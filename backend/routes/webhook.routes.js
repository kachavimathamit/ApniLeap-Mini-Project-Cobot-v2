const express = require('express');
const { pool } = require('../config/db');
const { logAudit } = require('../services/audit.service');

const router = express.Router();

// POST /api/webhooks/jira - receives Jira issue-update events. Jira Cloud
// can only reach a publicly resolvable URL, so this endpoint is inert on a
// localhost dev server; it is wired up so the route exists per the API
// contract (section 27) and works as-is once the backend is deployed
// publicly and the webhook is registered in Jira project settings.
router.post('/jira', async (req, res, next) => {
    try {
        const issueKey = req.body?.issue?.key;
        if (!issueKey) {
            return res.status(400).json({ error: 'No issue key in webhook payload.' });
        }

        const { rows } = await pool.query(`SELECT project_id FROM jira_links WHERE jira_issue_key = $1 LIMIT 1`, [issueKey]);
        if (rows[0]) {
            await logAudit({
                action: 'JIRA_WEBHOOK_RECEIVED',
                entityType: 'project',
                entityId: rows[0].project_id,
                details: { issueKey, webhookEvent: req.body?.webhookEvent },
            });
        }

        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

module.exports = router;
