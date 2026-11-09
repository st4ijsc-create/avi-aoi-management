import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * CSP không 'unsafe-eval': zod phải KHÔNG gọi `new Function(...)` khi tạo/parse schema.
 * Đo hành vi thật (đếm lời gọi Function), không chỉ đọc nguồn; thêm một ghim chuỗi import ở điểm vào.
 */
describe("zodJitless — không thăm dò eval", () => {
  it("sau khi nạp zodJitless: tạo + parse schema object KHÔNG gọi Function()", async () => {
    vi.resetModules();
    const Goc = globalThis.Function;
    let dem = 0;
    globalThis.Function = new Proxy(Goc, {
      construct(t, args) {
        dem++;
        return Reflect.construct(t, args);
      },
    }) as FunctionConstructor;
    try {
      await import("./zodJitless");
      const { z } = await import("zod");
      const s = z.object({ a: z.string(), b: z.number().optional() });
      expect(s.safeParse({ a: "x" }).success).toBe(true);
      expect(s.safeParse({ a: 1 }).success).toBe(false);
      expect(dem).toBe(0);
    } finally {
      globalThis.Function = Goc;
    }
  });

  it("điểm vào: main.tsx import ./lib/zodJitless TRƯỚC mọi import khác", () => {
    const src = readFileSync(resolve(__dirname, "../main.tsx"), "utf8");
    const dong = src.split(/\r?\n/).filter(l => /^\s*import\b/.test(l));
    expect(dong[0]).toMatch(/^import\s+"\.\/lib\/zodJitless"/);
  });
});
