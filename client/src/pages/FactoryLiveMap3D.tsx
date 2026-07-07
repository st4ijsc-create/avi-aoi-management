/**
 * Factory Live Map (3D) — L4 plant view.
 *
 * A 3D floor of ONE factory: every machine is a block coloured by LIVE status
 * (digital shadow from real telemetry, refreshed every few seconds). Click a
 * machine to drill down → detail + jump to the cell twin / monitoring.
 *
 * This is the factory-scale layer above the per-cell 2D twin (/rf-test-cell):
 *   plant (this page) → line → machine → cell twin.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer, MetricCard } from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { PollFreshness } from "@/components/PollFreshness";
import FactoryFloor3D, { statusColor, statusLabel, type MachineNode } from "@/components/FactoryFloor3D";
import { Factory, Cpu, Activity, CheckCircle2, PauseCircle, XCircle, FlaskConical, Info, RefreshCw, Box, Move } from "lucide-react";

interface Row extends MachineNode {
  factory: { id: number; name: string; code: string };
}

export function FactoryLiveMap3DContent() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  // Poll hygiene (doc 27 B12): pause the 5s poll when the tab is hidden,
  // refetch immediately on return — see usePollingInterval.
  const polling = usePollingInterval(5000);
  const machinesQ = trpc.machineStatus.listWithStatus.useQuery(undefined, { ...polling });
  const [factoryId, setFactoryId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);

  const rows = (machinesQ.data ?? []) as unknown as Row[];

  // factory options derived from machines that actually exist
  const factories = useMemo(() => {
    const m = new Map<number, { id: number; name: string; code: string }>();
    for (const r of rows) if (r.factory) m.set(r.factory.id, r.factory);
    return [...m.values()];
  }, [rows]);

  const activeFactoryId = factoryId ?? factories[0]?.id ?? null;
  const machines = useMemo(() => rows.filter((r) => r.factory?.id === activeFactoryId), [rows, activeFactoryId]);

  const kpi = useMemo(() => {
    let running = 0, idle = 0, offline = 0, up = 0;
    for (const m of machines) {
      if (m.latestStatus !== "online") offline++;
      else if (m.heartbeatStatus === "idle" || m.heartbeatStatus === "stopped") idle++;
      else running++;
      up += m.uptimePercent ?? 0;
    }
    return { running, idle, offline, total: machines.length, avgUptime: machines.length ? up / machines.length : 0 };
  }, [machines]);

  return (
    <>
      <PageContainer fluid className="space-y-4">
        <PageHeader
          icon={<Factory className="h-6 w-6" />}
          title={t("flm.title", "Bản đồ nhà máy 3D (live)")}
          description={t("flm.subtitle", "Mỗi máy là một khối 3D tô màu theo trạng thái thực — bấm để xem chi tiết & mở mô phỏng cụm")}
          actions={
            <>
              {/* Stale badge (audit F10): honest "updated Ns ago" for the 5s poll. */}
              <PollFreshness updatedAt={machinesQ.dataUpdatedAt} isFetching={machinesQ.isFetching} />
              <Select value={activeFactoryId ? String(activeFactoryId) : undefined} onValueChange={(v) => { setFactoryId(Number(v)); setSelected(null); }}>
                <SelectTrigger className="w-[220px]"><SelectValue placeholder={t("flm.pickFactory", "Chọn nhà máy")} /></SelectTrigger>
                <SelectContent>
                  {factories.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => setLocation("/factory-floor-editor")}>
                <Move className="h-4 w-4 mr-1" /> {t("flm.editLayout", "Sửa mặt bằng")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => machinesQ.refetch()}>
                <RefreshCw className={`h-4 w-4 mr-1 ${machinesQ.isFetching ? "animate-spin" : ""}`} /> {t("flm.refresh", "Làm mới")}
              </Button>
            </>
          }
        />

        <div className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-info flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t("flm.shadowNote", "Đây là digital SHADOW — màu phản ánh telemetry/heartbeat THỰC của máy, tự cập nhật ~5s. Khác với digital TWIN (mô phỏng what-if) ở trang cụm.")}</span>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MetricCard label={t("flm.total", "Tổng máy")} value={kpi.total} icon={<Cpu className="h-4 w-4" />} />
          <MetricCard label={t("flm.running", "Đang chạy")} value={kpi.running} tone="success" icon={<CheckCircle2 className="h-4 w-4" />} />
          <MetricCard label={t("flm.idleStopped", "Chờ/Dừng")} value={kpi.idle} tone="warning" icon={<PauseCircle className="h-4 w-4" />} />
          <MetricCard label={t("flm.offline", "Ngoại tuyến")} value={kpi.offline} tone="danger" icon={<XCircle className="h-4 w-4" />} />
          <MetricCard label={t("flm.avgUptime", "Uptime TB")} value={`${kpi.avgUptime.toFixed(0)}%`} icon={<Activity className="h-4 w-4" />} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 3D floor */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Box className="h-4 w-4" /> {t("flm.floor", "Sàn nhà máy")} — {machines.length} {t("flm.machines", "máy")}</CardTitle></CardHeader>
            <CardContent>
              {machinesQ.isLoading ? (
                <Skeleton className="h-[560px] w-full rounded-md" />
              ) : machines.length === 0 ? (
                <div className="h-[560px] flex items-center justify-center text-muted-foreground text-sm">
                  {t("flm.empty", "Chưa có máy (đang hoạt động) trong nhà máy này. Thêm máy ở Master Data / Cấu trúc nhà máy.")}
                </div>
              ) : (
                <FactoryFloor3D machines={machines} selectedId={selected?.id ?? null} onSelect={(m) => setSelected(m as Row)} />
              )}
              <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-muted-foreground">
                <Legend color="#10b981" label={t("flm.running", "Đang chạy")} />
                <Legend color="#f59e0b" label={t("flm.idle", "Chờ")} />
                <Legend color="#f97316" label={t("flm.stopped", "Dừng")} />
                <Legend color="#ef4444" label={t("flm.offline", "Ngoại tuyến")} />
                <span className="ml-auto">{t("flm.tip", "Kéo để xoay • lăn chuột để zoom • bấm khối máy để chọn")}</span>
              </div>
            </CardContent>
          </Card>

          {/* drill-down panel */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t("flm.detail", "Chi tiết máy")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!selected ? (
                <p className="text-sm text-muted-foreground">{t("flm.selectHint", "Bấm vào một khối máy trên sàn 3D để xem chi tiết và drill-down.")}</p>
              ) : (
                <>
                  <div>
                    <div className="text-lg font-semibold">{selected.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{selected.code} • {selected.machineType}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge style={{ background: statusColor(selected) }} className="text-white">{statusLabel(selected)}</Badge>
                    <span className="text-xs text-muted-foreground">{selected.line?.name}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <MetricCard label={t("flm.uptime", "Uptime 24h")} value={`${(selected.uptimePercent ?? 0).toFixed(0)}%`} />
                    <MetricCard label={t("flm.heartbeat", "Heartbeat")} value={selected.heartbeatStatus || "—"} />
                  </div>
                  <div className="space-y-2 pt-1">
                    <Button size="sm" className="w-full" onClick={() => setLocation("/rf-test-cell")}>
                      <FlaskConical className="h-4 w-4 mr-1" /> {t("flm.openTwin", "Mở mô phỏng cụm (twin)")}
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => setLocation(`/machine/${selected.id}`)}>
                      <Activity className="h-4 w-4 mr-1" /> {t("flm.openCockpit", "Mở cockpit máy")}
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => setLocation("/orchestration-studio")}>
                      <Box className="h-4 w-4 mr-1" /> {t("flm.openStudio", "Lập trình quy trình")}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </PageContainer>
    </>
  );
}

export default function FactoryLiveMap3D() {
  return (
    <DashboardLayout>
      <FactoryLiveMap3DContent />
    </DashboardLayout>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: color }} /> {label}</span>;
}
