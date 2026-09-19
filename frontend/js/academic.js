// Fixed choices for a project's academic year and semester, plus the name
// suggestions used by the Faculty Mentor / Project Coordinator / Reviewer
// fields. The server enforces the same rules (validators/academic.validator.js).
const Academic = (() => {
  const FIRST_YEAR = 2026;
  const YEAR_COUNT = 10;
  const years = Array.from({ length: YEAR_COUNT }, (_, i) => {
    const start = FIRST_YEAR + i;
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
  });
  const semesters = ['Sem-5', 'Sem-6', 'Sem-7', 'Sem-8'];

  function options(list, selected, placeholder) {
    return `<option value="">${esc(placeholder)}</option>` +
      list.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
  }

  // Fills a <datalist> with people's names so they can be picked or typed.
  function fillNameList(datalistId, names) {
    const list = document.getElementById(datalistId);
    if (list) list.innerHTML = [...new Set(names)].filter(Boolean).map((n) => `<option value="${esc(n)}"></option>`).join('');
  }

  return { years, semesters, yearOptions: (sel) => options(years, sel, 'Select academic year'),
           semesterOptions: (sel) => options(semesters, sel, 'Select semester'), fillNameList };
})();
