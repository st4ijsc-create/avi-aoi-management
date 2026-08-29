/**
 * LƯỚI cho `dungCauHoiSuaChon` — hàm THUẦN dựng câu hỏi cho Cmd+K. Năm bất biến bắt buộc: có
 * đường dẫn · có số dòng ĐÚNG · có đoạn mã · có yêu cầu · có nhắc tên tool `de_xuat_sua_doan`
 * (thiếu một trong năm thì `docDeXuatCucBo` phía bên kia không đọc được đề xuất, hoặc model không
 * biết sửa đoạn nào). Cộng thêm ca biên: đoạn chọn RỖNG phải ném lỗi rành mạch, không âm thầm gửi
 * một câu hỏi trống.
 */
import { describe, it, expect } from "vitest";
import { dungCauHoiSuaChon } from "./cauHoiSuaChon";

const DAU_VAO = {
  duongTuongDoi: "src/tinh/CongTien.cs",
  dongDau: 12,
  dongCuoi: 18,
  doanChon: "public int Cong(int a, int b) { return a + b; }",
  yeuCau: "đổi tên hàm thành CongHaiSo và thêm kiểm tra tràn số",
};

describe("dungCauHoiSuaChon", () => {
  it("★★★ có đường dẫn tương đối", () => {
    expect(dungCauHoiSuaChon(DAU_VAO)).toContain("src/tinh/CongTien.cs");
  });

  it("★★★ có khoảng dòng ĐÚNG (dongDau/dongCuoi)", () => {
    const s = dungCauHoiSuaChon(DAU_VAO);
    expect(s).toContain("dòng 12");
    expect(s).toContain("dòng 18");
    // Khoảng dòng còn phải xuất hiện lại TRONG khối avi-tool mẫu, đúng số — đây là thứ
    // `docDeXuatCucBo` thật sự đọc, không phải câu văn mô tả ở trên.
    expect(s).toContain('"dongDau":12');
    expect(s).toContain('"dongCuoi":18');
  });

  it("★★★ có đoạn mã đang chọn, nguyên văn, trong hàng rào", () => {
    const s = dungCauHoiSuaChon(DAU_VAO);
    expect(s).toContain("public int Cong(int a, int b) { return a + b; }");
    expect(s).toContain("```");
  });

  it("★★★ có yêu cầu của người dùng", () => {
    expect(dungCauHoiSuaChon(DAU_VAO)).toContain("đổi tên hàm thành CongHaiSo và thêm kiểm tra tràn số");
  });

  it("★★★ nhắc đúng tên tool de_xuat_sua_doan mà docDeXuatCucBo đọc được", () => {
    const s = dungCauHoiSuaChon(DAU_VAO);
    expect(s).toContain("de_xuat_sua_doan");
    expect(s).toContain('"tool":"de_xuat_sua_doan"');
  });

  it("★★★ đường dẫn trong khối avi-tool mẫu khớp ĐÚNG đường dẫn đã cho (không lệch)", () => {
    const s = dungCauHoiSuaChon(DAU_VAO);
    expect(s).toContain('"path":"src/tinh/CongTien.cs"');
  });

  it("★★★ đoạn chọn RỖNG ⇒ ném lỗi rành mạch, KHÔNG trả về câu hỏi rỗng lặng lẽ", () => {
    expect(() => dungCauHoiSuaChon({ ...DAU_VAO, doanChon: "" })).toThrow();
  });

  it("★★★ đoạn chọn CHỈ khoảng trắng cũng bị coi là rỗng ⇒ ném lỗi", () => {
    expect(() => dungCauHoiSuaChon({ ...DAU_VAO, doanChon: "   \n  \t " })).toThrow();
  });

  it("★★ lỗi ném ra phải là Error có thông điệp rõ ràng (không phải chuỗi/số bí ẩn)", () => {
    try {
      dungCauHoiSuaChon({ ...DAU_VAO, doanChon: "" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("rỗng");
    }
  });
});
