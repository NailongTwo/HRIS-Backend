const pool = require('../config/db');

async function createRolesTable() {
  try {
    console.log('Ensuring uuid-ossp extension exists...');
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    
    console.log('Creating roles table...');
    // Create the table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('roles table created successfully.');

    // Seed default roles matching user_role_type enum
    console.log('Seeding default roles...');
    await pool.query(`
      INSERT INTO roles (name, description, status) VALUES
      ('Admin', 'Full system access all modules', 'Active'),
      ('HR', 'HR management employees, leave, OT, announcements', 'Active'),
      ('Manager', 'Team management approve leave & OT for team', 'Active'),
      ('Employee', 'Standard employee access self-service only', 'Active'),
      ('Payroll', 'Payroll processing and management', 'Active'),
      ('Super Admin', 'Full system configuration and overriding access', 'Active')
      ON CONFLICT (name) DO NOTHING;
    `);
    console.log('Roles seeded successfully.');

  } catch (err) {
    console.error('Error during migration:', err.message);
  } finally {
    pool.end();
  }
}

createRolesTable();
