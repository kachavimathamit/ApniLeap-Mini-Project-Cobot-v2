const { pool } = require('../config/db');

const GLOBAL_ROLES = ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER'];
const APPROVER_ROLES = ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'DEPARTMENT_HEAD', 'REVIEWER'];

function isGlobalUser(user) {
    return (user.roles || []).some((r) => GLOBAL_ROLES.includes(r));
}

// Whether the user is allowed to approve a RED -> GREEN evidence-backed recovery.
function isAuthorizedApprover(user) {
    return (user.roles || []).some((r) => APPROVER_ROLES.includes(r));
}

// A project is visible to: global-role users, and users with an institute-level
// or department-level grant covering it. Being named as a project's mentor is
// deliberately NOT a grant on its own: a mentor assigned to a project outside
// their institutes must not gain access to that institute's data.
function canAccessProject(user, project) {
    if (isGlobalUser(user)) return true;
    if ((user.instituteIds || []).includes(project.institute_id)) return true;
    if ((user.departmentIds || []).includes(project.department_id)) return true;
    // A student sees the project(s) whose team lists their SRN.
    if ((user.projectIds || []).includes(project.id)) return true;
    return false;
}

async function loadProject(projectId) {
    const { rows } = await pool.query(`SELECT * FROM projects WHERE id = $1`, [projectId]);
    return rows[0] || null;
}

// Arrays for SQL filters. An empty list becomes one value that matches nothing
// (a nil UUID / department id 0), so ANY() never matches by accident.
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
function scopeArrays(user) {
    return {
        instituteIds: (user.instituteIds || []).length ? user.instituteIds : [NIL_UUID],
        departmentIds: (user.departmentIds || []).length ? user.departmentIds : [0],
        projectIds: (user.projectIds || []).length ? user.projectIds : [NIL_UUID],
        // every college the user may open: full grants plus colleges of their departments
        viewInstituteIds: [...new Set([...(user.instituteIds || []), ...(user.viewInstituteIds || [])])].length
            ? [...new Set([...(user.instituteIds || []), ...(user.viewInstituteIds || [])])] : [NIL_UUID],
    };
}

module.exports = { scopeArrays, isGlobalUser, isAuthorizedApprover, canAccessProject, loadProject, GLOBAL_ROLES, APPROVER_ROLES };
