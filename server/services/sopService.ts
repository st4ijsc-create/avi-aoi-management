/**
 * doc 44 W6-1 (G5.14) — e-SOP service (SYNAPSE LDS-L5 §6.2).
 *
 * CRUD định nghĩa SOP (draft→active→retired, versioned) + thực thi (start /
 * confirm-step / finish) với cổng-xác-nhận cưỡng chế bằng sopExecutionLogic
 * (pure). Xuất sopReadinessContribution() cho Line Controller readiness dùng
 * (W6-1 chỉ export — KHÔNG sửa lineController).
 *
 * KHÔNG có đường ghi xuống máy — đây là catalog + sổ thao tác tay (genealogy con
 * người). Mọi hàm đọc DB fail-safe: DB null → ném rõ ràng (router bọc).
 */
import { and, asc, desc, eq, ne, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  sops,
  sopSteps,
  sopExecutions,
  type SopRow,
  type SopStepRow,
  type SopExecutionRow,
  type SopStatus,
  type SopStepConfirmation,
} from "../../drizzle/schema";
import {
  computeExecutionProgress,
  validateStepConfirmation,
  canFinishExecution,
  upsertConfirmation,
  type SopStepLite,
  type StepConfirmCode,
} from "./sopExecutionLogic";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

// ─── Định nghĩa SOP: đọc ──────────────────────────────────────────────────────

export interface ListSopFilter {
  status?: SopStatus;
  productModelId?: number | null;
  stationId?: number | null;
  code?: string;
  limit?: number;
}

/** Danh sách SOP (kèm số bước) — mới nhất trước, lọc theo status/product/station/code. */
export async function listSops(filter: ListSopFilter = {}): Promise<Array<SopRow & { stepCount: number }>> {
  const d = await db();
  const conds = [];
  if (filter.status) conds.push(eq(sops.status, filter.status));
  if (filter.productModelId != null) conds.push(eq(sops.productModelId, filter.productModelId));
  if (filter.stationId != null) conds.push(eq(sops.stationId, filter.stationId));
  if (filter.code) conds.push(eq(sops.code, filter.code));

  const rows = await d
    .select()
    .from(sops)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(sops.updatedAt))
    .limit(Math.min(Math.max(filter.limit ?? 200, 1), 500));

  if (rows.length === 0) return [];
  const counts = await d
    .select({ sopId: sopSteps.sopId, n: sql<number>`count(*)::int` })
    .from(sopSteps)
    .where(inArray(sopSteps.sopId, rows.map((r) => r.id)))
    .groupBy(sopSteps.sopId);
  const byId = new Map(counts.map((c) => [c.sopId, Number(c.n)]));
  return rows.map((r) => ({ ...r, stepCount: byId.get(r.id) ?? 0 }));
}

/** Một SOP + các bước (ordered). null khi không tồn tại. */
export async function getSop(id: number): Promise<(SopRow & { steps: SopStepRow[] }) | null> {
  const d = await db();
  const [row] = await d.select().from(sops).where(eq(sops.id, id)).limit(1);
  if (!row) return null;
  const steps = await d.select().from(sopSteps).where(eq(sopSteps.sopId, id)).orderBy(asc(sopSteps.stepNo));
  return { ...row, steps };
}

/**
 * Chọn SOP ĐANG HIỆU LỰC theo ngữ cảnh (spec §6.2 "đúng bước hiện tại theo ngữ
 * cảnh sản phẩm/trạm"). Ưu tiên khớp CHẶT nhất: (product+station) > station >
 * product > chung (null,null). Chỉ status='active'.
 */
