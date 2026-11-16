/**
 * Khoá NGUỒN (AST, THUẦN, không DB): trên đường ĐỀ XUẤT → TỪ CHỐI của một lượt ghi tệp (`proposeAction` / `confirmAction` ⇒ `logCrudOperation` ⇒ `createAuditLog`), MỌI lần ghi `audit_logs` và `ai_pending_actions`
 * lấy kết nối bằng `getDb()` của MODULE `server/db/connection` — đúng hàm mà ba tệp phát lại thay bằng `layDbTheoKenh(kenh)` (`vi.mock("../db/connection")`) — và không có cách lấy kết nối nào khác lọt vào
 * (`getJobsDb` / `getReadDb` / `openSessionClient` / `getNotifyClient`, `postgres(...)`, `drizzle(...)`). Nhờ vậy ca `epDo` ép từ chối đo ĐƯỢC rò rỉ của đường này: không có đường ghi nào đi vòng qua kênh.
 * (Đối chứng bằng đột biến GHI DB bị HST thay bằng khoá nguồn này — luật 16/11: đột biến để lại hàng chỉ chạy khi nêu trước số hàng/loại bảng và được đồng ý.)
 * ĐỘT BIẾN PHẢI BẮT (chỉ chạy tệp này): trỏ một lần ghi `db.update(aiPendingActions)` sang kết nối khác · `const db = await getJobsDb()` · `logCrudOperation` truyền thêm `tx`/executor · import `getDb` từ module khác.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const GOC = path.join(__dirname, "..", "..");
const MODULE_KET_NOI = path.join(GOC, "server", "db", "connection");
const BANG_GHI = new Set(["auditLogs", "aiPendingActions"]);
const CACH_LAY_KHAC = ["getJobsDb", "getReadDb", "openSessionClient", "getNotifyClient"];

function doc(tuongDoi: string) {
  const p = path.join(GOC, tuongDoi);
  const nguon = fs.readFileSync(p, "utf8");
  return { p, tuongDoi, nguon, sf: ts.createSourceFile(p, nguon, ts.ScriptTarget.Latest, true) };
}
function duyet(n: ts.Node, fn: (n: ts.Node) => void): void {
  fn(n);
  ts.forEachChild(n, (c) => duyet(c, fn));
}
const dong = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
const laHam = (n: ts.Node): n is ts.FunctionLikeDeclaration => ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n);

/** Mọi import trong tệp: tên → đường mô-đun đã giải (tuyệt đối, không đuôi) hoặc tên gói. */
function importCuaTep(t: ReturnType<typeof doc>): Array<{ ten: string; tu: string }> {
  const ra: Array<{ ten: string; tu: string }> = [];
  for (const st of t.sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const mo = st.moduleSpecifier.text;
    const tu = mo.startsWith(".") ? path.resolve(path.dirname(t.p), mo) : mo;
    const nb = st.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) ra.push({ ten: e.name.text, tu });
    if (nb && ts.isNamespaceImport(nb)) ra.push({ ten: nb.name.text, tu });
    if (st.importClause?.name) ra.push({ ten: st.importClause.name.text, tu });
    if (!st.importClause) ra.push({ ten: "(side-effect)", tu });
  }
  return ra;
}

interface LanGhi {
  vi_tri: string;
  bang: string;
  nguoiNhan: string;
  nguon: string;
}

/** Mọi `X.insert(auditLogs|aiPendingActions)` / `X.update(aiPendingActions|auditLogs)`: `X` khai ở đâu (trong hàm bao). */
function lanGhi(t: ReturnType<typeof doc>): LanGhi[] {
  const ra: LanGhi[] = [];
  duyet(t.sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
    const ten = n.expression.name.text;
    if (ten !== "insert" && ten !== "update") return;
    const doiSo = n.arguments[0];
    if (!doiSo || !ts.isIdentifier(doiSo) || !BANG_GHI.has(doiSo.text)) return;
    let nhan: ts.Expression = n.expression.expression;
    while (ts.isAwaitExpression(nhan) || ts.isParenthesizedExpression(nhan)) nhan = nhan.expression;
    const nguoiNhan = nhan.getText(t.sf);
    let ham: ts.Node | undefined = n.parent;
    while (ham && !laHam(ham)) ham = ham.parent;
    let nguon = "(không thấy khai báo)";
    if (ham && ts.isIdentifier(nhan)) {
      duyet(ham, (m) => {
        if (ts.isVariableDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === nhan.getText(t.sf) && m.initializer) nguon = m.initializer.getText(t.sf).replace(/\s+/g, " ");
      });
    }
    ra.push({ vi_tri: `${t.tuongDoi}:${dong(t.sf, n)}`, bang: doiSo.text, nguoiNhan, nguon });
  });
  return ra;
}

