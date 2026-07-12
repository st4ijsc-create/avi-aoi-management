/**
 * FE-W0.3 (doc 46 §2.3) — generation-guard tests.
 *
 * PURE (no DB, no model, no I/O):
 *  (a) detectDegenerate flags "cell cell cell…"×N, n-gram cycles, low-unique
 *      ratio, single-char runs, CJK walls, and abnormal length;
 *  (b) it does NOT flag normal prose / short repetitive-but-legit text;
 *  (c) guardGeneratedText salvages a clean head, else returns "" so the caller
 *      substitutes an honest fallback; the enable flag short-circuits it.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  detectDegenerate,
  guardGeneratedText,
  isDegenerateStream,
} from "./generationGuard";

const NORMAL_VI =
  "Báo cáo ngày: 1.240 sản phẩm được kiểm, tỷ lệ đạt (FPY) 96,3%, NG 3,7% có xu hướng giảm so với kỳ trước. " +
  "Lỗi phổ biến nhất là thiếu thiếc ở chân linh kiện, chiếm 42% số lỗi. Máy AVI-GB300-01 có rủi ro hỏng 58% (mức CAO), " +
  "khuyến nghị lên lịch bảo trì sớm. Tiếp tục theo dõi và so sánh với kỳ kế tiếp.";

const NORMAL_EN =
  "Executive summary: throughput 1240 units, first-pass yield 96.3 percent, NG rate 3.7 percent trending down. " +
  "The top defect is insufficient solder at component leads, accounting for 42 percent of failures. Machine " +
  "AVI-GB300-01 shows a 58 percent failure risk which is high, so schedule maintenance soon and keep monitoring.";

describe("detectDegenerate", () => {
  it("flags a single word repeated thousands of times ('cell cell cell…')", () => {
    const garbage = Array(1000).fill("cell").join(" ");
    const r = detectDegenerate(garbage);
    expect(r.degenerate).toBe(true);
    expect(r.reason).toMatch(/word_repeat/);
    expect(r.truncateAt).toBe(0); // loop starts at the very beginning
  });

  it("flags a mixed CN/EN degenerate loop", () => {
    const garbage = Array(400).fill("cell 单元 cell 单元").join(" ");
    expect(detectDegenerate(garbage).degenerate).toBe(true);
  });

  it("flags a 2-word n-gram cycling forever ('a b a b a b…')", () => {
    const garbage = Array(50).fill("foo bar").join(" ");
    const r = detectDegenerate(garbage);
    expect(r.degenerate).toBe(true);
    expect(r.reason).toMatch(/word_repeat|ngram/);
  });

  it("flags a 3-word n-gram cycle without single-word repeats", () => {
    const garbage = Array(30).fill("the quick brown").join(" ");
    expect(detectDegenerate(garbage).degenerate).toBe(true);
  });

  it("flags a long single-character run (aaaaaa…)", () => {
    const garbage = "The value is " + "a".repeat(200);
    const r = detectDegenerate(garbage);
    expect(r.degenerate).toBe(true);
    expect(r.reason).toMatch(/char_repeat/);
  });

  it("flags a space-less CJK repetition wall (的的的…)", () => {
    const garbage = "单".repeat(300);
    // Long identical-char run OR low CJK ratio — either way degenerate.
    expect(detectDegenerate(garbage).degenerate).toBe(true);
  });

  it("flags a low-unique-word-ratio churn (small vocab, many words)", () => {
    // 120 words drawn from a 3-word vocab, shuffled so there is no long
    // consecutive run but the unique ratio is ~3/120.
    const vocab = ["alpha", "beta", "gamma"];
    const words: string[] = [];
    for (let i = 0; i < 120; i++) words.push(vocab[i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2]);
    // Break consecutive runs by interleaving deterministically.
    const churn = words.map((_, i) => vocab[(i * 7) % 3]).join(" ");
    const r = detectDegenerate(churn);
    expect(r.degenerate).toBe(true);
    expect(r.reason).toMatch(/low_unique_ratio|ngram|word_repeat/);
  });

  it("flags abnormally long output regardless of shape", () => {
    // Distinct-ish words but way over the char ceiling.
    const long = Array(6000)
      .fill(0)
      .map((_, i) => `w${i}`)
      .join(" ");
    expect(long.length).toBeGreaterThan(20000);
    const r = detectDegenerate(long);
    expect(r.degenerate).toBe(true);
    expect(r.reason).toMatch(/length_exceeded/);
  });

  it("does NOT flag a normal Vietnamese executive summary", () => {
    expect(detectDegenerate(NORMAL_VI).degenerate).toBe(false);
  });

  it("does NOT flag a normal English executive summary", () => {
    expect(detectDegenerate(NORMAL_EN).degenerate).toBe(false);
  });

  it("does NOT flag short legit repetition ('yes yes')", () => {
    expect(detectDegenerate("Yes yes, that is correct.").degenerate).toBe(false);
  });

  it("does NOT flag a normal numbered list", () => {
    const list =
      "Các bước thực hiện:\n" +
      "1. Mở màn hình Lệnh sản xuất.\n" +
      "2. Chọn lô cần kiểm tra.\n" +
      "3. Nhấn nút Bắt đầu để chạy.\n" +
      "4. Theo dõi kết quả trên bảng điều khiển.";
    expect(detectDegenerate(list).degenerate).toBe(false);
  });

  it("does NOT flag empty / non-string input", () => {
    expect(detectDegenerate("").degenerate).toBe(false);
    // @ts-expect-error runtime-safety
    expect(detectDegenerate(null).degenerate).toBe(false);
  });
});

describe("guardGeneratedText", () => {
  it("returns the text unchanged when it is clean", () => {
    const r = guardGeneratedText(NORMAL_VI);
    expect(r.degraded).toBe(false);
    expect(r.text).toBe(NORMAL_VI);
  });

  it("returns '' for unsalvageable garbage (loop from the start)", () => {
    const garbage = Array(1000).fill("cell").join(" ");
    const r = guardGeneratedText(garbage);
    expect(r.degraded).toBe(true);
    expect(r.text).toBe("");
    expect(r.reason).toMatch(/word_repeat/);
  });

  it("salvages a clean head that precedes the loop", () => {
    const head =
      "Tóm tắt điều hành: sản lượng 1.240, FPY 96,3%, NG 3,7% giảm so với kỳ trước; lỗi hàng đầu là thiếu thiếc. ";
    const garbage = head + Array(1000).fill("cell").join(" ");
    const r = guardGeneratedText(garbage);
    expect(r.degraded).toBe(true);
    expect(r.text).toBe(head.trim());
    expect(r.text.length).toBeGreaterThanOrEqual(80);
  });

  it("honors AI_GEN_GUARD_ENABLED=false (returns text untouched)", () => {
    const prev = process.env.AI_GEN_GUARD_ENABLED;
    process.env.AI_GEN_GUARD_ENABLED = "false";
    try {
      const garbage = Array(1000).fill("cell").join(" ");
      const r = guardGeneratedText(garbage);
      expect(r.degraded).toBe(false);
      expect(r.text).toBe(garbage);
    } finally {
      if (prev === undefined) delete process.env.AI_GEN_GUARD_ENABLED;
      else process.env.AI_GEN_GUARD_ENABLED = prev;
    }
  });

  it("handles null/undefined input safely", () => {
    expect(guardGeneratedText(null).text).toBe("");
    expect(guardGeneratedText(undefined).degraded).toBe(false);
  });
});

describe("isDegenerateStream", () => {
  it("returns true once accumulated text has looped", () => {
    expect(isDegenerateStream(Array(1000).fill("cell").join(" "))).toBe(true);
  });
  it("returns false for a clean partial accumulation", () => {
    expect(isDegenerateStream("Tóm tắt điều hành: sản lượng 1.240 sản phẩm")).toBe(false);
  });
});

afterEach(() => {
  delete process.env.AI_GEN_GUARD_ENABLED;
});
