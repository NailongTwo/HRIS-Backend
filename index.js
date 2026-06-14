const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
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
app.use('/api/compensation', require('./routes/compensation'));
// Test route
app.get('/', (req, res) => {
  res.json({ message: 'HRIS Backend is running!' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
