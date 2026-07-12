/**
 * OperatorHome — "/operator" — the simplified, kiosk/touch-friendly FRONT DOOR
 * for shop-floor operators (low-tech, gloves, tablets, big screens).
 *
 * Design goals (docs 05 minimal-effort UX): minimal cognitive load, BIG buttons
 * (≥96px tiles, ≥44px touch targets), high contrast, large readable labels, and
 * the operator's role-aware "Today" summary right at the top — zero clicks to a
 * personalized status.
 *
 * Doc 40 Wave 4 (persona operator) adds:
 *   - KIOSK mode polish (?kiosk=1): oversized tiles + a prominent RED emergency
 *     row ("Báo sự cố" + "Gọi bảo trì") pinned to the top.
 *   - "Line của tôi": defaults the line-status view to the operator's assigned
 *     factory (userAssignment.getMyAssignments) with a "Xem cả nhà máy" escape.
 *   - "Gọi bảo trì": 1-tap raises a maintenance-reason Andon (alert-only — it
 *     never actuates a machine).
 *   - "Đổi sản phẩm": deep-links to the 4-step ProductChangeoverWizard.
 *
 * Everything REUSES existing, battle-tested components. Rendered inside
 * DashboardLayout. Not role-locked (each underlying action enforces its own RBAC).
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { TodayBriefing } from "@/components/TodayBriefing";
import { PageHeader, PageContainer } from "@/components/patterns";
import { OfflineBanner } from "@/components/OfflineBanner";
import MachineQuickScan from "@/components/MachineQuickScan";
import QuickIssueReport from "@/components/QuickIssueReport";
import OperatorSessionControl from "@/components/OperatorSessionControl";
import { AIActionInbox } from "@/components/AIActionInbox";
import { FirstRunTour } from "@/components/FirstRunTour";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ScanLine,
  AlertTriangle,
  Factory,
  MessageSquare,
  Inbox,
  Wrench,
  Package,
  Building2,
  Loader2,
  type LucideIcon,
} from "lucide-react";

// ─── A single large tile (≥96px, big icon + label, high contrast) ──────────────

interface TileProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Tailwind accent classes for the icon/background. */
  accent: string;
  /** Optional count badge (e.g. pending inbox items). */
  badge?: number;
  /** Kiosk mode → oversized tile for viewing distance. */
  big?: boolean;
}

function Tile({ icon: Icon, label, onClick, accent, badge, big }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center justify-center gap-2 rounded-2xl border-2 p-4 text-center",
        "transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40",
        "bg-card hover:bg-muted/60 shadow-sm",
        big ? "min-h-[140px]" : "min-h-[96px]",
        accent,
      )}
    >
      {badge != null && badge > 0 && (
        <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-destructive px-2 text-sm font-bold text-destructive-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      <Icon className={cn("shrink-0", big ? "h-14 w-14" : "h-10 w-10")} strokeWidth={2.25} />
      <span className={cn("font-bold leading-tight tracking-tight", big ? "text-2xl" : "text-lg")}>
        {label}
      </span>
    </button>
  );
}

