# GPS - Chùa Linh Ứng: Web App thuyết minh đa ngôn ngữ

Đồ án Công nghệ phần mềm. Kiến trúc microservices: mỗi service có database riêng, giao tiếp qua REST nội bộ và RabbitMQ (Transactional Outbox).

## 1. Trạng thái hiện tại

| Thành phần | Trạng thái |
|---|---|
| API Gateway (JWT/JWKS, rate limit, proxy) | Đã có |
| Auth Service (token, mã ngắn, nhân viên, phân quyền, thu hồi phiên) | Đã có |
| Payment Service (đơn online/tiền mặt, webhook, Outbox, báo cáo) | Đã có, Payoo ở chế độ **mock** |
| POI Service (POI, bản dịch, tour, publish `dataset.json`) | Bản khởi đầu |
| Trang quầy nhân viên (`tools/staff`) | Đã có |
| Web App du khách (`tools/tourist`): thanh toán, bản đồ, GPS, geofence, nghe thuyết minh | Bản đầu tiên, cần thử trên thiết bị thật |
| Trang quản trị POI (`tools/admin`): thêm POI bằng bản đồ/GPS, nhập CSV, publish | Bản đầu tiên, cần thử trên thiết bị thật |
| Kiểm thử tự động (`scripts/smoke.mjs`) | Đã có |
| Payoo sandbox thật | Chưa làm (`payoo.ts` chế độ `sandbox` trả 501) |
| Dịch và audio tự động (`content-worker`) | Bản đầu tiên, cần thử với Internet |
| Chủ quán tự đăng ký + Admin duyệt | Đã có phần đăng ký và duyệt; chủ quán gửi POI chờ duyệt chưa làm |



## 2. Cấu trúc thư mục

```
linhung-guide/
├── docker-compose.yml        PostgreSQL+PostGIS, Redis, RabbitMQ + 4 service
├── .env.example              mẫu cấu hình (copy thành .env)
├── infra/postgres/init.sql   tạo 3 database: auth_db, payment_db, poi_db
├── services/
│   ├── api-gateway/    :8080  xác thực JWT, rate limit, proxy
│   ├── auth-service/   :4001  grant, token RS256, mã ngắn (Redis), nhân viên, audit
│   ├── payment-service/:4002  vé, đơn hàng, Payoo (mock), tiền mặt, webhook, outbox
│   └── poi-service/    :4003  POI, bản dịch, tour, dataset
├── infra/nginx/web.conf      nginx phục vụ web du khách + admin, chuyển /api sang Gateway
├── tools/tourist/index.html  Web App du khách (một file, Leaflet + Web Speech)
├── tools/admin/index.html    trang quản trị POI (bản đồ, GPS, CSV, publish)
├── services/content-worker/  worker Python: dịch tự động + audio Edge-TTS
├── tools/staff/staff.html    trang quầy nhân viên
├── scripts/smoke.mjs         kiểm thử tự động các luồng chính
└── docs/
    ├── data/poi-seed.sample.csv  file CSV mẫu để nhập POI
    ├── postman/              Postman collection + environment
    └── poi-suggestions/      geofence.ts (frontend), worker.py (pipeline dịch/TTS)
```

Chỉ **API Gateway** mở ra ngoài (cổng 8080). Các service còn lại chỉ truy cập được trong mạng Docker; Gateway xác thực JWT rồi gắn header `x-user-id`, `x-user-role` để service tin.

## 3. Yêu cầu cài đặt

| Công cụ | Dùng để | Bắt buộc |
|---|---|---|
| Docker Desktop (Windows: bật WSL2) | Chạy toàn bộ hệ thống | Có |
| Git | Quản lý mã nguồn | Có |
| VS Code | Đọc và sửa code | Nên có |
| Postman | Gọi API bằng giao diện | Nên có |
| Node.js 20 LTS | Chạy `smoke.mjs`, chạy từng service để debug | Cần cho kiểm thử |
| Python 3.11+ | Chạy trang nhân viên (`http.server`), pipeline sau này | Tùy chọn |
## 4. Chạy hệ thống

