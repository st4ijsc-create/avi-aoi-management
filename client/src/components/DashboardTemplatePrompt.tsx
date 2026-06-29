/**
 * Doc 10 / U11 — first-visit "start with a role template" nudge for the dashboard.
 *
 * On a user's FIRST visit to the ops dashboard, suggest picking a role-aligned layout
 * template (the DashboardTemplates system already exists) instead of facing an empty/generic
 * board. Dismissible and remembered per user+role (localStorage), so it never nags.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LayoutTemplate } from "lucide-react";

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

  if (!userId) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) remember(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutTemplate className="h-5 w-5" /> {t("dashTemplate.title", "Bắt đầu với một mẫu bảng?")}
          </DialogTitle>
          <DialogDescription>
            {t("dashTemplate.desc", "Chọn một bố cục dựng sẵn phù hợp vai trò của bạn (sản xuất / chất lượng / thiết bị / điều hành) — có thể tùy chỉnh sau.")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={remember}>{t("dashTemplate.skip", "Để sau")}</Button>
          <Button onClick={() => { remember(); navigate("/dashboard-templates"); }}>
            {t("dashTemplate.choose", "Chọn mẫu")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DashboardTemplatePrompt;
