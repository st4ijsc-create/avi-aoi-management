/**
 * APS Solver — G2.5a (Phương án A: spawn Python CP-SAT, heuristic fallback).
 *
 * SAFETY CONTRACT:
 *  - This module ONLY produces DRAFT schedule proposals. It NEVER writes machine
 *    tags or control commands and MUST NOT import commandDispatcher / writeTags.
 *  - The Python sidecar is spawned with shell:false + windowsHide + an args array
 *    (no shell interpolation → no command injection), an absolute .venv python
 *    path, and a SIGKILL timeout. Any failure (ortools missing, script error,
 *    timeout, malformed JSON, infeasible) resolves to `null` — never throws — so
 *    the caller can fall back to the heuristic scheduler.
 *  - APS is OFF by default (APS_SOLVER_ENABLED !== "true").
 */

import { spawn } from "child_process";
import path from "path";
import type { SchedulableOrder } from "./productionSchedulingService";

// ─── Configuration ─────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TIME_SEC = 20;
const DEFAULT_SETUP_MIN = 15;
const DEFAULT_MAX_JOBS = 200;

/** APS is opt-in. Default OFF → heuristic scheduler only. */
export function isApsEnabled(): boolean {
  return (process.env.APS_SOLVER_ENABLED ?? "").trim() === "true";
}

