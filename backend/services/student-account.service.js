const bcrypt = require('bcrypt');

// Every student on a project team gets a login: user name = SRN, password =
// the default below. The account can see only the team(s) the SRN is on, in
// read-only mode (see auth.middleware.js and access.service.js).
const DEFAULT_STUDENT_PASSWORD = 'Demo@12345';
const EMAIL_DOMAIN = 'kletech.ac.in';

let cachedHash = null;
async function defaultHash() {
    if (!cachedHash) cachedHash = await bcrypt.hash(DEFAULT_STUDENT_PASSWORD, 12);
    return cachedHash;
}

// Creates a STUDENT account for each student that does not have one, and keeps
// the name of existing ones current. An existing account's password is never
// reset. `db` is a pg client or pool. Returns the number of accounts created.
async function ensureStudentAccounts(db, students) {
    if (!students.length) return 0;
    const { rows: roleRows } = await db.query(`SELECT id FROM roles WHERE code = 'STUDENT'`);
    const roleId = roleRows[0] && roleRows[0].id;
    if (!roleId) return 0;

    let created = 0;
    for (const s of students) {
        const srn = String(s.srn).toUpperCase();
        const email = `${srn.toLowerCase()}@${EMAIL_DOMAIN}`;
        const { rows: existing } = await db.query(`SELECT id, srn FROM users WHERE email = $1 OR srn = $2`, [email, srn]);
        if (existing.length) {
            // Never touch an account that is not a student account (for example a staff
            // member whose address happens to match).
            const student = existing.find((u) => u.srn === srn);
            if (student) await db.query(`UPDATE users SET full_name = $1 WHERE id = $2`, [s.name, student.id]);
            continue;
        }
        const { rows } = await db.query(
            `INSERT INTO users (email, password_hash, full_name, srn) VALUES ($1,$2,$3,$4) RETURNING id`,
            [email, await defaultHash(), s.name, srn]
        );
        await db.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [rows[0].id, roleId]);
        created++;
    }
    return created;
}

module.exports = { ensureStudentAccounts, DEFAULT_STUDENT_PASSWORD };
