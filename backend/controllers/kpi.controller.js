const { pool } = require('../config/db');
const { canAccessProject, loadProject } = require('../services/access.service');
const { logAudit } = require('../services/audit.service');

// GET /api/projects/:projectId/kpis
async function listKpis(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT k.*, u.full_name AS owner_name,
                    (SELECT row_to_json(m) FROM (
                        SELECT measured_value, evidence, measured_at
                        FROM kpi_measurements WHERE kpi_id = k.id
                        ORDER BY measured_at DESC LIMIT 1
                    ) m) AS latest_measurement
             FROM kpis k
             LEFT JOIN users u ON u.id = k.owner_user_id
             WHERE k.project_id = $1
             ORDER BY k.created_at`,
            [req.params.projectId]
        );
        res.json({ kpis: rows });
    } catch (err) {
        next(err);
    }
}

// POST /api/projects/:projectId/kpis
async function createKpi(req, res, next) {
    try {
        const { name, targetValue, unit } = req.body || {};
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'KPI name is required.' });
        }
        const { rows } = await pool.query(
            `INSERT INTO kpis (project_id, name, target_value, unit, owner_user_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [req.params.projectId, name, targetValue || null, unit || null, req.user.id]
        );
        await logAudit({ userId: req.user.id, action: 'KPI_CREATE', entityType: 'kpi', entityId: rows[0].id, instituteId: req.project.institute_id, ipAddress: req.ip });
        res.status(201).json({ kpi: rows[0] });
    } catch (err) {
        next(err);
    }
}

// POST /api/kpis/:id/measurements
async function addMeasurement(req, res, next) {
    try {
        const { rows: kpiRows } = await pool.query(`SELECT * FROM kpis WHERE id = $1`, [req.params.id]);
        const kpi = kpiRows[0];
        if (!kpi) return res.status(404).json({ error: 'KPI not found.' });

        const project = await loadProject(kpi.project_id);
        if (!project || !canAccessProject(req.user, project)) {
            return res.status(403).json({ error: 'You are not authorized to update this KPI.' });
        }

        const { measuredValue, evidence } = req.body || {};
        if (!measuredValue) {
            return res.status(400).json({ error: 'measuredValue is required.' });
        }

        const { rows } = await pool.query(
            `INSERT INTO kpi_measurements (kpi_id, measured_value, evidence, recorded_by) VALUES ($1,$2,$3,$4) RETURNING *`,
            [req.params.id, measuredValue, evidence || null, req.user.id]
        );

        await logAudit({ userId: req.user.id, action: 'KPI_MEASUREMENT_ADD', entityType: 'kpi', entityId: req.params.id, instituteId: project.institute_id, ipAddress: req.ip });
        res.status(201).json({ measurement: rows[0] });
    } catch (err) {
        next(err);
    }
}

module.exports = { listKpis, createKpi, addMeasurement };
