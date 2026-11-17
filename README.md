# Ẩm thực Q5 cùng SGU – Hệ thống thuyết minh quán ăn tự động

Đồ án môn Công nghệ phần mềm – Trường Đại học Sài Gòn.

Web App giúp du khách khám phá ẩm thực khu Chợ Lớn (Quận 5, TP.HCM): mua vé ngày **không cần tài khoản**, xem bản đồ các quán, và **tự nghe thuyết minh bằng ngôn ngữ của mình** khi đi tới gần quán (GPS + geofence). Nội dung chỉ cần nhập tiếng Việt; hệ thống tự dịch sang 6 ngôn ngữ (vi, en, zh-CN, ja, ko, fr) và đọc thành audio.

Kiến trúc **microservice**: mỗi service một database, giao tiếp qua REST nội bộ và RabbitMQ (Transactional Outbox), chạy toàn bộ bằng Docker Compose.

---

## 1. Chức năng hiện có

| Nhóm | Chức năng | Trạng thái |
|---|---|---|
| Bán vé | Mua vé online qua **VNPAY Sandbox** (ký HMAC-SHA512, IPN, Return URL) | ✅ Bật bằng `ONLINE_PAYMENT_PROVIDER=vnpay` – xem [docs/VNPAY.md](docs/VNPAY.md) |
| | Thanh toán online **Payoo giả lập** (để test, smoke test) | ✅ `ONLINE_PAYMENT_PROVIDER=payoo` |
| | Mua vé tiền mặt tại quầy, nhân viên xác nhận, khách nhập **mã ngắn 6 ký tự** | ✅ |
| | Gói vé, báo cáo doanh thu | ✅ Gói vé chỉ có API; báo cáo tổng hợp có trên dashboard |
| Vé & đăng nhập | Đổi mã lấy token du khách (JWT RS256), đăng nhập nội bộ, làm mới token | ✅ |
| Thuyết minh | Bản đồ Leaflet, GPS, geofence (lọc sai số, đệm rời vùng, cooldown), banner "Gần bạn", tự phát | ✅ |
| | Dịch tự động (Google Translate) + audio (Edge-TTS) theo yêu cầu, có cache; lỗi thì đọc bằng giọng thiết bị | ✅ Cần Internet |
| Nội dung | Admin thêm/sửa/lưu trữ quán bằng bản đồ, nhập CSV, Publish dataset có phiên bản + ETag | ✅ |
| Chủ địa điểm | Tự đăng ký (CCCD mã hóa AES-256-GCM, tự xóa sau 180 ngày), Admin duyệt hồ sơ | ✅ |
| | Chủ quán gửi tối đa 10 quán, Admin duyệt/từ chối | ✅ |
| Theo dõi | Số du khách đang online, nhật ký kiểm toán | ✅ |

**Đã bỏ khỏi phạm vi (code còn nhưng không dùng):**
- **Thanh toán QR MoMo**: đã gỡ khỏi giao diện React; API `/payments/momo-qr`, `confirm-momo` còn trong payment-service nhưng không có giao diện nào gọi. Database hiện không còn migration thêm `MOMO_QR`, nên gọi API này sẽ lỗi 500 – không ảnh hưởng thanh toán VNPAY và tiền mặt.
- **Vai trò Biên tập viên (`CONTENT_EDITOR`)** và **quản trị tài khoản / thu hồi phiên (UC09)**: Admin làm luôn việc biên tập; API UC09 còn nhưng không có màn hình.

---

## 2. Kiến trúc

```
Trình duyệt ──> nginx (web :5175, staff-ui :5174) ──/api/──> api-gateway :8080
                                                               │  JWT (JWKS), rate limit,
                                                               │  xóa header giả, proxy
                       ┌───────────────────────┬───────────────┴──────────────┐
                       ▼                       ▼                              ▼
              auth-service :4001      payment-service :4002          poi-service :4003
              auth_db + Redis         payment_db                     poi_db (PostGIS) + file dataset
                    ▲                       │ outbox                         │
                    └──── RabbitMQ ◄────────┘ (PaymentSucceeded/Failed)      ▼
                                                                    content-service :4005 (Python)
                                                                    Google Translate + Edge-TTS
```

