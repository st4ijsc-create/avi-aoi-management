/**
 * ★★★ W23 (kiểm định 2026-10-25) — CENSUS "mọi khoá lá có ở CẢ BA ngôn ngữ vi/en/zh".
 * Lỗ cũ: `scripts/i18n-check.mjs` chỉ lượng từ trên khoá được MÃ tham chiếu viết LITERAL; khoá dựng ĐỘNG (`t(\`errors.reason.${x}\`)`, `errors.entity.*`, `flowStudio.hang.*`…) nằm NGOÀI nó,
 * và một khoá bị xoá khỏi `zh.json` chỉ bị bắt TÌNH CỜ (appErrorParamsCoverage). Đo 2026-10-25: 54 khoá lá chỉ có ở 1/3 ngôn ngữ (home.* chỉ zh; backup/mqtt.* chỉ en; số nhiều twin3d chỉ en) — đã bổ sung.
 * Luật: tập khoá (sau khi quy các hậu tố số nhiều i18next `_zero|_one|_two|_few|_many|_other` về khoá gốc) của vi = en = zh, TOÀN CÂY — không nợ, không ghim: khoá thêm ở một ngôn ngữ mà quên hai ngôn ngữ kia ⇒ ĐỎ tại đây.
 * Số nhiều: en có `x_one/x_other`, vi/zh chỉ cần `x_other` (hoặc `x`) — cùng khoá gốc `x` là đủ.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LOCALES = ["vi", "en", "zh"] as const;
type Cay = { [k: string]: Cay | string | number | boolean | null | unknown[] };
const cay = (l: string): Cay => JSON.parse(readFileSync(new URL(`./locales/${l}.json`, import.meta.url), "utf8")) as Cay;

const RE_SO_NHIEU = /_(zero|one|two|few|many|other)$/;

/** Tập khoá lá đã quy về khoá gốc (bỏ hậu tố số nhiều). */
export function khoaLa(o: Cay, tienTo = "", ra = new Set<string>()): Set<string> {
  for (const [k, v] of Object.entries(o)) {
    const q = tienTo ? `${tienTo}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) khoaLa(v as Cay, q, ra);
    else ra.add(q.replace(RE_SO_NHIEU, ""));
  }
  return ra;
}

/** Khoá có ở ít nhất một ngôn ngữ nhưng vắng ở ngôn ngữ khác: `khoá → [ngôn ngữ có]`. */
export function khoaLech(tap: Record<string, Set<string>>): Record<string, string[]> {
  const tatCa = new Set(Object.values(tap).flatMap((s) => [...s]));
  const ra: Record<string, string[]> = {};
  for (const k of tatCa) {
    const co = Object.keys(tap).filter((l) => tap[l]!.has(k));
    if (co.length !== Object.keys(tap).length) ra[k] = co;
  }
  return ra;
}

describe("khoá i18n vi = en = zh (toàn cây, gồm nhánh ĐỘNG errors.*, flowStudio.*, …)", () => {
  const tap = Object.fromEntries(LOCALES.map((l) => [l, khoaLa(cay(l))])) as Record<(typeof LOCALES)[number], Set<string>>;

  it("★ không khoá lá nào vắng ở một ngôn ngữ", () => {
    const lech = khoaLech(tap);
    const mau = Object.entries(lech).slice(0, 30).map(([k, co]) => `${k} [chỉ có: ${co.join(",")}]`);
    expect(mau, `${Object.keys(lech).length} khoá lệch giữa vi/en/zh (thêm bản dịch cho ngôn ngữ còn thiếu)`).toEqual([]);
  });

  it("cầu chì: cây đủ lớn và nhánh errors.* (không gian khoá của appError) có ở cả ba", () => {
    for (const l of LOCALES) expect(tap[l].size, l).toBeGreaterThan(15000);
    for (const l of LOCALES) expect([...tap[l]].filter((k) => k.startsWith("errors.")).length, `errors.* ${l}`).toBeGreaterThan(500);
    for (const pre of ["errors.reason.", "errors.entity.", "errors.operation.", "errors.field."]) {
      for (const l of LOCALES) expect([...tap[l]].some((k) => k.startsWith(pre)), `${pre} ở ${l}`).toBe(true);
    }
  });

  it("★ các tiền tố khoá ĐỘNG mà mã dựng bằng t(`prefix.${…}`) đều là nhánh có thật và đủ ba ngôn ngữ", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const goc = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const tienTo = new Set<string>();
    const duyet = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) duyet(p);
        else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) {
          const s = readFileSync(p, "utf8");
          for (const m of s.matchAll(/\bt\(\s*`([A-Za-z0-9_.]+)\.\$\{/g)) tienTo.add(m[1]!);
        }
      }
    };
    duyet(goc);
    expect(tienTo.size, "tìm được tiền tố động trong mã client").toBeGreaterThan(20);
    const lech = khoaLech(tap);
    const rotNhanh: string[] = [];
    for (const pre of tienTo) {
      const coNhanh = LOCALES.map((l) => [...tap[l]].some((k) => k === pre || k.startsWith(`${pre}.`)));
      if (coNhanh.some(Boolean) && !coNhanh.every(Boolean)) rotNhanh.push(`${pre} [vi,en,zh]=${coNhanh.join(",")}`);
      for (const k of Object.keys(lech)) if (k === pre || k.startsWith(`${pre}.`)) rotNhanh.push(`${k}`);
    }
    expect(rotNhanh).toEqual([]);
  });

  it("vị từ không mù: xoá một khoá khỏi zh / thêm khoá chỉ ở en ⇒ bị báo; số nhiều en-only-gốc có đủ vi/zh ⇒ không báo", () => {
    const vi = khoaLa({ a: { b: "x", c: "y" }, n_other: "n" } as Cay);
    const en = khoaLa({ a: { b: "x", c: "y", d: "z" }, n_one: "1", n_other: "n" } as Cay);
    const zh = khoaLa({ a: { b: "x" }, n_other: "n" } as Cay);
    expect(khoaLech({ vi, en, zh })).toEqual({ "a.c": ["vi", "en"], "a.d": ["en"] });
    expect(khoaLech({ vi: khoaLa({ q: "1" } as Cay), en: khoaLa({ q_one: "1", q_other: "2" } as Cay), zh: khoaLa({ q_other: "3" } as Cay) })).toEqual({});
    expect(khoaLech({ vi: khoaLa({ q: "1" } as Cay), en: khoaLa({ q: { r: "2" } } as Cay), zh: khoaLa({ q: "3" } as Cay) })).toEqual({ q: ["vi", "zh"], "q.r": ["en"] });
  });
});
