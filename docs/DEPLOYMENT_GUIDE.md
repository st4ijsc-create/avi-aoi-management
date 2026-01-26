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
| MySQL/TiDB | 8.0+ |
| MQTT Broker | Mosquitto 2.x hoặc HiveMQ |
| Redis (optional) | 7.x |
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

### 3.1 MySQL Setup

```bash
# Install MySQL
sudo apt-get install mysql-server

# Secure installation
sudo mysql_secure_installation

# Create database and user
sudo mysql -u root -p
```

```sql
CREATE DATABASE avi_aoi_mes CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'mes_user'@'localhost' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON avi_aoi_mes.* TO 'mes_user'@'localhost';
FLUSH PRIVILEGES;
```

### 3.2 Database Migration

```bash
cd /opt/avi-aoi-management

# Install dependencies
pnpm install

# Run migrations
pnpm db:push
```

---

## 4. Cấu Hình MQTT Broker

### 4.1 Cài Đặt Mosquitto

```bash
# Install Mosquitto
sudo apt-get install mosquitto mosquitto-clients

# Enable and start service
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
```

### 4.2 Cấu Hình Mosquitto

Tạo file `/etc/mosquitto/conf.d/mes.conf`:

```conf
# Listener configuration
listener 1883
protocol mqtt

# WebSocket listener (for browser clients)
listener 9001
protocol websockets

# Authentication
allow_anonymous false
password_file /etc/mosquitto/passwd

# Logging
log_dest file /var/log/mosquitto/mosquitto.log
log_type all

# Persistence
persistence true
persistence_location /var/lib/mosquitto/
```

### 4.3 Tạo User MQTT

```bash
# Create password file
sudo mosquitto_passwd -c /etc/mosquitto/passwd mes_system

# Restart Mosquitto
sudo systemctl restart mosquitto
```

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
