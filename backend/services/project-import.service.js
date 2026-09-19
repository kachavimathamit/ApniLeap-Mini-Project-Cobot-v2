const { parseCsv, csvCell } = require('./csv.service');
const { validateTeam } = require('../validators/student.validator');
const { validateTerm, cleanName } = require('../validators/academic.validator');

const MAX_ROWS = 200;
const STUDENTS = 5;              // 4 required + 1 optional
const EXAMPLE_MARK = 'EXAMPLE';   // the template's sample row starts with this

// The template columns, in order. Team ID and Artefact ID are not in the file:
// the system numbers them (Team-n / Art-n) as the projects are saved.
const PROJECT_COLUMNS = [
    ['themeName', 'Theme Name'],
    ['artefactTitle', 'Artefact Title'],
    ['title', 'Project Title'],
    ['facultyMentorName', 'Faculty Mentor Name'],
    ['coordinatorName', 'Project Coordinator Name'],
    ['reviewerName', 'Reviewer Name'],
    ['academicYear', 'Academic Year'],
    ['semester', 'Semester'],
];
const STUDENT_FIELDS = [['name', 'Name'], ['srn', 'SRN'], ['semester', 'Semester'], ['division', 'Division']];

function headerList() {
    const headers = PROJECT_COLUMNS.map(([, label]) => label);
    for (let n = 1; n <= STUDENTS; n++) {
        for (const [, label] of STUDENT_FIELDS) headers.push(`Student ${n} ${label}`);
    }
    return headers;
}

