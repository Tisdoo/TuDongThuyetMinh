/**
 * Tự kiểm tra phần lõi VNPAY (không cần DB, không cần mạng).
 * Chạy:  npx tsx scripts/vnpay-selftest.ts
 *
 * So khớp với thuật toán trong code mẫu Node.js chính thức của VNPAY
 * (sortObject + querystring.stringify(encode:false) + HMAC-SHA512).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import querystring from 'node:querystring';
import {
  buildPaymentUrl, buildSignData, formatVnpDate, normalizeIp, pickVnpParams,
  sign, toVnpOrderInfo, verifySecureHash,
} from '../src/services/vnpay';

const cfg = {
  tmnCode: 'TESTCODE',
  hashSecret: 'TESTSECRETTESTSECRETTESTSECRET12',
  payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  returnUrl: 'http://localhost:5175/api/payments/vnpay/return',
};

// --- Thuật toán tham chiếu, chép theo code mẫu VNPAY ---
function officialSortObject(obj: Record<string, string>) {
  const sorted: Record<string, string> = {};
  const keys = Object.keys(obj).map(encodeURIComponent).sort();
  for (const k of keys) sorted[k] = encodeURIComponent(obj[k]).replace(/%20/g, '+');
  return sorted;
}
function officialSign(params: Record<string, string>, secret: string) {
  const signData = querystring.stringify(officialSortObject(params), undefined, undefined, { encodeURIComponent: (s) => s });
  return crypto.createHmac('sha512', secret).update(Buffer.from(signData, 'utf-8')).digest('hex');
}

let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('  ok -', name); };

console.log('VNPAY self-test');

test('formatVnpDate dùng GMT+7 bất kể múi giờ server', () => {
  assert.equal(formatVnpDate(new Date('2026-10-18T17:05:09Z')), '20261019000509');
});

test('toVnpOrderInfo bỏ dấu và ký tự đặc biệt', () => {
  assert.equal(toVnpOrderInfo('Vé tham quan - Đà Nẵng #1'), 'Ve tham quan Da Nang 1');
});

test('normalizeIp', () => {
  assert.equal(normalizeIp('::ffff:10.0.0.5'), '10.0.0.5');
  assert.equal(normalizeIp('::1'), '127.0.0.1');
  assert.equal(normalizeIp('unknown'), '127.0.0.1');
});

const now = new Date('2026-10-18T12:00:00Z');
const url = buildPaymentUrl({
  orderCode: 'ABCD2345', amount: 20000, orderInfo: 'Ve tham quan trong ngay ABCD2345',
  ipAddr: '1.2.3.4', createdAt: now, expiresAt: new Date(now.getTime() + 30 * 60_000),
}, cfg);
const parsed = Object.fromEntries(new URL(url).searchParams) as Record<string, string>;

test('URL thanh toán có đủ tham số bắt buộc, số tiền nhân 100', () => {
  assert.equal(parsed.vnp_Version, '2.1.0');
  assert.equal(parsed.vnp_Command, 'pay');
  assert.equal(parsed.vnp_TmnCode, 'TESTCODE');
  assert.equal(parsed.vnp_Amount, '2000000');
  assert.equal(parsed.vnp_TxnRef, 'ABCD2345');
  assert.equal(parsed.vnp_CreateDate, '20261018190000');
  assert.equal(parsed.vnp_ExpireDate, '20261018193000');
  assert.match(parsed.vnp_SecureHash, /^[0-9a-f]{128}$/);
});

test('chữ ký khớp với thuật toán mẫu chính thức của VNPAY', () => {
  const { vnp_SecureHash, ...rest } = parsed;
  assert.equal(vnp_SecureHash, officialSign(rest, cfg.hashSecret));
});

test('verifySecureHash chấp nhận dữ liệu nguyên vẹn', () => {
  assert.equal(verifySecureHash(parsed, cfg.hashSecret), true);
});

test('verifySecureHash từ chối khi bị sửa tham số / sai secret / thiếu hash', () => {
  assert.equal(verifySecureHash({ ...parsed, vnp_Amount: '100' }, cfg.hashSecret), false);
  assert.equal(verifySecureHash(parsed, 'WRONG-SECRET'), false);
  const { vnp_SecureHash: _drop, ...noHash } = parsed;
  assert.equal(verifySecureHash(noHash, cfg.hashSecret), false);
});

test('hash chữ HOA vẫn hợp lệ, tham số ngoài vnp_* bị bỏ qua khi ký', () => {
  assert.equal(verifySecureHash({ ...parsed, vnp_SecureHash: parsed.vnp_SecureHash.toUpperCase() }, cfg.hashSecret), true);
  assert.equal(buildSignData({ ...parsed, foo: 'bar' }), buildSignData(parsed));
});

test('pickVnpParams loại key trùng (mảng) -> chữ ký thất bại', () => {
  const picked = pickVnpParams({ ...parsed, vnp_Amount: ['2000000', '1'] });
  assert.equal(picked.vnp_Amount, undefined);
  assert.equal(verifySecureHash(picked, cfg.hashSecret), false);
});

test('ký dữ liệu có dấu cách / ký tự đặc biệt giống mẫu chính thức', () => {
  const p = { vnp_OrderInfo: 'Thanh toan don hang 123', vnp_ReturnUrl: 'https://a.b/c?x=1&y=2', vnp_Amount: '1000' };
  assert.equal(sign(buildSignData(p), 's'), officialSign(p, 's'));
});

console.log(`\n${n} test đều đạt.`);
