import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import * as db from "../db";
import { requireAnyPermission } from "../_core/accessControl";
import { createAuditContext, logCrudOperation } from "../services/auditTrailService";

// doc 42 #18 — RBAC split-brain: bố trí xưởng là master-data của "Quản lý dữ liệu".
// FE gate module `settings_factory`; BE khớp permission thay vì hardgate role==='admin'.
const MODULE = "settings_factory";

// BG-132 — ruling (A) chủ dự án 2026-09-05: hạ gate SERVER của đường GHI bố cục theo ruling (A)
// đã cài ở đường ĐỌC client (RouteGuard `/digital-twin` gate `analytics_oee`, Khối D Task 2).
// Lô 5 Mục 1 đo được (DB thật, user role:'operator' KHÔNG-admin — admin bypass checkPermission)
// LỆCH: 6 mutation dưới đây vẫn gate CHỈ `settings_factory`, người có `analytics_oee` (không có
// `settings_factory`) bị chặn dù ruling (A) đã mở cổng xem cùng tài nguyên qua hub. Quyết định
// chủ dự án: OR HAI QUYỀN — `analytics_oee` HOẶC `settings_factory` — KHÔNG thay `settings_factory`
// bằng `analytics_oee` (đó sẽ làm MẤT quyền của người dùng `settings_factory` cũ, chống hồi quy
// RÀNG BUỘC bởi brief). Rủi ro đã nhận từ ruling (A) gốc: người có `analytics_oee` (vai phân
// tích/xem OEE) nay SỬA được bố cục xưởng — chủ dự án chấp nhận rủi ro này khi chốt ruling (A).
// Middleware dùng chung `requireAnyPermission` (sinh cùng đợt, `server/_core/accessControl.ts`).
const MODULE_OEE = "analytics_oee";
const canCreate = protectedProcedure.use(requireAnyPermission([
  { module: MODULE_OEE, action: "canCreate" },
  { module: MODULE, action: "canCreate" },
]));
const canEdit = protectedProcedure.use(requireAnyPermission([
  { module: MODULE_OEE, action: "canEdit" },
  { module: MODULE, action: "canEdit" },
]));
const canDelete = protectedProcedure.use(requireAnyPermission([
  { module: MODULE_OEE, action: "canDelete" },
  { module: MODULE, action: "canDelete" },
]));

// Khối D Task 2 (RULING R-KD-1) — (A) đổi CỔNG XEM bố cục (settings_factory → analytics_oee
// qua hub /digital-twin); BG-132 (trên) nay đổi luôn CỔNG GHI (canCreate/canEdit/canDelete) theo
// CÙNG ruling, dạng OR-hai-quyền chống hồi quy. Khuôn audit dùng lại NGUYÊN VẸN từ
// `hierarchyRouters.ts:123` (logCrudOperation + createAuditContext) — KHÔNG phát minh cơ chế
// mới. `logCrudOperation` tự nuốt lỗi (không ném), nên audit không bao giờ làm hỏng luồng ghi
// chính. `audit_logs` là WORM với vai `avi_app` (INSERT+SELECT, không DELETE) — mỗi lần gọi để
// lại một hàng, test không dọn được.
//
// ⚠ Brief gốc chỉ nêu 4 mutation (create/update/delete/updateMachinePosition). Đo lại đủ file:
// CÓ 6 mutation ghi bố cục — thiếu `addMachinePosition` và `removeMachinePosition` khỏi danh
// sách. Cả hai cùng gate (canEdit/canDelete), cùng ghi bảng `machine_positions` — vị trí máy
// trong xưởng CŨNG là "bố cục" theo đúng nghĩa rủi ro (A) đang nói tới, nên audit cả 6, không
// chỉ 4. Hai entityType tách bạch vì hai bảng khác nhau, tránh entityId lẫn giữa hai không gian
// khoá (id của factoryLayouts ≠ id của machinePositions).
const ENTITY_LAYOUT = "layout";
const ENTITY_MACHINE_POSITION = "layout_machine_position";

