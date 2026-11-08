/**
 * Dọn vệ sinh Q0-2 — `fpyPctOver` / `fpyPctByBucket` (FPY thật theo serial) thay cho "FPY proxy" ok/total.
 * Không DB: `database.execute` là bản giả trả đúng hình dạng hàng của `fpyAggregateSql`.
 */
import { describe, it, expect } from "vitest";
import { fpyPctOver, fpyPctByBucket, khoaBucket } from "./kpi";

const gia = (rows: unknown[]) => ({ execute: async () => rows });

describe("fpyPctOver — first-pass THẬT (kiểm tra đầu tiên của mỗi serial)", () => {
  it("first_pass / first_total × 100; NTF KHÔNG là first-pass (bên SQL: result = 'OK')", async () => {
    expect(await fpyPctOver(gia([{ first_total: 200, first_pass: 150 }]), undefined)).toBe(75);
  });
  it("không có serial dùng được (first_total=0) ⇒ 0, không NaN", async () => {
    expect(await fpyPctOver(gia([{ first_total: 0, first_pass: 0 }]), undefined)).toBe(0);
    expect(await fpyPctOver(gia([]), undefined)).toBe(0);
  });
  it("hàng DB trả chuỗi số (bigint → string) vẫn đúng", async () => {
    expect(await fpyPctOver(gia([{ first_total: "4", first_pass: "3" }]), undefined)).toBe(75);
  });
});

describe("fpyPctByBucket — khoá bucket khớp giữa hai truy vấn", () => {
  it("khoaBucket: cùng một thời điểm ở dạng Date / ISO / số ⇒ cùng khoá", () => {
    const d = new Date("2026-11-04T00:00:00.000Z");
    expect(khoaBucket(d)).toBe(khoaBucket(d.toISOString()));
    expect(khoaBucket(d)).toBe(khoaBucket(d.getTime()));
    expect(khoaBucket("khong-phai-thoi-gian")).toBe("khong-phai-thoi-gian");
  });
  it("Map<khoá, FPY%> theo từng kỳ", async () => {
    const k1 = new Date("2026-11-03T00:00:00.000Z");
    const k2 = new Date("2026-11-04T00:00:00.000Z");
    const m = await fpyPctByBucket(gia([
      { bucket: k1, first_total: 10, first_pass: 9 },
      { bucket: k2, first_total: 4, first_pass: 1 },
    ]), undefined, undefined as never);
    expect(m.get(khoaBucket(k1))).toBe(90);
    expect(m.get(khoaBucket(k2))).toBe(25);
    expect(m.get(khoaBucket(new Date("2026-11-05T00:00:00.000Z")))).toBeUndefined();
  });
});
