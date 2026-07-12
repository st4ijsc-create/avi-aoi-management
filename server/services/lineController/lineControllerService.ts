/**
 * doc 44 W3-A2 / G3.1 — LINE CONTROLLER (SYNAPSE LDS-L3 PHẦN II, Chương 4-7).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * "Bộ đồng bộ nội tuyến" v1 — lỗ hổng lớn nhất toàn hệ (doc 44 G3.1):
 *
 *   • FSM 7 trạng thái tường minh (spec §4.1, map ở drizzle/schema/lineController)
 *     — transition không hợp lệ trả INVALID_TRANSITION kèm danh sách hợp lệ.
 *   • MỌI transition đi qua policy seam `evaluateCommandPolicy` với action
 *     `line.command.{to}` (spec §16 "mọi lệnh đi qua một cửa") — DENY → chặn +
 *     audit (decision-trace của policyGate + row POLICY_DENIED trong sổ audit).
 *   • Persist transaction: line_states (race-guard WHERE state=from) + append
 *     line_state_transitions — FSM bền qua restart (spec §7/§19.1).
 *   • Publish `_line/state` RETAINED lên UNS v2 (spec §4.2/§12.2) khi
 *     UNS_TOPIC_V2_ENABLED — fire-and-forget (lỗi publish không chặn transition).
 *   • Đẩy delta vào state store (W2-B1) khi STATE_STORE_ENABLED.
 *   • correlationId từ ALS backbone (observability/correlation) khi không truyền.
 *   • Readiness checklist v1 (lineReadiness.ts) BẮT BUỘC cho mọi transition VÀO
 *     'ready' — không đạt → giữ nguyên trạng thái + trả checks.
 *   • Vòng QUAN SÁT nhịp (spec Chương 5 — v1 observe + cảnh báo, KHÔNG tự điều
 *     tiết; hành động giữ/thả tự động = W3-B): sweep interval đọc lineBalance
 *     analytics → blocking/starving kéo dài → event + Andon (routeAlert);
 *     bottleneck đổi → event; máy fault khi line producing → auto transition
 *     'fault' (qua đúng transitionLine, actor 'system').
 *
 * Cờ (đều default OFF/safe):
 *   LINE_CONTROLLER_ENABLED            "true" → bật sweep scheduler (OFF mặc định)
 *   LINE_CONTROLLER_SWEEP_MS           chu kỳ sweep (mặc định 30000, sàn 5000)
 *   LINE_CONTROLLER_STALL_MS           ngưỡng avg blocked/starved (mặc định 120000)
 *   LINE_CONTROLLER_DWELL_WINDOW_MS    cửa sổ dwell analytics (mặc định 900000)
 *   LINE_CONTROLLER_ALERT_COOLDOWN_MS  cooldown Andon per line+kind (mặc định 600000)
 *   LINE_READINESS_CACHE_MS            TTL cache readiness (lineReadiness, 30000)
 * ════════════════════════════════════════════════════════════════════════════
 */
import { evaluateCommandPolicy } from "../security/policyGate";
import { getCorrelationId } from "../observability/correlation";
import { isUnsTopicV2Enabled, buildLineAggregateTopicV2, toCanonicalState } from "../uns/topicV2";
import { stateStoreEnabled, setState, type StateSnapshot } from "../stateStore/stateStore";
import { getLatestLineBalance, getStationDwellAgg, type LineBalanceRow } from "../../db/lineBalance";
import {
  LINE_STATE_TRANSITIONS,
  isLegalLineStateTransition,
  asLineControllerState,
  type LineControllerState,
  type LineStateRow,
} from "../../../drizzle/schema";
import * as repo from "./lineStateRepo";
import {
  checkLineReadiness,
  getCachedReadiness,
  type LineReadinessResult,
} from "./lineReadiness";

// ─── Flags / tunables (đọc tại call time — test-friendly với stubEnv) ─────────

export function isLineControllerEnabled(): boolean {
  return process.env.LINE_CONTROLLER_ENABLED === "true" || process.env.LINE_CONTROLLER_ENABLED === "1";
}

export function lineControllerSweepMs(): number {
  const n = Number(process.env.LINE_CONTROLLER_SWEEP_MS);
  return Number.isFinite(n) && n >= 5_000 ? n : 30_000;
}