export const layoutRouter = router({
  // Đo lại trước khi vá (Lô 5 Mục 1, `layoutRoutersPermissionKhoiD.db.test.ts`): CẢ HAI
  // read-procedure dưới đây là `protectedProcedure` TRẦN — KHÔNG gate quyền nào, có từ TRƯỚC
  // Khối D (không phải hệ quả ruling A). BG-132 chỉ xin đổi ĐƯỜNG GHI (6 mutation) ⇒ GIỮ
  // NGUYÊN, không thêm gate ở đây (ngoài phạm vi ràng buộc chống hồi quy của Lô 6).
  listByWorkshop: protectedProcedure
    .input(z.object({ workshopId: z.number() }))
    .query(async ({ input }) => {
      return db.getFactoryLayoutsByWorkshop(input.workshopId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const layout = await db.getFactoryLayoutById(input.id);
      if (!layout) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'factoryLayout' }, 'Layout not found');
      }
      
      const positions = await db.getMachinePositionsByLayout(input.id);
      return { layout, positions };
    }),

  create: canCreate
    .input(z.object({
      workshopId: z.number(),
      name: z.string().min(1).max(255),
      layoutType: z.enum(["2D", "3D"]).optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      layoutData: z.string().optional(),
      backgroundImageUrl: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createFactoryLayout(input);
      await logCrudOperation(createAuditContext(ctx), {
        action: "create",
        entityType: ENTITY_LAYOUT,
        entityId: id,
        entityName: input.name,
        details: { operation: "create", after: input },
        status: "success",
      });
      return { id };
    }),

  update: canEdit
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      layoutType: z.enum(["2D", "3D"]).optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      layoutData: z.string().optional(),
      backgroundImageUrl: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const existing = await db.getFactoryLayoutById(id);
      if (!existing) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'factoryLayout' }, 'Layout not found');
      }
      await db.updateFactoryLayout(id, data);
      // `existing` đã đọc ở trên cho kiểm NOT_FOUND — dùng lại làm "before", không tốn thêm truy vấn.
      await logCrudOperation(createAuditContext(ctx), {
        action: "update",
        entityType: ENTITY_LAYOUT,
        entityId: id,
        entityName: existing.name,
        details: { operation: "update", before: existing, after: data },
        status: "success",
      });
      return { success: true };
    }),

  // doc 42 #17 — xoá layout (soft-delete). Trước đây thiếu procedure → không dọn được.
  delete: canDelete
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await db.getFactoryLayoutById(input.id);
      if (!existing) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'factoryLayout' }, 'Layout not found');
      }
      await db.deleteFactoryLayout(input.id);
      await logCrudOperation(createAuditContext(ctx), {
        action: "delete",
        entityType: ENTITY_LAYOUT,
        entityId: input.id,
        entityName: existing.name,
        details: { operation: "delete", before: existing },
        status: "success",
      });
      return { success: true };
    }),

  addMachinePosition: canEdit
    .input(z.object({
      layoutId: z.number(),
      machineId: z.number(),
      positionX: z.number(),
      positionY: z.number(),
      positionZ: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      rotation: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createMachinePosition(input);
      await logCrudOperation(createAuditContext(ctx), {
        action: "create",
        entityType: ENTITY_MACHINE_POSITION,
        entityId: id,
        entityName: `layout#${input.layoutId}/machine#${input.machineId}`,
        details: { operation: "create", after: input, metadata: { layoutId: input.layoutId } },
        status: "success",
      });
      return { id };
    }),

  updateMachinePosition: canEdit
    .input(z.object({
      id: z.number(),
      positionX: z.number().optional(),
      positionY: z.number().optional(),
      positionZ: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      rotation: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await db.updateMachinePosition(id, data);
      // ⚠ Không đọc "before": mutation này KHÔNG có kiểm NOT_FOUND sẵn (khác `update` bố cục ở
      // trên) nên đọc trước sẽ là một truy vấn MỚI, không tái dùng được. Theo đúng khuyến nghị
      // của brief — ghi `after` + id, không thêm truy vấn. Xem báo cáo Task 2 nếu cần đủ before/after.
      await logCrudOperation(createAuditContext(ctx), {
        action: "update",
        entityType: ENTITY_MACHINE_POSITION,
        entityId: id,
        entityName: `machine_position#${id}`,
        details: { operation: "update", after: data },
        status: "success",
      });
      return { success: true };
    }),

  removeMachinePosition: canDelete
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.deleteMachinePosition(input.id);
      // Cùng lý do trên: không có kiểm NOT_FOUND sẵn ⇒ không "before" mà không thêm truy vấn.
      await logCrudOperation(createAuditContext(ctx), {
        action: "delete",
        entityType: ENTITY_MACHINE_POSITION,
        entityId: input.id,
        entityName: `machine_position#${input.id}`,
        details: { operation: "delete" },
        status: "success",
      });
      return { success: true };
    }),
});
