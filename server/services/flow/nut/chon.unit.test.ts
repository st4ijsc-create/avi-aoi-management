/**
 * ★★★ Lô logic-chon — kiểm THUẦN `logic.chon` / `logic.gom`: mỗi toán tử × kiểu (KHÔNG ép kiểu), điều kiện khớp ĐẦU TIÊN thắng, biểu thức lỗi ⇒ `khac`, trần,
 * và BẢO TOÀN trên 200 lô ngẫu nhiên (seed cố định): Σ item ra = item vào, mỗi item xuất hiện ở ĐÚNG MỘT cổng (đúng thứ tự trong cổng).
 */
import { describe, expect, it } from "vitest";
import { layNut, type NguCanhChay } from "../dangKyNut";
import "./index";
import { CONG_CHON, TRAN_ITEM_CHON, TRAN_ITEM_GOM, chonCong, khopDieuKien } from "./chon";

const ngu = (items: { json: Record<string, unknown> }[]): NguCanhChay =>
  ({ runId: "r", flowId: "f", nodeId: "n", lan: 1, idempotencyKey: "k", inputs: { main: items }, nodes: {}, env: {}, run: { id: "r", flowId: "f", batDau: new Date().toISOString() } }) as unknown as NguCanhChay;
const chay = async (loai: string, tham: Record<string, unknown>, items: { json: Record<string, unknown> }[]) => (await layNut(loai)!.chay(tham, ngu(items))) as Record<string, { json: Record<string, unknown> }[]>;

describe("khopDieuKien — không ép kiểu", () => {
  it("eq: nghiêm ngặt (1 ≠ '1', true ≠ 1, null ≠ 'null'); đối tượng / mảng không bao giờ bằng", () => {
    expect(khopDieuKien("a", "eq", "a")).toBe(true);
    expect(khopDieuKien(1, "eq", 1)).toBe(true);
    expect(khopDieuKien(1, "eq", "1")).toBe(false);
    expect(khopDieuKien(true, "eq", 1)).toBe(false);
    expect(khopDieuKien(null, "eq", null)).toBe(true);
    expect(khopDieuKien(null, "eq", "null")).toBe(false);
    expect(khopDieuKien(undefined, "eq", null)).toBe(false);
    expect(khopDieuKien({ a: 1 }, "eq", { a: 1 })).toBe(false);
    expect(khopDieuKien([1], "eq", [1])).toBe(false);
  });
  it("in: bằng nghiêm ngặt một phần tử; dich không phải mảng ⇒ không khớp", () => {
    expect(khopDieuKien("b", "in", ["a", "b"])).toBe(true);
    expect(khopDieuKien(2, "in", ["2"])).toBe(false);
    expect(khopDieuKien("a", "in", "a")).toBe(false);
    expect(khopDieuKien({}, "in", [{}])).toBe(false);
  });
  it("gt/lt/gte/lte: CẢ HAI phải là số hữu hạn (chuỗi, null, NaN, Infinity ⇒ không khớp)", () => {
    expect(khopDieuKien(5, "gt", 3)).toBe(true);
    expect(khopDieuKien(3, "gt", 3)).toBe(false);
    expect(khopDieuKien(3, "gte", 3)).toBe(true);
    expect(khopDieuKien(2, "lt", 3)).toBe(true);
    expect(khopDieuKien(3, "lte", 3)).toBe(true);
    expect(khopDieuKien("5", "gt", 3)).toBe(false);
    expect(khopDieuKien(5, "gt", "3")).toBe(false);
    expect(khopDieuKien(null, "lt", 3)).toBe(false);
    expect(khopDieuKien(Number.NaN, "lt", 3)).toBe(false);
    expect(khopDieuKien(Number.POSITIVE_INFINITY, "gt", 3)).toBe(false);
  });
  it("toán tử lạ ⇒ không khớp", () => {
    expect(khopDieuKien("a", "regex", "a")).toBe(false);
    expect(khopDieuKien("a", undefined, "a")).toBe(false);
  });
});

describe("chonCong", () => {
  it("điều kiện khớp ĐẦU TIÊN thắng (thứ tự quan trọng); không khớp ⇒ khac; chỉ xét tối đa 5 điều kiện", () => {
    const ds = [{ so: "gt", dich: 10 }, { so: "gt", dich: 5 }, { so: "in", dich: [7, 8] }];
    expect(chonCong(20, ds)).toBe("nhanh-1");
    expect(chonCong(7, ds)).toBe("nhanh-2"); // khớp cả nhánh 2 và 3 ⇒ nhánh 2 thắng
    expect(chonCong(1, ds)).toBe("khac");
    const sau = Array.from({ length: 6 }, (_, i) => ({ so: "eq", dich: i }));
    expect(chonCong(5, sau)).toBe("khac"); // điều kiện thứ 6 không được xét
    expect(chonCong(4, sau)).toBe("nhanh-5");
  });
});

