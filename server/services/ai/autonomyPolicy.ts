/**
 * doc 69 Giai đoạn 4 / Wave 3 — Task D2: BOUNDED-AUTONOMY policy + kill-switch.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Today every AI-proposed write action is full HITL (server/services/aiCopilotActions.ts:
 * proposeAction → a human clicks confirm → confirmAction executes). This module adds the
 * PREDICATE that decides whether a just-proposed action may skip ONLY the human wait — it
 * NEVER decides whether to execute; execution always goes back through the real
 * confirmAction() (RBAC re-check, guardrail enforcement, idempotency, args-from-DB). See the
 * wiring in aiCopilotActions.ts:proposeAction (search "D2 — bounded-autonomy").
 *
 * `evaluateAutonomy()` returns `allowed:true` ONLY when EVERY one of these AND-conditions
 * holds (short-circuit, cheapest first):
 *   1. isAutonomyEnabled()      — master flag AI_AUTONOMY_ENABLED, default OFF. Opt-in.
 *   2. NOT isKillSwitchTripped() — durable, DB-backed, read FRESH every call (no caching).
 *   3. action.type ∉ AUTONOMY_INELIGIBLE — hard-coded denylist. Wins over EVERYTHING,
 *      including a misconfigured allowlist. Never reachable via env/config.
 *   3b. If action.type resolves to a REGISTERED `kind:"write"` tool, it must ALSO be named
 *      in AUTONOMY_REVIEWED_SAFE (with a written reason). A write tool that is in NEITHER
 *      set — i.e. one nobody has triaged — is ineligible (TYPE_UNCLASSIFIED). See the
 *      block above AUTONOMY_REVIEWED_SAFE for why this condition exists at all.
 *   4. action.type ∈ allowlist   — env AI_AUTONOMY_ALLOWLIST, default EMPTY. Nothing
 *      auto-executes until an operator explicitly opts a type in.
 *   5. action.idempotencyKey is present — guards at-most-one execution (defense-in-depth;
 *      the DB unique index on ai_pending_actions.idempotencyKey is the real guarantee).
 *   6. NOT rate-capped           — optional per-user/hour throttle (fail-safe: cap hit ⇒
 *      HITL fallback, never an error).
 *   7. The proposal carries an AdviceContract AND passes the SAME guardrail/requires[]
 *      enforcement the confirm path runs (reused via aiCopilotActions.evaluateContractForAutonomy
 *      — NOT reimplemented here). No contract ⇒ ineligible (autonomy cannot verify a safety
 *      envelope that was never attached). A `human_approval` requirement makes the action
 *      PERMANENTLY ineligible for autonomy — only a live human can satisfy that requirement,
 *      so autonomy must not pretend to satisfy it on their behalf.
 *
 * KILL-SWITCH STORAGE: reuses the existing `ai_system_config` key/value table (already used
 * by server/routers/aiSettingsRouter.ts for other AI runtime settings) — a durable settings/kv
 * table that already fits, so NO new migration is needed. Row absent (never tripped) ⇒ treated
 * as NOT tripped (steady-state default). A genuine read failure (DB unreachable) fails CLOSED
 * (treated as tripped) — the conservative choice for an unexpected error, distinct from the
 * expected "never configured" empty state.
 *
 * FAIL-CLOSED, NOT FAIL-THROW (D2 review Fix 2): `evaluateAutonomy()` is a hard promise —
 * it NEVER rejects. The whole AND-chain is wrapped in try/catch; any unexpected throw
 * anywhere in it (steps 1-7, including the dynamic import in step 7) degrades the decision
 * to `{allowed:false, reason:"AUTONOMY_CHECK_ERROR"}` instead of propagating. The caller
 * (aiCopilotActions.ts:proposeAction) additionally wraps its own autonomy-attempt block so
 * that even a throw from the auto-confirm call itself can never turn a successful propose
 * into an error — the `proposed` row it already inserted is always returned.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import type { AdviceContract, CopilotUser } from "../aiCopilotActions";
import { getTool, isWriteTool } from "../aiLocalTools/toolRegistry";
import type { ToolLang, ToolExecContext } from "../aiLocalTools/toolRegistry";

// ── Master flag + allowlist + rate cap (env, PURE — no I/O) ──────────────────

/** Master gate. Default OFF ⇒ evaluateAutonomy always short-circuits to not-allowed. */
export function isAutonomyEnabled(): boolean {
  return process.env.AI_AUTONOMY_ENABLED === "true";
}

