const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// GET all leave requests
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM leave_requests ORDER BY submitted_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET leave requests by employee
router.get('/employee/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM leave_requests WHERE employee_id = $1 ORDER BY submitted_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET leave credits by employee
router.get('/credits/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT lc.*, lt.name as leave_type_name, lt.code 
      FROM leave_credits lc
      JOIN leave_types lt ON lc.leave_type_id = lt.id
      WHERE lc.employee_id = $1 AND lc.year = EXTRACT(YEAR FROM NOW())`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// FILE a leave request
router.post('/', auth, async (req, res) => {
  const { 
    employee_id, 
    leave_type_id, 
    start_date, 
    end_date, 
    total_days,
    is_half_day,
    half_day_period,
    reason 
  } = req.body;

  try {
    // Generate reference number LV-YYYY-NNN
    const count = await pool.query('SELECT COUNT(*) FROM leave_requests');
    const refNo = `LV-${new Date().getFullYear()}-${String(parseInt(count.rows[0].count) + 1).padStart(3, '0')}`;

    const result = await pool.query(
      `INSERT INTO leave_requests 
      (reference_no, employee_id, leave_type_id, start_date, end_date, 
      total_days, is_half_day, half_day_period, reason, status, submitted_at) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending', NOW()) 
      RETURNING *`,
      [refNo, employee_id, leave_type_id, start_date, end_date, 
      total_days, is_half_day || false, half_day_period, reason]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// APPROVE/REJECT leave request
router.put('/:id/status', auth, async (req, res) => {
  const { status, approval_remarks, approved_by } = req.body;

  try {
    const result = await pool.query(
      `UPDATE leave_requests 
      SET status = $1, approval_remarks = $2, approved_by = $3, approved_at = NOW()
      WHERE id = $4 
      RETURNING *`,
      [status, approval_remarks, approved_by, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CANCEL leave request
router.put('/:id/cancel', auth, async (req, res) => {
  const { cancelled_reason } = req.body;

  try {
    const result = await pool.query(
      `UPDATE leave_requests 
      SET status = 'Cancelled', cancelled_reason = $1, cancelled_at = NOW()
      WHERE id = $2 
      RETURNING *`,
      [cancelled_reason, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;