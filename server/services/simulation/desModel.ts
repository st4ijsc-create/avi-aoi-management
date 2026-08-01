/**
 * doc 24 Wave-4 · T5 — DES MODEL BUILDER + SCENARIO/WHAT-IF + SCHEDULING FEEDBACK.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Turns REAL topology + routings into a `LineModel` the pure desEngine can run, then
 * layers scenario what-if (add a station / change a rate / change yield / add capacity)
 * and a SCHEDULING ADVISORY (predicted bottleneck + effective capacity/hour) that the
 * production-scheduling layer can consume as an INPUT — it NEVER mutates a schedule.
 *
 * Two model sources (both pure — the caller supplies already-loaded data):
 *   1) TOPOLOGY  — a line's ordered stations from the twin sceneGraph (LineNode). Each
 *      station's resource capacity defaults to its device count; per-station rate/yield
 *      come from an override table (config or historicals) with safe defaults.
 *   2) ROUTING   — an FOE WorkflowDefinition reused as a process routing: the ordered
 *      machines it drives become stations; per-machine command durations sum to a rate.
 *
 * PURE + DEGRADE-SAFE: no DB, no network. Missing params fall back to documented
 * defaults (reported in the model's notes / the engine's `notes`).
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  runDes,
  type LineModel,
  type StationSpec,
  type SourceSpec,
  type DesResult,
  type SimConfig,
  type ProcessDist,
} from "./desEngine";
import type { LineNode } from "../twin/sceneGraph";
import type { WorkflowDefinition, WorkflowStep } from "../orchestration/foe/workflowModel";

// ── Per-station parameters (config or estimated from historicals) ────────────────────

/** Rate/yield parameters for ONE station, keyed by station code or id. */
export interface StationParam {
  /** Mean processing time per part, seconds. */
  processTimeSec?: number;
  /** Override resource capacity (else the topology device-count is used). */
  capacity?: number;
  /** Good-part probability (0..1). */
  yield?: number;
  processDist?: ProcessDist;
  processCV?: number;
  onFail?: "scrap" | "rework";
  maxRework?: number;
  bufferCapacity?: number;
}

/** Documented safe defaults applied when a station has no param. */
export const DEFAULT_STATION_PARAM: Required<
  Pick<StationParam, "processTimeSec" | "yield" | "processDist" | "processCV">
> = {
  processTimeSec: 30,
  yield: 1,
  processDist: "deterministic",
  processCV: 0,
};

/** Options shared by the model builders. */
export interface BuildModelOptions {
  /** Param table keyed by station code OR id (code wins, then id). */
  params?: Record<string, StationParam>;
  /** How parts enter the line (default: a 500-part batch → measures line capacity). */
  source?: SourceSpec;
  /** Explicit station ordering (array of station code/id). Else topology order. */
  stationOrder?: string[];
  /** Default buffer capacity between stations (Infinity → no blocking). */
  defaultBufferCapacity?: number;
}

const DEFAULT_SOURCE: SourceSpec = { kind: "batch", count: 500 };

function resolveParam(
  params: Record<string, StationParam> | undefined,
  code: string | undefined,
  id: string,
): StationParam {
  if (!params) return {};
  if (code && params[code]) return params[code];
  if (params[id]) return params[id];
  return {};
}

// ── 1) Build from TOPOLOGY (twin sceneGraph LineNode) ────────────────────────────────

/**
 * Build a `LineModel` from a twin `LineNode`: its stations (in order) become the
 * process routing; each station's resource capacity defaults to its device count
 * (≥ 1). Per-station rate/yield come from `opts.params` (keyed by station code or id)
 * with documented defaults. Degrade-safe: a line with no stations yields an empty
 * model the engine reports as degraded.
 */
