/**
 * SCADA R1a T10 fix round 1 (minor 3) — CENSUS "tool AI tới `runDispatch` ⇒ CÓ `otWriteBinding`".
 *
 * Vì sao: `confirmAction` chỉ áp sàn vai + từ chối sớm mức ≥ 4 (`mucGhiOtLucXacNhan`) cho tool CÓ `otWriteBinding`; tool không
 * có hook được coi là "không ghi OT" ⇒ hành vi cũ. Một tool mới mà `execute` tới `runDispatch` (⇒ `dispatch()`) nhưng quên hook
 * sẽ LẶNG LẼ bỏ qua sàn vai lúc confirm (và binding băm lúc propose). Lượng từ là ∀, suy từ mã — không danh sách tay:
 *
 *   (A) ∀ tệp sản xuất dưới `server/services/aiLocalTools/**` import `ot/commandDispatcher`: mọi lời gọi `dispatch(…)` nằm TRONG
 *       hàm `runDispatch` (một chokepoint), và ∀ object literal có `execute` nhắc tới `runDispatch` ⇒ có thuộc tính `otWriteBinding`.
 *   (B) ∀ tool `kind:"write"` trong SỔ ĐĂNG KÝ lúc chạy (đảo lượng từ: đi từ sổ, không từ tệp): `execute` nhắc `runDispatch`
 *       ⇒ `typeof otWriteBinding === "function"`.
 *   (C) Bộ quét tự kiểm bằng đột biến trên mã / tool tổng hợp — một bộ quét không bắt được gì là chân lý rỗng.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { listTools, type Tool } from "./toolRegistry";
import "./writeHandlers";

const GOC = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const THU_MUC = join(GOC, "server/services/aiLocalTools");
const rel = (p: string) => relative(GOC, p).split(sep).join("/");

function moiTep(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) moiTep(p, ra);
    else if (/\.tsx?$/.test(ten) && !/\.test\.tsx?$/.test(ten) && !ten.endsWith(".d.ts")) ra.push(p);
  }
  return ra;
}

function coNhap(tepRel: string, nguon: ts.SourceFile, dich: string): boolean {
  let co = false;
  const di = (n: ts.Node) => {
    let spec: ts.Expression | undefined;
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) spec = n.moduleSpecifier;
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) spec = n.arguments[0];
    if (spec && ts.isStringLiteralLike(spec) && spec.text.startsWith(".")) {
      if (rel(resolve(GOC, dirname(tepRel), spec.text)).replace(/\.(ts|js)$/, "") === dich) co = true;
    }
    ts.forEachChild(n, di);
  };
  di(nguon);
  return co;
}

function nhacToi(n: ts.Node, ten: string): boolean {
  let co = false;
  const di = (x: ts.Node) => {
    if (co) return;
    if (ts.isIdentifier(x) && x.text === ten) co = true;
    else ts.forEachChild(x, di);
  };
  di(n);
  return co;
}

interface ViPham {
  tep: string;
  dong: number;
  loai: "dispatch_ngoai_runDispatch" | "execute_runDispatch_thieu_otWriteBinding";
}

/** Bộ quét (A) trên MỘT tệp nguồn. Trả vi phạm + số object tool tới runDispatch đã thấy (để chặn chân lý rỗng). */
function quetTep(tepRel: string, maNguon: string): { viPham: ViPham[]; soToolOt: number } {
  const sf = ts.createSourceFile(tepRel, maNguon, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const viPham: ViPham[] = [];
  let soToolOt = 0;
  const dong = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const di = (n: ts.Node, trongRunDispatch: boolean) => {
    const vao = trongRunDispatch || (ts.isFunctionDeclaration(n) && n.name?.text === "runDispatch");
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "dispatch" && !vao) {
      viPham.push({ tep: tepRel, dong: dong(n), loai: "dispatch_ngoai_runDispatch" });
    }
    if (ts.isObjectLiteralExpression(n)) {
      const tenProp = (p: ts.ObjectLiteralElementLike) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null);
      const exec = n.properties.find((p) => tenProp(p) === "execute");
      if (exec && nhacToi(exec, "runDispatch")) {
        soToolOt++;
        if (!n.properties.some((p) => tenProp(p) === "otWriteBinding")) {
          viPham.push({ tep: tepRel, dong: dong(n), loai: "execute_runDispatch_thieu_otWriteBinding" });
        }
      }
    }
    ts.forEachChild(n, (c) => di(c, vao));
  };
  di(sf, false);
  return { viPham, soToolOt };
}

