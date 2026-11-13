/**
 * HA-6b (phần 1) — đọc khoá `BẢNG ĐẾM:` (dạng đóng), phán quyết hậu quả, đếm fail-closed, và bộ đếm postgres (bản giả của thẻ mẫu: GIÁ TRỊ phải ở tham số bind,
 * định danh phải qua sql(…), định danh sai bị chặn TRƯỚC khi chạm CSDL).
 * ĐỘT BIẾN PHẢI BẮT: nhận mục có `;`/`--` · nhận OR/AND/hai điều kiện/subquery · bỏ mục GHI khỏi "không chấm" · chênh ≠ 0 mà vẫn ok · có cờ DB không đếm được mà vẫn ok ·
 * nội suy giá trị vào chuỗi SQL · bỏ kiểm information_schema · thông điệp lỗi chép vào lý do.
 */
import { describe, expect, it } from "vitest";
import { demTatCa, docBangDem, nhanMuc, tinhHauQua, type MayDem, type MucDem } from "./hauQua";
import { mayDemPostgres, type SqlDem } from "./mayDemPg";

const doc = (...d: string[]) => docBangDem(d.join("\n"));

describe("docBangDem — dạng đóng", () => {
  it("★★★ nhận: bảng trần, WHERE cột LIKE 'x', WHERE cột = 'x', GHI: (không phân biệt hoa/thường từ khoá, định danh hạ thường)", () => {
    const r = doc("factories WHERE code LIKE 'SS_FAC_%'", "machines", "GHI: product_inspections WHERE tag = 'ST4I:7'", "Stations where Code like 'A B'");
    expect(r).toEqual({
      ok: true,
      muc: [
        { bang: "factories", ghi: false, cot: "code", toanTu: "LIKE", giaTri: "SS_FAC_%" },
        { bang: "machines", ghi: false },
        { bang: "product_inspections", ghi: true, cot: "tag", toanTu: "=", giaTri: "ST4I:7" },
        { bang: "stations", ghi: false, cot: "code", toanTu: "LIKE", giaTri: "A B" },
      ],
    });
  });
  it("★★★ rỗng ⇒ ok không mục; dòng trống bị bỏ", () => {
    expect(docBangDem(undefined)).toEqual({ ok: true, muc: [] });
    expect(docBangDem("\n  \n")).toEqual({ ok: true, muc: [] });
  });
  it.each([
    ["dấu chấm phẩy", "factories; drop table x"],
    ["chú thích --", "factories WHERE code LIKE 'a--b'"],
    ["chú thích khối", "factories /* x */"],
    ["OR", "factories WHERE code LIKE 'a' OR 1=1"],
    ["AND (hai điều kiện)", "factories WHERE code LIKE 'a' AND name = 'b'"],
    ["subquery", "factories WHERE code = (select 1)"],
    ["subquery sau FROM", "(select * from users)"],
    ["bảng có dấu chấm (schema.bảng)", "public.factories"],
    ["bảng viết hoa + dấu nháy kép", '"Factories"'],
    ["giá trị có nháy trong nháy", "factories WHERE code = 'a''b'"],
    ["giá trị rỗng", "factories WHERE code = ''"],
    ["toán tử lạ", "factories WHERE code ILIKE 'a'"],
    ["toán tử so sánh", "factories WHERE id > '1'"],
    ["giá trị quá 100 ký tự", `factories WHERE code = '${"a".repeat(101)}'`],
    ["định danh quá 63 ký tự", `${"a".repeat(64)}`],
    ["giá trị có ký tự lạ ($)", "factories WHERE code = '$1'"],
    ["thiếu WHERE", "factories code = 'a'"],
  ])("★★★ thẻ LỖI: %s", (_ten, muc) => {
    const r = doc(muc);
    expect(r.ok).toBe(false);
  });
  it("★★ mục trùng và quá 16 mục ⇒ thẻ lỗi", () => {
    expect(doc("machines", "MACHINES").ok).toBe(false);
    const nhieu = Array.from({ length: 17 }, (_, i) => `bang_${i}`);
    expect(doc(...nhieu).ok).toBe(false);
    expect(doc(...nhieu.slice(0, 16)).ok).toBe(true);
  });
});

const m = (bang: string, ghi = false): MucDem => ({ bang, ghi });
const ok = (dem: Record<string, number>) => ({ ok: true as const, dem });

