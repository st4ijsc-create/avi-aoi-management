/**
 * ★★ Đợt 2 — BẢN KIỂM ĐẾM điểm chạm đĩa của chỉ mục mã. Cùng bất biến với `aiLocalTools/programmingFileIo.census.test.ts`
 * (lưới ấy chỉ quét `aiLocalTools/**` nên MÙ với thư mục này): byte nội dung tệp CHỈ đi qua `readConfined` (gọi từ
 * `hopCatChiMuc.ts`); ở đây không có một API chở/huỷ byte nào của `fs` — chỉ phép HỎI (`lstatSync`/`statSync`).
 * Quét AST theo THƯ MỤC (tệp mới rơi vào lưới ngay), bắt cả `fs.X(…)`, `fs["X"](…)` và named import.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const GOC = path.resolve(__dirname);
const API_CHO_BYTE = new Set([
  "readFileSync", "writeFileSync", "appendFileSync", "openSync", "readSync", "writeSync", "ftruncateSync", "truncateSync",
  "copyFileSync", "createReadStream", "createWriteStream", "readFile", "writeFile", "appendFile", "open", "copyFile",
  "unlinkSync", "unlink", "rmSync", "rm", "rmdirSync", "rmdir", "renameSync", "rename", "linkSync", "link", "symlinkSync",
  "symlink", "cpSync", "cp", "opendirSync", "readdirSync", "readdir",
]);

function tepSanPham(): string[] {
  return fs
    .readdirSync(GOC)
    .filter((t) => t.endsWith(".ts") && !t.endsWith(".test.ts") && !t.endsWith(".d.ts"))
    .map((t) => path.join(GOC, t));
}

describe("★★ chiMucMa — không cửa thứ hai ra đĩa", () => {
  it("không gọi API chở/huỷ byte của `fs` (kể cả `readdirSync` — liệt kê phải qua `lietKeTrongHopCat`)", () => {
    const ho: string[] = [];
    const tep = tepSanPham();
    expect(tep.length, "lưới phải thấy tệp sản phẩm").toBeGreaterThanOrEqual(5);
    for (const f of tep) {
      const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const di = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          const e = n.expression;
          const ten = ts.isPropertyAccessExpression(e)
            ? e.name.text
            : ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)
              ? e.argumentExpression.text
              : null;
          if (ten && API_CHO_BYTE.has(ten) && /\bfs\b/.test(e.getText(sf))) ho.push(`${path.basename(f)}: ${e.getText(sf)}`);
        }
        if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /^(node:)?fs(\/promises)?$/.test(n.moduleSpecifier.text)) {
          const nb = n.importClause?.namedBindings;
          if (nb && ts.isNamedImports(nb)) {
            for (const el of nb.elements) if (API_CHO_BYTE.has((el.propertyName ?? el.name).text)) ho.push(`${path.basename(f)}: import { ${el.name.text} }`);
          }
        }
        ts.forEachChild(n, di);
      };
      di(sf);
    }
    expect(ho).toEqual([]);
  });

  it("đọc nội dung CHỈ trong `hopCatChiMuc.ts` (`readConfined`) — tệp khác không nhập cửa đọc thô", () => {
    const ho: string[] = [];
    for (const f of tepSanPham()) {
      if (path.basename(f) === "hopCatChiMuc.ts") continue;
      const src = fs.readFileSync(f, "utf8");
      if (/\b(readConfined|confineTargetUnder|listConfined|confineDirUnder)\b/.test(src)) ho.push(path.basename(f));
    }
    expect(ho).toEqual([]);
    expect(fs.readFileSync(path.join(GOC, "hopCatChiMuc.ts"), "utf8")).toMatch(/readConfined\(cf\.target/);
  });
});
