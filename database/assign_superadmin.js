/**
 * assign_superadmin.js
 * Assigns Super Admin role to a specific user by email, against any target database.
 *
 * Usage:
 *   node database/assign_superadmin.js "<DATABASE_URL>" "<email>"
 *
 * Example (local Supabase):
 *   node database/assign_superadmin.js "postgresql://..." "admin123@highlysucceed.com"
 */

const { Pool } = require('pg');

const targetUrl = process.argv[2];
const targetEmail = process.argv[3];

if (!targetUrl || !targetEmail) {
  console.error('❌ Usage: node database/assign_superadmin.js "<DATABASE_URL>" "<email>"');
  process.exit(1);
}

const pool = new Pool({
  connectionString: targetUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
});

async function assignSuperAdmin() {
  const client = await pool.connect();
  try {
    console.log(`\n🔑 Assigning Super Admin role to: ${targetEmail}`);

    // Check user exists
    const userCheck = await client.query(
      `SELECT id, email, role FROM users WHERE email = $1`, [targetEmail]
    );
    if (userCheck.rows.length === 0) {
      console.error(`❌ No user found with email: ${targetEmail}`);
      process.exit(1);
    }
    const user = userCheck.rows[0];
    console.log(`   Found user: ${user.email} (current role: ${user.role})`);

    // Get Super Admin role id
    const roleCheck = await client.query(
      `SELECT id FROM roles WHERE name = 'Super Admin'`
    );
    if (roleCheck.rows.length === 0) {
      console.error(`❌ 'Super Admin' role not found. Have you run the RBAC migration yet?`);
      process.exit(1);
    }
    const superAdminRoleId = roleCheck.rows[0].id;

    // Update user
    await client.query(
      `UPDATE users SET role_id = $1, role = 'Super Admin' WHERE id = $2`,
      [superAdminRoleId, user.id]
    );

    console.log(`✅ Successfully assigned Super Admin to ${targetEmail}`);
    console.log(`   role_id: ${superAdminRoleId}`);
  } catch (err) {
    console.error('❌ Failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

assignSuperAdmin();
