/**
 * AI Agent Command Center (doc69 Giai đoạn 4 / Wave E2, tasks E2-3 + E2-4).
 *
 * The visual payoff of Wave E2: renders the E2-1 roster read-model
 * (`trpc.aiAgentCenter.getReadModel`) + the E2-2 savings summary
 * (`trpc.aiAgentCenter.getSavingsSummary`) as an Agent Floor grid + a token
 * savings rail + a live task feed + a drill-in drawer. Consumes ONLY existing
 * endpoints — no new backend. Polls every 5s (mirrors AIBrainDashboard.tsx's own
 * `usePollingInterval(5000)` + ops-role gating pattern) — this stays as the
 * FALLBACK; E2-4 adds a realtime nudge on top of it.
 *
 * E2-4: joins the shared socket's `ai:agents` room (server/services/
 * aiAgentRealtime.ts — a NO-OP unless AI_AGENTS_LIVE_ENABLED, mirroring the
 * Twin live gateway) and, on any nudge, DEBOUNCED-invalidates getReadModel +
 * getSavingsSummary via useDebouncedInvalidate (coalesces bursts from several
 * agent choke points firing close together). The 5s poll above is left
 * completely untouched, so the page stays live even when the flag/socket is
 * off/disconnected — the nudge only makes it feel faster when it's on.
 *
 * HITL is preserved end-to-end: this page never auto-executes anything — see
 * AgentDrillInDrawer.tsx's docblock for exactly which existing mutations the
 * drill-in steer controls call and how visibility is gated to what the backend
 * would actually allow the current user to do.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, RefreshCw, ShieldAlert } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { useDebouncedInvalidate } from "@/hooks/useDebouncedInvalidate";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import { useAuth } from "@/_core/hooks/useAuth";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AgentFloor } from "@/components/agentCenter/AgentFloor";
import { TokenSavingsRail } from "@/components/agentCenter/TokenSavingsRail";
import { LiveTaskFeed } from "@/components/agentCenter/LiveTaskFeed";
import { AgentDrillInDrawer } from "@/components/agentCenter/AgentDrillInDrawer";
import { KillSwitchBar } from "@/components/agentCenter/KillSwitchBar";

export default function AIAgentCommandCenter() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Mirrors AIBrainDashboard.tsx's own D4 Agent Ops gate exactly — the backend
  // (aiAgentCenterRouter's opsAgentCenterProcedure) restricts both queries to
  // admin/engineer, so a non-ops viewer must never see a spinner/crash here.
  const isOpsRole = user?.role === "admin" || user?.role === "engineer";
  const isAdmin = user?.role === "admin";
  const polling = usePollingInterval(5000);

  const readModel = trpc.aiAgentCenter.getReadModel.useQuery({ limit: 50 }, { ...polling, enabled: isOpsRole });
  const savings = trpc.aiAgentCenter.getSavingsSummary.useQuery(undefined, { ...polling, enabled: isOpsRole });
  const utils = trpc.useUtils();

  // E2-4 — realtime nudge on top of the 5s poll above (poll stays untouched as
  // the fallback). A nudge carries no data (see aiAgentRealtime.ts on the
  // server) — it just tells us to refetch sooner via the SAME RBAC-gated
  // queries. Debounced so a burst of choke-point emits (e.g. propose+confirm)
  // coalesces into one refetch instead of one per event.
  const flushAgentNudge = useDebouncedInvalidate(() => {
    void utils.aiAgentCenter.getReadModel.invalidate();
    void utils.aiAgentCenter.getSavingsSummary.invalidate();
  }, 1500);

  useEffect(() => {
    if (!isOpsRole) return; // non-ops can't query this page's data anyway
    const socket = getSharedSocket();
    const onConnect = () => socket.emit("subscribe", { aiAgents: true });
    const onNudge = () => flushAgentNudge();
    socket.on("connect", onConnect);
    socket.on("ai:agents", onNudge);
    if (socket.connected) onConnect();
    return () => {
      socket.emit("unsubscribe", { aiAgents: true });
      socket.off("connect", onConnect);
      socket.off("ai:agents", onNudge);
      releaseSharedSocket();
    };
  }, [isOpsRole, flushAgentNudge]);

  // Store only the id, not the roster object itself — the drawer re-derives the
  // LIVE entry from the latest poll below so its header/summary stay fresh
  // instead of freezing on the snapshot the user happened to click.
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const selectedEntry = readModel.data?.roster.find((r) => r.id === selectedEntryId) ?? null;

  const refreshAll = () => {
    readModel.refetch();
    savings.refetch();
  };

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<Bot className="h-6 w-6 text-primary" />}
          title={t("agentCenter.title", "Agent Command Center")}
          description={t(
            "agentCenter.subtitle",
            "Đội hình AI agent toàn hệ thống — trạng thái, tiết kiệm token, hoạt động gần đây và can thiệp HITL",
          )}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={refreshAll}>
                <RefreshCw className="h-4 w-4 mr-1.5" />
                {t("common.refresh", "Làm mới")}
              </Button>
              <KillSwitchBar isAdmin={isAdmin} />
            </div>
          }
        />

        {!isOpsRole ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <ShieldAlert className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">{t("agentCenter.permissionDenied.title", "Không đủ quyền")}</p>
              <p className="text-sm max-w-md text-muted-foreground">
                {t("agentCenter.permissionDenied.desc", "Cần quyền admin hoặc kỹ thuật để xem Agent Command Center.")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {readModel.isError && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
                <ShieldAlert className="size-4 shrink-0" />
                {t("agentCenter.loadError", "Không thể tải dữ liệu Agent Command Center lúc này.")}
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 items-start">
              <div className="min-w-0">
                <AgentFloor roster={readModel.data?.roster} isLoading={readModel.isLoading} onSelect={(entry) => setSelectedEntryId(entry.id)} />
              </div>
              <div className="min-w-0">
                <TokenSavingsRail savings={savings.data} isLoading={savings.isLoading} />
              </div>
            </div>

            <LiveTaskFeed items={readModel.data?.taskFeed} isLoading={readModel.isLoading} />
          </>
        )}

        <AgentDrillInDrawer
          entry={selectedEntry}
          onOpenChange={(open) => {
            if (!open) setSelectedEntryId(null);
          }}
          sessions={readModel.data?.sessions ?? []}
          taskFeed={readModel.data?.taskFeed ?? []}
          currentUserId={user?.id}
          onMutated={() => utils.aiAgentCenter.getReadModel.invalidate()}
        />
      </PageContainer>
    </DashboardLayout>
  );
}
