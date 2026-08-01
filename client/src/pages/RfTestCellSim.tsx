/**
 * RF Shielded Test Cell — REALTIME DIGITAL-TWIN PLAYBACK.
 *
 * A "watch it run" view for a wireless-transmitter test station:
 *   • Mitsubishi FX5U PLC driving an XYZ feeder gantry (cấp liệu),
 *   • a pick&place robot,
 *   • an RF shielded test chamber (đo cách sóng).
 *
 * The control program is a portable FOE WorkflowDefinition (one DUT cycle). We ask
 * the SAME pure twin the Orchestration Studio uses (orchestration.simulate) to PREDICT
 * the cycle — once assuming PASS, once assuming FAIL — then replay the predicted
 * timeline against a wall-clock so the cell animates live, looping to fill a carton.
 *
 * 100% read-only / no dispatch: this is a simulation. Going live routes every command
 * through the HITL dispatcher; E-stop / interlock / motion stay on the PLC.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Play, Pause, RotateCcw, Radio, Bot, Cpu, CheckCircle2, XCircle, Activity, Info, Waves, Download, ExternalLink } from "lucide-react";

// ── Station model (inline — self-contained, no DB seeding needed) ─────────────────
const FEEDER = 901, ROBOT = 902, RF = 903;

const MACHINES = [
  {
    id: FEEDER,
    machineType: "AUTOMATION",
    capabilities: {
      adapterKind: "ot-mitsubishi-mc",
      cycleTimeTracked: true,
      extraCommands: [
        { name: "feed_dut", label: "Feed one DUT to the pick position", paramsSchema: [{ name: "slot", label: "Tray", dataType: "int" }], riskLevel: "high", requiredPermission: "machine_control/canCreate" },
      ],
    },
  },
  {
    id: ROBOT,
    machineType: "ROBOT",
    capabilities: {
      extraCommands: [
        { name: "transfer", label: "Pick-and-place between two positions", paramsSchema: [{ name: "from", label: "From", dataType: "string" }, { name: "to", label: "To", dataType: "string" }], riskLevel: "high", requiredPermission: "machine_control/canCreate" },
      ],
    },
  },
  { id: RF, machineType: "FCT", capabilities: { emitsProcessResult: true, cycleTimeTracked: true } },
];

const COMMAND_DURATIONS = { start: 800, stop: 800, feed_dut: 1600, transfer: 1300, select_recipe: 400 };

/** The control PROGRAM — one DUT cycle (the line repeats it). */
const WORKFLOW = {
  ref: "RF-TEST-CELL-CYCLE",
  name: "One-DUT RF shield test cycle",
  steps: [
    { id: "feeder_start", type: "command", machineId: FEEDER, command: "start", label: "XYZ feeder: start" },
    { id: "feed", type: "command", machineId: FEEDER, command: "feed_dut", args: { slot: 1 }, label: "XYZ gantry brings DUT to the pick position" },
    { id: "xyz_travel", type: "delay", ms: 1200, label: "XYZ axes positioning" },
    { id: "wait_dut", type: "wait_telemetry", condition: { source: "telemetry", machineId: FEEDER, key: "dut_ready", op: "eq", value: 1 }, timeoutMs: 5000, label: "Interlock: pick only when a DUT is present" },
    { id: "robot_start", type: "command", machineId: ROBOT, command: "start", label: "Robot enters run mode" },
    { id: "pick_to_rf", type: "command", machineId: ROBOT, command: "transfer", args: { from: "PICK", to: "RF_CHAMBER" }, label: "Robot picks DUT → RF shield chamber" },
    { id: "load_settle", type: "delay", ms: 800, label: "Place DUT into the RF jig" },
    { id: "rf_recipe", type: "command", machineId: RF, command: "select_recipe", args: { recipeCode: "WIFI6_BT_TX" }, label: "Load RF test recipe (WiFi6/BT TX)" },
    { id: "rf_start", type: "command", machineId: RF, command: "start", label: "Close chamber + run emission measurement" },
    { id: "rf_measure", type: "delay", ms: 3000, label: "Measure: TX power, frequency, EVM, spectrum" },
    { id: "wait_result", type: "wait_telemetry", condition: { source: "telemetry", machineId: RF, key: "test_done", op: "eq", value: 1 }, timeoutMs: 10000, label: "Wait for the measurement result" },
    {
      id: "sort", type: "branch",
      condition: { source: "telemetry", machineId: RF, key: "process_result", op: "eq", value: "PASS" },
      then: [{ id: "place_ok", type: "command", machineId: ROBOT, command: "transfer", args: { from: "RF_CHAMBER", to: "CARTON_OK" }, label: "Stack PASS DUT into the carton" }],
      else: [{ id: "place_ng", type: "command", machineId: ROBOT, command: "transfer", args: { from: "RF_CHAMBER", to: "REJECT_BIN" }, label: "Reject FAIL DUT into the NG bin" }],
      label: "Sort by RF result",
    },
    { id: "place_settle", type: "delay", ms: 900, label: "Robot places + returns home" },
    { id: "rf_stop", type: "command", machineId: RF, command: "stop", label: "Open chamber, end measurement" },
  ],
};

