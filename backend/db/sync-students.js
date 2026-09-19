// Creates a login (user name = SRN, default password) for every student that is
// on a project team and does not have one yet. Safe to run repeatedly.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const { ensureStudentAccounts } = require('../services/student-account.service');

(async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(`SELECT DISTINCT ON (srn) srn, name FROM project_students ORDER BY srn, created_at DESC`);
        const created = await ensureStudentAccounts(client, rows.map((r) => ({ srn: r.srn, name: r.name })));
        await client.query('COMMIT');
        console.log(`Student accounts: ${rows.length} students on teams, ${created} new login(s) created.`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Failed:', err);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
})();
