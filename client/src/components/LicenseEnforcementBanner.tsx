/**
 * LicenseEnforcementBanner - Displays license status warnings/errors.
 *
 * Shown at the top of the DashboardLayout when:
 * - License is expiring soon (warning - yellow)
 * - License expired, system read-only (error - orange)
 * - License locked after 15 days (critical - red)
 * - No license found (critical - red)
 */

import { useLicenseEnforcement } from "@/hooks/useLicenseEnforcement";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Lock, ShieldAlert, ShieldX, WifiOff, X } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

export function LicenseEnforcementBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const enforcement = useLicenseEnforcement();
  const [dismissed, setDismissed] = useState(false);

  // Only show banners for logged-in users when there's something to show
  if (!user || !enforcement.showBanner || enforcement.isLoading) {
    return null;
  }

  // Allow dismissing warning (but not readonly/locked)
  if (dismissed && enforcement.isWarning && enforcement.serverReachable) {
    return null;
  }

  const isAdmin = user.role === 'admin';

  // Server-unreachable only banner (state is normal but server is down)
  const serverDownOnly = enforcement.isNormal && !enforcement.serverReachable && enforcement.consecutiveOfflineChecks > 0;

  if (serverDownOnly) {
    return (
      <div className="bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700 border-b px-4 py-2 flex items-center gap-3">
        <WifiOff className="h-4 w-4 text-blue-500 dark:text-blue-400 shrink-0" />
        <div className="flex-1 text-sm text-blue-700 dark:text-blue-300">
          <span className="font-medium">{t("licBanner.licenseServerKhongKhaDung", "License Server không khả dụng")}</span>
          <span className="ml-1 opacity-75">
            — Hệ thống vẫn hoạt động bình thường với license hiện tại.
            {enforcement.lastSuccessfulOnlineCheck && (
              <> Lần kết nối cuối: {new Date(enforcement.lastSuccessfulOnlineCheck).toLocaleString('vi-VN')}.</>
            )}
          </span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 p-1 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors text-blue-700 dark:text-blue-300"
          aria-label={t("licBanner.dongThongBao", "Đóng thông báo")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Icon, colors, and styling based on severity
  let bgClass: string;
  let borderClass: string;
  let textClass: string;
  let icon: React.ReactNode;

  switch (enforcement.bannerSeverity) {
    case 'warning':
      bgClass = 'bg-yellow-50 dark:bg-yellow-950/30';
      borderClass = 'border-yellow-300 dark:border-yellow-700';
      textClass = 'text-yellow-800 dark:text-yellow-200';
      icon = <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0" />;
      break;
    case 'error':
      bgClass = 'bg-orange-50 dark:bg-orange-950/30';
      borderClass = 'border-orange-300 dark:border-orange-700';
      textClass = 'text-orange-800 dark:text-orange-200';
      icon = <ShieldAlert className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />;
      break;
    case 'critical':
      bgClass = 'bg-red-50 dark:bg-red-950/30';
      borderClass = 'border-red-300 dark:border-red-700';
      textClass = 'text-red-800 dark:text-red-200';
      icon = enforcement.isLocked
        ? <Lock className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
        : <ShieldX className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />;
      break;
    default:
      return null;
  }

  return (
    <div className={`${bgClass} ${borderClass} border-b px-4 py-2.5 flex items-center gap-3`}>
      {icon}
      <div className={`flex-1 text-sm ${textClass}`}>
        <span className="font-medium">{enforcement.message}</span>
        {enforcement.daysUntilExpiry !== null && enforcement.daysUntilExpiry > 0 && (
          <span className="ml-2 opacity-75">
            (Còn {enforcement.daysUntilExpiry} ngày)
          </span>
        )}
        {!enforcement.serverReachable && enforcement.consecutiveOfflineChecks > 0 && (
          <span className="ml-2 inline-flex items-center gap-1 opacity-60">
            <WifiOff className="h-3 w-3 inline" />
            <span className="text-xs">Server offline</span>
          </span>
        )}
      </div>

      {/* Action button for admin */}
      {isAdmin && (
        <Link
          href="/license"
          className={`shrink-0 px-3 py-1 rounded-md text-xs font-medium border transition-colors
            ${enforcement.bannerSeverity === 'warning'
              ? 'bg-yellow-100 hover:bg-yellow-200 border-yellow-400 text-yellow-900 dark:bg-yellow-900 dark:hover:bg-yellow-800 dark:border-yellow-600 dark:text-yellow-100'
              : enforcement.bannerSeverity === 'error'
              ? 'bg-orange-100 hover:bg-orange-200 border-orange-400 text-orange-900 dark:bg-orange-900 dark:hover:bg-orange-800 dark:border-orange-600 dark:text-orange-100'
              : 'bg-red-100 hover:bg-red-200 border-red-400 text-red-900 dark:bg-red-900 dark:hover:bg-red-800 dark:border-red-600 dark:text-red-100'
            }`}
        >
          {enforcement.isLocked || enforcement.noLicense
            ? 'Kích hoạt License'
            : 'Gia hạn License'}
        </Link>
      )}

      {/* Dismiss button (only for warnings) */}
      {enforcement.isWarning && (
        <button
          onClick={() => setDismissed(true)}
          className={`shrink-0 p-1 rounded hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-colors ${textClass}`}
          aria-label={t("licBanner.dongCanhBao", "Đóng cảnh báo")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
