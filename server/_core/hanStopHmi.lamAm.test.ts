/**
 * SCADA R1b-2b-1 Task 9 (mục 46) — STOP HMI không trả giá import LẠNH.
 *
 * Request STOP (`scadaCommands.dungMay`) đi qua middleware ở `trpc.ts` / `moduleGate.ts` / `context.ts`; các tệp đó `await import("…")` module
 * lớn (vd. `../db`) lần đầu cần tới. Lần import đầu nằm TRONG hạn tổng `HAN_TONG_STOP_HMI_MS` ⇒ `index.ts` làm ấm danh sách
 * `MODULE_DUONG_STOP_HMI` ngay sau `listen`. Lưới này:
 *   1. quét ba tệp (bỏ chú thích): MỌI `import("<spec>")` ⇒ spec ∈ danh sách (cùng thư mục ⇒ cùng chuỗi). Cầu chì: mỗi tệp đọc được > 500 ký
 *      tự (đường dẫn sai / tệp rỗng ⇒ đỏ, không xanh giả "0 import"); và tổng số import động tìm thấy > 0.
 *   2. `lamAmDuongStopHmi()` THẬT ⇒ nạp được mọi module, `loi` rỗng.
 *   3. một loader ném (đồng bộ hoặc bất đồng bộ) ⇒ tên nó trong `loi`, hàm không ném.
 *   4. `index.ts` gọi nó trong `onListening` (sau listen), `void`, có log.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lamAmDuongStopHmi, MODULE_DUONG_STOP_HMI } from "./hanStopHmi";

const GOC = resolve(__dirname, "..", "..");
const TEP_QUET = ["server/_core/trpc.ts", "server/_core/moduleGate.ts", "server/_core/context.ts"] as const;

/** Bỏ chú thích khối + dòng (giữ chuỗi: `//` trong chuỗi "http://…" không phải chú thích). Đủ cho ba tệp TS này. */
function boChuThich(src: string): string {
  let ra = "";
  let i = 0;
  let chuoi: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (chuoi) {
      ra += c;
      if (c === "\\") {
        ra += n ?? "";
        i += 2;
        continue;
      }
      if (c === chuoi) chuoi = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      chuoi = c;
      ra += c;
      i += 1;
      continue;
    }
    if (c === "/" && n === "*") {
      const j = src.indexOf("*/", i + 2);
      i = j < 0 ? src.length : j + 2;
      continue;
    }
    if (c === "/" && n === "/") {
      const j = src.indexOf("\n", i + 2);
      i = j < 0 ? src.length : j;
      continue;
    }
    ra += c;
    i += 1;
  }
  return ra;
}

/**
 * Fix round 1 (M2) — mọi dạng import ĐỘNG: nháy kép / đơn / backtick (không nội suy), nhiều dòng (`import(\n  "x"\n)` của Prettier).
 * Cầu chì: đếm MỌI `import(` (sau khi bỏ chú thích) và đòi bằng số spec đọc được — dạng không phân tích được (spec là biến / nội suy) ⇒ ĐỎ,
 * không lọt im.
 */
const RE_SPEC = /\bimport\s*\(\s*(["'`])([^"'`$]+)\1\s*\)/g;
const RE_GOI = /\bimport\s*\(/g;
function quetImportDong(src: string): { specs: string[]; soGoi: number } {
  const ma = boChuThich(src);
  return { specs: [...ma.matchAll(RE_SPEC)].map((m) => m[2]), soGoi: [...ma.matchAll(RE_GOI)].length };
}

describe("R1b-2b-1 T9 — MODULE_DUONG_STOP_HMI phủ mọi import động của trpc / moduleGate / context", () => {
  it("quét ba tệp (bỏ chú thích): mọi import(\"…\") ⇒ có trong danh sách", () => {
    const ds = new Set(MODULE_DUONG_STOP_HMI.map(([s]) => s));
    let tong = 0;
    const thieu: string[] = [];
    for (const tep of TEP_QUET) {
      const src = readFileSync(resolve(GOC, tep), "utf8");
      expect(src.length, `cầu chì: ${tep} đọc được`).toBeGreaterThan(500);
      const { specs, soGoi } = quetImportDong(src);
      expect(specs.length, `cầu chì: ${tep} — mọi import( đều đọc được spec`).toBe(soGoi);
      for (const sp of specs) {
        tong += 1;
        if (!ds.has(sp)) thieu.push(`${tep}: import("${sp}")`);
      }
    }
    expect(tong, "cầu chì: tìm thấy ít nhất một import động").toBeGreaterThan(0);
    expect(thieu).toEqual([]);
  });

  it("cầu chì của bộ quét: chú thích bỏ; nháy kép / đơn / backtick / nhiều dòng đọc được; spec động ⇒ lệch đếm (đỏ ở ca quét)", () => {
    const src = [
      `// import("../a")`,
      `/* import("../b") */`,
      `const u = "http://x"; await import("../c");`,
      `await import('../d');`,
      "await import(`../e`);",
      `await import(\n  "../f"\n);`,
    ].join("\n");
    expect(quetImportDong(src)).toEqual({ specs: ["../c", "../d", "../e", "../f"], soGoi: 4 });
    const dong = quetImportDong("const x = '../g'; await import(x); await import(`../${x}`);");
    expect(dong.specs).toEqual([]);
    expect(dong.soGoi).toBe(2);
  });

  it("danh sách không trùng spec", () => {
    const specs = MODULE_DUONG_STOP_HMI.map(([s]) => s);
    expect(new Set(specs).size).toBe(specs.length);
  });
});

describe("R1b-2b-1 T9 — lamAmDuongStopHmi", () => {
  it("THẬT: nạp mọi module ⇒ ok = độ dài danh sách, loi rỗng", async () => {
    const kq = await lamAmDuongStopHmi();
    expect(kq).toEqual({ ok: MODULE_DUONG_STOP_HMI.length, loi: [] });
  }, 60_000);

  it("một loader ném (bất đồng bộ / đồng bộ) ⇒ tên nó trong loi; hàm KHÔNG ném; loader khác vẫn được gọi", async () => {
    const goi: string[] = [];
    const kq = await lamAmDuongStopHmi([
      ["a", async () => void goi.push("a")],
      ["hong-async", async () => Promise.reject(new Error("import lỗi giả"))],
      [
        "hong-dong-bo",
        () => {
          throw new Error("ném đồng bộ giả");
        },
      ],
      ["b", async () => void goi.push("b")],
    ]);
    expect(kq).toEqual({ ok: 2, loi: ["hong-async", "hong-dong-bo"] });
    expect(goi.sort()).toEqual(["a", "b"]);
  });
});

describe("R1b-2b-1 T9 — index.ts làm ấm ngay sau listen", () => {
  it("onListening gọi `void lamAmDuongStopHmi().then(…logger…)`", () => {
    const src = boChuThich(readFileSync(resolve(GOC, "server/_core/index.ts"), "utf8"));
    expect(src).toMatch(/import \{ lamAmDuongStopHmi \} from "\.\/hanStopHmi";/);
    const i = src.indexOf("const onListening = () => {");
    expect(i, "cầu chì: tìm thấy onListening").toBeGreaterThan(0);
    const than = src.slice(i, src.indexOf("\n  };", i));
    expect(than).toMatch(/void lamAmDuongStopHmi\(\)\.then\(\(\{ ok, loi \}\) => \{[\s\S]*logger\.(warn|info)/);
  });
});
