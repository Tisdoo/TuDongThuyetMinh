/**
 * ============================================================================
 *  VNPAY ADAPTER (phiên bản API 2.1.0) — PHẦN LÕI, KHÔNG ĐỤNG DATABASE
 * ============================================================================
 *
 *  File này chỉ chứa các hàm "thuần" (pure function): cùng input -> cùng output,
 *  không gọi DB, không gọi mạng. Nhờ vậy:
 *    - Dễ viết unit test (xem scripts/vnpay-selftest.ts).
 *    - Dễ giải thích khi vấn đáp: toàn bộ logic chữ ký nằm gọn ở một chỗ.
 *
 *  Ba việc chính:
 *    1. buildPaymentUrl()   : tạo URL thanh toán có chữ ký để chuyển khách sang VNPAY.
 *    2. verifySecureHash()  : kiểm tra chữ ký trên dữ liệu VNPAY gửi về (Return URL / IPN).
 *    3. isTransactionSuccess(): đọc kết quả giao dịch theo đúng quy tắc của VNPAY.
 *
 *  LƯU Ý THUẬT NGỮ: VNPAY gọi là "SHA512" nhưng thực chất là HMAC-SHA512, tức là
 *  băm SHA512 CÓ KHÓA BÍ MẬT (HashSecret). Khác với SHA512 thường ở chỗ: người
 *  không có HashSecret thì không thể tạo ra chữ ký hợp lệ, kể cả khi biết hết
 *  các tham số còn lại.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import net from 'net';

// ---------------------------------------------------------------------------
// Kiểu dữ liệu
// ---------------------------------------------------------------------------

/** Cấu hình merchant do VNPAY cấp (đọc từ biến môi trường ở config.ts). */
export interface VnpayConfig {
  tmnCode: string;    // Mã website (Terminal ID) VNPAY cấp khi đăng ký sandbox
  hashSecret: string; // Chuỗi bí mật dùng để ký HMAC-SHA512. TUYỆT ĐỐI không gửi xuống frontend
  payUrl: string;     // URL cổng thanh toán (sandbox: https://sandbox.vnpayment.vn/paymentv2/vpcpay.html)
  returnUrl: string;  // URL VNPAY chuyển TRÌNH DUYỆT của khách về sau khi thanh toán
}

/** Tập tham số vnp_* dạng key -> value (đều là chuỗi). */
export type VnpParams = Record<string, string>;

/** Thông tin đơn hàng cần để tạo URL thanh toán. */
export interface CreatePaymentInput {
  orderCode: string;   // Mã đơn của hệ thống -> vnp_TxnRef (phải duy nhất trong ngày)
  amount: number;      // Số tiền VND (số nguyên, KHÔNG nhân 100 — hàm sẽ tự nhân)
  orderInfo: string;   // Nội dung thanh toán (sẽ được bỏ dấu tiếng Việt)
  ipAddr: string;      // IP của khách hàng
  createdAt: Date;     // Thời điểm tạo giao dịch
  expiresAt: Date;     // Hết thời điểm này VNPAY không cho thanh toán nữa
  locale?: 'vn' | 'en';
  bankCode?: string;   // Tùy chọn: VNPAYQR, VNBANK, INTCARD... Bỏ trống = khách tự chọn trên trang VNPAY
}

/** Phiên bản API và lệnh thanh toán theo tài liệu VNPAY. */
const VNP_VERSION = '2.1.0';
const VNP_COMMAND = 'pay';
const VNP_CURRENCY = 'VND';
const VNP_ORDER_TYPE = 'other';

// ---------------------------------------------------------------------------
// 1. CHỮ KÝ ĐIỆN TỬ (Secure Hash)
// ---------------------------------------------------------------------------

/**
 * Encode giống hệt code mẫu Node.js chính thức của VNPAY:
 * encodeURIComponent rồi đổi "%20" (dấu cách) thành "+".
 * Hai phía (merchant và VNPAY) phải encode GIỐNG NHAU thì chữ ký mới khớp.
 */
