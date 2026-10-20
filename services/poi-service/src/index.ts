import express from 'express';
import { config } from './config';
import { errorHandler } from './common';
import { pool } from './db';
import { runMigrations } from './migrate';
import { datasetRouter } from './routes/dataset';
import { adminRouter } from './routes/admin';
import { ownerRouter } from './routes/owner';

async function main() {
  await runMigrations();

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'poi-service' });
  });
  app.use(datasetRouter);
  app.use(adminRouter);
  app.use(ownerRouter);
  app.use(errorHandler);

  app.listen(config.port, () => console.log(`[poi-service] listening on :${config.port}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
