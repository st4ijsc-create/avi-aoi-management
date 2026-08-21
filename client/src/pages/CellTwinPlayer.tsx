/**
 * GENERIC CELL TWIN PLAYER — data-driven realtime digital-twin PLAYBACK.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Generalises the hard-coded RfTestCellSim into a workflow-AGNOSTIC animator: pick ANY
 * deployed FOE WorkflowDefinition, ask the SAME pure twin the Orchestration Studio uses
 * (orchestration.simulate) to PREDICT its timeline + per-machine PackML state trace, then
 * replay it against a wall-clock so the cell animates live, looping over [0, total].
 *
 * The scene is generic: a horizontal lane of STATIONS (one per distinct machine the
 * workflow touches), each glowing when the active step targets it, with a DUT token
 * gliding between them. No station geometry is baked in — it derives purely from the
 * simulated timeline + the equipment list (machineId → name/type).
 *
 * 100% read-only / no dispatch: this is a simulation. Going live routes every command
 * through the HITL dispatcher; E-stop / interlock / motion stay on the device.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import { useEngineering } from "@/contexts/EngineeringContext";
import { parseDeepLink } from "@/lib/engineeringDeepLink";
import DashboardLayout from "@/components/DashboardLayout";
import { PageContainer, PageHeader } from "@/components/patterns";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Play, Pause, RotateCcw, Activity, Info, Workflow, AlertTriangle, Radio, MapPin } from "lucide-react";

// ── Twin result shape (mirror of server SimulationResult) ─────────────────────────
interface TLEntry {
  stepId: string;
  stepType: string;
  machineId?: number;
  command?: string;
  startMs: number;
  endMs: number;
  status: string;
  predictedState?: string;
  note?: string;
}
interface StatePoint { atMs: number; state: string }
interface SimWarning { stepId: string; kind: string; message: string }
interface Sim {
  ok: boolean;
  valid: boolean;
  errors: string[];
  timeline: TLEntry[];
  warnings: SimWarning[];
  totalDurationMs: number;
  machineStateTrace: Record<number, StatePoint[]>;
}

// ── helpers (reused from RfTestCellSim) ───────────────────────────────────────────
function lerp(a: number, b: number, p: number) { return a + (b - a) * Math.max(0, Math.min(1, p)); }

function stateColor(s?: string): string {
  switch (s) {
    case "Execute": return "#16a34a";
    case "Starting": case "Resetting": case "Unholding": return "#22c55e";
    case "Stopping": case "Holding": case "Suspending": return "#f59e0b";
    case "Stopped": case "Held": case "Suspended": return "#ef4444";
    case "Aborting": case "Aborted": return "#dc2626";
    case "Idle": return "#94a3b8";
    default: return "#64748b";
  }
}

/**
 * Mirror of server operationStatusToPackml (equipmentRouter): dựng PackML từ
 * operationStatus THẬT của thiết bị. Dùng cho overlay "Trực tiếp".
 */
function operationStatusToPackml(status?: string | null): string {
  switch (status) {
    case "running": return "Execute";
    case "stopped": return "Stopped";
    case "error": return "Aborted";
    case "maintenance": return "Held";
    case "warming_up": return "Starting";
    case "changeover": return "Suspended";
    case "starved":
    case "blocked": return "Held";
    default: return "Idle";
  }
}

/** Machine PackML state at virtual time t (from the predicted trace). */
function stateAt(sim: Sim, machineId: number, t: number): string {
  const trace = sim.machineStateTrace[machineId] ?? [];
  let s = "Idle";
  for (const p of trace) { if (p.atMs <= t) s = p.state; else break; }
  return s;
}

/** Active LEAF step (command/delay/wait/branch) whose [start,end) contains t. */
function activeStep(sim: Sim, t: number): TLEntry | undefined {
  let best: TLEntry | undefined;
  for (const e of sim.timeline) {
    if (e.stepType === "sequence" || e.stepType === "parallel") continue;
    if (t >= e.startMs && t < e.endMs) { if (!best || e.startMs >= best.startMs) best = e; }
  }
  return best;
}

