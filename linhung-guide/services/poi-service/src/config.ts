import 'dotenv/config';
import path from 'path';

export const config = {
  port: Number(process.env.PORT ?? 4003),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/poi_db',
  // Dev: luu bundle tren dia. Production: thay bang Azure Blob + CDN (xem builder.ts)
  storageDir: process.env.STORAGE_DIR ?? path.join(process.cwd(), 'storage', 'datasets'),
};
