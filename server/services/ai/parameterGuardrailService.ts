/**
 * doc 44 W5-A2 (gaps G4.18/G4.19/G4.20) — Parameter guardrail service.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SYNAPSE Tầng-4 §9.2 + §18.1: mọi thay đổi tham số (setpoint) bị CHẶN CỨNG bởi
 * dải min–max do kỹ sư quá trình đặt. Trước batch này set_machine_param nhận value
 * tùy ý KHÔNG kiểm dải số học. Service này khép ba lỗ:
 *
 *   G4.18 guardrail cứng  — resolveGuardrail + checkValue: vi phạm dải = REJECT
 *                           HONEST (OUT_OF_RANGE), KHÔNG clamp im lặng. max_step
 *                           = STEP_TOO_LARGE (§9.2 "bước nhỏ, có kiểm chứng").
 *   G4.19 twin-first      — evaluateTwinValidation: param requires_twin_validation
 *                           → kiểm twin (line của máy) trusted trước khi đề xuất.
 *   G4.20 closed-loop     — recordChange + sweepParamVerify: sau verify_after so
 *                           metrics_before vs hiện tại → improved|degraded|neutral;
 *                           degraded → Andon (routeAlert) kèm old_value.
 *
 * FLAGS (mọi cờ mới DEFAULT OFF/bảo thủ):
 *   PARAM_GUARDRAIL_ENABLED  (OFF) — bật enforce tại set_machine_param (bit-compat OFF).
 *   PARAM_GUARDRAIL_STRICT   (OFF) — param KHÔNG có guardrail: OFF=cho qua+log; ON=reject NO_GUARDRAIL.
 *   PARAM_VERIFY_ENABLED     (OFF) — bật sweep closed-loop verify.
 *   PARAM_VERIFY_DELAY_MS    (4h)  — chờ trước khi verify một thay đổi.
 *   PARAM_VERIFY_INTERVAL_MS (1h, floor 5m) — nhịp sweep.
 *   PARAM_VERIFY_EPSILON_PCT (0.5) — |ΔNG-rate| dưới ngưỡng ⇒ neutral.
 *
 * Fail-safe: mọi hàm IO nuốt lỗi (không ném ra ngoài đường thực thi lệnh); DB
 * không sẵn sàng ⇒ hành vi bảo thủ (không chặn oan, không bịa metric).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  parameterGuardrails,
  parameterChangeLog,
  type ParameterGuardrail,
  type ParameterChangeSource,
  type ParameterVerifyStatus,
} from "../../../drizzle/schema";

// ── flags / config (PURE) ─────────────────────────────────────────────────────

export function paramGuardrailEnabled(): boolean {
  return process.env.PARAM_GUARDRAIL_ENABLED === "true";
}
export function paramGuardrailStrict(): boolean {
  return process.env.PARAM_GUARDRAIL_STRICT === "true";
}
export function paramVerifyEnabled(): boolean {
  return process.env.PARAM_VERIFY_ENABLED === "true";
}
export function paramVerifyDelayMs(): number {
  const n = Number(process.env.PARAM_VERIFY_DELAY_MS);
  return Number.isFinite(n) && n >= 0 ? n : 4 * 60 * 60 * 1000; // 4h
}
export function paramVerifyIntervalMs(): number {
  const n = Number(process.env.PARAM_VERIFY_INTERVAL_MS);
  // floor 5 min so a typo cannot melt the DB.
  return Number.isFinite(n) && n >= 5 * 60_000 ? n : 60 * 60 * 1000; // 1h
}
/** |ΔNG-rate| (percentage points) below which a change is judged 'neutral'. */
export function paramVerifyEpsilonPct(): number {
  const n = Number(process.env.PARAM_VERIFY_EPSILON_PCT);
  return Number.isFinite(n) && n >= 0 ? n : 0.5;
}

// ── pure helpers (unit-tested, no IO) ─────────────────────────────────────────

/** Coerce a tool value (number | string | boolean) to a finite number, else null. */
export function coerceNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return null; // booleans have no numeric range
  if (typeof v === "string") {
    const n = Number(v.trim());
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  }
  return null;
}

export type GuardrailSummary = { min: number; max: number; maxStep: number | null; unit: string | null };

