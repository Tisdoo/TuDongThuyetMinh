import { pool } from './db';
import { DomainEvent } from './mq';
import { cancelGrant, markGrantPaid } from './services/grants';

// Consumer idempotent: event_id da xu ly thi bo qua; loi thi go dau de retry.
export async function handleEvent(evt: DomainEvent) {
  const ins = await pool.query('INSERT INTO processed_events(event_id) VALUES ($1) ON CONFLICT DO NOTHING', [evt.eventId]);
  if (ins.rowCount === 0) return;
  try {
    switch (evt.type) {
      case 'PaymentSucceeded':
        await markGrantPaid(evt.payload.orderId);
        break;
      case 'PaymentFailed':
        await cancelGrant(evt.payload.orderId, evt.payload.reason ?? 'PAYMENT_FAILED');
        break;
      default:
        console.warn('[events] ignored', evt.type);
    }
  } catch (e) {
    await pool.query('DELETE FROM processed_events WHERE event_id=$1', [evt.eventId]);
    throw e;
  }
}
