// compensation.js – Compensation Records endpoints (UPDATED)
const express = require('express');
const router = express.Router();
const auditRoute = require('../middleware/auditRoute');
router.use(auditRoute('compensation_records'));
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
    sss_loan,
    sss_loan_months,
    pagibig_loan,
    pagibig_loan_months,
    cash_advance,
    cash_advance_months,
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
          withholding_tax, sss_loan, sss_loan_months, pagibig_loan, 
          pagibig_loan_months, cash_advance, cash_advance_months,
          effective_date, change_reason)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
        sss_loan || 0,
        sss_loan_months || 0,
        pagibig_loan || 0,
        pagibig_loan_months || 0,
        cash_advance || 0,
        cash_advance_months || 0,
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

// ── PUT (update) compensation record ───────────────────────────────────────────
router.put('/:employee_id', auth, async (req, res) => {
  const { employee_id } = req.params;
  const {
    basic_salary,
    daily_rate,
    hourly_rate,
    sss_contribution,
    philhealth_contribution,
    pagibig_contribution,
    withholding_tax,
    sss_loan,
    sss_loan_months,
    pagibig_loan,
    pagibig_loan_months,
    cash_advance,
    cash_advance_months,
    effective_date,
    change_reason
  } = req.body;

  try {
    // Get the latest compensation record for this employee
    const existing = await pool.query(
      `SELECT id FROM compensation_records 
       WHERE employee_id = $1 
       ORDER BY effective_date DESC LIMIT 1`,
      [employee_id]
    );

    if (!existing.rows[0]) {
      return res.status(404).json({ message: 'No compensation record found for this employee' });
    }

    const result = await pool.query(
      `UPDATE compensation_records
       SET basic_salary = $1,
           daily_rate = $2,
           hourly_rate = $3,
           sss_contribution = $4,
           philhealth_contribution = $5,
           pagibig_contribution = $6,
           withholding_tax = $7,
           sss_loan = $8,
           sss_loan_months = $9,
           pagibig_loan = $10,
           pagibig_loan_months = $11,
           cash_advance = $12,
           cash_advance_months = $13,
           effective_date = $14,
           change_reason = $15,
           updated_at = NOW()
       WHERE employee_id = $16
       RETURNING *`,
      [
        basic_salary,
        daily_rate,
        hourly_rate,
        sss_contribution,
        philhealth_contribution,
        pagibig_contribution,
        withholding_tax,
        sss_loan || 0,
        sss_loan_months || 0,
        pagibig_loan || 0,
        pagibig_loan_months || 0,
        cash_advance || 0,
        cash_advance_months || 0,
        effective_date,
        change_reason,
        employee_id
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT compensation error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
