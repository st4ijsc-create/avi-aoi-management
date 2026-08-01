/**
 * System Health — doc 24 Tier-1b.
 *
 * Surfaces the internal health/status getters built in Waves 1/3 that previously
 * had NO UI or route:
 *   • OT telemetry store-and-forward WAL buffer   (systemHealth.storeForwardStatus)
 *   • OT connection HA supervisors (per adapter)  (systemHealth.connectionSupervisors)
 *   • DINOv2 visual-embedding model health/tier   (systemHealth.aiModelHealth)
 * plus two adjacent admin/interchange surfaces that already had procedures:
 *   • Hardware commissioning (FAT) sign-off ledger (commissioning.*, admin_system)
 *   • Digital-twin USD / DTDL export (download)     (twin.usdExport / twin.twinModels)
 *
 * 100% READ-ONLY for the health panels — opens no device-control path. Honest
 * empty / loading / degraded states throughout (flags off ⇒ enabled:false etc.).
 * RBAC: page is gated on machine_monitoring; the commissioning panel additionally
 * self-gates on admin_system (hidden for non-admins).
 */
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import {
  PageHeader,
  PageContainer,
  MetricCard,
  StatusBadge,
  SectionCard,
} from "@/components/patterns";
import type { StatusMapEntry } from "@/components/patterns";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Activity, Database, Waypoints, Cpu, ShieldCheck, Download, RefreshCw,
  AlertTriangle, Info, ClipboardCheck, Plug, FileDown, Boxes, Loader2,
} from "lucide-react";
import { toast } from "sonner";

// ── typed router outputs (avoid ReturnType<useQuery> overload collapse to {}) ──
type SysOut = inferRouterOutputs<AppRouter>["systemHealth"];
type StoreForwardStatus = SysOut["storeForwardStatus"];
type ConnSupervisorsOut = SysOut["connectionSupervisors"];
type AiModelHealthOut = SysOut["aiModelHealth"];
type DbIngestHealthOut = SysOut["dbIngestHealth"];

/** Minimal structural shape of a tRPC/React-Query result — the fields this page
 *  reads. The real query result is assignable to this, so passing it as a prop
 *  keeps full type-safety WITHOUT `ReturnType<typeof …useQuery>` (which resolves
 *  the wrong overload and degrades `data` to `{}`). */
interface QueryLike<T> {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: { message: string } | null;
}

// ── small helpers ─────────────────────────────────────────────────────────────

