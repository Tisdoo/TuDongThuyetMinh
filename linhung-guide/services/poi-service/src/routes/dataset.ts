import fs from 'fs';
import { Router } from 'express';
import { ah, AppError } from '../common';
import { latestPublished } from '../services/builder';

export const datasetRouter = Router();

// UC-T09: frontend tai dataset 1 lan sau khi xac thuc. ETag = so version -> 304 neu da moi nhat.
datasetRouter.get('/poi/dataset/latest', ah(async (req, res) => {
  const v = await latestPublished();
  if (!v) throw new AppError(404, 'NO_PUBLISHED_DATASET', 'Admin has not published a dataset yet');
  const etag = `"v${v.version_no}"`;
  res.setHeader('ETag', etag);
  res.setHeader('X-Dataset-Version', String(v.version_no));
  res.setHeader('X-Dataset-Checksum', v.checksum);
  res.setHeader('Cache-Control', 'private, no-cache');
  if (req.header('if-none-match') === etag) return res.status(304).end();
  res.type('application/json').send(fs.readFileSync(v.bundle_url, 'utf8'));
}));
