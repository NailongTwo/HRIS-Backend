const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const cron = require('node-cron');
const sendEventReminders = require('./cron/eventReminders');
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/leave', require('./routes/leave'));
app.use('/api/leave-ledger', require('./routes/leaveLedger'));
app.use('/api/overtime', require('./routes/overtime'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/payslips', require('./routes/payslips'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/positions', require('./routes/positions'));
app.use('/api/events', require('./routes/events'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/doc-requirements', require('./routes/docRequirements'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/roles', require('./routes/roles'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/audit-logs', require('./routes/auditLogs'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/recognitions', require('./routes/recognitions'));
app.use('/api/surveys', require('./routes/surveys'));
app.use('/api/performance', require('./routes/performance'));
app.use('/api/compensation', require('./routes/compensation'));
app.use('/api/work-schedules', require('./routes/workSchedules'));

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'HRIS Backend is running!' });
});

// Version canary — update this timestamp to confirm Render redeploy
app.get('/version', (req, res) => {
  res.json({ version: '2026-06-15T12:30:00Z', feature: 'auto-flag-adjust-v2' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ── Cron: send event reminders every day at 8:00 AM PHT (0:00 UTC) ──
cron.schedule('0 0 * * *', () => {
  console.log('[CRON] Running daily event reminders...');
  sendEventReminders();
});
console.log('[CRON] Event reminder job scheduled (daily at 8:00 AM PHT).');