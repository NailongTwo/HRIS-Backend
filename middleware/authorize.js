const pool = require('../config/db');

/**
 * Express middleware to authorize a user based on dynamic database RBAC permissions.
 * @param {string} moduleCode - The unique system identifier for the module (e.g. 'employees', 'payslips')
 * @param {string} action - The action requested: 'view', 'create', 'edit', or 'delete'
 */
const authorize = (moduleCode, action) => {
  return async (req, res, next) => {
    // 1. Ensure user authentication middleware has already run and attached req.user
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Unauthorized: Missing session details.' });
    }

    try {
      // 2. Fetch the user's live role_id from the database to avoid "JWT State Lag"
      const userCheck = await pool.query(
        'SELECT role_id FROM users WHERE id = $1',
        [req.user.id]
      );

      if (userCheck.rows.length === 0) {
        return res.status(401).json({ message: 'Unauthorized: User not found in database.' });
      }

      const roleId = userCheck.rows[0].role_id;
      if (!roleId) {
        return res.status(403).json({ message: 'Forbidden: User has no role assigned.' });
      }

      // 3. Map actions to corresponding SQL boolean columns
      const actionMap = {
        view: 'can_view',
        create: 'can_create',
        edit: 'can_edit',
        delete: 'can_delete'
      };

      const flagColumn = actionMap[action.toLowerCase()];
      if (!flagColumn) {
        return res.status(400).json({ message: `Invalid authorization query action: ${action}` });
      }

      // 4. Query the live permissions for the role and module
      // We use a CROSS JOIN to ensure a module matches even if no role_permission mapping exists.
      const query = `
        SELECT 
          r.name AS role_name,
          r.status AS role_status,
          COALESCE(rp.${flagColumn}, false) AS has_permission
        FROM roles r
        CROSS JOIN modules m
        LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.module_id = m.id
        WHERE r.id = $1 AND m.code = $2;
      `;

      const result = await pool.query(query, [roleId, moduleCode]);

      if (result.rows.length === 0) {
        return res.status(403).json({ 
          message: `Forbidden: Module '${moduleCode}' not found or role configuration omitted.` 
        });
      }

      const { role_name, role_status, has_permission } = result.rows[0];

      // 5. Check role status
      if (role_status !== 'Active') {
        return res.status(403).json({
          message: `Forbidden: Role '${role_name}' is inactive.`
        });
      }

      // 6. Handle Super Admin absolute override bypass
      if (role_name === 'Super Admin') {
        return next();
      }

      // 7. Enforce strict boolean gate check
      if (!has_permission) {
        return res.status(403).json({
          message: `Forbidden: Role '${role_name}' is not authorized to ${action} module '${moduleCode}'.`
        });
      }

      // Execution allowed
      next();
    } catch (err) {
      console.error('RBAC Authorization Guard Error:', err);
      res.status(500).json({ message: 'Internal authorization validation error.', error: err.message });
    }
  };
};

module.exports = authorize;

