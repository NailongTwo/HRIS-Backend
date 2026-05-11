const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// GET all events
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, et.name as event_type_name, et.color, et.is_holiday
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

// GET single event
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, et.name as event_type_name, et.color
      FROM events e
      JOIN event_types et ON e.event_type_id = et.id
      WHERE e.id = $1`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all event types
router.get('/types/all', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM event_types WHERE is_active = true ORDER BY name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE event
router.post('/', auth, async (req, res) => {
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
    created_by
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO events 
      (event_type_id, title, description, location, start_datetime, 
      end_datetime, is_all_day, is_recurring, recurrence_rule, 
      visibility, target_dept_ids, created_by) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
      RETURNING *`,
      [event_type_id, title, description, location, start_datetime,
      end_datetime, is_all_day || false, is_recurring || false,
      recurrence_rule, visibility || 'All', target_dept_ids, created_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE event
router.put('/:id', auth, async (req, res) => {
  const {
    title,
    description,
    location,
    start_datetime,
    end_datetime,
    is_all_day,
    visibility
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE events 
      SET title = $1, description = $2, location = $3,
      start_datetime = $4, end_datetime = $5, 
      is_all_day = $6, visibility = $7
      WHERE id = $8 
      RETURNING *`,
      [title, description, location, start_datetime,
      end_datetime, is_all_day, visibility, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE event (soft delete)
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE events SET is_active = false WHERE id = $1',
      [req.params.id]
    );
    res.json({ message: 'Event deleted!' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;