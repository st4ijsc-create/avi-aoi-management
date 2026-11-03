/**
 * Unit test cho client/src/lib/domains.ts — danh mục DOMAIN trang chủ.
 *
 * Kiểm tra:
 *  - DOMAINS có đúng 8 mục theo đúng thứ tự: production, quality, devices, robotics, twin, ai, analytics, governance
 *  - khoá (key) và href không trùng
 *  - mọi href bắt đầu bằng "/" và không có khoảng trắng
 *  - labelKey / blurbKey đúng dạng "domains.<key>.label" / "domains.<key>.blurb"
 *  - MỌI labelKey và blurbKey tồn tại và là chuỗi không rỗng trong CẢ BA tệp locale (vi, en, zh)
 *  - mỗi mục có icon
 *  - export mặc định là cùng mảng DOMAINS
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import DOMAINS, { DOMAINS as DOMAINS_EXPORT, type DomainTile } from "./domains";

/* ── helpers ─────────────────────────────────────────────────────────────── */

/**
 * Tra giá trị theo đường dẫn chấm (dotted path) trong object JSON đã parse.
 * vd: resolveDot({ a: { b: 1 } }, "a.b") → 1
 */
function resolveDot(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Nạp và parse một tệp JSON từ thư mục locales. */
function loadLocale(lang: "vi" | "en" | "zh"): Record<string, unknown> {
  const filePath = join(
    import.meta.dirname,
    "..",
    "i18n",
    "locales",
    `${lang}.json`,
  );
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

/* ── expected order ──────────────────────────────────────────────────────── */

const EXPECTED_KEYS = [
  "production",
  "quality",
  "devices",
  "robotics",
  "twin",
  "ai",
  "analytics",
  "governance",
];

/* ── tests ───────────────────────────────────────────────────────────────── */

describe("DOMAINS", () => {
  it("có đúng 8 mục", () => {
    expect(DOMAINS).toHaveLength(8);
  });

  it("theo đúng thứ tự khoá: production → quality → devices → robotics → twin → ai → analytics → governance", () => {
    const actualKeys = DOMAINS.map((d) => d.key);
    expect(actualKeys).toEqual(EXPECTED_KEYS);
  });

  it("mọi key không trùng nhau", () => {
    const keys = DOMAINS.map((d) => d.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("mọi href không trùng nhau", () => {
    const hrefs = DOMAINS.map((d) => d.href);
    const unique = new Set(hrefs);
    expect(unique.size).toBe(hrefs.length);
  });

  it("mọi href bắt đầu bằng '/' và không chứa khoảng trắng", () => {
    for (const d of DOMAINS) {
      expect(d.href.startsWith("/")).toBe(true);
      expect(d.href).not.toMatch(/\s/);
    }
  });

  it("labelKey đúng dạng 'domains.<key>.label'", () => {
    for (const d of DOMAINS) {
      const expected = `domains.${d.key}.label`;
      expect(d.labelKey).toBe(expected);
    }
  });

  it("blurbKey đúng dạng 'domains.<key>.blurb'", () => {
    for (const d of DOMAINS) {
      const expected = `domains.${d.key}.blurb`;
      expect(d.blurbKey).toBe(expected);
    }
  });

  it("mọi labelKey và blurbKey tồn tại và là chuỗi không rỗng trong cả ba locale (vi, en, zh)", () => {
    const langs: Array<"vi" | "en" | "zh"> = ["vi", "en", "zh"];
    const locales = new Map<string, Record<string, unknown>>();
    for (const lang of langs) {
      locales.set(lang, loadLocale(lang));
    }

    for (const d of DOMAINS) {
      for (const lang of langs) {
        const loc = locales.get(lang)!;

        // labelKey
        const labelVal = resolveDot(loc, d.labelKey);
        expect(labelVal, `labelKey "${d.labelKey}" trong ${lang}.json`).toBeDefined();
        expect(typeof labelVal, `labelKey "${d.labelKey}" trong ${lang}.json`).toBe("string");
        expect((labelVal as string).length).toBeGreaterThan(0);

        // blurbKey
        const blurbVal = resolveDot(loc, d.blurbKey);
        expect(blurbVal, `blurbKey "${d.blurbKey}" trong ${lang}.json`).toBeDefined();
        expect(typeof blurbVal, `blurbKey "${d.blurbKey}" trong ${lang}.json`).toBe("string");
        expect((blurbVal as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("mỗi mục có icon (khác undefined/null)", () => {
    for (const d of DOMAINS) {
      expect(d.icon).toBeDefined();
      expect(d.icon).not.toBeNull();
    }
  });

  it("export mặc định là cùng mảng DOMAINS", () => {
    expect(DOMAINS_EXPORT).toBe(DOMAINS);
    expect(DOMAINS).toBe(DOMAINS_EXPORT);
    // export default phải là cùng tham chiếu
    expect(DOMAINS).toBe(DOMAINS);
  });
});
