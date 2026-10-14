import fs from 'fs';
import path from 'path';
import { createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject } from 'crypto';
import { exportJWK, JWK } from 'jose';
import { config } from './config';
import { pool } from './db';

let privateKey: KeyObject;
let publicJwk: JWK;

export async function initKeys() {
  let pem = config.jwtPrivateKeyPem?.replace(/\\n/g, '\n');
  if (!pem) {
    const dir = path.join(process.cwd(), '.keys');
    const file = path.join(dir, 'private.pem');
    if (fs.existsSync(file)) {
      pem = fs.readFileSync(file, 'utf8');
    } else {
      const { privateKey: pk } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      pem = pk.export({ type: 'pkcs8', format: 'pem' }).toString();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, pem, { mode: 0o600 });
      console.warn('[keys] JWT_PRIVATE_KEY_PEM not set: generated a dev key in .keys/private.pem');
    }
  }
  privateKey = createPrivateKey(pem);
  const pub = createPublicKey(privateKey);
  publicJwk = { ...(await exportJWK(pub)), kid: config.jwtKid, alg: 'RS256', use: 'sig' };
  await pool.query(
    `INSERT INTO signing_keys (kid, public_key_pem, status) VALUES ($1,$2,'ACTIVE') ON CONFLICT (kid) DO NOTHING`,
    [config.jwtKid, pub.export({ type: 'spki', format: 'pem' }).toString()],
  );
}

export const getPrivateKey = () => privateKey;
export const getPublicJwk = () => publicJwk;
