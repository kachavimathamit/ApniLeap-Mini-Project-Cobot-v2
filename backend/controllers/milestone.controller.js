const { pool } = require('../config/db');
const { canAccessProject, loadProject } = require('../services/access.service');
const { logAudit } = require('../services/audit.service');

// GET /api/projects/:projectId/milestones
async function listMilestones(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM milestones WHERE project_id = $1 ORDER BY due_date NULLS LAST, created_at`,
            [req.params.projectId]
        );
        res.json({ milestones: rows });
    } catch (err) {
        next(err);
    }
}

// POST /api/projects/:projectId/milestones
async function createMilestone(req, res, next) {
    try {
        const { title, description, dueDate } = req.body || {};
        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Milestone title is required.' });
        }
        const { rows } = await pool.query(
            `INSERT INTO milestones (project_id, title, description, due_date) VALUES ($1,$2,$3,$4) RETURNING *`,
            [req.params.projectId, title, description || null, dueDate || null]
        );
        await logAudit({ userId: req.user.id, action: 'MILESTONE_CREATE', entityType: 'milestone', entityId: rows[0].id, instituteId: req.project.institute_id, ipAddress: req.ip });
        res.status(201).json({ milestone: rows[0] });
    } catch (err) {
        next(err);
    }
}

// PUT /api/milestones/:id
async function updateMilestone(req, res, next) {
    try {
        const { rows: existingRows } = await pool.query(`SELECT * FROM milestones WHERE id = $1`, [req.params.id]);
        const milestone = existingRows[0];
        if (!milestone) return res.status(404).json({ error: 'Milestone not found.' });

        const project = await loadProject(milestone.project_id);
        if (!project || !canAccessProject(req.user, project)) {
            return res.status(403).json({ error: 'You are not authorized to update this milestone.' });
        }

        const { title, description, dueDate, status } = req.body || {};
        const allowedStatus = ['UPCOMING', 'IN_PROGRESS', 'COMPLETED', 'MISSED'];
        if (status && !allowedStatus.includes(status)) {
            return res.status(400).json({ error: `status must be one of ${allowedStatus.join(', ')}.` });
        }

        const { rows } = await pool.query(
            `UPDATE milestones
             SET title = COALESCE($1, title),
                 description = COALESCE($2, description),
                 due_date = COALESCE($3, due_date),
                 status = COALESCE($4, status),
                 completed_at = CASE WHEN $4 = 'COMPLETED' THEN now() ELSE completed_at END
             WHERE id = $5 RETURNING *`,
            [title || null, description || null, dueDate || null, status || null, req.params.id]
        );

        await logAudit({ userId: req.user.id, action: 'MILESTONE_UPDATE', entityType: 'milestone', entityId: req.params.id, instituteId: project.institute_id, ipAddress: req.ip });
        res.json({ milestone: rows[0] });
    } catch (err) {
        next(err);
    }
}

module.exports = { listMilestones, createMilestone, updateMilestone };
