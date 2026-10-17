import express from 'express';
import { config } from './config';
import { errorHandler } from './common';
import { pool } from './db';
import { runMigrations } from './migrate';
import { initKeys } from './keys';
import { seedAdmin } from './seed';
import { startConsumer } from './mq';
import { handleEvent } from './events';
import { expireGrants } from './services/grants';
import { redactOldPii } from './services/owners';
import { publicRouter } from './routes/public';
import { staffRouter } from './routes/staff';
import { adminRouter } from './routes/admin';
import { internalRouter } from './routes/internal';

async function main() {
  await runMigrations();
  await initKeys();
  await seedAdmin();

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '100kb' }));
  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'auth-service' });
  });
  app.use(publicRouter);
  app.use(staffRouter);
  app.use(adminRouter);
  app.use(internalRouter);
  app.use(errorHandler);

  app.listen(config.port, () => console.log(`[auth-service] listening on :${config.port}`));

  startConsumer(handleEvent).catch((e) => {
    console.error('[mq] consumer crashed', e);
    process.exit(1);
  });
  setInterval(() => expireGrants().catch(console.error), 60_000); // UC-S03
  redactOldPii().catch(console.error);
  setInterval(() => redactOldPii().catch(console.error), 3600_000); // xoa CCCD qua han luu tru
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
