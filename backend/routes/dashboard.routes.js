const express = require('express');
const { programmeDashboard, instituteDashboard } = require('../controllers/dashboard.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireInstituteScope } = require('../middleware/tenant.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/programme', programmeDashboard);
router.get('/institute/:instituteId', requireInstituteScope('instituteId'), instituteDashboard);

module.exports = router;
