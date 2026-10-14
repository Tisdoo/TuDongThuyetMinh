import { NextFunction, Request, RequestHandler, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import net from 'net';
import { ZodError } from 'zod';
import { config } from './config';

export class AppError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.flatten() } });
  }
  console.error(err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
}

// Gateway da xac thuc JWT va gan header x-user-*; service chi tin header nay.
export function requireRole(...roles: string[]): RequestHandler {
  return (req, _res, next) => {
    const role = req.header('x-user-role');
    if (!role || !roles.includes(role)) return next(new AppError(403, 'FORBIDDEN', 'Insufficient role'));
    next();
  };
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function requireInternal(): RequestHandler {
  return (req, _res, next) => {
    const key = req.header('x-internal-key') ?? '';
    if (!safeEqual(key, config.internalApiKey)) return next(new AppError(401, 'UNAUTHORIZED'));
    next();
  };
}

export const clientIp = (req: Request): string =>
  req.header('x-forwarded-for')?.split(',')[0]?.trim() || req.ip || 'unknown';

export const inetOrNull = (ip: string): string | null => (net.isIP(ip) ? ip : null);
