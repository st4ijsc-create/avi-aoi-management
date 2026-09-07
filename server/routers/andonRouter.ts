/**
 * Sprint F5a — Andon router (ALERT-ONLY).
 *
 * Andon = visual signal / notification. NONE of these endpoints write a command
 * to a machine. RBAC via module 'andon':
 *   raise        → andon/canCreate
 *   acknowledge  → andon/canEdit
 *   resolve      → andon/canEdit
 *   list/active/get/metrics → andon/canView
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 15 LÔ R (L-1) — **HÀNG RÀO TENANT CHO `acknowledge` / `resolve`.**
 * ══════════════════════════════════════════════════════════════════════════════
 * `acknowledge` **CÓ** `ctx` — nhưng chỉ để ĐÓNG DẤU người tiếp nhận
 * (`acknowledgedBy = ctx.user.id`). Nó **KHÔNG kiểm `input.id` có thuộc phạm vi
 * người gọi hay không**. Đó là một phân biệt quan trọng và dễ nhìn nhầm:
 *
 *     có `ctx`  ≠  có kiểm phạm vi.
 *
 * Danh tính được DÙNG để ghi, không được dùng để CHẶN. Một tài khoản có
 * `andon/canEdit` ở nhà máy A tiếp nhận (và giải quyết) được cảnh báo Andon của
 * nhà máy B — chỉ cần đoán `id`; và vì `acknowledge` dập MTTA, nó còn làm hỏng
 * số đo của tenant kia.
 *
 * ★★★ **`requirePermission` KHÔNG đo tenant.** Hai trục khác nhau; chỉ một trục
 *   có người canh.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ `andon_events` KHÔNG CÓ CỘT TENANT — PHẠM VI PHẢI **SUY QUA PHÂN CẤP**
 * ══════════════════════════════════════════════════════════════════════════════
 * Đo lược đồ 2026-09-08: cột của bảng là `id, state, reason, status, lineId,
 * stationId, machineId, title, message, raisedBy, …` — KHÔNG có `factoryCode`
 * hay `corporateCode`. Nên `congMaTenant` (trục MÃ) **không dùng được ở đây**;
 * phải chiếu qua chuỗi `machines → stations → production_lines → workshops →
 * factories` bằng `idsTrongPhamVi`, tức trục ID.
 *
 * ⚠⚠ **CẢ BA cột `machineId`/`stationId`/`lineId` đều NULLABLE** (đo bằng
 *   `information_schema.columns`: cả ba `is_nullable = YES`). Nên câu hỏi thật
 *   là: *một hàng NULL cả ba thuộc phạm vi ai?*
 *
 *   **QUYẾT ĐỊNH: fail-CLOSED.** Một hàng không khai máy, trạm lẫn chuyền
 *   **không có đường nào truy ra nhà máy** — nói nó "thuộc mọi người" là mở đúng
 *   cái lỗ vừa vá (mọi tenant tiếp nhận được mọi cảnh báo vô chủ). Người bị thu
 *   hẹp KHÔNG chạm được nó; **vai toàn quyền vẫn chạm được**, nên hàng ấy không
 *   trở thành rác không ai dọn nổi.
 *
 *   Đây là cùng luật đã ghi ở hai chỗ khác trong repo, không phải luật thứ ba:
 *   `congMaTenant` ("hàng có CẢ HAI mã NULL bị LOẠI cho người bị thu hẹp") và
 *   nhánh `workstation` của `idsTrongPhamVi` ("công trạm mồ côi cả ba khoá
 *   KHÔNG có đường nào ra nhà máy ⇒ bị loại").
 *
 * ★ G48 — **cái rỗng này rỗng ở cột nào**: đo trên `aoi_management` 2026-09-08,
 *   `andon_events` có **9 hàng**, trong đó `machineId` khai đủ **9/9**,
 *   `lineId` **9/9**, `stationId` **2/9**, và **0 hàng** NULL cả ba. Nghĩa là
 *   luật fail-closed ở trên **không làm mất hàng nào đang có thật**; nó chỉ định
 *   nghĩa trước một hình dạng chưa xuất hiện.
 *
 * ⚠ **HOẶC, không phải VÀ**: một hàng khai `machineId` của A và `lineId` của A
 *   phải qua; nhưng nếu chỉ một trong ba cột được khai thì chính cột ấy quyết
 *   định. Dùng VÀ sẽ loại mọi hàng có cột NULL — "vá quá tay thành chặn tất cả".
 *
 * ⚠ Ngoài phạm vi ⇒ **`NOT_FOUND`**, cùng mã với "không tồn tại": một mã riêng
 *   vẫn xác nhận cảnh báo ấy có thật. Cùng luật lô Q1.
 *
 * Nghiệm thu: `maintenanceAndonPhamVi.db.test.ts` (hai chiều, CSDL thật, vai
 * KHÔNG-admin). ★ G26 — CSDL có **0 hàng `raised`**, nên lưới **tự dựng** hàng
 * `raised` rồi xoá lại; đo trên tập rỗng là đo trên hư không.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { and, eq, gte, desc, sql, isNull } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb as getDbRaw } from "../db";
import { andonEvents } from "../../drizzle/schema";
import { raiseAndon, acknowledgeAndon, resolveAndon } from "../services/andon/andonService";
import { classifyIssue } from "../services/aiIssueClassifier";
import { getMachineByCode, idsTrongPhamVi } from "../db/hierarchy";
import { phamViCua } from "./_phamViNguoiXem";

async function getDb() {
  const db = await getDbRaw();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return db;
}

const stateEnum = z.enum(["green", "yellow", "red", "call"]);
const reasonEnum = z.enum(["quality", "material", "maintenance", "safety", "setup", "other"]);

/**
 * ★★★ L-1 — cổng phạm vi cho MỘT hàng `andon_events` lấy theo `id` TỰ KHAI.
 *
 * Ném `NOT_FOUND` khi hàng không tồn tại HOẶC nằm ngoài phạm vi người gọi — hai
 * ca cho CÙNG một mã, cố ý (xem docblock đầu tệp).
 *
 * ⚠ Trả về hàng đã đọc để nơi gọi không phải đọc lần thứ hai (và không có khe hở
 *   giữa hai lần đọc).
 *
 * ⚠ Ba trục HOẶC nhau, và mỗi trục chỉ tính khi cột ấy KHÔNG NULL. Cả ba NULL ⇒
 *   fail-CLOSED cho người bị thu hẹp.
 */
