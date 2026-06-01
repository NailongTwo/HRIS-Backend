const pool = require('../config/db');

async function seedAuditLogs() {
  try {
    console.log('Seeding audit logs...');
    
    // We get the user IDs
    const usersResult = await pool.query('SELECT id, username, role FROM users');
    const users = usersResult.rows;
    
    const adminUser = users.find(u => u.role === 'Admin' || u.role === 'Super Admin') || users[0];
    const hrUser = users.find(u => u.role === 'HR') || users[0];
    const employeeUser = users.find(u => u.role === 'Employee') || users[0];

    // Seed some mock audit logs
    // actions: 'INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'APPROVE', 'REJECT', 'UPLOAD', 'ACKNOWLEDGE'
    await pool.query(`
      INSERT INTO audit_logs (user_id, action, table_name, record_id, ip_address, user_agent, remarks, created_at)
      VALUES
      ($1, 'INSERT', 'employees', 'aaaa1111-1111-1111-1111-111111111111', '192.168.1.1', 'Mozilla/5.0', 'Created employee John Doe', NOW() - INTERVAL '2 hours'),
      ($2, 'UPDATE', 'leave_requests', '22222222-2222-2222-2222-222222222222', '192.168.1.7', 'Mozilla/5.0', 'Approved leave request #5', NOW() - INTERVAL '4 hours'),
      ($1, 'INSERT', 'announcements', '33333333-3333-3333-3333-333333333333', '192.168.1.1', 'Mozilla/5.0', 'Created announcement Q1 HR Performance Review', NOW() - INTERVAL '5 hours'),
      ($3, 'LOGIN', 'users', $3, '192.168.1.3', 'Mozilla/5.0', 'User logged in', NOW() - INTERVAL '1 day'),
      ($2, 'DELETE', 'notifications', '11111111-1111-1111-1111-111111111111', '192.168.1.1', 'Mozilla/5.0', 'Deleted notification #92', NOW() - INTERVAL '1 day'),
      ($1, 'UPDATE', 'employees', 'aaaa3333-3333-3333-3333-333333333333', '192.168.1.1', 'Mozilla/5.0', 'Updated employee Bob Santos details', NOW() - INTERVAL '2 days')
    `, [adminUser.id, hrUser.id, employeeUser.id]);
    
    console.log('Audit logs seeded successfully.');
  } catch (err) {
    console.error('Error seeding audit logs:', err.message);
  } finally {
    pool.end();
  }
}

seedAuditLogs();
