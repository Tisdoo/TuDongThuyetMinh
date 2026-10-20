# Web App du khách

React + TypeScript + Leaflet. Docker build thư mục này và phục vụ ở `http://localhost:5175` (service `web`).

Chạy khi đang sửa code (cần backend đang chạy):

```bash
cd web
npm install
npm run dev        # http://localhost:5173, thêm ?sim=1 để giả lập vị trí
```

Thanh toán online xong sẽ quay về `FRONTEND_URL` trong `.env`, nên khi dev ở 5173 thì tạm đổi biến này thành `http://localhost:5173`.

Trước khi tạo Pull Request: `npm run build` và `npm run lint`.
