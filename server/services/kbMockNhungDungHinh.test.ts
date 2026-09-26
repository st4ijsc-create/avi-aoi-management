/**
 * ★ PDCA §15 (2026-09-24) — mock `generateEmbedding` TRẢ GIÁ TRỊ thì giá trị phải ĐÚNG HÌNH `{ embedding: number[] }`.
 *
 * `embedQuestionGguf` đọc `const { embedding } = await generateEmbedding(…)`. 8 tệp lưới từng mock trả MẢNG trơn
 * (`mockResolvedValue(unit(0))`) ⇒ `embedding` undefined ⇒ vector câu hỏi null ⇒ cosine = 0 IM LẶNG ⇒ các lưới đó chỉ đo
 * được từ khoá, trong khi chú thích của chúng nói "trùng hướng ⇒ tin cậy cao" / "trực giao ⇒ không liên quan". Một ca đối
 * chứng (vscodeRouteGate §F) chỉ xanh NHỜ lỗi này. Lưới này quét mã nguồn lưới — rẻ, không cần chạy từng tệp.
 *
 * Ngoài luật: `vi.fn()` trơn (trả undefined — cố ý "không có vector", đường chỉ-từ-khoá) và thân KHỐI `{ … }` (ném lỗi).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function tepLuoi(thuMuc: string): string[] {
  const ra: string[] = [];
  for (const f of readdirSync(thuMuc)) {
    const p = path.join(thuMuc, f);
    if (statSync(p).isDirectory()) ra.push(...tepLuoi(p));
    else if (/\.test\.ts$/.test(f)) ra.push(p);
  }
  return ra;
}

const RESOLVED = /generateEmbedding\.mockResolvedValue(?:Once)?\(\s*/g;
const MUI_TEN = /generateEmbedding(?:\.mockImplementation(?:Once)?\(|\s*:\s*vi\.fn\()\s*async\s*\([^)]*\)\s*=>\s*/g;

/** Mỗi chỗ mock TRẢ MỘT GIÁ TRỊ: vị trí + 240 ký tự đầu của giá trị ấy. */
export function giaTriTraVe(ma: string): { vt: number; x: string }[] {
  const ra: { vt: number; x: string }[] = [];
  for (const re of [RESOLVED, MUI_TEN]) {
    for (const m of ma.matchAll(re)) {
      const dau = (m.index ?? 0) + m[0].length;
      ra.push({ vt: m.index ?? 0, x: ma.slice(dau, dau + 240) });
    }
  }
  return ra;
}

/**
 * Giá trị hợp lệ: đối tượng `({ embedding: … })` / `{ embedding: … }`; hoặc thân KHỐI mà mọi `return` trong đó trả đối
 * tượng có `embedding` (khối chỉ ném lỗi, không `return`, cũng hợp lệ).
 */
export function dungHinh(x: string): boolean {
  if (/^\(?\s*\{[^}]*embedding\s*:/.test(x)) return true;
  if (/^\{\s*\n/.test(x) || /^\{\s*(?:throw|return|const|let|if|h\.)/.test(x)) {
    const tra = [...x.matchAll(/return\s+([^;\n]*)/g)].map((m) => m[1]);
    return tra.every((r) => /^\{[^}]*embedding\s*:/.test(r));
  }
  return false;
}

describe("mock generateEmbedding đúng hình { embedding }", () => {
  const tep = tepLuoi(path.resolve("server"));
  it("★★★ không chỗ mock nào trả MẢNG trơn / giá trị sai hình", () => {
    const sai: string[] = [];
    for (const f of tep) {
      const ma = readFileSync(f, "utf8");
      for (const { vt, x } of giaTriTraVe(ma)) {
        if (!dungHinh(x)) sai.push(`${path.relative(process.cwd(), f)}:${ma.slice(0, vt).split("\n").length}  ${x.slice(0, 40)}`);
      }
    }
    expect(sai).toEqual([]);
  });
  it("★ bộ nhận dạng: mảng trơn SAI, đối tượng {embedding} ĐÚNG, khối ném ĐÚNG", () => {
    expect(dungHinh("unit(0));")).toBe(false);
    expect(dungHinh("[0.1, 0.2]);")).toBe(false);
    expect(dungHinh("{ embedding: unit(0) });")).toBe(true);
    expect(dungHinh("({ embedding: [0.1], dimensions: 1 }))")).toBe(true);
    expect(dungHinh("{\n        throw new Error(\"x\");")).toBe(true);
    expect(dungHinh("{\n    h.last = 1;\n    return { embedding: [0.1], dimensions: 1 };\n  }")).toBe(true);
    expect(dungHinh("{\n    h.last = 1;\n    return unit(0);\n  }")).toBe(false);
  });
  it("lưới quét thấy chỗ mock (không rỗng im lặng)", () => {
    const n = tep.reduce((s, f) => s + giaTriTraVe(readFileSync(f, "utf8")).length, 0);
    expect(n).toBeGreaterThan(20);
  });
});
