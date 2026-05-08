const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// GET all attendance logs
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM attendance_logs ORDER BY log_date DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET attendance by employee
router.get('/employee/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM attendance_logs WHERE employee_id = $1 ORDER BY log_date DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// TIME IN
router.post('/time-in', auth, async (req, res) => {
  const { employee_id } = req.body;
  const today = new Date().toISOString().split('T')[0];

  try {
    // Check if already timed in today
    const existing = await pool.query(
      'SELECT * FROM attendance_logs WHERE employee_id = $1 AND log_date = $2',
      [employee_id, today]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'Already timed in today!' });
    }

    const result = await pool.query(
      `INSERT INTO attendance_logs 
      (employee_id, log_date, time_in, source, flag) 
      VALUES ($1, $2, NOW(), 'System', 'On Time') 
      RETURNING *`,
      [employee_id, today]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// TIME OUT
router.put('/time-out/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE attendance_logs 
      SET time_out = NOW()
      WHERE id = $1 
      RETURNING *`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;