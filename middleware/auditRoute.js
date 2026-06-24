const pool = require('../config/db');
const { VALID_TABLES } = require('../config/auditTables');

function extractIdFromUrl(url) {
  const match = url.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/|$)/);
  return match ? match[1] : null;
}

module.exports = function auditRoute(tableName) {
  if (!VALID_TABLES.includes(tableName)) {
    console.error(`[auditRoute] Invalid table_name "${tableName}" — audit disabled for this route`);
    return (req, res, next) => next();
  }

  return async (req, res, next) => {
    req._auditTable = tableName;
    req._auditHandled = false;

    const recordId = req.params.id || extractIdFromUrl(req.url);
    if (['PUT', 'PATCH', 'DELETE'].includes(req.method) && recordId) {
      try {
        const r = await pool.query(`SELECT row_to_json(t.*)::text AS data FROM "${tableName}" t WHERE id = $1`, [recordId]);
        req._auditOldValues = r.rows[0]?.data ? JSON.parse(r.rows[0].data) : null;
      } catch {
        req._auditOldValues = null;
      }
    }

    next();
  };
};
