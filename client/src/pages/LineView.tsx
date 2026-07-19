/**
 * doc 44 W3-B4 / G5.10 — LINE VIEW (SYNAPSE LDS-L5 Ch.4.2: "Sơ đồ tuyến, trạng
 * thái trạm, nhịp, nút cổ chai, WIP" — persona vận hành + kỹ sư).
 *
 * Đọc: trpc.lineController.{listStates,getState,stages,readiness,transitions}
 * (protectedProcedure — poll qua usePollingInterval + PollFreshness, KHÔNG tự
 * chế socket; WS uns:subscribe = W6 khi bật cờ).
 * Lệnh: trpc.lineController.command (actuationProcedure role-floor + 2FA server-
 * side) qua <LineCommandBar> — mỗi nút bọc ConfirmWithReason (spec §6.1 "xác
 * nhận theo rủi ro + lý do"), disable theo FSM map client (lineFsm.ts, mirror
 * drizzle/schema/lineController.ts).
 *
 * ISA-101: nền trung tính; màu chỉ cho bất thường (held/fault/blocked/starved/
 * bottleneck). Route /line-view/:lineId? — RouteGuard machine_status (đọc);
 * lệnh cần machine_control/canEdit (hiện-nhưng-khoá, doc 26 U4).
 */
import { useMemo, useState } from "react";
// doc 64 IA-10 S1 — truc pham vi ISA-95.
import { useScope } from "@/components/patterns/ScopeFilterBar";
import { useScopeWired } from "@/contexts/AssetScopeContext";
import { useTranslation } from "react-i18next";
import { useLocation, useRoute } from "wouter";
import {
  ClipboardList,
  ExternalLink,
  Loader2,
  Package,
  Timer,
  Waypoints,
} from "lucide-react";

import { trpc } from "@/lib/trpc";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { PollFreshness } from "@/components/PollFreshness";
import { EmptyState } from "@/components/EmptyState";
import {
  PageContainer,
  PageHeader,
  SectionCard,
  StatChip,
  StatChipRow,
  StatusBadge,
} from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import {
  LINE_VIEW_STATE_TONE,
  asLineViewState,
  formatMs,
  type LineViewState,
} from "@/components/lineView/lineFsm";
import { StationFlow, type StationStageView } from "@/components/lineView/StationFlow";
import { ReadinessPanel } from "@/components/lineView/ReadinessPanel";
import { LineCommandBar } from "@/components/lineView/LineCommandBar";
import { TransitionsTable, type TransitionRowView } from "@/components/lineView/TransitionsTable";

const CURRENT_PATH = "/line-view";

