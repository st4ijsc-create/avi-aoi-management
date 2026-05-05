#!/usr/bin/env node
/**
 * Build Offline Deployment Package
 * 
 * Đóng gói toàn bộ ứng dụng + dependencies để deploy trên 
 * Windows Server 2019 KHÔNG CÓ INTERNET.
 * 
 * Output: _deploy/avi-aoi-v{version}/
 *   ├── node/                  (Node.js portable runtime - copy thủ công nếu cần)
 *   ├── dist/
 *   │   ├── index.js           (server bundle)
 *   │   ├── index.cjs          (license SDK)
 *   │   └── public/            (client SPA build)
 *   ├── node_modules/          (production dependencies - real files, no symlinks)
 *   ├── drizzle/               (database migrations)
 *   ├── uploads/               (empty - runtime upload folder)
 *   ├── package.json
 *   ├── .env.example
 *   ├── start.bat
 *   ├── install-service.bat
 *   └── README.txt
 * 
 * Usage:
 *   node scripts/build-offline-package.mjs
 *   node scripts/build-offline-package.mjs --skip-build    (skip vite+esbuild, use existing dist/)
 *   node scripts/build-offline-package.mjs --include-node  (download & include Node.js portable)
 */

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const SKIP_BUILD = args.includes('--skip-build');
const INCLUDE_NODE = args.includes('--include-node');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const VERSION = pkg.version || '1.0.0';
const DEPLOY_NAME = `avi-aoi-v${VERSION}`;
const DEPLOY_ROOT = path.join(ROOT, '_deploy');
const DEPLOY_DIR = path.join(DEPLOY_ROOT, DEPLOY_NAME);
const DIST = path.join(ROOT, 'dist');

// ─── Native modules that need platform-specific binaries ────
const NATIVE_MODULES = [
  'sharp', '@img/sharp-win32-x64', '@img/sharp-libvips-win32-x64',
  'onnxruntime-node',
];

// ─── Heavy optional modules (can be excluded to reduce size) ──
const OPTIONAL_HEAVY = ['puppeteer', 'puppeteer-core'];

console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log('  AVI AOI - OFFLINE DEPLOYMENT PACKAGE BUILDER');
console.log('══════════════════════════════════════════════════════════════');
console.log(`  Version:    ${VERSION}`);
console.log(`  Output:     ${DEPLOY_DIR}`);
console.log(`  Skip Build: ${SKIP_BUILD}`);
console.log(`  Node.js:    ${INCLUDE_NODE ? 'Include portable' : 'Not included'}`);
console.log('══════════════════════════════════════════════════════════════');