function buildTemplateCsv() {
    const headers = headerList();
    const example = [
        `${EXAMPLE_MARK} (delete this row)`, 'Smart Energy Monitoring Dashboard', 'Smart Campus Energy Monitoring System',
        'Prof. Vikram Naik', 'Prof. Rajesh Kamble', 'Dr. Suresh Bhat', '2026-27', 'Sem-5',
        'Ananya Shetty', '01FE23BCS001', '5', 'A',
        'Rahul Kamat', '01FE23BCS002', '5', 'A',
        'Pooja Hegde', '01FE23BCS003', '5', 'B',
        'Karthik Menon', '01FE23BCS004', '5', 'B',
        '', '', '', '',   // Student 5 is optional: leave all four cells empty if there is none
    ];
    // BOM so Excel opens the UTF-8 file correctly.
    return '﻿' + [headers, example].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// "2026-2027" -> "2026-27"
function normalizeYear(value) {
    const m = /^(\d{4})\s*[-/]\s*(\d{4})$/.exec(String(value).trim());
    return m ? `${m[1]}-${m[2].slice(2)}` : String(value).trim();
}

// "5", "Sem 5", "sem-5", "Semester 5" -> 5
function semesterNumber(value) {
    const m = /^(?:sem(?:ester)?[\s-]*)?([5-8])$/i.exec(String(value).trim());
    return m ? Number(m[1]) : null;
}

// Reads the CSV text and checks every row. Returns
//   { errors: [{ row, message }], projects: [{ row, ...fields, students }] }
// A row number is the spreadsheet row (the header is row 1). Nothing is saved here.
// `srnLookup(srns)` returns [{ srn, project_code, team_id }] for SRNs already on a team.
async function readProjects(csvText, srnLookup) {
    const errors = [];
    const parsed = parseCsv(csvText);
    if (parsed.error) return { errors: [{ row: 1, message: parsed.error }], projects: [] };
    const table = parsed.rows;
    if (!table.length) return { errors: [{ row: 1, message: 'The file is empty.' }], projects: [] };

    // ---- header row ----
    const headerIndex = {};
    table[0].forEach((h, i) => { const k = norm(h); if (k && !(k in headerIndex)) headerIndex[k] = i; });
    const colOf = (label) => headerIndex[norm(label)];
    const required = [...PROJECT_COLUMNS.map(([, l]) => l)];
    for (let n = 1; n <= 4; n++) STUDENT_FIELDS.forEach(([, l]) => required.push(`Student ${n} ${l}`));
    const missing = required.filter((l) => colOf(l) === undefined);
    if (missing.length) {
        return {
            errors: [{ row: 1, message: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Use the template's header row unchanged.` }],
            projects: [],
        };
    }
    const cell = (row, label) => {
        const i = colOf(label);
        return i === undefined ? '' : String(row[i] ?? '').trim();
    };

    // ---- data rows ----
    const dataRows = [];
    for (let r = 1; r < table.length; r++) {
        if (table[r].every((c) => String(c).trim() === '')) continue;   // blank line
        dataRows.push({ row: r + 1, cells: table[r] });
    }
    if (!dataRows.length) return { errors: [{ row: 2, message: 'The file has no project rows.' }], projects: [] };
    if (dataRows.length > MAX_ROWS) {
        return { errors: [{ row: 1, message: `The file has ${dataRows.length} projects; the limit is ${MAX_ROWS} per upload.` }], projects: [] };
    }

    const projects = [];
    for (const { row, cells } of dataRows) {
        const fail = (message) => errors.push({ row, message });
        const before = errors.length;

        const themeName = cleanName(cell(cells, 'Theme Name'));
        if (String(cell(cells, 'Theme Name')).toUpperCase().startsWith(EXAMPLE_MARK)) {
            fail('This is the sample row from the template. Delete it (or replace it with a real project).');
            continue;
        }
        const artefactTitle = cell(cells, 'Artefact Title').replace(/\s+/g, ' ').slice(0, 300);
        const title = cell(cells, 'Project Title').replace(/\s+/g, ' ').slice(0, 300);
        if (!themeName) fail('Theme Name is required.');
        if (!artefactTitle) fail('Artefact Title is required.');
        if (!title) fail('Project Title is required.');

        const academicYear = normalizeYear(cell(cells, 'Academic Year'));
        const semRaw = cell(cells, 'Semester');
        const semNum = semRaw ? semesterNumber(semRaw) : null;
        const semester = semRaw ? (semNum ? `Sem-${semNum}` : semRaw) : '';
        const termProblem = validateTerm(academicYear, semester);
        if (termProblem) fail(termProblem);

        const rawStudents = [];
        for (let n = 1; n <= STUDENTS; n++) {
            const sem = cell(cells, `Student ${n} Semester`);
            rawStudents.push({
                name: cell(cells, `Student ${n} Name`),
                srn: cell(cells, `Student ${n} SRN`),
                semester: sem === '' ? '' : (semesterNumber(sem) ?? sem),
                division: cell(cells, `Student ${n} Division`),
            });
        }
        const team = validateTeam(rawStudents);
        if (team.error) fail(team.error);

        if (errors.length === before) {
            projects.push({
                row, title, themeName, artefactTitle,
                facultyMentorName: cleanName(cell(cells, 'Faculty Mentor Name')),
                coordinatorName: cleanName(cell(cells, 'Project Coordinator Name')),
                reviewerName: cleanName(cell(cells, 'Reviewer Name')),
                academicYear: academicYear || null,
                semester: semester || null,
                students: team.students,
            });
        }
    }

    // ---- SRNs: once in the file, and not already on a team ----
    const seen = new Map();   // srn -> first row
    for (const p of projects) {
        for (const s of p.students) {
            if (seen.has(s.srn)) {
                errors.push({ row: p.row, message: `SRN ${s.srn} is also used in row ${seen.get(s.srn)} of this file. An SRN can belong to only one team.` });
            } else {
                seen.set(s.srn, p.row);
            }
        }
    }
    if (seen.size) {
        const existing = await srnLookup([...seen.keys()]);
        for (const e of existing) {
            errors.push({ row: seen.get(e.srn), message: `SRN ${e.srn} is already on another project team (${e.team_id}, ${e.project_code}).` });
        }
    }

    errors.sort((a, b) => a.row - b.row);
    return { errors, projects };
}

module.exports = { readProjects, buildTemplateCsv, MAX_ROWS };
