/**
 * sync_all_modules.js
 * Ensures every module code used by authorize() middleware exists in the DB.
 * Idempotent — safe to re-run at any time.
 */
const pool = require('./config/db');

async function syncAllModules() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🔄 Syncing all RBAC module codes to database...');

    // ── Full canonical module list (parent_group, name, code, sort_order) ──
    const modules = [
      // Main
      ['Main', 'Dashboard',         'dashboard',         1],
      ['Main', 'Analytics',         'analytics',         2],
      ['Main', 'Performance',       'performance',       3],
      ['Main', 'Surveys',           'surveys',           4],
      ['Main', 'Recognition',       'recognition',       5],
      // Employee Management
      ['Employee Management', 'Employees',      'employees',      10],
      ['Employee Management', 'Departments',    'departments',    11],
      ['Employee Management', 'Job Positions',  'job_positions',  12],
      // Attendance & Leave
      ['Attendance & Leave', 'Attendance',        'attendance',        20],
      ['Attendance & Leave', 'Leave Requests',    'leave_requests',    21],
      ['Attendance & Leave', 'Overtime Requests', 'overtime_requests', 22],
      ['Attendance & Leave', 'Leave Credits',     'leave_credits',     23],
      ['Attendance & Leave', 'Leave Ledger',      'leave_ledger',      24],
      ['Attendance & Leave', 'Work Schedules',    'work_schedules',    25],
      // Tasks & Comms
      ['Tasks & Comms', 'Tasks',         'tasks',         30],
      ['Tasks & Comms', 'Announcements', 'announcements', 31],
      ['Tasks & Comms', 'Events',        'events',        32],
      // Documents
      ['Documents', 'Documents',        'documents',         40],
      ['Documents', 'Doc Requirements', 'doc_requirements',  41],
      // Payroll
      ['Payroll', 'Payslips', 'payslips', 50],
      // System
      ['System', 'Role Permissions', 'role_permission', 60],
      ['System', 'Reports',          'reports',          61],
      ['System', 'Audit Logs',       'audit_logs',       62],
    ];

    for (const [parent, name, code, order] of modules) {
      await client.query(`
        INSERT INTO modules (parent_group, name, code, sort_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (code) DO UPDATE
          SET name         = EXCLUDED.name,
              parent_group = EXCLUDED.parent_group,
              sort_order   = EXCLUDED.sort_order;
      `, [parent, name, code, order]);
    }
    console.log(`✅ Upserted ${modules.length} module rows.`);

    // ── Seed Super Admin + Admin with ALL permissions ──
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT r.id, m.id, true, true, true, true
      FROM roles r
      CROSS JOIN modules m
      WHERE r.name IN ('Super Admin', 'Admin')
      ON CONFLICT (role_id, module_id) DO UPDATE
        SET can_view   = true,
            can_create = true,
            can_edit   = true,
            can_delete = true,
            updated_at = NOW();
    `);
    console.log('✅ Super Admin + Admin: all permissions set to true.');

    // ── Seed all other roles with false for any MISSING rows (never overwrites existing) ──
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT r.id, m.id, false, false, false, false
      FROM roles r
      CROSS JOIN modules m
      WHERE r.name NOT IN ('Super Admin', 'Admin')
      ON CONFLICT (role_id, module_id) DO NOTHING;
    `);
    console.log('✅ Other roles: missing permission rows seeded with false (existing rows preserved).');

    await client.query('COMMIT');
    console.log('\n🎉 All modules synced successfully!');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Sync failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

syncAllModules();
