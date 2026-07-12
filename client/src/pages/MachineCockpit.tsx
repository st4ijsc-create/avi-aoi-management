/**
 * U3 (doc 21 §6 / §3 G-4, G-5) — MACHINE COCKPIT — the unified per-machine detail page.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Route `/machine/:id`. ONE tabbed cockpit over `assetCockpit.machineDetail(id)` — the
 * thin backend aggregation (§11) that assembles identity, resolved capability, live
 * state + PackML, health/PdM, OEE, per-machine normalized alarms, recipes, programs,
 * genealogy, 3D model and gated-action METADATA from a SINGLE call. The FE never fans
 * out to 10 routers; it renders the honest-null sections this one payload carries.
 *
 * TABS:
 *   Overview  — identity + hierarchy path + resolved capability (commands / telemetry
 *               tags / PackML states / deviceType) + live state (status / heartbeat /
 *               connection) + KPI MetricCards (OEE, health risk, alarms, connection).
 *   Health    — PdM risk gauge + reliability (MTBF / MTTR / RUL) — reuses the health
 *               gauge idea from MachineHealthMonitoring (replicated compactly).
 *   OEE       — availability / performance / quality radial gauges (OEEDashboard viz,
 *               replicated compactly).
 *   Alarms    — the per-machine ISA-18.2 normalized list.
 *   Recipes   — recipe versions + load/deploy history.
 *   Programs  — program projects + their deploy audit rows.
 *   Genealogy — recent product-traceability records for the machine's station.
 *   3D        — drei <Gltf> when a modelUri is registered, else a primitive block
 *               (same Suspense + primitive-fallback pattern as DigitalTwinCenter).
 *   Actions   — lists gatedActions (label / riskLevel / required permission / PackML
 *               command). METADATA ONLY — a "Propose" affordance routes to the EXISTING
 *               gated control surface (/control-plane). It NEVER executes a command here.
 *
 * LIVE: status refreshes via the shared socket (machine room `telemetry:sample` — the
 * same feed UnifiedDeviceMonitor consumes) merged with a 10s poll of machineDetail for
 * roll-up freshness. Honest "—"/empty when a section is available:false.
 *
 * READ-ONLY. No control path. RBAC: machine_monitoring/canView (route + router guard).
 * i18n via t("cockpit.*","English default") fallbacks.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useRoute } from "wouter";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Environment, Grid, Stage, Gltf } from "@react-three/drei";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { MetricCard, PageHeader, StatusBadge, SectionCard, EmptyState } from "@/components/patterns";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  Cpu, Activity, HeartPulse, Gauge, AlertTriangle, FileStack, Boxes, GitBranch,
  Wrench, ShieldAlert, ArrowLeft, RefreshCw, Wifi, WifiOff, ExternalLink, Info,
  ScrollText, Radio, Upload, Waves, History, Timer, Package, FileText, ChevronRight,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type MachineDetail = RouterOutputs["assetCockpit"]["machineDetail"];
type GatedAction = MachineDetail["gatedActions"][number];

// ════════════════════════════════════════════════════════════════════════════
// SMALL HELPERS
// ════════════════════════════════════════════════════════════════════════════

const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);
const fmtNum = (v: number | null | undefined, digits = 0) =>
  v == null ? "—" : Number(v).toFixed(digits);
const fmtHours = (v: number | null | undefined) => (v == null ? "—" : `${Number(v).toFixed(1)} h`);

function relTime(ts: number | null | undefined, now: number): string {
  if (ts == null) return "—";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function tsToLocale(ts: number | null | undefined): string {
  return ts == null ? "—" : new Date(ts).toLocaleString();
}

/** Alarm severity → StatusBadge tone. */
function alarmTone(sev: string): "error" | "warning" | "info" {
  if (sev === "critical" || sev === "high") return "error";
  if (sev === "medium") return "warning";
  return "info";
}

/** Risk level → badge tone (metadata only, mirrors the capability model). */
function riskTone(risk: string): "error" | "warning" | "info" | "success" {
  switch ((risk ?? "").toLowerCase()) {
    case "critical": case "high": return "error";
    case "medium": return "warning";
    case "low": return "info";
    default: return "success";
  }
}

/** A compact "—" when a section is unavailable, else the child. */
function SectionValue({ available, children }: { available: boolean; children: React.ReactNode }) {
  if (!available) return <span className="text-muted-foreground">—</span>;
  return <>{children}</>;
}

// ── Compact circular gauge (replicates the HealthGauge / OEEGauge idea, dependency-free SVG) ──
function RadialGauge({
  value, label, color, sub,
}: {
  value: number | null;
  label: string;
  color: string;
  sub?: string;
}) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const r = 42;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={108} height={108} viewBox="0 0 108 108" className="-rotate-90">
        <circle cx={54} cy={54} r={r} fill="none" stroke="currentColor" strokeWidth={9} className="text-muted/40" />
        {value != null && (
          <circle
            cx={54} cy={54} r={r} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={off} style={{ transition: "stroke-dashoffset .5s ease" }}
          />
        )}
      </svg>
      <div className="-mt-[74px] mb-[40px] text-center">
        <div className="text-xl font-bold tabular-nums" style={{ color: value == null ? undefined : color }}>
          {value == null ? "—" : `${Math.round(value)}%`}
        </div>
      </div>
      <div className="text-sm font-medium">{label}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── Key/value row helper (used by Overview + several tabs) ──
function KV({ k, v, mono }: { k: React.ReactNode; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className={cn("text-right", mono && "font-mono text-xs")}>{v}</span>
    </div>
  );
}

