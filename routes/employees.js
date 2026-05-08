const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// GET all employees
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM employees');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET single employee
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE employee
router.post('/', auth, async (req, res) => {
  const { first_name, last_name, department, position, date_hired } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO employees (first_name, last_name, department, position, date_hired) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [first_name, last_name, department, position, date_hired]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE employee
router.put('/:id', auth, async (req, res) => {
  const { first_name, last_name, department, position } = req.body;
  try {
    const result = await pool.query(
      'UPDATE employees SET first_name=$1, last_name=$2, department=$3, position=$4 WHERE id=$5 RETURNING *',
      [first_name, last_name, department, position, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE employee
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
    res.json({ message: 'Employee deleted!' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;