| Service | Cổng | Trách nhiệm | Dữ liệu |
|---|---|---|---|
| `api-gateway` | 8080 | Xác thực JWT, chặn du khách khỏi route quản trị, rate limit, đếm khách online | Redis |
| `auth-service` | 4001 | Đăng nhập nội bộ, refresh token, quyền vào app (grant), mã ngắn, ký JWT, chủ địa điểm, nhật ký | `auth_db`, Redis |
| `payment-service` | 4002 | Gói vé, đơn hàng, VNPAY / Payoo / tiền mặt, IPN, outbox, báo cáo | `payment_db` |
| `poi-service` | 4003 | Quán ăn, quán của chủ quán, duyệt, publish dataset, dịch theo ngôn ngữ, proxy audio | `poi_db`, file dataset |
| `content-service` | 4005 | Dịch và tạo MP3 (chỉ poi-service gọi, không mở cổng ra ngoài) | thư mục cache |
| `postgres` | 5432 | PostgreSQL 16 + PostGIS, 3 database | volume `pgdata` |
| `redis` | 6379 | Mã ngắn, đếm sai, denylist token, khách online | – |
| `rabbitmq` | 5672, 15672 | Exchange `domain.events`, queue `auth.payment-events` | – |
| `web`, `staff-ui` | 5175, 5174 | nginx phục vụ giao diện, chuyển `/api/` sang gateway | – |

---

## 3. Cấu trúc thư mục

```
DemoLan2/
├── docker-compose.yml           10 container: postgres, redis, rabbitmq, 5 service, 2 nginx
├── .env.example                 mẫu cấu hình (copy thành .env – KHÔNG commit .env)
├── database/
│   ├── init.sql                 tạo 3 database: auth_db, payment_db, poi_db
│   ├── migrations/<db>/*.sql    file SQL tạo bảng, chạy tự động khi service khởi động
│   ├── scripts/db.ps1           status, psql, backup, restore, migrate, reset
│   └── README.md                giải thích các bảng và cách migration chạy
├── infra/nginx/web.conf         nginx cổng 5175: web du khách, /admin, /staff, chuyển /api sang gateway
├── services/
│   ├── api-gateway/             src/index.ts
│   ├── auth-service/            src/routes, src/services (grants, staff, owners, tokens, pii), events.ts, mq.ts
│   ├── payment-service/         src/routes, src/services (orders, vnpay*, webhook, outbox), scripts/ (VNPAY test)
│   ├── poi-service/             src/routes (admin, owner, dataset, i18n), src/services (builder, localize)
│   └── content-service/         app.py, test_app.py
├── tools/
│   ├── tourist/index.html       Web App du khách (HTML/JS + Leaflet + Web Speech)
│   ├── tourist/owner-register.html, owner.html   chủ địa điểm
│   ├── tourist/img/             ảnh quán (nginx phục vụ ở /img/...)
│   ├── admin/index.html         trang quản trị
│   └── staff/staff.html         trang quầy
├── scripts/smoke.mjs            kiểm thử tự động 44 bước qua gateway
└── docs/                        tài liệu (xem mục 12)
```

Mỗi service Node.js chia 3 lớp: `routes/*.ts` (nhận HTTP, kiểm dữ liệu bằng Zod) → `services/*.ts` (nghiệp vụ) → `db.ts` (PostgreSQL).

---

## 4. Yêu cầu cài đặt

| Công cụ | Dùng để | Bắt buộc |
|---|---|---|
| Docker Desktop (Windows: bật WSL2) | Chạy toàn bộ hệ thống | Có |
| Git | Quản lý mã nguồn | Có |
| Node.js 20 LTS | Chạy `smoke.mjs`, script VNPAY | Cho kiểm thử |
| ngrok | HTTPS cho điện thoại (GPS) và cho VNPAY gọi IPN | Khi thử điện thoại / VNPAY |
| pgAdmin 4 | Xem và kiểm tra database | Nên có |
| VS Code, Postman | Đọc code, gọi API | Nên có |

---

## 5. Chạy hệ thống

Mở Docker Desktop, chờ **Engine running**. Mở terminal tại thư mục có `docker-compose.yml`:

```bash
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
docker compose up -d --build
docker compose ps             # 10 container phải "running"
```

