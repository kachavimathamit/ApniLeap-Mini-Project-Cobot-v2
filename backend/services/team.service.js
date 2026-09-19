// An SRN identifies one student, so it may belong to only one project team.
// Returns a message naming the first SRN that is already on another project,
// or null when none is. The database has a UNIQUE constraint as the final guard.
async function srnConflictMessage(db, srns, excludeProjectId) {
    const { rows } = await db.query(
        `SELECT s.srn, p.project_code, p.team_id
         FROM project_students s JOIN projects p ON p.id = s.project_id
         WHERE s.srn = ANY($1::text[]) AND ($2::uuid IS NULL OR s.project_id <> $2::uuid)
         ORDER BY s.srn LIMIT 1`,
        [srns, excludeProjectId || null]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return `SRN ${r.srn} is already on another project team (${r.team_id}, ${r.project_code}). An SRN can belong to only one team.`;
}

const SRN_CONSTRAINT = 'uq_project_students_srn';

function isSrnDuplicateError(err) {
    return err && err.code === '23505' && err.constraint === SRN_CONSTRAINT;
}

module.exports = { srnConflictMessage, isSrnDuplicateError };