export function buildLineModelFromScene(line: LineNode, opts: BuildModelOptions = {}): LineModel {
  const byKey = new Map(line.stations.map((s) => [s.code ?? s.id, s] as const));
  const byId = new Map(line.stations.map((s) => [s.id, s] as const));
  const ordered = opts.stationOrder
    ? opts.stationOrder
        .map((k) => byKey.get(k) ?? byId.get(k))
        .filter((s): s is LineNode["stations"][number] => s != null)
    : line.stations;

  const stations: StationSpec[] = ordered.map((s) => {
    const p = resolveParam(opts.params, s.code, s.id);
    const deviceCap = Array.isArray(s.devices) ? s.devices.length : 0;
    return {
      id: s.id,
      name: s.name || s.code || s.id,
      capacity: p.capacity ?? (deviceCap > 0 ? deviceCap : 1),
      processTimeSec: p.processTimeSec ?? DEFAULT_STATION_PARAM.processTimeSec,
      processDist: p.processDist ?? DEFAULT_STATION_PARAM.processDist,
      processCV: p.processCV ?? DEFAULT_STATION_PARAM.processCV,
      yield: p.yield ?? DEFAULT_STATION_PARAM.yield,
      onFail: p.onFail,
      maxRework: p.maxRework,
      bufferCapacity: p.bufferCapacity ?? opts.defaultBufferCapacity,
    };
  });

  return { id: line.id, name: line.name, stations, source: opts.source ?? DEFAULT_SOURCE };
}

// ── 2) Build from ROUTING (FOE WorkflowDefinition) ───────────────────────────────────

/** Flatten a workflow's steps depth-first (into then/else/parallel/sequence children). */
function flattenSteps(steps: WorkflowStep[], out: WorkflowStep[] = []): WorkflowStep[] {
  for (const s of steps) {
    out.push(s);
    const anyStep = s as unknown as {
      steps?: WorkflowStep[];
      then?: WorkflowStep[];
      else?: WorkflowStep[];
    };
    if (Array.isArray(anyStep.steps)) flattenSteps(anyStep.steps, out);
    if (Array.isArray(anyStep.then)) flattenSteps(anyStep.then, out);
    if (Array.isArray(anyStep.else)) flattenSteps(anyStep.else, out);
  }
  return out;
}

/**
 * Reuse an FOE `WorkflowDefinition` as a PROCESS ROUTING: the ordered machines it
 * drives become stations (in first-appearance order); each machine's station process
 * time = the SUM of its command durations (+ any delay steps that immediately follow
 * on that machine). Per-station yield/capacity come from `opts.params` keyed by the
 * machine id string. Steps without a machine (pure delays/gates) fold into the most
 * recent machine's time. Degrade-safe: a routing with no command steps → empty model.
 */
export function buildLineModelFromRouting(
  def: WorkflowDefinition,
  commandDurationsSec: Record<string, number> = {},
  defaultCommandSec = 2,
  opts: BuildModelOptions = {},
): LineModel {
  const flat = flattenSteps(def.steps ?? []);
  const order: number[] = [];
  const timeByMachine = new Map<number, number>();
  const nameByMachine = new Map<number, string>();
  let lastMachine: number | null = null;

  for (const s of flat) {
    const anyS = s as unknown as { machineId?: number; command?: string; ms?: number; label?: string; type: string };
    if (s.type === "command" && typeof anyS.machineId === "number") {
      const mid = anyS.machineId;
      if (!timeByMachine.has(mid)) {
        order.push(mid);
        timeByMachine.set(mid, 0);
        nameByMachine.set(mid, anyS.label || `machine ${mid}`);
      }
      const dur = anyS.command != null && commandDurationsSec[anyS.command] != null
        ? commandDurationsSec[anyS.command]
        : defaultCommandSec;
      timeByMachine.set(mid, (timeByMachine.get(mid) ?? 0) + dur);
      lastMachine = mid;
    } else if (s.type === "delay" && typeof anyS.ms === "number" && lastMachine != null) {
      // Fold a delay into the most-recent machine's station time.
      timeByMachine.set(lastMachine, (timeByMachine.get(lastMachine) ?? 0) + anyS.ms / 1000);
    }
  }

  const stations: StationSpec[] = order.map((mid) => {
    const id = `machine:${mid}`;
    const p = resolveParam(opts.params, String(mid), id);
    return {
      id,
      name: nameByMachine.get(mid) ?? id,
      capacity: p.capacity ?? 1,
      processTimeSec: p.processTimeSec ?? Math.max(0.001, timeByMachine.get(mid) ?? defaultCommandSec),
      processDist: p.processDist ?? DEFAULT_STATION_PARAM.processDist,
      processCV: p.processCV ?? DEFAULT_STATION_PARAM.processCV,
      yield: p.yield ?? DEFAULT_STATION_PARAM.yield,
      onFail: p.onFail,
      maxRework: p.maxRework,
      bufferCapacity: p.bufferCapacity ?? opts.defaultBufferCapacity,
    };
  });

  return { id: def.ref, name: def.name, stations, source: opts.source ?? DEFAULT_SOURCE };
}

