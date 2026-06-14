const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('modules','role_permissions','roles') ORDER BY table_name`)
  .then(r => { console.log('RBAC Tables found:', JSON.stringify(r.rows)); })
  .then(() => pool.query(`SELECT COUNT(*) as cnt FROM modules`))
  .then(r => console.log('Modules count:', r.rows[0].cnt))
  .then(() => pool.query(`SELECT u.email, r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.email='admin123@highlysucceed.com'`))
  .then(r => console.log('Admin user role:', JSON.stringify(r.rows[0])))
  .catch(e => console.error('Error:', e.message))
  .finally(() => pool.end());
