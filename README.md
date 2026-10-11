# GPS - Chùa Linh Ứng: Microservices (Auth, Payment, POI, API Gateway)

TypeScript (Node 20 + Express) cho các service nghiệp vụ. Mỗi service có DB riêng, giao tiếp qua REST nội bộ + RabbitMQ (Outbox).

```
services/
  api-gateway/      :8080  JWT (JWKS) + rate limit + proxy   (/api/auth, /api/payments, /api/poi, /api/chat)
  auth-service/     :4001  grant, token RS256, mã ngắn (Redis), staff, phân quyền, audit
  payment-service/  :4002  vé, đơn hàng, Payoo (mock), tiền mặt, webhook, outbox
  poi-service/      :4003  POI, bản dịch, tour, publish dataset.json
docs/poi-suggestions/      geofence.ts (frontend) + worker.py (pipeline dịch/TTS, Python)
```

## Chạy
```bash
cp .env.example .env
docker compose up --build        # Postgres+PostGIS, Redis, RabbitMQ + 4 service
```
Gateway: http://localhost:8080 · RabbitMQ UI: http://localhost:15672 (guest/guest)
Tài khoản dev: `admin / Admin@12345`, `staff1 / Staff@12345` (đổi ngay khi triển khai thật).

Chạy từng service để debug: `docker compose up postgres redis rabbitmq -d`, rồi trong thư mục service: `npm install && npm run dev`
(mặc định trỏ localhost; riêng payment-service cần auth-service đang chạy).

## Thử luồng ONLINE (mock Payoo)
```bash
B=http://localhost:8080/api
curl -s -X POST $B/payments/online -H 'content-type: application/json' -d '{"productCode":"DAY_PASS","lang":"vi"}'
# -> { orderCode, paymentUrl, authCode, ... }
curl -s -X POST $B/auth/exchange -H 'content-type: application/json' -d '{"authCode":"<authCode>"}'   # 202 PAYMENT_PENDING
# Mở paymentUrl trong trình duyệt (hoặc curl -L) = "khách đã trả tiền" (thêm ?result=fail để thử thất bại)
curl -s -X POST $B/auth/exchange -H 'content-type: application/json' -d '{"authCode":"<authCode>"}'   # 200 { accessToken }
```

## Thử luồng TIỀN MẶT
```bash
curl -s -X POST $B/payments/cash -H 'content-type: application/json' -d '{"productCode":"DAY_PASS"}'   # -> orderCode, orderId
S=$(curl -s -X POST $B/auth/staff/login -H 'content-type: application/json' -d '{"username":"staff1","password":"Staff@12345"}' | jq -r .accessToken)
curl -s $B/payments/admin/orders/by-code/<orderCode> -H "authorization: Bearer $S"
curl -s -X POST $B/payments/admin/orders/<orderId>/confirm-cash -H "authorization: Bearer $S" -H 'content-type: application/json' -d '{"amountReceived":20000}'
curl -s $B/auth/staff/orders/<orderId>/short-code -H "authorization: Bearer $S"        # 202 -> thử lại sau 1s -> { shortCode }
curl -s -X POST $B/auth/exchange-short -H 'content-type: application/json' -d '{"shortCode":"<shortCode>"}'   # { accessToken }
```

## Thử POI
```bash
A=$(curl -s -X POST $B/auth/staff/login -H 'content-type: application/json' -d '{"username":"admin","password":"Admin@12345"}' | jq -r .accessToken)
curl -s -X POST $B/poi/admin/pois -H "authorization: Bearer $A" -H 'content-type: application/json' \
  -d '{"code":"TUONG_PHAT_BA","latitude":16.1000,"longitude":108.2780,"triggerRadiusM":30,"status":"PUBLISHED"}'   # toạ độ minh hoạ, thay bằng toạ độ thật
curl -s -X PUT $B/poi/admin/pois/<id>/translations/vi -H "authorization: Bearer $A" -H 'content-type: application/json' \
  -d '{"name":"Tượng Phật Bà","shortDescription":"...","description":"..."}'
curl -s -X POST $B/poi/admin/publish -H "authorization: Bearer $A"
curl -s $B/poi/dataset/latest -H "authorization: Bearer <tourist accessToken>"
```

## Việc còn lại
- **Payoo thật**: `payment-service/src/services/payoo.ts` (mode `sandbox` ném 501). Cần tài liệu sandbox Payoo để điền request + định dạng chữ ký.
- POI: outbox publisher (copy từ payment-service), upload Blob/CDN, route_segments API, worker dịch/TTS (`docs/poi-suggestions/worker.py`).
- Chatbot (Python/FastAPI), monitoring, frontend PWA + Admin dashboard.
- Production: `JWT_PRIVATE_KEY_PEM`, `INTERNAL_API_KEY`, `PAYOO_CHECKSUM_KEY` bắt buộc đổi; tách DB server; HTTPS.

Chưa được build/chạy thử trong môi trường tạo mã (không có mạng để `npm install`): chỉ mới kiểm tra cú pháp. Có thể cần sửa lỗi nhỏ khi chạy lần đầu.

## Công cụ cho nhóm
- `tools/staff/staff.html`: trang quầy nhân viên (đăng nhập, danh sách đơn tiền mặt chờ, xác nhận thu, hiện mã ngắn).
  Chạy: `cd tools/staff && python -m http.server 5174` rồi mở http://localhost:5174/staff.html
- `scripts/smoke.mjs`: kiểm thử tự động các luồng chính. Chạy: `node scripts/smoke.mjs` (thêm `BRUTE=1` để thử khóa mã ngắn).
