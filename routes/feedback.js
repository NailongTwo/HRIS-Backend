const express = require('express');
const router = express.Router();
const auditRoute = require('../middleware/auditRoute');
router.use(auditRoute('feedback'));
const pool = require('../config/db');
const auth = require('../middleware/auth');
// GET all feedback for an employee
router.get('/employee/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM feedback WHERE employee_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Feedback fetch error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all feedback (for admin)
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.*, e.first_name, e.last_name, e.employee_no
      FROM feedback f
      LEFT JOIN employees e ON f.employee_id = e.id
      ORDER BY f.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Feedback fetch error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST new feedback
router.post('/', auth, async (req, res) => {
  const { employee_id, category, subject, message, is_anonymous } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO feedback (employee_id, category, subject, message, is_anonymous, status)
       VALUES ($1, $2, $3, $4, $5, 'New')
       RETURNING *`,
      [employee_id, category || 'General', subject, message, is_anonymous || false]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Feedback submit error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



// PUT update feedback status (admin)
router.put('/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  try {
    const result = await pool.query(
      'UPDATE feedback SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Feedback status update error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;


