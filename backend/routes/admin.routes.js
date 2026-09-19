const express = require('express');
const {
    listUsers, listRoles, createUser, setUserStatus, createInstitute, updateInstitute, deleteInstitute,
    setUserDepartments, createDepartment, updateDepartment, deleteDepartment,
} = require('../controllers/admin.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireInstituteScope } = require('../middleware/tenant.middleware');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('INSTITUTE_ADMIN')); // PLATFORM_ADMIN always passes requireRole regardless of the list

router.get('/users', listUsers);
router.post('/users', createUser);
router.patch('/users/:id/status', setUserStatus);
router.patch('/users/:id/departments', setUserDepartments);

router.get('/roles', listRoles);

// Only a Platform Administrator may create a new institute (institute-scope
// middleware would have nothing to scope against yet).
router.post('/institutes', requireRole(), createInstitute);
router.patch('/institutes/:id', requireRole(), updateInstitute);
router.delete('/institutes/:id', requireRole(), deleteInstitute);

router.post('/institutes/:instituteId/departments', requireInstituteScope('instituteId'), createDepartment);

// Departments are addressed directly here; the controllers check that they
// belong to an institute the administrator manages.
router.patch('/departments/:id', updateDepartment);
router.delete('/departments/:id', deleteDepartment);

module.exports = router;
