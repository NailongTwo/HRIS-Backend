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
    const userResult = await queryWithRetry('SELECT * FROM users WHERE email = $1', [email]);

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

    // Create JWT token
    const token = jwt.sign(
      { id: user.id, employee_id, role: user.role, employee_no: user.employee_no },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      token,
      role: user.role,
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
          u.role,
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

module.exports = router;
