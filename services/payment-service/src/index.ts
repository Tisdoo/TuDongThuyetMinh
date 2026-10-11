import express from 'express';
import { config } from './config';
import { errorHandler } from './common';
import { pool } from './db';
import { runMigrations } from './migrate';
import { startOutboxPublisher } from './services/outbox';
import { expireOrders } from './services/orders';
import { publicRouter } from './routes/public';
import { adminRouter } from './routes/admin';

async function main() {
  await runMigrations();

  const app = express();
  app.set('trust proxy', true);
  // Giu raw body: chu ky webhook phai tinh tren dung chuoi byte nhan duoc
  app.use(express.json({
    limit: '200kb',
    verify: (req, _res, buf) => { (req as any).rawBody = buf.toString('utf8'); },
  }));
  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'payment-service', payooMode: config.payoo.mode });
  });
  app.use(publicRouter);
  app.use(adminRouter);
  app.use(errorHandler);

  app.listen(config.port, () => console.log(`[payment-service] listening on :${config.port} (payoo=${config.payoo.mode})`));

  startOutboxPublisher();
  setInterval(() => expireOrders().catch(console.error), 60_000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
