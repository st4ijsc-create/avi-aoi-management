/**
 * Maintenance Work-Order CRUD router (key "maintenance") — closes the PdM loop.
 *
 * Today a work-order is created ONLY by the RCA write-tool
 * (aiLocalTools/writeHandlers/maintenance.ts) and listed read-only via
 * mesControlTowerRouter.listWorkOrders. This router adds the missing manage
 * surface: create / get / update (assign·priority·status·notes) / CLOSE /
 * delete — so a technician can actually run a work-order to completion.
 *
 * The CLOSE action is the key PdM-loop closer: it sets status=COMPLETED +
 * closedAt and derives downtimeMinutes (so computeMttrMtbf / reliability picks
 * it up → MTTR). repairStartedAt defaults to openedAt when the IN_PROGRESS
 * transition was never recorded, so MTTR never silently reads 0.
 *
 * SAFETY: pure maintenance master-data + lifecycle. NOTHING here writes a value
 * to a machine (no commandDispatcher / driver.writeTags). All writers are
 * getDb()-guarded.
 *
 * RBAC: module "machine_monitoring" (the same grant the RCA write-tool uses for
 *   create — machine_monitoring/canCreate). canView/canCreate/canEdit/canDelete
 *   via requirePermission. Admin always passes; non-admin without an explicit
 *   grant is denied (fail-safe FORBIDDEN).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 15 LÔ R (L-1) — **HÀNG RÀO TENANT CHO ĐƯỜNG GHI.**
 * ══════════════════════════════════════════════════════════════════════════════
 * Lô Q1 vá đường ĐỌC của `digitalTwinRouter`. Cùng hình dạng ấy còn nguyên ở
 * ĐÂY, và ở đây nó nặng hơn vì là đường GHI:
 *
 *     createWorkOrder khai `async ({ input })` — **KHÔNG bóc `ctx` một lần nào**.
 *     `input.machineId` là lời TỰ KHAI của client, chỉ được dùng để tra
 *     `machines.code`; không `phamViCua`, không kiểm phạm vi.
 *
 * Bề mặt đo được trên `aoi_management` 2026-09-08: **43 máy / 2 nhà máy** (và
 * 283 máy / 3 nhà máy ở bản đo của brief). Một tài khoản có
 * `machine_monitoring/canCreate` ở nhà máy A **tạo được phiếu bảo trì cho bất kỳ
 * máy nào** của nhà máy B — chỉ cần đoán một số nguyên.
 *
 * ★★★ **`requirePermission` KHÔNG đo tenant.** Hai trục khác nhau: nó trả lời
 *   "vai này được phép LÀM việc này không", KHÔNG trả lời "trên THỰC THỂ NÀO".
 *   Chỉ một trong hai trục có người canh, và đó là trục sai.
 *
 * ⚠⚠ **PHẠM VI RỘNG HƠN BRIEF.** Brief chỉ nêu `createWorkOrder`. Đo lại tệp
 *   này cho thấy **cả sáu** thủ tục đều không bóc `ctx`: `listWorkOrders`,
 *   `getWorkOrder`, `createWorkOrder`, `updateWorkOrder`, `closeWorkOrder`,
 *   `deleteWorkOrder`. Vá mỗi `create` là để lại đúng cánh cửa ấy cho `update`
 *   /`close`/`delete` — một `id` đoán được vẫn sửa và XOÁ được phiếu của tenant
 *   khác. Nên bản vá này đi hết cả sáu.
 *
 * **Trục ID, không phải trục mã.** `maintenance_work_orders.machineId` treo vào
 * chuỗi phân cấp `machines → stations → production_lines → workshops → factories`
 * ⇒ `idsTrongPhamVi("machine", …)` / `trongPhamVi("machine", id, …)`. Cột
 * `machineCode` trên bảng này là bản SAO tiện tra cứu, KHÔNG phải khoá tenant —
 * lọc theo nó là lọc theo một quy ước, không theo một quan hệ có thật.
 *
 * ⚠ `null` từ `idsTrongPhamVi` = vai toàn quyền ⇒ **KHÔNG thêm mệnh đề nào**
 *   (chiều DƯƠNG chống "vá quá tay thành chặn tất cả"). `[]` = 0 gán ⇒ 0 hàng.
 *
 * ⚠ **Phiếu có `machineId` NULL**: bảng cho phép NULL, và một hàng như thế
 *   KHÔNG có đường nào truy ra nhà máy. Quyết định: **fail-CLOSED** — người bị
 *   thu hẹp KHÔNG thấy và KHÔNG sửa được nó; vai toàn quyền vẫn thấy. Cùng luật
 *   đã ghi ở `congMaTenant` ("hàng có cả hai mã NULL bị LOẠI") và ở nhánh
 *   `workstation` mồ côi của `idsTrongPhamVi`.
 *
 * ⚠ Id ngoài phạm vi xử như **KHÔNG TỒN TẠI** (`NOT_FOUND`), không phải
 *   `FORBIDDEN`: một thông báo "bạn không được sửa phiếu 42" vẫn xác nhận phiếu
 *   42 có thật. Cùng luật lô Q1.
 *
 * Nghiệm thu: `maintenanceAndonPhamVi.db.test.ts` (hai chiều, CSDL thật, vai
 * KHÔNG-admin).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { idsTrongPhamVi, trongPhamVi } from "../db/hierarchy";
import { phamViCua } from "./_phamViNguoiXem";
import { getDb } from "../db/connection";
import { maintenanceWorkOrders, machines, sparePartsInventory } from "../../drizzle/schema";
// W4-A (doc 35) — spare-parts consumption ledger lives in its own schema file.
import { workOrderParts } from "../../drizzle/schema/maintenanceParts";

const MODULE = "machine_monitoring";

const WORK_ORDER_STATUSES = ["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
const WORK_ORDER_TYPES = ["PREVENTIVE", "PREDICTIVE", "CORRECTIVE", "BREAKDOWN", "INSPECTION"] as const;

const OPEN_STATUSES = new Set(["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"]);

/** Generate a unique-enough work-order number (mirrors writeHandlers/maintenance.ts). */
function buildWorkOrderNumber(machineId: number): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `WO-${machineId}-${Date.now()}-${rand}`;
}

