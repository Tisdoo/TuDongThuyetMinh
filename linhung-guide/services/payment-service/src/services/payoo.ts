import { createHash, timingSafeEqual } from 'crypto';
import { config } from '../config';
import { AppError } from '../common';

/**
 * Adapter cong thanh toan Payoo.
 * - mode=mock: gia lap hoan toan (trang thanh toan + webhook co chu ky) de test luong end-to-end.
 * - mode=sandbox: CAN TU HOAN THIEN theo tai lieu Payoo (dinh dang request, checksum, endpoint).
 */

// Quy uoc chu ky: SHA512(checksumKey + rawBody). DIEU CHINH theo tai lieu Payoo khi tich hop that.
export function signPayload(raw: string): string {
  return createHash('sha512').update(config.payoo.checksumKey + raw).digest('hex');
}

export function verifySignature(raw: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const a = Buffer.from(signPayload(raw));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createPayment(i: {
  orderCode: string;
  amount: number;
  description: string;
}): Promise<{ paymentUrl: string; providerTxnId: string }> {
  if (config.payoo.mode === 'mock') {
    return {
      paymentUrl: `${config.publicBaseUrl}/api/payments/mock/payoo/pay/${i.orderCode}`,
      providerTxnId: `MOCK-${i.orderCode}`,
    };
  }
  // TODO(sandbox): dung config.payoo.{apiUrl, shopId}, tao don hang theo spec Payoo,
  // ky bang signPayload, goi fetch(), lay paymentUrl + provider txn id tu response.
  throw new AppError(501, 'PAYOO_NOT_IMPLEMENTED', 'Implement Payoo sandbox call in services/payoo.ts');
}
