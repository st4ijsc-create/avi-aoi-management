/**
 * ★★★ Pha 5 Task 1 (review, **I-3** — phép thử **M3**) — **BẢN KIỂM ĐẾM MỌI ĐIỂM CHẠM ĐĨA.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI: LƯỚI CANARY ĐI THEO **TOOL**, NÊN NÓ MÙ VỚI MỘT ĐƯỜNG **KHÔNG PHẢI TOOL**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `workspaceConfinement.canary.test.ts` hỏi *"tool nào chở byte ra ngoài?"* — câu hỏi đúng, nhưng
 * nó chỉ thấy những gì **đăng ký làm tool**. Một hàm tiện ích mới trong một **FILE MỚI** gọi thẳng
 * `fs.readFileSync(abs)` rồi được một tool cũ dùng lại sẽ **vô hình** với lưới ấy — đúng lớp
 * *"lưới theo FILE, không theo ĐƯỜNG THOÁT"*, lớp đã tái diễn **12 lần** và vừa tái diễn **lần thứ
 * 13 ngay trong task được lập ra để đóng nó**.
 *
 * ⇒ Bất biến ở mức của nó, phát biểu **cái nó PHẢI LÀ** (không liệt kê cái bị cấm):
 *
 *     **MỌI lượt chạm đĩa theo BYTE trong `server/services/aiLocalTools/**` đều nằm trong ĐÚNG HAI
 *     hàm cửa của `readToolsProgramming.ts`: `readConfined` và `writeConfined`.**
 *
 * ⚠ Quét bằng **AST**, không so chuỗi: `git grep "fs.readFileSync"` bắt cả **chú thích** (docstring
 * của `programmingFile.ts` có đúng chuỗi ấy) và bỏ sót `fs["readFileSync"](x)`.
 * ⚠ Quét theo **THƯ MỤC**, không theo danh sách file — nên một **FILE MỚI** rơi vào lưới ngay.
 * ⚠ Lưới khoá cả **số lượng**: một điểm chạm mới ĐÃ ĐÚNG vẫn phải được người viết nhìn thấy một lần
 * (cùng kỷ luật với bản kiểm đếm `Tool.handler(` ở `authCtxInjection.test.ts`).
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const GOC = path.resolve(__dirname);

/**
 * API **chuyển BYTE** (đọc/ghi/cắt). ⚠ CỐ Ý **không** gồm `statSync`/`realpathSync`/`existsSync`/
 * `mkdirSync`: chúng là **phép hỏi/dựng khung**, không chở nội dung file đi đâu — bắt chúng sẽ làm
 * lưới kêu oan rồi bị người sau tắt đi.
 */
const API_CHO_BYTE = new Set([
  "readFileSync", "writeFileSync", "appendFileSync", "openSync", "readSync", "writeSync",
  "ftruncateSync", "truncateSync", "copyFileSync", "createReadStream", "createWriteStream",
  "readFile", "writeFile", "appendFile", "open", "copyFile",
]);

/**
 * ★ HAI CỬA — và **chỉ** hai. Muốn thêm một cái tên vào đây thì phải sửa file này, tức phải đọc
 * khối trên một lần. Đó là mục đích.
 */
const CUA: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["readToolsProgramming.ts", new Set(["readConfined", "writeConfined"])],
]);

interface DiemCham {
  readonly file: string;
  readonly dong: number;
  readonly api: string;
  /** Tên hàm bao ngoài gần nhất — `"<top-level>"` khi không có. */
  readonly trongHam: string;
}

function moiFileSanXuat(dir: string, ra: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      moiFileSanXuat(p, ra);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) {
      ra.push(p);
    }
  }
  return ra;
}

/** `fs.X(...)` và `fs["X"](...)` — cả hai hình dạng. */
function tenApi(n: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n)) {
    const a = n.argumentExpression;
    if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return a.text;
  }
  return null;
}

/** Hàm bao ngoài GẦN NHẤT có tên — neo đúng NẤC (vào cái hàm, không vào file). */
function hamBaoNgoai(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if ((ts.isFunctionExpression(p) || ts.isArrowFunction(p)) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) {
      return p.parent.name.text;
    }
    if ((ts.isFunctionExpression(p) || ts.isArrowFunction(p)) && ts.isPropertyAssignment(p.parent) && ts.isIdentifier(p.parent.name)) {
      return p.parent.name.text;
    }
  }
  return "<top-level>";
}