/**
 * ★ L-1 — đọc một phiếu **theo `id` TỰ KHAI**, đã qua cổng phạm vi.
 *
 * ⚠ Đây là chỗ dễ vá sai nhất (luật đã ghi ở `trongPhamVi`): nếu cổng chỉ áp lên
 *   DANH SÁCH mà không áp lên đường tra cứu theo `id`, một số nguyên đoán được
 *   vẫn mở được cửa sang tenant khác — và ở router này cửa ấy dẫn tới UPDATE,
 *   CLOSE và DELETE, không chỉ SELECT.
 *
 * ⚠ Ngoài phạm vi ⇒ **`NOT_FOUND`, không phải `FORBIDDEN`**: một mã riêng cho
 *   "có thật nhưng không phải của bạn" vẫn rò rỉ sự tồn tại của hàng ấy.
 *
 * ⚠ `machineId` NULL ⇒ fail-CLOSED cho người bị thu hẹp (xem docblock đầu tệp).
 */
async function getRow(id: number, ctx?: Parameters<typeof phamViCua>[0]) {
  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
  const [row] = await db.select().from(maintenanceWorkOrders).where(eq(maintenanceWorkOrders.id, id)).limit(1);
  if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workOrder" }, `work_order ${id} not found`);
  if (ctx !== undefined) {
    const idsMay = await idsTrongPhamVi("machine", phamViCua(ctx));
    if (idsMay !== null) {
      // `null` = toàn quyền ⇒ không cổng nào. Ngược lại: phiếu phải trỏ vào một
      // máy TRONG phạm vi. `machineId` NULL không truy được lên nhà máy ⇒ loại.
      if (row.machineId == null || !idsMay.includes(row.machineId)) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workOrder" }, `work_order ${id} not found`);
      }
    }
  }
  return row;
}

