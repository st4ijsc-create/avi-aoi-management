/**
 * ★★★ CENSUS AST (F5-nhanh, 2026-11-02) — mọi đường GHI vai / isActive / quyền của người dùng (bảng `users`, `permissions`) dọn auth
 * cache của người đó bằng `invalidateAuthUser` — cùng bộ dọn mà `user.update` / `user.updateRole` dùng.
 *
 * Lỗ gốc: `permissions.updateUserRole` ghi `users.role` thẳng, KHÔNG dọn cache ⇒ HTTP phục vụ vai cũ tới 45 s. Lớp lỗi "người ghi thứ N
 * quên": một thủ tục / hàm MỚI ghi hai bảng này mà không dọn ⇒ ĐỎ.
 *
 * Hình dạng (AST, không danh sách tên thủ tục):
 *   (1) `server/routers/permissionsRouter.ts`: mọi thuộc tính của `router({...})` mà thân có lời gọi ghi drizzle
 *       `.insert|update|delete(users|permissions)` phải chứa lời gọi `invalidateAuthUser(`.
 *   (2) `server/db/auth.ts`: mọi hàm export ghi `users` phải ở CAN_DON (chứa `invalidateAuthUser(`) hoặc MIEN (có lý do).
 *   (3) toàn `server/**` (không test): tệp ghi `users`/`permissions` phải là một trong hai tệp trên hoặc MIEN_TEP (có lý do; chỉ được
 *       THU HẸP).
 * Có ĐỘT BIẾN (chạy tay, ghi trong báo cáo F5-nhanh): bỏ dọn ở updateUserRole ⇒ (1) ĐỎ; thêm `db.update(users)` ở router khác ⇒ (3) ĐỎ.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const GOC = process.cwd();
const rel = (p: string) => relative(GOC, p).replace(/\\/g, "/");
const GHI_BANG = /\.(?:insert|update|delete)\(\s*(?:schema\.)?(?:users|permissions)\s*\)/;
const DON = "invalidateAuthUser(";

/** Hàm trong db/auth.ts ghi `users` mà KHÔNG đổi vai / isActive / quyền (không có gì trong auth cache trở nên SAI theo chiều MỞ). */
const MIEN_HAM_AUTH: Record<string, string> = {
  createLocalUser: "tạo người dùng MỚI — chưa có phiên nào trong cache",
  createUser: "tạo người dùng MỚI (openId sinh mới) — chưa có phiên nào trong cache",
  updateUserLoginAttempts: "đếm lần sai + lockedUntil — sdk không đọc lockedUntil; khoá chỉ chặn đăng nhập MỚI (kiểm kê C2)",
};
/** Hàm trong db/auth.ts PHẢI dọn (ghi vai / isActive / danh tính / cờ trong hàng cache). */
const PHAI_DON_HAM_AUTH = ["upsertUser", "updateUserRole", "updateUser", "deleteUser"];

const MIEN_TEP: Record<string, string> = {
  "server/routers/twoFactorRouter.ts": "chỉ BẬT twoFactorEnabled của CHÍNH người gọi (không vai / isActive / quyền; chiều SIẾT) — kiểm kê H",
  "server/testing/nguoiDungTest.ts": "bộ dựng người dùng cho lưới (INSERT người mới)",
};

function liet(dir: string, out: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    if (ten === "node_modules") continue;
    const p = resolve(dir, ten);
    const st = statSync(p);
    if (st.isDirectory()) liet(p, out);
    else if (/\.ts$/.test(ten) && !/\.test\.ts$/.test(ten) && !/\.d\.ts$/.test(ten)) out.push(p);
  }
  return out;
}
const parse = (p: string) => ts.createSourceFile(p, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true);

describe("★★★ F5-nhanh — census dọn auth cache khi đổi vai / quyền", () => {
  it("(1) permissionsRouter: mọi thủ tục ghi users/permissions gọi invalidateAuthUser", () => {
    const p = resolve(GOC, "server/routers/permissionsRouter.ts");
    const sf = parse(p);
    const ghi: string[] = [];
    const thieu: string[] = [];
    const di = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "router" && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
        for (const pr of n.arguments[0].properties) {
          if (!ts.isPropertyAssignment(pr)) continue;
          const ten = pr.name.getText(sf);
          const txt = pr.initializer.getText(sf);
          if (!GHI_BANG.test(txt)) continue;
          ghi.push(ten);
          if (!txt.includes(DON)) thieu.push(ten);
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
    // thiết bị đo tự canh: tám thủ tục ghi đã biết lúc viết lưới (kiểm kê B3, B4, D1–D6) phải được THẤY
    expect(ghi).toEqual(
      expect.arrayContaining([
        "updateUserRole", "applyRolePermissions", "upsertPermission", "batchUpdateUserPermissions",
        "deletePermission", "deleteUserPermissions", "applyRoleToUser", "applyBuiltInRoleToUser",
      ]),
    );
    expect(thieu, "thủ tục đổi vai/quyền KHÔNG dọn auth cache").toEqual([]);
  });

  it("(2) db/auth.ts: mọi hàm export ghi users được phân loại; hàm đổi vai/isActive/danh tính gọi invalidateAuthUser", () => {
    const p = resolve(GOC, "server/db/auth.ts");
    const sf = parse(p);
    const ghi = new Map<string, string>();
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name && st.body) {
        const txt = st.body.getText(sf);
        if (/\.(?:insert|update|delete)\(\s*users\s*\)/.test(txt)) ghi.set(st.name.text, txt);
      }
    }
    expect([...ghi.keys()]).toEqual(expect.arrayContaining(PHAI_DON_HAM_AUTH));
    const loi: string[] = [];
    for (const [ten, txt] of ghi) {
      if (MIEN_HAM_AUTH[ten]) continue;
      if (!txt.includes(DON)) loi.push(`${ten}: ghi users mà không gọi invalidateAuthUser (thêm lời gọi, hoặc MIEN_HAM_AUTH kèm lý do)`);
    }
    for (const ten of Object.keys(MIEN_HAM_AUTH)) if (!ghi.has(ten)) loi.push(`MIEN_HAM_AUTH mồ côi: ${ten}`);
    expect(loi).toEqual([]);
  });

  it("(3) toàn server: chỉ các tệp đã kiểm (permissionsRouter, db/auth) hoặc MIEN_TEP ghi users/permissions", () => {
    const tep = liet(resolve(GOC, "server"))
      .filter((p) => GHI_BANG.test(readFileSync(p, "utf8")))
      .map(rel)
      .filter((f) => !/\/__[^/]*$/.test(f)); // bộ dựng lưới `__*.ts` (không chạy trong sản phẩm)
    const ngoai = tep.filter((f) => f !== "server/routers/permissionsRouter.ts" && f !== "server/db/auth.ts" && !MIEN_TEP[f]);
    expect(ngoai, "tệp MỚI ghi users/permissions — phải dọn auth cache (invalidateAuthUser) và được thêm vào lưới").toEqual([]);
    const moCoi = Object.keys(MIEN_TEP).filter((f) => !tep.includes(f));
    expect(moCoi, "MIEN_TEP chỉ được thu hẹp: xoá mục mồ côi").toEqual([]);
  });
});
