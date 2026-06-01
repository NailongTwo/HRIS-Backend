const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

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
    console.log("Stored hash:", user.password_hash);
    console.log("Password received:", password);
    console.log("Password match result:", isMatch);
    // NEW: fetch employee_id linked to this user
    const empResult = await pool.query(
      'SELECT id FROM employees WHERE user_id = $1', 
      [user.id]
    );
    const employee_id = empResult.rows[0]?.id || null;

    // 3. Create the JWT token using DB data
    const token = jwt.sign(
      { id: user.id, employee_id, role: user.role, employee_no: user.employee_no },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    // 4. Send response back to frontend
    res.json({ 
      token, 
      role: user.role, 
      employee_no: user.employee_no,
      employee_id,        // NEW
      email: user.email   // NEW
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
