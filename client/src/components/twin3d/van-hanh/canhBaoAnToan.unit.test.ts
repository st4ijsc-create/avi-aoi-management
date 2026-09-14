import { describe, it, expect } from "vitest";
import { tomTatAnToan, trangThaiAnToan, type ThietBiAnToan } from "./canhBaoAnToan";

/**
 * ★★★ §11 #26 — E-STOP. Ca dương DỰNG TAY, và đó là quyết định có lý do.
 *
 * Đo được trên DB dev 2026-09-07: 3 robot, `status` phân bố `online` 2 · `idle` 1
 * — **KHÔNG robot nào đang `estop`**. Nghĩa là một phép nghiệm thu "chạy trên dữ
 * liệu thật rồi không thấy badge nào" sẽ XANH y hệt nhau dù mã đúng hay hỏng
 * hoàn toàn (G5 — đo trên tập rỗng). Nên ca dương ở đây phải dựng tay, và phải
 * có ô ĐỐI CHỨNG chứng minh bộ đếm biết KÊU.
 */

const R = (id: number, o: Partial<ThietBiAnToan> = {}): ThietBiAnToan => ({
  id, ma: `RB-${id}`, ...o,
});

describe("trangThaiAnToan — ba trạng thái, `khong_ro` KHÔNG phải `nha`", () => {
  it("★★★ `estop === true` ⇒ `nhan`", () => {
    expect(trangThaiAnToan(R(1, { estop: true }))).toBe("nhan");
  });

  it("★★★ `status === 'estop'` ⇒ `nhan` (nguồn thứ hai, fleetRouter.ts:325)", () => {
    expect(trangThaiAnToan(R(1, { status: "estop" }))).toBe("nhan");
  });

  it("★★★ BẤT KỲ nguồn nào nói 'đang nhấn' đều THẮNG", () => {
    // Với tín hiệu an toàn: dương-tính-giả tốn một lần đi kiểm tra,
    // âm-tính-giả tốn một người.
    expect(trangThaiAnToan(R(1, { estop: true, status: "online" }))).toBe("nhan");
    expect(trangThaiAnToan(R(1, { estop: null, status: "estop" }))).toBe("nhan");
  });

  it("`estop === false` ⇒ `nha` (ĐÃ đọc được, và không bị nhấn)", () => {
    expect(trangThaiAnToan(R(1, { estop: false }))).toBe("nha");
  });

  it("★★★ `estop == null` ⇒ `khong_ro`, KHÔNG phải `nha`", () => {
    // Một robot mất kết nối hiển thị giống robot đã-kiểm-và-an-toàn nghĩa là
    // màn hình tổng quan nói "mọi thứ ổn" về thiết bị ta không biết gì cả.
    expect(trangThaiAnToan(R(1))).toBe("khong_ro");
    expect(trangThaiAnToan(R(1, { estop: null }))).toBe("khong_ro");
    expect(trangThaiAnToan(R(1, { estop: undefined }))).toBe("khong_ro");
  });

  it("★★★ `status === 'online'` mà `estop == null` VẪN là `khong_ro`", () => {
    // Máy đang online không có nghĩa là ta đọc được mạch an toàn của nó. Suy
    // `nha` từ `online` là đúng lỗi "Quality=Good trong khi timestamp đứng im".
    expect(trangThaiAnToan(R(1, { status: "online" }))).toBe("khong_ro");
    expect(trangThaiAnToan(R(1, { status: "idle" }))).toBe("khong_ro");
  });
});

describe("tomTatAnToan — nổi lên tổng quan", () => {
  it("★★★ CA DƯƠNG: có E-STOP ⇒ `coCanhBao` và nêu ĐÍCH DANH thiết bị", () => {
    const ds = [R(1, { estop: false }), R(2, { estop: true }), R(3, { status: "estop" })];
    const tt = tomTatAnToan(ds);
    expect(tt.coCanhBao).toBe(true);
    // Danh sách, không phải số đếm: người trực ca cần biết robot NÀO.
    expect(tt.dangNhan.map((r) => r.ma).sort()).toEqual(["RB-2", "RB-3"]);
    expect(tt.soNha).toBe(1);
  });

  it("★★★ ĐỐI CHỨNG: không có E-STOP ⇒ KHÔNG cảnh báo", () => {
    // Thiếu ô này thì một bản cài đặt "luôn báo động" cũng xanh ô trên.
    const tt = tomTatAnToan([R(1, { estop: false }), R(2, { estop: false })]);
    expect(tt.coCanhBao).toBe(false);
    expect(tt.dangNhan).toEqual([]);
    expect(tt.soNha).toBe(2);
  });

  it("★★★ `khong_ro` đếm RIÊNG, không gộp vào `nha`", () => {
    // Hai câu dẫn tới hai hành động: `nha` = không phải làm gì;
    // `khong_ro` = đi xem vì sao mất tín hiệu.
    const tt = tomTatAnToan([R(1, { estop: false }), R(2), R(3, { status: "online" })]);
    expect(tt.soNha).toBe(1);
    expect(tt.soKhongRo).toBe(2);
    expect(tt.coCanhBao).toBe(false); // không rõ ≠ đang nhấn
  });

  it("tập RỖNG: không cảnh báo, mọi số bằng 0", () => {
    // ⚠ Ô này KHÔNG chứng minh gì về mã — nó chỉ ghim rằng tập rỗng không nổ.
    // Chính vì ca rỗng luôn "xanh" mà ba ô dương ở trên mới là phép đo thật.
    const tt = tomTatAnToan([]);
    expect(tt.coCanhBao).toBe(false);
    expect(tt.soKhongRo).toBe(0);
    expect(tt.soNha).toBe(0);
  });

  it("★ ẢNH CHỤP DB dev: 3 robot (online 2 · idle 1) ⇒ CẢ BA `khong_ro`", () => {
    // Đây là dữ liệu THẬT đo được. Nó cho thấy vì sao nghiệm thu #26 trên DB
    // này chứng minh số 0 về badge đỏ: không có ca dương nào để badge nổi lên.
    const tt = tomTatAnToan([
      R(1, { status: "online" }), R(2, { status: "online" }), R(3, { status: "idle" }),
    ]);
    expect(tt.soKhongRo).toBe(3);
    expect(tt.coCanhBao).toBe(false);
  });
});
