import { Router } from 'express';
import { z } from 'zod';
import { ah, requireRole } from '../common';
import { getShortCodeForOrder, reissueShortCode } from '../services/grants';

export const staffRouter = Router();
staffRouter.use('/auth/staff/orders', requireRole('STAFF', 'ADMIN'));

const orderIdOf = (req: any) => z.string().uuid().parse(req.params.orderId);

// UC-A04: hien thi ma ngan cho nhan vien doc cho khach
staffRouter.get('/auth/staff/orders/:orderId/short-code', ah(async (req, res) => {
  const r = await getShortCodeForOrder(orderIdOf(req));
  if (r.state === 'PENDING') return res.status(202).json({ status: 'PREPARING', hint: 'Retry in 1s' });
  if (r.state === 'EXPIRED')
    return res.status(410).json({ error: { code: 'SHORTCODE_EXPIRED', message: 'Use POST .../short-code/reissue' } });
  res.json({ shortCode: r.code, expiresInSec: r.expiresInSec });
}));

// Cap lai ma khi het han hoac khach lam mat
staffRouter.post('/auth/staff/orders/:orderId/short-code/reissue', ah(async (req, res) => {
  res.json(await reissueShortCode(orderIdOf(req), req.header('x-user-id') ?? 'unknown'));
}));