export default function OperatorHome() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [inboxOpen, setInboxOpen] = useState(false);

  // ── Kiosk mode (?kiosk=1) — bigger tiles + pinned emergency row ──────────────
  const isKiosk = useMemo(() => {
    if (typeof window === "undefined") return false;
    const p = new URLSearchParams(window.location.search);
    return p.get("kiosk") === "1" || p.get("kiosk") === "true";
  }, []);

  // Pending action count for the "Việc cần xử lý" tile badge (best-effort).
  const countQuery = trpc.aiInbox.count.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const pendingCount = countQuery.data?.count ?? 0;

  // ── "Line của tôi": resolve the operator's assigned factory (honest-null) ────
  const assignmentsQuery = trpc.userAssignment.getMyAssignments.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const factoriesQuery = trpc.factory.list.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const myFactories = useMemo(() => {
    const codes = new Set(
      (assignmentsQuery.data?.factories ?? []).map((f: any) => f.factoryCode).filter(Boolean),
    );
    const all = (factoriesQuery.data ?? []) as Array<{ id: number; code: string; name: string }>;
    return all.filter((f) => codes.has(f.code));
  }, [assignmentsQuery.data, factoriesQuery.data]);
  const singleFactory = myFactories.length === 1 ? myFactories[0] : null;

  const goMyLine = () => {
    // Default to the operator's factory when they own exactly one; otherwise the
    // full production dashboard (honest — no fabricated line filter).
    navigate(singleFactory ? `/production-dashboard?factory=${singleFactory.id}` : "/production-dashboard");
  };

  // ── "Gọi bảo trì" — 1-tap maintenance Andon (ALERT-ONLY, no actuation) ───────
  const callMaintenance = trpc.andon.raise.useMutation({
    onSuccess: () => {
      toast.success(t("operator.maintenanceCalled", "Đã gọi bảo trì — đội bảo trì sẽ được báo"));
    },
    onError: (err) => {
      toast.error(t("operator.maintenanceCallError", "Không gọi được bảo trì"), {
        description: err.message,
      });
    },
  });
  const handleCallMaintenance = () => {
    callMaintenance.mutate({
      state: "call",
      reason: "maintenance",
      title: t("operator.maintenanceCallTitle", "Yêu cầu bảo trì từ vận hành"),
    });
  };

  // Emergency buttons — rendered big in kiosk, still present otherwise.
  const emergencyRow = (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      <QuickIssueReport
        trigger={
          <button
            type="button"
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-red-500/60 bg-red-500/10 p-4 text-red-600 shadow-sm dark:text-red-400",
              "transition-colors active:scale-[0.98] hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-500/40",
              isKiosk ? "min-h-[140px]" : "min-h-[110px]",
            )}
          >
            <AlertTriangle className={cn(isKiosk ? "h-14 w-14" : "h-11 w-11")} strokeWidth={2.5} />
            <span className={cn("font-extrabold", isKiosk ? "text-2xl" : "text-xl")}>
              {t("operator.reportIssue", "Báo sự cố")}
            </span>
          </button>
        }
      />
      <button
        type="button"
        onClick={handleCallMaintenance}
        disabled={callMaintenance.isPending}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-amber-500/60 bg-amber-500/10 p-4 text-amber-600 shadow-sm dark:text-amber-400",
          "transition-colors active:scale-[0.98] hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-500/40 disabled:opacity-60",
          isKiosk ? "min-h-[140px]" : "min-h-[110px]",
        )}
      >
        {callMaintenance.isPending ? (
          <Loader2 className={cn("animate-spin", isKiosk ? "h-14 w-14" : "h-11 w-11")} />
        ) : (
          <Wrench className={cn(isKiosk ? "h-14 w-14" : "h-11 w-11")} strokeWidth={2.5} />
        )}
        <span className={cn("font-extrabold", isKiosk ? "text-2xl" : "text-xl")}>
          {t("operator.callMaintenance", "Gọi bảo trì")}
        </span>
      </button>
    </div>
  );

  return (
    <DashboardLayout>
      <PageContainer className="max-w-4xl">
        {/* Header */}
        <PageHeader
          icon={<Factory className="h-6 w-6" />}
          title={t("operator.title", "Màn hình vận hành")}
          description={t("operator.subtitle", "Chạm một nút để bắt đầu")}
        />

        {/* U16 — offline indicator (sets expectations when connectivity drops) */}
        <OfflineBanner />

        {/* KIOSK: emergency row pinned to the very top (biggest, red/amber). */}
        {isKiosk && emergencyRow}

        {/* Role-aware "Today" summary (zero-click) — hidden in kiosk to keep it lean */}
        {!isKiosk && <TodayBriefing />}

        {/* Clock-in / start-stop production session (W4-E) */}
        <OperatorSessionControl />

        {/* "Line của tôi" strip */}
        {myFactories.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                {t("operator.myFactory", "Nhà máy của tôi")}:
              </span>
              <span className="font-semibold">
                {myFactories.map((f) => f.name).join(", ")}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate("/production-dashboard")}>
              {t("operator.viewWholePlant", "Xem cả nhà máy")}
            </Button>
          </div>
        )}

        {/* Big-button task grid */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {/* Quét máy → MachineQuickScan (custom big-tile trigger) */}
          <MachineQuickScan
            trigger={
              <Tile
                icon={ScanLine}
                label={t("operator.scanMachine", "Quét máy")}
                accent="border-sky-500/30 text-sky-600 dark:text-sky-400"
                onClick={() => {}}
                big={isKiosk}
              />
            }
          />

          {/* Đổi sản phẩm → ProductChangeoverWizard */}
          <Tile
            icon={Package}
            label={t("operator.changeover", "Đổi sản phẩm")}
            accent="border-teal-500/30 text-teal-600 dark:text-teal-400"
            onClick={() => navigate("/product-changeover")}
            big={isKiosk}
          />

          {/* Trạng thái dây chuyền (của tôi) → /production-dashboard[?factory] */}
          <Tile
            icon={Factory}
            label={
              singleFactory
                ? t("operator.myLine", "Dây chuyền của tôi")
                : t("operator.lineStatus", "Trạng thái dây chuyền")
            }
            accent="border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
            onClick={goMyLine}
            big={isKiosk}
          />

          {/* Non-kiosk: Báo sự cố tile (kiosk shows the big red row instead) */}
          {!isKiosk && (
            <QuickIssueReport
              trigger={
                <Tile
                  icon={AlertTriangle}
                  label={t("operator.reportIssue", "Báo sự cố")}
                  accent="border-red-500/40 text-red-600 dark:text-red-400"
                  onClick={() => {}}
                />
              }
            />
          )}

          {/* Non-kiosk: Gọi bảo trì tile */}
          {!isKiosk && (
            <Tile
              icon={Wrench}
              label={t("operator.callMaintenance", "Gọi bảo trì")}
              accent="border-amber-500/40 text-amber-600 dark:text-amber-400"
              onClick={handleCallMaintenance}
            />
          )}

          {/* Hỏi AI → /ai-chat */}
          <Tile
            icon={MessageSquare}
            label={t("operator.askAI", "Hỏi AI")}
            accent="border-violet-500/30 text-violet-600 dark:text-violet-400"
            onClick={() => navigate("/ai-chat")}
            big={isKiosk}
          />

          {/* Việc cần xử lý → AIActionInbox */}
          <Tile
            icon={Inbox}
            label={t("operator.actionInbox", "Việc cần xử lý")}
            accent="border-amber-500/30 text-amber-600 dark:text-amber-400"
            badge={pendingCount}
            onClick={() => setInboxOpen(true)}
            big={isKiosk}
          />
        </div>
      </PageContainer>

      {/* Controlled inbox dialog (1-tap approve) */}
      <AIActionInbox open={inboxOpen} onOpenChange={setInboxOpen} />

      {/* First-run coach — shown once per user on their landing (skip in kiosk) */}
      {!isKiosk && <FirstRunTour />}
    </DashboardLayout>
  );
}
