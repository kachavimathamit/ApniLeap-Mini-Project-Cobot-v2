const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { logAudit } = require('../services/audit.service');

async function login(req, res, next) {
    try {
        // "email" may hold an email address or, for students, the SRN.
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({ error: 'SRN or email and password are required.' });
        }

        const identifier = String(email).trim();
        const bySrn = !identifier.includes('@');
        const { rows } = await pool.query(
            bySrn
                ? `SELECT id, email, password_hash, full_name, is_active, srn FROM users WHERE srn = $1`
                : `SELECT id, email, password_hash, full_name, is_active, srn FROM users WHERE email = $1`,
            [bySrn ? identifier.toUpperCase() : identifier.toLowerCase()]
        );
        const user = rows[0];

        // Same generic error for "no such user" and "wrong password" -
        // do not reveal account existence.
        const genericError = { error: 'Invalid SRN/email or password.' };

        if (!user) {
            await logAudit({ action: 'LOGIN_FAILED', details: { email }, ipAddress: req.ip });
            return res.status(401).json(genericError);
        }

        if (!user.is_active) {
            await logAudit({ userId: user.id, action: 'LOGIN_FAILED_INACTIVE', ipAddress: req.ip });
            return res.status(401).json({ error: 'This account has been deactivated.' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            await logAudit({ userId: user.id, action: 'LOGIN_FAILED', ipAddress: req.ip });
            return res.status(401).json(genericError);
        }

        const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN || '8h',
        });

        await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
        await logAudit({ userId: user.id, action: 'LOGIN', ipAddress: req.ip });

        const { rows: roleRows } = await pool.query(
            `SELECT r.code, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
            [user.id]
        );
        const { rows: instituteRows } = await pool.query(
            `SELECT institute_id FROM user_institute_access WHERE user_id = $1`,
            [user.id]
        );

        let projectIds = [];
        if (user.srn) {
            const { rows: teamRows } = await pool.query(`SELECT DISTINCT project_id FROM project_students WHERE srn = $1`, [user.srn]);
            projectIds = teamRows.map((r) => r.project_id);
        }
        const studentOnly = roleRows.length > 0 && roleRows.every((r) => r.code === 'STUDENT');

        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                srn: user.srn || null,
                projectIds,
                roles: roleRows.map((r) => r.code),
                roleNames: roleRows.map((r) => r.name),
                instituteIds: studentOnly ? [] : instituteRows.map((r) => r.institute_id),
            },
        });
    } catch (err) {
        next(err);
    }
}

async function logout(req, res, next) {
    try {
        await logAudit({ userId: req.user?.id, action: 'LOGOUT', ipAddress: req.ip });
        // Stateless JWT: client discards the token. Nothing server-side to invalidate
        // until a token-blacklist/session store is introduced in a later phase.
        res.json({ message: 'Logged out.' });
    } catch (err) {
        next(err);
    }
}

async function me(req, res, next) {
    try {
        const { rows: instRows } = await pool.query(
            `SELECT id, code, name FROM institutes WHERE id = ANY($1::uuid[]) ORDER BY display_order, name`,
            [req.user.instituteIds.length ? req.user.instituteIds : ['00000000-0000-0000-0000-000000000000']]
        );

        res.json({
            id: req.user.id,
            email: req.user.email,
            fullName: req.user.fullName,
            roles: req.user.roles,
            institutes: req.user.roles.includes('PLATFORM_ADMIN') || req.user.roles.includes('GLOBAL_PROGRAMME_LEADER')
                ? await allInstitutes()
                : instRows,
        });
    } catch (err) {
        next(err);
    }
}

async function allInstitutes() {
    const { rows } = await pool.query(`SELECT id, code, name FROM institutes WHERE is_active = TRUE ORDER BY display_order, name`);
    return rows;
}

module.exports = { login, logout, me };
