/**
 * GIẢ LẬP VNPAY GỌI IPN — dùng khi chạy local chưa có ngrok, hoặc để DEMO bảo mật khi vấn đáp.
 *
 * Script tự ký dữ liệu bằng VNP_HASH_SECRET giống hệt VNPAY rồi gọi vào /payments/vnpay/ipn.
 *
 * Cách dùng (trong thư mục services/payment-service, cần .env có VNP_TMN_CODE, VNP_HASH_SECRET):
 *   npx tsx scripts/vnpay-sim-ipn.ts <orderCode> <amountVND> [kịch bản] [baseUrl]
 *
 * Kịch bản:
 *   success        (mặc định) thanh toán thành công          -> mong đợi RspCode 00, lần 2 -> 02
 *   fail           khách hủy giao dịch (mã 24)                -> 00, đơn chuyển FAILED
 *   bad-signature  sửa vnp_ResponseCode sau khi ký (giả mạo)   -> 97
 *   wrong-amount   ký hợp lệ nhưng số tiền khác DB            -> 04
 *   unknown-order  mã đơn không tồn tại                       -> 01
 *
 * baseUrl mặc định: http://localhost:4002 (gọi thẳng payment-service).
 * Qua gateway: http://localhost:8080/api
 */
import 'dotenv/config';
import { buildSignData, formatVnpDate, sign, VnpParams } from '../src/services/vnpay';

const [orderCode, amountArg, scenario = 'success', baseUrl = 'http://localhost:4002'] = process.argv.slice(2);
if (!orderCode || !amountArg) {
  console.error('Cách dùng: npx tsx scripts/vnpay-sim-ipn.ts <orderCode> <amountVND> [success|fail|bad-signature|wrong-amount|unknown-order] [baseUrl]');
  process.exit(1);
}
const tmnCode = process.env.VNP_TMN_CODE ?? '';
const secret = process.env.VNP_HASH_SECRET ?? '';
if (!tmnCode || !secret) { console.error('Thiếu VNP_TMN_CODE / VNP_HASH_SECRET trong .env'); process.exit(1); }

const success = scenario !== 'fail';
const amount = Number(amountArg) * (scenario === 'wrong-amount' ? 0.5 : 1);
const params: VnpParams = {
  vnp_TmnCode: tmnCode,
  vnp_TxnRef: scenario === 'unknown-order' ? 'NOTEXIST' : orderCode,
  vnp_Amount: String(Math.round(amount * 100)),
  vnp_OrderInfo: `Thanh toan don ${orderCode}`,
  vnp_ResponseCode: success ? '00' : '24',
  vnp_TransactionStatus: success ? '00' : '02',
  vnp_TransactionNo: success ? String(14000000 + Math.floor(Math.random() * 999999)) : '0',
  vnp_BankCode: 'NCB',
  vnp_CardType: 'ATM',
  vnp_PayDate: formatVnpDate(new Date()),
};
params.vnp_SecureHash = sign(buildSignData(params), secret);

// Kẻ gian sửa kết quả SAU khi đã có chữ ký -> chữ ký không còn khớp.
if (scenario === 'bad-signature') params.vnp_ResponseCode = '00', params.vnp_Amount = '100';

const url = `${baseUrl}/payments/vnpay/ipn?${new URLSearchParams(params)}`;
(async () => {
  console.log(`[sim] ${scenario} -> ${url.slice(0, 120)}...`);
  const res = await fetch(url);
  console.log(`[sim] HTTP ${res.status}`, await res.text());
})();
