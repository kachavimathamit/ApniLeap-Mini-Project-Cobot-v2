const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const authRoutes = require('./routes/auth.routes');
const instituteRoutes = require('./routes/institute.routes');
const departmentRoutes = require('./routes/department.routes');
const projectRoutes = require('./routes/project.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const reportRoutes = require('./routes/report.routes');
const adminRoutes = require('./routes/admin.routes');
const webhookRoutes = require('./routes/webhook.routes');
const portfolioRoutes = require('./routes/portfolio.routes');
const { milestoneRouter, kpiRouter, issueRouter, actionRouter } = require('./routes/entity.routes');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));   // room for a 200-project CSV upload

app.use('/api/auth', authRoutes);
app.use('/api/institutes', instituteRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/milestones', milestoneRouter);
app.use('/api/kpis', kpiRouter);
app.use('/api/issues', issueRouter);
app.use('/api/actions', actionRouter);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/portfolio', portfolioRoutes);

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve the static frontend
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));

// 404 for unknown API routes
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found.' });
});

// Centralized error handler - never leak stack traces to the client
app.use((err, req, res, next) => {
    // Bad client input that reaches PostgreSQL is a 4xx, not a server fault.
    const clientErrors = {
        '22P02': [400, 'One of the supplied identifiers or values is malformed.'],
        '22001': [400, 'One of the supplied values is too long.'],
        '22007': [400, 'One of the supplied dates is invalid.'],
        '23503': [400, 'A referenced record does not exist.'],
        '23514': [400, 'One of the supplied values is not allowed.'],
        '23502': [400, 'A required value is missing.'],
    };
    if (err && clientErrors[err.code]) {
        const [status, message] = clientErrors[err.code];
        return res.status(status).json({ error: message });
    }
    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Request body is not valid JSON.' });
    }
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`ApniLeap Portfolio Monitoring Portal backend running on http://localhost:${PORT}`);
});
