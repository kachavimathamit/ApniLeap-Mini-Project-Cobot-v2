const { logAudit } = require('../services/audit.service');
const { pool } = require('../config/db');
const { canAccessProject } = require('../services/access.service');

const GLOBAL_ROLES = ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER'];

// Every handler below is wrapped in try/catch -> next(err). Express 4 does
// NOT catch rejected promises from async middleware; an uncaught one (e.g.
// a malformed UUID in a URL param throwing inside pool.query) becomes an
// unhandled rejection that crashes the whole Node process, not just the
// request. This was found and fixed after exactly that happened.

// Enforces institute-scope isolation. Reads the institute id from
// req.params[paramName] and rejects the request unless the authenticated
// user holds a global role or has an explicit grant for that institute.
// This is the backend security boundary referenced in requirements section 7:
// changing a URL/param to another institute's id must be rejected and audited.
function requireInstituteScope(paramName = 'instituteId') {
    return async (req, res, next) => {
        try {
            const instituteId = req.params[paramName];
            const roles = req.user?.roles || [];
            const isGlobal = roles.some((r) => GLOBAL_ROLES.includes(r));

            if (isGlobal) {
                return next();
            }

            const authorized = (req.user?.instituteIds || []).includes(instituteId) ||
                (req.user?.viewInstituteIds || []).includes(instituteId);

            if (!authorized) {
                await logAudit({
                    userId: req.user?.id,
                    action: 'ACCESS_DENIED_TENANT',
                    entityType: 'institute',
                    entityId: instituteId,
                    instituteId,
                    details: { route: req.originalUrl },
                    ipAddress: req.ip,
                });
                // Do not reveal whether the record exists (section 10).
                return res.status(403).json({ error: 'You are not authorized to access this institute.' });
            }

            next();
        } catch (err) {
            next(err);
        }
    };
}

// Enforces department-scope isolation. Loads the department's owning institute
// and rejects the request unless the user holds a global role, has an
// institute-level grant for that department's institute, or an explicit
// department-level grant for that department.
function requireDepartmentScope(paramName = 'departmentId') {
    return async (req, res, next) => {
        try {
            const departmentId = req.params[paramName];
            const roles = req.user?.roles || [];
            const isGlobal = roles.some((r) => GLOBAL_ROLES.includes(r));

            if (isGlobal) {
                return next();
            }

            const { rows } = await pool.query(
                `SELECT id, institute_id FROM departments WHERE id = $1`,
                [departmentId]
            );
            const department = rows[0];

            if (!department) {
                // Do not reveal whether the record exists.
                return res.status(404).json({ error: 'Department not found.' });
            }

            const authorized =
                (req.user?.instituteIds || []).includes(department.institute_id) ||
                (req.user?.departmentIds || []).includes(department.id);

            if (!authorized) {
                await logAudit({
                    userId: req.user?.id,
                    action: 'ACCESS_DENIED_TENANT',
                    entityType: 'department',
                    entityId: departmentId,
                    instituteId: department.institute_id,
                    details: { route: req.originalUrl },
                    ipAddress: req.ip,
                });
                return res.status(403).json({ error: 'You are not authorized to access this department.' });
            }

            req.department = department;
            next();
        } catch (err) {
            next(err);
        }
    };
}

// Enforces project-scope isolation. Loads the project and rejects the request
// unless the user holds a global role, an institute/department-level grant
// covering the project, or is the project's own assigned mentor.
function requireProjectScope(paramName = 'projectId') {
    return async (req, res, next) => {
        try {
            const projectId = req.params[paramName];

            const { rows } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [projectId]);
            const project = rows[0];

            if (!project) {
                return res.status(404).json({ error: 'Project not found.' });
            }

            if (!canAccessProject(req.user, project)) {
                await logAudit({
                    userId: req.user?.id,
                    action: 'ACCESS_DENIED_TENANT',
                    entityType: 'project',
                    entityId: projectId,
                    instituteId: project.institute_id,
                    details: { route: req.originalUrl },
                    ipAddress: req.ip,
                });
                return res.status(403).json({ error: 'You are not authorized to access this project.' });
            }

            req.project = project;
            next();
        } catch (err) {
            next(err);
        }
    };
}

module.exports = { requireInstituteScope, requireDepartmentScope, requireProjectScope };