/** Bộ kiểm (B) trên một danh sách tool. */
function toolThieuBinding(tools: ReadonlyArray<Tool<any, any>>): { thieu: string[]; soToolOt: number } {
  const thieu: string[] = [];
  let soToolOt = 0;
  for (const t of tools) {
    if (t.kind !== "write" || typeof t.execute !== "function") continue;
    if (!/\brunDispatch\b/.test(t.execute.toString())) continue;
    soToolOt++;
    if (typeof t.otWriteBinding !== "function") thieu.push(t.name);
  }
  return { thieu, soToolOt };
}

describe("census — tool AI tới runDispatch ⇒ có otWriteBinding", () => {
  it("(A) ∀ tệp aiLocalTools import ot/commandDispatcher: dispatch() chỉ trong runDispatch; execute→runDispatch ⇒ otWriteBinding", () => {
    const tepDispatch = moiTep(THU_MUC).filter((p) => {
      const r = rel(p);
      return coNhap(r, ts.createSourceFile(r, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true), "server/services/ot/commandDispatcher");
    });
    expect(tepDispatch.map(rel).sort(), "tập tệp chạm dispatcher (suy ra)").toEqual(
      expect.arrayContaining([
        "server/services/aiLocalTools/writeHandlers/machineControl.ts",
        "server/services/aiLocalTools/writeHandlers/visionControl.ts",
      ]),
    );
    let tong = 0;
    const viPham: ViPham[] = [];
    for (const p of tepDispatch) {
      const kq = quetTep(rel(p), readFileSync(p, "utf8"));
      tong += kq.soToolOt;
      viPham.push(...kq.viPham);
    }
    expect(viPham).toEqual([]);
    // machineControl: 1 khuôn lifecycle (4 tool) + select_recipe + download_job + set_machine_param + ack ⇒ 5 literal; vision: 2.
    expect(tong, "không được là chân lý rỗng").toBeGreaterThanOrEqual(7);
  });

  it("(B) ∀ write tool trong SỔ ĐĂNG KÝ có execute → runDispatch ⇒ otWriteBinding là hàm", () => {
    const { thieu, soToolOt } = toolThieuBinding(listTools());
    expect(thieu).toEqual([]);
    // 8 tool máy + 2 tool thị giác
    expect(soToolOt, "không được là chân lý rỗng").toBeGreaterThanOrEqual(10);
  });

  it("(C) tự kiểm bằng đột biến: bộ quét bắt được tool thiếu hook và dispatch() ngoài chokepoint", () => {
    const thieuHook = `
      async function runDispatch(ctx, args) { return dispatch(args); }
      registerTool({ name: "x", kind: "write", execute: async (p, ctx) => runDispatch(ctx, p) });
      registerTool({ name: "y", kind: "write", otWriteBinding: async () => null, execute: async (p, ctx) => runDispatch(ctx, p) });`;
    const a = quetTep("server/services/aiLocalTools/writeHandlers/__gia.ts", thieuHook);
    expect(a.soToolOt).toBe(2);
    expect(a.viPham.map((v) => v.loai)).toEqual(["execute_runDispatch_thieu_otWriteBinding"]);

    const dispatchLac = `
      async function runDispatch(ctx, args) { return dispatch(args); }
      async function duongTat(args) { return dispatch(args); }`;
    expect(quetTep("server/services/aiLocalTools/writeHandlers/__gia2.ts", dispatchLac).viPham.map((v) => v.loai)).toEqual([
      "dispatch_ngoai_runDispatch",
    ]);

    async function runDispatch(_c: unknown, _a: unknown) {
      return null;
    }
    const toolGia = { name: "gia_ot", kind: "write", execute: async (p: unknown, c: unknown) => runDispatch(c, p) } as unknown as Tool<any, any>;
    const toolGiaCoHook = { ...toolGia, name: "gia_ot_hook", otWriteBinding: async () => null } as unknown as Tool<any, any>;
    expect(toolThieuBinding([toolGia, toolGiaCoHook])).toEqual({ thieu: ["gia_ot"], soToolOt: 2 });
  });
});