function stallThresholdMs(): number {
  const n = Number(process.env.LINE_CONTROLLER_STALL_MS);
  return Number.isFinite(n) && n >= 1_000 ? n : 120_000;
}

function dwellWindowMs(): number {
  const n = Number(process.env.LINE_CONTROLLER_DWELL_WINDOW_MS);
  return Number.isFinite(n) && n >= 60_000 ? n : 15 * 60 * 1000;
}

function alertCooldownMs(): number {
  const n = Number(process.env.LINE_CONTROLLER_ALERT_COOLDOWN_MS);
  return Number.isFinite(n) && n >= 0 ? n : 10 * 60 * 1000;
}

// ─── Transition API ───────────────────────────────────────────────────────────

export interface TransitionOptions {
  /** Lý do (spec: mọi transition có reason trong audit). */
  reason?: string;
  /** user id | 'system' | 'orchestration' | 'api:<key>'. Mặc định 'system'. */
  actor?: string;
  /** Truyền từ caller; không truyền → lấy từ ALS backbone; không có → null. */
  correlationId?: string;
  /** Lý do giữ khi to='held' (fallback reason). */
  heldReason?: string;
  /** Recipe set ref nạp khi changeover (khóa phiên bản đầy đủ = W3-B). */
  recipeSetRef?: string;
  /** Readiness: bắt buộc recipe_set_ref khi vào 'ready'. */
  requireRecipe?: boolean;
  /** Orchestration W3-B nạp. */
  activeOrderId?: number | null;
  taktTargetS?: number | null;
}

export type TransitionFailure =
  | { ok: false; code: "DB_UNAVAILABLE"; message: string }
  | { ok: false; code: "LINE_NOT_FOUND"; message: string }
  | {
      ok: false;
      code: "INVALID_TRANSITION";
      message: string;
      from: LineControllerState;
      to: LineControllerState;
      allowed: readonly LineControllerState[];
    }
  | {
      ok: false;
      code: "NOT_READY";
      message: string;
      from: LineControllerState;
      to: LineControllerState;
      readiness: LineReadinessResult;
    }
  | {
      ok: false;
      code: "POLICY_DENIED";
      message: string;
      effect: string;
      policyRef: string | null;
    }
  | { ok: false; code: "CONFLICT"; message: string };

export type TransitionSuccess = {
  ok: true;
  lineId: number;
  from: LineControllerState;
  to: LineControllerState;
  state: LineStateRow;
  ts: string;
  correlationId: string | null;
  /** Kèm khi transition vào 'ready' (kết quả checklist vừa chạy). */
  readiness?: LineReadinessResult;
};

export type TransitionResult = TransitionSuccess | TransitionFailure;

/**
 * Chuyển trạng thái MỘT tuyến qua đầy đủ 4 cổng theo thứ tự:
 *   (a) FSM validate → (b) readiness (khi vào 'ready') → (c) policy seam →
 *   (d) persist transaction (race-safe) → publish UNS + state store (best-effort).
 * KHÔNG throw cho lý do nghiệp vụ — trả TransitionResult phân loại.
 */