export type CheckResult =
  | { ok: true }
  | { ok: false; code: "OUT_OF_RANGE" | "STEP_TOO_LARGE" | "NO_GUARDRAIL"; detail: string; guardrail?: GuardrailSummary };

function summarize(g: Pick<ParameterGuardrail, "minValue" | "maxValue" | "maxStep" | "unit">): GuardrailSummary {
  return { min: g.minValue, max: g.maxValue, maxStep: g.maxStep ?? null, unit: g.unit ?? null };
}

/**
 * PURE guardrail decision. A param WITH a guardrail that is violated ⇒ honest
 * REJECT (never a silent clamp — SYNAPSE §9.2). A param WITHOUT a guardrail:
 * strict=false ⇒ allowed (caller logs); strict=true ⇒ NO_GUARDRAIL reject.
 * Non-numeric writes (boolean flags / string enums) carry no numeric range ⇒ ok.
 */
export function checkAgainstGuardrail(
  guardrail: Pick<ParameterGuardrail, "minValue" | "maxValue" | "maxStep" | "unit"> | null | undefined,
  newValue: unknown,
  oldValue?: unknown,
  opts: { strict?: boolean } = {},
): CheckResult {
  if (!guardrail) {
    if (opts.strict) {
      return {
        ok: false,
        code: "NO_GUARDRAIL",
        detail: "Tham số chưa có dải an toàn (guardrail) do kỹ sư đặt — bị từ chối ở chế độ nghiêm ngặt.",
      };
    }
    return { ok: true };
  }
  const num = coerceNumber(newValue);
  if (num === null) return { ok: true }; // non-numeric → no numeric guardrail applies
  const g = summarize(guardrail);
  const unit = g.unit ? ` ${g.unit}` : "";
  if (num < g.min || num > g.max) {
    return {
      ok: false,
      code: "OUT_OF_RANGE",
      detail: `Giá trị ${num}${unit} nằm ngoài dải cho phép [${g.min}, ${g.max}]${unit}.`,
      guardrail: g,
    };
  }
  if (g.maxStep != null) {
    const old = coerceNumber(oldValue);
    if (old !== null) {
      const step = Math.abs(num - old);
      if (step > g.maxStep) {
        return {
          ok: false,
          code: "STEP_TOO_LARGE",
          detail: `Bước thay đổi ${step}${unit} (từ ${old} → ${num}) vượt bước tối đa ${g.maxStep}${unit}. Hãy đổi từng bước nhỏ, kiểm chứng.`,
          guardrail: g,
        };
      }
    }
  }
  return { ok: true };
}

export type TwinValidationStatus = "passed" | "untrusted" | "skipped";

/**
 * PURE twin-first verdict (SYNAPSE §18.1 chốt #2). Only meaningful when a
 * guardrail marks the param as requiring twin validation.
 *   required=false          ⇒ undefined (not applicable → attach nothing).
 *   no line resolvable       ⇒ 'skipped' (honest — cannot validate).
 *   twin trusted             ⇒ 'passed'.
 *   twin untrusted / unknown ⇒ 'untrusted'.
 */
export function decideTwinValidation(
  required: boolean,
  lineId: number | null,
  trusted: boolean | null,
): TwinValidationStatus | undefined {
  if (!required) return undefined;
  if (lineId == null) return "skipped";
  return trusted === true ? "passed" : "untrusted";
}

export type MachineMetrics = { ngRatePct?: number; total?: number; computedAt?: string };

/**
 * PURE closed-loop verdict from a before/after KPI snapshot (SYNAPSE §16).
 * Lower NG-rate ⇒ 'improved'; higher ⇒ 'degraded'; within epsilon or data
 * insufficient ⇒ 'neutral' (honest — cannot claim a change we can't measure).
 */
export function compareMetrics(
  before: MachineMetrics | null | undefined,
  after: MachineMetrics | null | undefined,
  epsilonPct = paramVerifyEpsilonPct(),
): ParameterVerifyStatus {
  const b = before?.ngRatePct;
  const a = after?.ngRatePct;
  if (b == null || a == null || !Number.isFinite(b) || !Number.isFinite(a)) return "neutral";
  if ((before?.total ?? 0) <= 0 || (after?.total ?? 0) <= 0) return "neutral";
  const delta = a - b; // + means NG-rate rose (worse)
  if (delta < -epsilonPct) return "improved";
  if (delta > epsilonPct) return "degraded";
  return "neutral";
}

