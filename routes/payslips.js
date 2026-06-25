// payslips.js – Payslips API (UPDATED for new fields)
// Key changes: Added sss_loan, pagibig_loan, cash_advance, day breakdowns, and sign-off fields

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const auditRoute = require('../middleware/auditRoute');

router.use(auditRoute('payslips'));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF, JPG, and PNG files are allowed.'));
  }
});

// GET all payslips (admin view)
router.get('/', auth, authorize('payslips', 'view'), async (req, res) => {
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
      `SELECT p.*, pp.period_label, pp.start_date, pp.end_date, pp.payment_date,
              e.employee_no,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name
      FROM payslips p
      JOIN pay_periods pp ON p.pay_period_id = pp.id
      JOIN employees   e  ON p.employee_id   = e.id
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
router.get('/pay-periods/all', auth, authorize('payroll_periods', 'view'), async (req, res) => {
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
router.post('/pay-periods', auth, authorize('payroll_periods', 'create'), async (req, res) => {
  const { period_label, start_date, end_date, payment_date } = req.body;
  try {
    const start = new Date(start_date);
    const year = start.getFullYear();
    const month = start.getMonth() + 1;
    const period_type = 'Monthly';

    const finalPaymentDate = payment_date && payment_date.trim() !== '' ? payment_date : null;
    
    if (new Date(start_date) >= new Date(end_date)) {
      return res.status(400).json({ 
        message: 'Period start date must be before end date.' 
      });
    }

    const overlapCheck = await pool.query(
      `SELECT id, period_label, start_date, end_date 
       FROM pay_periods
       WHERE (
         (start_date <= $1 AND end_date >= $1) OR
         (start_date <= $2 AND end_date >= $2) OR
         (start_date >= $1 AND end_date <= $2)
       )`,
      [start_date, end_date]
    );

    if (overlapCheck.rows.length > 0) {
      const overlap = overlapCheck.rows[0];
      const fmtDate = (d) => {
        if (!d) return '';
        if (d instanceof Date) return d.toISOString().split('T')[0];
        return String(d).split('T')[0];
      };
      return res.status(400).json({ 
        message: `Date range overlaps with existing period "${overlap.period_label}" (${fmtDate(overlap.start_date)} to ${fmtDate(overlap.end_date)})` 
      });
    }

    const result = await pool.query(
      `INSERT INTO pay_periods 
      (period_label, period_type, year, month, start_date, end_date, payment_date, is_finalized) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, false) 
      RETURNING *`,
      [period_label, period_type, year, month, start_date, end_date, finalPaymentDate]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE pay period
router.put('/pay-periods/:id', auth, authorize('payroll_periods', 'edit'), async (req, res) => {
  const { period_label, start_date, end_date, payment_date } = req.body;
  
  try {
    if (!period_label && !start_date && !end_date && !payment_date) {
      return res.status(400).json({ message: 'At least one field is required to update.' });
    }

    const currentRes = await pool.query(
      `SELECT start_date, end_date FROM pay_periods WHERE id = $1`,
      [req.params.id]
    );
    if (!currentRes.rows[0]) {
      return res.status(404).json({ message: 'Pay period not found.' });
    }

    const fmtDate = (d) => {
      if (!d) return '';
      if (d instanceof Date) return d.toISOString().split('T')[0];
      return String(d).split('T')[0];
    };

    const effectiveStart = start_date || fmtDate(currentRes.rows[0].start_date);
    const effectiveEnd = end_date || fmtDate(currentRes.rows[0].end_date);

    if (start_date || end_date) {
      if (new Date(effectiveStart) >= new Date(effectiveEnd)) {
        return res.status(400).json({ 
          message: 'Period start date must be before end date.' 
        });
      }

      const overlapCheck = await pool.query(
        `SELECT id, period_label, start_date, end_date 
         FROM pay_periods
         WHERE id != $3
           AND (
             (start_date <= $1 AND end_date >= $1) OR
             (start_date <= $2 AND end_date >= $2) OR
             (start_date >= $1 AND end_date <= $2)
           )`,
        [effectiveStart, effectiveEnd, req.params.id]
      );

      if (overlapCheck.rows.length > 0) {
        const overlap = overlapCheck.rows[0];
        return res.status(400).json({ 
          message: `Date range overlaps with existing period "${overlap.period_label}" (${fmtDate(overlap.start_date)} to ${fmtDate(overlap.end_date)})` 
        });
      }
    }
 
    const updateFields = [];
    const params = [];
    let paramIdx = 1;
 
    if (period_label) {
      updateFields.push(`period_label = $${paramIdx++}`);
      params.push(period_label);
    }
    if (start_date) {
      updateFields.push(`start_date = $${paramIdx++}`);
      params.push(start_date);
    }
    if (end_date) {
      updateFields.push(`end_date = $${paramIdx++}`);
      params.push(end_date);
    }
    if (payment_date !== undefined && payment_date !== null) {
      const finalPaymentDate = payment_date && payment_date.trim() !== '' ? payment_date : null;
      updateFields.push(`payment_date = $${paramIdx++}`);
      params.push(finalPaymentDate);
    }
 
    params.push(req.params.id);
    const idIdx = paramIdx;
 
    const result = await pool.query(
      `UPDATE pay_periods 
       SET ${updateFields.join(', ')}
       WHERE id = $${idIdx}
       RETURNING *`,
      params
    );
 
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Pay period not found.' });
    }
 
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE pay period
router.delete('/pay-periods/:id', auth, authorize('payroll_periods', 'delete'), async (req, res) => {
  try {
    const payslipCheck = await pool.query(
      `SELECT COUNT(*) as count FROM payslips WHERE pay_period_id = $1`,
      [req.params.id]
    );
 
    if (payslipCheck.rows[0].count > 0) {
      return res.status(400).json({ 
        message: `Cannot delete pay period with ${payslipCheck.rows[0].count} payslip(s). Delete or reassign payslips first.` 
      });
    }
 
    const result = await pool.query(
      `DELETE FROM pay_periods WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
 
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Pay period not found.' });
    }
 
    res.json({ message: 'Pay period deleted successfully!', deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DOWNLOAD payslip as PDF
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

    const data = payslip.rows[0];

    if (data.pdf_url) {
      return res.json({ type: 'url', url: data.pdf_url });
    }

    res.json({
      type: 'data',
      payslip: data
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET single payslip
router.get('/:id', auth, async (req, res) => {
  try {
    const payslip = await pool.query(
      `SELECT p.*, pp.period_label, pp.start_date, pp.end_date, pp.payment_date
      FROM payslips p
      JOIN pay_periods pp ON p.pay_period_id = pp.id
      WHERE p.id = $1`,
      [req.params.id]
    );

    res.json(payslip.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE payslip with NEW FIELDS
router.post('/', auth, authorize('payslips', 'create'), async (req, res) => {
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
    sss_loan,
    pagibig_loan,
    cash_advance,
    late_deduction,
    undertime_deduction, 
    absent_deduction,
    other_deductions,
    total_deductions,
    net_pay,
    days_worked,
    days_absent,
    days_leave,
    ot_hours,
    late_mins_total,
    undertime_mins_total,
    ordinary_days,
    special_holiday_hours,
    legal_holiday_days,
    prepared_by_name,
    prepared_by_title,
    check_by_name,
    check_by_title,
    generated_by
  } = req.body;

  try {
    const countRes = await pool.query(
      `SELECT COALESCE(MAX(CAST(SPLIT_PART(reference_no, '-', 4) AS INTEGER)), 0) AS max_seq 
       FROM payslips 
       WHERE reference_no LIKE $1`,
      [`PS-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-%`]
    );
    const nextSeq = (countRes.rows[0].max_seq || 0) + 1;
    const refNo = `PS-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(nextSeq).padStart(4, '0')}`;

    const result = await pool.query(
      `INSERT INTO payslips 
      (reference_no, employee_id, pay_period_id, basic_pay, overtime_pay,
      holiday_pay, allowances, other_earnings, gross_pay, sss_deduction,
      philhealth_deduction, pagibig_deduction, withholding_tax, sss_loan,
      pagibig_loan, cash_advance, late_deduction, undertime_deduction, absent_deduction, 
      other_deductions, total_deductions, net_pay, days_worked, days_absent, days_leave, 
      ot_hours, late_mins_total, undertime_mins_total, ordinary_days, special_holiday_hours,
      legal_holiday_days, prepared_by_name, prepared_by_title, check_by_name, check_by_title,
      generated_by) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 
      $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, 
      $35, $36) 
      RETURNING *`,
      [refNo, employee_id, pay_period_id, basic_pay, overtime_pay, holiday_pay, allowances, 
      other_earnings, gross_pay, sss_deduction, philhealth_deduction, pagibig_deduction, 
      withholding_tax, sss_loan || 0, pagibig_loan || 0, cash_advance || 0, late_deduction, 
      undertime_deduction, absent_deduction, other_deductions, total_deductions, net_pay, 
      days_worked, days_absent, days_leave, ot_hours, late_mins_total, undertime_mins_total,
      ordinary_days, special_holiday_hours, legal_holiday_days, prepared_by_name, 
      prepared_by_title, check_by_name, check_by_title, generated_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPLOAD payslip PDF
router.post('/:id/upload', auth, authorize('payslips', 'edit'), upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await pool.query('SELECT * FROM payslips WHERE id = $1', [id]);
    if (!existing.rows[0]) return res.status(404).json({ message: 'Payslip not found' });
    const { employee_id } = existing.rows[0];

    let pdfUrl = null;
    let pdfFileName = null;

    if (req.file) {
      const cleanedName = req.file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
      const filePath = `payslips/emp_${employee_id}_ps_${id}_${Date.now()}_${cleanedName}`;

      const { error: uploadError } = await supabase.storage
        .from('hris-files')
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true
        });

      if (uploadError) {
        console.error('Supabase upload error:', uploadError.message);
        return res.status(500).json({ message: 'Cloud storage upload failed.', error: uploadError.message });
      }

      const { data: urlData } = supabase.storage.from('hris-files').getPublicUrl(filePath);
      pdfUrl = urlData.publicUrl;
      pdfFileName = req.file.originalname;
    }

    const updateFields = pdfUrl
      ? `is_released = true, released_at = NOW(), pdf_url = $2, pdf_file_name = $3`
      : `is_released = true, released_at = NOW()`;

    const params = pdfUrl ? [id, pdfUrl, pdfFileName] : [id];
    const result = await pool.query(
      `UPDATE payslips SET ${updateFields} WHERE id = $1 RETURNING *`,
      params
    );

    res.json(result.rows[0]);
  } catch (err) {
    if (err.message?.includes('Only PDF')) {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// RELEASE payslip to employee
router.put('/:id/release', auth, authorize('payslips', 'edit'), async (req, res) => {
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
