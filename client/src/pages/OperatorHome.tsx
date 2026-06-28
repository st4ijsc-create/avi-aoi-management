/**
 * OperatorHome — "/operator" — the simplified, kiosk/touch-friendly FRONT DOOR
 * for shop-floor operators (low-tech, gloves, tablets, big screens).
 *
 * Design goals (docs 05 minimal-effort UX): minimal cognitive load, BIG buttons
 * (≥96px tiles, ≥44px touch targets), high contrast, large readable labels, and
 * the operator's role-aware "Today" summary right at the top — zero clicks to a
 * personalized status.
 *
 * Everything here REUSES existing, battle-tested components — nothing is rebuilt:
 *   - <TodayBriefing/>        role-aware glanceable summary (top of page)
 *   - <MachineQuickScan/>     "Quét máy" → QR/NFC → /ai-chat?machine=…
 *   - <QuickIssueReport/>     "Báo sự cố" → AI-classified Andon
 *   - <AIActionInbox/>        "Việc cần xử lý" → 1-tap approve inbox
 *   - navigation to /production-dashboard and /ai-chat
 *
 * Rendered inside DashboardLayout like the other pages. Not role-locked: any
 * authenticated role can view it (each underlying action enforces its own RBAC),
 * but it is purpose-built for operators and is their default landing.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { TodayBriefing } from "@/components/TodayBriefing";
import MachineQuickScan from "@/components/MachineQuickScan";
import QuickIssueReport from "@/components/QuickIssueReport";
import { AIActionInbox } from "@/components/AIActionInbox";
import { FirstRunTour } from "@/components/FirstRunTour";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  ScanLine,
  AlertTriangle,
  Factory,
  MessageSquare,
  Inbox,
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
}

function Tile({ icon: Icon, label, onClick, accent, badge }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-2xl border-2 p-4 text-center",
        "transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40",
        "bg-card hover:bg-muted/60 shadow-sm",
        accent,
      )}
    >
      {badge != null && badge > 0 && (
        <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-red-500 px-2 text-sm font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      <Icon className="h-10 w-10 shrink-0" strokeWidth={2.25} />
      <span className="text-lg font-bold leading-tight tracking-tight">{label}</span>
    </button>
  );
}

export default function OperatorHome() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [inboxOpen, setInboxOpen] = useState(false);

  // Pending action count for the "Việc cần xử lý" tile badge (best-effort).
  const countQuery = trpc.aiInbox.count.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const pendingCount = countQuery.data?.count ?? 0;

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-4xl space-y-6 p-2 sm:p-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Factory className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t("operator.title", "Màn hình vận hành")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("operator.subtitle", "Chạm một nút để bắt đầu")}
            </p>
          </div>
        </div>

        {/* Role-aware "Today" summary (zero-click) */}
        <TodayBriefing />

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
              />
            }
          />

          {/* Báo sự cố → QuickIssueReport (custom big-tile trigger) */}
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

          {/* Trạng thái dây chuyền → /production-dashboard */}
          <Tile
            icon={Factory}
            label={t("operator.lineStatus", "Trạng thái dây chuyền")}
            accent="border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
            onClick={() => navigate("/production-dashboard")}
          />

          {/* Hỏi AI → /ai-chat */}
          <Tile
            icon={MessageSquare}
            label={t("operator.askAI", "Hỏi AI")}
            accent="border-violet-500/30 text-violet-600 dark:text-violet-400"
            onClick={() => navigate("/ai-chat")}
          />

          {/* Việc cần xử lý → AIActionInbox */}
          <Tile
            icon={Inbox}
            label={t("operator.actionInbox", "Việc cần xử lý")}
            accent="border-amber-500/30 text-amber-600 dark:text-amber-400"
            badge={pendingCount}
            onClick={() => setInboxOpen(true)}
          />
        </div>
      </div>

      {/* Controlled inbox dialog (1-tap approve) */}
      <AIActionInbox open={inboxOpen} onOpenChange={setInboxOpen} />

      {/* First-run coach — shown once per user on their landing */}
      <FirstRunTour />
    </DashboardLayout>
  );
}
