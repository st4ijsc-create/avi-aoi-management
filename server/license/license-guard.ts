/**
 * LicenseGuard - Automatic periodic license checking & enforcement
 * 
 * State machine:
 *   NORMAL    → License valid, >30 days until expiry
 *   WARNING   → License valid but expiring within 30 days
 *   READONLY  → License expired, system is read-only (no mutations)
 *   LOCKED    → 15 days past expiry, all blocked except license activation
 * 
 * Features:
 *   - Periodic check every CHECK_INTERVAL_MS (default: 1 hour)
 *   - Disk-based state cache for resilience across restarts when License Server is down
 *   - Never overwrites DB modules with empty data during offline fallback
 *   - Logs state transitions
 *   - Exposes current state for middleware & UI
 */

import * as db from '../db';
import { licenseService } from './license-service';
import type { LicenseStateCache } from './license-service';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type LicenseSystemState = 'normal' | 'warning' | 'readonly' | 'locked' | 'no_license';

export interface LicenseGuardStatus {
  /** Current enforcement state */
  state: LicenseSystemState;
  /** Human-readable message */
  message: string;
  /** Days until license expires (negative if expired) */
  daysUntilExpiry: number | null;
  /** Timestamp of the license expiry */
  expiresAt: number | null;
  /** License key being monitored */
  licenseKey: string | null;
  /** Customer name */
  customerName: string | null;
  /** License type */
  licenseType: string | null;
  /** Last check timestamp */
  lastCheckedAt: number;
  /** Days past expiry (only when expired) */
  daysPastExpiry: number | null;
  /** Whether the License Server is currently reachable */
  serverReachable: boolean;
  /** Timestamp of last successful online validation */
  lastSuccessfulOnlineCheck: number | null;
  /** Number of consecutive checks where server was unreachable */
  consecutiveOfflineChecks: number;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Check interval: 1 hour */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Warning threshold: 30 days before expiry */
const WARNING_DAYS = 30;

/** Lock threshold: 15 days after expiry */
const LOCK_DAYS_AFTER_EXPIRY = 15;

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

class LicenseGuard {
  private _status: LicenseGuardStatus = {
    state: 'no_license',
    message: 'Chưa kiểm tra license',
    daysUntilExpiry: null,
    expiresAt: null,
    licenseKey: null,
    customerName: null,
    licenseType: null,
    lastCheckedAt: 0,
    daysPastExpiry: null,
    serverReachable: false,
    lastSuccessfulOnlineCheck: null,
    consecutiveOfflineChecks: 0,
  };

  private _timer: ReturnType<typeof setInterval> | null = null;
  private _started = false;

  // ─── Getters ─────────────────────────────────────────────

  /** Get current system enforcement state */
  getStatus(): LicenseGuardStatus {
    return { ...this._status };
  }

  /** Get just the state string */
  getState(): LicenseSystemState {
    return this._status.state;
  }

  /** Check if system is in a state that allows mutations */
  isMutationAllowed(): boolean {
    return this._status.state === 'normal' || this._status.state === 'warning';
  }

  /** Check if system is fully locked (only license activation allowed) */
  isFullyLocked(): boolean {
    return this._status.state === 'locked';
  }

  /** Check if system is read-only (queries OK, mutations blocked) */
  isReadOnly(): boolean {
    return this._status.state === 'readonly';
  }

  // ─── Lifecycle ───────────────────────────────────────────

