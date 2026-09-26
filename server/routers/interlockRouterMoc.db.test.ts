/**
 * Task 2 (doc 80 Phụ lục D §6/§7.4 "Vá ngay") — MOC tối thiểu cho interlock:
 * ILK-01 (reset duyệt khi sửa rule đang sống), ILK-02 (SoD ở approve), ILK-03
 * (reason bắt buộc + audit cho disable/delete/resolveEvent), ILK-05 (đích bắt
 * buộc cho hành động khác 'alert' + commandValue lưu thật).
 *
 * Cổng DB THẬT (`_test`, ép bởi vitest.setup). `interlockRules`/`interlock_events`
 * không có FK ra `machines`/`users` (đọc `drizzle/schema/interlock.ts`) nên
 * fixture chỉ cần user id tổng hợp + `role: "admin"` — admin bỏ qua
 * `checkPermission` hoàn toàn (accessControl.ts:205-207, `RBAC_SCOPED_ADMIN`
 * không đặt trong .env lẫn vitest.setup ⇒ mặc định god-mode cũ), nên khác biệt
 * DUY NHẤT giữa hai "admin" trong test này là **id** — đúng thứ ILK-02 (SoD)
 * cần đo (approver ≠ createdBy/updatedBy), KHÔNG phải một bộ quyền khác.
 * `twoFactorEnabled: true` bắt buộc cho mọi actor: `AUTH_2FA_BAT_BUOC` không
 * được vitest.setup nạp từ .env (chủ ý, xem docblock ở đó) ⇒ `batBuoc2FA()`
 * mặc định TRUE trong test process ⇒ `actuationProcedure`/`adminProcedure` đòi
 * 2FA cho vai đặc quyền (admin/supervisor/engineer/quality_inspector).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { interlockRouter } from "./interlockRouter";

const DB_URL = process.env.DATABASE_URL;
const DAU = `ILKMOC-${Date.now()}`;

// Ba "actor" khác id — role admin (bỏ qua requirePermission) để cô lập đúng
// biến ILK-02 cần đo (SoD theo id, không theo bộ quyền).
const A = 990_200_001;
const B = 990_200_002;
const C = 990_200_003;

function caller(userId: number) {
  return interlockRouter.createCaller({
    user: { id: userId, role: "admin", name: `probe-${userId}`, twoFactorEnabled: true },
  } as any);
}

function baseInput(name: string, over: Record<string, unknown> = {}) {
  return {
    name,
    scope: "machine" as const,
    sourceType: "ng_rate" as const,
    comparisonOperator: "gt" as const,
    threshold: 5,
    action: "alert" as const,
    ...over,
  };
}

/** Đọc lại appCode từ một lỗi tRPC bị ném (cause.appCode — cùng lối đọc với các test khác trong repo). */
async function expectAppCode(p: Promise<unknown>, appCode: string): Promise<void> {
  let err: any = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, "phải bị chặn, nhưng lời gọi đã thành công").not.toBeNull();
  const code = err?.cause?.appCode ?? err?.appCode;
  expect(code, `sai cổng chặn: appCode=${code}`).toBe(appCode);
}

let sql: ReturnType<typeof postgres>;
const ruleIds: number[] = [];
const eventIds: number[] = [];

async function auditRowsFor(entityType: string, entityId: number, action: string) {
  return sql`
    SELECT reason, "beforeJson", "afterJson" FROM control_audit_log
     WHERE "entityType" = ${entityType} AND "entityId" = ${String(entityId)} AND action = ${action}
     ORDER BY id DESC`;
}

