const express = require('express');
const router = express.Router();
const auditRoute = require('../middleware/auditRoute');
router.use(auditRoute('attendance_logs'));
const pool = require('../config/db');
const query = require('../config/queryWithRetry');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
// Helper to check if a holiday exists on a date
async function checkHolidayOnDate(dateStr) {
  try {
    const res = await pool.query(
      `SELECT e.is_non_working_day AS event_override, et.is_non_working_day AS type_default
       FROM events e
       JOIN event_types et ON e.event_type_id = et.id
       WHERE e.is_active = true AND et.is_active = true
         AND $1::date BETWEEN e.start_datetime::date AND e.end_datetime::date`,
      [dateStr]
    );
    if (res.rows.length === 0) return false;

    // 1. If any event explicitly sets is_non_working_day = TRUE -> treat as Holiday (non-working day)
    const hasForceTrue = res.rows.some(r => r.event_override === true);
    if (hasForceTrue) return true;

    // 2. If any event explicitly sets is_non_working_day = FALSE -> treat as working day (overrides type default)
    const hasForceFalse = res.rows.some(r => r.event_override === false);
    if (hasForceFalse) return false;

    // 3. Inherit type default
    return res.rows.some(r => r.type_default === true);
  } catch (err) {
    console.error('[checkHolidayOnDate] Error:', err.message);
    return false;
  }
}

// Helper to find the correct business date (log_date) and schedule details for a clock-in / clock-out
async function getBusinessDateAndSchedule(employeeId, now = new Date()) {
  const timezone = 'Asia/Manila';

  // Get current date string in Manila timezone
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone });
  const todayDate = new Date(todayStr);

  const yesterdayDate = new Date(todayDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

  // Fetch the employee's schedule and grace period
  const scheduleRes = await pool.query(
    `SELECT wsd.day_of_week, wsd.is_working, wsd.start_time, wsd.end_time, ws.grace_period_minutes
     FROM employees e
     JOIN work_schedules ws ON e.work_schedule_id = ws.id
     JOIN work_schedule_days wsd ON ws.id = wsd.work_schedule_id
     WHERE e.id = $1`,
    [employeeId]
  );

  const schedule = {};
  scheduleRes.rows.forEach(r => {
    schedule[r.day_of_week] = r;
  });

  const getScheduleForDate = (dateStr) => {
    const d = new Date(dateStr);
    const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = DAYS_OF_WEEK[d.getDay()];
    if (schedule[dayName]) {
      return schedule[dayName];
    }
    // If schedule data missing, treat as non-working to avoid incorrect defaults
    return {
      day_of_week: dayName,
      is_working: false,
      start_time: null,
      end_time: null,
      grace_period_minutes: 0
    };
  };

  const getShiftWindow = (dateStr, sched) => {
    if (!sched.is_working || !sched.start_time || !sched.end_time) return null;
    
    // Ensure times have seconds
    const startTime = sched.start_time.includes(':') && sched.start_time.split(':').length === 2 ? `${sched.start_time}:00` : sched.start_time;
    const endTime = sched.end_time.includes(':') && sched.end_time.split(':').length === 2 ? `${sched.end_time}:00` : sched.end_time;

    const expectedStart = new Date(`${dateStr}T${startTime}+08:00`);
    const expectedEnd = new Date(`${dateStr}T${endTime}+08:00`);
    if (startTime > endTime) {
      // Overnight shift
      expectedEnd.setDate(expectedEnd.getDate() + 1);
    }

    // Shift window starts 4 hours before expectedStart and ends 4 hours after expectedEnd
    const windowStart = new Date(expectedStart.getTime() - 4 * 60 * 60 * 1000);
    const windowEnd = new Date(expectedEnd.getTime() + 4 * 60 * 60 * 1000);

    return { expectedStart, expectedEnd, windowStart, windowEnd };
  };

  // 1. Check if now falls within yesterday's overnight shift window
  const schedYesterday = getScheduleForDate(yesterdayStr);
  const windowYesterday = getShiftWindow(yesterdayStr, schedYesterday);
  if (windowYesterday && now >= windowYesterday.windowStart && now <= windowYesterday.windowEnd) {
    return {
      businessDateStr: yesterdayStr,
      scheduleDay: schedYesterday,
      shiftTimes: windowYesterday
    };
  }

  // 2. Check if now falls within today's shift window
  const schedToday = getScheduleForDate(todayStr);
  const windowToday = getShiftWindow(todayStr, schedToday);
  if (windowToday && now >= windowToday.windowStart && now <= windowToday.windowEnd) {
    return {
      businessDateStr: todayStr,
      scheduleDay: schedToday,
      shiftTimes: windowToday
    };
  }

  // 3. Fallback to today
  return {
    businessDateStr: todayStr,
    scheduleDay: schedToday,
    shiftTimes: windowToday || {
      expectedStart: null,
      expectedEnd: null,
      windowStart: null,
      windowEnd: null
    }
  };
}