/** Comma-separated action `type`s (tool names) eligible for auto-confirm. Default EMPTY. */
export function getAutonomyAllowlist(): ReadonlySet<string> {
  const raw = process.env.AI_AUTONOMY_ALLOWLIST;
  if (!raw || !raw.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/** Generous default (fail-safe: a cap hit falls back to HITL, never throws). */
export function autonomyMaxPerHour(): number {
  const n = Number(process.env.AI_AUTONOMY_MAX_PER_HOUR);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

/**
 * Hard-coded, config-proof denylist (Mục "ineligible" — brief D2).
 *
 * ENUMERATION BASIS (D2 review Fix 1): built from a FULL `server`-tree scan for every
 * production `Tool` registration with `kind: "write"` — `grep -rn 'kind:\s*"write"'
 * server/`, test files excluded — NOT just the `aiLocalTools/writeHandlers*`
 * directories. The original pass scoped only to those directories and missed
 * `propose_defect_from_vision` (registered in server/services/visionDefectProposal.ts,
 * OUTSIDE aiLocalTools/writeHandlers*, wired from server/routers/aiVisionRouter.ts) —
 * a real quality-disposition write tool that would otherwise have been allowlist-able.
 * Re-run that grep and re-triage every new hit whenever a write tool is added anywhere
 * in `server/`; this set is the safety BACKSTOP, so it must stay provably exhaustive,
 * not just exhaustive over one directory.
 *
 * These action `type`s (== Tool.name, see aiLocalTools/toolRegistry.ts) mutate machine
 * actuation, program/recipe selection, quality/defect DISPOSITIONS, or safety-critical
 * setpoints/specs/limits/interlocks. They can NEVER be auto-confirmed — not even if an
 * operator mistakenly lists them in AI_AUTONOMY_ALLOWLIST. Checked BEFORE the allowlist
 * in evaluateAutonomy so it always wins. When in doubt about a new tool, DENY: the
 * denylist is a backstop, so over-inclusion is safe and under-inclusion is the bug.
 *
 * The small set of write tools DELIBERATELY left eligible-by-config (not blanket-
 * banned) — `acknowledge_alert`, `acknowledge_predictive_alert`,
 * `resolve_predictive_alert`, `create_maintenance_workorder`, `run_rca_analysis`,
 * `request_threshold_review` — change no machine parameter, no quality disposition,
 * and no spec/limit; see server/services/aiLocalTools/writeHandlers/{alerts,
 * maintenance,qualityAdvisory}.ts.
 */
export const AUTONOMY_INELIGIBLE: ReadonlySet<string> = new Set<string>([
  // Direct machine actuation (physical motion/state change) — server/services/aiLocalTools/writeHandlers/machineControl.ts
  "machine_start",
  "machine_stop",
  "machine_pause",
  "machine_reset",
  "select_recipe",
  "download_job",
  "set_machine_param",
  "acknowledge_machine_alarm", // alarm-clear is safety-subsystem-adjacent, not a plain status ack
  // Vision/SPI actuation — server/services/aiLocalTools/writeHandlers/visionControl.ts
  "reject_divert",
  "spi_printer_offset",
  // Vision defect DISPOSITION — server/services/visionDefectProposal.ts (NOT under
  // aiLocalTools/writeHandlers*; found by the full-tree scan, D2 review Fix 1). Attaches
  // a defectCatalogId to an existing measurement result OR creates a brand-new NG
  // result — i.e. it DECIDES what counts as NG/OK. Quality-consequential, not
  // meaningfully reversible ⇒ must never auto-execute.
  "propose_defect_from_vision",
  // PLC/robot program files — control logic, not data — server/services/aiLocalTools/writeHandlers/programmingFile.ts
  "write_project_file",
  /**
   * ★★★ doc 78 PHA B — `run_command` (server/services/aiLocalTools/writeHandlers/repoCommand.ts).
   *
   * Nó SINH TIẾN TRÌNH trên máy chủ: tiêu CPU/RAM thật, chạy tới 4 phút, và `npx vitest run <đường>`
   * **thi hành mã của chính repo** với một đường dẫn do model chọn. Danh sách trắng + hộp cát chặn
   * được *lệnh nào được chạy*; chúng KHÔNG phát biểu gì về *bao nhiêu lượt* hay *lúc nào* — và đó
   * đúng là thứ tự trị quyết định. Một vòng lặp tác nhân tự trị gọi `npm run check` mỗi bước là một
   * cách làm nghẽn máy chủ mà không lệnh nào trong đó "sai".
   * ⇒ Con người bấm duyệt từng lượt. Không có cấu hình nào mở được điều này (denylist thắng allowlist).
   */
  "run_command",
  // Safety interlock rules — server/services/aiLocalTools/writeHandlers/interlock.ts
  "propose_interlock_rule",
  // Quality setpoints / spec limits / thresholds: "safety-critical setpoints" per the D2
  // brief — a bad auto-tightened/loosened limit silently changes what counts as NG/OK.
  "adjust_ng_threshold", // server/services/aiLocalTools/writeHandlers/engineering.ts
  "create_ng_threshold",
  "configure_inspection_param",
  "update_product_quality_target",
  "set_yield_threshold", // server/services/aiLocalTools/writeHandlers/yield.ts
  "create_measurement_point", // server/services/aiLocalTools/writeHandlers/measurementPoint.ts
  "update_measurement_point",
  "set_spec_limits", // server/services/aiLocalTools/writeHandlers.ts (sample/tutorial tool)
]);

/**
 * ★★★ G3-C VIỆC 1 — **DANH SÁCH LÀ MỘT BẢN LIỆT KÊ, VÀ MỘT BẢN LIỆT KÊ KHÔNG BAO GIỜ BIẾT VỀ
 * TOOL THỨ N+1.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `AUTONOMY_INELIGIBLE` ở trên là 21 tên viết cứng. Lưới canh nó (`autonomyPolicy.test.ts`) đối
 * chiếu 21 tên ấy với **một mảng 21 tên viết cứng KHÁC** — hai bản sao của cùng một bản liệt kê,
 * không bên nào đọc registry. Hậu quả đo được: **thêm một write tool mới hôm nay và nó MẶC ĐỊNH
 * đủ tư cách tự trị** (chỉ cần ai đó ghi tên nó vào `AI_AUTONOMY_ALLOWLIST`), mà **không một ca
 * nào đỏ**. Đây đúng lớp lỗi "N+1" repo này đã dính nhiều lần.
 *
 * ⇒ Đảo từ DANH SÁCH sang **VỊ TỪ TRÊN REGISTRY SỐNG**: *mọi* tool `kind:"write"` trong
 * `listTools()` phải nằm trong **một trong hai** tập — `AUTONOMY_INELIGIBLE` (cấm tuyệt đối) hoặc
 * `AUTONOMY_REVIEWED_SAFE` (đã có người đọc và **viết ra lý do**). Tool chưa phân loại ⇒ **CẤM**,
 * cả ở lưới (census) lẫn **lúc chạy** (điều kiện 3b trong `evaluateAutonomyChain`).
 *
 * ⚠⚠ **VÌ SAO PHẢI CƯỠNG CHẾ LÚC CHẠY, KHÔNG CHỈ Ở TEST.** Một lưới chỉ đọc `AUTONOMY_INELIGIBLE
 * .has(name)` là **đọc TÊN ĐỊNH DANH, không đọc thứ tên đó trỏ tới**: xoá nguyên điều kiện 3 khỏi
 * `evaluateAutonomyChain` thì cái Set vẫn còn đủ 21 tên và lưới ấy vẫn **XANH** trong khi mọi lệnh
 * `machine_start` đã tự trị được. Nên tập phân loại này phải **là thứ thật sự cưỡng chế**, và mọi
 * ca phải đi qua `evaluateAutonomy()` — không khẳng định trên `Set.has`.
 *
 * ⚠ Vì sao là `Map<tên, lý do>` chứ không phải `Set<tên>`: một cái tên nằm im trong Set không nói
 * được **ai đã đọc nó và vì sao nó an toàn**. Bắt viết lý do làm cho việc thêm tên vào đây là một
 * **quyết định có chữ ký**, không phải một thao tác làm-cho-lưới-xanh.
 *
 * ⚠ MẶC ĐỊNH ĐÚNG LÀ "CẤM": khi không chắc, xếp vào `AUTONOMY_INELIGIBLE`. Denylist là backstop,
 * thừa thì vô hại, thiếu thì là lỗ.
 *
 * ĐO ĐƯỢC (2026-08-17, registry sống sau khi nạp `aiLocalTools/index` + `visionDefectProposal`):
 * 77 tool — 49 read · 26 write · 2 client. Nạp thêm `visionDefectProposal` (KHÔNG nằm trong đồ
 * thị nhập của `aiLocalTools/index`; `aiVisionRouter.ts` mới là người nạp nó) ⇒ **27 write tool**.
 * 21 tool denylisted + 6 tool dưới đây = 27, phủ kín. Con số "26 − 21 = 5" là **phép trừ sai**:
 * `propose_defect_from_vision` có trong denylist nhưng KHÔNG có trong registry khi chỉ nạp
 * `aiLocalTools/index`, nên chỗ chênh thật là **6 tool**, đúng bằng nhóm dưới đây.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export const AUTONOMY_REVIEWED_SAFE: ReadonlyMap<string, string> = new Map<string, string>([
  // server/services/aiLocalTools/writeHandlers/alerts.ts — ba tool này chỉ đổi TRẠNG THÁI GHI NHẬN
  // của một cảnh báo (ai đã xem / đã xử lý). Không chạm tham số máy, không đổi phán quyết NG/OK,
  // không đổi spec/limit; và mọi tác động đều đảo lại được bằng một thao tác người dùng.
  ["acknowledge_alert", "chỉ ghi nhận đã-xem một cảnh báo; không tham số máy, không phán quyết chất lượng, đảo lại được"],
  ["acknowledge_predictive_alert", "như trên, trên cảnh báo dự đoán (bảng riêng); không chạm thiết bị"],
  ["resolve_predictive_alert", "đóng một cảnh báo dự đoán; chỉ là trạng thái sổ sách, không lệnh xuống máy"],
  // server/services/aiLocalTools/writeHandlers/maintenance.ts
  ["create_maintenance_workorder", "tạo một phiếu công việc bảo trì ở trạng thái chờ; con người vẫn phải nhận và thực thi, không có byte nào rời hệ thống xuống máy"],
  // server/services/aiLocalTools/writeHandlers/qualityAdvisory.ts — hai tool "ghi ra một BẢN GHI",
  // không phải "áp một THAY ĐỔI". `request_threshold_review` cố ý CHỈ tạo YÊU CẦU duyệt ngưỡng —
  // chính vì việc ĐỔI ngưỡng nằm ở `adjust_ng_threshold`/`create_ng_threshold` và cả hai đã bị cấm.
  ["run_rca_analysis", "chạy + lưu một phân tích nguyên nhân gốc; đầu ra là văn bản phân tích, không đổi cấu hình nào"],
  ["request_threshold_review", "chỉ TẠO YÊU CẦU duyệt ngưỡng cho con người; việc ÁP ngưỡng nằm ở adjust_/create_ng_threshold và cả hai đã INELIGIBLE"],
]);

/** Ba trạng thái phân loại tự trị của một tool. `CHUA_PHAN_LOAI` là trạng thái ĐỎ. */
export type PhanLoaiTuTri = "INELIGIBLE" | "REVIEWED_SAFE" | "CHUA_PHAN_LOAI";

/** Phân loại một tên tool theo hai tập trên. Denylist thắng nếu (do sai sót) có ở cả hai. */
export function phanLoaiTuTri(toolName: string): PhanLoaiTuTri {
  if (AUTONOMY_INELIGIBLE.has(toolName)) return "INELIGIBLE";
  if (AUTONOMY_REVIEWED_SAFE.has(toolName)) return "REVIEWED_SAFE";
  return "CHUA_PHAN_LOAI";
}

/**
 * VỊ TỪ CENSUS — nhận một ảnh chụp registry (`listTools()`) và trả về **tên những write tool
 * chưa được phân loại**. Rỗng = phủ kín. Không tự gọi `listTools()` để người gọi quyết định
 * ảnh chụp nào đang được đo (test nạp thêm module đăng ký ngoài `aiLocalTools/index`).
 */
export function writeToolChuaPhanLoai(tools: readonly { name: string; kind?: string }[]): string[] {
  return tools
    .filter((t) => t.kind === "write" && phanLoaiTuTri(t.name) === "CHUA_PHAN_LOAI")
    .map((t) => t.name)
    .sort();
}

// ── Stable decision-reason codes (audited + asserted in tests) ───────────────

export const AUTONOMY_REASONS = {
  OK: "OK",
  MASTER_DISABLED: "MASTER_DISABLED",
  KILL_SWITCH_TRIPPED: "KILL_SWITCH_TRIPPED",
  TYPE_INELIGIBLE: "TYPE_INELIGIBLE_DENYLISTED",
  /**
   * G3-C — write tool CÓ TRONG REGISTRY nhưng KHÔNG có tên trong `AUTONOMY_INELIGIBLE` cũng
   * KHÔNG có trong `AUTONOMY_REVIEWED_SAFE`: chưa ai triage nó. Mặc định là CẤM, kể cả khi
   * người vận hành đã ghi nó vào `AI_AUTONOMY_ALLOWLIST`.
   */
  TYPE_UNCLASSIFIED: "TYPE_UNCLASSIFIED_WRITE_TOOL",
  TYPE_NOT_ALLOWLISTED: "TYPE_NOT_ALLOWLISTED",
  NO_IDEMPOTENCY_KEY: "NO_IDEMPOTENCY_KEY",
  RATE_CAP_EXCEEDED: "RATE_CAP_EXCEEDED",
  NO_ADVICE_CONTRACT: "NO_ADVICE_CONTRACT",
  HUMAN_APPROVAL_REQUIRED: "HUMAN_APPROVAL_REQUIRED",
  /**
   * D2 review Fix 2 — an unexpected throw anywhere in the AND-chain (a sub-check that
   * was supposed to be fail-safe but wasn't, a dynamic import failing, etc.) degrades
   * to this reason instead of rejecting evaluateAutonomy()'s Promise. Fails CLOSED:
   * the caller falls back to HITL exactly as it would for any other declined reason.
   */
  AUTONOMY_CHECK_ERROR: "AUTONOMY_CHECK_ERROR",
} as const;

// ── Kill-switch (durable — DB row, read fresh every call) ────────────────────

/** ai_system_config.key for the autonomy kill-switch row. */
export const AUTONOMY_KILL_SWITCH_KEY = "ai_autonomy_kill_switch";

/**
 * Fresh (uncached) read at decision time. Row absent (never tripped) ⇒ NOT tripped
 * (brief-mandated default — an unconfigured system behaves exactly as before this task).
 * A read failure (DB unreachable) ⇒ fails CLOSED (tripped=true): an unexpected error is
 * NOT the same as "nobody ever configured this," so the conservative read is to block
 * autonomy rather than silently allow it.
 */
export async function isKillSwitchTripped(): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return true;
    const { aiSystemConfig } = await import("../../../drizzle/schema");
    const [row] = await db
      .select()
      .from(aiSystemConfig)
      .where(eq(aiSystemConfig.key, AUTONOMY_KILL_SWITCH_KEY))
      .limit(1);
    if (!row) return false;
    return row.value === "true";
  } catch {
    return true;
  }
}

/** Trip the kill-switch. Durable (survives restart) + instant for every process (no cache). */
export async function tripKillSwitch(reason: string, byUserId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE");
  const { aiSystemConfig } = await import("../../../drizzle/schema");
  await db
    .insert(aiSystemConfig)
    .values({ key: AUTONOMY_KILL_SWITCH_KEY, value: "true", description: reason, updatedBy: byUserId })
    .onConflictDoUpdate({
      target: aiSystemConfig.key,
      set: { value: "true", description: reason, updatedBy: byUserId, updatedAt: new Date() },
    });
}

/** Reset (untrip) the kill-switch. */
export async function untripKillSwitch(byUserId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE");
  const { aiSystemConfig } = await import("../../../drizzle/schema");
  await db
    .insert(aiSystemConfig)
    .values({ key: AUTONOMY_KILL_SWITCH_KEY, value: "false", description: `untripped by user ${byUserId}`, updatedBy: byUserId })
    .onConflictDoUpdate({
      target: aiSystemConfig.key,
      set: { value: "false", description: `untripped by user ${byUserId}`, updatedBy: byUserId, updatedAt: new Date() },
    });
}

// ── Optional per-user/hour auto-execution rate cap (in-memory, fail-safe) ────
//
// Deliberately NOT durable/DB-backed: this is a throttle, not a safety gate (the
// kill-switch is the safety gate). A process restart resetting the counter is
// harmless — worst case a few extra autonomous executions right after a restart,
// still bounded by every OTHER condition above.

const _autonomyExecutionsByUser = new Map<number, number[]>();

function isRateCapped(userId: number): boolean {
  const windowMs = 60 * 60 * 1000;
  const now = Date.now();
  const recent = (_autonomyExecutionsByUser.get(userId) ?? []).filter((t) => now - t < windowMs);
  _autonomyExecutionsByUser.set(userId, recent);
  return recent.length >= autonomyMaxPerHour();
}

/** Called by the wiring in aiCopilotActions.ts ONLY after a real autonomous execution. */
export function recordAutonomousExecution(userId: number): void {
  const recent = _autonomyExecutionsByUser.get(userId) ?? [];
  recent.push(Date.now());
  _autonomyExecutionsByUser.set(userId, recent);
}

/** Test-only: clear the in-memory rate-cap window between test cases. */
export function __resetAutonomyRateCapForTests(): void {
  _autonomyExecutionsByUser.clear();
}

// ── evaluateAutonomy — the single decision predicate ──────────────────────────

export interface AutonomyAction {
  /** The tool/action type (== Tool.name / ai_pending_actions.tool). */
  type: string;
  /** The row's idempotencyKey (must be present — proposeAction always generates one). */
  idempotencyKey?: string | null;
  /** The advice contract attached to the proposal, if any (guardrail + requires[]). */
  contract?: AdviceContract | null;
  /** Server-owned args (read-only; passed through to the guardrail/requires check). */
  args: Record<string, unknown>;
}

export interface AutonomyContext {
  user: CopilotUser;
  tool: string;
  actionId: string;
  lang: ToolLang;
  req?: ToolExecContext["req"];
}

export interface AutonomyDecision {
  allowed: boolean;
  reason: string;
}

/**
 * The bounded-autonomy predicate. See the module doc comment for the full AND-chain.
 *
 * NEVER throws — every sub-check is fail-safe (falls back to `allowed:false`), AND this
 * public entry point wraps the whole chain in try/catch as a hard backstop (D2 review
 * Fix 2): if anything downstream throws for an unforeseen reason (the dynamic import of
 * aiCopilotActions failing, a sub-check that turns out not to be as fail-safe as
 * documented, etc.), the decision degrades to `{allowed:false,
 * reason:"AUTONOMY_CHECK_ERROR"}` — fail CLOSED, the caller falls back to HITL — instead
 * of rejecting the returned Promise. This function must be safe to `await` unconditionally
 * from proposeAction() without a try/catch of its own.
 */
export async function evaluateAutonomy(action: AutonomyAction, ctx: AutonomyContext): Promise<AutonomyDecision> {
  try {
    return await evaluateAutonomyChain(action, ctx);
  } catch {
    return { allowed: false, reason: AUTONOMY_REASONS.AUTONOMY_CHECK_ERROR };
  }
}

/** The actual AND-chain (see evaluateAutonomy's docstring for the fail-closed wrapper). */
async function evaluateAutonomyChain(action: AutonomyAction, ctx: AutonomyContext): Promise<AutonomyDecision> {
  // 1. Master flag — cheapest, no I/O. OFF ⇒ zero behavior change vs. pre-D2.
  if (!isAutonomyEnabled()) {
    return { allowed: false, reason: AUTONOMY_REASONS.MASTER_DISABLED };
  }

  // 2. Kill-switch — durable, read FRESH (a trip between propose and this check blocks it).
  if (await isKillSwitchTripped()) {
    return { allowed: false, reason: AUTONOMY_REASONS.KILL_SWITCH_TRIPPED };
  }

  // 3. Hard-coded denylist ALWAYS wins — checked before the allowlist so a
  //    misconfigured allowlist can never override it.
  if (AUTONOMY_INELIGIBLE.has(action.type)) {
    return { allowed: false, reason: AUTONOMY_REASONS.TYPE_INELIGIBLE };
  }

  // 3b. G3-C — VỊ TỪ, KHÔNG PHẢI DANH SÁCH. Tra `action.type` trong registry SỐNG: nếu nó là một
  //     tool `kind:"write"` thật sự đang đăng ký mà CHƯA được triage vào một trong hai tập, cấm.
  //     ⇒ Một write tool MỚI thêm hôm nay **mặc định KHÔNG** đủ tư cách tự trị, kể cả khi có người
  //     ghi tên nó vào allowlist. Đây là chỗ điều kiện này phải sống: cưỡng chế ở đường quyết
  //     định, chứ một khẳng định `Set.has(...)` trong test thì đột biến "xoá điều kiện 3" sống sót.
  //     ⚠ `getTool` trả `undefined` cho tên không (chưa) đăng ký ⇒ điều kiện này KHÔNG phát biểu
  //     gì về nó; hình dạng ấy vẫn bị các điều kiện 4-7 chặn như trước (allowlist rỗng mặc định),
  //     và `proposeAction` chỉ đề xuất được từ một `Tool` có thật nên đường thật luôn tra được.
  if (isWriteTool(getTool(action.type)) && !AUTONOMY_REVIEWED_SAFE.has(action.type)) {
    return { allowed: false, reason: AUTONOMY_REASONS.TYPE_UNCLASSIFIED };
  }

  // 4. Allowlist — empty by default ⇒ nothing qualifies until explicitly configured.
  if (!getAutonomyAllowlist().has(action.type)) {
    return { allowed: false, reason: AUTONOMY_REASONS.TYPE_NOT_ALLOWLISTED };
  }

  // 5. idempotencyKey must be present (defense-in-depth against double-execution).
  if (!action.idempotencyKey) {
    return { allowed: false, reason: AUTONOMY_REASONS.NO_IDEMPOTENCY_KEY };
  }

  // 6. Rate cap — fail-safe: cap hit falls back to HITL, never an error.
  if (isRateCapped(ctx.user.id)) {
    return { allowed: false, reason: AUTONOMY_REASONS.RATE_CAP_EXCEEDED };
  }

  // 7. Guardrail contract — MUST be present + in-band + requires[] satisfied. Reuses the
  //    SAME enforcement the confirm path runs (server/services/aiCopilotActions.ts
  //    evaluateContractForAutonomy → enforceAdviceContract) — never reimplemented here.
  //    Dynamic import avoids a top-level circular import (aiCopilotActions.ts imports THIS
  //    module at the top level to call evaluateAutonomy).
  const { evaluateContractForAutonomy } = await import("../aiCopilotActions");
  const contractCheck = await evaluateContractForAutonomy(action.contract ?? null, {
    user: ctx.user,
    tool: action.type,
    actionId: ctx.actionId,
    args: action.args,
    lang: ctx.lang,
  });
  if (!contractCheck.ok) {
    return { allowed: false, reason: contractCheck.reason ?? AUTONOMY_REASONS.NO_ADVICE_CONTRACT };
  }

  return { allowed: true, reason: AUTONOMY_REASONS.OK };
}
