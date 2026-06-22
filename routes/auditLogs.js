const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// GET audit logs — with pagination, filters, full data
router.get('/', auth, authorize('audit_logs', 'view'), async (req, res) => {
  try {
    const {
      action, table, userId, dateFrom, dateTo,
      page = 1, limit = 50,
    } = req.query;

    const queryParams = [];
    const conditions = [];

    // Super Admin sees all logs; Admins see own logs + employee logs + system logs
    if (req.user.role !== 'Super Admin') {
      queryParams.push(req.user.id);
      const ownIdx = queryParams.length;
      conditions.push(`(al.user_id = $${ownIdx} OR al.user_id IN (SELECT id FROM users WHERE role = 'Employee') OR al.user_id IS NULL)`);
    }

    if (action && action !== 'All Actions') {
      queryParams.push(action);
      conditions.push(`al.action = $${queryParams.length}`);
    }

    if (table && table !== 'All Tables') {
      queryParams.push(table);
      conditions.push(`al.table_name = $${queryParams.length}`);
    }

    if (userId) {
      queryParams.push(userId);
      conditions.push(`al.user_id = $${queryParams.length}`);
    }

    if (dateFrom) {
      queryParams.push(dateFrom);
      conditions.push(`al.created_at >= $${queryParams.length}::timestamptz`);
    }

    if (dateTo) {
      queryParams.push(dateTo + 'T23:59:59Z');
      conditions.push(`al.created_at <= $${queryParams.length}::timestamptz`);
    }

    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM audit_logs al${whereClause}`,
      queryParams
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const dataResult = await pool.query(
      `SELECT al.id,
              'AUD-' || al.id AS "refId",
              al.user_id AS "userId",
              al.employee_id AS "employeeId",
              COALESCE(e.first_name || ' ' || e.last_name, u.username) AS "user",
              al.action,
               al.table_name AS "table",
               al.record_id AS "recordId",
               al.old_values,
              al.new_values,
              al.changed_fields,
              al.remarks,
              TO_CHAR(al.created_at AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY HH:MI AM') AS "performedAt",
              al.created_at AS "createdAt"
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       LEFT JOIN employees e ON e.user_id = al.user_id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`,
      [...queryParams, limitNum, offset]
    );

    const cleaned = dataResult.rows.map(row => {
      if (row.performedAt) {
        row.performedAt = row.performedAt.replace(/\s+/g, ' ').trim();
      }
      return row;
    });

    res.json({ logs: cleaned, total, page: pageNum, limit: limitNum });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
