/**
 * MCP cục bộ — truy vấn chỉ đọc trên `_test`. Dùng URL của lưới (vai trò ứng dụng): kiểm hàng rào PHÍA MÁY CHỦ không phụ thuộc vai trò —
 * giao dịch READ ONLY chặn ghi, giao thức mở rộng chặn nhiều câu, cursor chặn số hàng. Vai trò `mcp_chi_doc` (chỉ SELECT, ẩn cột nhạy cảm)
 * được nghiệm thu riêng bởi `scripts/mcp-cuc-bo-vai-tro.mjs --test-only`.
 */
import { afterAll, describe, expect, it } from "vitest";
import { boChuThich, chayChiDoc, kiemSqlChiDoc, lietKeBang, taoKetNoiDb, truyVan, TRAN_HANG } from "./dbChiDoc";

const db = taoKetNoiDb(process.env.DATABASE_URL!);
afterAll(() => db.dong());

describe("kiểm văn bản (báo sớm)", () => {
  it("nhận SELECT / WITH / EXPLAIN; từ chối ghi, nhiều câu, EXPLAIN ANALYZE", () => {
    expect(kiemSqlChiDoc("select 1;")).toBe("select 1");
    expect(() => kiemSqlChiDoc("WITH a AS (SELECT 1) SELECT * FROM a")).not.toThrow();
    expect(() => kiemSqlChiDoc("SELECT ';' AS x")).not.toThrow();
    expect(() => kiemSqlChiDoc("delete from users")).toThrow(/chỉ nhận/);
    expect(() => kiemSqlChiDoc("select 1; drop table x")).toThrow(/một câu/);
    expect(() => kiemSqlChiDoc("/* x */ select 1; -- y\n commit")).toThrow(/một câu/);
    expect(() => kiemSqlChiDoc("explain analyze select 1")).toThrow(/ANALYZE/);
    expect(boChuThich("select 1 -- a; b\n")).toBe("select 1 \n");
  });
});

describe("hàng rào phía máy chủ", () => {
  it("SELECT chạy; số hàng bị cắt ở TRAN_HANG", async () => {
    const r = await truyVan(db, "SELECT g AS n FROM generate_series(1, 2000) g");
    expect(r.cot).toEqual(["n"]);
    expect(r.soHang).toBe(TRAN_HANG);
    expect(r.biCat).toBe(true);
  });
  it("hàm có tác dụng phụ trong SELECT bị giao dịch READ ONLY chặn (25006)", async () => {
    await expect(truyVan(db, "SELECT nextval('users_id_seq')")).rejects.toMatchObject({ ma: "LOI_CSDL" });
  });
  it("lách bộ lọc bằng chuỗi có ';' vẫn chỉ là MỘT câu ở máy chủ", async () => {
    const r = await truyVan(db, "SELECT 'a; DROP TABLE users' AS x");
    expect(r.hang).toEqual([["a; DROP TABLE users"]]);
  });
  it("BỎ QUA bộ lọc văn bản: máy chủ vẫn từ chối hai câu trong một lần gọi (giao thức mở rộng)", async () => {
    await expect(chayChiDoc(db, "SELECT 1; SELECT 2")).rejects.toMatchObject({ message: expect.stringMatching(/multiple commands/i) });
    await expect(chayChiDoc(db, "COMMIT; SELECT 1")).rejects.toMatchObject({ ma: "LOI_CSDL" });
  });
  it("lietKeBang trả bảng theo quyền thật", async () => {
    const ds = await lietKeBang(db, "machines");
    expect(ds.some((b) => b.bang === "machines")).toBe(true);
  });
});
