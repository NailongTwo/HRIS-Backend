const { Pool } = require('pg');

const pool = new Pool({
  host: 'dpg-d7tc6h67r5hc738jb3b0-a.oregon-postgres.render.com',
  user: 'user',
  password: 'cQFMtpi99QcVDUq5Uu7YgfH22ckAn9YN',
  database: 'hris_db_tb2f',
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

async function checkData() {
  const users = await pool.query('SELECT email, role, employee_no FROM users');
  console.log('\nUSERS:');
  users.rows.forEach(r => console.log('-', r.employee_no, r.email, r.role));

  const employees = await pool.query('SELECT employee_no, first_name, last_name FROM employees');
  console.log('\nEMPLOYEES:');
  employees.rows.forEach(r => console.log('-', r.employee_no, r.first_name, r.last_name));

  const employment = await pool.query(`
    SELECT e.employee_no, p.title, d.name 
    FROM employment_records er
    JOIN employees e ON er.employee_id = e.id
    JOIN positions p ON er.position_id = p.id
    JOIN departments d ON er.department_id = d.id
  `);
  console.log('\nEMPLOYMENT RECORDS:');
  employment.rows.forEach(r => console.log('-', r.employee_no, r.title, r.name));

  const credits = await pool.query(`
    SELECT e.employee_no, lt.code, lc.total_credits
    FROM leave_credits lc
    JOIN employees e ON lc.employee_id = e.id
    JOIN leave_types lt ON lc.leave_type_id = lt.id
  `);
  console.log('\nLEAVE CREDITS:');
  credits.rows.forEach(r => console.log('-', r.employee_no, r.code, r.total_credits));

  pool.end();
}

checkData();