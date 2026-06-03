const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// GET all tasks
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tasks ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET tasks by employee
router.get('/employee/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE assignee_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE task
router.post('/', auth, async (req, res) => {
  const {
    title,
    description,
    assignee_id,
    assigned_by,
    priority,
    due_date,
    start_date,
    project,
    tags
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO tasks 
      (title, description, assignee_id, assigned_by, status, priority, 
      due_date, start_date, project, tags) 
      VALUES ($1, $2, $3, $4, 'To Do', $5, $6, $7, $8, $9) 
      RETURNING *`,
      [title, description, assignee_id, assigned_by,
        priority || 'Medium', due_date, start_date, project, tags]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE task status
router.put('/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  try {
    const completed_at = status === 'Done' ? new Date() : null;
    
    const result = await pool.query(
      `UPDATE tasks 
       SET status = $1, 
           completed_at = $2
       WHERE id = $3 
       RETURNING *`,
      [status, completed_at, req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Task not found!' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE task
router.put('/:id', auth, async (req, res) => {
  const { title, description, priority, due_date, project, tags } = req.body;

  try {
    const result = await pool.query(
      `UPDATE tasks 
      SET title = $1, description = $2, priority = $3, 
      due_date = $4, project = $5, tags = $6
      WHERE id = $7 
      RETURNING *`,
      [title, description, priority, due_date, project, tags, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE task
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
    res.json({ message: 'Task deleted!' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET task comments
router.get('/:id/comments', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM task_comments WHERE task_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ADD task comment
router.post('/:id/comments', auth, async (req, res) => {
  const { author_id, body } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO task_comments (task_id, author_id, body) 
      VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, author_id, body]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;