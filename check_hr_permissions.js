const pool = require('./config/db');

async function checkHr() {
  try {
    const hrRoleRes = await pool.query("SELECT id FROM roles WHERE name = 'HR'");
    if (hrRoleRes.rows.length === 0) {
      console.log('HR role not found!');
      process.exit(1);
    }
    const hrRoleId = hrRoleRes.rows[0].id;
    console.log(`HR Role ID: ${hrRoleId}`);

    const permsRes = await pool.query(`
      SELECT m.code, rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
      FROM modules m
      LEFT JOIN role_permissions rp ON rp.module_id = m.id AND rp.role_id = $1
      ORDER BY m.parent_group, m.sort_order
    `, [hrRoleId]);

    console.table(permsRes.rows);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkHr();
