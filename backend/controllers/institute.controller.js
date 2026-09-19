const { pool } = require('../config/db');
const { scopeArrays } = require('../services/access.service');

const GLOBAL_ROLES = ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER'];

function isGlobalUser(req) {
    return (req.user.roles || []).some((r) => GLOBAL_ROLES.includes(r));
}

// GET /api/institutes - institutes authorized for the current user
async function listInstitutes(req, res, next) {
    try {
        let rows;
        if (isGlobalUser(req)) {
            ({ rows } = await pool.query(
                `SELECT id, code, name FROM institutes WHERE is_active = TRUE ORDER BY display_order, name`
            ));
        } else {
            const ids = scopeArrays(req.user).viewInstituteIds;
            ({ rows } = await pool.query(
                `SELECT id, code, name FROM institutes WHERE id = ANY($1::uuid[]) AND is_active = TRUE ORDER BY display_order, name`,
                [ids]
            ));
        }
        res.json({ institutes: rows });
    } catch (err) {
        next(err);
    }
}

// GET /api/institutes/:instituteId - single institute (tenant-scoped by middleware)
async function getInstitute(req, res, next) {
    try {
        const { rows } = await pool.query(`SELECT id, code, name FROM institutes WHERE id = $1`, [req.params.instituteId]);
        if (!rows[0]) return res.status(404).json({ error: 'Institute not found.' });
        res.json({ institute: rows[0] });
    } catch (err) {
        next(err);
    }
}

// GET /api/institutes/:instituteId/departments - a Dean/Head with department
// access sees only their own departments of the college.
async function listDepartments(req, res, next) {
    try {
        const restricted = !isGlobalUser(req) && !(req.user.instituteIds || []).includes(req.params.instituteId);
        const params = [req.params.instituteId];
        let restriction = '';
        if (restricted) {
            params.push(scopeArrays(req.user).departmentIds);
            restriction = 'AND d.id = ANY($2::int[])';
        }
        const { rows } = await pool.query(
            `SELECT d.id, d.code, d.name,
                    d.head_user_id, COALESCE(hu.full_name, d.head_display_name) AS head_name,
                    COUNT(p.id) FILTER (WHERE p.is_active) AS project_count,
                    COUNT(p.id) FILTER (WHERE p.rag_status = 'GREEN' AND p.is_active) AS green_count,
                    COUNT(p.id) FILTER (WHERE p.rag_status = 'YELLOW' AND p.is_active) AS yellow_count,
                    COUNT(p.id) FILTER (WHERE p.rag_status = 'RED' AND p.is_active) AS red_count
             FROM departments d
             LEFT JOIN users hu ON hu.id = d.head_user_id
             LEFT JOIN projects p ON p.department_id = d.id
             WHERE d.institute_id = $1 AND d.is_active = TRUE ${restriction}
             GROUP BY d.id, hu.id
             ORDER BY d.name`,
            params
        );
        res.json({ departments: rows });
    } catch (err) {
        next(err);
    }
}

// GET /api/institutes/:instituteId/staff - for owner / dean / head pickers.
// Includes each person's role codes so the caller can offer only eligible people.
async function listStaff(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT u.id, u.full_name, u.email,
                    COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS role_codes
             FROM users u
             JOIN user_institute_access uia ON uia.user_id = u.id
             LEFT JOIN user_roles ur ON ur.user_id = u.id
             LEFT JOIN roles r ON r.id = ur.role_id
             WHERE uia.institute_id = $1 AND u.is_active = TRUE
             GROUP BY u.id
             ORDER BY u.full_name`,
            [req.params.instituteId]
        );
        res.json({ staff: rows });
    } catch (err) {
        next(err);
    }
}

module.exports = { listInstitutes, getInstitute, listDepartments, listStaff };
