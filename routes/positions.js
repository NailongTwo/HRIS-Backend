const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// GET all positions
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, d.name as department_name 
      FROM positions p
      JOIN departments d ON p.department_id = d.id
      WHERE p.is_active = true 
      ORDER BY p.title ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET positions by department
router.get('/department/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM positions 
      WHERE department_id = $1 AND is_active = true`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET single position
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM positions WHERE id = $1',
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE position
router.post('/', auth, async (req, res) => {
  const { code, title, department_id, level, description } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO positions 
      (code, title, department_id, level, description) 
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING *`,
      [code, title, department_id, level || 1, description]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE position
router.put('/:id', auth, async (req, res) => {
  const { code, title, department_id, level, description, is_active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE positions 
      SET code = $1, title = $2, department_id = $3, 
      level = $4, description = $5, is_active = $6
      WHERE id = $7 
      RETURNING *`,
      [code, title, department_id, level, description, is_active, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE position (soft delete)
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE positions SET is_active = false WHERE id = $1',
      [req.params.id]
    );
    res.json({ message: 'Position deactivated!' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;