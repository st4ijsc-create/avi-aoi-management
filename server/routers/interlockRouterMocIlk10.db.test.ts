/**
 * ILK-10 (doc 80 Phụ lục D §7.4 "Vá ngay") — mọi thay đổi cấu hình rule interlock
 * và dòng audit tương ứng phải chung MỘT transaction.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * CÁCH ĐO ATOMICITY QUA API CÔNG KHAI (không chỉ đo "có gọi db.transaction()")
 * ══════════════════════════════════════════════════════════════════════════════
 * `recordAuditEvent` bị MOCK để LUÔN ném lỗi. Nếu `update`/`disable` KHÔNG bọc
 * transaction (hành vi TRƯỚC vá): `db.update(interlockRules)...` chạy trên kết
 * nối autocommit và COMMIT NGAY LẬP TỨC trước khi `recordAuditEvent` ném — dòng
 * rule vẫn đổi trong CSDL dù lệnh "thất bại" ở phía caller (mất đồng bộ giữa
 * cấu hình và audit — đúng khuyết tật ILK-10 nêu). Nếu CÓ transaction (đã vá):
 * `tx.update(...)` chưa hề COMMIT khi `recordAuditEvent(tx, …)` ném bên trong
 * CÙNG transaction ⇒ toàn bộ ROLLBACK ⇒ dòng KHÔNG đổi.
 *
 * Vì recordAuditEvent bị mock ném lỗi VÔ ĐIỀU KIỆN, fixture PHẢI dựng rule qua
 * SQL thô (không qua `interlockRouter.create`, vốn cũng gọi recordAuditEvent).
 * ══════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.mock("../services/audit/controlAuditService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/audit/controlAuditService")>();
  return {
    ...actual,
    recordAuditEvent: vi.fn(async () => {
      throw new Error("ILK10-forced-audit-failure");
    }),
  };
});

import { interlockRouter } from "./interlockRouter";

const DB_URL = process.env.DATABASE_URL;
const DAU = `ILK10-${Date.now()}`;
const A = 990_400_001;
const ORIGINAL_NAME = `${DAU}-rule`;

function caller(userId: number) {
  return interlockRouter.createCaller({
    user: { id: userId, role: "admin", name: `probe-${userId}`, twoFactorEnabled: true },
  } as any);
}

let sql: ReturnType<typeof postgres>;
let ruleId: number;

describe.skipIf(!DB_URL)("ILK-10 — rule + audit chung transaction (audit lỗi ⇒ rule KHÔNG đổi)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const r = await sql`
      INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, enabled, "approvedBy")
      VALUES (${ORIGINAL_NAME}, 'machine', 'ng_rate', 'gt', 5, 'alert', false, NULL)
      RETURNING id`;
    ruleId = (r[0] as unknown as { id: number }).id;
  }, 60_000);

  afterAll(async () => {
    // `control_audit_log` không được dọn (WORM — role `avi_app` bị từ chối
    // DELETE bằng thiết kế); ở đây thực tế KHÔNG có dòng nào được ghi vào đó cho
    // ruleId này (recordAuditEvent bị mock ném lỗi TRƯỚC khi insert bao giờ
    // chạy), nên không có gì phải dọn.
    await sql`DELETE FROM interlock_rules WHERE id = ${ruleId}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★ dữ kiện nền — rule dựng qua SQL thô, chưa hề đổi tên", async () => {
    const rows = await sql`SELECT name, enabled FROM interlock_rules WHERE id = ${ruleId}`;
    expect((rows[0] as any).name).toBe(ORIGINAL_NAME);
    expect((rows[0] as any).enabled).toBe(false);
  });

  it("★★★ update() ném lỗi (audit mock) VÀ tên rule KHÔNG đổi trong CSDL — transaction đã rollback", async () => {
    await expect(
      caller(A).update({ id: ruleId, name: `${DAU}-rule-DA-DOI-NHUNG-KHONG-DUOC-LUU` }),
    ).rejects.toThrow("ILK10-forced-audit-failure");

    const rows = await sql`SELECT name FROM interlock_rules WHERE id = ${ruleId}`;
    expect((rows[0] as any).name).toBe(ORIGINAL_NAME);
  });

  it("★★★ disable() ném lỗi (audit mock) VÀ enabled KHÔNG đổi trong CSDL — transaction đã rollback", async () => {
    // Bật cờ `enabled` bằng SQL thô (router.enable() cũng gọi recordAuditEvent, sẽ bị mock chặn).
    await sql`UPDATE interlock_rules SET enabled = true WHERE id = ${ruleId}`;

    await expect(caller(A).disable({ id: ruleId, reason: "kiem tra rollback ILK-10" })).rejects.toThrow(
      "ILK10-forced-audit-failure",
    );

    const rows = await sql`SELECT enabled FROM interlock_rules WHERE id = ${ruleId}`;
    expect((rows[0] as any).enabled).toBe(true); // vẫn TRUE — disable() đã rollback, không đổi thành false
  });
});