/** Format an ISO string / Date / null into a locale string (or an em-dash). */
function fmtTime(v: string | Date | null | undefined): string {
  if (v == null) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Humanize a millisecond duration into a compact "2h" / "45m" / "30s". */
function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function downloadText(text: string, filename: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ════════════════════════════════════════════════════════════════════════════
// Page
// ════════════════════════════════════════════════════════════════════════════

export default function SystemHealth() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();

  const sfQuery = trpc.systemHealth.storeForwardStatus.useQuery(undefined, { refetchInterval: 15_000 });
  const supQuery = trpc.systemHealth.connectionSupervisors.useQuery(undefined, { refetchInterval: 15_000 });
  const aiQuery = trpc.systemHealth.aiModelHealth.useQuery(undefined, { refetchInterval: 30_000 });

  const refreshAll = () => {
    void utils.systemHealth.storeForwardStatus.invalidate();
    void utils.systemHealth.connectionSupervisors.invalidate();
    void utils.systemHealth.aiModelHealth.invalidate();
  };

  const anyLoading = sfQuery.isFetching || supQuery.isFetching || aiQuery.isFetching;

  return (
    <DashboardLayout title={t("systemHealth.title", "System Health")} navItems={navItems} currentPath="/system-health">
      <PageContainer>
        <PageHeader
          icon={<Activity className="h-6 w-6" />}
          title={t("systemHealth.title", "System Health")}
          badge={<ViewOnlyBadge module="machine_monitoring" />}
          description={t(
            "systemHealth.subtitle",
            "Trạng thái nội bộ thời gian thực: bộ đệm store-and-forward telemetry OT, giám sát kết nối HA theo adapter, và tình trạng model thị giác DINOv2. Chỉ đọc — không mở đường ghi thiết bị.",
          )}
          actions={
            <Button variant="outline" onClick={refreshAll} disabled={anyLoading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${anyLoading ? "animate-spin" : ""}`} />
              {t("common.refresh", "Làm mới")}
            </Button>
          }
        />

        <StoreForwardSection query={sfQuery} />
        <DbIngestHealthSection />
        <ConnectionSupervisorsSection query={supQuery} />
        <AiModelHealthSection query={aiQuery} />
        <TwinExportSection />
        <CommissioningPanel />
      </PageContainer>
    </DashboardLayout>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 1) OT telemetry store-and-forward
// ════════════════════════════════════════════════════════════════════════════

function StoreForwardSection({ query }: { query: QueryLike<StoreForwardStatus> }) {
  const { t } = useTranslation();
  const s = query.data;

  const health: StatusMapEntry & { status: string } = useMemo(() => {
    if (!s) return { status: t("common.loading", "Đang tải…"), tone: "default" };
    if (!s.enabled) return { status: t("systemHealth.sf.disabled", "Tắt (passthrough)"), tone: "default" };
    if (s.bufferedCount > 0) return { status: t("systemHealth.sf.buffering", "Đang đệm (DB không sẵn sàng)"), tone: "warning" };
    return { status: t("systemHealth.sf.healthy", "Khỏe"), tone: "success" };
  }, [s, t]);

  const droppedTotal = s ? s.droppedOverflow + s.droppedAge : 0;

  return (
    <SectionCard
      icon={<Database className="h-5 w-5 text-primary" />}
      title={t("systemHealth.sf.title", "Store-and-forward telemetry OT")}
      description={t(
        "systemHealth.sf.desc",
        "Bộ đệm WAL trên đĩa giữ các mẫu telemetry khi DB/TSDB mất kết nối, phát lại (backfill) khi phục hồi — không mẫu nào bị bỏ âm thầm.",
      )}
      action={<StatusBadge status={health.status} tone={health.tone} />}
    >
      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading", "Đang tải…")}
        </div>
      ) : query.isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive py-6">
          <AlertTriangle className="h-4 w-4" /> {query.error?.message}
        </div>
      ) : !s ? null : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard
              icon={<Database className="h-4 w-4" />}
              label={t("systemHealth.sf.buffered", "Đang đệm")}
              value={s.bufferedCount}
              tone={s.bufferedCount > 0 ? "warning" : "default"}
              delta={t("systemHealth.sf.bufferedTotal", "tổng đã đệm: {{n}}", { n: s.buffered })}
            />
            <MetricCard
              icon={<RefreshCw className="h-4 w-4" />}
              label={t("systemHealth.sf.backfilled", "Đã backfill")}
              value={s.backfilled}
              tone={s.backfilled > 0 ? "success" : "default"}
              delta={t("systemHealth.sf.deduped", "deduped: {{n}}", { n: s.deduped })}
            />
            <MetricCard
              icon={<AlertTriangle className="h-4 w-4" />}
              label={t("systemHealth.sf.dropped", "Đã bỏ (overflow+age)")}
              value={droppedTotal}
              tone={droppedTotal > 0 ? "danger" : "default"}
              delta={t("systemHealth.sf.droppedSplit", "overflow {{o}} · age {{a}}", { o: s.droppedOverflow, a: s.droppedAge })}
            />
            <MetricCard
              icon={<Info className="h-4 w-4" />}
              label={t("systemHealth.sf.capacity", "Giới hạn bộ đệm")}
              value={s.maxEntries.toLocaleString()}
              delta={t("systemHealth.sf.maxAge", "tuổi tối đa: {{d}}", { d: fmtDuration(s.maxAgeMs) })}
            />
          </div>

          <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm md:grid-cols-2">
            <InfoRow label={t("systemHealth.sf.enabled", "Bật (OT_STORE_FORWARD_ENABLED)")} value={
              <StatusBadge status={s.enabled ? "on" : "off"} tone={s.enabled ? "success" : "default"} label={s.enabled ? t("common.on", "Bật") : t("common.off", "Tắt")} />
            } />
            <InfoRow label={t("systemHealth.sf.lastBackfill", "Backfill gần nhất")} value={fmtTime(s.lastBackfillAt)} />
            <InfoRow label={t("systemHealth.sf.lastBuffered", "Đệm gần nhất")} value={fmtTime(s.lastBufferedAt)} />
            <InfoRow label={t("systemHealth.sf.walFile", "Tệp WAL")} value={<code className="text-xs break-all">{s.walFile}</code>} />
          </div>

          {!s.enabled && (
            <p className="text-xs text-muted-foreground">
              {t("systemHealth.sf.disabledNote", "Cờ đang tắt → hành vi passthrough như hiện tại (chèn thẳng vào DB). Bật OT_STORE_FORWARD_ENABLED để kích hoạt bộ đệm bền vững.")}
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 1b) DB & Ingest health — W4-A (doc 27 gap B1). Admin-only (admin_system):
//     slow-query monitor (instrumented drizzle client), inspection-ingest WAL
//     depth (deferred W2-C), db_feature_status / timescale state (deferred W1-A).
// ════════════════════════════════════════════════════════════════════════════

function DbIngestHealthSection() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("admin_system", "canView");
  const query = trpc.systemHealth.dbIngestHealth.useQuery(undefined, {
    refetchInterval: 30_000,
    enabled: canView,
  });
  const d: DbIngestHealthOut | undefined = query.data;

  const featureTone: Record<string, StatusMapEntry["tone"]> = useMemo(() => ({
    ok: "success",
    partial: "warning",
    deferred: "warning",
    skipped: "warning",
    missing: "error",
  }), []);

  if (!canView) return null;

  const qm = d?.queryMonitor;
  const wal = d?.inspectionWal;
  const walDepth = wal?.bufferedCount ?? 0;
  const walTone: "success" | "warning" | "danger" =
    walDepth >= 500 ? "danger" : walDepth >= 100 ? "warning" : "success";

  const monitorBadge = qm == null
    ? null
    : qm.enabled
      ? <StatusBadge status="on" tone="success" label={t("systemHealth.db.monitorOn", "Monitor bật · ngưỡng {{n}}ms", { n: qm.thresholdMs })} />
      : <StatusBadge status="off" tone="warning" label={t("systemHealth.db.monitorOff", "Monitor tắt (QUERY_MONITOR_ENABLED)")} />;

  return (
    <SectionCard
      icon={<Database className="h-5 w-5 text-primary" />}
      title={t("systemHealth.db.title", "Sức khỏe DB & Ingest")}
      description={t(
        "systemHealth.db.desc",
        "Truy vấn chậm (đo trực tiếp trên client drizzle, SQL đã chuẩn hóa — không lưu tham số), độ sâu WAL ingest kiểm tra, và trạng thái tính năng DB (TimescaleDB / partition / FK). Chỉ admin.",
      )}
      action={monitorBadge}
    >
      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading", "Đang tải…")}
        </div>
      ) : query.isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive py-6">
          <AlertTriangle className="h-4 w-4" /> {query.error?.message}
        </div>
      ) : !d || !qm ? null : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard
              icon={<Database className="h-4 w-4" />}
              label={t("systemHealth.db.walDepth", "WAL ingest kiểm tra")}
              value={walDepth}
              tone={wal?.enabled === false ? "default" : walTone}
              delta={
                wal?.enabled === false
                  ? t("systemHealth.db.walOff", "tắt (passthrough)")
                  : t("systemHealth.db.walDelta", "backfill {{b}} · dead-letter {{d}}", {
                      b: wal?.backfilled ?? 0, d: wal?.deadLettered ?? 0,
                    })
              }
            />
            <MetricCard
              icon={<AlertTriangle className="h-4 w-4" />}
              label={t("systemHealth.db.slowQueries", "Truy vấn chậm")}
              value={qm.slowQueries}
              tone={qm.slowQueries > 0 ? "warning" : "success"}
              delta={t("systemHealth.db.slowPct", "{{p}}% trên tổng", { p: qm.slowQueryPercentage })}
            />
            <MetricCard
              icon={<Activity className="h-4 w-4" />}
              label={t("systemHealth.db.totalQueries", "Tổng truy vấn")}
              value={qm.totalQueries.toLocaleString()}
              delta={t("systemHealth.db.avgMs", "TB {{a}}ms · max {{m}}ms", {
                a: qm.averageExecutionTime, m: qm.maxExecutionTime,
              })}
            />
            <MetricCard
              icon={<Info className="h-4 w-4" />}
              label={t("systemHealth.db.patterns", "Mẫu truy vấn theo dõi")}
              value={qm.patternsTracked}
              delta={t("systemHealth.db.errors", "lỗi: {{n}}", { n: qm.errorCount })}
            />
          </div>

          <div>
            <div className="mb-1 text-sm font-medium">
              {t("systemHealth.db.topSlow", "Top truy vấn chậm (chuẩn hóa)")}
            </div>
            {qm.topSlow.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("systemHealth.db.noSlow", "Chưa ghi nhận truy vấn nào vượt ngưỡng chậm.")}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("systemHealth.db.col.query", "Truy vấn")}</TableHead>
                      <TableHead className="text-right">{t("systemHealth.db.col.count", "Số lần")}</TableHead>
                      <TableHead className="text-right">{t("systemHealth.db.col.slowCount", "Lần chậm")}</TableHead>
                      <TableHead className="text-right">{t("systemHealth.db.col.avg", "TB (ms)")}</TableHead>
                      <TableHead className="text-right">{t("systemHealth.db.col.max", "Max (ms)")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {qm.topSlow.map((row) => (
                      <TableRow key={row.query}>
                        <TableCell className="max-w-[420px]">
                          <code className="block truncate text-xs" title={row.query}>{row.query}</code>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.slowCount}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.avgTime}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{row.maxTime}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 text-sm font-medium">
              {t("systemHealth.db.features", "Tính năng DB (db_feature_status)")}
            </div>
            {!d.dbFeatures.available ? (
              <p className="text-sm text-muted-foreground">
                {t("systemHealth.db.featuresUnavailable", "Bảng db_feature_status chưa tồn tại (migration 0172 chưa chạy trên DB này).")}
              </p>
            ) : d.dbFeatures.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("systemHealth.db.featuresEmpty", "Chưa có bản ghi trạng thái tính năng nào.")}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm">
                {d.dbFeatures.rows.map((row) => (
                  <InfoRow
                    key={row.feature}
                    label={<span title={row.detail ?? undefined}><code className="text-xs">{row.feature}</code></span>}
                    value={<StatusBadge status={row.status} tone={featureTone[row.status] ?? "default"} label={row.status} />}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2) OT connection supervisors (HA)
// ════════════════════════════════════════════════════════════════════════════

function ConnectionSupervisorsSection({ query }: { query: QueryLike<ConnSupervisorsOut> }) {
  const { t } = useTranslation();
  const data = query.data;
  const supervisors = data?.supervisors ?? [];

  const stateMap: Record<string, StatusMapEntry> = useMemo(() => ({
    connected: { tone: "success", label: t("systemHealth.sup.connected", "connected") },
    connecting: { tone: "info", label: t("systemHealth.sup.connecting", "connecting") },
    reconnecting: { tone: "warning", label: t("systemHealth.sup.reconnecting", "reconnecting") },
    failed: { tone: "error", label: t("systemHealth.sup.failed", "failed") },
    idle: { tone: "default", label: t("systemHealth.sup.idle", "idle") },
    stopped: { tone: "default", label: t("systemHealth.sup.stopped", "stopped") },
  }), [t]);

  const headerBadge = data == null
    ? null
    : !data.haEnabled
      ? <StatusBadge status="off" tone="default" label={t("systemHealth.sup.haOff", "HA tắt")} />
      : <StatusBadge status="on" tone="success" label={t("systemHealth.sup.haOn", "HA bật")} />;

  return (
    <SectionCard
      icon={<Waypoints className="h-5 w-5 text-primary" />}
      title={t("systemHealth.sup.title", "Giám sát kết nối OT (HA / failover)")}
      description={t(
        "systemHealth.sup.desc",
        "Mỗi adapter được giám sát: tự kết nối lại (backoff mũ + jitter), máy trạng thái sức khỏe, và failover sang endpoint dự phòng. Chỉ hoạt động khi OT_CONN_HA_ENABLED.",
      )}
      action={headerBadge}
      contentClassName="p-0"
    >
      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading", "Đang tải…")}
        </div>
      ) : query.isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive p-6">
          <AlertTriangle className="h-4 w-4" /> {query.error?.message}
        </div>
      ) : supervisors.length === 0 ? (
        <div className="flex items-start gap-2 p-6 text-sm text-muted-foreground">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            {data && !data.haEnabled
              ? t("systemHealth.sup.emptyHaOff", "HA connection đang tắt (OT_CONN_HA_ENABLED). Không có adapter nào được giám sát — đường single-endpoint hợp lệ vẫn chạy như cũ.")
              : data && !data.otRunning
                ? t("systemHealth.sup.emptyNotRunning", "OT gateway chưa chạy (OT_GATEWAY_ENABLED). Chưa có adapter nào được giám sát.")
                : t("systemHealth.sup.empty", "HA đang bật nhưng chưa có adapter nào được giám sát.")}
          </span>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("systemHealth.sup.col.adapter", "Adapter")}</TableHead>
              <TableHead>{t("systemHealth.sup.col.protocol", "Giao thức")}</TableHead>
              <TableHead>{t("systemHealth.sup.col.state", "Trạng thái")}</TableHead>
              <TableHead>{t("systemHealth.sup.col.endpoint", "Endpoint hoạt động")}</TableHead>
              <TableHead className="text-right">{t("systemHealth.sup.col.reconnects", "Reconnect")}</TableHead>
              <TableHead className="text-right">{t("systemHealth.sup.col.failovers", "Failover")}</TableHead>
              <TableHead className="text-right">{t("systemHealth.sup.col.samples", "Mẫu")}</TableHead>
              <TableHead>{t("systemHealth.sup.col.lastError", "Lỗi gần nhất")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {supervisors.map((sup) => (
              <TableRow key={sup.adapterId}>
                <TableCell className="font-medium">{sup.code}</TableCell>
                <TableCell><Badge variant="outline">{sup.protocol}</Badge></TableCell>
                <TableCell><StatusBadge status={sup.state} map={stateMap} /></TableCell>
                <TableCell className="max-w-[220px] truncate" title={sup.activeEndpoint ?? undefined}>
                  {sup.activeEndpoint ?? "—"}
                  {sup.activeLabel && (
                    <span className="ml-1 text-xs text-muted-foreground">({sup.activeLabel})</span>
                  )}
                  {sup.endpointCount > 1 && (
                    <span className="ml-1 text-xs text-muted-foreground">· {sup.endpointCount} eps</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{sup.reconnects}</TableCell>
                <TableCell className="text-right tabular-nums">{sup.failovers}</TableCell>
                <TableCell className="text-right tabular-nums">{sup.samplesForwarded}</TableCell>
                <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={sup.lastError ?? undefined}>
                  {sup.lastError ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3) DINOv2 visual model health
// ════════════════════════════════════════════════════════════════════════════

function AiModelHealthSection({ query }: { query: QueryLike<AiModelHealthOut> }) {
  const { t } = useTranslation();
  const h = query.data;

  const tierBadge = h == null
    ? null
    : h.activeTier === "onnx"
      ? <StatusBadge status="onnx" tone="success" label={t("systemHealth.ai.tierOnnx", "ONNX (vector thật)")} />
      : h.activeTier === "text-of-image"
        ? <StatusBadge status="degraded" tone="warning" label={t("systemHealth.ai.tierText", "Suy giảm: text-of-image")} />
        : <StatusBadge status="degraded" tone="warning" label={t("systemHealth.ai.tierHeuristic", "Suy giảm: heuristic")} />;

  return (
    <SectionCard
      icon={<Cpu className="h-5 w-5 text-primary" />}
      title={t("systemHealth.ai.title", "Model thị giác DINOv2 (embedding)")}
      description={t(
        "systemHealth.ai.desc",
        "Nếu file .onnx vắng mặt, pipeline suy giảm trung thực (text-of-image → heuristic) — KHÔNG bịa embedding. Thả model thật vào đường dẫn cấu hình để bật tier ONNX.",
      )}
      action={tierBadge}
    >
      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading", "Đang tải…")}
        </div>
      ) : query.isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive py-6">
          <AlertTriangle className="h-4 w-4" /> {query.error?.message}
        </div>
      ) : !h ? null : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <MetricCard
              icon={<Cpu className="h-4 w-4" />}
              label={t("systemHealth.ai.present", "File model")}
              value={h.modelPresent ? t("systemHealth.ai.found", "Có mặt") : t("systemHealth.ai.absent", "Vắng mặt")}
              tone={h.modelPresent ? "success" : "warning"}
            />
            <MetricCard
              icon={<Activity className="h-4 w-4" />}
              label={t("systemHealth.ai.activeTier", "Tier đang dùng")}
              value={h.activeTier}
              tone={h.degraded ? "warning" : "success"}
            />
            <MetricCard
              icon={<Info className="h-4 w-4" />}
              label={t("systemHealth.ai.source", "Nguồn cấu hình")}
              value={h.source}
            />
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm">
            <InfoRow label={t("systemHealth.ai.modelPath", "Đường dẫn model")} value={<code className="text-xs break-all">{h.modelPath}</code>} />
            <InfoRow label={t("systemHealth.ai.configuredPath", "Đường dẫn cấu hình")} value={<code className="text-xs break-all">{h.configuredPath}</code>} />
          </div>
          <p className={`text-xs ${h.degraded ? "text-warning" : "text-muted-foreground"}`}>{h.note}</p>
        </div>
      )}
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4) Digital-twin USD / DTDL export
// ════════════════════════════════════════════════════════════════════════════

function TwinExportSection() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const factoriesQuery = trpc.factory.list.useQuery();
  const factories = factoriesQuery.data ?? [];
  const [factoryId, setFactoryId] = useState<string>("");
  const selectedId = factoryId !== "" ? Number(factoryId) : factories[0]?.id ?? null;
  const [busy, setBusy] = useState<null | "usd" | "dtdl">(null);

  const exportUsd = async () => {
    if (selectedId == null) return;
    setBusy("usd");
    try {
      const res = await utils.twin.usdExport.fetch({ factoryId: selectedId });
      downloadText(res.usda, `factory-${selectedId}.usda`, "text/plain;charset=utf-8");
      toast.success(t("systemHealth.export.usdOk", "Đã xuất USDA ({{n}} bytes)", { n: res.byteLength }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const exportDtdl = async () => {
    if (selectedId == null) return;
    setBusy("dtdl");
    try {
      const res = await utils.twin.twinModels.fetch({ factoryId: selectedId });
      downloadText(JSON.stringify(res, null, 2), `factory-${selectedId}-dtdl.json`, "application/json");
      toast.success(t("systemHealth.export.dtdlOk", "Đã xuất DTDL ({{n}} twin)", { n: res.counts.total }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <SectionCard
      icon={<Boxes className="h-5 w-5 text-primary" />}
      title={t("systemHealth.export.title", "Xuất Digital Twin (USD / DTDL)")}
      description={t(
        "systemHealth.export.desc",
        "Xuất scene-graph nhà máy ra USDA (Omniverse/Isaac) hoặc DTDL v3 (twin graph) — chỉ đọc, không ghi thiết bị. Tải trực tiếp về máy.",
      )}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <Label className="text-xs">{t("systemHealth.export.factory", "Nhà máy")}</Label>
          <Select
            value={selectedId != null ? String(selectedId) : ""}
            onValueChange={setFactoryId}
            disabled={factoriesQuery.isLoading || factories.length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("systemHealth.export.pickFactory", "Chọn nhà máy…")} />
            </SelectTrigger>
            <SelectContent>
              {factories.map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>{f.name ?? f.code ?? `#${f.id}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={exportUsd} disabled={selectedId == null || busy != null}>
          {busy === "usd" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
          {t("systemHealth.export.usd", "Tải USDA (.usda)")}
        </Button>
        <Button variant="outline" onClick={exportDtdl} disabled={selectedId == null || busy != null}>
          {busy === "dtdl" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileDown className="h-4 w-4 mr-1" />}
          {t("systemHealth.export.dtdl", "Tải DTDL (.json)")}
        </Button>
      </div>
      {factories.length === 0 && !factoriesQuery.isLoading && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("systemHealth.export.noFactory", "Chưa có nhà máy nào để xuất.")}
        </p>
      )}
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5) Hardware commissioning (FAT) — admin_system
// ════════════════════════════════════════════════════════════════════════════

interface AdapterLite { id: number; code: string; protocol: string }

function CommissioningPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("admin_system", "canView");
  const canCreate = hasPermission("admin_system", "canCreate");
  const canDelete = hasPermission("admin_system", "canDelete");

  // Whole panel is admin-only (mirrors the commissioning router RBAC).
  if (!canView) return null;

  const adaptersQuery = trpc.deviceAdapter.list.useQuery();
  const adapters: AdapterLite[] = (adaptersQuery.data ?? []).map((a: { id: number; code: string; protocol: string }) => ({
    id: a.id, code: a.code, protocol: a.protocol,
  }));

  const [manageAdapter, setManageAdapter] = useState<AdapterLite | null>(null);

  return (
    <SectionCard
      icon={<ShieldCheck className="h-5 w-5 text-primary" />}
      title={t("systemHealth.comm.title", "Commissioning phần cứng (cổng FAT)")}
      description={t(
        "systemHealth.comm.desc",
        "Sổ ký duyệt FAT/commissioning: một adapter phải có bản ghi ACTIVE, còn hạn thì mới được ghi thật (nếu không sẽ bị ép về mô phỏng). Chỉ admin. Không có đường ghi thiết bị từ đây.",
      )}
      contentClassName="p-0"
    >
      {adaptersQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading", "Đang tải…")}
        </div>
      ) : adaptersQuery.isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive p-6">
          <AlertTriangle className="h-4 w-4" /> {adaptersQuery.error?.message}
        </div>
      ) : adapters.length === 0 ? (
        <div className="flex items-start gap-2 p-6 text-sm text-muted-foreground">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t("systemHealth.comm.empty", "Chưa có adapter nào. Tạo adapter ở trang Device Adapter trước khi commissioning.")}</span>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("systemHealth.comm.col.adapter", "Adapter")}</TableHead>
              <TableHead>{t("systemHealth.comm.col.protocol", "Giao thức")}</TableHead>
              <TableHead>{t("systemHealth.comm.col.status", "Trạng thái cổng")}</TableHead>
              <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adapters.map((a) => (
              <CommissioningRow key={a.id} adapter={a} onManage={() => setManageAdapter(a)} />
            ))}
          </TableBody>
        </Table>
      )}

      {manageAdapter && (
        <CommissioningRecordsDialog
          adapter={manageAdapter}
          canCreate={canCreate}
          canDelete={canDelete}
          onClose={() => setManageAdapter(null)}
        />
      )}
    </SectionCard>
  );
}

