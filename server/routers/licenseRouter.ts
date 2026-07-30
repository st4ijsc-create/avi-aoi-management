/**
 * License Management tRPC Router
 * 
 * Hệ thống này là LICENSE CLIENT - chỉ quản lý license đã được
 * License Server (LICENSE_SERVER_URL) cấp phát và kích hoạt.
 * Không có chức năng tạo license hay tạo module.
 * 
 * Public endpoints:
 *   - activate: Kích hoạt license key từ License Server
 *   - validate: Xác thực license online
 *   - generateOfflineRequest: Tạo yêu cầu kích hoạt offline (Step 1)
 *   - applyOfflineLicense: Áp dụng gói license offline (Step 3)
 *   - getPublicKey: Tải RSA public key cho offline verification
 *   - sync: Client heartbeat & đồng bộ
 *   - getCRL: Lấy danh sách thu hồi
 *   - status: Trạng thái license hiện tại
 * 
 * Protected endpoints:
 *   - downloadLicenseFile: Tải file .lic offline
 *   - getAllowedModules: Lấy danh sách module được phép
 *   - checkRouteAccess: Kiểm tra quyền truy cập route
 * 
 * Admin endpoints (read-only):
 *   - admin.list: Xem danh sách license đã kích hoạt
 *   - admin.getById: Xem chi tiết license
 *   - admin.activations: Xem thiết bị đã kích hoạt
 *   - admin.syncLogs: Xem lịch sử đồng bộ
 *   - admin.stats: Thống kê tổng quan
 * 
 * Module endpoints:
 *   - modules.systemModules: Xem danh sách module từ registry
 *   - modules.exportModules: Export module/feature để gửi đến License Server
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import * as db from "../db";
import { licenseService } from "../license/license-service";
import { licenseGuard } from "../license/license-guard";
import { getDefaultProductCode } from "../license/productCode";
import { SYSTEM_MODULES, toExportFormat, isRouteAllowed, CORE_MODULE_CODES, ALL_MODULE_CODES } from "@shared/module-registry";
import { resolveEditionModules } from "@shared/editions"; // doc 33 I3 (F1): edition module-ceiling
import { resolveDeploymentProfile } from "../_core/deploymentProfile";
import { ENV } from "../_core/env";

// ═══════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS
// ═══════════════════════════════════════════════════════════════

const publicLicenseRouter = router({
  /**
   * Activate a license key online via License Server, fallback to local DB
   * Flow: License Server API → store locally → return result
   */
  // Doc 38 Đợt Q — was publicProcedure (NO auth): anyone could push a license key onto
  // the deployment. Now admin-only (+2FA). RSA signature verification inside
  // licenseService is unchanged. NOTE (bootstrap): CORE_ADMIN pages stay reachable in
  // the no_license state, so an admin can always log in and activate; if a headless
  // first-boot provisioning flow needs an unauthenticated path, add a separate
  // rate-limited + audited bootstrap route instead of reopening this one.
  activate: adminProcedure
    .input(z.object({
      licenseKey: z.string().min(1),
      productCode: z.string().min(1),
      hardwareFingerprint: z.string().optional(),
      machineName: z.string().optional(),
      clientVersion: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const ipAddress = ctx.req?.ip || ctx.req?.socket?.remoteAddress || 'unknown';
      const result = await licenseService.activate({
        ...input,
        ipAddress,
      });
      if (!result.success) {
        throw appError('BAD_REQUEST', 'OPERATION_FAILED', { operation: 'activateLicense' }, result.error);
      }
      // Force re-check license state after successful activation
      await licenseGuard.forceCheck();
      return result;
    }),

  /**
   * Check License Server connection status
   */
  serverStatus: publicProcedure.query(() => {
    const serverUrl = ENV.licenseServerUrl;
    return {
      configured: !!serverUrl,
      serverUrl: serverUrl || null,
    };
  }),

  /**
   * Get current license enforcement state
   * Returns: state (normal/warning/readonly/locked/no_license), message, expiry info
   * Used by UI to show warning banners and enforce read-only/locked mode
   */
  systemState: publicProcedure.query(() => {
    if (ENV.licenseBypass) {
      return {
        state: 'normal' as const,
        message: 'License bypass enabled (offline deployment)',
        daysUntilExpiry: null,
        expiresAt: null,
        licenseKey: 'bypass',
        customerName: 'Offline Deployment',
        licenseType: 'bypass',
        lastCheckedAt: Date.now(),
        daysPastExpiry: null,
        serverReachable: false,
        lastSuccessfulOnlineCheck: null,
        consecutiveOfflineChecks: 0,
      };
    }
    return licenseGuard.getStatus();
  }),

  /**
   * Force re-check license state (admin only)
   */
  forceCheck: adminProcedure.mutation(async () => {
    const status = await licenseGuard.forceCheck();
    return status;
  }),

  /**
   * Validate a license online
   */
  validate: publicProcedure
    .input(z.object({
      licenseKey: z.string().min(1),
      productCode: z.string().min(1),
      hardwareFingerprint: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return licenseService.validate(input);
    }),

  /**
   * Get RSA public key for offline verification
   */
  getPublicKey: publicProcedure.query(() => {
    return { publicKey: licenseService.getPublicKey() };
  }),

  /**
   * Sync operation - heartbeat, CRL refresh, license update
   */
  sync: publicProcedure
    .input(z.object({
      licenseKey: z.string().min(1),
      productCode: z.string().min(1),
      hardwareFingerprint: z.string().optional(),
      clientVersion: z.string().optional(),
      lastSyncAt: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const ipAddress = ctx.req?.ip || ctx.req?.socket?.remoteAddress || 'unknown';
      return licenseService.sync({ ...input, ipAddress });
    }),

  /**
   * Get Certificate Revocation List
   */
  getCRL: publicProcedure.query(async () => {
    return licenseService.getCRL();
  }),

  /**
   * Download offline license file (authenticated)
   */
  downloadLicenseFile: protectedProcedure
    .input(z.object({
      licenseKey: z.string().min(1),
      hardwareFingerprint: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const fileBase64 = await licenseService.downloadLicenseFile(input.licenseKey, input.hardwareFingerprint);
        return { success: true, fileBase64 };
      } catch (error: any) {
        throw appError('BAD_REQUEST', 'OPERATION_FAILED', { operation: 'downloadLicenseFile' }, error.message);
      }
    }),

  /**
   * Get allowed modules for the current active license
   * Returns list of module codes the user can access.
   *
   * Uses LicenseGuard's live state as the primary authority:
   *   - normal / warning / readonly → return all licensed modules
   *   - locked / no_license        → return core modules only
   *
   * Aggregates modules from ALL active licenses in DB (not just the
   * specified key) so that modules are always visible regardless of
   * which license key the client stored in localStorage.
   *
   * Falls back to disk cache when DB `allowedModules` is empty
   * (e.g. wiped by a past bug or server-down scenario).
   */
  getAllowedModules: protectedProcedure
    .input(z.object({
      licenseKey: z.string().min(1),
    }))
    .query(async ({ input }) => {
      // doc 33 I3 (F1 · ADR-007): bound the licensed modules by the deployment EDITION's ceiling
      // (a Machine edition never shows Site-only modules). Gated by EDITION_PROFILE (default OFF →
      // pass-through, fully backward-compatible). Core modules always survive.
      const profile = resolveDeploymentProfile();
      const applyEditionCeiling = (mods: string[]): string[] =>
        profile.profileEnforced ? resolveEditionModules(profile.edition, mods) : mods;

      // ── LICENSE_BYPASS: return all modules ──
      if (ENV.licenseBypass) {
        return {
          modules: applyEditionCeiling([...ALL_MODULE_CODES]),
          isLicensed: true,
          licenseStatus: 'normal',
          expiresAt: null,
          licenseType: 'bypass',
          customerName: 'Offline Deployment',
        };
      }

      // ── Use LicenseGuard state as primary authority ──
      const guardStatus = licenseGuard.getStatus();
      const guardState = guardStatus.state; // normal | warning | readonly | locked | no_license

      // States that should still show all licensed modules
      const modulesAllowedStates: string[] = ['normal', 'warning', 'readonly'];
      const isGuardAllowing = modulesAllowedStates.includes(guardState);

      // If guard says modules should be blocked → core only
      if (!isGuardAllowing) {
        return { 
          modules: CORE_MODULE_CODES, 
          isLicensed: false,
          licenseStatus: guardState,
        };
      }

      // ── Guard allows modules — aggregate from ALL active licenses ──
      // This makes the system resilient regardless of which key the
      // client has in localStorage.
      const { licenses: activeLicenses } = await db.getAllLicenses({ status: 'active', limit: 100 });
      const { licenses: expiredLicenses } = await db.getAllLicenses({ status: 'expired', limit: 100 });
      const allLicenses = [...activeLicenses, ...expiredLicenses];

      // Gather modules from all licenses
      let aggregatedModules: string[] = [];
      let bestLicense: typeof allLicenses[0] | null = null;

      for (const lic of allLicenses) {
        const mods = (lic.allowedModules as string[] | null) || [];
        if (mods.length > 0) {
          aggregatedModules.push(...mods);
        }
        // Track the best license (prefer the one matching the input key, else latest expiry)
        if (!bestLicense) {
          bestLicense = lic;
        } else if (lic.licenseKey === input.licenseKey) {
          bestLicense = lic;
        }
      }

      // Deduplicate aggregated modules
      aggregatedModules = [...new Set(aggregatedModules)];

      // If no modules found from any license, try disk cache
      if (aggregatedModules.length === 0) {
        const cached = licenseService.loadLicenseStateCache();
        if (cached && cached.allowedModules && cached.allowedModules.length > 0) {
          aggregatedModules = cached.allowedModules;
          console.log(`[getAllowedModules] No modules in any DB license — using ${aggregatedModules.length} modules from disk cache`);
        }
      }

      // Merge core + aggregated modules, then bound by the edition ceiling (I3).
      const uniqueModules = applyEditionCeiling([...new Set([...CORE_MODULE_CODES, ...aggregatedModules])]);

      // Use the best license (or guard status) for metadata
      const refLicense = bestLicense || null;

      return {
        modules: uniqueModules,
        isLicensed: aggregatedModules.length > 0,
        licenseStatus: refLicense?.status ?? guardState,
        expiresAt: refLicense?.expiresAt ? new Date(refLicense.expiresAt).getTime() : (guardStatus.expiresAt ?? null),
        licenseType: refLicense?.licenseType ?? guardStatus.licenseType,
        customerName: refLicense?.customerName ?? guardStatus.customerName,
      };
    }),

  /**
   * Check if a specific route is allowed for the current license.
   * Aggregates modules from ALL active licenses (same as getAllowedModules).
   */
  checkRouteAccess: protectedProcedure
    .input(z.object({
      licenseKey: z.string().min(1),
      routePath: z.string().min(1),
    }))
    .query(async ({ input }) => {
      // ── LICENSE_BYPASS: all routes allowed ──
      if (ENV.licenseBypass) {
        return { allowed: true };
      }

      // Use LicenseGuard state as primary authority
      const guardState = licenseGuard.getStatus().state;
      const isGuardAllowing = ['normal', 'warning', 'readonly'].includes(guardState);

      if (!isGuardAllowing) {
        return { allowed: isRouteAllowed(input.routePath, [...CORE_MODULE_CODES]) };
      }

      // Aggregate modules from all active/expired licenses
      const { licenses: activeLicenses } = await db.getAllLicenses({ status: 'active', limit: 100 });
      const { licenses: expiredLicenses } = await db.getAllLicenses({ status: 'expired', limit: 100 });
      let aggregatedModules: string[] = [];
      for (const lic of [...activeLicenses, ...expiredLicenses]) {
        const mods = (lic.allowedModules as string[] | null) || [];
        aggregatedModules.push(...mods);
      }
      aggregatedModules = [...new Set(aggregatedModules)];

      // Fallback to disk cache
      if (aggregatedModules.length === 0) {
        const cached = licenseService.loadLicenseStateCache();
        if (cached && cached.allowedModules && cached.allowedModules.length > 0) {
          aggregatedModules = cached.allowedModules;
        }
      }

      const allModules = [...new Set([...CORE_MODULE_CODES, ...aggregatedModules])];
      return { allowed: isRouteAllowed(input.routePath, allModules) };
    }),

  // ─── SDK Endpoints ─────────────────────────────────────────

  /**
   * Validate license online via SDK (checks against License Server)
   */
  validateOnline: protectedProcedure
    .input(z.object({ licenseKey: z.string().min(1) }))
    .mutation(async ({ input }) => {
      if (!licenseService.hasSDKClient()) {
        throw appError('PRECONDITION_FAILED', 'FEATURE_DISABLED', { feature: 'licenseServerSdk' }, 'License Server chưa được cấu hình');
      }
      return licenseService.validateOnline(input.licenseKey);
    }),

  /**
   * Validate license offline (from base64 offline license)
   */
  validateOffline: protectedProcedure
    .input(z.object({ offlineLicenseBase64: z.string().min(1) }))
    .mutation(async ({ input }) => {
      if (!licenseService.hasSDKClient()) {
        throw appError('PRECONDITION_FAILED', 'FEATURE_DISABLED', { feature: 'licenseServerSdk' }, 'License Server chưa được cấu hình');
      }
      return licenseService.validateOffline(input.offlineLicenseBase64);
    }),

  /**
   * Step 1: Generate offline activation request
   * Returns base64-encoded JSON with { licenseKey, hardwareFingerprint, productCode, timestamp }
   * Admin sends this data to License Server → offlineActivation.generatePackage
   */
  // Doc 38 Đợt Q — admin-only (was public). Emits a hardware-bound activation request.
  generateOfflineRequest: adminProcedure
    .input(z.object({
      licenseKey: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      try {
        return await licenseService.generateOfflineActivationRequest(input.licenseKey);
      } catch (err: any) {
        throw appError(
          'INTERNAL_SERVER_ERROR',
          'OPERATION_FAILED',
          { operation: 'generateOfflineActivationRequest' },
          `Lỗi tạo yêu cầu kích hoạt offline: ${err.message}`,
        );
      }
    }),

  /**
   * Step 3: Apply offline license package
   * Validates the signed package from License Server, stores in DB, saves to disk
   */
  // Doc 38 Đợt Q — admin-only (was public). The signed package is still verified
  // against the RSA public key inside licenseService before it is applied.
  applyOfflineLicense: adminProcedure
    .input(z.object({
      offlinePackageBase64: z.string().min(1),
      licenseKey: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      if (!licenseService.hasSDKClient()) {
        throw appError('PRECONDITION_FAILED', 'FEATURE_DISABLED', { feature: 'licenseServerSdk' }, 'License Server chưa được cấu hình');
      }
      const result = await licenseService.applyOfflineLicense(
        input.offlinePackageBase64,
        input.licenseKey,
      );
      if (!result.success) {
        throw appError('BAD_REQUEST', 'OPERATION_FAILED', { operation: 'applyOfflineLicense' }, result.error || 'Áp dụng license offline thất bại');
      }
      // Force re-check license state after successful offline activation
      await licenseGuard.forceCheck();
      return result;
    }),

  /**
   * Get hardware fingerprint of this machine (via SDK)
   */
  hardwareFingerprint: protectedProcedure.query(async () => {
    try {
      return await licenseService.getHardwareFingerprintDetailed();
    } catch (err: any) {
      throw appError('INTERNAL_SERVER_ERROR', 'OPERATION_FAILED', { operation: 'getHardwareFingerprint' }, `Hardware fingerprint failed: ${err.message}`);
    }
  }),

  /**
   * Get allowed modules from License Server (online check)
   */
  getAllowedModulesFromServer: protectedProcedure
    .input(z.object({ licenseKey: z.string().min(1) }))
    .query(async ({ input }) => {
      if (!licenseService.hasSDKClient()) {
        throw appError('PRECONDITION_FAILED', 'FEATURE_DISABLED', { feature: 'licenseServerSdk' }, 'License Server chưa được cấu hình');
      }
      return licenseService.getAllowedModulesFromServer(input.licenseKey);
    }),

  /**
   * Check if a specific module is allowed (online)
   */
  isModuleAllowed: protectedProcedure
    .input(z.object({
      licenseKey: z.string().min(1),
      moduleCode: z.string().min(1),
    }))
    .query(async ({ input }) => {
      if (!licenseService.hasSDKClient()) {
        throw appError('PRECONDITION_FAILED', 'FEATURE_DISABLED', { feature: 'licenseServerSdk' }, 'License Server chưa được cấu hình');
      }
      return licenseService.isModuleAllowedOnServer(input.licenseKey, input.moduleCode);
    }),

  /**
   * Sync modules with License Server
   * SDK expects Array<{ code, version? }> per its API
   */
  syncModules: protectedProcedure
    .input(z.object({
      licenseKey: z.string().min(1),
      clientModules: z.array(z.object({
        code: z.string().min(1),
        version: z.string().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      if (!licenseService.hasSDKClient()) {
        throw appError('PRECONDITION_FAILED', 'FEATURE_DISABLED', { feature: 'licenseServerSdk' }, 'License Server chưa được cấu hình');
      }
      return licenseService.syncModulesWithServer(input.licenseKey, input.clientModules);
    }),

  /**
   * Get all available product modules from License Server
   */
  productModules: protectedProcedure.query(async () => {
    if (!licenseService.hasSDKClient()) {
      throw appError('PRECONDITION_FAILED', 'FEATURE_DISABLED', { feature: 'licenseServerSdk' }, 'License Server chưa được cấu hình');
    }
    return licenseService.getProductModulesFromServer();
  }),

  /**
   * Checkout a floating license seat
   */
  floatingCheckout: protectedProcedure
    .input(z.object({ licenseKey: z.string().min(1) }))
    .mutation(async ({ input }) => {
      if (!licenseService.hasSDKClient()) {
        throw appError('PRECONDITION_FAILED', 'FEATURE_DISABLED', { feature: 'licenseServerSdk' }, 'License Server chưa được cấu hình');
      }
      return licenseService.checkoutFloatingLicense(input.licenseKey);
    }),

  /**
   * Checkin (release) a floating license seat
   */
  floatingCheckin: protectedProcedure
    .input(z.object({
      licenseKey: z.string().min(1),
      sessionId: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      if (!licenseService.hasSDKClient()) {
        throw appError('PRECONDITION_FAILED', 'FEATURE_DISABLED', { feature: 'licenseServerSdk' }, 'License Server chưa được cấu hình');
      }
      return licenseService.checkinFloatingLicense(input.licenseKey, input.sessionId);
    }),

  /**
   * Send heartbeat for floating license session
   */
  floatingHeartbeat: protectedProcedure
    .input(z.object({
      licenseKey: z.string().min(1),
      sessionId: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      if (!licenseService.hasSDKClient()) {
        throw appError('PRECONDITION_FAILED', 'FEATURE_DISABLED', { feature: 'licenseServerSdk' }, 'License Server chưa được cấu hình');
      }
      return licenseService.sendFloatingHeartbeat(input.licenseKey, input.sessionId);
    }),

  /**
   * Get floating license status (available seats)
   */
  floatingStatus: protectedProcedure
    .input(z.object({ licenseKey: z.string().min(1) }))
    .query(async ({ input }) => {
      if (!licenseService.hasSDKClient()) {
        throw appError('PRECONDITION_FAILED', 'FEATURE_DISABLED', { feature: 'licenseServerSdk' }, 'License Server chưa được cấu hình');
      }
      return licenseService.getFloatingStatus(input.licenseKey);
    }),

  /**
   * Check grace period status
   */
  gracePeriod: protectedProcedure
    .input(z.object({ licenseKey: z.string().min(1) }))
    .query(async ({ input }) => {
      if (!licenseService.hasSDKClient()) {
        throw appError('PRECONDITION_FAILED', 'FEATURE_DISABLED', { feature: 'licenseServerSdk' }, 'License Server chưa được cấu hình');
      }
      return licenseService.checkGracePeriod(input.licenseKey);
    }),
});

// ═══════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS (read-only – quản lý license do License Server cấp)
// ═══════════════════════════════════════════════════════════════

const adminLicenseRouter = router({
  /**
   * List all licenses (read-only view)
   */
  list: adminProcedure
    .input(z.object({
      status: z.enum(['active', 'expired', 'revoked', 'suspended', 'pending']).optional(),
      search: z.string().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      const data = await db.getAllLicenses({
        status: input?.status,
        limit: input?.limit || 200,
        offset: input?.offset,
      });

      let result = data.licenses;

      // Filter by search term (key, customer, email)
      if (input?.search) {
        const search = input.search.toLowerCase();
        result = result.filter(l =>
          l.licenseKey.toLowerCase().includes(search) ||
          l.customerName.toLowerCase().includes(search) ||
          (l.customerEmail && l.customerEmail.toLowerCase().includes(search)) ||
          (l.companyName && l.companyName.toLowerCase().includes(search))
        );
      }

      const total = result.length;
      const offset = input?.offset || 0;
      const limit = input?.limit || 50;
      const sliced = result.slice(offset, offset + limit);

      return { licenses: sliced, total };
    }),

  /**
   * Get license by ID (read-only)
   */
  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const license = await db.getLicenseById(input.id);
      if (!license) throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'license' }, 'License không tồn tại');
      return license;
    }),

  /**
   * View activations for a license (read-only)
   */
  activations: adminProcedure
    .input(z.object({ licenseKey: z.string().min(1) }))
    .query(async ({ input }) => {
      return db.getActivationsByLicenseKey(input.licenseKey);
    }),

  /**
   * View sync logs for a license (read-only)
   */
  syncLogs: adminProcedure
    .input(z.object({
      licenseKey: z.string().optional(),
      limit: z.number().min(1).max(500).optional(),
    }))
    .query(async ({ input }) => {
      if (!input?.licenseKey) {
        throw appError('BAD_REQUEST', 'FIELD_REQUIRED', { field: 'licenseKey' }, 'License key is required');
      }
      return db.getSyncLogs(input.licenseKey, input?.limit || 100);
    }),

  /**
   * Get license dashboard stats (read-only)
   */
  stats: adminProcedure.query(async () => {
    return db.getLicenseStats();
  }),
});

// ═══════════════════════════════════════════════════════════════
// MODULE ENDPOINTS (read-only – hiển thị module từ registry + export)
// ═══════════════════════════════════════════════════════════════

const moduleRouter = router({
  /**
   * Get all system modules from registry (không phụ thuộc DB)
   */
  systemModules: adminProcedure.query(() => {
    return SYSTEM_MODULES.map(m => ({
      code: m.code,
      name: m.name,
      description: m.description,
      version: m.version,
      isCore: m.isCore,
      routes: m.routes,
      navGroupId: m.navGroupId || null,
    }));
  }),

  /**
   * Export toàn bộ module/feature theo mẫu JSON để gửi đến License Server đồng bộ
   */
  exportModules: adminProcedure.query(() => {
    // R-2 rebrand: default export code is SYNAPSE-PLATFORM; LICENSE_PRODUCT_CODE wins.
    return toExportFormat(getDefaultProductCode());
  }),
});

// ═══════════════════════════════════════════════════════════════
// COMBINED LICENSE ROUTER
// ═══════════════════════════════════════════════════════════════

export const licenseRouter = router({
  // Public operations
  ...publicLicenseRouter._def.procedures,
  
  // Admin management (nested under admin.*)
  admin: adminLicenseRouter,
  
  // Module management (nested under modules.*)
  modules: moduleRouter,
});