// ── guardrail resolution (IO, fail-safe) ──────────────────────────────────────

/**
 * Resolve the effective guardrail for (machine, param). A machine-specific row
 * WINS over a machine_type default. Fail-safe: DB down / table absent ⇒ null.
 */
export async function resolveGuardrail(machineId: number, paramKey: string): Promise<ParameterGuardrail | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const [specific] = await db
      .select()
      .from(parameterGuardrails)
      .where(and(eq(parameterGuardrails.scope, "machine"), eq(parameterGuardrails.machineId, machineId), eq(parameterGuardrails.paramKey, paramKey)))
      .limit(1);
    if (specific) return specific;
    // Fall back to the machine's type default.
    const machineType = await resolveMachineType(machineId);
    if (machineType) {
      const [byType] = await db
        .select()
        .from(parameterGuardrails)
        .where(and(eq(parameterGuardrails.scope, "machine_type"), eq(parameterGuardrails.machineType, machineType), eq(parameterGuardrails.paramKey, paramKey)))
        .limit(1);
      if (byType) return byType;
    }
    return null;
  } catch {
    return null;
  }
}

/** Machine's type (for machine_type-scoped guardrail fallback). Fail-safe → null. */
async function resolveMachineType(machineId: number): Promise<string | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const { machines } = await import("../../../drizzle/schema");
    const rows = await db
      .select({ type: machines.machineType })
      .from(machines)
      .where(eq(machines.id, machineId))
      .limit(1);
    return rows[0]?.type ?? null;
  } catch {
    return null;
  }
}

/**
 * Async guardrail check for (machine, param). Resolves the effective guardrail,
 * then applies the PURE decision with the current strict flag.
 */
export async function checkValue(
  machineId: number,
  paramKey: string,
  newValue: unknown,
  oldValue?: unknown,
): Promise<CheckResult> {
  const guardrail = await resolveGuardrail(machineId, paramKey);
  return checkAgainstGuardrail(guardrail, newValue, oldValue, { strict: paramGuardrailStrict() });
}

/** Whether a param needs twin-first validation before an AI proposal. Fail-safe → false. */
export async function isTwinValidationRequired(machineId: number, paramKey: string): Promise<boolean> {
  const g = await resolveGuardrail(machineId, paramKey);
  return g?.requiresTwinValidation === true;
}

/** Does this machine have ANY guardrail requiring twin validation? Fail-safe → false. */
async function machineRequiresTwinValidation(machineId: number, paramKey?: string): Promise<boolean> {
  try {
    if (paramKey) return isTwinValidationRequired(machineId, paramKey);
    const db = await getDb();
    if (!db) return false;
    const rows = await db
      .select({ id: parameterGuardrails.id })
      .from(parameterGuardrails)
      .where(and(eq(parameterGuardrails.scope, "machine"), eq(parameterGuardrails.machineId, machineId), eq(parameterGuardrails.requiresTwinValidation, true)))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Resolve the production line a machine belongs to (machine → station → line). Fail-safe → null. */
export async function resolveLineForMachine(machineId: number): Promise<number | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const { machines, stations } = await import("../../../drizzle/schema");
    const rows = await db
      .select({ lineId: stations.lineId })
      .from(machines)
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .where(eq(machines.id, machineId))
      .limit(1);
    return rows[0]?.lineId ?? null;
  } catch {
    return null;
  }
}

/**
 * G4.19 twin-first verdict for an AI proposal touching `machineId`. Returns
 * undefined when no guardrail requires twin validation (attach nothing);
 * otherwise 'passed' | 'untrusted' | 'skipped'. Uses the REAL twin trust store
 * (twinFidelityService.isTwinTrusted). Fail-safe → undefined (never blocks here;
 * hard blocking is the Policy/A3 contract).
 */