Lần đầu mất 3–10 phút. Kiểm tra:

| Địa chỉ | Kết quả đúng |
|---|---|
| http://localhost:8080/health | `{"status":"ok","service":"api-gateway"}` |
| http://localhost:8080/api/payments/products | Có gói `DAY_PASS` |
| http://localhost:5175 | Web App du khách |
| http://localhost:15672 (guest / guest) | Giao diện RabbitMQ |

| Việc | Lệnh |
|---|---|
| Xem log một service | `docker compose logs -f payment-service` |
| Build lại sau khi sửa code `.ts` / `.py` | `docker compose up -d --build poi-service` |
| Sửa file HTML trong `tools/` | Không cần build, tải lại trang (Ctrl+F5) |
| Áp dụng thay đổi `.env` | `docker compose up -d <service>` |
| Dừng, giữ dữ liệu | `docker compose down` |
| Xóa sạch dữ liệu, làm lại từ đầu | `docker compose down -v` |

### Các trang

| Trang | Địa chỉ | Dùng để |
|---|---|---|
| Web App du khách | http://localhost:5175 | Chọn ngôn ngữ, mua vé, bản đồ, nghe thuyết minh |
| Giả lập vị trí | http://localhost:5175/?sim=1 | Bật nút giả lập rồi bấm lên bản đồ để "đi" – thử geofence không cần GPS |
| Quản trị | http://localhost:5175/admin/ | Quán ăn, CSV, duyệt chủ quán và quán, Publish, dashboard |
| Quầy nhân viên | http://localhost:5175/staff/ hoặc http://localhost:5174/staff.html | Xác nhận tiền mặt, đọc mã ngắn cho khách |
| Chủ địa điểm đăng ký | http://localhost:5175/owner-register.html | Gửi hồ sơ, xem trạng thái |
| Chủ địa điểm quản lý quán | http://localhost:5175/owner.html | Thêm, sửa, xóa quán của mình |

---

## 6. Tài khoản và vai trò (dev / demo)

| Tài khoản | Mật khẩu | Vai trò |
|---|---|---|
| `admin` | Giá trị `SEED_ADMIN_PASSWORD` trong `.env` | ADMIN |
| `staff1` | Xem `services/auth-service/src/seed.ts` | STAFF (tạo khi `SEED_DEV_ACCOUNTS=true`) |
| (tự đăng ký) | (tự đặt) | OWNER – đăng nhập được sau khi Admin duyệt hồ sơ |

| Vai trò | Được làm |
|---|---|
| `TOURIST` (token vé) | Tải dataset, nghe thuyết minh |
| `STAFF` | Quầy: tìm đơn, xác nhận tiền mặt, lấy / cấp lại mã ngắn |
| `ADMIN` | Mọi việc: quán ăn, CSV, Publish, duyệt chủ quán và quán, xem CCCD, gói vé, báo cáo |
| `OWNER` | Chỉ thêm / sửa / xóa quán **của chính mình**, quán phải chờ duyệt |

Triển khai thật: đặt `SEED_DEV_ACCOUNTS=false` và đổi mật khẩu admin.

---

## 7. Thanh toán

### VNPAY Sandbox (`ONLINE_PAYMENT_PROVIDER=vnpay`)

1. Điền `VNP_TMN_CODE`, `VNP_HASH_SECRET` (email VNPAY gửi khi đăng ký sandbox) vào **`.env`** – không ghi vào `.env.example`.
2. Chạy ngrok cho cổng 5175 (mục 9), đặt `PUBLIC_BASE_URL` và `FRONTEND_URL` là link ngrok.
3. Đặt IPN URL trên trang merchant VNPAY: `https://<ngrok>/api/payments/vnpay/ipn`.
4. Mở Web App **qua link ngrok** → Thanh toán online → nhập thẻ test của sandbox.

Chỉ **IPN** (server VNPAY gọi về, có chữ ký) mới ghi đơn `PAID`; Return URL chỉ để hiển thị. Chi tiết: [docs/VNPAY.md](docs/VNPAY.md).

Giả lập IPN không cần ngrok (trong `services/payment-service`, cần `npm install` một lần):

