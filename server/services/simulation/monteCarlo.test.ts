/**
 * Monte-Carlo replication tests — SYNAPSE §5.7.3 (doc 33 §3.6 / H6).
 *
 * Kiểm tra mulberry32 (PRNG tất định) và monteCarlo (aggregation KPI + CI 95 %).
 * Mỗi khẳng định là giá trị tính tay hoặc suy ra từ định nghĩa, không chép mã.
 */
import { describe, it, expect } from "vitest";

import { mulberry32, monteCarlo } from "./monteCarlo";

/* ------------------------------------------------------------------ */
/*  mulberry32                                                          */
/* ------------------------------------------------------------------ */

describe("mulberry32", () => {
  it("trả về hàm sinh số trong khoảng [0, 1)", () => {
    const rng = mulberry32(42);
    for (let j = 0; j < 100; j++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("tái lập chính xác: cùng seed → cùng chuỗi giá trị", () => {
    const a = mulberry32(777);
    const b = mulberry32(777);
    for (let j = 0; j < 50; j++) {
      expect(a()).toBe(b());
    }
  });

  it("seed khác → chuỗi giá trị khác", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    // Giá trị đầu tiên khác nhau
    expect(a()).not.toBe(b());
    // Các giá trị tiếp theo cũng khác
    expect(a()).not.toBe(b());
    expect(a()).not.toBe(b());
  });
});

/* ------------------------------------------------------------------ */
/*  monteCarlo — sample hằng                                            */
/* ------------------------------------------------------------------ */

describe("monteCarlo — sample hằng", () => {
  it("std = 0, ci95.halfWidth = 0, mean = giá trị hằng", () => {
    const r = monteCarlo(() => 5, 50);
    expect(r.mean).toBe(5);
    expect(r.std).toBe(0);
    expect(r.ci95.halfWidth).toBe(0);
  });

  it("min = max = mean = giá trị hằng", () => {
    const r = monteCarlo(() => 42, 20);
    expect(r.min).toBe(42);
    expect(r.max).toBe(42);
    expect(r.mean).toBe(42);
  });
});

/* ------------------------------------------------------------------ */
/*  monteCarlo — sample biến thiên                                      */
/* ------------------------------------------------------------------ */

describe("monteCarlo — sample biến thiên", () => {
  it("ci95.low < mean < ci95.high", () => {
    const r = monteCarlo((rng) => 100 + rng() * 20, 100, 999);
    expect(r.ci95.low).toBeLessThan(r.mean);
    expect(r.ci95.high).toBeGreaterThan(r.mean);
  });

  it("tái lập: cùng seed → cùng mean, std, ci95", () => {
    const r1 = monteCarlo((rng) => rng() * 50 + 10, 60, 54321);
    const r2 = monteCarlo((rng) => rng() * 50 + 10, 60, 54321);
    expect(r1.mean).toBe(r2.mean);
    expect(r1.std).toBe(r2.std);
    expect(r1.ci95.low).toBe(r2.ci95.low);
    expect(r1.ci95.high).toBe(r2.ci95.high);
  });
});

/* ------------------------------------------------------------------ */
/*  monteCarlo — biên của n                                             */
/* ------------------------------------------------------------------ */

describe("monteCarlo — biên n", () => {
  it("n < 1 → n bị kẹp thành 1", () => {
    const r = monteCarlo(() => 1, -5);
    expect(r.n).toBe(1);
  });

  it("n = 0 → n bị kẹp thành 1", () => {
    const r = monteCarlo(() => 1, 0);
    expect(r.n).toBe(1);
  });

  it("n = 1 → std = 0, ci95.halfWidth = 0", () => {
    const r = monteCarlo((rng) => rng() * 10, 1, 111);
    expect(r.n).toBe(1);
    expect(r.std).toBe(0);
    expect(r.ci95.halfWidth).toBe(0);
  });

  it("n không nguyên bị làm tròn xuống: n = 2,5 → n = 2", () => {
    const r = monteCarlo(() => 1, 2.5);
    expect(r.n).toBe(2);
  });

  it("n = 2,5 → sample được gọi 2 lần", () => {
    let count = 0;
    monteCarlo(() => {
      count++;
      return 1;
    }, 2.5);
    expect(count).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  monteCarlo — bất đẳng thức p5, p95, mean                            */
/* ------------------------------------------------------------------ */

describe("monteCarlo — bất đẳng thức phân vị", () => {
  it("min ≤ p5 ≤ p95 ≤ max", () => {
    const r = monteCarlo((rng) => Math.floor(rng() * 100), 50, 777);
    expect(r.min).toBeLessThanOrEqual(r.p5);
    expect(r.p5).toBeLessThanOrEqual(r.p95);
    expect(r.p95).toBeLessThanOrEqual(r.max);
  });

  it("min ≤ mean ≤ max", () => {
    const r = monteCarlo((rng) => rng() * 200 - 50, 80, 333);
    expect(r.min).toBeLessThanOrEqual(r.mean);
    expect(r.mean).toBeLessThanOrEqual(r.max);
  });
});

/* ------------------------------------------------------------------ */
/*  monteCarlo — ci95 low/high = mean ± halfWidth                       */
/* ------------------------------------------------------------------ */

describe("monteCarlo — ci95 bounds", () => {
  it("ci95.low = mean − halfWidth và ci95.high = mean + halfWidth", () => {
    const r = monteCarlo((rng) => rng() * 10, 40, 2024);
    expect(r.ci95.low).toBeCloseTo(r.mean - r.ci95.halfWidth, 10);
    expect(r.ci95.high).toBeCloseTo(r.mean + r.ci95.halfWidth, 10);
  });
});

/* ------------------------------------------------------------------ */
/*  monteCarlo — tính tay với sample(i) = i + 1, N = 10                 */
/* ------------------------------------------------------------------ */

describe("monteCarlo — tính tay sample(i) = i + 1, N = 10", () => {
  it("mean = 5.5", () => {
    const r = monteCarlo((rng, i) => i + 1, 10, 12345);
    // Values: [1,2,3,4,5,6,7,8,9,10] → mean = 55/10 = 5.5
    expect(r.mean).toBe(5.5);
  });

  it("std = √(82.5/9) ≈ 3.02765", () => {
    const r = monteCarlo((rng, i) => i + 1, 10, 12345);
    // Σ(xi - 5.5)² = 82.5, variance = 82.5/9, std = √(82.5/9)
    const expectedStd = Math.sqrt(82.5 / 9);
    expect(r.std).toBeCloseTo(expectedStd, 10);
  });

  it("p5 = 1, p95 = 10", () => {
    const r = monteCarlo((rng, i) => i + 1, 10, 12345);
    // sorted = [1..10], p5 → idx = round(0.05*9) = 0 → 1
    // p95 → idx = round(0.95*9) = round(8.55) = 9 → 10
    expect(r.p5).toBe(1);
    expect(r.p95).toBe(10);
  });

  it("halfWidth = 1.96 * std / √10", () => {
    const r = monteCarlo((rng, i) => i + 1, 10, 12345);
    const expectedStd = Math.sqrt(82.5 / 9);
    const expectedHW = (1.96 * expectedStd) / Math.sqrt(10);
    expect(r.ci95.halfWidth).toBeCloseTo(expectedHW, 10);
  });

  it("min = 1, max = 10", () => {
    const r = monteCarlo((rng, i) => i + 1, 10, 12345);
    expect(r.min).toBe(1);
    expect(r.max).toBe(10);
  });
});

/* ------------------------------------------------------------------ */
/*  monteCarlo — sample nhận i đúng thứ tự 0..N−1                       */
/* ------------------------------------------------------------------ */

describe("monteCarlo — thứ tự i và PRNG riêng", () => {
  it("sample nhận i đúng thứ tự 0..N−1", () => {
    const indices: number[] = [];
    monteCarlo((rng, i) => {
      indices.push(i);
      return i;
    }, 5, 999);
    expect(indices).toEqual([0, 1, 2, 3, 4]);
  });

  it("mỗi lượt có PRNG riêng: giá trị rng() đầu tiên khác nhau", () => {
    const firstValues: number[] = [];
    monteCarlo((rng) => {
      firstValues.push(rng());
      return 0;
    }, 5, 42);
    // Các seed khác nhau (seed + i * 2654435761) → giá trị đầu tiên khác nhau
    expect(firstValues[0]).not.toBe(firstValues[1]);
    expect(firstValues[1]).not.toBe(firstValues[2]);
    expect(firstValues[2]).not.toBe(firstValues[3]);
    expect(firstValues[3]).not.toBe(firstValues[4]);
  });

  it("bỏ trống n và seed → kết quả bằng gọi tường minh (30, 12345)", () => {
    const rDefault = monteCarlo((rng, i) => rng() * 10 + i);
    const rExplicit = monteCarlo((rng, i) => rng() * 10 + i, 30, 12345);
    expect(rDefault.mean).toBe(rExplicit.mean);
    expect(rDefault.std).toBe(rExplicit.std);
    expect(rDefault.n).toBe(30);
  });
});