function khongCachLayKhac(t: ReturnType<typeof doc>): void {
  const ds = importCuaTep(t);
  for (const c of CACH_LAY_KHAC) expect(ds.some((i) => i.ten === c), `${t.tuongDoi}: import ${c}`).toBe(false);
  expect(ds.some((i) => i.tu === "postgres" || /drizzle-orm\/postgres-js/.test(i.tu)), `${t.tuongDoi}: import postgres / drizzle postgres-js`).toBe(false);
  let taoKetNoi = 0;
  duyet(t.sf, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ["postgres", "drizzle"].includes(n.expression.text)) taoKetNoi++;
  });
  expect(taoKetNoi, `${t.tuongDoi}: tự dựng kết nối`).toBe(0);
}

describe("đường đề xuất → từ chối: mọi lần ghi audit_logs / ai_pending_actions đi qua getDb() của server/db/connection (= layDbTheoKenh trong ca phát lại)", () => {
  const COPILOT = doc("server/services/aiCopilotActions.ts");
  const SYSTEM = doc("server/db/system.ts");
  const AUDIT = doc("server/services/auditTrailService.ts");

  it("★★★ aiCopilotActions.ts: `getDb` import từ module connection; mọi lần ghi ai_pending_actions lấy `db` từ `await getDb()` trong CHÍNH hàm bao (liệt kê file:dòng)", () => {
    const imp = importCuaTep(COPILOT).filter((i) => i.ten === "getDb");
    expect(imp.map((i) => i.tu)).toEqual([MODULE_KET_NOI]);
    khongCachLayKhac(COPILOT);
    const ghi = lanGhi(COPILOT);
    const bang = ghi.map((g) => `${g.vi_tri} ${g.bang} ← ${g.nguoiNhan} = ${g.nguon}`).join("\n");
    expect(ghi.length, `phải thấy các lần ghi của đường đề xuất/từ chối:\n${bang}`).toBeGreaterThanOrEqual(8);
    for (const g of ghi) {
      expect(g.nguoiNhan, `${g.vi_tri}: người nhận lời gọi ghi`).toBe("db");
      expect(g.nguon, `${g.vi_tri}: nguồn của db\n${bang}`).toBe("await getDb()");
    }
  });
  it("★★★ db/system.ts `createAuditLog`: `getDb` import từ `./connection` (= cùng module); `const db = executor ?? (await getDb())`; ghi audit_logs trên `db`", () => {
    const imp = importCuaTep(SYSTEM).filter((i) => i.ten === "getDb");
    expect(imp.map((i) => i.tu)).toEqual([MODULE_KET_NOI]);
    khongCachLayKhac(SYSTEM);
    const ghi = lanGhi(SYSTEM).filter((g) => g.bang === "auditLogs");
    expect(ghi.length).toBeGreaterThanOrEqual(1);
    for (const g of ghi) {
      expect(g.nguoiNhan, g.vi_tri).toBe("db");
      expect(g.nguon, `${g.vi_tri}: nguồn của db`).toBe("executor ?? (await getDb())");
    }
  });
  it("★★★ auditTrailService.ts `logCrudOperation` gọi `createAuditLog` với ĐÚNG MỘT đối số (không truyền executor ⇒ rơi về `getDb()` của kênh); aiCopilotActions chỉ import `logCrudOperation`, không `logCrudOperationInTx`", () => {
    let goi = 0;
    duyet(AUDIT.sf, (n) => {
      if (!ts.isFunctionDeclaration(n) || n.name?.text !== "logCrudOperation") return;
      duyet(n, (m) => {
        if (ts.isCallExpression(m) && ts.isPropertyAccessExpression(m.expression) && m.expression.name.text === "createAuditLog") {
          goi++;
          expect(m.arguments.length, `${AUDIT.tuongDoi}:${dong(AUDIT.sf, m)} createAuditLog phải một đối số`).toBe(1);
        }
      });
    });
    expect(goi).toBe(1);
    const ten = importCuaTep(COPILOT).map((i) => i.ten);
    expect(ten).toContain("logCrudOperation");
    expect(ten).not.toContain("logCrudOperationInTx");
    // mọi lời gọi logCrudOperation trong aiCopilotActions có đúng 2 đối số (context, entry) — không có đối số thứ ba
    duyet(COPILOT.sf, (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "logCrudOperation") {
        expect(n.arguments.length, `${COPILOT.tuongDoi}:${dong(COPILOT.sf, n)} logCrudOperation`).toBe(2);
      }
    });
  });
  it("★★★ ba tệp phát lại đều thay `getDb` bằng `layDbTheoKenh(kenh)` trong mock của module connection (cùng module mà các tệp trên import)", () => {
    for (const t of ["phatLaiFixture.test.ts", "phatLaiLuot.test.ts", "phatLaiFixture.epDo.db.test.ts"]) {
      const nguon = fs.readFileSync(path.join(__dirname, t), "utf8");
      expect(nguon, t).toMatch(/vi\.mock\("\.\.\/db\/connection"/);
      expect(nguon, t).toMatch(/getDb:\s*async\s*\(\)\s*=>\s*layDbTheoKenh\(kenh\)/);
    }
    expect(path.relative(GOC, MODULE_KET_NOI).replace(/\\/g, "/")).toBe("server/db/connection");
    expect(fs.existsSync(`${MODULE_KET_NOI}.ts`)).toBe(true);
  });
});
