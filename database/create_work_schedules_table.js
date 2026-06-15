const pool = require('../config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('0. Preparing ENUM values (outside transaction)...');
    try {
      // Run this query outside the transaction block
      await client.query(`ALTER TYPE attendance_flag ADD VALUE IF NOT EXISTS 'Rest Day';`);
      console.log('Rest Day added to attendance_flag ENUM');
    } catch (e) {
      if (e.code === '25001') {
        console.log('Skipping ADD VALUE since we are in transaction (or other reason):', e.message);
      } else {
        console.log('ENUM Alteration note:', e.message);
      }
    }

    await client.query('BEGIN');

    console.log('1. Modifying event_types and events tables...');
    await client.query(`
      ALTER TABLE event_types ADD COLUMN IF NOT EXISTS is_non_working_day BOOLEAN DEFAULT false;
    `);
    await client.query(`
      ALTER TABLE events ADD COLUMN IF NOT EXISTS is_non_working_day BOOLEAN DEFAULT NULL;
    `);

    // Ensure regular and special holidays have is_non_working_day = true
    await client.query(`
      INSERT INTO event_types (name, color, is_holiday, is_non_working_day, is_active)
      VALUES 
        ('Regular Holiday', '#EF4444', true, true, true),
        ('Special Holiday', '#FACC15', true, true, true)
      ON CONFLICT (name) DO UPDATE SET is_non_working_day = true, is_holiday = true;
    `);

    console.log('2. Creating work_schedules table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS work_schedules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    console.log('3. Creating work_schedule_days table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS work_schedule_days (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        work_schedule_id UUID REFERENCES work_schedules(id) ON DELETE CASCADE,
        day_of_week VARCHAR(15) NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
        is_working BOOLEAN NOT NULL DEFAULT true,
        start_time TIME,
        end_time TIME,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(work_schedule_id, day_of_week)
      );
    `);

    console.log('4. Seeding default work schedules...');
    // Seed "Regular Office"
    let regularOfficeRes = await client.query(`
      INSERT INTO work_schedules (name, description, status)
      VALUES ('Regular Office', 'Standard Monday to Friday 8:00 AM - 5:00 PM schedule', 'Active')
      ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
      RETURNING id;
    `);
    const regOfficeId = regularOfficeRes.rows[0].id;

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    for (const d of days) {
      const isWorking = !['Saturday', 'Sunday'].includes(d);
      await client.query(`
        INSERT INTO work_schedule_days (work_schedule_id, day_of_week, is_working, start_time, end_time)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (work_schedule_id, day_of_week) DO UPDATE
          SET is_working = EXCLUDED.is_working,
              start_time = EXCLUDED.start_time,
              end_time = EXCLUDED.end_time;
      `, [regOfficeId, d, isWorking, isWorking ? '08:00:00' : null, isWorking ? '17:00:00' : null]);
    }

    // Seed "Night Shift"
    let nightShiftRes = await client.query(`
      INSERT INTO work_schedules (name, description, status)
      VALUES ('Night Shift', 'Monday to Friday overnight shift 9:00 PM - 6:00 AM', 'Active')
      ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
      RETURNING id;
    `);
    const nightShiftId = nightShiftRes.rows[0].id;

    for (const d of days) {
      const isWorking = !['Saturday', 'Sunday'].includes(d);
      await client.query(`
        INSERT INTO work_schedule_days (work_schedule_id, day_of_week, is_working, start_time, end_time)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (work_schedule_id, day_of_week) DO UPDATE
          SET is_working = EXCLUDED.is_working,
              start_time = EXCLUDED.start_time,
              end_time = EXCLUDED.end_time;
      `, [nightShiftId, d, isWorking, isWorking ? '21:00:00' : null, isWorking ? '06:00:00' : null]);
    }

    console.log('5. Altering employees table to reference work_schedules...');
    await client.query(`
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_schedule_id UUID REFERENCES work_schedules(id) ON DELETE RESTRICT;
    `);

    // Assign existing active employees to "Regular Office" schedule
    await client.query(`
      UPDATE employees
      SET work_schedule_id = $1
      WHERE work_schedule_id IS NULL;
    `, [regOfficeId]);

    console.log('6. Altering attendance_logs table for day_type and attendance_status...');
    await client.query(`
      ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS day_type VARCHAR(50) DEFAULT 'Regular Working Day';
    `);
    await client.query(`
      ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS attendance_status VARCHAR(50) DEFAULT NULL;
    `);

    // Backfill historical attendance logs
    await client.query(`
      UPDATE attendance_logs
      SET day_type = CASE
                       WHEN flag = 'Holiday' THEN 'Non-Working Holiday'
                       WHEN flag = 'Rest Day' THEN 'Rest Day'
                       ELSE 'Regular Working Day'
                     END,
          attendance_status = CASE
                                WHEN flag = 'On Leave' THEN 'On Leave'
                                WHEN flag = 'Absent' AND flag != 'Holiday' AND flag != 'Rest Day' THEN 'Absent'
                                WHEN flag = 'Holiday' THEN NULL
                                WHEN flag = 'Rest Day' THEN NULL
                                WHEN flag = 'Late' THEN 'Late'
                                WHEN flag = 'Undertime' THEN 'Undertime'
                                ELSE 'Present'
                              END;
    `);

    console.log('7. Recreating view v_employee_current_employment...');
    // Drop view first to avoid "cannot drop columns from view" type errors
    await client.query(`DROP VIEW IF EXISTS v_employee_current_employment;`);
    await client.query(`
      CREATE VIEW v_employee_current_employment AS
      SELECT 
          e.id AS employee_id,
          e.employee_no,
          e.first_name,
          e.last_name,
          e.avatar_url,
          e.status,
          e.work_schedule_id,
          ws.name AS work_schedule_name,
          er.id AS employment_record_id,
          er.department_id,
          er.position_id,
          p.title AS position_title,
          d.name AS department_name,
          er.employment_type,
          er.work_setup,
          er.hire_date,
          er.required_time_in,
          er.grace_period_mins,
          er.basic_salary,
          er.reports_to
      FROM employees e
      JOIN employment_records er ON e.id = er.employee_id
      JOIN positions p ON er.position_id = p.id
      JOIN departments d ON er.department_id = d.id
      LEFT JOIN work_schedules ws ON e.work_schedule_id = ws.id
      WHERE er.end_date IS NULL;
    `);

    console.log('8. Seeding modules & permissions...');
    const moduleRes = await client.query(`
      INSERT INTO modules (parent_group, name, code, sort_order)
      VALUES ('Attendance & Leave', 'Work Schedules', 'work_schedules', 34)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, parent_group = EXCLUDED.parent_group
      RETURNING id;
    `);
    const moduleId = moduleRes.rows[0].id;

    // Permissions for Super Admin, Admin, HR (Full access)
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT id, $1, true, true, true, true
      FROM roles
      WHERE name IN ('Super Admin', 'Admin', 'HR')
      ON CONFLICT (role_id, module_id) DO UPDATE
        SET can_view = true, can_create = true, can_edit = true, can_delete = true;
    `, [moduleId]);

    // Permissions for Manager (View only)
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT id, $1, true, false, false, false
      FROM roles
      WHERE name = 'Manager'
      ON CONFLICT (role_id, module_id) DO UPDATE
        SET can_view = true, can_create = false, can_edit = false, can_delete = false;
    `, [moduleId]);

    // Permissions for Employee (No access)
    await client.query(`
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT id, $1, false, false, false, false
      FROM roles
      WHERE name = 'Employee'
      ON CONFLICT (role_id, module_id) DO UPDATE
        SET can_view = false, can_create = false, can_edit = false, can_delete = false;
    `, [moduleId]);

    await client.query('COMMIT');
    console.log('🎉 Migration completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