export async function transitionLine(
  lineId: number,
  to: LineControllerState,
  opts: TransitionOptions = {},
): Promise<TransitionResult> {
  const actor = opts.actor?.trim() || "system";
  const reason = opts.reason?.trim() || null;
  const correlationId = opts.correlationId ?? getCorrelationId() ?? null;

  if (!(await repo.isDbAvailable())) {
    return { ok: false, code: "DB_UNAVAILABLE", message: "Không có kết nối DB — FSM tuyến cần trạng thái bền." };
  }

  const line = await repo.getLineRow(lineId);
  if (!line) {
    return { ok: false, code: "LINE_NOT_FOUND", message: `Không tìm thấy production line id=${lineId}.` };
  }

  const current = await repo.ensureLineState(lineId);
  if (!current) {
    return { ok: false, code: "DB_UNAVAILABLE", message: "Không đọc/tạo được line_states (DB unavailable)." };
  }
  const from = current.state;

  // (a) FSM validate — trạng thái đích phải là 1 trong 7 (defensive: REST/tRPC
  //     đã enum-validate) và transition phải hợp lệ, kèm danh sách hợp lệ (§4.1).
  const target = asLineControllerState(to);
  if (!target) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `Trạng thái đích không hợp lệ: '${String(to)}'. Hợp lệ từ '${from}': [${(LINE_STATE_TRANSITIONS[from] ?? []).join(", ")}].`,
      from,
      to: to as LineControllerState,
      allowed: LINE_STATE_TRANSITIONS[from] ?? [],
    };
  }
  if (!isLegalLineStateTransition(from, target)) {
    const allowed = LINE_STATE_TRANSITIONS[from] ?? [];
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message:
        from === target
          ? `Tuyến ${line.code} đã ở trạng thái '${from}' — không có transition same-state.`
          : `Transition '${from}' → '${target}' không hợp lệ cho tuyến ${line.code}. Hợp lệ từ '${from}': [${allowed.join(", ")}].`,
      from,
      to: target,
      allowed,
    };
  }

  // (b) Readiness checklist — BẮT BUỘC cho mọi transition VÀO 'ready'
  //     (idle→ready per yêu cầu batch; changeover→ready per spec §6.1 "xác nhận
  //     nạp trước khi cho READY"; fault→ready = "khắc phục + xác nhận" — checklist
  //     chính là bằng chứng khắc phục). Không đạt → GIỮ NGUYÊN trạng thái.
  let readiness: LineReadinessResult | undefined;
  if (target === "ready") {
    readiness = await checkLineReadiness(lineId, { requireRecipe: opts.requireRecipe ?? false });
    if (!readiness.ready) {
      const failed = readiness.checks.filter((c) => !c.passed).map((c) => c.name);
      return {
        ok: false,
        code: "NOT_READY",
        message: `Tuyến ${line.code} chưa sẵn sàng ('${from}' giữ nguyên): fail [${failed.join(", ")}].`,
        from,
        to: target,
        readiness,
      };
    }
  }

  // (c) Policy seam — action `line.command.{to}`, default-allow khi SEC_PLATFORM
  //     OFF (policyGate hiện tại), DENY → chặn + audit (spec §16).
  const decision = evaluateCommandPolicy({
    action: `line.command.${target}`,
    lineId,
    lineCode: line.code,
    from,
    to: target,
    actor,
    ...(reason ? { reason } : {}),
  });
  if (!decision.allow) {
    await repo.appendDeniedAudit({
      lineId,
      from,
      to: target,
      reason: `${decision.reason} (effect=${decision.effect})`,
      triggeredBy: actor,
      correlationId,
      policyRef: decision.policyId,
    });
    return {
      ok: false,
      code: "POLICY_DENIED",
      message: `Policy chặn lệnh line.command.${target}: ${decision.reason}`,
      effect: decision.effect,
      policyRef: decision.policyId,
    };
  }

  // (d) Persist transaction — race-guard: WHERE state=from.
  const updated = await repo.applyTransition({
    lineId,
    from,
    to: target,
    reason,
    triggeredBy: actor,
    correlationId,
    policyRef: decision.policyId,
    heldReason: opts.heldReason ?? undefined,
    ...(opts.recipeSetRef !== undefined ? { recipeSetRef: opts.recipeSetRef } : {}),
    ...(opts.activeOrderId !== undefined ? { activeOrderId: opts.activeOrderId } : {}),
    ...(opts.taktTargetS !== undefined ? { taktTargetS: opts.taktTargetS } : {}),
  });
  if (!updated) {
    return {
      ok: false,
      code: "CONFLICT",
      message: `Transition '${from}' → '${target}' thua race với một transition đồng thời (tuyến ${line.code}) — đọc lại trạng thái và thử lại.`,
    };
  }

  // (e) Publish `_line/state` + state-store delta — best-effort, KHÔNG BAO GIỜ
  //     chặn/ném vào đường lệnh (fire-and-forget semantics).
  try {
    await publishLineStateDelta(lineId, updated, correlationId);
  } catch (err) {
    console.error(`[LineController] line ${lineId} state publish failed:`, (err as Error)?.message ?? err);
  }

  console.log(
    `[LineController] line ${lineId} (${line.code}): '${from}' → '${target}' by ${actor}` +
      (reason ? ` — ${reason}` : ""),
  );

  return {
    ok: true,
    lineId,
    from,
    to: target,
    state: updated,
    ts: new Date(updated.enteredAt).toISOString(),
    correlationId,
    ...(readiness ? { readiness } : {}),
  };
}

// ─── UNS `_line/state` + state store delta ────────────────────────────────────