// ═══════════════════════════════════════════════════════════════
// Step 1: Clean previous deploy
// ═══════════════════════════════════════════════════════════════
console.log('\n[1/8] Cleaning previous deploy...');
if (fs.existsSync(DEPLOY_DIR)) {
  fs.rmSync(DEPLOY_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DEPLOY_DIR, { recursive: true });

// ═══════════════════════════════════════════════════════════════
// Step 2: Build production (vite + esbuild)
// ═══════════════════════════════════════════════════════════════
if (!SKIP_BUILD) {
  console.log('\n[2/8] Building production (vite + esbuild)...');
  execSync('pnpm build', { cwd: ROOT, stdio: 'inherit' });
} else {
  console.log('\n[2/8] Skipping build (using existing dist/)...');
  if (!fs.existsSync(path.join(DIST, 'index.js'))) {
    console.error('ERROR: dist/index.js not found. Run without --skip-build first.');
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Copy built files
// ═══════════════════════════════════════════════════════════════
console.log('\n[3/8] Copying built files...');

// dist/index.js (server bundle)
const distOut = path.join(DEPLOY_DIR, 'dist');
fs.mkdirSync(distOut, { recursive: true });
fs.copyFileSync(path.join(DIST, 'index.js'), path.join(distOut, 'index.js'));
console.log('  ✓ dist/index.js (server bundle)');

// dist/index.cjs (license SDK)
if (fs.existsSync(path.join(DIST, 'index.cjs'))) {
  fs.copyFileSync(path.join(DIST, 'index.cjs'), path.join(distOut, 'index.cjs'));
  console.log('  ✓ dist/index.cjs (license SDK)');
}

// dist/public/ (client SPA)
const publicSrc = path.join(DIST, 'public');
if (fs.existsSync(publicSrc)) {
  copyDirSync(publicSrc, path.join(distOut, 'public'));
  console.log('  ✓ dist/public/ (client SPA)');
}

// ═══════════════════════════════════════════════════════════════
// Step 4: Copy drizzle migrations
// ═══════════════════════════════════════════════════════════════
console.log('\n[4/8] Copying database migrations...');
const drizzleSrc = path.join(ROOT, 'drizzle');
if (fs.existsSync(drizzleSrc)) {
  const drizzleDest = path.join(DEPLOY_DIR, 'drizzle');
  // Copy only .sql files and meta/ folder
  fs.mkdirSync(drizzleDest, { recursive: true });
  let sqlCount = 0;
  for (const entry of fs.readdirSync(drizzleSrc, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.sql')) {
      fs.copyFileSync(
        path.join(drizzleSrc, entry.name),
        path.join(drizzleDest, entry.name)
      );
      sqlCount++;
    }
    if (entry.isDirectory() && entry.name === 'meta') {
      copyDirSync(
        path.join(drizzleSrc, entry.name),
        path.join(drizzleDest, entry.name)
      );
    }
  }
  console.log(`  ✓ ${sqlCount} migration files copied`);
}

// ═══════════════════════════════════════════════════════════════
// Step 5: Install production node_modules (npm for proper flat structure)
// ═══════════════════════════════════════════════════════════════
console.log('\n[5/8] Installing production dependencies (npm flat install)...');
console.log('       This may take a few minutes...');

// Write package.json with production deps
const prodPkg = {
  name: pkg.name,
  version: pkg.version,
  type: 'module',
  dependencies: { ...pkg.dependencies }
};

fs.writeFileSync(
  path.join(DEPLOY_DIR, 'package.json'),
  JSON.stringify(prodPkg, null, 2)
);

// Use npm install --production for a proper flat node_modules with all transitive deps
// --ignore-scripts: skip postinstall scripts (we handle native binaries in step 5b)
execSync('npm install --production --ignore-scripts', {
  cwd: DEPLOY_DIR, stdio: 'inherit', timeout: 600000
});

// Install sharp's Windows native binary separately
console.log('  Installing sharp native binary for Windows...');
execSync('npm install @img/sharp-win32-x64 --no-save', {
  cwd: DEPLOY_DIR, stdio: 'inherit', timeout: 120000
});

// Install onnxruntime-common (peer dep of onnxruntime-node, may not auto-install)
const onnxCommonDir = path.join(DEPLOY_DIR, 'node_modules', 'onnxruntime-common');
if (!fs.existsSync(onnxCommonDir)) {
  console.log('  Installing onnxruntime-common...');
  execSync('npm install onnxruntime-common --no-save', {
    cwd: DEPLOY_DIR, stdio: 'inherit', timeout: 120000
  });
}

console.log('  ✓ node_modules installed (npm flat structure)');

// ═══════════════════════════════════════════════════════════════
// Step 5b: Ensure onnxruntime-node native DLLs are present
// ═══════════════════════════════════════════════════════════════
console.log('\n[5b/8] Verifying native module binaries...');

const deployNm = path.join(DEPLOY_DIR, 'node_modules');

// Check sharp native binary
const sharpNodeFile = path.join(deployNm, '@img', 'sharp-win32-x64', 'lib', 'sharp-win32-x64.node');
if (fs.existsSync(sharpNodeFile)) {
  console.log('  ✓ sharp native binary present');
} else {
  console.error('  WARNING: sharp native binary missing! Image processing may not work.');
}

// Check onnxruntime-node native DLLs
const onnxNodeFile = path.join(deployNm, 'onnxruntime-node', 'bin', 'napi-v8', 'win32', 'x64', 'onnxruntime_binding.node');
const onnxDllFile = path.join(deployNm, 'onnxruntime-node', 'bin', 'napi-v8', 'win32', 'x64', 'onnxruntime.dll');
if (!fs.existsSync(onnxNodeFile) && !fs.existsSync(onnxDllFile)) {
  console.log('  onnxruntime-node binaries missing, trying to copy from pnpm store...');
  const pnpmOnnx = path.join(ROOT, 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmOnnx)) {
    const onnxPattern = fs.readdirSync(pnpmOnnx).find(d => d.startsWith('onnxruntime-node@'));
    if (onnxPattern) {
      const onnxSrc = path.join(pnpmOnnx, onnxPattern, 'node_modules', 'onnxruntime-node');
      if (fs.existsSync(onnxSrc)) {
        copyDirSync(onnxSrc, path.join(deployNm, 'onnxruntime-node'));
        console.log('  ✓ onnxruntime-node copied from pnpm store');
      }
    }
  }
} else {
  console.log('  ✓ onnxruntime-node binaries present');
}

// ═══════════════════════════════════════════════════════════════
// Step 6: Remove unnecessary files to reduce size
// ═══════════════════════════════════════════════════════════════
console.log('\n[6/8] Cleaning up unnecessary files...');

const nmPath = path.join(DEPLOY_DIR, 'node_modules');
let savedBytes = 0;

// Patterns to remove from node_modules
const REMOVE_PATTERNS = [
  // Documentation & meta files
  'README.md', 'readme.md', 'README.MD', 'README',
  'CHANGELOG.md', 'CHANGELOG', 'CHANGES.md', 'HISTORY.md',
  'LICENSE.md', 'LICENSE.txt', 'LICENSE', 'license',
  'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md',
  '.npmignore', '.eslintrc', '.eslintrc.json', '.eslintrc.js',
  '.prettierrc', '.prettierrc.json', '.editorconfig',
  '.travis.yml', '.github', '.circleci',
  'tsconfig.json', 'tsconfig.build.json', 'jest.config.js',
  'SECURITY.md', 'AUTHORS', '.npmrc',
];

// Remove .d.ts files (type definitions - not needed at runtime)
// Remove test directories
const REMOVE_DIRS = ['test', 'tests', '__tests__', 'docs', 'doc', 'example', 'examples', '.github'];

function cleanNodeModules(dir, depth = 0) {
  if (!fs.existsSync(dir)) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          if (REMOVE_DIRS.includes(entry.name) && depth > 0) {
            const size = getDirSize(fullPath);
            fs.rmSync(fullPath, { recursive: true, force: true });
            savedBytes += size;
          } else {
            cleanNodeModules(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          if (REMOVE_PATTERNS.includes(entry.name) ||
              (entry.name.endsWith('.map') && depth > 1) ||
              entry.name.endsWith('.d.ts') ||
              entry.name.endsWith('.d.mts') ||
              entry.name.endsWith('.d.cts')) {
            const stat = fs.statSync(fullPath);
            savedBytes += stat.size;
            fs.unlinkSync(fullPath);
          }
        }
      } catch (e) { /* skip locked/protected files */ }
    }
  } catch (e) { /* skip unreadable dirs */ }
}

