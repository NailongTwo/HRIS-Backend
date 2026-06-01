const pool = require('../config/db');

async function createAnnouncementsTable() {
  try {
    console.log('Ensuring uuid-ossp extension exists...');
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    
    console.log('Creating announcements table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        title VARCHAR(300) NOT NULL,
        category VARCHAR(50) NOT NULL,
        audience VARCHAR(100) NOT NULL,
        body TEXT,
        posted_by VARCHAR(100) NOT NULL DEFAULT 'Admin',
        status VARCHAR(20) NOT NULL DEFAULT 'Published',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('announcements table created successfully.');

    // Seed default announcements
    console.log('Seeding default announcements...');
    await pool.query(`
      INSERT INTO announcements (title, category, audience, body, posted_by, status, created_at) VALUES
      ('Revised Attendance Policy-Effective March 2026', 'Policy', 'All Employees', 'Please note that the attendance policy has been revised. Grace period is now 15 minutes.', 'Hr Dept', 'Published', NOW() - INTERVAL '1 day'),
      ('Company Teambuilding - March 15, 2026', 'Event', 'All Employees', 'Join us for our annual company teambuilding event at the beach resort!', 'Hr Dept', 'Published', NOW() - INTERVAL '2 days'),
      ('New Payroll Cut-off Schedule for Q2', 'Payroll', 'All Employees', 'The new cutoff schedule for Q2 has been published. Please submit your timesheets on time.', 'Finance', 'Published', NOW() - INTERVAL '3 days'),
      ('Q1 HR Performance Review Schedule', 'Memo', 'All Employees', 'Performance reviews for Q1 will start next week. Managers please schedule sessions.', 'Hr Dept', 'Published', NOW() - INTERVAL '5 days')
      ON CONFLICT DO NOTHING;
    `);
    console.log('Announcements seeded successfully.');

  } catch (err) {
    console.error('Error during migration:', err.message);
  } finally {
    pool.end();
  }
}

createAnnouncementsTable();
