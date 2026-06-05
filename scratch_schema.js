const { Pool } = require('pg');

const pool = new Pool({
  host: 'dpg-d7tc6h67r5hc738jb3b0-a.oregon-postgres.render.com',
  user: 'user',
  password: 'cQFMtpi99QcVDUq5Uu7YgfH22ckAn9YN',
  database: 'hris_db_tb2f',
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

async function runTest() {
  try {
    // 1. Get columns of employees
    const empCols = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'employees'
    `);
    console.log("EMPLOYEES COLUMNS:");
    empCols.rows.forEach(r => console.log(`- ${r.column_name} (${r.data_type})`));

    // 2. Get columns of employment_records
    const recCols = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'employment_records'
    `);
    console.log("\nEMPLOYMENT_RECORDS COLUMNS:");
    recCols.rows.forEach(r => console.log(`- ${r.column_name} (${r.data_type})`));

    // 3. Get columns of users
    const userCols = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users'
    `);
    console.log("\nUSERS COLUMNS:");
    userCols.rows.forEach(r => console.log(`- ${r.column_name} (${r.data_type})`));

  } catch (err) {
    console.error("Query error:", err.message);
  } finally {
    await pool.end();
  }
}

runTest();
