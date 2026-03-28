# =============================================================================
# AVI-AOI Management — Offline Deployment Package Builder
# Usage: .\scripts\create-offline-deploy.ps1 [-OutputDir "C:\deploy\avi-aoi"]
# =============================================================================
param(
    [string]$OutputDir = "C:\deploy\avi-aoi-management",
    [switch]$SkipBuild,
    [switch]$SkipZip
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "=== AVI-AOI Offline Deployment Builder ===" -ForegroundColor Cyan
Write-Host "  Source : $ProjectRoot"
Write-Host "  Output : $OutputDir"
Write-Host ""

# --- Step 1: Build (unless skipped) ---
if (-not $SkipBuild) {
    Write-Host "[1/5] Building production bundle..." -ForegroundColor Yellow
    Push-Location $ProjectRoot
    $env:PUPPETEER_SKIP_DOWNLOAD = "true"
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw "pnpm build failed" }
    Pop-Location
    Write-Host "      Build complete." -ForegroundColor Green
} else {
    Write-Host "[1/5] Build skipped (--SkipBuild)." -ForegroundColor DarkYellow
}

# --- Step 2: Create clean output directory ---
Write-Host "[2/5] Creating deployment directory..." -ForegroundColor Yellow
if (Test-Path $OutputDir) {
    Remove-Item -Recurse -Force $OutputDir
}
New-Item -ItemType Directory -Path $OutputDir | Out-Null
New-Item -ItemType Directory -Path "$OutputDir\uploads" | Out-Null
New-Item -ItemType Directory -Path "$OutputDir\cache" | Out-Null

# --- Step 3: Install production-only node_modules ---
Write-Host "[3/5] Installing production dependencies..." -ForegroundColor Yellow
# Copy package.json and pnpm lockfile to output dir for install
$pkgJson = Get-Content "$ProjectRoot\package.json" | ConvertFrom-Json

