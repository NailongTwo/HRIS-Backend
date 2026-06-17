const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// ─── GOALS ───────────────────────────────────────────────

// GET goals for an employee
router.get('/goals/employee/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM performance_goals WHERE employee_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all goals (admin)
router.get('/goals', auth, authorize('performance', 'view'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, e.first_name, e.last_name, e.employee_no
      FROM performance_goals g
      LEFT JOIN employees e ON g.employee_id = e.id
      ORDER BY g.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST create goal
router.post('/goals', auth, authorize('performance', 'create'), async (req, res) => {
  const { employee_id, title, description, target_date } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO performance_goals (employee_id, title, description, target_date)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [employee_id, title, description, target_date]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// PATCH update goal status
router.patch('/goals/:id', auth, async (req, res) => {
  const { status } = req.body;
  try {
    const result = await pool.query(
      `UPDATE performance_goals SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ─── KPI TRACKING ────────────────────────────────────────

// GET KPIs for an employee
router.get('/kpi/employee/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT k.*, g.title as goal_title
       FROM kpi_tracking k
       LEFT JOIN performance_goals g ON k.goal_id = g.id
       WHERE k.employee_id = $1 ORDER BY k.created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all KPIs (admin)
router.get('/kpi', auth, authorize('performance', 'view'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT k.*, e.first_name, e.last_name, e.employee_no, g.title as goal_title
      FROM kpi_tracking k
      LEFT JOIN employees e ON k.employee_id = e.id
      LEFT JOIN performance_goals g ON k.goal_id = g.id
      ORDER BY k.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST create KPI
router.post('/kpi', auth, authorize('performance', 'create'), async (req, res) => {
  const { employee_id, goal_id, kpi_name, target_value, unit, period } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO kpi_tracking (employee_id, goal_id, kpi_name, target_value, unit, period)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [employee_id, goal_id || null, kpi_name, target_value, unit, period]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// PATCH update KPI actual value
router.patch('/kpi/:id', auth, async (req, res) => {
  const { actual_value, status } = req.body;
  try {
    const result = await pool.query(
      `UPDATE kpi_tracking SET actual_value = COALESCE($1, actual_value), status = COALESCE($2, status) WHERE id = $3 RETURNING *`,
      [actual_value, status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ─── EVALUATIONS ─────────────────────────────────────────

// GET evaluations for an employee
router.get('/evaluations/employee/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pe.*, 
             e.first_name AS evaluator_first, e.last_name AS evaluator_last
      FROM performance_evaluations pe
      LEFT JOIN employees e ON pe.evaluator_id = e.id
      WHERE pe.employee_id = $1 ORDER BY pe.created_at DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all evaluations (admin)
router.get('/evaluations', auth, authorize('performance', 'view'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pe.*,
             emp.first_name, emp.last_name, emp.employee_no,
             ev.first_name AS evaluator_first, ev.last_name AS evaluator_last
      FROM performance_evaluations pe
      LEFT JOIN employees emp ON pe.employee_id = emp.id
      LEFT JOIN employees ev ON pe.evaluator_id = ev.id
      ORDER BY pe.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST create evaluation with appraisal categories
router.post('/evaluations', auth, authorize('performance', 'create'), async (req, res) => {
  const { employee_id, evaluator_id, period, evaluation_date, overall_rating, strengths, improvements, comments, appraisals } = req.body;
  try {
    const evalResult = await pool.query(
      `INSERT INTO performance_evaluations (employee_id, evaluator_id, period, evaluation_date, overall_rating, strengths, improvements, comments, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Submitted') RETURNING *`,
      [employee_id, evaluator_id, period, evaluation_date, overall_rating, strengths, improvements, comments]
    );
    const evaluation = evalResult.rows[0];

    if (appraisals && appraisals.length) {
      for (const a of appraisals) {
        await pool.query(
          `INSERT INTO performance_appraisals (evaluation_id, employee_id, category, rating, remarks)
           VALUES ($1, $2, $3, $4, $5)`,
          [evaluation.id, employee_id, a.category, a.rating, a.remarks]
        );
      }
    }

    res.json(evaluation);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET appraisal details for an evaluation
router.get('/evaluations/:id/appraisals', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM performance_appraisals WHERE evaluation_id = $1',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;