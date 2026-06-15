const { Pool } = require('pg');

const pool = new Pool({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  user: 'postgres.hzopojcqjypasauqkzwc',
  password: 'ox9Poh9qg9lw1nb2',
  database: 'postgres',
  port: 6543,
  ssl: { rejectUnauthorized: false }
});

async function createPerformanceTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS performance_goals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID REFERENCES employees(id),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        target_date DATE,
        status VARCHAR(20) DEFAULT 'In Progress',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS kpi_tracking (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID REFERENCES employees(id),
        goal_id UUID REFERENCES performance_goals(id) ON DELETE SET NULL,
        kpi_name VARCHAR(255) NOT NULL,
        target_value NUMERIC,
        actual_value NUMERIC DEFAULT 0,
        unit VARCHAR(50),
        period VARCHAR(50),
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS performance_evaluations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID REFERENCES employees(id),
        evaluator_id UUID REFERENCES employees(id),
        period VARCHAR(100) NOT NULL,
        evaluation_date DATE DEFAULT CURRENT_DATE,
        overall_rating NUMERIC(3,1),
        strengths TEXT,
        improvements TEXT,
        comments TEXT,
        status VARCHAR(20) DEFAULT 'Draft',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS performance_appraisals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        evaluation_id UUID REFERENCES performance_evaluations(id) ON DELETE CASCADE,
        employee_id UUID REFERENCES employees(id),
        category VARCHAR(100) NOT NULL,
        rating NUMERIC(3,1),
        remarks TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Performance tables created successfully!');
  } catch (e) {
    console.log('Error:', e.message);
  } finally {
    pool.end();
  }
}

createPerformanceTables();