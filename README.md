# GPS - Chùa Linh Ứng: Web App thuyết minh đa ngôn ngữ

Đồ án Công nghệ phần mềm. Kiến trúc microservices: mỗi service có database riêng, giao tiếp qua REST nội bộ và RabbitMQ (Transactional Outbox).

## 1. Trạng thái hiện tại

| Thành phần | Trạng thái |
|---|---|
| API Gateway (JWT/JWKS, rate limit, proxy, chặn giả mạo header) | Đã có |
| Auth Service (token, mã ngắn, nhân viên, phân quyền, thu hồi phiên, audit) | Đã có |
| Payment Service (đơn online/tiền mặt/MoMo QR, webhook, Outbox, báo cáo) | Đã có |
| Thanh toán online qua **VNPAY Sandbox** (ký HMAC-SHA512, Return URL, IPN) | Đã có, bật bằng `ONLINE_PAYMENT_PROVIDER=vnpay`. Hướng dẫn: [`docs/VNPAY.md`](docs/VNPAY.md) |
| Thanh toán online qua Payoo | Chỉ có chế độ **mock**; sandbox thật chưa làm (`payoo.ts` chế độ `sandbox` trả 501) |
| Thanh toán MoMo QR (QR cá nhân, nhân viên đối soát tay) | Đã có |
| POI Service (POI, bản dịch, tour, publish `dataset.json`) | Đã có |
| Dịch và audio tự động (`content-worker`: Google Translate + Edge-TTS) | Đã chạy được, cần Internet |
| Trang quầy nhân viên (`tools/staff`) | Đã có |
| Web App du khách (`tools/tourist`): màn hình chào mừng + mua vé bắt buộc, trang chủ thẻ POI có ảnh, bản đồ chia đôi (danh sách và bản đồ), thanh phát audio, thanh toán, GPS, geofence | Giao diện mới, cần thử thêm trên thiết bị thật tại chùa |
| Trang quản trị POI (`tools/admin`): thêm POI bằng bản đồ/GPS, nhập CSV, duyệt, publish | Đã chạy được |
| Chủ địa điểm tự đăng ký + Admin duyệt hồ sơ (CCCD mã hóa, tự xóa sau 180 ngày) | Đã có |
| **Chủ địa điểm gửi POI chờ duyệt** (`/owner.html` + tab **Duyệt POI chủ quán**) | Mới thêm, xem [mục 9c](#9c-chủ-địa-điểm-đăng-ký-và-gửi-poi) |
| Kiểm thử tự động (`scripts/smoke.mjs`), gồm cả luồng chủ địa điểm | Đã có |

## 2. Cấu trúc thư mục

```
linhung-guide/
├── docker-compose.yml          PostgreSQL+PostGIS, Redis, RabbitMQ, 4 service, worker, 2 web nginx
├── .env.example                mẫu cấu hình (copy thành .env)
├── infra/
│   ├── postgres/init.sql       tạo 3 database: auth_db, payment_db, poi_db
│   └── nginx/web.conf          nginx cổng 5175: web du khách, /admin, /audio, chuyển /api sang Gateway
├── services/
│   ├── api-gateway/    :8080   xác thực JWT, rate limit, proxy
│   ├── auth-service/   :4001   grant, token RS256, mã ngắn (Redis), nhân viên, chủ địa điểm, audit
│   ├── payment-service/:4002   vé, đơn hàng, VNPAY, Payoo (mock), MoMo QR, tiền mặt, webhook, outbox
│   ├── poi-service/    :4003   POI, bản dịch, tour, dataset, POI của chủ địa điểm
│   └── content-worker/         worker Python: dịch tự động + audio Edge-TTS (hàng đợi bằng PostgreSQL)
├── tools/
│   ├── tourist/index.html      Web App du khách (một file, Leaflet + Web Speech)
│   ├── tourist/owner-register.html  chủ địa điểm đăng ký, xem trạng thái hồ sơ
│   ├── tourist/owner.html      chủ địa điểm đăng nhập, thêm/sửa/xóa POI của mình
│   ├── admin/index.html        trang quản trị POI (bản đồ, GPS, CSV, duyệt chủ quán, duyệt POI, publish)
│   └── staff/staff.html        trang quầy nhân viên
├── scripts/smoke.mjs           kiểm thử tự động các luồng chính
└── docs/
    ├── VNPAY.md                tích hợp VNPAY Sandbox
    ├── system-presentation.html  trang thuyết minh kiến trúc (14 chương, sơ đồ Mermaid), mở bằng trình duyệt
    ├── data/poi-seed.sample.csv  file CSV mẫu để nhập POI
    └── poi-suggestions/        bản phác thảo cũ (geofence.ts, worker.py), đã được thay bằng code thật
```

Chỉ **API Gateway** (8080) và hai web nginx (5174, 5175) mở ra ngoài. Các service còn lại chỉ truy cập được trong mạng Docker; Gateway xác thực JWT rồi gắn header `x-user-id`, `x-user-role`, `x-user-name` để service tin (header do client tự gửi lên luôn bị xóa).

## 3. Yêu cầu cài đặt

| Công cụ | Dùng để | Bắt buộc |
|---|---|---|
| Docker Desktop (Windows: bật WSL2) | Chạy toàn bộ hệ thống | Có |
| Git | Quản lý mã nguồn | Có |
| VS Code | Đọc và sửa code | Nên có |
| Postman | Gọi API bằng giao diện | Nên có |
| Node.js 20 LTS | Chạy `smoke.mjs`, chạy từng service để debug | Cần cho kiểm thử |
| ngrok | Mở HTTPS cho điện thoại (GPS) và cho VNPAY gọi IPN | Cần khi thử điện thoại / VNPAY |

## 4. Chạy hệ thống

Mở Docker Desktop, chờ báo **Engine running**. Mở PowerShell **tại thư mục gốc `linhung-guide`** (nơi có `docker-compose.yml`):

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Lần đầu mất 3 đến 10 phút (worker Python build lâu nhất). Xong khi log có các dòng `listening on :4001`, `:4002`, `:4003`, `:8080` và `[worker] khoi dong`. Vài dòng `connect failed, retry in 3s` lúc đầu là bình thường (RabbitMQ đang khởi động).

Kiểm tra:
- `http://localhost:8080/health` trả `{"status":"ok","service":"api-gateway"}`
- `http://localhost:8080/api/payments/products` trả danh sách vé có `DAY_PASS`
- `http://localhost:5175` mở được Web App du khách
- RabbitMQ: `http://localhost:15672` (guest / guest)

| Việc | Lệnh |
|---|---|
| Dừng, giữ dữ liệu | `docker compose down` |
| Chạy lại | `docker compose up` (thêm `-d` để chạy nền) |
| Build lại một service sau khi sửa code | `docker compose up --build -d poi-service` |
| Xem log | `docker compose logs -f payment-service` |
| Xóa sạch dữ liệu, làm lại từ đầu | `docker compose down -v` |

Migration SQL tự chạy khi service khởi động (bảng `schema_migrations` ghi lại file nào đã chạy), nên khi kéo code mới chỉ cần build lại service đó, không phải xóa dữ liệu.

## 5. Tài khoản mặc định (chỉ để dev/demo)

| Tài khoản | Mật khẩu | Vai trò |
|---|---|---|
| `admin` | `Admin@12345` | ADMIN (đủ quyền nhân viên và quản trị) |
| `staff1` | `Staff@12345` | STAFF (quầy thu tiền) |
| (tự đăng ký) | (tự đặt) | OWNER, chỉ đăng nhập được sau khi Admin duyệt hồ sơ |

`staff1` được tạo khi `SEED_DEV_ACCOUNTS=true` (mặc định trong `docker-compose.yml`). Khi triển khai thật phải đặt `SEED_DEV_ACCOUNTS=false` và đổi mật khẩu admin.

| Vai trò | Được làm gì |
|---|---|
| `TOURIST` (token khách) | Tải dataset, nghe thuyết minh |
| `STAFF` | Quầy: tìm đơn, xác nhận tiền mặt / MoMo, lấy mã ngắn |
| `CONTENT_EDITOR` | Quản lý POI, bản dịch, duyệt POI chủ quán, publish |
| `ADMIN` | Tất cả, thêm quản lý nhân viên, vé, phiên, duyệt hồ sơ chủ quán |
| `OWNER` | Chỉ thêm/sửa/xóa POI **của chính mình**, POI phải chờ duyệt |

## 6. API chính (qua Gateway `http://localhost:8080/api`)

| Mục đích | Phương thức và đường dẫn | Quyền |
|---|---|---|
| Danh sách vé | `GET /payments/products` | Công khai |
| Tạo đơn online (Payoo mock hoặc VNPAY) | `POST /payments/online` → `orderCode`, `paymentUrl`, `authCode` | Công khai |
| Tạo đơn tiền mặt | `POST /payments/cash` → `orderCode`, `orderId` | Công khai |
| Tạo đơn MoMo QR | `POST /payments/momo-qr` | Công khai |
| Trạng thái đơn | `GET /payments/orders/{orderCode}` | Công khai |
| VNPAY Return URL / IPN | `GET /payments/vnpay/return`, `GET|POST /payments/vnpay/ipn` | Công khai (kiểm chữ ký) |
| Đổi `authCode` lấy token | `POST /auth/exchange` (202 chưa trả tiền, 200 có `accessToken`) | Công khai |
| Đổi mã ngắn lấy token | `POST /auth/exchange-short` | Công khai |
| Đăng nhập nhân viên / chủ địa điểm | `POST /auth/staff/login`, `/refresh`, `/logout` | Công khai |
| Chủ địa điểm đăng ký, xem trạng thái | `POST /auth/owner/register`, `POST /auth/owner/registration-status` | Công khai |
| Tìm đơn theo mã | `GET /payments/admin/orders/by-code/{code}` | STAFF, ADMIN |
| Xác nhận thu tiền mặt | `POST /payments/admin/orders/{id}/confirm-cash` body `{"amountReceived":20000}` | STAFF, ADMIN |
| Xác nhận đã nhận MoMo | `POST /payments/admin/orders/{id}/confirm-momo` | STAFF, ADMIN |
| Lấy / cấp lại mã ngắn | `GET /auth/staff/orders/{id}/short-code`, `POST .../short-code/reissue` | STAFF, ADMIN |
| Tra cứu, hủy đơn | `GET /payments/admin/orders`, `POST /payments/admin/orders/{id}/cancel` | STAFF, ADMIN |
| Quản lý vé, báo cáo ngày | `/payments/admin/products`, `/payments/admin/reports/daily` | ADMIN |
| Quản lý nhân viên, phiên | `/auth/admin/staff`, `/auth/admin/sessions` | ADMIN |
| Duyệt hồ sơ chủ địa điểm | `GET /auth/admin/owner-registrations`, `POST .../{id}/approve`, `POST .../{id}/reject`, `GET .../{id}/id-number` | ADMIN |
| POI, bản dịch, publish | `/poi/admin/pois`, `PUT .../translations/{lang}`, `POST /poi/admin/publish` | ADMIN, CONTENT_EDITOR |
| Dịch + audio, tiến độ | `POST /poi/admin/regenerate`, `GET /poi/admin/jobs` | ADMIN, CONTENT_EDITOR |
| Duyệt POI chủ quán | `GET /poi/admin/owner-pois?review=PENDING`, `POST .../{id}/approve`, `POST .../{id}/reject` | ADMIN, CONTENT_EDITOR |
| POI của chủ địa điểm | `GET/POST /poi/owner/pois`, `GET/PUT/DELETE /poi/owner/pois/{id}` | OWNER |
| Tải dataset (một lần) | `GET /poi/dataset/latest` | Token khách hoặc nhân viên |

Quy ước:
- Token gửi trong header `Authorization: Bearer <token>`.
- Lỗi trả dạng `{ "error": { "code": "...", "message": "..." } }`.
- Token nhân viên / chủ địa điểm sống 15 phút (dùng `/auth/staff/refresh` để làm mới); token khách sống theo `validity_hours` của vé (mặc định 12 giờ).
- `authCode` hết hạn sau 30 phút; mã ngắn hết hạn sau 10 phút, dùng một lần.
- Gateway giới hạn tần suất: 200 yêu cầu/phút chung; 30/phút cho đổi mã, đăng nhập, đăng ký chủ quán; 10/phút cho tạo đơn.

## 7. Thử luồng bằng Postman

Tạo environment có biến `base` = `http://localhost:8080/api`.

**Luồng online (Payoo mock, `ONLINE_PAYMENT_PROVIDER=payoo`):**
1. `POST /payments/online` → lưu `authCode`, `paymentUrl`.
2. `POST /auth/exchange` → **202** (chưa thanh toán).
3. Mở `paymentUrl` trong trình duyệt để giả lập khách trả tiền (thêm `?result=fail` để thử thất bại).
4. Chờ 1 đến 2 giây, gọi lại `/auth/exchange` → **200** có `accessToken`.

**Luồng online VNPAY:** xem [`docs/VNPAY.md`](docs/VNPAY.md) (cần ngrok để VNPAY gọi được IPN).

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
| Chủ địa điểm gọi `/poi/admin/...` hoặc sửa POI của người khác | 403 / 404 |
| Chủ địa điểm đăng nhập khi hồ sơ chưa duyệt | 401 `INVALID_CREDENTIALS` |
| Nhập mã ngắn sai quá 5 lần | 429 `TOO_MANY_ATTEMPTS` (khóa IP 5 phút) |
| Webhook / IPN sai chữ ký | 400 `INVALID_SIGNATURE` / `RspCode 97` |

Mở khóa nhanh sau khi thử sai mã ngắn: `docker compose exec redis redis-cli flushall`.

## 8. Kiểm thử tự động

Cần Node.js 20+. Ở thư mục gốc:

```powershell
node scripts/smoke.mjs
```

Script đi qua: đăng nhập, luồng online, webhook sai chữ ký và trùng, phân quyền, luồng tiền mặt, thu hồi phiên, và **luồng chủ địa điểm** (đăng ký → duyệt hồ sơ → gửi POI → duyệt POI → sửa → xóa). Mỗi mục in `PASS` hoặc `FAIL`, thoát mã khác 0 nếu có lỗi.

Lưu ý:
- Mục [1] dùng Payoo mock, nên khi chạy smoke hãy để `ONLINE_PAYMENT_PROVIDER=payoo` (hoặc chấp nhận mục [1] báo FAIL khi đang dùng VNPAY).
- Không chạy quá 2 lần mỗi phút vì Gateway giới hạn tần suất. Thêm `BRUTE=1` để thử khóa mã ngắn (sẽ khóa IP 5 phút).
- Mỗi lần chạy tạo một tài khoản `smoke_owner_...` (đã duyệt, POI đã xóa) để kiểm thử, có thể bỏ qua.

Xem dữ liệu trong database:

```powershell
docker compose exec postgres psql -U postgres -d payment_db -c "select order_code, method, status, amount from payment_orders order by created_at desc limit 5;"
docker compose exec postgres psql -U postgres -d auth_db -c "select channel, status, paid_at, consumed_at from access_grants order by created_at desc limit 5;"
docker compose exec postgres psql -U postgres -d poi_db -c "select code, owner_name, status, review_status from pois where owner_id is not null;"
```

## 9. Trang quầy nhân viên

Docker đã phục vụ sẵn trang này (service `staff-ui`):

Mở `http://localhost:5174/staff.html`, đăng nhập `staff1`. Trang hiện danh sách đơn tiền mặt và MoMo đang chờ (tự làm mới 5 giây); chọn đơn, bấm **Xác nhận ĐÃ THU**, mã 6 ký tự hiện ra để đọc cho khách.

## 9b. Web App du khách và trang quản trị POI

Docker phục vụ qua service `web` (nginx, cổng **5175**), `/api` được chuyển sang Gateway nên không cần cấu hình CORS và ngrok chỉ cần một đường.

| Trang | Địa chỉ | Dùng để |
|---|---|---|
| Web App du khách | `http://localhost:5175` | Mở ra là màn hình chào mừng + mua vé. Sau khi thanh toán: Trang chủ (thẻ POI có ảnh, bấm để nghe); Bản đồ: danh sách POI bên trái, bản đồ bên phải (điện thoại: bản đồ trên, danh sách dưới); Vé: thanh toán |
| Chế độ giả lập vị trí | `http://localhost:5175/?sim=1` | Thử geofence khi không ở chùa: bấm nút 🧪 rồi chạm lên bản đồ để "đi" |
| Quản trị POI | `http://localhost:5175/admin/` | Thêm, sửa POI, nhập CSV, duyệt chủ quán, duyệt POI chủ quán, publish |
| Chủ địa điểm đăng ký | `http://localhost:5175/owner-register.html` | Gửi hồ sơ, xem trạng thái |
| Chủ địa điểm quản lý POI | `http://localhost:5175/owner.html` | Thêm, sửa, xóa POI của mình |
| Quầy nhân viên | `http://localhost:5175/staff/` (hoặc `http://localhost:5174/staff.html`) | Xác nhận thu tiền mặt / MoMo. Mở qua 5175 thì dùng được cả qua ngrok |

**Ảnh POI:** chép ảnh vào `tools/tourist/img/` (nginx phục vụ ở `/img/...`, không cần build lại), rồi ghi `/img/ten-anh.jpg` vào ô "Ảnh đại diện" ở trang admin hoặc cột `thumbnail` của file CSV. Cũng có thể dùng link `https://...`. POI chưa có ảnh sẽ hiện ảnh minh họa theo loại (tượng, công trình, tiện ích, quán).

**Bắt buộc mua vé:** khách quét mã QR hoặc mở link sẽ vào thẳng màn hình chào mừng, chọn ngôn ngữ và mua vé. Chưa có vé thì không mở được trang chủ, bản đồ, dữ liệu POI hay audio (API `/poi/dataset/latest` cần token khách). Vé hết hạn thì app tự khóa và quay về màn hình mua vé.

**Nạp dữ liệu POI:** đăng nhập `admin` ở trang quản trị; thêm từng POI ở tab "Thêm / Sửa POI" (chạm bản đồ hoặc dùng GPS để lấy tọa độ), hoặc nhập nhiều POI ở tab "Nhập từ CSV" (mẫu: `docs/data/poi-seed.sample.csv`). Sau đó vào tab "Publish". Tọa độ trong file mẫu chỉ là minh họa, phải thay bằng tọa độ thật.

**Audio tự động:** lưu nội dung tiếng Việt là worker tự dịch sang en, zh-CN, ja, ko, fr và tạo MP3 (phục vụ ở `/audio/...`). Với POI có sẵn: tab **Publish**, bấm **Dịch và tạo audio cho tất cả POI**, chờ tiến độ về 0 rồi bấm **Publish**. Bản dịch sửa tay (HUMAN) không bị ghi đè. Dịch vụ miễn phí, không cần khóa API nhưng cần Internet.

**Thanh toán MoMo QR:** nút **Thanh toán MoMo (quét QR)** trên app du khách hiện ảnh QR `MOMO_QR_URL` (mặc định `/momo-qr.svg`, hãy đặt ảnh QR thật của nhóm vào `tools/tourist/momo-qr.svg`), khách chuyển khoản kèm mã đơn, nhân viên đối soát rồi xác nhận ở trang quầy.

## 9c. Chủ địa điểm đăng ký và gửi POI

Luồng đầy đủ:

```
Chủ quán                          Admin / Biên tập nội dung
──────────────────────────────    ─────────────────────────────────────────
1. /owner-register.html
   gửi hồ sơ (tài khoản bị khóa)
                                  2. /admin/ → tab "Duyệt chủ quán" → Duyệt
                                     (tài khoản được kích hoạt)
3. /owner.html → đăng nhập
   "+ Thêm địa điểm": tên, giới thiệu
   tiếng Việt, chạm bản đồ / GPS
   → POI ở DRAFT, chờ duyệt
                                  4. tab "Duyệt POI chủ quán" → Duyệt
                                     (POI → PUBLISHED, tự xếp dịch + audio)
                                     hoặc Từ chối (bắt buộc ghi lý do)
                                  5. tab "Publish" → Publish ngay
6. Du khách thấy địa điểm trên app
```

Quy tắc:
- Chủ quán chỉ thấy và sửa được POI của chính mình (lọc theo `owner_id` lấy từ token, không lấy từ dữ liệu client gửi).
- Tối đa 10 POI mỗi chủ quán; bán kính kích hoạt 10 đến 60 m; giới thiệu 20 đến 3000 ký tự; mã POI tự sinh dạng `OWN-XXXXXX`; loại POI là `SHOP` (Quán / cửa hàng).
- Chủ quán chỉ nhập tiếng Việt. Bản dịch và audio chỉ được tạo **sau khi duyệt** (không tốn công dịch nội dung chưa duyệt).
- Sửa POI đã duyệt thì POI quay về **chờ duyệt** và tạm ẩn khỏi dataset ở lần publish tiếp theo, tránh việc nội dung chưa kiểm duyệt lên app. Bản dịch máy cũ được đánh dấu dịch lại.
- Xóa là lưu trữ (`ARCHIVED`), không xóa cứng.
- Từ chối thì chủ quán thấy lý do trên `/owner.html`, sửa rồi gửi lại.
- CCCD trong hồ sơ được mã hóa AES-256-GCM (`PII_KEY`), chỉ ADMIN xem được, mỗi lần xem đều ghi nhật ký, tự xóa sau 180 ngày kể từ khi xử lý hồ sơ.

Sau khi kéo code này về: `docker compose up --build -d poi-service api-gateway` (migration `poi-service/migrations/002_owner_poi.sql` tự chạy; trang HTML không cần build).

## 10. Thử trên điện thoại (ngrok)

Trình duyệt chỉ cho dùng GPS trên HTTPS, và điện thoại không truy cập được `localhost` của máy tính. Mọi trang (du khách, admin, chủ quán) đều chạy ở cổng 5175:

1. `ngrok http 5175`, copy link `https://xxxx.ngrok-free.app`.
2. Trong `.env` đặt:
   ```
   FRONTEND_URL=https://xxxx.ngrok-free.app
   PUBLIC_BASE_URL=https://xxxx.ngrok-free.app
   ```
3. `docker compose up -d` để payment-service nhận cấu hình mới.
4. Nếu dùng VNPAY: cập nhật IPN URL `https://xxxx.ngrok-free.app/api/payments/vnpay/ipn` trên trang merchant (xem `docs/VNPAY.md`).

Mỗi lần khởi động lại ngrok, link đổi và phải cập nhật lại `.env` (và IPN URL nếu dùng VNPAY).

## 11. Cấu hình (`.env`)

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `INTERNAL_API_KEY` | Khóa Payment gọi nội bộ sang Auth | `change-me-internal-key` |
| `FRONTEND_URL` | Nơi cổng thanh toán chuyển khách về | `http://localhost:5175` |
| `PUBLIC_BASE_URL` | URL công khai (dùng cho `paymentUrl` mock, VNPAY Return URL) | `http://localhost:5175` |
| `ONLINE_PAYMENT_PROVIDER` | Cổng cho thanh toán online: `payoo` (mock) hoặc `vnpay` | `payoo` |
| `PAYOO_MODE` | `mock` hoặc `sandbox` (chưa làm) | `mock` |
| `PAYOO_CHECKSUM_KEY` | Khóa ký webhook Payoo | `change-me-checksum-key` |
| `VNP_TMN_CODE`, `VNP_HASH_SECRET` | Mã website và khóa bí mật VNPAY cấp (xem `docs/VNPAY.md`) | trống |
| `VNP_URL` | URL cổng thanh toán VNPAY | URL sandbox |
| `VNP_RETURN_URL` | Nơi VNPAY đưa khách về | `${PUBLIC_BASE_URL}/api/payments/vnpay/return` |
| `MOMO_QR_URL` | Ảnh QR MoMo hiển thị cho khách | `/momo-qr.svg` |
| `MOMO_ACCOUNT_NAME` | Tên chủ tài khoản MoMo hiển thị dưới QR | trống |
| `PII_KEY` | Khóa mã hóa CCCD của chủ địa điểm | `dev-pii-key-change-me` |
| `SEED_ADMIN_PASSWORD` | Mật khẩu admin tạo lần đầu | `Admin@12345` |
| `SEED_DEV_ACCOUNTS` | Tạo sẵn `staff1` (dev/demo) | `true` |
| `CORS_ORIGIN` | Nguồn được phép gọi API trực tiếp vào Gateway từ trình duyệt (trang ở 5175 đi qua nginx nên không cần) | `http://localhost:5173,http://localhost:5174` |

Khi triển khai thật bắt buộc đổi: `JWT_PRIVATE_KEY_PEM`, `INTERNAL_API_KEY`, `PAYOO_CHECKSUM_KEY`, `PII_KEY` (đổi `PII_KEY` sau khi đã có dữ liệu thì CCCD cũ không giải mã được), mật khẩu admin; đặt `SEED_DEV_ACCOUNTS=false`; tách database server; dùng HTTPS. Không đưa `VNP_HASH_SECRET` thật lên git: để trống trong `.env.example`, chỉ điền trong `.env`.

## 12. Xử lý sự cố thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `docker compose` báo `no configuration file provided` | Đứng sai thư mục | `cd` về thư mục có `docker-compose.yml` |
| `error during connect` / `cannot find the file specified` | Docker Desktop chưa chạy xong | Chờ trạng thái **Engine running** |
| `port is already allocated` (5432, 6379, 5672, 8080, 5174, 5175) | Cổng bị chương trình khác chiếm | Tắt chương trình đó, hoặc đổi số bên trái trong `ports` |
| Đăng nhập `staff1` báo 401 | Tài khoản chưa được tạo (bản cũ) | `docker compose up --build -d auth-service`, hoặc đăng nhập bằng `admin` |
| Chủ quán đăng nhập báo sai mật khẩu | Hồ sơ chưa được duyệt (tài khoản còn khóa) | Admin duyệt ở tab **Duyệt chủ quán**; chủ quán xem trạng thái ở `/owner-register.html` |
| `/owner.html` báo `HTTP 404` hoặc `NOT_FOUND` khi tải danh sách | poi-service / gateway chưa build lại bản mới | `docker compose up --build -d poi-service api-gateway` |
| POI chủ quán đã duyệt nhưng app chưa thấy | Chưa publish dataset | Tab **Publish** → **Publish ngay** |
| `/auth/exchange` ra 401 `MISSING_TOKEN` | URL thiếu `/api` hoặc sai phương thức | Kiểm tra biến `base`, dùng POST |
| `/auth/exchange` luôn 202 | Chưa thanh toán xong, hoặc event chưa tới Auth (VNPAY: IPN chưa tới) | Payoo: mở `paymentUrl`; VNPAY: kiểm tra ngrok và IPN URL; xem `docker compose logs auth-service` |
| 409 `ORDER_ALREADY_PAID` | Đơn đã thu tiền | Đúng hành vi; tạo đơn mới để thử tiếp |
| 429 `TOO_MANY_ATTEMPTS` | Bị khóa do nhập sai nhiều lần | `docker compose exec redis redis-cli flushall` |
| Tiến độ dịch/audio đứng yên hoặc FAILED | Worker không ra được Internet | `docker compose logs -f content-worker`, kiểm tra mạng, bấm lại **Dịch và tạo audio** |
| `node is not recognized` | Chưa cài Node.js, hoặc chưa mở lại PowerShell sau khi cài | Cài Node 20 LTS, đóng và mở lại PowerShell |
| Thanh toán xong báo lỗi `localhost:5173` | `.env` còn giá trị cũ | Sửa `FRONTEND_URL` và `PUBLIC_BASE_URL` thành `http://localhost:5175`, `docker compose up -d` |
| Bản đồ trắng, không có ô bản đồ | Máy không có Internet hoặc chặn `tile.openstreetmap.org` / `unpkg.com` | Kiểm tra mạng |
| GPS không hoạt động trên điện thoại | Trang không chạy HTTPS | Mở bằng link ngrok `https://...` |
| Postgres lỗi trên Mac chip M1/M2 | Image `postgis/postgis` thiếu bản arm64 | Đổi image thành `imresamu/postgis:16-3.4-bookworm` |

Hạn chế đã biết: Web App cần Internet để tải thư viện bản đồ và ô bản đồ (chưa hỗ trợ offline); nếu một ngôn ngữ chưa có audio MP3 thì app dùng giọng đọc của thiết bị; giới hạn thử mã ngắn tính theo IP lấy từ header `X-Forwarded-For`, chưa chống giả mạo header này khi triển khai thật; ảnh POI của chủ quán chỉ nhận đường dẫn URL, chưa có upload.

## 13. Quy ước làm việc nhóm

- Mỗi người một nhánh: `feat/backend`, `feat/poi`, `feat/frontend`. Không đẩy thẳng lên `main`; gộp bằng Pull Request, nhóm trưởng duyệt.
- Commit nhỏ, thường xuyên, mô tả rõ nội dung.
- Không đưa lên git: `.env`, `.keys/`, `node_modules/`, khóa bí mật VNPAY, token đăng nhập (đã có trong `.gitignore`).
- Đổi API phải báo nhóm trưởng và cập nhật mục 6 của file này.
- Một hạng mục chỉ xong khi: chạy đúng trên máy người khác, đã gộp vào `main`, có ảnh hoặc video làm bằng chứng cho báo cáo.

## 14. Việc còn lại

- Payoo sandbox thật: hoàn thiện `services/payment-service/src/services/payoo.ts` (chế độ `sandbox`); cần tài liệu sandbox của Payoo. (Có thể bỏ nếu nhóm chốt dùng VNPAY.)
- POI Service: publisher cho Outbox (sao từ payment-service) để phát event `DatasetPublished`, upload dataset/audio lên Blob/CDN, API `route_segments` (đường đi giữa các POI trong tour).
- Chủ địa điểm: upload ảnh thay cho nhập URL, thông báo (email) khi POI được duyệt / từ chối.
- Chế độ offline (Service Worker), monitoring, Postman collection, giao diện hoàn thiện cho Web App và Admin.
