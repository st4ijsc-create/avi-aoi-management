/**
 * LicenseEnforcementBanner - Displays license status warnings/errors.
 *
 * Shown at the top of the DashboardLayout when:
 * - License is expiring soon (warning - yellow)
 * - License expired, system read-only (error - orange)
 * - License locked after 15 days (critical - red)
 * - No license found (critical - red)
 *
 * Doc 81 Đợt 2 Task 2 (+ ruling R-2-i) — trong shell, điều kiện và nội dung đi qua MỘT hook
 * `useLicenseNotice` (đúng các nhánh cũ), nhưng hình dạng theo mức độ:
 *  · warning                    → chip 1 dòng trong NoticeStack của top bar (`licenseWarningNoticeItem`),
 *                                 popover giữ thân cũ + nút admin + nút đóng (chỉ warning, như cũ);
 *  · read-only / server offline → CHIP ĐỎ ĐẶC luôn hiện, không bao giờ cắt chữ, `role="status"`,
 *                                 nút admin NGAY TRÊN chip (`LicenseCriticalChip`);
 *  · locked / chưa có license   → THANH đỏ đầy bề rộng ≤32 px ngay dưới top bar (`LicenseCriticalBar`) —
 *                                 ngoại lệ có chủ đích của "0 banner" (R-2-i).
 * `LicenseEnforcementBanner` (dải cũ) giữ nguyên cho nơi nào còn dùng nó.
 */

import { useLicenseEnforcement } from "@/hooks/useLicenseEnforcement";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Info, Lock, ShieldAlert, ShieldX, WifiOff, X } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import type { NoticeItem } from "@/components/patterns/NoticeChip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Enforcement = ReturnType<typeof useLicenseEnforcement>;

export type LicenseNoticeMode = "none" | "serverDown" | "warning" | "readonly" | "locked" | "noLicense";

export interface LicenseNotice {
  mode: LicenseNoticeMode;
  enforcement: Enforcement;
  isAdmin: boolean;
  dismiss: () => void;
}

/** Các nhánh quyết định CŨ của banner, gom vào một chỗ cho mọi hình dạng. */
export function useLicenseNotice(): LicenseNotice {
  const { user } = useAuth();
  const enforcement = useLicenseEnforcement();
  const [dismissed, setDismissed] = useState(false);
  const dismiss = () => setDismissed(true);
  const isAdmin = user?.role === "admin";
  const none = { mode: "none" as const, enforcement, isAdmin, dismiss };

  // Only show banners for logged-in users when there's something to show
  if (!user || !enforcement.showBanner || enforcement.isLoading) return none;
  // Allow dismissing warning (but not readonly/locked)
  if (dismissed && enforcement.isWarning && enforcement.serverReachable) return none;
  // Server-unreachable only banner (state is normal but server is down)
  const serverDownOnly = enforcement.isNormal && !enforcement.serverReachable && enforcement.consecutiveOfflineChecks > 0;
  if (serverDownOnly) return { ...none, mode: "serverDown" };
  switch (enforcement.bannerSeverity) {
    case "warning":
      return { ...none, mode: "warning" };
    case "error":
      return { ...none, mode: "readonly" };
    case "critical":
      return { ...none, mode: enforcement.isLocked ? "locked" : "noLicense" };
    default:
      return none;
  }
}

/** Thân "server không khả dụng" (một bản duy nhất của câu cũ). */
function ServerDownBody({ enforcement, className }: { enforcement: Enforcement; className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex-1 text-sm text-blue-700 dark:text-blue-300", className)}>
      <span className="font-medium">{t("licBanner.licenseServerKhongKhaDung", "License Server không khả dụng")}</span>
      <span className="ml-1 opacity-75">
        — Hệ thống vẫn hoạt động bình thường với license hiện tại.
        {enforcement.lastSuccessfulOnlineCheck && (
          <> Lần kết nối cuối: {new Date(enforcement.lastSuccessfulOnlineCheck).toLocaleString('vi-VN')}.</>
        )}
      </span>
    </div>
  );
}

