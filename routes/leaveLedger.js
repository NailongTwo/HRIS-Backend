const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const query = require('../config/queryWithRetry');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

async function getCurrentBalance(client, employeeId, leaveTypeId, year) {
  const res = await client.query(
    `SELECT COALESCE(total_credits + carried_over - used_credits - pending_credits, 0) AS balance
     FROM leave_credits
     WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
    [employeeId, leaveTypeId, year]
  );
  return res.rows[0] ? Number(res.rows[0].balance) : 0;
}

async function getUserIdByEmployee(employeeId) {
  try {
    const r = await query('SELECT user_id FROM employees WHERE id = $1', [employeeId]);
    return r.rows[0]?.user_id || null;
  } catch { return null; }
}

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

router.get('/employee/:id', auth, authorize('leave_ledger', 'view'), async (req, res) => {
  try {
    const result = await query(
      `SELECT ll.transaction_date, ll.transaction_type, ll.amount, ll.balance_after,
              ll.remarks, lt.code AS leave_code, lt.name AS leave_type_name,
              u.username AS performed_by_name
       FROM leave_ledger ll
       JOIN leave_types lt ON ll.leave_type_id = lt.id
       LEFT JOIN users u ON ll.performed_by = u.id
       WHERE ll.employee_id = $1
       ORDER BY ll.transaction_date DESC, ll.created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.get('/balance/:id', auth, authorize('leave_ledger', 'view'), async (req, res) => {
  try {
    const result = await query(
      `SELECT DISTINCT ON (ll.leave_type_id)
              ll.leave_type_id, lt.name AS leave_type_name, lt.code AS leave_code,
              ll.balance_after AS current_balance,
              lt.badge_bg_color, lt.badge_text_color
       FROM leave_ledger ll
       JOIN leave_types lt ON ll.leave_type_id = lt.id
       WHERE ll.employee_id = $1
         AND EXTRACT(YEAR FROM ll.transaction_date) = EXTRACT(YEAR FROM CURRENT_DATE)
       ORDER BY ll.leave_type_id, ll.transaction_date DESC, ll.created_at DESC`,
      [req.params.id]
    );
    const totalRemaining = result.rows.reduce((sum, r) => sum + Number(r.current_balance), 0);
    res.json({ balances: result.rows, totalRemaining });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.post('/allocate', auth, authorize('leave_ledger', 'edit'), async (req, res) => {
  const { employee_id, leave_type_id, credits, year, reason } = req.body;
  const performedBy = req.user.id;
  const yr = year || new Date().getFullYear();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const balanceBefore = await getCurrentBalance(client, employee_id, leave_type_id, yr);
    const balanceAfter = balanceBefore + Number(credits);

    await client.query(
      `INSERT INTO leave_credits (employee_id, leave_type_id, year, total_credits, used_credits, pending_credits)
       VALUES ($1, $2, $3, $4, 0, 0)
       ON CONFLICT (employee_id, leave_type_id, year)
       DO UPDATE SET total_credits = leave_credits.total_credits + $4, updated_at = NOW()`,
      [employee_id, leave_type_id, yr, credits]
    );

    await client.query(
      `INSERT INTO leave_ledger (employee_id, leave_type_id, transaction_type, amount, balance_after, remarks, performed_by)
       VALUES ($1, $2, 'Allocation', $3, $4, $5, $6)`,
      [employee_id, leave_type_id, credits, balanceAfter, reason || 'Manual allocation', performedBy]
    );

    await client.query('COMMIT');
    res.json({ message: 'Credits allocated', balanceBefore, balanceAfter, credits });

    const recipientId = await getUserIdByEmployee(employee_id);
    const lt = (await query('SELECT name FROM leave_types WHERE id = $1', [leave_type_id])).rows[0];
    await notify({
      recipientId, type: 'Leave',
      title: 'Leave Credits Allocated',
      message: `Allocated ${credits} ${lt?.name || ''} credits. Balance: ${balanceAfter}.`,
      entityType: 'leave_ledger',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally { client.release(); }
});

router.post('/allocate/bulk', auth, authorize('leave_ledger', 'edit'), async (req, res) => {
  const { target, department_id, leave_type_id, credits, year, employment_types, preview } = req.body;
  const performedBy = req.user.id;
  const yr = year || new Date().getFullYear();

  let empQuery = `SELECT e.id, e.first_name, e.last_name, e.employee_no, d.name AS dept
                  FROM employees e
                  JOIN employment_records er ON e.id = er.employee_id AND er.end_date IS NULL
                  JOIN departments d ON er.department_id = d.id
                  WHERE e.status = 'Active'`;
  const params = [];
  let idx = 0;

  if (target === 'department' && department_id) {
    params.push(department_id); idx++;
    empQuery += ` AND er.department_id = $${idx}`;
  }
  if (employment_types && employment_types.length > 0) {
    params.push(employment_types); idx++;
    empQuery += ` AND er.employment_type = ANY($${idx}::text[])`;
  }
  params.push(leave_type_id, yr);
  empQuery += ` AND e.id NOT IN (SELECT employee_id FROM leave_credits WHERE leave_type_id = $${idx + 1} AND year = $${idx + 2})`;

  try {
    const empRes = await query(empQuery, params);
    if (preview) return res.json({ employees: empRes.rows, count: empRes.rows.length });

    if (empRes.rows.length === 0)
      return res.json({ message: 'No eligible employees to allocate.', allocated: 0 });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const emp of empRes.rows) {
        const balanceAfter = (await getCurrentBalance(client, emp.id, leave_type_id, yr)) + Number(credits);
        await client.query(
          `INSERT INTO leave_credits (employee_id, leave_type_id, year, total_credits, used_credits, pending_credits)
           VALUES ($1, $2, $3, $4, 0, 0) ON CONFLICT (employee_id, leave_type_id, year)
           DO UPDATE SET total_credits = leave_credits.total_credits + $4, updated_at = NOW()`,
          [emp.id, leave_type_id, yr, credits]
        );
        await client.query(
          `INSERT INTO leave_ledger (employee_id, leave_type_id, transaction_type, amount, balance_after, remarks, performed_by)
           VALUES ($1, $2, 'Allocation', $3, $4, $5, $6)`,
          [emp.id, leave_type_id, credits, balanceAfter, `Bulk allocation`, performedBy]
        );
      }
      await client.query('COMMIT');
      res.json({ message: `Allocated to ${empRes.rows.length} employees.`, allocated: empRes.rows.length });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally { client.release(); }
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.post('/adjust', auth, authorize('leave_ledger', 'edit'), async (req, res) => {
  const { employee_id, leave_type_id, amount, year, remarks } = req.body;
  const performedBy = req.user.id;
  const yr = year || new Date().getFullYear();

  if (!remarks || remarks.trim().length < 3)
    return res.status(400).json({ message: 'A meaningful reason is required.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const balanceBefore = await getCurrentBalance(client, employee_id, leave_type_id, yr);
    const balanceAfter = balanceBefore + Number(amount);

    const credRes = await client.query(
      `UPDATE leave_credits SET total_credits = GREATEST(0, total_credits + $1), updated_at = NOW()
       WHERE employee_id = $2 AND leave_type_id = $3 AND year = $4 RETURNING total_credits`,
      [amount, employee_id, leave_type_id, yr]
    );
    if (!credRes.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'No credit record found. Allocate first.' });
    }

    await client.query(
      `INSERT INTO leave_ledger (employee_id, leave_type_id, transaction_type, amount, balance_after, remarks, performed_by)
       VALUES ($1, $2, 'Adjustment', $3, $4, $5, $6)`,
      [employee_id, leave_type_id, amount, balanceAfter, remarks, performedBy]
    );

    await client.query('COMMIT');
    res.json({ message: 'Adjustment applied', balanceBefore, balanceAfter, amount });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally { client.release(); }
});

router.post('/reset', auth, authorize('leave_ledger', 'edit'), async (req, res) => {
  const { employee_id, leave_type_id, year, remarks } = req.body;
  const performedBy = req.user.id;
  const yr = year || new Date().getFullYear();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const balanceBefore = await getCurrentBalance(client, employee_id, leave_type_id, yr);

    await client.query(
      `UPDATE leave_credits SET total_credits = 0, used_credits = 0, pending_credits = 0, updated_at = NOW()
       WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
      [employee_id, leave_type_id, yr]
    );

    await client.query(
      `INSERT INTO leave_ledger (employee_id, leave_type_id, transaction_type, amount, balance_after, remarks, performed_by)
       VALUES ($1, $2, 'Adjustment', $3, 0, $4, $5)`,
      [employee_id, leave_type_id, -balanceBefore, remarks || 'Balance reset', performedBy]
    );

    await client.query('COMMIT');
    res.json({ message: 'Balance reset', previousBalance: balanceBefore });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally { client.release(); }
});

router.post('/carry-over', auth, authorize('leave_ledger', 'edit'), async (req, res) => {
  const { fromYear } = req.body;
  const performedBy = req.user.id;
  const fromYr = fromYear || new Date().getFullYear() - 1;
  const toYr = fromYr + 1;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const eligible = await client.query(
      `SELECT lc.employee_id, lc.leave_type_id,
              (lc.total_credits + lc.carried_over - lc.used_credits - lc.pending_credits) AS remaining,
              lp.max_carry_over
       FROM leave_credits lc
       JOIN leave_policies lp ON lc.leave_type_id = lp.leave_type_id
         AND lp.employment_type = (SELECT employment_type FROM employment_records
           WHERE employee_id = lc.employee_id AND end_date IS NULL)
       WHERE lc.year = $1 AND lp.max_carry_over > 0`,
      [fromYr]
    );

    let count = 0;
    for (const row of eligible.rows) {
      const carryAmount = Math.min(Number(row.remaining), Number(row.max_carry_over));
      if (carryAmount <= 0) continue;

      await client.query(
        `INSERT INTO leave_credits (employee_id, leave_type_id, year, total_credits, carried_over)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (employee_id, leave_type_id, year)
         DO UPDATE SET total_credits = leave_credits.total_credits + $4,
                       carried_over = leave_credits.carried_over + $4`,
        [row.employee_id, row.leave_type_id, toYr, carryAmount]
      );

      const balance = await getCurrentBalance(client, row.employee_id, row.leave_type_id, toYr);
      await client.query(
        `INSERT INTO leave_ledger (employee_id, leave_type_id, transaction_type, amount, balance_after, remarks, performed_by)
         VALUES ($1, $2, 'CarryOver', $3, $4, $5, $6)`,
        [row.employee_id, row.leave_type_id, carryAmount, balance + carryAmount,
         `Carried over from ${fromYr}`, performedBy]
      );
      count++;
    }

    await client.query('COMMIT');
    res.json({ message: `Carry-over complete. ${count} records processed.`, processed: count });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally { client.release(); }
});

module.exports = router;
