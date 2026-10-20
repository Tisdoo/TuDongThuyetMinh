/**
 * ============================================================================
 *  XỬ LÝ RETURN URL CỦA VNPAY
 * ============================================================================
 *
 *  Sau khi khách thanh toán xong (hoặc bấm hủy), VNPAY chuyển TRÌNH DUYỆT của
 *  khách về vnp_ReturnUrl kèm kết quả trên query string.
 *
 *  Nhiệm vụ DUY NHẤT ở đây: xác thực chữ ký rồi cho khách thấy giao diện thành
 *  công / thất bại. TUYỆT ĐỐI KHÔNG cập nhật Database ở đây (việc đó của IPN),
 *  vì dữ liệu này đi qua trình duyệt nên khách có thể tắt tab hoặc sửa URL.
 *
 *  Hàm chỉ ĐỌC Database (không ghi) để lấy địa chỉ trang kết quả của frontend.
 *
 *  Kết quả: chuyển hướng về frontend dạng
 *      {FRONTEND_URL}/payment/return?auth_code=...&order=...&status=success|failed&code=..
 *  Frontend (tools/tourist/index.html -> handleReturn):
 *      - status=failed : hiện màn hình "Thanh toán thất bại".
 *      - status=success: hiện "Đang xác nhận..." và hỏi Auth Service cho tới khi
 *        IPN đã cập nhật đơn sang PAID -> giao diện thành công phản ánh đúng DB.
 */
import { config } from '../config';
import { pool } from '../db';
import { describeResponseCode, isTransactionSuccess, pickVnpParams, verifySecureHash } from './vnpay';

export interface VnpayReturnResult {
  validSignature: boolean;
  status: 'success' | 'failed';
  orderCode: string | null;
  responseCode: string | null;
  message: string;
  redirectUrl: string; // địa chỉ frontend để chuyển khách tới
}

export async function resolveVnpayReturn(query: unknown): Promise<VnpayReturnResult> {
  const params = pickVnpParams(query);

  // Bước 1: Xác thực chữ ký. Sai chữ ký -> coi như thất bại và KHÔNG tin bất kỳ
  // tham số nào khác (kể cả mã đơn), nên cũng không tra cứu DB.
  if (!verifySecureHash(params, config.vnpay.hashSecret)) {
    return {
      validSignature: false,
      status: 'failed',
      orderCode: null,
      responseCode: null,
      message: 'Chữ ký không hợp lệ (dữ liệu có thể đã bị sửa)',
      redirectUrl: `${config.frontendUrl}/payment/return?status=failed&reason=INVALID_SIGNATURE`,
    };
  }

  // Bước 2: Đọc kết quả giao dịch.
  const orderCode = params.vnp_TxnRef;
  const responseCode = params.vnp_ResponseCode ?? null;
  const status = isTransactionSuccess(params) ? 'success' : 'failed';

  // Bước 3: Lấy URL trang kết quả của frontend đã lưu lúc tạo đơn (chứa auth_code
  // để khách nhận vé). Chỉ SELECT, không UPDATE.
  const { rows } = await pool.query(
    `SELECT t.raw_response->>'returnUrl' AS return_url
       FROM payment_transactions t
       JOIN payment_orders o ON o.id = t.order_id
      WHERE o.order_code = $1 AND t.provider = 'VNPAY'
      LIMIT 1`,
    [orderCode],
  );
  const base: string =
    rows[0]?.return_url ?? `${config.frontendUrl}/payment/return?order=${encodeURIComponent(orderCode)}`;
  const sep = base.includes('?') ? '&' : '?';

  // Bước 4: Trả về kết quả để route chuyển hướng khách sang giao diện tương ứng.
  return {
    validSignature: true,
    status,
    orderCode,
    responseCode,
    message: describeResponseCode(responseCode ?? undefined),
    redirectUrl: `${base}${sep}status=${status}&code=${encodeURIComponent(responseCode ?? '')}`,
  };
}