function apsTimeoutMs(): number {
  const raw = Number(process.env.APS_SOLVER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function apsMaxTimeSec(): number {
  const raw = Number(process.env.APS_SOLVER_MAX_TIME_SEC);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_TIME_SEC;
}

export function apsDefaultSetupMin(): number {
  const raw = Number(process.env.APS_DEFAULT_SETUP_MIN);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_SETUP_MIN;
}

export function apsMaxJobs(): number {
  const raw = Number(process.env.APS_MAX_JOBS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_JOBS;
}

function apsWeights(): { lateness: number; makespan: number; setup: number } {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  return {
    lateness: num(process.env.APS_W_LATENESS, 4),
    makespan: num(process.env.APS_W_MAKESPAN, 1),
    setup: num(process.env.APS_W_SETUP, 1),
  };
}

/**
 * Resolve { cmd, args } for the Python sidecar. Operators can fully override the
 * command via APS_SOLVER_CMD (whitespace-split, the script path appended). The
 * default uses the project's .venv python + scripts/aps_solver.py.
 */
export function resolveApsCommand(): { cmd: string; args: string[] } {
  const scriptPath = path.join(process.cwd(), "scripts", "aps_solver.py");
  const override = (process.env.APS_SOLVER_CMD ?? "").trim();
  if (override) {
    const parts = override.split(/\s+/).filter(Boolean);
    const [cmd, ...rest] = parts;
    return { cmd: cmd!, args: [...rest, scriptPath] };
  }
  const py = process.platform === "win32"
    ? path.join(process.cwd(), ".venv", "Scripts", "python.exe")
    : path.join(process.cwd(), ".venv", "bin", "python");
  return { cmd: py, args: [scriptPath] };
}

// ─── Model types ───────────────────────────────────────────────

/** One operation (process step) of an order, placed on a station. */
export interface ApsOp {
  stationId: number | null;
  orderIndex: number;
  durationMin: number;
}

export interface ApsModelOrder {
  id: number;
  lineId: number;
  productModelId: number | null;
  releaseMin: number;
  dueMin: number | null;
  dependencies: number[];
  ops: ApsOp[];
}

export interface ApsModel {
  scheduleEpoch: number; // ms epoch that minute 0 maps to
  horizonMin: number;
  changeoverMin: number;
  weights: { lateness: number; makespan: number; setup: number };
  maxTimeSec: number;
  orders: ApsModelOrder[];
}

/** Per-line process assignment used to build the op chain. */
export interface ApsLineAssignment {
  lineId: number;
  orderIndex: number;
  stationId: number | null;
  cycleTimeTargetSec: number | null; // seconds per unit
}

export interface ApsCapacityRow {
  lineId: number;
  stationId: number | null;
  machineId: number | null;
  parallelCapacity: number;
  changeoverDefaultMin: number;
}

export interface BuildApsModelInput {
  orders: SchedulableOrder[];
  /** Per-line ordered process assignments. */
  assignmentsByLine: Record<number, ApsLineAssignment[]>;
  capacity: ApsCapacityRow[];
  /** productModelId per order id (for changeover detection). */
  productModelByOrder?: Record<number, number | null>;
  /** Override default changeover; else max of capacity rows / env default. */
  changeoverMin?: number;
}

// ─── Pure model builder ────────────────────────────────────────

/**
 * Build the CP-SAT model from orders + per-line process assignments + capacity.
 * All durations are integer minutes computed from cycleTime(sec/unit) × quantity.
 * The horizon is a generous upper bound (sum of all op durations + release span
 * + changeover allowance) so the solver always has feasible space.
 */
export function buildApsModel(input: BuildApsModelInput): ApsModel {
  const { orders, assignmentsByLine, capacity } = input;

  // Common epoch: earliest of now and any scheduled start.
  const now = Date.now();
  const startCandidates = orders
    .map((o) => o.scheduledStartDate?.getTime())
    .filter((t): t is number => typeof t === "number");
  const scheduleEpoch = startCandidates.length > 0
    ? Math.min(now, ...startCandidates)
    : now;

  const minutesFrom = (d: Date | null | undefined): number | null =>
    d ? Math.max(0, Math.round((d.getTime() - scheduleEpoch) / 60_000)) : null;

  // Changeover: explicit override → max capacity changeover → env default.
  const capChangeover = capacity.reduce((m, c) => Math.max(m, c.changeoverDefaultMin || 0), 0);
  const changeoverMin = input.changeoverMin != null
    ? input.changeoverMin
    : (capChangeover > 0 ? capChangeover : apsDefaultSetupMin());

  const productModelByOrder = input.productModelByOrder ?? {};

  const modelOrders: ApsModelOrder[] = [];
  let totalDuration = 0;
  let maxRelease = 0;

  for (const order of orders) {
    if (order.status === "completed" || order.status === "cancelled") continue;
    const assignments = (assignmentsByLine[order.lineId] ?? [])
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex);

    const releaseMin = minutesFrom(order.scheduledStartDate) ?? 0;
    maxRelease = Math.max(maxRelease, releaseMin);

    let ops: ApsOp[];
    if (assignments.length > 0) {
      ops = assignments.map((a) => {
        const cycleSec = a.cycleTimeTargetSec ?? 0;
        // duration(min) = ceil(cycleSec * qty / 60); at least 1 min if it has work.
        const durMin = cycleSec > 0
          ? Math.max(1, Math.ceil((cycleSec * order.targetQuantity) / 60))
          : Math.max(1, Math.ceil(order.targetQuantity / 100));
        return { stationId: a.stationId, orderIndex: a.orderIndex, durationMin: durMin };
      });
    } else {
      // No process map: single op on a synthetic line-level station.
      const estHours = order.estimatedHours
        ?? Math.max(1, Math.ceil(order.targetQuantity / 100));
      ops = [{
        stationId: -order.lineId, // synthetic, stable per-line station id
        orderIndex: 0,
        durationMin: Math.max(1, Math.round(estHours * 60)),
      }];
    }

    for (const op of ops) totalDuration += op.durationMin;

    modelOrders.push({
      id: order.id,
      lineId: order.lineId,
      productModelId: productModelByOrder[order.id] ?? null,
      releaseMin,
      dueMin: minutesFrom(order.dueDate),
      dependencies: Array.isArray(order.dependencies) ? order.dependencies : [],
      ops,
    });
  }

  // Horizon: enough room for a fully serialized schedule plus changeovers.
  const opCount = modelOrders.reduce((n, o) => n + o.ops.length, 0);
  const horizonMin = Math.max(
    60,
    maxRelease + totalDuration + changeoverMin * opCount,
  );

  return {
    scheduleEpoch,
    horizonMin,
    changeoverMin,
    weights: apsWeights(),
    maxTimeSec: apsMaxTimeSec(),
    orders: modelOrders,
  };
}

// ─── Spawn the Python sidecar ──────────────────────────────────

export interface ApsRawResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "ERROR";
  solverMode: "cpsat";
  items: Array<{
    productionOrderId: number;
    lineId: number | null;
    stationId: number | null;
    productModelId: number | null;
    suggestedStartMin: number;
    suggestedEndMin: number;
    setupMinutes: number;
    sequenceIndex: number;
  }>;
  objective: {
    makespanMin?: number;
    totalTardinessMin?: number;
    totalSetupMin?: number;
  };
  wallMs?: number;
  message?: string;
}

/**
 * Spawn the CP-SAT sidecar, feed the model on stdin, collect stdout JSON.
 * NEVER throws and NEVER rejects: returns `null` on spawn error, non-zero exit,
 * timeout (SIGKILL), empty/invalid output, or a non-FEASIBLE status — the caller
 * then falls back to the heuristic scheduler.
 */
export function runApsSolver(model: ApsModel): Promise<ApsRawResult | null> {
  return new Promise<ApsRawResult | null>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: ApsRawResult | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };

    let child;
    try {
      const { cmd, args } = resolveApsCommand();
      child = spawn(cmd, args, { cwd: process.cwd(), shell: false, windowsHide: true });
    } catch {
      finish(null);
      return;
    }

    timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
      finish(null);
    }, apsTimeoutMs());

    let stdout = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    // stderr is ignored on purpose (ortools logs / warnings must not break us).
    child.stderr?.on("data", () => { /* swallow */ });

    child.on("error", () => finish(null));
    child.on("exit", (code) => {
      if (code !== 0) { finish(null); return; }
      finish(parseStdout(stdout));
    });

    // Feed the model and close stdin.
    try {
      child.stdin?.write(JSON.stringify(model));
      child.stdin?.end();
    } catch {
      finish(null);
    }
  });
}

