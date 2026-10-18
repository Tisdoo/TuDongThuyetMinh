-- Them hinh thuc thanh toan MOMO_QR (chuyen khoan qua ma QR MoMo, nhan vien doi soat thu cong)
ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_method_check;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_method_check CHECK (method IN ('ONLINE','CASH','MOMO_QR'));
