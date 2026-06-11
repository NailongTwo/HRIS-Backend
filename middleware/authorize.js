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
      // 2. Map actions to corresponding SQL boolean columns
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

      // 3. Query the user's designated role permissions
      const query = `
        SELECT 
          r.name as role_name,
          COALESCE(rp.${flagColumn}, false) as has_permission
        FROM users u
        JOIN roles r ON u.role_id = r.id
        LEFT JOIN role_permissions rp ON rp.role_id = r.id
        LEFT JOIN modules m ON rp.module_id = m.id
        WHERE u.id = $1 AND m.code = $2;
      `;

      const result = await pool.query(query, [req.user.id, moduleCode]);

      if (result.rows.length === 0) {
        // Fallback: If no module mapping exists, check if user's role is Super Admin
        const roleCheck = await pool.query(
          `SELECT r.name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`, 
          [req.user.id]
        );

        if (roleCheck.rows.length > 0 && roleCheck.rows[0].name === 'Super Admin') {
          return next(); // Super Admin has universal access
        }

        return res.status(403).json({ 
          message: `Forbidden: Denied access. Role configuration omitted for module '${moduleCode}'.` 
        });
      }

      const { role_name, has_permission } = result.rows[0];

      // 4. Handle Super Admin absolute override bypass
      if (role_name === 'Super Admin') {
        return next();
      }

      // 5. Enforce strict boolean gate check
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