Mở Docker Desktop, chờ báo **Engine running**. Mở PowerShell **tại thư mục gốc `linhung-guide`** (nơi có `docker-compose.yml`):

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Lần đầu mất 3 đến 10 phút. Xong khi log có các dòng `listening on :4001`, `:4002`, `:4003`, `:8080`. Vài dòng `connect failed, retry in 3s` lúc đầu là bình thường (RabbitMQ đang khởi động).

Kiểm tra:
- `http://localhost:8080/health` trả `{"status":"ok","service":"api-gateway"}`
- `http://localhost:8080/api/payments/products` trả danh sách vé có `DAY_PASS`
- RabbitMQ: `http://localhost:15672` (guest / guest)

| Việc | Lệnh |
|---|---|
| Dừng, giữ dữ liệu | `docker compose down` |
| Chạy lại | `docker compose up` (thêm `-d` để chạy nền) |
| Build lại một service sau khi sửa code | `docker compose up --build -d auth-service` |
| Xem log | `docker compose logs -f payment-service` |
| Xóa sạch dữ liệu, làm lại từ đầu | `docker compose down -v` |


## 5. Tài khoản mặc định (chỉ để dev/demo)

| Tài khoản | Mật khẩu | Vai trò |
|---|---|---|
| `admin` | `Admin@12345` | ADMIN (đủ quyền nhân viên và quản trị) |
| `staff1` | `Staff@12345` | STAFF (quầy thu tiền) |

`staff1` được tạo khi `SEED_DEV_ACCOUNTS=true` (mặc định trong `docker-compose.yml`). Khi triển khai thật phải đặt `SEED_DEV_ACCOUNTS=false` và đổi mật khẩu admin.

## 6. API chính (qua Gateway `http://localhost:8080/api`)

| Mục đích | Phương thức và đường dẫn | Quyền |
|---|---|---|
| Danh sách vé | `GET /payments/products` | Công khai |
| Tạo đơn online | `POST /payments/online` → `orderCode`, `paymentUrl`, `authCode` | Công khai |
| Tạo đơn tiền mặt | `POST /payments/cash` → `orderCode`, `orderId` | Công khai |
| Trạng thái đơn | `GET /payments/orders/{orderCode}` | Công khai |
| Đổi `authCode` lấy token | `POST /auth/exchange` (202 chưa trả tiền, 200 có `accessToken`) | Công khai |
| Đổi mã ngắn lấy token | `POST /auth/exchange-short` | Công khai |
| Đăng nhập nhân viên | `POST /auth/staff/login`, `/refresh`, `/logout` | Công khai |
| Tìm đơn theo mã | `GET /payments/admin/orders/by-code/{code}` | STAFF, ADMIN |
| Xác nhận thu tiền mặt | `POST /payments/admin/orders/{id}/confirm-cash` body `{"amountReceived":20000}` | STAFF, ADMIN |
| Lấy / cấp lại mã ngắn | `GET /auth/staff/orders/{id}/short-code`, `POST .../short-code/reissue` | STAFF, ADMIN |
| Tra cứu, hủy đơn | `GET /payments/admin/orders`, `POST /payments/admin/orders/{id}/cancel` | STAFF, ADMIN |
| Quản lý vé, báo cáo ngày | `/payments/admin/products`, `/payments/admin/reports/daily` | ADMIN |
| Quản lý nhân viên, phiên | `/auth/admin/staff`, `/auth/admin/sessions` | ADMIN |
| POI, bản dịch, publish | `/poi/admin/pois`, `PUT .../translations/{lang}`, `POST /poi/admin/publish` | ADMIN, CONTENT_EDITOR |
| Tải dataset (một lần) | `GET /poi/dataset/latest` | Token khách hoặc nhân viên |

Quy ước:
- Token gửi trong header `Authorization: Bearer <token>`.
- Lỗi trả dạng `{ "error": { "code": "...", "message": "..." } }`.
- Token nhân viên sống 15 phút; token khách sống theo `validity_hours` của vé (mặc định 12 giờ).
- `authCode` hết hạn sau 30 phút; mã ngắn hết hạn sau 10 phút, dùng một lần.
- Gateway giới hạn tần suất: 200 yêu cầu/phút chung, 30/phút cho đổi mã và đăng nhập, 10/phút cho tạo đơn.

