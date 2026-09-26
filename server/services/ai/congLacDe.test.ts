import { describe, it, expect } from "vitest";
import { canTuKiem, doPhuTu, taoBangIdf, tuKiemCo, NGUONG_PHU } from "./congLacDe";

const KHO = ["Mã lỗi E082 Air pressure low kiểm tra máy nén khí", "Camera calibration hàng tuần", "Góc wetting 30° đến 75°", "Quy trình NG khay đỏ"];
const bang = taoBangIdf(KHO);

describe("congLacDe — phần thuần", () => {
  it("★ câu hỏi có từ hiếm VẮNG khỏi đoạn trích (nozzle, gắp) ⇒ độ phủ thấp", () => {
    expect(doPhuTu("Máy gắp đặt báo nozzle hút không lên", [KHO[0]], bang)).toBeLessThan(NGUONG_PHU);
  });
  it("câu hỏi mà từ nội dung có mặt ⇒ độ phủ cao", () => {
    expect(doPhuTu("E082 air pressure", [KHO[0]], bang)).toBeGreaterThanOrEqual(NGUONG_PHU);
  });
  it("chỉ toàn từ chức năng ⇒ 1 (không đủ căn cứ để chặn)", () => {
    expect(doPhuTu("là gì thế nào", [KHO[1]], bang)).toBe(1);
  });
  it("tự kiểm: KHONG/KHÔNG ⇒ false; CO ⇒ true; rỗng/mơ hồ ⇒ true (không chặn khi nghi ngờ)", () => {
    expect(tuKiemCo("KHONG")).toBe(false);
    expect(tuKiemCo("Không.")).toBe(false);
    expect(tuKiemCo("CO")).toBe(true);
    expect(tuKiemCo("")).toBe(true);
    expect(tuKiemCo(null)).toBe(true);
  });
  it("chỉ tự kiểm khi độ phủ dưới ngưỡng", () => {
    expect(canTuKiem(0.59)).toBe(true);
    expect(canTuKiem(0.6)).toBe(false);
    expect(canTuKiem(NaN)).toBe(false);
  });
});
