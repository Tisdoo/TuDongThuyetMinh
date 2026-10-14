import { NextFunction, Request, RequestHandler, Response } from 'express';
import { randomInt } from 'crypto';
import net from 'net';
import { ZodError } from 'zod';

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

export function requireRole(...roles: string[]): RequestHandler {
  return (req, _res, next) => {
    const role = req.header('x-user-role');
    if (!role || !roles.includes(role)) return next(new AppError(403, 'FORBIDDEN', 'Insufficient role'));
    next();
  };
}

export const clientIp = (req: Request): string =>
  req.header('x-forwarded-for')?.split(',')[0]?.trim() || req.ip || 'unknown';
export const inetOrNull = (ip: string): string | null => (net.isIP(ip) ? ip : null);

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomCode(len: number) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}
