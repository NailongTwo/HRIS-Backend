const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// GET all work schedules (with employee count and days array)
router.get('/', auth, authorize('work_schedules', 'view'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ws.*, 
             (SELECT COUNT(*) FROM employees e WHERE e.work_schedule_id = ws.id AND e.status = 'Active')::int AS employee_count,
             COALESCE(
               (SELECT json_agg(
                  json_build_object(
                    'id', wsd.id,
                    'day_of_week', wsd.day_of_week,
                    'is_working', wsd.is_working,
                    'start_time', wsd.start_time,
                    'end_time', wsd.end_time
                  ) ORDER BY CASE wsd.day_of_week
                    WHEN 'Monday' THEN 1
                    WHEN 'Tuesday' THEN 2
                    WHEN 'Wednesday' THEN 3
                    WHEN 'Thursday' THEN 4
                    WHEN 'Friday' THEN 5
                    WHEN 'Saturday' THEN 6
                    WHEN 'Sunday' THEN 7
                  END
                )
                FROM work_schedule_days wsd
                WHERE wsd.work_schedule_id = ws.id
               ), '[]'::json
             ) AS days
      FROM work_schedules ws
      ORDER BY ws.name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET active work schedules only
router.get('/active', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, description FROM work_schedules
      WHERE status = 'Active'
      ORDER BY name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET single work schedule
router.get('/:id', auth, async (req, res) => {
  try {
    const wsResult = await pool.query(
      'SELECT * FROM work_schedules WHERE id = $1',
      [req.params.id]
    );

    if (wsResult.rows.length === 0) {
      return res.status(404).json({ message: 'Work schedule not found' });
    }

    const daysResult = await pool.query(`
      SELECT id, day_of_week, is_working, start_time, end_time
      FROM work_schedule_days
      WHERE work_schedule_id = $1
      ORDER BY CASE day_of_week
        WHEN 'Monday' THEN 1
        WHEN 'Tuesday' THEN 2
        WHEN 'Wednesday' THEN 3
        WHEN 'Thursday' THEN 4
        WHEN 'Friday' THEN 5
        WHEN 'Saturday' THEN 6
        WHEN 'Sunday' THEN 7
      END
    `, [req.params.id]);

    const schedule = {
      ...wsResult.rows[0],
      days: daysResult.rows
    };

    res.json(schedule);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CREATE work schedule
router.post('/', auth, authorize('work_schedules', 'create'), async (req, res) => {
  const { name, description, status, grace_period_minutes, days } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Schedule name is required.' });
  }

  const graceMins = parseInt(grace_period_minutes, 10);
  const gracePeriodMinutes = !isNaN(graceMins) && graceMins >= 0 ? graceMins : 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if name unique
    const existing = await client.query('SELECT id FROM work_schedules WHERE name = $1', [name]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Work schedule name already exists.' });
    }

    const wsResult = await client.query(
      `INSERT INTO work_schedules (name, description, status, grace_period_minutes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, description, status || 'Active', gracePeriodMinutes]
    );
    const scheduleId = wsResult.rows[0].id;

    const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    if (days && Array.isArray(days)) {
      for (const dName of DAYS_OF_WEEK) {
        const dObj = days.find(d => d.day_of_week === dName) || {
          day_of_week: dName,
          is_working: false,
          start_time: null,
          end_time: null
        };

        const isWorking = !!dObj.is_working;
        const startTime = isWorking ? dObj.start_time || null : null;
        const endTime = isWorking ? dObj.end_time || null : null;

        await client.query(
          `INSERT INTO work_schedule_days (work_schedule_id, day_of_week, is_working, start_time, end_time)
           VALUES ($1, $2, $3, $4, $5)`,
          [scheduleId, dName, isWorking, startTime, endTime]
        );
      }
    } else {
      // Default Monday-Friday 8am-5pm if not provided
      for (const dName of DAYS_OF_WEEK) {
        const isWorking = !['Saturday', 'Sunday'].includes(dName);
        await client.query(
          `INSERT INTO work_schedule_days (work_schedule_id, day_of_week, is_working, start_time, end_time)
           VALUES ($1, $2, $3, $4, $5)`,
          [scheduleId, dName, isWorking, isWorking ? '08:00:00' : null, isWorking ? '17:00:00' : null]
        );
      }
    }

    await client.query('COMMIT');

    // Fetch full created schedule for return
    const daysResult = await pool.query(`
      SELECT id, day_of_week, is_working, start_time, end_time
      FROM work_schedule_days
      WHERE work_schedule_id = $1
      ORDER BY CASE day_of_week
        WHEN 'Monday' THEN 1
        WHEN 'Tuesday' THEN 2
        WHEN 'Wednesday' THEN 3
        WHEN 'Thursday' THEN 4
        WHEN 'Friday' THEN 5
        WHEN 'Saturday' THEN 6
        WHEN 'Sunday' THEN 7
      END
    `, [scheduleId]);

    res.status(201).json({
      ...wsResult.rows[0],
      days: daysResult.rows
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
});

// UPDATE work schedule
router.put('/:id', auth, authorize('work_schedules', 'edit'), async (req, res) => {
  const { id } = req.params;
  const { name, description, status, grace_period_minutes, days } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Schedule name is required.' });
  }

  const graceMins = parseInt(grace_period_minutes, 10);
  const gracePeriodMinutes = !isNaN(graceMins) && graceMins >= 0 ? graceMins : 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if name unique (excluding self)
    const existing = await client.query('SELECT id FROM work_schedules WHERE name = $1 AND id != $2', [name, id]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Work schedule name already exists.' });
    }

    // Check if deactivating a schedule that has active employees
    if (status === 'Inactive') {
      const empCheck = await client.query(
        `SELECT COUNT(*) FROM employees WHERE work_schedule_id = $1 AND status = 'Active'`,
        [id]
      );
      if (parseInt(empCheck.rows[0].count) > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Cannot deactivate schedule: Active employees are currently assigned to it.' });
      }
    }

    const wsResult = await client.query(
      `UPDATE work_schedules
       SET name = $1, description = $2, status = $3, grace_period_minutes = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [name, description, status, gracePeriodMinutes, id]
    );

    if (wsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Work schedule not found' });
    }

    if (days && Array.isArray(days)) {
      const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      for (const dName of DAYS_OF_WEEK) {
        const dObj = days.find(d => d.day_of_week === dName);
        if (dObj) {
          const isWorking = !!dObj.is_working;
          const startTime = isWorking ? dObj.start_time || null : null;
          const endTime = isWorking ? dObj.end_time || null : null;

          await client.query(
            `INSERT INTO work_schedule_days (work_schedule_id, day_of_week, is_working, start_time, end_time)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (work_schedule_id, day_of_week) DO UPDATE
               SET is_working = EXCLUDED.is_working,
                   start_time = EXCLUDED.start_time,
                   end_time = EXCLUDED.end_time,
                   updated_at = NOW()`,
            [id, dName, isWorking, startTime, endTime]
          );
        }
      }
    }

    await client.query('COMMIT');

    const daysResult = await pool.query(`
      SELECT id, day_of_week, is_working, start_time, end_time
      FROM work_schedule_days
      WHERE work_schedule_id = $1
      ORDER BY CASE day_of_week
        WHEN 'Monday' THEN 1
        WHEN 'Tuesday' THEN 2
        WHEN 'Wednesday' THEN 3
        WHEN 'Thursday' THEN 4
        WHEN 'Friday' THEN 5
        WHEN 'Saturday' THEN 6
        WHEN 'Sunday' THEN 7
      END
    `, [id]);

    res.json({
      ...wsResult.rows[0],
      days: daysResult.rows
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
});

// DELETE work schedule (only blocks if ACTIVE employees are currently assigned)
router.delete('/:id', auth, authorize('work_schedules', 'delete'), async (req, res) => {
  try {
    const { id } = req.params;

    // Only block deletion if there are currently ACTIVE employees assigned to this schedule.
    // Inactive/historical employees do not prevent deletion.
    const empCheck = await pool.query(
      `SELECT COUNT(*) FROM employees WHERE work_schedule_id = $1 AND status = 'Active'`,
      [id]
    );

    if (parseInt(empCheck.rows[0].count) > 0) {
      return res.status(400).json({
        message: `Cannot delete schedule: ${empCheck.rows[0].count} active employee(s) are currently assigned to it. Please reassign them first or deactivate the schedule instead.`
      });
    }

    const result = await pool.query(
      'DELETE FROM work_schedules WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Work schedule not found' });
    }

    res.json({ message: 'Work schedule deleted successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
