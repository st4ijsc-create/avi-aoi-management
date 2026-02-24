/**
 * Runtime Security Module
 * 
 * Provides runtime protection against code tampering:
 * 
 * 1. Verifies critical file integrity at startup
 * 2. Monitors license-related files for runtime modification  
 * 3. Prevents common bypass attempts
 * 4. Detects environment variable tampering
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════
// INTEGRITY VERIFICATION
// ═══════════════════════════════════════════════════════════════

interface FileWatch {
  path: string;
  hash: string;
  watcher?: fs.FSWatcher;
}

const watchedFiles: FileWatch[] = [];
let integrityCheckInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Calculate SHA-256 hash of a file
 */
function hashFile(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return '';
  }
}

/**
 * Initialize runtime security checks
 * Call this during server startup, after license system init
 */
export function initializeRuntimeSecurity(): void {
  // Only enable runtime security in production
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Security] Runtime security skipped (development mode)');
    return;
  }

  console.log('[Security] Initializing runtime security...');
  
  // ─── 1. Watch critical license files ───────────────────────
  const criticalFiles = [
    path.resolve(__dirname, 'license-guard.ts'),         // dev
    path.resolve(__dirname, 'license-middleware.ts'),     // dev
    path.resolve(__dirname, 'license-service.ts'),       // dev
    path.resolve(__dirname, '../_core/index.ts'),        // dev entry
    path.resolve(__dirname, 'sdk/index.cjs'),            // SDK
    path.resolve(__dirname, '../../dist/index.js'),      // prod bundle
    path.resolve(__dirname, '../../dist/index.cjs'),     // prod SDK
  ];

  for (const filePath of criticalFiles) {
    if (fs.existsSync(filePath)) {
      const hash = hashFile(filePath);
      const watch: FileWatch = { path: filePath, hash };
      
      // Set up filesystem watcher
      try {
        watch.watcher = fs.watch(filePath, (eventType) => {
          if (eventType === 'change') {
            const newHash = hashFile(filePath);
            if (newHash !== watch.hash) {
              console.error(`[SECURITY] Critical file modified at runtime: ${path.basename(filePath)}`);
              console.error('[SECURITY] License system integrity compromised. Shutting down...');
              
              // Graceful shutdown
              process.exit(78); // EX_CONFIG
            }
          }
        });
      } catch {
        // File watcher failed — not critical, periodic check will catch it
      }
      
      watchedFiles.push(watch);
    }
  }

  // ─── 2. Periodic integrity check (every 60s) ──────────────
  integrityCheckInterval = setInterval(() => {
    for (const watch of watchedFiles) {
      if (fs.existsSync(watch.path)) {
        const currentHash = hashFile(watch.path);
        if (currentHash !== watch.hash) {
          console.error(`[SECURITY] File integrity violation detected: ${path.basename(watch.path)}`);
          process.exit(78);
        }
      }
    }
  }, 60_000);

  // ─── 3. Protect against env tampering ───────────────────────
  // Snapshot license-related env values at startup
  // If changed at runtime, periodic check will detect it
  const envSnapshot: Record<string, string> = {};
  const protectedEnvKeys = [
    'LICENSE_SERVER_URL',
    'LICENSE_PRODUCT_CODE',
    'LICENSE_ENCRYPTION_SECRET',
  ];
  for (const key of protectedEnvKeys) {
    if (process.env[key]) {
      envSnapshot[key] = process.env[key]!;
    }
  }

  // Periodic env tamper detection
  setInterval(() => {
    for (const [key, originalValue] of Object.entries(envSnapshot)) {
      if (process.env[key] !== originalValue) {
        console.error(`[SECURITY] Environment variable ${key} was tampered with. Restoring...`);
        process.env[key] = originalValue;
      }
    }
  }, 30_000);

  // ─── 4. Anti-patching protection ──────────────────────────
  // Prevent overriding critical globals
  const originalExit = process.exit;
  const originalRequire = (globalThis as any).require;
  
  // Detect if someone tries to replace process.exit (common bypass)
  let exitCheckCount = 0;
  setInterval(() => {
    if (process.exit !== originalExit) {
      console.error('[SECURITY] process.exit has been tampered with');
      originalExit(78);
    }
    exitCheckCount++;
  }, 30_000);

  console.log(`[Security] Runtime security initialized. Watching ${watchedFiles.length} critical files.`);
}

/**
 * Cleanup security watchers (for graceful shutdown)  
 */
export function shutdownRuntimeSecurity(): void {
  if (integrityCheckInterval) {
    clearInterval(integrityCheckInterval);
  }
  for (const watch of watchedFiles) {
    watch.watcher?.close();
  }
}

/**
 * Verify license module integrity on-demand
 * Can be called from license-guard or middleware
 */
export function verifyLicenseIntegrity(): { ok: boolean; details?: string } {
  const sdkPath = path.resolve(__dirname, 'sdk/index.cjs');
  const distSdkPath = path.resolve(__dirname, '../../dist/index.cjs');
  
  // Check SDK file exists 
  const sdkExists = fs.existsSync(sdkPath) || fs.existsSync(distSdkPath);
  if (!sdkExists) {
    return { ok: false, details: 'SDK file missing' };
  }

  // Check watched files haven't been modified
  for (const watch of watchedFiles) {
    if (fs.existsSync(watch.path)) {
      const currentHash = hashFile(watch.path);
      if (currentHash !== watch.hash) {
        return { ok: false, details: `File modified: ${path.basename(watch.path)}` };
      }
    }
  }

  return { ok: true };
}
