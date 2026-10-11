import { PoolClient } from 'pg';
import { pool } from '../db';
import { publish } from '../mq';

export type EventType = 'PaymentSucceeded' | 'PaymentFailed';
const ROUTING: Record<EventType, string> = {
  PaymentSucceeded: 'payment.succeeded',
  PaymentFailed: 'payment.failed',
};

/** Ghi event trong CUNG transaction voi thay doi trang thai don (Transactional Outbox). */
export async function enqueue(c: PoolClient, type: EventType, orderId: string, payload: Record<string, unknown>) {
  await c.query(
    `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
     VALUES ('payment_order', $1, $2, $3)`,
    [orderId, type, JSON.stringify({ orderId, ...payload })],
  );
}

async function flush() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(
      `SELECT * FROM outbox_events WHERE status='PENDING' ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
    );
    for (const r of rows) {
      await publish(
        ROUTING[r.event_type as EventType],
        { eventId: r.id, type: r.event_type, occurredAt: r.created_at, payload: r.payload },
        r.id,
      );
      await c.query(`UPDATE outbox_events SET status='PUBLISHED', published_at=now() WHERE id=$1`, [r.id]);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    console.error('[outbox] flush failed (will retry)', (e as Error).message);
  } finally {
    c.release();
  }
}

export function startOutboxPublisher() {
  setInterval(() => void flush(), 1000);
}
