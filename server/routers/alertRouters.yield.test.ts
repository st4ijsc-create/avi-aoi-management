import { describe, it, expect } from "vitest";
import { tinhYieldCanhBao } from "./alertRouters";

describe("tinhYieldCanhBao — ngưỡng cảnh báo phải tính NTF là PASS", () => {
  it("KHÔNG báo động giả: 85 OK + 10 NTF / 100 ⇒ 95, không phải 85", () => {
    expect(tinhYieldCanhBao({ total: 100, ok: 85, ntf: 10 })).toBeCloseTo(95, 6);
  });

  it("vẫn thấp thật thì vẫn thấp: 70 OK + 5 NTF / 100 ⇒ 75", () => {
    expect(tinhYieldCanhBao({ total: 100, ok: 70, ntf: 5 })).toBeCloseTo(75, 6);
  });

  it("toàn NTF: 0 OK + 30 NTF / 30 ⇒ 100", () => {
    expect(tinhYieldCanhBao({ total: 30, ok: 0, ntf: 30 })).toBeCloseTo(100, 6);
  });

  it("KHÔNG có bo nào ⇒ 100 (máy dừng ≠ máy hỏng), giữ nguyên hành vi cũ", () => {
    expect(tinhYieldCanhBao({ total: 0, ok: 0, ntf: 0 })).toBe(100);
  });

  it("không NaN khi total = 0", () => {
    expect(Number.isNaN(tinhYieldCanhBao({ total: 0, ok: 0, ntf: 0 }))).toBe(false);
  });
});