## 7. Thử luồng bằng Postman

Import hai file trong `docs/postman/` (collection `LinhUng` và environment `local`), chọn environment `local` ở góc trên bên phải (biến `base` = `http://localhost:8080/api`).

**Luồng online (mock Payoo):**
1. `POST /payments/online` → lưu `authCode`, `paymentUrl`.
2. `POST /auth/exchange` → **202** (chưa thanh toán).
3. Mở `paymentUrl` trong trình duyệt để giả lập khách trả tiền (thêm `?result=fail` để thử thất bại). Trang lỗi `localhost:5173` hiện ra là bình thường khi chưa có frontend.
4. Chờ 1 đến 2 giây, gọi lại `/auth/exchange` → **200** có `accessToken`.

**Luồng tiền mặt:**
1. `POST /payments/cash` → `orderCode`, `orderId`.
2. `POST /auth/staff/login` (admin hoặc staff1) → `accessToken` nhân viên.
3. `GET /payments/admin/orders/by-code/{orderCode}` → trạng thái `PENDING`.
4. `POST /payments/admin/orders/{orderId}/confirm-cash` với `{"amountReceived":20000}` → `PAID`.
5. `GET /auth/staff/orders/{orderId}/short-code` → có thể 202 vài lần, rồi 200 có `shortCode`.
6. `POST /auth/exchange-short` với `{"shortCode":"..."}` → 200 có `accessToken`.

Kết quả lỗi đúng khi thử sai (để kiểm tra phân quyền và chống lạm dụng):

| Thao tác | Kết quả đúng |
|---|---|
| Dùng lại `authCode` | 409 `CODE_ALREADY_USED` |
| Dùng lại mã ngắn | 401 `INVALID_CODE` |
| Xác nhận thu tiền lần hai | 409 `ORDER_ALREADY_PAID` |
| Thu sai số tiền trên đơn còn `PENDING` | 400 `AMOUNT_MISMATCH` |
| Gọi API không có token | 401 |
| Token khách gọi API nhân viên | 403 |
| Nhập mã ngắn sai quá 5 lần | 429 `TOO_MANY_ATTEMPTS` (khóa IP 5 phút) |
| Webhook sai chữ ký | 400 `INVALID_SIGNATURE` |

Mở khóa nhanh sau khi thử sai mã ngắn: `docker compose exec redis redis-cli flushall`.

## 8. Kiểm thử tự động

Cần Node.js 20+. Ở thư mục gốc:

```powershell
node scripts/smoke.mjs
```

Script đi qua đăng nhập, luồng online, webhook sai chữ ký và trùng, phân quyền, luồng tiền mặt, thu hồi phiên; mỗi mục in `PASS` hoặc `FAIL`, thoát mã khác 0 nếu có lỗi. Không chạy quá 2 lần mỗi phút vì Gateway giới hạn tần suất. Thêm `BRUTE=1` để thử khóa mã ngắn (sẽ khóa IP 5 phút).

Xem dữ liệu trong database:

```powershell
docker compose exec postgres psql -U postgres -d payment_db -c "select order_code, method, status, amount from payment_orders order by created_at desc limit 5;"
docker compose exec postgres psql -U postgres -d payment_db -c "select event_id, signature_valid, processed, note from webhook_events;"
docker compose exec postgres psql -U postgres -d auth_db -c "select channel, status, paid_at, consumed_at from access_grants order by created_at desc limit 5;"
```

## 9. Trang quầy nhân viên

Docker đã phục vụ sẵn trang này (service `staff-ui`, không cần cài Node hay Python):

```powershell
docker compose up -d
```

Mở `http://localhost:5174/staff.html`, đăng nhập `staff1`. Trang hiện danh sách đơn tiền mặt đang chờ (tự làm mới 5 giây); chọn đơn, bấm **Xác nhận ĐÃ THU**, mã 6 ký tự hiện ra để đọc cho khách. Cổng 5174 đã được cho phép CORS trong `docker-compose.yml`.

## 9b. Web App du khách và trang quản trị POI

Docker phục vụ cả hai qua service `web` (nginx, cổng **5175**), `/api` được chuyển sang Gateway nên không cần cấu hình CORS và ngrok chỉ cần một đường.