// ── Twin result shape (mirror of server SimulationResult) ─────────────────────────
interface TLEntry { stepId: string; stepType: string; machineId?: number; command?: string; startMs: number; endMs: number; status: string; predictedState?: string; note?: string }
interface StatePoint { atMs: number; state: string }
interface Sim { ok: boolean; valid: boolean; errors: string[]; timeline: TLEntry[]; warnings: { stepId: string; kind: string; message: string }[]; totalDurationMs: number; machineStateTrace: Record<number, StatePoint[]> }

// ── 2D scene geometry (top-down, viewBox 0 0 840 420) ─────────────────────────────
const PT = {
  TRAY: { x: 95, y: 150 },
  PICK: { x: 300, y: 150 },
  ROBOT: { x: 440, y: 220 },
  CHAMBER: { x: 630, y: 150 },
  CARTON: { x: 680, y: 340 },
  REJECT: { x: 470, y: 70 },
};

// stepId → human label (recursively incl. branch then/else children).
const STEP_LABELS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const walk = (steps: Array<Record<string, unknown>>) => {
    for (const s of steps) {
      if (s.id && s.label) out[s.id as string] = s.label as string;
      if (Array.isArray(s.then)) walk(s.then as Array<Record<string, unknown>>);
      if (Array.isArray(s.else)) walk(s.else as Array<Record<string, unknown>>);
      if (Array.isArray(s.steps)) walk(s.steps as Array<Record<string, unknown>>);
    }
  };
  walk(WORKFLOW.steps as unknown as Array<Record<string, unknown>>);
  return out;
})();
const labelOf = (stepId?: string) => (stepId ? STEP_LABELS[stepId] ?? stepId : "—");

function lerp(a: number, b: number, p: number) { return a + (b - a) * Math.max(0, Math.min(1, p)); }
function lerpPt(a: { x: number; y: number }, b: { x: number; y: number }, p: number) { return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) }; }

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

/** DUT token position + which machine is carrying it, at time t. */
function tokenAt(sim: Sim, t: number, variant: "PASS" | "FAIL") {
  const e = (id: string) => sim.timeline.find((x) => x.stepId === id);
  const feed = e("feed"), travel = e("xyz_travel"), pick = e("pick_to_rf"), load = e("load_settle");
  const place = variant === "FAIL" ? e("place_ng") : e("place_ok");
  const settle = e("place_settle");
  const target = variant === "FAIL" ? PT.REJECT : PT.CARTON;
  if (!feed || !travel || !pick || !load || !place || !settle) return { x: PT.TRAY.x, y: PT.TRAY.y, carrier: "none" as const, visible: true };

  if (t < feed.startMs) return { ...PT.TRAY, carrier: "none" as const, visible: true };
  // 1) gantry XYZ brings DUT TRAY → PICK
  if (t < travel.endMs) return { ...lerpPt(PT.TRAY, PT.PICK, (t - feed.startMs) / (travel.endMs - feed.startMs)), carrier: "gantry" as const, visible: true };
  // 2) waiting at PICK (robot spinning up)
  if (t < pick.startMs) return { ...PT.PICK, carrier: "none" as const, visible: true };
  // 3) robot carries PICK → CHAMBER
  if (t < load.endMs) return { ...lerpPt(PT.PICK, PT.CHAMBER, (t - pick.startMs) / (load.endMs - pick.startMs)), carrier: "robot" as const, visible: true };
  // 4) inside chamber, testing
  if (t < place.startMs) return { ...PT.CHAMBER, carrier: "none" as const, visible: true };
  // 5) robot carries CHAMBER → carton/reject
  if (t < settle.endMs) return { ...lerpPt(PT.CHAMBER, target, (t - place.startMs) / (settle.endMs - place.startMs)), carrier: "robot" as const, visible: true };
  // 6) deposited
  return { ...target, carrier: "none" as const, visible: false };
}

const SPEEDS = [0.5, 1, 2, 4];
const CARTON_COLS = 6, CARTON_ROWS = 4, CARTON_SIZE = CARTON_COLS * CARTON_ROWS;

// ── Seeded stochastic yield ───────────────────────────────────────────────────────
// Defects occur by PROBABILITY (a Bernoulli trial on `yieldRate`), NOT on a fixed
// "1 NG every N DUTs" cadence. The run stays DETERMINISTIC under a fixed seed: a fresh
// mulberry32 stream is seeded per cycle index, so the PASS/FAIL sequence is reproducible
// across resets and independent of call order (a stateful stream is not needed).
const YIELD_SEED = 0x51ec; // fixed seed → deterministic playback
const DEFAULT_YIELD_RATE = 0.95; // ~95% good; tunable setpoint (control lives in the header)
const YIELD_PRESETS = [0.9, 0.95, 0.98, 0.99];

