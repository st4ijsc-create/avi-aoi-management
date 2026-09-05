/**
 * CỔNG CSDL THẬT — BG-93 (Lô 10 Mục 1): `audit_logs` là hypertable + retention
 * policy 365 ngày, và WORM (avi_app không xoá được) vẫn giữ nguyên SAU khi
 * migration 0349 rewrite PK (id, "createdAt") + create_hypertable + add_retention_policy.
 *
 * Khuôn tái dùng nguyên văn `tenantRlsCuongChe.db.test.ts`: `describe.skipIf(!DB_URL)`,
 * cầu chì vai-đo-không-superuser TRƯỚC mọi assertion khác (không có cầu chì, mọi
 * ca dưới xanh giả vì `aoi`/superuser bỏ qua mọi kiểm quyền).
 *
 * ── ĐỘT BIẾN mà lưới này bắt được (đã đo tay Lô 10, xem báo cáo) ──────────────
 *   (a) ai đó `remove_retention_policy('audit_logs')`     ⇒ ca "policy 365d" ĐỎ
 *   (b) GRANT DELETE cho avi_app trên audit_logs (mở WORM) ⇒ ca "WORM âm tính" ĐỎ
 *      (assertion đảo: DELETE phải NÉM lỗi 42501 — nếu nó THÀNH CÔNG, `.rejects`
 *       thất bại, không phải im lặng bỏ qua)
 *   (c) revert PK về (id) đơn cột (hoàn nguyên 0349)       ⇒ ca "PK ghép" ĐỎ
 *   (d) audit_logs bị hoàn nguyên về bảng thường (drop hypertable) ⇒ ca (a) ĐỎ
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const RETENTION_DAYS = 365;

let sql: ReturnType<typeof postgres>;
let probeId: number | undefined;

describe.skipIf(!DB_URL)("BG-93 (0349) — audit_logs hypertable + retention 365d + WORM", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    // ⚠ KHÔNG xoá hàng probe: audit_logs là WORM với vai avi_app (đúng chủ đích,
    //   cùng lý do `cheDo2faTheoTrienKhai.test.ts` không dọn hàng nó đẻ ra). Hàng
    //   probe (action='DBTEST-0349-PROBE') là bằng chứng sống của việc DELETE bị
    //   chặn — xoá nó đi sẽ cần đúng quyền mà ca kiểm này chứng minh KHÔNG tồn tại.
    await sql?.end();
  });

  it("CẦU CHÌ — vai đo phải là avi_app (không superuser, không BYPASSRLS)", async () => {
    const [r] = await sql<{ u: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(
      r.rolsuper,
      `vai "${r.u}" là superuser ⇒ MỌI ca dưới đây xanh giả. Trỏ DATABASE_URL vào avi_app, không phải owner (aoi).`,
    ).toBe(false);
    expect(r.rolbypassrls, `vai "${r.u}" có BYPASSRLS ⇒ lưới vô nghĩa`).toBe(false);
  });

  it("audit_logs là hypertable với PK ghép (id, \"createdAt\") — tiền lệ 0172", async () => {
    const hyper = await sql`
      SELECT hypertable_name FROM timescaledb_information.hypertables
       WHERE hypertable_name = 'audit_logs'`;
    expect(hyper.length, "audit_logs KHÔNG xuất hiện trong timescaledb_information.hypertables").toBe(1);

    const [pk] = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'audit_logs' AND con.contype = 'p'`;
    expect(pk?.def).toMatch(/PRIMARY KEY \(id, "?createdAt"?\)/);
  });

  it("retention policy đúng 365 ngày (timescaledb_information.jobs) — đột biến gỡ policy phải ĐỎ ở đây", async () => {
    const jobs = await sql<{ job_id: number; config: { drop_after?: string } }[]>`
      SELECT job_id, config FROM timescaledb_information.jobs
       WHERE hypertable_name = 'audit_logs' AND proc_name = 'policy_retention'`;
    expect(jobs.length, "số job retention cho audit_logs").toBe(1);
    expect(jobs[0]?.config?.drop_after).toBe(`${RETENTION_DAYS} days`);
  });

  it("WORM âm tính (ca thật, vai avi_app) — INSERT OK, DELETE 42501", async () => {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO audit_logs ("action", "status", "details")
      VALUES ('DBTEST-0349-PROBE', 'success', 'auditLogsRetention.db.test.ts — WORM negative gate')
      RETURNING id`;
    expect(row?.id, "INSERT vào audit_logs (vai avi_app) phải thành công").toBeGreaterThan(0);
    probeId = row.id;

    await expect(
      sql`DELETE FROM audit_logs WHERE id = ${row.id}`,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("grants avi_app trên audit_logs vẫn CHỈ INSERT+SELECT (migration 0349 không đụng grants)", async () => {
    const rows = await sql<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_name = 'audit_logs' AND grantee = 'avi_app'
       ORDER BY privilege_type`;
    const privs = rows.map((r) => r.privilege_type).sort();
    expect(privs).toEqual(["INSERT", "SELECT"]);
    expect(privs).not.toContain("DELETE");
    expect(privs).not.toContain("UPDATE");
  });

  it("hàng probe DBTEST-0349-PROBE vẫn còn (không role nào xoá được nó, kể cả ca kiểm này)", async () => {
    if (probeId === undefined) return; // ca INSERT ở trên fail thì bỏ qua, không nhân đôi lỗi
    const [row] = await sql`SELECT id FROM audit_logs WHERE id = ${probeId}`;
    expect(row?.id, "hàng probe biến mất khỏi audit_logs — WORM đã bị phá").toBe(probeId);
  });
});
