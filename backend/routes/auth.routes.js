const express = require('express');
const rateLimit = require('express-rate-limit');
const { login, logout, me } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

// Brute-force protection: only FAILED attempts count. Institutes often sit
// behind one shared public IP, so counting successful logins would lock out
// legitimate users as soon as enough of them sign in during the same window.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again later.' },
});

router.post('/login', loginLimiter, login);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, me);

module.exports = router;