export async function resolveActiveSop(ctx: {
  productModelId?: number | null;
  stationId?: number | null;
}): Promise<(SopRow & { steps: SopStepRow[] }) | null> {
  const d = await db();
  const active = await d.select().from(sops).where(eq(sops.status, "active"));
  if (active.length === 0) return null;

  const pid = ctx.productModelId ?? null;
  const sid = ctx.stationId ?? null;
  const score = (s: SopRow): number => {
    // Loại các SOP gắn ngữ cảnh KHÁC với yêu cầu (mismatch) — chỉ nhận khớp hoặc null.
    if (s.productModelId != null && pid != null && s.productModelId !== pid) return -1;
    if (s.stationId != null && sid != null && s.stationId !== sid) return -1;
    if (s.productModelId != null && pid == null) return -1;
    if (s.stationId != null && sid == null) return -1;
    let v = 0;
    if (s.productModelId != null && s.productModelId === pid) v += 2;
    if (s.stationId != null && s.stationId === sid) v += 1;
    return v; // 0 = SOP chung (null,null)
  };
  const ranked = active
    .map((s) => ({ s, v: score(s) }))
    .filter((x) => x.v >= 0)
    .sort((a, b) => b.v - a.v || b.s.version - a.s.version);
  if (ranked.length === 0) return null;
  return getSop(ranked[0].s.id);
}

// ─── Định nghĩa SOP: ghi ──────────────────────────────────────────────────────

export interface SopStepInput {
  stepNo: number;
  text: string;
  mediaRef?: string | null;
  requiresConfirm?: boolean;
  expectedInput?: string | null;
}

export interface CreateSopInput {
  code: string;
  title: string;
  description?: string | null;
  productModelId?: number | null;
  stationId?: number | null;
  version?: number;
  status?: SopStatus;
  steps?: SopStepInput[];
  createdBy?: number | null;
}

/** Tạo SOP mới (+ bước). version mặc định = max(version của code)+1 nếu chưa truyền. */
export async function createSop(input: CreateSopInput): Promise<SopRow & { steps: SopStepRow[] }> {
  const d = await db();
  let version = input.version;
  if (version == null) {
    const [mx] = await d
      .select({ v: sql<number>`coalesce(max(${sops.version}), 0)::int` })
      .from(sops)
      .where(eq(sops.code, input.code));
    version = Number(mx?.v ?? 0) + 1;
  }
  const [row] = await d
    .insert(sops)
    .values({
      code: input.code,
      title: input.title,
      description: input.description ?? null,
      productModelId: input.productModelId ?? null,
      stationId: input.stationId ?? null,
      version,
      status: input.status ?? "draft",
      createdBy: input.createdBy ?? null,
    })
    .returning();
  const steps = await replaceSteps(row.id, input.steps ?? []);
  return { ...row, steps };
}

/** Thay TOÀN BỘ bước của một SOP (xóa cũ, chèn mới). Trả bước mới (ordered). */
export async function replaceSteps(sopId: number, steps: SopStepInput[]): Promise<SopStepRow[]> {
  const d = await db();
  await d.delete(sopSteps).where(eq(sopSteps.sopId, sopId));
  if (steps.length === 0) return [];
  const values = steps.map((s) => ({
    sopId,
    stepNo: s.stepNo,
    text: s.text,
    mediaRef: s.mediaRef ?? null,
    requiresConfirm: s.requiresConfirm ?? false,
    expectedInput: s.expectedInput ?? null,
  }));
  await d.insert(sopSteps).values(values);
  await d.update(sops).set({ updatedAt: new Date() }).where(eq(sops.id, sopId));
  return d.select().from(sopSteps).where(eq(sopSteps.sopId, sopId)).orderBy(asc(sopSteps.stepNo));
}

export interface UpdateSopInput {
  id: number;
  title?: string;
  description?: string | null;
  productModelId?: number | null;
  stationId?: number | null;
  steps?: SopStepInput[];
}

/** Cập nhật metadata SOP + (tùy chọn) thay bước. Trả SOP mới. */
export async function updateSop(input: UpdateSopInput): Promise<(SopRow & { steps: SopStepRow[] }) | null> {
  const d = await db();
  const patch: Partial<SopRow> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.productModelId !== undefined) patch.productModelId = input.productModelId;
  if (input.stationId !== undefined) patch.stationId = input.stationId;
  const [row] = await d.update(sops).set(patch).where(eq(sops.id, input.id)).returning();
  if (!row) return null;
  if (input.steps !== undefined) await replaceSteps(input.id, input.steps);
  return getSop(input.id);
}

