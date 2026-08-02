import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** Cổng chống DRIFT: bench.mjs đã sai 3 lần vì tự dựng context khác đường sản
 *  xuất. Test này không đo VRAM — nó khẳng định bench KHÔNG còn hard-code tham
 *  số context riêng, mà lấy từ cùng nguồn với sản xuất. */
describe("bench.mjs — khớp đường sản xuất", () => {
  const src = readFileSync("scripts/ai-bench/bench.mjs", "utf8");

  it("KHÔNG còn hard-code contextSize 'auto' cho embedding", () => {
    expect(src).not.toMatch(/createEmbeddingContext\(\{\s*contextSize:\s*"auto"/);
  });

  it("KHÔNG còn tạo context text mà bỏ qua sequences", () => {
    const m = src.match(/model\.createContext\(\{[^}]*\}\)/s);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/sequences/);
  });
});
