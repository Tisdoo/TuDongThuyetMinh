import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AppError } from '../common';
import { pool, tx } from '../db';
import { enqueue } from './outbox';
import { verifySignature } from './payoo';

const PayooEvent = z.object({
  eventId: z.string().min(1).max(100),
  orderCode: z.string().min(1).max(12),
  status: z.enum(['SUCCESS', 'FAILED']),
  amount: z.number(),
  providerTxnId: z.string().max(100).optional(),
});

/**
 * UC-S01: xu ly webhook. Thu tu: xac thuc chu ky -> chong trung (event_id) -> khoa don -> doi chieu so tien -> doi trang thai + outbox.
 * Tra ve 200 cho moi truong hop da xu ly/bo qua hop le de Payoo khong retry vo han.
 */
export async function handlePayooWebhook(rawBody: string, signature: string | undefined) {
  if (!verifySignature(rawBody, signature)) {
    await pool.query(
      `INSERT INTO webhook_events (provider, event_id, payload, signature_valid, note)
       VALUES ('PAYOO', $1, $2, false, 'INVALID_SIGNATURE')`,
      [`INVALID:${randomUUID()}`, safeJson(rawBody)],
    );
    console.warn('[webhook] invalid signature rejected');
    throw new AppError(400, 'INVALID_SIGNATURE');
  }
  const evt = PayooEvent.parse(JSON.parse(rawBody));

  return tx(async (c) => {
    const ins = await c.query(
      `INSERT INTO webhook_events (provider, event_id, payload, signature_valid)
       VALUES ('PAYOO', $1, $2, true) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
      [evt.eventId, rawBody],
    );
    if (!ins.rows[0]) return { result: 'DUPLICATE_IGNORED' };
    const webhookId = ins.rows[0].id;
    const done = (note: string) =>
      c.query(`UPDATE webhook_events SET processed=true, processed_at=now(), note=$2 WHERE id=$1`, [webhookId, note]);

    const { rows } = await c.query('SELECT * FROM payment_orders WHERE order_code=$1 FOR UPDATE', [evt.orderCode]);
    const o = rows[0];
    if (!o) { await done('ORDER_NOT_FOUND'); return { result: 'ORDER_NOT_FOUND' }; }

    if (evt.status === 'SUCCESS') {
      if (Number(o.amount) !== evt.amount) {
        await done('AMOUNT_MISMATCH');
        console.error(`[webhook] amount mismatch order=${o.order_code} expected=${o.amount} got=${evt.amount}`);
        return { result: 'AMOUNT_MISMATCH' };
      }
      if (o.status === 'PAID') { await done('ALREADY_PAID'); return { result: 'ALREADY_PAID' }; }
      if (o.status !== 'PENDING') {
        // Khach tra tien sau khi don het han/huy: can doi soat thu cong
        await done(`LATE_PAYMENT_REVIEW:${o.status}`);
        console.error(`[webhook] payment for non-pending order ${o.order_code} (${o.status})`);
        return { result: 'NEEDS_REVIEW' };
      }
      await c.query(`UPDATE payment_orders SET status='PAID', paid_at=now(), updated_at=now() WHERE id=$1`, [o.id]);
      await c.query(
        `UPDATE payment_transactions SET status='SUCCESS', completed_at=now()
          WHERE order_id=$1 AND provider='PAYOO'`, [o.id]);
      await enqueue(c, 'PaymentSucceeded', o.id, { orderCode: o.order_code, channel: 'ONLINE' });
      await done('PAID');
      return { result: 'PAID' };
    }

    // FAILED
    if (o.status === 'PENDING') {
      await c.query(`UPDATE payment_orders SET status='FAILED', updated_at=now() WHERE id=$1`, [o.id]);
      await c.query(
        `UPDATE payment_transactions SET status='FAILED', completed_at=now()
          WHERE order_id=$1 AND provider='PAYOO'`, [o.id]);
      await enqueue(c, 'PaymentFailed', o.id, { orderCode: o.order_code, channel: 'ONLINE', reason: 'PAYOO_FAILED' });
    }
    await done('FAILED');
    return { result: 'FAILED' };
  });
}

function safeJson(raw: string) {
  try { return JSON.stringify(JSON.parse(raw)); } catch { return JSON.stringify({ raw: raw.slice(0, 2000) }); }
}
