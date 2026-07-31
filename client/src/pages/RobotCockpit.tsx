/**
 * U3 (doc 21 §6 / §3 G-4, G-5) — ROBOT COCKPIT — the unified per-robot detail page.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Route `/robot/:id`. ONE tabbed cockpit over `assetCockpit.robotDetail(id)` (§11) —
 * identity, full live telemetry (mode / busy / estop / speed / pose / joints / battery /
 * safety zone / firmware / heartbeat), capability + gated-action metadata, jobs, fleet
 * tasks, IR programs, safety zone reactions, behaviour anomalies, per-robot normalized
 * alarms, 3D model, and a SAMPLE kinematic chain for the joint/pose viz.
 *
 * LIVE (closes G-5): subscribes the shared socket to room `robot:{id}` and applies the
 * compact `robot:telemetry` UDM in place, so the Overview + Joints tabs update without a
 * refetch. A slow 15s poll of robotDetail refreshes the non-live sections.
 *
 * JOINT VIZ CHOICE — a clean 2D JOINT-BAR READOUT (not a 3D FK arm). The forward-kinematics
 * solver + DH chain live SERVER-SIDE (sim/kinematicModel.ts) and are not exported to the
 * client; porting FK to drive a 3D arm would add real build/regression risk for little gain
 * over the honest data we actually have (live jointStates + per-joint limits from the sample
 * chain). So Joints renders each joint's LIVE value against its limit band as a bar — precise,
 * dependency-free, always builds. The 3D tab still renders the registered glTF model via drei
 * <Gltf> (else a primitive). The kinematic model's `isSample` note is shown honestly.
 *
 * TEACH/JOG — promotes the existing <TeachJogPanel> here. It stays behind the real gate: the
 * panel edits a LOCAL tmscript buffer only (no dispatch); running it on a real robot needs the
 * gated robotCommandDispatcher (ROBOT_CONTROL_ENABLED + HITL), which this cockpit does NOT call.
 * Labeled "preview / gated" honestly.
 *
 * ACTIONS — gatedActions METADATA ONLY; "Propose" routes to the gated /command-console
 * surface (typed-confirm + interlock preview). Nothing executes from this page.
 *
 * READ-ONLY. RBAC: machine_monitoring/canView. i18n via t("cockpit.*","English default").
 * ════════════════════════════════════════════════════════════════════════════
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useRoute } from "wouter";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Environment, Grid, Stage, Gltf } from "@react-three/drei";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import DashboardLayout from "@/components/DashboardLayout";
import { MetricCard, PageHeader, StatusBadge, SectionCard, EmptyState } from "@/components/patterns";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { TeachJogPanel } from "@/components/engineering/TeachJogPanel";
import { Sparkline } from "@/components/patterns/Sparkline";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { withParams } from "@/lib/engineeringDeepLink";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import {
  Bot, Activity, Sliders, ListChecks, Boxes, ScrollText, ShieldAlert, AlertTriangle,
  Wrench, ArrowLeft, RefreshCw, Wifi, WifiOff, ExternalLink, Info, Radio, Battery,
  Gamepad2, Zap, OctagonAlert, Save, BellOff, TrendingUp, Loader2,
} from "lucide-react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type RobotDetail = RouterOutputs["assetCockpit"]["robotDetail"];
type RobotLiveTelemetry = NonNullable<RobotDetail["liveTelemetry"]["value"]>;
type GatedAction = RobotDetail["gatedActions"][number];

/** The compact `robot:telemetry` UDM the server emits into room `robot:{id}`. */
interface RobotTelemetryEvent {
  robotId?: number;
  mode?: string | null;
  busy?: boolean | null;
  estop?: boolean | null;
  speedPct?: number | null;
  pose?: Record<string, unknown> | null;
  jointStates?: Array<Record<string, unknown>> | null;
  batteryPct?: number | null;
  safetyZoneId?: number | null;
  firmwareVersion?: string | null;
  status?: string | null;
  ts?: number | null;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

const fmtNum = (v: number | null | undefined, digits = 0) => (v == null ? "—" : Number(v).toFixed(digits));

/**
 * Render a telemetry descriptor / tag readably — NEVER "[object Object]".
 * Capability telemetry tags are TelemetryDescriptor objects ({ key, label, ... }),
 * so extract the human field; tolerate legacy string tags and null.
 */
function telemetryTagLabel(tag: unknown): string {
  if (tag == null) return "—";
  if (typeof tag === "string") return tag;
  if (typeof tag === "object") {
    const o = tag as { label?: unknown; key?: unknown; name?: unknown };
    const v = o.label ?? o.key ?? o.name;
    if (typeof v === "string" && v.trim().length > 0) return v;
    return JSON.stringify(tag);
  }
  return String(tag);
}

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
function alarmTone(sev: string): "error" | "warning" | "info" {
  if (sev === "critical" || sev === "high") return "error";
  if (sev === "medium") return "warning";
  return "info";
}
function riskTone(risk: string): "error" | "warning" | "info" | "success" {
  switch ((risk ?? "").toLowerCase()) {
    case "critical": case "high": return "error";
    case "medium": return "warning";
    case "low": return "info";
    default: return "success";
  }
}

function KV({ k, v, mono }: { k: React.ReactNode; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className={cn("text-right", mono && "font-mono text-xs")}>{v}</span>
    </div>
  );
}

/** Read a numeric joint value from a loose jointState record (name-agnostic). */
function jointValue(j: Record<string, unknown> | undefined): number | null {
  if (!j) return null;
  const cand = j.position ?? j.value ?? j.angle ?? j.q ?? j.rad;
  const n = typeof cand === "string" ? Number(cand) : (cand as number | undefined);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// ════════════════════════════════════════════════════════════════════════════
// JOINTS — 2D live joint-bar readout: each kinematic joint's live value vs its limits.
// ════════════════════════════════════════════════════════════════════════════

function JointBars({
  kinematic, live, chron, t,
}: {
  kinematic: RobotDetail["kinematicModel"];
  live: RobotLiveTelemetry | null;
  /** ENG-F14 — telemetry cũ→mới để vẽ mini-trend từng khớp. */
  chron: Array<Record<string, unknown>>;
  t: (k: string, f: string) => string;
}) {
  const model = kinematic.available ? kinematic.value?.model : null;
  const joints = (model?.joints ?? []).filter((j) => j.type !== "fixed");
  const liveJoints = live?.jointStates ?? null;

  if (!model) {
    return <EmptyState title={t("cockpit.noKinematic", "No kinematic model")} description={t("cockpit.noKinematicHint", "No kinematic chain is available for this robot kind.")} />;
  }
  return (
    <div className="space-y-4">
      {kinematic.value?.isSample && (
        <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
          <Info className="h-4 w-4 shrink-0" />
          <span>{kinematic.value.note}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant="secondary">{model.label}</Badge>
        <span className="text-muted-foreground">{t("cockpit.dof", "DOF")}: {model.dof}</span>
        <span className="text-muted-foreground">
          {t("cockpit.jointFeed", "Joint feed")}: {liveJoints?.length ? `${liveJoints.length} live` : t("cockpit.noJointFeed", "no live joint values")}
        </span>
      </div>
      <div className="space-y-3">
        {joints.map((j, i) => {
          const val = jointValue(liveJoints?.[i]);
          const min = j.limits?.min ?? null;
          const max = j.limits?.max ?? null;
          const isRev = j.type === "revolute";
          const disp = (v: number) => (isRev ? `${((v * 180) / Math.PI).toFixed(1)}°` : `${v.toFixed(1)}mm`);
          let pct = 50;
          if (val != null && min != null && max != null && max > min) {
            pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
          }
          const nearLimit = val != null && min != null && max != null && (pct < 8 || pct > 92);
          const hist = chron
            .map((r) => jointValue((r.jointStates as Array<Record<string, unknown>> | undefined)?.[i]))
            .filter((n): n is number => n != null);
          return (
            <div key={j.name}>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 font-medium">
                  <Sliders className="h-3 w-3 text-muted-foreground" />
                  {j.name}
                  <Badge variant="outline" className="text-[9px] capitalize">{j.type}</Badge>
                </span>
                <span className="flex items-center gap-2">
                  {hist.length >= 2 && (
                    <Sparkline data={hist} width={72} height={16} tone={nearLimit ? "critical" : "neutral"} aria-label={t("cockpit.jointTrend", "Joint trend")} />
                  )}
                  <span className={cn("font-mono", nearLimit && "text-destructive")}>
                    {val == null ? "—" : disp(val)}
                  </span>
                </span>
              </div>
              <div className="relative h-3 w-full overflow-hidden rounded bg-muted">
                {val != null && (
                  <div
                    className={cn("absolute top-0 h-full w-1 rounded", nearLimit ? "bg-destructive" : "bg-primary")}
                    style={{ left: `calc(${pct}% - 2px)`, transition: "left .4s ease" }}
                  />
                )}
                {/* midline */}
                <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
              </div>
              <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
                <span>{min == null ? "—" : disp(min)}</span>
                <span>{max == null ? "—" : disp(max)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* TCP pose (from live telemetry, honest — no client FK) */}
      {live?.pose && Object.keys(live.pose).length > 0 && (
        <div className="rounded-md border p-3">
          <div className="mb-1 text-xs font-medium text-muted-foreground">{t("cockpit.tcpPose", "TCP pose (live)")}</div>
          <div className="grid grid-cols-3 gap-2 text-xs font-mono sm:grid-cols-6">
            {Object.entries(live.pose).slice(0, 6).map(([k, v]) => (
              <div key={k}><span className="text-muted-foreground">{k}: </span>{typeof v === "number" ? v.toFixed(1) : String(v)}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3D — glTF via drei <Gltf>, else a primitive (mirrors DigitalTwinCenter fallback).
// ════════════════════════════════════════════════════════════════════════════

function Model3DPane({ model3d, t }: { model3d: RobotDetail["model3d"]; t: (k: string, f: string) => string }) {
  const [webglOk, setWebglOk] = useState(true);
  useEffect(() => {
    try {
      const el = document.createElement("canvas");
      setWebglOk(!!(el.getContext("webgl") || el.getContext("experimental-webgl")));
    } catch { setWebglOk(false); }
  }, []);
  const uri = model3d.available ? model3d.value?.modelUri ?? null : null;
  if (!webglOk) {
    return <div className="flex h-[440px] items-center justify-center text-sm text-muted-foreground">{t("cockpit.no3d", "3D is not available in this browser.")}</div>;
  }
  return (
    <>
      {!model3d.available && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-info/30 bg-info/10 px-2 py-1 text-[11px] text-info">
          <Info className="h-3.5 w-3.5 shrink-0" />
          {t("cockpit.no3dModelRobot", "No 3D model registered for this robot — showing a placeholder block.")}
        </div>
      )}
      <div className="h-[440px] w-full overflow-hidden rounded-lg border bg-[#0a0a0f]">
        <Canvas shadows dpr={[1, 2]}>
          <PerspectiveCamera makeDefault position={[3, 2.2, 3]} fov={50} />
          <OrbitControls enablePan enableZoom enableRotate minDistance={1.2} maxDistance={18} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[6, 8, 4]} intensity={1.1} castShadow />
          <Environment preset="warehouse" />
          <Grid args={[20, 20]} cellSize={0.5} cellThickness={0.5} cellColor="#1e293b" sectionSize={2} sectionColor="#334155" fadeDistance={22} infiniteGrid position={[0, -0.01, 0]} />
          <Suspense fallback={<mesh><cylinderGeometry args={[0.45, 0.55, 1.1, 16]} /><meshStandardMaterial color="#06b6d4" wireframe /></mesh>}>
            {uri ? (
              <Stage intensity={0.4} environment={null} adjustCamera={false}><Gltf src={uri} /></Stage>
            ) : (
              <mesh castShadow position={[0, 0.55, 0]}><cylinderGeometry args={[0.45, 0.55, 1.1, 24]} /><meshStandardMaterial color="#8b5cf6" metalness={0.4} roughness={0.5} /></mesh>
            )}
          </Suspense>
        </Canvas>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PAGE
// ════════════════════════════════════════════════════════════════════════════

export default function RobotCockpit() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/robot/:id");
  const robotId = Number(params?.id);
  const validId = Number.isFinite(robotId) && robotId > 0;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const { hasPermission } = usePermissions();
  // ENG-F14/F12 — điều khiển OT ở cockpit gate theo permission bit machine_control
  // (admin bypass sẵn trong hasPermission). canEdit = shelve/ack alarm; canCreate = lưu
  // teach buffer thành artifact programming (createProject/createArtifact yêu cầu canCreate).
  const canEditControl = hasPermission("machine_control", "canEdit");
  const canCreateProgram = hasPermission("machine_control", "canCreate");
  const utils = trpc.useUtils();

  const detailQ = trpc.assetCockpit.robotDetail.useQuery(
    { robotId },
    { enabled: validId, refetchInterval: 15_000, staleTime: 5_000, retry: false },
  );
  const d = detailQ.data;

  // ENG-F14 — series telemetry (~20 mẫu) để vẽ mini-trend (robotDetail chỉ cho 1 mẫu
  // tức thời). robot.telemetry trả các hàng robot_telemetry mới-nhất-trước.
  const seriesQ = trpc.robot.telemetry.useQuery(
    { robotId, limit: 20 },
    { enabled: validId, refetchInterval: 15_000, staleTime: 5_000, retry: false },
  );
  const series = useMemo(() => {
    const rows = (seriesQ.data ?? []) as Array<Record<string, unknown>>;
    const chron = [...rows].reverse(); // cũ → mới (trái → phải)
    const num = (v: unknown): number | null => {
      const n = typeof v === "string" ? Number(v) : (v as number);
      return typeof n === "number" && Number.isFinite(n) ? n : null;
    };
    const speed = chron.map((r) => num(r.speedPct)).filter((n): n is number => n != null);
    const battery = chron.map((r) => num(r.batteryLevel)).filter((n): n is number => n != null);
    return { count: chron.length, speed, battery, chron };
  }, [seriesQ.data]);

  // ENG-F12 — teach/jog buffer sống ở STATE CHA + localStorage (không mất khi đổi tab / reload).
  const teachKey = `robot-cockpit-teach:${robotId}`;
  const [teachBuffer, setTeachBuffer] = useState<string>("# robot-tm tmscript (local preview)\n");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(teachKey);
      if (saved != null) setTeachBuffer(saved);
    } catch { /* localStorage unavailable → giữ default in-memory */ }
  }, [teachKey]);
  useEffect(() => {
    try { localStorage.setItem(teachKey, teachBuffer); } catch { /* ignore quota / privacy mode */ }
  }, [teachKey, teachBuffer]);

  // ENG-F12 — "Lưu vào project robot-tm": tái dùng project robot-tm đã gắn robot này
  // (deviceId) nếu có; nếu chưa có → tạo project robot-tm gắn deviceId rồi tạo artifact.
  // createArtifact KHÔNG nhận deviceId (chỉ projectId) nên đường đi đúng là project trước.
  const createArtifactM = trpc.programming.createArtifact.useMutation({
    onSuccess: (a) => {
      toast.success(t("cockpit.teachSaved", "Đã lưu teach buffer vào project robot-tm (bản {{v}})", { v: (a as { version?: number })?.version ?? "?" }));
      void utils.assetCockpit.robotDetail.invalidate({ robotId });
    },
    onError: (e) => toastTrpcError(e),
  });
  const createProjectM = trpc.programming.createProject.useMutation({
    onSuccess: (proj) => {
      createArtifactM.mutate({ projectId: (proj as { id: number }).id, language: "tmscript", content: teachBuffer });
      void utils.assetCockpit.robotDetail.invalidate({ robotId });
    },
    onError: (e) => toastTrpcError(e),
  });
  const savingTeach = createArtifactM.isPending || createProjectM.isPending;
  const saveTeachToProject = () => {
    if (!canCreateProgram || savingTeach) return;
    const progs = (d?.programs.available ? d.programs.value : null) as Array<Record<string, unknown>> | null;
    const existing = progs?.find((p) => String(p.kind) === "robot-tm" && p.id != null);
    if (existing) {
      createArtifactM.mutate({ projectId: Number(existing.id), language: "tmscript", content: teachBuffer });
    } else {
      // Mã duy nhất (timestamp) để tránh CONFLICT nếu tồn tại project cùng mã chưa gắn robot.
      createProjectM.mutate({
        code: `robot-${robotId}-tm-${Date.now().toString(36)}`,
        name: `${d?.identity.name ?? `Robot ${robotId}`} — Teach/Jog`,
        kind: "robot-tm",
        deviceId: robotId,
      });
    }
  };

  // ── LIVE telemetry overlay from room `robot:{id}` / `robot:telemetry` (closes G-5). ──
  const [liveOverlay, setLiveOverlay] = useState<RobotTelemetryEvent | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  useEffect(() => {
    if (!validId) return;
    const socket = getSharedSocket();
    const onConnect = () => { setSocketConnected(true); socket.emit("subscribe", { robotId }); };
    const onDisconnect = () => setSocketConnected(false);
    const onTelemetry = (evt: RobotTelemetryEvent) => {
      if (evt?.robotId != null && evt.robotId !== robotId) return;
      setLiveOverlay(evt);
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("robot:telemetry", onTelemetry);
    if (socket.connected) onConnect();
    return () => {
      socket.emit("unsubscribe", { robotId });
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("robot:telemetry", onTelemetry);
      releaseSharedSocket();
    };
  }, [validId, robotId]);

  // Merge the socket overlay onto the polled telemetry section (socket wins per-field).
  const live = useMemo<RobotLiveTelemetry | null>(() => {
    const base = d?.liveTelemetry.available ? d.liveTelemetry.value : null;
    if (!liveOverlay && !base) return null;
    return {
      mode: liveOverlay?.mode ?? base?.mode ?? null,
      busy: liveOverlay?.busy ?? base?.busy ?? null,
      estop: liveOverlay?.estop ?? base?.estop ?? null,
      speedPct: liveOverlay?.speedPct ?? base?.speedPct ?? null,
      pose: liveOverlay?.pose ?? base?.pose ?? null,
      jointStates: liveOverlay?.jointStates ?? base?.jointStates ?? null,
      batteryPct: liveOverlay?.batteryPct ?? base?.batteryPct ?? null,
      safetyZoneId: liveOverlay?.safetyZoneId ?? base?.safetyZoneId ?? null,
      firmwareVersion: liveOverlay?.firmwareVersion ?? base?.firmwareVersion ?? null,
      lastHeartbeat: base?.lastHeartbeat ?? null,
      ts: liveOverlay?.ts ?? base?.ts ?? null,
    };
  }, [d?.liveTelemetry, liveOverlay]);

  const isLive = socketConnected && liveOverlay != null;
  const estop = live?.estop === true;

  if (!validId) {
    return (
      <DashboardLayout>
        <div className="p-4">
          <EmptyState title={t("cockpit.badRobotId", "Invalid robot id")} description={t("cockpit.badRobotIdHint", "This URL does not reference a robot.")} />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4 p-1">
        <PageHeader
          icon={<Bot className="h-6 w-6" />}
          title={d ? d.identity.name : t("cockpit.robot", "Robot cockpit")}
          description={
            d
              ? [d.identity.code, d.identity.vendor, d.identity.kind, d.identity.model].filter(Boolean).join(" · ")
              : t("cockpit.loadingRobot", "Loading robot…")
          }
          actions={
            <div className="flex items-center gap-2">
              {estop && <Badge className="gap-1 bg-destructive text-white"><OctagonAlert className="h-3.5 w-3.5" /> {t("cockpit.estop", "E-STOP")}</Badge>}
              {isLive ? (
                <Badge className="gap-1 bg-emerald-500 text-white"><Wifi className="h-3.5 w-3.5" /> {t("cockpit.live", "LIVE")}</Badge>
              ) : (
                <Badge className="gap-1 bg-amber-500 text-white"><WifiOff className="h-3.5 w-3.5" /> {t("cockpit.polling", "POLLING")}</Badge>
              )}
              <Button size="sm" variant="outline" onClick={() => setLocation("/robot-control")}>
                <ArrowLeft className="mr-1 h-4 w-4" /> {t("cockpit.back", "Back")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => detailQ.refetch()}>
                <RefreshCw className={cn("mr-1 h-4 w-4", detailQ.isFetching && "animate-spin")} /> {t("cockpit.refresh", "Refresh")}
              </Button>
            </div>
          }
        />

        {detailQ.isError ? (
          <EmptyState title={t("cockpit.robotNotFound", "Robot not found")} description={t("cockpit.robotNotFoundHint", "No robot exists for this id, or it is not visible to you.")} />
        ) : detailQ.isLoading || !d ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{t("cockpit.loading", "Loading cockpit…")}</div>
        ) : (
          <Tabs defaultValue="overview" className="w-full">
            <ScrollArea className="w-full">
              <TabsList className="mb-2 inline-flex w-max">
                <TabsTrigger value="overview"><Activity className="mr-1 h-4 w-4" />{t("cockpit.tabOverview", "Overview")}</TabsTrigger>
                <TabsTrigger value="joints"><Sliders className="mr-1 h-4 w-4" />{t("cockpit.tabJoints", "Joints")}</TabsTrigger>
                <TabsTrigger value="jobs"><ListChecks className="mr-1 h-4 w-4" />{t("cockpit.tabJobs", "Jobs")}</TabsTrigger>
                <TabsTrigger value="tasks"><ListChecks className="mr-1 h-4 w-4" />{t("cockpit.tabTasks", "Tasks")}</TabsTrigger>
                <TabsTrigger value="programs"><ScrollText className="mr-1 h-4 w-4" />{t("cockpit.tabPrograms", "Programs")}</TabsTrigger>
                <TabsTrigger value="safety"><ShieldAlert className="mr-1 h-4 w-4" />{t("cockpit.tabSafety", "Safety")}</TabsTrigger>
                <TabsTrigger value="anomalies"><Activity className="mr-1 h-4 w-4" />{t("cockpit.tabAnomalies", "Anomalies")}</TabsTrigger>
                <TabsTrigger value="alarms"><AlertTriangle className="mr-1 h-4 w-4" />{t("cockpit.tabAlarms", "Alarms")}</TabsTrigger>
                <TabsTrigger value="model3d"><Boxes className="mr-1 h-4 w-4" />{t("cockpit.tab3d", "3D")}</TabsTrigger>
                <TabsTrigger value="teach"><Gamepad2 className="mr-1 h-4 w-4" />{t("cockpit.tabTeach", "Teach / Jog")}</TabsTrigger>
                <TabsTrigger value="actions"><Wrench className="mr-1 h-4 w-4" />{t("cockpit.tabActions", "Actions")}</TabsTrigger>
              </TabsList>
            </ScrollArea>

            {/* ── OVERVIEW ── */}
            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard icon={<Activity className="h-4 w-4" />} label={t("cockpit.mode", "Mode")} value={live?.mode ?? "—"} />
                <MetricCard
                  icon={<Zap className="h-4 w-4" />}
                  label={t("cockpit.speed", "Speed")}
                  value={live?.speedPct == null ? "—" : `${Math.round(live.speedPct)}%`}
                  delta={series.speed.length >= 2 ? <Sparkline data={series.speed} width={84} height={20} tone="neutral" showArea showEndDot aria-label={t("cockpit.speedTrend", "Speed trend")} /> : undefined}
                />
                <MetricCard
                  icon={<OctagonAlert className="h-4 w-4" />}
                  label={t("cockpit.estopState", "E-stop")}
                  value={live?.estop == null ? "—" : live.estop ? t("cockpit.engaged", "Engaged") : t("cockpit.clear", "Clear")}
                  tone={live?.estop ? "error" : live?.estop === false ? "success" : "default"}
                />
                <MetricCard
                  icon={<Battery className="h-4 w-4" />}
                  label={t("cockpit.battery", "Battery")}
                  value={live?.batteryPct == null ? "—" : `${Math.round(live.batteryPct)}%`}
                  tone={live?.batteryPct != null && live.batteryPct < 20 ? "error" : "default"}
                  delta={series.battery.length >= 2 ? <Sparkline data={series.battery} width={84} height={20} tone={series.battery[series.battery.length - 1] < 20 ? "critical" : "good"} showArea showEndDot aria-label={t("cockpit.batteryTrend", "Battery trend")} /> : undefined}
                />
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5" />
                {series.count >= 2
                  ? t("cockpit.trendCaption", "Mini-trend từ {{n}} mẫu telemetry gần nhất (cũ → mới).", { n: series.count })
                  : t("cockpit.trendNone", "Chưa đủ mẫu telemetry để vẽ mini-trend (cần ≥ 2 mẫu).")}
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Identity */}
                <SectionCard icon={<Bot className="h-4 w-4" />} title={t("cockpit.identity", "Identity")}>
                  <KV k={t("cockpit.code", "Code")} v={d.identity.code} mono />
                  <KV k={t("cockpit.vendor", "Vendor")} v={d.identity.vendor} />
                  <KV k={t("cockpit.kind", "Kind")} v={d.identity.kind} />
                  <KV k={t("cockpit.model", "Model")} v={d.identity.model ?? "—"} />
                  <KV k={t("cockpit.status", "Status")} v={<StatusBadge status={d.identity.status} className="px-1.5 py-0 text-[11px]" />} />
                  <KV k={t("cockpit.enabled", "Enabled")} v={<StatusBadge status={d.identity.isEnabled ? "active" : "offline"} className="px-1.5 py-0 text-[11px]" />} />
                  <KV k={t("cockpit.lastSeen", "Last seen")} v={relTime(d.identity.lastSeenAt, now)} />
                </SectionCard>

                {/* Live telemetry (full UDM) */}
                <SectionCard
                  icon={<Radio className="h-4 w-4" />}
                  title={t("cockpit.liveTelemetry", "Live telemetry")}
                  description={isLive ? t("cockpit.socketLive", "Streaming · robot:telemetry") : t("cockpit.socketPoll", "Polling (no live socket)")}
                >
                  {!live ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="space-y-1">
                      <KV k={t("cockpit.mode", "Mode")} v={live.mode ?? "—"} />
                      <KV k={t("cockpit.busy", "Busy")} v={live.busy == null ? "—" : live.busy ? t("cockpit.yes", "Yes") : t("cockpit.no", "No")} />
                      <KV k={t("cockpit.estopState", "E-stop")} v={<StatusBadge status={live.estop ? "fault" : "ok"} tone={live.estop ? "error" : "success"} label={live.estop == null ? "—" : live.estop ? "engaged" : "clear"} className="px-1.5 py-0 text-[11px]" />} />
                      <KV k={t("cockpit.speed", "Speed")} v={live.speedPct == null ? "—" : `${Math.round(live.speedPct)}%`} />
                      <KV k={t("cockpit.safetyZone", "Safety zone")} v={live.safetyZoneId ?? "—"} />
                      <KV k={t("cockpit.firmware", "Firmware")} v={live.firmwareVersion ?? "—"} mono />
                      <KV k={t("cockpit.heartbeat", "Heartbeat")} v={relTime(live.lastHeartbeat, now)} />
                      <KV k={t("cockpit.sampleTs", "Sample time")} v={relTime(live.ts, now)} />
                    </div>
                  )}
                </SectionCard>

                {/* Battery + capability summary */}
                <SectionCard icon={<Battery className="h-4 w-4" />} title={t("cockpit.powerCap", "Power & capability")}>
                  <div className="mb-3">
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{t("cockpit.battery", "Battery")}</span>
                      <span className="font-mono">{live?.batteryPct == null ? "—" : `${Math.round(live.batteryPct)}%`}</span>
                    </div>
                    {live?.batteryPct != null && <Progress value={live.batteryPct} className="h-2" />}
                  </div>
                  {d.capability.available && d.capability.value ? (
                    <>
                      <KV k={t("cockpit.equipClass", "Equipment class")} v={d.capability.value.equipmentClass} />
                      <KV k={t("cockpit.deviceType", "Device type")} v={<Badge variant="outline">{d.capability.value.deviceType}</Badge>} />
                      <div className="pt-1">
                        <div className="mb-1 text-xs text-muted-foreground">{t("cockpit.telemetryTags", "Telemetry tags")}</div>
                        <div className="flex flex-wrap gap-1">
                          {d.capability.value.telemetryTags.slice(0, 10).map((tag, i) => (
                            <Badge key={`${telemetryTagLabel(tag)}-${i}`} variant="outline" className="text-[10px]">
                              {telemetryTagLabel(tag)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </SectionCard>
              </div>
            </TabsContent>

            {/* ── JOINTS (2D live joint-bar readout) ── */}
            <TabsContent value="joints">
              <SectionCard icon={<Sliders className="h-4 w-4" />} title={t("cockpit.tabJoints", "Joints & pose")} description={t("cockpit.jointsHint", "Live joint values vs kinematic limits (2D readout)")}>
                <JointBars kinematic={d.kinematicModel} live={live} chron={series.chron} t={t} />
              </SectionCard>
            </TabsContent>

            {/* ── JOBS ── */}
            <TabsContent value="jobs">
              <SectionCard icon={<ListChecks className="h-4 w-4" />} title={t("cockpit.tabJobs", "Jobs")} description={t("cockpit.jobsHint", "Recent robot job / motion log")}>
                {!d.jobs.available || ((d.jobs.value?.length ?? 0) === 0) ? (
                  <EmptyState title={t("cockpit.noJobs", "No jobs")} description={t("cockpit.noJobsHint", "No recent jobs for this robot.")} />
                ) : (
                  <ScrollArea className="h-[440px] pr-2">
                    <div className="space-y-2">
                      {(d.jobs.value as Array<Record<string, unknown>>).map((j, i) => (
                        <div key={i} className="rounded-md border px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{String(j.name ?? j.jobName ?? j.command ?? `#${j.id ?? i}`)}</span>
                            {j.status != null && <StatusBadge status={String(j.status)} className="px-1.5 py-0 text-[10px]" />}
                            <span className="ml-auto text-[11px] text-muted-foreground">{j.createdAt != null ? new Date(String(j.createdAt)).toLocaleString() : ""}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </SectionCard>
            </TabsContent>

            {/* ── TASKS (fleet) ── */}
            <TabsContent value="tasks">
              <SectionCard icon={<ListChecks className="h-4 w-4" />} title={t("cockpit.tabTasks", "Fleet tasks")} description={t("cockpit.tasksHint", "Tasks assigned to this robot")}>
                {!d.tasks.available || ((d.tasks.value?.length ?? 0) === 0) ? (
                  <EmptyState title={t("cockpit.noTasks", "No tasks")} description={t("cockpit.noTasksHint", "No fleet tasks assigned to this robot.")} />
                ) : (
                  <ScrollArea className="h-[440px] pr-2">
                    <div className="space-y-2">
                      {(d.tasks.value as Array<Record<string, unknown>>).map((tk, i) => (
                        <div key={i} className="rounded-md border px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{String(tk.taskType ?? tk.type ?? tk.name ?? `#${tk.id ?? i}`)}</span>
                            {tk.status != null && <StatusBadge status={String(tk.status)} className="px-1.5 py-0 text-[10px]" />}
                            {tk.priority != null && <Badge variant="outline" className="text-[10px]">P{String(tk.priority)}</Badge>}
                            <span className="ml-auto text-[11px] text-muted-foreground">{tk.createdAt != null ? new Date(String(tk.createdAt)).toLocaleString() : ""}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </SectionCard>
            </TabsContent>

            {/* ── PROGRAMS (IR) ── */}
            <TabsContent value="programs">
              <SectionCard icon={<ScrollText className="h-4 w-4" />} title={t("cockpit.tabPrograms", "IR programs")} description={t("cockpit.programsHint", "Motion / IR flows bound to this robot")}>
                {!d.programs.available || ((d.programs.value?.length ?? 0) === 0) ? (
                  <EmptyState title={t("cockpit.noPrograms", "No programs")} description={t("cockpit.noProgramsRobotHint", "No IR programs bound to this robot.")} />
                ) : (
                  <div className="space-y-2">
                    {(d.programs.value as Array<Record<string, unknown>>).map((p, i) => (
                      <div key={i} className="rounded-md border px-3 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{String(p.name ?? p.title ?? `#${p.id ?? i}`)}</span>
                          {p.kind != null && <Badge variant="outline" className="text-[10px]">{String(p.kind)}</Badge>}
                          {p.status != null && <StatusBadge status={String(p.status)} className="px-1.5 py-0 text-[10px]" />}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto h-7"
                            onClick={() => setLocation(p.id != null ? withParams("/ir-editor", { projectId: Number(p.id) }) : "/ir-editor")}
                          >
                            <ExternalLink className="mr-1 h-3.5 w-3.5" /> {t("cockpit.openIr", "Open IR")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </TabsContent>

            {/* ── SAFETY ── */}
            <TabsContent value="safety">
              <SectionCard icon={<ShieldAlert className="h-4 w-4" />} title={t("cockpit.tabSafety", "Safety zone reactions")} description={t("cockpit.safetyHint", "Safety events involving this robot")}>
                {!d.safety.available || ((d.safety.value?.length ?? 0) === 0) ? (
                  <EmptyState title={t("cockpit.noSafety", "No safety events")} description={t("cockpit.noSafetyHint", "No recent safety events for this robot.")} />
                ) : (
                  <ScrollArea className="h-[440px] pr-2">
                    <div className="space-y-2">
                      {(d.safety.value as Array<Record<string, unknown>>).map((s, i) => (
                        <div key={i} className="rounded-md border px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{String(s.eventType ?? `#${s.id ?? i}`)}</span>
                            {s.isNearMiss ? <Badge variant="outline" className="text-[10px]">near-miss</Badge> : <StatusBadge status="critical" tone="error" className="px-1.5 py-0 text-[10px]" />}
                            {s.outcome != null && <Badge variant="secondary" className="text-[10px]">{String(s.outcome)}</Badge>}
                            <span className="ml-auto text-[11px] text-muted-foreground">{s.createdAt != null ? new Date(String(s.createdAt)).toLocaleString() : ""}</span>
                          </div>
                          {s.notes != null && <div className="mt-1 text-xs text-muted-foreground">{String(s.notes)}</div>}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </SectionCard>
            </TabsContent>

            {/* ── ANOMALIES ── */}
            <TabsContent value="anomalies">
              <SectionCard icon={<Activity className="h-4 w-4" />} title={t("cockpit.tabAnomalies", "Behaviour anomalies")} description={t("cockpit.anomaliesHint", "Recent robot-behaviour anomalies (read-only)")}>
                {!d.anomalies.available || ((d.anomalies.value?.length ?? 0) === 0) ? (
                  <EmptyState title={t("cockpit.noAnomalies", "No anomalies")} description={t("cockpit.noAnomaliesHint", "No recent behaviour anomalies for this robot.")} />
                ) : (
                  <ScrollArea className="h-[440px] pr-2">
                    <div className="space-y-2">
                      {(d.anomalies.value as Array<Record<string, unknown>>).map((a, i) => (
                        <div key={i} className="rounded-md border px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{String(a.anomalyType ?? a.type ?? `#${a.id ?? i}`)}</span>
                            {a.severity != null && <StatusBadge status={String(a.severity)} className="px-1.5 py-0 text-[10px]" />}
                            {a.status != null && <Badge variant="outline" className="text-[10px]">{String(a.status)}</Badge>}
                            <span className="ml-auto text-[11px] text-muted-foreground">{a.detectedAt != null ? new Date(String(a.detectedAt)).toLocaleString() : ""}</span>
                          </div>
                          {a.description != null && <div className="mt-1 text-xs text-muted-foreground">{String(a.description)}</div>}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </SectionCard>
            </TabsContent>

            {/* ── ALARMS ── */}
            <TabsContent value="alarms">
              <SectionCard icon={<AlertTriangle className="h-4 w-4" />} title={t("cockpit.tabAlarms", "Alarms")} description={t("cockpit.robotAlarmsHint", "Per-robot ISA-18.2 normalized feed (from safety)")}>
                {/* ENG-F14 — feed chuẩn hoá từ safety_events KHÔNG mang id ledger, và safety_events
                    không có mutation ack/resolve qua tRPC → không thể Ack/Shelve theo TỪNG lần xảy ra
                    tại đây. Shelve theo LỚP alarm (ISA-18.2 rationalization) làm ở Equipment Standards
                    (equipmentStandards.shelveMasterAlarm, gate machine_control/canEdit). */}
                {canEditControl && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
                    <Info className="h-4 w-4 shrink-0" />
                    <span className="flex-1 min-w-[12rem]">
                      {t("cockpit.alarmAckBlocked", "Ack/Shelve theo từng lần xảy ra chưa khả dụng cho alarm robot (feed từ safety_events không có ledger id). Bạn có thể shelve theo LỚP alarm ở Equipment Standards.")}
                    </span>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => setLocation("/equipment-standards")}>
                      <BellOff className="mr-1 h-3.5 w-3.5" /> {t("cockpit.shelveClass", "Shelve theo lớp")}
                    </Button>
                  </div>
                )}
                {!d.alarms.available || ((d.alarms.value?.length ?? 0) === 0) ? (
                  <EmptyState title={t("cockpit.noAlarms", "No active alarms")} description={t("cockpit.noRobotAlarmsHint", "This robot has no recent normalized alarms.")} />
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
                            {canEditControl && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5"
                                title={t("cockpit.shelveClassTip", "Mở Equipment Standards để shelve/rationalize LỚP alarm {{code}} (không phải lần xảy ra này)", { code: a.standardCode })}
                                onClick={() => setLocation("/equipment-standards")}
                              >
                                <BellOff className="h-3.5 w-3.5" />
                              </Button>
                            )}
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

            {/* ── 3D ── */}
            <TabsContent value="model3d">
              <SectionCard icon={<Boxes className="h-4 w-4" />} title={t("cockpit.tab3d", "3D model")} description={d.model3d.source}>
                <Model3DPane model3d={d.model3d} t={t} />
              </SectionCard>
            </TabsContent>

            {/* ── TEACH / JOG (gated preview) ── */}
            <TabsContent value="teach">
              <SectionCard
                icon={<Gamepad2 className="h-4 w-4" />}
                title={t("cockpit.tabTeach", "Teach / Jog")}
                description={t("cockpit.teachHint", "Author a robot job by jogging a LOCAL preview pose — preview only, gated")}
              >
                <div className="mb-3 flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  {t("cockpit.teachGate", "PREVIEW / GATED — jog moves a local preview pose only. Running a job on the real robot requires the gated robotCommandDispatcher (ROBOT_CONTROL_ENABLED + HITL). Nothing is dispatched from this cockpit.")}
                </div>
                <TeachJogBuffer
                  value={teachBuffer}
                  onChange={setTeachBuffer}
                  onSave={saveTeachToProject}
                  canSave={canCreateProgram}
                  saving={savingTeach}
                />
              </SectionCard>
            </TabsContent>

            {/* ── ACTIONS (gated, propose-only) ── */}
            <TabsContent value="actions">
              <SectionCard
                icon={<Wrench className="h-4 w-4" />}
                title={t("cockpit.tabActions", "Actions")}
                description={t("cockpit.robotActionsHint", "Commands you MAY propose. \"Propose\" opens the gated Command Console — the actual dispatch stays behind the same HITL / mode / commissioning / interlock gates (dry-run unless control is enabled).")}
              >
                <div className="mb-3 flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  {t("cockpit.robotActionsGate", "Read-only cockpit. \"Propose\" opens the gated Command Console (typed-confirm + interlock preview); nothing dispatches from this page.")}
                </div>
                {d.gatedActions.length === 0 ? (
                  <EmptyState title={t("cockpit.noActions", "No commands")} description={t("cockpit.noActionsHint", "This robot's capability profile exposes no proposable commands.")} />
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
                          <Button size="sm" variant="outline" onClick={() => setLocation(`/command-console?robotId=${robotId}&command=${encodeURIComponent(a.name)}`)}>
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

/**
 * Buffer wrapper for <TeachJogPanel>. ENG-F12 — buffer sống ở STATE CHA (value/onChange)
 * nên KHÔNG mất khi đổi tab; cha cũng đồng bộ localStorage. "Lưu vào project robot-tm"
 * gọi programming.createArtifact (qua cha) để đưa buffer vào pipeline build/deploy có gate.
 */
function TeachJogBuffer({
  value, onChange, onSave, canSave, saving,
}: {
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  canSave: boolean;
  saving: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <TeachJogPanel value={value} onChange={onChange} />
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{t("cockpit.tmscript", "tmscript buffer (preview)")}</span>
          <span
            title={!canSave ? t("cockpit.teachSavePerm", "Cần quyền tạo chương trình (machine_control/canCreate)") : undefined}
          >
            <Button size="sm" variant="outline" className="h-7" disabled={!canSave || saving} onClick={onSave}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              {t("cockpit.teachSave", "Lưu vào project robot-tm")}
            </Button>
          </span>
        </div>
        <pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 text-xs font-mono">{value}</pre>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("cockpit.teachSaveHint", "Lưu tạo một artifact bản mới trong project robot-tm gắn robot này (tự tạo project nếu chưa có) — vào pipeline validate/build/deploy có gate. Không phát chuyển động.")}
        </p>
      </div>
    </div>
  );
}
