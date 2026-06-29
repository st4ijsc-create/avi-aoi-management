/**
 * FirstRunTour — lightweight, dismissible first-run coach (doc 07 §④ P2).
 *
 * Shows a small welcome modal ONCE per user (keyed in localStorage by user id) on
 * their landing page, pointing to 3–4 key actions tailored to their role. No heavy
 * tour library — a simple Dialog with a short checklist of "where to start".
 *
 * Behavior:
 *   - Only renders for an authenticated user, and only if not previously dismissed.
 *   - "Bắt đầu" / close → persists the dismissal so it never shows again for that user.
 *   - Fails safe: if localStorage is unavailable it simply won't persist (shows once
 *     per session at worst), and never throws.
 *
 * Mount it once on a role landing (e.g. OperatorHome). Reuses role info from useAuth.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  ScanLine,
  AlertTriangle,
  MessageSquare,
  Inbox,
  BarChart3,
  FileText,
  Sparkles,
  ClipboardCheck,
  Factory,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const STORAGE_PREFIX = "firstRunTour:";

interface TourTip {
  icon: LucideIcon;
  /** i18n key for the tip label. */
  key: string;
  /** Fallback (vi) label. */
  fallback: string;
  /** Optional route the tip points to. */
  href?: string;
}

/** Role → 3–4 "where to start" tips. Unknown roles fall back to a generic set. */
function tipsForRole(role?: string | null): TourTip[] {
  switch (role) {
    case "operator":
      return [
        { icon: ScanLine, key: "tour.tips.scan", fallback: "Quét máy để bắt đầu", href: "/operator" },
        { icon: AlertTriangle, key: "tour.tips.report", fallback: "Báo sự cố nhanh", href: "/operator" },
        { icon: MessageSquare, key: "tour.tips.askAI", fallback: "Hỏi AI khi cần trợ giúp", href: "/ai-chat" },
        { icon: Inbox, key: "tour.tips.inbox", fallback: "Xem việc cần xử lý", href: "/operator" },
      ];
    case "maintenance":
      return [
        { icon: Sparkles, key: "tour.tips.copilot", fallback: "Mở RCA Copilot để khắc phục sự cố", href: "/technician-copilot" },
        { icon: AlertTriangle, key: "tour.tips.alerts", fallback: "Theo dõi cảnh báo máy", href: "/alerts" },
        { icon: MessageSquare, key: "tour.tips.askAI", fallback: "Hỏi AI khi cần trợ giúp", href: "/ai-chat" },
      ];
    case "quality_inspector":
      return [
        { icon: ClipboardCheck, key: "tour.tips.qualityHome", fallback: "Mở không gian kiểm tra chất lượng", href: "/quality-home" },
        { icon: BarChart3, key: "tour.tips.spc", fallback: "Phân tích SPC", href: "/spc-analysis" },
        { icon: FileText, key: "tour.tips.reports", fallback: "Xem báo cáo", href: "/reports" },
      ];
    case "supervisor":
    case "manager":
      return [
        { icon: Sparkles, key: "tour.tips.insight", fallback: "Hỏi đáp & tóm tắt điều hành", href: "/management-insight" },
        { icon: BarChart3, key: "tour.tips.dashboard", fallback: "Bảng điều khiển sản xuất", href: "/production-dashboard" },
        { icon: FileText, key: "tour.tips.reports", fallback: "Xem báo cáo", href: "/reports" },
      ];
    default:
      return [
        { icon: Factory, key: "tour.tips.dashboard", fallback: "Bảng điều khiển sản xuất", href: "/dashboard" },
        { icon: MessageSquare, key: "tour.tips.askAI", fallback: "Hỏi AI khi cần trợ giúp", href: "/ai-chat" },
        { icon: FileText, key: "tour.tips.reports", fallback: "Xem báo cáo", href: "/reports" },
      ];
  }
}

function dismissed(userKey: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + userKey) === "1";
  } catch {
    return false;
  }
}

function markDismissed(userKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + userKey, "1");
  } catch {
    /* ignore — best-effort persistence */
  }
}

export function FirstRunTour() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  // Stable per-user key. Falls back to "anon" only when a user with no id exists.
  const userKey = useMemo(() => {
    const u = user as { id?: number | string; openId?: string } | null;
    return u ? String(u.id ?? u.openId ?? "anon") : null;
  }, [user]);

  const role = user?.role ?? null;
  const tips = useMemo(() => tipsForRole(role), [role]);

  useEffect(() => {
    if (!userKey) return;
    // U10/doc 10 U17: re-trigger the tour when the user's ROLE changes (new role → new
    // tips), by clearing the per-user dismissed flag the first time we see a different role.
    try {
      const roleKey = STORAGE_PREFIX + userKey + ":role";
      const prevRole = window.localStorage.getItem(roleKey);
      const curRole = role ?? "";
      if (prevRole !== null && prevRole !== curRole) {
        window.localStorage.removeItem(STORAGE_PREFIX + userKey); // un-dismiss for the new role
      }
      window.localStorage.setItem(roleKey, curRole);
    } catch {
      /* best-effort */
    }
    if (!dismissed(userKey)) setOpen(true);
  }, [userKey, role]);

  const close = () => {
    if (userKey) markDismissed(userKey);
    setOpen(false);
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? close() : setOpen(o))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t("tour.title", "Chào mừng bạn!")}
          </DialogTitle>
          <DialogDescription>
            {t("tour.subtitle", "Đây là vài chỗ để bắt đầu nhanh nhất cho công việc của bạn.")}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 py-2">
          {tips.map((tip) => {
            const Icon = tip.icon;
            const label = t(tip.key, tip.fallback);
            const content = (
              <span className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-medium text-foreground">{label}</span>
              </span>
            );
            return (
              <li key={tip.key}>
                {tip.href ? (
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      navigate(tip.href!);
                    }}
                    className="w-full rounded-lg border p-2 text-left transition-colors hover:bg-muted/60"
                  >
                    {content}
                  </button>
                ) : (
                  <div className="rounded-lg border p-2">{content}</div>
                )}
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button onClick={close} className="w-full sm:w-auto">
            {t("tour.start", "Bắt đầu")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default FirstRunTour;
