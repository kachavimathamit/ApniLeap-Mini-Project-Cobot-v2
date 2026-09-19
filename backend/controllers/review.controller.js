const { pool } = require('../config/db');
const { logAudit } = require('../services/audit.service');

// GET /api/projects/:projectId/reviews
async function listReviews(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT r.*, u.full_name AS reviewer_name
             FROM reviews r
             LEFT JOIN users u ON u.id = r.reviewer_user_id
             WHERE r.project_id = $1
             ORDER BY r.review_date DESC`,
            [req.params.projectId]
        );
        res.json({ reviews: rows });
    } catch (err) {
        next(err);
    }
}

// POST /api/projects/:projectId/reviews
async function createReview(req, res, next) {
    try {
        const { comments, decision, recommendedStatus, nextReviewAt } = req.body || {};
        if (!comments || !comments.trim()) {
            return res.status(400).json({ error: 'Review comments are required.' });
        }
        if (recommendedStatus && !['GREEN', 'YELLOW', 'RED'].includes(recommendedStatus)) {
            return res.status(400).json({ error: 'recommendedStatus must be one of GREEN, YELLOW, RED.' });
        }

        const { rows } = await pool.query(
            `INSERT INTO reviews (project_id, reviewer_user_id, comments, decision, recommended_status, next_review_at)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [req.params.projectId, req.user.id, comments, decision || null, recommendedStatus || null, nextReviewAt || null]
        );

        if (nextReviewAt) {
            await pool.query(`UPDATE projects SET next_review_at = $1, last_review_at = now() WHERE id = $2`, [nextReviewAt, req.params.projectId]);
        } else {
            await pool.query(`UPDATE projects SET last_review_at = now() WHERE id = $1`, [req.params.projectId]);
        }

        await logAudit({ userId: req.user.id, action: 'REVIEW_CREATE', entityType: 'review', entityId: rows[0].id, instituteId: req.project.institute_id, ipAddress: req.ip });
        res.status(201).json({ review: rows[0] });
    } catch (err) {
        next(err);
    }
}

module.exports = { listReviews, createReview };
