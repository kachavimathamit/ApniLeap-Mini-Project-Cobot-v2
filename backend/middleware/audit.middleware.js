const { logAudit } = require('../services/audit.service');

// Generic request-completion auditor for state-changing routes.
// Usage: router.post('/projects/:id/status', auditAction('PROJECT_STATUS_CHANGE', 'project'), handler)
function auditAction(action, entityType) {
    return (req, res, next) => {
        res.on('finish', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                logAudit({
                    userId: req.user?.id,
                    action,
                    entityType,
                    entityId: req.params.id || req.params.projectId || null,
                    details: { method: req.method, path: req.originalUrl },
                    ipAddress: req.ip,
                }).catch((err) => console.error('Audit log failed:', err));
            }
        });
        next();
    };
}

module.exports = { auditAction };
