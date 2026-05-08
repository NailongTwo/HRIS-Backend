const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// GET all overtime requests
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM overtime_requests ORDER BY submitted_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET overtime requests by employee
router.get('/employee/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM overtime_requests WHERE employee_id = $1 ORDER BY submitted_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// FILE an overtime request
router.post('/', auth, async (req, res) => {
  const {
    employee_id,
    ot_date,
    day_type,
    planned_start,
    planned_end,
    planned_hours,
    reason,
    project_task
  } = req.body;

  try {
    // Generate reference number OT-YYYY-NNN
    const count = await pool.query('SELECT COUNT(*) FROM overtime_requests');
    const refNo = `OT-${new Date().getFullYear()}-${String(parseInt(count.rows[0].count) + 1).padStart(3, '0')}`;

    const result = await pool.query(
      `INSERT INTO overtime_requests 
      (reference_no, employee_id, ot_date, day_type, planned_start, 
      planned_end, planned_hours, reason, project_task, status, submitted_at) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending', NOW()) 
      RETURNING *`,
      [refNo, employee_id, ot_date, day_type || 'Regular Day', 
      planned_start, planned_end, planned_hours, reason, project_task]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// APPROVE/REJECT overtime request
router.put('/:id/status', auth, async (req, res) => {
  const { status, approval_remarks, approved_by } = req.body;

  try {
    const result = await pool.query(
      `UPDATE overtime_requests 
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

// CANCEL overtime request
router.put('/:id/cancel', auth, async (req, res) => {
  const { cancelled_reason } = req.body;

  try {
    const result = await pool.query(
      `UPDATE overtime_requests 
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