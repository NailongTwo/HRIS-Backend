const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const multer = require('multer');

// multer: memory storage — file buffer kept in req.file.buffer
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB cap
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF, JPG, and PNG files are allowed.'));
  }
});

// ─── GET all document types ────────────────────────────────────────────────────
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

// ─── GET all employee documents (admin view) ──────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const { employee_id, status, category } = req.query;
    let query = `
      SELECT ed.*,
             dt.name      AS document_type_name,
             dt.category,
             CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
             e.employee_no
      FROM employee_documents ed
      JOIN document_types dt ON ed.document_type_id = dt.id
      JOIN employees      e  ON ed.employee_id       = e.id
      WHERE ed.is_current = true
    `;
    const params = [];
    if (employee_id) {
      params.push(employee_id);
      query += ` AND ed.employee_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND ed.status = $${params.length}`;
    }
    if (category) {
      params.push(category);
      query += ` AND dt.category = $${params.length}`;
    }
    query += ' ORDER BY e.last_name ASC, dt.name ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ─── GET all documents by employee ────────────────────────────────────────────
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

// ─── GET single document ───────────────────────────────────────────────────────
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

// ─── UPLOAD document (multipart/form-data) ────────────────────────────────────
router.post('/upload', auth, upload.single('file'), async (req, res) => {
  try {
    const {
      employee_id,
      document_type_id,
      issued_date,
      expiry_date,
      uploaded_by
    } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'No file was uploaded.' });
    }

    // Encode file buffer as base64 data URI for storage in DB
    const base64 = req.file.buffer.toString('base64');
    const dataUri = `data:${req.file.mimetype};base64,${base64}`;
    const fileSizeKb = Math.round(req.file.size / 1024);

    // Get current version number for this employee + document type
    const versionResult = await pool.query(
      `SELECT MAX(version) as max_version
       FROM employee_documents
       WHERE employee_id = $1 AND document_type_id = $2`,
      [employee_id, document_type_id]
    );
    const newVersion = (versionResult.rows[0].max_version || 0) + 1;

    // Mark any previous versions as not current
    await pool.query(
      `UPDATE employee_documents
       SET is_current = false
       WHERE employee_id = $1 AND document_type_id = $2 AND is_current = true`,
      [employee_id, document_type_id]
    );

    const result = await pool.query(
      `INSERT INTO employee_documents
       (employee_id, document_type_id, file_name, file_url, file_size_kb,
        mime_type, version, is_current, issued_date, expiry_date,
        status, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, 'Pending', $10)
       RETURNING *`,
      [
        employee_id, document_type_id,
        req.file.originalname, dataUri, fileSizeKb,
        req.file.mimetype, newVersion,
        issued_date || null, expiry_date || null,
        uploaded_by || null
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.message.includes('Only PDF')) {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ─── UPDATE document status ────────────────────────────────────────────────────
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

// ─── ACKNOWLEDGE document ──────────────────────────────────────────────────────
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

// ─── Multer error handler ──────────────────────────────────────────────────────
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ message: err.message });
  }
});

module.exports = router;