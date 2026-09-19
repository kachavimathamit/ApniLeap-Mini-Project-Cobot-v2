const express = require('express');
const { updateMilestone } = require('../controllers/milestone.controller');
const { addMeasurement } = require('../controllers/kpi.controller');
const { updateIssue } = require('../controllers/issue.controller');
const { updateAction, verifyAction } = require('../controllers/action.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// These routes address individual entities directly (not nested under a known
// project id), so each controller loads the parent project itself and applies
// the same canAccessProject() tenant check before making any change.
// verifyAction has its own isAuthorizedApprover check inside the controller
// because that approver list differs from the general mentor-and-up gate.
const MENTOR_UP = ['FACULTY_MENTOR', 'DEPARTMENT_HEAD', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'GLOBAL_PROGRAMME_LEADER'];

const milestoneRouter = express.Router();
milestoneRouter.use(authenticate);
milestoneRouter.put('/:id', requireRole(...MENTOR_UP), updateMilestone);

const kpiRouter = express.Router();
kpiRouter.use(authenticate);
kpiRouter.post('/:id/measurements', requireRole(...MENTOR_UP), addMeasurement);

const issueRouter = express.Router();
issueRouter.use(authenticate);
issueRouter.put('/:id', requireRole(...MENTOR_UP), updateIssue);

const actionRouter = express.Router();
actionRouter.use(authenticate);
actionRouter.put('/:id', requireRole(...MENTOR_UP), updateAction);
actionRouter.post('/:id/verify', verifyAction);

module.exports = { milestoneRouter, kpiRouter, issueRouter, actionRouter };
