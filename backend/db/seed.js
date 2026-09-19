const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const { ensureStudentAccounts } = require('../services/student-account.service');

const ROLES = [
    ['PLATFORM_ADMIN', 'Platform Administrator', 'Manages institutes, users, roles, policies and system configuration'],
    ['GLOBAL_PROGRAMME_LEADER', 'Global Programme Leader', 'Views portfolio and reviews projects across authorized institutes'],
    ['INSTITUTE_ADMIN', 'Institute Administrator', 'Manages one assigned institute'],
    ['DEAN_PRINCIPAL', 'Dean/Principal', 'Views institutional portfolio and reviews risk'],
    ['DEPARTMENT_HEAD', 'Department Head', 'Views and reviews departmental projects and mentor actions'],
    ['FACULTY_MENTOR', 'Faculty Mentor', 'Updates status, milestones, issues, evidence and corrective actions'],
    ['REVIEWER', 'Reviewer/Success Coach', 'Reviews progress and recommends status'],
    ['STUDENT', 'Student', 'Signs in with the SRN; sees only the own team and its project, read-only'],
    ['READ_ONLY_STAKEHOLDER', 'Read-only Stakeholder', 'Views dashboards and approved reports only'],
];

const INSTITUTES = [
    ['KLE', 'KLE Technological University'],
    ['MMCOE', 'Marathwada Mitra Mandal College of Engineering'],
    ['RIT', 'Rajarambapu Institute of Technology'],
    ['COEP', 'College of Engineering, Pune'],
    ['SANGLI', 'Sangli Institute of Technology'],
];

// Order institutes are listed in: KLE first, then COEP, then the rest.
// (Kept separate from INSTITUTES above, whose order determines project codes.)
const DISPLAY_ORDER = { KLE: 1, COEP: 2, MMCOE: 3, RIT: 4, SANGLI: 5 };


// KLE's first department is Computer Science and Engineering (the order matters:
// it keeps the existing project codes stable). Its second CSE department, (AI),
// is created further below.
const DEPARTMENTS_BY_INSTITUTE = {
    KLE: [
        { code: 'CSE', name: 'Computer Science and Engineering' },
    ],
};
// Only KLE carries departments and sample projects. The other institutes are
// kept as organisation names only, so they get no departments or projects.
const departmentsOf = (instCode) => DEPARTMENTS_BY_INSTITUTE[instCode] || [];

// KLE's second department. A Dean is given access to departments (both here) and
// each Department Head to their own department.
const KLE_EXTRA_DEPARTMENTS = [
    { code: 'CSE', headEmail: 'kle.hod.cse@apnileap.org' },
    { code: 'CSEAI', name: 'Computer Science and Engineering (AI)', headEmail: 'kle.hod.cseai@apnileap.org' },
];
const KLE_DEAN_EMAIL = 'kle.dean@apnileap.org';

const DEMO_PASSWORD = 'Demo@12345';

// Every project has a fixed team of four students. These are made-up demo
// people; real teams are entered through the app.
const DEMO_FIRST = ['Aarav', 'Diya', 'Rohan', 'Ananya', 'Kabir', 'Meera', 'Vihaan', 'Isha', 'Arjun', 'Riya', 'Karthik', 'Sneha'];
const DEMO_LAST = ['Kulkarni', 'Patil', 'Naik', 'Desai', 'Joshi', 'Hegde', 'Shetty', 'Bhat', 'Kamat', 'Pai'];
function demoTeam(seed) {
    return [0, 1, 2, 3].map((slot) => {
        const n = seed * 4 + slot;
        return {
            slot: slot + 1,
            name: `${DEMO_FIRST[n % DEMO_FIRST.length]} ${DEMO_LAST[(n * 7 + slot) % DEMO_LAST.length]}`,
            srn: `01FE23BCS${String(100 + n).padStart(3, '0')}`,
            semester: 5,
            division: 'ABC'[n % 3],
        };
    });
}