export async function evaluateTwinValidation(
  machineId: number | null | undefined,
  paramKey?: string,
): Promise<TwinValidationStatus | undefined> {
  try {
    if (machineId == null) return undefined;
    const required = await machineRequiresTwinValidation(machineId, paramKey);
    if (!required) return undefined;
    const lineId = await resolveLineForMachine(machineId);
    if (lineId == null) return decideTwinValidation(true, null, null);
    const { isTwinTrusted } = await import("../twin/twinFidelityService");
    const trusted = await isTwinTrusted(`line:${lineId}`);
    return decideTwinValidation(true, lineId, trusted);
  } catch {
    return undefined;
  }
}

// ── change log (append-only, IO) ──────────────────────────────────────────────

/** Most recent recorded value for (machine, param) — used as the max-step baseline. Fail-safe → null. */
export async function lastKnownValue(machineId: number, paramKey: string): Promise<number | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = await db
      .select({ v: parameterChangeLog.newValue })
      .from(parameterChangeLog)
      .where(and(eq(parameterChangeLog.machineId, machineId), eq(parameterChangeLog.paramKey, paramKey), isNotNull(parameterChangeLog.newValue)))
      .orderBy(desc(parameterChangeLog.id))
      .limit(1);
    return rows[0]?.v ?? null;
  } catch {
    return null;
  }
}

/**
 * Compute a compact machine KPI snapshot (NG-rate over a recent window) for the
 * closed-loop verify. Fail-safe → {} (no fabrication when data/DB absent).
 */
export async function computeMachineMetrics(machineId: number, windowHours = 24): Promise<MachineMetrics> {
  try {
    const db = await getDb();
    if (!db) return {};
    const { productInspections, measurementResults } = await import("../../../drizzle/schema");
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const [row] = await db
      .select({
        total: sql<number>`COUNT(*)`.as("total"),
        ng: sql<number>`SUM(CASE WHEN ${measurementResults.result} = 'NG' THEN 1 ELSE 0 END)`.as("ng"),
      })
      .from(measurementResults)
      .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
      .where(and(eq(productInspections.machineId, machineId), sql`${productInspections.inspectionTime} >= ${since}`));
    const total = Number(row?.total ?? 0);
    const ng = Number(row?.ng ?? 0);
    if (total <= 0) return { total: 0, computedAt: new Date().toISOString() };
    return { ngRatePct: (ng / total) * 100, total, computedAt: new Date().toISOString() };
  } catch {
    return {};
  }
}

export interface RecordChangeInput {
  machineId: number;
  paramKey: string;
  oldValue?: unknown;
  newValue: unknown;
  source: ParameterChangeSource;
  guardrailId?: number | null;
  correlationId?: string | null;
  /** Pre-computed before-snapshot; when omitted it is measured now. */
  metricsBefore?: MachineMetrics;
}

/**
 * Append a change to the log with verify_after = now + PARAM_VERIFY_DELAY and a
 * before-KPI snapshot. Only records NUMERIC changes (the log columns are double).
 * Fail-safe: returns the row id or null; never throws into the command path.
 */
export async function recordChange(input: RecordChangeInput): Promise<number | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const newNum = coerceNumber(input.newValue);
    if (newNum === null) return null; // non-numeric → nothing to verify
    const oldNum = coerceNumber(input.oldValue);
    const metricsBefore = input.metricsBefore ?? (await computeMachineMetrics(input.machineId));
    const now = new Date();
    const [row] = await db
      .insert(parameterChangeLog)
      .values({
        machineId: input.machineId,
        paramKey: input.paramKey,
        oldValue: oldNum,
        newValue: newNum,
        source: input.source,
        guardrailId: input.guardrailId ?? null,
        verifyStatus: "pending",
        verifyAfter: new Date(now.getTime() + paramVerifyDelayMs()),
        metricsBefore,
        correlationId: input.correlationId ?? null,
        ts: now,
      })
      .returning({ id: parameterChangeLog.id });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

// ── CRUD (router surface) ─────────────────────────────────────────────────────

export interface SetGuardrailInput {
  scope: "machine" | "machine_type";
  machineId?: number | null;
  machineType?: string | null;
  paramKey: string;
  minValue: number;
  maxValue: number;
  maxStep?: number | null;
  unit?: string | null;
  requiresTwinValidation?: boolean;
  notes?: string | null;
  setBy?: number | null;
}

