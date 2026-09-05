# Hướng Dẫn Triển Khai Hệ Thống MES AVI/AOI

**Phiên bản:** 1.0.0  
**Ngày cập nhật:** 26/01/2026  
**Tác giả:** Manus AI

---

## Mục Lục

1. [Yêu Cầu Hệ Thống](#1-yêu-cầu-hệ-thống)
2. [Chuẩn Bị Môi Trường](#2-chuẩn-bị-môi-trường)
3. [Cài Đặt Database](#3-cài-đặt-database)
4. [Cấu Hình MQTT Broker](#4-cấu-hình-mqtt-broker)
5. [Build và Deploy Application](#5-build-và-deploy-application)
6. [Cấu Hình Environment Variables](#6-cấu-hình-environment-variables)
7. [Khởi Tạo Hệ Thống](#7-khởi-tạo-hệ-thống)
8. [Bảo Mật](#8-bảo-mật)
9. [Monitoring và Logging](#9-monitoring-và-logging)
10. [Backup và Recovery](#10-backup-và-recovery)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Yêu Cầu Hệ Thống

### 1.1 Yêu Cầu Phần Cứng (Production)

| Thành phần | Tối thiểu | Khuyến nghị |
|------------|-----------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16+ GB |
| Storage | 100 GB SSD | 500+ GB SSD |
| Network | 100 Mbps | 1 Gbps |

### 1.2 Yêu Cầu Phần Mềm

| Phần mềm | Phiên bản |
|----------|-----------|
| Node.js | 18.x hoặc 22.x |
| pnpm | 8.x+ |
| PostgreSQL | 16+ (khuyến nghị 16/18) — cần extension **pgvector** cho tìm kiếm ảnh/embedding AI |
| TimescaleDB (tùy chọn) | 2.17+ — chỉ khi bật time-series nâng cao (`TSDB_URL`) |
| MQTT Broker | **Đã nhúng sẵn (aedes)** trong ứng dụng — không cần cài ngoài. EMQX 5.x chỉ cần khi dùng UNS/Sparkplug B đa nhà máy |
| Redis (optional) | 7.x — cache phân tán + Socket.IO adapter khi chạy nhiều instance |
| Nginx (reverse proxy) | 1.24+ |

---

## 2. Chuẩn Bị Môi Trường

### 2.1 Cài Đặt Node.js

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### 2.2 Cài Đặt pnpm

```bash
npm install -g pnpm
pnpm --version
```

### 2.3 Clone Repository

```bash
git clone <repository-url> /opt/avi-aoi-management
cd /opt/avi-aoi-management
```

---

## 3. Cài Đặt Database

> Hệ thống chạy trên **PostgreSQL** (qua Drizzle ORM, driver `postgres-js`). Kết nối cấu hình bằng biến môi trường `DATABASE_URL`. Extension **pgvector** cần thiết cho tìm kiếm ảnh/embedding AI (có cơ chế fallback brute-force nếu thiếu, nhưng nên cài để đạt hiệu năng).

### 3.1 PostgreSQL Setup

```bash
# Install PostgreSQL 16 (Ubuntu/Debian)
sudo apt-get install -y postgresql-16 postgresql-contrib-16

# (khuyến nghị) cài pgvector
sudo apt-get install -y postgresql-16-pgvector

# Create database and user
sudo -u postgres psql
```

```sql
CREATE DATABASE avi_aoi_mes;
CREATE USER mes_user WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE avi_aoi_mes TO mes_user;
-- Kết nối vào DB rồi bật extension pgvector:
\c avi_aoi_mes
CREATE EXTENSION IF NOT EXISTS vector;
-- LƯU Ý BẢO MẬT: app KHÔNG nên kết nối bằng superuser — RLS audit-log
-- (append-only) chỉ có hiệu lực khi app dùng user thường (mes_user).
```

Đặt `DATABASE_URL` trong `.env`:

```env
DATABASE_URL=postgres://mes_user:your_secure_password@localhost:5432/avi_aoi_mes
# (tùy chọn) time-series nâng cao trên TimescaleDB riêng:
# TSDB_URL=postgres://mes_user:...@localhost:5433/avi_aoi_tsdb
```

### 3.2 Database Migration

```bash
cd /opt/avi-aoi-management

# Install dependencies
pnpm install

# Run migrations (drizzle-kit generate + runner standalone áp file drizzle/*.sql)
pnpm db:push
```

---

## 4. Cấu Hình MQTT Broker

> **Không cần cài broker ngoài.** Ứng dụng nhúng sẵn broker **aedes** (TCP + WebSocket), bật bằng `MQTT_ENABLED=true`. Thiết bị/máy kết nối trực tiếp tới ứng dụng. Mosquitto/HiveMQ KHÔNG còn được dùng.

### 4.1 Cấu Hình Broker Nhúng (aedes)

Đặt trong `.env`:

```env
MQTT_ENABLED=true
MQTT_PORT=1883          # listener TCP cho thiết bị/máy
MQTT_WS_PORT=8883       # listener WebSocket cho client trình duyệt
# Xác thực client dựa trên đăng ký thiết bị trong DB (bảng mqttClients),
# username dạng "deviceId:deviceName:deviceModel".
```

Topic chuẩn của hệ thống:

```
avi/factory/{factory}/workshop/{workshop}/station/{station}/errors|summary
avi/client/{clientId}/commands
avi/system/broadcast
```

> ⚠️ **Bảo mật (cần làm trước production):** broker nhúng hiện bind `0.0.0.0` và chưa bật TLS. Với môi trường production nên đặt sau reverse proxy/TLS terminator, hoặc dùng EMQX có TLS (xem 4.2). Đây là hạng mục đang được xử lý trong Phase 1 (WS1.3) của lộ trình nâng cấp.

### 4.2 (Tùy chọn) EMQX cho UNS / Sparkplug B đa nhà máy

Chỉ cần khi bật Unified Namespace liên nhà máy. Bật bằng các biến:

```env
UNS_BRIDGE_ENABLED=true
UNS_SPARKPLUG_ENABLED=true
UNS_BROKER_URL=mqtt://emqx-host:1884   # broker EMQX riêng, port khác broker nhúng để tránh loop
```

Ứng dụng chỉ **publish** sang EMQX (chuẩn hóa topic theo ISA-95); không tiêu thụ lệnh điều khiển từ EMQX.

---

## 5. Build và Deploy Application

### 5.1 Build Production

```bash
cd /opt/avi-aoi-management

# Install dependencies
pnpm install

# Build application
pnpm build
```

### 5.2 Cấu Hình Systemd Service

Tạo file `/etc/systemd/system/avi-aoi-mes.service`:

```ini
[Unit]
Description=AVI/AOI MES Application
After=network.target mysql.service mosquitto.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/avi-aoi-management
ExecStart=/usr/bin/node dist/server/index.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=avi-aoi-mes
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 5.3 Khởi Động Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable avi-aoi-mes
sudo systemctl start avi-aoi-mes
```

---

## 6. Cấu Hình Environment Variables

### 6.1 Tạo File .env

Tạo file `/opt/avi-aoi-management/.env`:

```env
# Database
DATABASE_URL=mysql://mes_user:your_secure_password@localhost:3306/avi_aoi_mes

# JWT Secret (generate with: openssl rand -base64 32)
JWT_SECRET=your_jwt_secret_here

# Application
NODE_ENV=production
PORT=3000

# MQTT Configuration
MQTT_ENABLED=true
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=mes_system
MQTT_PASSWORD=your_mqtt_password

# Redis (optional, for caching)
REDIS_URL=redis://localhost:6379

# OAuth (if using Manus OAuth)
VITE_APP_ID=your_app_id
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://manus.im/login

# Owner info
OWNER_OPEN_ID=owner_id
OWNER_NAME=Admin

# Forge API (if using)
BUILT_IN_FORGE_API_URL=https://api.manus.im
BUILT_IN_FORGE_API_KEY=your_api_key
```

### 6.2 Bảo Vệ File .env

```bash
chmod 600 /opt/avi-aoi-management/.env
chown www-data:www-data /opt/avi-aoi-management/.env
```

---

## 7. Khởi Tạo Hệ Thống

### 7.1 Tạo Admin User Đầu Tiên

Truy cập ứng dụng qua trình duyệt và vào trang `/setup` để tạo admin user đầu tiên.

### 7.2 Seed Demo Data (Optional)

Nếu cần dữ liệu demo để test:

```bash
cd /opt/avi-aoi-management
pnpm seed
```

### 7.3 Cấu Hình Cơ Bản

Sau khi đăng nhập với admin:

1. **Cài đặt → Cấu hình hệ thống**: Thiết lập các thông số cơ bản
2. **Cài đặt → Ngưỡng cảnh báo**: Thiết lập ngưỡng FPY, Yield
3. **Quản trị → Quản lý người dùng**: Tạo thêm users
4. **Cài đặt → Ca làm việc**: Cấu hình ca sản xuất

---

## 8. Bảo Mật

### 8.1 Cấu Hình Nginx với SSL

Tạo file `/etc/nginx/sites-available/avi-aoi-mes`:

```nginx
server {
    listen 80;
    server_name mes.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name mes.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/mes.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mes.yourdomain.com/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support
    location /socket.io {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

### 8.2 Cài Đặt SSL Certificate

```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d mes.yourdomain.com

# Enable auto-renewal
sudo systemctl enable certbot.timer
```

### 8.3 Firewall Configuration

```bash
# UFW
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 1883/tcp  # MQTT (internal only)
sudo ufw enable
```

### 8.4 Chính Sách 2FA Bắt Buộc (`AUTH_2FA_BAT_BUOC`)

> Chính sách chủ dự án chốt 2026-09-05 (Lô 10 Mục 2). Xem chi tiết đầy đủ ở khối chú thích
> `AUTH_2FA_BAT_BUOC` trong `.env.example` và docblock `batBuoc2FA()` ở `server/_core/trpc.ts`.

Biến môi trường `AUTH_2FA_BAT_BUOC` (mặc định = ép buộc khi không đặt) quyết định server có đòi
admin/vai đặc quyền (supervisor, quality_inspector, engineer) phải bật 2FA trước khi gọi các thủ
tục đặc quyền hay không:

| Kiểu triển khai | Giá trị bắt buộc | Vì sao |
|---|---|---|
| **Internet-facing** (cổng đăng nhập lộ ra ngoài LAN nhà máy, kể cả qua VPN/reverse-proxy công khai) | `AUTH_2FA_BAT_BUOC=1` **hoặc để trống/không đặt** (mặc định trong mã đã là ép) | Đặt `=0` tắt đòi-BẬT-2FA cho **mọi** `adminProcedure`/`require2FA` cùng lúc, gồm cả các thủ tục quản trị đã hợp nhất RBAC với dead-letter WAL (`integrityRouter`, BG-131 Lô 9 Mục 3) — các thủ tục đó chạy được mà không cần OTP khi cờ này tắt. |
| **Mạng LOCAL** (nội bộ nhà máy, không có lối vào Internet) | `AUTH_2FA_BAT_BUOC=0` được phép | Đánh đổi đã chấp nhận: chi phí bắt ~100 kỹ sư quẹt OTP mỗi lần đăng nhập/đăng xuất nhiều lần trong ca không tương xứng với rủi ro khi không có tầng truy cập Internet nào phải chắn. RBAC/kiểm vai vẫn giữ nguyên; step-up OTP cho lệnh chạm máy/deploy (`ACTUATION_STEPUP_2FA`) không đổi. |

**Không đổi hành vi mặc định trong mã** — đây thuần là chính sách cấu hình `.env` theo môi trường
triển khai, không phải một thay đổi runtime mới.

---

## 9. Monitoring và Logging

### 9.1 Application Logs

```bash
# View application logs
sudo journalctl -u avi-aoi-mes -f

# View last 100 lines
sudo journalctl -u avi-aoi-mes -n 100
```

### 9.2 Log Rotation

Tạo file `/etc/logrotate.d/avi-aoi-mes`:

```
/var/log/avi-aoi-mes/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        systemctl reload avi-aoi-mes > /dev/null 2>&1 || true
    endscript
}
```

### 9.3 Health Check Endpoint

Ứng dụng cung cấp endpoint health check tại `/api/health`:

```bash
curl https://mes.yourdomain.com/api/health
```

---

## 10. Backup và Recovery

### 10.1 Database Backup Script

Tạo file `/opt/scripts/backup-mes-db.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/opt/backups/mes"
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="mes_backup_${DATE}.sql.gz"

mkdir -p $BACKUP_DIR

mysqldump -u mes_user -p'your_password' avi_aoi_mes | gzip > "${BACKUP_DIR}/${FILENAME}"

# Keep only last 30 days
find $BACKUP_DIR -type f -mtime +30 -delete

echo "Backup completed: ${FILENAME}"
```

### 10.2 Scheduled Backup

```bash
# Add to crontab
crontab -e

# Add line (daily at 2 AM)
0 2 * * * /opt/scripts/backup-mes-db.sh >> /var/log/mes-backup.log 2>&1
```

### 10.3 Recovery Procedure

```bash
# Stop application
sudo systemctl stop avi-aoi-mes

# Restore database
gunzip < /opt/backups/mes/mes_backup_YYYYMMDD_HHMMSS.sql.gz | mysql -u mes_user -p avi_aoi_mes

# Start application
sudo systemctl start avi-aoi-mes
```

---

## 11. Troubleshooting

### 11.1 Common Issues

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-------------|-----------|
| Application không start | Missing env vars | Kiểm tra file .env |
| Database connection failed | Wrong credentials | Verify DATABASE_URL |
| MQTT không kết nối | Broker not running | Check mosquitto service |
| WebSocket timeout | Nginx config | Check proxy settings |
| 502 Bad Gateway | App crashed | Check journalctl logs |

### 11.2 Debug Commands

```bash
# Check application status
sudo systemctl status avi-aoi-mes

# Check port usage
sudo netstat -tlnp | grep 3000

# Check MySQL connection
mysql -u mes_user -p -e "SELECT 1"

# Check MQTT broker
mosquitto_sub -h localhost -t '#' -v

# Check logs
sudo journalctl -u avi-aoi-mes --since "1 hour ago"
```

### 11.3 Performance Tuning

```bash
# MySQL optimization
# Add to /etc/mysql/mysql.conf.d/mysqld.cnf
innodb_buffer_pool_size = 1G
innodb_log_file_size = 256M
max_connections = 200

# Node.js memory
# Add to systemd service
Environment=NODE_OPTIONS="--max-old-space-size=4096"
```

---

## Liên Hệ Hỗ Trợ

Nếu gặp vấn đề trong quá trình triển khai, vui lòng liên hệ:

- **Email:** support@example.com
- **Documentation:** https://docs.example.com
- **Issue Tracker:** https://github.com/example/avi-aoi-management/issues

---

*Tài liệu này được tạo tự động bởi Manus AI. Phiên bản: 1.0.0*
