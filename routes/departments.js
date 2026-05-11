const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// GET all departments
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM departments WHERE is_active = true ORDER BY name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET single department
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM departments WHERE id = $1',
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE department
router.post('/', auth, async (req, res) => {
  const { code, name, description, head_employee_id, parent_dept_id } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO departments 
      (code, name, description, head_employee_id, parent_dept_id) 
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING *`,
      [code, name, description, head_employee_id, parent_dept_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE department
router.put('/:id', auth, async (req, res) => {
  const { code, name, description, head_employee_id, is_active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE departments 
      SET code = $1, name = $2, description = $3, 
      head_employee_id = $4, is_active = $5
      WHERE id = $6 
      RETURNING *`,
      [code, name, description, head_employee_id, is_active, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE department (soft delete)
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE departments SET is_active = false WHERE id = $1',
      [req.params.id]
    );
    res.json({ message: 'Department deactivated!' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;