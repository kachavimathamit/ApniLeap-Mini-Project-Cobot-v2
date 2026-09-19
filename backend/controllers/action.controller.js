const { pool } = require('../config/db');
const { canAccessProject, loadProject, isAuthorizedApprover } = require('../services/access.service');
const { logAudit } = require('../services/audit.service');
const { cleanName } = require('../validators/academic.validator');

// GET /api/projects/:projectId/actions
async function listActions(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT a.*, COALESCE(a.owner_name, ou.full_name) AS owner_name, vu.full_name AS verified_by_name
             FROM corrective_actions a
             LEFT JOIN users ou ON ou.id = a.owner_user_id
             LEFT JOIN users vu ON vu.id = a.verified_by
             WHERE a.project_id = $1
             ORDER BY a.due_date NULLS LAST, a.created_at DESC`,
            [req.params.projectId]
        );
        res.json({ actions: rows });
    } catch (err) {
        next(err);
    }
}

// POST /api/projects/:projectId/actions
async function createAction(req, res, next) {
    try {
        const { description, issueId, dueDate, evidence } = req.body || {};
        const ownerName = cleanName(req.body && req.body.ownerName);
        if (!description || !description.trim()) {
            return res.status(400).json({ error: 'Corrective action description is required.' });
        }
        const { rows } = await pool.query(
            `INSERT INTO corrective_actions (project_id, issue_id, description, owner_name, due_date, evidence)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [req.params.projectId, issueId || null, description, ownerName, dueDate || null, evidence || null]
        );
        await logAudit({ userId: req.user.id, action: 'CORRECTIVE_ACTION_CREATE', entityType: 'corrective_action', entityId: rows[0].id, instituteId: req.project.institute_id, ipAddress: req.ip });
        res.status(201).json({ action: rows[0] });
    } catch (err) {
        next(err);
    }
}

// PUT /api/actions/:id
async function updateAction(req, res, next) {
    try {
        const { rows: existingRows } = await pool.query(`SELECT * FROM corrective_actions WHERE id = $1`, [req.params.id]);
        const action = existingRows[0];
        if (!action) return res.status(404).json({ error: 'Corrective action not found.' });

        const project = await loadProject(action.project_id);
        if (!project || !canAccessProject(req.user, project)) {
            return res.status(403).json({ error: 'You are not authorized to update this corrective action.' });
        }

        const { status, evidence, dueDate } = req.body || {};
        const allowedStatus = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'OVERDUE'];
        if (status && !allowedStatus.includes(status)) {
            return res.status(400).json({ error: `status must be one of ${allowedStatus.join(', ')}.` });
        }
        if (status === 'VERIFIED') {
            return res.status(400).json({ error: 'Use POST /api/actions/:id/verify to verify a corrective action.' });
        }

        const { rows } = await pool.query(
            `UPDATE corrective_actions
             SET status = COALESCE($1, status),
                 evidence = COALESCE($2, evidence),
                 due_date = COALESCE($3, due_date),
                 completed_at = CASE WHEN $1 = 'COMPLETED' THEN now() ELSE completed_at END
             WHERE id = $4 RETURNING *`,
            [status || null, evidence || null, dueDate || null, req.params.id]
        );

        await logAudit({ userId: req.user.id, action: 'CORRECTIVE_ACTION_UPDATE', entityType: 'corrective_action', entityId: req.params.id, instituteId: project.institute_id, ipAddress: req.ip });
        res.json({ action: rows[0] });
    } catch (err) {
        next(err);
    }
}

// POST /api/actions/:id/verify - authorized reviewer confirms evidence and closes the loop
async function verifyAction(req, res, next) {
    try {
        const { rows: existingRows } = await pool.query(`SELECT * FROM corrective_actions WHERE id = $1`, [req.params.id]);
        const action = existingRows[0];
        if (!action) return res.status(404).json({ error: 'Corrective action not found.' });

        const project = await loadProject(action.project_id);
        if (!project || !canAccessProject(req.user, project)) {
            return res.status(403).json({ error: 'You are not authorized to verify this corrective action.' });
        }
        if (!isAuthorizedApprover(req.user)) {
            return res.status(403).json({ error: 'Only an authorized reviewer may verify a corrective action.' });
        }
        if (action.status !== 'COMPLETED') {
            return res.status(400).json({ error: 'Only a completed corrective action can be verified.' });
        }
        if (!action.evidence) {
            return res.status(400).json({ error: 'This corrective action has no evidence recorded and cannot be verified.' });
        }

        const { rows } = await pool.query(
            `UPDATE corrective_actions SET status = 'VERIFIED', verified_by = $1, verified_at = now() WHERE id = $2 RETURNING *`,
            [req.user.id, req.params.id]
        );

        await logAudit({ userId: req.user.id, action: 'CORRECTIVE_ACTION_VERIFY', entityType: 'corrective_action', entityId: req.params.id, instituteId: project.institute_id, ipAddress: req.ip });
        res.json({ action: rows[0] });
    } catch (err) {
        next(err);
    }
}

module.exports = { listActions, createAction, updateAction, verifyAction };
