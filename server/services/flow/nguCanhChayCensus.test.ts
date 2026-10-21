/**
 * ★★★ Đợt 9 (IDOR) — CENSUS "mọi đường dựng NguCanhChay đều ĐẶT `kiemPhamVi`" (đóng theo mặc định: vắng ⇒ node tài nguyên từ chối).
 * Lượng từ ∀ suy từ MÃ (AST), không danh sách tay: mọi object literal dưới `server/services/flow/**` (không test) có đủ hình NguCanhChay
 * — các khoá `runId · nodeId · lan · idempotencyKey · inputs · nodes` — phải mang khoá `kiemPhamVi`. Cầu chì: phải thấy ≥ 2 literal
 * (động cơ `batDauBuoc` + `chayThuNut`); bộ quét tự kiểm bằng đột biến trên mã tổng hợp.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GOC = resolve(dirname(fileURLToPath(import.meta.url)));
const HINH = ["runId", "nodeId", "lan", "idempotencyKey", "inputs", "nodes"];

function moiTep(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) moiTep(p, ra);
    else if (/\.ts$/.test(ten) && !/\.test\.ts$/.test(ten) && !ten.endsWith(".d.ts")) ra.push(p);
  }
  return ra;
}

/** Các object literal có hình NguCanhChay: [có kiemPhamVi?, vị trí]. */
function quet(nguon: string, ten = "x.ts"): { co: boolean; dong: number }[] {
  const sf = ts.createSourceFile(ten, nguon, ts.ScriptTarget.Latest, true);
  const ra: { co: boolean; dong: number }[] = [];
  const di = (n: ts.Node) => {
    if (ts.isObjectLiteralExpression(n)) {
      const khoa = new Set(n.properties.map((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : ts.isShorthandPropertyAssignment(p) ? p.name.text : "")));
      if (HINH.every((k) => khoa.has(k))) ra.push({ co: khoa.has("kiemPhamVi"), dong: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

describe("census — mọi NguCanhChay dựng ra đều đặt kiemPhamVi", () => {
  it("∀ literal hình NguCanhChay dưới server/services/flow/**: có `kiemPhamVi`; thấy ≥ 2 literal (dongCo + chayThuNut)", () => {
    const thay: { tep: string; dong: number; co: boolean }[] = [];
    for (const tep of moiTep(GOC)) for (const r of quet(readFileSync(tep, "utf8"), tep)) thay.push({ tep: relative(GOC, tep).split(sep).join("/"), ...r });
    expect(thay.length, "bộ quét không thấy đủ nơi dựng NguCanhChay").toBeGreaterThanOrEqual(2);
    expect(thay.map((t) => t.tep)).toEqual(expect.arrayContaining(["dongCo.ts", "chayThuNut.ts"]));
    expect(thay.filter((t) => !t.co), "dựng NguCanhChay mà KHÔNG đặt kiemPhamVi").toEqual([]);
  });

  it("tự kiểm: literal có hình mà thiếu kiemPhamVi ⇒ bị bắt; có ⇒ qua; literal khác hình ⇒ bỏ qua", () => {
    const hinh = "runId: 'r', nodeId: 'n', lan: 1, idempotencyKey: 'k', inputs: {}, nodes: {}";
    expect(quet(`const a = { ${hinh} };`)).toEqual([{ co: false, dong: 1 }]);
    expect(quet(`const a = { ${hinh}, kiemPhamVi: undefined };`)).toEqual([{ co: true, dong: 1 }]);
    expect(quet(`const a = { runId: 'r', nodeId: 'n' };`)).toEqual([]);
  });
});
