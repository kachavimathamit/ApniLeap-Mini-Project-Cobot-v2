// Academic year is chosen from a list that starts at 2026-27; semester is one
// of Sem-5 .. Sem-8. The same lists are offered in the UI (frontend/js/academic.js).
const SEMESTERS = ['Sem-5', 'Sem-6', 'Sem-7', 'Sem-8'];
const FIRST_YEAR = 2026;

function isAcademicYear(value) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(value));
    if (!m) return false;
    const start = Number(m[1]);
    return start >= FIRST_YEAR && Number(m[2]) === (start + 1) % 100;
}

// Returns an error message, or null when both values are acceptable
// (either may be empty).
function validateTerm(academicYear, semester) {
    if (academicYear && !isAcademicYear(academicYear)) {
        return 'Academic year must be chosen from the list (2026-27 onwards).';
    }
    if (semester && !SEMESTERS.includes(semester)) {
        return 'Semester must be one of Sem-5, Sem-6, Sem-7 or Sem-8.';
    }
    return null;
}

// Cleans an optional free-text name; returns null when empty.
function cleanName(value) {
    const s = String(value ?? '').trim().replace(/\s+/g, ' ');
    return s ? s.slice(0, 200) : null;
}

module.exports = { SEMESTERS, isAcademicYear, validateTerm, cleanName };
