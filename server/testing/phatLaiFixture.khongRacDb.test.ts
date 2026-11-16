/**
 * Khoá CẤU TRÚC của `phatLaiFixture.test.ts` + `kenhGiaoDich.ts` để phát lại không quay lại để rác trong `_test` (mỗi lượt cổng từng để ~240 hàng `audit_logs` — bảng WORM, không xoá được — và ~80 `ai_pending_actions`).
 * THUẦN: chỉ đọc mã nguồn bằng AST; KHÔNG chạm CSDL. HÀNH VI (lỗi trong giao dịch lan ra, ngoài giao dịch ⇒ ĐỎ) được kiểm ở `kenhGiaoDich.test.ts`; phép đo THẬT là phép đếm rộng trước/sau một lượt (dieu-phoi): 0 bảng đổi.
 * ĐỘT BIẾN PHẢI BẮT: bỏ `throw …Rollback…` cuối giao dịch · catch nuốt MỌI lỗi · thêm lại `db.delete(...)` / `DELETE FROM` · import lại `taoNguoiDungTest` · bỏ mock `getDb` hoặc bốn hàm kết nối khác ·
 * không trả kênh về `null` · chèn người dùng ngoài giao dịch.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const doc = (t: string) => {
  const p = path.join(__dirname, t);
  const nguon = fs.readFileSync(p, "utf8");
  return { nguon, sf: ts.createSourceFile(p, nguon, ts.ScriptTarget.Latest, true) };
};
const PHAT_LAI = doc("phatLaiFixture.test.ts");
const KENH = doc("kenhGiaoDich.ts");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function duyet(sf: ts.SourceFile, fn: (n: ts.Node) => void): void {
  const di = (n: ts.Node) => {
    fn(n);
    ts.forEachChild(n, di);
  };
  di(sf);
}

describe("phatLaiFixture.test.ts — giao dịch luôn ROLLBACK, chỉ nuốt Rollback", () => {
  it("★★★ `.transaction(cb)`: câu CUỐI của `cb` là `throw new …Rollback…()`; kênh trả về null trong `finally`", () => {
    let coGiaoDichHoanTac = false;
    duyet(PHAT_LAI.sf, (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "transaction") {
        for (const a of n.arguments) {
          if (!(ts.isArrowFunction(a) || ts.isFunctionExpression(a)) || !ts.isBlock(a.body)) continue;
          const lenhCuoi = a.body.statements[a.body.statements.length - 1];
          if (lenhCuoi && ts.isThrowStatement(lenhCuoi) && lenhCuoi.expression && /rollback/i.test(lenhCuoi.expression.getText(PHAT_LAI.sf))) coGiaoDichHoanTac = true;
        }
      }
    });
    expect(coGiaoDichHoanTac, "thiếu giao dịch ROLLBACK ở cuối").toBe(true);
    expect(PHAT_LAI.nguon).toMatch(/finally\s*\{[\s\S]{0,700}?kenh\.db\s*=\s*null;\s*\}/);
  });
  it("★★★ khối `catch (e)` ngoài CHỈ gọi `nuotRollback(e)` (hành vi: chỉ nuốt RollbackPhatLai, ném lại mọi lỗi khác — kiểm ở kenhGiaoDich.test.ts); nuốt mọi lỗi ⇒ phát lại XANH GIẢ trên mọi lệch", () => {
    const catchCoBien: string[] = [];
    duyet(PHAT_LAI.sf, (n) => {
      if (ts.isCatchClause(n) && n.variableDeclaration && ts.isIdentifier(n.variableDeclaration.name)) {
        const ten = n.variableDeclaration.name.text;
        const dung = new RegExp(`^\\{\\s*nuotRollback\\(${ten}\\);\\s*\\}$`).test(n.block.getText(PHAT_LAI.sf).trim());
        catchCoBien.push(dung ? "dung" : `sai: ${n.block.getText(PHAT_LAI.sf).trim().slice(0, 80)}`);
      }
    });
    expect(catchCoBien, "đúng MỘT `catch (e)` và nó chỉ gọi nuotRollback(e)").toEqual(["dung"]);
  });
  it("★★★ không DELETE / TRUNCATE / `.delete(` ở cả hai tệp", () => {
    for (const t of [PHAT_LAI, KENH]) {
      let goiDelete = 0;
      duyet(t.sf, (n) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "delete") goiDelete++;
      });
      expect(goiDelete).toBe(0);
      expect(/DELETE\s+FROM|TRUNCATE/i.test(boChuThich(t.nguon))).toBe(false);
    }
  });
});

describe("phatLaiFixture.test.ts — không để lại hàng nào trong CSDL", () => {
  it("★★★ phát hiện RÒ RỈ ngay trong ca: trong `finally` TRƯỚC khi trả kênh, đếm `demHangRoRi(uid)` bằng kết nối riêng (cả khi ca đỏ) và đẩy `cauBaoRoRi(...)` vào `kenh.lot` ⇒ `afterEach(kiemKhongLot)` làm ca ĐỎ", () => {
    const n = PHAT_LAI.nguon;
    expect(n).toMatch(/finally\s*\{[\s\S]{0,300}?if \(uid !== null\) await ghiNhanRoRi\(kenh, uid\);[\s\S]{0,100}?kenh\.db\s*=\s*null;/);
    expect(n, "khởi tạo kênh phải có `goi: {}` để có bản tóm tắt chẩn đoán").toMatch(/vi\.hoisted\(\(\): KenhGiaoDich => \(\{ db: null, lot: \[\], goi: \{\} \}\)\)/);
    // việc đếm + ghi `kenh.lot` nằm trong `ghiNhanRoRi` (kiemRoRiDb.ts, kiểm hành vi bằng bộ đếm giả) — tệp ca KHÔNG tự `catch` thêm (AST trên chỉ cho đúng MỘT `catch (e)` — của nuotRollback)
    expect(n).not.toMatch(/demHangRoRi\(uid\)\.catch\(/);
  });
  it("★★★ không dùng `taoNguoiDungTest`; `insert(users)` gọi trên `tx` (tham số giao dịch)", () => {
    expect(/taoNguoiDungTest|nguoiDungTest/.test(boChuThich(PHAT_LAI.nguon))).toBe(false);
    let chenQuaTx = false;
    duyet(PHAT_LAI.sf, (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "insert" && n.arguments[0]?.getText(PHAT_LAI.sf) === "users") {
        chenQuaTx = /^tx\b/.test(n.expression.expression.getText(PHAT_LAI.sf).replace(/^\(?await\s+/, ""));
      }
    });
    expect(chenQuaTx, "`insert(users)` phải gọi trên `tx`").toBe(true);
  });
  it("★★★ mock `../db/connection`: `getDb` = `layDbTheoKenh(kenh)`; `getJobsDb` / `getReadDb` / `openSessionClient` / `getNotifyClient` đều đè bằng `ghiNoiKhac` (lộ ngay nếu đường phát lại chạm chúng)", () => {
    const n = PHAT_LAI.nguon;
    expect(n).toMatch(/vi\.mock\("\.\.\/db\/connection"/);
    expect(n).toMatch(/getDb:\s*async\s*\(\)\s*=>\s*layDbTheoKenh\(kenh\)/);
    for (const ten of ["getJobsDb", "getReadDb", "openSessionClient", "getNotifyClient"]) {
      expect(n, ten).toMatch(new RegExp(`${ten}:\\s*(async\\s*)?\\(\\)\\s*=>\\s*ghiNoiKhac\\(kenh,\\s*"${ten}"\\)`));
    }
    expect(n).toMatch(/afterEach\(\(\)\s*=>\s*kiemKhongLot\(kenh\)\)/);
    expect(n).toMatch(/afterAll\(async \(\) => \{\s*kiemKhongLot\(kenh\);/);
  });
  it("★★★ `getDb` thật chỉ lấy qua `vi.importActual` (để mở giao dịch); không import `getDb` thẳng (sẽ là bản bị mock)", () => {
    expect(PHAT_LAI.nguon).toMatch(/vi\.importActual<typeof import\("\.\.\/db\/connection"\)>\("\.\.\/db\/connection"\)/);
    expect(/import\s*\{[^}]*\bgetDb\b[^}]*\}\s*from\s*"\.\.\/db\/connection"/.test(PHAT_LAI.nguon)).toBe(false);
  });
});
