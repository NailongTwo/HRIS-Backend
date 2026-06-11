const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const queryWithRetry = require('../config/queryWithRetry');
const auth = require('../middleware/auth');
require('dotenv').config();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  console.log(`Attempting login for: [${email}]`);

  try {
    // Join with roles table to fetch dynamic role name
    const userResult = await queryWithRetry(
      `SELECT u.*, r.name as role_name 
       FROM users u 
       LEFT JOIN roles r ON u.role_id = r.id 
       WHERE u.email = $1`, 
      [email]
    );

    if (userResult.rows.length === 0) {
      console.log("No user found with that email in DB.");
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = userResult.rows[0];
    console.log("User found. Comparing passwords...");

    const isMatch = await bcrypt.compare(password, user.password_hash);
    console.log("Password match result:", isMatch);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Fetch employee_id linked to this user
    const empResult = await queryWithRetry(
      'SELECT id FROM employees WHERE user_id = $1',
      [user.id]
    );
    const employee_id = empResult.rows[0]?.id || null;

    // Use dynamic role name, default to enum value if role_id not linked
    const roleName = user.role_name || user.role;

    // Create JWT token
    const token = jwt.sign(
      { id: user.id, employee_id, role: roleName, employee_no: user.employee_no },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      token,
      role: roleName,
      employee_no: user.employee_no,
      employee_id,
      email: user.email
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /api/auth/me — returns full profile for the logged-in admin
router.get('/me', auth, async (req, res) => {
  try {
    const result = await queryWithRetry(
      `SELECT
          u.id        AS user_id,
          u.email,
          u.username,
          u.role_id,
          COALESCE(r.name, u.role::text) AS role,
          u.employee_no,
          e.id        AS employee_id,
          e.first_name,
          e.last_name,
          e.date_of_birth,
          e.gender,
          e.civil_status,
          e.personal_phone,
          e.personal_email,
          er.hire_date,
          er.employment_type,
          er.work_setup,
          p.title     AS position_title,
          d.name      AS department_name
       FROM users u
       LEFT JOIN roles r              ON u.role_id = r.id
       LEFT JOIN employees e          ON u.id = e.user_id
       LEFT JOIN employment_records er ON e.id = er.employee_id AND er.end_date IS NULL
       LEFT JOIN positions p           ON er.position_id = p.id
       LEFT JOIN departments d         ON er.department_id = d.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /me error:', err.message);
    res.status(500).json({ message: 'Failed to load profile details.', error: err.message });
  }
});

// PUT /api/auth/profile — update logged-in admin's personal employee info
router.put('/profile', auth, async (req, res) => {
  const { first_name, last_name, personal_phone, personal_email, civil_status, gender, date_of_birth } = req.body;
  try {
    // Update employee record tied to this user
    await queryWithRetry(
      `UPDATE employees
         SET first_name     = COALESCE($1, first_name),
             last_name      = COALESCE($2, last_name),
             personal_phone = COALESCE($3, personal_phone),
             personal_email = COALESCE($4, personal_email),
             civil_status   = COALESCE($5, civil_status),
             gender         = COALESCE($6, gender),
             date_of_birth  = COALESCE($7, date_of_birth)
         WHERE user_id = $8`,
      [first_name, last_name, personal_phone, personal_email, civil_status, gender, date_of_birth, req.user.id]
    );

    // Re-fetch fresh profile
    const result = await queryWithRetry(
      `SELECT u.id AS user_id, u.email, u.username, u.role_id, COALESCE(r.name, u.role::text) AS role, u.employee_no,
              e.id AS employee_id, e.first_name, e.last_name,
              e.date_of_birth, e.gender, e.civil_status,
              e.personal_phone, e.personal_email,
              er.hire_date, er.employment_type, er.work_setup,
              p.title AS position_title, d.name AS department_name
         FROM users u
         LEFT JOIN roles r              ON u.role_id = r.id
         LEFT JOIN employees e          ON u.id = e.user_id
         LEFT JOIN employment_records er ON e.id = er.employee_id AND er.end_date IS NULL
         LEFT JOIN positions p           ON er.position_id = p.id
         LEFT JOIN departments d         ON er.department_id = d.id
         WHERE u.id = $1`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /profile error:', err.message);
    res.status(500).json({ message: 'Failed to update profile.', error: err.message });
  }
});

// PUT /api/auth/change-password — change logged-in admin's password
router.put('/change-password', auth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ message: 'Both current and new password are required.' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters.' });
  }
  try {
    const userResult = await queryWithRetry('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const isMatch = await bcrypt.compare(current_password, user.password_hash);
    if (!isMatch) return res.status(401).json({ message: 'Current password is incorrect.' });

    const hash = await bcrypt.hash(new_password, 10);
    await queryWithRetry('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('PUT /change-password error:', err.message);
    res.status(500).json({ message: 'Failed to change password.', error: err.message });
  }
});

// GET /api/auth/my-permissions — returns the logged-in user's dynamic permission schema
router.get('/my-permissions', auth, async (req, res) => {
  try {
    const query = `
      SELECT 
        m.code as module_code,
        COALESCE(rp.can_view, false) as can_view,
        COALESCE(rp.can_create, false) as can_create,
        COALESCE(rp.can_edit, false) as can_edit,
        COALESCE(rp.can_delete, false) as can_delete
      FROM modules m
      JOIN users u ON u.id = $1
      LEFT JOIN role_permissions rp ON rp.module_id = m.id AND rp.role_id = u.role_id
      ORDER BY m.parent_group, m.sort_order;
    `;
    const result = await pool.query(query, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch My Permissions Error:', err);
    res.status(500).json({ message: 'Failed to retrieve permissions.', error: err.message });
  }
});

module.exports = router;
