/**
 * AI Action Inbox — a single push surface for "work that needs you", 1-tap.
 *
 * Consumes trpc.aiInbox.* (list/count/dismiss). Approving a PROPOSAL reuses the
 * EXISTING HITL confirm mutation the chat uses — trpc.aiCopilot.confirmAction
 * with { actionId, token, lang } — so the server re-checks RBAC and executes
 * from the DB row. This component NEVER calls a write endpoint directly.
 *
 * Surface: a right-side slide-over (Sheet) opened from a header launcher with an
 * unread count badge. Items are severity-sorted by the server (critical→info).
 * Big text + large touch targets for kiosk/tablet. Localized vi/en/zh.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { getSharedSocket } from "@/lib/socketManager";
import { RealtimeBadge, useSocketConnected } from "@/components/RealtimeBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircle,
  Eye,
  X,
  Cpu,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types (mirror server/services/aiActionInbox.ts InboxItem) ─────────────────

type InboxItemType = "proposal" | "insight" | "alert";
type InboxAction = "approve" | "dismiss" | "ask" | "view";
type InboxSeverity = "critical" | "warning" | "info";

interface InboxItem {
  id: string;
  type: InboxItemType;
  severity: InboxSeverity;
  title: string;
  body: string;
  actions: InboxAction[];
  machineCode?: string | null;
  createdAt: string;
  actionId?: string;
  token?: string;
  tool?: string;
  expiresAt?: string;
  recommendation?: string | null;
}

// ─── Severity → visual style ───────────────────────────────────────────────────

function severityStyle(sev: InboxSeverity) {
  switch (sev) {
    case "critical":
      return {
        ring: "border-l-4 border-l-red-500",
        chip: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
        icon: "text-red-600 dark:text-red-400",
      };
    case "warning":
      return {
        ring: "border-l-4 border-l-amber-500",
        chip: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
        icon: "text-amber-600 dark:text-amber-400",
      };
    default:
      return {
        ring: "border-l-4 border-l-blue-500",
        chip: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
        icon: "text-blue-600 dark:text-blue-400",
      };
  }
}

function TypeIcon({ type, className }: { type: InboxItemType; className?: string }) {
  if (type === "proposal") return <CheckCircle2 className={className} />;
  if (type === "alert") return <AlertTriangle className={className} />;
  return <Lightbulb className={className} />;
}

// ─── Live TTL countdown for a proposal's expiresAt ─────────────────────────────

function useCountdown(expiresAt?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const msLeft = Math.max(0, new Date(expiresAt).getTime() - now);
  const totalSec = Math.floor(msLeft / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return {
    expired: msLeft <= 0,
    label: `${mm}:${ss.toString().padStart(2, "0")}`,
    urgent: msLeft > 0 && msLeft <= 60_000,
  };
}

// ─── Single inbox card ─────────────────────────────────────────────────────────

function InboxCard({
  item,
  busy,
  onApprove,
  onDismiss,
  onAsk,
}: {
  item: InboxItem;
  busy: boolean;
  onApprove: (item: InboxItem) => void;
  onDismiss: (item: InboxItem) => void;
  onAsk: (item: InboxItem) => void;
}) {
  const { t } = useTranslation();
  const s = severityStyle(item.severity);
  const ttl = useCountdown(item.expiresAt);
  const actions = item.actions ?? [];

  return (
    <div className={cn("rounded-lg border bg-card p-3.5 shadow-sm", s.ring)}>
      <div className="flex items-start gap-3">
        <TypeIcon type={item.type} className={cn("size-6 shrink-0 mt-0.5", s.icon)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={cn("text-[11px] font-semibold", s.chip)}>
              {t(`aiInbox.severity.${item.severity}`)}
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              {t(`aiInbox.type.${item.type}`)}
            </Badge>
            {item.machineCode && (
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                <Cpu className="size-3" />
                {item.machineCode}
              </span>
            )}
            {ttl && (
              <span
                className={cn(
                  "ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono font-semibold tabular-nums",
                  ttl.urgent
                    ? "border-red-300 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                    : "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
                )}
                title={t("aiInbox.expiresLabel")}
              >
                <Clock className="size-3" />
                {ttl.expired ? "0:00" : ttl.label}
              </span>
            )}
          </div>

          <p className="mt-1.5 text-[15px] font-semibold leading-snug text-foreground break-words">
            {item.title}
          </p>
          {item.body && item.body !== item.title && (
            <p className="mt-1 text-sm leading-snug text-muted-foreground break-words">
              {item.body}
            </p>
          )}
          {item.recommendation && (
            <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[13px] leading-snug text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              💡 {item.recommendation}
            </p>
          )}

          {/* 1-tap actions (large touch targets) */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {actions.includes("approve") && (
              <Button
                className="h-10 min-h-[40px] px-4 text-sm font-semibold"
                disabled={busy || (ttl?.expired ?? false)}
                onClick={() => onApprove(item)}
              >
                {busy ? <Loader2 className="size-4 animate-spin mr-1.5" /> : (
                  <CheckCircle2 className="size-4 mr-1.5" />
                )}
                {t("aiInbox.actions.approve")}
              </Button>
            )}
            {(actions.includes("ask") || actions.includes("view")) && (
              <Button
                variant="outline"
                className="h-10 min-h-[40px] px-4 text-sm"
                disabled={busy}
                onClick={() => onAsk(item)}
              >
                {actions.includes("view") ? (
                  <Eye className="size-4 mr-1.5" />
                ) : (
                  <MessageCircle className="size-4 mr-1.5" />
                )}
                {t(actions.includes("view") ? "aiInbox.actions.view" : "aiInbox.actions.ask")}
              </Button>
            )}
            {actions.includes("dismiss") && (
              <Button
                variant="ghost"
                className="h-10 min-h-[40px] px-3 text-sm text-muted-foreground"
                disabled={busy}
                onClick={() => onDismiss(item)}
              >
                <X className="size-4 mr-1" />
                {t("aiInbox.actions.dismiss")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Drawer ────────────────────────────────────────────────────────────────────

export function AIActionInbox({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  // Refetch on open + a light interval keeps it realtime-ish.
  const listQuery = trpc.aiInbox.list.useQuery(
    { limit: 50 },
    { enabled: open, refetchInterval: open ? 30_000 : false, refetchOnWindowFocus: false },
  );

  const confirmActionMutation = trpc.aiCopilot.confirmAction.useMutation();
  const dismissMutation = trpc.aiInbox.dismiss.useMutation();

  const connected = useSocketConnected();
  const items = (listQuery.data?.items ?? []) as InboxItem[];
  const busyId = confirmActionMutation.isPending || dismissMutation.isPending;

  const invalidate = () => {
    void utils.aiInbox.list.invalidate();
    void utils.aiInbox.count.invalidate();
  };

  // Realtime refresh: new work (proposals/alerts) is pushed over the socket, so
  // refetch the inbox the moment a relevant event lands instead of only polling.
  useEffect(() => {
    if (!open) return;
    const socket = getSharedSocket();
    const refresh = () => invalidate();
    const events = [
      "andon:event",
      "inspection:alert",
      "ng:alert",
      "yield:warning",
      "qualityGate:triggered",
      "ai:proposal",
      "ai:inbox_update",
    ];
    events.forEach((e) => socket.on(e, refresh));
    return () => {
      events.forEach((e) => socket.off(e, refresh));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // APPROVE — reuse the EXISTING HITL confirm mutation (RBAC + execute on server).
  const handleApprove = async (item: InboxItem) => {
    const actionId = item.actionId ?? item.id;
    const token = item.token ?? item.id;
    if (!actionId || !token) return;
    try {
      const res = await confirmActionMutation.mutateAsync({
        actionId,
        token,
        lang: (i18n.language as "vi" | "en" | "zh") ?? "vi",
      });
      if (res.ok) toast.success(res.message ?? t("aiInbox.toast.approved"));
      else toast.error(res.message ?? t("aiInbox.toast.failed"));
    } catch {
      toast.error(t("aiInbox.toast.failed"));
    } finally {
      invalidate();
    }
  };

  // DISMISS — acknowledge insight / cancel proposal (never executes).
  const handleDismiss = async (item: InboxItem) => {
    try {
      await dismissMutation.mutateAsync({ type: item.type, id: item.id });
      toast.success(t("aiInbox.toast.dismissed"));
    } catch {
      toast.error(t("aiInbox.toast.failed"));
    } finally {
      invalidate();
    }
  };

  // ASK / VIEW — deep-link to the AI assistant prefilled with a contextual question.
  const handleAsk = (item: InboxItem) => {
    const ctx = item.machineCode ? ` (${item.machineCode})` : "";
    const q = `${item.title}${ctx} — ${t("aiInbox.askPrefix")}`;
    onOpenChange(false);
    setLocation(`/ai-chat?q=${encodeURIComponent(q)}`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full p-0 sm:max-w-md flex flex-col">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="size-5 text-primary" />
            {t("aiInbox.title")}
            {items.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {items.length}
              </Badge>
            )}
            <RealtimeBadge connected={connected} pollingFallback className="ml-auto" />
          </SheetTitle>
          <SheetDescription>{t("aiInbox.subtitle")}</SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="space-y-3 p-4">
            {listQuery.isLoading ? (
              // Loading skeleton
              <>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded-lg border p-3.5">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="mt-2 h-5 w-3/4" />
                    <Skeleton className="mt-2 h-4 w-1/2" />
                    <Skeleton className="mt-3 h-10 w-32" />
                  </div>
                ))}
              </>
            ) : items.length === 0 ? (
              // Empty state
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <CheckCircle2 className="size-8 text-primary" />
                </div>
                <p className="text-base font-semibold text-foreground">
                  {t("aiInbox.empty")}
                </p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  {t("aiInbox.emptyHint")}
                </p>
              </div>
            ) : (
              items.map((item) => (
                <InboxCard
                  key={`${item.type}:${item.id}`}
                  item={item}
                  busy={busyId}
                  onApprove={handleApprove}
                  onDismiss={handleDismiss}
                  onAsk={handleAsk}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ─── Header launcher + count badge (poll ~30s) ─────────────────────────────────

export function AIActionInboxLauncher() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  const countQuery = trpc.aiInbox.count.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const count = countQuery.data?.count ?? 0;
  // Server may expose a critical sub-count; fall back gracefully if absent.
  const criticalCount = (countQuery.data as { critical?: number } | undefined)?.critical ?? 0;
  const hasUnread = count > 0;

  // Realtime: bump the unread badge the instant new work is pushed.
  useEffect(() => {
    const socket = getSharedSocket();
    const refresh = () => void utils.aiInbox.count.invalidate();
    const events = [
      "andon:event",
      "inspection:alert",
      "ng:alert",
      "yield:warning",
      "qualityGate:triggered",
      "ai:proposal",
      "ai:inbox_update",
    ];
    events.forEach((e) => socket.on(e, refresh));
    return () => {
      events.forEach((e) => socket.off(e, refresh));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        onClick={() => setOpen(true)}
        title={t("aiInbox.title")}
        aria-label={
          hasUnread ? t("aiInbox.unreadAria", { count }) : t("aiInbox.title")
        }
      >
        <Lightbulb className="h-5 w-5" />
        {hasUnread && (
          <span
            className={cn(
              "absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white",
              criticalCount > 0 ? "bg-red-500 animate-pulse" : "bg-amber-500",
            )}
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </Button>
      <AIActionInbox open={open} onOpenChange={setOpen} />
    </>
  );
}
