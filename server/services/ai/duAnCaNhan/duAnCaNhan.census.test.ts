/**
 * ★★★ Đợt 3a — CENSUS NGƯỜI GỌI của cửa phân giải dự án (AST, quét CẢ cây `server/**`, không danh sách tệp — một
 * tệp MỚI rơi vào lưới ngay, kể cả tệp của dòng việc song song):
 *   1. MỌI lời gọi `phanGiaiGoc(` ngoài lưới mang ĐÚNG HAI đối số — chữ ký đã bắt buộc, nhưng `vitest`/esbuild
 *      không kiểm kiểu, nên một điểm gọi một-đối-số vẫn CHẠY (đối số thứ hai `undefined` ⇒ dự án cá nhân bị từ chối:
 *      an toàn, nhưng là một lỗi chức năng câm). Lưới này bắt nó ngay, không đợi `tsc`.
 *   2. `gocTheoId(` (cửa KHÔNG biết người gọi) không được gọi ngoài `repoProjects.ts` — mọi đường thực thi đi qua
 *      `phanGiaiGoc`.
 *   3. Đối chứng: lưới THẤY các điểm gọi thật (≥ 10) — nếu không, nó đang quét hư không.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const GOC_SERVER = path.resolve(__dirname, "..", "..", "..");

function moiTep(d: string, ra: string[] = []): string[] {
  for (const m of fs.readdirSync(d, { withFileTypes: true })) {
    if (m.name === "node_modules") continue;
    const p = path.join(d, m.name);
    if (m.isDirectory()) moiTep(p, ra);
    else if (/\.(ts|tsx)$/.test(m.name) && !/\.(test|spec)\.tsx?$/.test(m.name) && !m.name.endsWith(".d.ts")) ra.push(p);
  }
  return ra;
}

interface Goi {
  tep: string;
  dong: number;
  ten: string;
  soDoiSo: number;
}

function quet(): Goi[] {
  const ra: Goi[] = [];
  for (const tep of moiTep(GOC_SERVER)) {
    const src = fs.readFileSync(tep, "utf8");
    if (!src.includes("phanGiaiGoc") && !src.includes("gocTheoId")) continue;
    const sf = ts.createSourceFile(tep, src, ts.ScriptTarget.Latest, true, tep.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const e = n.expression;
        const ten = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : "";
        if (ten === "phanGiaiGoc" || ten === "gocTheoId") {
          ra.push({
            tep: path.relative(GOC_SERVER, tep).split(path.sep).join("/"),
            dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            ten,
            soDoiSo: n.arguments.length,
          });
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
  }
  return ra;
}

const GOI = quet();

describe("★★★ Đợt 3a — census người gọi cửa phân giải dự án", () => {
  it("★★★ mọi `phanGiaiGoc(` có ĐÚNG HAI đối số (người gọi tường minh — `null` nếu không biết)", () => {
    const sai = GOI.filter((g) => g.ten === "phanGiaiGoc" && g.soDoiSo !== 2);
    expect(sai.map((g) => `${g.tep}:${g.dong} (${g.soDoiSo} đối số)`)).toEqual([]);
  });

  it("★★ `gocTheoId(` chỉ được gọi bên trong `repoProjects.ts`", () => {
    const ngoai = GOI.filter((g) => g.ten === "gocTheoId" && !g.tep.endsWith("services/aiLocalTools/repoProjects.ts"));
    expect(ngoai.map((g) => `${g.tep}:${g.dong}`)).toEqual([]);
  });

  it("★ đối chứng: lưới THẤY các điểm gọi thật", () => {
    expect(GOI.filter((g) => g.ten === "phanGiaiGoc").length).toBeGreaterThanOrEqual(10);
  });
});
