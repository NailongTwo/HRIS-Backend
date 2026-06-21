// cron/eventReminders.js — Daily event reminder notifications
const query = require('../config/queryWithRetry');

// ── Silent notification insert (same helper used elsewhere) ──
async function notify({ recipientId, type, title, message, entityType, entityId }) {
  if (!recipientId) return;
  try {
    await query(
      `INSERT INTO notifications (recipient_id, type, title, message, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [recipientId, type, title, message, entityType, entityId]
    );
  } catch (err) {
    console.warn('[eventReminder:notify] Failed:', err.message);
  }
}

async function sendEventReminders() {
  try {
    // ── 1. Get events happening TODAY ──
    const todayEvents = await query(
      `SELECT e.*, et.name as event_type_name
       FROM events e
       JOIN event_types et ON e.event_type_id = et.id
       WHERE e.is_active = true
         AND (e.start_datetime AT TIME ZONE 'Asia/Manila')::date = (NOW() AT TIME ZONE 'Asia/Manila')::date`
    );

    // ── 2. Get events happening TOMORROW ──
    const tomorrowEvents = await query(
      `SELECT e.*, et.name as event_type_name
       FROM events e
       JOIN event_types et ON e.event_type_id = et.id
       WHERE e.is_active = true
         AND (e.start_datetime AT TIME ZONE 'Asia/Manila')::date = (NOW() AT TIME ZONE 'Asia/Manila')::date + INTERVAL '1 day'`
    );

    if (todayEvents.rows.length === 0 && tomorrowEvents.rows.length === 0) {
      console.log('[EventReminders] No events today or tomorrow. Skipping.');
      return;
    }

    // ── 3. Get ALL user IDs to notify ──
    const users = await query('SELECT id FROM users');
    const userIds = users.rows.map(u => u.id);

    // ── 4. Send "Event Today" notifications ──
    for (const event of todayEvents.rows) {
      // Deduplicate: skip if we already sent today's reminder for this event
      const alreadySent = await query(
        `SELECT id FROM notifications
         WHERE entity_type = 'event_reminder_today' AND entity_id = $1
           AND DATE(created_at) = CURRENT_DATE
         LIMIT 1`,
        [event.id]
      );
      if (alreadySent.rows.length > 0) continue;

      const startTime = event.is_all_day
        ? 'All Day'
        : new Date(event.start_datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

      for (const userId of userIds) {
        await notify({
          recipientId: userId,
          type: 'Event',
          title: `📅 Event Today: ${event.title}`,
          message: `${event.title} (${event.event_type_name}) is happening today.${event.is_all_day ? '' : ' Time: ' + startTime}${event.location ? ' | Location: ' + event.location : ''}`,
          entityType: 'event_reminder_today',
          entityId: event.id,
        });
      }
      console.log(`[EventReminders] Sent "today" reminder for: ${event.title}`);
    }

    // ── 5. Send "Event Tomorrow" notifications ──
    for (const event of tomorrowEvents.rows) {
      const alreadySent = await query(
        `SELECT id FROM notifications
         WHERE entity_type = 'event_reminder_tomorrow' AND entity_id = $1
           AND DATE(created_at) = CURRENT_DATE
         LIMIT 1`,
        [event.id]
      );
      if (alreadySent.rows.length > 0) continue;

      for (const userId of userIds) {
        await notify({
          recipientId: userId,
          type: 'Event',
          title: `🔔 Event Tomorrow: ${event.title}`,
          message: `Reminder: ${event.title} (${event.event_type_name}) is happening tomorrow.${event.location ? ' Location: ' + event.location : ''}`,
          entityType: 'event_reminder_tomorrow',
          entityId: event.id,
        });
      }
      console.log(`[EventReminders] Sent "tomorrow" reminder for: ${event.title}`);
    }

    console.log(`[EventReminders] Done. Today: ${todayEvents.rows.length} events, Tomorrow: ${tomorrowEvents.rows.length} events.`);
  } catch (err) {
    console.error('[EventReminders] Error:', err.message);
  }
}

module.exports = sendEventReminders;
