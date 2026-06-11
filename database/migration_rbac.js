const pool = require('../config/db');

async function migrateRBAC() {
  console.log('🚀 Starting RBAC database migration...');
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // 1. Enable uuid-ossp extension
    console.log('Step 1: Enabling uuid-ossp extension...');
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // 2. Create roles table if not exists (baseline check)
    console.log('Step 2: Checking roles table...');
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

    // Seed default roles if not present
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
    console.log('Step 3: Creating modules table...');
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
    
    // Create index for modules
    await client.query(`CREATE INDEX IF NOT EXISTS idx_modules_parent_sort ON modules(parent_group, sort_order);`);

    // Seed modules list
    console.log('Step 4: Seeding HRIS modules...');
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
      ['System', 'Notifications', 'notifications', 92]
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

    // 4. Create role_permissions table
    console.log('Step 5: Creating role_permissions table...');
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

    // 5. Alter users table to add role_id and index
    console.log('Step 6: Adding role_id column to users table...');
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id) ON DELETE RESTRICT;
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);`);

    // 6. Link existing users to corresponding roles based on users.role text value
    console.log('Step 7: Mapping existing users to roles table...');
    await client.query(`
      UPDATE users 
      SET role_id = (SELECT id FROM roles r WHERE r.name = users.role::text)
      WHERE role_id IS NULL;
    `);

    // Set fallback default for any user whose role didn't map (e.g. set to Employee)
    await client.query(`
      UPDATE users 
      SET role_id = (SELECT id FROM roles WHERE name = 'Employee')
      WHERE role_id IS NULL;
    `);

    // 7. Seed baseline permission matrices for preloaded roles
    console.log('Step 8: Seeding baseline permissions for preloaded roles...');

    // A. Super Admin & Admin (All True)
    console.log('Seeding Admin and Super Admin matrices...');
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT r.id, m.id, true, true, true, true 
      FROM roles r, modules m
      WHERE r.name IN ('Super Admin', 'Admin')
      ON CONFLICT (role_id, module_id) DO NOTHING;
    `);

    // B. HR (Standard management access, no full system config delete)
    console.log('Seeding HR matrices...');
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT r.id, m.id, 
        true, -- can_view
        CASE WHEN m.code IN ('role_permission', 'audit_logs') THEN false ELSE true END, -- can_create
        CASE WHEN m.code IN ('role_permission', 'audit_logs') THEN false ELSE true END, -- can_edit
        CASE WHEN m.code IN ('employees', 'departments', 'positions', 'leave_requests', 'overtime_requests', 'tasks', 'announcements', 'calendar', 'employee_documents') THEN true ELSE false END -- can_delete
      FROM roles r, modules m
      WHERE r.name = 'HR'
      ON CONFLICT (role_id, module_id) DO NOTHING;
    `);

    // C. Manager (Approvals, team actions, tasks, notifications)
    console.log('Seeding Manager matrices...');
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT r.id, m.id,
        CASE WHEN m.code IN ('role_permission', 'audit_logs', 'payroll_periods', 'payslips', 'doc_requirements') THEN false ELSE true END, -- can_view
        CASE WHEN m.code IN ('leave_requests', 'overtime_requests', 'tasks', 'calendar') THEN true ELSE false END, -- can_create
        CASE WHEN m.code IN ('leave_requests', 'overtime_requests', 'tasks', 'calendar') THEN true ELSE false END, -- can_edit
        false -- can_delete
      FROM roles r, modules m
      WHERE r.name = 'Manager'
      ON CONFLICT (role_id, module_id) DO NOTHING;
    `);

    // D. Payroll (Payslips, payroll cutoff, reports)
    console.log('Seeding Payroll matrices...');
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT r.id, m.id,
        CASE WHEN m.code IN ('dashboard', 'payroll_periods', 'payslips', 'reports', 'notifications') THEN true ELSE false END, -- can_view
        CASE WHEN m.code IN ('payroll_periods', 'payslips') THEN true ELSE false END, -- can_create
        CASE WHEN m.code IN ('payroll_periods', 'payslips') THEN true ELSE false END, -- can_edit
        false -- can_delete
      FROM roles r, modules m
      WHERE r.name = 'Payroll'
      ON CONFLICT (role_id, module_id) DO NOTHING;
    `);

    // E. Employee (Dashboard, leave credits, tasks, notifications, payslips, calendar)
    console.log('Seeding Employee matrices...');
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT r.id, m.id,
        CASE WHEN m.code IN ('dashboard', 'leave_requests', 'overtime_requests', 'leave_credits', 'tasks', 'announcements', 'calendar', 'payslips', 'employee_documents', 'notifications') THEN true ELSE false END, -- can_view
        CASE WHEN m.code IN ('leave_requests', 'overtime_requests', 'tasks') THEN true ELSE false END, -- can_create
        false, -- can_edit
        false -- can_delete
      FROM roles r, modules m
      WHERE r.name = 'Employee'
      ON CONFLICT (role_id, module_id) DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('✅ RBAC migration completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ RBAC migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

migrateRBAC();