  /**
   * Start periodic license checking
   * Should be called after server startup & DB is ready
   * 
   * On startup, loads last-known-good state from disk cache
   * so the system doesn't start in 'no_license' state when
   * the License Server is temporarily unreachable.
   */
  async start(): Promise<void> {
    if (this._started) return;

    console.log('[LicenseGuard] Starting periodic license check...');
    this._started = true;

    // ── Load cached state from disk BEFORE first check ──
    // This ensures modules are available immediately on startup
    // even if the License Server is unreachable.
    const cachedState = licenseService.loadLicenseStateCache();
    if (cachedState) {
      const age = Date.now() - cachedState.cachedAt;
      const ageHours = Math.round(age / (1000 * 60 * 60));
      console.log(`[LicenseGuard] Restoring cached state: ${cachedState.state} (${cachedState.allowedModules.length} modules, cached ${ageHours}h ago)`);
      
      // Restore state from cache so middleware doesn't block during startup check
      this._status = {
        state: cachedState.state as LicenseSystemState,
        message: cachedState.message + ' (từ cache, đang kiểm tra...)',
        daysUntilExpiry: cachedState.expiresAt
          ? Math.floor((cachedState.expiresAt - Date.now()) / (1000 * 60 * 60 * 24))
          : null,
        expiresAt: cachedState.expiresAt,
        licenseKey: cachedState.licenseKey,
        customerName: cachedState.customerName,
        licenseType: cachedState.licenseType,
        lastCheckedAt: cachedState.cachedAt,
        daysPastExpiry: null,
        serverReachable: false,
        lastSuccessfulOnlineCheck: cachedState.lastSuccessfulOnlineCheck,
        consecutiveOfflineChecks: 0,
      };

      // Recalculate daysPastExpiry from cached expiresAt
      if (cachedState.expiresAt) {
        const days = Math.floor((cachedState.expiresAt - Date.now()) / (1000 * 60 * 60 * 24));
        if (days < 0) {
          this._status.daysPastExpiry = Math.abs(days);
        }
      }
    }

    // Run first check immediately
    await this.checkLicense();

    // Schedule periodic checks
    this._timer = setInterval(async () => {
      try {
        await this.checkLicense();
      } catch (err: any) {
        console.error('[LicenseGuard] Periodic check error:', err.message);
      }
    }, CHECK_INTERVAL_MS);

    console.log(`[LicenseGuard] Periodic check started (interval: ${CHECK_INTERVAL_MS / 1000 / 60} min)`);
  }

  /**
   * Stop periodic checking
   */
  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._started = false;
    console.log('[LicenseGuard] Stopped');
  }

  // ─── Core Check Logic ───────────────────────────────────

