import { describe, it, expect } from "vitest";
import { tinhDongTong } from "./scheduledReportService";
import { finalYield } from "../utils/kpi";

describe("tinhDongTong — dòng TỔNG phải cùng công thức với các dòng chi tiết", () => {
  const rows = [
    { total: 100, ok: 90, ntf: 5 },
    { total: 200, ok: 150, ntf: 40 },
    { total: 50, ok: 10, ntf: 0 },
  ];

  it("tổng số cộng đúng", () => {
    const t = tinhDongTong(rows);
    expect(t.total).toBe(350);
    expect(t.ok).toBe(250);
    expect(t.ntf).toBe(45);
  });

  it("BẤT BIẾN: yield của dòng tổng == finalYield trên tổng đã cộng", () => {
    const t = tinhDongTong(rows);
    expect(t.yieldRate).toBeCloseTo(finalYield({ ok: 250, ntf: 45, total: 350 }), 6);
  });

  it("BẤT BIẾN: khi mọi dòng chi tiết cùng yield thì dòng tổng cũng bằng đúng yield đó", () => {
    const dong = [
      { total: 100, ok: 80, ntf: 10 },
      { total: 200, ok: 160, ntf: 20 },
    ];
    const t = tinhDongTong(dong);
    expect(t.yieldRate).toBeCloseTo(90, 6);
  });

  it("NTF không bị rơi khỏi dòng tổng: 0 OK + 30 NTF trên 30 ⇒ 100", () => {
    expect(tinhDongTong([{ total: 30, ok: 0, ntf: 30 }]).yieldRate).toBeCloseTo(100, 6);
  });

  it("không có dòng nào ⇒ 0, không NaN", () => {
    const t = tinhDongTong([]);
    expect(t.yieldRate).toBe(0);
    expect(Number.isNaN(t.yieldRate)).toBe(false);
  });
});