describe.skipIf(!DB_URL)("Task 2 — interlockRouter MOC (ILK-01/02/03/05)", () => {
  beforeAll(() => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
  }, 60_000);

  afterAll(async () => {
    // `control_audit_log` KHÔNG được dọn: bảng APPEND-ONLY (WORM) — role DB
    // `avi_app` bị từ chối DELETE trên bảng này BẰNG THIẾT KẾ (đã đo: "permission
    // denied for table control_audit_log"), đúng bất biến audit mà chính task
    // này đang canh. Các dòng audit của test này mang tiền tố DAU duy nhất nên
    // vô hại khi ở lại `_test`.
    if (ruleIds.length) await sql`DELETE FROM interlock_rules WHERE id = ANY(${ruleIds})`;
    if (eventIds.length) await sql`DELETE FROM interlock_events WHERE id = ANY(${eventIds})`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════
  describe("ILK-01 — sửa rule đã duyệt và/hoặc đang bật ⇒ reset duyệt + tắt", () => {
    it("★★★ update trên rule ĐÃ duyệt + ĐANG bật ⇒ approvedBy/approvedAt=null, enabled=false, audit reason đúng chữ", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-ilk01a`));
      ruleIds.push(created.id);
      await caller(B).approve({ id: created.id }); // B ≠ A (createdBy) → SoD OK
      const enabled = await caller(A).enable({ id: created.id });
      expect(enabled.approvedBy).toBe(B);
      expect(enabled.enabled).toBe(true);

      const updated = await caller(A).update({ id: created.id, name: `${DAU}-ilk01a-renamed` });
      expect(updated.name).toBe(`${DAU}-ilk01a-renamed`);
      expect(updated.approvedBy).toBeNull();
      expect(updated.approvedAt).toBeNull();
      expect(updated.enabled).toBe(false);

      const audit = await auditRowsFor("interlock_rule", created.id, "update");
      expect(audit.length).toBeGreaterThan(0);
      expect((audit[0] as any).reason).toBe("sửa rule đã duyệt ⇒ cần duyệt lại");
    });

    it("update chỉ đổi trường KHÔNG ảnh hưởng hành vi (description) trên rule đã duyệt ⇒ VẪN reset (Đợt 0 chọn an toàn)", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-ilk01b`));
      ruleIds.push(created.id);
      await caller(B).approve({ id: created.id });
      await caller(A).enable({ id: created.id });

      const updated = await caller(A).update({ id: created.id, description: "chỉ đổi mô tả" });
      expect(updated.description).toBe("chỉ đổi mô tả");
      expect(updated.approvedBy).toBeNull();
      expect(updated.enabled).toBe(false);
    });

    it("update trên rule CHƯA từng duyệt/bật ⇒ KHÔNG có gì để reset, audit reason=null", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-ilk01c`));
      ruleIds.push(created.id);
      const updated = await caller(A).update({ id: created.id, name: `${DAU}-ilk01c-v2` });
      expect(updated.approvedBy).toBeNull();
      expect(updated.enabled).toBe(false);
      const audit = await auditRowsFor("interlock_rule", created.id, "update");
      expect((audit[0] as any).reason).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("ILK-02 — SoD: người duyệt KHÔNG được là người tạo/sửa cuối", () => {
    it("★★★ người TẠO tự duyệt ⇒ FORBIDDEN/PERMISSION_DENIED, approvedBy KHÔNG đổi", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-ilk02a`));
      ruleIds.push(created.id);
      await expectAppCode(caller(A).approve({ id: created.id }), "PERMISSION_DENIED");
      const row = await caller(B).get({ id: created.id });
      expect(row.approvedBy).toBeNull();
    });

    it("★★★ người SỬA CUỐI (không phải người tạo) tự duyệt ⇒ vẫn FORBIDDEN", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-ilk02b`));
      ruleIds.push(created.id);
      await caller(C).update({ id: created.id, description: "C sửa cuối" });
      await expectAppCode(caller(C).approve({ id: created.id }), "PERMISSION_DENIED");
    });

    it("người ĐỘC LẬP (≠ tạo, ≠ sửa cuối) duyệt ⇒ thành công", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-ilk02c`));
      ruleIds.push(created.id);
      const row = await caller(B).approve({ id: created.id });
      expect(row.approvedBy).toBe(B);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("ILK-03 — reason bắt buộc (≥3 ký tự) cho disable/delete/resolveEvent + ghi audit", () => {
    it("disable với reason quá ngắn ⇒ zod từ chối, enabled KHÔNG đổi", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-ilk03a`));
      ruleIds.push(created.id);
      await caller(B).approve({ id: created.id });
      await caller(A).enable({ id: created.id });
      await expect(caller(A).disable({ id: created.id, reason: "ab" } as any)).rejects.toThrow();
      const row = await caller(A).get({ id: created.id });
      expect(row.enabled).toBe(true);
    });

    it("★★★ disable với reason hợp lệ ⇒ tắt + ghi audit reason ĐÚNG CHỮ (không còn console.info)", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-ilk03b`));
      ruleIds.push(created.id);
      await caller(B).approve({ id: created.id });
      await caller(A).enable({ id: created.id });
      const row = await caller(A).disable({ id: created.id, reason: "Bảo trì định kỳ theo lịch" });
      expect(row.enabled).toBe(false);
      const audit = await auditRowsFor("interlock_rule", created.id, "disable");
      expect(audit).toHaveLength(1);
      expect((audit[0] as any).reason).toBe("Bảo trì định kỳ theo lịch");
    });

    it("delete THIẾU reason ⇒ zod từ chối, rule KHÔNG bị xoá", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-ilk03c`));
      ruleIds.push(created.id);
      await expect(caller(A).delete({ id: created.id } as any)).rejects.toThrow();
      const rows = await sql`SELECT id FROM interlock_rules WHERE id = ${created.id}`;
      expect(rows).toHaveLength(1);
    });

    it("★★★ delete với reason hợp lệ ⇒ audit ghi TRƯỚC (before không null) rồi xoá thật", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-ilk03d`));
      ruleIds.push(created.id);
      await caller(A).delete({ id: created.id, reason: "Rule cấu hình sai, tạo lại" });
      const rows = await sql`SELECT id FROM interlock_rules WHERE id = ${created.id}`;
      expect(rows).toHaveLength(0);
      const audit = await auditRowsFor("interlock_rule", created.id, "delete");
      expect(audit).toHaveLength(1);
      expect((audit[0] as any).reason).toBe("Rule cấu hình sai, tạo lại");
      expect((audit[0] as any).beforeJson).not.toBeNull();
    });

    it("resolveEvent THIẾU reason ⇒ zod từ chối; với reason hợp lệ ⇒ resolved + notes + audit (trước vá: 0 audit)", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-ilk03e`));
      ruleIds.push(created.id);
      const ev = await sql`INSERT INTO interlock_events ("ruleId") VALUES (${created.id}) RETURNING id`;
      const eventId = (ev[0] as any).id as number;
      eventIds.push(eventId);

      await expect(caller(A).resolveEvent({ id: eventId } as any)).rejects.toThrow();

      const resolved = await caller(A).resolveEvent({ id: eventId, reason: "Đã kiểm tra, false positive" });
      expect(resolved.status).toBe("resolved");
      expect(resolved.notes).toBe("Đã kiểm tra, false positive");

      const audit = await auditRowsFor("interlock_event", eventId, "resolve");
      expect(audit).toHaveLength(1);
      expect((audit[0] as any).reason).toBe("Đã kiểm tra, false positive");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("ILK-05 — hành động khác 'alert' bắt buộc có đích; commandValue lưu thật", () => {
    it("★★★ create action=stop_line KHÔNG đích ⇒ BAD_REQUEST/FIELD_REQUIRED, KHÔNG ghi hàng", async () => {
      const name = `${DAU}-ilk05a`;
      await expectAppCode(caller(A).create(baseInput(name, { action: "stop_line" })), "FIELD_REQUIRED");
      const rows = await sql`SELECT id FROM interlock_rules WHERE name = ${name}`;
      expect(rows).toHaveLength(0);
    });

    it("create action=stop_line CÓ targetMachineId ⇒ thành công; commandValue lưu THẬT (trước vá: luôn null)", async () => {
      const created = await caller(A).create(
        baseInput(`${DAU}-ilk05b`, { action: "stop_line", targetMachineId: 990_300_001, commandValue: 42 }),
      );
      ruleIds.push(created.id);
      expect(created.targetMachineId).toBe(990_300_001);
      const rows = await sql`SELECT "commandValue" FROM interlock_rules WHERE id = ${created.id}`;
      expect((rows[0] as any).commandValue).toBe(42);
    });

    it("★★★ update đổi action → stop_line nhưng KHÔNG kèm đích ⇒ BAD_REQUEST, rule giữ nguyên action cũ", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-ilk05c`)); // action alert, không đích
      ruleIds.push(created.id);
      await expectAppCode(caller(A).update({ id: created.id, action: "stop_line" }), "FIELD_REQUIRED");
      const row = await caller(A).get({ id: created.id });
      expect(row.action).toBe("alert");
    });

    it("update gỡ đích DUY NHẤT của một rule action khác 'alert' ⇒ BAD_REQUEST, đích giữ nguyên", async () => {
      const created = await caller(A).create(
        baseInput(`${DAU}-ilk05d`, { action: "reduce_speed", targetMachineId: 990_300_002 }),
      );
      ruleIds.push(created.id);
      await expect(caller(A).update({ id: created.id, targetMachineId: null })).rejects.toThrow();
      const row = await caller(A).get({ id: created.id });
      expect(row.targetMachineId).toBe(990_300_002);
    });

    it("update GIỮ action khác 'alert' và chỉ đổi commandTag (đích khác vẫn còn) ⇒ thành công", async () => {
      const created = await caller(A).create(
        baseInput(`${DAU}-ilk05e`, { action: "reduce_speed", targetMachineId: 990_300_003 }),
      );
      ruleIds.push(created.id);
      const updated = await caller(A).update({ id: created.id, commandTag: "tag_moi" });
      expect(updated.commandTag).toBe("tag_moi");
      expect(updated.targetMachineId).toBe(990_300_003);
    });
  });
});