/** One adapter row: its live gate status + a Manage button. */
function CommissioningRow({ adapter, onManage }: { adapter: AdapterLite; onManage: () => void }) {
  const { t } = useTranslation();
  const statusQuery = trpc.commissioning.status.useQuery({ adapterId: adapter.id });
  const st = statusQuery.data;

  const badge = st == null
    ? <StatusBadge status="loading" tone="default" label="…" />
    : st.commissioned
      ? <StatusBadge status="commissioned" tone="success" label={t("systemHealth.comm.commissioned", "Đã commissioning")} />
      : st.wouldForceSimulated
        ? <StatusBadge status="simulated" tone="warning" label={t("systemHealth.comm.wouldSimulate", "Sẽ bị ép mô phỏng")} />
        : <StatusBadge status="gateoff" tone="default" label={t("systemHealth.comm.gateOff", "Cổng tắt")} />;

  return (
    <TableRow>
      <TableCell className="font-medium">{adapter.code}</TableCell>
      <TableCell><Badge variant="outline">{adapter.protocol}</Badge></TableCell>
      <TableCell>{badge}</TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant="outline" onClick={onManage}>
          <ClipboardCheck className="h-4 w-4 mr-1" /> {t("systemHealth.comm.manage", "Sổ ký")}
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** Records ledger for one adapter + create (sign) + revoke. */
function CommissioningRecordsDialog({
  adapter, canCreate, canDelete, onClose,
}: {
  adapter: AdapterLite;
  canCreate: boolean;
  canDelete: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const recordsQuery = trpc.commissioning.list.useQuery({ adapterId: adapter.id });
  const records = recordsQuery.data ?? [];

  const [fatReference, setFatReference] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [revokeFor, setRevokeFor] = useState<number | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  const invalidate = () => {
    void utils.commissioning.list.invalidate({ adapterId: adapter.id });
    void utils.commissioning.status.invalidate({ adapterId: adapter.id });
  };

  const createMut = trpc.commissioning.create.useMutation({
    onSuccess: () => {
      toast.success(t("systemHealth.comm.signed", "Đã ký commissioning"));
      setFatReference(""); setExpiresAt(""); setNotes("");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const revokeMut = trpc.commissioning.revoke.useMutation({
    onSuccess: () => {
      toast.success(t("systemHealth.comm.revoked", "Đã thu hồi bản ghi"));
      setRevokeFor(null); setRevokeReason("");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const submitCreate = () => {
    createMut.mutate({
      adapterId: adapter.id,
      fatReference: fatReference.trim() || null,
      expiresAt: expiresAt.trim() ? new Date(expiresAt) : null,
      notes: notes.trim() || null,
    });
  };

  const statusMap: Record<string, StatusMapEntry> = {
    active: { tone: "success", label: t("systemHealth.comm.rec.active", "active") },
    revoked: { tone: "error", label: t("systemHealth.comm.rec.revoked", "revoked") },
    expired: { tone: "warning", label: t("systemHealth.comm.rec.expired", "expired") },
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("systemHealth.comm.dialogTitle", "Sổ ký commissioning — {{code}}", { code: adapter.code })}</DialogTitle>
          <DialogDescription>
            {t("systemHealth.comm.dialogDesc", "Ký duyệt FAT (tạo bản ghi active) hoặc thu hồi. Ghi thật chỉ được phép khi có bản ghi active còn hạn.")}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[300px] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{t("systemHealth.comm.rec.status", "Trạng thái")}</TableHead>
                <TableHead>{t("systemHealth.comm.rec.fat", "FAT ref")}</TableHead>
                <TableHead>{t("systemHealth.comm.rec.signedAt", "Ký lúc")}</TableHead>
                <TableHead>{t("systemHealth.comm.rec.expiresAt", "Hết hạn")}</TableHead>
                <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recordsQuery.isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">{t("common.loading", "Đang tải…")}</TableCell></TableRow>
              ) : records.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">{t("systemHealth.comm.noRecords", "Chưa có bản ghi commissioning.")}</TableCell></TableRow>
              ) : records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.id}</TableCell>
                  <TableCell><StatusBadge status={r.status} map={statusMap} /></TableCell>
                  <TableCell className="max-w-[140px] truncate" title={r.fatReference ?? undefined}>{r.fatReference ?? "—"}</TableCell>
                  <TableCell className="text-xs">{fmtTime(r.signedAt)}</TableCell>
                  <TableCell className="text-xs">{r.expiresAt ? fmtTime(r.expiresAt) : t("systemHealth.comm.noExpiry", "không hạn")}</TableCell>
                  <TableCell className="text-right">
                    {canDelete && r.status === "active" && (
                      <Button size="sm" variant="destructive" disabled={revokeMut.isPending}
                        onClick={() => { setRevokeFor(r.id); setRevokeReason(""); }}>
                        {t("systemHealth.comm.revoke", "Thu hồi")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {canCreate && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Plug className="h-4 w-4" /> {t("systemHealth.comm.signTitle", "Ký commissioning mới")}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <Label className="text-xs">{t("systemHealth.comm.rec.fat", "FAT ref")}</Label>
                <Input value={fatReference} onChange={(e) => setFatReference(e.target.value)}
                  placeholder={t("common.optional", "(tùy chọn)")} />
              </div>
              <div>
                <Label className="text-xs">{t("systemHealth.comm.rec.expiresAt", "Hết hạn")}</Label>
                <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">{t("systemHealth.comm.rec.notes", "Ghi chú")}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder={t("common.optional", "(tùy chọn)")} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.close", "Đóng")}</Button>
          {canCreate && (
            <Button onClick={submitCreate} disabled={createMut.isPending}>
              <ShieldCheck className="h-4 w-4 mr-1" /> {t("systemHealth.comm.sign", "Ký duyệt")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Revoke confirmation */}
      <AlertDialog open={revokeFor != null} onOpenChange={(o) => { if (!o) setRevokeFor(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("systemHealth.comm.revokeTitle", "Thu hồi bản ghi?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("systemHealth.comm.revokeDesc", "Thu hồi bản ghi #{{id}}? Adapter sẽ mất trạng thái commissioned và ghi thật sẽ bị ép về mô phỏng.", { id: revokeFor ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-1">
            <Label className="text-xs">{t("systemHealth.comm.revokeReason", "Lý do (tùy chọn)")}</Label>
            <Input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Huỷ")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (revokeFor != null) revokeMut.mutate({ recordId: revokeFor, reason: revokeReason.trim() || null }); }}
            >
              {t("systemHealth.comm.revoke", "Thu hồi")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

// ── shared tiny row ─────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
