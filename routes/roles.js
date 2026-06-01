const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// GET all roles (with user count)
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.name, r.description as desc, r.status, COUNT(u.id)::int as users
      FROM roles r
      LEFT JOIN users u ON u.role::text = r.name
      GROUP BY r.id, r.name, r.description, r.status
      ORDER BY r.name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE role
router.post('/', auth, async (req, res) => {
  const { name, desc, status } = req.body;
  try {
    // Add value to user_role_type enum if it doesn't exist
    try {
      await pool.query(`ALTER TYPE user_role_type ADD VALUE '${name}'`);
    } catch (enumErr) {
      // Ignore if value already exists
    }

    const result = await pool.query(
      `INSERT INTO roles (name, description, status) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (name) DO UPDATE SET description = $2, status = $3
       RETURNING *`,
      [name, desc, status || 'Active']
    );
    res.json({ ...result.rows[0], desc: result.rows[0].description, users: 0 });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE role
router.put('/:id', auth, async (req, res) => {
  const { name, desc, status } = req.body;
  try {
    const result = await pool.query(
      `UPDATE roles 
       SET name = $1, description = $2, status = $3, updated_at = NOW() 
       WHERE id = $4 
       RETURNING *`,
      [name, desc, status, req.params.id]
    );
    
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Role not found' });
    }

    // Add value to user_role_type enum if it doesn't exist
    try {
      await pool.query(`ALTER TYPE user_role_type ADD VALUE '${name}'`);
    } catch (enumErr) {
      // Ignore if value already exists
    }

    res.json({ ...result.rows[0], desc: result.rows[0].description });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE role
router.delete('/:id', auth, async (req, res) => {
  try {
    const roleCheck = await pool.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);
    if (!roleCheck.rows[0]) {
      return res.status(404).json({ message: 'Role not found' });
    }

    await pool.query('DELETE FROM roles WHERE id = $1', [req.params.id]);
    res.json({ message: 'Role deleted successfully!' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
