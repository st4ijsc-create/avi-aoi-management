/**
 * CENSUS pha 0 · C0-1 — handler Sparkplug KHÔNG còn đường nào tới ghi tag / dispatcher (chọn B, dieu-phoi 2026-11-04). Quét AST (TypeScript compiler API), không grep thô:
 *   • `uns/sparkplugCommand.ts` KHÔNG import `commandDispatcher` / `otDeviceWrite` / adapter / driver / `unsPublisher` / drizzle / db;
 *   • KHÔNG có định danh `dispatch`, `writeTags`, `deployFile`, `resolveTarget`, `metricToWrite`, `executeOtDeviceWrite`;
 *   • `SparkplugCommandDeps` chỉ có subscribe / onRebirth / log;
 *   • `unsPublisher.ts` không import `commandDispatcher` và không còn `resolveSparkplugTarget` / `sparkplugMetricToWrite`.
 * Đột biến (chạy tay, ghi ở báo cáo): đưa lại `dispatch` vào deps, import `../ot/commandDispatcher`, thêm `writeTags(` ⇒ ĐỎ.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const GOC = resolve(__dirname, "..");
const doc = (rel: string) => readFileSync(join(GOC, rel), "utf8");

function phanTich(src: string, ten: string) {
  const sf = ts.createSourceFile(ten, src, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const dinhDanh = new Set<string>();
  const walk = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) imports.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) imports.push(n.arguments[0].text); // import động
    if (ts.isIdentifier(n)) dinhDanh.add(n.text);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return { sf, imports, dinhDanh };
}

const CAM_DINH_DANH = ["dispatch", "writeTags", "deployFile", "resolveTarget", "metricToWrite", "executeOtDeviceWrite", "SPARKPLUG_ACTION_ID_METRIC", "SPARKPLUG_COMMAND_TOOL"];
const CAM_IMPORT = /commandDispatcher|otDeviceWrite|adapterFacade|otDriver|\/ot\/|drizzle|\/db(\/|$)|unsPublisher|robot/;

describe("census — Sparkplug handler không có đường ghi thiết bị (C0-1)", () => {
  const h = phanTich(doc("uns/sparkplugCommand.ts"), "sparkplugCommand.ts");

  it("§0 phép quét THẤY mã (không quét rỗng)", () => {
    expect(h.imports.length).toBeGreaterThanOrEqual(2);
    expect(h.dinhDanh.has("SparkplugCommandHandler")).toBe(true);
    expect(h.dinhDanh.has("onRebirth")).toBe(true);
  });

  it("★ KHÔNG import dispatcher / ghi thiết bị / adapter / db (kể cả import động)", () => {
    for (const i of h.imports) expect(i, `import cấm: ${i}`).not.toMatch(CAM_IMPORT);
  });

  it("★ KHÔNG có định danh dispatch / writeTags / deployFile / resolveTarget / metricToWrite / HITL-bind", () => {
    for (const d of CAM_DINH_DANH) expect(h.dinhDanh.has(d), `định danh cấm: ${d}`).toBe(false);
  });

  it("★ SparkplugCommandDeps chỉ có subscribe / onRebirth / log", () => {
    const tenTruong: string[] = [];
    const walk = (n: ts.Node) => {
      if (ts.isInterfaceDeclaration(n) && n.name.text === "SparkplugCommandDeps") for (const m of n.members) if (ts.isPropertySignature(m) && ts.isIdentifier(m.name)) tenTruong.push(m.name.text);
      ts.forEachChild(n, walk);
    };
    walk(h.sf);
    expect(tenTruong.sort()).toEqual(["log", "onRebirth", "subscribe"]);
  });

  it("★ unsPublisher.ts: không import commandDispatcher, không còn hàm ánh xạ DCMD → ghi", () => {
    const p = phanTich(doc("unsPublisher.ts"), "unsPublisher.ts");
    for (const i of p.imports) expect(i, `import cấm trong unsPublisher: ${i}`).not.toMatch(/commandDispatcher|otDeviceWrite/);
    expect(p.dinhDanh.has("resolveSparkplugTarget")).toBe(false);
    expect(p.dinhDanh.has("sparkplugMetricToWrite")).toBe(false);
    expect(p.dinhDanh.has("sparkplugSystemUserId")).toBe(false);
  });
});
