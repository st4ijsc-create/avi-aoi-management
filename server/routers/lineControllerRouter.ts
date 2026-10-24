/**
 * doc 44 W3-A2 / G3.1 — Line Controller tRPC router (UI nội bộ).
 *
 * Read: getState / listStates / stages / readiness / transitions / status
 *   → protectedProcedure (mọi user đã đăng nhập — read-only, không mở control path).
 * Write: transition / command
 *   → actuationProcedure (role-floor admin/supervisor/engineer + 2FA — doc 38 Đợt Q;
 *     đúng pattern mọi đường machine-control). Policy seam + FSM validate + audit
 *     nằm TRONG lineControllerService (một cửa — REST /v1/lines đi cùng đường).
 *
 * Mutation trả TransitionResult NGUYÊN TRẠNG (ok:true|false + code phân loại +
 * readiness checks) để UI render checklist/allowed-list — không ném TRPCError
 * cho lý do nghiệp vụ.
 */
import { z } from "zod";
import { protectedProcedure, actuationProcedure, router } from "../_core/trpc";
import { LINE_STATES, recipeSets, recipeSetItems, machineRecipes } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { appError } from "../_core/appError";
import { getDb } from "../db";
import { idsTrongPhamVi } from "../db/hierarchy";
import { phamViCua, type CoDanhTinh } from "./_phamViNguoiXem";
import { mayTrongPhamVi } from "./_adapterPhamVi";
import { sanPhamGhiTrongPhamVi } from "./_sanPhamPhamVi";
import {
  listLinesWithState,
  getLineStateDetail,
  getLineStages,
  transitionLine,
  executeLineCommand,
  getLineControllerStatus,
  LINE_COMMANDS,
} from "../services/lineController/lineControllerService";
import { checkLineReadiness } from "../services/lineController/lineReadiness";
import { listTransitions } from "../services/lineController/lineStateRepo";
import {
  listRecipeSets,
  getRecipeSetDetail,
  getRecipeSetLockStatus,
  createRecipeSet,
  addRecipeSetItem,
  removeRecipeSetItem,
  distributeRecipeSet,
  unlockRecipeSet,
} from "../services/lineController/recipeSetService";

const lineIdSchema = z.number().int().positive();

/**
 * Phạm vi nhà máy cho GHI điều khiển tuyến (rà bảo mật 2026-10-24, lô W8 — kiểm định phamViGhi): chuyển trạng thái / ra lệnh / phân phối recipe set
 * tới một TUYẾN, và sửa recipe set chạm MÁY. Trước: người nhà máy A start/hold/changeover tuyến nhà máy B, nạp recipe set vào máy nhà máy B.
 *  • tuyến: lineId phải trong phạm vi (cùng `idsTrongPhamVi("line")`) ⇒ NOT_FOUND "line";
 *  • recipe set: KHÔNG có cột nhà máy; set thuộc phạm vi ⇔ MỌI máy trong item của nó thuộc phạm vi (set rỗng = nháp: ai cũng thao tác); set có máy ngoài
 *    phạm vi ≡ không tồn tại ⇒ NOT_FOUND "recipeSet". Toàn quyền (admin) ⇒ không kiểm.
 */
async function tuyenTrongPhamVi(ctx: CoDanhTinh, lineId: number): Promise<void> {
  const ids = await idsTrongPhamVi("line", phamViCua(ctx), { strict: true });
  if (ids !== null && !ids.includes(lineId)) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "line" }, "Line not found");
}

async function setTrongPhamVi(ctx: CoDanhTinh, ref: { id?: number; code?: string }): Promise<void> {
  const ids = await idsTrongPhamVi("machine", phamViCua(ctx), { strict: true });
  if (ids === null) return;
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  const [set] = await d
    .select({ id: recipeSets.id })
    .from(recipeSets)
    .where(ref.id != null ? eq(recipeSets.id, ref.id) : eq(recipeSets.code, ref.code ?? ""))
    .limit(1);
  if (!set) return; // không tồn tại: để dịch vụ trả lỗi nghiệp vụ như trước (không lộ gì)
  const items = await d.select({ m: recipeSetItems.machineId }).from(recipeSetItems).where(eq(recipeSetItems.recipeSetId, set.id));
  if (items.some((i) => !ids.includes(i.m))) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "recipeSet" }, "Recipe set not found");
}