export type SetGuardrailResult =
  | { ok: true; id: number; created: boolean }
  | { ok: false; code: "INVALID_RANGE" | "INVALID_TARGET" | "NO_DB"; message: string };

/** Upsert a guardrail (engineer authoring). Machine-specific or type-default. */
export async function setGuardrail(input: SetGuardrailInput): Promise<SetGuardrailResult> {
  if (!(input.maxValue > input.minValue)) {
    return { ok: false, code: "INVALID_RANGE", message: "max_value phải lớn hơn min_value." };
  }
  if (input.maxStep != null && !(input.maxStep > 0)) {
    return { ok: false, code: "INVALID_RANGE", message: "max_step phải > 0 (hoặc bỏ trống)." };
  }
  if (input.scope === "machine" && input.machineId == null) {
    return { ok: false, code: "INVALID_TARGET", message: "scope='machine' cần machine_id." };
  }
  if (input.scope === "machine_type" && !input.machineType) {
    return { ok: false, code: "INVALID_TARGET", message: "scope='machine_type' cần machine_type." };
  }
  const db = await getDb();
  if (!db) return { ok: false, code: "NO_DB", message: "Cơ sở dữ liệu không sẵn sàng." };

  const values = {
    scope: input.scope,
    machineId: input.scope === "machine" ? input.machineId ?? null : null,
    machineType: input.scope === "machine_type" ? input.machineType ?? null : null,
    paramKey: input.paramKey,
    minValue: input.minValue,
    maxValue: input.maxValue,
    maxStep: input.maxStep ?? null,
    unit: input.unit ?? null,
    requiresTwinValidation: input.requiresTwinValidation ?? false,
    notes: input.notes ?? null,
    setBy: input.setBy ?? null,
    updatedAt: new Date(),
  };

  // Two-step upsert (partial unique indexes make onConflict targeting awkward).
  const existing = await findExactGuardrail(input);
  if (existing) {
    await db.update(parameterGuardrails).set(values).where(eq(parameterGuardrails.id, existing.id));
    return { ok: true, id: existing.id, created: false };
  }
  const [row] = await db.insert(parameterGuardrails).values(values).returning({ id: parameterGuardrails.id });
  return { ok: true, id: row.id, created: true };
}

async function findExactGuardrail(input: SetGuardrailInput): Promise<{ id: number } | null> {
  const db = await getDb();
  if (!db) return null;
  const conds =
    input.scope === "machine"
      ? [eq(parameterGuardrails.scope, "machine"), eq(parameterGuardrails.machineId, input.machineId as number), eq(parameterGuardrails.paramKey, input.paramKey)]
      : [eq(parameterGuardrails.scope, "machine_type"), eq(parameterGuardrails.machineType, input.machineType as string), eq(parameterGuardrails.paramKey, input.paramKey)];
  const [row] = await db.select({ id: parameterGuardrails.id }).from(parameterGuardrails).where(and(...conds)).limit(1);
  return row ?? null;
}

export async function listGuardrails(filter?: { machineId?: number; machineType?: string }): Promise<ParameterGuardrail[]> {
  const db = await getDb();
  if (!db) return [];
  const conds: any[] = [];
  if (filter?.machineId != null) conds.push(eq(parameterGuardrails.machineId, filter.machineId));
  if (filter?.machineType) conds.push(eq(parameterGuardrails.machineType, filter.machineType));
  const q = db.select().from(parameterGuardrails);
  const rows = conds.length ? await q.where(and(...conds)) : await q;
  return rows;
}

export async function getGuardrail(id: number): Promise<ParameterGuardrail | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(parameterGuardrails).where(eq(parameterGuardrails.id, id)).limit(1);
  return row ?? null;
}

export async function deleteGuardrail(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const res: any = await db.delete(parameterGuardrails).where(eq(parameterGuardrails.id, id));
  return (res?.rowCount ?? 1) > 0;
}