/**
 * Payload LineState (spec §12.2 — state UPPERCASE 'PRODUCING'…) publish RETAINED
 * lên `syn/{site}/{area}/{line}/_line/state` (aspect 'state' → QoS1 retain,
 * topicV2.aspectPublishOptions). Gated UNS_TOPIC_V2_ENABLED. LƯU Ý interplay:
 * unsAggregates (G2.3) cũng publish topic này (derived OEE rollup) — retained
 * last-writer-wins; hai payload đều StateSnapshot-shaped {path, ts, state}.
 */
async function publishLineStateDelta(
  lineId: number,
  row: LineStateRow,
  correlationId: string | null,
): Promise<void> {
  const unsOn = isUnsTopicV2Enabled();
  const storeOn = stateStoreEnabled();
  if (!unsOn && !storeOn) return;

  const segs = await repo.getLineSegs(lineId);
  if (!segs) return; // không resolve được hierarchy — honest skip, không bịa path

  const path = `${segs.site}/${segs.area}/${segs.line}/_line`;
  const ts = new Date().toISOString();
  const state = row.state.toUpperCase(); // spec §12.2: "state":"PRODUCING"

  if (unsOn) {
    const payload = {
      path,
      ts,
      state,
      values: {
        held_reason: row.heldReason ?? null,
        recipe_set: row.recipeSetRef ?? null,
        takt_target_s: row.taktTargetS ?? null,
        active_order_id: row.activeOrderId ?? null,
        entered_at: new Date(row.enteredAt).toISOString(),
      },
      metric_source: "lineControllerService",
      ...(correlationId ? { correlation_id: correlationId } : {}),
    };
    const { publishUnsV2 } = await import("../unsPublisher");
    publishUnsV2(buildLineAggregateTopicV2(segs, "state"), payload, "state");
  }

  if (storeOn) {
    const snap: StateSnapshot = {
      path,
      ts,
      state,
      values: {
        ...(row.heldReason ? { held_reason: { v: row.heldReason } } : {}),
        ...(row.recipeSetRef ? { recipe_set: { v: row.recipeSetRef } } : {}),
        ...(row.taktTargetS != null ? { takt_target_s: { v: row.taktTargetS, unit: "s" } } : {}),
        ...(row.activeOrderId != null ? { active_order_id: { v: row.activeOrderId } } : {}),
      },
      source: "live",
    };
    setState(path, snap);
  }
}

// ─── Lệnh cấp tuyến (REST/tRPC dùng chung) ────────────────────────────────────

export const LINE_COMMANDS = ["start", "hold", "resume", "changeover", "complete", "reset_fault"] as const;
export type LineCommand = (typeof LINE_COMMANDS)[number];

/**
 * Map lệnh → trạng thái đích theo NGỮ CẢNH (spec §13.2). `complete` là lệnh
 * "tiến chuỗi hoàn tất": producing→completing (drain), completing→idle (drain
 * xong), changeover→ready (changeover xong). `start` từ idle tự chuỗi
 * idle→ready (checklist) rồi ready→producing.
 */
export function resolveCommandTarget(
  command: LineCommand,
  current: LineControllerState,
): { to: LineControllerState; chainReadyFirst?: boolean } {
  switch (command) {
    case "start":
      return current === "idle" ? { to: "producing", chainReadyFirst: true } : { to: "producing" };
    case "hold":
      return { to: "held" };
    case "resume":
      return { to: "producing" };
    case "changeover":
      return { to: "changeover" };
    case "complete":
      if (current === "completing") return { to: "idle" };
      if (current === "changeover") return { to: "ready" };
      return { to: "completing" };
    case "reset_fault":
      return { to: "ready" };
  }
}

/**
 * Thực thi một lệnh tuyến (start|hold|resume|changeover|complete|reset_fault).
 * `start` từ idle: transition idle→ready (BẮT BUỘC checklist) rồi ready→producing
 * — fail bước nào trả kết quả bước đó (transition ready đã persist là thật,
 * có trong audit).
 */
