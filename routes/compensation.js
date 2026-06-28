// compensation.js – Compensation Records endpoints
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
    const row = result.rows[0];

    if (row) {
      // Compute whether each loan/advance is still active (hasn't been fully paid off).
      // months = 0 means "no fixed term" -> treat as always active while amount > 0.
      const sssMonths = parseInt(row.sss_loan_months) || 0;
      const sssPaid = parseInt(row.sss_loan_months_paid) || 0;
      row.sss_loan_active = parseFloat(row.sss_loan) > 0 && (sssMonths === 0 || sssPaid < sssMonths);

      const pagibigMonths = parseInt(row.pagibig_loan_months) || 0;
      const pagibigPaid = parseInt(row.pagibig_loan_months_paid) || 0;
      row.pagibig_loan_active = parseFloat(row.pagibig_loan) > 0 && (pagibigMonths === 0 || pagibigPaid < pagibigMonths);

      const cashMonths = parseInt(row.cash_advance_months) || 0;
      const cashPaid = parseInt(row.cash_advance_months_paid) || 0;
      row.cash_advance_active = parseFloat(row.cash_advance) > 0 && (cashMonths === 0 || cashPaid < cashMonths);
    }

    res.json(row || null);
  } catch (err) {
    console.error('GET compensation error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



// Always inserts a new row, preserving full salary/loan history.
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
    // Look up the most recent prior record so we know whether each loan is
    // a continuation (carry months_paid forward) or a fresh loan (reset to 0).
    const prior = await pool.query(
      `SELECT sss_loan, sss_loan_months, sss_loan_months_paid,
              pagibig_loan, pagibig_loan_months, pagibig_loan_months_paid,
              cash_advance, cash_advance_months, cash_advance_months_paid
         FROM compensation_records
        WHERE employee_id = $1
     ORDER BY effective_date DESC, created_at DESC
        LIMIT 1`,
      [employee_id]
    );
    const priorRow = prior.rows[0] || null;

    const resolveMonthsPaid = (newAmount, newMonths, priorAmount, priorMonths, priorPaid) => {
      const amountChanged = parseFloat(newAmount || 0) !== parseFloat(priorAmount || 0);
      const monthsChanged = parseInt(newMonths || 0) !== parseInt(priorMonths || 0);
      if (!priorRow || amountChanged || monthsChanged) return 0;
      return parseInt(priorPaid) || 0;
    };

    const sssLoanMonthsPaid = resolveMonthsPaid(
      sss_loan, sss_loan_months,
      priorRow?.sss_loan, priorRow?.sss_loan_months, priorRow?.sss_loan_months_paid
    );
    const pagibigLoanMonthsPaid = resolveMonthsPaid(
      pagibig_loan, pagibig_loan_months,
      priorRow?.pagibig_loan, priorRow?.pagibig_loan_months, priorRow?.pagibig_loan_months_paid
    );
    const cashAdvanceMonthsPaid = resolveMonthsPaid(
      cash_advance, cash_advance_months,
      priorRow?.cash_advance, priorRow?.cash_advance_months, priorRow?.cash_advance_months_paid
    );

    const result = await pool.query(
      `INSERT INTO compensation_records
         (employee_id, basic_salary, daily_rate, hourly_rate,
          sss_contribution, philhealth_contribution, pagibig_contribution,
          withholding_tax, sss_loan, sss_loan_months, sss_loan_months_paid,
          pagibig_loan, pagibig_loan_months, pagibig_loan_months_paid,
          cash_advance, cash_advance_months, cash_advance_months_paid,
          effective_date, change_reason)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
        sssLoanMonthsPaid,
        pagibig_loan || 0,
        pagibig_loan_months || 0,
        pagibigLoanMonthsPaid,
        cash_advance || 0,
        cash_advance_months || 0,
        cashAdvanceMonthsPaid,
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