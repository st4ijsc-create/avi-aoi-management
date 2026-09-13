/**
 * ════════════════════════════════════════════════════════════════════════════
 * `mauChuTrenNen.unit.test.ts` — ĐỢT 57 (mục thiết kế 11)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Lưới này KHÔNG hỏi "hàm có chạy không". Nó hỏi **đúng câu mà phép đo pixel đã hỏi**:
 * *với đúng ba màu mức độ của hệ token, cặp chữ/nền được chọn có đạt 4,5 : 1 không* —
 * và **bản ghim `#fff` cũ có TRƯỢT không** (đối chứng; G139: một kết luận "đạt" chỉ có
 * giá trị khi cùng thiết bị đo ấy biết kêu trượt trên nền cũ).
 *
 * Byte sRGB dưới đây là **số đo thật**, lấy từ pixel của trang đã vẽ ở Đợt 57
 * (`.qa-dot57/do-sau-vi/tong.json`, trường `nenRGB` của các badge) chứ không phải
 * trị quy từ `oklch()` bằng tay — đúng luật "đọc thiết bị đo, không đọc kết quả".
 */
import { describe, it, expect } from "vitest";

import { doChoi, tiSoTuongPhan, chonByteTuongPhan, type ByteMau } from "./mauChuTrenNen";

/** Byte sRGB ĐO ĐƯỢC trên trang (theme tối) — xem docblock. */
const NEN_TOI: ByteMau = [7, 10, 16]; // --background
const CHU_SANG: ByteMau = [244, 245, 250]; // --foreground
const MUC = {
  destructive: [241, 77, 76] as ByteMau,
  warning: [239, 168, 49] as ByteMau,
  info: [90, 163, 236] as ByteMau,
};
const TRANG: ByteMau = [255, 255, 255];
const NGUONG_CHU_THUONG = 4.5;

describe("★ nền tảng — công thức WCAG 2.1, không phải 'brightness'", () => {
  it("độ chói của trắng = 1, của đen = 0", () => {
    expect(doChoi([255, 255, 255])).toBeCloseTo(1, 5);
    expect(doChoi([0, 0, 0])).toBeCloseTo(0, 5);
  });
  it("tỉ số trắng/đen = 21 : 1 (trần lý thuyết của WCAG)", () => {
    expect(tiSoTuongPhan([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 2);
  });
  it("tỉ số đối xứng và luôn ≥ 1", () => {
    expect(tiSoTuongPhan(MUC.warning, TRANG)).toBeCloseTo(tiSoTuongPhan(TRANG, MUC.warning), 6);
    expect(tiSoTuongPhan(MUC.info, MUC.info)).toBeCloseTo(1, 6);
  });
});

describe("★★★ ĐỐI CHỨNG — bản ghim `#fff` (bản TRƯỚC Đợt 57) TRƯỢT ở cả ba mức", () => {
  /*
   * Nếu khối này xanh (tức "#fff đạt") thì lưới ở dưới vô nghĩa: nó sẽ đạt bất kể
   * hàm chọn có làm gì. Đây là chỗ phép đo tự chứng minh nó biết kêu.
   */
  it.each(Object.entries(MUC))("trắng trên `--%s` KHÔNG đạt 4,5 : 1", (_ten, nen) => {
    expect(tiSoTuongPhan(nen, TRANG)).toBeLessThan(NGUONG_CHU_THUONG);
  });
});

describe("★★★ KẾT CỤC — màu chữ ĐƯỢC CHỌN đạt ngưỡng chữ thường ở cả ba mức", () => {
  it.each(Object.entries(MUC))("`--%s`: cặp chọn ra ≥ 4,5 : 1", (_ten, nen) => {
    const kq = chonByteTuongPhan(nen, [CHU_SANG, NEN_TOI]);
    expect(kq.tiSo).toBeGreaterThanOrEqual(NGUONG_CHU_THUONG);
  });

  it("`--destructive` (đỏ) chọn chữ SẪM — chính ca mà `--destructive-foreground` sáng làm hỏng", () => {
    const kq = chonByteTuongPhan(MUC.destructive, [CHU_SANG, NEN_TOI]);
    expect(kq.chon, "phải chọn ứng viên 1 = --background (sẫm)").toBe(1);
    expect(kq.tiSo).toBeGreaterThan(4.9);
    // …và chọn sáng thì thua: con số nói VÌ SAO, không chỉ nói CÁI GÌ.
    expect(tiSoTuongPhan(MUC.destructive, CHU_SANG)).toBeLessThan(NGUONG_CHU_THUONG);
  });

  it("`--warning` (hổ phách) và `--info` (xanh) cũng chọn chữ SẪM", () => {
    expect(chonByteTuongPhan(MUC.warning, [CHU_SANG, NEN_TOI]).chon).toBe(1);
    expect(chonByteTuongPhan(MUC.info, [CHU_SANG, NEN_TOI]).chon).toBe(1);
  });

  it("★ LẬT THEO THEME — trên một nền SẪM, phép chọn trả ứng viên SÁNG", () => {
    // Đây là ca theme sáng ở dạng thu nhỏ: nền badge sẫm ⇒ phải chọn chữ sáng.
    const nenSam: ByteMau = [120, 20, 20];
    expect(chonByteTuongPhan(nenSam, [CHU_SANG, NEN_TOI]).chon).toBe(0);
  });

  it("★ hàm chọn KHÔNG bao giờ trả cặp tệ hơn cả hai ứng viên", () => {
    for (const nen of Object.values(MUC)) {
      const kq = chonByteTuongPhan(nen, [CHU_SANG, NEN_TOI]);
      expect(kq.tiSo).toBe(Math.max(tiSoTuongPhan(nen, CHU_SANG), tiSoTuongPhan(nen, NEN_TOI)));
    }
  });
});
