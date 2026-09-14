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
import { factoryIdGate } from "../db/reportAggregators";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
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

/**
 * ★★★ ĐỢT 24 VIỆC 1 — CỔNG PHẠM VI CHO ĐƯỜNG **ĐỌC DANH SÁCH**.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ LÔ R VÁ ĐƯỜNG GHI VÀ **DỪNG Ở ĐÓ**. ĐƯỜNG ĐỌC CÒN NGUYÊN.
 * ══════════════════════════════════════════════════════════════════════════════
 * `congPhamViAndon` ở trên gác `acknowledge`/`resolve` — hai thủ tục nhận MỘT
 * `id`. Nhưng bốn thủ tục ĐỌC (`list` :?, `active`, `get`, `metrics`) khai
 * `async ({ input })` / `async ()` — **không bóc `ctx`**, nên không có mệnh đề
 * tenant nào. Đo trên mã trước bản vá này:
 *
 *     active: protectedProcedure.use(requirePermission("andon","canView"))
 *       .query(async () => { … isNull(resolvedAt) … limit(200) })
 *                    ↑ KHÔNG có ctx ⇒ trả andon của MỌI nhà máy
 *
 * ⇒ Đây **không phải lỗi hiển thị**. `ShellAlertChip.tsx:43` gọi `andon.active`
 *   mỗi 15 s ở **vỏ ứng dụng**, nên MỌI màn của MỌI vai đọc được andon của mọi
 *   tenant — chỉ cần có `andon/canView`. Cùng lớp lỗi với `demVatThe` (lô K) và
 *   `digitalTwinRouter` (lô Q), nhưng ở bề mặt được nhìn thấy nhiều nhất.
 *
 * ★ ĐO ĐƯỢC 2026-09-08 (`aoi_management`): 7 hàng `resolvedAt IS NULL`, **cả 7
 *   thuộc factory 1 `SIM-FAC`**. `operator1` (id 48, **0 hàng**
 *   `user_factory_assignments`) đọc được cả 7 — badge khai "7" cho một người
 *   không được xem nhà máy nào.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★ VÌ SAO MỘT MỆNH ĐỀ `SQL`, KHÔNG PHẢI LỌC SAU KHI ĐỌC
 * ══════════════════════════════════════════════════════════════════════════════
 * Lọc trong JS sau `limit(200)` sẽ cắt **sau** khi CSDL đã chọn 200 hàng của mọi
 * tenant: người bị thu hẹp có thể nhận 0 hàng dù nhà máy họ có andon, chỉ vì 200
 * chỗ đã bị tenant khác chiếm. Cổng phải nằm TRONG `WHERE`.
 *
 * ⚠ HOẶC ba trục, mỗi trục chỉ tính khi cột ấy KHÔNG NULL — **cùng khuôn**
 *   `congPhamViAndon` (G12: một luật, không hai bản cài đặt). Cả ba NULL ⇒
 *   fail-CLOSED cho người bị thu hẹp; `null` phạm vi (vai toàn quyền) ⇒ KHÔNG
 *   thêm mệnh đề nào (chiều DƯƠNG chống vá quá tay).
 *
 * Trả `undefined` khi không cần cổng, để nơi gọi ghép thẳng vào `and(...)`.
 */
