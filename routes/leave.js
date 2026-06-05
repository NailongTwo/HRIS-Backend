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
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// APPROVE/REJECT leave request — auto-notifies employee
router.put('/:id/status', auth, async (req, res) => {
  const { status, approval_remarks } = req.body;
  const approved_by = req.user.id;
  try {
    const result = await query(
      `UPDATE leave_requests 
       SET status = $1, approval_remarks = $2, approved_by = $3, approved_at = NOW()
       WHERE id = $4
       RETURNING *, 
         (SELECT name FROM leave_types WHERE id = leave_requests.leave_type_id) AS leave_type_name`,
      [status, approval_remarks, approved_by, req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Leave request not found!' });
    }
    const lr = result.rows[0];
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
    res.status(500).json({ message: 'Server error', error: err.message });
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

module.exports = router;