// SCADA R0 Task 11 — nhãn trạng thái kết nối + kiểu hiển thị chất lượng (D10) của M10. Hàm thuần.
import { describe, expect, it } from "vitest";
import { dinhDangTuoi, hienChatLuong, nhanTrangThai, type DonViThoiGian } from "./chatLuongHienThi";

const now = 1_800_000_000_000;
// Đơn vị là THAM SỐ BẮT BUỘC (không có mặc định ngầm tiếng Việt): fixture tường minh cho test.
const VI: DonViThoiGian = { giay: "s", phut: "ph", gio: "giờ", ngay: "ngày" };
const EN: DonViThoiGian = { giay: "s", phut: "min", gio: "h", ngay: "d" };

describe("nhanTrangThai", () => {
  it("lost 3 phút ⇒ tone bad, khoá scada.diag.matKetNoi, '3 ph'", () => {
    expect(nhanTrangThai("lost", now - 180_000, now, VI)).toEqual({ nhan: "scada.diag.matKetNoi", thoiGian: "3 ph", tone: "bad" });
  });
  it("các trạng thái còn lại: tone + khoá riêng", () => {
    expect(nhanTrangThai("connected", now - 5_000, now, VI)).toMatchObject({ nhan: "scada.diag.trangThai.connected", tone: "ok", thoiGian: "5 s" });
    expect(nhanTrangThai("connecting", null, now, VI)).toMatchObject({ nhan: "scada.diag.trangThai.connecting", tone: "warn", thoiGian: null });
    expect(nhanTrangThai("disabled", null, now, VI)).toMatchObject({ nhan: "scada.diag.trangThai.disabled", tone: "muted" });
    expect(nhanTrangThai("khong_ro", null, now, VI)).toMatchObject({ nhan: "scada.diag.trangThai.khong_ro", tone: "warn" });
  });
  it("edge_chua_co_so_lieu ⇒ muted (KHÔNG BAO GIỜ bad), không có thời gian dù có mốc", () => {
    expect(nhanTrangThai("edge_chua_co_so_lieu", now - 999_000, now, VI)).toEqual({
      nhan: "scada.diag.edgeChuaCoSoLieu",
      thoiGian: null,
      tone: "muted",
    });
  });
  it("đơn vị thời gian: giây / phút / giờ / ngày; mốc ở tương lai hoặc null ⇒ thoiGian null (không '-3 ph')", () => {
    expect(nhanTrangThai("lost", now - 59_000, now, VI).thoiGian).toBe("59 s");
    expect(nhanTrangThai("lost", now - 3_600_000, now, VI).thoiGian).toBe("1 giờ");
    expect(nhanTrangThai("lost", now - 2 * 86_400_000, now, VI).thoiGian).toBe("2 ngày");
    expect(nhanTrangThai("lost", now + 60_000, now, VI).thoiGian).toBeNull();
    expect(nhanTrangThai("lost", null, now, VI).thoiGian).toBeNull();
  });
  it("đơn vị đi theo tham số (en)", () => {
    expect(nhanTrangThai("lost", now - 180_000, now, EN).thoiGian).toBe("3 min");
  });
});

describe("hienChatLuong (D10)", () => {
  it("uncertain ⇒ viền chấm xám (KHÔNG vàng, KHÔNG gạch tím)", () => {
    expect(hienChatLuong("uncertain", false)).toEqual({ kieu: "nghi_ngo", vien: "dotted-grey" });
  });
  it("good tươi ⇒ không viền; good nhưng cũ ⇒ 'cu' + gạch tím", () => {
    expect(hienChatLuong("good", false)).toEqual({ kieu: "tot", vien: "none" });
    expect(hienChatLuong("good", true)).toEqual({ kieu: "cu", vien: "purple-strike" });
  });
  it("bad ⇒ xấu + gạch tím (kể cả khi tươi)", () => {
    expect(hienChatLuong("bad", false)).toEqual({ kieu: "xau", vien: "purple-strike" });
    expect(hienChatLuong("bad", true)).toEqual({ kieu: "xau", vien: "purple-strike" });
  });
  it("uncertain mà cũ ⇒ không tin được ⇒ 'cu' + gạch tím", () => {
    expect(hienChatLuong("uncertain", true)).toEqual({ kieu: "cu", vien: "purple-strike" });
  });
});

describe("dinhDangTuoi — đơn vị + dấu thập phân theo ngôn ngữ (không mặc định tiếng Việt)", () => {
  it("vi: '1,5 s', '1 ph', '5 giờ'", () => {
    expect(dinhDangTuoi(1500, VI, "vi")).toBe("1,5 s");
    expect(dinhDangTuoi(90_000, VI, "vi")).toBe("1 ph");
    expect(dinhDangTuoi(5 * 3_600_000, VI, "vi")).toBe("5 giờ");
  });
  it("en: '1.5 s', '1 min', '5 h' — KHÔNG có 'giờ' / 'ph' / dấu phẩy", () => {
    expect(dinhDangTuoi(1500, EN, "en")).toBe("1.5 s");
    expect(dinhDangTuoi(90_000, EN, "en")).toBe("1 min");
    const gio = dinhDangTuoi(5 * 3_600_000, EN, "en");
    expect(gio).toBe("5 h");
    expect(gio).not.toMatch(/giờ|ph/);
  });
  it("null / âm / không hữu hạn ⇒ '—'", () => {
    expect(dinhDangTuoi(null, EN, "en")).toBe("—");
    expect(dinhDangTuoi(-1, EN, "en")).toBe("—");
    expect(dinhDangTuoi(Number.NaN, EN, "en")).toBe("—");
  });
});
