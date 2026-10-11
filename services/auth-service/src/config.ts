import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4001),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/auth_db',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  rabbitUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
  internalApiKey: process.env.INTERNAL_API_KEY ?? 'change-me-internal-key',

  jwtIssuer: 'linhung-auth',
  jwtAudience: 'linhung-app',
  jwtKid: process.env.JWT_KID ?? 'dev-key-1',
  // Production: dat JWT_PRIVATE_KEY_PEM (xuong dong bang \n). Dev: tu sinh vao .keys/
  jwtPrivateKeyPem: process.env.JWT_PRIVATE_KEY_PEM,

  staffTokenTtlSec: 15 * 60,
  refreshTtlDays: 7,
  authCodeTtlMin: 30,
  shortCodeTtlSec: 600,
  shortCodeMaxAttempts: 5,
  shortCodeLockSec: 300,

  seedAdminUsername: process.env.SEED_ADMIN_USERNAME ?? 'admin',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345',
  isProd: process.env.NODE_ENV === 'production',
};
