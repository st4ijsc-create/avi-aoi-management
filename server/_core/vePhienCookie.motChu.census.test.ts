/**
 * ★★★ CENSUS (W-hợp-nhất 2026-10-26) — MỘT chủ đọc vé phiên từ header Cookie và băm "phần đã ký": `server/_core/vePhienCookie.ts`.
 * Lỗ lớp "đường thứ N quên": mỗi nơi tự viết regex / `cookie.parse` cho `app_session_id` đã từng lệch auth (khoảng trắng, tên lặp, %-mã) ⇒ xô giới hạn
 * riêng cho từng biến thể văn bản của MỘT vé. Luật: trong server/** (không test), chỉ `vePhienCookie.ts` được `import … from "cookie"` để lấy `COOKIE_NAME` ra khỏi header;
 * và không nơi nào ngoài nó tự cắt `header.payload` của vé (`.split(".")` rồi nối lại bằng ".") — dùng `phanDaKyCuaVe` / `bamPhanDaKy`.
 * Ngoại lệ có lý do: `pendingTwoFactor.ts` đọc cookie VÉ 2FA (tên khác, không phải vé phiên).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const GOC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const CHU = "server/_core/vePhienCookie.ts";
const MIEN_COOKIE_LIB: Readonly<Record<string, string>> = {
  "server/_core/pendingTwoFactor.ts": "cookie vé 2FA (VE_COOKIE) — không phải vé phiên; đọc `cookie.parse` riêng có chủ đích",
};

function lietKe(d: string, ra: string[] = []): string[] {
  for (const f of readdirSync(d)) {
    if (f === "node_modules" || f === "dist") continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) lietKe(p, ra);
    else if (/\.(ts|mjs|js)$/.test(f) && !/\.test\.(ts|mjs|js)$/.test(f) && !/\.d\.ts$/.test(f)) ra.push(p);
  }
  return ra;
}

export function nhapThuVienCookie(duongDan: string, noiDung: string): boolean {
  const sf = ts.createSourceFile(duongDan, noiDung, ts.ScriptTarget.Latest, true);
  let co = false;
  const duyet = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text === "cookie") co = true;
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === "cookie") co = true;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "require" && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === "cookie") co = true;
    ts.forEachChild(n, duyet);
  };
  duyet(sf);
  return co;
}

/** Ghép lại `header.payload` bằng tay từ `.split(".")` (dấu hiệu tự cắt phần đã ký). */
export function tuCatPhanDaKy(noiDung: string): boolean {
  return /\.split\(\s*["']\.["']\s*\)[\s\S]{0,200}\[\s*0\s*\][\s\S]{0,40}\+\s*["']\.["']\s*\+[\s\S]{0,40}\[\s*1\s*\]|`\$\{\s*\w+\[0\]\s*\}\.\$\{\s*\w+\[1\]\s*\}`/.test(noiDung);
}

describe("MỘT chủ đọc vé phiên", () => {
  const tep = lietKe(join(GOC, "server"));
  const rel = (p: string) => relative(GOC, p).split(sep).join("/");

  it("★ chỉ vePhienCookie.ts (và ngoại lệ có lý do) import thư viện `cookie`", () => {
    const nhap = tep.filter((p) => nhapThuVienCookie(p, readFileSync(p, "utf8"))).map(rel).sort();
    expect(nhap).toEqual([CHU, ...Object.keys(MIEN_COOKIE_LIB)].sort());
  });

  it("★ không nơi nào ngoài vePhienCookie.ts tự cắt `header.payload` của vé", () => {
    const sai = tep.filter((p) => rel(p) !== CHU && tuCatPhanDaKy(readFileSync(p, "utf8"))).map(rel);
    expect(sai).toEqual([]);
  });

  it("cầu chì: chủ tồn tại, export đủ ba hàm và còn được auth + hai tầng limiter dùng", () => {
    const chu = readFileSync(join(GOC, CHU), "utf8");
    for (const h of ["docVePhienTuCookie", "coHinhJws", "phanDaKyCuaVe", "bamPhanDaKy"]) expect(chu).toContain(`export function ${h}`);
    for (const nguoiDung of ["server/_core/sdk.ts", "server/_core/trpcGioiHanThuTuc.ts", "server/_core/rateLimitConfig.ts", "server/_core/context.ts"]) {
      expect(readFileSync(join(GOC, nguoiDung), "utf8"), nguoiDung).toContain("vePhienCookie");
    }
  });

  it("vị từ không mù: tệp mã giả import cookie / tự cắt phần đã ký ⇒ BÁO; tệp sạch ⇒ không", () => {
    expect(nhapThuVienCookie("x.ts", `import { parse } from "cookie";`)).toBe(true);
    expect(nhapThuVienCookie("x.ts", `const c = require("cookie");`)).toBe(true);
    expect(nhapThuVienCookie("x.ts", `const c = await import("cookie");`)).toBe(true);
    expect(nhapThuVienCookie("x.ts", `import { parse } from "cookie-parser";`)).toBe(false);
    expect(tuCatPhanDaKy("const p = t.split('.'); const k = p[0] + '.' + p[1];")).toBe(true);
    expect(tuCatPhanDaKy("const p = t.split('.'); return `${p[0]}.${p[1]}`;")).toBe(true);
    expect(tuCatPhanDaKy("const parts = host.split('.'); return parts.length;")).toBe(false);
  });
});
