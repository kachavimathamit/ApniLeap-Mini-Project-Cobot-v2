const { pool } = require('../config/db');
const { logAudit } = require('../services/audit.service');
const { canAccessProject } = require('../services/access.service');
const { ensureStudentAccounts } = require('../services/student-account.service');
const { readProjects, buildTemplateCsv, MAX_ROWS } = require('../services/project-import.service');
const { findInstituteUserByName, provisionIntegrations } = require('./project.controller');

// SRNs from `srns` that already belong to a project team.
async function existingSrns(srns) {
    const { rows } = await pool.query(
        `SELECT s.srn, p.project_code, p.team_id
         FROM project_students s JOIN projects p ON p.id = s.project_id
         WHERE s.srn = ANY($1::text[]) ORDER BY s.srn`,
        [srns]
    );
    return rows;
}

// GET /api/departments/:departmentId/projects/import-template
async function importTemplate(req, res) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="project-upload-template.csv"');
    res.send(buildTemplateCsv());
}

// POST /api/departments/:departmentId/projects/import   { csv, dryRun }
// Every row is checked first; if anything is wrong nothing is saved and the
// problems are returned (row number + reason). With dryRun the call only checks.
async function importProjects(req, res, next) {
    try {
        const { rows: deptRows } = await pool.query(`SELECT id, institute_id, name FROM departments WHERE id = $1`, [req.params.departmentId]);
        const department = deptRows[0];
        if (!department) return res.status(404).json({ error: 'Department not found.' });
        if (!canAccessProject(req.user, { institute_id: department.institute_id, department_id: department.id })) {
            return res.status(403).json({ error: 'You are not authorized to create projects in this department.' });
        }

        const csv = req.body && req.body.csv;
        if (typeof csv !== 'string' || !csv.trim()) {
            return res.status(400).json({ error: 'No file content was received.' });
        }

        const { errors, projects } = await readProjects(csv, existingSrns);
        const preview = projects.map((p) => ({
            row: p.row, title: p.title, themeName: p.themeName, artefactTitle: p.artefactTitle,
            students: p.students.map((s) => s.name),
        }));
        if (errors.length) {
            return res.status(422).json({ valid: false, errors: errors.slice(0, 200), errorCount: errors.length, limit: MAX_ROWS });
        }
        if (req.body.dryRun) {
            return res.json({ valid: true, count: projects.length, preview });
        }

        // ---- save everything together, or nothing ----
        const { rows: instRows } = await pool.query(`SELECT code FROM institutes WHERE id = $1`, [department.institute_id]);
        const instituteCode = instRows[0]?.code || 'AL';
        for (const p of projects) p.mentorUserId = await findInstituteUserByName(p.facultyMentorName, department.institute_id);

        const created = [];
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SELECT pg_advisory_xact_lock(hashtext('apnileap:new-project'))`);
            const { rows: maxRows } = await client.query(
                `SELECT COALESCE(MAX(NULLIF(regexp_replace(project_code, '^.*-', ''), '')::int), 0) AS max_seq
                 FROM projects WHERE project_code LIKE $1`,
                [`AL-${instituteCode}-%`]
            );
            let seq = Number(maxRows[0].max_seq);
            for (const p of projects) {
                seq += 1;
                const projectCode = `AL-${instituteCode}-${String(seq).padStart(3, '0')}`;
                const { rows } = await client.query(
                    `INSERT INTO projects (project_code, title, institute_id, department_id, mentor_user_id, faculty_mentor_name, coordinator_name,
                                          reviewer_name, academic_year, semester, created_by, theme_name, artefact_title)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, project_code, team_id, artefact_id, title`,
                    [projectCode, p.title, department.institute_id, department.id, p.mentorUserId, p.facultyMentorName, p.coordinatorName,
                     p.reviewerName, p.academicYear, p.semester, req.user.id, p.themeName, p.artefactTitle]
                );
                await client.query(
                    `INSERT INTO status_history (project_id, previous_status, new_status, reason, changed_by)
                     VALUES ($1, NULL, 'GREEN', 'Project created (CSV upload)', $2)`,
                    [rows[0].id, req.user.id]
                );
                for (const s of p.students) {
                    await client.query(
                        `INSERT INTO project_students (project_id, slot, name, srn, semester, division) VALUES ($1,$2,$3,$4,$5,$6)`,
                        [rows[0].id, s.slot, s.name, s.srn, s.semester, s.division]
                    );
                }
                await ensureStudentAccounts(client, p.students);
                created.push({ row: p.row, id: rows[0].id, projectCode: rows[0].project_code, teamId: rows[0].team_id, artefactId: rows[0].artefact_id, title: rows[0].title });
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Some data in the file conflicts with existing records (for example an SRN already on a team). Nothing was saved. Check the file and upload again.' });
            }
            throw err;
        } finally {
            client.release();
        }

        await logAudit({
            userId: req.user.id, action: 'PROJECT_IMPORT', entityType: 'department', entityId: String(department.id),
            instituteId: department.institute_id, ipAddress: req.ip, details: { count: created.length, projects: created.map((c) => c.projectCode) },
        });

        res.status(201).json({ created, count: created.length, integrations: 'in_background' });

        // Jira issue + Confluence page per project, as for a single Add Project. This
        // runs after the reply (a big file would otherwise take minutes) and is
        // best-effort: a Jira/Confluence problem never undoes the import.
        setImmediate(async () => {
            for (const c of created) {
                try {
                    const { rows } = await pool.query(
                        `SELECT p.*, i.name AS institute_name, d.name AS department_name, COALESCE(p.faculty_mentor_name, mu.full_name) AS mentor_name
                         FROM projects p
                         JOIN institutes i ON i.id = p.institute_id
                         JOIN departments d ON d.id = p.department_id
                         LEFT JOIN users mu ON mu.id = p.mentor_user_id
                         WHERE p.id = $1`,
                        [c.id]
                    );
                    if (rows[0]) await provisionIntegrations(rows[0], req.user.id);
                } catch (err) {
                    console.error(`Import: Jira/Confluence step failed for ${c.projectCode} (non-fatal):`, err.message);
                }
            }
        });
    } catch (err) {
        next(err);
    }
}

module.exports = { importTemplate, importProjects };
