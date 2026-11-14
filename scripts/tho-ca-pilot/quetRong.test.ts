/**
 * HA-6d — quét rộng count(*) mọi bảng trước/sau. THUẦN (bộ quét giả) + bộ quét postgres với bản giả của thẻ mẫu — KHÔNG chạm CSDL.
 * ĐỘT BIẾN PHẢI BẮT: không sắp xếp / khử trùng · lỗi một bảng làm hỏng cả lượt quét · bảng ngoài thẻ lẫn vào trong thẻ · bảng mới/mất bị coi là không đổi · số null bị tính vào tổng ·
 * lỗi lộ thông điệp · bộ quét không đặt phiên chỉ-đọc / trần thời gian · 57014 không thành null · lỗi khác bị nuốt.
 */
import { describe, expect, it } from "vitest";
import { HAN_MOI_BANG_QUET_MS, mayQuetRongPostgres, type SqlDem } from "./mayDemPg";
import { luuYQuetRong, quetTatCa, soSanhQuet, TRAN_SO_BANG_QUET, type KetQuaQuet, type MayQuet } from "./quetRong";

const may = (ds: string[] | Error, dem: (b: string) => number | null | Error): MayQuet => ({
  lietKe: async () => {
    if (ds instanceof Error) throw ds;
    return ds;
  },
  dem: async (b) => {
    const r = dem(b);
    if (r instanceof Error) throw r;
    return r;
  },
});
const ok = (dem: Record<string, number | null>): KetQuaQuet => ({ ok: true, dem });

describe("quetTatCa", () => {
  it("★★★ đếm từng bảng, bảng sắp xếp và khử trùng; số null (quá hạn) giữ là null", async () => {
    const r = await quetTatCa(may(["b", "a", "b", "c"], (t) => ({ a: 1, b: 20, c: 0 })[t] ?? null));
    expect(r).toEqual({ ok: true, dem: { a: 1, b: 20, c: 0 } });
    expect(Object.keys((r as { dem: object }).dem)).toEqual(["a", "b", "c"]);
    expect(await quetTatCa(may(["a", "lon"], (t) => (t === "lon" ? null : 3)))).toEqual({ ok: true, dem: { a: 3, lon: null } });
  });
  it("★★★ MỘT bảng lỗi hoặc trả giá trị rác ⇒ số của nó null, các bảng khác vẫn đếm (không hỏng cả lượt quét)", async () => {
    const r = await quetTatCa(may(["a", "hong", "am", "nan", "z"], (t) => (t === "hong" ? new Error("permission denied MK_BI_MAT") : t === "am" ? -1 : t === "nan" ? Number.NaN : 7)));
    expect(r).toEqual({ ok: true, dem: { a: 7, am: null, hong: null, nan: null, z: 7 } });
    expect(JSON.stringify(r)).not.toContain("MK_BI_MAT");
  });
  it("★★★ không liệt kê được ⇒ ok:false, lý do CHỈ tên lớp + mã 5 ký tự (không chép thông điệp — có thể chứa URL / vai)", async () => {
    const loi = Object.assign(new Error("connect postgresql://u:MK_BI_MAT@h/db"), { code: "28P01" });
    const r = await quetTatCa(may(loi, () => 0));
    expect(r).toEqual({ ok: false, lyDo: "không liệt kê được bảng: Error 28P01" });
    expect(JSON.stringify(r)).not.toContain("MK_BI_MAT");
    expect(await quetTatCa(may(new TypeError("x"), () => 0))).toEqual({ ok: false, lyDo: "không liệt kê được bảng: TypeError" });
  });
  it("★★ quá nhiều bảng ⇒ không quét (ok:false); đúng bằng trần thì vẫn quét", async () => {
    const nhieu = Array.from({ length: TRAN_SO_BANG_QUET + 1 }, (_, i) => `t${String(i).padStart(5, "0")}`);
    expect(await quetTatCa(may(nhieu, () => 1))).toEqual({ ok: false, lyDo: `quá nhiều bảng (${TRAN_SO_BANG_QUET + 1} > ${TRAN_SO_BANG_QUET})` });
    const du = nhieu.slice(0, TRAN_SO_BANG_QUET);
    const r = await quetTatCa(may(du, () => 1));
    expect(r.ok).toBe(true);
    expect(Object.keys((r as { dem: object }).dem)).toHaveLength(TRAN_SO_BANG_QUET);
  });
});

