const express = require('express');
const router = express.Router();
const auditRoute = require('../middleware/auditRoute');
router.use(auditRoute('document_types'));
const pool = require('../config/db');
const auth = require('../middleware/auth');
// GET all document requirements (document_types table)
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM document_types ORDER BY category ASC, name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE document requirement
router.post('/', auth, async (req, res) => {
  const { name, category, is_required, description } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO document_types (name, category, is_required, description, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING *`,
      [name, category, is_required ?? true, description || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ message: 'A document type with this name already exists.' });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE document requirement
router.put('/:id', auth, async (req, res) => {
  const { name, category, is_required, description, is_active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE document_types
       SET name        = COALESCE($1, name),
           category    = COALESCE($2, category),
           is_required = COALESCE($3, is_required),
           description = COALESCE($4, description),
           is_active   = COALESCE($5, is_active),
           updated_at  = NOW()
       WHERE id = $6
       RETURNING *`,
      [name, category, is_required, description, is_active, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document requirement not found.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ message: 'A document type with this name already exists.' });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;



