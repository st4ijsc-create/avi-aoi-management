/**
 * doc 80 Đợt 0 — final whole-branch review, fix wave (interlock):
 *
 *   #2 — update/delete/approve/enable/disable đọc rule trong transaction KHÔNG khoá hàng ⇒ approve
 *        và edit đan xen được: rule ĐÃ DUYỆT mang nội dung CHƯA ai duyệt, và người vừa sửa tự
 *        duyệt lọt SoD (đọc ảnh chụp cũ). Vá: `SELECT … FOR UPDATE` trong mọi transaction ấy.
 *   #5 — tự duyệt lách qua việc `updatedBy` bị ghi đè: A tạo, B sửa logic, A sửa mô tả (updatedBy
 *        = A), B duyệt ⇒ lọt. Vá (không migration): approve từ chối người có tên là actor trong các
 *        dòng control_audit_log create/update của rule KỂ TỪ lần duyệt gần nhất.
 *   #7 — kiểm đích (ILK-05) cả ở approve/enable: hàng do AI tool / seed ghi thẳng bảng bỏ qua
 *        create/update.
 *
 * CSDL THẬT (`_test`) — tranh chấp chỉ tái hiện được với khoá hàng Postgres thật. Để đan xen
 * TẤT ĐỊNH (không phụ thuộc may rủi lịch luồng), `recordAuditEvent` được bọc: khi "giữ" một
 * action, lượt gọi dừng NGAY TRƯỚC khi ghi dòng audit — tức SAU lệnh UPDATE của nó, transaction
 * còn mở (khoá hàng của UPDATE còn giữ) — cho tới khi test "thả".
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

const hold = vi.hoisted(() => ({
  action: null as string | null,
  reached: null as null | (() => void),
  release: null as null | Promise<void>,
}));

vi.mock("../services/audit/controlAuditService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/audit/controlAuditService")>();
  return {
    ...actual,
    recordAuditEvent: vi.fn(async (db: unknown, e: { action: string }) => {
      if (hold.action && e.action === hold.action) {
        hold.action = null; // chỉ giữ MỘT lượt
        hold.reached?.();
        await hold.release;
      }
      return actual.recordAuditEvent(db as never, e as never);
    }),
  };
});

import { interlockRouter } from "./interlockRouter";

const DB_URL = process.env.DATABASE_URL;
const DAU = `ILKFIN-${Date.now()}`;
const A = 990_500_001;
const B = 990_500_002;
const C = 990_500_003;
const D = 990_500_004;

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

/** Giữ lượt recordAuditEvent kế tiếp có `action`; trả hàm chờ-tới và hàm thả. */
function armHold(action: string) {
  let release!: () => void;
  hold.release = new Promise<void>((r) => (release = r));
  const reached = new Promise<void>((r) => (hold.reached = r));
  hold.action = action;
  return { reached, release: () => release() };
}

function appCodeOf(e: unknown): string | undefined {
  const err = e as { cause?: { appCode?: string }; appCode?: string } | null;
  return err?.cause?.appCode ?? err?.appCode;
}

let sql: ReturnType<typeof postgres>;
const ruleIds: number[] = [];

async function ruleRow(id: number) {
  const r = await sql`SELECT name, description, threshold, "approvedBy", "updatedBy", enabled FROM interlock_rules WHERE id = ${id}`;
  return r[0] as any;
}

