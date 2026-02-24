/**
 * useLicenseEnforcement – React hook for license enforcement state.
 *
 * Queries the server's LicenseGuard status and provides:
 * - Current enforcement state (normal/warning/readonly/locked/no_license)
 * - Warning/error messages for banners
 * - Helpers to check if mutations are allowed
 *
 * Polls every 5 minutes to stay in sync with server-side checks.
 */

import { trpc } from "@/lib/trpc";

export type LicenseSystemState = 'normal' | 'warning' | 'readonly' | 'locked' | 'no_license';

export interface LicenseEnforcementStatus {
  state: LicenseSystemState;
  message: string;
  daysUntilExpiry: number | null;
  expiresAt: number | null;
  licenseKey: string | null;
  customerName: string | null;
  licenseType: string | null;
  lastCheckedAt: number;
  daysPastExpiry: number | null;
  serverReachable: boolean;
  lastSuccessfulOnlineCheck: number | null;
  consecutiveOfflineChecks: number;
}

/**
 * Hook trả về trạng thái enforcement của license.
 * Dùng để hiện banner cảnh báo và kiểm tra read-only/locked.
 */
export function useLicenseEnforcement() {
  const { data, isLoading, refetch } = trpc.license.systemState.useQuery(
    undefined,
    {
      staleTime: 60_000, // Re-fetch every 1 min of staleness
      refetchInterval: 5 * 60_000, // Poll every 5 minutes
      refetchOnWindowFocus: true,
      retry: 1,
    },
  );

  const state: LicenseSystemState = data?.state ?? 'normal';

  return {
    /** Current enforcement state */
    state,
    /** Human-readable message (for banner display) */
    message: data?.message ?? '',
    /** Days until license expires (negative if expired) */
    daysUntilExpiry: data?.daysUntilExpiry ?? null,
    /** License expiry timestamp */
    expiresAt: data?.expiresAt ?? null,
    /** Days past expiry (only when expired) */
    daysPastExpiry: data?.daysPastExpiry ?? null,
    /** License key being monitored */
    licenseKey: data?.licenseKey ?? null,
    /** Customer name */
    customerName: data?.customerName ?? null,
    /** License type */
    licenseType: data?.licenseType ?? null,
    /** Last check timestamp */
    lastCheckedAt: data?.lastCheckedAt ?? 0,
    /** Whether License Server is currently reachable */
    serverReachable: data?.serverReachable ?? true,
    /** Timestamp of last successful online validation */
    lastSuccessfulOnlineCheck: data?.lastSuccessfulOnlineCheck ?? null,
    /** How many consecutive checks have been offline */
    consecutiveOfflineChecks: data?.consecutiveOfflineChecks ?? 0,

    // ─── Helpers ─────────────────────────────────────────

    /** System is operating normally (can do everything) */
    isNormal: state === 'normal',
    /** License is expiring soon - show warning banner */
    isWarning: state === 'warning',
    /** System is read-only - mutations blocked (except license) */
    isReadOnly: state === 'readonly',
    /** System is fully locked - only license activation works */
    isLocked: state === 'locked',
    /** No license found */
    noLicense: state === 'no_license',
    /** Mutations are allowed (normal or warning) */
    canMutate: state === 'normal' || state === 'warning',
    /** Should show a warning/error banner */
    showBanner: state !== 'normal' || (data?.serverReachable === false && (data?.consecutiveOfflineChecks ?? 0) > 0),
    /** Banner severity level */
    bannerSeverity: state === 'warning' ? 'warning' as const
      : state === 'readonly' ? 'error' as const
      : state === 'locked' || state === 'no_license' ? 'critical' as const
      : null,

    /** Loading state */
    isLoading,
    /** Re-fetch enforcement status */
    refresh: refetch,
  };
}
