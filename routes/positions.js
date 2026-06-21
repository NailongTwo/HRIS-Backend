const express = require('express');
const router = express.Router();
const auditRoute = require('../middleware/auditRoute');
router.use(auditRoute('positions'));
const pool = require('../config/db');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
// GET positions as lightweight list — for dropdowns/filters, any authenticated user
router.get('/simple', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.title, p.department_id, d.name AS department_name
       FROM positions p
       LEFT JOIN departments d ON p.department_id = d.id
       WHERE p.is_active = true
       ORDER BY p.title ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all positions
router.get('/', auth, authorize('job_positions', 'view'), async (req, res) => {
  try {
    const { activeOnly } = req.query;
    let queryStr = `
      SELECT p.*, d.name AS department_name,
             (SELECT COUNT(DISTINCT er.employee_id)
              FROM employment_records er
              JOIN employees e ON er.employee_id = e.id
              WHERE er.position_id = p.id AND e.status = 'Active' AND (er.end_date IS NULL OR er.end_date > NOW())
             )::int AS employees
      FROM positions p
      LEFT JOIN departments d ON p.department_id = d.id
    `;
    if (activeOnly === 'true') {
      queryStr += ' WHERE p.is_active = true';
    }
    queryStr += ' ORDER BY p.title ASC';

    const result = await pool.query(queryStr);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET positions by department
router.get('/department/:id', auth, authorize('job_positions', 'view'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM positions 
      WHERE department_id = $1 AND is_active = true`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET single position
router.get('/:id', auth, authorize('job_positions', 'view'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM positions WHERE id = $1',
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE position
router.post('/', auth, authorize('job_positions', 'create'), async (req, res) => {
  const { code, title, department_id, level, description, status, is_active } = req.body;
  const activeVal = is_active !== undefined ? is_active : (status === 'Inactive' ? false : true);
  try {
    // Validate department exists
    const dept = await pool.query('SELECT id FROM departments WHERE id = $1', [department_id]);
    if (dept.rows.length === 0) {
      return res.status(400).json({ message: 'Selected department does not exist.' });
    }

    const result = await pool.query(
      `INSERT INTO positions 
      (code, title, department_id, level, description, is_active) 
      VALUES ($1, $2, $3, $4, $5, $6) 
      RETURNING *`,
      [code, title, department_id, level || 1, description, activeVal]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ message: 'Position code already exists.' });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE position
router.put('/:id', auth, authorize('job_positions', 'edit'), async (req, res) => {
  const { id } = req.params;
  const { code, title, department_id, level, description, is_active: is_active_req, status } = req.body;
  const is_active = is_active_req !== undefined ? is_active_req : (status !== undefined ? status === 'Active' : undefined);

  try {
    if (is_active === false) {
      // Check active employees assigned to this position
      const employees = await pool.query(
        `SELECT COUNT(*) FROM employment_records er
         JOIN employees e ON er.employee_id = e.id
         WHERE er.position_id = $1 AND e.status = 'Active' AND (er.end_date IS NULL OR er.end_date > NOW())`,
        [id]
      );
      if (parseInt(employees.rows[0].count) > 0) {
        return res.status(400).json({ message: 'Cannot deactivate position: Active employees are currently assigned to it.' });
      }
    }

    if (department_id) {
      // Validate department exists
      const dept = await pool.query('SELECT id FROM departments WHERE id = $1', [department_id]);
      if (dept.rows.length === 0) {
        return res.status(400).json({ message: 'Selected department does not exist.' });
      }
    }

    const result = await pool.query(
      `UPDATE positions 
      SET code = COALESCE($1, code), 
          title = COALESCE($2, title), 
          department_id = COALESCE($3, department_id), 
          level = COALESCE($4, level), 
          description = COALESCE($5, description), 
          is_active = COALESCE($6, is_active),
          updated_at = NOW()
      WHERE id = $7 
      RETURNING *`,
      [code, title, department_id, level, description, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Position not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ message: 'Position code already exists.' });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE position (soft delete)
router.delete('/:id', auth, authorize('job_positions', 'delete'), async (req, res) => {
  try {
    const { id } = req.params;

    // Check active employees assigned to this position
    const employees = await pool.query(
      `SELECT COUNT(*) FROM employment_records er
       JOIN employees e ON er.employee_id = e.id
       WHERE er.position_id = $1 AND e.status = 'Active' AND (er.end_date IS NULL OR er.end_date > NOW())`,
      [id]
    );
    if (parseInt(employees.rows[0].count) > 0) {
      return res.status(400).json({ message: 'Cannot archive position: Active employees are currently assigned to it.' });
    }

    await pool.query(
      'UPDATE positions SET is_active = false, updated_at = NOW() WHERE id = $1',
      [id]
    );
    res.json({ message: 'Position archived successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;


