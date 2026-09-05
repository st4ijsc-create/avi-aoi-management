/**
 * server/routers/layoutRoutersAuditKhoiD.db.test.ts
 *
 * Khối D Task 2 (RULING R-KD-1) — audit cho đường ghi bố cục. Xem docblock đầu
 * `layoutRouters.ts` cho bối cảnh: (A) đổi CỔNG XEM bố cục (settings_factory →
 * analytics_oee qua hub `/digital-twin`) mà giữ nguyên CỔNG GHI ⇒ rủi ro chủ dự án
 * NHẬN ("ai có quyền phân tích mà không có settings_factory sẽ sửa được bố cục
 * xưởng") chỉ trở nên QUAN SÁT ĐƯỢC nếu mọi lượt ghi để lại một hàng `audit_logs`.
 *
 * ── DB THẬT, KHÔNG MOCK ─────────────────────────────────────────────────────────
 * Gọi thẳng `layoutRouter` qua `createCaller` (không mock `../db` hay
 * `auditTrailService`) rồi SELECT lại `audit_logs` bằng chính client thật của server
 * (`db.getDb()`) — cùng khuôn `dangKyTinHieuHinhDangIngestBg89.test.ts`. Vai đo được
 * là `avi_app`, DB là bản `_test` (derive bởi `vitest.setup.ts`) — cầu chì Đ-28 kiểm
 * `current_user` ngay ở `beforeAll`, mọi thông điệp assert kèm `current_database()`.
 *
 * ── KHÔNG CẦN DỰNG CÂY FACTORY/WORKSHOP/MACHINE THẬT ────────────────────────────
 * Đo: `drizzle/0000_volatile_zaladane.sql` chỉ khai PRIMARY KEY cho `factory_layouts`
 * và `machine_positions` — KHÔNG có `REFERENCES`/FOREIGN KEY nào tới `workshops`/
 * `machines`. Router thật cũng không kiểm sự tồn tại của `workshopId`/`machineId`
 * trước khi ghi. Vì vậy các ca dưới dùng id giả (777777, 888888…) — đúng hành vi
 * router thật, không phải mẹo dựng lưới.
 *
 * ── ĐÃ ĐO 6 MUTATION, KHÔNG PHẢI 4 ──────────────────────────────────────────────
 * Brief gốc chỉ nêu 4 (create/update/delete/updateMachinePosition). Đọc lại đủ file
 * `layoutRouters.ts`: có CHẮC 6 mutation ghi bố cục — thiếu `addMachinePosition` và
 * `removeMachinePosition`. Cả hai cùng ghi bảng `machine_positions` (vị trí máy
 * trong xưởng), tức cùng loại rủi ro (A) đang nói — lưới này khoá đủ 6, không chỉ 4.
 *
 * ── WORM — KHÔNG DỌN `audit_logs` ───────────────────────────────────────────────
 * `audit_logs` là WORM cho vai `avi_app` (INSERT+SELECT, REVOKE UPDATE/DELETE, mig
 * 0224) ⇒ `afterAll` CHỈ dọn `factory_layouts`/`machine_positions` (hai bảng này
 * KHÔNG WORM) — KHÔNG đụng `audit_logs`, và KHÔNG `.catch(() => {})` quanh việc dọn
 * hai bảng đó (một catch rỗng ở đây là dọn dẹp câm, bài học các lưới Khối B/C).
 * Số hàng `audit_logs` do file này để lại: 6 (một hàng mỗi mutation, một lần chạy).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, sql } from "drizzle-orm";
import * as db from "../db";
import { auditLogs, factoryLayouts, machinePositions } from "../../drizzle/schema";
import { layoutRouter } from "./layoutRouters";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const STAMP = `${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
let tenDb = "(chưa đo)";

// role "admin" bypass `checkPermission` mà không cần seed bảng `permissions` — xem
// server/_core/accessControl.ts:205-207 (god-mode mặc định, scopedAdminEnabled() TẮT).
function ctx(): TrpcContext {
  return {
    user: { id: 900001, name: `KhoiD-T2-${STAMP}`, role: "admin" } as TrpcContext["user"],
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
const caller = () => layoutRouter.createCaller(ctx());

/** SELECT thật trên `audit_logs`, lọc đúng (entityType, entityId) — cùng khuôn dangKyTinHieuHinhDangIngestBg89.test.ts. */
async function hangKhopEntity(entityType: string, entityId: number) {
  const d = await db.getDb();
  if (!d) throw new Error("DB không sẵn sàng — lưới này cần DB THẬT, không mock");
  return d
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)));
}

function chiTietCua(hang: { details: unknown }): { before?: any; after?: any; metadata?: any } {
  return JSON.parse(hang.details as string);
}

const idsToClean = { layoutIds: [] as number[], positionIds: [] as number[] };

