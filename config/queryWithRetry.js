const pool = require('./db');

const RETRYABLE_MSGS = [
  'connection terminated',
  'connection reset',
  'terminating connection',
  'server closed the connection',
  'econnreset',
  'econnrefused',
  'etimedout',
  'connection refused',
  'ssl connection has been closed',
  'network error',
];

function isRetryable(err) {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toLowerCase();
  return RETRYABLE_MSGS.some(m => msg.includes(m) || code.includes(m));
}

/**
 * Run a parameterised query with automatic retry on transient DB errors.
 * Delays are generous (2s, 5s, 10s) to allow Render free-tier DB to wake up.
 *
 * @param {string} text   - SQL query string
 * @param {Array}  params - Query parameters
 * @param {number} [retries=4] - Max retry attempts
 */
async function queryWithRetry(text, params, retries = 4) {
  const delays = [2000, 5000, 8000, 10000]; // ms between each retry
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      lastErr = err;
      if (isRetryable(err) && attempt < retries) {
        const delay = delays[attempt] || 5000;
        console.warn(`[DB] Retryable error on attempt ${attempt + 1}/${retries + 1}: "${err.message}". Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        if (!isRetryable(err)) {
          // Non-retryable (syntax error, constraint, etc.) — fail immediately
          throw err;
        }
        break;
      }
    }
  }
  throw lastErr;
}

module.exports = queryWithRetry;
