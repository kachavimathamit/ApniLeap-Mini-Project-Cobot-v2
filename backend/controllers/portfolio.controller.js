const { pool } = require('../config/db');
const { isGlobalUser, scopeArrays } = require('../services/access.service');

// Builds the WHERE fragment that restricts rows to what the user may see,
// mirroring canAccessProject(): global roles see everything; everyone else
// sees projects in their institutes or departments.
function scopeClause(user, startIndex) {
    if (isGlobalUser(user)) return { sql: 'TRUE', params: [] };
    const a = scopeArrays(user);
    return {
        sql: `(p.institute_id = ANY($${startIndex}::uuid[]) OR p.department_id = ANY($${startIndex + 1}::int[]) OR p.id = ANY($${startIndex + 2}::uuid[]))`,
        params: [a.instituteIds, a.departmentIds, a.projectIds],
    };
}

// GET /api/portfolio/projects?search=&status=
async function listProjects(req, res, next) {
    try {
        const scope = scopeClause(req.user, 1);
        const params = [...scope.params];
        const conditions = [scope.sql, 'p.is_active = TRUE'];

        if (req.query.status && ['GREEN', 'YELLOW', 'RED'].includes(req.query.status)) {
            params.push(req.query.status);
            conditions.push(`p.rag_status = $${params.length}`);
        }
        // Institute -> Department -> Faculty Mentor / Theme, each narrowing the last.
        if (req.query.instituteId) {
            params.push(req.query.instituteId);
            conditions.push(`p.institute_id = $${params.length}::uuid`);
        }
        if (req.query.departmentId) {
            params.push(req.query.departmentId);
            conditions.push(`p.department_id = $${params.length}::int`);
        }
        if (req.query.mentor) {
            params.push(req.query.mentor);
            conditions.push(`lower(COALESCE(p.faculty_mentor_name, mu.full_name)) = lower($${params.length})`);
        }
        if (req.query.theme) {
            params.push(req.query.theme);
            conditions.push(`lower(p.theme_name) = lower($${params.length})`);
        }
        if (req.query.search) {
            params.push(`%${String(req.query.search).replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
            const n = params.length;
            conditions.push(`(p.title ILIKE $${n} OR p.project_code ILIKE $${n} OR p.theme_name ILIKE $${n} OR p.artefact_title ILIKE $${n}
                              OR p.team_id ILIKE $${n} OR p.artefact_id ILIKE $${n} OR COALESCE(p.faculty_mentor_name, mu.full_name) ILIKE $${n})`);
        }

        const { rows } = await pool.query(
            `SELECT p.id, p.project_code, p.title, p.rag_status, p.completion_pct, p.next_review_at, p.last_update_at,
                    p.theme_name, p.team_id, p.artefact_id,
                    i.name AS institute_name, d.name AS department_name, COALESCE(p.faculty_mentor_name, mu.full_name) AS mentor_name
             FROM projects p
             JOIN institutes i ON i.id = p.institute_id
             JOIN departments d ON d.id = p.department_id
             LEFT JOIN users mu ON mu.id = p.mentor_user_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY CASE p.rag_status WHEN 'RED' THEN 0 WHEN 'YELLOW' THEN 1 ELSE 2 END, p.title
             LIMIT 500`,
            params
        );
        res.json({ projects: rows });
    } catch (err) {
        next(err);
    }
}

// GET /api/portfolio/filters?instituteId=&departmentId= - the Faculty Mentor and
// Theme choices for the projects the user can see in that department (or college).
async function listFilterOptions(req, res, next) {
    try {
        const scope = scopeClause(req.user, 1);
        const params = [...scope.params];
        const conditions = [scope.sql, 'p.is_active = TRUE'];
        if (req.query.instituteId) {
            params.push(req.query.instituteId);
            conditions.push(`p.institute_id = $${params.length}::uuid`);
        }
        if (req.query.departmentId) {
            params.push(req.query.departmentId);
            conditions.push(`p.department_id = $${params.length}::int`);
        }
        const { rows } = await pool.query(
            `SELECT DISTINCT COALESCE(p.faculty_mentor_name, mu.full_name) AS mentor, p.theme_name AS theme
             FROM projects p
             LEFT JOIN users mu ON mu.id = p.mentor_user_id
             WHERE ${conditions.join(' AND ')}`,
            params
        );
        const uniq = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));
        res.json({ mentors: uniq(rows.map((r) => r.mentor)), themes: uniq(rows.map((r) => r.theme)) });
    } catch (err) {
        next(err);
    }
}

// GET /api/portfolio/issues?status=
async function listIssues(req, res, next) {
    try {
        const scope = scopeClause(req.user, 1);
        const params = [...scope.params];
        const conditions = [scope.sql];

        if (req.query.status && ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(req.query.status)) {
            params.push(req.query.status);
            conditions.push(`iss.status = $${params.length}`);
        }

        const { rows } = await pool.query(
            `SELECT iss.id, iss.title, iss.status, iss.escalation_level, iss.created_at,
                    p.id AS project_id, p.project_code, p.title AS project_title, i.name AS institute_name
             FROM issues iss
             JOIN projects p ON p.id = iss.project_id
             JOIN institutes i ON i.id = p.institute_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY iss.created_at DESC
             LIMIT 500`,
            params
        );
        res.json({ issues: rows });
    } catch (err) {
        next(err);
    }
}

// GET /api/portfolio/reviews
async function listReviews(req, res, next) {
    try {
        const scope = scopeClause(req.user, 1);
        const { rows } = await pool.query(
            `SELECT r.id, r.review_date, r.comments, r.decision, r.recommended_status,
                    p.id AS project_id, p.project_code, p.title AS project_title, i.name AS institute_name,
                    u.full_name AS reviewer_name
             FROM reviews r
             JOIN projects p ON p.id = r.project_id
             JOIN institutes i ON i.id = p.institute_id
             LEFT JOIN users u ON u.id = r.reviewer_user_id
             WHERE ${scope.sql}
             ORDER BY r.review_date DESC
             LIMIT 500`,
            scope.params
        );
        res.json({ reviews: rows });
    } catch (err) {
        next(err);
    }
}

module.exports = { listProjects, listFilterOptions, listIssues, listReviews };
