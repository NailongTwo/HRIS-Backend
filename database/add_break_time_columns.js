const pool = require('../config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Altering work_schedule_days table to add break_start and break_end...');
    await client.query(`
      ALTER TABLE work_schedule_days ADD COLUMN IF NOT EXISTS break_start TIME DEFAULT NULL;
      ALTER TABLE work_schedule_days ADD COLUMN IF NOT EXISTS break_end TIME DEFAULT NULL;
    `);
    await client.query('COMMIT');
    console.log('🎉 Migration completed successfully! Columns break_start and break_end added to work_schedule_days.');
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