function quet(): DiemCham[] {
  const ra: DiemCham[] = [];
  for (const file of moiFileSanXuat(GOC)) {
    const src = fs.readFileSync(file, "utf8");
    if (!src.includes("fs")) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const rel = path.relative(GOC, file).split(path.sep).join("/");
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const api = tenApi(n.expression);
        if (api && API_CHO_BYTE.has(api)) {
          ra.push({
            file: rel,
            dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            api,
            trongHam: hamBaoNgoai(n),
          });
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
  }
  return ra;
}

function ngoaiCua(d: DiemCham): boolean {
  const chp = CUA.get(d.file);
  return !chp || !chp.has(d.trongHam);
}

describe("★★★ M3 — MỌI lượt chạm đĩa theo BYTE trong nhóm tool đều nằm trong hai hàm CỬA", () => {
  it("★★★ KHÔNG điểm chạm nào nằm ngoài `readConfined`/`writeConfined`", () => {
    const ho = quet().filter(ngoaiCua);
    expect(
      ho,
      "một lượt chạm đĩa ngoài cửa chung là một ĐƯỜNG THOÁT MỚI: nó bỏ qua phép kiểm realpath-của-" +
        "target và `nlink` ⇒ đọc/ghi xuyên hard link ra ngoài workspace (đúng hai lỗ Critical C-1/C-2 " +
        "vừa đóng). Sửa ĐIỂM GỌI cho đi qua `confineTarget` + `readConfined`/`writeConfined`, " +
        "KHÔNG nới lưới:\n" + ho.map((d) => `  ${d.file}:${d.dong} [${d.trongHam}] → fs.${d.api}(…)`).join("\n"),
    ).toEqual([]);
  });

  it("★★ BẢN KIỂM ĐẾM — đúng những điểm chạm đã biết, trong đúng hai hàm cửa", () => {
    const tatCa = quet();
    expect(tatCa.length, "lưới phải THẤY các điểm chạm thật, nếu không nó đang quét hư không").toBeGreaterThan(0);
    const tom = tatCa.map((d) => `${d.file} [${d.trongHam}] fs.${d.api}`).sort();
    expect(
      tom,
      "thêm/bớt một lượt chạm đĩa phải được người viết nhìn thấy lưới này một lần",
    ).toEqual([
      "readToolsProgramming.ts [readConfined] fs.openSync",
      "readToolsProgramming.ts [readConfined] fs.readSync",
      "readToolsProgramming.ts [writeConfined] fs.ftruncateSync",
      "readToolsProgramming.ts [writeConfined] fs.openSync",
      "readToolsProgramming.ts [writeConfined] fs.writeSync",
    ]);
  });

  /**
   * ⚠⚠ Ca này chạy **ĐÚNG hai vị từ** mà `quet()` chạy (`tenApi` + `hamBaoNgoai`), **không chép
   * lại** chúng. Bản chép sẽ xanh trên vị từ CŨ khi vị từ thật đổi — đúng lớp *"hai bản sao của một
   * vị từ"* mà cả task này đang gỡ.
   */
  function chamTrenNguon(nguon: string): { api: string; trongHam: string } | null {
    const sf = ts.createSourceFile("t.ts", nguon, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let ra: { api: string; trongHam: string } | null = null;
    const di = (n: ts.Node): void => {
      if (ra === null && ts.isCallExpression(n)) {
        const api = tenApi(n.expression);
        if (api && API_CHO_BYTE.has(api)) ra = { api, trongHam: hamBaoNgoai(n) };
      }
      ts.forEachChild(n, di);
    };
    di(sf);
    return ra;
  }

  it("★★ LƯỚI-CHO-LƯỚI: các hình dạng lách đều bị THẤY (kể cả `fs[\"x\"]()`, arrow, method, top-level)", () => {
    const lach = [
      'const b = fs.readFileSync(abs);',
      'const b = fs["readFileSync"](abs);',
      'function doc(p) { return fs.openSync(p, "r"); }',
      'const doc = (p) => fs.readFileSync(p);',
      'const o = { doc(p) { return fs.writeFileSync(p, "x"); } };',
      'fs.createReadStream(abs);',
    ];
    for (const mau of lach) {
      const r = chamTrenNguon(mau);
      expect(r, `lưới phải THẤY điểm chạm: ${mau}`).not.toBeNull();
      expect(ngoaiCua({ file: "moi-file-la.ts", dong: 1, api: r!.api, trongHam: r!.trongHam }), `phải bị BẮT: ${mau}`).toBe(true);
    }
  });

  it("★ chiều DƯƠNG: đúng hai cửa được cho qua, và phép hỏi/dựng-khung KHÔNG bị bắt oan", () => {
    expect(ngoaiCua({ file: "readToolsProgramming.ts", dong: 1, api: "openSync", trongHam: "readConfined" })).toBe(false);
    expect(ngoaiCua({ file: "readToolsProgramming.ts", dong: 1, api: "writeSync", trongHam: "writeConfined" })).toBe(false);
    // Một lưới kêu oan sẽ bị người sau tắt đi — `statSync`/`realpathSync`/`mkdirSync` phải im.
    expect(chamTrenNguon("const s = fs.statSync(p);")).toBeNull();
    expect(chamTrenNguon("const r = fs.realpathSync(p);")).toBeNull();
    expect(chamTrenNguon('fs.mkdirSync(d, { recursive: true });')).toBeNull();
    expect(chamTrenNguon("if (fs.existsSync(p)) return 1;")).toBeNull();
  });
});
