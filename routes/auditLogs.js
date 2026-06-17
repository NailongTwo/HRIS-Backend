const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// GET audit logs
router.get('/', auth, authorize('audit_logs', 'view'), async (req, res) => {
  try {
    const { action, table } = req.query;
    
    let queryText = `
      SELECT al.id, 
             COALESCE(e.first_name || ' ' || e.last_name, u.username) AS user,
             al.action, 
             al.table_name AS table,
             al.record_id AS "recordId", 
             al.ip_address::text AS ip,
             TO_CHAR(al.created_at, 'Month DD, YYYY HH:MI AM') AS "performedAt",
             al.remarks
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      LEFT JOIN employees e ON e.user_id = al.user_id
    `;
    
    const queryParams = [];
    const conditions = [];
    
    if (action && action !== 'All Actions') {
      queryParams.push(action);
      conditions.push(`al.action = $${queryParams.length}`);
    }
    
    if (table && table !== 'All Tables') {
      queryParams.push(table);
      conditions.push(`al.table_name = $${queryParams.length}`);
    }
    
    if (conditions.length > 0) {
      queryText += ' WHERE ' + conditions.join(' AND ');
    }
    
    queryText += ' ORDER BY al.created_at DESC LIMIT 100';
    
    const result = await pool.query(queryText, queryParams);
    
    // Clean up performedAt formatting to match "March 2, 2026 5:38 PM"
    const cleaned = result.rows.map(row => {
      if (row.performedAt) {
        // Trim double spaces and fix month capitalization/spacing if any
        row.performedAt = row.performedAt.replace(/\s+/g, ' ').trim();
      }
      return row;
    });
    
    res.json(cleaned);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Helper to create an audit log from other routes
router.post('/', auth, authorize('audit_logs', 'create'), async (req, res) => {
  const { action, table_name, record_id, remarks, ip_address } = req.body;
  const userId = req.user.id;
  
  try {
    const result = await pool.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, remarks, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, action, table_name, record_id, remarks, ip_address || req.ip]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