| Trang | Địa chỉ | Dùng để |
|---|---|---|
| Web App du khách | `http://localhost:5175` | Thanh toán, bản đồ, GPS, nghe thuyết minh |
| Chế độ giả lập vị trí | `http://localhost:5175/?sim=1` | Thử geofence khi không ở chùa: bấm nút 🧪 rồi chạm lên bản đồ để "đi" |
| Quản trị POI | `http://localhost:5175/admin/` | Thêm, sửa POI, nhập CSV, publish |
| Quầy nhân viên | `http://localhost:5174/staff.html` | Xác nhận thu tiền mặt |

Trong `.env` phải có (bản `.env.example` mới đã cập nhật):
```
FRONTEND_URL=http://localhost:5175
PUBLIC_BASE_URL=http://localhost:5175
```
Sau khi sửa `.env`: `docker compose up -d`.

**Nạp dữ liệu POI:** đăng nhập `admin` ở trang quản trị; thêm từng POI ở tab "Thêm / Sửa POI" (chạm bản đồ hoặc dùng GPS để lấy tọa độ), hoặc nhập nhiều POI ở tab "Nhập từ CSV" (mẫu: `docs/data/poi-seed.sample.csv`). Sau đó vào tab "Publish". Tọa độ trong file mẫu chỉ là minh họa, phải thay bằng tọa độ thật.

Hạn chế đã biết: Web App cần Internet để tải thư viện bản đồ và ô bản đồ (chưa hỗ trợ offline); giọng đọc phụ thuộc thiết bị (nếu máy không có giọng cho ngôn ngữ đó thì chỉ hiển thị văn bản); giới hạn thử mã ngắn tính theo IP lấy từ header `X-Forwarded-For`, chưa chống giả mạo header này khi triển khai thật.

## 9c. Tính năng mới: chủ quán tự đăng ký, audio tự động

| Tính năng | Cách dùng |
|---|---|
| Chủ quán đăng ký | Mở `http://localhost:5175/owner-register.html`, điền hồ sơ. Admin duyệt ở trang admin, tab **Duyệt chủ quán** |
| Thanh toán MoMo QR | Nút **Thanh toán MoMo (quét QR)** trên app du khách. Nhân viên xác nhận ở trang quầy (`:5174/staff.html`) |
| Audio tự động | Service `content-worker` tự dịch và tạo MP3. Trang admin, tab **Publish**, bấm **Dịch và tạo audio cho tất cả POI** |


**Dịch và audio dùng dịch vụ miễn phí không cần khóa API nhưng cần Internet:** Google Translate (qua `deep-translator`) và Microsoft Edge-TTS. Lần đầu build worker mất vài phút.



## 10. Thử trên điện thoại (ngrok)

Trình duyệt chỉ cho dùng GPS trên HTTPS, và điện thoại không truy cập được `localhost` của máy tính. Web App du khách và trang admin đã chạy ở cổng 5175:

1. `ngrok http 5175`, copy link `https://xxxx.ngrok-free.app`.
2. Trong `.env` đặt:
   ```
   FRONTEND_URL=https://xxxx.ngrok-free.app
   PUBLIC_BASE_URL=https://xxxx.ngrok-free.app
   ```
3. `docker compose up -d` để payment-service nhận cấu hình mới.

Mỗi lần khởi động lại ngrok, link đổi và phải cập nhật lại `.env`.

## 11. Cấu hình (`.env`)

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `INTERNAL_API_KEY` | Khóa Payment gọi nội bộ sang Auth | `change-me-internal-key` |
| `PAYOO_MODE` | `mock` hoặc `sandbox` | `mock` |
| `PAYOO_CHECKSUM_KEY` | Khóa ký webhook | `change-me-checksum-key` |
| `FRONTEND_URL` | Nơi Payoo chuyển khách về sau thanh toán | `http://localhost:5175` |
| `PUBLIC_BASE_URL` | URL công khai (dùng cho `paymentUrl` mock) | `http://localhost:5175` |
| `SEED_ADMIN_PASSWORD` | Mật khẩu admin tạo lần đầu | `Admin@12345` |
| `SEED_DEV_ACCOUNTS` | Tạo sẵn `staff1` (dev/demo) | `true` |
| `CORS_ORIGIN` | Nguồn được phép gọi API từ trình duyệt | `http://localhost:5173,http://localhost:5174` |