// ── Scenario / what-if ───────────────────────────────────────────────────────────────

/** One scenario mutation applied to a base model (additive; never mutates in place). */
export type ScenarioOp =
  | { op: "setProcessTime"; stationId: string; processTimeSec: number }
  | { op: "setCapacity"; stationId: string; capacity: number }
  | { op: "addCapacity"; stationId: string; delta: number }
  | { op: "setYield"; stationId: string; yield: number }
  | { op: "addStation"; afterStationId?: string | null; station: StationSpec }
  | { op: "removeStation"; stationId: string }
  | { op: "setSource"; source: SourceSpec };

/** Apply a list of scenario ops to a model, returning a NEW model (deep-copied stations). */
export function applyScenario(model: LineModel, ops: ScenarioOp[]): LineModel {
  let stations: StationSpec[] = model.stations.map((s) => ({ ...s }));
  let source: SourceSpec = model.source;
  for (const op of ops) {
    switch (op.op) {
      case "setProcessTime":
        stations = stations.map((s) => (s.id === op.stationId ? { ...s, processTimeSec: op.processTimeSec } : s));
        break;
      case "setCapacity":
        stations = stations.map((s) => (s.id === op.stationId ? { ...s, capacity: op.capacity } : s));
        break;
      case "addCapacity":
        stations = stations.map((s) =>
          s.id === op.stationId ? { ...s, capacity: Math.max(1, (s.capacity || 1) + op.delta) } : s,
        );
        break;
      case "setYield":
        stations = stations.map((s) => (s.id === op.stationId ? { ...s, yield: op.yield } : s));
        break;
      case "addStation": {
        const idx =
          op.afterStationId == null ? stations.length - 1 : stations.findIndex((s) => s.id === op.afterStationId);
        const at = idx < 0 ? stations.length : idx + 1;
        stations = [...stations.slice(0, at), { ...op.station }, ...stations.slice(at)];
        break;
      }
      case "removeStation":
        stations = stations.filter((s) => s.id !== op.stationId);
        break;
      case "setSource":
        source = op.source;
        break;
    }
  }
  return { ...model, stations, source };
}

/** KPI deltas between a baseline and a scenario run. */
export interface ScenarioComparison {
  base: DesResult;
  scenario: DesResult;
  deltas: {
    throughputPerHour: number;
    throughputPct: number; // (scenario/base − 1)·100, 0 when base is 0
    goodCompleted: number;
    wipAvg: number;
    cycleP95Sec: number;
    bottleneckChanged: boolean;
    fromBottleneck: string | null;
    toBottleneck: string | null;
  };
  summary: string;
}

/** Run a baseline vs a scenario and report KPI deltas. PURE + deterministic (same seed). */
export function runScenarioComparison(
  model: LineModel,
  ops: ScenarioOp[],
  config: SimConfig = {},
): ScenarioComparison {
  const base = runDes(model, config);
  const scenarioModel = applyScenario(model, ops);
  const scenario = runDes(scenarioModel, config);

  const tpDelta = scenario.throughputPerHour - base.throughputPerHour;
  const tpPct = base.throughputPerHour > 0 ? (tpDelta / base.throughputPerHour) * 100 : 0;
  const bottleneckChanged = base.bottleneckStationId !== scenario.bottleneckStationId;

  const summary =
    `Throughput ${base.throughputPerHour.toFixed(1)} → ${scenario.throughputPerHour.toFixed(1)} /h ` +
    `(${tpPct >= 0 ? "+" : ""}${tpPct.toFixed(1)}%). ` +
    (bottleneckChanged
      ? `Bottleneck moved ${base.bottleneckStationId ?? "—"} → ${scenario.bottleneckStationId ?? "—"}.`
      : `Bottleneck stays ${scenario.bottleneckStationId ?? "—"}.`);

  return {
    base,
    scenario,
    deltas: {
      throughputPerHour: tpDelta,
      throughputPct: tpPct,
      goodCompleted: scenario.goodCompleted - base.goodCompleted,
      wipAvg: scenario.wipAvg - base.wipAvg,
      cycleP95Sec: scenario.cycleTime.p95Sec - base.cycleTime.p95Sec,
      bottleneckChanged,
      fromBottleneck: base.bottleneckStationId,
      toBottleneck: scenario.bottleneckStationId,
    },
    summary,
  };
}

// ── Scheduling feedback (ADVISORY ONLY — surfaces, never mutates a schedule) ──────────

