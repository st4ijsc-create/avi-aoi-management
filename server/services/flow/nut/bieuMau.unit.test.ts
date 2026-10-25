/** nguoi.bieu-mau — định nghĩa trường, kiểm giá trị người điền (THUẦN) và node (payload của hàng chờ). */
import { describe, expect, it } from "vitest";
import { layNut, type NguCanhChay, type YeuCauCho } from "../dangKyNut";
import "../nut";
import { bieuMauCuaPayload, kiemDinhNghiaBieuMau, kiemGiaTriBieuMau, TRAN_CHUOI_BIEU_MAU, type TruongBieuMau } from "./bieuMau";

const TRUONG: TruongBieuMau[] = [
  { ten: "loai", nhan: "Loại", kieu: "chon", luaChon: ["a", "b"], batBuoc: true },
  { ten: "n", nhan: "Số", kieu: "so" },
  { ten: "ok", nhan: "Xong", kieu: "boolean" },
  { ten: "tx", nhan: "Chữ", kieu: "chuoi" },
];

describe("kiemDinhNghiaBieuMau", () => {
  it("hợp lệ ⇒ rỗng; không phải mảng / rỗng / > 20 / tên xấu / trùng / kiểu lạ / chon thiếu hoặc trùng lựa chọn / luaChon ở kiểu khác ⇒ lỗi", () => {
    expect(kiemDinhNghiaBieuMau(TRUONG)).toEqual([]);
    expect(kiemDinhNghiaBieuMau("x")).toHaveLength(1);
    expect(kiemDinhNghiaBieuMau([])).toHaveLength(1);
    expect(kiemDinhNghiaBieuMau(Array.from({ length: 21 }, (_, i) => ({ ten: `t${i}`, nhan: "x", kieu: "chuoi" })))).toHaveLength(1);
    expect(kiemDinhNghiaBieuMau([{ ten: "1a", nhan: "x", kieu: "chuoi" }]).join()).toMatch(/ten phải khớp/);
    expect(kiemDinhNghiaBieuMau([{ ten: "a", nhan: "x", kieu: "chuoi" }, { ten: "a", nhan: "y", kieu: "so" }]).join()).toMatch(/trùng/);
    expect(kiemDinhNghiaBieuMau([{ ten: "a", nhan: "x", kieu: "ngay" }]).join()).toMatch(/kieu phải là/);
    expect(kiemDinhNghiaBieuMau([{ ten: "a", nhan: "x", kieu: "chon" }]).join()).toMatch(/luaChon/);
    expect(kiemDinhNghiaBieuMau([{ ten: "a", nhan: "x", kieu: "chon", luaChon: ["z", "z"] }]).join()).toMatch(/luaChon/);
    expect(kiemDinhNghiaBieuMau([{ ten: "a", nhan: "x", kieu: "chuoi", luaChon: ["z"] }]).join()).toMatch(/chỉ dùng cho/);
    expect(kiemDinhNghiaBieuMau([{ ten: "a", nhan: " ", kieu: "chuoi" }]).join()).toMatch(/nhan/);
  });
});

describe("kiemGiaTriBieuMau", () => {
  it("hợp lệ: đúng kiểu, khoá lạ bị loại, trường không bắt buộc trống ⇒ null", () => {
    expect(kiemGiaTriBieuMau(TRUONG, { loai: "a", n: 1.5, ok: false, tx: "x", la: 1 })).toEqual({ ok: true, v: { loai: "a", n: 1.5, ok: false, tx: "x" } });
    expect(kiemGiaTriBieuMau(TRUONG, { loai: "b", tx: "" })).toEqual({ ok: true, v: { loai: "b", n: null, ok: null, tx: null } });
  });
  it("★ lỗi: thiếu bắt buộc · ngoài lựa chọn · chuỗi số KHÔNG ép · NaN/Infinity · boolean là chuỗi · quá dài · không phải chữ", () => {
    const loi = (g: unknown) => {
      const r = kiemGiaTriBieuMau(TRUONG, g);
      return r.ok ? null : r.loi;
    };
    expect(loi({})).toMatch(/bắt buộc/);
    expect(loi(null)).toMatch(/bắt buộc/);
    expect(loi({ loai: "c" })).toMatch(/lựa chọn/);
    expect(loi({ loai: "a", n: "3" })).toMatch(/số/);
    expect(loi({ loai: "a", n: Number.NaN })).toMatch(/số/);
    expect(loi({ loai: "a", n: Infinity })).toMatch(/số/);
    expect(loi({ loai: "a", ok: "true" })).toMatch(/có\/không/);
    expect(loi({ loai: "a", tx: "x".repeat(TRAN_CHUOI_BIEU_MAU + 1) })).toMatch(/quá dài/);
    expect(loi({ loai: "a", tx: 5 })).toMatch(/chữ/);
  });
  it("không đọc khoá kế thừa (constructor)", () => {
    const r = kiemGiaTriBieuMau([{ ten: "constructor", nhan: "C", kieu: "chuoi", batBuoc: true }], {});
    expect(r.ok).toBe(false);
  });
});

describe("node nguoi.bieu-mau", () => {
  const ngu = (main: { json: Record<string, unknown> }[]): NguCanhChay => ({
    runId: "r", flowId: "f", nodeId: "n", lan: 1, idempotencyKey: "r:n:1", inputs: { main }, nodes: {}, env: {}, run: { id: "r", flowId: "f", batDau: "x" },
  });
  it("trả yêu cầu chờ kind duyet, payload mang bieuMau {truong, truongRa}; hạn tính ra mili-giây; bieuMauCuaPayload đọc lại được", async () => {
    const kq = (await layNut("nguoi.bieu-mau")!.chay({ tieuDe: "T {{ $json.x }}", truong: TRUONG, hetHanGio: 2, truongRa: "kq" }, ngu([{ json: { x: 5 } }]))) as YeuCauCho;
    expect(kq.__cho.kind).toBe("duyet");
    expect(kq.__cho.hetHanMs).toBe(7_200_000);
    expect(kq.__cho.payload).toMatchObject({ tieuDe: "T 5", vaiTroDuyet: "supervisor" });
    expect(bieuMauCuaPayload(kq.__cho.payload)).toEqual({ truong: TRUONG.map((f) => ({ ...f, ...(f.batBuoc ? { batBuoc: true } : {}) })), truongRa: "kq" });
  });
  it("định nghĩa sai ⇒ node từ chối lúc chạy; truongRa xấu ⇒ bieuMau; thẻ thường ⇒ bieuMauCuaPayload null", async () => {
    await expect(layNut("nguoi.bieu-mau")!.chay({ truong: [] }, ngu([{ json: {} }]))).rejects.toThrow(/cần ít nhất 1 trường/);
    const kq = (await layNut("nguoi.bieu-mau")!.chay({ truong: TRUONG, truongRa: "1 xấu!" }, ngu([{ json: {} }]))) as YeuCauCho;
    expect(bieuMauCuaPayload(kq.__cho.payload)?.truongRa).toBe("bieuMau");
    expect(bieuMauCuaPayload({ tieuDe: "x" })).toBeNull();
    expect(bieuMauCuaPayload(null)).toBeNull();
  });
});
