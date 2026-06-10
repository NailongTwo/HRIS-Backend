const { Pool } = require('pg');

const pool = new Pool({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  user: 'postgres.hzopojcqjypasauqkzwc',
  password: 'ox9Poh9qg9lw1nb2',
  database: 'postgres',
  port: 6543,
  ssl: { rejectUnauthorized: false }
});

pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'overtime_requests'")
  .then(r => {
    console.log('overtime_requests columns:');
    r.rows.forEach(row => console.log('-', row.column_name));
    pool.end();
  })
  .catch(e => {
    console.log('Error:', e.message);
    pool.end();
  });