# Web App du khách (PWA) — phần việc của người C (Frontend)

Vite + React + TypeScript + Leaflet. Bám theo hợp đồng API ở mục 6 của kế hoạch 2 tuần; mọi yêu cầu đi qua Gateway.

## 1. Chiến lược

**Mục tiêu duy nhất:** chạy trọn luồng demo trên điện thoại thật:
quét QR → chọn ngôn ngữ + hình thức thanh toán → nhận token → bản đồ có GPS → chạm POI → đọc/nghe thuyết minh (vi/en) → được gợi ý khi đến gần POI.

Nguyên tắc:

1. **Không viết lại từ đầu.** Bản một file `tools/tourist/index.html` (nhóm trưởng dựng) đã có đủ logic chạy được. Bản React này
   tách logic đó thành module có kiểu (TypeScript), để dễ đọc, dễ chia việc và dễ đưa vào báo cáo chương 6. Hai bản dùng chung API, nên
   nếu bản React gặp sự cố lúc demo thì vẫn còn bản cũ ở cổng 5175 làm phương án dự phòng.
2. **Chỉ một đường ngrok.** Vite proxy `/api` → Gateway `:8080`, nên giao diện và API cùng origin: không cần CORS, chỉ cần một đường ngrok.
3. **Tải dataset một lần.** Sau khi có token, gọi `GET /api/poi/dataset/latest` một lần (gửi `If-None-Match` theo version đã lưu → 304 thì
   dùng bản trong `localStorage`). Mọi thứ sau đó (bản đồ, geofence, nội dung) chạy trên máy khách, không gọi API POI nữa.
4. **Luôn có đường lùi:**
   - Audio: MP3 tạo sẵn (`audioUrl`) → lỗi thì giọng đọc trình duyệt (Web Speech API) → không có giọng thì chỉ hiện văn bản.
   - Bản dịch: thiếu ngôn ngữ đã chọn thì hiện en, rồi vi, và ghi chú "Chưa có bản dịch".
   - GPS: bị từ chối hoặc yếu → bản đồ vẫn dùng được, chạm POI để xem. `?sim=1` bật nút 🧪 giả lập vị trí khi không ở chùa.
   - Chatbot: service chưa chạy (502/404) → báo "chưa sẵn sàng", không làm hỏng app.
5. **F5 không mất đơn.** Đơn online/MoMo/tiền mặt đang chờ được lưu `sessionStorage`; token lưu `localStorage` và kiểm tra hạn (`exp` trong JWT).

## 2. Cấu trúc mã

```
web/
├── vite.config.ts          host + allowedHosts (ngrok), proxy /api -> :8080, /audio -> :5175
├── public/                 manifest.webmanifest, sw.js (cache vỏ app + ô bản đồ), icon.svg
└── src/
    ├── api/client.ts       gọi Gateway, gắn Bearer token, xử lý 401 -> về màn hình thanh toán
    ├── api/types.ts        kiểu dữ liệu theo hợp đồng API và dataset.json
    ├── lib/geofence.ts     GeofenceEngine (lấy từ docs/poi-suggestions/geofence.ts): hysteresis + cooldown + priority
    ├── lib/narration.ts    phát MP3 / Web Speech API, chia câu, "mở khóa" audio trên iOS
    ├── lib/i18n.ts         chuỗi giao diện vi/en
    ├── lib/poi.ts          chọn bản dịch theo ngôn ngữ, văn bản đọc
    ├── hooks/              useDataset (tải 1 lần + 304), useGeolocation (watchPosition), useToast
    ├── screens/            PayScreen, WaitScreen (/payment/return), CashScreen, MomoScreen, MapScreen
    ├── components/         PoiSheet (bottom-sheet), ChatPanel (/api/chat)
    └── App.tsx             máy trạng thái màn hình + menu ngôn ngữ
```

## 3. Luồng màn hình

| Màn hình | API | Ghi chú |
|---|---|---|
| Chọn ngôn ngữ + thanh toán | `GET /payments/products`, `POST /payments/online` \| `/cash` \| `/momo-qr` | Online: lưu `authCode` vào `sessionStorage` rồi chuyển sang `paymentUrl` |
| Chờ thanh toán (`/payment/return`) | `POST /auth/exchange` mỗi 3 giây, tối đa 20 lần | 202 = chưa trả xong, 200 = token; `?status=failed` → báo thất bại |
| Tiền mặt | `GET /payments/orders/{code}` mỗi 3 giây, `POST /auth/exchange-short` | 429 → "sai quá nhiều lần, thử lại sau 5 phút" |
| MoMo QR | `POST /auth/exchange` mỗi 4 giây (~30 phút) | Nhân viên xác nhận ở trang quầy |
| Bản đồ | `GET /poi/dataset/latest` (một lần) | Marker đánh số, vòng bán kính kích hoạt, chấm xanh vị trí + vòng sai số |
| Chi tiết POI | — | Tên, khoảng cách, ảnh, mô tả; Nghe / Dừng / Chỉ đường (Google Maps đi bộ) |
| Gợi ý gần POI | — | Banner "Bạn đang gần…" (tự ẩn 15 giây); bật 🔊 tự phát thì mở và đọc luôn |
| Hỏi đáp | `POST /chat` body `{ question, lang, poiId? }` → `{ answer }` | Định dạng cần chốt với người B (xem mục 6) |