# Write a minimal package.json for the deploy folder (prod deps only)
$deployPkg = [ordered]@{
    name            = $pkgJson.name
    version         = $pkgJson.version
    type            = $pkgJson.type
    scripts         = [ordered]@{
        start = "node dist/index.js"
        migrate = "node -e `"import('./dist/migrate.js')`""
    }
    dependencies    = $pkgJson.dependencies
    pnpm            = [ordered]@{
        onlyBuiltDependencies = @("core-js", "esbuild", "puppeteer", "sharp")
    }
}
$deployPkg | ConvertTo-Json -Depth 10 | Set-Content "$OutputDir\package.json"

# Copy lockfile and patches
Copy-Item "$ProjectRoot\pnpm-lock.yaml" "$OutputDir\pnpm-lock.yaml"
if (Test-Path "$ProjectRoot\patches") {
    Copy-Item -Recurse "$ProjectRoot\patches" "$OutputDir\patches"
}

# Write .npmrc with hoisted layout so node_modules are flat (no NTFS junctions)
# This is REQUIRED for ZIP packaging — Compress-Archive does not follow symlinks/junctions
@"
node-linker=hoisted
hoisting=true
"@ | Set-Content "$OutputDir\.npmrc"

Push-Location $OutputDir
$env:PUPPETEER_SKIP_DOWNLOAD = "true"
pnpm install --prod --frozen-lockfile 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Retrying without frozen-lockfile..." -ForegroundColor DarkYellow
    pnpm install --prod 2>&1
}
Pop-Location

# Rebuild native modules for this platform
# (sharp and esbuild require platform-specific binaries compiled after install)
Push-Location $OutputDir
pnpm rebuild sharp esbuild 2>&1
Pop-Location
Write-Host "      Dependencies installed." -ForegroundColor Green

# --- Step 4: Copy runtime files ---
Write-Host "[4/5] Copying runtime files..." -ForegroundColor Yellow

# Built server + client
Copy-Item -Recurse "$ProjectRoot\dist" "$OutputDir\dist"

# Database migrations
Copy-Item -Recurse "$ProjectRoot\drizzle" "$OutputDir\drizzle"

# License files
foreach ($f in @("license.lic", "license.lic.b64")) {
    if (Test-Path "$ProjectRoot\$f") {
        Copy-Item "$ProjectRoot\$f" "$OutputDir\$f"
    }
}

# Config templates
Copy-Item "$ProjectRoot\.env.example" "$OutputDir\.env.example"

# Start scripts
@"
@echo off
REM AVI-AOI Management Server — Windows Start Script
REM Copy .env.example to .env and configure before first run.
if not exist .env (
    echo ERROR: .env file not found. Copy .env.example to .env and configure it.
    pause
    exit /b 1
)
set NODE_ENV=production
node dist/index.js
"@ | Set-Content "$OutputDir\start.bat"

@"
#!/bin/bash
# AVI-AOI Management Server — Linux Start Script
# Copy .env.example to .env and configure before first run.
if [ ! -f .env ]; then
  echo "ERROR: .env file not found. Copy .env.example to .env and configure it."
  exit 1
fi
export NODE_ENV=production
node dist/index.js
"@ | Set-Content "$OutputDir\start.sh"

# Migration runner
@"
#!/usr/bin/env node
// Run this once on first deployment (or after upgrading) to apply DB migrations.
// Usage: node migrate.js
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set in .env');
  process.exit(1);
}

console.log('Running database migrations...');
// drizzle-kit is not included in production deps; use the SQL files directly via psql
// or run this from the development machine: pnpm db:push
console.log('Migration SQL files are located in ./drizzle/');
console.log('Apply them with: psql $DATABASE_URL -f drizzle/<migration>.sql');
"@ | Set-Content "$OutputDir\migrate.mjs"

# README
@"
# AVI-AOI Management — Offline Deployment

## Requirements
- Node.js >= 20.x (LTS)
- PostgreSQL >= 14

## First-time setup

1. Copy the environment template:
   ```
   cp .env.example .env
   ```

2. Edit `.env` and set at minimum:
   - `DATABASE_URL` — your PostgreSQL connection string
   - `JWT_SECRET` — a strong random secret (≥ 32 chars)
   - `MASTER_API_KEY` — key used by factory machines to connect

3. Run database migrations:
   Apply the SQL files in `./drizzle/` to your PostgreSQL database in numeric order.
   Example (Linux):
   ```
   for f in drizzle/*.sql; do psql "\$DATABASE_URL" -f "\$f"; done
   ```

4. Start the server:
   - Windows: `start.bat`
   - Linux/macOS: `bash start.sh`
   - Direct: `node dist/index.js`

   Server listens on port 3000 by default (change with `PORT=` in .env).

## Storage Modes
- `STORAGE_MODE=local` — images stored in `./uploads/` on this server
- `STORAGE_MODE=forge` — images stored via external Forge API

## Optional Services
- **MQTT**: Set `MQTT_ENABLED=true` to enable real-time machine pub/sub
- **Redis**: Set `REDIS_URL` to enable session caching
- **Email**: Configure `SMTP_*` variables for alert emails
- **AI features**: Set `OPENAI_API_KEY` to enable AI chat and analysis
- **HTTPS**: Set `HTTPS_ENABLED=true` with cert paths, or use a reverse proxy (nginx/caddy recommended)

## Updating
To update, replace the `dist/` folder with a new build, then restart the server.
Run any new migration SQL files from `./drizzle/` before restarting.
"@ | Set-Content "$OutputDir\README.md"

Write-Host "      Runtime files copied." -ForegroundColor Green

# --- Step 5: Create ZIP archive ---
if (-not $SkipZip) {
    Write-Host "[5/5] Creating ZIP archive..." -ForegroundColor Yellow
    $version = $pkgJson.version
    $timestamp = Get-Date -Format "yyyyMMdd_HHmm"
    $zipPath = "C:\deploy\avi-aoi-management-${version}-${timestamp}.zip"
    
    if (-not (Test-Path "C:\deploy")) { New-Item -ItemType Directory "C:\deploy" | Out-Null }
    
    Compress-Archive -Path "$OutputDir\*" -DestinationPath $zipPath -Force
    $zipSizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
    Write-Host "      ZIP: $zipPath ($zipSizeMB MB)" -ForegroundColor Green
} else {
    Write-Host "[5/5] ZIP skipped (--SkipZip)." -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "=== Deployment package ready ===" -ForegroundColor Cyan
Write-Host "  Folder : $OutputDir"
if (-not $SkipZip) { Write-Host "  ZIP    : $zipPath" }
Write-Host ""
Write-Host "Transfer the ZIP to the target server and extract it." -ForegroundColor White
Write-Host "Then follow the instructions in README.md." -ForegroundColor White