function encodeVnp(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

/**
 * Tạo "chuỗi dữ liệu cần ký" (signData) từ tập tham số.
 *
 *   Bước 1: Chỉ lấy các tham số bắt đầu bằng "vnp_".
 *   Bước 2: Loại bỏ chính vnp_SecureHash và vnp_SecureHashType (không ký lên chữ ký).
 *   Bước 3: Sắp xếp tên tham số theo thứ tự bảng chữ cái (a -> z).
 *   Bước 4: Nối thành chuỗi "key1=value1&key2=value2..." với value đã encode.
 *
 * Ví dụ: { vnp_Amount: '2000000', vnp_Command: 'pay' } -> "vnp_Amount=2000000&vnp_Command=pay"
 *
 * Chuỗi này đồng thời là query string của URL thanh toán.
 */
export function buildSignData(params: VnpParams): string {
  return Object.keys(params)
    .filter((key) => key.startsWith('vnp_'))
    .filter((key) => key !== 'vnp_SecureHash' && key !== 'vnp_SecureHashType')
    .sort()
    .map((key) => `${encodeVnp(key)}=${encodeVnp(params[key])}`)
    .join('&');
}

/**
 * Tính chữ ký: HMAC-SHA512(HashSecret, signData), xuất dạng hex.
 */
export function sign(signData: string, hashSecret: string): string {
  return createHmac('sha512', hashSecret).update(Buffer.from(signData, 'utf-8')).digest('hex');
}

/**
 * Kiểm tra chữ ký VNPAY gửi về (dùng chung cho Return URL và IPN).
 *
 *   Bước 1: Lấy vnp_SecureHash mà VNPAY gửi kèm.
 *   Bước 2: Tự tính lại chữ ký từ các tham số còn lại + HashSecret của mình.
 *   Bước 3: So sánh hai chữ ký.
 *
 * Nếu kẻ gian sửa bất kỳ tham số nào (ví dụ đổi vnp_ResponseCode từ 24 thành 00,
 * hay đổi vnp_Amount) thì chữ ký tính lại sẽ khác -> trả về false.
 *
 * Dùng timingSafeEqual (so sánh thời gian hằng) thay cho "===" để kẻ tấn công
 * không đoán dần được chữ ký qua việc đo thời gian phản hồi (timing attack).
 */
export function verifySecureHash(params: VnpParams, hashSecret: string): boolean {
  const received = params.vnp_SecureHash;
  if (!received || !hashSecret) return false;

  const expected = sign(buildSignData(params), hashSecret);
  const a = Buffer.from(expected.toLowerCase(), 'utf8');
  const b = Buffer.from(received.toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// 2. TẠO URL THANH TOÁN
// ---------------------------------------------------------------------------

/**
 * Tạo URL thanh toán VNPAY có chữ ký.
 *
 * Luồng: Backend gọi hàm này -> trả paymentUrl cho frontend -> frontend
 * chuyển hướng (location.href = paymentUrl) -> khách thấy trang VNPAY.
 */
export function buildPaymentUrl(input: CreatePaymentInput, cfg: VnpayConfig): string {
  // Bước 1: Kiểm tra dữ liệu đầu vào. Số tiền VND phải là số nguyên dương.
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new Error(`VNPAY: số tiền không hợp lệ (${input.amount})`);
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.orderCode)) {
    throw new Error(`VNPAY: mã đơn không hợp lệ (${input.orderCode})`);
  }

  // Bước 2: Gom các tham số theo tài liệu VNPAY.
  const params: VnpParams = {
    vnp_Version: VNP_VERSION,
    vnp_Command: VNP_COMMAND,
    vnp_TmnCode: cfg.tmnCode,
    // VNPAY yêu cầu số tiền NHÂN 100 (bỏ phần thập phân). 20.000đ -> "2000000".
    vnp_Amount: String(input.amount * 100),
    vnp_CurrCode: VNP_CURRENCY,
    vnp_TxnRef: input.orderCode,
    vnp_OrderInfo: toVnpOrderInfo(input.orderInfo),
    vnp_OrderType: VNP_ORDER_TYPE,
    vnp_Locale: input.locale ?? 'vn',
    vnp_ReturnUrl: cfg.returnUrl,
    vnp_IpAddr: normalizeIp(input.ipAddr),
    // Thời gian theo múi giờ GMT+7, định dạng yyyyMMddHHmmss.
    vnp_CreateDate: formatVnpDate(input.createdAt),
    vnp_ExpireDate: formatVnpDate(input.expiresAt),
  };
  if (input.bankCode) params.vnp_BankCode = input.bankCode;

  // Bước 3: Sắp xếp + encode + ký.
  const signData = buildSignData(params);
  const secureHash = sign(signData, cfg.hashSecret);

  // Bước 4: Ghép URL. Query string chính là signData, thêm vnp_SecureHash ở cuối.
  return `${cfg.payUrl}?${signData}&vnp_SecureHash=${secureHash}`;
}

// ---------------------------------------------------------------------------
// 3. ĐỌC KẾT QUẢ GIAO DỊCH
// ---------------------------------------------------------------------------

/**
 * Giao dịch chỉ được coi là THÀNH CÔNG khi CẢ HAI mã đều là "00":
 *   - vnp_ResponseCode    : kết quả xử lý thanh toán
 *   - vnp_TransactionStatus: trạng thái giao dịch tại VNPAY
 */
export function isTransactionSuccess(params: VnpParams): boolean {
  return params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00';
}

/** Bảng mã vnp_ResponseCode (dùng để log và hiển thị lý do thất bại). */
export const VNP_RESPONSE_MESSAGES: Record<string, string> = {
  '00': 'Giao dịch thành công',
  '07': 'Trừ tiền thành công nhưng giao dịch bị nghi ngờ (gian lận, bất thường)',
  '09': 'Thẻ/Tài khoản chưa đăng ký InternetBanking',
  '10': 'Xác thực thông tin thẻ/tài khoản sai quá 3 lần',
  '11': 'Hết hạn chờ thanh toán',
  '12': 'Thẻ/Tài khoản bị khóa',
  '13': 'Nhập sai mật khẩu xác thực giao dịch (OTP)',
  '24': 'Khách hàng hủy giao dịch',
  '51': 'Tài khoản không đủ số dư',
  '65': 'Tài khoản vượt quá hạn mức giao dịch trong ngày',
  '75': 'Ngân hàng thanh toán đang bảo trì',
  '79': 'Nhập sai mật khẩu thanh toán quá số lần quy định',
  '99': 'Lỗi khác',
};

export const describeResponseCode = (code: string | undefined): string =>
  (code && VNP_RESPONSE_MESSAGES[code]) || `Mã lỗi không xác định (${code ?? 'trống'})`;

/**
 * Lọc dữ liệu query thô (req.query của Express) thành VnpParams an toàn:
 * chỉ giữ tham số "vnp_*" có giá trị là CHUỖI. Nếu ai đó gửi trùng key
 * (vnp_Amount=1&vnp_Amount=2 -> mảng) thì key đó bị bỏ, khiến chữ ký sai và
 * yêu cầu bị từ chối — đúng như mong muốn.
 */
export function pickVnpParams(query: unknown): VnpParams {
  const out: VnpParams = {};
  if (!query || typeof query !== 'object') return out;
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (key.startsWith('vnp_') && typeof value === 'string') out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hàm tiện ích
// ---------------------------------------------------------------------------

/**
 * Định dạng ngày giờ theo yêu cầu VNPAY: yyyyMMddHHmmss, múi giờ GMT+7.
 * Cộng thẳng 7 giờ rồi đọc theo UTC để KHÔNG phụ thuộc múi giờ của server
 * (container Docker thường chạy UTC; nếu dùng giờ server sẽ lệch 7 tiếng và
 * VNPAY báo "giao dịch đã quá thời gian chờ thanh toán").
 */
export function formatVnpDate(date: Date): string {
  const d = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

/**
 * vnp_OrderInfo: VNPAY yêu cầu tiếng Việt KHÔNG DẤU, không ký tự đặc biệt.
 * "Vé tham quan - Đà Nẵng" -> "Ve tham quan Da Nang"
 */
export function toVnpOrderInfo(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // bỏ dấu
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]/g, ' ') // bỏ ký tự đặc biệt
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255);
}

/**
 * Chuẩn hóa IP: Node trả IPv4 dạng "::ffff:1.2.3.4" hoặc "::1" khi chạy local.
 * Gửi IP không hợp lệ thì VNPAY có thể từ chối, nên đưa về IPv4 khi có thể.
 */
export function normalizeIp(ip: string): string {
  const v = (ip ?? '').trim().replace(/^::ffff:/, '');
  if (v === '::1' || !net.isIP(v)) return '127.0.0.1';
  return v;
}
