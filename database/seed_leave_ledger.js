require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingLedger = await client.query('SELECT COUNT(*) FROM leave_ledger');
    if (parseInt(existingLedger.rows[0].count) > 0) {
      console.log('Leave ledger already seeded. Skipping.');
      await client.query('ROLLBACK');
      return;
    }

    // Auto-seed leave_policies if empty
    const policyCount = await client.query('SELECT COUNT(*) FROM leave_policies');
    if (parseInt(policyCount.rows[0].count) === 0) {
      const leaveTypes = await client.query("SELECT id, code FROM leave_types WHERE code IN ('VL','SL','EL')");
      for (const lt of leaveTypes.rows) {
        for (const empType of ['Full-Time', 'Probationary']) {
          const entitlement = lt.code === 'EL' ? 5 : 15;
          await client.query(
            `INSERT INTO leave_policies (leave_type_id, employment_type, annual_entitlement, accrual_method,
             waiting_period_days, min_service_months, effective_date, max_carry_over, allow_negative_balance)
             VALUES ($1, $2, $3, 'Lump Sum', 0, 0, '2026-01-01', $4, true)
             ON CONFLICT DO NOTHING`,
            [lt.id, empType, entitlement, lt.code === 'VL' ? 5 : 0]
          );
        }
      }
    }

    // Backfill ledger from existing leave_credits
    const credits = await client.query(
      `SELECT lc.*, e.user_id FROM leave_credits lc JOIN employees e ON lc.employee_id = e.id WHERE lc.year = EXTRACT(YEAR FROM CURRENT_DATE)`
    );

    for (const c of credits.rows) {
      const total = Number(c.total_credits) + Number(c.carried_over || 0);

      if (total > 0) {
        await client.query(
          `INSERT INTO leave_ledger (employee_id, leave_type_id, transaction_date, transaction_type, amount, balance_after, remarks)
           VALUES ($1, $2, $3, 'Allocation', $4, $4, $5)`,
          [c.employee_id, c.leave_type_id, `${c.year}-01-01 00:00:00+08`, total, `Annual allocation ${c.year}`]
        );
      }

      const used = Number(c.used_credits || 0);
      if (used > 0) {
        await client.query(
          `INSERT INTO leave_ledger (employee_id, leave_type_id, transaction_date, transaction_type, amount, balance_after, remarks)
           VALUES ($1, $2, $3, 'Usage', $4, $5, $6)`,
          [c.employee_id, c.leave_type_id, `${c.year}-06-15 08:00:00+08`, -used, Math.max(0, total - used),
           'Leave used (synthetic entry)']
        );
      }
    }

    await client.query('COMMIT');
    console.log(`Seeded ${credits.rows.length} ledger entries.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
