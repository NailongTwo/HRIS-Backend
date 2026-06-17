const pool = require('./config/db');

async function updateModules() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Inserting/Updating modules to match sidebar exact codes...');

    // 1. Rename existing module codes if necessary
    await client.query(`
      UPDATE modules 
      SET code = 'job_positions' 
      WHERE code = 'positions';
    `);

    await client.query(`
      UPDATE modules 
      SET code = 'event_types' 
      WHERE code = 'event_type';
    `);

    // 2. Insert missing modules if they do not exist
    const newModules = [
      ['Main', 'Analytics', 'analytics', 11],
      ['Main', 'Performance', 'performance', 12],
      ['Main', 'Surveys', 'surveys', 13],
      ['Main', 'Recognition', 'recognition', 14],
      ['Attendance & Leave', 'Leave Ledger', 'leave_ledger', 34]
    ];

    for (const [parent, name, code, order] of newModules) {
      await client.query(`
        INSERT INTO modules (parent_group, name, code, sort_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (code) DO UPDATE 
        SET name = EXCLUDED.name,
            parent_group = EXCLUDED.parent_group,
            sort_order = EXCLUDED.sort_order;
      `, [parent, name, code, order]);
    }

    // 3. For any new modules, auto-seed Super Admin and Admin permissions to true
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT r.id, m.id, true, true, true, true 
      FROM roles r, modules m
      WHERE r.name IN ('Super Admin', 'Admin')
      ON CONFLICT (role_id, module_id) DO NOTHING;
    `);

    // Seed default false permissions for HR/Manager/Employee/Payroll for the new modules to prevent NULL
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT r.id, m.id, false, false, false, false
      FROM roles r, modules m
      WHERE r.name NOT IN ('Super Admin', 'Admin')
      ON CONFLICT (role_id, module_id) DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('✅ Modules synchronized successfully in database!');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to update modules:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

updateModules();
