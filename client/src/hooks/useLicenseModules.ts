/**
 * useLicenseModules – React hook for license-based module gating.
 *
 * Cung cấp thông tin về các module được phép truy cập dựa trên license key.
 * Sử dụng kết hợp với module-registry (shared) và tRPC endpoint getAllowedModules.
 *
 * Core modules (CORE_*) luôn được phép truy cập.
 * Optional modules (MOD_*) chỉ được phép khi license đang active và chứa module code.
 * 
 * RESILIENCE: Caches module data in localStorage so modules survive
 * browser refreshes and server restarts when the License Server is down.
 */

import { useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  CORE_MODULE_CODES,
  SYSTEM_MODULES,
  getModuleByRoute,
  getModuleByNavGroup,
  isRouteAllowed as _isRouteAllowed,
} from "../../../shared/module-registry";

const LICENSE_KEY_STORAGE = "avi_license_key";
const LICENSE_MODULES_CACHE = "avi_license_modules_cache";

/**
 * Lấy license key đã lưu trong localStorage
 */
export function getSavedLicenseKey(): string | null {
  try {
    return localStorage.getItem(LICENSE_KEY_STORAGE);
  } catch {
    return null;
  }
}

/**
 * Lưu license key vào localStorage
 */
export function saveLicenseKey(key: string) {
  try {
    localStorage.setItem(LICENSE_KEY_STORAGE, key);
  } catch {
    // ignore
  }
}

/**
 * Xóa license key khỏi localStorage
 */
export function clearLicenseKey() {
  try {
    localStorage.removeItem(LICENSE_KEY_STORAGE);
    localStorage.removeItem(LICENSE_MODULES_CACHE);
  } catch {
    // ignore
  }
}

// ─── Module Cache Helpers (localStorage) ─────────────────────

interface ModulesCache {
  modules: string[];
  isLicensed: boolean;
  licenseStatus: string | null;
  expiresAt: number | null;
  licenseType: string | null;
  customerName: string | null;
  cachedAt: number;
}

function saveModulesCache(data: ModulesCache): void {
  try {
    localStorage.setItem(LICENSE_MODULES_CACHE, JSON.stringify(data));
  } catch {
    // ignore
  }
}

function loadModulesCache(): ModulesCache | null {
  try {
    const raw = localStorage.getItem(LICENSE_MODULES_CACHE);
    if (!raw) return null;
    const cache: ModulesCache = JSON.parse(raw);
    if (!cache.cachedAt || !Array.isArray(cache.modules)) return null;
    return cache;
  } catch {
    return null;
  }
}

/**
 * Hook trả về thông tin license modules cho user hiện tại.
 *
 * @returns
 * - allowedModules: danh sách module codes được phép
 * - isModuleAllowed(code): kiểm tra module code có được phép không
 * - isRouteAllowed(path): kiểm tra route path có được phép không
 * - isNavGroupAllowed(groupId): kiểm tra nav group có được phép không
 * - isLicensed: có license active không
 * - licenseStatus, licenseType, expiresAt: thông tin license
 * - isLoading: đang tải
 * - noLicenseKey: chưa có license key được lưu
 */
