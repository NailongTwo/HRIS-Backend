const express = require('express');
const router = express.Router();
const query = require('../config/queryWithRetry');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// ── Notify all active employees about a new announcement ──────────────────────
async function notifyAllEmployees({ title, annId, category }) {
  try {
    // Get all active employees who have a linked user account
    const empRes = await query(
      `SELECT user_id FROM employees WHERE status = 'Active' AND user_id IS NOT NULL`
    );
    if (!empRes.rows.length) return;

    // Bulk insert one notification per employee in a single query
    const values = empRes.rows.map((_, i) => `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`).join(', ');
    const params = empRes.rows.flatMap(row => [
      row.user_id, 'Announcement',
      `New Announcement: ${title}`,
      `A new ${category} announcement has been posted. Click to read more.`,
      'announcement', annId
    ]);
    await query(
      `INSERT INTO notifications (recipient_id, type, title, message, entity_type, entity_id) VALUES ${values}`,
      params
    );
  } catch (err) {
    console.warn('[notifyAllEmployees] Failed:', err.message);
  }
}

// GET all announcements
router.get('/', auth, authorize('announcements', 'view'), async (req, res) => {
  try {
    const result = await query(
      `SELECT id, title, category, audience, body, posted_by AS "postedBy", 
              TO_CHAR(created_at, 'Mon DD, YYYY') AS date, status
       FROM announcements
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE announcement — notifies all active employees
router.post('/', auth, authorize('announcements', 'create'), async (req, res) => {
  const { title, category, audience, body } = req.body;
  const postedBy = req.body.postedBy || 'Admin';
  
  try {
    const result = await query(
      `INSERT INTO announcements (title, category, audience, body, posted_by, status)
       VALUES ($1, $2, $3, $4, $5, 'Published')
       RETURNING id, title, category, audience, body, posted_by AS "postedBy", 
                 TO_CHAR(created_at, 'Mon DD, YYYY') AS date, status`,
      [title, category, audience, body, postedBy]
    );
    const ann = result.rows[0];
    res.status(201).json(ann);

    // ── Fire-and-forget: notify all active employees ──
    await notifyAllEmployees({ title: ann.title, annId: ann.id, category: ann.category });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE announcement
router.put('/:id', auth, authorize('announcements', 'edit'), async (req, res) => {
  const { id } = req.params;
  const { title, category, audience, body } = req.body;
  
  try {
    const result = await query(
      `UPDATE announcements
       SET title = $1, category = $2, audience = $3, body = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING id, title, category, audience, body, posted_by AS "postedBy", 
                 TO_CHAR(created_at, 'Mon DD, YYYY') AS date, status`,
      [title, category, audience, body, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Announcement not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE announcement
router.delete('/:id', auth, authorize('announcements', 'delete'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query(
      `DELETE FROM announcements WHERE id = $1 RETURNING id`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Announcement not found' });
    }
    
    res.json({ message: 'Announcement deleted successfully', id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
