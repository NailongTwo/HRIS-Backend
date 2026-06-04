const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// GET all leave requests - with employee details
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT lr.*, 
              e.first_name, e.last_name, e.employee_no,
              lt.name as leave_type_name, lt.code as leave_type_code,
              lt.badge_bg_color, lt.badge_text_color, lt.badge_dot_color
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.id
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       ORDER BY lr.submitted_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  } 
});

// GET all leave types -- MOVED TO TOP before /:id routes
router.get('/types', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM leave_types WHERE is_active = true ORDER BY name`
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
      `SELECT lr.*,     
              lt.name as leave_type_name, lt.code as leave_type_code,
              lt.badge_bg_color, lt.badge_text_color, lt.badge_dot_color
       FROM leave_requests lr
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       WHERE lr.employee_id = $1 
       ORDER BY lr.submitted_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET leave credits - using the view
router.get('/credits/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM v_leave_balance_current_year
       WHERE employee_id = $1`,
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
    reason,
    attachment_url
  } = req.body;

  try {
    const balance = await pool.query(
      `SELECT * FROM v_leave_balance_current_year
       WHERE employee_id = $1 
       AND leave_code = (SELECT code FROM leave_types WHERE id = $2)`,
      [employee_id, leave_type_id]
    );

    if (balance.rows[0] && balance.rows[0].available_credits < total_days) {
      return res.status(400).json({ 
        message: 'Insufficient leave credits!',
        available: balance.rows[0].available_credits,
        requested: total_days
      });
    }

    const count = await pool.query('SELECT COUNT(*) FROM leave_requests');
    const refNo = `LV-${new Date().getFullYear()}-${String(parseInt(count.rows[0].count) + 1).padStart(3, '0')}`;

    const credit = await pool.query(
      `SELECT id FROM leave_credits 
       WHERE employee_id = $1 
       AND leave_type_id = $2 
       AND year = EXTRACT(YEAR FROM NOW())`,
      [employee_id, leave_type_id]
    );

    const result = await pool.query(
      `INSERT INTO leave_requests 
        (reference_no, employee_id, leave_type_id, leave_credit_id,
         start_date, end_date, total_days, is_half_day, 
         half_day_period, reason, attachment_url, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Pending') 
       RETURNING *`,
      [refNo, employee_id, leave_type_id, credit.rows[0]?.id,
       start_date, end_date, total_days, is_half_day || false,
       half_day_period, reason, attachment_url]
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
       WHERE id = $4 RETURNING *`,
      [status, approval_remarks, approved_by, req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Leave request not found!' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CANCEL leave request
router.put('/:id/cancel', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE leave_requests 
       SET status = 'Cancelled', cancelled_at = NOW()
       WHERE id = $1 AND status = 'Pending'
       RETURNING *`,
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Leave request not found or already processed!' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Cancel error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


// for Admin 
// 1. GET all leave credits for all employees for the current year
router.get('/credits', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         lc.employee_id,
         e.employee_no,
         e.first_name || ' ' || e.last_name AS full_name,
         d.name AS department_name,
         lt.id AS leave_type_id,
         lt.name AS leave_type,
         lt.code AS leave_code,
         lc.year,
         lc.total_credits,
         lc.carried_over,
         lc.used_credits,
         lc.pending_credits,
         (lc.total_credits + lc.carried_over - lc.used_credits - lc.pending_credits) AS available_credits
       FROM leave_credits lc
       JOIN employees e ON lc.employee_id = e.id
       JOIN leave_types lt ON lc.leave_type_id = lt.id
       LEFT JOIN employment_records er ON e.id = er.employee_id AND er.end_date IS NULL
       LEFT JOIN departments d ON er.department_id = d.id
       WHERE lc.year = EXTRACT(YEAR FROM CURRENT_DATE)::smallint
       ORDER BY full_name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
// 2. PUT update leave credits for a single employee (Vacation, Sick, Emergency)
router.put('/credits', auth, async (req, res) => {
  const { employee_id, year, vl_total, vl_used, sl_total, sl_used, el_total, el_used } = req.body;
  try {
    const updateCredit = async (code, total, used) => {
      const typeRes = await pool.query('SELECT id FROM leave_types WHERE code = $1', [code]);
      if (typeRes.rows.length === 0) return;
      const leave_type_id = typeRes.rows[0].id;
      await pool.query(
        `INSERT INTO leave_credits (employee_id, leave_type_id, year, total_credits, used_credits)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (employee_id, leave_type_id, year) 
         DO UPDATE SET total_credits = EXCLUDED.total_credits, used_credits = EXCLUDED.used_credits, updated_at = NOW()`,
        [employee_id, leave_type_id, year, total, used]
      );
    };
    if (vl_total !== undefined && vl_used !== undefined) await updateCredit('VL', vl_total, vl_used);
    if (sl_total !== undefined && sl_used !== undefined) await updateCredit('SL', sl_total, sl_used);
    if (el_total !== undefined && el_used !== undefined) await updateCredit('EL', el_total, el_used);
    res.json({ message: 'Leave credits updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
// 3. POST allocate/bulk reset leave credits for all active employees
router.post('/credits/allocate', auth, async (req, res) => {
  const { vl, sl, el } = req.body;
  const year = new Date().getFullYear();
  try {
    const employeesRes = await pool.query("SELECT id FROM employees WHERE status = 'Active'");
    const activeEmployees = employeesRes.rows;
    const typesRes = await pool.query("SELECT id, code FROM leave_types WHERE code IN ('VL', 'SL', 'EL')");
    const leaveTypes = typesRes.rows;
    const vl_type = leaveTypes.find(t => t.code === 'VL');
    const sl_type = leaveTypes.find(t => t.code === 'SL');
    const el_type = leaveTypes.find(t => t.code === 'EL');
    for (const emp of activeEmployees) {
      if (vl_type && vl !== undefined) {
        await pool.query(
          `INSERT INTO leave_credits (employee_id, leave_type_id, year, total_credits, used_credits, pending_credits)
           VALUES ($1, $2, $3, $4, 0, 0)
           ON CONFLICT (employee_id, leave_type_id, year) 
           DO UPDATE SET total_credits = EXCLUDED.total_credits, used_credits = 0, pending_credits = 0, updated_at = NOW()`,
          [emp.id, vl_type.id, year, vl]
        );
      }
      if (sl_type && sl !== undefined) {
        await pool.query(
          `INSERT INTO leave_credits (employee_id, leave_type_id, year, total_credits, used_credits, pending_credits)
           VALUES ($1, $2, $3, $4, 0, 0)
           ON CONFLICT (employee_id, leave_type_id, year) 
           DO UPDATE SET total_credits = EXCLUDED.total_credits, used_credits = 0, pending_credits = 0, updated_at = NOW()`,
          [emp.id, sl_type.id, year, sl]
        );
      }
      if (el_type && el !== undefined) {
        await pool.query(
          `INSERT INTO leave_credits (employee_id, leave_type_id, year, total_credits, used_credits, pending_credits)
           VALUES ($1, $2, $3, $4, 0, 0)
           ON CONFLICT (employee_id, leave_type_id, year) 
           DO UPDATE SET total_credits = EXCLUDED.total_credits, used_credits = 0, pending_credits = 0, updated_at = NOW()`,
          [emp.id, el_type.id, year, el]
        );
      }
    }
    res.json({ message: 'Leave credits allocated to all active employees successfully!' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
module.exports = router;
