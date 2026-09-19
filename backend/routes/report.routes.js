const express = require('express');
const { weeklyReport } = require('../controllers/report.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);
router.get('/weekly', weeklyReport);

module.exports = router;