Khi triển khai thật bắt buộc đổi: `JWT_PRIVATE_KEY_PEM`, `INTERNAL_API_KEY`, `PAYOO_CHECKSUM_KEY`, mật khẩu admin; đặt `SEED_DEV_ACCOUNTS=false`; tách database server; dùng HTTPS.

## 12. Xử lý sự cố thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `docker compose` báo `no configuration file provided` | Đứng sai thư mục | `cd` về thư mục có `docker-compose.yml` |
| `error during connect` / `cannot find the file specified` | Docker Desktop chưa chạy xong | Chờ trạng thái **Engine running** |
| `port is already allocated` (5432, 6379, 5672, 8080) | Cổng bị chương trình khác chiếm | Tắt chương trình đó, hoặc đổi số bên trái trong `ports` |
| Đăng nhập `staff1` báo 401 | Tài khoản chưa được tạo (bản cũ) | Cập nhật code mới rồi `docker compose up --build -d auth-service`, hoặc đăng nhập bằng `admin` |
| `/auth/exchange` ra 401 `MISSING_TOKEN` | URL thiếu `/api` hoặc sai phương thức | Kiểm tra biến `base`, dùng POST, chọn environment `local` |
| `/auth/exchange` luôn 202 | Chưa mở `paymentUrl`, hoặc event chưa tới Auth | Mở `paymentUrl`, chờ 2 giây; xem `docker compose logs auth-service` |
| 409 `ORDER_ALREADY_PAID` | Đơn đã thu tiền | Đúng hành vi; tạo đơn mới để thử tiếp |
| 429 `TOO_MANY_ATTEMPTS` | Bị khóa do nhập sai nhiều lần | `docker compose exec redis redis-cli flushall` |
| `node is not recognized` | Chưa cài Node.js, hoặc chưa mở lại PowerShell sau khi cài | Cài Node 20 LTS, đóng và mở lại PowerShell |
| Thanh toán xong báo lỗi `localhost:5173` | `.env` còn giá trị cũ | Sửa `FRONTEND_URL` và `PUBLIC_BASE_URL` thành `http://localhost:5175`, `docker compose up -d` |
| Bản đồ trắng, không có ô bản đồ | Máy không có Internet hoặc chặn `tile.openstreetmap.org` / `unpkg.com` | Kiểm tra mạng |
| GPS không hoạt động trên điện thoại | Trang không chạy HTTPS | Mở bằng link ngrok `https://...` |
| Postgres lỗi trên Mac chip M1/M2 | Image `postgis/postgis` thiếu bản arm64 | Đổi image thành `imresamu/postgis:16-3.4-bookworm` |

## 13. Quy ước làm việc nhóm

- Mỗi người một nhánh: `feat/backend`, `feat/poi`, `feat/frontend`. Không đẩy thẳng lên `main`; gộp bằng Pull Request, nhóm trưởng duyệt.
- Commit nhỏ, thường xuyên, mô tả rõ nội dung.
- Không đưa lên git: `.env`, `.keys/`, `node_modules/`, token đăng nhập (đã có trong `.gitignore`, riêng token trong file Postman environment phải tự xóa trước khi xuất).
- Đổi API phải báo nhóm trưởng và cập nhật mục 6 của file này cùng Postman collection.
- Một hạng mục chỉ xong khi: chạy đúng trên máy người khác, đã gộp vào `main`, có ảnh hoặc video làm bằng chứng cho báo cáo.

## 14. Việc còn lại

- Payoo sandbox thật: hoàn thiện `services/payment-service/src/services/payoo.ts` (chế độ `sandbox`); cần tài liệu sandbox của Payoo để điền định dạng request và chữ ký.
- POI: publisher cho Outbox (sao từ payment-service), upload Blob/CDN, API `route_segments`, worker dịch và TTS (`docs/poi-suggestions/worker.py`).
- Chế độ offline (Service Worker), monitoring, nhánh Chủ địa điểm (venues, duyệt POI), giao diện hoàn thiện cho Web App và Admin.
