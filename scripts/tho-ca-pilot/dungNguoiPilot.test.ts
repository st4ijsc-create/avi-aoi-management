import { describe, it, expect } from "vitest";
import { dungNguoiPilot, QUYEN_PILOT, type Sql } from "./dungNguoiPilot";

function sqlGia(tt: { db: string; nguoi: string }, userCo = false) {
  const cau: string[] = [];
  const sql: Sql = async (s) => {
    const q = s.join("?").replace(/\s+/g, " ").trim();
    cau.push(q);
    if (q.startsWith("SELECT current_database()")) return [tt];
    if (q.startsWith("SELECT id FROM users")) return userCo ? [{ id: 41 }] : [];
    if (q.startsWith("INSERT INTO users")) return [{ id: 41 }];
    return [];
  };
  return { sql, cau };
}

describe("dungNguoiPilot", () => {
  it("★ sai CSDL ⇒ từ chối, KHÔNG câu ghi nào", async () => {
    const { sql, cau } = sqlGia({ db: "aoi_management", nguoi: "avi_app" });
    expect(await dungNguoiPilot(sql, false)).toMatchObject({ ok: false });
    expect(cau).toHaveLength(1);
  });
  it("★ kết nối bằng owner aoi ⇒ từ chối, không ghi", async () => {
    const { sql, cau } = sqlGia({ db: "aoi_management_test", nguoi: "aoi" });
    expect(await dungNguoiPilot(sql, false)).toMatchObject({ ok: false, loi: expect.stringContaining("owner") });
    expect(cau).toHaveLength(1);
  });
  it("--chi-doc ⇒ không ghi; báo user đã có hay chưa", async () => {
    const a = sqlGia({ db: "aoi_management_test", nguoi: "avi_app" }, true);
    expect(await dungNguoiPilot(a.sql, true)).toEqual({ ok: true, id: 41, daCo: true, chiDoc: true, quyen: [] });
    expect(a.cau.some((c) => c.startsWith("INSERT"))).toBe(false);
    expect(await dungNguoiPilot(sqlGia({ db: "aoi_management_test", nguoi: "avi_app" }).sql, true)).toMatchObject({ id: 0, daCo: false });
  });
  it("★ dựng: upsert user engineer + đúng 2 hàng quyền, KHÔNG DELETE/TRUNCATE, không cấp admin/quyền khác", async () => {
    const { sql, cau } = sqlGia({ db: "aoi_management_test", nguoi: "avi_app" });
    const kq = await dungNguoiPilot(sql, false);
    expect(kq).toEqual({ ok: true, id: 41, daCo: false, chiDoc: false, quyen: ["ai_repo_read", "ai_repo_exec"] });
    const ghi = cau.filter((c) => c.startsWith("INSERT"));
    expect(ghi).toHaveLength(1 + QUYEN_PILOT.length);
    expect(ghi[0]).toContain("'engineer'");
    expect(ghi[0]).not.toContain("admin");
    expect(cau.join(" ")).not.toMatch(/bDELETEs+FROM|bTRUNCATEb|bDROPs/i);
  });
  it("quyền cấp: ai_repo_read(view+edit), ai_repo_exec(create) — không bit nào khác", () => {
    expect(QUYEN_PILOT).toEqual([
      { moduleName: "ai_repo_read", category: "settings", canView: true, canCreate: false, canEdit: true },
      { moduleName: "ai_repo_exec", category: "settings", canView: false, canCreate: true, canEdit: false },
    ]);
  });
});
