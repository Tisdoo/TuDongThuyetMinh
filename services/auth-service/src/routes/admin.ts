import { Router } from 'express';
import { z } from 'zod';
import { ah, requireRole } from '../common';
import * as staff from '../services/staff';

export const adminRouter = Router();
adminRouter.use('/auth/admin', requireRole('ADMIN'));

const ROLE = z.enum(['ADMIN', 'STAFF', 'CONTENT_EDITOR']);
const actor = (req: any) => req.header('x-user-id') ?? 'unknown';

// UC-A07: quan ly tai khoan nhan vien
adminRouter.get('/auth/admin/staff', ah(async (_req, res) => {
  res.json(await staff.listStaff());
}));

adminRouter.post('/auth/admin/staff', ah(async (req, res) => {
  const b = z.object({
    username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_.-]+$/),
    password: z.string().min(8).max(100),
    fullName: z.string().max(100).optional(),
    email: z.string().email().optional(),
    roleCode: ROLE,
  }).parse(req.body);
  res.status(201).json(await staff.createStaff(b, actor(req)));
}));

adminRouter.patch('/auth/admin/staff/:id', ah(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const b = z.object({
    isActive: z.boolean().optional(),
    roleCode: ROLE.optional(),
    password: z.string().min(8).max(100).optional(),
    fullName: z.string().max(100).optional(),
  }).parse(req.body);
  await staff.updateStaff(id, b, actor(req));
  res.status(204).end();
}));

// UC-A05: tra cuu va thu hoi phien du khach
adminRouter.get('/auth/admin/sessions', ah(async (_req, res) => {
  res.json(await staff.listSessions());
}));

adminRouter.post('/auth/admin/sessions/:id/revoke', ah(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const b = z.object({ reason: z.string().max(100).default('REVOKED_BY_ADMIN') }).parse(req.body ?? {});
  await staff.revokeSession(id, b.reason, actor(req));
  res.status(204).end();
}));
