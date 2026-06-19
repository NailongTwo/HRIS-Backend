const pool = require('../config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Adding Late Time Out to attendance_flag ENUM...');
    await client.query(`ALTER TYPE attendance_flag ADD VALUE IF NOT EXISTS 'Late Time Out';`);
    console.log('Late Time Out added to attendance_flag ENUM');

    console.log('Adding time_out_grace_minutes to work_schedules...');
    await client.query(`
      ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS time_out_grace_minutes INTEGER NOT NULL DEFAULT 60;
    `);
    console.log('Column time_out_grace_minutes added to work_schedules (default 60 min)');

    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
