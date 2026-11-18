# database/: mọi thứ để tạo và quản lý CSDL

Hệ thống dùng **PostgreSQL 16 + PostGIS**, chạy trong Docker (service `postgres` trong `docker-compose.yml`).
Mỗi microservice có **một database riêng** (Database-per-Service).

```
database/
├── init.sql                 # Tạo 3 database: auth_db, payment_db, poi_db (chạy 1 lần khi volume pgdata còn trống)
├── migrations/
│   ├── auth_db/             # Bảng của auth-service
│   ├── payment_db/          # Bảng của payment-service
│   └── poi_db/              # Bảng của poi-service
├── scripts/db.ps1           # Lệnh quản lý: status, psql, backup, restore, migrate, reset
└── backups/                 # (tự tạo khi chạy backup, không commit)
```

## Các bảng hiện có

| Database | Service | Bảng |
|---|---|---|
| `auth_db` | auth-service | roles, staff_accounts, staff_refresh_tokens, access_grants, access_sessions, signing_keys, auth_audit_logs, processed_events, owner_registrations |
| `payment_db` | payment-service | ticket_products, payment_orders, payment_transactions, cash_receipts, webhook_events, outbox_events |
| `poi_db` | poi-service | poi_categories, pois, dataset_versions (các bảng khác đã bị xóa ở `004_simplify.sql`) |

Mỗi DB còn có bảng `schema_migrations` ghi lại file SQL nào đã chạy.

## Migration chạy thế nào

- Khi khởi động, mỗi service đọc các file `.sql` trong thư mục của DB mình **theo thứ tự tên** và chỉ chạy những file chưa có trong `schema_migrations` (code ở `services/<tên>/src/migrate.ts`).
- Chạy bằng Docker: `docker-compose.yml` truyền `database/migrations/<db>` vào lúc build (`additional_contexts: dbmigrations`) và file được copy vào `/app/migrations`.
- Chạy local (`npm run dev`): service đọc thẳng `database/migrations/<db>`. Có thể đổi thư mục bằng biến môi trường `MIGRATIONS_DIR`.

**Thêm/sửa bảng:** tạo file mới với số kế tiếp, ví dụ `database/migrations/poi_db/005_them_cot.sql`.
Không sửa file đã chạy rồi, vì nó sẽ không được chạy lại.
Sau đó chạy `.\database\scripts\db.ps1 migrate poi_db`.

## Lệnh quản lý (PowerShell, chạy ở thư mục gốc dự án)

```powershell
.\database\scripts\db.ps1 status                 # Liệt kê migration đã chạy + các bảng của từng DB
.\database\scripts\db.ps1 psql poi_db            # Mở psql vào 1 DB
.\database\scripts\db.ps1 backup                 # Sao lưu cả 3 DB vào database\backups (hoặc: backup poi_db)
.\database\scripts\db.ps1 restore poi_db database\backups\poi_db_20261111_1200.sql
.\database\scripts\db.ps1 migrate                # Build lại service để chạy file SQL mới (hoặc: migrate poi_db)
.\database\scripts\db.ps1 reset                  # XÓA SẠCH dữ liệu DB rồi tạo lại (hỏi xác nhận; giữ khóa JWT và file upload)
```

Nếu PowerShell chặn script: `powershell -ExecutionPolicy Bypass -File .\database\scripts\db.ps1 status`.

Kết nối từ máy ngoài Docker (DBeaver, pgAdmin...): `localhost:5432`, user `postgres`, mật khẩu `postgres`.
