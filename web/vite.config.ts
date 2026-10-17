import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// host + allowedHosts: cho phép điện thoại truy cập qua ngrok.
// proxy /api -> Gateway: chỉ cần một đường ngrok cho cả giao diện và API, không phải cấu hình CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': process.env.GATEWAY_URL ?? 'http://localhost:8080',
      '/audio': process.env.AUDIO_URL ?? 'http://localhost:5175',
    },
  },
});
