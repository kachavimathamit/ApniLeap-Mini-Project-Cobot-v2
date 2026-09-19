const MIN_TEAM_SIZE = 4;
const MAX_TEAM_SIZE = 5;
const EMAIL_DOMAIN = 'kletech.ac.in';

// The student's email is never entered: it is always SRN@kletech.ac.in.
function emailFromSrn(srn) {
    return `${String(srn).toLowerCase()}@${EMAIL_DOMAIN}`;
}

function isBlankRow(raw) {
    return !raw || ['name', 'srn', 'semester', 'division'].every((k) => String(raw[k] ?? '').trim() === '');
}

// Validates a project team: 4 students are required and a 5th is optional. The
// whole team is submitted and replaced at once. A 5th row that is completely
// empty is ignored; a partly filled one is an error. Returns { students } with
// cleaned values, or { error } with a message fit to show the user.
function validateTeam(input) {
    if (!Array.isArray(input) || input.length < MIN_TEAM_SIZE || input.length > MAX_TEAM_SIZE) {
        return { error: `A project team must have ${MIN_TEAM_SIZE} students, and may have a ${MAX_TEAM_SIZE}th.` };
    }
    const rows = input.length === MAX_TEAM_SIZE && isBlankRow(input[MAX_TEAM_SIZE - 1]) ? input.slice(0, MIN_TEAM_SIZE) : input;

    const students = [];
    const seenSrn = new Set();

    for (let i = 0; i < rows.length; i++) {
        const n = i + 1;
        const raw = rows[i] || {};
        const optional = n > MIN_TEAM_SIZE ? ' (leave the whole row empty if there is no 5th student)' : '';
        const name = String(raw.name ?? '').trim().replace(/\s+/g, ' ');
        const srn = String(raw.srn ?? '').trim().toUpperCase();
        const division = String(raw.division ?? '').trim().toUpperCase();
        const semester = Number(raw.semester);

        if (!name || name.length > 200) return { error: `Student ${n}: name is required (up to 200 characters)${optional}.` };
        if (!/^[A-Z0-9]{6,20}$/.test(srn)) return { error: `Student ${n}: SRN must be 6-20 letters/digits (for example 01FE23BCS001)${optional}.` };
        if (seenSrn.has(srn)) return { error: `Student ${n}: SRN ${srn} is listed twice in this team.` };
        if (!Number.isInteger(semester) || semester < 5 || semester > 8) return { error: `Student ${n}: semester must be Sem-5, Sem-6, Sem-7 or Sem-8${optional}.` };
        if (!/^[A-Z0-9]{1,10}$/.test(division)) return { error: `Student ${n}: division is required (for example A)${optional}.` };

        seenSrn.add(srn);
        students.push({ slot: n, name, srn, semester, division });
    }
    return { students };
}

module.exports = { MIN_TEAM_SIZE, MAX_TEAM_SIZE, EMAIL_DOMAIN, emailFromSrn, validateTeam };