async function seed() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Roles
        const roleIds = {};
        for (const [code, name, description] of ROLES) {
            const { rows } = await client.query(
                `INSERT INTO roles (code, name, description) VALUES ($1,$2,$3)
                 ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
                 RETURNING id, code`,
                [code, name, description]
            );
            roleIds[rows[0].code] = rows[0].id;
        }
        console.log('Roles seeded:', Object.keys(roleIds).length);

        // Institutes
        const instituteIds = {};
        for (const [code, name] of INSTITUTES) {
            const { rows } = await client.query(
                `INSERT INTO institutes (code, name, display_order) VALUES ($1,$2,$3)
                 ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, display_order = EXCLUDED.display_order
                 RETURNING id, code`,
                [code, name, DISPLAY_ORDER[code] ?? 100]
            );
            instituteIds[rows[0].code] = rows[0].id;
        }
        console.log('Institutes seeded:', Object.keys(instituteIds).length);

        // One-off rename for databases seeded before schools existed: KLE's
        // "Computer Science" (COMP) becomes "Computer Science and Engineering" (CSE).
        // Renaming keeps its projects attached.
        await client.query(
            `UPDATE departments SET code = 'CSE', name = 'Computer Science and Engineering'
             WHERE institute_id = $1 AND code = 'COMP'
               AND NOT EXISTS (SELECT 1 FROM departments WHERE institute_id = $1 AND code = 'CSE')`,
            [instituteIds.KLE]
        );

        // Departments (3 per institute)
        const departmentIds = {}; // key: `${instituteCode}:${deptCode}`
        for (const code of Object.keys(instituteIds)) {
            for (const dept of departmentsOf(code)) {
                const { rows } = await client.query(
                    `INSERT INTO departments (institute_id, code, name) VALUES ($1,$2,$3)
                     ON CONFLICT (institute_id, code) DO UPDATE SET name = EXCLUDED.name
                     RETURNING id, code`,
                    [instituteIds[code], dept.code, dept.name]
                );
                departmentIds[`${code}:${dept.code}`] = rows[0].id;
            }
        }
        console.log('Departments seeded:', Object.keys(departmentIds).length);

        // Demo users
        const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
        const DEMO_USERS = [
            { email: 'platform.admin@apnileap.org', name: 'Platform Administrator', role: 'PLATFORM_ADMIN' },
            { email: 'programme.leader@apnileap.org', name: 'Balaji (Global Programme Leader)', role: 'GLOBAL_PROGRAMME_LEADER' },
            { email: 'kle.admin@apnileap.org', name: 'KLE Institute Administrator', role: 'INSTITUTE_ADMIN', institute: 'KLE' },
            { email: 'kle.mentor@apnileap.org', name: 'Faculty Mentor (KLE - CSE)', role: 'FACULTY_MENTOR', institute: 'KLE' },
            { email: 'kle.dean@apnileap.org', name: 'Dean (KLE)', role: 'DEAN_PRINCIPAL', institute: 'KLE' },
            { email: 'kle.hod.cse@apnileap.org', name: 'Head, Computer Science and Engineering (KLE)', role: 'DEPARTMENT_HEAD', institute: 'KLE' },
            { email: 'kle.hod.cseai@apnileap.org', name: 'Head, Computer Science and Engineering (AI) (KLE)', role: 'DEPARTMENT_HEAD', institute: 'KLE' },
            { email: 'kle.reviewer@apnileap.org', name: 'Reviewer/Success Coach (KLE)', role: 'REVIEWER', institute: 'KLE' },
            { email: 'kle.readonly@apnileap.org', name: 'Read-only Stakeholder (KLE)', role: 'READ_ONLY_STAKEHOLDER', institute: 'KLE' },
        ];

        const userIds = {};
        for (const u of DEMO_USERS) {
            const { rows } = await client.query(
                `INSERT INTO users (email, password_hash, full_name) VALUES ($1,$2,$3)
                 ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
                 RETURNING id, email`,
                [u.email, passwordHash, u.name]
            );
            userIds[u.email] = rows[0].id;

            await client.query(
                `INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)
                 ON CONFLICT (user_id, role_id) DO NOTHING`,
                [rows[0].id, roleIds[u.role]]
            );

            if (u.role === 'PLATFORM_ADMIN' || u.role === 'GLOBAL_PROGRAMME_LEADER') {
                for (const code of Object.keys(instituteIds)) {
                    await client.query(
                        `INSERT INTO user_institute_access (user_id, institute_id) VALUES ($1,$2)
                         ON CONFLICT DO NOTHING`,
                        [rows[0].id, instituteIds[code]]
                    );
                }
            } else if (u.institute) {
                await client.query(
                    `INSERT INTO user_institute_access (user_id, institute_id) VALUES ($1,$2)
                     ON CONFLICT DO NOTHING`,
                    [rows[0].id, instituteIds[u.institute]]
                );
            }
        }
        console.log('Demo users seeded:', Object.keys(userIds).length);

        // ---- KLE departments, their Heads, and the Dean's department access ----
        for (const d of KLE_EXTRA_DEPARTMENTS) {
            // The second CSE department is created here; CSE already exists above.
            if (d.name) {
                const { rows } = await client.query(
                    `INSERT INTO departments (institute_id, code, name) VALUES ($1,$2,$3)
                     ON CONFLICT (institute_id, code) DO UPDATE SET name = EXCLUDED.name
                     RETURNING id`,
                    [instituteIds.KLE, d.code, d.name]
                );
                departmentIds[`KLE:${d.code}`] = rows[0].id;
            }
            const deptId = departmentIds[`KLE:${d.code}`];
            await client.query(`UPDATE departments SET head_user_id = $1 WHERE id = $2`, [userIds[d.headEmail], deptId]);
            for (const email of [d.headEmail, KLE_DEAN_EMAIL]) {
                await client.query(
                    `INSERT INTO user_department_access (user_id, department_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
                    [userIds[email], deptId]
                );
            }
        }
        console.log('KLE departments with Head and Dean access seeded:', KLE_EXTRA_DEPARTMENTS.length);

        // Sample projects with a spread of RAG statuses across institutes/departments
        const RAG_CYCLE = ['GREEN', 'GREEN', 'YELLOW', 'GREEN', 'RED', 'YELLOW', 'GREEN', 'GREEN', 'RED', 'YELLOW'];
        let ragIdx = 0;
        let projectSeq = 1;
        const mentorId = userIds['kle.mentor@apnileap.org'];

        for (const instCode of Object.keys(instituteIds)) {
            for (const { code: deptCode, name: deptName } of departmentsOf(instCode)) {
                const deptId = departmentIds[`${instCode}:${deptCode}`];

                // 2 projects per department
                for (let i = 0; i < 2; i++) {
                    const rag = RAG_CYCLE[ragIdx % RAG_CYCLE.length];
                    ragIdx++;
                    const code = `AL-${instCode}-${String(projectSeq).padStart(3, '0')}`;
                    projectSeq++;
                    const completion = rag === 'RED' ? 30 : rag === 'YELLOW' ? 55 : 78;

                    const { rows } = await client.query(
                        `INSERT INTO projects
                            (project_code, title, institute_id, department_id, mentor_user_id,
                             academic_year, semester, rag_status, completion_pct,
                             last_review_at, next_review_at, project_phase, created_by)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - interval '10 days', now() + interval '7 days', 'ACTIVE', $5)
                         ON CONFLICT (project_code) DO UPDATE SET title = EXCLUDED.title
                         RETURNING id, (xmax = 0) AS inserted`,
                        // The demo mentor belongs to KLE only; assigning them to another
                        // institute's project would grant cross-institute access.
                        [code, `${deptName} Mini Project ${i + 1}`, instituteIds[instCode], deptId, instCode === 'KLE' ? mentorId : null,
                         '2026-27', 'Sem-5', rag, completion]
                    );

                    // Only for newly created rows, so re-running the seed does not
                    // pile up duplicate history entries.
                    if (rows[0].inserted) {
                        await client.query(
                            `INSERT INTO status_history (project_id, previous_status, new_status, reason, changed_by)
                             VALUES ($1, NULL, $2, 'Initial status at project creation', $3)`,
                            [rows[0].id, rag, mentorId]
                        );
                    }
                }
            }
        }
        console.log('Sample projects seeded:', projectSeq - 1);

        // KLE's second CSE department: two demo projects, only if it has none.
        // The next code continues KLE's numbering so nothing already there is
        // overwritten.
        const cseaiId = departmentIds['KLE:CSEAI'];
        const { rows: cseaiProjects } = await client.query(`SELECT 1 FROM projects WHERE department_id = $1 LIMIT 1`, [cseaiId]);
        if (!cseaiProjects.length) {
            const { rows: maxRows } = await client.query(
                `SELECT COALESCE(MAX(NULLIF(regexp_replace(project_code, '^.*-', ''), '')::int), 0) AS max_seq
                 FROM projects WHERE project_code LIKE 'AL-KLE-%'`
            );
            let seq = Number(maxRows[0].max_seq);
            for (const [i, rag] of ['GREEN', 'YELLOW'].entries()) {
                seq++;
                const { rows } = await client.query(
                    `INSERT INTO projects
                        (project_code, title, institute_id, department_id, mentor_user_id, academic_year, semester,
                         rag_status, completion_pct, last_review_at, next_review_at, project_phase, created_by)
                     VALUES ($1,$2,$3,$4,$5,'2026-27','Sem-5',$6,$7, now() - interval '10 days', now() + interval '7 days','ACTIVE',$5)
                     RETURNING id`,
                    [`AL-KLE-${String(seq).padStart(3, '0')}`, `Computer Science and Engineering (AI) Mini Project ${i + 1}`,
                     instituteIds.KLE, cseaiId, mentorId, rag, rag === 'YELLOW' ? 55 : 78]
                );
                await client.query(
                    `INSERT INTO status_history (project_id, previous_status, new_status, reason, changed_by)
                     VALUES ($1, NULL, $2, 'Initial status at project creation', $3)`,
                    [rows[0].id, rag, mentorId]
                );
            }
        }

        // Every project has exactly four students: give any project without a
        // team a demo one (projects that already have a team are left alone).
        const { rows: teamless } = await client.query(
            `SELECT p.id FROM projects p
             WHERE NOT EXISTS (SELECT 1 FROM project_students s WHERE s.project_id = p.id)
             ORDER BY p.project_code`
        );
        let teamSeed = 0;
        for (const { id } of teamless) {
            for (const s of demoTeam(teamSeed)) {
                await client.query(
                    `INSERT INTO project_students (project_id, slot, name, srn, semester, division)
                     VALUES ($1,$2,$3,$4,$5,$6)`,
                    [id, s.slot, s.name, s.srn, s.semester, s.division]
                );
            }
            teamSeed++;
        }
        // Show the mentor's name on projects that have a mentor account.
        await client.query(
            `UPDATE projects p SET faculty_mentor_name = u.full_name
             FROM users u WHERE u.id = p.mentor_user_id AND p.faculty_mentor_name IS NULL`
        );
        // Team ID / Artefact ID are assigned by the database; give demo projects an artefact title.
        await client.query(`UPDATE projects SET artefact_title = title WHERE artefact_title IS NULL`);
        // Every student on a team can sign in with their SRN (default password).
        const { rows: teamStudents } = await client.query(`SELECT DISTINCT ON (srn) srn, name FROM project_students ORDER BY srn, created_at DESC`);
        const studentLogins = await ensureStudentAccounts(client, teamStudents);
        console.log('Student logins created:', studentLogins);
        console.log('Demo student teams created for', teamless.length, 'projects');

        await client.query('COMMIT');
        console.log('\nSeed complete.');
        console.log('Demo login password for all seeded users:', DEMO_PASSWORD);
        console.log('Accounts: ' + DEMO_USERS.map((u) => u.email).join(' / '));
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Seed failed:', err);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

seed();
