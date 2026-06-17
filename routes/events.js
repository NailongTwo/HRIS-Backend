const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// GET all events
router.get('/', auth, authorize('events', 'view'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, et.name as event_type_name, et.color, et.is_holiday, et.is_non_working_day as event_type_is_non_working_day
       FROM events e
       JOIN event_types et ON e.event_type_id = et.id
       WHERE e.is_active = true
       ORDER BY e.start_datetime ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all event types -- MOVED TO TOP before /:id
router.get('/types/all', auth, authorize('event_types', 'view'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM event_types WHERE is_active = true ORDER BY name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST new event type
router.post('/types', auth, authorize('event_types', 'create'), async (req, res) => {
  const { name, description, color, is_active, is_non_working_day } = req.body;
  try {
    // Check if name already exists
    const existing = await pool.query(
      'SELECT id FROM event_types WHERE name = $1',
      [name]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'Event type already exists!' });
    }

    const result = await pool.query(
      `INSERT INTO event_types (name, description, color, is_active, is_non_working_day)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, description, color, is_active ?? true, is_non_working_day ?? false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET single event
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, et.name as event_type_name, et.color, et.is_non_working_day as event_type_is_non_working_day
       FROM events e
       JOIN event_types et ON e.event_type_id = et.id
       WHERE e.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Event not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE event
router.post('/', auth, authorize('events', 'create'), async (req, res) => {
  const {
    event_type_id,
    title,
    description,
    location,
    start_datetime,
    end_datetime,
    is_all_day,
    is_recurring,
    recurrence_rule,
    visibility,
    target_dept_ids,
    created_by,
    is_non_working_day
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO events 
        (event_type_id, title, description, location, start_datetime, 
         end_datetime, is_all_day, is_recurring, recurrence_rule, 
         visibility, target_dept_ids, created_by, is_non_working_day) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
       RETURNING *`,
      [event_type_id, title, description, location, start_datetime,
       end_datetime, is_all_day || false, is_recurring || false,
       recurrence_rule, visibility || 'All', target_dept_ids, created_by, is_non_working_day === undefined ? null : is_non_working_day]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('CREATE EVENT ERROR:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE event
router.put('/:id', auth, authorize('events', 'edit'), async (req, res) => {
  const {
    title,
    description,
    location,
    start_datetime,
    end_datetime,
    is_all_day,
    visibility,
    is_non_working_day
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE events 
       SET title = $1, description = $2, location = $3,
           start_datetime = $4, end_datetime = $5, 
           is_all_day = $6, visibility = $7, is_non_working_day = $8,
           updated_at = NOW()
       WHERE id = $9 
       RETURNING *`,
      [title, description, location, start_datetime,
       end_datetime, is_all_day, visibility, is_non_working_day === undefined ? null : is_non_working_day, req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Event not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE event (soft delete)
router.delete('/:id', auth, authorize('events', 'delete'), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE events SET is_active = false WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Event not found' });
    }
    res.json({ message: 'Event deleted successfully!' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE event type
router.put('/types/:id', auth, authorize('event_types', 'edit'), async (req, res) => {
  const { name, description, color, is_active, is_non_working_day } = req.body;
  try {
    const result = await pool.query(
      `UPDATE event_types 
       SET name = $1, description = $2, color = $3, is_active = $4, is_non_working_day = $5
       WHERE id = $6 
       RETURNING *`,
      [name, description, color, is_active, is_non_working_day ?? false, req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Event type not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
// DELETE event type (soft delete)
router.delete('/types/:id', auth, authorize('event_types', 'delete'), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE event_types SET is_active = false WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Event type not found' });
    }
    res.json({ message: 'Event type disabled successfully!' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
module.exports = router;
