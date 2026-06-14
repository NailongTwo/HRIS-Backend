// compensation.js – Compensation Records endpoints
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// ── GET latest compensation for an employee ─────────────────────────────────────
router.get('/:employee_id', auth, async (req, res) => {
  const { employee_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT *
         FROM compensation_records
        WHERE employee_id = $1
     ORDER BY effective_date DESC, created_at DESC
        LIMIT 1`,
      [employee_id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('GET compensation error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ── POST (create) compensation record ───────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  const {
    employee_id,
    basic_salary,
    daily_rate,
    hourly_rate,
    sss_contribution,
    philhealth_contribution,
    pagibig_contribution,
    withholding_tax,
    effective_date,
    change_reason
  } = req.body;

  // Basic validation – ensure employee_id exists
  if (!employee_id) {
    return res.status(400).json({ message: 'employee_id is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO compensation_records
         (employee_id, basic_salary, daily_rate, hourly_rate,
          sss_contribution, philhealth_contribution, pagibig_contribution,
          withholding_tax, effective_date, change_reason)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        employee_id,
        basic_salary,
        daily_rate,
        hourly_rate,
        sss_contribution,
        philhealth_contribution,
        pagibig_contribution,
        withholding_tax,
        effective_date,
        change_reason
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST compensation error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