// Sync function to generate Absent and On Leave logs
async function syncEmployeeAttendance(employeeId) {
  try {
    const empRes = await pool.query(
      `SELECT e.status, e.work_schedule_id, er.hire_date
       FROM employees e
       LEFT JOIN employment_records er ON er.employee_id = e.id AND er.end_date IS NULL
       WHERE e.id = $1
       LIMIT 1`,
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
    
    // Fetch work schedule details + time_out_grace_minutes
    const scheduleRes = await pool.query(
      `SELECT wsd.day_of_week, wsd.is_working, wsd.start_time, wsd.end_time,
              COALESCE(ws.time_out_grace_minutes, 60) AS time_out_grace_minutes
       FROM work_schedule_days wsd
       JOIN work_schedules ws ON wsd.work_schedule_id = ws.id
       WHERE wsd.work_schedule_id = $1`,
      [empRes.rows[0].work_schedule_id]
    );
    const schedule = {};
    let timeOutGraceMinutes = 60;
    scheduleRes.rows.forEach(r => {
      schedule[r.day_of_week] = r;
      timeOutGraceMinutes = r.time_out_grace_minutes;
    });
 
    const getScheduleForDate = (d) => {
      const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = DAYS_OF_WEEK[d.getDay()];
      if (schedule[dayName]) return schedule[dayName];
      return {
        day_of_week: dayName,
        is_working: false,
        start_time: null,
        end_time: null,
        time_out_grace_minutes: 60
      };
    };
    
    // Fetch existing logs
    const logsRes = await pool.query(
      `SELECT id, log_date::text, flag, time_in, time_out, day_type, attendance_status 
       FROM attendance_logs 
       WHERE employee_id = $1 AND log_date BETWEEN $2 AND $3`,
      [employeeId, startDateStr, todayStrParam]
    );
    const existingLogs = {};
    logsRes.rows.forEach(r => {
      existingLogs[r.log_date.substring(0, 10)] = r;
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
 
    // Fetch calendar holidays
    const holidaysRes = await pool.query(
      `SELECT e.start_datetime::date as start_date, e.end_datetime::date as end_date,
              e.is_non_working_day AS event_override, et.is_non_working_day AS type_default
       FROM events e
       JOIN event_types et ON e.event_type_id = et.id
       WHERE e.is_active = true AND et.is_active = true
         AND NOT (e.end_datetime::date < $1 OR e.start_datetime::date > $2)`,
      [startDateStr, todayStrParam]
    );
 
    const checkHoliday = (date) => {
      const d = new Date(date.toISOString().split('T')[0]);
      const matches = holidaysRes.rows.filter(h => {
        const start = new Date(h.start_date);
        const end = new Date(h.end_date);
        return d >= start && d <= end;
      });
      if (matches.length === 0) return false;
 
      const hasForceTrue = matches.some(m => m.event_override === true);
      if (hasForceTrue) return true;
 
      const hasForceFalse = matches.some(m => m.event_override === false);
      if (hasForceFalse) return false;
 
      return matches.some(m => m.type_default === true);
    };
    
    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const isToday = dateStr === todayStrParam;
      const log = existingLogs[dateStr];
      
      const leave = getApprovedLeave(d);
      const isHoliday = checkHoliday(d);
      const schedDay = getScheduleForDate(d);
      
      let dayType = 'Regular Working Day';
      let attendanceStatus = null;
      let flag = 'Pending';
      
      if (leave) {
        dayType = 'Regular Working Day';
        attendanceStatus = 'On Leave';
        flag = 'On Leave';
      } else if (isHoliday) {
        dayType = 'Non-Working Holiday';
        attendanceStatus = null;
        flag = 'Holiday';
      } else if (!schedDay.is_working) {
        dayType = 'Rest Day';
        attendanceStatus = null;
        flag = 'Rest Day';
      } else {
        dayType = 'Regular Working Day';
        
        const hasTimeIn = log && log.time_in;
        const hasTimeOut = log && log.time_out;
        
        const nowManila = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
        let shiftEnded = !isToday;
        let timeOutGraceEnded = !isToday;
        
        if (isToday && schedDay.end_time) {
          const [sh, sm] = (schedDay.start_time || '00:00').split(':').map(Number);
          const [eh, em] = schedDay.end_time.split(':').map(Number);
          const isOvernight = sh > eh || (sh === eh && sm > em);
          const grace = schedDay.time_out_grace_minutes || 60;
          
          const shiftEnd = new Date(today);
          if (isOvernight) shiftEnd.setDate(shiftEnd.getDate() + 1);
          shiftEnd.setHours(eh, em, 0, 0);
          shiftEnded = nowManila > shiftEnd;
          
          const graceEnd = new Date(today);
          if (isOvernight) graceEnd.setDate(graceEnd.getDate() + 1);
          graceEnd.setHours(eh, em + grace, 0, 0);
          timeOutGraceEnded = nowManila > graceEnd;
        }
        
        if (hasTimeIn) {
          if (!hasTimeOut && timeOutGraceEnded) {
            flag = 'Late Time Out';
            attendanceStatus = 'Late Time Out';
          }
        } else if (shiftEnded) {
          flag = 'Absent';
          attendanceStatus = 'Absent';
        }
        // else: still pending — flag stays NULL (blank)
      }
      
      // ─── Upsert the attendance log ───
      
      if (!log) {
        // Always insert a placeholder for any day (including today).
        await pool.query(
          `INSERT INTO attendance_logs (employee_id, log_date, source, flag, day_type, attendance_status, remarks) 
           VALUES ($1, $2, 'System', $3, $4, $5, $6)`,
          [employeeId, dateStr, flag, dayType, attendanceStatus, leave ? `Approved Leave: ${leave.name}` : null]
        );
      } else {
        if (!log.time_in) {
          // If a log exists without time_in, sync details
          if (log.flag !== flag || log.day_type !== dayType || log.attendance_status !== attendanceStatus) {
            await pool.query(
              `UPDATE attendance_logs 
               SET flag = $1, day_type = $2, attendance_status = $3, remarks = $4, updated_at = NOW() 
               WHERE id = $5`,
              [flag, dayType, attendanceStatus, leave ? `Approved Leave: ${leave.name}` : null, log.id]
            );
          }
        } else {
          // Log has time_in — sync day_type and apply Late Time Out if past grace
          let finalDayType = 'Regular Working Day';
          if (isHoliday) {
            finalDayType = 'Non-Working Holiday';
          } else if (!schedDay.is_working) {
            finalDayType = 'Rest Day';
          }
          
          const needsDayTypeUpdate = log.day_type !== finalDayType;
          const needsLateTimeOut = flag === 'Late Time Out' && log.flag !== 'Late Time Out' && !log.time_out;
          
          if (needsDayTypeUpdate || needsLateTimeOut) {
            const setClauses = [];
            const values = [];
            let paramIdx = 1;
            
            if (needsDayTypeUpdate) {
              setClauses.push(`day_type = $${paramIdx++}`);
              values.push(finalDayType);
            }
            if (needsLateTimeOut) {
              setClauses.push(`flag = $${paramIdx++}`);
              values.push('Late Time Out');
              setClauses.push(`attendance_status = $${paramIdx++}`);
              values.push('Late Time Out');
            }
            
            setClauses.push(`updated_at = NOW()`);
            values.push(log.id);
            
            await pool.query(
              `UPDATE attendance_logs SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
              values
            );
          }
        }
      }
    }
  } catch (err) {
    console.error(`[syncEmployeeAttendance] Error for employee ${employeeId}:`, err.message);
  }
}

// GET all attendance logs
router.get('/', auth, authorize('attendance', 'view'), async (req, res) => {
  try {
    // Sync active employees
    const activeEmps = await query("SELECT id FROM employees WHERE status = 'Active'");
    for (const emp of activeEmps.rows) {
      await syncEmployeeAttendance(emp.id);
    }

    const result = await query(
      `SELECT al.*, 
              e.first_name, e.last_name, e.employee_no,
              COALESCE(ot.planned_hours, 0) AS approved_ot_hours
       FROM attendance_logs al
       JOIN employees e ON al.employee_id = e.id
       LEFT JOIN overtime_requests ot 
         ON al.employee_id = ot.employee_id
         AND al.log_date::date = ot.ot_date::date
         AND ot.status = 'Approved'
       ORDER BY al.log_date DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET attendance by employee
router.get('/employee/:id', auth, authorize('attendance', 'view'), async (req, res) => {
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

// GET attendance summary for payslip generation
router.get('/summary', auth, authorize('attendance', 'view'), async (req, res) => {
  try {
    const { employee_id, start_date, end_date } = req.query;
 
    if (!employee_id || !start_date || !end_date) {
      return res.status(400).json({
        message: 'employee_id, start_date, and end_date are required'
      });
    }
 
    // Step 1: Get attendance stats from attendance_logs
    const attendanceRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE time_in IS NOT NULL AND day_type = 'Regular Working Day'
        ) AS days_worked,
        COUNT(*) FILTER (WHERE attendance_status = 'Absent')    AS days_absent,
        COUNT(*) FILTER (WHERE flag = 'Holiday')   AS days_holiday,
        COALESCE(SUM(late_mins), 0) AS late_mins_total,
        COALESCE(SUM(undertime_mins), 0) AS undertime_mins_total
      FROM attendance_logs
      WHERE employee_id = $1
        AND log_date >= $2
        AND log_date <= $3
    `, [employee_id, start_date, end_date]);
 
    // Step 2: Get APPROVED leave days
    const leaveRes = await pool.query(`
      SELECT COALESCE(SUM(total_days), 0) AS total_leave_days
      FROM leave_requests
      WHERE employee_id = $1
        AND status = 'Approved'
        AND NOT (end_date < $2 OR start_date > $3)
    `, [employee_id, start_date, end_date]);
 
    // Step 3: Get APPROVED OT hours
    const otRes = await pool.query(`
      SELECT COALESCE(SUM(planned_hours), 0) AS total_ot_hours
      FROM overtime_requests
      WHERE employee_id = $1
        AND status = 'Approved'
        AND ot_date BETWEEN $2 AND $3
    `, [employee_id, start_date, end_date]);
 
    // Step 4: Get compensation rates
    const compRes = await pool.query(`
      SELECT daily_rate, hourly_rate
      FROM compensation_records
      WHERE employee_id = $1 AND end_date IS NULL
      ORDER BY effective_date DESC LIMIT 1
    `, [employee_id]);
 
    // Parse results
    const attRow = attendanceRes.rows[0] || {};
    const leaveRow = leaveRes.rows[0] || {};
    const otRow = otRes.rows[0] || {};
    const comp = compRes.rows[0] || {};
 
    const dailyRate  = parseFloat(comp.daily_rate)  || 0;
    const hourlyRate = parseFloat(comp.hourly_rate) || 0;
 
    const daysWorked    = parseInt(attRow.days_worked) || 0;
    const daysAbsent    = parseInt(attRow.days_absent) || 0;
    const daysLeave     = parseFloat(leaveRow.total_leave_days) || 0;
    const daysHoliday   = parseInt(attRow.days_holiday) || 0;
    const lateMins      = parseInt(attRow.late_mins_total) || 0;
    const undertimeMins = parseInt(attRow.undertime_mins_total) || 0;
    const otHours       = parseFloat(otRow.total_ot_hours) || 0;
 
    // Calculate pay values
    const overtimePay   = (otHours * hourlyRate * 1.25).toFixed(2);
    const holidayPay    = (daysHoliday * dailyRate).toFixed(2);
    const lateDeduction = ((lateMins / 60) * hourlyRate).toFixed(2);
    const undertimeDeduction = ((undertimeMins / 60) * hourlyRate).toFixed(2);
    const absentDeduction = (daysAbsent * dailyRate).toFixed(2);
 
    res.json({
      days_worked:      daysWorked,
      days_absent:      daysAbsent,
      days_leave:       daysLeave,
      days_holiday:     daysHoliday,
      ot_hours:         otHours,
      late_mins_total:  lateMins,
      undertime_mins_total: undertimeMins,  
      overtime_pay:     overtimePay,
      holiday_pay:      holidayPay,
      late_deduction:   lateDeduction,
      undertime_deduction: undertimeDeduction, 
      absent_deduction: absentDeduction,
    });
  } catch (err) {
    console.error('Attendance summary error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET monthly summary
router.get('/summary/:employee_id', auth, authorize('attendance', 'view'), async (req, res) => {
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
  const now = new Date();

  try {
    const { businessDateStr, scheduleDay, shiftTimes } = await getBusinessDateAndSchedule(employee_id, now);

    // Check if already timed in today for this business date
    const existing = await query(
      'SELECT * FROM attendance_logs WHERE employee_id = $1 AND log_date = $2',
      [employee_id, businessDateStr]
    );

    if (existing.rows.length > 0 && existing.rows[0].time_in) {
      return res.status(400).json({ message: 'Already timed in today!' });
    }

    if (existing.rows.length > 0 && existing.rows[0].flag === 'Absent') {
      return res.status(400).json({ message: 'Absent' });
    }

    // ── Early time-in window: allow up to 1 hour before shift start ──
    if (shiftTimes.expectedStart) {
      const earlyWindow = new Date(shiftTimes.expectedStart);
      earlyWindow.setHours(earlyWindow.getHours() - 1);
      if (now < earlyWindow) {
        return res.status(400).json({ message: 'Too early. Time-in opens 1 hour before your shift.' });
      }
    }

    const isHoliday = await checkHolidayOnDate(businessDateStr);
    let dayType = 'Regular Working Day';
    if (isHoliday) {
      dayType = 'Non-Working Holiday';
    } else if (!scheduleDay.is_working) {
      dayType = 'Rest Day';
    }

    let attendanceStatus = 'Present';
    let flag = 'On Time';
    let late_mins = 0;

    // Only calculate late minutes if it is a scheduled working day and NOT a holiday
    if (scheduleDay.is_working && !isHoliday && shiftTimes.expectedStart) {
      const gracePeriod = scheduleDay.grace_period_minutes || 0;
      const diffMins = Math.floor((now - shiftTimes.expectedStart) / 60000);

      if (diffMins > gracePeriod) {
        attendanceStatus = 'Late';
        flag = 'Late';
        late_mins = diffMins - gracePeriod;
      }
    }

    if (existing.rows.length > 0) {
      const result = await query(
        `UPDATE attendance_logs 
         SET time_in = $1,
             source = 'System',
             flag = $2,
             attendance_status = $3,
             day_type = $4,
             late_mins = $5,
             updated_at = NOW()
         WHERE id = $6 
         RETURNING *`,
        [now, flag, attendanceStatus, dayType, late_mins, existing.rows[0].id]
      );
      res.json(result.rows[0]);
    } else {
      const result = await query(
        `INSERT INTO attendance_logs 
          (employee_id, log_date, time_in, source, flag, attendance_status, day_type, late_mins) 
         VALUES ($1, $2, $3, 'System', $4, $5, $6, $7) 
         RETURNING *`,
        [employee_id, businessDateStr, now, flag, attendanceStatus, dayType, late_mins]
      );
      res.json(result.rows[0]);
    }
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// TIME OUT
router.put('/time-out/:id', auth, async (req, res) => {
  try {
    const logRes = await query(
      'SELECT * FROM attendance_logs WHERE id = $1',
      [req.params.id]
    );

    if (logRes.rows.length === 0) {
      return res.status(404).json({ message: 'Attendance log not found!' });
    }

    const log = logRes.rows[0];
    if (log.time_out) {
      return res.status(400).json({ message: 'Already timed out!' });
    }

    const timeIn = new Date(log.time_in);
    const now = new Date();
    
    // Fetch the employee's schedule details FIRST (need it before computing hours)
    const logDateStr = new Date(log.log_date).toISOString().split('T')[0];
    const { scheduleDay, shiftTimes } = await getBusinessDateAndSchedule(log.employee_id, timeIn);
    
    // Cap effective start at scheduled start — early clock-ins don't earn extra paid hours
    const effectiveStart = (shiftTimes.expectedStart && timeIn < shiftTimes.expectedStart)
      ? shiftTimes.expectedStart
      : timeIn;
    
    // Cap effective end at scheduled end — late clock-outs beyond shift don't earn extra hours
    // unless covered by an approved OT request (handled separately, not here)
    const effectiveEnd = (shiftTimes.expectedEnd && now > shiftTimes.expectedEnd)
      ? shiftTimes.expectedEnd
      : now;
    
    const hoursWorked = effectiveEnd > effectiveStart
      ? ((effectiveEnd - effectiveStart) / 3600000).toFixed(2)
      : '0.00';

    let undertimeMins = 0;
    let attendanceStatus = log.attendance_status || 'Present';
    let flag = log.flag || 'On Time';

    const isHoliday = log.day_type === 'Non-Working Holiday';

    if (scheduleDay.is_working && !isHoliday && shiftTimes.expectedEnd) {
      const diffMins = Math.floor((shiftTimes.expectedEnd - now) / 60000);
      if (diffMins > 0) {
        undertimeMins = diffMins;
        if (attendanceStatus !== 'Late' && flag !== 'Late') {
          attendanceStatus = 'Undertime';
          flag = 'Undertime';
        }
      }
    }

    const result = await query(
      `UPDATE attendance_logs 
       SET time_out = $1,
           hours_worked = $2,
           undertime_mins = $3,
           attendance_status = $4,
           flag = $5,
           updated_at = NOW()
       WHERE id = $6 
       RETURNING *`,
      [now, hoursWorked, undertimeMins, attendanceStatus, flag, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ADJUST attendance log (manually by admin)
router.put('/:id/adjust', auth, authorize('attendance', 'edit'), async (req, res) => {
  const { time_in, time_out, remarks, adjustment_reason } = req.body;
  const adjusted_by = req.user.id;

  try {
    // Fetch the current log — cast log_date to text so pg returns 'YYYY-MM-DD'
    // without the UTC midnight shift that turns '2026-06-15' into '2026-06-14T16:00:00Z'
    const logRes = await query(
      'SELECT *, log_date::text AS log_date_str FROM attendance_logs WHERE id = $1',
      [req.params.id]
    );
    if (!logRes.rows[0]) {
      return res.status(404).json({ message: 'Attendance log not found!' });
    }
    const currentLog = logRes.rows[0];

    // log_date_str is already 'YYYY-MM-DD' — no timezone conversion needed
    const logDateStr = currentLog.log_date_str.substring(0, 10);

    // Check approved leave on this date
    const leavesRes = await pool.query(
      `SELECT lt.name as leave_type_name
       FROM leave_requests lr
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       WHERE lr.employee_id = $1 AND lr.status = 'Approved' 
         AND $2::date BETWEEN lr.start_date AND lr.end_date
       LIMIT 1`,
      [currentLog.employee_id, logDateStr]
    );
    const hasApprovedLeave = leavesRes.rows.length > 0;
    const approvedLeaveName = hasApprovedLeave ? leavesRes.rows[0].leave_type_name : null;

    // Check holiday on this date
    const isHoliday = await checkHolidayOnDate(logDateStr);

    // Fetch employee schedule
    const schedRes = await pool.query(
      `SELECT wsd.day_of_week, wsd.is_working, wsd.start_time, wsd.end_time, ws.grace_period_minutes
       FROM employees e
       JOIN work_schedules ws ON e.work_schedule_id = ws.id
       JOIN work_schedule_days wsd ON ws.id = wsd.work_schedule_id
       WHERE e.id = $1`,
      [currentLog.employee_id]
    );

    const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    // Use 'T00:00:00' (no timezone suffix) so the Date is created in local time,
    // preventing a UTC-midnight shift that would land on the wrong weekday.
    const logDayDate = new Date(logDateStr + 'T00:00:00');
    const dayName = DAYS_OF_WEEK[logDayDate.getDay()];

    let scheduleDay = schedRes.rows.find(r => r.day_of_week === dayName);
    if (!scheduleDay) {
      scheduleDay = {
        day_of_week: dayName,
        is_working: false,
        start_time: null,
        end_time: null,
        grace_period_minutes: 0
      };
    }

    let expectedStart = null;
    let expectedEnd = null;
    if (scheduleDay.is_working && scheduleDay.start_time && scheduleDay.end_time) {
      const startTime = scheduleDay.start_time.includes(':') && scheduleDay.start_time.split(':').length === 2 ? `${scheduleDay.start_time}:00` : scheduleDay.start_time;
      const endTime = scheduleDay.end_time.includes(':') && scheduleDay.end_time.split(':').length === 2 ? `${scheduleDay.end_time}:00` : scheduleDay.end_time;

      expectedStart = new Date(`${logDateStr}T${startTime}+08:00`);
      expectedEnd = new Date(`${logDateStr}T${endTime}+08:00`);
      if (startTime > endTime) {
        // Overnight shift
        expectedEnd.setDate(expectedEnd.getDate() + 1);
      }
    }

    const finalTimeIn = (time_in && !isNaN(new Date(time_in).getTime())) ? new Date(time_in) : null;
    const finalTimeOut = (time_out && !isNaN(new Date(time_out).getTime())) ? new Date(time_out) : null;
    
    let hoursWorked = null;
    if (finalTimeIn && finalTimeOut) {
      const effIn = (expectedStart && finalTimeIn < expectedStart) ? expectedStart : finalTimeIn;
      const effOut = (expectedEnd && finalTimeOut > expectedEnd) ? expectedEnd : finalTimeOut;
      hoursWorked = effOut > effIn ? ((effOut - effIn) / 3600000).toFixed(2) : '0.00';
    }

    let dayType = 'Regular Working Day';
    let attStatus = null;
    let flag = 'On Time';
    let late_mins = 0;
    let undertime_mins = 0;

    if (!finalTimeIn) {
      // Case A: Absent / On Leave / Holiday / Rest Day
      if (hasApprovedLeave) {
        dayType = 'Regular Working Day';
        attStatus = 'On Leave';
        flag = 'On Leave';
      } else if (isHoliday) {
        dayType = 'Non-Working Holiday';
        attStatus = null;
        flag = 'Holiday';
      } else if (!scheduleDay.is_working) {
        dayType = 'Rest Day';
        attStatus = null;
        flag = 'Rest Day';
      } else {
        dayType = 'Regular Working Day';
        attStatus = 'Absent';
        flag = 'Absent';
      }
    } else {
      // Case B: Present
      if (isHoliday) {
        dayType = 'Non-Working Holiday';
        attStatus = 'Present';
        flag = 'On Time';
      } else if (!scheduleDay.is_working) {
        dayType = 'Rest Day';
        attStatus = 'Present';
        flag = 'On Time';
      } else {
        dayType = 'Regular Working Day';
        
        // Calculate late minutes
        if (expectedStart) {
          const gracePeriod = scheduleDay.grace_period_minutes || 0;
          const diffMins = Math.floor((finalTimeIn - expectedStart) / 60000);
          if (diffMins > gracePeriod) {
            late_mins = diffMins - gracePeriod;
          }
        }

        // Calculate undertime minutes
        if (finalTimeOut && expectedEnd) {
          const diffEnd = Math.floor((expectedEnd - finalTimeOut) / 60000);
          if (diffEnd > 0) {
            undertime_mins = diffEnd;
          }
        }

        // Determine flag and status
        if (late_mins > 0) {
          flag = 'Late';
          attStatus = 'Late';
        } else if (undertime_mins > 0) {
          flag = 'Undertime';
          attStatus = 'Undertime';
        } else {
          flag = 'On Time';
          attStatus = 'Present';
        }
      }
    }

    let finalRemarks = remarks;
    if (!finalRemarks && !finalTimeIn && hasApprovedLeave) {
      finalRemarks = `Approved Leave: ${approvedLeaveName}`;
    }

    const result = await query(
      `UPDATE attendance_logs 
       SET time_in = $1,
           time_out = $2,
           flag = $3,
           day_type = $4,
           attendance_status = $5,
           remarks = $6,
           adjustment_reason = $7,
           is_adjusted = true,
           adjusted_by = $8,
           adjusted_at = NOW(),
           hours_worked = $9,
           late_mins = $10,
           undertime_mins = $11,
           updated_at = NOW()
       WHERE id = $12 
       RETURNING *`,
      [
        finalTimeIn ? (time_in || null) : null,
        finalTimeIn && finalTimeOut ? (time_out || null) : null,
        flag,
        dayType,
        attStatus,
        finalRemarks || '',
        adjustment_reason || '',
        adjusted_by,
        hoursWorked,
        late_mins,
        undertime_mins,
        req.params.id
      ]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Attendance log not found!' });
    }

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



