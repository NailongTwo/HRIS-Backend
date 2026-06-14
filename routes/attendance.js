const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const query = require('../config/queryWithRetry');
const auth = require('../middleware/auth');

// Sync function to generate Absent and On Leave logs
async function syncEmployeeAttendance(employeeId) {
  try {
    const empRes = await pool.query(
      "SELECT hire_date, status FROM employees WHERE id = $1",
      [employeeId]
    );
    if (empRes.rows.length === 0 || empRes.rows[0].status !== 'Active') return;
    
    const hireDate = empRes.rows[0].hire_date ? new Date(empRes.rows[0].hire_date) : null;
    if (!hireDate) return;
    
    const startYear = new Date('2026-01-01');
    const startDate = hireDate > startYear ? hireDate : startYear;
    
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const today = new Date(todayStr);
    
    if (startDate > today) return;
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const todayStrParam = today.toISOString().split('T')[0];
    
    // Fetch existing logs
    const logsRes = await pool.query(
      "SELECT log_date::text, flag FROM attendance_logs WHERE employee_id = $1 AND log_date BETWEEN $2 AND $3",
      [employeeId, startDateStr, todayStrParam]
    );
    const existingLogs = {};
    logsRes.rows.forEach(r => {
      existingLogs[r.log_date.substring(0, 10)] = r.flag;
    });
    
    // Fetch approved leave requests
    const leavesRes = await pool.query(
      `SELECT start_date::text, end_date::text, lt.name as leave_type_name
       FROM leave_requests lr
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       WHERE lr.employee_id = $1 AND lr.status = 'Approved' 
         AND NOT (lr.end_date < $2 OR lr.start_date > $3)`,
      [employeeId, startDateStr, todayStrParam]
    );
    
    const leaves = leavesRes.rows.map(r => ({
      start: new Date(r.start_date.substring(0, 10)),
      end: new Date(r.end_date.substring(0, 10)),
      name: r.leave_type_name
    }));
    
    const getApprovedLeave = (date) => {
      const d = new Date(date.toISOString().split('T')[0]);
      return leaves.find(l => d >= l.start && d <= l.end);
    };
    
    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Skip Saturday and Sunday
      
      const dateStr = d.toISOString().split('T')[0];
      const leave = getApprovedLeave(d);
      const isToday = dateStr === todayStrParam;
      
      if (!existingLogs[dateStr]) {
        if (leave) {
          await pool.query(
            `INSERT INTO attendance_logs (employee_id, log_date, source, flag, remarks) 
             VALUES ($1, $2, 'System', 'On Leave', $3)`,
            [employeeId, dateStr, `Approved Leave: ${leave.name}`]
          );
        } else if (!isToday) {
          await pool.query(
            `INSERT INTO attendance_logs (employee_id, log_date, source, flag) 
             VALUES ($1, $2, 'System', 'Absent')`,
            [employeeId, dateStr]
          );
        }
      } else if (existingLogs[dateStr] === 'Absent' && leave) {
        await pool.query(
          `UPDATE attendance_logs 
           SET flag = 'On Leave', remarks = $1 
           WHERE employee_id = $2 AND log_date = $3`,
          [`Approved Leave: ${leave.name}`, employeeId, dateStr]
        );
      }
    }
  } catch (err) {
    console.error(`[syncEmployeeAttendance] Error for employee ${employeeId}:`, err.message);
  }
}

// GET all attendance logs
router.get('/', auth, async (req, res) => {
  try {
    // Sync all active employees
    const activeEmps = await query("SELECT id FROM employees WHERE status = 'Active'");
    for (const emp of activeEmps.rows) {
      await syncEmployeeAttendance(emp.id);
    }

    const result = await query(
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
    await syncEmployeeAttendance(req.params.id);

    const result = await query(
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
    await syncEmployeeAttendance(req.params.employee_id);

    const result = await query(
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
    const existing = await query(
      'SELECT * FROM attendance_logs WHERE employee_id = $1 AND log_date = $2',
      [employee_id, today]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'Already timed in today!' });
    }

    // Get required_time_in and grace_period from employment record
    const empRecord = await query(
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

    const result = await query(
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
    const log = await query(
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

    const result = await query(
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

// ADJUST attendance log (manually by admin)
router.put('/:id/adjust', auth, async (req, res) => {
  const { time_in, time_out, flag, remarks, adjustment_reason } = req.body;
  const adjusted_by = req.user.id;

  try {
    // 1. Calculate hours_worked if both time_in and time_out are provided
    let hoursWorked = null;
    let lateMins = 0;
    if (time_in && time_out) {
      const inDate = new Date(time_in);
      const outDate = new Date(time_out);
      hoursWorked = ((outDate - inDate) / 3600000).toFixed(2);
      if (hoursWorked < 0) hoursWorked = 0;
    }

    // 2. Perform adjustment
    const result = await query(
      `UPDATE attendance_logs 
       SET time_in = $1,
           time_out = $2,
           flag = $3,
           remarks = $4,
           adjustment_reason = $5,
           is_adjusted = true,
           adjusted_by = $6,
           adjusted_at = NOW(),
           hours_worked = COALESCE($7, hours_worked),
           updated_at = NOW()
       WHERE id = $8 
       RETURNING *`,
      [time_in || null, time_out || null, flag || 'On Time', remarks || '', adjustment_reason || '', adjusted_by, hoursWorked, req.params.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Attendance log not found!' });
    }

    // 3. Get employee details for the response
    const updatedResult = await query(
      `SELECT al.*, 
              e.first_name, e.last_name, e.employee_no
       FROM attendance_logs al
       JOIN employees e ON al.employee_id = e.id
       WHERE al.id = $1`,
      [result.rows[0].id]
    );

    res.json(updatedResult.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;