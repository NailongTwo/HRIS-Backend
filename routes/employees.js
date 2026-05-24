const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// GET all employees - using the view
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM v_employee_current_employment');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET single employee
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM v_employee_current_employment WHERE employee_id = $1',
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE employee - requires user_id first
router.post('/', auth, async (req, res) => {
  const {
    user_id,
    employee_no,
    first_name,
    middle_name,
    last_name,
    date_of_birth,
    gender,
    civil_status,
    nationality
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO employees 
        (user_id, employee_no, first_name, middle_name, last_name, date_of_birth, gender, civil_status, nationality) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`,
      [user_id, employee_no, first_name, middle_name, last_name, date_of_birth, gender, civil_status, nationality]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE employee
router.put('/:id', auth, async (req, res) => {
  const {
    first_name,
    middle_name,
    last_name,
    civil_status,
    nationality,
    personal_email,
    personal_phone
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE employees 
       SET first_name=$1, middle_name=$2, last_name=$3, 
           civil_status=$4, nationality=$5, 
           personal_email=$6, personal_phone=$7
       WHERE id=$8 
       RETURNING *`,
      [first_name, middle_name, last_name, civil_status, nationality, personal_email, personal_phone, req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// SOFT DELETE - set status to Inactive instead of deleting
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
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