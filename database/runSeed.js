const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const poolConfig = process.env.DIRECT_URL
  ? { connectionString: process.env.DIRECT_URL }
  : {
      host: 'aws-1-ap-southeast-1.pooler.supabase.com',
      port: 5432,
      database: 'postgres',
      user: 'postgres.hzopojcqjypasauqkzwc',
      password: 'ox9Poh9qg9lw1nb2',
    };

const pool = new Pool({
  ...poolConfig,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function runSeed() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
    await pool.query(sql);
    console.log('Seed data inserted successfully!');
  } catch (err) {
    console.log('Error:', err.message);
  } finally {
    pool.end();
  }
}

runSeed();