/** Thân thông điệp license (một bản duy nhất của các câu cũ). */
function LicenseBody({ enforcement, className }: { enforcement: Enforcement; className?: string }) {
  return (
    <div className={cn("flex-1 text-sm", className)}>
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
  );
}

/** Nút admin cũ (Gia hạn / Kích hoạt License). */
function AdminAction({ n, className }: { n: LicenseNotice; className: string }) {
  const { t } = useTranslation();
  if (!n.isAdmin) return null;
  return (
    <Link href="/license" className={className}>
      {n.enforcement.isLocked || n.enforcement.noLicense
        ? t("licenseEnforcementBanner.kichHoatLicense", "Kích hoạt License")
        : t("licenseEnforcementBanner.giaHanLicense", "Gia hạn License")}
    </Link>
  );
}

const SOLID_CTA =
  "shrink-0 rounded-full border border-white/40 bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white transition-colors hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white";

// ── Legacy full banner (unchanged look) ─────────────────────────────────────
export function LicenseEnforcementBanner() {
  const { t } = useTranslation();
  const n = useLicenseNotice();
  const { enforcement } = n;
  if (n.mode === "none") return null;

  if (n.mode === "serverDown") {
    return (
      <div className="bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700 border-b px-4 py-2 flex items-center gap-3">
        <WifiOff className="h-4 w-4 text-blue-500 dark:text-blue-400 shrink-0" />
        <ServerDownBody enforcement={enforcement} />
        <button
          onClick={n.dismiss}
          className="shrink-0 p-1 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors text-blue-700 dark:text-blue-300"
          aria-label={t("licBanner.dongThongBao", "Đóng thông báo")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  let bgClass: string;
  let borderClass: string;
  let textClass: string;
  let icon: React.ReactNode;
  switch (n.mode) {
    case "warning":
      bgClass = 'bg-yellow-50 dark:bg-yellow-950/30';
      borderClass = 'border-yellow-300 dark:border-yellow-700';
      textClass = 'text-yellow-800 dark:text-yellow-200';
      icon = <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0" />;
      break;
    case "readonly":
      bgClass = 'bg-orange-50 dark:bg-orange-950/30';
      borderClass = 'border-orange-300 dark:border-orange-700';
      textClass = 'text-orange-800 dark:text-orange-200';
      icon = <ShieldAlert className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />;
      break;
    default:
      bgClass = 'bg-red-50 dark:bg-red-950/30';
      borderClass = 'border-red-300 dark:border-red-700';
      textClass = 'text-red-800 dark:text-red-200';
      icon = n.mode === "locked"
        ? <Lock className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
        : <ShieldX className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />;
  }

  return (
    <div className={`${bgClass} ${borderClass} border-b px-4 py-2.5 flex items-center gap-3`}>
      {icon}
      <LicenseBody enforcement={enforcement} className={textClass} />
      <AdminAction
        n={n}
        className={`shrink-0 px-3 py-1 rounded-md text-xs font-medium border transition-colors
          ${n.mode === 'warning'
            ? 'bg-yellow-100 hover:bg-yellow-200 border-yellow-400 text-yellow-900 dark:bg-yellow-900 dark:hover:bg-yellow-800 dark:border-yellow-600 dark:text-yellow-100'
            : n.mode === 'readonly'
            ? 'bg-orange-100 hover:bg-orange-200 border-orange-400 text-orange-900 dark:bg-orange-900 dark:hover:bg-orange-800 dark:border-orange-600 dark:text-orange-100'
            : 'bg-red-100 hover:bg-red-200 border-red-400 text-red-900 dark:bg-red-900 dark:hover:bg-red-800 dark:border-red-600 dark:text-red-100'
          }`}
      />
      {/* Dismiss button (only for warnings) */}
      {enforcement.isWarning && (
        <button
          onClick={n.dismiss}
          className={`shrink-0 p-1 rounded hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-colors ${textClass}`}
          aria-label={t("licBanner.dongCanhBao", "Đóng cảnh báo")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Shell: warning → chip in the NoticeStack ─────────────────────────────────
export function licenseWarningNoticeItem(n: LicenseNotice, t: TFunction): NoticeItem | null {
  if (n.mode !== "warning") return null;
  return {
    id: "license-warning",
    kind: "honesty",
    testId: "shell-notice-license",
    label: t("shell.notice.licenseWarning", "License sắp hết hạn"),
    content: (
      <>
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" aria-hidden="true" />
          <LicenseBody enforcement={n.enforcement} />
        </div>
        <div className="mt-2 flex items-center justify-end gap-2">
          <AdminAction n={n} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted" />
          {n.enforcement.isWarning && (
            <button
              type="button"
              onClick={n.dismiss}
              className="rounded p-1 hover:bg-muted"
              aria-label={t("licBanner.dongCanhBao", "Đóng cảnh báo")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </>
    ),
  };
}

// ── Shell: read-only / server offline → solid red chip, always visible ───────
export function LicenseCriticalChip({ notice: n }: { notice: LicenseNotice }) {
  const { t } = useTranslation();
  if (n.mode !== "readonly" && n.mode !== "serverDown") return null;
  const readonly = n.mode === "readonly";
  const label = readonly
    ? t("shell.notice.licenseReadonly", "License: chỉ đọc")
    : t("shell.notice.licenseServerDown", "License: mất kết nối");
  const Icon = readonly ? ShieldAlert : WifiOff;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="shell-license-critical"
      data-state={n.mode}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-destructive pl-2 pr-1 text-xs font-semibold text-destructive-foreground shadow-sm"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
      <span className="sr-only">
        {readonly ? n.enforcement.message : t("licBanner.licenseServerKhongKhaDung", "License Server không khả dụng")}
      </span>
      <AdminAction n={n} className={SOLID_CTA} />
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("shell.notice.licenseDetails", "Chi tiết license")}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 text-sm">
          {readonly ? <LicenseBody enforcement={n.enforcement} /> : <ServerDownBody enforcement={n.enforcement} />}
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ── Shell: locked / no licence → full-width bar ≤32 px under the top bar ─────
// `includeChipStates` (điện thoại): chỉ-đọc / server offline cũng thành thanh — vẫn đỏ đặc, luôn hiện,
// nhưng nền `bg-destructive` + icon/nhãn riêng để KHÁC thanh "bị khoá" (`bg-red-700`, ổ khoá).
export function LicenseCriticalBar({ notice: n, includeChipStates = false }: { notice: LicenseNotice; includeChipStates?: boolean }) {
  const { t } = useTranslation();
  const chipState = n.mode === "readonly" || n.mode === "serverDown";
  if (n.mode !== "locked" && n.mode !== "noLicense" && !(includeChipStates && chipState)) return null;
  const locked = n.mode === "locked";
  const Icon = locked ? Lock : n.mode === "readonly" ? ShieldAlert : n.mode === "serverDown" ? WifiOff : ShieldX;
  const label = locked
    ? t("shell.notice.licenseLocked", "License bị khoá")
    : n.mode === "readonly"
      ? t("shell.notice.licenseReadonly", "License: chỉ đọc")
      : n.mode === "serverDown"
        ? t("licBanner.licenseServerKhongKhaDung", "License Server không khả dụng")
        : t("shell.notice.licenseMissing", "Chưa có license");
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="shell-license-bar"
      data-state={n.mode}
      className={cn(
        "flex h-8 min-w-0 shrink-0 items-center gap-2 overflow-hidden px-3 text-xs",
        chipState ? "bg-destructive text-destructive-foreground" : "bg-red-700 text-white dark:bg-red-800",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0 font-semibold">{label}</span>
      {n.mode !== "serverDown" && <LicenseBody enforcement={n.enforcement} className="min-w-0 truncate text-xs opacity-90" />}
      <AdminAction n={n} className={cn(SOLID_CTA, "ml-auto")} />
    </div>
  );
}
