import { PoolClient } from 'pg';
import { config } from '../config';
import { AppError, inetOrNull, randomCode } from '../common';
import { pool, tx } from '../db';
import { enqueue } from './outbox';
import { createPayment } from './payoo';
import { buildPaymentUrl } from './vnpay';

type Method = 'ONLINE' | 'CASH' | 'MOMO_QR';

/** Goi noi bo sang Auth Service tao access_grant (PENDING). */
async function createAuthGrant(orderId: string, channel: Method, validityHours: number): Promise<{ authCode: string | null }> {
  let res: Response;
  try {
    res = await fetch(`${config.authUrl}/internal/grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': config.internalApiKey },
      body: JSON.stringify({ orderId, channel, validityHours }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new AppError(502, 'AUTH_SERVICE_UNAVAILABLE');
  }
  if (!res.ok) throw new AppError(502, 'AUTH_GRANT_FAILED', `Auth service returned ${res.status}`);
  return (await res.json()) as { authCode: string | null };
}

async function insertOrder(method: Method, productCode: string, lang: string | undefined, ip: string) {
  const p = (await pool.query('SELECT * FROM ticket_products WHERE code=$1 AND is_active', [productCode])).rows[0];
  if (!p) throw new AppError(404, 'PRODUCT_NOT_FOUND');
  const ttl = method === 'CASH' ? config.cashOrderTtlMin : config.onlineOrderTtlMin;
  for (let i = 0; i < 5; i++) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO payment_orders (order_code, product_id, amount, currency, method, status, language, client_ip, expires_at)
         VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7, now() + make_interval(mins => $8))
         RETURNING *`,
        [randomCode(8), p.id, p.price, p.currency, method, lang ?? null, inetOrNull(ip), ttl],
      );
      return { order: rows[0], product: p };
    } catch (e: any) {
      if (e.code !== '23505') throw e; // trung order_code -> thu lai
    }
  }
  throw new AppError(500, 'ORDER_CODE_GENERATION_FAILED');
}