// Drop undefined keys so partial updates only touch provided fields.
function clean<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const maintenanceRouter = router({
  // ── list (read) — filter by status / machine ─────────────────────────────────
  listWorkOrders: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({
      status: z.enum(WORK_ORDER_STATUSES).optional(),
      machineId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      // ★ L-1 — cổng tenant. `null` = toàn quyền ⇒ không thêm mệnh đề nào;
      //   `[]` = 0 gán ⇒ 0 hàng (KHÔNG phải "không lọc").
      const idsMay = await idsTrongPhamVi("machine", phamViCua(ctx));
      if (idsMay !== null && idsMay.length === 0) return [];
      const conds = [] as any[];
      if (input?.status) conds.push(eq(maintenanceWorkOrders.status, input.status));
      if (input?.machineId) conds.push(eq(maintenanceWorkOrders.machineId, input.machineId));
      // ⚠ `input.machineId` là lời TỰ KHAI: một máy ngoài phạm vi phải cho tập
      //   RỖNG như thể nó không tồn tại — mệnh đề `inArray` dưới đây làm việc ấy.
      //   `machineId` NULL bị loại theo luật fail-CLOSED (docblock đầu tệp).
      if (idsMay !== null) conds.push(inArray(maintenanceWorkOrders.machineId, idsMay));
      return await db.select().from(maintenanceWorkOrders)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(maintenanceWorkOrders.openedAt))
        .limit(input?.limit ?? 200);
    }),

  // ── get one (read) ───────────────────────────────────────────────────────────
  getWorkOrder: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input, ctx }) => getRow(input.id, ctx)),

  // ── create (write) — reuses the writeHandlers/maintenance.ts insert pattern ───
  createWorkOrder: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      machineId: z.number().int().positive(),
      title: z.string().min(3).max(256),
      description: z.string().max(4000).optional(),
      type: z.enum(WORK_ORDER_TYPES).default("CORRECTIVE"),
      priority: z.number().int().min(1).max(5).default(3), // 1 = highest
      assignedTo: z.number().int().positive().nullable().optional(),
      status: z.enum(WORK_ORDER_STATUSES).default("OPEN"),
      scheduledFor: z.string().datetime().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      // ══════════════════════════════════════════════════════════════════════
      // ★★★ L-1 — LỖ GHI XUYÊN TENANT. Đây là dòng mà bản gốc KHÔNG có.
      // ══════════════════════════════════════════════════════════════════════
      // `input.machineId` do client TỰ KHAI. Bản gốc chỉ dùng nó để tra
      // `machines.code` rồi ghi thẳng — nên một tài khoản có `canCreate` ở nhà
      // máy A tạo được phiếu cho máy của nhà máy B bằng cách đoán số nguyên.
      //
      // ⚠ `trongPhamVi` trả `true` khi phạm vi là `null` (toàn quyền) ⇒ admin và
      //   lối không mang danh tính KHÔNG bị thu hẹp.
      // ⚠ `NOT_FOUND` chứ không `FORBIDDEN` — xem docblock `getRow`.
      if (!(await trongPhamVi("machine", input.machineId, phamViCua(ctx)))) {
        throw appError(
          "NOT_FOUND",
          "ENTITY_NOT_FOUND",
          { entity: "machine" },
          `machine ${input.machineId} not found`,
        );
      }
      const [machine] = await db.select({ code: machines.code }).from(machines).where(eq(machines.id, input.machineId)).limit(1);
      const [row] = await db
        .insert(maintenanceWorkOrders)
        .values({
          workOrderNumber: buildWorkOrderNumber(input.machineId),
          machineId: input.machineId,
          machineCode: machine?.code ?? null,
          type: input.type,
          status: input.status,
          trigger: "MANUAL",
          priority: input.priority,
          title: input.title,
          description: input.description ?? null,
          assignedTo: input.assignedTo ?? null,
          scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        } as any)
        .returning();
      return row;
    }),

  // ── update (write) — assign / priority / status / type / notes ────────────────
  // A transition INTO IN_PROGRESS stamps repairStartedAt (drives MTTR span).
  updateWorkOrder: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      id: z.number().int().positive(),
      title: z.string().min(3).max(256).optional(),
      description: z.string().max(4000).nullable().optional(),
      type: z.enum(WORK_ORDER_TYPES).optional(),
      priority: z.number().int().min(1).max(5).optional(),
      status: z.enum(WORK_ORDER_STATUSES).optional(),
      assignedTo: z.number().int().positive().nullable().optional(),
      resolutionNotes: z.string().max(4000).nullable().optional(),
      scheduledFor: z.string().datetime().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      // ★ L-1 — `getRow(id, ctx)` là cổng: phiếu ngoài phạm vi ⇒ `NOT_FOUND`.
      const existing = await getRow(input.id, ctx);

      // Stamp repairStartedAt on first transition into IN_PROGRESS.
      const startRepair =
        input.status === "IN_PROGRESS" && existing.status !== "IN_PROGRESS" && existing.repairStartedAt == null;

      const patch = clean({
        title: input.title,
        description: input.description,
        type: input.type,
        priority: input.priority,
        status: input.status,
        assignedTo: input.assignedTo,
        resolutionNotes: input.resolutionNotes,
        scheduledFor: input.scheduledFor === undefined ? undefined : (input.scheduledFor ? new Date(input.scheduledFor) : null),
        repairStartedAt: startRepair ? new Date() : undefined,
        updatedAt: new Date(),
      });

      const [row] = await db.update(maintenanceWorkOrders).set(patch).where(eq(maintenanceWorkOrders.id, input.id)).returning();
      return row;
    }),

  // ── close (write) — THE PdM-loop closer ──────────────────────────────────────
  // Sets status=COMPLETED + closedAt and records the resolution. Computes
  // downtimeMinutes (closedAt − repairStartedAt, falling back to openedAt) so
  // reliability/computeMttrMtbf can derive MTTR. Idempotent-safe: closing an
  // already-closed order is rejected.
  closeWorkOrder: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      id: z.number().int().positive(),
      resolutionNotes: z.string().max(4000).optional(),
      downtimeMinutes: z.number().int().min(0).max(60 * 24 * 365).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      // ★ L-1 — cổng phạm vi TRƯỚC mọi kiểm tra vòng đời.
      const existing = await getRow(input.id, ctx);
      if (existing.status === "COMPLETED") {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "closeWorkOrder" }, "Work order already completed");
      }
      if (existing.status === "CANCELLED") {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "closeWorkOrder" }, "Cannot close a cancelled work order");
      }

      const closedAt = new Date();
      // MTTR span: prefer repairStartedAt, fall back to openedAt so the metric
      // is never silently zero when IN_PROGRESS was skipped.
      const startedAt = existing.repairStartedAt ?? existing.openedAt ?? closedAt;
      const computedDowntime = Math.max(0, Math.round((closedAt.getTime() - new Date(startedAt).getTime()) / 60000));
      const downtimeMinutes = input.downtimeMinutes ?? computedDowntime;

      const [row] = await db.update(maintenanceWorkOrders)
        .set({
          status: "COMPLETED",
          closedAt,
          repairStartedAt: existing.repairStartedAt ?? new Date(startedAt),
          downtimeMinutes,
          resolutionNotes: input.resolutionNotes ?? existing.resolutionNotes ?? null,
          updatedAt: closedAt,
        } as any)
        .where(eq(maintenanceWorkOrders.id, input.id))
        .returning();
      return row;
    }),

  // ── delete (write) ───────────────────────────────────────────────────────────
  deleteWorkOrder: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      // ★ L-1 — 404 nếu thiếu HOẶC ngoài phạm vi. XOÁ là hậu quả không lùi được,
      //   nên đây là chỗ cuối cùng được phép quên cổng.
      await getRow(input.id, ctx);
      await db.delete(maintenanceWorkOrders).where(eq(maintenanceWorkOrders.id, input.id));
      return { deleted: true, id: input.id };
    }),

  // ── status summary (read) — small badges on the list header ──────────────────
  summary: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { total: 0, open: 0, byStatus: {} as Record<string, number> };
      // ★ L-1 — một BẢN ĐẾM cũng rò rỉ tenant: "nhà máy B có 412 phiếu đang mở"
      //   là thông tin của nhà máy B, dù không hàng nào được trả về.
      const idsMay = await idsTrongPhamVi("machine", phamViCua(ctx));
      if (idsMay !== null && idsMay.length === 0) {
        return { total: 0, open: 0, byStatus: {} as Record<string, number> };
      }
      const rows = await db
        .select()
        .from(maintenanceWorkOrders)
        .where(idsMay !== null ? inArray(maintenanceWorkOrders.machineId, idsMay) : undefined);
      const byStatus: Record<string, number> = {};
      let open = 0;
      for (const r of rows) {
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
        if (OPEN_STATUSES.has(r.status)) open += 1;
      }
      return { total: rows.length, open, byStatus };
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // W4-A (doc 35 §W4.2) — spare-parts consumption on a work order.
  // Closes the orphan: spare_parts_inventory had no consumption link. Recording
  // parts used inserts a work_order_parts ledger row AND decrements on-hand stock
  // atomically (single db.transaction). Below-reorder query surfaces restock need.
  // ══════════════════════════════════════════════════════════════════════════

  // ── record parts used on a WO (write) — atomic ledger insert + stock decrement ─
  recordPartsUsed: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      workOrderId: z.number().int().positive(),
      sparePartId: z.number().int().positive().optional(),
      partCode: z.string().min(1).max(64).optional(),
      quantityUsed: z.number().int().min(1).max(1_000_000),
      notes: z.string().max(2000).optional(),
    }).refine((v) => v.sparePartId != null || v.partCode != null, {
      message: "Provide sparePartId or partCode",
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");

      // Validate the work order exists (soft FK — validated here, not in DDL).
      // ★ L-1 — và rằng nó THUỘC PHẠM VI người gọi: ghi sổ tiêu hao phụ tùng
      //   vào phiếu của tenant khác là một phép GHI xuyên tenant, và nó còn TRỪ
      //   tồn kho thật ở giao dịch ngay dưới.
      await getRow(input.workOrderId, ctx);

      return await db.transaction(async (tx) => {
        // Resolve the spare part by id or unique partCode, locking the row so a
        // concurrent consumption cannot over-draw the same stock.
        const [part] = await tx
          .select()
          .from(sparePartsInventory)
          .where(input.sparePartId != null
            ? eq(sparePartsInventory.id, input.sparePartId)
            : eq(sparePartsInventory.partCode, input.partCode!))
          .for("update")
          .limit(1);
        if (!part) {
          throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "sparePart" }, "Spare part not found");
        }
        if (part.quantityOnHand < input.quantityUsed) {
          throw appError(
            "BAD_REQUEST",
            "INVALID_VALUE",
            { field: "quantityUsed" },
            `Insufficient stock for ${part.partCode}: on hand ${part.quantityOnHand}, requested ${input.quantityUsed}`,
          );
        }

        // Ledger row — unitCost is snapshotted from the inventory master.
        const [row] = await tx
          .insert(workOrderParts)
          .values({
            workOrderId: input.workOrderId,
            sparePartId: part.id,
            partCode: part.partCode,
            quantityUsed: input.quantityUsed,
            unitCost: part.unitCost ?? null,
            consumedBy: ctx.user?.id ?? null,
            notes: input.notes ?? null,
          } as any)
          .returning();

        // Atomic decrement (clamped ≥ 0 defensively although validated above).
        const [updated] = await tx
          .update(sparePartsInventory)
          .set({
            quantityOnHand: sql`GREATEST(0, ${sparePartsInventory.quantityOnHand} - ${input.quantityUsed})`,
            updatedAt: new Date(),
          })
          .where(eq(sparePartsInventory.id, part.id))
          .returning({ id: sparePartsInventory.id, quantityOnHand: sparePartsInventory.quantityOnHand, reorderLevel: sparePartsInventory.reorderLevel });

        return {
          part: row,
          inventory: updated,
          belowReorder: updated ? updated.quantityOnHand <= updated.reorderLevel : false,
        };
      });
    }),

  // ── parts consumed on a WO (read) ─────────────────────────────────────────────
  listPartsForWorkOrder: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ workOrderId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      // ★ L-1 — cổng qua phiếu cha: `workOrderId` là lời TỰ KHAI. Ngoài phạm vi
      //   ⇒ `getRow` ném `NOT_FOUND`, cùng hình dạng với một phiếu không có thật.
      await getRow(input.workOrderId, ctx);
      return await db.select().from(workOrderParts)
        .where(eq(workOrderParts.workOrderId, input.workOrderId))
        .orderBy(desc(workOrderParts.consumedAt));
    }),

  // ── spare parts at/below reorder level (read) — restock worklist ──────────────
  partsBelowReorder: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return await db.select().from(sparePartsInventory)
        .where(lte(sparePartsInventory.quantityOnHand, sparePartsInventory.reorderLevel))
        .orderBy(sparePartsInventory.quantityOnHand)
        .limit(input?.limit ?? 200);
    }),
});
