// Bulk project upload from a CSV file (Department page). The file is read in the
// browser, sent to the server which checks every row, and only imported when the
// whole file is valid.
const ProjectImport = (() => {
  let modal, departmentId, csvText = '', onDone = () => {};

  const $ = (id) => document.getElementById(id);

  // Like Api.post but keeps the body of a 422 (the list of row problems).
  async function send(path, data) {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Api.token()}` },
      body: JSON.stringify(data),
    });
    let body = null;
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    return { status: res.status, body: body || {} };
  }

  function setStatus(html) { $('importStatus').innerHTML = html; }

  function errorTable(errors, total) {
    return `
      <div class="al-login-error" style="display:block">This file cannot be imported yet - ${esc(total)} problem${total === 1 ? '' : 's'} found. Nothing was saved.</div>
      <div class="table-responsive mt-2" style="max-height:260px;overflow:auto">
        <table class="table al-table table-sm mb-0">
          <thead><tr><th style="width:80px">Row</th><th>Problem</th></tr></thead>
          <tbody>${errors.map((e) => `<tr><td>${esc(e.row)}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      ${errors.length < total ? `<p class="text-muted mt-1 mb-0" style="font-size:13px">Showing the first ${esc(errors.length)}.</p>` : ''}
      <p class="text-muted mt-2 mb-0" style="font-size:13px">Fix the file and choose it again.</p>`;
  }

  async function check(file) {
    $('importSubmit').disabled = true;
    csvText = '';
    if (!file) { setStatus(''); return; }
    if (file.size > 900 * 1024) { setStatus(errorTable([{ row: 1, message: 'The file is too large (limit about 200 projects).' }], 1)); return; }
    setStatus('<p class="text-muted mb-0">Checking the file…</p>');
    try {
      csvText = await file.text();
      const { status, body } = await send(`/departments/${encodeURIComponent(departmentId)}/projects/import`, { csv: csvText, dryRun: true });
      if (status === 422) { csvText = ''; setStatus(errorTable(body.errors || [], body.errorCount || (body.errors || []).length)); return; }
      if (status !== 200) { csvText = ''; setStatus(`<div class="al-login-error" style="display:block">${esc(body.error || `Request failed (${status})`)}</div>`); return; }
      setStatus(`
        <div class="alert alert-success py-2 mb-2">The file is valid: <strong>${esc(body.count)} project${body.count === 1 ? '' : 's'}</strong> will be added.</div>
        <div class="table-responsive" style="max-height:240px;overflow:auto">
          <table class="table al-table table-sm mb-0">
            <thead><tr><th>Row</th><th>Project</th><th>Theme</th><th>Students</th></tr></thead>
            <tbody>${body.preview.map((p) => `<tr><td>${esc(p.row)}</td><td>${esc(p.title)}</td><td>${esc(p.themeName)}</td><td>${esc(p.students.length)}</td></tr>`).join('')}</tbody>
          </table>
        </div>`);
      $('importSubmit').textContent = `Import ${body.count} project${body.count === 1 ? '' : 's'}`;
      $('importSubmit').disabled = false;
    } catch (err) {
      csvText = '';
      setStatus(`<div class="al-login-error" style="display:block">${esc(err.message)}</div>`);
    }
  }

  async function runImport() {
    if (!csvText) return;
    const btn = $('importSubmit');
    btn.disabled = true;               // one click only, so nothing is imported twice
    $('importFile').disabled = true;
    setStatus('<p class="text-muted mb-0">Importing…</p>');
    try {
      const { status, body } = await send(`/departments/${encodeURIComponent(departmentId)}/projects/import`, { csv: csvText });
      if (status === 422) { setStatus(errorTable(body.errors || [], body.errorCount || 0)); $('importFile').disabled = false; return; }
      if (status !== 201) {
        setStatus(`<div class="al-login-error" style="display:block">${esc(body.error || `Request failed (${status})`)}</div>`);
        $('importFile').disabled = false;
        return;
      }
      csvText = '';
      setStatus(`
        <div class="alert alert-success py-2 mb-2"><strong>${esc(body.count)} project${body.count === 1 ? '' : 's'} imported.</strong>
          Their Jira issues and Confluence pages are being created in the background.</div>
        <div class="table-responsive" style="max-height:260px;overflow:auto">
          <table class="table al-table table-sm mb-0">
            <thead><tr><th>Team ID</th><th>Artefact ID</th><th>Project code</th><th>Project</th></tr></thead>
            <tbody>${body.created.map((c) => `<tr><td>${esc(c.teamId)}</td><td>${esc(c.artefactId)}</td><td>${esc(c.projectCode)}</td><td>${esc(c.title)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <p class="text-muted mt-2 mb-0" style="font-size:13px">Each student can now sign in with their SRN and the default password.</p>`);
      btn.textContent = 'Done';
      btn.disabled = false;
      btn.onclick = () => { modal.hide(); };
      onDone();
    } catch (err) {
      setStatus(`<div class="al-login-error" style="display:block">${esc(err.message)}</div>`);
      $('importFile').disabled = false;
    }
  }

  async function downloadTemplate() {
    try {
      const res = await fetch(`/api/departments/${encodeURIComponent(departmentId)}/projects/import-template`, {
        headers: { Authorization: `Bearer ${Api.token()}` },
      });
      if (!res.ok) throw new Error(`Could not download the template (${res.status}).`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'project-upload-template.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) {
      setStatus(`<div class="al-login-error" style="display:block">${esc(err.message)}</div>`);
    }
  }

  function init(options) {
    departmentId = options.departmentId;
    onDone = options.onDone || (() => {});
    modal = new bootstrap.Modal($('importModal'));
    $('importFile').addEventListener('change', (e) => check(e.target.files[0]));
    $('importSubmit').addEventListener('click', () => { if (!$('importSubmit').onclick) runImport(); });
    $('importTemplateBtn').addEventListener('click', downloadTemplate);
  }

  function open(departmentName) {
    $('importDeptName').textContent = departmentName || 'this department';
    $('importFile').value = '';
    $('importFile').disabled = false;
    $('importSubmit').onclick = null;
    $('importSubmit').textContent = 'Import projects';
    $('importSubmit').disabled = true;
    csvText = '';
    setStatus('');
    modal.show();
  }

  return { init, open };
})();
