const pool = require('../config/db');
const { REDACTED_FIELDS, VALID_TABLES } = require('../config/auditTables');

const METHOD_ACTION_MAP = {
  POST: 'INSERT',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

function redact(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const clone = { ...obj };
  for (const key of REDACTED_FIELDS) {
    if (key in clone) clone[key] = '[REDACTED]';
  }
  return clone;
}

function extractRecordId(body, req) {
  if (body?.id) return body.id;
  if (body?.employee_id) return body.employee_id;
  if (body?.user_id) return body.user_id;
  if (body?.record_id) return body.record_id;
  if (body?.ledger_id) return body.ledger_id;
  return req.params.id || null;
}

function extractNewValues(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.id) return body;
  const wrapped = Object.values(body).find(v => v && typeof v === 'object' && (v.id || v.employee_id || v.user_id));
  if (wrapped) return wrapped;
  if (body.employee_id || body.user_id || body.ledger_id) return body;
  return null;
}

function computeChangedFields(oldValues, newValues) {
  if (!oldValues || !newValues) return null;
  const changed = [];
  for (const key of Object.keys(newValues)) {
    if (key === 'id' || REDACTED_FIELDS.includes(key)) continue;
    const oldVal = oldValues[key];
    const newVal = newValues[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changed.push(key);
    }
  }
  return changed.length > 0 ? changed : null;
}

async function writeAuditLog({ req, action, tableName, recordId, oldValues, newValues }) {
  try {
    const changedFields = action === 'UPDATE' ? computeChangedFields(oldValues, newValues) : null;

    await pool.query(
      `INSERT INTO audit_logs
       (user_id, employee_id, action, table_name, record_id, old_values, new_values, changed_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.user?.id || null,
        req.user?.employee_id || null,
        action,
        tableName,
        recordId,
        oldValues ? JSON.stringify(redact(oldValues)) : null,
        newValues ? JSON.stringify(redact(newValues)) : null,
        changedFields,
      ]
    );
  } catch (err) {
    console.error('[auditLog] Failed to write audit entry:', err.message);
  }
}

module.exports = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (!req._auditHandled && req._auditTable && res.statusCode < 300) {
      const action = METHOD_ACTION_MAP[req.method] || 'UPDATE';
      const recordId = extractRecordId(body, req);
      const newValues = action === 'INSERT' || action === 'UPDATE' ? extractNewValues(body) : null;
      const oldValues = (action === 'UPDATE' || action === 'DELETE') ? req._auditOldValues || null : null;

      writeAuditLog({
        req,
        action,
        tableName: req._auditTable,
        recordId,
        oldValues,
        newValues,
      });
    }

    return originalJson(body);
  };

  next();
};
