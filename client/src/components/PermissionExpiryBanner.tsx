/**
 * Doc 10 / U6 — Permission-expiry warning banner.
 *
 * usePermissions already silently DROPS an expired permission (hasPermission returns false
 * past expiresAt), but the user got no warning. This banner surfaces any grant expiring
 * within the next N days (default 7) so the user can ask an admin to renew before losing
 * access. Dismissible per-session. Admins (no expiring grants) never see it.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { AlertTriangle, X } from "lucide-react";

const WARN_WITHIN_DAYS = 7;

export function PermissionExpiryBanner() {
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

  if (dismissed || expiring.length === 0) return null;

  const soonest = expiring.reduce((m, e) => (e.days < m.days ? e : m), expiring[0]);

  return (
    <div className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">
        {expiring.length === 1
          ? t("permExpiry.one", { defaultValue: 'Quyền "{{module}}" sẽ hết hạn sau {{days}} ngày — liên hệ quản trị để gia hạn.', module: soonest.module, days: soonest.days })
          : t("permExpiry.many", { defaultValue: "{{count}} quyền sắp hết hạn (sớm nhất sau {{days}} ngày) — liên hệ quản trị để gia hạn.", count: expiring.length, days: soonest.days })}
      </span>
      <button type="button" onClick={() => setDismissed(true)} aria-label={t("common.dismiss", "Bỏ qua")} className="shrink-0 rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default PermissionExpiryBanner;
