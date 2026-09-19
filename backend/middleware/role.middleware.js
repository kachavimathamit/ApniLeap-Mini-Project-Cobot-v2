const { logAudit } = require('../services/audit.service');

// Role-based check. Platform Administrator is always allowed.
// Usage: requireRole('INSTITUTE_ADMIN', 'DEPARTMENT_HEAD')
function requireRole(...allowedRoles) {
    return async (req, res, next) => {
        try {
            const roles = req.user?.roles || [];
            const allowed = roles.includes('PLATFORM_ADMIN') || roles.some((r) => allowedRoles.includes(r));

            if (!allowed) {
                await logAudit({
                    userId: req.user?.id,
                    action: 'ACCESS_DENIED_ROLE',
                    entityType: 'route',
                    entityId: req.originalUrl,
                    details: { requiredRoles: allowedRoles, userRoles: roles },
                    ipAddress: req.ip,
                });
                return res.status(403).json({ error: 'You do not have permission to perform this action.' });
            }
            next();
        } catch (err) {
            next(err);
        }
    };
}

module.exports = { requireRole };