export async function executeLineCommand(
  lineId: number,
  command: LineCommand,
  opts: TransitionOptions = {},
): Promise<TransitionResult> {
  if (!(await repo.isDbAvailable())) {
    return { ok: false, code: "DB_UNAVAILABLE", message: "Không có kết nối DB — FSM tuyến cần trạng thái bền." };
  }
  const line = await repo.getLineRow(lineId);
  if (!line) {
    return { ok: false, code: "LINE_NOT_FOUND", message: `Không tìm thấy production line id=${lineId}.` };
  }
  const current = await repo.ensureLineState(lineId);
  if (!current) {
    return { ok: false, code: "DB_UNAVAILABLE", message: "Không đọc/tạo được line_states (DB unavailable)." };
  }

  const { to, chainReadyFirst } = resolveCommandTarget(command, current.state);
  if (chainReadyFirst) {
    const readyStep = await transitionLine(lineId, "ready", {
      ...opts,
      reason: opts.reason ?? `auto: start từ idle — bước 1/2 (readiness gate)`,
    });
    if (!readyStep.ok) return readyStep;
  }
  return transitionLine(lineId, to, opts);
}

// ─── Chi tiết trạng thái / stages cho API ─────────────────────────────────────

export interface LineStateDetail {
  lineId: number;
  code: string;
  name: string;
  state: LineControllerState;
  heldReason: string | null;
  recipeSetRef: string | null;
  activeOrderId: number | null;
  taktTargetS: number | null;
  enteredAt: string | null;
  /** Nhịp/nghẽn từ line_balance_metrics (analytics W2) — null khi chưa có dữ liệu (honest). */
  takt: {
    taktTimeMs: number | null;
    avgCycleTimeMs: number | null;
    maxCycleTimeMs: number | null;
    throughputUnits: number;
    utilizationPct: number | null;
    periodStart: string;
    periodEnd: string;
  } | null;
  bottleneck: { stationId: number | null; machineId: number | null } | null;
  /** Readiness cache (TTL LINE_READINESS_CACHE_MS) — tính mới khi cache nguội. */
  readiness: LineReadinessResult;
  recentTransitions: Array<{
    fromState: string;
    toState: string;
    reason: string | null;
    triggeredBy: string;
    correlationId: string | null;
    policyRef: string | null;
    ts: string;
  }>;
}

/** Trạng thái + nhịp + bottleneck + readiness của một tuyến. Null khi tuyến không tồn tại. */
export async function getLineStateDetail(lineId: number): Promise<LineStateDetail | null> {
  const line = await repo.getLineRow(lineId);
  if (!line) return null;
  const stateRow = await repo.getLineState(lineId);
  const [balance, readiness, transitions] = await Promise.all([
    getLatestLineBalance(lineId).catch(() => null as LineBalanceRow | null),
    (async () => getCachedReadiness(lineId) ?? (await checkLineReadiness(lineId)))(),
    repo.listTransitions(lineId, 10),
  ]);
  return {
    lineId,
    code: line.code,
    name: line.name,
    state: (stateRow?.state ?? "idle") as LineControllerState,
    heldReason: stateRow?.heldReason ?? null,
    recipeSetRef: stateRow?.recipeSetRef ?? null,
    activeOrderId: stateRow?.activeOrderId ?? null,
    taktTargetS: stateRow?.taktTargetS == null ? null : Number(stateRow.taktTargetS),
    enteredAt: stateRow ? new Date(stateRow.enteredAt).toISOString() : null,
    takt: balance
      ? {
          taktTimeMs: balance.taktTimeMs,
          avgCycleTimeMs: balance.avgCycleTimeMs,
          maxCycleTimeMs: balance.maxCycleTimeMs,
          throughputUnits: balance.throughputUnits,
          utilizationPct: balance.utilizationPct,
          periodStart: balance.periodStart,
          periodEnd: balance.periodEnd,
        }
      : null,
    bottleneck:
      balance && (balance.bottleneckStationId != null || balance.bottleneckMachineId != null)
        ? { stationId: balance.bottleneckStationId, machineId: balance.bottleneckMachineId }
        : null,
    readiness,
    recentTransitions: transitions.map((t) => ({
      fromState: t.fromState,
      toState: t.toState,
      reason: t.reason ?? null,
      triggeredBy: t.triggeredBy,
      correlationId: t.correlationId ?? null,
      policyRef: t.policyRef ?? null,
      ts: new Date(t.ts).toISOString(),
    })),
  };
}

