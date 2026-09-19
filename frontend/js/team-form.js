// The student team form, shared by "Add Project" and "Edit Team".
// A project team has 4 required students and an optional 5th, so four rows are
// always shown and an "Add 5th student" button reveals the fifth. A 5th row
// left completely empty is simply not saved. Each student's email is not typed:
// it is always SRN@kletech.ac.in.
const TeamForm = (() => {
  const REQUIRED = 4;
  const MAX = 5;
  const EMAIL_DOMAIN = 'kletech.ac.in';

  function emailFor(srn) {
    const v = String(srn || '').trim().toLowerCase();
    return v ? `${v}@${EMAIL_DOMAIN}` : '';
  }

  function semesterOptions(selected) {
    let html = '<option value="">Sem</option>';
    for (let n = 5; n <= 8; n++) html += `<option value="${n}"${Number(selected) === n ? ' selected' : ''}>Sem-${n}</option>`;
    return html;
  }

  function rowHtml(i, s) {
    const optional = i >= REQUIRED;
    return `
      <div class="al-team-row${optional ? ' d-none' : ''}" data-row="${i}"${optional ? ' data-optional="1"' : ''}>
        <div class="al-team-title d-flex justify-content-between align-items-center">
          <span>Student ${i + 1}${optional ? ' <span class="text-muted" style="font-weight:400">(optional)</span>' : ''}</span>
          ${optional ? '<button type="button" class="btn btn-sm btn-outline-secondary" data-remove-fifth>Remove 5th student</button>' : ''}
        </div>
        <div class="row g-2">
          <div class="col-12 col-md-5"><label class="form-label">Name</label>
            <input class="form-control" data-f="name" maxlength="200" value="${esc(s.name)}" autocomplete="off"></div>
          <div class="col-6 col-md-3"><label class="form-label">SRN</label>
            <input class="form-control text-uppercase" data-f="srn" maxlength="20" value="${esc(s.srn)}" placeholder="01FE23BCS001" autocomplete="off"></div>
          <div class="col-3 col-md-2"><label class="form-label">Semester</label>
            <select class="form-select" data-f="semester">${semesterOptions(s.semester)}</select></div>
          <div class="col-3 col-md-2"><label class="form-label">Div</label>
            <input class="form-control text-uppercase" data-f="division" maxlength="10" value="${esc(s.division)}" autocomplete="off"></div>
          <div class="col-12"><span class="al-team-email-label">Email (automatic):</span>
            <span class="al-team-email" data-f="email">${esc(emailFor(s.srn)) || '—'}</span></div>
        </div>
      </div>`;
  }

  // students: optional existing team ([{name, srn, semester, division}])
  function render(container, students) {
    const list = Array.isArray(students) ? students : [];
    container.innerHTML =
      Array.from({ length: MAX }, (_, i) => rowHtml(i, list[i] || {})).join('') +
      '<button type="button" class="btn btn-outline-secondary btn-sm mt-1" data-add-fifth>+ Add 5th student (optional)</button>';

    const fifth = container.querySelector('[data-optional]');
    const addBtn = container.querySelector('[data-add-fifth]');
    const showFifth = (show) => {
      fifth.classList.toggle('d-none', !show);
      addBtn.classList.toggle('d-none', show);
    };
    showFifth(Boolean(list[REQUIRED]));
    addBtn.addEventListener('click', () => { showFifth(true); fifth.querySelector('[data-f="name"]').focus(); });
    fifth.querySelector('[data-remove-fifth]').addEventListener('click', () => {
      fifth.querySelectorAll('[data-f="name"],[data-f="srn"],[data-f="division"]').forEach((el) => { el.value = ''; });
      fifth.querySelector('[data-f="semester"]').value = '';
      fifth.querySelector('[data-f="email"]').textContent = '—';
      showFifth(false);
    });

    container.querySelectorAll('[data-f="srn"]').forEach((input) => {
      input.addEventListener('input', () => {
        const row = input.closest('.al-team-row');
        row.querySelector('[data-f="email"]').textContent = emailFor(input.value) || '—';
      });
    });
  }

  // Returns the 4 required students, plus the 5th only when it is shown and not empty.
  function read(container) {
    const rows = [...container.querySelectorAll('.al-team-row')].map((row) => {
      const val = (f) => row.querySelector(`[data-f="${f}"]`).value;
      return {
        name: val('name').trim(), srn: val('srn').trim(), semester: val('semester'),
        division: val('division').trim(), hidden: row.classList.contains('d-none'),
      };
    });
    const isEmpty = (r) => !r.name && !r.srn && !r.semester && !r.division;
    return rows
      .filter((r, i) => i < REQUIRED || (!r.hidden && !isEmpty(r)))
      .map(({ hidden, ...student }) => student);
  }

  return { render, read, emailFor, REQUIRED, MAX };
})();
