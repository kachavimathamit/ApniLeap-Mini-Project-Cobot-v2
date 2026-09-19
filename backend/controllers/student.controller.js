const { pool } = require('../config/db');
const { logAudit } = require('../services/audit.service');
const { validateTeam } = require('../validators/student.validator');
const { srnConflictMessage, isSrnDuplicateError } = require('../services/team.service');
const { ensureStudentAccounts } = require('../services/student-account.service');

async function loadTeam(client, projectId, user) {
    const { rows } = await client.query(
        `SELECT slot, name, srn, semester, division, email
         FROM project_students WHERE project_id = $1 ORDER BY slot`,
        [projectId]
    );
    return rows.map((r) => ({
        slot: r.slot, name: r.name, srn: r.srn, semester: r.semester,
        division: r.division, email: r.email,
    }));
}

// GET /api/projects/:projectId/students
async function listStudents(req, res, next) {
    try {
        res.json({ students: await loadTeam(pool, req.params.projectId, req.user) });
    } catch (err) {
        next(err);
    }
}

// PUT /api/projects/:projectId/students - replaces the whole team (always four)
async function replaceStudents(req, res, next) {
    const client = await pool.connect();
    try {
        const result = validateTeam(req.body?.students);
        if (result.error) return res.status(400).json({ error: result.error });
        const conflict = await srnConflictMessage(pool, result.students.map((s) => s.srn), req.params.projectId);
        if (conflict) return res.status(409).json({ error: conflict });

        await client.query('BEGIN');
        // Delete first so students can move between slots without tripping the
        // unique (project, slot) / (project, srn) constraints mid-update.
        await client.query(`DELETE FROM project_students WHERE project_id = $1`, [req.params.projectId]);
        for (const s of result.students) {
            await client.query(
                `INSERT INTO project_students (project_id, slot, name, srn, semester, division)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
                [req.params.projectId, s.slot, s.name, s.srn, s.semester, s.division]
            );
        }
        await client.query(`UPDATE projects SET last_update_at = now() WHERE id = $1`, [req.params.projectId]);
        await ensureStudentAccounts(client, result.students);
        await client.query('COMMIT');

        await logAudit({
            userId: req.user.id, action: 'PROJECT_TEAM_UPDATE', entityType: 'project', entityId: req.params.projectId,
            instituteId: req.project.institute_id, details: { srns: result.students.map((s) => s.srn) }, ipAddress: req.ip,
        });
        res.json({ students: await loadTeam(pool, req.params.projectId, req.user) });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (isSrnDuplicateError(err)) return res.status(409).json({ error: 'One of these SRNs is already on another project team.' });
        next(err);
    } finally {
        client.release();
    }
}

module.exports = { listStudents, replaceStudents, loadTeam };