export interface LineStageView {
  stationId: number;
  code: string;
  name: string;
  orderIndex: number;
  /** Chu kỳ mục tiêu (giây) từ line_stages nếu stage link trạm — null khi chưa cấu hình. */
  cycleTimeTargetS: number | null;
  /** Dwell analytics (station_dwell_time, cửa sổ LINE_CONTROLLER_DWELL_WINDOW_MS). */
  dwell: { avgDwellMs: number; avgStarvedMs: number; avgBlockedMs: number; samples: number } | null;
  /** Blocked/starved khi avg vượt LINE_CONTROLLER_STALL_MS (ngưỡng công bố trong meta). */
  blocked: boolean;
  starved: boolean;
  machines: Array<{
    id: number;
    code: string;
    name: string;
    machineType: string;
    operationStatus: string;
    /** PackML/op-state chuẩn hóa (toCanonicalState — honest passthrough khi lạ). */
    opState: string;
    presence: "online" | "offline" | "unknown";
  }>;
}

export interface LineStagesResult {
  lineId: number;
  windowFrom: string;
  windowTo: string;
  stallThresholdMs: number;
  stages: LineStageView[];
}

/** Trạng thái từng trạm của tuyến (spec §13.2 GET /v1/lines/{id}/stages). Null khi tuyến không tồn tại. */
export async function getLineStages(lineId: number): Promise<LineStagesResult | null> {
  const line = await repo.getLineRow(lineId);
  if (!line) return null;
  const to = new Date();
  const from = new Date(to.getTime() - dwellWindowMs());
  const [stationRows, machineRows, cycleTargets, dwellAgg] = await Promise.all([
    repo.getLineStations(lineId),
    repo.getLineMachines(lineId),
    repo.getStageCycleTargets(lineId),
    getStationDwellAgg(lineId, from).catch(() => []),
  ]);
  const presence = await repo.getLatestPresence(machineRows.map((m) => m.id));
  const dwellByStation = new Map(dwellAgg.map((d) => [d.stationId, d]));
  const threshold = stallThresholdMs();

  const stages: LineStageView[] = stationRows.map((s) => {
    const d = dwellByStation.get(s.id) ?? null;
    return {
      stationId: s.id,
      code: s.code,
      name: s.name,
      orderIndex: s.orderIndex,
      cycleTimeTargetS: cycleTargets.get(s.id) ?? null,
      dwell: d
        ? { avgDwellMs: d.avgDwellMs, avgStarvedMs: d.avgStarvedMs, avgBlockedMs: d.avgBlockedMs, samples: d.samples }
        : null,
      blocked: !!d && d.avgBlockedMs >= threshold,
      starved: !!d && d.avgStarvedMs >= threshold,
      machines: machineRows
        .filter((m) => m.stationId === s.id)
        .map((m) => ({
          id: m.id,
          code: m.code,
          name: m.name,
          machineType: m.machineType,
          operationStatus: m.operationStatus,
          opState: toCanonicalState(m.operationStatus),
          presence: presence.get(m.id) ?? "unknown",
        })),
    };
  });

  return {
    lineId,
    windowFrom: from.toISOString(),
    windowTo: to.toISOString(),
    stallThresholdMs: threshold,
    stages,
  };
}

/** Danh sách tuyến + trạng thái (GET /v1/lines + tRPC listStates). */
export async function listLinesWithState(): Promise<repo.LineWithState[]> {
  return repo.listLinesWithState();
}

// ─── Vòng quan sát nhịp (sweep — spec Chương 5, v1 observe-only) ──────────────

export interface LineControllerEvent {
  ts: string;
  lineId: number;
  kind: "machine_fault" | "blocking" | "starving" | "bottleneck_change";
  detail: string;
}

export interface SweepStats {
  lines: number;
  producing: number;
  faultTransitions: number;
  stallAlerts: number;
  bottleneckChanges: number;
  errors: number;
  ms: number;
}

let sweepTimer: NodeJS.Timeout | null = null;
let sweepRunning = false;
let lastSweepAt: string | null = null;
let lastSweepStats: SweepStats | null = null;

const recentEvents: LineControllerEvent[] = [];
const MAX_EVENTS = 100;
/** lineId → bottleneckMachineId quan sát lần trước (đổi → event). */
const lastBottleneck = new Map<number, number | null>();
/** `${lineId}:${kind}` → epoch-ms lần Andon gần nhất (cooldown). */
const lastAlertAt = new Map<string, number>();

function recordEvent(ev: LineControllerEvent): void {
  recentEvents.push(ev);
  if (recentEvents.length > MAX_EVENTS) recentEvents.shift();
  console.log(`[LineController] event ${ev.kind} line=${ev.lineId}: ${ev.detail}`);
}

