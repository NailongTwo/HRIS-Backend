const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const query = require('../config/queryWithRetry');
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');

// GET all employees - using the view joined with users and roles
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.*, u.role_id, COALESCE(r.name, u.role::text) as role
      FROM v_employee_current_employment v
      JOIN employees e ON v.employee_id = e.id
      JOIN users u ON e.user_id = u.id
      LEFT JOIN roles r ON u.role_id = r.id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET single employee
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.*, u.role_id, COALESCE(r.name, u.role::text) as role
      FROM v_employee_current_employment v
      JOIN employees e ON v.employee_id = e.id
      JOIN users u ON e.user_id = u.id
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE v.employee_id = $1
    `, [req.params.id]);
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE employee - full transaction (user + employee + employment record)
router.post('/', auth, async (req, res) => {
  const {
    // User account info
    email,
    username,
    role_id, // Accept role_id UUID instead of raw role enum
    // Personal info
    employee_no,
    first_name,
    middle_name,
    last_name,
    date_of_birth,
    gender,
    civil_status,
    nationality,
    personal_email,
    personal_phone,
    // Employment info
    position_id,
    department_id,
    employment_type,
    work_setup,
    hire_date,
    basic_salary,
    work_schedule_id
  } = req.body;

  // Validate required fields to avoid database constraint violations
  if (!email || !employee_no || !first_name || !last_name || !gender || !civil_status || !date_of_birth || date_of_birth.trim() === '') {
    return res.status(400).json({ message: 'Missing required personal details: email, employee number, first name, last name, date of birth, gender, and civil status are required.' });
  }

  if (!work_schedule_id) {
    return res.status(400).json({ message: 'Work schedule assignment is required.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Check if email already exists
    const emailCheck = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    if (emailCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Email already exists!' });
    }

    // 2. Generate default password (first name + last 4 of employee_no)
    const defaultPassword = `${first_name.toLowerCase()}${employee_no.slice(-4)}`;
    const password_hash = await bcrypt.hash(defaultPassword, 10);

    // Look up the role name to populate the users.role enum column for backward compatibility
    let roleName = 'Employee';
    if (role_id) {
      const roleRes = await client.query('SELECT name FROM roles WHERE id = $1', [role_id]);
      if (roleRes.rows.length > 0) {
        roleName = roleRes.rows[0].name;
      }
    }
    const finalRoleId = role_id || (await client.query("SELECT id FROM roles WHERE name = 'Employee'")).rows[0]?.id || null;

    // 3. Create user account with role_id link
    const userResult = await client.query(
      `INSERT INTO users (employee_no, username, email, password_hash, role, role_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [employee_no, username || email.split('@')[0], email, password_hash, roleName, finalRoleId]
    );
    const user_id = userResult.rows[0].id;

    // 4. Create employee record
    const employeeResult = await client.query(
      `INSERT INTO employees 
        (user_id, employee_no, first_name, middle_name, last_name, 
         date_of_birth, gender, civil_status, nationality,
         personal_email, personal_phone, work_schedule_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [user_id, employee_no, first_name, middle_name, last_name,
       date_of_birth, gender, civil_status, nationality || 'Filipino',
       personal_email, personal_phone, work_schedule_id]
    );
    const employee_id = employeeResult.rows[0].id;

    // 5. Create employment record
    await client.query(
      `INSERT INTO employment_records
        (employee_id, position_id, department_id, employment_type,
         work_setup, hire_date, effective_date, basic_salary, required_time_in)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, '08:00:00')`,
      [employee_id, position_id, department_id, employment_type || 'Full-Time',
       work_setup || 'On-site', hire_date, basic_salary]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Employee created successfully!',
      employee_id,
      user_id,
      default_password: defaultPassword
    });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
});

// UPDATE employee — full transaction: personal info + employment record + user role
router.put('/:id', auth, async (req, res) => {
  const {
    // Personal / contact
    first_name, middle_name, last_name,
    date_of_birth, gender, civil_status,
    nationality, personal_email, personal_phone,
    // Employment
    department_id, position_id,
    employment_type, work_setup, basic_salary,
    // Account
    role_id,
    // Work Schedule
    work_schedule_id
  } = req.body;

  const safeDob = date_of_birth && String(date_of_birth).trim() !== '' ? date_of_birth : null;
  const safeSalary = basic_salary !== undefined && basic_salary !== '' ? Number(basic_salary) : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Update personal / contact info
    const empResult = await client.query(
      `UPDATE employees
       SET first_name       = COALESCE($1, first_name),
           middle_name      = $2,
           last_name        = COALESCE($3, last_name),
           date_of_birth    = COALESCE($4::date, date_of_birth),
           gender           = COALESCE($5::gender_type, gender),
           civil_status     = COALESCE($6::civil_status_type, civil_status),
           nationality      = COALESCE($7, nationality),
           personal_email   = $8,
           personal_phone   = $9,
           work_schedule_id = COALESCE($10::uuid, work_schedule_id),
           updated_at       = NOW()
       WHERE id = $11
       RETURNING *`,
      [first_name, middle_name, last_name,
       safeDob, gender, civil_status,
       nationality, personal_email, personal_phone,
       work_schedule_id || null,
       req.params.id]
    );

    if (empResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Employee not found' });
    }

    const employee = empResult.rows[0];

    // 2. Update the current (active) employment record
    const hasEmploymentChange = department_id || position_id || employment_type || work_setup || safeSalary !== null;
    if (hasEmploymentChange) {
      await client.query(
        `UPDATE employment_records
         SET department_id   = COALESCE($1, department_id),
             position_id     = COALESCE($2, position_id),
             employment_type = COALESCE($3::employment_type, employment_type),
             work_setup      = COALESCE($4::work_setup_type, work_setup),
             basic_salary    = COALESCE($5, basic_salary),
             updated_at      = NOW()
         WHERE employee_id = $6
           AND id = (
             SELECT id FROM employment_records
             WHERE employee_id = $6 AND end_date IS NULL
             ORDER BY effective_date DESC
             LIMIT 1
           )`,
        [department_id || null, position_id || null,
         employment_type || null, work_setup || null,
         safeSalary, req.params.id]
      );
    }

    // 3. Update system role
    if (role_id) {
      const roleRes = await client.query('SELECT name FROM roles WHERE id = $1', [role_id]);
      if (roleRes.rows.length > 0) {
        const roleName = roleRes.rows[0].name;
        await client.query(
          `UPDATE users SET role_id = $1, role = $2 WHERE id = $3`,
          [role_id, roleName, employee.user_id]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'Employee updated successfully!', employee });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PUT /employees] Error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
});


// SOFT DELETE - set status to Inactive
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await query(
      `UPDATE employees SET status='Inactive' WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    res.json({ message: 'Employee deactivated successfully!' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
