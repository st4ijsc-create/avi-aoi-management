/**
 * doc 80 Đợt 0 — Task 8 (RBAC-02, ECN-03, ECN-05) — ecnRouter trên CSDL THẬT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Phụ lục D §1/§4 (ECN-02..05), Phụ lục F hàng RBAC-02: trước bản vá,
 * `ecn.create/list/getById/getItems` ngồi trên `moduleProcedure("MOD_ENGINEERING")`
 * MỘT MÌNH — cờ license đang TẮT nên đó là pass-through, tức **BẤT KỲ tài khoản đã
 * đăng nhập nào** đọc/tạo được ECN. `transition` đọc-rồi-UPDATE KHÔNG kiểm trạng thái
 * cũ (`ecnService.ts:269-273` trước bản vá) ⇒ hai lượt duyệt đồng thời đều "thắng"
 * trong im lặng. SoD chỉ chặn ở bước approve, không chặn ở review, và không chặn
 * người xem xét tự duyệt.
 *
 * Ba lỗ này chỉ tái hiện được TRÊN POSTGRES THẬT (một UPDATE tại một thời điểm trên
 * MỘT hàng — không có khoá hàng thật trong mock DB), nên bộ test này dùng
 * `ecnRouter.createCaller(ctx)` + kết nối `postgres` trực tiếp, cùng khuôn với
 * `fleetRouter.dot0.db.test.ts` (Task 6).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

const DB_URL = process.env.DATABASE_URL;
const RUN = `t8_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

// userId tổng hợp — không có FK users→permissions/engineering_changes (cùng tiền lệ
// fleetRouter.dot0.db.test.ts / commandCenterKpiScope.db.test.ts), nên gieo được mà
// không chạm bảng `users`.
const U_ADMIN = 951301;
const U_ENG_NOPERM = 951302; // engineer, KHÔNG có dòng permission nào cho machine_control
const U_ENG_VIEW = 951303; // engineer, machine_control canView=true canCreate=false
const U_ENG_FULL = 951304; // engineer, machine_control canView=true canCreate=true — requester mặc định
const U_SUP_A = 951305; // supervisor — người duyệt A (đua với B)
const U_SUP_B = 951306; // supervisor — người duyệt B
const U_SUP_C = 951307; // supervisor — dùng làm reviewer trong ca ECN-05
const ALL_USERS = [U_ADMIN, U_ENG_NOPERM, U_ENG_VIEW, U_ENG_FULL, U_SUP_A, U_SUP_B, U_SUP_C];

const ctxFor = (id: number, role: string) =>
  ({ user: { id, role, name: `u${id}`, twoFactorEnabled: true } }) as any;

let sql: ReturnType<typeof postgres>;

async function mkEcn(opts: {
  requestedBy?: number;
  status?: string;
  reviewedBy?: number | null;
} = {}): Promise<number> {
  const key = `${RUN}_${Math.random().toString(36).slice(2, 10)}`;
  const r = await sql`
    INSERT INTO engineering_changes ("ecnKey", title, "changeType", status, "requestedBy", "reviewedBy")
    VALUES (
      ${key}, ${"t8 ecn " + key}, 'process',
      ${opts.status ?? "draft"}, ${opts.requestedBy ?? U_ENG_FULL}, ${opts.reviewedBy ?? null}
    )
    RETURNING id`;
  return Number((r[0] as { id: number }).id);
}

describe.skipIf(!DB_URL)("ecnRouter Đợt 0 Task 8 — RBAC-02 · ECN-03 (CAS) · ECN-05 (SoD mở rộng) (CSDL THẬT)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate")
              VALUES (${U_ENG_VIEW}, 'machine_control', 'machine_control', true, false)`;
    await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate")
              VALUES (${U_ENG_FULL}, 'machine_control', 'machine_control', true, true)`;
    // U_ENG_NOPERM và các supervisor KHÔNG có dòng permission nào — `transition` sàn
    // theo VAI (roleProcedure), không theo bit quyền, nên không cần cho ca ECN-03/05.
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM engineering_changes WHERE "ecnKey" LIKE ${RUN + "%"}`;
    await sql`DELETE FROM permissions WHERE "userId" IN ${sql(ALL_USERS)}`;
    await sql.end({ timeout: 5 });
  });

  const caller = async (userId: number, role: string) =>
    (await import("./ecnRouter")).ecnRouter.createCaller(ctxFor(userId, role));

  // ════════════════════════════════════════════════════════════════════════
  // RBAC-02 — create/list/getById/getItems đòi bit quyền machine_control
  // ════════════════════════════════════════════════════════════════════════
  describe("RBAC-02 — create/list/getById/getItems đòi machine_control (trước bản vá: mọi tài khoản đăng nhập đều qua)", () => {
    it("★★★ engineer KHÔNG có dòng permission nào ⇒ list/getById/getItems/create đều FORBIDDEN", async () => {
      const ecnId = await mkEcn();
      const c = await caller(U_ENG_NOPERM, "engineer");
      await expect(c.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.getById({ id: ecnId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.getItems({ ecnId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.create({ title: `${RUN} nope`, changeType: "process" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("engineer canView=true canCreate=false ⇒ đọc OK, create FORBIDDEN (canView ≠ canCreate)", async () => {
      const ecnId = await mkEcn();
      const c = await caller(U_ENG_VIEW, "engineer");
      await expect(c.list({})).resolves.toBeDefined();
      await expect(c.getById({ id: ecnId })).resolves.toBeDefined();
      await expect(c.getItems({ ecnId })).resolves.toBeDefined();
      await expect(c.create({ title: `${RUN} viewonly`, changeType: "process" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("engineer canView=true canCreate=true ⇒ tất cả bốn thủ tục OK", async () => {
      const ecnId = await mkEcn();
      const c = await caller(U_ENG_FULL, "engineer");
      await expect(c.list({})).resolves.toBeDefined();
      await expect(c.getById({ id: ecnId })).resolves.toBeDefined();
      await expect(c.getItems({ ecnId })).resolves.toBeDefined();
      const created = await c.create({ title: `${RUN} full`, changeType: "process" });
      expect(created.id).toBeGreaterThan(0);
      expect(created.status).toBe("draft");
    });

    it("admin bỏ qua bit quyền dù KHÔNG có dòng permission nào", async () => {
      const ecnId = await mkEcn();
      const c = await caller(U_ADMIN, "admin");
      await expect(c.list({})).resolves.toBeDefined();
      await expect(c.getById({ id: ecnId })).resolves.toBeDefined();
      await expect(c.getItems({ ecnId })).resolves.toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ECN-03 — transition nhận expectedStatus, UPDATE điều kiện WHERE id AND status
  // ════════════════════════════════════════════════════════════════════════
  describe("ECN-03 — CAS trên `status`: hai lượt đồng thời ⇒ đúng 1 thành công + 1 CONFLICT", () => {
    it("★★★ hai lượt approve() song song trên CÙNG ECN in_review, cùng expectedStatus ⇒ 1 ok + 1 CONFLICT, DB đổi ĐÚNG một lần", async () => {
      const ecnId = await mkEcn({ status: "in_review", requestedBy: U_ENG_FULL, reviewedBy: U_ENG_VIEW });
      const cA = await caller(U_SUP_A, "supervisor");
      const cB = await caller(U_SUP_B, "supervisor");
      const [r1, r2] = await Promise.allSettled([
        cA.transition({ id: ecnId, action: "approve", expectedStatus: "in_review" }),
        cB.transition({ id: ecnId, action: "approve", expectedStatus: "in_review" }),
      ]);
      const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
      const rejected = [r1, r2].filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({ code: "CONFLICT" });

      const rows = await sql`SELECT status, "approvedBy" FROM engineering_changes WHERE id = ${ecnId}`;
      expect(rows).toHaveLength(1);
      expect((rows[0] as any).status).toBe("approved");
      expect([U_SUP_A, U_SUP_B]).toContain((rows[0] as any).approvedBy);
    });

    it("expectedStatus LÀ predecessor hợp lệ nhưng trạng thái THẬT trên DB đã đi xa hơn (không phải đua — stale read) ⇒ CONFLICT, KHÔNG đổi thêm", async () => {
      // "approved -> implemented" là một chuyển hợp lệ theo BẢNG (nên đây KHÔNG rơi vào
      // nhánh BAD_STATE) — nhưng hàng THẬT trên DB đã ở "implemented" từ trước (ai đó
      // implement rồi mà client chưa refresh). CAS phải bắt được ca "hợp lệ trên giấy,
      // sai trên đời" này y hệt ca đua thật.
      const ecnId = await mkEcn({ status: "implemented", requestedBy: U_ENG_FULL, reviewedBy: U_ENG_VIEW });
      const c = await caller(U_SUP_A, "supervisor");
      await expect(c.transition({ id: ecnId, action: "implement", expectedStatus: "approved" }))
        .rejects.toMatchObject({ code: "CONFLICT" });
      const rows = await sql`SELECT status, "implementedBy" FROM engineering_changes WHERE id = ${ecnId}`;
      expect((rows[0] as any).status).toBe("implemented");
      expect((rows[0] as any).implementedBy).toBeNull(); // seed trực tiếp, chưa ai được stamp
    });

    it("expectedStatus khớp thật ⇒ transition đơn lẻ vẫn thành công như trước (không hồi quy đường vui)", async () => {
      const ecnId = await mkEcn({ status: "submitted", requestedBy: U_ENG_FULL });
      const c = await caller(U_SUP_A, "supervisor");
      const r = await c.transition({ id: ecnId, action: "review", expectedStatus: "submitted" });
      expect(r.status).toBe("in_review");
      expect(r.reviewedBy).toBe(U_SUP_A);
    });

    it("KHÔNG gửi expectedStatus (caller cũ/hệ thống) ⇒ vẫn hoạt động, dùng status vừa đọc làm from-state", async () => {
      const ecnId = await mkEcn({ status: "draft", requestedBy: U_ENG_FULL });
      const c = await caller(U_SUP_A, "supervisor");
      const r = await c.transition({ id: ecnId, action: "submit" });
      expect(r.status).toBe("submitted");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ECN-05 — SoD mở rộng: requester không review/approve chính mình; reviewer ≠ approver
  // ════════════════════════════════════════════════════════════════════════
  describe("ECN-05 — SoD mở rộng sang bước xem xét + người xem xét ≠ người duyệt", () => {
    it("★★★ người yêu cầu KHÔNG được review chính ECN của mình ⇒ FORBIDDEN, status/reviewedBy không đổi", async () => {
      const ecnId = await mkEcn({ status: "submitted", requestedBy: U_SUP_A });
      const c = await caller(U_SUP_A, "supervisor");
      await expect(c.transition({ id: ecnId, action: "review", expectedStatus: "submitted" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      const rows = await sql`SELECT status, "reviewedBy" FROM engineering_changes WHERE id = ${ecnId}`;
      expect((rows[0] as any).status).toBe("submitted");
      expect((rows[0] as any).reviewedBy).toBeNull();
    });

    it("★★★ người ĐÃ xem xét KHÔNG được đồng thời là người duyệt ⇒ FORBIDDEN, status không đổi", async () => {
      const ecnId = await mkEcn({ status: "in_review", requestedBy: U_ENG_FULL, reviewedBy: U_SUP_A });
      const c = await caller(U_SUP_A, "supervisor");
      await expect(c.transition({ id: ecnId, action: "approve", expectedStatus: "in_review" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      const rows = await sql`SELECT status, "approvedBy" FROM engineering_changes WHERE id = ${ecnId}`;
      expect((rows[0] as any).status).toBe("in_review");
      expect((rows[0] as any).approvedBy).toBeNull();
    });

    it("người yêu cầu vẫn KHÔNG được approve chính mình (hành vi CŨ — không hồi quy)", async () => {
      const ecnId = await mkEcn({ status: "in_review", requestedBy: U_SUP_B, reviewedBy: U_SUP_C });
      const c = await caller(U_SUP_B, "supervisor");
      await expect(c.transition({ id: ecnId, action: "approve", expectedStatus: "in_review" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("người xem xét KHÁC người yêu cầu VÀ người duyệt KHÁC người xem xét ⇒ review rồi approve đều OK", async () => {
      const ecnId = await mkEcn({ status: "submitted", requestedBy: U_ENG_FULL });
      const reviewer = await caller(U_SUP_C, "supervisor");
      const reviewed = await reviewer.transition({ id: ecnId, action: "review", expectedStatus: "submitted" });
      expect(reviewed.status).toBe("in_review");

      const approver = await caller(U_SUP_A, "supervisor");
      const approved = await approver.transition({ id: ecnId, action: "approve", expectedStatus: "in_review" });
      expect(approved.status).toBe("approved");
      expect(approved.approvedBy).toBe(U_SUP_A);
    });
  });
});
