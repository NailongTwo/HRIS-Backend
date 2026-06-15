const pool = require('../config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Altering work_schedules table to add grace_period_minutes...');
    await client.query(`
      ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS grace_period_minutes INTEGER NOT NULL DEFAULT 0;
    `);
    await client.query('COMMIT');
    console.log('🎉 Migration completed successfully! Column grace_period_minutes added to work_schedules.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