export default function LineView() {
  const { t } = useTranslation();
  const [location, setLocation] = useLocation();
  const [, params] = useRoute("/line-view/:lineId?");
  const crumbs = buildBreadcrumbs(location, t);

  const { hasPermission } = usePermissions();
  // Đọc đã được RouteGuard (machine_status) gate; lệnh cần machine_control/edit
  // (server actuationProcedure vẫn tái-gate role-floor + 2FA — đây chỉ là UX).
  const canControl = hasPermission("machine_control", "canEdit");

  // ── Chọn tuyến: URL /line-view/:lineId? là nguồn sự thật; không có → tuyến đầu.
  const routeLineId = params?.lineId != null && /^\d+$/.test(params.lineId) ? Number(params.lineId) : null;
  // doc 64 IA-10 S1 — trục phạm vi ISA-95 (đọc Chuyền từ header khi route không chỉ định).
  const { scope: assetScope } = useScope(["factory", "line"]);
  useScopeWired();

  const listPolling = usePollingInterval(15_000);
  const linesQ = trpc.lineController.listStates.useQuery(
    // doc 64 IA-10 S2 — danh sách tuyến lọc theo Xưởng của trục (server DEP-S2).
    { factoryId: assetScope.factoryId },
    { staleTime: 10_000, ...listPolling },
  );
  const lines = linesQ.data ?? [];
  // doc 64 IA-10 S1 — ưu tiên: route param (link chia sẻ) → trục phạm vi (header) → tuyến đầu.
  const selectedLineId = routeLineId ?? assetScope.lineId ?? lines[0]?.lineId ?? null;

  // ── Poll chi tiết ~5s (spec §5.2 — suy giảm mượt: PollFreshness hiện tuổi dữ liệu).
  const detailPolling = usePollingInterval(5_000);
  const stateQ = trpc.lineController.getState.useQuery(
    { lineId: selectedLineId ?? 0 },
    { enabled: selectedLineId != null, staleTime: 4_000, ...detailPolling },
  );
  const stagesQ = trpc.lineController.stages.useQuery(
    { lineId: selectedLineId ?? 0 },
    { enabled: selectedLineId != null, staleTime: 4_000, ...detailPolling },
  );
  const transitionsPolling = usePollingInterval(10_000);
  const transitionsQ = trpc.lineController.transitions.useQuery(
    { lineId: selectedLineId ?? 0, limit: 50 },
    { enabled: selectedLineId != null, staleTime: 8_000, ...transitionsPolling },
  );
  // Readiness chạy checklist THẬT server-side (không cache) → không poll; refetch
  // bằng nút "Kiểm tra lại" hoặc sau khi có lệnh.
  const readinessQ = trpc.lineController.readiness.useQuery(
    { lineId: selectedLineId ?? 0 },
    { enabled: selectedLineId != null, staleTime: 30_000, refetchOnWindowFocus: false },
  );

  const utils = trpc.useUtils();
  const invalidateAll = () => void utils.lineController.invalidate();

  const detail = stateQ.data ?? null;
  const state: LineViewState = asLineViewState(detail?.state) ?? "idle";
  const stages: StationStageView[] = (stagesQ.data?.stages ?? []) as StationStageView[];

  // ── Drawer chi tiết trạm (click card sơ đồ tuyến).
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const selectedStation = useMemo(
    () => stages.find((s) => s.stationId === selectedStationId) ?? null,
    [stages, selectedStationId],
  );

  // ── Nhịp: mục tiêu (takt_target_s) vs thực tế (avg cycle từ line_balance_metrics).
  const taktTargetMs = detail?.taktTargetS != null ? detail.taktTargetS * 1000 : null;
  const avgCycleMs = detail?.takt?.avgCycleTimeMs ?? null;
  const taktBehind = taktTargetMs != null && avgCycleMs != null && avgCycleMs > taktTargetMs;

  const stateLabel = (s: string) => t(`lineView.state.${s}`, s);

  return (
    <DashboardLayout title={t("lineView.title", "Line View")} navItems={navItems} currentPath={CURRENT_PATH}>
      <PageContainer className="space-y-6">
        {/* doc65 V2: KHÔNG truyền breadcrumbs — DashboardLayout đã render breadcrumb ở
            thanh trên; truyền vào PageHeader làm breadcrumb xuất hiện 2 LẦN trên màn. */}
        <PageHeader
          icon={<Waypoints className="h-6 w-6" />}
          title={t("lineView.title", "Line View")}
          description={t(
            "lineView.subtitle",
            "Sơ đồ tuyến: trạng thái FSM, nhịp, nút cổ chai, trạm nghẽn/đói liệu và lệnh tuyến.",
          )}
          actions={
            <div className="flex items-center gap-2">
              <PollFreshness updatedAt={stateQ.dataUpdatedAt} isFetching={stateQ.isFetching} />
              <Select
                value={selectedLineId != null ? String(selectedLineId) : undefined}
                onValueChange={(v) => setLocation(`/line-view/${v}`)}
                disabled={lines.length === 0}
              >
                <SelectTrigger className="w-72">
                  <SelectValue placeholder={t("lineView.selectLine", "Chọn tuyến")} />
                </SelectTrigger>
                <SelectContent>
                  {lines.map((l) => (
                    <SelectItem key={l.lineId} value={String(l.lineId)}>
                      <span className="flex items-center gap-2">
                        <span className="truncate">
                          {l.code} · {l.name}
                        </span>
                        <StatusBadge
                          status={l.state}
                          tone={LINE_VIEW_STATE_TONE[asLineViewState(l.state) ?? "idle"]}
                          label={stateLabel(l.state)}
                          className="px-1.5 py-0 text-[10px]"
                        />
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />

        {linesQ.isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!linesQ.isLoading && lines.length === 0 && (
          <EmptyState
            icon={Waypoints}
            title={t("lineView.noLines", "Chưa có tuyến ACTIVE nào")}
            description={t(
              "lineView.noLinesDesc",
              "Tạo production line (kèm trạm và máy) trong Dữ liệu chủ để dùng Line View.",
            )}
          />
        )}

        {selectedLineId != null && !linesQ.isLoading && lines.length > 0 && (
          <>
            {/* ── Header trạng thái tuyến + lệnh ─────────────────────────────── */}
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge
                      status={state}
                      tone={LINE_VIEW_STATE_TONE[state]}
                      label={stateLabel(state)}
                      className="px-3 py-1 text-sm font-semibold"
                    />
                    {detail?.heldReason && state === "held" && (
                      <span className="text-sm text-warning" title={t("lineView.kpi.heldReason", "Lý do giữ")}>
                        {t("lineView.kpi.heldReason", "Lý do giữ")}: {detail.heldReason}
                      </span>
                    )}
                    {detail?.enteredAt && (
                      <span className="text-xs text-muted-foreground">
                        {t("lineView.kpi.inStateSince", "Vào trạng thái lúc {{time}}", {
                          time: new Date(detail.enteredAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }),
                        })}
                      </span>
                    )}
                  </div>
                  <LineCommandBar
                    lineId={selectedLineId}
                    lineCode={detail?.code ?? String(selectedLineId)}
                    state={state}
                    canControl={canControl}
                    onSettled={invalidateAll}
                  />
                </div>

                {/* Nhịp + đơn hàng + recipe — honest "—" khi analytics chưa có dữ liệu. */}
                <StatChipRow>
                  <StatChip
                    icon={<Timer className="size-3.5" />}
                    label={t("lineView.kpi.taktTarget", "Takt mục tiêu")}
                    value={detail?.taktTargetS != null ? `${detail.taktTargetS}s` : "—"}
                  />
                  <StatChip
                    label={t("lineView.kpi.cycleAvg", "Chu kỳ TB")}
                    value={formatMs(avgCycleMs)}
                    tone={taktBehind ? "warning" : "default"}
                    title={
                      taktBehind
                        ? t("lineView.kpi.behindTakt", "Chu kỳ thực tế đang CHẬM hơn takt mục tiêu")
                        : undefined
                    }
                  />
                  <StatChip
                    label={t("lineView.kpi.throughput", "Sản lượng (cửa sổ)")}
                    value={detail?.takt ? detail.takt.throughputUnits : "—"}
                  />
                  <StatChip
                    label={t("lineView.kpi.utilization", "Hiệu suất sử dụng")}
                    value={
                      detail?.takt?.utilizationPct != null ? `${Math.round(detail.takt.utilizationPct)}%` : "—"
                    }
                  />
                  <StatChip
                    icon={<ClipboardList className="size-3.5" />}
                    label={t("lineView.kpi.activeOrder", "Đơn hàng")}
                    value={detail?.activeOrderId != null ? `#${detail.activeOrderId}` : "—"}
                  />
                  <StatChip
                    icon={<Package className="size-3.5" />}
                    label={t("lineView.kpi.recipeSet", "Recipe set")}
                    value={detail?.recipeSetRef ?? "—"}
                  />
                </StatChipRow>
              </CardContent>
            </Card>

            {/* ── Sơ đồ tuyến ngang (trạm trái→phải, bottleneck từ getState) ──── */}
            <SectionCard
              title={t("lineView.flow.title", "Sơ đồ tuyến")}
              description={
                stagesQ.data
                  ? t("lineView.flow.window", "Cửa sổ quan sát dwell: {{minutes}} phút — ngưỡng nghẽn/đói {{threshold}}", {
                      minutes: Math.round(
                        (new Date(stagesQ.data.windowTo).getTime() - new Date(stagesQ.data.windowFrom).getTime()) /
                          60000,
                      ),
                      threshold: formatMs(stagesQ.data.stallThresholdMs),
                    })
                  : undefined
              }
            >
              {stagesQ.isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <StationFlow
                  stages={stages}
                  bottleneckStationId={detail?.bottleneck?.stationId ?? null}
                  bottleneckMachineId={detail?.bottleneck?.machineId ?? null}
                  onSelectStation={setSelectedStationId}
                />
              )}
            </SectionCard>

            {/* ── Readiness + lịch sử transition ─────────────────────────────── */}
            <div className="grid gap-6 xl:grid-cols-2">
              <ReadinessPanel
                readiness={readinessQ.data}
                isLoading={readinessQ.isLoading}
                isFetching={readinessQ.isFetching}
                onRecheck={() => void readinessQ.refetch()}
              />
              <SectionCard title={t("lineView.transitions.title", "Lịch sử chuyển trạng thái")}>
                <TransitionsTable
                  rows={(transitionsQ.data ?? []) as TransitionRowView[]}
                  loading={transitionsQ.isLoading}
                />
              </SectionCard>
            </div>
          </>
        )}

        {/* ── Drawer chi tiết trạm — link cockpit máy /machine/:id sẵn có ────── */}
        <Sheet open={selectedStation != null} onOpenChange={(o) => !o && setSelectedStationId(null)}>
          <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
            <SheetHeader>
              <SheetTitle>
                {t("lineView.drawer.title", "Trạm {{name}}", { name: selectedStation?.name ?? "" })}
              </SheetTitle>
              <SheetDescription>{selectedStation?.code}</SheetDescription>
            </SheetHeader>
            {selectedStation && (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
                {/* Nhịp trạm — dwell/blocked/starved trong cửa sổ quan sát. */}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md border p-2">
                    <p className="text-xs text-muted-foreground">{t("lineView.flow.cycleTarget", "Chu kỳ mục tiêu")}</p>
                    <p className="font-medium tabular-nums">
                      {selectedStation.cycleTimeTargetS != null ? `${selectedStation.cycleTimeTargetS}s` : "—"}
                    </p>
                  </div>
                  <div className="rounded-md border p-2">
                    <p className="text-xs text-muted-foreground">{t("lineView.drawer.dwellAvg", "Dwell TB")}</p>
                    <p className="font-medium tabular-nums">
                      {selectedStation.dwell ? formatMs(selectedStation.dwell.avgDwellMs) : "—"}
                    </p>
                  </div>
                  <div className={selectedStation.blocked ? "rounded-md border border-warning/60 p-2" : "rounded-md border p-2"}>
                    <p className="text-xs text-muted-foreground">{t("lineView.flow.blocked", "Nghẽn (blocked)")}</p>
                    <p className="font-medium tabular-nums">
                      {selectedStation.dwell ? formatMs(selectedStation.dwell.avgBlockedMs) : "—"}
                    </p>
                  </div>
                  <div className={selectedStation.starved ? "rounded-md border border-warning/60 p-2" : "rounded-md border p-2"}>
                    <p className="text-xs text-muted-foreground">{t("lineView.flow.starved", "Đói liệu (starved)")}</p>
                    <p className="font-medium tabular-nums">
                      {selectedStation.dwell ? formatMs(selectedStation.dwell.avgStarvedMs) : "—"}
                    </p>
                  </div>
                </div>
                {selectedStation.dwell && (
                  <p className="text-xs text-muted-foreground">
                    {t("lineView.drawer.samples", "{{count}} mẫu dwell trong cửa sổ quan sát", {
                      count: selectedStation.dwell.samples,
                    })}
                  </p>
                )}

                {/* Máy của trạm → mở cockpit /machine/:id. */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("lineView.drawer.machines", "Máy trong trạm")}</p>
                  {selectedStation.machines.length === 0 && (
                    <p className="text-sm text-muted-foreground">{t("lineView.flow.noMachines", "Chưa gán máy")}</p>
                  )}
                  {selectedStation.machines.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium" title={m.name}>
                          {m.code} · {m.name}
                        </p>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{m.machineType}</span>
                          <span aria-hidden="true">·</span>
                          <span>{t(`lineView.drawer.presence.${m.presence}`, m.presence)}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={m.opState} className="text-[10px]" />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setLocation(`/machine/${m.id}`)}
                          title={t("lineView.drawer.openMachine", "Mở cockpit máy")}
                        >
                          <ExternalLink className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </PageContainer>
    </DashboardLayout>
  );
}
