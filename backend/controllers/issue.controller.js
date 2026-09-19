const { pool } = require('../config/db');
const { canAccessProject, loadProject } = require('../services/access.service');
const { logAudit } = require('../services/audit.service');

// GET /api/projects/:projectId/issues
async function listIssues(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT i.*, u.full_name AS raised_by_name
             FROM issues i
             LEFT JOIN users u ON u.id = i.raised_by
             WHERE i.project_id = $1
             ORDER BY i.created_at DESC`,
            [req.params.projectId]
        );
        res.json({ issues: rows });
    } catch (err) {
        next(err);
    }
}

// POST /api/projects/:projectId/issues
// Any authenticated user with project access may raise a challenge/issue,
// including students (section 2.1: "Students will have access to input
// challenges faced or issues faced").
async function createIssue(req, res, next) {
    try {
        const { title, rootCause, impact, supportRequired } = req.body || {};
        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Issue title is required.' });
        }
        const { rows } = await pool.query(
            `INSERT INTO issues (project_id, title, root_cause, impact, support_required, raised_by)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [req.params.projectId, title, rootCause || null, impact || null, supportRequired || null, req.user.id]
        );
        await logAudit({ userId: req.user.id, action: 'ISSUE_CREATE', entityType: 'issue', entityId: rows[0].id, instituteId: req.project.institute_id, ipAddress: req.ip });
        res.status(201).json({ issue: rows[0] });
    } catch (err) {
        next(err);
    }
}

// PUT /api/issues/:id
async function updateIssue(req, res, next) {
    try {
        const { rows: existingRows } = await pool.query(`SELECT * FROM issues WHERE id = $1`, [req.params.id]);
        const issue = existingRows[0];
        if (!issue) return res.status(404).json({ error: 'Issue not found.' });

        const project = await loadProject(issue.project_id);
        if (!project || !canAccessProject(req.user, project)) {
            return res.status(403).json({ error: 'You are not authorized to update this issue.' });
        }

        const { status, escalationLevel, rootCause, impact, supportRequired } = req.body || {};
        const allowedStatus = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
        const allowedEscalation = ['NONE', 'DEPARTMENT', 'INSTITUTE', 'PROGRAMME'];
        if (status && !allowedStatus.includes(status)) {
            return res.status(400).json({ error: `status must be one of ${allowedStatus.join(', ')}.` });
        }
        if (escalationLevel && !allowedEscalation.includes(escalationLevel)) {
            return res.status(400).json({ error: `escalationLevel must be one of ${allowedEscalation.join(', ')}.` });
        }

        const { rows } = await pool.query(
            `UPDATE issues
             SET status = COALESCE($1, status),
                 escalation_level = COALESCE($2, escalation_level),
                 root_cause = COALESCE($3, root_cause),
                 impact = COALESCE($4, impact),
                 support_required = COALESCE($5, support_required)
             WHERE id = $6 RETURNING *`,
            [status || null, escalationLevel || null, rootCause || null, impact || null, supportRequired || null, req.params.id]
        );

        await logAudit({ userId: req.user.id, action: 'ISSUE_UPDATE', entityType: 'issue', entityId: req.params.id, instituteId: project.institute_id, ipAddress: req.ip });
        res.json({ issue: rows[0] });
    } catch (err) {
        next(err);
    }
}

module.exports = { listIssues, createIssue, updateIssue };