## 4. Chạy

Cần Node.js 20+ và backend đang chạy (`docker compose up -d` ở thư mục gốc).

```bash
cd web
npm install
npm run dev            # http://localhost:5173  (thêm ?sim=1 để giả lập vị trí)
```

Trong `.env` ở thư mục gốc đặt `FRONTEND_URL=http://localhost:5173` và `PUBLIC_BASE_URL=http://localhost:5173` (để Payoo mock quay về đúng
`/payment/return`), rồi `docker compose up -d`.

**Thử trên điện thoại:** `ngrok http 5173`, đặt hai biến trên thành link `https://xxxx.ngrok-free.app`, `docker compose up -d`.
GPS chỉ chạy trên HTTPS nên bắt buộc dùng link ngrok.

Kiểm tra trước khi tạo Pull Request: `npm run build` và `npm run lint` không lỗi.

## 5. Kế hoạch theo ngày (người C)

| Ngày | Việc | Trạng thái |
|---|---|---|
| 1–2 (12–13/10) | Khởi tạo Vite React TS, Leaflet, bản đồ với POI giả | Xong |
| 3 (14/10) | GPS `watchPosition`, chấm vị trí hiện tại | Xong |
| 4 (15/10) | Chọn ngôn ngữ, chọn hình thức thanh toán | Xong |
| 5 (16/10) | Màn hình chờ (polling 3 giây), nhập mã ngắn | Xong |
| 6 (17/10) | Tải dataset thật, hiện marker | Xong, chờ B publish dữ liệu thật |
| 7 (18/10) | Bottom-sheet chi tiết POI — **Mốc 2** | Xong |
| 8 (19/10) | Nút Nghe (Web Speech API), đổi vi/en | Xong |
| 9 (20/10) | Tích hợp geofence, gợi ý khi đến gần | Xong; còn thử ngoài trời |
| 10 (21/10) | Khung chat `/api/chat` — **Mốc 3**: chạy trên điện thoại qua ngrok | Giao diện xong, chờ service của B |
| 11–12 (22–23/10) | Viết chương 6 báo cáo, chụp ảnh giao diện, quay video trên điện thoại | |
| 13–14 (24–25/10) | Đóng băng code, luyện demo, slide | |

Vì phần code đã đi trước lịch, thời gian còn lại dành cho: **thử trên điện thoại thật** (Android Chrome + iPhone Safari), đi thử tại chùa,
chỉnh `triggerRadiusM` cùng người B, và thu thập ảnh/video cho báo cáo.

## 6. Cần chốt với các bạn

- **Người A:** đồng ý thêm `FRONTEND_URL`/`PUBLIC_BASE_URL` = cổng 5173 (hoặc link ngrok) khi demo bằng bản React.
- **Người B:** định dạng `/api/chat` (đề xuất: request `{ question, lang, poiId? }`, response `{ answer }`); mỗi POI 2–3 câu để giọng
  đọc không quá dài; có ảnh `thumbnailUrl` thì sheet hiện ảnh.

## 7. Danh sách thử trên điện thoại (bằng chứng cho báo cáo)

- [ ] Online mock: thanh toán → quay về → có token → vào bản đồ
- [ ] Online mock thất bại (`?result=fail`) → báo thất bại, thanh toán lại được
- [ ] Tiền mặt: hiện mã đơn → nhân viên xác nhận → nhập mã ngắn → vào bản đồ; nhập sai 5 lần → báo khóa
- [ ] F5 khi đang chờ thanh toán → vẫn ở màn hình chờ đúng đơn
- [ ] Bản đồ hiện đủ POI thật, chấm vị trí đúng ngoài trời
- [ ] Chạm POI → sheet; Nghe tiếng Việt và tiếng Anh; Dừng
- [ ] Đi vào bán kính POI → banner gợi ý; bật 🔊 → tự đọc
- [ ] Từ chối quyền vị trí → app vẫn dùng được
- [ ] Token hết hạn → về màn hình thanh toán
