/**
 * Khoá CẤU TRÚC của `phatLaiFixture.test.ts` để nó không quay lại để rác trong `_test` (mỗi lượt cổng từng để ~240 hàng `audit_logs` — bảng WORM, không xoá được — và ~80 `ai_pending_actions`).
 * THUẦN: chỉ đọc mã nguồn bằng AST; KHÔNG chạm CSDL. Phép đo THẬT là phép đếm rộng trước/sau một lượt chạy (dieu-phoi / kiem-dinh): 0 bảng đổi.
 * ĐỘT BIẾN PHẢI BẮT: bỏ `throw …Rollback…` cuối giao dịch · thêm lại `db.delete(...)` / `DELETE FROM` · import lại `taoNguoiDungTest` · bỏ mock `getDb` hoặc để nó rơi về kết nối chung ·
 * không trả `kenh.db` về `null` sau ca · mở `getDb` thật ngoài `importActual`.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const TEP = path.join(__dirname, "phatLaiFixture.test.ts");
const nguon = fs.readFileSync(TEP, "utf8");
const sf = ts.createSourceFile(TEP, nguon, ts.ScriptTarget.Latest, true);

function duyet(fn: (n: ts.Node) => void): void {
  const di = (n: ts.Node) => {
    fn(n);
    ts.forEachChild(n, di);
  };
  di(sf);
}

describe("phatLaiFixture.test.ts — không để lại hàng nào trong CSDL", () => {
  it("★★★ mỗi ca chạy TRONG `.transaction(cb)` mà `cb` luôn ném một giá trị tên có 'rollback' (ROLLBACK)", () => {
    let coGiaoDichHoanTac = false;
    duyet((n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "transaction") {
        for (const a of n.arguments) {
          if (!(ts.isArrowFunction(a) || ts.isFunctionExpression(a))) continue;
          const lenhCuoi = ts.isBlock(a.body) ? a.body.statements[a.body.statements.length - 1] : undefined;
          // câu CUỐI của thân giao dịch là `throw new …Rollback…()` — không phải một nhánh có điều kiện bên trong
          if (lenhCuoi && ts.isThrowStatement(lenhCuoi) && lenhCuoi.expression && /rollback/i.test(lenhCuoi.expression.getText(sf))) coGiaoDichHoanTac = true;
        }
      }
    });
    expect(coGiaoDichHoanTac, "thiếu giao dịch ROLLBACK ở cuối").toBe(true);
  });
  it("★★★ KHÔNG DELETE / TRUNCATE: không gọi `.delete(`, không câu `DELETE FROM` / `TRUNCATE`", () => {
    let goiDelete = 0;
    duyet((n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "delete") goiDelete++;
    });
    expect(goiDelete).toBe(0);
    expect(/DELETE\s+FROM|TRUNCATE/i.test(nguon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"))).toBe(false);
  });
  it("★★★ không dùng `taoNguoiDungTest` (helper cũ DELETE trên kết nối chung); người dùng thử chèn bằng `tx.insert(users)` TRONG giao dịch", () => {
    expect(/taoNguoiDungTest|nguoiDungTest/.test(nguon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"))).toBe(false);
    let chenQuaTx = false;
    duyet((n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "insert" && n.arguments[0]?.getText(sf) === "users") {
        chenQuaTx = /^tx\b/.test(n.expression.expression.getText(sf).replace(/^\(?await\s+/, ""));
      }
    });
    expect(chenQuaTx, "`insert(users)` phải gọi trên `tx`").toBe(true);
  });
  it("★★★ `getDb` của module `../db/connection` bị thay bằng bản trả giao dịch của ca (`kenh.db ?? null`) — KHÔNG rơi về kết nối chung", () => {
    expect(nguon).toMatch(/vi\.mock\("\.\.\/db\/connection"/);
    expect(nguon).toMatch(/getDb:\s*async\s*\(\)\s*=>\s*layDbTheoKenh\(kenh\)/);
    // hành vi (trong giao dịch ⇒ giao dịch; ngoài ⇒ null + ghi lại + ĐỎ) được kiểm ở `kenhGiaoDich.test.ts`; ở đây khoá việc NỐI nó vào ca
    expect(nguon).toMatch(/afterEach\(\(\)\s*=>\s*kiemKhongLot\(kenh\)\)/);
    expect(nguon).toMatch(/afterAll\(async \(\) => \{\s*kiemKhongLot\(kenh\);/);
  });
  it("★★★ kênh được TRẢ VỀ `null` trong `finally` sau mỗi ca; và `getDb` thật chỉ lấy qua `vi.importActual` (để mở giao dịch)", () => {
    expect(nguon).toMatch(/finally\s*\{\s*kenh\.db\s*=\s*null;\s*\}/);
    expect(nguon).toMatch(/vi\.importActual<typeof import\("\.\.\/db\/connection"\)>\("\.\.\/db\/connection"\)/);
    expect(/import\s*\{[^}]*\bgetDb\b[^}]*\}\s*from\s*"\.\.\/db\/connection"/.test(nguon), "không import `getDb` thẳng (sẽ là bản bị mock)").toBe(false);
  });
});
