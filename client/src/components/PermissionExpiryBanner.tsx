/**
 * Doc 10 / U6 — Permission-expiry warning banner.
 *
 * usePermissions already silently DROPS an expired permission (hasPermission returns false
 * past expiresAt), but the user got no warning. This banner surfaces any grant expiring
 * within the next N days (default 7) so the user can ask an admin to renew before losing
 * access. Dismissible per-session. Admins (no expiring grants) never see it.
 *
 * Doc 81 Đợt 2 Task 2 — shell vẽ nó thành CHIP 1 dòng trong top bar (`permissionExpiryNoticeItem` trong
 * NoticeStack của shell); popover giữ NGUYÊN câu và nút bỏ qua. Điều kiện hiện (`expiring`, `dismissed`)
 * nằm ở MỘT hook `usePermissionExpiryNotice` cho cả banner lẫn chip.
 */
import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { AlertTriangle, X } from "lucide-react";
import type { NoticeItem } from "@/components/patterns/NoticeChip";

const WARN_WITHIN_DAYS = 7;

export interface PermissionExpiryNotice {
  /** Câu cảnh báo khi có quyền sắp hết hạn và chưa bỏ qua; null = không hiện. */
  message: string | null;
  dismiss: () => void;
}

/** Điều kiện + câu của banner (một đường cho cả banner lẫn chip của shell). */
export function usePermissionExpiryNotice(): PermissionExpiryNotice {
  const { t } = useTranslation();
  const { permissions } = usePermissions();
  const [dismissed, setDismissed] = useState(false);

  const expiring = useMemo(() => {
    const now = Date.now();
    const horizon = now + WARN_WITHIN_DAYS * 24 * 60 * 60 * 1000;
    return permissions
      .map((p) => {
        if (!p.expiresAt) return null;
        const at = typeof p.expiresAt === "string" ? new Date(p.expiresAt) : p.expiresAt;
        const ms = at.getTime();
        if (Number.isNaN(ms) || ms < now || ms > horizon) return null; // already expired or far off
        return { module: p.moduleName, days: Math.max(0, Math.ceil((ms - now) / (24 * 60 * 60 * 1000))) };
      })
      .filter(Boolean) as Array<{ module: string; days: number }>;
  }, [permissions]);

  const dismiss = () => setDismissed(true);
  if (dismissed || expiring.length === 0) return { message: null, dismiss };

  const soonest = expiring.reduce((m, e) => (e.days < m.days ? e : m), expiring[0]);

  const message =
    expiring.length === 1
      ? t("permExpiry.one", { defaultValue: 'Quyền "{{module}}" sẽ hết hạn sau {{days}} ngày — liên hệ quản trị để gia hạn.', module: soonest.module, days: soonest.days })
      : t("permExpiry.many", { defaultValue: "{{count}} quyền sắp hết hạn (sớm nhất sau {{days}} ngày) — liên hệ quản trị để gia hạn.", count: expiring.length, days: soonest.days });
  return { message, dismiss };
}

/** Mục NoticeStack của shell (chip 1 dòng + popover giữ nguyên câu và nút bỏ qua). */
export function permissionExpiryNoticeItem(n: PermissionExpiryNotice, t: TFunction): NoticeItem | null {
  if (n.message == null) return null;
  return {
    id: "permission-expiry",
    kind: "honesty",
    testId: "shell-notice-permission-expiry",
    label: t("shell.notice.permExpiry", "Quyền sắp hết hạn"),
    content: (
      <>
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="flex-1">{n.message}</p>
        </div>
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={n.dismiss} className="rounded border px-2 py-1 text-xs hover:bg-muted">
            {t("common.dismiss", "Bỏ qua")}
          </button>
        </div>
      </>
    ),
  };
}

export function PermissionExpiryBanner() {
  const { t } = useTranslation();
  const { message, dismiss } = usePermissionExpiryNotice();
  if (message == null) return null;

  return (
    <div className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      <button type="button" onClick={dismiss} aria-label={t("common.dismiss", "Bỏ qua")} className="shrink-0 rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default PermissionExpiryBanner;
