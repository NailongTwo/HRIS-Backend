const pool = require('../config/db');
const { REDACTED_FIELDS, VALID_TABLES } = require('../config/auditTables');

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj;
  const clone = { ...obj };
  for (const key of REDACTED_FIELDS) {
    if (key in clone) clone[key] = '[REDACTED]';
  }
  return clone;
}

function sanitizeTable(tableName) {
  if (!VALID_TABLES.includes(tableName)) {
    throw new Error(`Invalid audit table name: ${tableName}`);
  }
  return tableName;
}

async function log({ action, table_name, record_id, old_values, new_values, changed_fields, remarks, req }) {
  req._auditHandled = true;

  if (!VALID_TABLES.includes(table_name)) {
    console.error(`[auditHelper] Invalid table_name: ${table_name}`);
    return;
  }

  try {
    await pool.query(
      `INSERT INTO audit_logs
       (user_id, employee_id, action, table_name, record_id, old_values, new_values, changed_fields, ip_address, user_agent, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        req?.user?.id || null,
        req?.user?.employee_id || null,
        action,
        table_name,
        record_id || null,
        old_values ? JSON.stringify(redact(old_values)) : null,
        new_values ? JSON.stringify(redact(new_values)) : null,
        changed_fields || null,
        req?.ip || null,
        req?.headers?.['user-agent'] || null,
        remarks || null,
      ]
    );
  } catch (err) {
    console.error('[auditHelper] Failed to write audit entry:', err.message);
  }
}

module.exports = { log, redact };
