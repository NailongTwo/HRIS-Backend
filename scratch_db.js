const pool = require('./config/db');

async function checkDb() {
  try {
    console.log('Querying users...');
    const usersRes = await pool.query(`
      SELECT u.id, u.username, u.email, u.role, u.role_id, r.name as role_table_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
    `);
    console.table(usersRes.rows);

    console.log('\nQuerying roles...');
    const rolesRes = await pool.query('SELECT id, name, status FROM roles');
    console.table(rolesRes.rows);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkDb();