/**
 * Đổi trạng thái SOP. Kích hoạt (active) tự động retire mọi bản `active` KHÁC
 * cùng code (chỉ 1 bản hiệu lực / code tại một thời điểm — spec §6.2).
 */
export async function setSopStatus(id: number, status: SopStatus): Promise<SopRow | null> {
  const d = await db();
  const [target] = await d.select().from(sops).where(eq(sops.id, id)).limit(1);
  if (!target) return null;
  if (status === "active") {
    await d
      .update(sops)
      .set({ status: "retired", updatedAt: new Date() })
      .where(and(eq(sops.code, target.code), eq(sops.status, "active"), ne(sops.id, id)));
  }
  const [row] = await d
    .update(sops)
    .set({ status, updatedAt: new Date() })
    .where(eq(sops.id, id))
    .returning();
  return row ?? null;
}

/** Xóa một SOP (chỉ khi draft — active/retired giữ để truy vết). steps cascade. */
export async function deleteSop(id: number): Promise<{ ok: boolean; code?: string }> {
  const d = await db();
  const [row] = await d.select().from(sops).where(eq(sops.id, id)).limit(1);
  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (row.status !== "draft") return { ok: false, code: "NOT_DRAFT" };
  // Không xóa nếu còn phiên thực thi tham chiếu (FK RESTRICT ở DB — chặn sớm ở đây).
  const [exec] = await d.select({ id: sopExecutions.id }).from(sopExecutions).where(eq(sopExecutions.sopId, id)).limit(1);
  if (exec) return { ok: false, code: "HAS_EXECUTIONS" };
  await d.delete(sopSteps).where(eq(sopSteps.sopId, id));
  await d.delete(sops).where(eq(sops.id, id));
  return { ok: true };
}

/** Nhân bản một SOP thành bản DRAFT mới (version = max(code)+1) để soạn phiên mới. */
export async function cloneAsNewVersion(sopId: number, createdBy?: number | null): Promise<(SopRow & { steps: SopStepRow[] }) | null> {
  const full = await getSop(sopId);
  if (!full) return null;
  return createSop({
    code: full.code,
    title: full.title,
    description: full.description,
    productModelId: full.productModelId,
    stationId: full.stationId,
    status: "draft",
    createdBy: createdBy ?? null,
    steps: full.steps.map((s) => ({
      stepNo: s.stepNo,
      text: s.text,
      mediaRef: s.mediaRef,
      requiresConfirm: s.requiresConfirm,
      expectedInput: s.expectedInput,
    })),
  });
}

// ─── Thực thi SOP (start / confirm-step / finish) ─────────────────────────────

function toStepLite(steps: SopStepRow[]): SopStepLite[] {
  return steps.map((s) => ({ stepNo: s.stepNo, requiresConfirm: s.requiresConfirm, expectedInput: s.expectedInput }));
}

export interface StartExecutionInput {
  sopId: number;
  unitSerial?: string | null;
  lineId?: number | null;
  stationId?: number | null;
  operatorId?: number | null;
}

/** Bắt đầu một phiên thực thi SOP. */
export async function startExecution(input: StartExecutionInput): Promise<SopExecutionRow> {
  const d = await db();
  const [sop] = await d.select().from(sops).where(eq(sops.id, input.sopId)).limit(1);
  if (!sop) throw new Error("SOP not found");
  const [row] = await d
    .insert(sopExecutions)
    .values({
      sopId: input.sopId,
      unitSerial: input.unitSerial ?? null,
      lineId: input.lineId ?? null,
      stationId: input.stationId ?? sop.stationId ?? null,
      operatorId: input.operatorId ?? null,
      status: "in_progress",
      stepConfirmations: [],
    })
    .returning();
  return row;
}