export async function listChangeLog(filter?: { machineId?: number; paramKey?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conds: any[] = [];
  if (filter?.machineId != null) conds.push(eq(parameterChangeLog.machineId, filter.machineId));
  if (filter?.paramKey) conds.push(eq(parameterChangeLog.paramKey, filter.paramKey));
  const limit = Math.max(1, Math.min(500, filter?.limit ?? 100));
  const base = db.select().from(parameterChangeLog);
  const q = conds.length ? base.where(and(...conds)) : base;
  return q.orderBy(desc(parameterChangeLog.id)).limit(limit);
}

// ── closed-loop verify sweep (G4.20) ──────────────────────────────────────────

export interface VerifySweepResult {
  verified: number;
  improved: number;
  degraded: number;
  neutral: number;
}

/**
 * Verify pending changes whose verify_after has elapsed: measure the machine's
 * current KPIs, compare vs metrics_before, persist the verdict, and route ONE
 * Andon warning per degraded change (kèm old_value). Non-overlapping.
 */
export async function sweepParamVerify(): Promise<VerifySweepResult> {
  const out: VerifySweepResult = { verified: 0, improved: 0, degraded: 0, neutral: 0 };
  if (sweeping || !paramVerifyEnabled()) return out;
  sweeping = true;
  try {
    const db = await getDb();
    if (!db) return out;
    const now = new Date();
    const pending = await db
      .select()
      .from(parameterChangeLog)
      .where(and(eq(parameterChangeLog.verifyStatus, "pending"), isNotNull(parameterChangeLog.machineId), isNotNull(parameterChangeLog.verifyAfter), lte(parameterChangeLog.verifyAfter, now)))
      .orderBy(parameterChangeLog.id)
      .limit(200);

    for (const row of pending) {
      try {
        const machineId = row.machineId as number;
        const metricsAfter = await computeMachineMetrics(machineId);
        const status = compareMetrics(row.metricsBefore as MachineMetrics | null, metricsAfter);
        await db
          .update(parameterChangeLog)
          .set({ verifyStatus: status, verifiedAt: new Date(), metricsAfter })
          .where(eq(parameterChangeLog.id, row.id));
        out.verified++;
        if (status === "improved") out.improved++;
        else if (status === "degraded") out.degraded++;
        else out.neutral++;

        if (status === "degraded") {
          try {
            const { routeAlert } = await import("../aiSmartAlertRouter");
            await routeAlert({
              type: "PATTERN_ANOMALY",
              severity: "MEDIUM",
              machineId,
              message:
                `Thay đổi tham số "${row.paramKey}" trên máy #${machineId} khiến chất lượng XẤU ĐI ` +
                `(NG-rate ${fmtPct(row.metricsBefore)} → ${fmtPct(metricsAfter)}). ` +
                `Cân nhắc LÙI về giá trị cũ ${row.oldValue ?? "?"}.`,
              data: {
                paramKey: row.paramKey,
                oldValue: row.oldValue ?? null,
                newValue: row.newValue ?? null,
                metricsBefore: row.metricsBefore ?? null,
                metricsAfter,
                changeLogId: row.id,
                runbookRef: "rb-param-rollback",
              },
            });
          } catch (err) {
            console.error("[paramVerify] routeAlert failed:", (err as Error)?.message ?? err);
          }
        }
      } catch (err) {
        console.error(`[paramVerify] change ${row.id} verify failed:`, (err as Error)?.message ?? err);
      }
    }
  } finally {
    sweeping = false;
  }
  return out;
}

function fmtPct(m: unknown): string {
  const v = (m as MachineMetrics | null)?.ngRatePct;
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(2)}%` : "?";
}

// ── sweep lifecycle (mirror twinFidelityService) ──────────────────────────────

let sweepTimer: NodeJS.Timeout | null = null;
let sweeping = false;

/** Start the verify sweep. No-op unless PARAM_VERIFY_ENABLED=true. Idempotent. */
export function startParamVerifySweep(): void {
  if (sweepTimer || !paramVerifyEnabled()) return;
  const interval = paramVerifyIntervalMs();
  sweepTimer = setInterval(() => {
    void sweepParamVerify().catch((err) => console.error("[paramVerify] sweep failed:", (err as Error)?.message ?? err));
  }, interval);
  sweepTimer.unref?.();
  console.log(`[paramVerify] closed-loop verify sweep started (every ${Math.round(interval / 60000)} min)`);
}

export function stopParamVerifySweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/** Test-only: reset the in-process sweep latch. */
export function _resetParamVerifyForTests(): void {
  stopParamVerifySweep();
  sweeping = false;
}