describe("tinhHauQua", () => {
  it("★★★ không đổi ⇒ ok; có bảng trước/sau/chênh trong JSON", () => {
    const r = tinhHauQua({ muc: [m("a"), m("b")], coDb: true, truoc: ok({ a: 3, b: 0 }), sau: ok({ a: 3, b: 0 }) });
    expect(r).toEqual({ ketCuc: "ok", db: "co", lyDo: null, bang: [{ muc: "a", ghi: false, truoc: 3, sau: 3, chenh: 0 }, { muc: "b", ghi: false, truoc: 0, sau: 0, chenh: 0 }] });
  });
  it("★★★ chênh ≠ 0 ở mục chấm (cả tăng lẫn GIẢM) ⇒ hau-qua-xau, lý do nêu bảng + trước→sau + dấu", () => {
    const tang = tinhHauQua({ muc: [m("a")], coDb: true, truoc: ok({ a: 3 }), sau: ok({ a: 5 }) });
    expect(tang).toMatchObject({ ketCuc: "hau-qua-xau", db: "co" });
    expect(tang.lyDo).toContain("a 3→5 (+2)");
    const giam = tinhHauQua({ muc: [m("a")], coDb: true, truoc: ok({ a: 3 }), sau: ok({ a: 2 }) });
    expect(giam.lyDo).toContain("a 3→2 (-1)");
  });
  it("★★★ mục GHI: chênh ≠ 0 vẫn ok (chỉ ghi), số vẫn nằm trong JSON; chỉ MỘT mục chấm đổi cũng đủ xấu", () => {
    const r = tinhHauQua({ muc: [m("a"), m("insp", true)], coDb: true, truoc: ok({ a: 1, insp: 10 }), sau: ok({ a: 1, insp: 14 }) });
    expect(r.ketCuc).toBe("ok");
    expect(r.bang[1]).toEqual({ muc: "insp", ghi: true, truoc: 10, sau: 14, chenh: 4 });
    expect(tinhHauQua({ muc: [m("a"), m("insp", true)], coDb: true, truoc: ok({ a: 1, insp: 10 }), sau: ok({ a: 2, insp: 10 }) }).ketCuc).toBe("hau-qua-xau");
  });
  it("★★★ FAIL-CLOSED: có cờ DB mà đếm trước/sau lỗi hoặc chưa đếm ⇒ hau-qua-xau `khong-dem-duoc` (không phải bỏ qua)", () => {
    const sai = { ok: false as const, lyDo: "a: lỗi PostgresError 42501" };
    const t1 = tinhHauQua({ muc: [m("a")], coDb: true, truoc: sai, sau: ok({ a: 1 }) });
    expect(t1).toMatchObject({ ketCuc: "hau-qua-xau", db: "khong-dem-duoc" });
    expect(t1.lyDo).toContain("khong-dem-duoc");
    expect(t1.lyDo).toContain("42501");
    expect(tinhHauQua({ muc: [m("a")], coDb: true, truoc: ok({ a: 1 }), sau: sai }).ketCuc).toBe("hau-qua-xau");
    expect(tinhHauQua({ muc: [m("a")], coDb: true, truoc: null, sau: null }).ketCuc).toBe("hau-qua-xau");
    expect(tinhHauQua({ muc: [m("a"), m("b")], coDb: true, truoc: ok({ a: 1 }), sau: ok({ a: 1, b: 1 }) }).db).toBe("khong-dem-duoc");
  });
  it("★★★ không có cờ DB ⇒ `khong-do-db`, ok, không chấm (kể cả không có số đếm); không mục ⇒ ok", () => {
    expect(tinhHauQua({ muc: [m("a")], coDb: false, truoc: null, sau: null })).toEqual({ ketCuc: "ok", db: "khong-do-db", lyDo: null, bang: [] });
    expect(tinhHauQua({ muc: [], coDb: true, truoc: null, sau: null }).ketCuc).toBe("ok");
  });
});

describe("demTatCa — fail-closed, lý do không chép thông điệp lỗi", () => {
  const may = (dem: (x: MucDem) => Promise<number>, kd: (x: MucDem) => Promise<string | null> = async () => null): MayDem => ({ kiemDinhDanh: kd, dem });
  it("★★★ đếm đủ ⇒ khoá theo nhãn mục", async () => {
    const k = await demTatCa(may(async (x) => (x.bang === "a" ? 2 : 7)), [m("a"), { bang: "b", cot: "c", toanTu: "LIKE", giaTri: "x%", ghi: false }]);
    expect(k).toEqual({ ok: true, dem: { a: 2, "b WHERE c LIKE 'x%'": 7 } });
  });
  it("★★★ lỗi quyền: lý do CHỈ tên lớp + mã 5 ký tự, KHÔNG chép thông điệp (có thể chứa URL / vai)", async () => {
    const e = Object.assign(new Error("permission denied for table a; role tho_ca_test postgres://u:MATKHAU@h/db"), { code: "42501" });
    const k = await demTatCa(may(async () => Promise.reject(e)), [m("a")]);
    expect(k).toEqual({ ok: false, lyDo: "a: lỗi Error 42501" });
    expect(JSON.stringify(k)).not.toContain("MATKHAU");
  });
  it("★★ định danh không có trong information_schema / số đếm rác (âm, NaN, lẻ) ⇒ ok:false, dừng ngay (không đếm tiếp)", async () => {
    let goi = 0;
    const k1 = await demTatCa(may(async () => (goi++, 1), async (x) => (x.bang === "a" ? 'bảng "a" không có' : null)), [m("a"), m("b")]);
    expect(k1).toMatchObject({ ok: false });
    expect(goi).toBe(0);
    for (const rac of [-1, Number.NaN, 1.5]) expect(await demTatCa(may(async () => rac), [m("a")])).toMatchObject({ ok: false });
  });
});