/** Danh dau don that bai/het han va ban event de Auth huy grant. */
export async function failOrder(orderId: string, reason: string, status: 'FAILED' | 'EXPIRED' | 'CANCELLED' = 'FAILED') {
  await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE payment_orders SET status=$2, updated_at=now()
        WHERE id=$1 AND status IN ('CREATED','PENDING') RETURNING order_code, method`,
      [orderId, status],
    );
    if (rows[0]) await enqueue(c, 'PaymentFailed', orderId, { orderCode: rows[0].order_code, channel: rows[0].method, reason });
  });
}

// ---------- UC-T04: thanh toan online ----------
export async function startOnlineOrder(productCode: string, lang: string | undefined, ip: string) {
  const { order, product } = await insertOrder('ONLINE', productCode, lang, ip);
  try {
    const grant = await createAuthGrant(order.id, 'ONLINE', product.validity_hours);
    const returnUrl = `${config.frontendUrl}/payment/return?auth_code=${encodeURIComponent(grant.authCode ?? '')}&order=${order.order_code}`;
    const description = `Ve tham quan - ${product.name}`;

    // Chon cong thanh toan theo ONLINE_PAYMENT_PROVIDER
    let provider: 'PAYOO' | 'VNPAY';
    let pay: { paymentUrl: string; providerTxnId: string | null };
    if (config.onlineProvider === 'vnpay') {
      // VNPAY: tu tao URL co chu ky (HMAC-SHA512). Ma GD VNPAY chi co sau khi khach tra tien (IPN).
      provider = 'VNPAY';
      pay = {
        providerTxnId: null,
        paymentUrl: buildPaymentUrl({
          orderCode: order.order_code,
          amount: Number(order.amount),
          orderInfo: `Thanh toan don hang ${order.order_code}`,
          ipAddr: ip,
          createdAt: new Date(),
          expiresAt: new Date(order.expires_at), // VNPAY khoa thanh toan khi don het han
          locale: lang?.toLowerCase().startsWith('vi') ? 'vn' : 'en',
        }, config.vnpay),
      };
    } else {
      provider = 'PAYOO';
      pay = await createPayment({ orderCode: order.order_code, amount: Number(order.amount), description });
    }

    await pool.query(
      `INSERT INTO payment_transactions (order_id, provider, provider_txn_id, payment_url, amount, status, raw_response)
       VALUES ($1,$2,$3,$4,$5,'INITIATED',$6)`,
      [order.id, provider, pay.providerTxnId, pay.paymentUrl, order.amount, JSON.stringify({ returnUrl })],
    );
    return {
      orderCode: order.order_code,
      amount: Number(order.amount),
      currency: order.currency,
      paymentUrl: pay.paymentUrl,
      authCode: grant.authCode, // frontend luu sessionStorage de polling /auth/exchange
      expiresAt: order.expires_at,
    };
  } catch (e) {
    await failOrder(order.id, 'PROVIDER_ERROR').catch(console.error);
    if (e instanceof AppError) throw e.status >= 500 && e.status !== 501 ? new AppError(502, 'PAYMENT_PROVIDER_ERROR', e.message) : e;
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR');
  }
}

// ---------- UC-T06: thanh toan tien mat ----------
export async function startCashOrder(productCode: string, lang: string | undefined, ip: string) {
  const { order, product } = await insertOrder('CASH', productCode, lang, ip);
  try {
    await createAuthGrant(order.id, 'CASH', product.validity_hours);
  } catch (e) {
    await failOrder(order.id, 'AUTH_ERROR').catch(console.error);
    throw e;
  }
  return {
    orderCode: order.order_code,
    orderId: order.id, // nhan vien can orderId de lay ma ngan; khach chi can orderCode
    amount: Number(order.amount),
    currency: order.currency,
    expiresAt: order.expires_at,
  };
}

// ---------- Thanh toan bang QR MoMo ----------
// Khach quet QR MoMo cua chu du an va chuyen dung so tien, ghi noi dung = ma don.
// Ma QR ca nhan KHONG gui thong bao ve server, nen nhan vien xem MoMo roi bam xac nhan (doi soat thu cong).
// Khach nhan token bang authCode giong luong online (khong can nhan vien doc ma).
export async function startMomoQrOrder(productCode: string, lang: string | undefined, ip: string) {
  const { order, product } = await insertOrder('MOMO_QR', productCode, lang, ip);
  try {
    const grant = await createAuthGrant(order.id, 'ONLINE', product.validity_hours);
    return {
      orderCode: order.order_code,
      amount: Number(order.amount),
      currency: order.currency,
      expiresAt: order.expires_at,
      authCode: grant.authCode,
      qr: { imageUrl: config.momo.qrUrl, accountName: config.momo.accountName, transferNote: order.order_code },
    };
  } catch (e) {
    await failOrder(order.id, 'AUTH_ERROR').catch(console.error);
    throw e;
  }
}

/** Nhan vien xac nhan DA NHAN tien MoMo. momoTxnId (ma giao dich trong app MoMo) la UNIQUE: mot giao dich khong dung cho hai don. */
export async function confirmMomo(orderId: string, staffId: string, amountReceived: number, momoTxnId?: string, note?: string) {
  try {
    return await tx(async (c: PoolClient) => {
      const { rows } = await c.query('SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE', [orderId]);
      const o = rows[0];
      if (!o) throw new AppError(404, 'ORDER_NOT_FOUND');
      if (o.method !== 'MOMO_QR') throw new AppError(400, 'NOT_A_MOMO_ORDER');
      if (o.status === 'PAID') throw new AppError(409, 'ORDER_ALREADY_PAID');
      if (o.status !== 'PENDING') throw new AppError(409, 'ORDER_NOT_PAYABLE', `Order is ${o.status}`);
      if (new Date(o.expires_at) < new Date()) throw new AppError(409, 'ORDER_EXPIRED');
      if (amountReceived !== Number(o.amount)) throw new AppError(400, 'AMOUNT_MISMATCH', `Expected ${Number(o.amount)}`);
      await c.query(
        `INSERT INTO payment_transactions (order_id, provider, provider_txn_id, amount, status, raw_response, completed_at)
         VALUES ($1,'MOMO_QR',$2,$3,'SUCCESS',$4, now())`,
        [orderId, momoTxnId ?? null, amountReceived, JSON.stringify({ confirmedBy: staffId, note: note ?? null })],
      );
      await c.query(`UPDATE payment_orders SET status='PAID', paid_at=now(), updated_at=now() WHERE id=$1`, [orderId]);
      await enqueue(c, 'PaymentSucceeded', orderId, { orderCode: o.order_code, channel: 'MOMO_QR' });
      return { orderId, orderCode: o.order_code, status: 'PAID' };
    });
  } catch (e: any) {
    if (e.code === '23505') throw new AppError(409, 'MOMO_TXN_ALREADY_USED', 'This MoMo transaction id was already used');
    throw e;
  }
}

/** Frontend co the hoi trang thai theo order_code (public, chi tra thong tin toi thieu). */
export async function getOrderStatus(orderCode: string) {
  const { rows } = await pool.query(
    'SELECT order_code, method, status, expires_at FROM payment_orders WHERE order_code=$1',
    [orderCode.toUpperCase()],
  );
  if (!rows[0]) throw new AppError(404, 'ORDER_NOT_FOUND');
  return { orderCode: rows[0].order_code, method: rows[0].method, status: rows[0].status, expiresAt: rows[0].expires_at };
}

// ---------- UC-A02: nhan vien tra don ----------
export async function findOrderByCode(orderCode: string) {
  const { rows } = await pool.query(
    `SELECT o.id, o.order_code, o.method, o.status, o.amount, o.currency, o.expires_at, o.created_at, o.paid_at,
            p.code AS product_code, p.name AS product_name
       FROM payment_orders o JOIN ticket_products p ON p.id = o.product_id
      WHERE o.order_code=$1`,
    [orderCode.toUpperCase()],
  );
  if (!rows[0]) throw new AppError(404, 'ORDER_NOT_FOUND');
  return rows[0];
}

// ---------- UC-A03: xac nhan da thu tien mat ----------
export async function confirmCash(orderId: string, staffId: string, amountReceived: number, note?: string) {
  return tx(async (c: PoolClient) => {
    const { rows } = await c.query('SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE', [orderId]);
    const o = rows[0];
    if (!o) throw new AppError(404, 'ORDER_NOT_FOUND');
    if (o.method !== 'CASH') throw new AppError(400, 'NOT_A_CASH_ORDER');
    if (o.status === 'PAID') throw new AppError(409, 'ORDER_ALREADY_PAID', 'Use short-code reissue if the code is lost');
    if (o.status !== 'PENDING') throw new AppError(409, 'ORDER_NOT_PAYABLE', `Order is ${o.status}`);
    if (new Date(o.expires_at) < new Date()) throw new AppError(409, 'ORDER_EXPIRED');
    if (amountReceived !== Number(o.amount)) {
      throw new AppError(400, 'AMOUNT_MISMATCH', `Expected ${Number(o.amount)}`);
    }
    await c.query(
      `INSERT INTO cash_receipts (order_id, staff_id, amount_received, note) VALUES ($1,$2,$3,$4)`,
      [orderId, staffId, amountReceived, note ?? null],
    );
    await c.query(
      `INSERT INTO payment_transactions (order_id, provider, amount, status, completed_at)
       VALUES ($1,'CASH',$2,'SUCCESS', now())`,
      [orderId, amountReceived],
    );
    await c.query(`UPDATE payment_orders SET status='PAID', paid_at=now(), updated_at=now() WHERE id=$1`, [orderId]);
    await enqueue(c, 'PaymentSucceeded', orderId, { orderCode: o.order_code, channel: 'CASH' });
    return { orderId, orderCode: o.order_code, status: 'PAID' };
  });
}

export async function cancelOrder(orderId: string) {
  const { rows } = await pool.query('SELECT status FROM payment_orders WHERE id=$1', [orderId]);
  if (!rows[0]) throw new AppError(404, 'ORDER_NOT_FOUND');
  if (!['CREATED', 'PENDING'].includes(rows[0].status)) throw new AppError(409, 'ORDER_NOT_CANCELLABLE', `Order is ${rows[0].status}`);
  await failOrder(orderId, 'CANCELLED_BY_STAFF', 'CANCELLED');
}

// ---------- Job het han don ----------
export async function expireOrders() {
  await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE payment_orders SET status='EXPIRED', updated_at=now()
        WHERE status IN ('CREATED','PENDING') AND expires_at < now()
        RETURNING id, order_code, method`,
    );
    for (const r of rows) await enqueue(c, 'PaymentFailed', r.id, { orderCode: r.order_code, channel: r.method, reason: 'EXPIRED' });
  });
}