describe.skipIf(!DB_URL)(
  "Khối D Task 2 — audit đường ghi bố cục (layoutRouter, DB THẬT vai avi_app)",
  () => {
    beforeAll(async () => {
      const d = await db.getDb();
      if (!d) throw new Error("DB không sẵn sàng");
      const rows = (await d.execute(
        sql`SELECT current_database() AS db, current_user AS usr`,
      )) as unknown as { db: string; usr: string }[];
      const row = Array.isArray(rows) ? rows[0] : (rows as any).rows[0];
      tenDb = row.db;
      // ⚠ Cầu chì Đ-28: vai không phải avi_app thì phép đo WORM/quyền bên dưới vô nghĩa.
      expect(row.usr, "phải đo bằng vai avi_app — vai superuser (BYPASSRLS) làm WORM giả-xanh").toBe(
        "avi_app",
      );
      // eslint-disable-next-line no-console
      console.log(`[layoutRoutersAuditKhoiD] current_database()=${row.db} current_user=${row.usr}`);
    });

    afterAll(async () => {
      const d = await db.getDb();
      if (!d) return;
      // factory_layouts / machine_positions KHÔNG WORM — dọn THẬT, không nuốt lỗi.
      for (const id of idsToClean.positionIds) {
        await d.delete(machinePositions).where(eq(machinePositions.id, id));
      }
      for (const id of idsToClean.layoutIds) {
        await d.delete(factoryLayouts).where(eq(factoryLayouts.id, id));
      }
      // KHÔNG xoá audit_logs: WORM, avi_app không có DELETE (mig 0224) — hàng ở lại vĩnh viễn.
    });

    it("layout.create — 1 hàng audit_logs entityType=layout, action=create", async () => {
      const name = `KD-T2-CREATE-${STAMP}`;
      const res = await caller().create({ workshopId: 777777, name });
      idsToClean.layoutIds.push(res.id);
      const rows = await hangKhopEntity("layout", res.id);
      expect(rows.length, `[${tenDb}] create phải để lại ĐÚNG 1 hàng audit_logs`).toBe(1);
      expect(rows[0].action).toBe("create");
      expect(rows[0].entityName).toBe(name);
      expect(rows[0].status).toBe("success");
      expect(chiTietCua(rows[0]).after).toMatchObject({ name, workshopId: 777777 });
    });

    it("layout.update — 1 hàng audit_logs mang before/after ĐÚNG (không tốn truy vấn mới — dùng lại `existing`)", async () => {
      const name = `KD-T2-UPDATE-${STAMP}`;
      const res = await caller().create({ workshopId: 777777, name });
      idsToClean.layoutIds.push(res.id);
      const tenMoi = `${name}-SUA`;
      await caller().update({ id: res.id, name: tenMoi });
      const rows = await hangKhopEntity("layout", res.id);
      const upd = rows.find((r) => r.action === "update");
      expect(upd, `[${tenDb}] update phải để lại hàng action=update`).toBeTruthy();
      const ct = chiTietCua(upd!);
      expect(ct.before).toMatchObject({ name });
      expect(ct.after).toMatchObject({ name: tenMoi });
    });

    it("layout.delete — 1 hàng audit_logs mang before (tên TRƯỚC khi xoá)", async () => {
      const name = `KD-T2-DELETE-${STAMP}`;
      const res = await caller().create({ workshopId: 777777, name });
      // Bị xoá ngay trong ca — KHÔNG đưa vào idsToClean (đã không còn hàng để dọn).
      await caller().delete({ id: res.id });
      const rows = await hangKhopEntity("layout", res.id);
      const del = rows.find((r) => r.action === "delete");
      expect(del, `[${tenDb}] delete phải để lại hàng action=delete`).toBeTruthy();
      expect(chiTietCua(del!).before).toMatchObject({ name });
    });

    it("addMachinePosition — 1 hàng audit_logs entityType=layout_machine_position, action=create, metadata.layoutId đúng", async () => {
      const layout = await caller().create({ workshopId: 777777, name: `KD-T2-POS-ADD-${STAMP}` });
      idsToClean.layoutIds.push(layout.id);
      const res = await caller().addMachinePosition({
        layoutId: layout.id, machineId: 888888, positionX: 10, positionY: 20,
      });
      idsToClean.positionIds.push(res.id);
      const rows = await hangKhopEntity("layout_machine_position", res.id);
      expect(rows.length, `[${tenDb}] addMachinePosition phải để lại ĐÚNG 1 hàng`).toBe(1);
      expect(rows[0].action).toBe("create");
      const ct = chiTietCua(rows[0]);
      expect(ct.after).toMatchObject({ layoutId: layout.id, machineId: 888888 });
      expect(ct.metadata).toMatchObject({ layoutId: layout.id });
    });

    it("updateMachinePosition — 1 hàng audit_logs entityType=layout_machine_position, action=update (KHÔNG có mutation này trước bản vá — brief gốc bỏ sót)", async () => {
      const layout = await caller().create({ workshopId: 777777, name: `KD-T2-POS-UPD-${STAMP}` });
      idsToClean.layoutIds.push(layout.id);
      const pos = await caller().addMachinePosition({
        layoutId: layout.id, machineId: 888889, positionX: 1, positionY: 1,
      });
      idsToClean.positionIds.push(pos.id);
      await caller().updateMachinePosition({ id: pos.id, positionX: 99 });
      const rows = await hangKhopEntity("layout_machine_position", pos.id);
      const upd = rows.find((r) => r.action === "update");
      expect(upd, `[${tenDb}] updateMachinePosition phải để lại hàng action=update`).toBeTruthy();
      expect(chiTietCua(upd!).after).toMatchObject({ positionX: 99 });
    });

    it("removeMachinePosition — 1 hàng audit_logs entityType=layout_machine_position, action=delete (brief gốc bỏ sót mutation này)", async () => {
      const layout = await caller().create({ workshopId: 777777, name: `KD-T2-POS-DEL-${STAMP}` });
      idsToClean.layoutIds.push(layout.id);
      const pos = await caller().addMachinePosition({
        layoutId: layout.id, machineId: 888890, positionX: 2, positionY: 2,
      });
      // KHÔNG đưa pos.id vào idsToClean.positionIds — removeMachinePosition xoá hàng ngay dưới đây.
      await caller().removeMachinePosition({ id: pos.id });
      const rows = await hangKhopEntity("layout_machine_position", pos.id);
      const del = rows.find((r) => r.action === "delete");
      expect(del, `[${tenDb}] removeMachinePosition phải để lại hàng action=delete`).toBeTruthy();
    });
  },
);
