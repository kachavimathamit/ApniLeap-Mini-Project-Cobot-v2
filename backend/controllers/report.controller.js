const { pool } = require('../config/db');
const { isGlobalUser, scopeArrays } = require('../services/access.service');
const { logAudit } = require('../services/audit.service');

const STALE_DAYS = 14;
const LONG_STANDING_RED_DAYS = 14;
const LOOKAHEAD_DAYS = 14;
const LOOKBACK_DAYS = 7;

// GET /api/reports/weekly - section 9.2. Every section is scoped to the
// requesting user's authorized institutes; a global user sees everything.
async function weeklyReport(req, res, next) {
    try {
        const global = isGlobalUser(req.user);
        const arrays = scopeArrays(req.user);
        // Projects visible to the user: their colleges, their departments (Dean/Head).
        const scopeSql = '(p.institute_id = ANY($1::uuid[]) OR p.department_id = ANY($2::int[]))';
        const instituteFilter = global ? '' : `AND ${scopeSql}`;
        const params = global ? [] : [arrays.instituteIds, arrays.departmentIds];

        const { rows: instituteSummary } = await pool.query(
            `SELECT i.id, i.code, i.name,
                    COUNT(p.id) FILTER (WHERE p.is_active) AS total_projects,
                    COUNT(p.id) FILTER (WHERE p.rag_status = 'GREEN' AND p.is_active) AS green_count,
                    COUNT(p.id) FILTER (WHERE p.rag_status = 'YELLOW' AND p.is_active) AS yellow_count,
                    COUNT(p.id) FILTER (WHERE p.rag_status = 'RED' AND p.is_active) AS red_count
             FROM institutes i
             LEFT JOIN projects p ON p.institute_id = i.id ${global ? '' : `AND ${scopeSql}`}
             WHERE i.is_active = TRUE ${global ? '' : 'AND i.id = ANY($3::uuid[])'}
             GROUP BY i.id ORDER BY i.display_order, i.name`,
            global ? [] : [arrays.instituteIds, arrays.departmentIds, arrays.viewInstituteIds]
        );

        const { rows: newRed } = await pool.query(
            `SELECT DISTINCT p.id, p.project_code, p.title, i.name AS institute_name, sh.created_at
             FROM status_history sh
             JOIN projects p ON p.id = sh.project_id
             JOIN institutes i ON i.id = p.institute_id
             WHERE sh.new_status = 'RED' AND sh.created_at >= now() - interval '${LOOKBACK_DAYS} days' ${instituteFilter}
             ORDER BY sh.created_at DESC`,
            params
        );

        const { rows: longStandingRed } = await pool.query(
            `SELECT p.id, p.project_code, p.title, i.name AS institute_name, p.rag_since
             FROM projects p JOIN institutes i ON i.id = p.institute_id
             WHERE p.rag_status = 'RED' AND p.is_active AND p.rag_since <= now() - interval '${LONG_STANDING_RED_DAYS} days' ${instituteFilter}
             ORDER BY p.rag_since ASC`,
            params
        );

        const { rows: recovering } = await pool.query(
            `SELECT DISTINCT p.id, p.project_code, p.title, i.name AS institute_name, sh.new_status, sh.created_at
             FROM status_history sh
             JOIN projects p ON p.id = sh.project_id
             JOIN institutes i ON i.id = p.institute_id
             WHERE sh.previous_status = 'RED' AND sh.new_status IN ('YELLOW','GREEN')
               AND sh.created_at >= now() - interval '${LOOKBACK_DAYS} days' ${instituteFilter}
             ORDER BY sh.created_at DESC`,
            params
        );

        const { rows: overdueActions } = await pool.query(
            `SELECT a.id, a.description, a.due_date, p.project_code, p.title, i.name AS institute_name, COALESCE(a.owner_name, ou.full_name) AS owner_name
             FROM corrective_actions a
             JOIN projects p ON p.id = a.project_id
             JOIN institutes i ON i.id = p.institute_id
             LEFT JOIN users ou ON ou.id = a.owner_user_id
             WHERE a.status NOT IN ('COMPLETED','VERIFIED') AND a.due_date < now() ${instituteFilter}
             ORDER BY a.due_date ASC`,
            params
        );

        const { rows: staleProjects } = await pool.query(
            `SELECT p.id, p.project_code, p.title, i.name AS institute_name, p.last_update_at
             FROM projects p JOIN institutes i ON i.id = p.institute_id
             WHERE p.is_active AND p.last_update_at < now() - interval '${STALE_DAYS} days' ${instituteFilter}
             ORDER BY p.last_update_at ASC`,
            params
        );

        const { rows: upcomingReviews } = await pool.query(
            `SELECT p.id, p.project_code, p.title, i.name AS institute_name, p.next_review_at
             FROM projects p JOIN institutes i ON i.id = p.institute_id
             WHERE p.is_active AND p.next_review_at BETWEEN now() AND now() + interval '${LOOKAHEAD_DAYS} days' ${instituteFilter}
             ORDER BY p.next_review_at ASC`,
            params
        );

        const { rows: upcomingMilestones } = await pool.query(
            `SELECT m.id, m.title, m.due_date, p.project_code, p.title AS project_title, i.name AS institute_name
             FROM milestones m
             JOIN projects p ON p.id = m.project_id
             JOIN institutes i ON i.id = p.institute_id
             WHERE m.status != 'COMPLETED' AND m.due_date BETWEEN now() AND now() + interval '${LOOKAHEAD_DAYS} days' ${instituteFilter}
             ORDER BY m.due_date ASC`,
            params
        );

        const { rows: recentDecisions } = await pool.query(
            `SELECT r.id, r.decision, r.recommended_status, r.review_date, p.project_code, p.title, i.name AS institute_name, u.full_name AS reviewer_name
             FROM reviews r
             JOIN projects p ON p.id = r.project_id
             JOIN institutes i ON i.id = p.institute_id
             LEFT JOIN users u ON u.id = r.reviewer_user_id
             WHERE r.decision IS NOT NULL AND r.review_date >= now() - interval '${LOOKBACK_DAYS} days' ${instituteFilter}
             ORDER BY r.review_date DESC`,
            params
        );

        await logAudit({ userId: req.user.id, action: 'REPORT_WEEKLY_VIEW', entityType: 'report', ipAddress: req.ip });

        res.json({
            generatedAt: new Date().toISOString(),
            instituteSummary, newRed, longStandingRed, recovering,
            overdueActions, staleProjects, upcomingReviews, upcomingMilestones, recentDecisions,
        });
    } catch (err) {
        next(err);
    }
}

module.exports = { weeklyReport };
