import 'dotenv/config';

const port = Number(process.env.PORT ?? 4002);

export const config = {
  port,
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/payment_db',
  rabbitUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
  authUrl: process.env.AUTH_URL ?? 'http://localhost:4001',
  internalApiKey: process.env.INTERNAL_API_KEY ?? 'change-me-internal-key',

  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:8080', // gateway, dung cho mock payment page
  selfUrl: process.env.SELF_URL ?? `http://localhost:${port}`,         // mock tu goi webhook cua chinh no

  onlineOrderTtlMin: 30,
  cashOrderTtlMin: 60,

  // Thanh toan bang QR MoMo ca nhan: anh QR do chu du an cung cap, nhan vien doi soat thu cong.
  momo: {
    qrUrl: process.env.MOMO_QR_URL ?? '/momo-qr.svg',
    accountName: process.env.MOMO_ACCOUNT_NAME ?? '',
  },

  payoo: {
    mode: (process.env.PAYOO_MODE ?? 'mock') as 'mock' | 'sandbox',
    apiUrl: process.env.PAYOO_API_URL ?? '',
    shopId: process.env.PAYOO_SHOP_ID ?? '',
    checksumKey: process.env.PAYOO_CHECKSUM_KEY ?? 'change-me-checksum-key',
  },
};