async function menhDePhamViAndon(ctx: unknown) {
  const pv = phamViCua(ctx as Parameters<typeof phamViCua>[0]);
  const [idsMay, idsTram, idsChuyen] = await Promise.all([
    idsTrongPhamVi("machine", pv),
    idsTrongPhamVi("station", pv),
    idsTrongPhamVi("line", pv),
  ]);
  // Vai toàn quyền / lối không mang danh tính ⇒ không cổng nào.
  if (idsMay === null && idsTram === null && idsChuyen === null) return undefined;

  // ⚠ `[]` (phạm vi RỖNG) phải cho 0 hàng, KHÔNG phải "không lọc". `factoryIdGate`
  //   (`db/reportAggregators.ts:445`) đã cưỡng chế đúng luật ấy — `[] ⇒ 1 = 0`
  //   TƯỜNG MINH — và `idsTrongPhamVi` cũng dựng câu của nó bằng chính hàm này.
  //   G12: dùng lại, không viết bản cài đặt thứ hai của một mệnh đề `IN`.
  //
  // ⚠ `IS NOT NULL` là phần KHÔNG ĐƯỢC BỎ: `NULL IN (1,2)` cho `NULL` chứ không
  //   `FALSE`. Bỏ nó thì hàng NULL cả ba vẫn bị `WHERE` loại (vì `NULL` không
  //   phải `TRUE`) — tức ta được kết quả ĐÚNG vì một lý do SAI, và lý do sai ấy
  //   vỡ ngay khi ai đó thêm một vế `OR TRUE`. Viết tường minh để luật
  //   fail-closed đọc được trên mặt chữ.
  const ve = (cot: AnyPgColumn, ids: number[] | null) =>
    ids === null || ids.length === 0
      ? sql`1 = 0`
      : sql`(${cot} IS NOT NULL AND ${factoryIdGate(cot, ids)})`;

  return sql`(${ve(andonEvents.machineId, idsMay)} OR ${ve(andonEvents.stationId, idsTram)} OR ${ve(andonEvents.lineId, idsChuyen)})`;
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
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      const conds = [];
      if (input?.status) conds.push(eq(andonEvents.status, input.status));
      if (input?.lineId) conds.push(eq(andonEvents.lineId, input.lineId));
      if (input?.machineId) conds.push(eq(andonEvents.machineId, input.machineId));
      // ★ ĐỢT 24 — cổng tenant ĐỨNG CẠNH bộ lọc tự khai, không thay nó: một
      //   `input.lineId` của tenant khác vẫn phải cho 0 hàng.
      const congPhamVi = await menhDePhamViAndon(ctx);
      if (congPhamVi) conds.push(congPhamVi);
      return db
        .select()
        .from(andonEvents)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(andonEvents.raisedAt))
        .limit(input?.limit ?? 100);
    }),

  /**
   * ★★★ ĐỢT 24 VIỆC 1 — thủ tục nuôi **BADGE VỎ ỨNG DỤNG** (`ShellAlertChip`).
   *
   * Bản trước khai `async () => {…}`: KHÔNG `ctx`, KHÔNG mệnh đề tenant. Vì chip
   * sống ở header vỏ và poll 15 s, lỗ này hiện diện trên MỌI màn — xem
   * `menhDePhamViAndon`.
   */
  active: protectedProcedure
    .use(requirePermission("andon", "canView"))
    .query(async ({ ctx }) => {
      const db = await getDb();
      const congPhamVi = await menhDePhamViAndon(ctx);
      return db
        .select()
        .from(andonEvents)
        .where(and(isNull(andonEvents.resolvedAt), congPhamVi))
        .orderBy(desc(andonEvents.raisedAt))
        .limit(200);
    }),

  /**
   * ★ ĐỢT 24 — `get` nhận `id` TỰ KHAI, đúng hình dạng `acknowledge`/`resolve`.
   *   `congPhamViAndon` đã đọc hàng VÀ gác phạm vi trong một lần, nên nó thay
   *   trọn phần thân cũ (G12 — không có phép đọc thứ hai ở đây).
   */
  get: protectedProcedure
    .use(requirePermission("andon", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return congPhamViAndon(input.id, ctx);
    }),

  metrics: protectedProcedure
    .use(requirePermission("andon", "canView"))
    .input(z.object({
      sinceHours: z.number().int().min(1).max(24 * 90).default(24),
      // doc 64 IA-10 S4 — trục phạm vi (optional/additive): MTTA/MTTR theo Chuyền/Máy.
      lineId: z.number().int().positive().optional(),
      machineId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      const since = new Date(Date.now() - (input?.sinceHours ?? 24) * 3600 * 1000);
      const conds = [gte(andonEvents.raisedAt, since)];
      if (input?.lineId !== undefined) conds.push(eq(andonEvents.lineId, input.lineId));
      if (input?.machineId !== undefined) conds.push(eq(andonEvents.machineId, input.machineId));
      // ★ ĐỢT 24 — MTTA/MTTR là số GỘP: không gác thì một tài khoản 0-gán đọc
      //   được nhịp vận hành của mọi nhà máy mà không cần thấy một hàng nào.
      const congPhamVi = await menhDePhamViAndon(ctx);
      if (congPhamVi) conds.push(congPhamVi);
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