/** Tham chiếu một recipe set theo id HOẶC code (ít nhất một). */
const recipeSetRefSchema = z
  .object({
    id: z.number().int().positive().optional(),
    code: z.string().min(1).max(200).optional(),
  })
  .refine((v) => v.id != null || v.code != null, { message: "Cần id hoặc code." });

export const lineControllerRouter = router({
  /** Mọi tuyến ACTIVE + trạng thái FSM (tuyến chưa có row → 'idle'). */
  // doc 64 IA-10 S2 (DEP-S2) — nhận factoryId (optional): tra lineId thuộc nhà máy
  // (lines→workshops, 1 query) rồi lọc kết quả. Không truyền = y hệt cũ.
  listStates: protectedProcedure
    .input(z.object({ factoryId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => {
      const all = await listLinesWithState();
      if (input?.factoryId === undefined) return all;
      const { getDb } = await import("../db/connection");
      const { productionLines, workshops } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return all;
      const rows = await db
        .select({ id: productionLines.id })
        .from(productionLines)
        .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
        .where(eq(workshops.factoryId, input.factoryId));
      const allowed = new Set(rows.map((r) => r.id));
      return all.filter((l: { lineId: number }) => allowed.has(l.lineId));
    }),

  /** Trạng thái + nhịp/bottleneck + readiness cache + transitions gần nhất. */
  getState: protectedProcedure
    .input(z.object({ lineId: lineIdSchema }))
    .query(async ({ input }) => {
      return getLineStateDetail(input.lineId);
    }),

  /** Trạng thái từng trạm: máy, op-state, dwell, blocked/starved (spec §13.2). */
  stages: protectedProcedure
    .input(z.object({ lineId: lineIdSchema }))
    .query(async ({ input }) => {
      return getLineStages(input.lineId);
    }),

  /** Chạy checklist sẵn sàng MỚI (không dùng cache) — spec §6.2. */
  readiness: protectedProcedure
    .input(z.object({ lineId: lineIdSchema, requireRecipe: z.boolean().optional() }))
    .query(async ({ input }) => {
      return checkLineReadiness(input.lineId, { requireRecipe: input.requireRecipe ?? false });
    }),

  /** Lịch sử transition (audit append-only, gồm cả row POLICY_DENIED). */
  transitions: protectedProcedure
    .input(z.object({ lineId: lineIdSchema, limit: z.number().int().min(1).max(200).default(20) }))
    .query(async ({ input }) => {
      return listTransitions(input.lineId, input.limit);
    }),

  /** Trạng thái runtime của sweep scheduler + events gần nhất. */
  status: protectedProcedure.query(() => getLineControllerStatus()),

  /**
   * Chuyển trạng thái tường minh (FSM validate + readiness khi vào 'ready' +
   * policy seam + persist + publish). Trả TransitionResult — UI kiểm `ok`.
   */
  transition: actuationProcedure
    .input(
      z.object({
        lineId: lineIdSchema,
        to: z.enum(LINE_STATES),
        reason: z.string().max(500).optional(),
        heldReason: z.string().max(500).optional(),
        recipeSetRef: z.string().max(200).optional(),
        requireRecipe: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await tuyenTrongPhamVi(ctx, input.lineId); // phạm vi nhà máy
      return transitionLine(input.lineId, input.to, {
        reason: input.reason,
        heldReason: input.heldReason,
        recipeSetRef: input.recipeSetRef,
        requireRecipe: input.requireRecipe,
        actor: String(ctx.user.id),
      });
    }),

  /** Lệnh tuyến mức cao (start|hold|resume|changeover|complete|reset_fault). */
  command: actuationProcedure
    .input(
      z.object({
        lineId: lineIdSchema,
        command: z.enum(LINE_COMMANDS),
        reason: z.string().max(500).optional(),
        recipeSetRef: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await tuyenTrongPhamVi(ctx, input.lineId); // phạm vi nhà máy
      return executeLineCommand(input.lineId, input.command, {
        reason: input.reason,
        recipeSetRef: input.recipeSetRef,
        actor: String(ctx.user.id),
      });
    }),

  /**
   * W3-B1 (G3.3) — RecipeSet cấp tuyến (spec §6.1). Read = protectedProcedure;
   * mutation = actuationProcedure (role-floor + 2FA — pattern batch). Mutation
   * trả result-union {ok:false, code} NGUYÊN TRẠNG cho lý do nghiệp vụ.
   */
  recipeSet: router({
    /** Catalog set (mới nhất trước) + số item. */
    list: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
      .query(async ({ input }) => listRecipeSets(input?.limit ?? 100)),

    /** Set + items (join phiên bản recipe + máy). Null khi không tồn tại. */
    get: protectedProcedure.input(recipeSetRefSchema).query(async ({ input }) => getRecipeSetDetail(input)),

    /** Trạng thái khóa (locked/lockedBy/lockedAt) + các tuyến đang dùng set. */
    lockStatus: protectedProcedure
      .input(recipeSetRefSchema)
      .query(async ({ input }) => getRecipeSetLockStatus(input)),

    /** Tạo set draft (khóa/active chỉ qua distribute + xác nhận nạp). */
    create: actuationProcedure
      .input(
        z.object({
          code: z.string().min(1).max(120),
          productModelId: z.number().int().positive().nullable().optional(),
          version: z.number().int().min(1).optional(),
          notes: z.string().max(2000).nullable().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (input.productModelId != null) await sanPhamGhiTrongPhamVi(ctx, input.productModelId); // luật ghi theo sản phẩm
        return createRecipeSet({
          code: input.code,
          productModelId: input.productModelId ?? null,
          version: input.version,
          notes: input.notes ?? null,
          actor: String(ctx.user.id),
        });
      }),

    /** Thêm item: máy nào nạp recipe VERSION nào (machineRecipeId = row versioned). */
    addItem: actuationProcedure
      .input(
        z.object({
          recipeSetId: z.number().int().positive(),
          machineId: z.number().int().positive(),
          machineRecipeId: z.number().int().positive(),
          stationId: z.number().int().positive().nullable().optional(),
          required: z.boolean().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        // phạm vi nhà máy: set + máy + trạm + máy của phiên bản recipe đều phải trong phạm vi
        await setTrongPhamVi(ctx, { id: input.recipeSetId });
        await mayTrongPhamVi(ctx, input.machineId);
        if (input.stationId != null) {
          const tram = await idsTrongPhamVi("station", phamViCua(ctx), { strict: true });
          if (tram !== null && !tram.includes(input.stationId)) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "station" }, "Station not found");
        }
        const d = await getDb();
        if (d) {
          const [rc] = await d.select({ m: machineRecipes.machineId }).from(machineRecipes).where(eq(machineRecipes.id, input.machineRecipeId)).limit(1);
          if (rc?.m != null) await mayTrongPhamVi(ctx, rc.m);
        }
        return addRecipeSetItem(input);
      }),

    /** Gỡ item khỏi set draft (set khóa → LOCKED). */
    removeItem: actuationProcedure
      .input(z.object({ recipeSetId: z.number().int().positive(), itemId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        await setTrongPhamVi(ctx, { id: input.recipeSetId }); // phạm vi nhà máy
        return removeRecipeSetItem(input.itemId, input.recipeSetId);
      }),

    /**
     * Phân phối set tới tuyến qua đường deploy sẵn có + XÁC NHẬN NẠP (spec
     * §6.1) — đủ máy required đúng phiên bản → set line.recipe_set_ref + KHÓA.
     */
    distribute: actuationProcedure
      .input(
        z.object({
          lineId: lineIdSchema,
          recipeSetId: z.number().int().positive(),
          notes: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await tuyenTrongPhamVi(ctx, input.lineId); // phạm vi nhà máy: tuyến đích
        await setTrongPhamVi(ctx, { id: input.recipeSetId }); // … và set phân phối
        return distributeRecipeSet(input.lineId, input.recipeSetId, {
          actor: String(ctx.user.id),
          actorId: ctx.user.id,
          notes: input.notes ?? null,
        });
      }),

    /** Gỡ khóa — chỉ khi mọi tuyến dùng set ở idle/completing/fault (§6.1). */
    unlock: actuationProcedure
      .input(recipeSetRefSchema.and(z.object({ reason: z.string().max(500).optional() })))
      .mutation(async ({ input, ctx }) => {
        await setTrongPhamVi(ctx, { id: input.id, code: input.code }); // phạm vi nhà máy
        return unlockRecipeSet(
          { id: input.id, code: input.code },
          { actor: String(ctx.user.id), reason: input.reason },
        );
      }),
  }),
});