function parseStdout(raw: string): ApsRawResult | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw.trim()) as ApsRawResult;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.status !== "OPTIMAL" && parsed.status !== "FEASIBLE") return null;
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── Result mapper ─────────────────────────────────────────────

export interface ApsParsedItem {
  productionOrderId: number;
  lineId: number;
  stationId: number | null;
  suggestedStart: Date;
  suggestedEnd: Date;
  reason: string;
  setupMinutes: number;
  sequenceIndex: number;
}

export interface ApsParsedObjective {
  makespanMin: number | null;
  totalTardinessMin: number | null;
  totalSetupMin: number | null;
}

export interface ApsParsedResult {
  items: ApsParsedItem[];
  objective: ApsParsedObjective;
}

/**
 * Map raw solver minutes back to absolute Date slots (using the model epoch).
 * For multi-op orders, the persisted item spans the order's first start to its
 * last end so the DRAFT row matches the existing one-row-per-order shape, while
 * keeping the placed stationId/setup/sequence from the final op.
 */
export function parseApsResult(model: ApsModel, raw: ApsRawResult): ApsParsedResult {
  const epoch = model.scheduleEpoch;
  const toDate = (min: number) => new Date(epoch + min * 60_000);

  // Aggregate ops per order: earliest start, latest end, last-op station/seq.
  const byOrder = new Map<number, {
    lineId: number;
    startMin: number;
    endMin: number;
    stationId: number | null;
    setupMinutes: number;
    sequenceIndex: number;
    lastOrderIndex: number;
  }>();

  for (const it of raw.items) {
    const prev = byOrder.get(it.productionOrderId);
    const lineId = it.lineId ?? (prev?.lineId ?? 0);
    if (!prev) {
      byOrder.set(it.productionOrderId, {
        lineId,
        startMin: it.suggestedStartMin,
        endMin: it.suggestedEndMin,
        stationId: it.stationId,
        setupMinutes: it.setupMinutes ?? 0,
        sequenceIndex: it.sequenceIndex ?? 0,
        lastOrderIndex: 0,
      });
    } else {
      prev.startMin = Math.min(prev.startMin, it.suggestedStartMin);
      prev.setupMinutes += it.setupMinutes ?? 0;
      // The placement of the final op (latest end) wins for station/seq.
      if (it.suggestedEndMin >= prev.endMin) {
        prev.endMin = it.suggestedEndMin;
        prev.stationId = it.stationId;
        prev.sequenceIndex = it.sequenceIndex ?? prev.sequenceIndex;
      }
    }
  }

  const items: ApsParsedItem[] = [];
  for (const [orderId, agg] of byOrder) {
    items.push({
      productionOrderId: orderId,
      lineId: agg.lineId,
      stationId: agg.stationId,
      suggestedStart: toDate(agg.startMin),
      suggestedEnd: toDate(agg.endMin),
      reason: "APS CP-SAT tối ưu (makespan + trễ hạn + changeover)",
      setupMinutes: agg.setupMinutes,
      sequenceIndex: agg.sequenceIndex,
    });
  }

  const objective: ApsParsedObjective = {
    makespanMin: raw.objective?.makespanMin ?? null,
    totalTardinessMin: raw.objective?.totalTardinessMin ?? null,
    totalSetupMin: raw.objective?.totalSetupMin ?? null,
  };

  return { items, objective };
}
