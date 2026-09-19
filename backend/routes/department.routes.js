const express = require('express');
const { getDepartment, listProjects, listMentors } = require('../controllers/department.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireDepartmentScope } = require('../middleware/tenant.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { importTemplate, importProjects } = require('../controllers/import.controller');

// Same roles that may add a project (Faculty Mentor and above).
const MENTOR_UP = ['FACULTY_MENTOR', 'DEPARTMENT_HEAD', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'GLOBAL_PROGRAMME_LEADER']; 

const router = express.Router();

router.use(authenticate);

router.get('/:departmentId', requireDepartmentScope('departmentId'), getDepartment);
router.get('/:departmentId/projects', requireDepartmentScope('departmentId'), listProjects);
router.get('/:departmentId/mentors', requireDepartmentScope('departmentId'), listMentors);
router.get('/:departmentId/projects/import-template', requireRole(...MENTOR_UP), requireDepartmentScope('departmentId'), importTemplate);
router.post('/:departmentId/projects/import', requireRole(...MENTOR_UP), requireDepartmentScope('departmentId'), importProjects);

module.exports = router;