/** Andon warning qua smart-alert router — cooldown per (line, kind), best-effort. */
async function maybeAndonAlert(
  lineId: number,
  kind: "blocking" | "starving",
  detail: string,
): Promise<boolean> {
  const key = `${lineId}:${kind}`;
  const now = Date.now();
  const last = lastAlertAt.get(key) ?? 0;
  if (now - last < alertCooldownMs()) return false;
  lastAlertAt.set(key, now);
  recordEvent({ ts: new Date().toISOString(), lineId, kind, detail });
  try {
    const { routeAlert } = await import("../aiSmartAlertRouter");
    await routeAlert({
      type: "PATTERN_ANOMALY",
      severity: "HIGH",
      message: `[Line Controller] ${kind === "blocking" ? "Nghẽn (blocking)" : "Đói (starving)"} kéo dài trên tuyến ${lineId}: ${detail}`,
      data: { source: "lineControllerService", lineId, kind, detail },
    });
  } catch (err) {
    console.error("[LineController] Andon routeAlert failed:", (err as Error)?.message ?? err);
  }
  return true;
}

/**
 * MỘT lượt quan sát (exported cho tests / on-demand; KHÔNG gate cờ ở đây):
 *   • line 'producing' có máy operationStatus='error' → auto transition 'fault'
 *     (qua transitionLine, actor 'system' — đủ policy + audit + publish).
 *   • blocking/starving kéo dài (avg dwell vượt ngưỡng trong cửa sổ) → event +
 *     Andon (cooldown). QUAN SÁT + CẢNH BÁO — không tự giữ/thả (W3-B).
 *   • bottleneck đổi (line_balance_metrics) → event.
 * Mỗi tuyến isolated try/catch — một tuyến lỗi không chặn các tuyến khác.
 */
export async function runLineControllerSweepOnce(now: Date = new Date()): Promise<SweepStats> {
  const t0 = Date.now();
  const stats: SweepStats = {
    lines: 0,
    producing: 0,
    faultTransitions: 0,
    stallAlerts: 0,
    bottleneckChanges: 0,
    errors: 0,
    ms: 0,
  };
  try {
    const lines = await repo.listLinesWithState();
    stats.lines = lines.length;
    for (const line of lines) {
      if (line.state !== "producing") continue;
      stats.producing += 1;
      try {
        // 1) Máy fault khi tuyến đang producing → auto FAULT (spec §4.1 "*→fault").
        const lineMachines = await repo.getLineMachines(line.lineId);
        const faulted = lineMachines.filter((m) => m.operationStatus === "error");
        if (faulted.length > 0) {
          const codes = faulted.map((m) => m.code).join(", ");
          const res = await transitionLine(line.lineId, "fault", {
            actor: "system",
            reason: `auto (sweep): máy lỗi khi tuyến đang producing — ${codes} (operationStatus=error)`,
          });
          if (res.ok) {
            stats.faultTransitions += 1;
            recordEvent({
              ts: new Date().toISOString(),
              lineId: line.lineId,
              kind: "machine_fault",
              detail: `máy ${codes} lỗi → tuyến '${res.from}' → 'fault'`,
            });
          } else {
            stats.errors += 1;
            console.error(
              `[LineController] sweep: auto-fault line ${line.lineId} bị chặn (${res.code}): ${res.message}`,
            );
          }
          continue; // tuyến đã fault — bỏ qua quan sát nhịp lượt này
        }

        // 2) Blocking/starving kéo dài (dwell analytics — quan sát, không điều tiết).
        const dwell = await getStationDwellAgg(line.lineId, new Date(now.getTime() - dwellWindowMs()));
        const threshold = stallThresholdMs();
        const blocked = dwell.filter((d) => d.avgBlockedMs >= threshold);
        const starved = dwell.filter((d) => d.avgStarvedMs >= threshold);
        if (blocked.length > 0) {
          const fired = await maybeAndonAlert(
            line.lineId,
            "blocking",
            `trạm ${blocked.map((d) => `${d.stationId} (avg blocked ${d.avgBlockedMs}ms)`).join("; ")} vượt ngưỡng ${threshold}ms`,
          );
          if (fired) stats.stallAlerts += 1;
        }
        if (starved.length > 0) {
          const fired = await maybeAndonAlert(
            line.lineId,
            "starving",
            `trạm ${starved.map((d) => `${d.stationId} (avg starved ${d.avgStarvedMs}ms)`).join("; ")} vượt ngưỡng ${threshold}ms`,
          );
          if (fired) stats.stallAlerts += 1;
        }

        // 3) Bottleneck đổi (line_balance_metrics mới nhất).
        const balance = await getLatestLineBalance(line.lineId);
        if (balance) {
          const prev = lastBottleneck.get(line.lineId);
          const cur = balance.bottleneckMachineId ?? null;
          if (prev !== undefined && prev !== cur) {
            stats.bottleneckChanges += 1;
            recordEvent({
              ts: new Date().toISOString(),
              lineId: line.lineId,
              kind: "bottleneck_change",
              detail: `bottleneck machine ${prev ?? "none"} → ${cur ?? "none"}`,
            });
          }
          lastBottleneck.set(line.lineId, cur);
        }
      } catch (err) {
        stats.errors += 1;
        console.error(`[LineController] sweep line ${line.lineId} failed:`, (err as Error)?.message ?? err);
      }
    }
  } catch (err) {
    stats.errors += 1;
    console.error("[LineController] sweep run error:", (err as Error)?.message ?? err);
  }
  stats.ms = Date.now() - t0;
  lastSweepAt = new Date().toISOString();
  lastSweepStats = stats;
  return stats;
}

