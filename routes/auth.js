const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

/*

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

*/

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  console.log(`Attempting login for: [${email}]`);

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (userResult.rows.length === 0) {
      console.log("No user found with that email in DB.");
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = userResult.rows[0];
    console.log("User found. Comparing passwords...");

    const isMatch = await bcrypt.compare(password, user.password_hash);
    console.log("Password match result:", isMatch);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    

    // 3. Create the JWT token using DB data
    const token = jwt.sign(
      { id: user.id, role: user.role, employee_no: user.employee_no },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    // 4. Send response back to frontend
    res.json({ 
      token, 
      role: user.role, 
      employee_no: user.employee_no 
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
