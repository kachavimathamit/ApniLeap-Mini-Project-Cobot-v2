const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../config/db');

async function init() {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    const client = await pool.connect();
    try {
        await client.query(sql);
        console.log('Schema applied successfully.');
    } catch (err) {
        console.error('Schema init failed:', err);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

init();