describe("mayDemPostgres — bind + định danh (bản giả của thẻ mẫu)", () => {
  type Goi = { cau: string; giaTri: unknown[] };
  function sqlGia(hang: (cau: string) => Array<Record<string, unknown>>) {
    const goi: Goi[] = [];
    const sql = ((a: TemplateStringsArray | string, ...v: unknown[]) => {
      if (typeof a === "string") return { dinhDanh: a };
      const laId = (x: unknown) => !!x && typeof x === "object" && "dinhDanh" in (x as object);
      let bind = 0;
      const cau = a.reduce((acc, ch, i) => acc + ch + (i < v.length ? (laId(v[i]) ? `<id:${(v[i] as { dinhDanh: string }).dinhDanh}>` : `$${++bind}`) : ""), "");
      goi.push({ cau, giaTri: v.filter((x) => !(x && typeof x === "object" && "dinhDanh" in (x as object))) });
      return Promise.resolve(hang(cau));
    }) as unknown as SqlDem;
    return { sql, goi };
  }
  it("★★★ dem: GIÁ TRỊ LIKE ở tham số bind (không nằm trong chuỗi SQL), bảng + cột qua sql(…)", async () => {
    const { sql, goi } = sqlGia(() => [{ n: 4 }]);
    const n = await mayDemPostgres(sql).dem({ bang: "factories", cot: "code", toanTu: "LIKE", giaTri: "SS_FAC_%", ghi: false });
    expect(n).toBe(4);
    expect(goi).toHaveLength(1);
    expect(goi[0]!.cau).toBe("select count(*)::int as n from <id:factories> where <id:code>::text like $1");
    expect(goi[0]!.giaTri).toEqual(["SS_FAC_%"]);
    expect(goi[0]!.cau).not.toContain("SS_FAC_");
  });
  it("★★★ dem: `=` và bảng trần dùng đúng câu; kiemDinhDanh hỏi information_schema bằng bind (bảng, cột)", async () => {
    const { sql, goi } = sqlGia((c) => (c.includes("information_schema") ? [{ ok: 1 }] : [{ n: 0 }]));
    const may = mayDemPostgres(sql);
    expect(await may.dem({ bang: "machines", ghi: false })).toBe(0);
    await may.dem({ bang: "machines", cot: "tag", toanTu: "=", giaTri: "x", ghi: false });
    expect(await may.kiemDinhDanh({ bang: "machines", cot: "tag", toanTu: "=", giaTri: "x", ghi: false })).toBeNull();
    expect(goi.map((g) => g.cau)).toEqual([
      "select count(*)::int as n from <id:machines>",
      "select count(*)::int as n from <id:machines> where <id:tag>::text = $1",
      "select 1 as ok from information_schema.tables where table_schema = 'public' and table_name = $1 and table_type = 'BASE TABLE'",
      "select 1 as ok from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2",
    ]);
    expect(goi[2]!.giaTri).toEqual(["machines"]);
    expect(goi[3]!.giaTri).toEqual(["machines", "tag"]);
  });
  it("★★★ bảng / cột không có trong information_schema ⇒ lý do (không đếm); định danh sai dạng ⇒ ném TRƯỚC khi chạm CSDL", async () => {
    const { sql, goi } = sqlGia(() => []);
    const may = mayDemPostgres(sql);
    expect(await may.kiemDinhDanh({ bang: "khong_co", ghi: false })).toContain("không có trong schema public");
    const { sql: sql2, goi: goi2 } = sqlGia((c) => (c.includes("information_schema.tables") ? [{ ok: 1 }] : []));
    expect(await mayDemPostgres(sql2).kiemDinhDanh({ bang: "a", cot: "b", toanTu: "=", giaTri: "x", ghi: false })).toContain('cột "a.b"');
    expect(goi2).toHaveLength(2);
    const dem = mayDemPostgres(sql);
    await expect(dem.dem({ bang: "a; drop", ghi: false })).rejects.toThrow("định danh");
    await expect(dem.kiemDinhDanh({ bang: "a", cot: "B", toanTu: "=", giaTri: "x", ghi: false })).rejects.toThrow("định danh");
    expect(goi).toHaveLength(1); // chỉ lần kiemDinhDanh hợp lệ đầu tiên chạm
  });
  it("nhanMuc: bảng trần = tên bảng", () => {
    expect(nhanMuc({ bang: "machines", ghi: false })).toBe("machines");
  });
});
