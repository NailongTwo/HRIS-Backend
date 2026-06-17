const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// 0. GET roles as lightweight list (id + name only) — for dropdowns, any authenticated user
router.get('/simple', auth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, name FROM roles WHERE status = 'Active' ORDER BY name ASC`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// 1. GET all roles (with user count)
// Gated: only users with view rights on 'role_permission' can view roles
router.get('/', auth, authorize('role_permission', 'view'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.name, r.description as desc, r.status, COUNT(u.id)::int as users
      FROM roles r
      LEFT JOIN users u ON u.role_id = r.id
      GROUP BY r.id, r.name, r.description, r.status
      ORDER BY r.name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// 2. CREATE role (with optional duplication from template role)
// Gated: requires create rights on 'role_permission'
router.post('/', auth, authorize('role_permission', 'create'), async (req, res) => {
  const { name, desc, status, copy_role_id } = req.body;
  
  if (!name || name.trim() === '') {
    return res.status(400).json({ message: 'Role name is required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Add value to user_role_type enum if it doesn't exist to maintain backward compatibility
    try {
      await client.query(`ALTER TYPE user_role_type ADD VALUE '${name}'`);
    } catch (enumErr) {
      // Ignore if value already exists
    }

    // Insert the role
    const roleInsertQuery = `
      INSERT INTO roles (name, description, status) 
      VALUES ($1, $2, $3) 
      ON CONFLICT (name) DO UPDATE SET description = $2, status = $3
      RETURNING *
    `;
    const roleResult = await client.query(roleInsertQuery, [name, desc, status || 'Active']);
    const newRole = roleResult.rows[0];

    // Seed or copy permissions
    if (copy_role_id) {
      // Copy permission flags from template role, defaulting missing ones to false
      const permissionCopyQuery = `
        INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
        SELECT 
          $1::uuid, 
          m.id, 
          COALESCE(rp.can_view, false), 
          COALESCE(rp.can_create, false), 
          COALESCE(rp.can_edit, false), 
          COALESCE(rp.can_delete, false)
        FROM modules m
        LEFT JOIN role_permissions rp ON rp.module_id = m.id AND rp.role_id = $2::uuid;
      `;
      await client.query(permissionCopyQuery, [newRole.id, copy_role_id]);
    } else {
      // Default: seed all false permissions for all modules
      const permissionInitQuery = `
        INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
        SELECT $1, id, false, false, false, false FROM modules;
      `;
      await client.query(permissionInitQuery, [newRole.id]);
    }

    await client.query('COMMIT');
    res.status(201).json({ ...newRole, desc: newRole.description, users: 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
});

// 3. GET specific role's permission matrix checkbox states
// Gated: requires view rights on 'role_permission'
router.get('/:id/permissions', auth, authorize('role_permission', 'view'), async (req, res) => {
  try {
    const query = `
      SELECT 
        m.code as module_code,
        m.name as module_name,
        m.parent_group,
        COALESCE(rp.can_view, false) as can_view,
        COALESCE(rp.can_create, false) as can_create,
        COALESCE(rp.can_edit, false) as can_edit,
        COALESCE(rp.can_delete, false) as can_delete
      FROM modules m
      LEFT JOIN role_permissions rp ON rp.module_id = m.id AND rp.role_id = $1
      ORDER BY m.parent_group ASC, m.sort_order ASC;
    `;
    const result = await pool.query(query, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// 4. PUT update and batch-save the edited matrix layout
// Gated: requires edit rights on 'role_permission'
router.put('/:id/permissions', auth, authorize('role_permission', 'edit'), async (req, res) => {
  const roleId = req.params.id;
  const { permissions } = req.body;

  if (!Array.isArray(permissions)) {
    return res.status(400).json({ message: 'Permissions must be an array.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure role exists
    const roleCheck = await client.query('SELECT name FROM roles WHERE id = $1', [roleId]);
    if (roleCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Role not found' });
    }

    const moduleCodes = [];
    const canView = [];
    const canCreate = [];
    const canEdit = [];
    const canDelete = [];

    permissions.forEach(p => {
      moduleCodes.push(p.module_code);
      canView.push(!!p.can_view);
      canCreate.push(!!p.can_create);
      canEdit.push(!!p.can_edit);
      canDelete.push(!!p.can_delete);
    });

    const upsertQuery = `
      INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
      SELECT 
        $1::uuid, 
        m.id, 
        val.can_view::boolean, 
        val.can_create::boolean, 
        val.can_edit::boolean, 
        val.can_delete::boolean
      FROM unnest($2::text[], $3::boolean[], $4::boolean[], $5::boolean[], $6::boolean[]) 
        AS val(module_code, can_view, can_create, can_edit, can_delete)
      JOIN modules m ON m.code = val.module_code
      ON CONFLICT (role_id, module_id) DO UPDATE SET
        can_view = EXCLUDED.can_view,
        can_create = EXCLUDED.can_create,
        can_edit = EXCLUDED.can_edit,
        can_delete = EXCLUDED.can_delete,
        updated_at = NOW();
    `;

    await client.query(upsertQuery, [
      roleId, 
      moduleCodes, 
      canView, 
      canCreate, 
      canEdit, 
      canDelete
    ]);

    await client.query('COMMIT');
    res.json({ message: 'Permissions saved successfully.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
});

// 5. UPDATE role details (name, desc, status)
// Gated: requires edit rights on 'role_permission'
router.put('/:id', auth, authorize('role_permission', 'edit'), async (req, res) => {
  const { name, desc, status } = req.body;
  try {
    const result = await pool.query(
      `UPDATE roles 
       SET name = $1, description = $2, status = $3, updated_at = NOW() 
       WHERE id = $4 
       RETURNING *`,
      [name, desc, status, req.params.id]
    );
    
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Role not found' });
    }

    try {
      await pool.query(`ALTER TYPE user_role_type ADD VALUE '${name}'`);
    } catch (enumErr) {
      // Ignore if value already exists
    }

    res.json({ ...result.rows[0], desc: result.rows[0].description });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// 6. DELETE role
// Gated: requires delete rights on 'role_permission'
router.delete('/:id', auth, authorize('role_permission', 'delete'), async (req, res) => {
  try {
    const roleCheck = await pool.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);
    if (!roleCheck.rows[0]) {
      return res.status(404).json({ message: 'Role not found' });
    }

    if (roleCheck.rows[0].name === 'Super Admin' || roleCheck.rows[0].name === 'Admin') {
      return res.status(400).json({ message: 'Default Admin/Super Admin roles cannot be deleted.' });
    }

    await pool.query('DELETE FROM roles WHERE id = $1', [req.params.id]);
    res.json({ message: 'Role deleted successfully!' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