/** Các mốc thời gian (ms) của biên leaf-step — dùng cho phím ←/→ bước qua từng bước. */
function leafBoundaries(sim: Sim): number[] {
  const set = new Set<number>([0, sim.totalDurationMs]);
  for (const e of sim.timeline) {
    if (e.stepType === "sequence" || e.stepType === "parallel") continue;
    if (e.endMs <= e.startMs) continue;
    set.add(e.startMs);
    set.add(e.endMs);
  }
  return [...set].filter((v) => v >= 0 && v <= sim.totalDurationMs).sort((a, b) => a - b);
}

/** A distinct station the timeline touches (a machine targeted by command/wait steps). */
interface Station {
  machineId: number;
  name: string;
  machineType: string;
  firstAtMs: number;
}

/**
 * Derive the ordered lane of stations from the timeline: one per distinct machineId
 * referenced by a command/wait step, ordered by the first time it becomes active.
 */
function deriveStations(
  sim: Sim,
  nameOf: (id: number) => { name: string; machineType: string },
): Station[] {
  const firstAt = new Map<number, number>();
  for (const e of sim.timeline) {
    if (e.machineId == null) continue;
    if (e.stepType === "sequence" || e.stepType === "parallel") continue;
    const prev = firstAt.get(e.machineId);
    if (prev === undefined || e.startMs < prev) firstAt.set(e.machineId, e.startMs);
  }
  return [...firstAt.entries()]
    .map(([machineId, firstAtMs]) => {
      const meta = nameOf(machineId);
      return { machineId, firstAtMs, name: meta.name, machineType: meta.machineType };
    })
    .sort((a, b) => a.firstAtMs - b.firstAtMs);
}

/**
 * DUT token position along the lane at time t. Interpolates between the station of the
 * PREVIOUS active machine-targeting step and the CURRENT one, by the active step's
 * progress. Lane positions are evenly spaced indices 0..n-1 (caller maps to pixels).
 */
function tokenLanePos(sim: Sim, t: number, stationIndex: Map<number, number>): number | null {
  if (stationIndex.size === 0) return null;
  // Ordered list of machine-targeting leaf steps with a known station.
  const steps = sim.timeline
    .filter((e) => e.machineId != null && stationIndex.has(e.machineId) && e.stepType !== "sequence" && e.stepType !== "parallel")
    .sort((a, b) => a.startMs - b.startMs);
  if (steps.length === 0) return 0;

  // Find the current (active or most-recent) machine step.
  let curIdx = -1;
  for (let i = 0; i < steps.length; i++) {
    if (t >= steps[i].startMs) curIdx = i; else break;
  }
  if (curIdx < 0) return stationIndex.get(steps[0].machineId!)!; // before first

  const cur = steps[curIdx];
  const curPos = stationIndex.get(cur.machineId!)!;
  const prev = curIdx > 0 ? steps[curIdx - 1] : undefined;
  const prevPos = prev ? stationIndex.get(prev.machineId!)! : curPos;

  // While the current step is still executing, glide from prev station → current.
  const span = Math.max(1, cur.endMs - cur.startMs);
  const p = (t - cur.startMs) / span;
  if (p >= 1) return curPos; // settled at the current station
  return lerp(prevPos, curPos, p);
}

const SPEEDS = [0.5, 1, 2, 4];

interface WorkflowRow {
  id: number;
  ref: string;
  name: string;
}