describe("node logic.chon", () => {
  const tham = { giaTri: "{{ $json.nhan }}", nhanh: [{ so: "eq", dich: "dien" }, { so: "in", dich: ["co-khi", "plc"] }] };
  it("định tuyến item đúng cổng, giữ thứ tự; giá trị thiếu / biểu thức lỗi ⇒ khac (KHÔNG rơi item)", async () => {
    const vao = [{ json: { nhan: "dien", i: 1 } }, { json: { nhan: "plc", i: 2 } }, { json: { i: 3 } }, { json: { nhan: "co-khi", i: 4 } }, { json: { nhan: "dien", i: 5 } }];
    const ra = await chay("logic.chon", tham, vao);
    expect(ra["nhanh-1"].map((x) => x.json.i)).toEqual([1, 5]);
    expect(ra["nhanh-2"].map((x) => x.json.i)).toEqual([2, 4]);
    expect(ra.khac.map((x) => x.json.i)).toEqual([3]);
    const loi = await chay("logic.chon", { giaTri: "{{ $json.a.b.c.d() }}", nhanh: [{ so: "eq", dich: 1 }] }, [{ json: { i: 1 } }, { json: { i: 2 } }]);
    expect(loi.khac.length).toBe(2);
    for (const c of CONG_CHON) expect(Array.isArray(loi[c]), c).toBe(true);
  });
  it("số vs chuỗi KHÔNG ép: giaTri là số 1 không khớp dich '1'", async () => {
    const ra = await chay("logic.chon", { giaTri: "{{ $json.v }}", nhanh: [{ so: "eq", dich: "1" }] }, [{ json: { v: 1 } }, { json: { v: "1" } }]);
    expect(ra["nhanh-1"].map((x) => x.json.v)).toEqual(["1"]);
    expect(ra.khac.map((x) => x.json.v)).toEqual([1]);
  });
  it("trần: > TRAN_ITEM_CHON item ⇒ lỗi QUA_TRAN_ITEM (không cắt); đúng bằng trần ⇒ chạy; > 5 điều kiện ⇒ lỗi", async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ json: { i } }));
    await expect(chay("logic.chon", tham, mk(TRAN_ITEM_CHON + 1))).rejects.toMatchObject({ ma: "QUA_TRAN_ITEM" });
    const ra = await chay("logic.chon", tham, mk(TRAN_ITEM_CHON));
    expect(ra.khac.length).toBe(TRAN_ITEM_CHON);
    await expect(chay("logic.chon", { giaTri: "{{ $json.i }}", nhanh: Array.from({ length: 6 }, () => ({ so: "eq", dich: 1 })) }, mk(1))).rejects.toMatchObject({ ma: "QUA_NHIEU_NHANH" });
  });
  it("★ BẢO TOÀN trên 200 lô ngẫu nhiên (seed cố định): Σ ra = vào, mỗi item đúng một cổng, thứ tự trong cổng giữ nguyên", async () => {
    let seed = 20261026;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const gts: unknown[] = [1, "1", null, true, false, 0, -5, 3.5, "dien", "khac", "", { a: 1 }, [1], Number.MAX_SAFE_INTEGER];
    const toanTu = ["eq", "in", "gt", "lt", "gte", "lte"];
    for (let lo = 0; lo < 200; lo++) {
      const n = Math.floor(rnd() * 40);
      const nhanh = Array.from({ length: Math.floor(rnd() * 6) }, () => {
        const so = toanTu[Math.floor(rnd() * toanTu.length)];
        return { so, dich: so === "in" ? [gts[Math.floor(rnd() * gts.length)], gts[Math.floor(rnd() * gts.length)]] : gts[Math.floor(rnd() * gts.length)] };
      });
      const vao = Array.from({ length: n }, (_, i) => ({ json: { i, v: gts[Math.floor(rnd() * gts.length)] } }));
      const ra = await chay("logic.chon", { giaTri: "{{ $json.v }}", nhanh: nhanh.slice(0, 5) }, vao);
      const tat = CONG_CHON.flatMap((c) => ra[c]);
      expect(tat.length, `lô ${lo}`).toBe(n);
      expect(new Set(tat).size, `lô ${lo}: trùng item`).toBe(n);
      for (const c of CONG_CHON) {
        const ds = ra[c].map((x) => x.json.i as number);
        expect([...ds].sort((a, b) => a - b), `lô ${lo} cổng ${c}: sai thứ tự`).toEqual(ds);
      }
    }
  });
});

describe("node logic.gom", () => {
  it("gộp N item ⇒ 1 item { danhSach, soItem }; truongRa hợp lệ được dùng, không hợp lệ ⇒ danhSach", async () => {
    const ra = await chay("logic.gom", {}, [{ json: { a: 1 } }, { json: { a: 2 } }]);
    expect(ra.main).toEqual([{ json: { danhSach: [{ a: 1 }, { a: 2 }], soItem: 2 } }]);
    expect((await chay("logic.gom", { truongRa: "tatCa" }, [{ json: { a: 1 } }])).main[0].json).toEqual({ tatCa: [{ a: 1 }], soItem: 1 });
    expect(Object.keys((await chay("logic.gom", { truongRa: "__proto__" }, [{ json: {} }])).main[0].json).sort()).toEqual(["danhSach", "soItem"]);
  });
  it("trần: đúng TRAN_ITEM_GOM ⇒ gộp; vượt ⇒ lỗi QUA_TRAN_ITEM (không cắt)", async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ json: { i } }));
    expect((await chay("logic.gom", {}, mk(TRAN_ITEM_GOM))).main[0].json.soItem).toBe(TRAN_ITEM_GOM);
    await expect(chay("logic.gom", {}, mk(TRAN_ITEM_GOM + 1))).rejects.toMatchObject({ ma: "QUA_TRAN_ITEM" });
  });
});