/** mulberry32 — one deterministic uniform in [0,1) from a 32-bit seed (same family as the DES engine). */
function mulberry32(seed: number): number {
  let a = seed >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let x = a;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

/** Deterministic PASS/FAIL for cycle `idx`: Bernoulli(yieldRate) — PASS with probability = yieldRate. */
function sampleVariant(idx: number, yieldRate: number): "PASS" | "FAIL" {
  const u = mulberry32((YIELD_SEED ^ Math.imul(idx + 1, 0x9e3779b9)) >>> 0);
  return u < yieldRate ? "PASS" : "FAIL";
}

// ── RF measurement trace (SIMULATED — deterministic per DUT) ────────────────────────
// KHÔNG phải giá trị realtime: các số đo RF được SINH TẤT ĐỊNH từ seed theo chỉ số chu kỳ
// (cùng họ mulberry32 với yield). Mỗi DUT phát 4 metric RF điển hình của bước "Measure…":
// TX power, sai số tần số, EVM, biên spectrum-mask — kèm giới hạn để giải thích PASS/FAIL
// bằng SỐ. Với DUT FAIL, đúng MỘT metric bị đẩy ra ngoài spec (lý do rớt), các metric còn lại đạt.

/** Một metric RF đo được của một DUT (kèm giới hạn + kết luận đạt/rớt). */
export interface RfMetric {
  key: string; // hậu tố khoá i18n (rfcell.rf.<key>)
  value: number;
  unit: string;
  low: number | null; // giới hạn dưới (null = không áp dụng)
  high: number | null; // giới hạn trên (null = không áp dụng)
  dispLo: number; // miền hiển thị của thanh đo
  dispHi: number;
  pass: boolean;
}

/** Bản ghi kết quả test một DUT trong phiên (để lưu History + export CSV). */
export interface DutRecord {
  cycle: number; // chỉ số chu kỳ (0-based)
  serial: string;
  variant: "PASS" | "FAIL";
  ts: number; // wall-clock lúc ghi (nhật ký phiên)
  metrics: RfMetric[];
}

/** Cấu hình 4 metric RF: đơn vị, giới hạn spec, miền hiển thị thanh đo. */
const RF_METRICS = [
  { key: "txPower", unit: "dBm", low: 15, high: 21, dispLo: 12, dispHi: 24 },
  { key: "freqErr", unit: "ppm", low: -25, high: 25, dispLo: -45, dispHi: 45 },
  { key: "evm", unit: "%", low: null as number | null, high: 5, dispLo: 0, dispHi: 8 },
  { key: "maskMargin", unit: "dB", low: 0, high: null as number | null, dispLo: -3, dispHi: 8 },
] as const;

const round2 = (v: number) => Math.round(v * 100) / 100;
/** Uniform tất định trong [0,1) cho (chu kỳ idx, muối salt). */
const rfRand = (idx: number, salt: number) => mulberry32((YIELD_SEED ^ Math.imul(idx + 1, salt >>> 0)) >>> 0);
const SALTS = [0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1];

/**
 * Sinh 4 số đo RF tất định cho DUT chu kỳ `idx` khớp với `variant`:
 *   • PASS → cả 4 metric nằm trong spec (quanh giá trị danh định),
 *   • FAIL → đúng một metric (chọn tất định) bị đẩy ra ngoài spec.
 */
function measureDut(idx: number, variant: "PASS" | "FAIL"): RfMetric[] {
  const failMetric = variant === "FAIL" ? Math.floor(rfRand(idx, 0x2545f491) * RF_METRICS.length) % RF_METRICS.length : -1;
  return RF_METRICS.map((m, i) => {
    const u = rfRand(idx, SALTS[i]);
    const failing = i === failMetric;
    let value: number;
    switch (m.key) {
      case "txPower":
        value = failing ? 12 + u * 2.5 : 16.5 + u * 3; // fail < 15 dBm
        break;
      case "freqErr": {
        const sgn = rfRand(idx, 0x1b56c4e9) < 0.5 ? -1 : 1;
        value = failing ? sgn * (27 + u * 12) : (u - 0.5) * 30; // fail |ppm| > 25
        break;
      }
      case "evm":
        value = failing ? 5.5 + u * 2 : 1.8 + u * 2; // fail > 5%
        break;
      default: // maskMargin
        value = failing ? -0.4 - u * 2 : 2.5 + u * 3.3; // fail biên âm (vi phạm mask)
        break;
    }
    value = round2(value);
    const pass = (m.low === null || value >= m.low) && (m.high === null || value <= m.high);
    return { key: m.key, value, unit: m.unit, low: m.low, high: m.high, dispLo: m.dispLo, dispHi: m.dispHi, pass };
  });
}

const MAX_HISTORY = 500; // giới hạn bản ghi giữ trong phiên

export function RfTestCellSimContent() {
  const { t } = useTranslation();
  // U3 (doc 26) — breadcrumb "Kỹ thuật › Section › Trang" + link về Hub.
  const [location] = useLocation();
  const crumbs = buildBreadcrumbs(location, t);
  const utils = trpc.useUtils();

  const [sims, setSims] = useState<{ pass: Sim; fail: Sim } | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0); // tăng để thử tải lại twin (nút Retry)
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [yieldRate, setYieldRate] = useState(DEFAULT_YIELD_RATE);
  const [mode, setMode] = useState<"twin" | "live">("twin"); // chế độ nguồn dữ liệu (Live: chưa map máy thật)
  const [history, setHistory] = useState<DutRecord[]>([]); // nhật ký kết quả per-DUT trong phiên
  const [view, setView] = useState({ t: 0, cycle: 0, variant: "PASS" as "PASS" | "FAIL", ok: 0, ng: 0, carton: 0, cartonsDone: 0 });

  // Refs the rAF loop reads/writes without re-rendering.
  const simsRef = useRef(sims); simsRef.current = sims;
  const runningRef = useRef(running); runningRef.current = running;
  const speedRef = useRef(speed); speedRef.current = speed;
  const yieldRef = useRef(yieldRate); yieldRef.current = yieldRate;
  const stateRef = useRef({ t: 0, cycle: 0, variant: "PASS" as "PASS" | "FAIL", ok: 0, ng: 0, carton: 0, cartonsDone: 0 });
  const historyRef = useRef<DutRecord[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  // Seeded Bernoulli on the current yield setpoint (read via ref so tuning yield mid-run
  // takes effect without restarting the loop). Deterministic for a given (seed, idx, yield).
  const pickVariant = (idx: number): "PASS" | "FAIL" => sampleVariant(idx, yieldRef.current);

  // Fetch the two predicted timelines (PASS / FAIL) from the pure twin.
  // reloadKey trong deps: nút Retry tăng nó để thử tải lại sau lỗi.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const base = { workflow: WORKFLOW as unknown as Record<string, unknown>, machines: MACHINES as never, commandDurations: COMMAND_DURATIONS };
        const [pass, fail] = await Promise.all([
          utils.orchestration.simulate.fetch({ ...base, assumedTelemetry: { [FEEDER]: { dut_ready: 1 }, [RF]: { test_done: 1, process_result: "PASS" } } }),
          utils.orchestration.simulate.fetch({ ...base, assumedTelemetry: { [FEEDER]: { dut_ready: 1 }, [RF]: { test_done: 1, process_result: "FAIL" } } }),
        ]);
        if (!alive) return;
        setSims({ pass: pass as unknown as Sim, fail: fail as unknown as Sim });
      } catch (err) {
        toast.error(t("rfcell.simFailed", "Could not load the twin simulation"));
        // eslint-disable-next-line no-console
        console.error(err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [utils, t, reloadKey]);

  // The realtime playback loop.
  useEffect(() => {
    const frame = (ts: number) => {
      if (!runningRef.current) { rafRef.current = null; return; }
      const s = simsRef.current;
      if (!s) { rafRef.current = requestAnimationFrame(frame); return; }
      const last = lastTsRef.current ?? ts;
      lastTsRef.current = ts;
      const st = stateRef.current;
      const dur = (st.variant === "FAIL" ? s.fail : s.pass).totalDurationMs;
      let nt = st.t + (ts - last) * speedRef.current;
      if (nt >= dur) {
        // finalize the cycle — ghi bản ghi DUT (số đo tất định khớp variant vừa chạy)
        const rec: DutRecord = {
          cycle: st.cycle,
          serial: `DUT-${String(st.cycle + 1).padStart(4, "0")}`,
          variant: st.variant,
          ts: Date.now(),
          metrics: measureDut(st.cycle, st.variant),
        };
        const nextHist = historyRef.current.concat(rec);
        if (nextHist.length > MAX_HISTORY) nextHist.splice(0, nextHist.length - MAX_HISTORY);
        historyRef.current = nextHist;
        setHistory(nextHist);

        if (st.variant === "FAIL") st.ng += 1;
        else {
          st.ok += 1;
          st.carton += 1;
          if (st.carton >= CARTON_SIZE) { st.carton = 0; st.cartonsDone += 1; }
        }
        st.cycle += 1;
        st.variant = pickVariant(st.cycle);
        nt -= dur;
      }
      st.t = nt;
      setView({ t: st.t, cycle: st.cycle, variant: st.variant, ok: st.ok, ng: st.ng, carton: st.carton, cartonsDone: st.cartonsDone });
      rafRef.current = requestAnimationFrame(frame);
    };
    if (running) { lastTsRef.current = null; rafRef.current = requestAnimationFrame(frame); }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  }, [running]);

  const reset = () => {
    setRunning(false);
    stateRef.current = { t: 0, cycle: 0, variant: "PASS", ok: 0, ng: 0, carton: 0, cartonsDone: 0 };
    historyRef.current = [];
    setHistory([]);
    setView({ t: 0, cycle: 0, variant: "PASS", ok: 0, ng: 0, carton: 0, cartonsDone: 0 });
  };

  // Xuất nhật ký kết quả per-DUT ra CSV (khoá cột giữ tiếng Anh cho ổn định máy đọc).
  const exportCsv = () => {
    if (!history.length) return;
    const cols = ["serial", "time", "result", ...RF_METRICS.map((m) => `${m.key}_${m.unit}`)];
    const rows = history.map((r) => [
      r.serial,
      new Date(r.ts).toISOString(),
      r.variant,
      ...r.metrics.map((m) => String(m.value)),
    ]);
    const csv = [cols.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rf-test-cell-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sim = sims ? (view.variant === "FAIL" ? sims.fail : sims.pass) : null;
  const cycleSec = sim ? sim.totalDurationMs / 1000 : 0;
  const uph = cycleSec > 0 ? Math.round(3600 / cycleSec) : 0;
  const total = view.ok + view.ng;
  const yieldPct = total > 0 ? ((view.ok / total) * 100).toFixed(1) : "—";

  const act = sim ? activeStep(sim, view.t) : undefined;
  const token = sim ? tokenAt(sim, view.t, view.variant) : null;
  const feederState = sim ? stateAt(sim, FEEDER, view.t) : "Idle";
  const robotState = sim ? stateAt(sim, ROBOT, view.t) : "Idle";
  const rfState = sim ? stateAt(sim, RF, view.t) : "Idle";

  // RF chamber glow + result flash windows.
  const rfStart = sim?.timeline.find((x) => x.stepId === "rf_start");
  const rfMeasure = sim?.timeline.find((x) => x.stepId === "rf_measure");
  const waitResult = sim?.timeline.find((x) => x.stepId === "wait_result");
  const rfTesting = !!(rfStart && rfMeasure && view.t >= rfStart.startMs && view.t < rfMeasure.endMs);
  const resultKnown = !!(waitResult && view.t >= waitResult.startMs);

  // Số đo RF của DUT ĐANG chạy (tất định theo chu kỳ) — chỉ lộ khi bước đo hoàn tất.
  const measurement = sim ? measureDut(view.cycle, view.variant) : [];
  const failingMetric = measurement.find((m) => !m.pass);

  return (
    <PageContainer fluid className="space-y-4">
        <PageHeader
          breadcrumbs={crumbs}
          icon={<Radio className="h-6 w-6" />}
          badge={<ViewOnlyBadge module="machine_control" />}
          title={t("rfcell.title", "RF Shielded Test Cell — Realtime Simulation")}
          description={t("rfcell.subtitle", "FX5U XYZ feeder • pick&place robot • RF test chamber — a digital twin running in real time")}
          actions={
            <>
              <div className="flex items-center gap-1" role="group" aria-label={t("rfcell.sourceMode", "Data source")}>
                <Button size="sm" variant={mode === "twin" ? "default" : "outline"} className="px-2 h-7" onClick={() => setMode("twin")}>
                  {t("rfcell.modeTwin", "Twin playback")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="px-2 h-7"
                  disabled
                  title={t("rfcell.modeLiveHint", "Live telemetry requires mapping this cell to real machines — not wired yet")}
                >
                  {t("rfcell.modeLive", "Live")}
                </Button>
              </div>
              <Button size="sm" disabled={loading || !sims} onClick={() => setRunning((r) => !r)}>
                {running ? <><Pause className="h-4 w-4 mr-1" /> {t("rfcell.pause", "Pause")}</> : <><Play className="h-4 w-4 mr-1" /> {t("rfcell.play", "Play")}</>}
              </Button>
              <Button size="sm" variant="outline" onClick={reset}><RotateCcw className="h-4 w-4 mr-1" /> {t("rfcell.reset", "Reset")}</Button>
              <div className="flex items-center gap-1">
                <Label className="text-xs text-muted-foreground">{t("rfcell.speed", "Speed")}</Label>
                {SPEEDS.map((s) => (
                  <Button key={s} size="sm" variant={speed === s ? "default" : "outline"} className="px-2 h-7" onClick={() => setSpeed(s)}>{s}×</Button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-xs text-muted-foreground">{t("rfcell.yieldControl", "Yield")}</Label>
                {YIELD_PRESETS.map((y) => (
                  <Button
                    key={y}
                    size="sm"
                    variant={yieldRate === y ? "default" : "outline"}
                    className="px-2 h-7"
                    onClick={() => setYieldRate(y)}
                    title={t("rfcell.yieldHint", "Target good-part probability (seeded, deterministic)")}
                  >
                    {Math.round(y * 100)}%
                  </Button>
                ))}
              </div>
            </>
          }
        />

        {/* U7 (doc 26 §2.1) — "Khi nào dùng": trang LÀ GÌ / DÙNG KHI NÀO cho KTV mới. */}
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span>{t("rfcell.whenToUse", "When to use — watch a real-time digital twin of the RF shielded test cell (feeder + robot + RF chamber) to understand its cycle. Simulation only — no device commands.")}</span>
        </div>

        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t("rfcell.twinNote", "This is a SIMULATION on a digital twin — no command is sent to any device. When run for real, every command goes through the HITL dispatcher; safety (E-stop / interlock / motion) stays on the FX5U PLC.")}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── 2D cell scene ── */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> {t("rfcell.cellView", "Cell layout (top-down)")}</CardTitle></CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="aspect-[2/1] w-full rounded-md" />
                  <Skeleton className="h-7 w-full rounded" />
                  <p className="text-center text-xs text-muted-foreground">{t("rfcell.loading", "Loading twin simulation…")}</p>
                </div>
              ) : !sims ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                  <XCircle className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">{t("rfcell.loadFailedTitle", "Simulation unavailable")}</p>
                  <p className="max-w-sm text-xs text-muted-foreground">{t("rfcell.loadFailedBody", "The digital-twin simulation could not be loaded. Check that the orchestration twin service is reachable, then retry.")}</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setReloadKey((k) => k + 1)}>
                    <RotateCcw className="h-4 w-4 mr-1" /> {t("rfcell.retry", "Retry")}
                  </Button>
                </div>
              ) : (
              <>
              <svg viewBox="0 0 840 420" className="w-full rounded-md bg-slate-50 dark:bg-slate-900 border">
                {/* feeder rail + tray */}
                <rect x="55" y="135" width="255" height="8" rx="4" className="fill-slate-300 dark:fill-slate-700" />
                <rect x="60" y="120" width="70" height="60" rx="4" className="fill-slate-200 dark:fill-slate-800 stroke-slate-400" />
                <text x="95" y="200" textAnchor="middle" className="fill-slate-500 text-[11px]">{t("rfcell.svg.dutTray", "DUT tray")}</text>
                {/* gantry carriage */}
                {(() => {
                  const gx = token?.carrier === "gantry" ? token.x : PT.PICK.x;
                  return <g><rect x={gx - 14} y={108} width="28" height="20" rx="3" className="fill-sky-500" /><line x1={gx} y1={128} x2={gx} y2={143} className="stroke-sky-600" strokeWidth={3} /></g>;
                })()}
                <text x={PT.PICK.x} y={108} textAnchor="middle" className="fill-slate-500 text-[10px]">XYZ (FX5U)</text>
                <circle cx={PT.PICK.x} cy={PT.PICK.y} r={6} className="fill-slate-400" />
                <text x={PT.PICK.x} y={172} textAnchor="middle" className="fill-slate-500 text-[10px]">{t("rfcell.svg.pickPos", "Pick position")}</text>

                {/* robot */}
                <circle cx={PT.ROBOT.x} cy={PT.ROBOT.y} r={26} className="fill-slate-200 dark:fill-slate-800 stroke-slate-400" />
                <circle cx={PT.ROBOT.x} cy={PT.ROBOT.y} r={8} className="fill-indigo-500" />
                <text x={PT.ROBOT.x} y={PT.ROBOT.y + 44} textAnchor="middle" className="fill-slate-500 text-[10px]">{t("rfcell.svg.robot", "Robot")}</text>
                {token?.carrier === "robot" && <line x1={PT.ROBOT.x} y1={PT.ROBOT.y} x2={token.x} y2={token.y} className="stroke-indigo-500" strokeWidth={4} strokeLinecap="round" />}

                {/* RF chamber */}
                <rect x={PT.CHAMBER.x - 55} y={PT.CHAMBER.y - 50} width="110" height="100" rx="6"
                  className={rfTesting ? "fill-emerald-100 dark:fill-emerald-900/40 stroke-emerald-500" : "fill-slate-200 dark:fill-slate-800 stroke-slate-400"} strokeWidth={2} />
                {rfTesting && [18, 30, 42].map((r, i) => (
                  <circle key={r} cx={PT.CHAMBER.x} cy={PT.CHAMBER.y} r={r} fill="none" className="stroke-emerald-500" strokeWidth={1.5} opacity={0.7 - i * 0.2}>
                    <animate attributeName="r" values={`${r};${r + 10};${r}`} dur="1.2s" repeatCount="indefinite" />
                  </circle>
                ))}
                <text x={PT.CHAMBER.x} y={PT.CHAMBER.y - 58} textAnchor="middle" className="fill-slate-500 text-[10px]">{t("rfcell.svg.rfChamber", "RF shield chamber")}</text>
                {resultKnown && view.t < (sim?.timeline.find((x) => x.stepId === "place_settle")?.endMs ?? 0) && (
                  <text x={PT.CHAMBER.x} y={PT.CHAMBER.y + 4} textAnchor="middle" className={view.variant === "FAIL" ? "fill-red-600 text-[14px] font-bold" : "fill-emerald-600 text-[14px] font-bold"}>
                    {view.variant === "FAIL" ? "FAIL" : "PASS"}
                  </text>
                )}

                {/* carton (OK) grid */}
                <rect x={PT.CARTON.x - 70} y={PT.CARTON.y - 42} width="140" height="74" rx="4" className="fill-amber-50 dark:fill-amber-950/30 stroke-amber-500" strokeWidth={2} />
                {Array.from({ length: CARTON_SIZE }).map((_, i) => {
                  const c = i % CARTON_COLS, r = Math.floor(i / CARTON_COLS);
                  const filled = i < view.carton;
                  return <rect key={i} x={PT.CARTON.x - 64 + c * 21} y={PT.CARTON.y - 36 + r * 17} width="17" height="13" rx="2" className={filled ? "fill-emerald-500" : "fill-slate-200 dark:fill-slate-700 stroke-slate-300"} />;
                })}
                <text x={PT.CARTON.x} y={PT.CARTON.y + 46} textAnchor="middle" className="fill-slate-500 text-[10px]">{t("rfcell.svg.cartonOk", "PASS carton")} ({view.carton}/{CARTON_SIZE})</text>

                {/* reject bin */}
                <rect x={PT.REJECT.x - 28} y={PT.REJECT.y - 22} width="56" height="40" rx="4" className="fill-red-50 dark:fill-red-950/30 stroke-red-400" strokeWidth={2} />
                <text x={PT.REJECT.x} y={PT.REJECT.y + 4} textAnchor="middle" className="fill-red-600 text-[12px] font-semibold">{view.ng}</text>
                <text x={PT.REJECT.x} y={PT.REJECT.y + 34} textAnchor="middle" className="fill-slate-500 text-[10px]">{t("rfcell.svg.rejectBin", "Reject bin")}</text>

                {/* the DUT token */}
                {token?.visible && (
                  <rect x={token.x - 8} y={token.y - 8} width="16" height="16" rx="2"
                    className={view.variant === "FAIL" && resultKnown ? "fill-red-500 stroke-red-700" : "fill-emerald-500 stroke-emerald-700"} strokeWidth={1.5} />
                )}
              </svg>

              {/* timeline / playhead */}
              {sim && (
                <div className="mt-3">
                  <div className="text-[11px] text-muted-foreground mb-1">{t("rfcell.timeline", "Cycle progress")} — {labelOf(act?.stepId)}</div>
                  <div className="relative h-7 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    {sim.timeline.filter((e) => e.stepType !== "sequence" && e.stepType !== "parallel" && e.endMs > e.startMs).map((e) => {
                      const left = (e.startMs / sim.totalDurationMs) * 100;
                      const w = ((e.endMs - e.startMs) / sim.totalDurationMs) * 100;
                      const color = e.machineId === FEEDER ? "#0ea5e9" : e.machineId === ROBOT ? "#6366f1" : e.machineId === RF ? "#10b981" : "#cbd5e1";
                      return <div key={e.stepId} className="absolute top-0 h-full border-r border-white/60" style={{ left: `${left}%`, width: `${w}%`, background: color, opacity: act?.stepId === e.stepId ? 1 : 0.45 }} title={labelOf(e.stepId)} />;
                    })}
                    <div className="absolute top-0 h-full w-0.5 bg-black dark:bg-white" style={{ left: `${(view.t / sim.totalDurationMs) * 100}%` }} />
                  </div>
                  <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: "#0ea5e9" }} /> FX5U</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: "#6366f1" }} /> Robot</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: "#10b981" }} /> RF</span>
                  </div>
                </div>
              )}
              </>
              )}
            </CardContent>
          </Card>

          {/* ── live status + KPIs ── */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{t("rfcell.machines", "Machine status (PackML)")}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {[
                  { icon: <Cpu className="h-4 w-4" />, name: "FX5U Feeder XYZ", st: feederState },
                  { icon: <Bot className="h-4 w-4" />, name: "Pick&Place Robot", st: robotState },
                  { icon: <Radio className="h-4 w-4" />, name: "RF Shield Test", st: rfState },
                ].map((m) => (
                  <div key={m.name} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm">{m.icon} {m.name}</span>
                    <Badge style={{ background: stateColor(m.st) }} className="text-white">{m.st}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{t("rfcell.kpis", "Output & throughput")}</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <Kpi label={t("rfcell.cycleNo", "Cycle")} value={String(view.cycle)} />
                <Kpi label={t("rfcell.cycleTime", "Cycle/DUT")} value={`${cycleSec.toFixed(1)}s`} />
                <Kpi label="OK" value={String(view.ok)} cls="text-emerald-600" icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
                <Kpi label="NG" value={String(view.ng)} cls="text-red-600" icon={<XCircle className="h-3.5 w-3.5" />} />
                <Kpi label={t("rfcell.yield", "Yield")} value={`${yieldPct}%`} />
                <Kpi label={t("rfcell.targetYield", "Target yield")} value={`${Math.round(yieldRate * 100)}%`} />
                <Kpi label={t("rfcell.uph", "Throughput")} value={`${uph} UPH`} />
                <Kpi label={t("rfcell.cartonsDone", "Cartons done")} value={String(view.cartonsDone)} />
                <Kpi label={t("rfcell.inCarton", "In carton")} value={`${view.carton}/${CARTON_SIZE}`} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{t("rfcell.program", "Control program")}</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <p>{t("rfcell.programNote", "One cycle = a WorkflowDefinition (FOE/ISA-88) of 15 steps. The twin predicts cycle time, PackML state and the PASS/FAIL branch.")}</p>
                <p className="font-mono text-[11px] text-foreground">ref: {WORKFLOW.ref} • {WORKFLOW.steps.length} steps</p>
                <p>{t("rfcell.openStudio", "Open /orchestration-studio to edit / deploy / run it for real (via the HITL dispatcher).")}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link href="/orchestration-studio">
                    <Button size="sm" variant="outline" className="h-7"><ExternalLink className="h-3.5 w-3.5 mr-1" /> {t("rfcell.linkStudio", "Orchestration Studio")}</Button>
                  </Link>
                  <Link href="/cell-twin">
                    <Button size="sm" variant="outline" className="h-7"><ExternalLink className="h-3.5 w-3.5 mr-1" /> {t("rfcell.linkCellTwin", "Cell Twin")}</Button>
                  </Link>
                  <Link href="/factory-live-map">
                    <Button size="sm" variant="outline" className="h-7"><ExternalLink className="h-3.5 w-3.5 mr-1" /> {t("rfcell.linkFactoryMap", "Factory Live Map")}</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── RF measurement trace (simulated) + per-DUT history ── */}
        {sims && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* RF measurement trace of the CURRENT DUT */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Waves className="h-4 w-4" /> {t("rfcell.rf.title", "RF measurement trace (simulated)")}
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">DUT-{String(view.cycle + 1).padStart(4, "0")}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[11px] text-muted-foreground">{t("rfcell.rf.note", "Deterministic twin measurements per DUT (seeded) — NOT live RF instrument data. Each metric is shown against its spec limit.")}</p>
                {resultKnown ? (
                  <>
                    <div className="space-y-2.5">
                      {measurement.map((m) => (
                        <RfMetricRow key={m.key} m={m} label={t(`rfcell.rf.${m.key}`, m.key)} />
                      ))}
                    </div>
                    {failingMetric ? (
                      <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                        {t("rfcell.rf.failExplain", "{{metric}} out of spec: {{value}} {{unit}} → FAIL", { metric: t(`rfcell.rf.${failingMetric.key}`, failingMetric.key), value: failingMetric.value, unit: failingMetric.unit })}
                      </div>
                    ) : (
                      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                        {t("rfcell.rf.passExplain", "All 4 RF metrics within spec → PASS")}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
                    <Waves className="h-6 w-6" />
                    <p className="text-xs">{t("rfcell.rf.measuring", "Measuring… TX power, frequency error, EVM, spectrum-mask margin.")}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Per-DUT result history + CSV export */}
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">{t("rfcell.history", "Test history (this session)")} <span className="text-muted-foreground font-normal">({history.length})</span></CardTitle>
                <Button size="sm" variant="outline" className="h-7" disabled={!history.length} onClick={exportCsv}>
                  <Download className="h-3.5 w-3.5 mr-1" /> {t("rfcell.exportCsv", "Export CSV")}
                </Button>
              </CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
                    <Activity className="h-6 w-6" />
                    <p className="max-w-xs text-xs">{t("rfcell.historyEmpty", "No DUTs tested yet. Press Play to run the cell — each completed DUT is logged here with its RF measurements.")}</p>
                  </div>
                ) : (
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background">
                        <tr className="text-left text-muted-foreground border-b">
                          <th className="py-1 pr-3">{t("rfcell.col.serial", "Serial")}</th>
                          <th className="py-1 pr-3">{t("rfcell.col.result", "Result")}</th>
                          {RF_METRICS.map((m) => (
                            <th key={m.key} className="py-1 pr-3 whitespace-nowrap">{t(`rfcell.rf.${m.key}`, m.key)}</th>
                          ))}
                          <th className="py-1 pr-3 whitespace-nowrap">{t("rfcell.col.time", "Time")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.slice().reverse().map((r) => (
                          <tr key={r.cycle} className="border-b border-border/40">
                            <td className="py-1 pr-3 font-mono whitespace-nowrap">{r.serial}</td>
                            <td className="py-1 pr-3">
                              <Badge variant="outline" className={r.variant === "PASS" ? "text-emerald-600 border-emerald-500/40" : "text-red-600 border-red-500/40"}>{r.variant}</Badge>
                            </td>
                            {r.metrics.map((m) => (
                              <td key={m.key} className={`py-1 pr-3 font-mono whitespace-nowrap ${m.pass ? "" : "text-red-600 font-semibold"}`}>{m.value}</td>
                            ))}
                            <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap">{new Date(r.ts).toLocaleTimeString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
    </PageContainer>
  );
}

export default function RfTestCellSim() {
  return (
    <DashboardLayout>
      <RfTestCellSimContent />
    </DashboardLayout>
  );
}

/** Định dạng chuỗi giới hạn spec cho một metric. */
function fmtSpec(m: RfMetric): string {
  if (m.low !== null && m.high !== null) return `${m.low}…${m.high} ${m.unit}`;
  if (m.high !== null) return `≤ ${m.high} ${m.unit}`;
  if (m.low !== null) return `≥ ${m.low} ${m.unit}`;
  return "—";
}

/** Một dòng metric RF: giá trị + badge PASS/FAIL + thanh đo vs dải spec. */
function RfMetricRow({ m, label }: { m: RfMetric; label: string }) {
  const span = m.dispHi - m.dispLo || 1;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - m.dispLo) / span) * 100));
  const bandLo = pct(m.low ?? m.dispLo);
  const bandHi = pct(m.high ?? m.dispHi);
  const markerPct = pct(m.value);
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between mb-0.5">
        <span className="font-medium">{label}</span>
        <span className="flex items-center gap-2">
          <span className={`font-mono font-semibold ${m.pass ? "text-emerald-600" : "text-red-600"}`}>{m.value} {m.unit}</span>
          <Badge variant="outline" className={m.pass ? "text-emerald-600 border-emerald-500/40" : "text-red-600 border-red-500/40"}>{m.pass ? "PASS" : "FAIL"}</Badge>
        </span>
      </div>
      <div className="relative h-2 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div className="absolute top-0 h-full bg-emerald-500/25" style={{ left: `${bandLo}%`, width: `${Math.max(0, bandHi - bandLo)}%` }} />
        <div className={`absolute -top-0.5 h-3 w-0.5 ${m.pass ? "bg-emerald-600" : "bg-red-600"}`} style={{ left: `${markerPct}%` }} />
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{fmtSpec(m)}</div>
    </div>
  );
}

function Kpi({ label, value, cls, icon }: { label: string; value: string; cls?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className={`text-lg font-semibold ${cls ?? ""}`}>{value}</div>
    </div>
  );
}
