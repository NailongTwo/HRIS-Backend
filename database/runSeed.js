const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: 'dpg-d7tc6h67r5hc738jb3b0-a.oregon-postgres.render.com',
  user: 'user',
  password: 'cQFMtpi99QcVDUq5Uu7YgfH22ckAn9YN',
  database: 'hris_db_tb2f',
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

async function runSeed() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
    await pool.query(sql);
    console.log('Seed data inserted successfully!');
  } catch (err) {
    console.log('Error:', err.message);
  } finally {
    pool.end();
  }
}

runSeed();