import { Router } from 'express';
import { z } from 'zod';
import { ah, requireInternal } from '../common';
import { createGrant } from '../services/grants';

export const internalRouter = Router();

// Chi Payment Service goi (header x-internal-key). Khong expose qua gateway.
internalRouter.post('/internal/grants', requireInternal(), ah(async (req, res) => {
  const b = z.object({
    orderId: z.string().uuid(),
    channel: z.enum(['ONLINE', 'CASH']),
    validityHours: z.number().int().min(1).max(168),
  }).parse(req.body);
  const g = await createGrant(b);
  res.status(201).json(g);
}));