// ─── Scheduler lifecycle (mirror unsAggregates) + startup recovery ───────────

/**
 * Khởi động Line Controller: recovery trạng thái bền từ line_states (spec §19.1
 * "khởi động lại, tiếp tục từ trạng thái bền" — FSM đọc DB mỗi transition nên
 * recovery = xác nhận + log) rồi resume sweep. No-op khi LINE_CONTROLLER_ENABLED
 * OFF (default).
 */
export async function startLineController(): Promise<void> {
  if (!isLineControllerEnabled()) {
    console.log("[LineController] disabled (set LINE_CONTROLLER_ENABLED=true to enable)");
    return;
  }
  if (sweepTimer) return;

  // Startup recovery — đọc trạng thái bền, seed quan sát bottleneck.
  try {
    const lines = await repo.listLinesWithState();
    const nonIdle = lines.filter((l) => l.state !== "idle");
    console.log(
      `[LineController] recovered ${lines.length} persisted line state(s) from line_states` +
        (nonIdle.length > 0
          ? ` — non-idle: ${nonIdle.map((l) => `${l.code}='${l.state}'`).join(", ")}`
          : ""),
    );
  } catch (err) {
    console.error("[LineController] startup recovery read failed:", (err as Error)?.message ?? err);
  }

  const interval = lineControllerSweepMs();
  sweepTimer = setInterval(() => {
    if (sweepRunning) return; // không chồng lượt
    sweepRunning = true;
    runLineControllerSweepOnce()
      .then((s) => {
        if (s.faultTransitions > 0 || s.stallAlerts > 0 || s.bottleneckChanges > 0 || s.errors > 0) {
          console.log(
            `[LineController] sweep: lines=${s.lines} producing=${s.producing} faults=${s.faultTransitions} ` +
              `stallAlerts=${s.stallAlerts} bottleneckChanges=${s.bottleneckChanges} err=${s.errors} in ${s.ms}ms`,
          );
        }
      })
      .catch((err) => console.error("[LineController] sweep tick failed:", (err as Error)?.message ?? err))
      .finally(() => {
        sweepRunning = false;
      });
  }, interval);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
  console.log(`[LineController] sweep scheduler started (every ${interval}ms — observe + warn, v1)`);
}

/** Dừng sweep (shutdown). An toàn khi chưa start. */
export function stopLineController(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/** Trạng thái runtime cho dashboards / health. */
export function getLineControllerStatus() {
  return {
    enabled: isLineControllerEnabled(),
    sweepMs: lineControllerSweepMs(),
    stallThresholdMs: stallThresholdMs(),
    dwellWindowMs: dwellWindowMs(),
    alertCooldownMs: alertCooldownMs(),
    running: !!sweepTimer,
    lastSweepAt,
    lastSweepStats,
    recentEvents: [...recentEvents],
  };
}

/** Test seam: reset module state (timer + caches + events). */
export function _resetLineControllerForTests(): void {
  stopLineController();
  sweepRunning = false;
  lastSweepAt = null;
  lastSweepStats = null;
  recentEvents.length = 0;
  lastBottleneck.clear();
  lastAlertAt.clear();
}