/**
 * The advisory a DES run feeds back to production scheduling. It is an INPUT the planner
 * SEES — the scheduling service does NOT auto-apply it. `predictedCapacityPerHour` maps
 * onto the scheduler's per-line `capacityPerHour` so a planner can compare the configured
 * capacity against the sim-predicted effective capacity (which accounts for the bottleneck,
 * queueing and yield).
 */
export interface ThroughputAdvisory {
  lineId?: number;
  /** Good units/hour the sim predicts the line can sustain. */
  predictedGoodThroughputPerHour: number;
  /** Same figure framed as the scheduler's `capacityPerHour` input. */
  predictedCapacityPerHour: number;
  bottleneckStationId: string | null;
  bottleneckEffServiceSec: number | null;
  /** Mean and p95 flow time (seconds) of completed good parts. */
  predictedCycleTimeSec: number;
  predictedCycleP95Sec: number;
  wipAvg: number;
  degraded: boolean;
  advisoryNote: string;
}

/** Distil a DES result into a scheduling advisory. PURE. */
export function buildThroughputAdvisory(result: DesResult, lineId?: number): ThroughputAdvisory {
  const perHour = Math.round(result.throughputPerHour * 10) / 10;
  const note = result.ok
    ? `Sim predicts ~${perHour} good units/h; bottleneck ${result.bottleneckStationId ?? "—"} ` +
      `(eff. ${result.bottleneckEffServiceSec != null ? result.bottleneckEffServiceSec.toFixed(1) : "—"}s/part). ` +
      `Advisory only — schedule is unchanged.`
    : "Sim degraded — no reliable throughput prediction; schedule unchanged.";
  return {
    lineId,
    predictedGoodThroughputPerHour: perHour,
    predictedCapacityPerHour: perHour,
    bottleneckStationId: result.bottleneckStationId,
    bottleneckEffServiceSec: result.bottleneckEffServiceSec,
    predictedCycleTimeSec: Math.round(result.cycleTime.meanSec * 10) / 10,
    predictedCycleP95Sec: Math.round(result.cycleTime.p95Sec * 10) / 10,
    wipAvg: Math.round(result.wipAvg * 100) / 100,
    degraded: result.degraded,
    advisoryNote: note,
  };
}

/**
 * Reconcile a sim throughput advisory against the schedule's CONFIGURED capacity/hour
 * for a line. Returns a delta + a recommendation STRING — it does NOT change any schedule
 * (the caller surfaces this next to the configured value). PURE.
 */
export interface CapacityReconciliation {
  configuredPerHour: number | null;
  predictedPerHour: number;
  deltaPerHour: number | null;
  deltaPct: number | null;
  recommendation: string;
}

export function reconcileCapacityAdvisory(
  configuredPerHour: number | null,
  advisory: ThroughputAdvisory,
): CapacityReconciliation {
  const predicted = advisory.predictedCapacityPerHour;
  if (configuredPerHour == null || !Number.isFinite(configuredPerHour) || configuredPerHour <= 0) {
    return {
      configuredPerHour,
      predictedPerHour: predicted,
      deltaPerHour: null,
      deltaPct: null,
      recommendation:
        `No configured capacity for this line — the sim predicts ~${predicted} good units/h ` +
        `(bottleneck ${advisory.bottleneckStationId ?? "—"}). Consider seeding capacityPerHour from this.`,
    };
  }
  const delta = predicted - configuredPerHour;
  const pct = (delta / configuredPerHour) * 100;
  let rec: string;
  if (Math.abs(pct) < 5) {
    rec = `Configured ${configuredPerHour}/h ≈ sim ${predicted}/h — capacity assumption looks sound.`;
  } else if (delta < 0) {
    rec =
      `Sim predicts only ${predicted}/h vs configured ${configuredPerHour}/h (${pct.toFixed(0)}%). ` +
      `The ${advisory.bottleneckStationId ?? "bottleneck"} station likely caps real output — schedules built on the ` +
      `configured value may run late. Review (advisory only).`;
  } else {
    rec =
      `Sim predicts ${predicted}/h vs configured ${configuredPerHour}/h (+${pct.toFixed(0)}%). ` +
      `There may be headroom above the configured capacity. Review (advisory only).`;
  }
  return { configuredPerHour, predictedPerHour: predicted, deltaPerHour: delta, deltaPct: pct, recommendation: rec };
}
