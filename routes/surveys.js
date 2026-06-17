const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// GET all active surveys with questions, and whether employee has responded
router.get('/employee/:id', auth, async (req, res) => {
  try {
    const surveysRes = await pool.query(`
      SELECT s.*, 
        EXISTS(SELECT 1 FROM survey_responses sr WHERE sr.survey_id = s.id AND sr.employee_id = $1) AS has_responded
      FROM surveys s
      WHERE s.status = 'Active'
      ORDER BY s.created_at DESC
    `, [req.params.id]);

    const surveys = surveysRes.rows;

    for (const survey of surveys) {
      const qRes = await pool.query(
        'SELECT * FROM survey_questions WHERE survey_id = $1 ORDER BY order_num ASC',
        [survey.id]
      );
      survey.questions = qRes.rows;
    }

    res.json(surveys);
  } catch (err) {
    console.error('Survey fetch error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST submit survey response
router.post('/:id/respond', auth, async (req, res) => {
  const { employee_id, answers } = req.body; // answers: [{question_id, answer_text}]
  try {
    const responseRes = await pool.query(
      `INSERT INTO survey_responses (survey_id, employee_id) VALUES ($1, $2) RETURNING id`,
      [req.params.id, employee_id]
    );
    const responseId = responseRes.rows[0].id;

    for (const ans of answers) {
      await pool.query(
        `INSERT INTO survey_answers (response_id, question_id, answer_text) VALUES ($1, $2, $3)`,
        [responseId, ans.question_id, ans.answer_text]
      );
    }

    res.json({ message: 'Survey submitted successfully!' });
  } catch (err) {
    console.error('Survey submit error:', err.message);
    if (err.code === '23505') {
      return res.status(400).json({ message: 'You have already responded to this survey.' });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all surveys (admin)
router.get('/', auth, authorize('surveys', 'view'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM surveys ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST create survey (admin)
router.post('/', auth, authorize('surveys', 'create'), async (req, res) => {
  const { title, description, created_by, expires_at, questions } = req.body;
  try {
    const surveyRes = await pool.query(
      `INSERT INTO surveys (title, description, created_by, expires_at) VALUES ($1, $2, $3, $4) RETURNING *`,
      [title, description, created_by, expires_at]
    );
    const survey = surveyRes.rows[0];

    if (questions && questions.length) {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        await pool.query(
          `INSERT INTO survey_questions (survey_id, question_text, question_type, options, order_num) VALUES ($1, $2, $3, $4, $5)`,
          [survey.id, q.question_text, q.question_type || 'rating', JSON.stringify(q.options || null), i]
        );
      }
    }

    res.json(survey);
  } catch (err) {
    console.error('Survey create error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET all responses for a survey (admin)
router.get('/:id/responses', auth, authorize('surveys', 'view'), async (req, res) => {
  try {
    const questionsRes = await pool.query(
      'SELECT * FROM survey_questions WHERE survey_id = $1 ORDER BY order_num ASC',
      [req.params.id]
    );

    const responsesRes = await pool.query(`
      SELECT sr.id AS response_id, sr.employee_id, sr.submitted_at AS created_at,
             e.first_name, e.last_name, e.employee_no
      FROM survey_responses sr
      LEFT JOIN employees e ON sr.employee_id = e.id
      WHERE sr.survey_id = $1
      ORDER BY sr.submitted_at DESC
    `, [req.params.id]);

    const responses = responsesRes.rows;
    for (const r of responses) {
      const ansRes = await pool.query(
        'SELECT question_id, answer_text FROM survey_answers WHERE response_id = $1',
        [r.response_id]
      );
      r.answers = ansRes.rows;
    }

    res.json({ questions: questionsRes.rows, responses });
  } catch (err) {
    console.error('Survey responses fetch error:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;