```bash
npx tsx scripts/vnpay-selftest.ts                                  # kiểm thuật toán ký
npx tsx scripts/vnpay-sim-ipn.ts <mã đơn> 20000 success            # hoặc fail | bad-signature | wrong-amount | unknown-order
```

### Payoo giả lập (`ONLINE_PAYMENT_PROVIDER=payoo`)

Bấm Thanh toán online sẽ mở trang giả lập, tự báo "đã trả tiền" rồi quay về app. Thêm `?result=fail` vào link để thử thất bại. Dùng cho smoke test.

### Tiền mặt

Khách chọn "Trả tiền mặt tại quầy" → nhận mã đơn 8 ký tự → nhân viên tìm đơn, nhập số tiền, xác nhận → trang quầy hiện mã ngắn 6 ký tự → khách nhập mã vào app.

---

## 8. Database

- 3 database riêng (Database-per-Service), **không có khóa ngoại xuyên database** – liên kết bằng id (tham chiếu logic) và đồng bộ qua sự kiện.
- Migration nằm ở `database/migrations/<db>/`, chạy tự động khi service khởi động; bảng `schema_migrations` ghi file đã chạy. **Thay đổi cấu trúc bảng phải tạo file migration mới**, không sửa file cũ.
- Lệnh tiện ích: `powershell -File database/scripts/db.ps1 status | psql | backup | restore | migrate | reset`.

Kết nối pgAdmin: Host `localhost`, Port `5432`, user `postgres`, password `postgres`.

Không sửa tay: `payment_orders.status`, `access_grants`, `outbox_events` đang `PENDING`, `processed_events`, `schema_migrations`, các cột băm / mã hóa. Cú pháp SQL mẫu chạy được trên dự án: [docs/SQL-CO-BAN.sql](docs/SQL-CO-BAN.sql).

---

## 9. Thử trên điện thoại (ngrok)

GPS trên trình duyệt chỉ chạy với HTTPS, và VNPAY cần gọi được IPN từ Internet.

1. `ngrok http 5175` → copy link `https://xxxx.ngrok-free.app`.
2. Trong `.env`:
   ```
   FRONTEND_URL=https://xxxx.ngrok-free.app
   PUBLIC_BASE_URL=https://xxxx.ngrok-free.app
   ```
3. `docker compose up -d payment-service`.
4. Dùng VNPAY thì cập nhật IPN URL trên trang merchant.

Mỗi lần link ngrok đổi phải làm lại bước 2–4. Ngrok tắt mà `PUBLIC_BASE_URL` vẫn trỏ tới ngrok thì link thanh toán trả 404.

---

## 10. API chính (qua gateway `http://localhost:8080/api`)

| Mục đích | Phương thức và đường dẫn | Quyền |
|---|---|---|
| Danh sách vé | `GET /payments/products` | Công khai |
| Tạo đơn online / tiền mặt | `POST /payments/online`, `POST /payments/cash` | Công khai (10 lần/phút) |
| Trạng thái đơn | `GET /payments/orders/{orderCode}` | Công khai |
| VNPAY IPN / Return URL | `GET\|POST /payments/vnpay/ipn`, `GET /payments/vnpay/return` | Công khai (kiểm chữ ký) |
| Đổi mã lấy vé | `POST /auth/exchange` (202 chưa trả / 200 có `accessToken`), `POST /auth/exchange-short` | Công khai |
| Đăng nhập nội bộ | `POST /auth/staff/login`, `/refresh`, `/logout` | Công khai |
| Chủ địa điểm đăng ký / xem trạng thái | `POST /auth/owner/register`, `/registration-status` | Công khai |
| Ngôn ngữ, dịch chữ giao diện | `GET /poi/languages`, `POST /poi/i18n` | Công khai |
| Tải dataset theo ngôn ngữ (ETag) | `GET /poi/dataset/latest?lang=ja` | Token vé |
| Audio thuyết minh | `GET /poi/tts/{poiId}?lang=ja` | Token vé |
| Báo hiện diện | `POST /presence/heartbeat`, `/leave` | Token vé |
| Quầy: tìm đơn, xác nhận tiền mặt, hủy | `GET /payments/admin/orders[/by-code/{code}]`, `POST .../{id}/confirm-cash`, `.../cancel` | STAFF, ADMIN |
| Mã ngắn | `GET /auth/staff/orders/{id}/short-code`, `POST .../reissue` | STAFF, ADMIN |
| Gói vé, báo cáo | `/payments/admin/products`, `/payments/admin/reports/summary`, `/daily` | ADMIN |
| Quán ăn | `GET/POST /poi/admin/pois`, `GET/PUT/DELETE /poi/admin/pois/{id}`, `PUT .../{id}/content` | ADMIN |
| Duyệt quán chủ quán | `GET /poi/admin/owner-pois`, `POST .../{id}/approve`, `.../reject` | ADMIN |
| Publish, lịch sử, thống kê | `POST /poi/admin/publish`, `GET /poi/admin/dataset-versions`, `GET /poi/admin/stats` | ADMIN |
| Duyệt hồ sơ chủ quán, xem CCCD | `/auth/admin/owner-registrations[/{id}/approve\|reject\|id-number]` | ADMIN |
| Quán của chủ quán | `GET/POST /poi/owner/pois`, `GET/PUT/DELETE /poi/owner/pois/{id}` | OWNER |
| Số khách online | `GET /presence/admin/online` | ADMIN |

