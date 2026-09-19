const { pool } = require('../config/db');

// GET /api/departments/:departmentId
async function getDepartment(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT d.id, d.code, d.name, d.institute_id,
                    i.name AS institute_name, i.code AS institute_code,
                    COALESCE(hu.full_name, d.head_display_name) AS head_name,
                    cu.full_name AS coordinator_name
             FROM departments d
             JOIN institutes i ON i.id = d.institute_id
             LEFT JOIN users hu ON hu.id = d.head_user_id
             LEFT JOIN users cu ON cu.id = d.coordinator_user_id
             WHERE d.id = $1`,
            [req.params.departmentId]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Department not found.' });
        res.json({ department: rows[0] });
    } catch (err) {
        next(err);
    }
}

// GET /api/departments/:departmentId/projects
// Query params: search, status (GREEN|YELLOW|RED), mentor (user id),
// semester, phase, overdue (true), sort
async function listProjects(req, res, next) {
    try {
        const { departmentId } = req.params;
        const { search, status, mentor, semester, phase, overdue, sort } = req.query;

        const conditions = ['p.department_id = $1', 'p.is_active = TRUE'];
        const params = [departmentId];

        if (search) {
            params.push(`%${search}%`);
            conditions.push(`(p.title ILIKE $${params.length} OR p.project_code ILIKE $${params.length} OR p.team_id ILIKE $${params.length}
                    OR p.artefact_id ILIKE $${params.length} OR p.artefact_title ILIKE $${params.length} OR p.theme_name ILIKE $${params.length})`);
        }
        if (status && ['GREEN', 'YELLOW', 'RED'].includes(status)) {
            params.push(status);
            conditions.push(`p.rag_status = $${params.length}`);
        }
        if (mentor) {
            params.push(mentor);
            conditions.push(`COALESCE(p.faculty_mentor_name, mu.full_name) = $${params.length}`);
        }
        if (semester) {
            params.push(semester);
            conditions.push(`p.semester = $${params.length}`);
        }
        if (phase) {
            params.push(phase);
            conditions.push(`p.project_phase = $${params.length}`);
        }
        if (overdue === 'true') {
            conditions.push(`p.next_review_at < now()`);
        }

        const sortMap = {
            severity: `CASE p.rag_status WHEN 'RED' THEN 0 WHEN 'YELLOW' THEN 1 ELSE 2 END`,
            oldest_update: `p.last_update_at ASC`,
            nearest_milestone: `p.next_review_at ASC NULLS LAST`,
            mentor: `mentor_name ASC NULLS LAST`,
            name: `p.title ASC`,
        };
        const orderBy = sortMap[sort] || sortMap.severity;

        const { rows } = await pool.query(
            `SELECT p.id, p.project_code, p.title, p.rag_status, p.completion_pct,
                    p.last_update_at, p.next_review_at, p.semester, p.project_phase,
                    COALESCE(p.faculty_mentor_name, mu.full_name) AS mentor_name, p.academic_year,
                    p.team_id, p.artefact_id, p.theme_name, p.artefact_title,
                    p.coordinator_name, p.reviewer_name,
                    COUNT(iss.id) FILTER (WHERE iss.status IN ('OPEN','IN_PROGRESS')) AS open_issue_count
             FROM projects p
             LEFT JOIN users mu ON mu.id = p.mentor_user_id
             LEFT JOIN issues iss ON iss.project_id = p.id
             WHERE ${conditions.join(' AND ')}
             GROUP BY p.id, mu.id
             ORDER BY ${orderBy}`,
            params
        );

        res.json({ projects: rows });
    } catch (err) {
        next(err);
    }
}

// GET /api/departments/:departmentId/mentors - for the mentor filter dropdown
async function listMentors(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT DISTINCT COALESCE(p.faculty_mentor_name, u.full_name) AS full_name
             FROM projects p
             LEFT JOIN users u ON u.id = p.mentor_user_id
             WHERE p.department_id = $1 AND COALESCE(p.faculty_mentor_name, u.full_name) IS NOT NULL
             ORDER BY 1`,
            [req.params.departmentId]
        );
        res.json({ mentors: rows });
    } catch (err) {
        next(err);
    }
}

module.exports = { getDepartment, listProjects, listMentors };
