const express = require('express');
const router = express.Router();
const query = require('../config/queryWithRetry');
const auth = require('../middleware/auth');

// GET all announcements
router.get('/', auth, async (req, res) => {
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

// CREATE announcement
router.post('/', auth, async (req, res) => {
  const { title, category, audience, body } = req.body;
  // If the request has postedBy, use it; otherwise default to 'Admin'
  const postedBy = req.body.postedBy || 'Admin';
  
  try {
    const result = await query(
      `INSERT INTO announcements (title, category, audience, body, posted_by, status)
       VALUES ($1, $2, $3, $4, $5, 'Published')
       RETURNING id, title, category, audience, body, posted_by AS "postedBy", 
                 TO_CHAR(created_at, 'Mon DD, YYYY') AS date, status`,
      [title, category, audience, body, postedBy]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE announcement
router.put('/:id', auth, async (req, res) => {
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
router.delete('/:id', auth, async (req, res) => {
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