Quy ước: token gửi trong header `Authorization: Bearer <token>`; lỗi trả dạng `{ "error": { "code": "...", "message": "..." } }`; token nhân viên sống 15 phút, refresh 7 ngày; token du khách sống theo `validity_hours` của gói vé (mặc định 12 giờ).

---

## 11. Kiểm thử

```bash
node scripts/smoke.mjs
```

44 bước qua gateway: đăng nhập, thanh toán online (Payoo giả lập), webhook sai chữ ký / trùng, phân quyền, tiền mặt + mã ngắn, thu hồi phiên, luồng chủ địa điểm.

- Chạy với **`ONLINE_PAYMENT_PROVIDER=payoo`**; khi đang dùng `vnpay` sẽ có 8 bước FAIL (smoke không tự trả tiền trên VNPAY được).
- Cách nhau **ít nhất 1 phút** giữa hai lần chạy (giới hạn 30 lần/phút cho đổi mã + đăng nhập).
- Mỗi lần chạy để lại dữ liệu thử (đơn hàng, tài khoản `owner_...`).

Kiểm thử khác:

| Phần | Lệnh |
|---|---|
| Thuật toán ký VNPAY | `npx tsx scripts/vnpay-selftest.ts` (trong `services/payment-service`) |
| Giả lập IPN VNPAY | `npx tsx scripts/vnpay-sim-ipn.ts <mã đơn> 20000 <kịch bản>` |
| Unit test content-service | `python -m unittest test_app.py` (trong `services/content-service`) |

---

## 12. Tài liệu

| File | Nội dung |
|---|---|
| [docs/LUONG-8-USECASE.md](docs/LUONG-8-USECASE.md) | Luồng code UC01–UC08: đi qua file nào, hàm nào, dòng nào; muốn sửa gì thì sửa ở đâu |
| [docs/HUONG-DAN-USE-CASE.md](docs/HUONG-DAN-USE-CASE.md) | Cách chạy thử từng use case, câu SQL kiểm tra, điểm phải giữ khi sửa code |
| [docs/SQL-CO-BAN.sql](docs/SQL-CO-BAN.sql) | Cú pháp SQL cơ bản kèm ví dụ trên database dự án (mở bằng pgAdmin) |
| [docs/VNPAY.md](docs/VNPAY.md) | Tích hợp VNPAY Sandbox |
| [database/README.md](database/README.md) | Các bảng và cách migration chạy |
| [docs/data/poi-seed.sample.csv](docs/data/poi-seed.sample.csv) | File CSV mẫu để nhập quán |

---

