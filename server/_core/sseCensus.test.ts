/**
 * ★★★ CENSUS AST — mọi lời gọi `sseBroadcast(...)` phải truyền ĐỦ 4 đối số (kênh, sự kiện, dữ liệu, `factoryId`); đối số thứ 4 không được là
 * `undefined`. Chống "đường thứ N quên": thêm bộ phát SSE mới mà không khai nhà máy ⇒ ĐỎ. Hiện 0 nơi gọi (cầu chì: tệp định nghĩa vẫn có chữ ký 4 tham số).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const GOC = resolve(__dirname, "..", "..");

export function vietPhamSse(noiDung: string): string[] {
  const sf = ts.createSourceFile("x.ts", noiDung, ts.ScriptTarget.Latest, true);
  const loi: string[] = [];
  const duyet = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const t = n.expression;
      const ten = ts.isIdentifier(t) ? t.text : ts.isPropertyAccessExpression(t) ? t.name.text : "";
      if (ten === "sseBroadcast") {
        const d4 = n.arguments[3];
        if (!d4 || (ts.isIdentifier(d4) && d4.text === "undefined")) loi.push(`dòng ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: thiếu factoryId`);
      }
    }
    ts.forEachChild(n, duyet);
  };
  duyet(sf);
  return loi;
}

function tep(dir: string, ra: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === "node_modules") continue;
    if (statSync(p).isDirectory()) tep(p, ra);
    else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) ra.push(p);
  }
  return ra;
}

describe("census sseBroadcast truyền factoryId", () => {
  it("không lời gọi sseBroadcast nào thiếu đối số thứ 4", () => {
    const sai: string[] = [];
    for (const p of tep(join(GOC, "server"))) {
      for (const l of vietPhamSse(readFileSync(p, "utf8"))) sai.push(`${relative(GOC, p)} ${l}`);
    }
    expect(sai).toEqual([]);
  });
  it("cầu chì: chữ ký định nghĩa có factoryId bắt buộc", () => {
    expect(readFileSync(join(__dirname, "sse.ts"), "utf8")).toMatch(/export function sseBroadcast\([^)]*factoryId: number \| null\)/);
  });
  it("đột biến: bắt gọi thiếu / undefined, tha gọi đủ", () => {
    expect(vietPhamSse(`sseBroadcast("a","b",{});`)).toHaveLength(1);
    expect(vietPhamSse(`sseBroadcast("a","b",{},undefined);`)).toHaveLength(1);
    expect(vietPhamSse(`x.sseBroadcast("a","b",{},3);`)).toHaveLength(0);
    expect(vietPhamSse(`sseBroadcast("a","b",{},null);`)).toHaveLength(0);
  });
});
