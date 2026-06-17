const pool = require('./config/db');

async function fixPerms() {
  try {
    console.log('Fixing leave_ledger view permissions for HR, Manager, and Employee...');

    // Get leave_ledger module ID
    const moduleRes = await pool.query("SELECT id FROM modules WHERE code = 'leave_ledger'");
    if (moduleRes.rows.length === 0) {
      console.log('leave_ledger module not found!');
      process.exit(1);
    }
    const moduleId = moduleRes.rows[0].id;

    // Update or insert role permissions for leave_ledger
    const rolesToUpdate = ['HR', 'Manager', 'Employee'];
    for (const roleName of rolesToUpdate) {
      const roleRes = await pool.query("SELECT id FROM roles WHERE name = $1", [roleName]);
      if (roleRes.rows.length > 0) {
        const roleId = roleRes.rows[0].id;
        await pool.query(`
          INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
          VALUES ($1, $2, true, false, false, false)
          ON CONFLICT (role_id, module_id) DO UPDATE 
          SET can_view = true;
        `, [roleId, moduleId]);
        console.log(`Updated permissions for role: ${roleName}`);
      }
    }

    console.log('✅ Permissions fixed!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

fixPerms();
