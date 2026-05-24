const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// GET all attendance logs
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT al.*, 
              e.first_name, e.last_name, e.employee_no
       FROM attendance_logs al
       JOIN employees e ON al.employee_id = e.id
       ORDER BY al.log_date DESC`
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

// GET monthly summary - using the view
router.get('/summary/:employee_id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM v_attendance_monthly_summary 
       WHERE employee_id = $1 
       ORDER BY year DESC, month DESC`,
      [req.params.employee_id]
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

    // Get required_time_in and grace_period from employment record
    const empRecord = await pool.query(
      `SELECT required_time_in, grace_period_mins 
       FROM v_employee_current_employment 
       WHERE employee_id = $1`,
      [employee_id]
    );

    // Determine if late
    let flag = 'On Time';
    let late_mins = 0;

    if (empRecord.rows[0]?.required_time_in) {
      const now = new Date();
      const [reqHour, reqMin] = empRecord.rows[0].required_time_in.split(':');
      const gracePeriod = empRecord.rows[0].grace_period_mins || 15;

      const requiredTime = new Date();
      requiredTime.setHours(parseInt(reqHour), parseInt(reqMin), 0, 0);

      const diffMins = Math.floor((now - requiredTime) / 60000);

      if (diffMins > gracePeriod) {
        flag = 'Late';
        late_mins = diffMins;
      }
    }

    const result = await pool.query(
      `INSERT INTO attendance_logs 
        (employee_id, log_date, time_in, source, flag, late_mins) 
       VALUES ($1, $2, NOW(), 'System', $3, $4) 
       RETURNING *`,
      [employee_id, today, flag, late_mins]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// TIME OUT
router.put('/time-out/:id', auth, async (req, res) => {
  try {
    // Get time_in to compute hours_worked
    const log = await pool.query(
      'SELECT * FROM attendance_logs WHERE id = $1',
      [req.params.id]
    );

    if (!log.rows[0]) {
      return res.status(404).json({ message: 'Attendance log not found!' });
    }

    if (log.rows[0].time_out) {
      return res.status(400).json({ message: 'Already timed out!' });
    }

    const timeIn = new Date(log.rows[0].time_in);
    const timeOut = new Date();
    const hoursWorked = ((timeOut - timeIn) / 3600000).toFixed(2);

    const result = await pool.query(
      `UPDATE attendance_logs 
       SET time_out = NOW(),
           hours_worked = $1
       WHERE id = $2 
       RETURNING *`,
      [hoursWorked, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;