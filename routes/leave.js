const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const query = require('../config/queryWithRetry');
const auth = require('../middleware/auth');

// ── Helper: silent fire-and-forget notification insert ────────────────────────
async function notify({ recipientId, type, title, message, entityType, entityId }) {
  if (!recipientId) return;
  try {
    await query(
      `INSERT INTO notifications (recipient_id, type, title, message, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [recipientId, type, title, message, entityType, entityId]
    );
  } catch (err) {
    console.warn('[notify] Failed:', err.message);
  }
}

// ── Helper: resolve employee_id → users.id ────────────────────────────────────
async function getUserIdByEmployee(employeeId) {
  try {
    const r = await query('SELECT user_id FROM employees WHERE id = $1', [employeeId]);
    return r.rows[0]?.user_id || null;
  } catch { return null; }
}

// ─── Helper: notify all admin-side users (non-Employee roles) ─────────────────
async function notifyAdmins({ type, title, message, entityType, entityId }) {
  try {
    const result = await query(
      `SELECT u.id FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name != 'Employee' AND r.status = 'Active'`
    );
    for (const row of result.rows) {
      await notify({
        recipientId: row.id,
        type,
        title,
        message,
        entityType,
        entityId,
      });
    }
  } catch (err) {
    console.warn('[notifyAdmins] Failed:', err.message);
  }
}


// GET all leave requests - with employee details
router.get('/', auth, async (req, res) => {
  try {
    const result = await query(
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

// GET all leave types
router.get('/types', auth, async (req, res) => {
  try {
    const result = await query(
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
    const result = await query(
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
    const result = await query(
      `SELECT * FROM v_leave_balance_current_year WHERE employee_id = $1`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// PUT allocate leave credits to all employees
router.put('/credits/allocate', auth, async (req, res) => {
  const { vl, sl, el, year = new Date().getFullYear() } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const empRes = await client.query("SELECT id FROM employees WHERE status = 'Active'");
    const employees = empRes.rows;

    const leaveTypes = {
      vl: '88124176-c41f-41eb-90f2-d25bd6f0bdb0',
      sl: 'b892e39f-97e8-4181-a83b-f981d5d39a12',
      el: '346c714d-09be-4402-b727-cdea5a9b03d1'
    };

    for (const emp of employees) {
      const updates = [
        { total: vl, typeId: leaveTypes.vl },
        { total: sl, typeId: leaveTypes.sl },
        { total: el, typeId: leaveTypes.el }
      ];

      for (const item of updates) {
        if (item.total === undefined) continue;
        await client.query(
          `INSERT INTO leave_credits (employee_id, leave_type_id, year, total_credits, used_credits, pending_credits)
           VALUES ($1, $2, $3, $4, 0, 0)
           ON CONFLICT (employee_id, leave_type_id, year) 
           DO UPDATE SET total_credits = EXCLUDED.total_credits`,
          [emp.id, item.typeId, year, item.total]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'Leave credits allocated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
});

// PUT update leave credits for a single employee
router.put('/credits/:employee_id', auth, async (req, res) => {
  const { employee_id } = req.params;
  const { vl, vlLeft, sl, slLeft, el, elLeft, year = new Date().getFullYear() } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const leaveTypes = {
      vl: '88124176-c41f-41eb-90f2-d25bd6f0bdb0',
      sl: 'b892e39f-97e8-4181-a83b-f981d5d39a12',
      el: '346c714d-09be-4402-b727-cdea5a9b03d1'
    };

    const updates = [
      { total: vl,  available: vlLeft, typeId: leaveTypes.vl },
      { total: sl,  available: slLeft, typeId: leaveTypes.sl },
      { total: el,  available: elLeft, typeId: leaveTypes.el }
    ];

    for (const item of updates) {
      if (item.total === undefined || item.available === undefined) continue;
      const used = item.total - item.available;
      await client.query(
        `INSERT INTO leave_credits (employee_id, leave_type_id, year, total_credits, used_credits, pending_credits)
         VALUES ($1, $2, $3, $4, $5, 0)
         ON CONFLICT (employee_id, leave_type_id, year) 
         DO UPDATE SET total_credits = EXCLUDED.total_credits, used_credits = $5`,
        [employee_id, item.typeId, year, item.total, used]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Leave credits updated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
});

// FILE a leave request
router.post('/', auth, async (req, res) => {
  const {
    employee_id, leave_type_id, start_date, end_date,
    total_days, is_half_day, half_day_period, reason, attachment_url
  } = req.body;

  try {
    const balance = await query(
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

    const count = await query('SELECT COUNT(*) FROM leave_requests');
    const refNo = `LV-${new Date().getFullYear()}-${String(parseInt(count.rows[0].count) + 1).padStart(3, '0')}`;

    const credit = await query(
      `SELECT id FROM leave_credits 
       WHERE employee_id = $1 
       AND leave_type_id = $2 
       AND year = EXTRACT(YEAR FROM NOW())`,
      [employee_id, leave_type_id]
    );

    const result = await query(
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
        // ── Fire-and-forget: notify all admin users about the new leave request ──
    const lr = result.rows[0];
    const empInfo = await query(
      `SELECT e.first_name, e.last_name, lt.name as leave_type_name
       FROM employees e, leave_types lt
       WHERE e.id = $1 AND lt.id = $2`,
      [employee_id, leave_type_id]
    );
    const empName = empInfo.rows[0]
      ? `${empInfo.rows[0].first_name} ${empInfo.rows[0].last_name}`
      : 'An employee';
    const leaveName = empInfo.rows[0]?.leave_type_name || 'Leave';
    const dateRange = start_date === end_date
      ? new Date(start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : `${new Date(start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    await notifyAdmins({
      type: 'Leave',
      title: 'New Leave Request',
      message: `${empName} submitted a ${leaveName} request (${lr.reference_no}) for ${dateRange} (${total_days} day${total_days > 1 ? 's' : ''}).`,
      entityType: 'leave_request',
      entityId: lr.id,
    });

  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// APPROVE/REJECT leave request — auto-notifies employee
router.put('/:id/status', auth, async (req, res) => {
  const { status, approval_remarks } = req.body;
  const approved_by = req.user.id;
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get current leave request info
    const currentRes = await client.query(
      `SELECT lr.*, lt.name AS leave_type_name, lt.code AS leave_code
       FROM leave_requests lr
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       WHERE lr.id = $1`,
      [req.params.id]
    );
    
    if (currentRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Leave request not found!' });
    }
    
    const lr = currentRes.rows[0];
    const oldStatus = lr.status;
    
    // ── Negative balance check (only on new approval) ──
    if (status === 'Approved' && oldStatus !== 'Approved') {
      const policyRes = await client.query(
        `SELECT lp.allow_negative_balance
         FROM leave_policies lp
         JOIN employment_records er ON er.employee_id = $2 AND er.end_date IS NULL
         WHERE lp.leave_type_id = $1 AND lp.employment_type = er.employment_type`,
        [lr.leave_type_id, lr.employee_id]
      );
      const allowNegative = policyRes.rows[0]?.allow_negative_balance === true;
      if (!allowNegative) {
        const balRes = await client.query(
          `SELECT (total_credits + carried_over - used_credits - pending_credits) AS remaining
           FROM leave_credits
           WHERE employee_id = $1 AND leave_type_id = $2 AND year = EXTRACT(YEAR FROM CURRENT_DATE)`,
          [lr.employee_id, lr.leave_type_id]
        );
        const remaining = Number(balRes.rows[0]?.remaining || 0);
        if (lr.total_days > remaining) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            message: `Insufficient credits. Remaining: ${remaining}, Requested: ${lr.total_days}`,
            available: remaining,
            requested: lr.total_days,
          });
        }
      }
    }
    
    // Update status
    const result = await client.query(
      `UPDATE leave_requests 
       SET status = $1, approval_remarks = $2, approved_by = $3, approved_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, approval_remarks, approved_by, req.params.id]
    );

    // Handle attendance log records
    if (status === 'Approved' && oldStatus !== 'Approved') {
      const start = new Date(lr.start_date);
      const end = new Date(lr.end_date);
      
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        
        // Only insert if no log exists, or update if it's currently marked as Absent
        const logCheck = await client.query(
          'SELECT id, flag FROM attendance_logs WHERE employee_id = $1 AND log_date = $2',
          [lr.employee_id, dateStr]
        );
        
        if (logCheck.rows.length === 0) {
          await client.query(
            `INSERT INTO attendance_logs (employee_id, log_date, source, flag, remarks) 
             VALUES ($1, $2, 'System', 'On Leave', $3)`,
            [lr.employee_id, dateStr, `Approved Leave: ${lr.leave_type_name}`]
          );
        } else if (logCheck.rows[0].flag === 'Absent') {
          await client.query(
            `UPDATE attendance_logs 
             SET flag = 'On Leave', remarks = $1 
             WHERE id = $2`,
            [`Approved Leave: ${lr.leave_type_name}`, logCheck.rows[0].id]
          );
        }
      }
    } else if (oldStatus === 'Approved' && status !== 'Approved') {
      const start = new Date(lr.start_date);
      const end = new Date(lr.end_date);
      
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        
        // Remove the On Leave flag (either delete System logs, or set back to Absent)
        await client.query(
          `DELETE FROM attendance_logs 
           WHERE employee_id = $1 AND log_date = $2 AND flag = 'On Leave'`,
          [lr.employee_id, dateStr]
        );
      }
    }

    // ── Write ledger entry on approval ──
    // The DB trigger already updated used_credits, so balanceAfter is the post-deduction balance
    if (status === 'Approved' && oldStatus !== 'Approved') {
      const balRes = await client.query(
        `SELECT (total_credits + carried_over - used_credits - pending_credits) AS balance
         FROM leave_credits
         WHERE employee_id = $1 AND leave_type_id = $2 AND year = EXTRACT(YEAR FROM CURRENT_DATE)`,
        [lr.employee_id, lr.leave_type_id]
      );
      const balanceAfter = Number(balRes.rows[0]?.balance || 0);
      await client.query(
        `INSERT INTO leave_ledger (employee_id, leave_type_id, transaction_type, amount, balance_after, remarks, performed_by, reference_id)
         VALUES ($1, $2, 'Usage', $3, $4, $5, $6, $7)`,
        [lr.employee_id, lr.leave_type_id, -(lr.total_days), balanceAfter,
         `Approved: ${lr.reference_no}`, approved_by, lr.id]
      );
    }

    await client.query('COMMIT');
    res.json(lr);

    // ── Fire-and-forget notification ──
    const recipientId = await getUserIdByEmployee(lr.employee_id);
    const dateRange = lr.start_date === lr.end_date
      ? new Date(lr.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : `${new Date(lr.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(lr.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    await notify({
      recipientId,
      type: 'Leave',
      title: `Leave Request ${status}`,
      message: `Your ${lr.leave_type_name || 'leave'} request (${lr.reference_no}) for ${dateRange} has been ${status.toLowerCase()}.${approval_remarks ? ' Remarks: ' + approval_remarks : ''}`,
      entityType: 'leave_request',
      entityId: lr.id,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
});

// CANCEL leave request
router.put('/:id/cancel', auth, async (req, res) => {
  try {
    const result = await query(
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