async function congPhamViAndon(id: number, ctx: unknown) {
  const db = await getDb();
  const [row] = await db.select().from(andonEvents).where(eq(andonEvents.id, id)).limit(1);
  if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "andonEvent" }, "Andon không tồn tại.");

  const pv = phamViCua(ctx as Parameters<typeof phamViCua>[0]);
  const [idsMay, idsTram, idsChuyen] = await Promise.all([
    idsTrongPhamVi("machine", pv),
    idsTrongPhamVi("station", pv),
    idsTrongPhamVi("line", pv),
  ]);
  // `null` ở tầng máy = vai toàn quyền / lối không mang danh tính ⇒ KHÔNG cổng
  // nào. Ba lời gọi cùng nguồn phạm vi nên chúng `null` cùng lúc; kiểm một là đủ,
  // nhưng kiểm cả ba cho hình dạng tự nói.
  if (idsMay === null && idsTram === null && idsChuyen === null) return row;

  const hop =
    (row.machineId != null && (idsMay ?? []).includes(row.machineId)) ||
    (row.stationId != null && (idsTram ?? []).includes(row.stationId)) ||
    (row.lineId != null && (idsChuyen ?? []).includes(row.lineId));
  if (!hop) {
    throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "andonEvent" }, "Andon không tồn tại.");
  }
  return row;
}

