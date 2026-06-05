const { Pool } = require('pg');

const config = {
  host: 'dpg-d7tc6h67r5hc738jb3b0-a.oregon-postgres.render.com',
  user: 'user',
  password: 'cQFMtpi99QcVDUq5Uu7YgfH22ckAn9YN',
  database: 'hris_db_tb2f',
  port: 5432,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000
};

async function testWithRetries() {
  for (let i = 1; i <= 5; i++) {
    console.log(`Connection attempt ${i}...`);
    const pool = new Pool(config);
    pool.on('error', (err) => {
      console.log(`Pool error event: ${err.message}`);
    });
    
    try {
      const client = await pool.connect();
      console.log("Successfully connected to the database!");
      
      const res = await client.query("SELECT NOW()");
      console.log(`Database time: ${res.rows[0].now}`);
      
      client.release();
      await pool.end();
      return;
    } catch (err) {
      console.error(`Attempt ${i} failed:`, err.message);
      await pool.end();
      // Wait 3 seconds
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

testWithRetries();
