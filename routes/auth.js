const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

// TEMPORARY MOCK LOGIN - for testing only
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // Test credentials - remove this when database is ready
  if (email === 'admin@highlysucceed.com' && password === 'password123') {
    const token = jwt.sign(
      { id: '123', role: 'Admin', employee_no: 'HS-001' },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
    return res.json({ token, role: 'Admin', employee_no: 'HS-001' });
  }

  if (email === 'employee@highlysucceed.com' && password === 'password123') {
    const token = jwt.sign(
      { id: '456', role: 'Employee', employee_no: 'HS-002' },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
    return res.json({ token, role: 'Employee', employee_no: 'HS-002' });
  }

  return res.status(401).json({ message: 'Invalid email or password' });
});

module.exports = router;