const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// GET attendance report
router.get('/attendance', auth, authorize('reports', 'view'), async (req, res) => {
  const { start_date, end_date, employee_id } = req.query;
  try {
    let query = `
      SELECT al.*, 
             v.first_name, v.last_name, v.employee_no,
             v.department_name
      FROM attendance_logs al
      JOIN v_employee_current_employment v ON al.employee_id = v.employee_id
      WHERE al.log_date BETWEEN $1 AND $2
    `;
    const params = [start_date, end_date];

    if (employee_id) {
      query += ` AND al.employee_id = $3`;
      params.push(employee_id);
    }

    query += ` ORDER BY al.log_date DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET leave report
router.get('/leave', auth, authorize('reports', 'view'), async (req, res) => {
  const { start_date, end_date, employee_id, status } = req.query;
  try {
    let query = `
      SELECT lr.*, e.first_name, e.last_name, e.employee_no,
      lt.name as leave_type_name, lt.code as leave_type_code
      FROM leave_requests lr
      JOIN employees e ON lr.employee_id = e.id
      JOIN leave_types lt ON lr.leave_type_id = lt.id
      WHERE lr.start_date BETWEEN $1 AND $2
    `;
    const params = [start_date, end_date];

    if (employee_id) {
      query += ` AND lr.employee_id = $${params.length + 1}`;
      params.push(employee_id);
    }

    if (status) {
      query += ` AND lr.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY lr.submitted_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET overtime report
router.get('/overtime', auth, authorize('reports', 'view'), async (req, res) => {
  const { start_date, end_date, employee_id, status } = req.query;
  try {
    let query = `
      SELECT ot.*, e.first_name, e.last_name, e.employee_no
      FROM overtime_requests ot
      JOIN employees e ON ot.employee_id = e.id
      WHERE ot.ot_date BETWEEN $1 AND $2
    `;
    const params = [start_date, end_date];

    if (employee_id) {
      query += ` AND ot.employee_id = $${params.length + 1}`;
      params.push(employee_id);
    }

    if (status) {
      query += ` AND ot.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY ot.submitted_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET payroll report
router.get('/payroll', auth, authorize('reports', 'view'), async (req, res) => {
  const { pay_period_id } = req.query;
  try {
    const result = await pool.query(
      `SELECT p.*, e.first_name, e.last_name, e.employee_no,
      pp.period_label, pp.start_date, pp.end_date
      FROM payslips p
      JOIN employees e ON p.employee_id = e.id
      JOIN pay_periods pp ON p.pay_period_id = pp.id
      WHERE p.pay_period_id = $1
      ORDER BY e.last_name ASC`,
      [pay_period_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET employee master list report
router.get('/employees', auth, authorize('reports', 'view'), async (req, res) => {
  const { department_id, status } = req.query;
  try {
    let query = `
      SELECT e.*, v.position_title, v.department_name, 
      v.employment_type, v.work_setup
      FROM employees e
      JOIN v_employee_current_employment v ON e.id = v.employee_id
      WHERE 1=1
    `;
    const params = [];

    if (department_id) {
      query += ` AND v.department_id = $${params.length + 1}`;
      params.push(department_id);
    }

    if (status) {
      query += ` AND e.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY e.last_name ASC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;