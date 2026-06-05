const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const query = require('../config/queryWithRetry');
const auth = require('../middleware/auth');

// ─── Helper: fire-and-forget notification insert ──────────────────────────────
// Silently fails so a notification error never breaks the main response.
async function notify({ recipientId, type, title, message, entityType, entityId }) {
  if (!recipientId) return;
  try {
    await query(
      `INSERT INTO notifications (recipient_id, type, title, message, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [recipientId, type, title, message, entityType, entityId]
    );
  } catch (err) {
    console.warn('[notify] Failed to insert notification:', err.message);
  }
}

// ─── Helper: get user_id from employee_id ─────────────────────────────────────
async function getUserIdByEmployee(employeeId) {
  try {
    const r = await query('SELECT user_id FROM employees WHERE id = $1', [employeeId]);
    return r.rows[0]?.user_id || null;
  } catch {
    return null;
  }
}

// GET all overtime requests - with employee details
router.get('/', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT ot.*,
              e.first_name, e.last_name, e.employee_no
       FROM overtime_requests ot
       JOIN employees e ON ot.employee_id = e.id
       ORDER BY ot.submitted_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET overtime requests by employee
router.get('/employee/:id', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM overtime_requests 
       WHERE employee_id = $1 
       ORDER BY submitted_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET pending approvals - using the view
router.get('/pending', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM v_pending_approvals 
       WHERE request_type = 'overtime_request'
       ORDER BY submitted_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// FILE an overtime request
router.post('/', auth, async (req, res) => {
  const { employee_id, ot_date, day_type, planned_start, planned_end, planned_hours, reason, project_task } = req.body;

  try {
    const count = await query('SELECT COUNT(*) FROM overtime_requests');
    const refNo = `OT-${new Date().getFullYear()}-${String(parseInt(count.rows[0].count) + 1).padStart(3, '0')}`;

    let multiplier = 1.25;
    try {
      const policy = await query(
        `SELECT value FROM hr_policies WHERE key = $1`,
        [day_type === 'Regular Day'
          ? 'overtime.regular_day_multiplier'
          : day_type === 'Rest Day'
          ? 'overtime.rest_day_multiplier'
          : 'overtime.holiday_multiplier']
      );
      if (policy.rows[0]?.value) multiplier = parseFloat(policy.rows[0].value);
    } catch { /* hr_policies may not exist — use default 1.25 */ }

    const result = await query(
      `INSERT INTO overtime_requests 
        (reference_no, employee_id, ot_date, day_type, 
         planned_start, planned_end, planned_hours, 
         reason, project_task, status, ot_rate_multiplier) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending', $10) 
       RETURNING *`,
      [refNo, employee_id, ot_date, day_type || 'Regular Day',
       planned_start, planned_end, planned_hours,
       reason, project_task || null, multiplier]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('OT error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// APPROVE/REJECT overtime request — auto-notifies employee
router.put('/:id/status', auth, async (req, res) => {
  const { status, approval_remarks } = req.body;
  const approved_by = req.user.id;

  try {
    const result = await query(
      `UPDATE overtime_requests 
       SET status = $1, approval_remarks = $2, approved_by = $3, approved_at = NOW()
       WHERE id = $4 
       RETURNING *`,
      [status, approval_remarks, approved_by, req.params.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Overtime request not found!' });
    }

    const ot = result.rows[0];
    res.json(ot);

    // ── Fire-and-forget notification to the employee ──
    const recipientId = await getUserIdByEmployee(ot.employee_id);
    const isApproved = status === 'Approved';
    await notify({
      recipientId,
      type: 'Overtime',
      title: `Overtime Request ${status}`,
      message: `Your overtime request (${ot.reference_no}) for ${ot.ot_date} has been ${status.toLowerCase()}.${approval_remarks ? ' Remarks: ' + approval_remarks : ''}`,
      entityType: 'overtime_request',
      entityId: ot.id,
    });

  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CANCEL overtime request
router.put('/:id/cancel', auth, async (req, res) => {
  const { cancelled_reason } = req.body;

  try {
    const result = await query(
      `UPDATE overtime_requests 
       SET status = 'Cancelled', cancelled_reason = $1, cancelled_at = NOW()
       WHERE id = $2 
       RETURNING *`,
      [cancelled_reason, req.params.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Overtime request not found!' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;