/**
 * Các endpoint VNPAY (đều công khai, khai báo ở api-gateway PUBLIC):
 *
 *   GET  /payments/vnpay/return  : VNPAY chuyển TRÌNH DUYỆT khách về đây (chỉ hiển thị).
 *   GET  /payments/vnpay/ipn     : SERVER VNPAY gọi ngầm để cập nhật đơn (ghi DB).
 *   POST /payments/vnpay/ipn     : dự phòng nếu IPN được cấu hình gọi bằng POST.
 *
 * Endpoint TẠO URL thanh toán là POST /payments/online sẵn có (routes/public.ts):
 * khi ONLINE_PAYMENT_PROVIDER=vnpay, nó trả về paymentUrl của VNPAY.
 */
import { Router } from 'express';
import { ah } from '../common';
import { handleVnpayIpn } from '../services/vnpay-ipn';
import { resolveVnpayReturn } from '../services/vnpay-return';

export const vnpayRouter = Router();

// Return URL: xác thực chữ ký rồi chuyển khách sang trang kết quả của frontend.
// Gửi header "Accept: application/json" (Postman) để xem kết quả dạng JSON thay vì bị chuyển hướng.
vnpayRouter.get('/payments/vnpay/return', ah(async (req, res) => {
  const result = await resolveVnpayReturn(req.query);
  if (req.accepts(['html', 'json']) === 'json') return res.json(result);
  res.redirect(302, result.redirectUrl);
}));

// IPN: luôn HTTP 200 + JSON { RspCode, Message } theo yêu cầu VNPAY.
const ipn = ah(async (req, res) => {
  res.status(200).json(await handleVnpayIpn(req.query));
});
vnpayRouter.get('/payments/vnpay/ipn', ipn);
vnpayRouter.post('/payments/vnpay/ipn', ipn);
