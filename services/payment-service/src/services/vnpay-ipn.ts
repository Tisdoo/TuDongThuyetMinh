/**
 * ============================================================================
 *  XỬ LÝ IPN (Instant Payment Notification) CỦA VNPAY
 * ============================================================================
 *
 *  IPN là API mà SERVER VNPAY gọi ngầm (server-to-server) về server của mình
 *  sau khi giao dịch kết thúc. Đây là NƠI DUY NHẤT được phép cập nhật trạng
 *  thái đơn hàng trong Database.
 *
 *  Vì sao không cập nhật DB ở Return URL?
 *    - Return URL đi qua trình duyệt của khách: khách có thể tắt tab, mất mạng
 *      (đơn không bao giờ được cập nhật), hoặc tự sửa URL (giả mạo kết quả).
 *    - IPN do VNPAY gọi trực tiếp, có chữ ký, và VNPAY sẽ GỌI LẠI nếu mình
 *      chưa trả lời thành công -> đáng tin và không bị mất.
 *
 *  Thứ tự kiểm tra (theo tài liệu VNPAY) và mã phản hồi tương ứng:
 *    B1. Chữ ký sai                         -> RspCode 97
 *    B2. Không tìm thấy đơn                 -> RspCode 01
 *    B3. Số tiền không khớp                 -> RspCode 04
 *    B4. Đơn đã được xử lý trước đó         -> RspCode 02
 *    B5. Cập nhật thành công                -> RspCode 00
 *        Lỗi bất ngờ (DB sập, ...)          -> RspCode 99  (VNPAY sẽ gọi lại sau)
 *
 *  Phản hồi luôn là HTTP 200 với JSON { RspCode, Message } — đây là định dạng
 *  VNPAY yêu cầu; VNPAY đọc RspCode chứ không đọc HTTP status.
 */
import { PoolClient } from 'pg';
import { config } from '../config';
import { pool, tx } from '../db';
import { enqueue } from './outbox';
import {
  describeResponseCode,
  isTransactionSuccess,
  pickVnpParams,
  verifySecureHash,
  VnpParams,
} from './vnpay';

export type IpnRspCode = '00' | '01' | '02' | '04' | '97' | '99';
export interface IpnResponse {
  RspCode: IpnRspCode;
  Message: string;
}

const reply = (RspCode: IpnRspCode, Message: string): IpnResponse => ({ RspCode, Message });

/**
 * Hàm chính xử lý IPN.
 * @param query req.query của Express (VNPAY gửi dữ liệu trên query string)
 */
export async function handleVnpayIpn(query: unknown): Promise<IpnResponse> {
  const params = pickVnpParams(query);

  try {
    // ---------------------------------------------------------------------
    // B1. XÁC THỰC CHỮ KÝ
    // Không có HashSecret thì không ai tạo được chữ ký đúng -> request giả mạo
    // (ví dụ kẻ gian tự gọi /ipn với vnp_ResponseCode=00) bị chặn ngay ở đây.
    // ---------------------------------------------------------------------
    if (!verifySecureHash(params, config.vnpay.hashSecret)) {
      await logWebhook(pool, params, false, 'INVALID_SIGNATURE');
      console.warn('[vnpay-ipn] chữ ký không hợp lệ, từ chối', params.vnp_TxnRef);
      return reply('97', 'Invalid signature');
    }

    // Chữ ký đúng nhưng của merchant khác (cấu hình nhầm) -> cũng không xử lý.
    if (params.vnp_TmnCode !== config.vnpay.tmnCode) {
      await logWebhook(pool, params, true, 'TMN_CODE_MISMATCH');
      return reply('97', 'Invalid signature');
    }

    const orderCode = params.vnp_TxnRef;
    const vnpAmount = Number(params.vnp_Amount); // đơn vị: VND x 100
    const success = isTransactionSuccess(params);

    // ---------------------------------------------------------------------
    // Các bước còn lại chạy trong MỘT TRANSACTION:
    // hoặc tất cả thay đổi được lưu, hoặc không thay đổi gì (rollback).
    // ---------------------------------------------------------------------
    return await tx(async (c) => {
      // Lưu lại mọi lần VNPAY gọi để đối soát. Trùng event_id (VNPAY gọi lại
      // cùng một kết quả) thì bỏ qua bản ghi, nhưng VẪN đi tiếp để trả đúng mã.
      const webhookId = await logWebhook(c, params, true, null);
      const done = async (note: string) => {
        if (webhookId) {
          await c.query(
            `UPDATE webhook_events SET processed = true, processed_at = now(), note = $2 WHERE id = $1`,
            [webhookId, note],
          );
        }
      };

      // -------------------------------------------------------------------
      // B2. TÌM ĐƠN HÀNG + KHÓA DÒNG (SELECT ... FOR UPDATE)
      // Khóa dòng để nếu VNPAY gọi IPN 2 lần cùng lúc, lần thứ hai phải đợi
      // lần thứ nhất xong -> không bao giờ cộng vé / bắn event 2 lần.
      // -------------------------------------------------------------------
      const { rows } = await c.query(
        `SELECT o.id, o.order_code, o.amount, o.status, o.method
           FROM payment_orders o
          WHERE o.order_code = $1
            AND o.method = 'ONLINE'
            AND EXISTS (SELECT 1 FROM payment_transactions t WHERE t.order_id = o.id AND t.provider = 'VNPAY')
          FOR UPDATE`,
        [orderCode],
      );
      const order = rows[0];
      if (!order) {
        await done('ORDER_NOT_FOUND');
        return reply('01', 'Order not found');
      }

      // -------------------------------------------------------------------
      // B3. KIỂM TRA SỐ TIỀN
      // So với số tiền LƯU TRONG DB (snapshot lúc tạo đơn), không tin số tiền
      // nào khác. Nhớ nhân 100 vì vnp_Amount có đơn vị VND x 100.
      // -------------------------------------------------------------------
      const expectedAmount = Number(order.amount) * 100;
      if (!Number.isSafeInteger(vnpAmount) || vnpAmount !== expectedAmount) {
        await done('AMOUNT_MISMATCH');
        console.error(`[vnpay-ipn] lệch số tiền order=${orderCode} expected=${expectedAmount} got=${params.vnp_Amount}`);
        return reply('04', 'Invalid amount');
      }

      // -------------------------------------------------------------------
      // B4. KIỂM TRA TRẠNG THÁI ĐƠN (chống xử lý lặp - idempotency)
      // Chỉ đơn đang PENDING mới được cập nhật. Đơn đã PAID/FAILED/EXPIRED/
      // CANCELLED thì trả 02 để VNPAY ngừng gọi lại.
      // -------------------------------------------------------------------
      if (order.status !== 'PENDING') {
        if (success && order.status !== 'PAID') {
          // Khách trả tiền thành công nhưng đơn đã hết hạn/bị hủy: cần nhân viên
          // đối soát và hoàn tiền thủ công. Ghi log rõ ràng để không bị sót.
          console.error(`[vnpay-ipn] CẦN ĐỐI SOÁT: đơn ${orderCode} đang ${order.status} nhưng VNPAY báo thành công`);
          await done(`LATE_PAYMENT_REVIEW:${order.status}`);
        } else {
          await done(`ALREADY_${order.status}`);
        }
        return reply('02', 'Order already confirmed');
      }

      // -------------------------------------------------------------------
      // B5. CẬP NHẬT DATABASE
      // -------------------------------------------------------------------
      if (success) {
        await markPaid(c, order.id, params);
        // Ghi event vào outbox trong CÙNG transaction -> Auth Service sẽ nhận
        // PaymentSucceeded và kích hoạt vé (access grant) cho khách.
        await enqueue(c, 'PaymentSucceeded', order.id, { orderCode, channel: 'ONLINE' });
        await done('PAID');
      } else {
        const code = params.vnp_ResponseCode;
        await markFailed(c, order.id, params);
        await enqueue(c, 'PaymentFailed', order.id, { orderCode, channel: 'ONLINE', reason: `VNPAY_${code}` });
        await done(`FAILED:${code}`);
        console.info(`[vnpay-ipn] đơn ${orderCode} thất bại: ${describeResponseCode(code)}`);
      }
      return reply('00', 'Confirm Success');
    });
  } catch (err) {
    // Lỗi bất ngờ: transaction đã rollback, trả 99 để VNPAY gọi lại sau.
    console.error('[vnpay-ipn] lỗi xử lý', err);
    return reply('99', 'Unknown error');
  }
}