export const andonRouter = router({
  raise: protectedProcedure
    .use(requirePermission("andon", "canCreate"))
    .input(z.object({
      state: stateEnum,
      reason: reasonEnum,
      title: z.string().min(1).max(255),
      message: z.string().max(2000).optional(),
      lineId: z.number().int().positive().optional(),
      stationId: z.number().int().positive().optional(),
      machineId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return raiseAndon(
        {
          state: input.state,
          reason: input.reason,
          title: input.title,
          message: input.message,
          lineId: input.lineId,
          stationId: input.stationId,
          machineId: input.machineId,
          raisedBySystem: false,
        },
        { id: ctx.user.id, name: ctx.user.name ?? null },
      );
    }),

  /**
   * quickReport — operator "1-tap issue report" (báo sự cố).
   *
   * Minimum effort: the operator submits a short free-text (or voice-dictated)
   * description; the FAST AI model picks reason + state via classifyIssue() so
   * the operator never has to choose a category/severity. The classified Andon
   * is then raised through the SAME raiseAndon service path as `raise`.
   *
   * Same RBAC as raise (andon/canCreate). raisedBySystem:false (a human raised
   * it). Fail-safe end-to-end: a classifier failure still raises an Andon with a
   * safe default (reason "other"). An empty description is allowed → a bare
   * call-for-help. `degraded` tells the client the AI fell back to a default.
   */
  quickReport: protectedProcedure
    .use(requirePermission("andon", "canCreate"))
    .input(z.object({
      machineId: z.number().int().positive().optional(),
      machineCode: z.string().min(1).max(100).optional(),
      stationId: z.number().int().positive().optional(),
      lineId: z.number().int().positive().optional(),
      description: z.string().max(2000).optional(),
      lang: z.enum(["vi", "en", "zh"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Resolve machineId from a scanned/typed machine code when an id wasn't passed.
      let machineId = input.machineId;
      let machineCode = input.machineCode?.trim() || undefined;
      if (machineId == null && machineCode) {
        const m = await getMachineByCode(machineCode);
        if (m) {
          machineId = m.id;
          machineCode = m.code;
        }
      }

      // FAST-model classification (never throws — returns a safe default if degraded).
      const classified = await classifyIssue({
        description: input.description,
        machineCode,
        lang: input.lang ?? "vi",
      });

      const event = await raiseAndon(
        {
          state: classified.state,
          reason: classified.reason,
          title: classified.title,
          message: input.description?.trim() || classified.title,
          machineId: machineId ?? null,
          stationId: input.stationId ?? null,
          lineId: input.lineId ?? null,
          raisedBySystem: false,
        },
        { id: ctx.user.id, name: ctx.user.name ?? null },
      );

      return {
        andonId: event.id,
        reason: classified.reason,
        state: classified.state,
        title: classified.title,
        degraded: classified.degraded,
      };
    }),

  acknowledge: protectedProcedure
    .use(requirePermission("andon", "canEdit"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      // ★★★ L-1 — cổng phạm vi TRƯỚC khi ghi. Bản gốc có `ctx` nhưng chỉ dùng nó
      //   để đóng dấu người tiếp nhận, không để chặn.
      await congPhamViAndon(input.id, ctx);
      const row = await acknowledgeAndon(input.id, ctx.user.id, { id: ctx.user.id, name: ctx.user.name ?? null });
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "andonEvent" }, "Andon không tồn tại.");
      return row;
    }),

  resolve: protectedProcedure
    .use(requirePermission("andon", "canEdit"))
    .input(z.object({ id: z.number().int().positive(), notes: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => {
      // ★ L-1 — `resolve` có ĐÚNG hình dạng của `acknowledge`; vá một mà bỏ cái
      //   kia là để nguyên cánh cửa (bài học "vá xong kiểm NHÁNH KIA").
      await congPhamViAndon(input.id, ctx);
      const row = await resolveAndon(input.id, ctx.user.id, input.notes, { id: ctx.user.id, name: ctx.user.name ?? null });
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "andonEvent" }, "Andon không tồn tại.");
      return row;
    }),

  list: protectedProcedure
    .use(requirePermission("andon", "canView"))
    .input(z.object({
      status: z.enum(["raised", "acknowledged", "resolved"]).optional(),
      lineId: z.number().int().positive().optional(),
      machineId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      const conds = [];
      if (input?.status) conds.push(eq(andonEvents.status, input.status));
      if (input?.lineId) conds.push(eq(andonEvents.lineId, input.lineId));
      if (input?.machineId) conds.push(eq(andonEvents.machineId, input.machineId));
      return db
        .select()
        .from(andonEvents)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(andonEvents.raisedAt))
        .limit(input?.limit ?? 100);
    }),

  active: protectedProcedure
    .use(requirePermission("andon", "canView"))
    .query(async () => {
      const db = await getDb();
      return db
        .select()
        .from(andonEvents)
        .where(isNull(andonEvents.resolvedAt))
        .orderBy(desc(andonEvents.raisedAt))
        .limit(200);
    }),

  get: protectedProcedure
    .use(requirePermission("andon", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const [row] = await db.select().from(andonEvents).where(eq(andonEvents.id, input.id)).limit(1);
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "andonEvent" }, "Andon không tồn tại.");
      return row;
    }),

  metrics: protectedProcedure
    .use(requirePermission("andon", "canView"))
    .input(z.object({
      sinceHours: z.number().int().min(1).max(24 * 90).default(24),
      // doc 64 IA-10 S4 — trục phạm vi (optional/additive): MTTA/MTTR theo Chuyền/Máy.
      lineId: z.number().int().positive().optional(),
      machineId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      const since = new Date(Date.now() - (input?.sinceHours ?? 24) * 3600 * 1000);
      const conds = [gte(andonEvents.raisedAt, since)];
      if (input?.lineId !== undefined) conds.push(eq(andonEvents.lineId, input.lineId));
      if (input?.machineId !== undefined) conds.push(eq(andonEvents.machineId, input.machineId));
      const [row] = await db
        .select({
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${andonEvents.resolvedAt} is null)::int`,
          resolved: sql<number>`count(*) filter (where ${andonEvents.status} = 'resolved')::int`,
          avgMtta: sql<number>`coalesce(avg(${andonEvents.mttaSeconds}), 0)::float`,
          avgMttr: sql<number>`coalesce(avg(${andonEvents.mttrSeconds}), 0)::float`,
        })
        .from(andonEvents)
        .where(and(...conds));
      return {
        total: row?.total ?? 0,
        active: row?.active ?? 0,
        resolved: row?.resolved ?? 0,
        avgMttaSeconds: Math.round(row?.avgMtta ?? 0),
        avgMttrSeconds: Math.round(row?.avgMttr ?? 0),
      };
    }),
});