  /**
   * Check all active licenses and determine system state
   * Uses the license with the latest expiry date
   */
  async checkLicense(): Promise<LicenseGuardStatus> {
    try {
      // Get all licenses from local DB
      const { licenses } = await db.getAllLicenses({ status: 'active', limit: 100 });

      // Also check expired licenses (might be in grace period)
      const { licenses: expiredLicenses } = await db.getAllLicenses({ status: 'expired', limit: 100 });

      const allLicenses = [...licenses, ...expiredLicenses];

      if (allLicenses.length === 0) {
        // No licenses in DB — try offline fallback from saved license file
        if (licenseService.hasSDKClient()) {
          try {
            const offlineResult = await licenseService.validateSavedOfflineLicense();
            if (offlineResult && offlineResult.isValid) {
              console.log('[LicenseGuard] No DB licenses but saved offline license is valid');
              const offlineExpiry = offlineResult.expiresAt ? new Date(offlineResult.expiresAt) : null;
              const offlineDays = offlineExpiry
                ? Math.floor((offlineExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : null;
              
              let offlineState: LicenseSystemState = 'normal';
              let offlineMessage = 'License offline hoạt động bình thường.';
              
              if (offlineDays !== null) {
                if (offlineDays <= 0) {
                  offlineState = 'readonly';
                  offlineMessage = `🔒 License offline đã hết hạn. Hệ thống chỉ đọc.`;
                } else if (offlineDays <= WARNING_DAYS) {
                  offlineState = 'warning';
                  offlineMessage = `⚠️ License offline sắp hết hạn! Còn ${offlineDays} ngày.`;
                } else {
                  offlineMessage = `License offline hoạt động bình thường. Còn ${offlineDays} ngày.`;
                }
              }

              const newState: LicenseGuardStatus = {
                state: offlineState,
                message: offlineMessage,
                daysUntilExpiry: offlineDays,
                expiresAt: offlineExpiry?.getTime() || null,
                licenseKey: offlineResult.moduleCodes?.[0] || 'offline',
                customerName: offlineResult.customerName || 'Offline',
                licenseType: offlineResult.licenseType || 'offline',
                lastCheckedAt: Date.now(),
                daysPastExpiry: offlineDays !== null && offlineDays < 0 ? Math.abs(offlineDays) : null,
                serverReachable: false,
                lastSuccessfulOnlineCheck: this._status.lastSuccessfulOnlineCheck,
                consecutiveOfflineChecks: this._status.consecutiveOfflineChecks,
              };
              this._updateStatus(newState);
              return this._status;
            }
          } catch (err: any) {
            console.warn(`[LicenseGuard] Offline fallback check failed: ${err.message}`);
          }
        }

        // ── Disk cache fallback: if DB has no licenses but disk cache has a valid state ──
        const cachedState = licenseService.loadLicenseStateCache();
        if (cachedState && cachedState.state !== 'no_license' && cachedState.licenseKey) {
          console.log(`[LicenseGuard] No DB licenses but disk cache exists (state: ${cachedState.state}, ${cachedState.allowedModules.length} modules)`);
          const cachedExpiry = cachedState.expiresAt;
          const cachedDays = cachedExpiry
            ? Math.floor((cachedExpiry - Date.now()) / (1000 * 60 * 60 * 24))
            : null;

          // Only use cache if license is not expired beyond lock threshold
          if (cachedDays === null || cachedDays > -LOCK_DAYS_AFTER_EXPIRY) {
            let cacheState: LicenseSystemState = 'normal';
            let cacheMessage = cachedState.message + ' (từ cache)';
            if (cachedDays !== null) {
              if (cachedDays <= 0) {
                cacheState = 'readonly';
                cacheMessage = `🔒 License đã hết hạn (từ cache). Hệ thống chỉ đọc.`;
              } else if (cachedDays <= WARNING_DAYS) {
                cacheState = 'warning';
                cacheMessage = `⚠️ License sắp hết hạn (từ cache)! Còn ${cachedDays} ngày.`;
              }
            }

            const newState: LicenseGuardStatus = {
              state: cacheState,
              message: cacheMessage,
              daysUntilExpiry: cachedDays,
              expiresAt: cachedExpiry,
              licenseKey: cachedState.licenseKey,
              customerName: cachedState.customerName,
              licenseType: cachedState.licenseType,
              lastCheckedAt: Date.now(),
              daysPastExpiry: cachedDays !== null && cachedDays < 0 ? Math.abs(cachedDays) : null,
              serverReachable: false,
              lastSuccessfulOnlineCheck: cachedState.lastSuccessfulOnlineCheck,
              consecutiveOfflineChecks: this._status.consecutiveOfflineChecks + 1,
            };
            this._updateStatus(newState);
            return this._status;
          }
        }

        const newState: LicenseGuardStatus = {
          state: 'no_license',
          message: 'Chưa có license nào được kích hoạt. Vui lòng kích hoạt license.',
          daysUntilExpiry: null,
          expiresAt: null,
          licenseKey: null,
          customerName: null,
          licenseType: null,
          lastCheckedAt: Date.now(),
          daysPastExpiry: null,
          serverReachable: false,
          lastSuccessfulOnlineCheck: this._status.lastSuccessfulOnlineCheck,
          consecutiveOfflineChecks: this._status.consecutiveOfflineChecks,
        };
        this._updateStatus(newState);
        return this._status;
      }

      // Find the best license:
      //   1. Active with latest expiry (or lifetime = no expiry)
      //   2. If all expired, use the one with latest expiry
      let bestLicense: any = null;
      let bestExpiresAt: Date | null = null;

      for (const lic of allLicenses) {
        // Lifetime license (no expiry) → always best
        if (!lic.expiresAt && lic.status === 'active') {
          bestLicense = lic;
          bestExpiresAt = null;
          break;
        }

        const expiry = lic.expiresAt ? new Date(lic.expiresAt) : null;
        if (!bestLicense) {
          bestLicense = lic;
          bestExpiresAt = expiry;
        } else if (expiry && bestExpiresAt && expiry > bestExpiresAt) {
          bestLicense = lic;
          bestExpiresAt = expiry;
        } else if (expiry && !bestExpiresAt) {
          // Current best has no expiry but is not active → use this one
          if (bestLicense.status !== 'active') {
            bestLicense = lic;
            bestExpiresAt = expiry;
          }
        }
      }

      if (!bestLicense) {
        const newState: LicenseGuardStatus = {
          state: 'no_license',
          message: 'Không tìm thấy license hợp lệ.',
          daysUntilExpiry: null,
          expiresAt: null,
          licenseKey: null,
          customerName: null,
          licenseType: null,
          lastCheckedAt: Date.now(),
          daysPastExpiry: null,
          serverReachable: false,
          lastSuccessfulOnlineCheck: this._status.lastSuccessfulOnlineCheck,
          consecutiveOfflineChecks: this._status.consecutiveOfflineChecks,
        };
        this._updateStatus(newState);
        return this._status;
      }

      // Determine state based on expiry
      const now = new Date();
      const expiresAt = bestLicense.expiresAt ? new Date(bestLicense.expiresAt) : null;

      // ─── Online validation via SDK (non-blocking) ───
      // If SDK is available, validate against License Server to catch revocations.
      // When server is unreachable, continue using local DB data (graceful degradation).
      let serverReachable = this._status.serverReachable;
      let lastSuccessfulOnlineCheck = this._status.lastSuccessfulOnlineCheck;
      let consecutiveOfflineChecks = this._status.consecutiveOfflineChecks;

      if (licenseService.hasSDKClient()) {
        try {
          // Use a race timeout for online validation to prevent slow startup.
          // SDK default timeout is 30s, but we don't want to block startup that long.
          const ONLINE_CHECK_TIMEOUT_MS = 10_000; // 10s max for first check
          const onlineResult = await Promise.race([
            licenseService.validateOnline(bestLicense.licenseKey),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Online validation timeout')), ONLINE_CHECK_TIMEOUT_MS)
            ),
          ]);

          // ✅ Server reachable — update tracking
          serverReachable = true;
          lastSuccessfulOnlineCheck = Date.now();

          // Reset offline counter; if we were offline before, log recovery
          if (consecutiveOfflineChecks > 0) {
            console.log(`[LicenseGuard] ✅ License Server reconnected after ${consecutiveOfflineChecks} offline check(s). Syncing latest data.`);
          }
          consecutiveOfflineChecks = 0;

          if (!onlineResult.isValid) {
            console.warn(`[LicenseGuard] Server says license invalid: ${onlineResult.error}`);
            // If server says revoked/suspended → override local state
            if (onlineResult.status === 'revoked' || onlineResult.status === 'suspended') {
              const newState: LicenseGuardStatus = {
                state: 'locked',
                message: `🚫 License bị ${onlineResult.status === 'revoked' ? 'thu hồi' : 'tạm ngưng'} bởi License Server. Liên hệ quản trị viên.`,
                daysUntilExpiry: null,
                expiresAt: expiresAt?.getTime() || null,
                licenseKey: bestLicense.licenseKey,
                customerName: bestLicense.customerName,
                licenseType: bestLicense.licenseType,
                lastCheckedAt: Date.now(),
                daysPastExpiry: null,
                serverReachable,
                lastSuccessfulOnlineCheck,
                consecutiveOfflineChecks,
              };
              this._updateStatus(newState);
              return this._status;
            }
          } else {
            console.log(`[LicenseGuard] Online validation OK for ${bestLicense.licenseKey}`);
          }
        } catch (err: any) {
          // ❌ Network error or timeout — server unreachable
          serverReachable = false;
          consecutiveOfflineChecks++;

          const offlineMsg = lastSuccessfulOnlineCheck
            ? `last online: ${new Date(lastSuccessfulOnlineCheck).toLocaleString()}`
            : 'never validated online';
          console.warn(`[LicenseGuard] ⚠ License Server unreachable (attempt #${consecutiveOfflineChecks}, ${offlineMsg}): ${err.message}`);
          console.log(`[LicenseGuard] → Continuing with local license data (graceful degradation)`);

          // Attempt offline fallback: validate saved offline license file
          try {
            const offlineResult = await licenseService.validateSavedOfflineLicense();
            if (offlineResult && offlineResult.isValid) {
              console.log(`[LicenseGuard] Offline license file validation OK`);
              // ⚠️ CRITICAL: Only sync modules from offline result if they are NON-EMPTY.
              // Never overwrite DB modules with empty data — the DB already has
              // the authoritative module list from the last successful online activation.
              if (offlineResult.moduleCodes && offlineResult.moduleCodes.length > 0) {
                await db.updateLicenseByKey(bestLicense.licenseKey, {
                  allowedModules: offlineResult.moduleCodes,
                });
                console.log(`[LicenseGuard] Synced ${offlineResult.moduleCodes.length} modules from offline license`);
              } else {
                console.log(`[LicenseGuard] Offline result has no module data — keeping existing DB modules intact`);
              }
            } else if (offlineResult && !offlineResult.isValid) {
              console.warn(`[LicenseGuard] Offline license file validation failed: ${offlineResult.error}`);
            }
          } catch (offlineErr: any) {
            // Both online and offline validation failed — fall through to local DB expiry check
            console.warn(`[LicenseGuard] Offline fallback also failed: ${offlineErr.message}`);
            console.log(`[LicenseGuard] → Using local DB data for license state determination`);
          }
        }
      }

      // Lifetime license → always normal
      if (!expiresAt) {
        const newState: LicenseGuardStatus = {
          state: 'normal',
          message: serverReachable
            ? 'License vĩnh viễn - hoạt động bình thường.'
            : 'License vĩnh viễn - hoạt động bình thường. (License Server không khả dụng)',
          daysUntilExpiry: null,
          expiresAt: null,
          licenseKey: bestLicense.licenseKey,
          customerName: bestLicense.customerName,
          licenseType: bestLicense.licenseType,
          lastCheckedAt: Date.now(),
          daysPastExpiry: null,
          serverReachable,
          lastSuccessfulOnlineCheck,
          consecutiveOfflineChecks,
        };
        this._updateStatus(newState);
        return this._status;
      }

      const diffMs = expiresAt.getTime() - now.getTime();
      const daysUntilExpiry = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      let state: LicenseSystemState;
      let message: string;
      let daysPastExpiry: number | null = null;

      // Append server status hint to messages when server is unreachable
      const serverHint = !serverReachable && licenseService.hasSDKClient()
        ? ' (License Server không khả dụng — sử dụng license cục bộ)'
        : '';

      if (daysUntilExpiry > WARNING_DAYS) {
        // NORMAL: more than 30 days until expiry
        state = 'normal';
        message = `License hoạt động bình thường. Còn ${daysUntilExpiry} ngày.${serverHint}`;

        // Auto-recover DB status if it was incorrectly set to non-active
        if (bestLicense.status !== 'active') {
          console.log(`[LicenseGuard] DB status is "${bestLicense.status}" but license has ${daysUntilExpiry} days remaining — recovering to "active"`);
          await db.updateLicenseByKey(bestLicense.licenseKey, { status: 'active' });
        }
      } else if (daysUntilExpiry > 0) {
        // WARNING: expiring within 30 days
        state = 'warning';
        message = `⚠️ License sắp hết hạn! Còn ${daysUntilExpiry} ngày. Vui lòng gia hạn license.${serverHint}`;

        // Auto-recover DB status if it was incorrectly set to non-active
        if (bestLicense.status !== 'active') {
          console.log(`[LicenseGuard] DB status is "${bestLicense.status}" but license has ${daysUntilExpiry} days remaining — recovering to "active"`);
          await db.updateLicenseByKey(bestLicense.licenseKey, { status: 'active' });
        }
      } else if (daysUntilExpiry >= -LOCK_DAYS_AFTER_EXPIRY) {
        // READONLY: expired but within 15-day grace period
        state = 'readonly';
        daysPastExpiry = Math.abs(daysUntilExpiry);
        const daysLeft = LOCK_DAYS_AFTER_EXPIRY - daysPastExpiry;
        message = `🔒 License đã hết hạn ${daysPastExpiry} ngày trước. Hệ thống chỉ đọc. Còn ${daysLeft} ngày trước khi bị khóa hoàn toàn.`;
        
        // Update license status to expired in DB if still active
        if (bestLicense.status === 'active') {
          await db.updateLicenseByKey(bestLicense.licenseKey, { status: 'expired' });
        }
      } else {
        // LOCKED: more than 15 days past expiry
        state = 'locked';
        daysPastExpiry = Math.abs(daysUntilExpiry);
        message = `🚫 License đã hết hạn ${daysPastExpiry} ngày. Hệ thống bị khóa hoàn toàn. Chỉ có thể kích hoạt lại license.`;
        
        // Update license status to expired in DB if still active
        if (bestLicense.status === 'active') {
          await db.updateLicenseByKey(bestLicense.licenseKey, { status: 'expired' });
        }
      }

      const newState: LicenseGuardStatus = {
        state,
        message,
        daysUntilExpiry,
        expiresAt: expiresAt.getTime(),
        licenseKey: bestLicense.licenseKey,
        customerName: bestLicense.customerName,
        licenseType: bestLicense.licenseType,
        lastCheckedAt: Date.now(),
        daysPastExpiry,
        serverReachable,
        lastSuccessfulOnlineCheck,
        consecutiveOfflineChecks,
      };

      this._updateStatus(newState);
      return this._status;
    } catch (err: any) {
      console.error('[LicenseGuard] Check failed:', err.message);
      
      // On error (e.g., DB unreachable), try to restore from disk cache
      // instead of staying in 'no_license' state which blocks everything.
      if (this._status.state === 'no_license') {
        const cachedState = licenseService.loadLicenseStateCache();
        if (cachedState && cachedState.state !== 'no_license') {
          console.log(`[LicenseGuard] Restoring from disk cache after check failure (state: ${cachedState.state})`);
          this._status = {
            state: cachedState.state as LicenseSystemState,
            message: cachedState.message + ' (từ cache — DB không khả dụng)',
            daysUntilExpiry: cachedState.expiresAt
              ? Math.floor((cachedState.expiresAt - Date.now()) / (1000 * 60 * 60 * 24))
              : null,
            expiresAt: cachedState.expiresAt,
            licenseKey: cachedState.licenseKey,
            customerName: cachedState.customerName,
            licenseType: cachedState.licenseType,
            lastCheckedAt: Date.now(),
            daysPastExpiry: null,
            serverReachable: false,
            lastSuccessfulOnlineCheck: cachedState.lastSuccessfulOnlineCheck,
            consecutiveOfflineChecks: this._status.consecutiveOfflineChecks + 1,
          };
          // Recalculate daysPastExpiry
          if (cachedState.expiresAt) {
            const days = Math.floor((cachedState.expiresAt - Date.now()) / (1000 * 60 * 60 * 24));
            if (days < 0) this._status.daysPastExpiry = Math.abs(days);
          }
        }
      }
      
      this._status.lastCheckedAt = Date.now();
      return this._status;
    }
  }

  /**
   * Force re-check (e.g., after activation)
   */
  async forceCheck(): Promise<LicenseGuardStatus> {
    console.log('[LicenseGuard] Force re-check triggered');
    return this.checkLicense();
  }

  // ─── Private ─────────────────────────────────────────────

  private _updateStatus(newStatus: LicenseGuardStatus): void {
    const prevState = this._status.state;
    this._status = newStatus;

    // Log state transitions
    if (prevState !== newStatus.state) {
      console.log(`[LicenseGuard] State changed: ${prevState} → ${newStatus.state}`);
      console.log(`[LicenseGuard] ${newStatus.message}`);
    }

    // ── Persist state to disk for resilience across restarts ──
    // Only cache when we have meaningful license data (not no_license)
    if (newStatus.state !== 'no_license' && newStatus.licenseKey) {
      this._saveToDiskCache(newStatus);
    }
  }

  /**
   * Save current state + module list to disk cache.
   * This runs async-ish (fire-and-forget DB read for modules) to avoid
   * slowing down the state update.
   */
  private _saveToDiskCache(status: LicenseGuardStatus): void {
    // Read current modules from DB to include in cache
    if (status.licenseKey) {
      db.getLicenseByKey(status.licenseKey)
        .then((license) => {
          const cache: LicenseStateCache = {
            state: status.state,
            licenseKey: status.licenseKey,
            customerName: status.customerName,
            licenseType: status.licenseType,
            expiresAt: status.expiresAt,
            allowedModules: license?.allowedModules || [],
            cachedAt: Date.now(),
            lastSuccessfulOnlineCheck: status.lastSuccessfulOnlineCheck,
            message: status.message,
          };
          licenseService.saveLicenseStateCache(cache);
        })
        .catch((err) => {
          console.warn(`[LicenseGuard] Failed to read modules for disk cache: ${err.message}`);
        });
    }
  }
}

// Singleton instance
export const licenseGuard = new LicenseGuard();
