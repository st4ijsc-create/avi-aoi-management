/**
 * Khoá CẤU TRÚC của `phatLaiLuot.test.ts` (vòng ghi ⇒ đóng gói ⇒ phát lại với sổ THẬT): tệp này từng rò +6 `audit_logs` / +2 `ai_pending_actions` mỗi lượt cổng (người dùng thử qua `taoNguoiDungTest`,
 * ghi sổ qua kết nối chung, dọn bằng `db.delete`) — giờ mọi ca chạm DB chạy TRONG giao dịch luôn ROLLBACK và đếm rò rỉ theo userId bằng kết nối riêng (cùng khuôn `phatLaiFixture.test.ts`).
 * THUẦN: chỉ đọc mã nguồn bằng AST; KHÔNG chạm CSDL.
 * ĐỘT BIẾN PHẢI BẮT: import lại `taoNguoiDungTest` · thêm `.delete(` / `DELETE FROM` · bỏ `throw …Rollback…` cuối giao dịch · catch nuốt MỌI lỗi · bỏ phép đếm rò rỉ khỏi `finally` ·
 * bỏ mock `getDb` hoặc bốn hàm kết nối khác · bỏ `afterEach(kiemKhongLot)` · gọi `chay`/`ghiFixture` ngoài `trongRollback`.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const nguon = fs.readFileSync(path.join(__dirname, "phatLaiLuot.test.ts"), "utf8");
const sf = ts.createSourceFile("phatLaiLuot.test.ts", nguon, ts.ScriptTarget.Latest, true);
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function duyet(fn: (n: ts.Node) => void): void {
  const di = (n: ts.Node) => {
    fn(n);
    ts.forEachChild(n, di);
  };
  di(sf);
}

describe("phatLaiLuot.test.ts — giao dịch luôn ROLLBACK, chỉ nuốt Rollback", () => {
  it("★★★ `.transaction(cb)`: câu CUỐI của `cb` là `throw new …Rollback…()`; kênh trả về null trong `finally`", () => {
    let coGiaoDichHoanTac = false;
    duyet((n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "transaction") {
        for (const a of n.arguments) {
          if (!(ts.isArrowFunction(a) || ts.isFunctionExpression(a)) || !ts.isBlock(a.body)) continue;
          const lenhCuoi = a.body.statements[a.body.statements.length - 1];
          if (lenhCuoi && ts.isThrowStatement(lenhCuoi) && lenhCuoi.expression && /rollback/i.test(lenhCuoi.expression.getText(sf))) coGiaoDichHoanTac = true;
        }
      }
    });
    expect(coGiaoDichHoanTac, "thiếu giao dịch ROLLBACK ở cuối").toBe(true);
    expect(nguon).toMatch(/finally\s*\{[\s\S]{0,900}?kenh\.db\s*=\s*null;\s*\}/);
  });
  it("★★★ đúng MỘT `catch (e)` và nó chỉ gọi `nuotRollback(e)` (nuốt mọi lỗi ⇒ xanh giả trên mọi lệch)", () => {
    const catchCoBien: string[] = [];
    duyet((n) => {
      if (ts.isCatchClause(n) && n.variableDeclaration && ts.isIdentifier(n.variableDeclaration.name)) {
        const ten = n.variableDeclaration.name.text;
        const dung = new RegExp(`^\\{\\s*nuotRollback\\(${ten}\\);\\s*\\}$`).test(n.block.getText(sf).trim());
        catchCoBien.push(dung ? "dung" : `sai: ${n.block.getText(sf).trim().slice(0, 80)}`);
      }
    });
    expect(catchCoBien).toEqual(["dung"]);
  });
  it("★★★ không DELETE / TRUNCATE / `.delete(`; không dùng `taoNguoiDungTest`; `insert(users)` gọi trên `tx`", () => {
    let goiDelete = 0;
    let chenQuaTx = false;
    duyet((n) => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
      if (n.expression.name.text === "delete") goiDelete++;
      if (n.expression.name.text === "insert" && n.arguments[0]?.getText(sf) === "users") chenQuaTx = /^tx\b/.test(n.expression.expression.getText(sf).replace(/^\(?await\s+/, ""));
    });
    expect(goiDelete).toBe(0);
    expect(/DELETE\s+FROM|TRUNCATE/i.test(boChuThich(nguon))).toBe(false);
    expect(/taoNguoiDungTest|nguoiDungTest/.test(boChuThich(nguon))).toBe(false);
    expect(chenQuaTx, "`insert(users)` phải gọi trên `tx`").toBe(true);
  });
});

describe("phatLaiLuot.test.ts — không để lại hàng nào trong CSDL", () => {
  it("★★★ phát hiện RÒ RỈ trong `finally` TRƯỚC khi trả kênh: `demHangRoRi(nguoiId)` bằng kết nối riêng (cả khi ca đỏ) ⇒ `kenh.lot.push(cauBaoRoRi(...))` ⇒ `afterEach(kiemKhongLot)` làm ca ĐỎ", () => {
    expect(nguon).toMatch(/finally\s*\{[\s\S]{0,300}?if \(nguoiId !== null\) await ghiNhanRoRi\(kenh, nguoiId\);[\s\S]{0,100}?kenh\.db\s*=\s*null;/);
    expect(nguon, "khởi tạo kênh phải có `goi: {}`").toMatch(/vi\.hoisted\(\(\): KenhGiaoDich => \(\{ db: null, lot: \[\], goi: \{\} \}\)\)/);
  });
  it("★★★ mock `../db/connection`: `getDb` = `layDbTheoKenh(kenh)`; bốn hàm kết nối khác đè bằng `ghiNoiKhac`; `afterEach`/`afterAll` gọi `kiemKhongLot`", () => {
    expect(nguon).toMatch(/vi\.mock\("\.\.\/db\/connection"/);
    expect(nguon).toMatch(/getDb:\s*async\s*\(\)\s*=>\s*layDbTheoKenh\(kenh\)/);
    for (const ten of ["getJobsDb", "getReadDb", "openSessionClient", "getNotifyClient"]) {
      expect(nguon, ten).toMatch(new RegExp(`${ten}:\\s*(async\\s*)?\\(\\)\\s*=>\\s*ghiNoiKhac\\(kenh,\\s*"${ten}"\\)`));
    }
    expect(nguon).toMatch(/afterEach\(\(\)\s*=>\s*kiemKhongLot\(kenh\)\)/);
    expect(nguon).toMatch(/afterAll\(\(\) => \{\s*kiemKhongLot\(kenh\);/);
  });
  it("★★★ `getDb` thật chỉ lấy qua `vi.importActual`; không import `getDb` thẳng (sẽ là bản bị mock)", () => {
    expect(nguon).toMatch(/vi\.importActual<typeof import\("\.\.\/db\/connection"\)>\("\.\.\/db\/connection"\)/);
    expect(/import\s*\{[^}]*\bgetDb\b[^}]*\}\s*from\s*"\.\.\/db\/connection"/.test(nguon)).toBe(false);
  });
  it("★★★ mọi ca chạm sổ (`ghiFixture` / `chay`) nằm TRONG `trongRollback(async (uid) => …)`; hook `beforeAll` không còn tạo người dùng hay chạy lượt", () => {
    const tenHook = /beforeAll\(\(\) => \{([\s\S]*?)\n\}\);/.exec(nguon);
    expect(tenHook, "beforeAll đồng bộ, không chạm DB").not.toBeNull();
    expect(/ghiFixture|chay\(|taoQuanLyLuotChay/.test(tenHook![1]!)).toBe(false);
    const caDb = [...nguon.matchAll(/", \(\) => trongRollback\(async \(uid\) => \{/g)].length;
    expect(caDb, "đúng 3 ca chạm DB bọc trong trongRollback").toBe(3);
  });
});

describe("phatLaiFixture.epDo.db.test.ts — ca ép `apply_diff` bị từ chối, đếm theo userId", () => {
  const ep = fs.readFileSync(path.join(__dirname, "phatLaiFixture.epDo.db.test.ts"), "utf8");
  it("★★★ ca thứ 3: đổi gốc hộp cát NGAY LÚC lượt bắt đầu, khẳng định đường từ chối đã chạy thật (đếm `ai_action_denied` theo userId TRONG giao dịch) rồi mới đo rò rỉ trước/sau ROLLBACK", () => {
    expect(ep).toMatch(/kieu === "tu-choi-apply-diff" && !daDoiGoc/);
    expect(ep).toMatch(/process\.env\.AI_REPO_SANDBOX_ROOTS = `phatlaifx=Phat lai fixture\|\$\{ngoai\}`/);
    expect(ep).toMatch(/eq\(auditLogs\.action, "ai_action_denied"\)/);
    expect(ep).toMatch(/epDo\(null, \{\}, "tu-choi-apply-diff"\)/);
    expect(ep).toMatch(/expect\(k\.daTuChoi[\s\S]{0,200}?\)\.toBeGreaterThan\(0\)/);
    // đếm rò rỉ nằm TRƯỚC khi trả kênh
    expect(ep).toMatch(/kq\.daTuChoi = [\s\S]{0,200}?kq\.roTruocRollback = await demHangRoRi\(kq\.uid!\);\s*kenh\.db = null;/);
    expect(/\.delete\(|DELETE\s+FROM|TRUNCATE/i.test(boChuThich(ep))).toBe(false);
  });
});
