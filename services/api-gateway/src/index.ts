import 'dotenv/config';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createProxyMiddleware } from 'http-proxy-middleware';
import Redis from 'ioredis';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const config = {
  port: Number(process.env.PORT ?? 8080),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  authUrl: process.env.AUTH_URL ?? 'http://localhost:4001',
  paymentUrl: process.env.PAYMENT_URL ?? 'http://localhost:4002',
  poiUrl: process.env.POI_URL ?? 'http://localhost:4003',
  chatUrl: process.env.CHAT_URL ?? 'http://localhost:4004',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  issuer: 'linhung-auth',
  audience: 'linhung-app',
};

const redis = new Redis(config.redisUrl);
const jwks = createRemoteJWKSet(new URL(`${config.authUrl}/auth/.well-known/jwks.json`), {
  cooldownDuration: 10_000,
});

// Route cong khai (khong can token). Moi route khac bat buoc Bearer JWT.
const PUBLIC: Array<[string, RegExp]> = [
  ['GET', /^\/api\/payments\/products$/],
  ['POST', /^\/api\/payments\/(online|cash|momo-qr)$/],
  ['GET', /^\/api\/payments\/orders\/[A-Za-z0-9]+$/],
  ['POST', /^\/api\/payments\/webhook\/payoo$/],
  ['GET', /^\/api\/payments\/mock\/payoo\/pay\/[A-Za-z0-9]+$/],
  // VNPAY: Return URL (trinh duyet khach) va IPN (server VNPAY goi ngam) khong co JWT
  ['GET', /^\/api\/payments\/vnpay\/return$/],
  ['GET', /^\/api\/payments\/vnpay\/ipn$/],
  ['POST', /^\/api\/payments\/vnpay\/ipn$/],
  ['POST', /^\/api\/auth\/(exchange|exchange-short)$/],
  ['POST', /^\/api\/auth\/staff\/(login|refresh|logout)$/],
  ['POST', /^\/api\/auth\/owner\/(register|registration-status)$/],
];
const isPublic = (req: Request) => PUBLIC.some(([m, re]) => m === req.method && re.test(req.path));

// Duong dan danh rieng cho nhan vien/admin: du khach (TOURIST) bi chan o day, service tu kiem tra role chi tiet.
const STAFF_ONLY = /^\/api\/(auth\/(staff|admin)\/|[a-z]+\/admin\/)/;

async function authenticate(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/health' || req.method === 'OPTIONS' || isPublic(req)) return next();
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return deny(res, 401, 'MISSING_TOKEN');
  try {
    const { payload } = await jwtVerify(h.slice(7), jwks, { issuer: config.issuer, audience: config.audience });
    if (payload.jti && (await redis.exists(`token_denylist:${payload.jti}`))) return deny(res, 401, 'TOKEN_REVOKED');
    const role = String(payload.role ?? '');
    if (STAFF_ONLY.test(req.path) && role === 'TOURIST') return deny(res, 403, 'FORBIDDEN');
    // Service tin cac header nay vi chi gateway moi toi duoc service (mang noi bo)
    req.headers['x-user-id'] = String(payload.sub ?? '');
    req.headers['x-user-role'] = role;
    if (payload.username) req.headers['x-user-name'] = String(payload.username);
    if (payload.jti) req.headers['x-session-id'] = String(payload.jti);
    next();
  } catch {
    deny(res, 401, 'INVALID_TOKEN');
  }
}

function deny(res: Response, status: number, code: string) {
  res.status(status).json({ error: { code, message: code } });
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.corsOrigin.split(','), credentials: false }));

// Luon xoa header danh tinh do client gui len, tranh gia mao
app.use((req, _res, next) => {
  for (const h of ['x-user-id', 'x-user-role', 'x-user-name', 'x-session-id', 'x-internal-key']) delete req.headers[h];
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'api-gateway' }));

// Rate limit: chung va chat hon cho cac endpoint nhay cam (UC-S04)
app.use('/api', rateLimit({ windowMs: 60_000, limit: 200, standardHeaders: true, legacyHeaders: false }));
app.use(['/api/auth/exchange', '/api/auth/exchange-short', '/api/auth/staff/login', '/api/auth/owner/register', '/api/auth/owner/registration-status'],
  rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }));
app.use(['/api/payments/online', '/api/payments/cash', '/api/payments/momo-qr'],
  rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }));

app.use(authenticate);

// KHONG dung express.json() o day: proxy can stream body nguyen ven (webhook can raw body)
const proxy = (prefix: string, target: string) =>
  createProxyMiddleware({
    target,
    pathFilter: prefix,
    changeOrigin: true,
    xfwd: true,
    pathRewrite: { '^/api': '' },
    on: {
      error: (_err, _req, res) => {
        const r = res as unknown as Response;
        if (typeof r.writeHead === 'function') {
          r.writeHead(502, { 'Content-Type': 'application/json' });
          r.end(JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Service unavailable' } }));
        }
      },
    },
  });

app.use(proxy('/api/auth', config.authUrl));
app.use(proxy('/api/payments', config.paymentUrl));
app.use(proxy('/api/poi', config.poiUrl));
app.use(proxy('/api/chat', config.chatUrl));

app.use((_req, res) => deny(res, 404, 'NOT_FOUND'));

app.listen(config.port, () => console.log(`[api-gateway] listening on :${config.port}`));
