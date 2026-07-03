/**
 * Interlock — đánh giá điều kiện rule ĐỒNG BỘ, chỉ đọc DB (KHÔNG Andon/dispatch).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TÁCH RIÊNG (doc 25 T1):
 *   - commandDispatcher.dispatch() cần một CỔNG interlock ĐỒNG BỘ, fail-closed
 *     chạy TRƯỚC mọi real-write cho lệnh HITL. Trước đây interlockEngine chỉ là
 *     poll-loop async (mặc định TẮT) → lệnh người-xác-nhận có thể ghi xuống máy
 *     mà KHÔNG qua interlock.
 *   - Module này KHÔNG import commandDispatcher/andonService nên KHÔNG tạo vòng
 *     phụ thuộc khi commandDispatcher import ngược lại (an toàn về mặt module).
 *   - fetchObservation được CHUYỂN vào đây (từ interlockEngine) để cả engine (poll)
 *     lẫn dispatcher (inline) DÙNG CHUNG một logic — tránh nhân bản.
 *
 * SAFETY: các hàm ở đây chỉ ĐỌC feed + trả boolean/kết quả cổng. Chúng KHÔNG bao
 * giờ raise Andon hay ghi lệnh máy — đó là việc của engine/dispatcher.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, gte, sql, desc } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  interlockRules,
  processResults,
  spcRuleViolations,
  cpkHistory,
  otTelemetry,
  type InterlockRule,
} from "../../../drizzle/schema";
import {
  evaluateCondition,
  deriveObserved,
  type ComparisonOperator,
  type InterlockSourceType,
  type ObservationContext,
} from "./ruleEvaluator";

/** Window start = now - windowSeconds (default 300s). */
function windowStart(rule: InterlockRule): Date {
  const secs = rule.windowSeconds ?? 300;
  return new Date(Date.now() - secs * 1000);
}

/**
 * Query the source feed for a rule and reduce it to an ObservationContext. PURE
 * derivation happens in ruleEvaluator.deriveObserved(). Each branch is scoped by
 * machine when machineId is set (best-effort; rules may be line/station scoped).
 */
export async function fetchObservation(rule: InterlockRule): Promise<ObservationContext> {
  const db = await getDb();
  if (!db) return {};
  const since = windowStart(rule);

  switch (rule.sourceType as InterlockSourceType) {
    case "spc_violation": {
      const conds = [gte(spcRuleViolations.detectedAt, since), eq(spcRuleViolations.isActive, true)];
      if (rule.machineId != null) conds.push(eq(spcRuleViolations.machineId, rule.machineId));
      const [r] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(spcRuleViolations)
        .where(and(...conds));
      return { count: r?.c ?? 0 };
    }
    case "process_result": {
      // Count NG/fail process results in window (sourceKey may name a stepType).
      const conds = [gte(processResults.measuredAt, since), eq(processResults.result, "fail")];
      if (rule.machineId != null) conds.push(eq(processResults.machineId, rule.machineId));
      if (rule.sourceKey) conds.push(eq(processResults.stepType, rule.sourceKey));
      const [r] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(processResults)
        .where(and(...conds));
      return { count: r?.c ?? 0 };
    }
    case "ng_rate": {
      // NG-rate (%) over process_results in window: fail / total * 100.
      const conds = [gte(processResults.measuredAt, since)];
      if (rule.machineId != null) conds.push(eq(processResults.machineId, rule.machineId));
      const [r] = await db
        .select({
          total: sql<number>`count(*)::int`,
          fail: sql<number>`count(*) filter (where ${processResults.result} = 'fail')::int`,
        })
        .from(processResults)
        .where(and(...conds));
      const total = r?.total ?? 0;
      const fail = r?.fail ?? 0;
      return { scalar: total > 0 ? (fail / total) * 100 : 0 };
    }
    case "cpk": {
      const conds = [];
      if (rule.machineId != null) conds.push(eq(cpkHistory.machineId, rule.machineId));
      const [r] = await db
        .select({ cpk: cpkHistory.cpk })
        .from(cpkHistory)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(cpkHistory.periodEnd))
        .limit(1);
      return { scalar: r?.cpk != null ? Number(r.cpk) : null };
    }
    case "telemetry_tag": {
      // Canonical ot_telemetry (P2): ts/metric/numValue.
      const conds = [gte(otTelemetry.ts, since)];
      if (rule.machineId != null) conds.push(eq(otTelemetry.machineId, rule.machineId));
      if (rule.sourceKey) conds.push(eq(otTelemetry.metric, rule.sourceKey));
      const rows = await db
        .select({ v: otTelemetry.numValue, t: otTelemetry.ts })
        .from(otTelemetry)
        .where(and(...conds))
        .orderBy(otTelemetry.ts)
        .limit(rule.windowSize ?? 50);
      const series = rows.map((r) => (r.v != null ? Number(r.v) : null));
      const latest = series.length ? series[series.length - 1] : null;
      return { series, scalar: latest };
    }
    default:
      return {};
  }
}

