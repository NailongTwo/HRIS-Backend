const express = require('express');
const router = express.Router();
const auditRoute = require('../middleware/auditRoute');
router.use(auditRoute('recognitions'));
const pool = require('../config/db');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
// GET all recognitions for an employee
router.get('/employee/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, 
             e.first_name AS awarded_by_first_name, 
             e.last_name AS awarded_by_last_name
      FROM recognitions r
      LEFT JOIN employees e ON r.awarded_by = e.id
      WHERE r.employee_id = $1
      ORDER BY r.awarded_date DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Recognition fetch error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all recognitions (company-wide feed)
router.get('/', auth, authorize('recognition', 'view'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, 
             e.first_name, e.last_name, e.employee_no,
             a.first_name AS awarded_by_first_name, 
             a.last_name AS awarded_by_last_name
      FROM recognitions r
      LEFT JOIN employees e ON r.employee_id = e.id
      LEFT JOIN employees a ON r.awarded_by = a.id
      ORDER BY r.awarded_date DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Recognition fetch error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST new recognition (admin/HR)
router.post('/', auth, authorize('recognition', 'create'), async (req, res) => {
  const { employee_id, title, description, category, awarded_by, awarded_date } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO recognitions (employee_id, title, description, category, awarded_by, awarded_date)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE))
       RETURNING *`,
      [employee_id, title, description, category || 'Recognition', awarded_by, awarded_date]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Recognition submit error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE recognition (admin)
router.delete('/:id', auth, authorize('recognition', 'delete'), async (req, res) => {
  try {
    await pool.query('DELETE FROM recognitions WHERE id = $1', [req.params.id]);
    res.json({ message: 'Recognition deleted.' });
  } catch (err) {
    console.error('Recognition delete error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;