// ---------------------------------------------------------------------------
// Các hàm cập nhật DB (tách riêng cho dễ đọc)
// ---------------------------------------------------------------------------

/** Đơn -> PAID; giao dịch -> SUCCESS, lưu mã giao dịch VNPAY (vnp_TransactionNo) để đối soát. */
async function markPaid(c: PoolClient, orderId: string, p: VnpParams) {
  await c.query(
    `UPDATE payment_orders SET status = 'PAID', paid_at = now(), updated_at = now() WHERE id = $1`,
    [orderId],
  );
  await c.query(
    `UPDATE payment_transactions
        SET status = 'SUCCESS', completed_at = now(),
            provider_txn_id = $2,
            raw_response = COALESCE(raw_response, '{}'::jsonb) || jsonb_build_object('ipn', $3::jsonb)
      WHERE order_id = $1 AND provider = 'VNPAY'`,
    [orderId, p.vnp_TransactionNo ? `VNPAY-${p.vnp_TransactionNo}` : null, JSON.stringify(p)],
  );
}

/** Đơn -> FAILED; giao dịch -> FAILED. Khách muốn mua lại sẽ tạo đơn mới. */
async function markFailed(c: PoolClient, orderId: string, p: VnpParams) {
  await c.query(`UPDATE payment_orders SET status = 'FAILED', updated_at = now() WHERE id = $1`, [orderId]);
  await c.query(
    `UPDATE payment_transactions
        SET status = 'FAILED', completed_at = now(),
            raw_response = COALESCE(raw_response, '{}'::jsonb) || jsonb_build_object('ipn', $2::jsonb)
      WHERE order_id = $1 AND provider = 'VNPAY'`,
    [orderId, JSON.stringify(p)],
  );
}

/**
 * Ghi nhật ký IPN vào bảng webhook_events (dùng chung với Payoo).
 * event_id = mã đơn + mã GD VNPAY + mã kết quả -> mỗi kết quả chỉ lưu một lần.
 * Trả về id bản ghi mới, hoặc null nếu bản ghi đã tồn tại (VNPAY gọi lại).
 */
async function logWebhook(
  db: PoolClient | typeof pool,
  p: VnpParams,
  signatureValid: boolean,
  note: string | null,
): Promise<string | null> {
  const eventId = signatureValid
    ? `${p.vnp_TxnRef ?? '?'}:${p.vnp_TransactionNo ?? '0'}:${p.vnp_ResponseCode ?? '?'}`
    : `INVALID:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const { rows } = await db.query(
    `INSERT INTO webhook_events (provider, event_id, payload, signature_valid, note)
     VALUES ('VNPAY', $1, $2, $3, $4)
     ON CONFLICT (provider, event_id) DO NOTHING
     RETURNING id`,
    [eventId.slice(0, 100), JSON.stringify(p), signatureValid, note],
  );
  return rows[0]?.id ?? null;
}