cleanNodeModules(nmPath);
console.log(`  ✓ Cleaned ${(savedBytes / 1024 / 1024).toFixed(1)} MB of unnecessary files`);

// Remove puppeteer's chromium download (huge, ~200MB+)
// PDF export can use system Chrome or be disabled
const puppeteerCache = path.join(nmPath, 'puppeteer', '.local-chromium');
const puppeteerCache2 = path.join(nmPath, '.cache', 'puppeteer');
for (const p of [puppeteerCache, puppeteerCache2]) {
  if (fs.existsSync(p)) {
    const size = getDirSize(p);
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`  ✓ Removed puppeteer cache: ${(size / 1024 / 1024).toFixed(0)} MB`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Step 7: Create config & startup files
// ═══════════════════════════════════════════════════════════════
console.log('\n[7/8] Creating configuration files...');

// uploads/ directory
fs.mkdirSync(path.join(DEPLOY_DIR, 'uploads'), { recursive: true });

// package.json - keep dependencies so node_modules stays valid
// Read existing package.json from deploy (may have deps from fallback install)
let existingPkg = {};
const deployPkgPath = path.join(DEPLOY_DIR, 'package.json');
if (fs.existsSync(deployPkgPath)) {
  try { existingPkg = JSON.parse(fs.readFileSync(deployPkgPath, 'utf-8')); } catch {}
}
const prodPkgJson = {
  name: 'avi-aoi-management',
  version: VERSION,
  type: 'module',
  private: true,
  scripts: {
    start: 'node dist/index.js',
    migrate: 'node node_modules/drizzle-kit/bin.cjs migrate'
  },
  engines: {
    node: '>=20.0.0'
  },
  // Keep dependencies so that node_modules structure is valid
  ...(existingPkg.dependencies ? { dependencies: existingPkg.dependencies } : {}),
  ...(existingPkg.pnpm ? { pnpm: existingPkg.pnpm } : {}),
};
fs.writeFileSync(deployPkgPath, JSON.stringify(prodPkgJson, null, 2));
console.log('  ✓ package.json');

// .env.example
const envExample = `# ═══════════════════════════════════════════════════════════
# AVI AOI Management System - Production Configuration
# Copy this file to .env and fill in your values
# ═══════════════════════════════════════════════════════════

# Server
NODE_ENV=production
PORT=3000

# Database (PostgreSQL)
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/avi_aoi_db

# License Server (optional)
# LICENSE_SERVER_URL=http://192.168.x.x:3001
# LICENSE_PRODUCT_CODE=your_product_code
# LICENSE_ENCRYPTION_SECRET=your_secret

# MQTT Broker (built-in, optional config)
# MQTT_PORT=1883
# MQTT_WS_PORT=8083

# Redis (optional - falls back to in-memory cache)
# REDIS_URL=redis://localhost:6379

# OAuth (optional)
# OAUTH_SERVER_URL=http://your-oauth-server

# Email (optional - for notifications)
# SMTP_HOST=smtp.your-server.com
# SMTP_PORT=587
# SMTP_USER=your-email@example.com
# SMTP_PASSWORD=your-password

# OpenAI (optional - for AI features)
# OPENAI_API_KEY=sk-...

# SSL (optional - for HTTPS)
# SSL_KEY_PATH=./certs/key.pem
# SSL_CERT_PATH=./certs/cert.pem
`;
fs.writeFileSync(path.join(DEPLOY_DIR, '.env.example'), envExample);
console.log('  ✓ .env.example');

// start.bat
const startBat = `@echo off
chcp 65001 >nul
echo.
echo ═══════════════════════════════════════════════
echo   AVI AOI Management System v${VERSION}
echo ═══════════════════════════════════════════════
echo.

:: Check .env file
if not exist ".env" (
    echo [WARNING] .env file not found!
    echo           Copy .env.example to .env and configure it.
    echo.
    pause
    exit /b 1
)

:: Set environment
set NODE_ENV=production

:: Check if Node.js is available
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    :: Try portable Node.js in ./node/ folder
    if exist "node\\node.exe" (
        echo Using portable Node.js...
        set "PATH=%~dp0node;%PATH%"
    ) else (
        echo [ERROR] Node.js not found!
        echo         Install Node.js 20+ or copy portable Node.js to ./node/ folder
        pause
        exit /b 1
    )
)

echo Starting server on port %PORT%...
echo Press Ctrl+C to stop.
echo.
node dist/index.js
pause
`;
fs.writeFileSync(path.join(DEPLOY_DIR, 'start.bat'), startBat);
console.log('  ✓ start.bat');

// install-service.bat (install as Windows Service using nssm or node-windows)
const installServiceBat = `@echo off
chcp 65001 >nul
echo.
echo ═══════════════════════════════════════════════
echo   Install AVI AOI as Windows Service
echo ═══════════════════════════════════════════════
echo.
echo This script requires NSSM (Non-Sucking Service Manager).
echo Download from: https://nssm.cc/download
echo Place nssm.exe in this folder or in PATH.
echo.

:: Check NSSM
where nssm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    if exist "nssm.exe" (
        set "NSSM=nssm.exe"
    ) else (
        echo [ERROR] nssm.exe not found!
        echo         Download from https://nssm.cc/download
        echo         Place nssm.exe in this folder.
        pause
        exit /b 1
    )
) else (
    set "NSSM=nssm"
)

:: Find Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    if exist "node\\node.exe" (
        set "NODE_EXE=%~dp0node\\node.exe"
    ) else (
        echo [ERROR] Node.js not found!
        pause
        exit /b 1
    )
) else (
    for /f "tokens=*" %%i in ('where node') do set "NODE_EXE=%%i"
)

set SERVICE_NAME=AviAoiManagement
set APP_DIR=%~dp0

echo Installing service: %SERVICE_NAME%
echo Node.js: %NODE_EXE%
echo App Dir: %APP_DIR%
echo.

%NSSM% install %SERVICE_NAME% "%NODE_EXE%" dist\\index.js
%NSSM% set %SERVICE_NAME% AppDirectory "%APP_DIR%"
%NSSM% set %SERVICE_NAME% AppEnvironmentExtra "NODE_ENV=production"
%NSSM% set %SERVICE_NAME% DisplayName "AVI AOI Management System"
%NSSM% set %SERVICE_NAME% Description "AVI AOI Inspection Management System v${VERSION}"
%NSSM% set %SERVICE_NAME% Start SERVICE_AUTO_START
%NSSM% set %SERVICE_NAME% AppStdout "%APP_DIR%logs\\service-stdout.log"
%NSSM% set %SERVICE_NAME% AppStderr "%APP_DIR%logs\\service-stderr.log"
%NSSM% set %SERVICE_NAME% AppRotateFiles 1
%NSSM% set %SERVICE_NAME% AppRotateBytes 10485760

:: Create logs directory
mkdir "%APP_DIR%logs" 2>nul

echo.
echo ═══════════════════════════════════════════════
echo   Service installed successfully!
echo ═══════════════════════════════════════════════
echo.
echo   Start:   net start %SERVICE_NAME%
echo   Stop:    net stop %SERVICE_NAME%
echo   Remove:  nssm remove %SERVICE_NAME% confirm
echo   Status:  nssm status %SERVICE_NAME%
echo.
pause
`;
fs.writeFileSync(path.join(DEPLOY_DIR, 'install-service.bat'), installServiceBat);
console.log('  ✓ install-service.bat');

// uninstall-service.bat
const uninstallServiceBat = `@echo off
chcp 65001 >nul
echo Stopping and removing AviAoiManagement service...
net stop AviAoiManagement 2>nul
nssm remove AviAoiManagement confirm
echo Done.
pause
`;
fs.writeFileSync(path.join(DEPLOY_DIR, 'uninstall-service.bat'), uninstallServiceBat);
console.log('  ✓ uninstall-service.bat');

// README.txt
const readme = `═══════════════════════════════════════════════════════════════
  AVI AOI Management System v${VERSION}
  Offline Deployment Package
  Built: ${new Date().toISOString()}
═══════════════════════════════════════════════════════════════

REQUIREMENTS:
  - Windows Server 2019 or later
  - Node.js 20.x or later (LTS recommended)
  - PostgreSQL 14+ (with database created)
  - Minimum 4GB RAM, 2 CPU cores
  - Port 3000 (default, configurable)

QUICK START:
  1. Install Node.js 20 LTS (or copy portable to ./node/ folder)
  2. Install & configure PostgreSQL
  3. Copy .env.example to .env
  4. Edit .env with your database URL and settings
  5. Run database migrations:
     Double-click migrate.bat
     (or run: node migrate.mjs)
  6. Double-click start.bat (or run: node dist/index.js)

INSTALL AS WINDOWS SERVICE:
  1. Download nssm.exe from https://nssm.cc/download
  2. Place nssm.exe in this folder
  3. Run install-service.bat as Administrator
  4. Start: net start AviAoiManagement

PORTABLE NODE.JS (no installer needed):
  1. Download Node.js Windows Binary (.zip) from https://nodejs.org
  2. Extract to ./node/ folder (so that ./node/node.exe exists)
  3. start.bat will auto-detect it

FOLDER STRUCTURE:
  dist/           - Application files (server + client)
  dist/public/    - Web frontend (SPA)
  node_modules/   - Runtime dependencies
  drizzle/        - Database migration SQL files
  uploads/        - File upload storage (auto-created)
  logs/           - Service logs (auto-created)
  .env            - Configuration (create from .env.example)

DATABASE SETUP:
  1. Install PostgreSQL
  2. Create database: CREATE DATABASE avi_aoi_db;
  3. Set DATABASE_URL in .env:
     DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/avi_aoi_db
  4. Run migrations (double-click migrate.bat or run):
     node migrate.mjs
  5. To check pending migrations without applying:
     node migrate.mjs --dry-run

FIREWALL:
  Allow inbound TCP on port 3000 (or your configured PORT)
  If using MQTT: allow TCP 1883 and 8083

TROUBLESHOOTING:
  - Check logs/ folder for error details
  - Verify PostgreSQL is running and accessible
  - Ensure .env file exists with correct DATABASE_URL
  - Ensure port 3000 is not in use by another application

═══════════════════════════════════════════════════════════════
`;
fs.writeFileSync(path.join(DEPLOY_DIR, 'README.txt'), readme);
console.log('  ✓ README.txt');

// Copy standalone migration runner
const migrateScriptSrc = path.join(ROOT, 'scripts', 'migrate-standalone.mjs');
if (fs.existsSync(migrateScriptSrc)) {
  fs.copyFileSync(migrateScriptSrc, path.join(DEPLOY_DIR, 'migrate.mjs'));
  console.log('  ✓ migrate.mjs (standalone migration runner)');
}

// migrate.bat
const migrateBat = `@echo off
chcp 65001 >nul
echo.
echo ═══════════════════════════════════════════════
echo   AVI AOI - Database Migration
echo ═══════════════════════════════════════════════
echo.

:: Check .env file
if not exist ".env" (
    echo [ERROR] .env file not found!
    echo         Copy .env.example to .env and configure DATABASE_URL
    pause
    exit /b 1
)

:: Check if Node.js is available
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    if exist "node\\node.exe" (
        set "PATH=%~dp0node;%PATH%"
    ) else (
        echo [ERROR] Node.js not found!
        pause
        exit /b 1
    )
)

echo Running database migrations...
echo.
node migrate.mjs %*
echo.
pause
`;
fs.writeFileSync(path.join(DEPLOY_DIR, 'migrate.bat'), migrateBat);
console.log('  ✓ migrate.bat');

// Copy patches folder if exists
const patchesDir = path.join(ROOT, 'patches');
if (fs.existsSync(patchesDir)) {
  copyDirSync(patchesDir, path.join(DEPLOY_DIR, 'patches'));
  console.log('  ✓ patches/');
}

// Copy drizzle config
if (fs.existsSync(path.join(ROOT, 'drizzle.config.ts'))) {
  // Create a JS version of drizzle config for production
  const drizzleConfigProd = `// Drizzle config for running migrations in production
import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required. Set it in .env file.");
}

export default defineConfig({
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
`;
  fs.writeFileSync(path.join(DEPLOY_DIR, 'drizzle.config.ts'), drizzleConfigProd);
  console.log('  ✓ drizzle.config.ts');
}

// Copy nssm.exe for Windows Service support
const nssmSources = [
  path.join(ROOT, '_deploy', 'nssm-2.24', 'win64', 'nssm.exe'),
  path.join(ROOT, '_deploy', 'nssm-2.24', 'win32', 'nssm.exe'),
  path.join(ROOT, 'nssm.exe'),
];
const nssmSource = nssmSources.find(p => fs.existsSync(p));
if (nssmSource) {
  fs.copyFileSync(nssmSource, path.join(DEPLOY_DIR, 'nssm.exe'));
  console.log('  ✓ nssm.exe (Windows Service Manager)');
} else {
  console.log('  ⚠ nssm.exe not found - download from https://nssm.cc/download and place in deploy folder');
}

// ═══════════════════════════════════════════════════════════════
// Step 8: Calculate sizes and report
// ═══════════════════════════════════════════════════════════════
console.log('\n[8/8] Calculating package size...');

const sizes = {};
for (const entry of fs.readdirSync(DEPLOY_DIR, { withFileTypes: true })) {
  const fullPath = path.join(DEPLOY_DIR, entry.name);
  if (entry.isDirectory()) {
    sizes[entry.name + '/'] = getDirSize(fullPath);
  } else {
    sizes[entry.name] = fs.statSync(fullPath).size;
  }
}

const totalSize = Object.values(sizes).reduce((a, b) => a + b, 0);

console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log('  BUILD COMPLETE ✓');
console.log('══════════════════════════════════════════════════════════════');
console.log(`  Output:  ${DEPLOY_DIR}`);
console.log(`  Version: ${VERSION}`);
console.log('');
console.log('  Package contents:');
const sortedEntries = Object.entries(sizes).sort((a, b) => b[1] - a[1]);
for (const [name, size] of sortedEntries) {
  console.log(`    ${formatSize(size).padStart(10)}  ${name}`);
}
console.log(`    ${'─'.repeat(10)}`);
console.log(`    ${formatSize(totalSize).padStart(10)}  TOTAL`);
console.log('');
console.log('  Next steps:');
console.log(`    1. Copy "${DEPLOY_NAME}" folder to USB/network share`);
console.log('    2. On target server:');
console.log('       - Install Node.js 20 LTS (or copy portable to ./node/)');
console.log('       - Install PostgreSQL and create database');
console.log('       - Copy .env.example → .env and configure');
console.log('       - Double-click migrate.bat (or run: node migrate.mjs)');
console.log('       - Run: start.bat');
console.log('');
if (totalSize > 500 * 1024 * 1024) {
  console.log('  TIP: Package is large. To reduce size:');
  console.log('    - Remove puppeteer if PDF export is not needed');
  console.log('    - Remove onnxruntime-node if AI features are not needed');
  console.log('');
}
console.log('══════════════════════════════════════════════════════════════');

// ═══════════════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════════════

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      // Resolve symlink and copy real file
      const realPath = fs.realpathSync(srcPath);
      if (fs.statSync(realPath).isDirectory()) {
        copyDirSync(realPath, destPath);
      } else {
        fs.copyFileSync(realPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getDirSize(dir) {
  let size = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          size += getDirSize(fullPath);
        } else if (entry.isFile()) {
          size += fs.statSync(fullPath).size;
        }
      } catch (e) { /* skip inaccessible */ }
    }
  } catch (e) { /* skip unreadable dirs */ }
  return size;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

async function resolveSymlinks(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const realPath = fs.realpathSync(fullPath);
      fs.rmSync(fullPath, { recursive: true, force: true });
      if (fs.statSync(realPath).isDirectory()) {
        copyDirSync(realPath, fullPath);
      } else {
        fs.copyFileSync(realPath, fullPath);
      }
    } else if (entry.isDirectory()) {
      await resolveSymlinks(fullPath);
    }
  }
}
