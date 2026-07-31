/**
 * W8-C (doc 27 §9 V10 — F2 completion) — /repair-station: dedicated full-screen
 * REPAIR WORKSTATION for the repair operator (khác InspectionDetail của QC).
 *
 * Flow (shopfloor tablet, big touch targets, ?kiosk=1 hides chrome via the
 * global useKioskMode hook):
 *   1. SCAN — autofocus serial input (Enter submits) → that board's
 *      disposition(s) + defect details (NG measurements, defect image, IPC code,
 *      VLM description) reusing inspection.getById — no new detail path.
 *   2. ONE-TAP transitions (start repair / mark repaired / send re-inspect) via
 *      defectDisposition.transition — the server's legal-transition service is
 *      the single source of truth (illegal → CONFLICT toast). Closing stays a
 *      QUALITY action (updateStatus) and only shows for quality roles.
 *   3. QUEUE — open dispositions grouped by lane (open → in_repair → repaired →
 *      re_inspect_pending), OLDEST FIRST (FIFO backlog), filter line/machine/type.
 *   4. STATS strip — repaired today, avg time in repair (audit-ledger derived),
 *      backlog by lane, oldest age.
 *
 * RBAC mirrors the router: bench actions for admin/supervisor/quality_inspector/
 * maintenance/operator; viewer/user get an honest read-only badge.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { MetricCard, PageContainer, PageHeader, SectionCard, StatusBadge } from "@/components/patterns";
import { ContextDrawer } from "@/components/workspace";
import RepairAISummary from "@/components/RepairAISummary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Wrench,
  ScanBarcode,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  ExternalLink,
  Clock,
  Timer,
  Layers,
  User as UserIcon,
  X,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type QueueRow = RouterOutputs["defectDisposition"]["repairQueue"][number];
type SerialRow = RouterOutputs["defectDisposition"]["listBySerial"][number];
type InspectionById = RouterOutputs["inspection"]["getById"];

type DispositionType = "rework" | "repair" | "scrap" | "use_as_is" | "return_to_vendor";
type DispositionStatus = "open" | "in_repair" | "repaired" | "re_inspect_pending" | "closed";

const LANES: Exclude<DispositionStatus, "closed">[] = ["open", "in_repair", "repaired", "re_inspect_pending"];
/** Repair-walk targets exposed on the bench (closing stays quality-only). */
const BENCH_TARGETS: Record<Exclude<DispositionStatus, "closed">, DispositionStatus[]> = {
  open: ["in_repair"],
  in_repair: ["repaired"],
  repaired: ["re_inspect_pending"],
  re_inspect_pending: ["in_repair"],
};
const BENCH_ROLES = new Set(["admin", "supervisor", "quality_inspector", "maintenance", "operator"]);
const CLOSE_ROLES = new Set(["admin", "supervisor", "quality_inspector"]);

function laneBadgeClass(status: DispositionStatus): string {
  switch (status) {
    case "open": return "bg-destructive/20 text-destructive border-destructive/30";
    case "in_repair": return "bg-warning/20 text-warning border-warning/30";
    case "repaired": return "bg-primary/20 text-primary border-primary/30";
    case "re_inspect_pending": return "bg-secondary text-secondary-foreground border-border";
    case "closed": return "bg-success/20 text-success border-success/30";
  }
}

function verdictBadge(result: string) {
  if (result === "OK") {
    return (
      <Badge className="bg-success/20 text-success border-success/30 gap-1">
        <CheckCircle2 className="h-3 w-3" /> OK
      </Badge>
    );
  }
  if (result === "NG") {
    return (
      <Badge className="bg-destructive/20 text-destructive border-destructive/30 gap-1">
        <XCircle className="h-3 w-3" /> NG
      </Badge>
    );
  }
  return (
    <Badge className="bg-warning/20 text-warning border-warning/30 gap-1">
      <AlertTriangle className="h-3 w-3" /> {result}
    </Badge>
  );
}