describe("soSanhQuet", () => {
  const trongThe = new Set(["a"]);
  it("★★★ không bảng nào đổi ⇒ doi rỗng, tongChenh 0, soBang đúng; luuY rỗng", () => {
    const k = soSanhQuet(ok({ a: 1, b: 2 }), ok({ a: 1, b: 2 }), trongThe);
    expect(k).toEqual({ ok: true, lyDo: null, soBang: 2, doi: [], ngoaiThe: [], khongDem: [], tongChenh: 0 });
    expect(luuYQuetRong(k)).toBe("");
  });
  it("★★★ bảng TRONG thẻ đổi ⇒ vào `doi` nhưng KHÔNG vào `ngoaiThe`; bảng NGOÀI thẻ đổi ⇒ vào cả hai; tổng cộng đúng; doi theo tên", () => {
    const k = soSanhQuet(ok({ a: 10, b: 5, c: 7, d: 9 }), ok({ a: 11, b: 7, c: 7, d: 6 }), trongThe);
    expect(k.doi).toEqual([
      { bang: "a", truoc: 10, sau: 11, chenh: 1 },
      { bang: "b", truoc: 5, sau: 7, chenh: 2 },
      { bang: "d", truoc: 9, sau: 6, chenh: -3 },
    ]);
    expect(k.ngoaiThe).toEqual(["b", "d"]);
    expect(k.tongChenh).toBe(0); // +1 +2 −3
    expect(k.soBang).toBe(4);
    const l = luuYQuetRong(k);
    expect(l).toContain("b 5→7 (+2)");
    expect(l).toContain("d 9→6 (-3)");
    expect(l).not.toContain("a 10→11");
    expect(l).toContain("không đổi kết cục");
  });
  it("★★★ bảng XUẤT HIỆN / BIẾN MẤT giữa hai lần quét ⇒ vào doi với chenh null (không cộng vào tổng); ngoài thẻ thì vào ngoaiThe", () => {
    const k = soSanhQuet(ok({ a: 1, cu: 4 }), ok({ a: 1, moi: 9 }), trongThe);
    expect(k.doi).toEqual([
      { bang: "cu", truoc: 4, sau: null, chenh: null },
      { bang: "moi", truoc: null, sau: 9, chenh: null },
    ]);
    expect(k.ngoaiThe).toEqual(["cu", "moi"]);
    expect(k.tongChenh).toBe(0);
    expect(luuYQuetRong(k)).toContain("cu 4→∅");
    expect(luuYQuetRong(k)).toContain("moi ∅→9");
  });
  it("★★ số null (không đếm được) ⇒ vào khongDem, KHÔNG vào doi, KHÔNG vào tổng", () => {
    const k = soSanhQuet(ok({ a: 1, lon: null, b: 5 }), ok({ a: 1, lon: 1000, b: null }), trongThe);
    expect(k.khongDem).toEqual(["b", "lon"]);
    expect(k.doi).toEqual([]);
    expect(k.tongChenh).toBe(0);
  });
  it("★★★ một lần quét hỏng / thiếu ⇒ ok:false, lý do nêu phía hỏng, mọi số rỗng", () => {
    const hong: KetQuaQuet = { ok: false, lyDo: "không mở được kết nối quét" };
    expect(soSanhQuet(hong, ok({ a: 1 }), trongThe)).toMatchObject({ ok: false, lyDo: "trước: không mở được kết nối quét", soBang: 0, doi: [], tongChenh: 0 });
    expect(soSanhQuet(ok({ a: 1 }), hong, trongThe)).toMatchObject({ ok: false, lyDo: "sau: không mở được kết nối quét" });
    expect(soSanhQuet(null, ok({}), trongThe)).toMatchObject({ ok: false, lyDo: "chưa quét lần nào" });
    expect(luuYQuetRong(soSanhQuet(hong, ok({}), trongThe))).toBe("HA-6d: quét rộng không xong (trước: không mở được kết nối quét) — không có số đo ngoài thẻ");
  });
});