describe.skipIf(!DB_URL)("interlock — final review fix wave (#2 khoá hàng, #5 SoD theo sổ audit, #7 đích ở approve/enable)", () => {
  beforeAll(() => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
  }, 60_000);

  afterAll(async () => {
    hold.action = null;
    // control_audit_log là WORM (avi_app không có DELETE) — các dòng mang tiền tố DAU ở lại vô hại.
    if (ruleIds.length) await sql`DELETE FROM interlock_rules WHERE id = ANY(${ruleIds})`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════
  describe("#2 — approve ∥ update không để rule ĐÃ DUYỆT mang nội dung CHƯA duyệt", () => {
    it("★★★ approve giữ hàng, update chen vào ⇒ cuối cùng (duyệt + cũ) hoặc (chưa duyệt + mới), KHÔNG BAO GIỜ duyệt + mới", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-race1`));
      ruleIds.push(created.id);
      const newName = `${DAU}-race1-SUA`;

      const h = armHold("approve");
      const pApprove = caller(B).approve({ id: created.id });
      await h.reached; // approve đã UPDATE (approvedBy=B), transaction còn mở
      const pUpdate = caller(A).update({ id: created.id, name: newName });
      await new Promise((r) => setTimeout(r, 400)); // cho update chạy tới chỗ nó bị chặn
      h.release();
      const [ra, ru] = await Promise.allSettled([pApprove, pUpdate]);
      expect(ra.status).toBe("fulfilled");
      expect(ru.status).toBe("fulfilled");

      const row = await ruleRow(created.id);
      const approvedAndNew = row.approvedBy != null && row.name === newName;
      expect(approvedAndNew, `rule duyệt bởi ${row.approvedBy} nhưng mang nội dung mới "${row.name}"`).toBe(false);
      // Thứ tự tuần tự hoá thật ở đây là approve → update ⇒ update thấy rule ĐÃ duyệt ⇒ reset.
      expect(row.name).toBe(newName);
      expect(row.approvedBy).toBeNull();
    }, 60_000);

    it("★★★ cùng MỘT người: update (giữ hàng) ∥ approve ⇒ approve thấy updatedBy mới ⇒ FORBIDDEN, không tự duyệt lọt", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-race2`));
      ruleIds.push(created.id);

      const h = armHold("update");
      const pUpdate = caller(B).update({ id: created.id, threshold: 9 });
      await h.reached; // update đã UPDATE (updatedBy=B), transaction còn mở, audit chưa ghi
      const pApprove = caller(B).approve({ id: created.id });
      await new Promise((r) => setTimeout(r, 400));
      h.release();
      const [ru, ra] = await Promise.allSettled([pUpdate, pApprove]);
      expect(ru.status).toBe("fulfilled");
      expect(ra.status).toBe("rejected");
      expect(appCodeOf((ra as PromiseRejectedResult).reason)).toBe("PERMISSION_DENIED");

      const row = await ruleRow(created.id);
      expect(row.approvedBy).toBeNull();
      expect(row.updatedBy).toBe(B);
    }, 60_000);

    it("update (giữ hàng) ∥ approve của người KHÁC ⇒ nếu rule kết thúc ĐÃ duyệt thì dòng audit 'approve' ghi ĐÚNG nội dung đang lưu", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-race3`));
      ruleIds.push(created.id);
      const newName = `${DAU}-race3-SUA`;

      const h = armHold("update");
      const pUpdate = caller(B).update({ id: created.id, name: newName });
      await h.reached;
      const pApprove = caller(C).approve({ id: created.id });
      await new Promise((r) => setTimeout(r, 400));
      h.release();
      await Promise.allSettled([pUpdate, pApprove]);

      const row = await ruleRow(created.id);
      if (row.approvedBy != null) {
        const audit = await sql`
          SELECT "beforeJson" FROM control_audit_log
           WHERE "entityType" = 'interlock_rule' AND "entityId" = ${String(created.id)} AND action = 'approve'
           ORDER BY id DESC LIMIT 1`;
        // Sổ audit nói người duyệt đã duyệt nội dung NÀO — phải đúng nội dung đang lưu.
        expect((audit[0] as any).beforeJson.name).toBe(row.name);
      }
    }, 60_000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("#5 — SoD theo sổ audit: ai từng tạo/sửa rule kể từ lần duyệt gần nhất KHÔNG được duyệt", () => {
    it("★★★ A tạo, B sửa logic, A sửa mô tả (updatedBy=A), B duyệt ⇒ FORBIDDEN", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-sod1`));
      ruleIds.push(created.id);
      await caller(B).update({ id: created.id, threshold: 42 });
      await caller(A).update({ id: created.id, description: "chỉ đổi mô tả" });
      expect((await ruleRow(created.id)).updatedBy).toBe(A);

      const err = await caller(B).approve({ id: created.id }).catch((e) => e);
      expect(appCodeOf(err)).toBe("PERMISSION_DENIED");
      expect((await ruleRow(created.id)).approvedBy).toBeNull();
    });

    it("người ĐỘC LẬP (không tạo, không sửa) vẫn duyệt được", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-sod2`));
      ruleIds.push(created.id);
      await caller(B).update({ id: created.id, threshold: 42 });
      await caller(A).update({ id: created.id, description: "mô tả" });
      const row = await caller(C).approve({ id: created.id });
      expect(row.approvedBy).toBe(C);
    });

    it("cửa sổ tính TỪ lần duyệt gần nhất: sửa TRƯỚC lần duyệt cũ không chặn lần duyệt sau", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-sod3`));
      ruleIds.push(created.id);
      await caller(B).update({ id: created.id, threshold: 7 }); // B sửa — TRƯỚC lần duyệt 1
      await caller(C).approve({ id: created.id }); // lần duyệt 1 (C độc lập)
      await caller(D).update({ id: created.id, threshold: 8 }); // D sửa ⇒ reset duyệt
      const row = await caller(B).approve({ id: created.id }); // B không sửa gì kể từ lần duyệt 1
      expect(row.approvedBy).toBe(B);
      // còn D (vừa sửa sau lần duyệt 1) thì bị chặn ở vòng kế:
      await caller(A).update({ id: created.id, description: "x" }); // reset
      await caller(D).update({ id: created.id, threshold: 9 });
      await caller(A).update({ id: created.id, description: "y" }); // updatedBy=A, che D
      const err = await caller(D).approve({ id: created.id }).catch((e) => e);
      expect(appCodeOf(err)).toBe("PERMISSION_DENIED");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("#7 — ILK-05 cũng kiểm ở approve/enable (hàng ghi thẳng bảng bỏ qua create/update)", () => {
    it("★★★ rule stop_line KHÔNG đích (seed/AI ghi thẳng) ⇒ approve BAD_REQUEST/FIELD_REQUIRED, không duyệt", async () => {
      const r = await sql`
        INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, enabled, "approvedBy", "createdBy")
        VALUES (${`${DAU}-seed-noTarget`}, 'machine', 'ng_rate', 'gt', 5, 'stop_line', false, NULL, ${A})
        RETURNING id`;
      const id = (r[0] as unknown as { id: number }).id;
      ruleIds.push(id);
      const err = await caller(B).approve({ id }).catch((e) => e);
      expect(appCodeOf(err)).toBe("FIELD_REQUIRED");
      expect((await ruleRow(id)).approvedBy).toBeNull();
    });

    it("★★★ rule stop_line KHÔNG đích nhưng ĐÃ có approvedBy (seed) ⇒ enable BAD_REQUEST, không bật", async () => {
      const r = await sql`
        INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, enabled, "approvedBy", "approvedAt", "createdBy")
        VALUES (${`${DAU}-seed-approved-noTarget`}, 'machine', 'ng_rate', 'gt', 5, 'reduce_speed', false, ${C}, now(), ${A})
        RETURNING id`;
      const id = (r[0] as unknown as { id: number }).id;
      ruleIds.push(id);
      const err = await caller(A).enable({ id }).catch((e) => e);
      expect(appCodeOf(err)).toBe("FIELD_REQUIRED");
      expect((await ruleRow(id)).enabled).toBe(false);
    });

    it("rule stop_line CÓ đích ⇒ approve + enable vẫn đi như cũ", async () => {
      const created = await caller(A).create(baseInput(`${DAU}-target-ok`, { action: "stop_line", targetMachineId: 1 }));
      ruleIds.push(created.id);
      await caller(B).approve({ id: created.id });
      const row = await caller(A).enable({ id: created.id });
      expect(row.enabled).toBe(true);
    });
  });
});
