import { describe, it, expect } from "vitest";
import { chotLuot, ghiChu, ghiNghi, taoDongHo, tocDoHaiPha } from "./dongHoHaiPha";

describe("dongHoHaiPha — F2 tok/s nghĩ vs sinh", () => {
  it("đo hai khoảng từ mảnh đầu tới mảnh cuối của mỗi pha, rồi xoá cho lượt kế", () => {
    const d = taoDongHo();
    ghiNghi(d, 1000); ghiNghi(d, 3000); ghiNghi(d, 6000);
    ghiChu(d, 6500); ghiChu(d, 8500);
    expect(chotLuot(d)).toEqual({ msNghi: 5000, msSinh: 2000 });
    expect(chotLuot(d)).toEqual({});
  });
  it("★ không biết ≠ 0: pha không có sự kiện hoặc < 200 ms ⇒ vắng, không phải 0", () => {
    const d = taoDongHo();
    ghiNghi(d, 1000);
    ghiChu(d, 2000); ghiChu(d, 2100);
    expect(chotLuot(d)).toEqual({});
  });
  it("tốc độ: nghĩ = token nghĩ / ms nghĩ; sinh = (ra − nghĩ) / ms sinh", () => {
    expect(tocDoHaiPha({ tokensOut: 1200, tokensReasoning: 1000, msNghi: 5000, msSinh: 2000 })).toEqual({ tokNghi: 200, tokSinh: 100 });
  });
  it("★ thiếu số nghĩ ⇒ không tách được (sinh không được giả là toàn bộ ra)", () => {
    expect(tocDoHaiPha({ tokensOut: 1200, msNghi: 5000, msSinh: 2000 })).toEqual({ tokNghi: null, tokSinh: null });
  });
  it("thiếu khoảng đo ⇒ null đúng pha đó", () => {
    expect(tocDoHaiPha({ tokensOut: 1200, tokensReasoning: 1000, msSinh: 2000 })).toEqual({ tokNghi: null, tokSinh: 100 });
  });
});
