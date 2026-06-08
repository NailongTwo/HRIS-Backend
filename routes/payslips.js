const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// GET all payslips (admin view) — optionally filter by pay_period_id
router.get('/', auth, async (req, res) => {
  try {
    const { pay_period_id } = req.query;
    let query = `
      SELECT ps.*,
             pp.period_label, pp.start_date, pp.end_date, pp.payment_date,
             e.employee_no,
             CONCAT(e.first_name, ' ', e.last_name) AS employee_name
      FROM payslips ps
      JOIN pay_periods pp ON ps.pay_period_id = pp.id
      JOIN employees   e  ON ps.employee_id   = e.id
    `;
    const params = [];
    if (pay_period_id) {
      params.push(pay_period_id);
      query += ` WHERE ps.pay_period_id = $1`;
    }
    query += ' ORDER BY pp.start_date DESC, e.last_name ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all payslips by employee
router.get('/employee/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, pp.period_label, pp.start_date, pp.end_date, pp.payment_date
      FROM payslips p
      JOIN pay_periods pp ON p.pay_period_id = pp.id
      WHERE p.employee_id = $1 AND p.is_released = true
      ORDER BY pp.start_date DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all pay periods
router.get('/pay-periods/all', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM pay_periods ORDER BY start_date DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE pay period
router.post('/pay-periods', auth, async (req, res) => {
  const { period_label, start_date, end_date, payment_date } = req.body;
  try {
    // Automatically derive fields if not provided
    const start = new Date(start_date);
    const year = start.getFullYear();
    const month = start.getMonth() + 1;
    const period_type = start.getDate() <= 15 ? '1st Half' : '2nd Half';

    const result = await pool.query(
      `INSERT INTO pay_periods 
      (period_label, period_type, year, month, start_date, end_date, payment_date, is_finalized) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, false) 
      RETURNING *`,
      [period_label, period_type, year, month, start_date, end_date, payment_date]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// FINALIZE/RELEASE pay period
router.put('/pay-periods/:id/finalize', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE pay_periods 
      SET is_finalized = true 
      WHERE id = $1 
      RETURNING *`,
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Pay period not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DOWNLOAD payslip as PDF — returns stored pdf_url or structured data
router.get('/:id/download', auth, async (req, res) => {
  try {
    const payslip = await pool.query(
      `SELECT ps.*,
              pp.period_label, pp.start_date, pp.end_date, pp.payment_date,
              e.employee_no,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              d.name AS department_name,
              p.title AS position_title
       FROM payslips ps
       JOIN pay_periods pp ON ps.pay_period_id = pp.id
       JOIN employees   e  ON ps.employee_id   = e.id
       LEFT JOIN employment_records er ON er.employee_id = e.id AND (er.end_date IS NULL OR er.end_date > NOW())
       LEFT JOIN departments d ON er.department_id = d.id
       LEFT JOIN positions   p ON er.position_id   = p.id
       WHERE ps.id = $1`,
      [req.params.id]
    );

    if (!payslip.rows[0]) {
      return res.status(404).json({ message: 'Payslip not found' });
    }

    const lineItems = await pool.query(
      'SELECT * FROM payslip_line_items WHERE payslip_id = $1 ORDER BY sort_order ASC',
      [req.params.id]
    );

    const data = payslip.rows[0];

    // If a stored pdf_url exists (data URI or signed URL), redirect/return it
    if (data.pdf_url) {
      // If it's a data URI, send it back; client will open in new tab
      return res.json({ type: 'url', url: data.pdf_url });
    }

    // Otherwise return structured data so the client can generate the PDF
    res.json({
      type: 'data',
      payslip: data,
      line_items: lineItems.rows
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET single payslip with line items
router.get('/:id', auth, async (req, res) => {
  try {
    const payslip = await pool.query(
      `SELECT p.*, pp.period_label, pp.start_date, pp.end_date, pp.payment_date
      FROM payslips p
      JOIN pay_periods pp ON p.pay_period_id = pp.id
      WHERE p.id = $1`,
      [req.params.id]
    );

    const lineItems = await pool.query(
      `SELECT * FROM payslip_line_items 
      WHERE payslip_id = $1 
      ORDER BY sort_order ASC`,
      [req.params.id]
    );

    res.json({
      payslip: payslip.rows[0],
      line_items: lineItems.rows
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE payslip
router.post('/', auth, async (req, res) => {
  const {
    employee_id,
    pay_period_id,
    basic_pay,
    overtime_pay,
    holiday_pay,
    allowances,
    other_earnings,
    gross_pay,
    sss_deduction,
    philhealth_deduction,
    pagibig_deduction,
    withholding_tax,
    late_deduction,
    absent_deduction,
    other_deductions,
    total_deductions,
    net_pay,
    days_worked,
    days_absent,
    days_leave,
    ot_hours,
    late_mins_total,
    generated_by
  } = req.body;

  try {
    // Generate reference number PS-YYYY-MM-NNNN using a counter
    const count = await pool.query('SELECT COUNT(*) FROM payslips');
    const refNo = `PS-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(parseInt(count.rows[0].count) + 1).padStart(4, '0')}`;

    const result = await pool.query(
      `INSERT INTO payslips 
      (reference_no, employee_id, pay_period_id, basic_pay, overtime_pay,
      holiday_pay, allowances, other_earnings, gross_pay, sss_deduction,
      philhealth_deduction, pagibig_deduction, withholding_tax, late_deduction,
      absent_deduction, other_deductions, total_deductions, net_pay,
      days_worked, days_absent, days_leave, ot_hours, late_mins_total, generated_by) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 
      $15, $16, $17, $18, $19, $20, $21, $22, $23, $24) 
      RETURNING *`,
      [refNo, employee_id, pay_period_id, basic_pay, overtime_pay,
      holiday_pay, allowances, other_earnings, gross_pay, sss_deduction,
      philhealth_deduction, pagibig_deduction, withholding_tax, late_deduction,
      absent_deduction, other_deductions, total_deductions, net_pay,
      days_worked, days_absent, days_leave, ot_hours, late_mins_total, generated_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// RELEASE payslip to employee
router.put('/:id/release', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE payslips 
      SET is_released = true, released_at = NOW()
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