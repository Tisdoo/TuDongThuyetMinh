import { Router } from 'express';
import { z } from 'zod';
import { ah, clientIp } from '../common';
import { getPublicJwk } from '../keys';
import { exchangeAuthCode, exchangeShortCode } from '../services/grants';
import * as staff from '../services/staff';

export const publicRouter = Router();

// Gateway doc JWKS de verify chu ky JWT
publicRouter.get('/auth/.well-known/jwks.json', (_req, res) => {
  res.json({ keys: [getPublicJwk()] });
});

const ctxOf = (req: any, lang?: string) => ({
  ip: clientIp(req),
  userAgent: (req.header('user-agent') ?? '').slice(0, 300),
  lang,
});

// UC-T05: doi auth_code lay token (frontend polling). 202 = chua thanh toan xong
publicRouter.post('/auth/exchange', ah(async (req, res) => {
  const b = z.object({ authCode: z.string().min(10).max(100), lang: z.string().max(10).optional() }).parse(req.body);
  const r = await exchangeAuthCode(b.authCode, ctxOf(req, b.lang));
  if (r.pending) return res.status(202).json({ status: 'PAYMENT_PENDING' });
  res.json({ accessToken: r.token, expiresAt: r.expiresAt });
}));

// UC-T07: doi ma ngan (tien mat) lay token
publicRouter.post('/auth/exchange-short', ah(async (req, res) => {
  const b = z.object({ shortCode: z.string().min(4).max(10), lang: z.string().max(10).optional() }).parse(req.body);
  const r = await exchangeShortCode(b.shortCode, ctxOf(req, b.lang));
  if (r.pending) return res.status(202).json({ status: 'PAYMENT_PENDING' });
  res.json({ accessToken: r.token, expiresAt: r.expiresAt });
}));

// UC-A01: nhan vien dang nhap / lam moi / dang xuat
publicRouter.post('/auth/staff/login', ah(async (req, res) => {
  const b = z.object({ username: z.string().min(1).max(50), password: z.string().min(1).max(200) }).parse(req.body);
  res.json(await staff.login(b.username, b.password, clientIp(req)));
}));

publicRouter.post('/auth/staff/refresh', ah(async (req, res) => {
  const b = z.object({ refreshToken: z.string().min(20).max(200) }).parse(req.body);
  res.json(await staff.refresh(b.refreshToken));
}));

publicRouter.post('/auth/staff/logout', ah(async (req, res) => {
  const b = z.object({ refreshToken: z.string().min(20).max(200) }).parse(req.body);
  await staff.logout(b.refreshToken);
  res.status(204).end();
}));
