/**
 * Đợt 8.3 — phần thuần của Flow Studio (`flowStudio.ts`). Đuôi `.unit.test.ts` BẮT BUỘC (glob nửa client của vitest).
 */
import { describe, it, expect } from "vitest";
import { kiemLuong, type KhaiBaoNut } from "@shared/flow/model";
import {
  docItemsNhap, idLuongTuTen, idNutMoi, loiBieuThucChuoi, loiBieuThucThamSo, luongMoi, nhomDanhMuc, saoTuMau, taoNutMoi, trangThaiTheoNut,
  type KhaiBaoNutClient,
} from "./flowStudio";

const kb = (type: string, them: Partial<KhaiBaoNutClient> = {}): KhaiBaoNutClient => ({
  type, typeVersion: 1, laKichHoat: false, congVao: ["main"], congRa: ["main"], tacDungPhu: "thuan", lapLai: "idempotent", choDuCong: false, nhanBiMat: false, ...them,
});
const DANH_MUC = [
  kb("kich-hoat.thu-cong", { laKichHoat: true, congVao: [] }),
  kb("du-lieu.dat"),
  kb("logic.neu", { congRa: ["dung", "sai"] }),
  kb("ai.llm"),
  kb("nguoi.duyet", { congRa: ["dong-y", "tu-choi", "het-han"] }),
];
const dangKy = (t: string) => DANH_MUC.find((k) => k.type === t) as KhaiBaoNut | undefined;

describe("Flow Studio — biểu thức tức thì", () => {
  it("chuỗi không có biểu thức / biểu thức đúng ⇒ không lỗi", () => {
    expect(loiBieuThucChuoi("abc")).toBeNull();
    expect(loiBieuThucChuoi("{{ $json.so > 10 }}")).toBeNull();
    expect(loiBieuThucChuoi("x {{ upper($json.ten) }} y")).toBeNull();
  });
  it("cú pháp sai / ngoặc không đóng ⇒ có lỗi (đúng bộ phân tích của động cơ)", () => {
    expect(loiBieuThucChuoi("{{ $json.so > }}")).not.toBeNull();
    expect(loiBieuThucChuoi("{{ $json.so")).not.toBeNull();
    expect(loiBieuThucChuoi("{{ $json.a b }}")).not.toBeNull();
  });
  it("lỗi trong tham số lồng mang đường dẫn", () => {
    const l = loiBieuThucThamSo({ truong: { a: "{{ 1 + }}", b: "{{ 2 }}" }, ds: ["ok", "{{ ( }}"] });
    expect(Object.keys(l).sort()).toEqual(["ds.1", "truong.a"]);
  });
});

describe("Flow Studio — tạo node / luồng", () => {
  it("id node duy nhất theo đuôi type", () => {
    expect(idNutMoi("du-lieu.dat", ["dat-1", "dat-2"])).toBe("dat-3");
    const n = taoNutMoi(DANH_MUC[2], [], [10.4, 20.6]);
    expect(n).toMatchObject({ id: "neu-1", type: "logic.neu", position: [10, 21] });
  });
  it("id luồng từ tên tiếng Việt", () => {
    expect(idLuongTuTen("e2e83 Đặt trường thử", "ab12")).toBe("e2e83-dat-truong-thu-ab12");
    expect(idLuongTuTen("!!!", "zz")).toBe("luong-zz");
  });
  it("luồng mới + node nối đúng cổng ⇒ hợp lệ theo kiemLuong", () => {
    const def = luongMoi("e2e83-x", "x");
    const dat = taoNutMoi(DANH_MUC[1], def.nodes.map((n) => n.id), [200, 0]);
    def.nodes.push(dat);
    def.connections.push({ from: { node: "thu-cong-1", port: "main" }, to: { node: dat.id, port: "main" } });
    expect(kiemLuong(def, dangKy)).toMatchObject({ ok: true, hang: "thuan" });
  });
  it("sao từ mẫu: id/tên mới, bỏ pinData", () => {
    const m = { ...luongMoi("mau-a", "A"), pinData: { x: [{ json: {} }] } };
    const s = saoTuMau(m, "e2e83-b", "B");
    expect(s.id).toBe("e2e83-b");
    expect(s.name).toBe("B");
    expect("pinData" in s).toBe(false);
  });
  it("nhóm danh mục theo tiền tố, thứ tự cố định, có lọc", () => {
    expect(nhomDanhMuc(DANH_MUC).map((g) => g.nhom)).toEqual(["kich-hoat", "logic", "du-lieu", "ai", "nguoi"]);
    expect(nhomDanhMuc(DANH_MUC, "llm").map((g) => g.nhom)).toEqual(["ai"]);
  });
});

describe("Flow Studio — chạy tay / dòng thời gian", () => {
  it("items nhập: bọc tự động, từ chối JSON hỏng / phần tử không phải đối tượng", () => {
    expect(docItemsNhap('[{"so":1},{"json":{"so":2}}]')).toEqual({ ok: true, items: [{ json: { so: 1 } }, { json: { so: 2 } }] });
    expect(docItemsNhap("[1]")).toEqual({ ok: false });
    expect(docItemsNhap("{")).toEqual({ ok: false });
    expect(docItemsNhap("")).toEqual({ ok: true, items: [] });
  });
  it("trạng thái node = bước mới nhất", () => {
    expect(trangThaiTheoNut([{ nodeId: "a", status: "loi" }, { nodeId: "a", status: "xong" }, { nodeId: "b", status: "dang-chay" }])).toEqual({ a: "xong", b: "dang-chay" });
  });
});
