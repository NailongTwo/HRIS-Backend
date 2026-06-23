const express = require('express');
const router = express.Router();
const auditRoute = require('../middleware/auditRoute');
router.use(auditRoute('notifications'));
const query = require('../config/queryWithRetry');
const auth = require('../middleware/auth');
// GET all notifications for the authenticated user
router.get('/', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM notifications 
      WHERE recipient_id = $1 
      ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all notifications by user
router.get('/:user_id', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM notifications 
      WHERE recipient_id = $1 
      ORDER BY created_at DESC`,
      [req.params.user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET unread notifications count
router.get('/:user_id/unread', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT COUNT(*) FROM notifications 
      WHERE recipient_id = $1 AND is_read = false`,
      [req.params.user_id]
    );
    res.json({ unread_count: result.rows[0].count });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// MARK notification as read
router.put('/:id/read', auth, async (req, res) => {
  try {
    const result = await query(
      `UPDATE notifications 
      SET is_read = true, read_at = NOW()
      WHERE id = $1 
      RETURNING *`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// MARK all notifications as read
router.put('/:user_id/read-all', auth, async (req, res) => {
  try {
    await query(
      `UPDATE notifications 
      SET is_read = true, read_at = NOW()
      WHERE recipient_id = $1 AND is_read = false`,
      [req.params.user_id]
    );
    res.json({ message: 'All notifications marked as read!', record: { user_id: req.params.user_id } });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE notification
router.post('/', auth, async (req, res) => {
  const {
    recipient_id,
    type,
    title,
    message,
    entity_type,
    entity_id,
    action_url
  } = req.body;

  try {
    const result = await query(
      `INSERT INTO notifications 
      (recipient_id, type, title, message, entity_type, entity_id, action_url) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING *`,
      [recipient_id, type, title, message, entity_type, entity_id, action_url]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ARCHIVE notification
router.put('/:id/archive', auth, async (req, res) => {
  try {
    const result = await query(
      `UPDATE notifications 
      SET is_archived = true
      WHERE id = $1 
      RETURNING *`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;


