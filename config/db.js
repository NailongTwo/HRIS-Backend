const { Pool, types } = require('pg');
require('dotenv').config();

// Prevent pg from converting DATE columns into JS Date objects (which get
// shifted by the server's local timezone on JSON serialization). Keep dates
// as plain "YYYY-MM-DD" strings instead.
types.setTypeParser(1082, (val) => val);

const poolConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: parseInt(process.env.DB_PORT) || 5432,
    };

const pool = new Pool({
  ...poolConfig,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Swallow pool-level errors so the server never crashes on a dropped connection
pool.on('error', (err) => {
  console.warn('[DB Pool] Idle client error (will reconnect):', err.message);
});

// Warm up DB connection on startup — non-blocking, retries a few times
const warmUp = async (attempts = 0) => {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Connected to PostgreSQL!');
  } catch (err) {
    if (attempts < 5) {
      const delay = (attempts + 1) * 3000; // 3s, 6s, 9s, 12s, 15s
      console.warn(`[DB] Startup ping failed (attempt ${attempts + 1}/5): ${err.message}. Retrying in ${delay / 1000}s...`);
      setTimeout(() => warmUp(attempts + 1), delay);
    } else {
      console.error('[DB] Could not connect after 5 attempts. Queries will retry on demand.');
    }
  }
};

warmUp();

module.exports = pool;