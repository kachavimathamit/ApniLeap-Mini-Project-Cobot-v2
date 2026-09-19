const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const { isGlobalUser } = require('../services/access.service');
const { logAudit } = require('../services/audit.service');
const { cleanName } = require('../validators/academic.validator');

const PRIVILEGED_ROLES = ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER'];

// GET /api/admin/users?instituteId=&role=&q=
// Filtered search: nothing is returned unless at least one filter is given.
// Students are never listed (their accounts come from project teams). A
// Platform Administrator sees everyone else; an Institute Administrator only
// users of their own institute(s), and never the platform-wide roles.
async function listUsers(req, res, next) {
    try {
        const global = isGlobalUser(req.user);
        const instituteId = String(req.query.instituteId || '').trim();
        const role = String(req.query.role || '').trim();
        const q = String(req.query.q || '').trim();

        if (!instituteId && !role && !q) {
            return res.status(400).json({ error: 'Choose an organization, a role or type some details, then search.' });
        }
        if (role === 'STUDENT') {
            return res.json({ users: [], total: 0, truncated: false });
        }

        const params = [];
        const where = [
            `NOT EXISTS (SELECT 1 FROM user_roles sr JOIN roles srr ON srr.id = sr.role_id
                         WHERE sr.user_id = u.id AND srr.code = 'STUDENT')`,
        ];

        if (!global) {
            params.push(req.user.instituteIds.length ? req.user.instituteIds : ['00000000-0000-0000-0000-000000000000']);
            where.push(`u.id IN (SELECT user_id FROM user_institute_access WHERE institute_id = ANY($${params.length}::uuid[]))`);
            params.push(PRIVILEGED_ROLES);
            where.push(`NOT EXISTS (SELECT 1 FROM user_roles pr JOIN roles prr ON prr.id = pr.role_id
                                    WHERE pr.user_id = u.id AND prr.code = ANY($${params.length}::text[]))`);
        }
        if (instituteId) {
            if (!global && !req.user.instituteIds.includes(instituteId)) {
                return res.status(403).json({ error: 'You may only search your own institute.' });
            }
            params.push(instituteId);
            where.push(`u.id IN (SELECT user_id FROM user_institute_access WHERE institute_id = $${params.length}::uuid)`);
            // Platform-wide roles have access to every institute; list them only when asked for by role.
            if (!PRIVILEGED_ROLES.includes(role)) {
                params.push(PRIVILEGED_ROLES);
                where.push(`NOT EXISTS (SELECT 1 FROM user_roles gr JOIN roles grr ON grr.id = gr.role_id
                                        WHERE gr.user_id = u.id AND grr.code = ANY($${params.length}::text[]))`);
            }
        }
        if (role) {
            params.push(role);
            where.push(`EXISTS (SELECT 1 FROM user_roles fr JOIN roles frr ON frr.id = fr.role_id
                                WHERE fr.user_id = u.id AND frr.code = $${params.length})`);
        }
        if (q) {
            params.push(`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
            where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
        }

        const { rows } = await pool.query(
            `SELECT u.id, u.email, u.full_name, u.is_active, u.last_login_at, u.created_at,
                    COALESCE((SELECT array_agg(DISTINCT r.code) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '{}') AS role_codes,
                    COALESCE((SELECT array_agg(DISTINCT r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '{}') AS role_names,
                    COALESCE((SELECT array_agg(DISTINCT i.name) FROM user_institute_access a JOIN institutes i ON i.id = a.institute_id WHERE a.user_id = u.id), '{}') AS institute_names,
                    COALESCE((SELECT array_agg(a.institute_id) FROM user_institute_access a WHERE a.user_id = u.id), '{}') AS institute_ids,
                    COALESCE((SELECT array_agg(a.department_id ORDER BY a.department_id) FROM user_department_access a WHERE a.user_id = u.id), '{}') AS department_ids,
                    COALESCE((SELECT array_agg(d.name ORDER BY d.name) FROM user_department_access a JOIN departments d ON d.id = a.department_id WHERE a.user_id = u.id), '{}') AS department_names
             FROM users u
             WHERE ${where.join(' AND ')}
             ORDER BY u.full_name
             LIMIT 51`,
            params
        );
        const truncated = rows.length > 50;
        res.json({ users: rows.slice(0, 50), total: Math.min(rows.length, 50), truncated });
    } catch (err) {
        next(err);
    }
}

// Departments must belong to the colleges the user is being given.
async function checkDepartmentGrant(req, departmentIds, instituteIds) {
    if (!departmentIds.length) return null;
    if (!departmentIds.every((d) => Number.isInteger(d))) return 'Department access must be a list of department ids.';
    const { rows } = await pool.query(`SELECT id, institute_id FROM departments WHERE id = ANY($1::int[])`, [departmentIds]);
    if (rows.length !== new Set(departmentIds).size) return 'One or more departments do not exist.';
    if (rows.some((d) => !instituteIds.includes(d.institute_id))) return 'A department must belong to one of the user\'s colleges.';
    if (!isGlobalUser(req.user) && rows.some((d) => !req.user.instituteIds.includes(d.institute_id))) {
        return 'You may only grant access to departments of your own institute.';
    }
    return null;
}

// PATCH /api/admin/users/:id/departments  { departmentIds: [int] }
// Replaces the user's department access within the colleges the caller manages.
async function setUserDepartments(req, res, next) {
    const client = await pool.connect();
    try {
        const departmentIds = Array.isArray(req.body && req.body.departmentIds) ? req.body.departmentIds.map(Number) : null;
        if (!departmentIds) return res.status(400).json({ error: 'departmentIds (list) is required.' });

        const { rows: target } = await client.query(
            `SELECT u.id,
                    COALESCE((SELECT array_agg(institute_id) FROM user_institute_access WHERE user_id = u.id), '{}') AS institute_ids,
                    COALESCE((SELECT array_agg(r.code) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '{}') AS role_codes
             FROM users u WHERE u.id = $1`,
            [req.params.id]
        );
        const user = target[0];
        if (!user || user.role_codes.includes('STUDENT')) return res.status(404).json({ error: 'User not found.' });
        if (!isGlobalUser(req.user)) {
            const shared = user.institute_ids.some((i) => req.user.instituteIds.includes(i));
            if (!shared || user.role_codes.some((r) => PRIVILEGED_ROLES.includes(r))) {
                return res.status(403).json({ error: 'You are not authorized to manage this user.' });
            }
        }
        const problem = await checkDepartmentGrant(req, departmentIds, user.institute_ids);
        if (problem) return res.status(400).json({ error: problem });

        await client.query('BEGIN');
        // Only departments of colleges this caller manages are replaced.
        const manageable = isGlobalUser(req.user) ? user.institute_ids : user.institute_ids.filter((i) => req.user.instituteIds.includes(i));
        await client.query(
            `DELETE FROM user_department_access
             WHERE user_id = $1 AND department_id IN (SELECT id FROM departments WHERE institute_id = ANY($2::uuid[]))`,
            [user.id, manageable]
        );
        for (const id of new Set(departmentIds)) {
            await client.query(`INSERT INTO user_department_access (user_id, department_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [user.id, id]);
        }
        await client.query('COMMIT');
        await logAudit({ userId: req.user.id, action: 'USER_DEPARTMENTS_UPDATE', entityType: 'user', entityId: user.id, ipAddress: req.ip, details: { departmentIds } });
        res.json({ departmentIds: [...new Set(departmentIds)] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        next(err);
    } finally {
        client.release();
    }
}

// GET /api/admin/roles
async function listRoles(req, res, next) {
    try {
        const { rows } = await pool.query(`SELECT id, code, name, description FROM roles ORDER BY id`);
        res.json({ roles: rows });
    } catch (err) {
        next(err);
    }
}

// POST /api/admin/users
async function createUser(req, res, next) {
    const client = await pool.connect();
    try {
        const { email, fullName, password, roleCodes, instituteIds } = req.body || {};
        const departmentIds = Array.isArray(req.body && req.body.departmentIds) ? req.body.departmentIds.map(Number) : [];
        const global = isGlobalUser(req.user);

        if (!email || !fullName || !password || !Array.isArray(roleCodes) || !roleCodes.length) {
            return res.status(400).json({ error: 'email, fullName, password and at least one role are required.' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        }

        if (roleCodes.includes('STUDENT')) {
            return res.status(400).json({ error: 'Student accounts are created automatically from the SRNs on a project team (login = SRN).' });
        }

        // An Institute Administrator may not create platform-wide roles, and
        // may only grant access to their own institute(s).
        let grantIds = Array.isArray(instituteIds) ? instituteIds : [];
        if (!global) {
            if (roleCodes.some((r) => PRIVILEGED_ROLES.includes(r))) {
                return res.status(403).json({ error: 'You are not authorized to assign a platform-wide role.' });
            }
            const notOwned = grantIds.filter((id) => !req.user.instituteIds.includes(id));
            if (notOwned.length) {
                return res.status(403).json({ error: 'You may only grant access to your own institute.' });
            }
        }

        const deptProblem = await checkDepartmentGrant(req, departmentIds, grantIds);
        if (deptProblem) return res.status(400).json({ error: deptProblem });

        const { rows: roleRows } = await client.query(`SELECT id, code FROM roles WHERE code = ANY($1::text[])`, [roleCodes]);
        if (roleRows.length !== roleCodes.length) {
            return res.status(400).json({ error: 'One or more role codes are invalid.' });
        }

        await client.query('BEGIN');

        const passwordHash = await bcrypt.hash(password, 12);
        const { rows: userRows } = await client.query(
            `INSERT INTO users (email, password_hash, full_name) VALUES ($1,$2,$3) RETURNING id, email, full_name`,
            [String(email).toLowerCase().trim(), passwordHash, fullName]
        );
        const userId = userRows[0].id;

        for (const role of roleRows) {
            await client.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`, [userId, role.id]);
        }
        for (const instituteId of grantIds) {
            await client.query(`INSERT INTO user_institute_access (user_id, institute_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [userId, instituteId]);
        }

        for (const departmentId of new Set(departmentIds)) {
            await client.query(`INSERT INTO user_department_access (user_id, department_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [userId, departmentId]);
        }

        await client.query('COMMIT');
        await logAudit({ userId: req.user.id, action: 'USER_CREATE', entityType: 'user', entityId: userId, ipAddress: req.ip, details: { roleCodes, instituteIds: grantIds, departmentIds } });

        res.status(201).json({ user: userRows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
            return res.status(409).json({ error: 'A user with this email already exists.' });
        }
        next(err);
    } finally {
        client.release();
    }
}

// PATCH /api/admin/users/:id/status
async function setUserStatus(req, res, next) {
    try {
        const { isActive } = req.body || {};
        if (typeof isActive !== 'boolean') {
            return res.status(400).json({ error: 'isActive (boolean) is required.' });
        }

        if (!isGlobalUser(req.user)) {
            const { rows } = await pool.query(
                `SELECT 1 FROM user_institute_access WHERE user_id = $1 AND institute_id = ANY($2::uuid[])`,
                [req.params.id, req.user.instituteIds]
            );
            const { rows: privileged } = await pool.query(
                `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = $1 AND r.code = ANY($2::text[])`,
                [req.params.id, PRIVILEGED_ROLES]
            );
            if (!rows.length || privileged.length) {
                return res.status(403).json({ error: 'You are not authorized to manage this user.' });
            }
        }

        const { rows } = await pool.query(
            `UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, email, full_name, is_active`,
            [isActive, req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'User not found.' });

        await logAudit({ userId: req.user.id, action: isActive ? 'USER_ACTIVATE' : 'USER_DEACTIVATE', entityType: 'user', entityId: req.params.id, ipAddress: req.ip });
        res.json({ user: rows[0] });
    } catch (err) {
        next(err);
    }
}

// POST /api/admin/institutes - Platform Administrator only (enforced by route)
async function createInstitute(req, res, next) {
    try {
        const { code, name } = req.body || {};
        if (!code || !name) {
            return res.status(400).json({ error: 'code and name are required.' });
        }
        const { rows } = await pool.query(
            `INSERT INTO institutes (code, name) VALUES ($1,$2) RETURNING *`,
            [code.toUpperCase().trim(), name]
        );
        await logAudit({ userId: req.user.id, action: 'INSTITUTE_CREATE', entityType: 'institute', entityId: rows[0].id, instituteId: rows[0].id, ipAddress: req.ip });
        res.status(201).json({ institute: rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'An institute with this code already exists.' });
        next(err);
    }
}

// A Dean must hold the Dean/Principal role and a Department Head the
// Department Head role, and both must belong to the institute. Returns an
// error message, or null when the person is eligible (or none was chosen).
async function checkLeader(userId, instituteId, roleCode, label) {
    if (!userId) return null;
    const { rows } = await pool.query(
        `SELECT 1
         FROM users u
         JOIN user_institute_access uia ON uia.user_id = u.id AND uia.institute_id = $2
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id AND r.code = $3
         WHERE u.id = $1 AND u.is_active = TRUE`,
        [userId, instituteId, roleCode]
    );
    return rows.length ? null : `The selected ${label} must be an active user of this institute with the ${roleCode === 'DEAN_PRINCIPAL' ? 'Dean/Principal' : 'Department Head'} role.`;
}

// Institute Administrators may only change their own institute; the entity
// routes below address a department directly, so check its institute here.
function canManageInstitute(req, instituteId) {
    return isGlobalUser(req.user) || (req.user.instituteIds || []).includes(instituteId);
}

// A Department Head works in their own department, so naming one grants that access.
async function grantHeadAccess(userId, departmentId) {
    if (!userId) return;
    await pool.query(
        `INSERT INTO user_department_access (user_id, department_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [userId, departmentId]
    );
}

// POST /api/admin/institutes/:instituteId/departments  { name, headUserId?, headName? }
// The department id (integer) and its code (Dept-<id>) are assigned by the database.
async function createDepartment(req, res, next) {
    try {
        const { headUserId } = req.body || {};
        const name = String((req.body && req.body.name) || '').trim().replace(/\s+/g, ' ');
        const headName = headUserId ? null : cleanName(req.body && req.body.headName);
        if (!name) {
            return res.status(400).json({ error: 'Department name is required.' });
        }
        const problem = await checkLeader(headUserId, req.params.instituteId, 'DEPARTMENT_HEAD', 'Department Head');
        if (problem) return res.status(400).json({ error: problem });

        const { rows } = await pool.query(
            `INSERT INTO departments (institute_id, name, head_user_id, head_display_name) VALUES ($1,$2,$3,$4) RETURNING *`,
            [req.params.instituteId, name, headUserId || null, headName]
        );
        await grantHeadAccess(headUserId, rows[0].id);
        await logAudit({ userId: req.user.id, action: 'DEPARTMENT_CREATE', entityType: 'department', entityId: rows[0].id, instituteId: req.params.instituteId, ipAddress: req.ip });
        res.status(201).json({ department: rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'A department with this name already exists in this institute.' });
        next(err);
    }
}

// PATCH /api/admin/departments/:id  { name?, headUserId?, headName? }
async function updateDepartment(req, res, next) {
    try {
        const { rows: found } = await pool.query(`SELECT * FROM departments WHERE id = $1`, [req.params.id]);
        const dept = found[0];
        if (!dept || !canManageInstitute(req, dept.institute_id)) {
            return res.status(404).json({ error: 'Department not found.' });
        }
        const body = req.body || {};
        const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

        if (has('headUserId') && body.headUserId) {
            const problem = await checkLeader(body.headUserId, dept.institute_id, 'DEPARTMENT_HEAD', 'Department Head');
            if (problem) return res.status(400).json({ error: problem });
        }
        if (has('name') && !String(body.name || '').trim()) {
            return res.status(400).json({ error: 'name cannot be empty.' });
        }

        const { rows } = await pool.query(
            `UPDATE departments SET
                name = COALESCE($1, name),
                head_user_id = CASE WHEN $2 THEN $3::uuid ELSE head_user_id END,
                head_display_name = CASE WHEN $2 THEN $4 ELSE head_display_name END
             WHERE id = $5 RETURNING *`,
            [has('name') ? String(body.name).trim().replace(/\s+/g, ' ') : null,
             has('headUserId') || has('headName'), body.headUserId || null, body.headUserId ? null : cleanName(body.headName), dept.id]
        );
        await grantHeadAccess(body.headUserId, dept.id);
        await logAudit({ userId: req.user.id, action: 'DEPARTMENT_UPDATE', entityType: 'department', entityId: dept.id, instituteId: dept.institute_id, details: body, ipAddress: req.ip });
        res.json({ department: rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'A department with this name already exists in this institute.' });
        next(err);
    }
}

// PATCH /api/admin/institutes/:id  { name }  (Platform Administrator only)
async function updateInstitute(req, res, next) {
    try {
        const name = String((req.body && req.body.name) || '').trim();
        if (!name) return res.status(400).json({ error: 'name is required.' });
        const { rows } = await pool.query(`UPDATE institutes SET name = $1 WHERE id = $2 RETURNING *`, [name, req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'Institute not found.' });
        await logAudit({ userId: req.user.id, action: 'INSTITUTE_UPDATE', entityType: 'institute', entityId: rows[0].id, instituteId: rows[0].id, details: { name }, ipAddress: req.ip });
        res.json({ institute: rows[0] });
    } catch (err) {
        next(err);
    }
}

// Removing a department or institute also removes its projects. Without
// ?cascade=true the request is refused with the counts so the UI can ask the
// user to confirm; nothing is deleted until the client repeats it with cascade.
function wantsCascade(req) {
    return req.query.cascade === 'true';
}

// DELETE /api/admin/departments/:id[?cascade=true]
async function deleteDepartment(req, res, next) {
    const client = await pool.connect();
    try {
        const { rows: found } = await client.query(`SELECT * FROM departments WHERE id = $1`, [req.params.id]);
        const dept = found[0];
        if (!dept || !canManageInstitute(req, dept.institute_id)) {
            return res.status(404).json({ error: 'Department not found.' });
        }
        const { rows: counts } = await client.query(`SELECT COUNT(*)::int AS n FROM projects WHERE department_id = $1`, [dept.id]);
        const projectCount = counts[0].n;
        if (projectCount > 0 && !wantsCascade(req)) {
            return res.status(409).json({
                error: `This department has ${projectCount} project(s). Deleting it also deletes those projects and their teams, milestones, KPIs, issues, actions and reviews.`,
                needsConfirm: true, projectCount,
            });
        }
        await client.query('BEGIN');
        await client.query(`DELETE FROM projects WHERE department_id = $1`, [dept.id]);
        await client.query(`DELETE FROM student_teams WHERE department_id = $1`, [dept.id]);
        await client.query(`DELETE FROM departments WHERE id = $1`, [dept.id]);
        await client.query('COMMIT');
        await logAudit({ userId: req.user.id, action: 'DEPARTMENT_DELETE', entityType: 'department', entityId: dept.id, instituteId: dept.institute_id, details: { code: dept.code, name: dept.name, projectsDeleted: projectCount }, ipAddress: req.ip });
        res.json({ deleted: true, projectsDeleted: projectCount });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        next(err);
    } finally {
        client.release();
    }
}

// DELETE /api/admin/institutes/:id?cascade=true&confirmCode=CODE
// Platform Administrator only. Removes the institute with its
// departments and projects. The caller must type the institute code.
async function deleteInstitute(req, res, next) {
    const client = await pool.connect();
    try {
        const { rows: found } = await client.query(`SELECT * FROM institutes WHERE id = $1`, [req.params.id]);
        const inst = found[0];
        if (!inst) return res.status(404).json({ error: 'Institute not found.' });

        const { rows: c } = await client.query(
            `SELECT (SELECT COUNT(*)::int FROM projects WHERE institute_id = $1) AS projects,
                    (SELECT COUNT(*)::int FROM departments WHERE institute_id = $1) AS departments`,
            [inst.id]
        );
        const counts = c[0];
        if (!wantsCascade(req) || String(req.query.confirmCode || '').toUpperCase() !== inst.code) {
            return res.status(409).json({
                error: `Deleting ${inst.code} also deletes its ${counts.departments} department(s) and ${counts.projects} project(s).`,
                needsConfirm: true, ...counts, code: inst.code,
            });
        }
        await client.query('BEGIN');
        await client.query(`DELETE FROM projects WHERE institute_id = $1`, [inst.id]);
        await client.query(`DELETE FROM institutes WHERE id = $1`, [inst.id]);
        await client.query('COMMIT');
        await logAudit({ userId: req.user.id, action: 'INSTITUTE_DELETE', entityType: 'institute', entityId: inst.id, instituteId: null, details: { code: inst.code, name: inst.name, ...counts }, ipAddress: req.ip });
        res.json({ deleted: true, ...counts });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        next(err);
    } finally {
        client.release();
    }
}

module.exports = {
    listUsers, listRoles, createUser, setUserStatus, setUserDepartments, createInstitute, updateInstitute, deleteInstitute,
    createDepartment, updateDepartment, deleteDepartment,
};
