const express = require('express');
const router = express.Router();
const auditRoute = require('../middleware/auditRoute');
router.use(auditRoute('tasks'));
const pool = require('../config/db');
const query = require('../config/queryWithRetry');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
// GET all tasks
router.get('/', auth, authorize('tasks', 'view'), async (req, res) => {
  try {
    const result = await query('SELECT * FROM tasks ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET tasks by employee
router.get('/employee/:id', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM tasks WHERE assignee_id = $1::uuid OR $1::uuid = ANY(assignee_ids::uuid[]) ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE task (self-logged by employee)
router.post('/', auth, async (req, res) => {
  const { title, description, assignee_ids, task_date, project, attachment_urls } = req.body;
  try {
    const safeAssigneeIds = Array.isArray(assignee_ids) && assignee_ids.length > 0 ? assignee_ids : [];
    const primaryAssignee = safeAssigneeIds[0] || null;
    const result = await query(
      `INSERT INTO tasks 
      (title, description, assignee_id, assignee_ids, status, task_date, project, attachment_urls) 
      VALUES ($1, $2, $3, $4, 'To Do', $5, $6, $7) 
      RETURNING *`,
      [title, description, primaryAssignee, safeAssigneeIds, task_date || new Date().toISOString().slice(0, 10), project, attachment_urls || []]
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
    const result = await query(
      `UPDATE tasks SET status = $1, completed_at = $2 WHERE id = $3 RETURNING *`,
      [status, completed_at, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Task not found!' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE task (employee self-edit; locked once Done)
router.put('/:id', auth, async (req, res) => {
  const { title, description, task_date, project, attachment_urls } = req.body;
  try {
    const existing = await query('SELECT status FROM tasks WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ message: 'Task not found!' });
    if (existing.rows[0].status === 'Done') {
      return res.status(403).json({ message: 'This task is already marked as Done and can no longer be edited.' });
    }

    const result = await query(
      `UPDATE tasks 
      SET title = $1, description = $2, task_date = $3, project = $4, attachment_urls = $5, updated_at = NOW()
      WHERE id = $6 
      RETURNING *`,
      [title, description, task_date, project, attachment_urls, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE task
router.delete('/:id', auth, authorize('tasks', 'delete'), async (req, res) => {
  try {
    const result = await query('DELETE FROM tasks WHERE id = $1 RETURNING *', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Task not found!' });
    res.json({ message: 'Task deleted!', record: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET task comments
router.get('/:id/comments', auth, async (req, res) => {
  try {
    const result = await query(
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
    const result = await query(
      `INSERT INTO task_comments (task_id, author_id, body) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, author_id, body]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPLOAD task attachment to Supabase, append to attachment_urls
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const taskFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post('/:id/attachment', auth, taskFileUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });

    const existing = await query('SELECT status, attachment_urls FROM tasks WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ message: 'Task not found!' });
    if (existing.rows[0].status === 'Done') {
      return res.status(403).json({ message: 'This task is already marked as Done and can no longer be edited.' });
    }

    const filePath = `task-attachments/task_${req.params.id}_${Date.now()}_${req.file.originalname}`;

    const { error: uploadError } = await supabase.storage
      .from('hris-files')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) {
      return res.status(500).json({ message: 'Cloud storage upload failed.', error: uploadError.message });
    }

    const { data: urlData } = supabase.storage.from('hris-files').getPublicUrl(filePath);
    const fileUrl = urlData.publicUrl;

    const currentUrls = existing.rows[0].attachment_urls || [];
    const updatedUrls = [...currentUrls, fileUrl];

    const result = await query(
      `UPDATE tasks SET attachment_urls = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [updatedUrls, req.params.id]
    );

    res.json({ message: 'File uploaded successfully!', attachment_urls: result.rows[0].attachment_urls });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;


