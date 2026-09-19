const { pool } = require('../config/db');
const { scopeArrays } = require('../services/access.service');

const GLOBAL_ROLES = ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER'];

function isGlobalUser(req) {
    return (req.user.roles || []).some((r) => GLOBAL_ROLES.includes(r));
}

// GET /api/dashboard/programme - authorized cross-institute summary. A
// department-scoped user (Dean/Head) is counted only over their own departments.
async function programmeDashboard(req, res, next) {
    try {
        const global = isGlobalUser(req);
        const arrays = scopeArrays(req.user);
        const scopeSql = '(p.institute_id = ANY($1::uuid[]) OR p.department_id = ANY($2::int[]))';
        const scopeFilter = global ? '' : `WHERE ${scopeSql}`;
        const params = global ? [] : [arrays.instituteIds, arrays.departmentIds];

        const { rows: totals } = await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE p.is_active) AS total_projects,
                COUNT(*) FILTER (WHERE p.rag_status = 'GREEN' AND p.is_active) AS green_count,
                COUNT(*) FILTER (WHERE p.rag_status = 'YELLOW' AND p.is_active) AS yellow_count,
                COUNT(*) FILTER (WHERE p.rag_status = 'RED' AND p.is_active) AS red_count,
                COUNT(*) FILTER (WHERE p.next_review_at < now() AND p.is_active) AS overdue_review_count,
                COUNT(*) FILTER (WHERE p.next_review_at BETWEEN now() AND now() + interval '14 days' AND p.is_active) AS upcoming_review_count
             FROM projects p
             ${scopeFilter}`,
            params
        );

        const { rows: byInstitute } = await pool.query(
            `SELECT i.id, i.code, i.name,
                    COUNT(p.id) FILTER (WHERE p.is_active) AS total_projects,
                    COUNT(p.id) FILTER (WHERE p.rag_status = 'GREEN' AND p.is_active) AS green_count,
                    COUNT(p.id) FILTER (WHERE p.rag_status = 'YELLOW' AND p.is_active) AS yellow_count,
                    COUNT(p.id) FILTER (WHERE p.rag_status = 'RED' AND p.is_active) AS red_count
             FROM institutes i
             LEFT JOIN projects p ON p.institute_id = i.id ${global ? '' : `AND ${scopeSql}`}
             ${global ? '' : 'WHERE i.id = ANY($3::uuid[])'}
             GROUP BY i.id
             ORDER BY i.display_order, i.name`,
            global ? [] : [arrays.instituteIds, arrays.departmentIds, arrays.viewInstituteIds]
        );

        res.json({
            totals: totals[0],
            institutes: byInstitute,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) {
        next(err);
    }
}

// GET /api/dashboard/institute/:instituteId
async function instituteDashboard(req, res, next) {
    try {
        const instituteId = req.params.instituteId;
        // A Dean/Head with department access sees only their own departments.
        const restricted = !isGlobalUser(req) && !(req.user.instituteIds || []).includes(instituteId);
        const restriction = restricted ? 'AND d.id = ANY($2::int[])' : '';
        const params = restricted ? [instituteId, scopeArrays(req.user).departmentIds] : [instituteId];

        const { rows: totals } = await pool.query(
            `SELECT
                COUNT(DISTINCT d.id) AS total_departments,
                COUNT(p.id) FILTER (WHERE p.is_active) AS total_projects,
                COUNT(p.id) FILTER (WHERE p.rag_status = 'GREEN' AND p.is_active) AS green_count,
                COUNT(p.id) FILTER (WHERE p.rag_status = 'YELLOW' AND p.is_active) AS yellow_count,
                COUNT(p.id) FILTER (WHERE p.rag_status = 'RED' AND p.is_active) AS red_count
             FROM departments d
             LEFT JOIN projects p ON p.department_id = d.id
             WHERE d.institute_id = $1 AND d.is_active = TRUE ${restriction}`,
            params
        );

        res.json({ totals: totals[0] });
    } catch (err) {
        next(err);
    }
}

module.exports = { programmeDashboard, instituteDashboard };