describe("mayQuetRongPostgres — bản giả của thẻ mẫu", () => {
  type Goi = { cau: string; giaTri: unknown[] };
  function sqlGia(hang: (cau: string) => Array<Record<string, unknown>> | Error) {
    const goi: Goi[] = [];
    const sql = ((a: TemplateStringsArray | string, ...v: unknown[]) => {
      if (typeof a === "string") return { dinhDanh: a };
      const laId = (x: unknown) => !!x && typeof x === "object" && "dinhDanh" in (x as object);
      let bind = 0;
      const cau = a.reduce((acc, ch, i) => acc + ch + (i < v.length ? (laId(v[i]) ? `<id:${(v[i] as { dinhDanh: string }).dinhDanh}>` : `$${++bind}`) : ""), "");
      goi.push({ cau, giaTri: v.filter((x) => !laId(x)) });
      const r = hang(cau);
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    }) as unknown as SqlDem;
    return { sql, goi };
  }
  it("★★★ phiên đặt CHỈ-ĐỌC và trần thời gian bằng set_config (bind) MỘT lần; liệt kê chỉ BASE TABLE; đếm qua sql(định danh) với count(*)::text", async () => {
    const { sql, goi } = sqlGia((c) => (c.includes("information_schema") ? [{ table_name: "a" }, { table_name: "b" }] : c.includes("count(*)") ? [{ n: "12" }] : [{}]));
    const m = mayQuetRongPostgres(sql);
    expect(await m.lietKe()).toEqual(["a", "b"]);
    expect(await m.dem("a")).toBe(12);
    expect(await m.dem("b")).toBe(12);
    expect(goi.map((g) => g.cau)).toEqual([
      "select set_config('default_transaction_read_only', 'on', false), set_config('statement_timeout', $1, false)",
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
      "select count(*)::text as n from <id:a>",
      "select count(*)::text as n from <id:b>",
    ]);
    expect(goi[0]!.giaTri).toEqual([String(HAN_MOI_BANG_QUET_MS)]);
    expect(goi.every((g) => /^select /.test(g.cau))).toBe(true);
  });
  it("★★★ trần thời gian lấy từ tham số (làm tròn xuống, tối thiểu 1 ms)", async () => {
    for (const [vao, ra] of [[2500.9, "2500"], [0, "1"], [-5, "1"]] as const) {
      const { sql, goi } = sqlGia(() => [{ n: "0" }]);
      await mayQuetRongPostgres(sql, vao).dem("x");
      expect(goi[0]!.giaTri, String(vao)).toEqual([ra]);
    }
  });
  it("★★★ mã 57014 (quá hạn) ⇒ null; lỗi KHÁC ⇒ ném tiếp (bộ quét ngoài biến thành null và không dừng cả lượt)", async () => {
    const qua = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    const { sql } = sqlGia((c) => (c.includes("set_config") ? [{}] : qua));
    expect(await mayQuetRongPostgres(sql).dem("lon")).toBeNull();
    const quyen = Object.assign(new Error("permission denied"), { code: "42501" });
    const { sql: sql2 } = sqlGia((c) => (c.includes("set_config") ? [{}] : quyen));
    await expect(mayQuetRongPostgres(sql2).dem("kin")).rejects.toThrow("permission denied");
    const r = await quetTatCa(mayQuetRongPostgres(sqlGia((c) => (c.includes("set_config") ? [{}] : c.includes("information_schema") ? [{ table_name: "kin" }, { table_name: "ok" }] : c.includes("<id:kin>") ? quyen : [{ n: "4" }])).sql));
    expect(r).toEqual({ ok: true, dem: { kin: null, ok: 4 } });
  });
});