export function CellTwinPlayerContent() {
  const { t } = useTranslation();
  // U3 (doc 26) — breadcrumb "Kỹ thuật › Section › Trang" + link về Hub.
  const [location] = useLocation();
  const crumbs = buildBreadcrumbs(location, t);
  const utils = trpc.useUtils();

  const workflowsQ = trpc.orchestration.listWorkflows.useQuery({ limit: 100 });
  const equipmentQ = trpc.equipment.listEquipment.useQuery({ limit: 500 });
  // (5) Thời lượng lệnh THẬT từ lịch sử (nếu có + đủ quyền) → truyền vào simulate cho KPI có nghĩa.
  const durationsQ = trpc.commandLog.avgDurations.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: false,
  });

  const [selectedRef, setSelectedRef] = useState<string>("");
  const [sim, setSim] = useState<Sim | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState({ t: 0, cycle: 0 });
  // (1)(4) Nguồn trạng thái hiển thị: "predicted" = trace mô phỏng · "live" = operationStatus thật.
  const [mode, setMode] = useState<"predicted" | "live">("predicted");

  // machineId → { name, machineType } map from the equipment list.
  const machineMeta = useMemo(() => {
    const m = new Map<number, { name: string; machineType: string }>();
    for (const e of equipmentQ.data ?? []) {
      m.set(e.machineId, { name: e.name ?? e.code ?? t("cellTwin.maySo", { id: e.machineId }), machineType: e.machineType });
    }
    return m;
  }, [equipmentQ.data]);

  const nameOf = (id: number) =>
    machineMeta.get(id) ?? { name: t("celltwin.unknownMachine", "Máy #{{id}}", { id }), machineType: "—" };

  // (1) Trạng thái thiết bị THẬT (operationStatus → PackML), map theo machineId.
  const liveState = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of equipmentQ.data ?? []) m.set(e.machineId, operationStatusToPackml(e.operationStatus));
    return m;
  }, [equipmentQ.data]);

  // (3) Toạ độ layout đã lưu (0–1) từ Factory Floor Editor, map theo machineId (chỉ nhận toạ độ hợp lệ).
  const layoutMap = useMemo(() => {
    const m = new Map<number, { x: number; y: number }>();
    for (const e of equipmentQ.data ?? []) {
      const px = typeof e.layoutPositionX === "number" ? e.layoutPositionX : parseFloat(String(e.layoutPositionX));
      const py = typeof e.layoutPositionY === "number" ? e.layoutPositionY : parseFloat(String(e.layoutPositionY));
      if (Number.isFinite(px) && Number.isFinite(py) && px >= 0 && px <= 1 && py >= 0 && py <= 1) m.set(e.machineId, { x: px, y: py });
    }
    return m;
  }, [equipmentQ.data]);

  const workflows: WorkflowRow[] = useMemo(
    () => (workflowsQ.data ?? []).map((w) => ({ id: w.id, ref: w.ref, name: w.name })),
    [workflowsQ.data],
  );

  // U1 (doc 26) — deep-link ?ref= là nguồn chính; store lastSelected.workflowRef là fallback;
  // cuối cùng mới về workflow đầu tiên. Áp dụng MỘT LẦN sau khi list workflow đã tải.
  const search = useSearch();
  const deepLink = useMemo(() => parseDeepLink(search), [search]);
  const { lastSelected, setLastWorkflowRef } = useEngineering();
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    if (workflows.length === 0) return; // đợi list
    deepLinkApplied.current = true;
    const wanted = deepLink.ref ?? lastSelected.workflowRef;
    if (wanted && workflows.some((w) => w.ref === wanted)) setSelectedRef(wanted);
    else if (!selectedRef) setSelectedRef(workflows[0].ref);
  }, [workflows, deepLink.ref, lastSelected.workflowRef, selectedRef]);

  // U1 — nhớ workflow đang xem để lần sau mở lại đúng chỗ (fallback cho điều hướng trơn).
  useEffect(() => {
    if (selectedRef) setLastWorkflowRef(selectedRef);
  }, [selectedRef, setLastWorkflowRef]);

  // Refs the rAF loop reads/writes without re-rendering.
  const simRef = useRef(sim); simRef.current = sim;
  const runningRef = useRef(running); runningRef.current = running;
  const speedRef = useRef(speed); speedRef.current = speed;
  const stateRef = useRef({ t: 0, cycle: 0 });
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  // Fetch the predicted timeline whenever the selected workflow changes.
  useEffect(() => {
    if (!selectedRef) { setSim(null); return; }
    let alive = true;
    setSimLoading(true);
    setRunning(false);
    stateRef.current = { t: 0, cycle: 0 };
    setView({ t: 0, cycle: 0 });
    (async () => {
      try {
        const durs = durationsQ.data?.durations;
        const res = await utils.orchestration.simulate.fetch({
          workflowRef: selectedRef,
          // (5) Truyền thời lượng lệnh thật nếu lịch sử có dữ liệu; nếu rỗng → twin dùng mặc định.
          ...(durs && Object.keys(durs).length > 0 ? { commandDurations: durs } : {}),
        });
        if (!alive) return;
        setSim(res as unknown as Sim);
      } catch (err) {
        if (!alive) return;
        toast.error(t("celltwin.simFailed", "Không tải được mô phỏng twin"));
        // eslint-disable-next-line no-console
        console.error(err);
        setSim(null);
      } finally {
        if (alive) setSimLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [selectedRef, utils, t, durationsQ.data]);

  // The realtime playback loop (loops over [0, totalDurationMs]).
  useEffect(() => {
    const frame = (ts: number) => {
      if (!runningRef.current) { rafRef.current = null; return; }
      const s = simRef.current;
      if (!s || s.totalDurationMs <= 0) { rafRef.current = requestAnimationFrame(frame); return; }
      const last = lastTsRef.current ?? ts;
      lastTsRef.current = ts;
      const st = stateRef.current;
      let nt = st.t + (ts - last) * speedRef.current;
      if (nt >= s.totalDurationMs) {
        st.cycle += 1;
        nt -= s.totalDurationMs;
        if (nt >= s.totalDurationMs) nt = 0; // guard a huge dt
      }
      st.t = nt;
      setView({ t: st.t, cycle: st.cycle });
      rafRef.current = requestAnimationFrame(frame);
    };
    if (running) { lastTsRef.current = null; rafRef.current = requestAnimationFrame(frame); }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  }, [running]);

  const reset = () => {
    setRunning(false);
    stateRef.current = { t: 0, cycle: 0 };
    setView({ t: 0, cycle: 0 });
  };

  // (2) Tua tới thời điểm cụ thể (ms) + tự tạm dừng — dùng cho scrub & phím ←/→.
  const seekTo = (tMs: number) => {
    const s = simRef.current;
    if (!s || s.totalDurationMs <= 0) return;
    const clamped = Math.max(0, Math.min(s.totalDurationMs, tMs));
    setRunning(false);
    stateRef.current = { t: clamped, cycle: stateRef.current.cycle };
    setView({ t: clamped, cycle: stateRef.current.cycle });
  };

  // Scrub theo vị trí con trỏ trên thanh Gantt.
  const scrubbingRef = useRef(false);
  const scrubFromClientX = (clientX: number, el: HTMLElement) => {
    const s = simRef.current;
    if (!s || s.totalDurationMs <= 0) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seekTo(pct * s.totalDurationMs);
  };
  const onScrubDown = (e: React.PointerEvent<HTMLDivElement>) => {
    scrubbingRef.current = true;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    scrubFromClientX(e.clientX, e.currentTarget);
  };
  const onScrubMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    scrubFromClientX(e.clientX, e.currentTarget);
  };
  const onScrubUp = () => { scrubbingRef.current = false; };

  // Phím ←/→ bước theo biên leaf-step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const ae = document.activeElement;
      const tag = ae?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (ae as HTMLElement)?.isContentEditable) return;
      const s = simRef.current;
      if (!s || s.totalDurationMs <= 0) return;
      e.preventDefault();
      const bounds = leafBoundaries(s);
      const cur = stateRef.current.t;
      let target: number;
      if (e.key === "ArrowRight") target = bounds.find((b) => b > cur + 0.5) ?? s.totalDurationMs;
      else target = [...bounds].reverse().find((b) => b < cur - 0.5) ?? 0;
      seekTo(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── derived (per-frame) ──
  const stations = useMemo(() => (sim ? deriveStations(sim, nameOf) : []), [sim, machineMeta]);
  const stationIndex = useMemo(() => {
    const m = new Map<number, number>();
    stations.forEach((s, i) => m.set(s.machineId, i));
    return m;
  }, [stations]);

  const act = sim ? activeStep(sim, view.t) : undefined;
  const tokenPos = sim ? tokenLanePos(sim, view.t, stationIndex) : null;

  const cycleSec = sim ? sim.totalDurationMs / 1000 : 0;
  const leafSteps = sim
    ? sim.timeline.filter((e) => e.stepType !== "sequence" && e.stepType !== "parallel" && e.endMs > e.startMs)
    : [];
  const stepCount = sim
    ? sim.timeline.filter((e) => e.stepType !== "sequence" && e.stepType !== "parallel").length
    : 0;
  const warningsCount = sim ? sim.warnings.length : 0;

  const selectedWf = workflows.find((w) => w.ref === selectedRef);
  const activeMachineId = act?.machineId;
  const activeBranchNote = act?.stepType === "branch" ? act.note : undefined;
  const atTerminal = !!(sim && view.t >= sim.totalDurationMs - 1);

  // SVG lane geometry — evenly spread stations across the width.
  const VB_W = 880, VB_H = 280;
  const laneY = 150;
  const margin = 90;
  const stationX = (idx: number) =>
    stations.length <= 1 ? VB_W / 2 : margin + (idx * (VB_W - 2 * margin)) / (stations.length - 1);

  // (3) Layout THẬT: nếu MỌI trạm đều có toạ độ đã lưu → đặt theo X/Y thật; nếu thiếu → lane chia đều.
  const useRealLayout = stations.length > 0 && stations.every((s) => layoutMap.has(s.machineId));
  const stationPx = (idx: number): { x: number; y: number } => {
    if (useRealLayout) {
      const p = layoutMap.get(stations[idx].machineId)!;
      return { x: margin + p.x * (VB_W - 2 * margin), y: 56 + p.y * (VB_H - 112) };
    }
    return { x: stationX(idx), y: laneY };
  };

  // (1)(4) Trạng thái để hiển thị trên trạm: chế độ Trực tiếp lấy operationStatus thật; nếu không có binding → null (hiện "—").
  const displayStateOf = (machineId: number): string | null => {
    if (mode === "live") return liveState.get(machineId) ?? null;
    return sim ? stateAt(sim, machineId, view.t) : "Idle";
  };
  // (5) KPI nhịp chu kỳ có dựa trên lịch sử lệnh hay không.
  const durationsFromHistory = !!(durationsQ.data && Object.keys(durationsQ.data.durations).length > 0);

  // A small palette per machine (stable by lane index) for the Gantt + station tint.
  const PALETTE = ["#0ea5e9", "#6366f1", "#10b981", "#f59e0b", "#ec4899", "#14b8a6", "#a855f7", "#ef4444"];
  const colorOf = (machineId?: number) => {
    if (machineId == null) return "#cbd5e1";
    const idx = stationIndex.get(machineId);
    return idx === undefined ? "#cbd5e1" : PALETTE[idx % PALETTE.length];
  };

  const noWorkflows = !workflowsQ.isLoading && workflows.length === 0;

  return (
    <PageContainer fluid className="space-y-4">
        <PageHeader
          breadcrumbs={crumbs}
          icon={<Workflow className="h-6 w-6" />}
          badge={<ViewOnlyBadge module="machine_control" />}
          title={t("celltwin.title", "Cell Twin — Phát lại dự đoán quy trình")}
          description={t("celltwin.subtitle", "Chọn một quy trình và xem bản sao số phát lại dòng thời gian DỰ ĐOÁN; bật Trực tiếp để phủ trạng thái thiết bị thật (không phát lệnh)")}
          actions={
            <>
              <Button size="sm" disabled={simLoading || !sim || sim.totalDurationMs <= 0} onClick={() => setRunning((r) => !r)}>
                {running ? <><Pause className="h-4 w-4 mr-1" /> {t("celltwin.pause", "Tạm dừng")}</> : <><Play className="h-4 w-4 mr-1" /> {t("celltwin.play", "Chạy")}</>}
              </Button>
              <Button size="sm" variant="outline" onClick={reset}><RotateCcw className="h-4 w-4 mr-1" /> {t("celltwin.reset", "Đặt lại")}</Button>
              <div className="flex items-center gap-1">
                <Label className="text-xs text-muted-foreground">{t("celltwin.speed", "Tốc độ")}</Label>
                {SPEEDS.map((s) => (
                  <Button key={s} size="sm" variant={speed === s ? "default" : "outline"} className="px-2 h-7" onClick={() => setSpeed(s)}>{s}×</Button>
                ))}
              </div>
            </>
          }
        />

        {/* U7 (doc 26 §2.1) — "Khi nào dùng": trang LÀ GÌ / DÙNG KHI NÀO cho KTV mới. */}
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span>{t("celltwin.whenToUse", "Khi nào dùng — chọn một quy trình và phát lại dòng thời gian DỰ ĐOÁN trên bản sao số; bật Trực tiếp để phủ trạng thái thiết bị thật. Không phát lệnh nào xuống thiết bị.")}</span>
        </div>

        {/* workflow picker */}
        <div className="flex items-center gap-2 flex-wrap">
          <Label className="text-sm text-muted-foreground">{t("celltwin.workflow", "Quy trình")}</Label>
          <Select value={selectedRef} onValueChange={setSelectedRef} disabled={noWorkflows}>
            <SelectTrigger className="w-[420px] max-w-full">
              <SelectValue placeholder={t("celltwin.pickWorkflow", "Chọn quy trình…")} />
            </SelectTrigger>
            <SelectContent>
              {workflows.map((w) => (
                <SelectItem key={w.id} value={w.ref}>
                  {w.name} <span className="text-muted-foreground">· {w.ref}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {simLoading && <span className="text-xs text-muted-foreground">{t("celltwin.simulating", "Đang mô phỏng…")}</span>}
        </div>

        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t("celltwin.twinNote", "Đây là MÔ PHỎNG trên bản sao số (digital twin) — không phát lệnh xuống thiết bị. Khi chạy thật: mọi lệnh đi qua dispatcher HITL; an toàn (E-stop/interlock/chuyển động) nằm trên thiết bị.")}</span>
        </div>

        {noWorkflows ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              {t("celltwin.empty", "Chưa có quy trình nào được triển khai. Mở /orchestration-studio để tạo và triển khai một quy trình, sau đó quay lại đây để xem phát lại.")}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* ── generic scene ── */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4" /> {t("celltwin.cellView", "Sơ đồ tế bào (lane trạm)")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sim && stations.length > 0 ? (
                  <>
                    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full rounded-md bg-slate-50 dark:bg-slate-900 border">
                      {/* Đường nối trạm: lane thẳng (chia đều) hoặc polyline theo thứ tự dòng chảy (layout thật) */}
                      {useRealLayout ? (
                        <polyline
                          points={stations.map((_, idx) => { const p = stationPx(idx); return `${p.x},${p.y}`; }).join(" ")}
                          fill="none" className="stroke-slate-300 dark:stroke-slate-700" strokeWidth={2.5} strokeLinecap="round" strokeDasharray="6 5"
                        />
                      ) : (
                        <line x1={margin} y1={laneY} x2={VB_W - margin} y2={laneY} className="stroke-slate-300 dark:stroke-slate-700" strokeWidth={4} strokeLinecap="round" />
                      )}

                      {/* stations */}
                      {stations.map((s, idx) => {
                        const { x, y } = stationPx(idx);
                        const st = displayStateOf(s.machineId);
                        const isActive = activeMachineId === s.machineId;
                        const c = colorOf(s.machineId);
                        return (
                          <g key={s.machineId}>
                            {isActive && (
                              <rect x={x - 78} y={y - 52} width="156" height="104" rx="12" fill="none" stroke={c} strokeWidth={3} opacity={0.9}>
                                <animate attributeName="opacity" values="0.35;0.95;0.35" dur="1.1s" repeatCount="indefinite" />
                              </rect>
                            )}
                            <rect
                              x={x - 70} y={y - 44} width="140" height="88" rx="10"
                              className="fill-white dark:fill-slate-800"
                              stroke={isActive ? c : "#cbd5e1"} strokeWidth={isActive ? 2.5 : 1.5}
                            />
                            <rect x={x - 70} y={y - 44} width="140" height="6" rx="3" fill={c} />
                            <text x={x} y={y - 22} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
                              {s.name.length > 18 ? s.name.slice(0, 17) + "…" : s.name}
                            </text>
                            <text x={x} y={y - 7} textAnchor="middle" className="fill-slate-500 text-[9px]">{s.machineType}</text>
                            {/* PackML state badge — theo chế độ (dự đoán / trực tiếp) */}
                            <rect x={x - 42} y={y + 4} width="84" height="20" rx="10" fill={st ? stateColor(st) : "#94a3b8"} />
                            <text x={x} y={y + 18} textAnchor="middle" className="fill-white text-[10px] font-medium">{st ?? t("celltwin.noLive", "chưa rõ")}</text>
                          </g>
                        );
                      })}

                      {/* DUT token gliding along the lane (chuyển động là phát lại DỰ ĐOÁN) */}
                      {tokenPos != null && (() => {
                        const lo = Math.floor(tokenPos), hi = Math.ceil(tokenPos);
                        const frac = tokenPos - lo;
                        const a = stationPx(lo), b = stationPx(hi);
                        const x = lerp(a.x, b.x, frac);
                        const y = lerp(a.y, b.y, frac);
                        return (
                          <g>
                            <rect x={x - 9} y={y - 9} width="18" height="18" rx="3"
                              className="fill-emerald-500 stroke-emerald-700" strokeWidth={1.5} />
                            <text x={x} y={y + 30} textAnchor="middle" className="fill-emerald-600 text-[9px] font-medium">DUT</text>
                          </g>
                        );
                      })()}
                    </svg>
                    {/* Chú thích nguồn bố cục — trung thực về việc dùng vị trí thật hay chia đều */}
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {useRealLayout
                        ? t("celltwin.layoutReal", "Bố cục theo vị trí thật (Sửa mặt bằng nhà máy)")
                        : t("celltwin.layoutEven", "Bố cục lane chia đều (chưa đủ toạ độ đã lưu cho mọi trạm)")}
                    </div>

                    {/* active-step + branch / terminal notes */}
                    <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
                      <div className="text-[11px] text-muted-foreground">
                        {t("celltwin.activeStep", "Bước hiện tại")}:{" "}
                        <span className="text-foreground font-medium">{act?.stepId ?? "—"}</span>
                        {act?.command ? <span className="font-mono"> · {act.command}</span> : null}
                      </div>
                      {activeBranchNote && (
                        <Badge variant="outline" className="text-[10px]">{activeBranchNote}</Badge>
                      )}
                      {atTerminal && !running && (
                        <Badge className="bg-slate-600 text-white text-[10px]">{t("celltwin.done", "Kết thúc chu kỳ")}</Badge>
                      )}
                    </div>

                    {/* Gantt timeline strip + playhead — kéo để tua, ←/→ bước theo mốc */}
                    <div className="mt-3">
                      <div className="text-[11px] text-muted-foreground mb-1 flex items-center justify-between gap-2">
                        <span>{t("celltwin.timeline", "Tiến trình chu kỳ")}</span>
                        <span className="text-[10px]">{t("celltwin.scrubHint", "Kéo để tua · ←/→ bước theo mốc")}</span>
                      </div>
                      <div
                        className="relative h-7 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden cursor-ew-resize touch-none select-none"
                        role="slider"
                        aria-label={t("celltwin.timeline", "Tiến trình chu kỳ")}
                        aria-valuemin={0}
                        aria-valuemax={Math.round(sim.totalDurationMs)}
                        aria-valuenow={Math.round(view.t)}
                        onPointerDown={onScrubDown}
                        onPointerMove={onScrubMove}
                        onPointerUp={onScrubUp}
                        onPointerLeave={onScrubUp}
                      >
                        {leafSteps.map((e) => {
                          const left = (e.startMs / sim.totalDurationMs) * 100;
                          const w = ((e.endMs - e.startMs) / sim.totalDurationMs) * 100;
                          return (
                            <div
                              key={e.stepId}
                              className="absolute top-0 h-full border-r border-white/60 pointer-events-none"
                              style={{ left: `${left}%`, width: `${w}%`, background: colorOf(e.machineId), opacity: act?.stepId === e.stepId ? 1 : 0.45 }}
                              title={`${e.stepId}${e.command ? " · " + e.command : ""}`}
                            />
                          );
                        })}
                        <div className="absolute top-0 h-full w-0.5 bg-black dark:bg-white pointer-events-none" style={{ left: `${(view.t / sim.totalDurationMs) * 100}%` }} />
                      </div>
                      {/* machine legend */}
                      <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                        {stations.map((s) => (
                          <span key={s.machineId} className="flex items-center gap-1">
                            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: colorOf(s.machineId) }} /> {s.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-10 text-center text-muted-foreground text-sm">
                    {simLoading
                      ? t("celltwin.simulating", "Đang mô phỏng…")
                      : sim && stations.length === 0
                        ? t("celltwin.noStations", "Quy trình này không tham chiếu máy nào để hiển thị.")
                        : t("celltwin.selectPrompt", "Chọn một quy trình để xem phát lại.")}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── live status + KPIs ── */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2 space-y-2">
                  <CardTitle className="text-sm">{t("celltwin.machines", "Trạng thái máy (PackML)")}</CardTitle>
                  {/* (1)(4) Toggle nguồn trạng thái: Dự đoán (trace) vs Trực tiếp (thiết bị thật) */}
                  <div className="inline-flex rounded-md border p-0.5 text-xs w-fit">
                    <button
                      type="button"
                      className={`px-2 py-0.5 rounded ${mode === "predicted" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                      onClick={() => setMode("predicted")}
                    >
                      {t("celltwin.modePredicted", "Dự đoán")}
                    </button>
                    <button
                      type="button"
                      className={`px-2 py-0.5 rounded inline-flex items-center gap-1 ${mode === "live" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                      onClick={() => setMode("live")}
                    >
                      <Radio className="h-3 w-3" /> {t("celltwin.modeLive", "Trực tiếp")}
                    </button>
                  </div>
                  {mode === "live" && (
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      {t("celltwin.liveNote", "Đang hiển thị trạng thái thiết bị THẬT (operationStatus). Chuyển động token vẫn là phát lại dự đoán.")}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  {stations.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
                  {sim && stations.map((s) => {
                    const st = displayStateOf(s.machineId);
                    return (
                      <div key={s.machineId} className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm">
                          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: colorOf(s.machineId) }} />
                          {s.name}
                        </span>
                        <Badge style={{ background: st ? stateColor(st) : "#94a3b8" }} className="text-white">{st ?? t("celltwin.noLive", "chưa rõ")}</Badge>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{t("celltwin.kpis", "Chỉ số dự đoán")}</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <Kpi
                    label={t("celltwin.cycleTime", "Nhịp chu kỳ")}
                    value={`${cycleSec.toFixed(1)}s`}
                    hint={durationsFromHistory ? t("celltwin.kpiFromHistory", "theo lịch sử lệnh") : t("celltwin.kpiDefault", "ước lượng mặc định")}
                  />
                  <Kpi label={t("celltwin.stepCount", "Số bước")} value={String(stepCount)} />
                  <Kpi label={t("celltwin.machineCount", "Số máy")} value={String(stations.length)} />
                  <Kpi
                    label={t("celltwin.warnings", "Cảnh báo")}
                    value={String(warningsCount)}
                    cls={warningsCount > 0 ? "text-amber-600" : undefined}
                    icon={warningsCount > 0 ? <AlertTriangle className="h-3.5 w-3.5" /> : undefined}
                  />
                  <Kpi label={t("celltwin.cycleNo", "Chu kỳ đã chạy")} value={String(view.cycle)} />
                  <Kpi label={t("celltwin.elapsed", "Thời điểm")} value={`${(view.t / 1000).toFixed(1)}s`} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{t("celltwin.program", "Chương trình điều khiển")}</CardTitle></CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-1">
                  {selectedWf ? (
                    <>
                      <p className="text-foreground font-medium">{selectedWf.name}</p>
                      <p className="font-mono text-[11px]">ref: {selectedWf.ref} · {stepCount} steps</p>
                    </>
                  ) : (
                    <p>—</p>
                  )}
                  {sim && !sim.valid && sim.errors.length > 0 && (
                    <p className="text-destructive">{t("celltwin.invalid", "Quy trình không hợp lệ")}: {sim.errors[0]}</p>
                  )}
                  <p>{t("celltwin.openStudio", "Mở /orchestration-studio để sửa/triển khai/chạy thật (qua dispatcher HITL).")}</p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
    </PageContainer>
  );
}

export default function CellTwinPlayer() {
  return (
    <DashboardLayout>
      <CellTwinPlayerContent />
    </DashboardLayout>
  );
}

function Kpi({ label, value, cls, icon, hint }: { label: string; value: string; cls?: string; icon?: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className={`text-lg font-semibold ${cls ?? ""}`}>{value}</div>
      {hint && <div className="text-[9px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
