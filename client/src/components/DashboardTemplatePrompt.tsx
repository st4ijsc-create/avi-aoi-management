/**
 * Doc 10 / U11 — first-visit "start with a role template" nudge for the dashboard.
 *
 * On a user's FIRST visit to the ops dashboard, suggest picking a role-aligned layout
 * template (the DashboardTemplates system already exists) instead of facing an empty/generic
 * board. Dismissible and remembered per user+role (localStorage), so it never nags.
 *
 * doc64 S5-OPT (ISA-101): đổi VỎ modal → banner inline KHÔNG chặn. Modal auto-open đè màn
 * giám sát ngay khi vào ca là anti-pattern HMI (content-first); nó còn "cướp" LCP (~4s, POC ×4)
 * vì Radix Dialog portal paint muộn sau auth+mount. Banner render cùng first-paint của trang,
 * logic nudge/dismiss/remember GIỮ NGUYÊN.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LayoutTemplate, X } from "lucide-react";

function key(userId: string, role: string) {
  return `dashboardTemplate:${role}:${userId}`;
}

export function DashboardTemplatePrompt() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  const userId = user ? String((user as any).id ?? (user as any).openId ?? "anon") : null;
  const role = user?.role ?? "user";

  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(key(userId, role)) !== "1") setOpen(true);
    } catch {
      /* ignore */
    }
  }, [userId, role]);

  const remember = () => {
    if (!userId) return;
    try {
      window.localStorage.setItem(key(userId, role), "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  if (!userId || !open) return null;

  return (
    <div
      role="region"
      aria-label={t("dashTemplate.title", "Bắt đầu với một mẫu bảng?")}
      className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 md:mx-6"
    >
      <LayoutTemplate className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium">{t("dashTemplate.title", "Bắt đầu với một mẫu bảng?")}</span>{" "}
        <span className="text-xs text-muted-foreground">
          {t("dashTemplate.desc", "Chọn một bố cục dựng sẵn phù hợp vai trò của bạn (sản xuất / chất lượng / thiết bị / điều hành) — có thể tùy chỉnh sau.")}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" onClick={() => { remember(); navigate("/dashboard-templates"); }}>
          {t("dashTemplate.choose", "Chọn mẫu")}
        </Button>
        <Button size="sm" variant="ghost" onClick={remember} aria-label={t("dashTemplate.skip", "Để sau")}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default DashboardTemplatePrompt;