export function useLicenseModules() {
  const { isAuthenticated } = useAuth();
  const licenseKey = getSavedLicenseKey();

  // ── Auto-sync license key from LicenseGuard's best license ──
  // The guard picks the "best" license (latest expiry, active preferred).
  // If the client has no key, or has a different key, auto-sync it.
  const { data: systemState } = trpc.license.systemState.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 60_000, // Check every 1 min
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (systemState?.licenseKey && systemState.state !== 'no_license') {
      const guardKey = systemState.licenseKey;
      const currentKey = getSavedLicenseKey();
      if (!currentKey || currentKey !== guardKey) {
        console.log(`[useLicenseModules] Auto-syncing license key: ${currentKey || '(none)'} → ${guardKey}`);
        saveLicenseKey(guardKey);
      }
    }
  }, [systemState?.licenseKey, systemState?.state]);

  // Use the guard's key if available and different from localStorage
  const effectiveKey = (systemState?.licenseKey && systemState.state !== 'no_license')
    ? systemState.licenseKey
    : licenseKey;

  const { data, isLoading, isError, refetch } = trpc.license.getAllowedModules.useQuery(
    { licenseKey: effectiveKey || "" },
    {
      enabled: isAuthenticated && !!effectiveKey,
      staleTime: 5 * 60_000, // Cache 5 phút
      refetchOnWindowFocus: false,
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10_000),
    },
  );

  // ── Save successful responses to localStorage cache ──
  useEffect(() => {
    if (data && data.modules && data.modules.length > 0) {
      saveModulesCache({
        modules: data.modules,
        isLicensed: data.isLicensed,
        licenseStatus: data.licenseStatus ?? null,
        expiresAt: data.expiresAt ?? null,
        licenseType: data.licenseType ?? null,
        customerName: data.customerName ?? null,
        cachedAt: Date.now(),
      });
    }
  }, [data]);

  // ── Load cached modules from localStorage as fallback ──
  const cachedModules = useMemo(() => loadModulesCache(), []);

  const allowedModules = useMemo<string[]>(() => {
    if (!effectiveKey) return [...CORE_MODULE_CODES];
    // Primary: use server response
    if (data?.modules && data.modules.length > 0) {
      return data.modules;
    }
    // Fallback: use localStorage cache when server is unreachable or loading
    if (cachedModules?.modules && cachedModules.modules.length > 0) {
      return cachedModules.modules;
    }
    // Last resort: core modules only
    return [...CORE_MODULE_CODES];
  }, [data?.modules, effectiveKey, cachedModules]);

  const allowedSet = useMemo(() => new Set(allowedModules), [allowedModules]);

  /**
   * Kiểm tra module code có được phép không
   */
  const isModuleAllowed = (moduleCode: string): boolean => {
    const mod = SYSTEM_MODULES.find((m) => m.code === moduleCode);
    if (!mod) return true; // Unknown module → allow
    if (mod.isCore) return true;
    return allowedSet.has(moduleCode);
  };

  /**
   * Kiểm tra route path có được phép truy cập không
   */
  const isRouteAllowed = (routePath: string): boolean => {
    return _isRouteAllowed(routePath, allowedModules);
  };

  /**
   * Kiểm tra nav group có module tương ứng được phép không
   */
  const isNavGroupAllowed = (navGroupId: string): boolean => {
    const mod = getModuleByNavGroup(navGroupId);
    if (!mod) return true; // Group không map với module → allow
    if (mod.isCore) return true;
    return allowedSet.has(mod.code);
  };

  /**
   * Lấy danh sách system modules kèm trạng thái allowed/blocked
   */
  const modulesWithStatus = useMemo(() => {
    return SYSTEM_MODULES.map((m) => ({
      ...m,
      allowed: m.isCore || allowedSet.has(m.code),
    }));
  }, [allowedSet]);

  return {
    /** Danh sách module codes được phép */
    allowedModules,
    /** Có license active không */
    isLicensed: data?.isLicensed ?? cachedModules?.isLicensed ?? false,
    /** Trạng thái license */
    licenseStatus: data?.licenseStatus ?? cachedModules?.licenseStatus ?? null,
    /** Loại license */
    licenseType: data?.licenseType ?? cachedModules?.licenseType ?? null,
    /** Thời gian hết hạn (epoch ms) */
    expiresAt: data?.expiresAt ?? cachedModules?.expiresAt ?? null,
    /** Tên khách hàng */
    customerName: data?.customerName ?? cachedModules?.customerName ?? null,
    /** License key hiện tại */
    licenseKey: effectiveKey,
    /** Chưa có license key nào được lưu */
    noLicenseKey: !effectiveKey,
    /** Đang tải thông tin license */
    isLoading: isAuthenticated && !!effectiveKey && isLoading && !cachedModules,
    /** Server query failed (using cached data) */
    isUsingCache: isError && !!cachedModules,
    /** Kiểm tra module code có được phép */
    isModuleAllowed,
    /** Kiểm tra route có được phép */
    isRouteAllowed,
    /** Kiểm tra nav group có được phép */
    isNavGroupAllowed,
    /** Tất cả modules kèm trạng thái allowed */
    modulesWithStatus,
    /** Refresh lại thông tin license */
    refresh: refetch,
  };
}