// ── W8-A (doc 27 M13 / doc 29 §4.2): capabilities-vs-deviceType validation badge ──
// Fresh re-check via machine.checkCapabilities; honest three-state:
// validated OK / warnings (errors or unknown vendor keys) / nothing declared.
function CapabilitiesValidationBadge({ machineId }: { machineId: number }) {
  const { t } = useTranslation();
  const q = trpc.machine.checkCapabilities.useQuery({ id: machineId }, { retry: false, staleTime: 60_000 });
  if (q.isLoading || q.isError || !q.data) return null;
  const fresh = q.data.fresh;
  if (fresh.skipped) {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground">
        {t("cockpit.capsNone", "No declared capabilities")}
      </Badge>
    );
  }
  const warnCount = fresh.errors.length + fresh.unknownKeys.length;
  if (fresh.ok && warnCount === 0) {
    return (
      <Badge className="bg-emerald-500 text-[10px] text-white">
        {t("cockpit.capsOk", "Capabilities validated")} · {fresh.deviceTypeKey}
      </Badge>
    );
  }
  return (
    <Badge
      variant="destructive"
      className="text-[10px]"
      title={[
        ...fresh.errors.map((e: any) => `${e.path}: expected ${e.expected}, got ${e.got}`),
        ...(fresh.unknownKeys.length ? [`${t("cockpit.capsUnknownKeys", "vendor keys")}: ${fresh.unknownKeys.join(", ")}`] : []),
      ].join("\n")}
    >
      {t("cockpit.capsWarn", "Capabilities drift")} · {fresh.errors.length}/{fresh.unknownKeys.length}
    </Badge>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3D — glTF via drei <Gltf>, else a primitive block (same fallback as the twin).
// ════════════════════════════════════════════════════════════════════════════

function Model3DPane({
  model3d, name, t, canRegister, uploading, onUploadFile,
}: {
  model3d: MachineDetail["model3d"];
  name: string;
  t: (k: string, f: string) => string;
  canRegister?: boolean;
  uploading?: boolean;
  onUploadFile?: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [webglOk, setWebglOk] = useState(true);
  useEffect(() => {
    try {
      const el = document.createElement("canvas");
      setWebglOk(!!(el.getContext("webgl") || el.getContext("experimental-webgl")));
    } catch { setWebglOk(false); }
  }, []);

  const uri = model3d.available ? model3d.value?.modelUri ?? null : null;

  if (!webglOk) {
    return (
      <div className="flex h-[440px] items-center justify-center text-sm text-muted-foreground">
        {t("cockpit.no3d", "3D is not available in this browser.")}
      </div>
    );
  }
  return (
    <>
      {!model3d.available && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-info/30 bg-info/10 px-2 py-1 text-[11px] text-info">
          <Info className="h-3.5 w-3.5 shrink-0" />
          {t("cockpit.no3dModel", "No 3D model registered for this machine — showing a placeholder block.")}
        </div>
      )}
      {canRegister && onUploadFile && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadFile(f); e.currentTarget.value = ""; }}
          />
          <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            <Upload className={cn("mr-1 h-4 w-4", uploading && "animate-pulse")} />
            {uploading ? t("cockpit.model3dUploading", "Uploading…") : t("cockpit.model3dUpload", "Upload & register 3D model")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("cockpit.model3dHint", ".glb or .gltf (glTF 2.0) — becomes this machine's model")}
          </span>
        </div>
      )}
      <div className="h-[440px] w-full overflow-hidden rounded-lg border bg-[#0a0a0f]">
        <Canvas shadows dpr={[1, 2]}>
          <PerspectiveCamera makeDefault position={[3.2, 2.4, 3.2]} fov={50} />
          <OrbitControls enablePan enableZoom enableRotate minDistance={1.5} maxDistance={20} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[6, 8, 4]} intensity={1.1} castShadow />
          <Environment preset="warehouse" />
          <Grid args={[24, 24]} cellSize={0.5} cellThickness={0.5} cellColor="#1e293b" sectionSize={2} sectionColor="#334155" fadeDistance={26} infiniteGrid position={[0, -0.01, 0]} />
          <Suspense
            fallback={
              <mesh>
                <boxGeometry args={[1.5, 1, 1.5]} />
                <meshStandardMaterial color="#06b6d4" wireframe />
              </mesh>
            }
          >
            {uri ? (
              <Stage intensity={0.4} environment={null} adjustCamera={false}>
                <Gltf src={uri} />
              </Stage>
            ) : (
              <mesh castShadow position={[0, 0.5, 0]}>
                <boxGeometry args={[1.5, 1, 1.5]} />
                <meshStandardMaterial color="#3b82f6" metalness={0.4} roughness={0.5} />
              </mesh>
            )}
          </Suspense>
        </Canvas>
      </div>
      {model3d.available && model3d.value && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{model3d.value.modelKind}</Badge>
          <Badge variant="outline">{model3d.value.conversionStatus}</Badge>
          <span className="truncate">{name}</span>
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TELEMETRY / SENSOR TREND — reads machine_sensor_readings (the REAL vibration /
// current / temperature stream PdM now scores against). Historical line chart per
// sensor type with a statistical reference band overlay (mean ± 2σ). Honest empty
// state when no readings exist (e.g. sensor ingest not producing for this machine).
// ════════════════════════════════════════════════════════════════════════════

/** Feature → line colour (matches the twin / OEE palette used elsewhere). */
function sensorColor(feature: string): string {
  switch (feature) {
    case "vibration": return "#8b5cf6";
    case "current": return "#06b6d4";
    case "temperature": return "#f59e0b";
    default: return "#3b82f6";
  }
}

const SENSOR_WINDOWS: { label: string; hours: number }[] = [
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
];

function SensorTrendTab({ machineId }: { machineId: number }) {
  const { t } = useTranslation();
  const [windowHours, setWindowHours] = useState(24);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const typesQ = trpc.sensor.listTypes.useQuery(
    { machineId, windowHours: 24 * 7 },
    { retry: false, staleTime: 30_000 },
  );
  const types = typesQ.data?.available ? typesQ.data.types : [];

  // Default the selection to the highest-volume sensor type once types load.
  const effectiveType = selectedType ?? types[0]?.sensorType ?? null;

  const seriesQ = trpc.sensor.readSeries.useQuery(
    { machineId, sensorType: effectiveType ?? "", windowHours, maxPoints: 500 },
    { enabled: !!effectiveType, retry: false, refetchInterval: 30_000, staleTime: 10_000 },
  );
  const s = seriesQ.data;

  if (typesQ.isLoading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">{t("cockpit.loading", "Loading…")}</div>;
  }
  if (types.length === 0) {
    return (
      <EmptyState
        title={t("cockpit.noSensors", "No sensor telemetry")}
        description={t("cockpit.noSensorsHint", "No vibration / current / temperature readings have been ingested for this machine yet.")}
      />
    );
  }

  const color = sensorColor(s?.feature ?? "other");
  const band = s?.available ? s.referenceBand : null;
  const chartData = (s?.available ? s.series : []).map((p) => ({ t: p.t, value: p.value }));

  return (
    <div className="space-y-3">
      {/* Sensor-type selector + window selector */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {types.map((ty) => (
            <Button
              key={ty.sensorType}
              size="sm"
              variant={ty.sensorType === effectiveType ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setSelectedType(ty.sensorType)}
            >
              {ty.sensorType}
              <Badge variant="secondary" className="ml-1.5 px-1 text-[10px]">{ty.count}</Badge>
            </Button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          {SENSOR_WINDOWS.map((w) => (
            <Button
              key={w.hours}
              size="sm"
              variant={w.hours === windowHours ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setWindowHours(w.hours)}
            >
              {w.label}
            </Button>
          ))}
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => seriesQ.refetch()}>
            <RefreshCw className={cn("h-3.5 w-3.5", seriesQ.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Chart */}
      {seriesQ.isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">{t("cockpit.loading", "Loading…")}</div>
      ) : !s?.available || chartData.length === 0 ? (
        <EmptyState
          title={t("cockpit.noSensorWindow", "No readings in this window")}
          description={t("cockpit.noSensorWindowHint", "Try a wider time range, or this sensor has not reported recently.")}
        />
      ) : (
        <>
          <div className="h-[360px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  tick={{ fontSize: 11 }}
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  width={48}
                  domain={["auto", "auto"]}
                  label={s.unit ? { value: s.unit, angle: -90, position: "insideLeft", fontSize: 11 } : undefined}
                />
                <Tooltip
                  labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                  formatter={(val: number) => [`${Number(val).toFixed(3)}${s.unit ? ` ${s.unit}` : ""}`, s.sensorType]}
                  contentStyle={{ fontSize: 12 }}
                />
                {band && (
                  <>
                    <ReferenceLine y={band.mean} stroke={color} strokeDasharray="4 4" strokeOpacity={0.5}
                      label={{ value: t("cockpit.sensorMean", "mean"), fontSize: 10, fill: color, position: "right" }} />
                    <ReferenceLine y={band.upper} stroke="#ef4444" strokeDasharray="2 4" strokeOpacity={0.6}
                      label={{ value: "+2σ", fontSize: 10, fill: "#ef4444", position: "right" }} />
                    <ReferenceLine y={band.lower} stroke="#ef4444" strokeDasharray="2 4" strokeOpacity={0.6}
                      label={{ value: "-2σ", fontSize: 10, fill: "#ef4444", position: "right" }} />
                  </>
                )}
                <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.8} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Stats + honest band note */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
            {s.stats && (
              <>
                <span>{t("cockpit.sensorCount", "Readings")}: <span className="font-mono text-foreground">{s.rawCount}</span></span>
                <span>{t("cockpit.sensorMeanStat", "Mean")}: <span className="font-mono text-foreground">{s.stats.mean.toFixed(3)}</span></span>
                <span>σ: <span className="font-mono text-foreground">{s.stats.std.toFixed(3)}</span></span>
                <span>min/max: <span className="font-mono text-foreground">{s.stats.min.toFixed(2)} / {s.stats.max.toFixed(2)}</span></span>
              </>
            )}
          </div>
          {band && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Info className="h-3 w-3 shrink-0" />
              {t("cockpit.sensorBandNote", "The ±2σ band is a statistical reference from this window's data — not an engineering limit.")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAINTENANCE — the per-machine maintenance MEMORY (doc 40 §5-6, persona Hùng).
// 100% FRONTEND over already-existing read APIs — NO new router:
//   • work-order history   → maintenance.listWorkOrders({ machineId })
//   • downtime timeline     → oee.getDowntimeHistory({ machineId })
//   • spare parts consumed  → maintenance.listPartsForWorkOrder({ workOrderId })
//     (no by-machine roll-up endpoint exists → lazy per-work-order expand, honest)
// Everything is honest-null: empty states, "—" when a field is absent.
// ════════════════════════════════════════════════════════════════════════════

/** Work-order status → StatusBadge tone. */
function woStatusTone(status: string): "error" | "warning" | "info" | "success" {
  switch ((status ?? "").toUpperCase()) {
    case "COMPLETED": return "success";
    case "IN_PROGRESS": case "ON_HOLD": return "warning";
    case "OPEN": case "SCHEDULED": return "info";
    default: return "info"; // CANCELLED / unknown
  }
}

/** Downtime category → tone (mirrors the OEE downtime taxonomy). */
function downtimeTone(category: string): "error" | "warning" | "info" | "success" {
  switch ((category ?? "").toLowerCase()) {
    case "breakdown": case "unplanned": return "error";
    case "maintenance": case "changeover": return "warning";
    case "planned": return "info";
    default: return "info";
  }
}

const OPEN_WO_STATUSES = new Set(["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"]);

/** Minutes → "1h 20m" / "45m" (honest "—" when null). */
function fmtMinutes(v: number | null | undefined): string {
  if (v == null) return "—";
  const m = Math.max(0, Math.round(v));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

// ── Lazy spare-parts panel for ONE work order (fires only when expanded). ──
function WorkOrderParts({ workOrderId }: { workOrderId: number }) {
  const { t } = useTranslation();
  const q = trpc.maintenance.listPartsForWorkOrder.useQuery(
    { workOrderId },
    { retry: false, staleTime: 60_000 },
  );
  if (q.isLoading) {
    return <div className="px-3 py-2 text-xs text-muted-foreground">{t("cockpit.loading", "Loading…")}</div>;
  }
  const rows = q.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        {t("cockpit.moNoParts", "No spare parts recorded for this work order.")}
      </div>
    );
  }
  return (
    <div className="space-y-1 px-3 py-2">
      {rows.map((p) => (
        <div key={p.id} className="flex items-center gap-2 text-xs">
          <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="font-mono">{p.partCode}</span>
          <Badge variant="secondary" className="px-1 text-[10px]">×{p.quantityUsed}</Badge>
          {p.unitCost != null && (
            <span className="text-muted-foreground">@ {String(p.unitCost)}</span>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">{p.consumedAt ? new Date(p.consumedAt as string | number | Date).toLocaleString() : "—"}</span>
        </div>
      ))}
    </div>
  );
}

// ── One work-order row: summary line + expandable parts ledger. ──
function WorkOrderRow({ wo, now }: { wo: Record<string, any>; now: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const isOpen = OPEN_WO_STATUSES.has(String(wo.status ?? "").toUpperCase());
  const openedAt = wo.openedAt ? new Date(wo.openedAt).getTime() : null;
  const closedAt = wo.closedAt ? new Date(wo.closedAt).getTime() : null;
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <StatusBadge status={String(wo.status ?? "unknown")} tone={woStatusTone(String(wo.status ?? ""))} className="px-1.5 py-0 text-[10px] capitalize" />
        {wo.type != null && <Badge variant="outline" className="text-[10px]">{String(wo.type)}</Badge>}
        <span className="truncate text-sm font-medium">{String(wo.title ?? wo.workOrderNumber ?? `#${wo.id}`)}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {isOpen
            ? `${t("cockpit.moOpenedRel", "opened")} ${relTime(openedAt, now)}`
            : fmtMinutes(wo.downtimeMinutes)}
        </span>
      </button>
      {open && (
        <div className="border-t bg-muted/20">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-3">
            <KV k={t("cockpit.moNumber", "WO #")} v={<span className="font-mono text-xs">{String(wo.workOrderNumber ?? `#${wo.id}`)}</span>} />
            <KV k={t("cockpit.moPriority", "Priority")} v={wo.priority != null ? `P${wo.priority}` : "—"} />
            <KV k={t("cockpit.moTrigger", "Trigger")} v={wo.trigger ?? "—"} />
            <KV k={t("cockpit.moOpened", "Opened")} v={tsToLocale(openedAt)} />
            <KV k={t("cockpit.moStarted", "Repair started")} v={tsToLocale(wo.repairStartedAt ? new Date(wo.repairStartedAt).getTime() : null)} />
            <KV k={t("cockpit.moClosed", "Closed")} v={tsToLocale(closedAt)} />
            <KV k={t("cockpit.moMttr", "Downtime (MTTR span)")} v={fmtMinutes(wo.downtimeMinutes)} />
          </div>
          {wo.description && <div className="px-3 pb-1 text-xs text-muted-foreground">{String(wo.description)}</div>}
          {wo.resolutionNotes && (
            <div className="px-3 pb-1 text-xs">
              <span className="text-muted-foreground">{t("cockpit.moResolution", "Resolution")}: </span>
              {String(wo.resolutionNotes)}
            </div>
          )}
          <div className="border-t">
            <div className="px-3 pt-2 text-[11px] font-medium text-muted-foreground">{t("cockpit.moPartsUsed", "Spare parts used")}</div>
            <WorkOrderParts workOrderId={Number(wo.id)} />
          </div>
        </div>
      )}
    </div>
  );
}

function MaintenanceTab({ machineId, now }: { machineId: number; now: number }) {
  const { t } = useTranslation();

  const woQ = trpc.maintenance.listWorkOrders.useQuery(
    { machineId, limit: 100 },
    { retry: false, staleTime: 30_000 },
  );
  const dtQ = trpc.mqttClient.getDowntimeHistory.useQuery(
    { machineId },
    { retry: false, staleTime: 30_000 },
  );

  const workOrders = (woQ.data ?? []) as Array<Record<string, any>>;
  const downtime = (dtQ.data ?? []) as Array<Record<string, any>>;

  // MTTR / open-count roll-up derived purely from the WO list (honest, no fabrication).
  const summary = useMemo(() => {
    const open = workOrders.filter((w) => OPEN_WO_STATUSES.has(String(w.status ?? "").toUpperCase())).length;
    const closed = workOrders.filter((w) => String(w.status ?? "").toUpperCase() === "COMPLETED");
    const withDt = closed.filter((w) => w.downtimeMinutes != null);
    const mttr = withDt.length
      ? withDt.reduce((s, w) => s + Number(w.downtimeMinutes), 0) / withDt.length
      : null;
    const dtMin = downtime.reduce((s, e) => s + (e.duration != null ? Number(e.duration) : 0), 0);
    return { total: workOrders.length, open, closed: closed.length, mttr, dtCount: downtime.length, dtMin };
  }, [workOrders, downtime]);

  return (
    <div className="space-y-4">
      {/* Roll-up strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard icon={<History className="h-4 w-4" />} label={t("cockpit.moTotal", "Work orders")} value={String(summary.total)} />
        <MetricCard icon={<Wrench className="h-4 w-4" />} label={t("cockpit.moOpen", "Open")} value={String(summary.open)} tone={summary.open > 0 ? "warning" : "default"} />
        <MetricCard icon={<Timer className="h-4 w-4" />} label={t("cockpit.moMttrAvg", "Avg MTTR")} value={fmtMinutes(summary.mttr)} />
        <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label={t("cockpit.moDtEvents", "Downtime events")} value={`${summary.dtCount} · ${fmtMinutes(summary.dtMin)}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Work-order history */}
        <SectionCard icon={<History className="h-4 w-4" />} title={t("cockpit.moHistory", "Work-order history")} description={t("cockpit.moHistoryHint", "Every maintenance work order for this machine — expand for detail + parts.")}>
          {woQ.isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">{t("cockpit.loading", "Loading…")}</div>
          ) : workOrders.length === 0 ? (
            <EmptyState title={t("cockpit.moNoWo", "No work orders")} description={t("cockpit.moNoWoHint", "No maintenance work orders have been recorded for this machine.")} />
          ) : (
            <ScrollArea className="h-[440px] pr-2">
              <div className="space-y-2">
                {workOrders.map((wo) => (
                  <WorkOrderRow key={String(wo.id)} wo={wo} now={now} />
                ))}
              </div>
            </ScrollArea>
          )}
        </SectionCard>

        {/* Downtime timeline */}
        <SectionCard icon={<Timer className="h-4 w-4" />} title={t("cockpit.moDowntime", "Downtime timeline")} description={t("cockpit.moDowntimeHint", "Recorded downtime intervals + reason for this machine.")}>
          {dtQ.isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">{t("cockpit.loading", "Loading…")}</div>
          ) : downtime.length === 0 ? (
            <EmptyState title={t("cockpit.moNoDt", "No downtime recorded")} description={t("cockpit.moNoDtHint", "No downtime intervals have been logged for this machine.")} />
          ) : (
            <ScrollArea className="h-[440px] pr-2">
              <div className="space-y-2">
                {downtime.map((e, i) => {
                  const start = e.startTime ? new Date(e.startTime).getTime() : null;
                  const end = e.endTime ? new Date(e.endTime).getTime() : null;
                  const ongoing = start != null && end == null;
                  return (
                    <div key={String(e.id ?? i)} className="rounded-md border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={String(e.category ?? "other")} tone={downtimeTone(String(e.category ?? ""))} className="px-1.5 py-0 text-[10px] capitalize" />
                        {ongoing
                          ? <Badge className="bg-red-500 px-1.5 py-0 text-[10px] text-white">{t("cockpit.moOngoing", "ONGOING")}</Badge>
                          : <span className="text-xs font-medium">{fmtMinutes(e.duration)}</span>}
                        <span className="ml-auto text-[11px] text-muted-foreground">{tsToLocale(start)}</span>
                      </div>
                      {e.reason && <div className="mt-1 text-sm">{String(e.reason)}</div>}
                      {e.notes && <div className="mt-0.5 text-xs text-muted-foreground">{String(e.notes)}</div>}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </SectionCard>
      </div>

      {/* Documents / manuals — honest empty: no per-machine attachment endpoint exists yet. */}
      <SectionCard icon={<FileText className="h-4 w-4" />} title={t("cockpit.moDocs", "Manuals & documents")}>
        <EmptyState
          title={t("cockpit.moNoDocs", "No documents attached")}
          description={t("cockpit.moNoDocsHint", "No maintenance manuals or documents are linked to this machine yet.")}
        />
      </SectionCard>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PAGE
// ════════════════════════════════════════════════════════════════════════════

export default function MachineCockpit() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/machine/:id");
  const machineId = Number(params?.id);
  const validId = Number.isFinite(machineId) && machineId > 0;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const detailQ = trpc.assetCockpit.machineDetail.useQuery(
    { machineId },
    { enabled: validId, refetchInterval: 10_000, staleTime: 5_000, retry: false },
  );
  const d = detailQ.data;

  // ── 3D model upload & register (management action; RBAC-gated, not flag-gated). ──
  const { hasPermission, isAdmin } = usePermissions();
  const canRegisterModel = isAdmin === true || hasPermission("machine_control", "canCreate");
  const uploadModelMut = trpc.twin.models.uploadAndRegister.useMutation({
    onSuccess: () => {
      toast.success(t("cockpit.model3dUploaded", "3D model uploaded & registered."));
      detailQ.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const handleModelFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      const b64 = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw; // strip data: prefix
      if (!b64) { toast.error(t("cockpit.model3dReadErr", "Could not read the file.")); return; }
      uploadModelMut.mutate({ machineId, filename: file.name, contentBase64: b64 });
    };
    reader.onerror = () => toast.error(t("cockpit.model3dReadErr", "Could not read the file."));
    reader.readAsDataURL(file);
  };

  // ── LIVE status via the shared socket (machine room / telemetry:sample). When a
  // sample lands for THIS machine, nudge a refetch so the live state + KPIs refresh. ──
  const [liveTick, setLiveTick] = useState(0);
  useEffect(() => {
    if (!validId) return;
    const socket = getSharedSocket();
    const onConnect = () => socket.emit("subscribe", { machineId });
    const onSample = (evt: { machineId?: number }) => {
      if (evt?.machineId === machineId) setLiveTick((x) => x + 1);
    };
    socket.on("connect", onConnect);
    socket.on("telemetry:sample", onSample);
    if (socket.connected) onConnect();
    return () => {
      socket.emit("unsubscribe", { machineId });
      socket.off("connect", onConnect);
      socket.off("telemetry:sample", onSample);
      releaseSharedSocket();
    };
  }, [validId, machineId]);
  useEffect(() => {
    if (liveTick > 0) detailQ.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTick]);

  const connected = d?.liveState.available ? d.liveState.value?.connected : undefined;

  if (!validId) {
    return (
      <DashboardLayout>
        <div className="p-4">
          <EmptyState title={t("cockpit.badId", "Invalid machine id")} description={t("cockpit.badIdHint", "This URL does not reference a machine.")} />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4 p-1">
        {/* Header */}
        <PageHeader
          icon={<Cpu className="h-6 w-6" />}
          title={d ? `${d.identity.name}` : t("cockpit.machine", "Machine cockpit")}
          description={
            d
              ? [d.identity.code, d.identity.machineType, d.identity.factoryName, d.identity.lineName]
                  .filter(Boolean)
                  .join(" · ")
              : t("cockpit.loadingMachine", "Loading machine…")
          }
          actions={
            <div className="flex items-center gap-2">
              {connected === true && (
                <Badge className="gap-1 bg-emerald-500 text-white"><Wifi className="h-3.5 w-3.5" /> {t("cockpit.online", "ONLINE")}</Badge>
              )}
              {connected === false && (
                <Badge className="gap-1 bg-muted text-muted-foreground"><WifiOff className="h-3.5 w-3.5" /> {t("cockpit.offline", "OFFLINE")}</Badge>
              )}
              <Button size="sm" variant="outline" onClick={() => setLocation("/device-monitor")}>
                <ArrowLeft className="mr-1 h-4 w-4" /> {t("cockpit.back", "Back")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => detailQ.refetch()}>
                <RefreshCw className={cn("mr-1 h-4 w-4", detailQ.isFetching && "animate-spin")} /> {t("cockpit.refresh", "Refresh")}
              </Button>
            </div>
          }
        />

        {detailQ.isError ? (
          <EmptyState
            title={t("cockpit.notFound", "Machine not found")}
            description={t("cockpit.notFoundHint", "No machine exists for this id, or it is not visible to you.")}
          />
        ) : detailQ.isLoading || !d ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{t("cockpit.loading", "Loading cockpit…")}</div>
        ) : (
          <Tabs defaultValue="overview" className="w-full">
            <ScrollArea className="w-full">
              <TabsList className="mb-2 inline-flex w-max">
                <TabsTrigger value="overview"><Activity className="mr-1 h-4 w-4" />{t("cockpit.tabOverview", "Overview")}</TabsTrigger>
                <TabsTrigger value="health"><HeartPulse className="mr-1 h-4 w-4" />{t("cockpit.tabHealth", "Health / PdM")}</TabsTrigger>
                <TabsTrigger value="telemetry"><Waves className="mr-1 h-4 w-4" />{t("cockpit.tabTelemetry", "Telemetry")}</TabsTrigger>
                <TabsTrigger value="oee"><Gauge className="mr-1 h-4 w-4" />{t("cockpit.tabOee", "OEE")}</TabsTrigger>
                <TabsTrigger value="alarms"><AlertTriangle className="mr-1 h-4 w-4" />{t("cockpit.tabAlarms", "Alarms")}</TabsTrigger>
                <TabsTrigger value="recipes"><FileStack className="mr-1 h-4 w-4" />{t("cockpit.tabRecipes", "Recipes")}</TabsTrigger>
                <TabsTrigger value="programs"><ScrollText className="mr-1 h-4 w-4" />{t("cockpit.tabPrograms", "Programs")}</TabsTrigger>
                <TabsTrigger value="genealogy"><GitBranch className="mr-1 h-4 w-4" />{t("cockpit.tabGenealogy", "Genealogy")}</TabsTrigger>
                <TabsTrigger value="model3d"><Boxes className="mr-1 h-4 w-4" />{t("cockpit.tab3d", "3D")}</TabsTrigger>
                <TabsTrigger value="maintenance"><History className="mr-1 h-4 w-4" />{t("cockpit.tabMaintenance", "Maintenance")}</TabsTrigger>
                <TabsTrigger value="actions"><Wrench className="mr-1 h-4 w-4" />{t("cockpit.tabActions", "Actions")}</TabsTrigger>
              </TabsList>
            </ScrollArea>

            {/* ── OVERVIEW ── */}
            <TabsContent value="overview" className="space-y-4">
              {/* KPI strip */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard
                  icon={<Gauge className="h-4 w-4" />}
                  label={t("cockpit.kpiOee", "OEE")}
                  value={d.oee.available ? fmtPct(d.oee.value?.oee ?? null) : "—"}
                  tone={d.oee.value?.oee != null && d.oee.value.oee < 60 ? "warning" : "default"}
                />
                <MetricCard
                  icon={<HeartPulse className="h-4 w-4" />}
                  label={t("cockpit.kpiRisk", "Failure risk")}
                  value={d.health.available ? fmtPct(d.health.value?.failureRisk != null ? d.health.value.failureRisk * 100 : null) : "—"}
                  tone={d.health.value?.failureRisk != null && d.health.value.failureRisk > 0.6 ? "error" : "default"}
                />
                <MetricCard
                  icon={<AlertTriangle className="h-4 w-4" />}
                  label={t("cockpit.kpiAlarms", "Active alarms")}
                  value={d.alarms.available ? String(d.alarms.value?.length ?? 0) : "—"}
                  tone={(d.alarms.value?.length ?? 0) > 0 ? "warning" : "default"}
                />
                <MetricCard
                  icon={<Radio className="h-4 w-4" />}
                  label={t("cockpit.kpiConn", "Connection")}
                  value={connected == null ? "—" : connected ? t("cockpit.connected", "Connected") : t("cockpit.disconnected", "Disconnected")}
                  tone={connected ? "success" : connected === false ? "error" : "default"}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Identity + hierarchy */}
                <SectionCard icon={<Cpu className="h-4 w-4" />} title={t("cockpit.identity", "Identity")}>
                  <KV k={t("cockpit.code", "Code")} v={d.identity.code} mono />
                  <KV k={t("cockpit.type", "Type")} v={d.identity.machineType} />
                  <KV k={t("cockpit.model", "Model")} v={d.identity.model ?? "—"} />
                  <KV k={t("cockpit.manufacturer", "Manufacturer")} v={d.identity.manufacturer ?? "—"} />
                  <KV k={t("cockpit.station", "Station")} v={d.identity.stationCode ?? "—"} />
                  <KV k={t("cockpit.line", "Line")} v={d.identity.lineName ?? "—"} />
                  <KV k={t("cockpit.factory", "Factory")} v={d.identity.factoryName ?? "—"} />
                  <KV k={t("cockpit.corporate", "Corporate")} v={d.identity.corporateCode ?? "—"} />
                  <KV k={t("cockpit.active", "Active")} v={<StatusBadge status={d.identity.isActive ? "active" : "offline"} className="px-1.5 py-0 text-[11px]" />} />
                </SectionCard>

                {/* Resolved capability */}
                <SectionCard icon={<Activity className="h-4 w-4" />} title={t("cockpit.capability", "Resolved capability")}>
                  {/* W8-A (M13): declared-capabilities validation vs deviceTypes contract */}
                  <div className="mb-1"><CapabilitiesValidationBadge machineId={machineId} /></div>
                  <SectionValue available={d.resolvedCapability.available}>
                    {d.resolvedCapability.value && (
                      <div className="space-y-2">
                        <KV k={t("cockpit.equipClass", "Equipment class")} v={d.resolvedCapability.value.equipmentClass} />
                        <KV k={t("cockpit.adapterKind", "Adapter kind")} v={d.resolvedCapability.value.adapterKind} />
                        <KV k={t("cockpit.deviceType", "Device type")} v={<Badge variant="outline">{d.resolvedCapability.value.deviceType}</Badge>} />
                        <div className="pt-1">
                          <div className="mb-1 text-xs text-muted-foreground">{t("cockpit.packmlStates", "PackML states")}</div>
                          <div className="flex flex-wrap gap-1">
                            {d.resolvedCapability.value.packmlStates.map((s) => (
                              <Badge key={String(s)} variant="secondary" className="text-[10px]">{String(s)}</Badge>
                            ))}
                          </div>
                        </div>
                        <div className="pt-1">
                          <div className="mb-1 text-xs text-muted-foreground">{t("cockpit.telemetryTags", "Telemetry tags")} ({d.resolvedCapability.value.telemetryTags.length})</div>
                          <div className="flex flex-wrap gap-1">
                            {d.resolvedCapability.value.telemetryTags.slice(0, 12).map((tag) => (
                              <Badge key={String((tag as { name?: string })?.name ?? JSON.stringify(tag))} variant="outline" className="text-[10px]">
                                {String((tag as { name?: string })?.name ?? tag)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </SectionValue>
                </SectionCard>

                {/* Live state + PackML */}
                <SectionCard icon={<Radio className="h-4 w-4" />} title={t("cockpit.liveState", "Live state")}>
                  <SectionValue available={d.liveState.available}>
                    {d.liveState.value && (
                      <div className="space-y-1">
                        <KV k={t("cockpit.status", "Status")} v={<StatusBadge status={d.liveState.value.status ?? "unknown"} className="px-1.5 py-0 text-[11px]" />} />
                        <KV k={t("cockpit.packml", "PackML / op")} v={d.liveState.value.operationStatus ?? "—"} />
                        <KV k={t("cockpit.lastChange", "Last change")} v={tsToLocale(d.liveState.value.lastStatusChange)} />
                        <KV k={t("cockpit.heartbeat", "Heartbeat")} v={d.liveState.value.heartbeatStatus ?? "—"} />
                        <KV k={t("cockpit.lastHeartbeat", "Last heartbeat")} v={relTime(d.liveState.value.lastHeartbeat, now)} />
                        <KV k={t("cockpit.connection", "Connection")} v={<StatusBadge status={d.liveState.value.connected ? "connected" : "offline"} className="px-1.5 py-0 text-[11px]" />} />
                      </div>
                    )}
                  </SectionValue>
                </SectionCard>
              </div>
            </TabsContent>

            {/* ── HEALTH / PdM ── */}
            <TabsContent value="health">
              <SectionCard icon={<HeartPulse className="h-4 w-4" />} title={t("cockpit.tabHealth", "Health / PdM")} description={d.health.source}>
                {!d.health.available || !d.health.value ? (
                  <EmptyState title={t("cockpit.noHealth", "No health data")} description={t("cockpit.noHealthHint", "No PdM risk / reliability data for this machine yet.")} />
                ) : (
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-center justify-around gap-6">
                      <RadialGauge
                        value={d.health.value.failureRisk != null ? d.health.value.failureRisk * 100 : null}
                        label={t("cockpit.failureRisk", "Failure risk")}
                        color={d.health.value.failureRisk != null && d.health.value.failureRisk > 0.6 ? "#ef4444" : "#f59e0b"}
                        sub={d.health.value.maintenanceUrgency ?? undefined}
                      />
                      <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                        <MetricCard icon={<Wrench className="h-4 w-4" />} label={t("cockpit.mtbf", "MTBF")} value={fmtHours(d.health.value.mtbfHours)} />
                        <MetricCard icon={<Wrench className="h-4 w-4" />} label={t("cockpit.mttr", "MTTR")} value={fmtHours(d.health.value.mttrHours)} />
                        <MetricCard icon={<HeartPulse className="h-4 w-4" />} label={t("cockpit.rul", "RUL (PdM horizon)")} value={fmtHours(d.health.value.rulHours)} />
                        <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label={t("cockpit.timeframe", "Predicted timeframe")} value={fmtHours(d.health.value.predictedTimeframeHours)} />
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("cockpit.recMaint", "Recommended maintenance")}: {tsToLocale(d.health.value.recommendedMaintenanceDate)}
                      {" · "}{t("cockpit.rulNote", "RUL is the PdM predicted horizon (no dedicated RUL regressor yet).")}
                    </div>
                  </div>
                )}
              </SectionCard>
            </TabsContent>

            {/* ── TELEMETRY / SENSOR TREND ── */}
            <TabsContent value="telemetry">
              <SectionCard
                icon={<Waves className="h-4 w-4" />}
                title={t("cockpit.tabTelemetry", "Telemetry")}
                description={t("cockpit.telemetryHint", "Historical vibration / current / temperature — the same sensor stream PdM scores against.")}
              >
                <SensorTrendTab machineId={machineId} />
              </SectionCard>
            </TabsContent>

            {/* ── OEE ── */}
            <TabsContent value="oee">
              <SectionCard icon={<Gauge className="h-4 w-4" />} title={t("cockpit.tabOee", "OEE")} description={d.oee.source}>
                {!d.oee.available || !d.oee.value ? (
                  <EmptyState title={t("cockpit.noOee", "No OEE data")} description={t("cockpit.noOeeHint", "No uptime / production data for this machine yet.")} />
                ) : (
                  <div className="flex flex-wrap items-center justify-around gap-6 py-2">
                    <RadialGauge value={d.oee.value.availability} label={t("cockpit.availability", "Availability")} color="#3b82f6" />
                    <RadialGauge value={d.oee.value.performance} label={t("cockpit.performance", "Performance")} color="#8b5cf6" />
                    <RadialGauge value={d.oee.value.quality} label={t("cockpit.quality", "Quality")} color="#10b981" />
                    <RadialGauge value={d.oee.value.oee} label="OEE" color="#f59e0b" />
                  </div>
                )}
              </SectionCard>
            </TabsContent>

            {/* ── ALARMS ── */}
            <TabsContent value="alarms">
              <SectionCard icon={<AlertTriangle className="h-4 w-4" />} title={t("cockpit.tabAlarms", "Alarms")} description={t("cockpit.alarmsHint", "Per-machine ISA-18.2 normalized feed")}>
                {!d.alarms.available || (d.alarms.value?.length ?? 0) === 0 ? (
                  <EmptyState title={t("cockpit.noAlarms", "No active alarms")} description={t("cockpit.noAlarmsHint", "This machine has no recent normalized alarms.")} />
                ) : (
                  <ScrollArea className="h-[440px] pr-2">
                    <div className="space-y-2">
                      {d.alarms.value!.map((a, i) => (
                        <div key={`${a.standardCode}-${a.ts}-${i}`} className="rounded-md border px-3 py-2">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={a.severity} tone={alarmTone(a.severity)} className="px-1.5 py-0 text-[11px] capitalize" />
                            <span className="font-mono text-xs">{a.standardCode}</span>
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">{a.source}</Badge>
                            <span className="ml-auto text-[11px] text-muted-foreground">{tsToLocale(a.ts)}</span>
                          </div>
                          {a.description && <div className="mt-1 text-sm">{a.description}</div>}
                          {a.recommendedAction && <div className="mt-0.5 text-xs text-muted-foreground">→ {a.recommendedAction}</div>}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </SectionCard>
            </TabsContent>

            {/* ── RECIPES ── */}
            <TabsContent value="recipes">
              <SectionCard icon={<FileStack className="h-4 w-4" />} title={t("cockpit.tabRecipes", "Recipes")} description={t("cockpit.recipesHint", "Recipe load / deploy history for this machine")}>
                {!d.recipes.available || ((d.recipes.value?.loadHistory?.length ?? 0) === 0) ? (
                  <EmptyState title={t("cockpit.noRecipes", "No recipe history")} description={t("cockpit.noRecipesHint", "No recipe loads recorded for this machine.")} />
                ) : (
                  <ScrollArea className="h-[440px] pr-2">
                    <div className="space-y-2">
                      {(d.recipes.value!.loadHistory as Array<Record<string, unknown>>).map((h, i) => (
                        <div key={i} className="rounded-md border px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{String(h.recipeName ?? h.recipeCode ?? h.recipeId ?? `#${i + 1}`)}</span>
                            {h.version != null && <Badge variant="outline" className="text-[10px]">v{String(h.version)}</Badge>}
                            {h.status != null && <StatusBadge status={String(h.status)} className="px-1.5 py-0 text-[10px]" />}
                            <span className="ml-auto text-[11px] text-muted-foreground">
                              {h.loadedAt != null ? new Date(String(h.loadedAt)).toLocaleString() : h.createdAt != null ? new Date(String(h.createdAt)).toLocaleString() : ""}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </SectionCard>
            </TabsContent>

            {/* ── PROGRAMS ── */}
            <TabsContent value="programs">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <SectionCard icon={<ScrollText className="h-4 w-4" />} title={t("cockpit.projects", "Program projects")}>
                  {!d.programs.available || ((d.programs.value?.projects?.length ?? 0) === 0) ? (
                    <EmptyState title={t("cockpit.noPrograms", "No programs")} description={t("cockpit.noProgramsHint", "No program projects bound to this machine.")} />
                  ) : (
                    <div className="space-y-2">
                      {(d.programs.value!.projects as Array<Record<string, unknown>>).map((p, i) => (
                        <div key={i} className="rounded-md border px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{String(p.name ?? p.title ?? `#${p.id ?? i}`)}</span>
                            {p.kind != null && <Badge variant="outline" className="text-[10px]">{String(p.kind)}</Badge>}
                            {p.status != null && <StatusBadge status={String(p.status)} className="px-1.5 py-0 text-[10px]" />}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
                <SectionCard icon={<ScrollText className="h-4 w-4" />} title={t("cockpit.deployments", "Deployments")}>
                  {!d.programs.available || ((d.programs.value?.deployments?.length ?? 0) === 0) ? (
                    <EmptyState title={t("cockpit.noDeploy", "No deployments")} description={t("cockpit.noDeployHint", "No deploy audit rows for this machine.")} />
                  ) : (
                    <ScrollArea className="h-[380px] pr-2">
                      <div className="space-y-2">
                        {(d.programs.value!.deployments as Array<Record<string, unknown>>).map((dep, i) => (
                          <div key={i} className="rounded-md border px-3 py-2 text-sm">
                            <div className="flex items-center gap-2">
                              {dep.status != null && <StatusBadge status={String(dep.status)} className="px-1.5 py-0 text-[10px]" />}
                              <span className="font-mono text-xs">{String(dep.buildId ?? dep.version ?? `#${dep.id ?? i}`)}</span>
                              <span className="ml-auto text-[11px] text-muted-foreground">
                                {dep.createdAt != null ? new Date(String(dep.createdAt)).toLocaleString() : ""}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </SectionCard>
              </div>
            </TabsContent>

            {/* ── GENEALOGY ── */}
            <TabsContent value="genealogy">
              <SectionCard icon={<GitBranch className="h-4 w-4" />} title={t("cockpit.tabGenealogy", "Genealogy")} description={t("cockpit.genealogyHint", "Recent product traceability at this machine's station")}>
                {!d.genealogy.available || ((d.genealogy.value?.length ?? 0) === 0) ? (
                  <EmptyState title={t("cockpit.noGenealogy", "No traceability records")} description={t("cockpit.noGenealogyHint", "No recent genealogy records for this station.")} />
                ) : (
                  <ScrollArea className="h-[440px] pr-2">
                    <div className="space-y-2">
                      {(d.genealogy.value as Array<Record<string, unknown>>).map((g, i) => (
                        <div key={i} className="rounded-md border px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs">{String(g.serialNumber ?? g.unitSerial ?? g.lotId ?? `#${g.id ?? i}`)}</span>
                            {g.result != null && <StatusBadge status={String(g.result)} className="px-1.5 py-0 text-[10px]" />}
                            <span className="ml-auto text-[11px] text-muted-foreground">
                              {g.recordedAt != null ? new Date(String(g.recordedAt)).toLocaleString() : ""}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </SectionCard>
            </TabsContent>

            {/* ── 3D ── */}
            <TabsContent value="model3d">
              <SectionCard icon={<Boxes className="h-4 w-4" />} title={t("cockpit.tab3d", "3D model")} description={d.model3d.source}>
                <Model3DPane
                  model3d={d.model3d}
                  name={d.identity.name}
                  t={t}
                  canRegister={canRegisterModel}
                  uploading={uploadModelMut.isPending}
                  onUploadFile={handleModelFile}
                />
              </SectionCard>
            </TabsContent>

            {/* ── MAINTENANCE (work-order memory + downtime + parts) ── */}
            <TabsContent value="maintenance">
              <MaintenanceTab machineId={machineId} now={now} />
            </TabsContent>

            {/* ── ACTIONS (gated, propose-only) ── */}
            <TabsContent value="actions">
              <SectionCard
                icon={<Wrench className="h-4 w-4" />}
                title={t("cockpit.tabActions", "Actions")}
                description={t("cockpit.actionsHint", "Commands you MAY propose. Execution stays behind the existing gated (HITL / dry-run) control surface — nothing runs from here.")}
              >
                <div className="mb-3 flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  {t("cockpit.actionsGate", "Read-only cockpit. \"Propose\" opens the gated Control Plane — it never dispatches a command directly.")}
                </div>
                {d.gatedActions.length === 0 ? (
                  <EmptyState title={t("cockpit.noActions", "No commands")} description={t("cockpit.noActionsHint", "This machine's capability profile exposes no proposable commands.")} />
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {d.gatedActions.map((a: GatedAction) => (
                      <div key={a.name} className="rounded-md border px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{a.label}</span>
                          <StatusBadge status={a.riskLevel} tone={riskTone(a.riskLevel)} className="px-1.5 py-0 text-[10px] capitalize" />
                          {a.packmlCommand && <Badge variant="outline" className="text-[10px]">{a.packmlCommand}</Badge>}
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-muted-foreground">{t("cockpit.requires", "Requires")}: {a.requiredPermission}</span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setLocation(`/control-plane?machineId=${machineId}&command=${encodeURIComponent(a.name)}`)}
                          >
                            <ExternalLink className="mr-1 h-3.5 w-3.5" /> {t("cockpit.propose", "Propose")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}
