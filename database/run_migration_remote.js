/**
 * run_migration_remote.js
 * Run RBAC migration against ANY database by passing DATABASE_URL as argument.
 *
 * Usage:
 *   node database/run_migration_remote.js "postgresql://user:pass@host:5432/dbname"
 */

const { Pool } = require('pg');

const targetUrl = process.argv[2];

if (!targetUrl) {
  console.error('❌ Usage: node database/run_migration_remote.js "<DATABASE_URL>"');
  console.error('   Example: node database/run_migration_remote.js "postgresql://user:pass@host/db"');
  process.exit(1);
}

const pool = new Pool({
  connectionString: targetUrl,
  ssl: { rejectUnauthorized: false },
  max: 3,
  connectionTimeoutMillis: 30000,
});

async function migrateRBAC() {
  console.log('🚀 Starting RBAC migration against target database...');
  console.log(`   Target: ${targetUrl.replace(/:([^:@]+)@/, ':****@')}`); // mask password
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // 1. Enable uuid-ossp extension
    console.log('\n[1/8] Enabling uuid-ossp extension...');
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // 2. Create roles table
    console.log('[2/8] Ensuring roles table exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Seed default roles
    await client.query(`
      INSERT INTO roles (name, description, status) VALUES
      ('Super Admin', 'Full system configuration and overriding access', 'Active'),
      ('Admin', 'Full system access to all modules', 'Active'),
      ('HR', 'HR management of employees, leave, overtime, and announcements', 'Active'),
      ('Manager', 'Team management and approvals of leave & overtime', 'Active'),
      ('Employee', 'Standard employee self-service access', 'Active'),
      ('Payroll', 'Payroll periods and payslip processing', 'Active')
      ON CONFLICT (name) DO NOTHING;
    `);

    // 3. Create modules table
    console.log('[3/8] Creating modules table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS modules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        parent_group VARCHAR(100) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_modules_parent_sort ON modules(parent_group, sort_order);`);

    // 4. Seed modules
    console.log('[4/8] Seeding HRIS modules...');
    const modulesToSeed = [
      ['Main', 'Dashboard', 'dashboard', 10],
      ['Employee Management', 'Employees', 'employees', 20],
      ['Employee Management', 'Departments', 'departments', 21],
      ['Employee Management', 'Job Positions', 'positions', 22],
      ['Attendance & Leave', 'Attendance', 'attendance', 30],
      ['Attendance & Leave', 'Leave Requests', 'leave_requests', 31],
      ['Attendance & Leave', 'Overtime Requests', 'overtime_requests', 32],
      ['Attendance & Leave', 'Leave Credits', 'leave_credits', 33],
      ['Tasks & Announcements', 'Tasks', 'tasks', 40],
      ['Tasks & Announcements', 'Announcements', 'announcements', 41],
      ['Calendar & Events', 'Calendar', 'calendar', 50],
      ['Calendar & Events', 'Event Type', 'event_type', 51],
      ['Payroll', 'Payroll Periods', 'payroll_periods', 60],
      ['Payroll', 'Payslips', 'payslips', 61],
      ['Documents', 'Employee Documents', 'employee_documents', 70],
      ['Documents', 'Doc Requirements', 'doc_requirements', 71],
      ['Reports', 'Reports', 'reports', 80],
      ['System', 'Role Permission', 'role_permission', 90],
      ['System', 'Audit Logs', 'audit_logs', 91],
      ['System', 'Notifications', 'notifications', 92],
    ];

    for (const [parent, name, code, order] of modulesToSeed) {
      await client.query(`
        INSERT INTO modules (parent_group, name, code, sort_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (code) DO UPDATE
          SET name = EXCLUDED.name,
              parent_group = EXCLUDED.parent_group,
              sort_order = EXCLUDED.sort_order;
      `, [parent, name, code, order]);
    }

    // 5. Create role_permissions table
    console.log('[5/8] Creating role_permissions table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
        can_view BOOLEAN NOT NULL DEFAULT false,
        can_create BOOLEAN NOT NULL DEFAULT false,
        can_edit BOOLEAN NOT NULL DEFAULT false,
        can_delete BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (role_id, module_id)
      );
    `);

    // 6. Add role_id column to users
    console.log('[6/8] Adding role_id column to users table...');
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id) ON DELETE RESTRICT;
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);`);

    // 7. Map existing users to roles
    console.log('[7/8] Mapping existing users to roles...');
    await client.query(`
      UPDATE users
      SET role_id = (SELECT id FROM roles r WHERE r.name = users.role::text)
      WHERE role_id IS NULL;
    `);
    // Fallback: assign Employee role to any unmapped user
    await client.query(`
      UPDATE users
      SET role_id = (SELECT id FROM roles WHERE name = 'Employee')
      WHERE role_id IS NULL;
    `);

    // 8. Seed baseline permission matrices
    console.log('[8/8] Seeding permission matrices for all roles...');

    // Super Admin & Admin — all true
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT r.id, m.id, true, true, true, true
      FROM roles r, modules m
      WHERE r.name IN ('Super Admin', 'Admin')
      ON CONFLICT (role_id, module_id) DO NOTHING;
    `);

    // HR
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT r.id, m.id,
        true,
        CASE WHEN m.code IN ('role_permission', 'audit_logs') THEN false ELSE true END,
        CASE WHEN m.code IN ('role_permission', 'audit_logs') THEN false ELSE true END,
        CASE WHEN m.code IN ('employees', 'departments', 'positions', 'leave_requests', 'overtime_requests', 'tasks', 'announcements', 'calendar', 'employee_documents') THEN true ELSE false END
      FROM roles r, modules m
      WHERE r.name = 'HR'
      ON CONFLICT (role_id, module_id) DO NOTHING;
    `);

    // Manager
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT r.id, m.id,
        CASE WHEN m.code IN ('role_permission', 'audit_logs', 'payroll_periods', 'payslips', 'doc_requirements') THEN false ELSE true END,
        CASE WHEN m.code IN ('leave_requests', 'overtime_requests', 'tasks', 'calendar') THEN true ELSE false END,
        CASE WHEN m.code IN ('leave_requests', 'overtime_requests', 'tasks', 'calendar') THEN true ELSE false END,
        false
      FROM roles r, modules m
      WHERE r.name = 'Manager'
      ON CONFLICT (role_id, module_id) DO NOTHING;
    `);

    // Payroll
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT r.id, m.id,
        CASE WHEN m.code IN ('dashboard', 'payroll_periods', 'payslips', 'reports', 'notifications') THEN true ELSE false END,
        CASE WHEN m.code IN ('payroll_periods', 'payslips') THEN true ELSE false END,
        CASE WHEN m.code IN ('payroll_periods', 'payslips') THEN true ELSE false END,
        false
      FROM roles r, modules m
      WHERE r.name = 'Payroll'
      ON CONFLICT (role_id, module_id) DO NOTHING;
    `);

    // Employee
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT r.id, m.id,
        CASE WHEN m.code IN ('dashboard', 'leave_requests', 'overtime_requests', 'leave_credits', 'tasks', 'announcements', 'calendar', 'payslips', 'employee_documents', 'notifications') THEN true ELSE false END,
        CASE WHEN m.code IN ('leave_requests', 'overtime_requests', 'tasks') THEN true ELSE false END,
        false,
        false
      FROM roles r, modules m
      WHERE r.name = 'Employee'
      ON CONFLICT (role_id, module_id) DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('\n✅ RBAC migration completed successfully!');
    console.log('   Tables created: roles, modules, role_permissions');
    console.log('   Column added: users.role_id');
    console.log('   Permissions seeded for: Super Admin, Admin, HR, Manager, Payroll, Employee');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration FAILED:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrateRBAC();
