import { Router } from 'express';
import { z } from 'zod';
import { ah, clientIp } from '../common';
import { config } from '../config';
import { pool } from '../db';
import * as orders from '../services/orders';
import { handlePayooWebhook } from '../services/webhook';
import { signPayload } from '../services/payoo';

export const publicRouter = Router();

// Danh sach goi ve dang ban
publicRouter.get('/payments/products', ah(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT code, name, price::int AS price, currency, validity_hours
       FROM ticket_products WHERE is_active ORDER BY price`);
  res.json(rows);
}));

const OrderBody = z.object({
  productCode: z.string().min(1).max(30).default('DAY_PASS'),
  lang: z.string().max(10).optional(),
});

publicRouter.post('/payments/online', ah(async (req, res) => {
  const b = OrderBody.parse(req.body ?? {});
  res.status(201).json(await orders.startOnlineOrder(b.productCode, b.lang, clientIp(req)));
}));

publicRouter.post('/payments/cash', ah(async (req, res) => {
  const b = OrderBody.parse(req.body ?? {});
  res.status(201).json(await orders.startCashOrder(b.productCode, b.lang, clientIp(req)));
}));

publicRouter.get('/payments/orders/:orderCode', ah(async (req, res) => {
  const code = z.string().min(4).max(12).parse(req.params.orderCode);
  res.json(await orders.getOrderStatus(code));
}));

// UC-S01: webhook Payoo. Can RAW body de kiem tra chu ky (index.ts luu req.rawBody).
publicRouter.post('/payments/webhook/payoo', ah(async (req, res) => {
  const raw = (req as any).rawBody as string;
  const sig = req.header('x-payoo-signature') ?? undefined;
  res.status(200).json(await handlePayooWebhook(raw, sig));
}));

// ---- Mock Payoo: chi bat khi PAYOO_MODE=mock ----
if (config.payoo.mode === 'mock') {
  // Mo URL nay trong trinh duyet = "khach da thanh toan". Them ?result=fail de mo phong that bai.
  publicRouter.get('/payments/mock/payoo/pay/:orderCode', ah(async (req, res) => {
    const code = z.string().max(12).parse(req.params.orderCode).toUpperCase();
    const result = req.query.result === 'fail' ? 'FAILED' : 'SUCCESS';
    const { rows } = await pool.query(
      `SELECT o.amount, t.provider_txn_id, t.raw_response
         FROM payment_orders o JOIN payment_transactions t ON t.order_id=o.id AND t.provider='PAYOO'
        WHERE o.order_code=$1`, [code]);
    if (!rows[0]) return res.status(404).send('Order not found');

    const body = JSON.stringify({
      eventId: `MOCK-EVT-${code}-${result}`,
      orderCode: code,
      status: result,
      amount: Number(rows[0].amount),
      providerTxnId: rows[0].provider_txn_id,
    });
    await fetch(`${config.selfUrl}/payments/webhook/payoo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-payoo-signature': signPayload(body) },
      body,
    });
    const returnUrl = rows[0].raw_response?.returnUrl as string | undefined;
    if (returnUrl) return res.redirect(`${returnUrl}&status=${result.toLowerCase()}`);
    res.send(`Mock payment ${result} for ${code}`);
  }));
}