/** Compact "3m / 2h / 1d 4h" age string — glanceable on the shopfloor. */
function ageLabel(from: string | Date, t: (k: string, d: string) => string): string {
  const ms = Date.now() - new Date(from).getTime();
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 60) return `${min}${t("repairStation.ageMin", "m")}`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}${t("repairStation.ageHour", "h")} ${min % 60}${t("repairStation.ageMin", "m")}`;
  const d = Math.floor(h / 24);
  return `${d}${t("repairStation.ageDay", "d")} ${h % 24}${t("repairStation.ageHour", "h")}`;
}

/** Parse the VLM analysis JSON honestly: description-ish field or raw excerpt. */
function vlmSummary(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of ["description", "analysis", "summary", "defectDescription"]) {
      const v = parsed[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch {
    /* raw text below */
  }
  return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
}

export default function RepairStation() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const role = user?.role ?? "";
  const canBench = BENCH_ROLES.has(role);
  const canClose = CLOSE_ROLES.has(role);

  // ── Serial scan workflow ────────────────────────────────────────────────────
  const [serialInput, setSerialInput] = useState("");
  const [activeSerial, setActiveSerial] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  const submitSerial = (value?: string) => {
    const s = (value ?? serialInput).trim();
    if (!s) return;
    setActiveSerial(s);
    setSerialInput(s);
  };

  // ── Queue filters ───────────────────────────────────────────────────────────
  const [filterLine, setFilterLine] = useState<number | null>(null);
  const [filterMachine, setFilterMachine] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<DispositionType | "all">("all");

  // ── Queries ─────────────────────────────────────────────────────────────────
  const statsQ = trpc.defectDisposition.repairStats.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
  });
  const queueQ = trpc.defectDisposition.repairQueue.useQuery(
    {
      lineId: filterLine,
      machineId: filterMachine,
      disposition: filterType === "all" ? null : filterType,
      limit: 500,
    },
    { refetchInterval: 15_000, retry: false },
  );
  const transitionsQ = trpc.defectDisposition.transitions.useQuery(undefined, {
    retry: false,
    staleTime: Infinity,
  });
  const serialQ = trpc.defectDisposition.listBySerial.useQuery(
    { serial: activeSerial ?? "" },
    { enabled: !!activeSerial, retry: false },
  );

  const queue = (queueQ.data ?? []) as QueueRow[];
  const stats = statsQ.data;
  const legal = (transitionsQ.data ?? null) as Record<DispositionStatus, DispositionStatus[]> | null;

  // Filter options derived from the loaded queue (no extra permission surface).
  const lineOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of queue) if (r.lineId != null) m.set(r.lineId, r.lineName ?? `#${r.lineId}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [queue]);
  const machineOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of queue) if (r.machineId != null) m.set(r.machineId, r.machineName ?? r.machineCode ?? `#${r.machineId}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [queue]);

  const lanes = useMemo(() => {
    const grouped: Record<string, QueueRow[]> = { open: [], in_repair: [], repaired: [], re_inspect_pending: [] };
    for (const r of queue) {
      if (r.status in grouped) grouped[r.status].push(r); // server already sorts oldest-first
    }
    return grouped;
  }, [queue]);

  const refreshAll = () => {
    void utils.defectDisposition.repairQueue.invalidate();
    void utils.defectDisposition.repairStats.invalidate();
    void utils.defectDisposition.listBySerial.invalidate();
    void utils.defectDisposition.countOpen.invalidate();
  };

  const typeLabel = (v: string) => t(`disposition.types.${v}`, v);
  const statusLabel = (v: string) => t(`disposition.status.${v}`, v);

  return (
    <DashboardLayout>
      <PageContainer className="flex flex-col gap-4 space-y-0">
        <PageHeader
          icon={<Wrench className="h-6 w-6" />}
          title={t("repairStation.title", "Repair station")}
          description={t(
            "repairStation.subtitle",
            "Scan a board serial, walk the repair loop (start → repaired → re-inspect) and work the NG backlog oldest-first.",
          )}
          badge={
            !canBench ? (
              <Badge variant="outline" className="text-muted-foreground">
                {t("repairStation.readOnly", "View only — repair actions need operator/maintenance/quality role")}
              </Badge>
            ) : undefined
          }
          actions={
            <Button size="icon" variant="ghost" onClick={refreshAll} title={t("common.refresh", "Refresh")}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        />

        {/* ── Stats strip ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label={t("repairStation.repairedToday", "Repaired today")}
            value={stats ? stats.repairedToday : "—"}
            tone="good"
          />
          <MetricCard
            icon={<Timer className="h-4 w-4" />}
            label={t("repairStation.avgRepair", "Avg time in repair")}
            value={
              stats?.avgRepairMinutes != null
                ? `${stats.avgRepairMinutes} ${t("repairStation.minutes", "min")}`
                : "—"
            }
            delta={
              stats && stats.repairPairCount > 0
                ? t("repairStation.avgRepairHint", "{{n}} repairs, last {{d}} days")
                    .replace("{{n}}", String(stats.repairPairCount))
                    .replace("{{d}}", String(stats.windowDays))
                : t("repairStation.noPairs", "No completed repairs in the window yet")
            }
          />
          <MetricCard
            icon={<Layers className="h-4 w-4" />}
            label={t("repairStation.backlog", "Open backlog")}
            value={stats ? LANES.reduce((acc, l) => acc + stats.openByLane[l], 0) : "—"}
            tone={stats && stats.openByLane.open > 0 ? "warning" : "default"}
          />
          <MetricCard
            icon={<Clock className="h-4 w-4" />}
            label={t("repairStation.oldestOpen", "Oldest open")}
            value={
              stats?.oldestOpenMinutes != null
                ? ageLabel(new Date(Date.now() - stats.oldestOpenMinutes * 60000), t)
                : "—"
            }
            tone={stats?.oldestOpenMinutes != null && stats.oldestOpenMinutes > 24 * 60 ? "danger" : "default"}
          />
        </div>

        {/* ── Serial scan bar (autofocus, Enter submits) ───────────────────── */}
        <SectionCard icon={<ScanBarcode className="h-4 w-4" />} title={t("repairStation.scanTitle", "Scan / enter board serial")}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-64 flex-1">
              <ScanBarcode className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={scanRef}
                className="h-12 pl-10 font-mono text-lg"
                placeholder={t("repairStation.scanPlaceholder", "Scan barcode or type serial, then Enter…")}
                value={serialInput}
                onChange={(e) => setSerialInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitSerial();
                }}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
            <Button className="h-12 px-6 text-base" disabled={!serialInput.trim()} onClick={() => submitSerial()}>
              {t("repairStation.lookup", "Look up")}
            </Button>
            {activeSerial && (
              <Button
                variant="outline"
                className="h-12"
                onClick={() => {
                  setActiveSerial(null);
                  setSerialInput("");
                  scanRef.current?.focus();
                }}
              >
                <X className="mr-1 h-4 w-4" />
                {t("common.clear", "Clear")}
              </Button>
            )}
          </div>
        </SectionCard>

        {/* ── Active-serial work panel ─────────────────────────────────────── */}
        {activeSerial && (
          <SerialWorkPanel
            serial={activeSerial}
            rows={(serialQ.data ?? []) as SerialRow[]}
            loading={serialQ.isLoading}
            legal={legal}
            canBench={canBench}
            canClose={canClose}
            onChanged={refreshAll}
            typeLabel={typeLabel}
            statusLabel={statusLabel}
          />
        )}

        {/* ── Queue filters ───────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filterLine != null ? String(filterLine) : "all"}
            onValueChange={(v) => setFilterLine(v === "all" ? null : Number(v))}
          >
            <SelectTrigger className="h-11 w-48">
              <SelectValue placeholder={t("repairStation.filterLine", "All lines")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("repairStation.filterLine", "All lines")}</SelectItem>
              {lineOptions.map(([id, name]) => (
                <SelectItem key={id} value={String(id)}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filterMachine != null ? String(filterMachine) : "all"}
            onValueChange={(v) => setFilterMachine(v === "all" ? null : Number(v))}
          >
            <SelectTrigger className="h-11 w-52">
              <SelectValue placeholder={t("repairStation.filterMachine", "All machines")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("repairStation.filterMachine", "All machines")}</SelectItem>
              {machineOptions.map(([id, name]) => (
                <SelectItem key={id} value={String(id)}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={(v) => setFilterType(v as DispositionType | "all")}>
            <SelectTrigger className="h-11 w-48">
              <SelectValue placeholder={t("repairStation.filterType", "All types")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("repairStation.filterType", "All types")}</SelectItem>
              {(["rework", "repair", "scrap", "use_as_is", "return_to_vendor"] as DispositionType[]).map((v) => (
                <SelectItem key={v} value={v}>{typeLabel(v)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs text-muted-foreground">
            {t("repairStation.fifoHint", "Oldest first — work the top card of each lane")}
          </span>
        </div>

        {/* ── Lanes ───────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {LANES.map((lane) => (
            <div key={lane} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-2">
              <div className="flex items-center justify-between px-1">
                <Badge className={`${laneBadgeClass(lane)} border`}>{statusLabel(lane)}</Badge>
                <span className="text-sm font-semibold tabular-nums">{lanes[lane].length}</span>
              </div>
              {queueQ.isLoading && (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {!queueQ.isLoading && lanes[lane].length === 0 && (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                  {t("repairStation.laneEmpty", "Empty")}
                </p>
              )}
              {lanes[lane].map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="rounded-md border border-border bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40 active:scale-[0.99]"
                  onClick={() => {
                    if (r.serialNumber) {
                      submitSerial(r.serialNumber);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-base font-semibold">
                      {r.serialNumber ?? `#${r.inspectionId}`}
                    </span>
                    <Badge variant="outline" className="shrink-0 gap-1 text-[11px]">
                      <Clock className="h-3 w-3" />
                      {ageLabel(r.createdAt as unknown as string, t)}
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-[11px]">{typeLabel(r.disposition)}</Badge>
                    {r.machineName && (
                      <span className="truncate text-xs text-muted-foreground">{r.machineName}</span>
                    )}
                    {r.productModel && (
                      <span className="truncate text-xs text-muted-foreground">· {r.productModel}</span>
                    )}
                  </div>
                  {(r.assigneeName || r.assignee != null) && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <UserIcon className="h-3 w-3" />
                      {r.assigneeName ?? `#${r.assignee}`}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Serial work panel — dispositions of the scanned board + defect details +
// one-tap transitions. Detail data reuses inspection.getById (same source as
// InspectionDetail) — no duplicated detail path.
// ═══════════════════════════════════════════════════════════════════════════
function SerialWorkPanel({
  serial,
  rows,
  loading,
  legal,
  canBench,
  canClose,
  onChanged,
  typeLabel,
  statusLabel,
}: {
  serial: string;
  rows: SerialRow[];
  loading: boolean;
  legal: Record<DispositionStatus, DispositionStatus[]> | null;
  canBench: boolean;
  canClose: boolean;
  onChanged: () => void;
  typeLabel: (v: string) => string;
  statusLabel: (v: string) => string;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const open = rows.filter((r) => r.status !== "closed");
  const history = rows.filter((r) => r.status === "closed");
  const focus = open[0] ?? rows[0] ?? null;

  // Defect details of the focused disposition's inspection (reused query).
  const detailQ = trpc.inspection.getById.useQuery(
    { id: focus?.inspectionId ?? 0 },
    { enabled: !!focus, retry: false },
  );
  const reInspectQ = trpc.defectDisposition.reInspectStatus.useQuery(
    { inspectionId: focus?.inspectionId ?? 0 },
    { enabled: !!focus, retry: false, staleTime: 30_000 },
  );

  const onError = (e: { data?: { code?: string } | null; message: string }) => {
    if (e.data?.code === "CONFLICT") {
      toast.info(t("repairStation.conflictToast", "State changed elsewhere — refreshed. ") + mapTrpcError(e));
      onChanged();
    } else {
      toastTrpcError(e);
    }
  };

  const transitionM = trpc.defectDisposition.transition.useMutation({
    onSuccess: () => {
      toast.success(t("disposition.statusUpdated", "Status updated"));
      setNote("");
      onChanged();
    },
    onError,
  });
  const closeM = trpc.defectDisposition.updateStatus.useMutation({
    onSuccess: () => {
      toast.success(t("disposition.statusUpdated", "Status updated"));
      setNote("");
      onChanged();
    },
    onError,
  });
  const pending = transitionM.isPending || closeM.isPending;

  const detail = detailQ.data as InspectionById | undefined;
  const reInspect = reInspectQ.data;

  const measurements = useMemo(() => {
    const all = detail?.measurements ?? [];
    if (focus?.measurementResultId != null) {
      const scoped = all.filter((m) => m.id === focus.measurementResultId);
      if (scoped.length > 0) return scoped;
    }
    return all.filter((m) => m.result === "NG");
  }, [detail, focus]);

  const actionLabel = (target: DispositionStatus) => t(`disposition.action.${target}`, target);

  // AI drawer context — the focused NG point's own image (if any) + a human
  // label, used to scope RepairAISummary's "find similar" + "Hỏi AI" actions.
  const primaryMeasurement = measurements[0];
  const defectImageUrl = primaryMeasurement
    ? ((primaryMeasurement as { defectCropUrl?: string | null }).defectCropUrl ?? primaryMeasurement.imageUrl)
    : null;
  const defectLabel = primaryMeasurement
    ? (primaryMeasurement.defectNameVi ?? primaryMeasurement.defectName ?? primaryMeasurement.pointName ?? null)
    : null;

  return (
    <>
    <SectionCard
      icon={<Wrench className="h-4 w-4" />}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg">{serial}</span>
          {detail?.inspection && verdictBadge(detail.inspection.overallResult)}
          {/* Re-inspect chip — DERIVED: a later inspection of the same serial */}
          {reInspect?.found && reInspect.latest ? (
            <Link href={`/inspection/${reInspect.latest.id}`}>
              <Badge variant="outline" className="cursor-pointer gap-1.5 hover:bg-muted">
                <RotateCcw className="h-3 w-3" />
                {t("disposition.reInspected", "Re-inspected")}: {verdictBadge(reInspect.latest.overallResult)}
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </Badge>
            </Link>
          ) : focus ? (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <RotateCcw className="h-3 w-3" />
              {t("disposition.notReInspected", "Not re-inspected yet")}
            </Badge>
          ) : null}
        </span>
      }
      action={
        focus ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setAiOpen(true)}>
              <Sparkles className="h-3.5 w-3.5" />
              {t("repairAI.openButton", "Trợ lý AI")}
            </Button>
            <Link href={`/inspection/${focus.inspectionId}`}>
              <Button size="sm" variant="outline" className="gap-1">
                <ExternalLink className="h-3.5 w-3.5" />
                {t("repairStation.openInspection", "Inspection detail")}
              </Button>
            </Link>
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          {t(
            "repairStation.serialEmpty",
            "No disposition for this serial — QC creates one from the inspection detail page (NG/NTF panel).",
          )}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* ── Left: dispositions + one-tap actions ─────────────────────── */}
          <div className="space-y-3">
            {open.map((d) => {
              const status = d.status as Exclude<DispositionStatus, "closed">;
              const benchTargets = (BENCH_TARGETS[status] ?? []).filter(
                (target) => !legal || (legal[status] ?? []).includes(target),
              );
              const closable = canClose && (!legal || (legal[status] ?? []).includes("closed"));
              return (
                <div key={d.id} className="rounded-lg border border-border bg-secondary/20 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{typeLabel(d.disposition)}</Badge>
                    <Badge className={`${laneBadgeClass(status)} border`}>{statusLabel(status)}</Badge>
                    {d.measurementResultId != null && (
                      <Badge variant="outline" className="text-[10px]">
                        {t("disposition.pointScope", "Point")} #{d.measurementResultId}
                      </Badge>
                    )}
                    {d.workOrderId != null && (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Wrench className="h-3 w-3" /> WO #{d.workOrderId}
                      </Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {ageLabel(d.createdAt as unknown as string, t)}
                    </span>
                  </div>
                  {d.note && <p className="mt-2 whitespace-pre-wrap text-sm">{d.note}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {t("disposition.createdBy", "Created by")}: {d.createdByName ?? (d.createdBy != null ? `#${d.createdBy}` : "—")}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UserIcon className="h-3 w-3" />
                      {d.assigneeName ?? (d.assignee != null ? `#${d.assignee}` : "—")}
                    </span>
                  </div>
                  {canBench && (benchTargets.length > 0 || closable) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {benchTargets.map((target) => (
                        <Button
                          key={target}
                          className="h-11 px-5 text-base"
                          disabled={pending}
                          onClick={() =>
                            transitionM.mutate({
                              id: d.id,
                              status: target as "in_repair" | "repaired" | "re_inspect_pending",
                              note: note.trim() || undefined,
                            })
                          }
                        >
                          {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                          {actionLabel(target)}
                        </Button>
                      ))}
                      {closable && (
                        <Button
                          variant="outline"
                          className="h-11 px-5 text-base"
                          disabled={pending}
                          onClick={() => closeM.mutate({ id: d.id, status: "closed", note: note.trim() || undefined })}
                        >
                          {actionLabel("closed")}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {canBench && open.length > 0 && (
              <Textarea
                rows={2}
                className="text-sm"
                placeholder={t("repairStation.notePlaceholder", "Optional note — attached to the next action…")}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}

            {history.length > 0 && (
              <div>
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowHistory((v) => !v)}>
                  {showHistory
                    ? t("repairStation.hideHistory", "Hide closed history")
                    : t("repairStation.showHistory", "Show closed history ({{n}})").replace("{{n}}", String(history.length))}
                </Button>
                {showHistory && (
                  <div className="mt-1 space-y-1.5">
                    {history.map((d) => (
                      <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="text-[10px]">{typeLabel(d.disposition)}</Badge>
                        <Badge className={`${laneBadgeClass("closed")} border text-[10px]`}>{statusLabel("closed")}</Badge>
                        {d.note && <span className="truncate">{d.note}</span>}
                        <span className="ml-auto">{new Date(d.updatedAt as unknown as string).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Right: defect details (reused inspection.getById) ─────────── */}
          <div className="space-y-3">
            {detailQ.isLoading && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {detail?.inspection && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {detail.machine && <span>{detail.machine.name}</span>}
                {detail.inspection.productModel && <span>· {detail.inspection.productModel}</span>}
                <span>· {new Date(detail.inspection.inspectionTime as unknown as string).toLocaleString()}</span>
              </div>
            )}
            {!detailQ.isLoading && measurements.length === 0 && detail && (
              <p className="text-sm text-muted-foreground">
                {t("repairStation.noNgPoints", "No NG measurement points on this inspection.")}
              </p>
            )}
            {measurements.map((m) => {
              const vlm = vlmSummary(m.aiAnalysisResult);
              const img = (m as { defectCropUrl?: string | null }).defectCropUrl ?? m.imageUrl;
              return (
                <div key={m.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{m.pointName ?? m.pointCode ?? `#${m.pointDefId}`}</span>
                    {verdictBadge(m.result)}
                    {m.defectCode && (
                      <Badge variant="outline" className="font-mono text-[11px]" title={m.defectNameVi ?? m.defectName ?? undefined}>
                        {m.defectCode}
                      </Badge>
                    )}
                    {m.defectName && <span className="text-xs text-muted-foreground">{m.defectNameVi ?? m.defectName}</span>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    {m.measuredValue != null && (
                      <span>
                        {t("repairStation.measured", "Measured")}: <span className="font-mono text-foreground">{m.measuredValue}</span>
                      </span>
                    )}
                    {m.measuredValueText && <span className="font-mono">{m.measuredValueText}</span>}
                    {m.remark && <span>{m.remark}</span>}
                  </div>
                  {img ? (
                    <a href={img} target="_blank" rel="noreferrer" className="mt-2 block">
                      <img
                        src={img}
                        alt={m.pointName ?? "defect"}
                        loading="lazy"
                        className="max-h-48 rounded-md border border-border object-contain"
                      />
                    </a>
                  ) : (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <ImageIcon className="h-3.5 w-3.5" />
                      {t("repairStation.noImage", "No defect image")}
                    </div>
                  )}
                  {vlm && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md bg-muted/40 p-2 text-xs">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="whitespace-pre-wrap">{vlm}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SectionCard>
    <ContextDrawer
      open={aiOpen}
      onOpenChange={setAiOpen}
      title={t("repairAI.title", "Trợ lý AI sửa chữa")}
      description={serial}
    >
      <RepairAISummary
        serial={serial}
        machineId={detail?.machine?.id ?? null}
        machineCode={detail?.machine?.code ?? null}
        machineName={detail?.machine?.name ?? null}
        defectImageUrl={defectImageUrl}
        defectLabel={defectLabel}
      />
    </ContextDrawer>
    </>
  );
}
