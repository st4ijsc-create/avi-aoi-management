#!/usr/bin/env node
/**
 * Pack Offline Deployment
 * 
 * Đóng gói hệ thống hoàn chỉnh cho máy chủ offline (không có internet).
 * 
 * Bao gồm:
 *   - dist-secure/ (server bundle + frontend assets)
 *   - node_modules/ (tất cả dependencies)
 *   - drizzle/ (migration files cho database)
 *   - Scripts khởi tạo DB & cài đặt
 *   - .env.example, start.bat, install.bat
 * 
 * Output: offline-deploy/synapse-platform-offline-v{version}-{date}.zip
 * 
 * Usage:
 *   node scripts/pack-offline.mjs
 *   node scripts/pack-offline.mjs --skip-build   (bỏ qua build nếu đã build)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DIST_SECURE = path.join(ROOT, 'dist-secure');
const STAGING = path.join(ROOT, 'offline-deploy', 'staging');
const OUTPUT_DIR = path.join(ROOT, 'offline-deploy');

const skipBuild = process.argv.includes('--skip-build');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version || '1.0.0';
const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const archiveName = `synapse-platform-offline-v${version}-${dateStr}`; // R-2 rebrand (was avi-aoi-management-offline-*)

console.log('═══════════════════════════════════════════════════════');
console.log('  OFFLINE DEPLOYMENT PACKAGER');
console.log(`  Version: ${version}  |  Date: ${dateStr}`);
console.log('═══════════════════════════════════════════════════════');

// ─── Step 1: Build ───────────────────────────────────────────
if (!skipBuild) {
  console.log('\n[1/6] Building secure distribution...');
  execSync('node scripts/build-secure.mjs', { cwd: ROOT, stdio: 'inherit' });
} else {
  console.log('\n[1/6] Skipping build (--skip-build)');
  if (!fs.existsSync(path.join(DIST_SECURE, 'index.js'))) {
    console.error('[ERROR] dist-secure/index.js not found! Run build first.');
    process.exit(1);
  }
}

// ─── Step 2: Clean & prepare staging ─────────────────────────
console.log('\n[2/6] Preparing staging directory...');
if (fs.existsSync(STAGING)) {
  fs.rmSync(STAGING, { recursive: true });
}
fs.mkdirSync(STAGING, { recursive: true });

// ─── Step 3: Copy dist-secure contents ──────────────────────
console.log('\n[3/6] Copying application files...');

// Copy all dist-secure files (except old node_modules)
for (const entry of fs.readdirSync(DIST_SECURE, { withFileTypes: true })) {
  const src = path.join(DIST_SECURE, entry.name);
  const dest = path.join(STAGING, entry.name);
  
  if (entry.name === 'node_modules') continue; // Will install fresh
  if (entry.name === 'package-lock.json') continue;
  if (entry.name === 'package.full.json') continue;
  
  if (entry.isDirectory()) {
    copyDirSync(src, dest);
    console.log(`  ✓ ${entry.name}/`);
  } else {
    fs.copyFileSync(src, dest);
    console.log(`  ✓ ${entry.name}`);
  }
}

// Copy drizzle migrations
const drizzleSrc = path.join(ROOT, 'drizzle');
const drizzleDest = path.join(STAGING, 'drizzle');
if (fs.existsSync(drizzleSrc)) {
  copyDirSync(drizzleSrc, drizzleDest);
  const sqlFiles = fs.readdirSync(drizzleDest).filter(f => f.endsWith('.sql'));
  console.log(`  ✓ drizzle/ (${sqlFiles.length} migration files)`);
}

// Copy drizzle.config.ts (needed for drizzle-kit migrate)
if (fs.existsSync(path.join(ROOT, 'drizzle.config.ts'))) {
  fs.copyFileSync(
    path.join(ROOT, 'drizzle.config.ts'),
    path.join(STAGING, 'drizzle.config.ts')
  );
  console.log('  ✓ drizzle.config.ts');
}

// ─── Step 4: Create production package.json with drizzle-kit ─
console.log('\n[4/6] Creating package.json & installing dependencies...');

// Read the dist-secure package.json and add drizzle-kit
const distPkg = JSON.parse(fs.readFileSync(path.join(DIST_SECURE, 'package.json'), 'utf-8'));

const productionPkg = {
  name: distPkg.name || 'synapse-platform',
  version: version,
  type: 'module',
  private: true,
  scripts: {
    start: 'node index.js',
    'db:migrate': 'npx drizzle-kit migrate',
  },
  engines: {
    node: '>=20.0.0',
  },
  dependencies: {
    ...distPkg.dependencies,
    // Add drizzle-kit as production dep for offline migration
    'drizzle-kit': '^0.31.4',
    // cross-env for start script
    'cross-env': '^7.0.3',
    // TypeScript for drizzle config parsing
    'tsx': '^4.20.0',
  },
};

fs.writeFileSync(
  path.join(STAGING, 'package.json'),
  JSON.stringify(productionPkg, null, 2)
);

// Install dependencies using npm (produces package-lock.json + node_modules)
console.log('  Installing dependencies with npm (this may take a few minutes)...');
execSync('npm install --production --ignore-scripts', {
  cwd: STAGING,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});

// Some packages need post-install (sharp, bcryptjs, etc.)
console.log('  Running platform-specific builds...');
try {
  execSync('npm rebuild', { cwd: STAGING, stdio: 'inherit' });
} catch (e) {
  console.warn('  [WARN] Some native modules may need rebuilding on target platform');
}

// Count installed packages
const nmPath = path.join(STAGING, 'node_modules');
const pkgCount = fs.existsSync(nmPath)
  ? fs.readdirSync(nmPath).filter(f => !f.startsWith('.')).length
  : 0;
console.log(`  ✓ ${pkgCount} packages installed`);

// ─── Step 5: Create helper scripts ──────────────────────────
console.log('\n[5/6] Creating deployment scripts...');

// Enhanced start.bat
const startBat = `@echo off
chcp 65001 >nul
echo ═══════════════════════════════════════════════
echo   SYNAPSE Platform - Production
echo   Version: ${version}
echo ═══════════════════════════════════════════════
echo.

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js 20+ from https://nodejs.org
    pause
    exit /b 1
)

:: Check .env
if not exist .env (
    echo [WARNING] .env file not found!
    echo Please run install.bat first, or copy .env.example to .env and configure it.
    pause
    exit /b 1
)

:: Create uploads directory if needed
if not exist uploads mkdir uploads

echo Starting server...
set NODE_ENV=production
node index.js
pause
`;
fs.writeFileSync(path.join(STAGING, 'start.bat'), startBat);

// Install/setup script
const installBat = `@echo off
chcp 65001 >nul
echo ═══════════════════════════════════════════════
echo   SYNAPSE Platform - Installer
echo   Version: ${version}
echo ═══════════════════════════════════════════════
echo.

:: Check Node.js
echo [1/4] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js 20+ before running this installer.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do echo   Node.js %%i detected

:: Check if .env exists
echo.
echo [2/4] Checking configuration...
if not exist .env (
    echo   Creating .env from template...
    copy .env.example .env >nul
    echo   [IMPORTANT] Please edit .env file with your database connection info!
    echo   Required: DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/avi_aoi_db
    echo.
    echo   Opening .env for editing...
    notepad .env
    echo.
    echo   After saving .env, press any key to continue...
    pause >nul
) else (
    echo   .env file found
)

:: Create required directories
echo.
echo [3/4] Creating directories...
if not exist uploads mkdir uploads
if not exist uploads\\aoi-cache mkdir uploads\\aoi-cache
echo   uploads/ created

:: Run database migrations
echo.
echo [4/4] Running database migrations...
echo   This will create/update all database tables...
npx drizzle-kit migrate 2>nul
if errorlevel 1 (
    echo   [WARNING] Migration failed. Please check DATABASE_URL in .env
    echo   Make sure PostgreSQL is running and the database exists.
    echo.
    echo   To create the database manually:
    echo     psql -U postgres -c "CREATE DATABASE avi_aoi_db;"
    echo.
    echo   Then run this installer again.
    pause
    exit /b 1
)
echo   Database migrations completed successfully!

echo.
echo ═══════════════════════════════════════════════
echo   INSTALLATION COMPLETE!
echo ═══════════════════════════════════════════════
echo.
echo   To start the server:
echo     start.bat
echo     OR: set NODE_ENV=production ^& node index.js
echo.
echo   Default access:
echo     Web UI:  http://localhost:3000
echo     API:     http://localhost:3000/api
echo.
echo   Default admin account:
echo     Username: admin
echo     Password: admin123
echo     (Change password after first login!)
echo.
pause
`;
fs.writeFileSync(path.join(STAGING, 'install.bat'), installBat);

// Enhanced .env.example
const envExample = `# ═══════════════════════════════════════════════════════
# SYNAPSE Platform - Production Configuration
# Version: ${version}
# ═══════════════════════════════════════════════════════

# ── Database (REQUIRED) ──────────────────────────────
# PostgreSQL connection string
# Format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/avi_aoi_db

# ── Server ───────────────────────────────────────────
NODE_ENV=production
PORT=3000

# ── Security ─────────────────────────────────────────
# JWT secret - change this to a random string!
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=change-this-to-a-random-secret-string

# ── License ──────────────────────────────────────────
# Set to true for offline deployment without License Server
LICENSE_BYPASS=true
LICENSE_SERVER_URL=
LICENSE_PRODUCT_CODE=SYNAPSE-PROD
# legacy AVI-AOI-* van duoc chap nhan (dual-accept R-2)
LICENSE_ENCRYPTION_SECRET=avi-license-secret-2026-xK9mP4qR

# ── Storage ──────────────────────────────────────────
STORAGE_MODE=local
LOCAL_STORAGE_DIR=./uploads

# ── MQTT (optional) ──────────────────────────────────
MQTT_ENABLED=true
MQTT_PORT=1883
MQTT_WS_PORT=8883
MQTT_BROKER_URL=mqtt://localhost:1883

# ── External MQTT (disabled for offline) ─────────────
EXTERNAL_MQTT_ENABLED=false

# ── AOI Image Cache ─────────────────────────────────
AOI_CACHE_DIR=./uploads/aoi-cache
AOI_CACHE_TTL_DAYS=7

# ── Email (optional) ────────────────────────────────
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# SMTP_FROM=

# ── Master API Key ──────────────────────────────────
# API key for AVI/AOI machine clients to register
# Change this to your own key!
MASTER_API_KEY=master_avi_aoi_2026_change_me

# ── App Branding ────────────────────────────────────
VITE_APP_TITLE=VPMS System
VITE_APP_ID=synapse-platform
`;
fs.writeFileSync(path.join(STAGING, '.env.example'), envExample);

// README
const readme = `# SYNAPSE Platform (formerly AVI AOI Management) - Offline Deployment
# Version: ${version} | Build: ${dateStr}

## Yêu cầu hệ thống
- **Node.js** >= 20.0.0 (khuyến nghị 22 LTS)
- **PostgreSQL** >= 15
- **RAM** >= 4GB
- **OS**: Windows 10/11 hoặc Windows Server 2019+
- **KHÔNG** cần kết nối internet

## Cài đặt nhanh (Windows)

### Bước 1: Giải nén
Giải nén file zip vào thư mục, ví dụ: \`C:\\VPMS\`

### Bước 2: Tạo Database
Mở pgAdmin hoặc psql:
\`\`\`sql
CREATE DATABASE avi_aoi_db;
\`\`\`

### Bước 3: Chạy installer
\`\`\`
install.bat
\`\`\`
Installer sẽ:
- Kiểm tra Node.js
- Tạo file .env (bạn cần điền thông tin database)
- Tạo thư mục uploads
- Chạy database migrations tự động

### Bước 4: Khởi động
\`\`\`
start.bat
\`\`\`

### Bước 5: Truy cập
- Web: http://localhost:3000
- Tài khoản mặc định: admin / admin123

## Cấu trúc thư mục
\`\`\`
├── index.js            # Server (main)
├── index.cjs           # License SDK
├── public/             # Frontend UI
├── drizzle/            # Database migrations
├── node_modules/       # Dependencies (đã đầy đủ)
├── uploads/            # File storage (tự tạo)
├── .env                # Cấu hình (tạo từ .env.example)
├── .env.example        # Mẫu cấu hình
├── install.bat         # Script cài đặt
├── start.bat           # Script khởi động
├── package.json        # Package info
└── README.md           # Hướng dẫn này
\`\`\`

## Cấu hình quan trọng (.env)

| Biến | Mô tả | Bắt buộc |
|------|--------|----------|
| DATABASE_URL | PostgreSQL connection string | ✅ |
| JWT_SECRET | Secret cho JWT token | ✅ |
| PORT | Cổng server (mặc định 3000) | |
| LICENSE_BYPASS | true = bỏ qua kiểm tra license | ✅ offline |
| MQTT_ENABLED | Bật MQTT broker nội bộ | |
| MASTER_API_KEY | API key cho máy AOI kết nối | |
| STORAGE_MODE | local = lưu file trên ổ đĩa | |

## Cập nhật phiên bản
1. Dừng server (Ctrl+C hoặc đóng terminal)
2. **Backup** file \`.env\` và thư mục \`uploads/\`
3. Giải nén bản mới ghi đè (KHÔNG ghi đè .env và uploads/)
4. Chạy lại: \`npx drizzle-kit migrate\` (cập nhật database)
5. Khởi động: \`start.bat\`

## Khắc phục sự cố

### Server không khởi động
- Kiểm tra Node.js: \`node --version\` (cần >= 20)
- Kiểm tra DATABASE_URL trong .env
- Kiểm tra PostgreSQL đang chạy

### Không đăng nhập được
- Tài khoản mặc định: admin / admin123
- Kiểm tra database đã chạy migrations

### Module không hiển thị
- Đảm bảo LICENSE_BYPASS=true trong .env
- Xóa cache trình duyệt (Ctrl+Shift+Delete)

### MQTT không kết nối
- Kiểm tra MQTT_ENABLED=true trong .env
- Port 1883 (TCP) và 8883 (WebSocket) cần mở
`;
fs.writeFileSync(path.join(STAGING, 'README.md'), readme);

// ─── Step 6: Create ZIP archive ─────────────────────────────
console.log('\n[6/6] Creating ZIP archive...');

// Use PowerShell to create zip (available on all Windows 10+)
const zipPath = path.join(OUTPUT_DIR, `${archiveName}.zip`);
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

try {
  // Rename staging to final folder name for clean zip structure
  const finalDir = path.join(OUTPUT_DIR, archiveName);
  if (fs.existsSync(finalDir)) {
    fs.rmSync(finalDir, { recursive: true });
  }
  fs.renameSync(STAGING, finalDir);

  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${finalDir}\\*' -DestinationPath '${zipPath}' -Force"`,
    { cwd: ROOT, stdio: 'inherit', timeout: 600000 }
  );

  // Get zip size
  const stats = fs.statSync(zipPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  OFFLINE PACKAGE COMPLETE ✓');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Archive:  ${zipPath}`);
  console.log(`  Size:     ${sizeMB} MB`);
  console.log(`  Version:  ${version}`);
  console.log('');
  console.log('  Deploy to offline server:');
  console.log('    1. Copy ZIP to server');
  console.log('    2. Extract to any folder (e.g. C:\\VPMS)');
  console.log('    3. Run install.bat');
  console.log('    4. Run start.bat');
  console.log('═══════════════════════════════════════════════════════');

  // Keep the unzipped folder too for easy access
  console.log(`\n  Unzipped folder also available at:`);
  console.log(`    ${finalDir}`);

} catch (err) {
  console.error('[ERROR] Failed to create ZIP:', err.message);
  console.log('\n  The staging folder is available at:');
  console.log(`    ${STAGING}`);
  console.log('  You can manually zip it or copy to the server.');
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