/**
 * Đánh giá ĐỒNG BỘ điều kiện của một rule: fetch feed → derive → compare. Trả về
 * true khi điều kiện của rule đang VI PHẠM (met). Tái dùng bởi cả interlockEngine
 * (poll) và evaluateInterlockGate (inline). Có thể ném lỗi nếu fetchObservation lỗi
 * — caller phải bắt và xử lý fail-closed.
 */
export async function evaluateRuleCondition(rule: InterlockRule): Promise<boolean> {
  const obs = await fetchObservation(rule);
  const observed = deriveObserved(rule.sourceType as InterlockSourceType, obs);
  const threshold = rule.threshold != null ? Number(rule.threshold) : null;
  return evaluateCondition(
    observed,
    rule.comparisonOperator as ComparisonOperator,
    threshold,
    rule.consecutiveCount,
    obs.series,
  );
}

/** Các action interlock được coi là "chặn máy" (dùng làm allowlist cho cổng inline). */
const INTERLOCK_GATE_ACTIONS: ReadonlySet<string> = new Set([
  "block_downstream",
  "stop_line",
  "reduce_speed",
]);

export interface InterlockGateViolation {
  ruleId: number;
  ruleName: string;
  action: string;
}

export interface InterlockGateResult {
  /** true = có rule chặn đang vi phạm HOẶC lỗi đánh giá (fail-closed) → cấm ghi. */
  blocked: boolean;
  /** true = bị chặn vì lỗi/không đánh giá được (fail-closed), không phải do rule met. */
  failClosed: boolean;
  violations: InterlockGateViolation[];
}

/** Rule có nhắm tới đúng thiết bị/máy của lệnh này không (theo targetAdapterId/targetMachineId/commandTag). */
function isTargeted(
  rule: InterlockRule,
  params: { adapterId: number; machineId?: number | null; tagKeys: string[] },
): boolean {
  const byAdapter = rule.targetAdapterId != null && rule.targetAdapterId === params.adapterId;
  const byMachine =
    rule.targetMachineId != null && params.machineId != null && rule.targetMachineId === params.machineId;
  // commandTag khớp tag đang ghi (và, nếu có targetAdapterId, phải cùng adapter).
  const byTag =
    rule.commandTag != null &&
    params.tagKeys.includes(rule.commandTag) &&
    (rule.targetAdapterId == null || rule.targetAdapterId === params.adapterId);
  return byAdapter || byMachine || byTag;
}

/**
 * CỔNG INTERLOCK ĐỒNG BỘ — dùng inline trong commandDispatcher.dispatch() TRƯỚC
 * mọi real-write cho lệnh HITL.
 *
 * Chỉ xét rule đã enabled + approved (approvedBy != null), có action chặn/dừng
 * (allowlist), và nhắm ĐÚNG target của lệnh (targetAdapterId / targetMachineId /
 * commandTag). Với mỗi rule liên quan, đánh giá điều kiện live: nếu ĐANG vi phạm →
 * ghi vào violations. blocked=true khi có ≥1 vi phạm.
 *
 * FAIL-CLOSED: bất kỳ lỗi nào (không có DB, query lỗi, evaluator ném) → trả
 * { blocked:true, failClosed:true } để dispatcher TỪ CHỐI ghi (an toàn hơn cho phép).
 * Rule proposed/chưa duyệt KHÔNG chặn (không nằm trong tập enabled+approved).
 */
export async function evaluateInterlockGate(params: {
  adapterId: number;
  machineId?: number | null;
  tagKeys: string[];
}): Promise<InterlockGateResult> {
  try {
    const db = await getDb();
    if (!db) return { blocked: true, failClosed: true, violations: [] };

    // Chỉ lấy rule đang enabled; lọc approved + action + target ở app-level.
    const enabledRules = await db
      .select()
      .from(interlockRules)
      .where(eq(interlockRules.enabled, true))
      .limit(1000);

    const relevant = enabledRules.filter(
      (r) => r.approvedBy != null && INTERLOCK_GATE_ACTIONS.has(r.action) && isTargeted(r, params),
    );

    const violations: InterlockGateViolation[] = [];
    for (const rule of relevant) {
      // evaluateRuleCondition có thể ném → nhảy xuống catch → fail-closed.
      const met = await evaluateRuleCondition(rule);
      if (met) violations.push({ ruleId: rule.id, ruleName: rule.name, action: rule.action });
    }

    return { blocked: violations.length > 0, failClosed: false, violations };
  } catch {
    // Lỗi đánh giá bất kỳ → fail-closed: cấm real-write.
    return { blocked: true, failClosed: true, violations: [] };
  }
}