export interface ConfirmStepResult {
  ok: boolean;
  code: StepConfirmCode | "NOT_FOUND" | "NOT_IN_PROGRESS";
  execution?: SopExecutionRow;
  progress?: ReturnType<typeof computeExecutionProgress>;
}

/**
 * Xác nhận một bước. Cưỡng chế cổng bằng validateStepConfirmation (pure) — bước
 * requires_confirm có expected_input chỉ qua khi input khớp. Trả result-union
 * (KHÔNG ném) cho lý do nghiệp vụ để router map thành thông báo thân thiện.
 */
export async function confirmStep(
  executionId: number,
  stepNo: number,
  input: string | null | undefined,
  userId: number | null,
): Promise<ConfirmStepResult> {
  const d = await db();
  const [exec] = await d.select().from(sopExecutions).where(eq(sopExecutions.id, executionId)).limit(1);
  if (!exec) return { ok: false, code: "NOT_FOUND" };
  if (exec.status !== "in_progress") return { ok: false, code: "NOT_IN_PROGRESS" };

  const steps = await d.select().from(sopSteps).where(eq(sopSteps.sopId, exec.sopId)).orderBy(asc(sopSteps.stepNo));
  const lite = toStepLite(steps);
  const verdict = validateStepConfirmation(lite, stepNo, input);
  if (!verdict.ok) return { ok: false, code: verdict.code };

  const nextConfirmations = upsertConfirmation(exec.stepConfirmations ?? [], {
    stepNo,
    confirmedBy: userId,
    confirmedAt: new Date().toISOString(),
    input: input?.trim() ? input.trim() : null,
  } satisfies SopStepConfirmation);

  const [row] = await d
    .update(sopExecutions)
    .set({ stepConfirmations: nextConfirmations })
    .where(eq(sopExecutions.id, executionId))
    .returning();
  return { ok: true, code: "OK", execution: row, progress: computeExecutionProgress(lite, nextConfirmations) };
}

export interface FinishExecutionResult {
  ok: boolean;
  code: "OK" | "NOT_FOUND" | "NOT_IN_PROGRESS" | "INCOMPLETE";
  execution?: SopExecutionRow;
  progress?: ReturnType<typeof computeExecutionProgress>;
}

/** Kết thúc phiên — chỉ khi mọi bước requires_confirm đã thỏa (cổng bắt buộc). */
export async function finishExecution(executionId: number): Promise<FinishExecutionResult> {
  const d = await db();
  const [exec] = await d.select().from(sopExecutions).where(eq(sopExecutions.id, executionId)).limit(1);
  if (!exec) return { ok: false, code: "NOT_FOUND" };
  if (exec.status !== "in_progress") return { ok: false, code: "NOT_IN_PROGRESS" };

  const steps = await d.select().from(sopSteps).where(eq(sopSteps.sopId, exec.sopId)).orderBy(asc(sopSteps.stepNo));
  const lite = toStepLite(steps);
  const confirmations = exec.stepConfirmations ?? [];
  if (!canFinishExecution(lite, confirmations)) {
    return { ok: false, code: "INCOMPLETE", progress: computeExecutionProgress(lite, confirmations) };
  }
  const [row] = await d
    .update(sopExecutions)
    .set({ status: "completed", finishedAt: new Date() })
    .where(eq(sopExecutions.id, executionId))
    .returning();
  return { ok: true, code: "OK", execution: row, progress: computeExecutionProgress(lite, confirmations) };
}

/** Bỏ dở một phiên (đánh dấu abandoned). */
export async function abandonExecution(executionId: number): Promise<SopExecutionRow | null> {
  const d = await db();
  const [row] = await d
    .update(sopExecutions)
    .set({ status: "abandoned", finishedAt: new Date() })
    .where(and(eq(sopExecutions.id, executionId), eq(sopExecutions.status, "in_progress")))
    .returning();
  return row ?? null;
}

/** Một phiên + tiến độ tính lại (fresh) từ bước SOP. */
export async function getExecution(id: number): Promise<
  (SopExecutionRow & { progress: ReturnType<typeof computeExecutionProgress> }) | null
