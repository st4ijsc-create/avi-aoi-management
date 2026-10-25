/**
 * ★★★ W18 (kiểm định, 2026-10-25) — BỘ QUÉT AST "đọc `.rows` trên kết quả `db.execute(...)` của postgres-js".
 *
 * VÌ SAO. Driver của repo là postgres-js: `db.execute(sql…)` trả MỘT MẢNG hàng, KHÔNG có `.rows` (khác node-pg). Mã viết kiểu node-pg `result.rows || []` luôn ra `[]`:
 * số liệu luôn 0 / danh sách luôn rỗng mà không lỗi nào — đã gặp ≥ 6 lần (processInspection, getEmbeddingStats, getQualityGateStats, runDiversitySampling, alertEvaluation…).
 *
 * QUY TẮC. Một biến nhận kết quả `…execute(…)` (hoặc chính lời gọi `execute(…)`) mà bị đọc `.rows` thì CÂU LỆNH chứa nó phải có ĐƯỜNG LÙI về chính kết quả (mảng):
 *   `R.rows ?? R` · `R.rows || R` · `Array.isArray(R) ? R : R.rows` · hoặc dùng helper chung `hangKetQua(R)` (server/services/mqttAlertPhamVi.ts) / `hangCuaKetQua` ⇒ không còn `.rows` trần.
 *   `.rows` TRẦN (kể cả `R.rows || []`, `R.rows?.[0]`, `(await x.execute()).rows`) ⇒ HỎNG trên postgres-js.
 *
 * GIỚI HẠN (đọc trước khi tin con số): theo TÊN biến trong CÙNG tệp (không theo kiểu); kết quả `execute` đi qua tham số hàm / thuộc tính đối tượng không theo được;
 * `.rows` trên thứ khác (`input.rows`, `grid.rows`) không bị tính vì gốc của nó không phải biến nhận `execute`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

export interface ViPhamRows {
  /** `tệp:dòng` tương đối so với gốc quét */
  vitri: string;
  /** dòng mã (đã cắt) */
  mau: string;
}

/** Lời gọi `.execute(` ? (db.execute / d.execute / tx.execute / x.y.execute). */
function laLoiGoiExecute(n: ts.Node): boolean {
  return ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "execute";
}
function boBoc(n: ts.Expression): ts.Expression {
  let c: ts.Expression = n;
  for (;;) {
    if (ts.isParenthesizedExpression(c) || ts.isAsExpression(c) || ts.isNonNullExpression(c) || ts.isTypeAssertionExpression(c) || ts.isAwaitExpression(c)) c = c.expression;
    else return c;
  }
}
/** Biểu thức (sau khi bóc await/as/ngoặc) là lời gọi execute? */
function laKetQuaExecute(e: ts.Expression | undefined): boolean {
  return !!e && laLoiGoiExecute(boBoc(e));
}

function layGocDinhDanh(e: ts.Expression): string | null {
  const c = boBoc(e);
  return ts.isIdentifier(c) ? c.text : null;
}

export function quetTep(tenTep: string, noiDung: string): ViPhamRows[] {
  const sf = ts.createSourceFile(tenTep, noiDung, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // 1) biến nhận kết quả execute
  const bienExec = new Set<string>();
  const duyet1 = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && laKetQuaExecute(n.initializer)) bienExec.add(n.name.text);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && laKetQuaExecute(n.right)) bienExec.add(n.left.text);
    // `x.execute(...).then((r) => r.rows)` — tham số của callback `.then` trên một lời gọi execute cũng là kết quả execute
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "then" && laKetQuaExecute(n.expression.expression as ts.Expression)) {
      const cb = n.arguments[0];
      if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && cb.parameters[0] && ts.isIdentifier(cb.parameters[0].name)) bienExec.add(cb.parameters[0].name.text);
    }
    ts.forEachChild(n, duyet1);
  };
  duyet1(sf);

  const ra: ViPhamRows[] = [];
  const dongCuaNut = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const duyet2 = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === "rows") {
      const goc = boBoc(n.expression);
      const tenGoc = layGocDinhDanh(n.expression);
      const laExecTrucTiep = laLoiGoiExecute(goc);
      if (laExecTrucTiep || (tenGoc !== null && bienExec.has(tenGoc))) {
        // câu lệnh chứa nút
        let st: ts.Node = n;
        while (st.parent && !ts.isStatement(st)) st = st.parent;
        // đường lùi có thể nằm ở câu lệnh TRƯỚC trong cùng hàm (`if (Array.isArray(r)) return r;`) ⇒ xét cả thân hàm bao
        let ham: ts.Node = n;
        while (ham.parent && !ts.isFunctionLike(ham)) ham = ham.parent;
        const vanBan = st.getText(sf);
        const vanBanHam = ham.getText(sf);
        let coDuongLui = false;
        if (tenGoc !== null) {
          if (new RegExp(`Array\\.isArray\\(\\s*\\(?${tenGoc}\\b`).test(vanBanHam) || new RegExp(`hangKetQua(?:<[^>]*>)?\\(\\s*${tenGoc}\\b`).test(vanBanHam)) coDuongLui = true;
          else {
            // đường lùi: tên gốc được DÙNG ở chỗ không phải (a) gốc của một `.rows`, (b) tên khai báo (tham số / biến), (c) tên thuộc tính
            let dung = 0;
            const dem = (x: ts.Node): void => {
              if (ts.isIdentifier(x) && x.text === tenGoc) {
                const cha = x.parent;
                const laGocRows = ts.isPropertyAccessExpression(cha) && cha.name.text === "rows" && cha.expression === x;
                const laGocRowsQuaBoc = (() => { let c: ts.Node = x; while (c.parent && (ts.isParenthesizedExpression(c.parent) || ts.isAsExpression(c.parent) || ts.isNonNullExpression(c.parent))) c = c.parent; const pp = c.parent; return !!pp && ts.isPropertyAccessExpression(pp) && pp.name.text === "rows" && pp.expression === c; })();
                const laKhaiBao = (ts.isParameter(cha) || ts.isVariableDeclaration(cha) || ts.isBindingElement(cha)) && cha.name === x;
                const laTenThuocTinh = ts.isPropertyAccessExpression(cha) && cha.name === x;
                if (!laGocRows && !laGocRowsQuaBoc && !laKhaiBao && !laTenThuocTinh) dung++;
              }
              ts.forEachChild(x, dem);
            };
            dem(st);
            if (dung > 0) coDuongLui = true;
          }
        }
        if (!coDuongLui) ra.push({ vitri: `${tenTep}:${dongCuaNut(n)}`, mau: n.getText(sf).slice(0, 80).replace(/\s+/g, " ") });
      }
    }
    ts.forEachChild(n, duyet2);
  };
  duyet2(sf);
  return ra;
}

function lietKeTs(thuMuc: string, ra: string[]): void {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const d = join(thuMuc, ten);
    const st = statSync(d);
    if (st.isDirectory()) lietKeTs(d, ra);
    else if (ten.endsWith(".ts") && !ten.endsWith(".test.ts") && !ten.endsWith(".d.ts") && !/^__/.test(ten)) ra.push(d);
  }
}

/** Quét toàn `server/` (trừ test). `goc` = thư mục `server`. */
export function quetServer(goc: string): ViPhamRows[] {
  const tep: string[] = [];
  lietKeTs(goc, tep);
  const ra: ViPhamRows[] = [];
  for (const f of tep.sort()) ra.push(...quetTep(relative(join(goc, ".."), f).split(sep).join("/"), readFileSync(f, "utf8")));
  return ra;
}
