const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const logId = '6a6b5916-e4c4-447d-9503-9d37bdb9b4df';
  try {
    const res = await pool.query('SELECT * FROM attendance_logs WHERE id = $1', [logId]);
    console.log('Database record:');
    console.log(JSON.stringify(res.rows[0], null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

main();
