import { Router } from 'express';
import { z } from 'zod';
import { ah, AppError, requireRole } from '../common';
import { pool } from '../db';
import * as orders from '../services/orders';

export const adminRouter = Router();
const staffOrAdmin = requireRole('STAFF', 'ADMIN');
const adminOnly = requireRole('ADMIN');
const uuid = (v: unknown) => z.string().uuid().parse(v);

// ---------- Nhan vien: don hang & thu tien mat ----------
// UC-A02
adminRouter.get('/payments/admin/orders/by-code/:orderCode', staffOrAdmin, ah(async (req, res) => {
  res.json(await orders.findOrderByCode(z.string().min(4).max(12).parse(req.params.orderCode)));
}));

// UC-A03
adminRouter.post('/payments/admin/orders/:id/confirm-cash', staffOrAdmin, ah(async (req, res) => {
  const b = z.object({ amountReceived: z.number().int().positive(), note: z.string().max(255).optional() }).parse(req.body);
  const staffId = req.header('x-user-id');
  if (!staffId) throw new AppError(401, 'UNAUTHORIZED');
  res.json(await orders.confirmCash(uuid(req.params.id), staffId, b.amountReceived, b.note));
}));

// Xac nhan DA NHAN tien MoMo (doi soat thu cong sau khi xem thong bao trong app MoMo)
adminRouter.post('/payments/admin/orders/:id/confirm-momo', staffOrAdmin, ah(async (req, res) => {
  const b = z.object({
    amountReceived: z.number().int().positive(),
    momoTxnId: z.string().min(4).max(100).optional(),
    note: z.string().max(255).optional(),
  }).parse(req.body);
  const staffId = req.header('x-user-id');
  if (!staffId) throw new AppError(401, 'UNAUTHORIZED');
  res.json(await orders.confirmMomo(uuid(req.params.id), staffId, b.amountReceived, b.momoTxnId, b.note));
}));

// UC-A05: huy don dang cho
adminRouter.post('/payments/admin/orders/:id/cancel', staffOrAdmin, ah(async (req, res) => {
  await orders.cancelOrder(uuid(req.params.id));
  res.status(204).end();
}));

// Tra cuu giao dich (loc + phan trang)
adminRouter.get('/payments/admin/orders', staffOrAdmin, ah(async (req, res) => {
  const q = z.object({
    status: z.enum(['CREATED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED']).optional(),
    method: z.enum(['ONLINE', 'CASH', 'MOMO_QR']).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }).parse(req.query);

  const where: string[] = [];
  const vals: unknown[] = [];
  const add = (sql: string, v: unknown) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };
  if (q.status) add('o.status = ?', q.status);
  if (q.method) add('o.method = ?', q.method);
  if (q.from) add('o.created_at >= ?', q.from);
  if (q.to) add('o.created_at < ?', q.to);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (await pool.query(`SELECT count(*)::int AS n FROM payment_orders o ${w}`, vals)).rows[0].n;
  const { rows } = await pool.query(
    `SELECT o.id, o.order_code, o.method, o.status, o.amount::int AS amount, o.created_at, o.paid_at, p.code AS product_code
       FROM payment_orders o JOIN ticket_products p ON p.id=o.product_id
       ${w} ORDER BY o.created_at DESC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`, vals);
  res.json({ page: q.page, pageSize: q.pageSize, total, items: rows });
}));

// ---------- Admin: san pham ve (UC-A06) ----------
adminRouter.get('/payments/admin/products', adminOnly, ah(async (_req, res) => {
  const { rows } = await pool.query('SELECT id, code, name, price::int AS price, currency, validity_hours, is_active FROM ticket_products ORDER BY code');
  res.json(rows);
}));

adminRouter.post('/payments/admin/products', adminOnly, ah(async (req, res) => {
  const b = z.object({
    code: z.string().regex(/^[A-Z0-9_]{2,30}$/),
    name: z.string().min(1).max(100),
    price: z.number().int().min(0),
    validityHours: z.number().int().min(1).max(168),
  }).parse(req.body);
  try {
    const { rows } = await pool.query(
      `INSERT INTO ticket_products (code, name, price, validity_hours) VALUES ($1,$2,$3,$4)
       RETURNING id, code, name, price::int AS price, validity_hours, is_active`,
      [b.code, b.name, b.price, b.validityHours]);
    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e.code === '23505') throw new AppError(409, 'PRODUCT_CODE_EXISTS');
    throw e;
  }
}));

// Doi gia khong anh huong don cu vi payment_orders.amount la snapshot
adminRouter.patch('/payments/admin/products/:id', adminOnly, ah(async (req, res) => {
  const b = z.object({
    name: z.string().min(1).max(100).optional(),
    price: z.number().int().min(0).optional(),
    validityHours: z.number().int().min(1).max(168).optional(),
    isActive: z.boolean().optional(),
  }).parse(req.body);
  const { rowCount } = await pool.query(
    `UPDATE ticket_products SET
       name = COALESCE($2, name), price = COALESCE($3, price),
       validity_hours = COALESCE($4, validity_hours), is_active = COALESCE($5, is_active), updated_at = now()
     WHERE id = $1`,
    [uuid(req.params.id), b.name ?? null, b.price ?? null, b.validityHours ?? null, b.isActive ?? null]);
  if (!rowCount) throw new AppError(404, 'PRODUCT_NOT_FOUND');
  res.status(204).end();
}));

// Dashboard: tong doanh thu tu truoc toi nay (chi tinh don da thanh toan)
adminRouter.get('/payments/admin/reports/summary', adminOnly, ah(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT COALESCE(sum(amount), 0)::bigint AS total FROM payment_orders WHERE status = 'PAID'`);
  res.json({ totalRevenue: Number(rows[0].total), currency: 'VND' });
}));

// Bao cao doanh thu theo ngay (gio Viet Nam)
adminRouter.get('/payments/admin/reports/daily', adminOnly, ah(async (req, res) => {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.date ?? new Date().toISOString().slice(0, 10));
  const { rows } = await pool.query(
    `SELECT method, count(*)::int AS orders, COALESCE(sum(amount),0)::bigint AS revenue
       FROM payment_orders
      WHERE status='PAID' AND (paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $1::date
      GROUP BY method`, [date]);
  res.json({ date, byMethod: rows, totalRevenue: rows.reduce((s, r) => s + Number(r.revenue), 0) });
}));
