const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// GET all document types
router.get('/types', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM document_types WHERE is_active = true ORDER BY name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all documents by employee
router.get('/employee/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ed.*, dt.name as document_type_name, dt.category
      FROM employee_documents ed
      JOIN document_types dt ON ed.document_type_id = dt.id
      WHERE ed.employee_id = $1 AND ed.is_current = true
      ORDER BY dt.name ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET single document
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ed.*, dt.name as document_type_name
      FROM employee_documents ed
      JOIN document_types dt ON ed.document_type_id = dt.id
      WHERE ed.id = $1`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPLOAD document
router.post('/', auth, async (req, res) => {
  const {
    employee_id,
    document_type_id,
    file_name,
    file_url,
    file_size_kb,
    mime_type,
    issued_date,
    expiry_date,
    uploaded_by
  } = req.body;

  try {
    // Get current version number
    const versionResult = await pool.query(
      `SELECT MAX(version) as max_version 
      FROM employee_documents 
      WHERE employee_id = $1 AND document_type_id = $2`,
      [employee_id, document_type_id]
    );

    const newVersion = (versionResult.rows[0].max_version || 0) + 1;

    const result = await pool.query(
      `INSERT INTO employee_documents 
      (employee_id, document_type_id, file_name, file_url, file_size_kb,
      mime_type, version, is_current, issued_date, expiry_date, 
      status, uploaded_by) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, 'Pending', $10) 
      RETURNING *`,
      [employee_id, document_type_id, file_name, file_url, file_size_kb,
      mime_type, newVersion, issued_date, expiry_date, uploaded_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE document status
router.put('/:id/status', auth, async (req, res) => {
  const { status, remarks, acknowledged_by } = req.body;

  try {
    const result = await pool.query(
      `UPDATE employee_documents 
      SET status = $1, remarks = $2, 
      acknowledged_by = $3, acknowledged_at = NOW()
      WHERE id = $4 
      RETURNING *`,
      [status, remarks, acknowledged_by, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ACKNOWLEDGE document
router.post('/:id/acknowledge', auth, async (req, res) => {
  const { employee_id, ip_address, user_agent } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO document_acknowledgements 
      (employee_id, document_id, ip_address, user_agent) 
      VALUES ($1, $2, $3, $4) 
      RETURNING *`,
      [employee_id, req.params.id, ip_address, user_agent]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;