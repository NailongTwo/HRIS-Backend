const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// GET departments as lightweight list — for dropdowns/filters, any authenticated user
router.get('/simple', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name FROM departments WHERE is_active = true ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all departments
router.get('/', auth, authorize('departments', 'view'), async (req, res) => {
  try {
    const { activeOnly } = req.query;
    let queryStr = `
      SELECT d.*, 
             (SELECT COUNT(DISTINCT er.employee_id) 
              FROM employment_records er
              JOIN employees e ON er.employee_id = e.id
              WHERE er.department_id = d.id AND e.status = 'Active' AND (er.end_date IS NULL OR er.end_date > NOW())
             )::int AS employees
      FROM departments d
    `;
    if (activeOnly === 'true') {
      queryStr += ' WHERE d.is_active = true';
    }
    queryStr += ' ORDER BY d.name ASC';
    const result = await pool.query(queryStr);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET single department
router.get('/:id', auth, authorize('departments', 'view'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM departments WHERE id = $1',
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE department
router.post('/', auth, authorize('departments', 'create'), async (req, res) => {
  const { code, name, description, head_employee_id, parent_dept_id, status, is_active } = req.body;
  const activeVal = is_active !== undefined ? is_active : (status === 'Inactive' ? false : true);
  try {
    const result = await pool.query(
      `INSERT INTO departments 
      (code, name, description, head_employee_id, parent_dept_id, is_active) 
      VALUES ($1, $2, $3, $4, $5, $6) 
      RETURNING *`,
      [code, name, description, head_employee_id, parent_dept_id, activeVal]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ message: 'Department code or name already exists.' });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// UPDATE department
router.put('/:id', auth, authorize('departments', 'edit'), async (req, res) => {
  const { id } = req.params;
  const { code, name, description, head_employee_id, parent_dept_id, is_active: is_active_req, status } = req.body;
  const is_active = is_active_req !== undefined ? is_active_req : (status !== undefined ? status === 'Active' : undefined);

  try {
    // If we are deactivating, check dependencies first
    if (is_active === false) {
      const subDepts = await pool.query(
        'SELECT COUNT(*) FROM departments WHERE parent_dept_id = $1 AND is_active = true',
        [id]
      );
      if (parseInt(subDepts.rows[0].count) > 0) {
        return res.status(400).json({ message: 'Cannot deactivate department: It has active sub-departments.' });
      }

      const activePositions = await pool.query(
        'SELECT COUNT(*) FROM positions WHERE department_id = $1 AND is_active = true',
        [id]
      );
      if (parseInt(activePositions.rows[0].count) > 0) {
        return res.status(400).json({ message: 'Cannot deactivate department: It has active job positions.' });
      }

      const employees = await pool.query(
        `SELECT COUNT(*) FROM employment_records er
         JOIN employees e ON er.employee_id = e.id
         WHERE er.department_id = $1 AND e.status = 'Active' AND (er.end_date IS NULL OR er.end_date > NOW())`,
        [id]
      );
      if (parseInt(employees.rows[0].count) > 0) {
        return res.status(400).json({ message: 'Cannot deactivate department: It has active employees assigned to it.' });
      }
    }

    const result = await pool.query(
      `UPDATE departments 
      SET code = COALESCE($1, code), 
          name = COALESCE($2, name), 
          description = COALESCE($3, description), 
          head_employee_id = COALESCE($4, head_employee_id),
          parent_dept_id = COALESCE($5, parent_dept_id),
          is_active = COALESCE($6, is_active),
          updated_at = NOW()
      WHERE id = $7 
      RETURNING *`,
      [code, name, description, head_employee_id, parent_dept_id, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Department not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ message: 'Department code or name already exists.' });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// DELETE department (soft delete)
router.delete('/:id', auth, authorize('departments', 'delete'), async (req, res) => {
  try {
    const { id } = req.params;

    // Check active sub-departments
    const subDepts = await pool.query(
      'SELECT COUNT(*) FROM departments WHERE parent_dept_id = $1 AND is_active = true',
      [id]
    );
    if (parseInt(subDepts.rows[0].count) > 0) {
      return res.status(400).json({ message: 'Cannot archive department: It has active sub-departments.' });
    }

    // Check active positions
    const activePositions = await pool.query(
      'SELECT COUNT(*) FROM positions WHERE department_id = $1 AND is_active = true',
      [id]
    );
    if (parseInt(activePositions.rows[0].count) > 0) {
      return res.status(400).json({ message: 'Cannot archive department: It has active job positions.' });
    }

    // Check active employees
    const employees = await pool.query(
      `SELECT COUNT(*) FROM employment_records er
       JOIN employees e ON er.employee_id = e.id
       WHERE er.department_id = $1 AND e.status = 'Active' AND (er.end_date IS NULL OR er.end_date > NOW())`,
      [id]
    );
    if (parseInt(employees.rows[0].count) > 0) {
      return res.status(400).json({ message: 'Cannot archive department: It has active employees assigned to it.' });
    }

    await pool.query(
      'UPDATE departments SET is_active = false, updated_at = NOW() WHERE id = $1',
      [id]
    );
    res.json({ message: 'Department archived successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;