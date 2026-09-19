const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

// Verifies the JWT, loads the current user + roles + institute access, and
// attaches them to req.user. Deny by default: no token, no access.
async function authenticate(req, res, next) {
    try {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;

        if (!token) {
            return res.status(401).json({ error: 'Authentication required.' });
        }

        let payload;
        try {
            payload = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: 'Invalid or expired session.' });
        }

        const { rows } = await pool.query(
            `SELECT u.id, u.email, u.full_name, u.is_active, u.srn
             FROM users u WHERE u.id = $1`,
            [payload.sub]
        );
        const user = rows[0];

        if (!user || !user.is_active) {
            return res.status(401).json({ error: 'Account is not active.' });
        }

        const { rows: roleRows } = await pool.query(
            `SELECT r.code FROM user_roles ur
             JOIN roles r ON r.id = ur.role_id
             WHERE ur.user_id = $1`,
            [user.id]
        );

        const { rows: instituteRows } = await pool.query(
            `SELECT institute_id FROM user_institute_access WHERE user_id = $1`,
            [user.id]
        );

        const { rows: deptRows } = await pool.query(
            `SELECT department_id FROM user_department_access WHERE user_id = $1`,
            [user.id]
        );

        const roles = roleRows.map((r) => r.code);

        // A student sees only the project team(s) their SRN is on. Any institute or
        // department grant on a student-only account is ignored, so a student can
        // never read other teams even if such a grant was added by mistake.
        let projectIds = [];
        if (user.srn) {
            const { rows: teamRows } = await pool.query(
                `SELECT DISTINCT project_id FROM project_students WHERE srn = $1`,
                [user.srn]
            );
            projectIds = teamRows.map((r) => r.project_id);
        }
        const studentOnly = roles.length > 0 && roles.every((r) => r === 'STUDENT');
        // A Dean or Department Head (with no broader role) works only in the
        // departments they were given; a college-wide grant is ignored for them.
        const departmentScoped = roles.length > 0 && roles.every((r) => r === 'DEAN_PRINCIPAL' || r === 'DEPARTMENT_HEAD');
        const departmentIds = studentOnly ? [] : deptRows.map((r) => r.department_id);
        let viewInstituteIds = [];
        if (departmentScoped && departmentIds.length) {
            const { rows: viewRows } = await pool.query(
                `SELECT DISTINCT institute_id FROM departments WHERE id = ANY($1::int[])`,
                [departmentIds]
            );
            viewInstituteIds = viewRows.map((r) => r.institute_id);
        }

        req.user = {
            id: user.id,
            email: user.email,
            fullName: user.full_name,
            srn: user.srn || null,
            roles,
            instituteIds: (studentOnly || departmentScoped) ? [] : instituteRows.map((r) => r.institute_id),
            departmentIds,
            // Colleges a department-scoped user may open (read access to their own departments only).
            viewInstituteIds,
            departmentScoped,
            projectIds,
        };

        next();
    } catch (err) {
        next(err);
    }
}

module.exports = { authenticate };
