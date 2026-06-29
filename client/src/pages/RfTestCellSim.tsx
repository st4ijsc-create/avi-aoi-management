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
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Play, Pause, RotateCcw, Radio, Bot, Cpu, CheckCircle2, XCircle, Activity, Info } from "lucide-react";

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
        { name: "feed_dut", label: "Cấp 1 DUT tới vị trí gắp", paramsSchema: [{ name: "slot", label: "Khay", dataType: "int" }], riskLevel: "high", requiredPermission: "machine_control/canCreate" },
      ],
    },
  },
  {
    id: ROBOT,
    machineType: "ROBOT",
    capabilities: {
      extraCommands: [
        { name: "transfer", label: "Gắp–thả giữa 2 vị trí", paramsSchema: [{ name: "from", label: "Từ", dataType: "string" }, { name: "to", label: "Đến", dataType: "string" }], riskLevel: "high", requiredPermission: "machine_control/canCreate" },
      ],
    },
  },
  { id: RF, machineType: "FCT", capabilities: { emitsProcessResult: true, cycleTimeTracked: true } },
];

const COMMAND_DURATIONS = { start: 800, stop: 800, feed_dut: 1600, transfer: 1300, select_recipe: 400 };

/** The control PROGRAM — one DUT cycle (the line repeats it). */
const WORKFLOW = {
  ref: "RF-TEST-CELL-CYCLE",
  name: "Chu kỳ test cách sóng 1 DUT",
  steps: [
    { id: "feeder_start", type: "command", machineId: FEEDER, command: "start", label: "Cấp liệu XYZ: khởi động" },
    { id: "feed", type: "command", machineId: FEEDER, command: "feed_dut", args: { slot: 1 }, label: "Gantry XYZ đưa DUT tới vị trí gắp" },
    { id: "xyz_travel", type: "delay", ms: 1200, label: "Trục XYZ định vị" },
    { id: "wait_dut", type: "wait_telemetry", condition: { source: "telemetry", machineId: FEEDER, key: "dut_ready", op: "eq", value: 1 }, timeoutMs: 5000, label: "Interlock: chỉ gắp khi có DUT" },
    { id: "robot_start", type: "command", machineId: ROBOT, command: "start", label: "Robot vào chế độ chạy" },
    { id: "pick_to_rf", type: "command", machineId: ROBOT, command: "transfer", args: { from: "PICK", to: "RF_CHAMBER" }, label: "Robot gắp DUT → buồng cách sóng" },
    { id: "load_settle", type: "delay", ms: 800, label: "Đặt DUT vào jig RF" },
    { id: "rf_recipe", type: "command", machineId: RF, command: "select_recipe", args: { recipeCode: "WIFI6_BT_TX" }, label: "Nạp bài đo RF (WiFi6/BT TX)" },
    { id: "rf_start", type: "command", machineId: RF, command: "start", label: "Đóng buồng + chạy đo phát xạ" },
    { id: "rf_measure", type: "delay", ms: 3000, label: "Đo: công suất TX, tần số, EVM, phổ" },
    { id: "wait_result", type: "wait_telemetry", condition: { source: "telemetry", machineId: RF, key: "test_done", op: "eq", value: 1 }, timeoutMs: 10000, label: "Chờ kết quả đo" },
    {
      id: "sort", type: "branch",
      condition: { source: "telemetry", machineId: RF, key: "process_result", op: "eq", value: "PASS" },
      then: [{ id: "place_ok", type: "command", machineId: ROBOT, command: "transfer", args: { from: "RF_CHAMBER", to: "CARTON_OK" }, label: "Xếp DUT ĐẠT vào hộp các-tông" }],
      else: [{ id: "place_ng", type: "command", machineId: ROBOT, command: "transfer", args: { from: "RF_CHAMBER", to: "REJECT_BIN" }, label: "Loại DUT LỖI vào khay NG" }],
      label: "Phân loại theo kết quả RF",
    },
    { id: "place_settle", type: "delay", ms: 900, label: "Robot đặt + về home" },
    { id: "rf_stop", type: "command", machineId: RF, command: "stop", label: "Mở buồng, kết thúc đo" },
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
const DEFECT_EVERY = 8; // 1 NG every 8 DUTs (~12.5% NG → ~87.5% yield)

export default function RfTestCellSim() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();

  const [sims, setSims] = useState<{ pass: Sim; fail: Sim } | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState({ t: 0, cycle: 0, variant: "PASS" as "PASS" | "FAIL", ok: 0, ng: 0, carton: 0, cartonsDone: 0 });

  // Refs the rAF loop reads/writes without re-rendering.
  const simsRef = useRef(sims); simsRef.current = sims;
  const runningRef = useRef(running); runningRef.current = running;
  const speedRef = useRef(speed); speedRef.current = speed;
  const stateRef = useRef({ t: 0, cycle: 0, variant: "PASS" as "PASS" | "FAIL", ok: 0, ng: 0, carton: 0, cartonsDone: 0 });
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  const pickVariant = (idx: number): "PASS" | "FAIL" => (idx % DEFECT_EVERY === DEFECT_EVERY - 1 ? "FAIL" : "PASS");

  // Fetch the two predicted timelines (PASS / FAIL) from the pure twin.
  useEffect(() => {
    let alive = true;
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
        toast.error(t("rfcell.simFailed", "Không tải được mô phỏng twin"));
        // eslint-disable-next-line no-console
        console.error(err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [utils, t]);

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
        // finalize the cycle
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
    setView({ t: 0, cycle: 0, variant: "PASS", ok: 0, ng: 0, carton: 0, cartonsDone: 0 });
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

  return (
    <DashboardLayout>
      <div className="space-y-4 p-1">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Radio className="h-5 w-5 text-primary" /> {t("rfcell.title", "Trạm test cách sóng — Mô phỏng realtime")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("rfcell.subtitle", "FX5U cấp liệu XYZ • Robot gắp–thả • Buồng đo RF — bản sao số chạy theo thời gian thực")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={loading || !sims} onClick={() => setRunning((r) => !r)}>
              {running ? <><Pause className="h-4 w-4 mr-1" /> {t("rfcell.pause", "Tạm dừng")}</> : <><Play className="h-4 w-4 mr-1" /> {t("rfcell.play", "Chạy")}</>}
            </Button>
            <Button size="sm" variant="outline" onClick={reset}><RotateCcw className="h-4 w-4 mr-1" /> {t("rfcell.reset", "Đặt lại")}</Button>
            <div className="flex items-center gap-1">
              <Label className="text-xs text-muted-foreground">{t("rfcell.speed", "Tốc độ")}</Label>
              {SPEEDS.map((s) => (
                <Button key={s} size="sm" variant={speed === s ? "default" : "outline"} className="px-2 h-7" onClick={() => setSpeed(s)}>{s}×</Button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t("rfcell.twinNote", "Đây là MÔ PHỎNG trên bản sao số (digital twin) — không phát lệnh xuống thiết bị. Khi chạy thật: mọi lệnh đi qua dispatcher HITL; an toàn (E-stop/interlock/chuyển động) nằm trên PLC FX5U.")}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── 2D cell scene ── */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> {t("rfcell.cellView", "Sơ đồ trạm (nhìn từ trên)")}</CardTitle></CardHeader>
            <CardContent>
              <svg viewBox="0 0 840 420" className="w-full rounded-md bg-slate-50 dark:bg-slate-900 border">
                {/* feeder rail + tray */}
                <rect x="55" y="135" width="255" height="8" rx="4" className="fill-slate-300 dark:fill-slate-700" />
                <rect x="60" y="120" width="70" height="60" rx="4" className="fill-slate-200 dark:fill-slate-800 stroke-slate-400" />
                <text x="95" y="200" textAnchor="middle" className="fill-slate-500 text-[11px]">Khay DUT</text>
                {/* gantry carriage */}
                {(() => {
                  const gx = token?.carrier === "gantry" ? token.x : PT.PICK.x;
                  return <g><rect x={gx - 14} y={108} width="28" height="20" rx="3" className="fill-sky-500" /><line x1={gx} y1={128} x2={gx} y2={143} className="stroke-sky-600" strokeWidth={3} /></g>;
                })()}
                <text x={PT.PICK.x} y={108} textAnchor="middle" className="fill-slate-500 text-[10px]">XYZ (FX5U)</text>
                <circle cx={PT.PICK.x} cy={PT.PICK.y} r={6} className="fill-slate-400" />
                <text x={PT.PICK.x} y={172} textAnchor="middle" className="fill-slate-500 text-[10px]">Vị trí gắp</text>

                {/* robot */}
                <circle cx={PT.ROBOT.x} cy={PT.ROBOT.y} r={26} className="fill-slate-200 dark:fill-slate-800 stroke-slate-400" />
                <circle cx={PT.ROBOT.x} cy={PT.ROBOT.y} r={8} className="fill-indigo-500" />
                <text x={PT.ROBOT.x} y={PT.ROBOT.y + 44} textAnchor="middle" className="fill-slate-500 text-[10px]">Robot</text>
                {token?.carrier === "robot" && <line x1={PT.ROBOT.x} y1={PT.ROBOT.y} x2={token.x} y2={token.y} className="stroke-indigo-500" strokeWidth={4} strokeLinecap="round" />}

                {/* RF chamber */}
                <rect x={PT.CHAMBER.x - 55} y={PT.CHAMBER.y - 50} width="110" height="100" rx="6"
                  className={rfTesting ? "fill-emerald-100 dark:fill-emerald-900/40 stroke-emerald-500" : "fill-slate-200 dark:fill-slate-800 stroke-slate-400"} strokeWidth={2} />
                {rfTesting && [18, 30, 42].map((r, i) => (
                  <circle key={r} cx={PT.CHAMBER.x} cy={PT.CHAMBER.y} r={r} fill="none" className="stroke-emerald-500" strokeWidth={1.5} opacity={0.7 - i * 0.2}>
                    <animate attributeName="r" values={`${r};${r + 10};${r}`} dur="1.2s" repeatCount="indefinite" />
                  </circle>
                ))}
                <text x={PT.CHAMBER.x} y={PT.CHAMBER.y - 58} textAnchor="middle" className="fill-slate-500 text-[10px]">Buồng cách sóng (RF)</text>
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
                <text x={PT.CARTON.x} y={PT.CARTON.y + 46} textAnchor="middle" className="fill-slate-500 text-[10px]">Hộp các-tông ĐẠT ({view.carton}/{CARTON_SIZE})</text>

                {/* reject bin */}
                <rect x={PT.REJECT.x - 28} y={PT.REJECT.y - 22} width="56" height="40" rx="4" className="fill-red-50 dark:fill-red-950/30 stroke-red-400" strokeWidth={2} />
                <text x={PT.REJECT.x} y={PT.REJECT.y + 4} textAnchor="middle" className="fill-red-600 text-[12px] font-semibold">{view.ng}</text>
                <text x={PT.REJECT.x} y={PT.REJECT.y + 34} textAnchor="middle" className="fill-slate-500 text-[10px]">Khay NG</text>

                {/* the DUT token */}
                {token?.visible && (
                  <rect x={token.x - 8} y={token.y - 8} width="16" height="16" rx="2"
                    className={view.variant === "FAIL" && resultKnown ? "fill-red-500 stroke-red-700" : "fill-emerald-500 stroke-emerald-700"} strokeWidth={1.5} />
                )}
              </svg>

              {/* timeline / playhead */}
              {sim && (
                <div className="mt-3">
                  <div className="text-[11px] text-muted-foreground mb-1">{t("rfcell.timeline", "Tiến trình chu kỳ")} — {labelOf(act?.stepId)}</div>
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
            </CardContent>
          </Card>

          {/* ── live status + KPIs ── */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{t("rfcell.machines", "Trạng thái máy (PackML)")}</CardTitle></CardHeader>
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
              <CardHeader className="pb-2"><CardTitle className="text-sm">{t("rfcell.kpis", "Sản lượng & năng suất")}</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <Kpi label={t("rfcell.cycleNo", "Chu kỳ")} value={String(view.cycle)} />
                <Kpi label={t("rfcell.cycleTime", "Nhịp/DUT")} value={`${cycleSec.toFixed(1)}s`} />
                <Kpi label="OK" value={String(view.ok)} cls="text-emerald-600" icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
                <Kpi label="NG" value={String(view.ng)} cls="text-red-600" icon={<XCircle className="h-3.5 w-3.5" />} />
                <Kpi label={t("rfcell.yield", "Yield")} value={`${yieldPct}%`} />
                <Kpi label={t("rfcell.uph", "Năng suất")} value={`${uph} UPH`} />
                <Kpi label={t("rfcell.cartonsDone", "Hộp đã đóng")} value={String(view.cartonsDone)} />
                <Kpi label={t("rfcell.inCarton", "Trong hộp")} value={`${view.carton}/${CARTON_SIZE}`} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{t("rfcell.program", "Chương trình điều khiển")}</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <p>{t("rfcell.programNote", "Một chu kỳ = WorkflowDefinition (FOE/ISA-88) gồm 15 bước. Twin dự đoán nhịp, trạng thái PackML và nhánh PASS/FAIL.")}</p>
                <p className="font-mono text-[11px] text-foreground">ref: {WORKFLOW.ref} • {WORKFLOW.steps.length} steps</p>
                <p>{t("rfcell.openStudio", "Mở /orchestration-studio để sửa/triển khai/chạy thật (qua dispatcher HITL).")}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
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
