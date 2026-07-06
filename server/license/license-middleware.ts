/**
 * License Middleware
 * 
 * Provides Express middleware for license verification on startup,
 * per-request license checking, and license enforcement.
 * 
 * Usage:
 *   1. Call initializeLicenseSystem() at server startup
 *   2. Use licenseEnforcementMiddleware() before tRPC mount to enforce states
 *   3. Optionally use requireLicense() middleware for protected routes
 * 
 * Enforcement states:
 *   - normal/warning: all operations allowed
 *   - readonly: only queries + license endpoints allowed (mutations blocked)
 *   - locked: everything blocked except license activation endpoints
 *   - no_license: same as locked
 */

import { licenseService } from './license-service';
import { licenseGuard } from './license-guard';
import { decideLicenseBatch, type LicenseState } from './licensePolicy'; // doc 33 F4 (SYNAPSE §4.3): never-stop-production
import { ENV } from '../_core/env';
import type { Request, Response, NextFunction } from 'express';

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let licenseInitialized = false;
let licenseInitError: string | null = null;

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Initialize license system at server startup
 * - Generates/loads RSA key pair
 * - Starts LicenseGuard periodic checks
 * - Should be called before tRPC routes are mounted
 */
export async function initializeLicenseSystem(): Promise<void> {
  if (ENV.licenseBypass) {
    console.log('[License] LICENSE_BYPASS=true — skipping license system initialization');
    licenseInitialized = true;
    return;
  }
  try {
    console.log('[License] Initializing license system...');
    await licenseService.initializeKeys();
    licenseInitialized = true;
    console.log('[License] License system initialized successfully');

    // Start license guard periodic monitoring
    await licenseGuard.start();
  } catch (error: any) {
    licenseInitError = error.message;
    console.error('[License] Failed to initialize license system:', error.message);
    // Don't throw - license system failure should not prevent server startup
    // The admin can fix the issue and restart
  }
}

// ═══════════════════════════════════════════════════════════════
// ENFORCEMENT MIDDLEWARE
// ═══════════════════════════════════════════════════════════════

/**
 * tRPC procedure paths that are ALWAYS allowed regardless of license state.
 * These allow users to authenticate, check state, and activate licenses.
 */
const ALWAYS_ALLOWED_PROCEDURES = new Set([
  // License operations
  'license.activate',
  'license.serverStatus',
  'license.systemState',
  'license.forceCheck',
  'license.validate',
  'license.getPublicKey',
  'license.sync',
  'license.getCRL',
  'license.getAllowedModules',   // Must always be queryable so UI shows correct modules
  'license.checkRouteAccess',   // Must always be queryable for route gating
  'license.generateOfflineRequest',
  'license.applyOfflineLicense',
  // License admin (needed to manage licenses even when locked/expired)
  'license.admin.list',
  'license.admin.getById',
  'license.admin.activations',
  'license.admin.syncLogs',
  'license.admin.stats',
  // Auth operations
  'auth.me',
  'auth.login',
  'auth.logout',
  'auth.checkSetupRequired',
  'auth.oauthProviders',
  'auth.setupAdmin',
  // 2FA
  'twoFactor.verify',
  'twoFactor.getStatus',
  // System
  'system.health',
]);

/**
 * Procedures allowed in READONLY mode (queries from any router + always-allowed)
 * In readonly mode, GET requests (queries) are allowed, POST mutations are blocked
 * unless the procedure is in the always-allowed list.
 */

/**
 * Express middleware for license enforcement on tRPC endpoints.
 * 
 * Must be mounted BEFORE the tRPC middleware:
 *   app.use('/api/trpc', licenseEnforcementMiddleware());
 *   app.use('/api/trpc', createExpressMiddleware({...}));
 * 
 * Behavior:
 *   - normal/warning: pass through
 *   - readonly: block POST mutations (except always-allowed)
 *   - locked/no_license: block everything except always-allowed procedures
 */
export function licenseEnforcementMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (ENV.licenseBypass) return next();
    const state = licenseGuard.getState() as LicenseState;

    // Normal and warning states: allow everything
    if (state === 'normal' || state === 'warning') {
      return next();
    }

    // Extract procedure name(s) from tRPC URL (batch = comma-separated).
    const procedures = req.path.replace(/^\//, '').split(',').filter(Boolean);
    const method = req.method.toUpperCase();

    // doc 33 F4 (SYNAPSE §4.3 "không bao giờ dừng sản xuất vì license"):
    // production-critical procedures (inspection/session/andon/safety/telemetry/alerts)
    // ALWAYS pass; `locked` degrades to read-only for non-critical config when
    // never-stop-production is on (default). License STATUS stays honest; only enforcement
    // changes so the line never halts.
    const decision = decideLicenseBatch({
      procedures,
      method,
      state,
      alwaysAllowed: (proc) => ALWAYS_ALLOWED_PROCEDURES.has(proc),
    });
    if (decision.allow) return next();

    const status = licenseGuard.getStatus();
    const messages: Record<string, string> = {
      LICENSE_READONLY:
        'License hết hạn: thao tác sản xuất/kiểm tra/an toàn vẫn chạy — chỉ khoá cấu hình & tính năng cao cấp. Vui lòng gia hạn.',
      LICENSE_LOCKED: `Cấu hình bị khoá do license hết hạn quá ${status.daysPastExpiry ?? '?'} ngày (sản xuất-cốt-lõi vẫn hoạt động). Vui lòng gia hạn.`,
      NO_LICENSE:
        'Hệ thống chưa có license — vui lòng kích hoạt để dùng đầy đủ (thao tác sản xuất-cốt-lõi vẫn hoạt động).',
    };
    const code = decision.code ?? 'LICENSE_LOCKED';
    res.status(403).json({
      error: {
        message: messages[code] ?? messages.LICENSE_LOCKED,
        code,
        data: {
          state: status.state,
          message: status.message,
          daysUntilExpiry: status.daysUntilExpiry,
          daysPastExpiry: status.daysPastExpiry,
        },
      },
    });
    return;
  };
}

// ═══════════════════════════════════════════════════════════════
// EXISTING MIDDLEWARE
// ═══════════════════════════════════════════════════════════════

/**
 * Express middleware to check license system health
 * Returns 503 if license system failed to initialize
 * 
 * Use on license-specific API routes to ensure keys are loaded
 */
export function requireLicenseSystem() {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!licenseInitialized) {
      res.status(503).json({
        error: 'License system not initialized',
        details: licenseInitError || 'Unknown error',
      });
      return;
    }
    next();
  };
}

/**
 * Get license system status
 */
export function getLicenseSystemStatus() {
  return {
    initialized: licenseInitialized,
    error: licenseInitError,
  };
}
