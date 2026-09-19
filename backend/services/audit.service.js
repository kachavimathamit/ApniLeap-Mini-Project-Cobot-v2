const { pool } = require('../config/db');

// entity_id and action are bounded VARCHAR columns; a caller passing a raw
// request URL (e.g. role/tenant middleware logging a denied route) can
// easily exceed that. Truncate defensively rather than let a DB constraint
// violation reach the caller.
function truncate(value, maxLength) {
    if (value === null || value === undefined) return null;
    const s = String(value);
    return s.length > maxLength ? s.slice(0, maxLength) : s;
}

// Audit logging must never be able to crash or fail the request it is
// attached to - a write failure here is logged to the console and swallowed,
// not propagated. (An earlier version awaited this without a try/catch,
// and a too-long entity_id took down the entire Node process.)
async function logAudit({ userId, action, entityType = null, entityId = null, instituteId = null, details = null, ipAddress = null }) {
    try {
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, institute_id, details, ip_address)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
                userId || null,
                truncate(action, 80),
                truncate(entityType, 50),
                truncate(entityId, 300),
                instituteId || null,
                details ? JSON.stringify(details) : null,
                truncate(ipAddress, 64),
            ]
        );
    } catch (err) {
        console.error('Audit log write failed (non-fatal):', err.message);
    }
}

module.exports = { logAudit };
