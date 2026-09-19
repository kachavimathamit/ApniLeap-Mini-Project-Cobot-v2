const express = require('express');
const { listInstitutes, getInstitute, listDepartments, listStaff } = require('../controllers/institute.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireInstituteScope } = require('../middleware/tenant.middleware');
const { requireRole } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/', listInstitutes);
router.get('/:instituteId', requireInstituteScope('instituteId'), getInstitute);
router.get('/:instituteId/departments', requireInstituteScope('instituteId'), listDepartments);
// The staff directory (names, emails, roles) is for people who assign owners,
// mentors, deans and heads - not for students or read-only stakeholders.
router.get(
    '/:instituteId/staff',
    requireRole('FACULTY_MENTOR', 'DEPARTMENT_HEAD', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'GLOBAL_PROGRAMME_LEADER', 'REVIEWER'),
    requireInstituteScope('instituteId'),
    listStaff
);

module.exports = router;