> {
  const d = await db();
  const [exec] = await d.select().from(sopExecutions).where(eq(sopExecutions.id, id)).limit(1);
  if (!exec) return null;
  const steps = await d.select().from(sopSteps).where(eq(sopSteps.sopId, exec.sopId)).orderBy(asc(sopSteps.stepNo));
  return { ...exec, progress: computeExecutionProgress(toStepLite(steps), exec.stepConfirmations ?? []) };
}

/** Lịch sử phiên của một SOP (mới nhất trước). */
export async function listExecutions(sopId: number, limit = 50): Promise<SopExecutionRow[]> {
  const d = await db();
  return d
    .select()
    .from(sopExecutions)
    .where(eq(sopExecutions.sopId, sopId))
    .orderBy(desc(sopExecutions.startedAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}

// ─── Readiness contribution (spec §6.2 "gắn với readiness" — LDS-L3 Ch.6) ──────

export interface SopReadinessContribution {
  /** ok=true khi KHÔNG có SOP bắt buộc chưa hoàn tất cho ngữ cảnh (readiness item PASS). */
  ok: boolean;
  /** Có SOP active áp cho ngữ cảnh này không (có = nên đã thực thi). */
  required: boolean;
  activeSop: { id: number; code: string; title: string; version: number } | null;
  /** Đã có phiên completed gần đây (cùng station) cho SOP này chưa. */
  hasRecentCompletion: boolean;
  detail: string;
}

/**
 * doc 44 W6-1 (spec §6.2) — đóng góp e-SOP vào readiness tuyến. Line Controller
 * (W6+) SẼ gọi hàm này khi tính readiness khi vào 'ready'; W6-1 chỉ EXPORT (không
 * sửa lineController). Fail-safe: lỗi/DB null → ok:true (không chặn readiness vì
 * e-SOP), required:false.
 *
 * Ngữ nghĩa MVP: nếu có SOP active cho (product/station) và CHƯA có phiên
 * completed trong `windowHours` (mặc định 24h) → ok:false (readiness cảnh báo
 * "chưa hoàn tất e-SOP changeover"). Không có SOP active → ok:true, required:false.
 */
export async function sopReadinessContribution(ctx: {
  lineId?: number | null;
  stationId?: number | null;
  productModelId?: number | null;
  windowHours?: number;
}): Promise<SopReadinessContribution> {
  try {
    const sop = await resolveActiveSop({ productModelId: ctx.productModelId, stationId: ctx.stationId });
    if (!sop) {
      return { ok: true, required: false, activeSop: null, hasRecentCompletion: false, detail: "Không có e-SOP bắt buộc cho ngữ cảnh này." };
    }
    const d = await db();
    const since = new Date(Date.now() - (ctx.windowHours ?? 24) * 3600_000);
    const conds = [eq(sopExecutions.sopId, sop.id), eq(sopExecutions.status, "completed"), gte(sopExecutions.startedAt, since)];
    if (ctx.stationId != null) conds.push(eq(sopExecutions.stationId, ctx.stationId));
    const [done] = await d.select({ id: sopExecutions.id }).from(sopExecutions).where(and(...conds)).limit(1);
    const hasRecentCompletion = !!done;
    return {
      ok: hasRecentCompletion,
      required: true,
      activeSop: { id: sop.id, code: sop.code, title: sop.title, version: sop.version },
      hasRecentCompletion,
      detail: hasRecentCompletion
        ? `Đã hoàn tất e-SOP ${sop.code}@v${sop.version}.`
        : `Chưa hoàn tất e-SOP ${sop.code}@v${sop.version} (trong ${ctx.windowHours ?? 24}h).`,
    };
  } catch {
    // Fail-safe: e-SOP không được làm sập readiness khi lỗi tra cứu.
    return { ok: true, required: false, activeSop: null, hasRecentCompletion: false, detail: "Không đánh giá được e-SOP (bỏ qua)." };
  }
}
