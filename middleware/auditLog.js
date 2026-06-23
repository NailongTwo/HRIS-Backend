const pool = require('../config/db');
const { REDACTED_FIELDS, VALID_TABLES } = require('../config/auditTables');

const METHOD_ACTION_MAP = {
  POST: 'INSERT',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

const ACTION_VERBS = {
  INSERT: 'Created', UPDATE: 'Updated', DELETE: 'Deleted',
  LOGIN: 'Logged in', LOGOUT: 'Logged out',
  APPROVE: 'Approved', REJECT: 'Rejected',
  EXPORT: 'Exported', UPLOAD: 'Uploaded', ACKNOWLEDGE: 'Acknowledged',
};

const TABLE_LABELS = {
  users: 'user', employees: 'employee', departments: 'department', positions: 'position',
  attendance_logs: 'attendance log', leave_requests: 'leave request',
  leave_credits: 'leave credit', leave_ledger: 'leave ledger entry',
  overtime_requests: 'overtime request', tasks: 'task', task_comments: 'task comment',
  announcements: 'announcement', events: 'event', event_types: 'event type',
  pay_periods: 'pay period', payslips: 'payslip', payslip_line_items: 'payslip line',
  employee_documents: 'document', document_types: 'document type',
  notifications: 'notification', feedback: 'feedback',
  recognitions: 'recognition', surveys: 'survey',
  performance_evaluations: 'evaluation', goals: 'goal', kpis: 'KPI',
  work_schedules: 'work schedule', work_schedule_days: 'work schedule day',
  roles: 'role', role_permissions: 'permission mapping',
  compensation_records: 'compensation record',
  employment_records: 'employment record',
  employee_government_ids: 'government ID',
  modules: 'module', hr_policies: 'policy', approval_workflows: 'workflow',
  audit_logs: 'audit log',
};

function extractName(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (obj.name) return obj.name;
  if (obj.title) return obj.title;
  if (obj.code) return obj.code;
  if (obj.label) return obj.label;
  if (obj.period_label) return obj.period_label;
  if (obj.file_name) return obj.file_name;
  if (obj.first_name) return `${obj.first_name} ${obj.last_name || ''}`.trim();
  if (obj.employee_no) return obj.employee_no;
  if (obj.reference_no) return obj.reference_no;
  if (obj.leave_type_name) return obj.leave_type_name;
  if (obj.description) return obj.description.length > 40 ? obj.description.slice(0, 40) + '...' : obj.description;
  return '';
}

function generateSummary(action, tableName, newValues, oldValues) {
  const verb = ACTION_VERBS[action] || action;
  const label = TABLE_LABELS[tableName] || tableName.replace(/_/g, ' ');
  const values = newValues || oldValues || {};
  const name = extractName(values);
  if (name) return `${verb} ${label} "${name}"`;
  if (values.flag) return `${verb} ${label} (${values.flag})`;
  if (values.transaction_type) return `${verb} ${label} (${values.transaction_type})`;
  return `${verb} ${label}`;
}

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
    const summary = generateSummary(action, tableName, newValues, oldValues);

    await pool.query(
      `INSERT INTO audit_logs
       (user_id, employee_id, action, table_name, record_id, old_values, new_values, changed_fields, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        req.user?.id || null,
        req.user?.employee_id || null,
        action,
        tableName,
        recordId,
        oldValues ? JSON.stringify(redact(oldValues)) : null,
        newValues ? JSON.stringify(redact(newValues)) : null,
        changedFields,
        summary,
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