## 13. Cấu hình (`.env`)

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `ONLINE_PAYMENT_PROVIDER` | Cổng thanh toán online: `vnpay` hoặc `payoo` (giả lập) | `payoo` |
| `VNP_TMN_CODE`, `VNP_HASH_SECRET` | Mã website và khóa bí mật VNPAY | trống |
| `VNP_URL`, `VNP_RETURN_URL` | Cổng VNPAY, nơi VNPAY đưa khách về | sandbox, `${PUBLIC_BASE_URL}/api/payments/vnpay/return` |
| `FRONTEND_URL`, `PUBLIC_BASE_URL` | Địa chỉ công khai của web (localhost hoặc ngrok) | `http://localhost:5175` |
| `PAYOO_MODE`, `PAYOO_CHECKSUM_KEY` | Payoo giả lập và khóa ký webhook | `mock` |
| `INTERNAL_API_KEY` | Khóa Payment gọi nội bộ sang Auth | `change-me-internal-key` |
| `PII_KEY` | Khóa mã hóa CCCD (đổi sau khi có dữ liệu thì CCCD cũ không giải mã được) | `dev-pii-key-change-me` |
| `SEED_ADMIN_PASSWORD`, `SEED_DEV_ACCOUNTS` | Mật khẩu admin tạo lần đầu, có tạo `staff1` không | – , `true` |
| `LANGUAGES` | Danh sách ngôn ngữ (tiếng Việt luôn đứng đầu) | `vi,en,zh-CN,ja,ko,fr` |

**Không commit `.env` và khóa bí mật.** `.env.example` chỉ chứa giá trị giữ chỗ.

---

## 14. Xử lý sự cố

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `ports are not available ... bind: An attempt was made to access a socket in a way forbidden` (Windows) | Hyper-V/WinNAT giữ trước dải cổng chứa 8080, 5175… do dải cổng động bắt đầu từ 1024 | PowerShell **Administrator**: `netsh int ipv4 set dynamic tcp start=49152 num=16384` và lệnh tương tự cho `ipv6`, rồi khởi động lại máy. Kiểm tra: `netsh interface ipv4 show excludedportrange protocol=tcp` |
| `port is already allocated` | Chương trình khác chiếm cổng | Tắt chương trình đó hoặc đổi số bên trái trong `ports` |
| Smoke test nhiều bước báo 429 | Vượt giới hạn 30 lần/phút | Chờ 1 phút rồi chạy lại |
| Link thanh toán trả 404 | `PUBLIC_BASE_URL` trỏ tới ngrok đang tắt | Bật ngrok hoặc đặt lại `http://localhost:5175` |
| `/auth/exchange` luôn trả 202 | Chưa thanh toán xong / IPN chưa tới / sự kiện chưa qua RabbitMQ | Kiểm tra ngrok và IPN URL; `docker compose logs auth-service payment-service`; xem bảng `outbox_events` |
| Payment-service dừng ngay khi khởi động | Bật `vnpay` mà thiếu `VNP_*` | Điền đủ trong `.env` |
| App báo "chưa có bản dịch" | Google chặn / mất mạng; hệ thống trả tiếng Việt và thử lại sau 60 giây | Kiểm tra Internet; `docker compose logs content-service` |
| Quán đã duyệt nhưng app chưa thấy | Chưa Publish | Trang quản trị → Publish |
| Chủ quán đăng nhập báo sai mật khẩu | Hồ sơ chưa được duyệt | Admin duyệt hồ sơ |
| Trang quầy / quản trị tự đăng xuất sau 15 phút | Hai trang này chưa tự làm mới token | Đăng nhập lại |
| GPS không chạy trên điện thoại | Không phải HTTPS | Mở bằng link ngrok |
| Bản đồ trắng | Không tải được thư viện / ô bản đồ | Kiểm tra Internet |

**Hạn chế đã biết:** chưa chạy offline; khách mất `authCode` sau khi trả online chưa có cách lấy lại vé; chưa có màn hình hoàn tiền cho đơn trả muộn (`LATE_PAYMENT_REVIEW`); hai người Publish cùng lúc thì người sau nhận lỗi 500; bản dịch chỉ lưu trong RAM nên khởi động lại poi-service thì phải dịch lại; ảnh quán chỉ nhận URL, chưa có upload.

---

## 15. Quy ước làm việc nhóm

- Mỗi phần một nhánh: `feat/backend`, `feat/frontend`. Không đẩy thẳng lên `main`; gộp bằng Pull Request.
- **Không dùng `git push --force`** trên nhánh chung.
 
- Thay đổi cấu trúc bảng → file migration mới trong `database/migrations/<db>/`.
- Sửa xong chạy `node scripts/smoke.mjs` trước khi push; đổi API thì cập nhật mục 10 của file này.
