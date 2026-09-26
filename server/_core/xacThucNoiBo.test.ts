/**
 * ★★★ Pha 7 / vá **NHÀ TÙ I-4** — **LƯỚI NEO VÀO NGUỒN SINH DỮ LIỆU THẬT.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI — **MỘT LƯỚI XANH TRÊN HÌNH DẠNG DỮ LIỆU KHÔNG TỒN TẠI**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lưới §5 của lượt I-4 **XANH suốt** trong khi cổng buộc-đổi-mật-khẩu đang là **nhà tù thật cho
 * 4/4 tài khoản không-admin đang hoạt động**. Cơ chế của lời nói dối ấy:
 *
 *   · fixture dựng người dùng qua `createUser`, mà hàm ấy **ghi cứng `loginMethod: 'local'`**;
 *   · hàng thật trong DB sản xuất mang **`'password'`** (do `scripts/seed-test-data.mjs` tạo);
 *   · vị từ `loginMethod !== 'local'` từ chối đúng bốn người ấy.
 *
 * ⇒ Lưới đo **chính cái nó tự dựng**, nên nó không bao giờ đỏ được cho lớp lỗi này. Bài học: một
 *   lưới về *hình dạng dữ liệu* phải lấy hình dạng ấy **từ mã sinh ra dữ liệu**, không từ fixture.
 *
 * ⇒ §2 dưới đây **đọc chính `scripts/seed-test-data.mjs` và `server/db/auth.ts`**, rút giá trị mà
 *   chúng **thật sự ghi vào cột `loginMethod`**, rồi đối chiếu **hai chiều** với tập hằng ở
 *   `shared/xacThucNoiBo.ts`. Hai bên lệch nhau ⇒ **ĐỎ**, không cần ai nhớ đếm lại.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÙNG MÙ ĐƯỢC KHAI (đừng đọc màu xanh của file này thành "đã phủ hết")
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. Lưới đọc **mã sinh**, không đọc **DB đang chạy**. Một hàng được ghi tay bằng `psql` với một
 *     `loginMethod` thứ ba vẫn nhốt được chủ nó, và §2 sẽ **không** thấy. Nửa ấy chỉ đóng được
 *     bằng một ràng buộc CHECK trên cột (cần DDL ⇒ ngoài phạm vi lượt vá này) — **nợ đã khai**.
 *  2. `server/_core/oauth.ts` và `server/_core/sdk.ts` ghi giá trị **động** (tên nhà cung cấp từ
 *     request). Không rút được literal ⇒ không neo được. Chúng an toàn theo **chiều đóng**: giá
 *     trị lạ ⇒ `laXacThucNoiBo` trả `false` (§1).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { moiFileDuoi, laFileTest } from "../routers/deployProcedureScan";
import { PHUONG_THUC_XAC_THUC_NOI_BO, laXacThucNoiBo } from "@shared/xacThucNoiBo";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/_core
const GOC = join(TEST_DIR, "..", "..");

const doc = (duongTuongDoi: string): string => readFileSync(join(GOC, ...duongTuongDoi.split("/")), "utf8");

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * BỘ RÚT — hai hình dạng ghi khác nhau, vì hai nguồn sinh viết theo hai ngôn ngữ khác nhau.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Ghi kiểu **đối tượng TS** (`loginMethod: 'local'`) — drizzle `.values({…})`. */
function rutTuDoiTuongTs(src: string): string[] {
  return [...src.matchAll(/\bloginMethod\s*:\s*(['"`])([^'"`]*)\1/g)].map((m) => m[2] as string);
}

/** Cắt một danh sách phân cách bởi dấu phẩy **ở mức ngoài cùng** (bỏ qua `(…)`, `${…}`, chuỗi). */
function catTheoPhayNgoaiCung(s: string): string[] {
  const ra: string[] = [];
  let sau = 0;
  let doSau = 0;
  let nhay: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (nhay) {
      if (c === "\\") i++;
      else if (c === nhay) nhay = null;
      continue;
    }
    if (c === "'" || c === '"') nhay = c;
    else if (c === "(" || c === "{") doSau++;
    else if (c === ")" || c === "}") doSau--;
    else if (c === "," && doSau === 0) {
      ra.push(s.slice(sau, i));
      sau = i + 1;
    }
  }
  ra.push(s.slice(sau));
  return ra.map((t) => t.trim()).filter((t) => t.length > 0);
}

/**
 * Ghi kiểu **`INSERT INTO users (…) VALUES (…)`** — SQL thô của seed script.
 *
 * ⚠ Rút **theo VỊ TRÍ CỘT**, không bằng một regex đoán mò quanh chữ `'password'`: nếu ai chèn thêm
 *   một cột vào giữa, phép rút theo vị trí vẫn đúng, còn regex đoán mò sẽ lặng lẽ trả nhầm ô.
 * @returns literal ở ô `loginMethod`, hoặc `null` nếu ô ấy là giá trị **động** (`${…}`).
 */
function rutTuInsertSql(src: string): string[] {
  const ra: string[] = [];
  const re = /INSERT\s+INTO\s+users\s*\(([^)]*)\)\s*(?:\r?\n\s*)?VALUES\s*\(/gi;
  for (const m of src.matchAll(re)) {
    const cot = catTheoPhayNgoaiCung(m[1] as string).map((c) => c.replace(/["'`]/g, "").trim());
    const viTri = cot.indexOf("loginMethod");
    if (viTri === -1) continue;
    // Từ dấu `(` của VALUES, đi tới `)` **cân bằng** của nó.
    const mo = (m.index as number) + m[0].length;
    let doSau = 1;
    let nhay: string | null = null;
    let i = mo;
    for (; i < src.length && doSau > 0; i++) {
      const c = src[i] as string;
      if (nhay) {
        if (c === "\\") i++;
        else if (c === nhay) nhay = null;
        continue;
      }
      if (c === "'" || c === '"') nhay = c;
      else if (c === "(" || c === "{") doSau++;
      else if (c === ")" || c === "}") doSau--;
    }
    const giaTri = catTheoPhayNgoaiCung(src.slice(mo, i - 1));
    const o = giaTri[viTri];
    if (o === undefined) continue;
    const lit = /^'([^']*)'$/.exec(o) ?? /^"([^"]*)"$/.exec(o);
    if (lit) ra.push(lit[1] as string);
  }
  return ra;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * DANH SÁCH NGUỒN SINH — **đây là thứ tập hằng bị neo vào**, không phải một fixture.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

type Nhan = "noi-bo" | "lien-bang";
interface NguonSinh {
  duong: string;
  nhan: Nhan;
  rut: (src: string) => string[];
  vi: string;
}

/**
 * ⚠⚠ Mỗi mục là một **đường đi thật đã ghi hàng vào `users` trong DB đang chạy**.
 *   · `noi-bo`    — mật khẩu do hệ NÀY giữ ⇒ mọi giá trị nó ghi **PHẢI** được công nhận;
 *   · `lien-bang` — danh tính do IdP ngoài giữ ⇒ mọi giá trị nó ghi **PHẢI KHÔNG** được công nhận.
 */
const NGUON_SINH: readonly NguonSinh[] = [
  {
    duong: "server/db/auth.ts",
    nhan: "noi-bo",
    rut: rutTuDoiTuongTs,
    vi: "`createLocalUser` / `createUserWithPassword` — chủ tầng-DB của lượt tạo tài khoản nội bộ",
  },
  {
    duong: "scripts/seed-test-data.mjs",
    nhan: "noi-bo",
    rut: rutTuInsertSql,
    vi: "đường ĐÃ TẠO 4 tài khoản không-admin đang chạy (`operator1`·`supervisor1`·`maint1`·`engineer1`)",
  },
  {
    duong: "server/_core/samlProvider.ts",
    nhan: "lien-bang",
    rut: rutTuDoiTuongTs,
    vi: "đăng nhập SAML — mật khẩu KHÔNG nằm ở hệ này",
  },
];

const giaTriCua = (nhan: Nhan): string[] => [
  ...new Set(NGUON_SINH.filter((n) => n.nhan === nhan).flatMap((n) => n.rut(doc(n.duong)))),
];

/* ══════════════════════════════════════════════════════════════════════════════════════════════ */

describe("★★★ vá NHÀ TÙ I-4 §1 — `laXacThucNoiBo` FAIL-CLOSED", () => {
  it("công nhận đúng các phần tử của tập hằng", () => {
    for (const v of PHUONG_THUC_XAC_THUC_NOI_BO) {
      expect(laXacThucNoiBo(v), `\`${v}\` ở trong tập hằng mà vị từ lại chối`).toBe(true);
    }
  });

  it("★★★ giá trị LẠ ⇒ KHÔNG nội bộ (hỏng theo chiều ĐÓNG, không mở cửa)", () => {
    for (const v of ["saml", "manus", "google", "oidc", "Local", "LOCAL", "PASSWORD", "", " local "]) {
      expect(laXacThucNoiBo(v), `\`${v}\` không được công nhận là xác thực nội bộ`).toBe(false);
    }
  });

  it("★★ không phải chuỗi ⇒ KHÔNG nội bộ (cột nullable + JSON của `auth.me`)", () => {
    for (const v of [null, undefined, 0, 1, true, {}, [], NaN]) {
      expect(laXacThucNoiBo(v), `\`${String(v)}\` không được công nhận`).toBe(false);
    }
  });
});

describe("★★★★ vá NHÀ TÙ I-4 §2 — tập hằng NEO HAI CHIỀU vào MÃ SINH DỮ LIỆU THẬT", () => {
  it("★★ cầu chì — mọi nguồn sinh còn tồn tại và còn rút ra được giá trị", () => {
    for (const n of NGUON_SINH) {
      expect(existsSync(join(GOC, ...n.duong.split("/"))), `mất nguồn sinh: ${n.duong}`).toBe(true);
      expect(
        n.rut(doc(n.duong)).length,
        `không rút được literal loginMethod nào từ ${n.duong} (${n.vi}) — bộ rút đã trượt hình dạng ⇒ ` +
          "mọi ca dưới đây thành RỖNG NGHĨA, đúng lớp lỗi mà file này sinh ra để diệt",
      ).toBeGreaterThan(0);
    }
  });

  it("★★★★ chiều A — ∀ giá trị mà một nguồn sinh NỘI BỘ ghi ra ⇒ PHẢI được công nhận", () => {
    const thieu = giaTriCua("noi-bo").filter((v) => !laXacThucNoiBo(v));
    expect(
      thieu,
      "⇒ ĐÂY LÀ SỰ CỐ I-4 TÁI DIỄN: một đường tạo tài khoản thật ghi ra giá trị mà vị từ chối ⇒\n" +
        "  chủ của những tài khoản ấy KHÔNG đổi được mật khẩu, và cổng buộc-đổi-mật-khẩu nhốt họ.\n" +
        "⇒ Thêm giá trị ấy vào `PHUONG_THUC_XAC_THUC_NOI_BO` (`shared/xacThucNoiBo.ts`).",
    ).toEqual([]);
  });

  it("★★★★ chiều B — ∀ phần tử của tập hằng ⇒ PHẢI có một nguồn sinh NỘI BỘ ghi ra nó", () => {
    const noiBo = new Set(giaTriCua("noi-bo"));
    const thua = PHUONG_THUC_XAC_THUC_NOI_BO.filter((v) => !noiBo.has(v));
    expect(
      thua,
      "⇒ Một phần tử KHÔNG AI SINH RA là nới lỏng không có lý do — và người sau sẽ xoá nó, rồi nhốt\n" +
        "  lại đúng những người mà nó đang cứu. Hoặc bỏ nó khỏi tập hằng, hoặc khai nguồn sinh vào\n" +
        "  `NGUON_SINH` của chính lưới này.",
    ).toEqual([]);
  });

  it("★★★ chiều C — ∀ giá trị mà một nguồn sinh LIÊN BANG ghi ra ⇒ PHẢI KHÔNG được công nhận", () => {
    const lot = giaTriCua("lien-bang").filter((v) => laXacThucNoiBo(v));
    expect(
      lot,
      "⇒ Một danh tính do IdP NGOÀI giữ vừa được coi là 'xác thực nội bộ' ⇒ hệ mở cửa ĐẶT MẬT KHẨU\n" +
        "  cho một tài khoản mà mật khẩu không phải thứ xác thực nó.",
    ).toEqual([]);
  });

  it("★★★ ca ĐỐI CHỨNG DƯƠNG — chính giá trị mà seed script ghi ra ĐI QUA được vị từ", () => {
    const tuSeed = rutTuInsertSql(doc("scripts/seed-test-data.mjs"));
    // Cầu chì: nếu bộ rút trượt, mảng rỗng và `every` trả `true` — một lượng từ TỰ THOẢ.
    expect(tuSeed.length, "bộ rút SQL không thấy ô `loginMethod` ⇒ ca này rỗng nghĩa").toBeGreaterThan(0);
    for (const v of tuSeed) {
      expect(
        laXacThucNoiBo(v),
        `seed script ghi \`loginMethod = '${v}'\` — đây là hình dạng dữ liệu SẢN XUẤT, ` +
          "và nó vừa bị vị từ từ chối. Đó chính là nhà tù.",
      ).toBe(true);
    }
  });
});

describe("★★★★ vá NHÀ TÙ I-4 §3 — MỘT CHỦ: không nơi nào được so `loginMethod` với một CHUỖI", () => {
  const NHANH = ["server", "client/src", "shared"];
  const TOI = "server/_core/xacThucNoiBo.test.ts";

  /**
   * ★★★ Đọc trên **CÂY**, không trên **VĂN BẢN** — bài học I-2 của cùng chuỗi pha, ở chiều ngược
   * lại: một regex trên văn bản **bắt nhầm CHÚ THÍCH**. Đo được ngay lượt chạy đầu của lưới này:
   * `shared/xacThucNoiBo.ts` và `server/routers/userRouters.ts` bị tố cáo, trong khi cả hai chỉ
   * **kể lại hình dạng cũ trong docstring** để người sau hiểu vì sao nó bị bỏ. Một lưới ĐỎ vì chú
   * thích sẽ được gỡ bằng cách **xoá chú thích** — tức lưới tự phá đúng thứ tài liệu giải thích nó.
   *
   * ⇒ Hỏi trên AST: một `BinaryExpression` có toán tử `===`/`!==`/`==`/`!=`, một vế là truy cập
   *   thuộc tính tên `loginMethod`, vế kia là một **string literal**.
   */
  function soLoginMethodVoiChuoi(src: string, tenFile: string): boolean {
    const sf = ts.createSourceFile(
      tenFile,
      src,
      ts.ScriptTarget.Latest,
      true,
      tenFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const laLoginMethod = (n: ts.Node): boolean =>
      (ts.isPropertyAccessExpression(n) && n.name.text === "loginMethod") ||
      (ts.isElementAccessExpression(n) &&
        ts.isStringLiteralLike(n.argumentExpression) &&
        n.argumentExpression.text === "loginMethod") ||
      (ts.isIdentifier(n) && n.text === "loginMethod");
    const laChuoi = (n: ts.Node): boolean => ts.isStringLiteralLike(n);
    const goc = (n: ts.Node): ts.Node =>
      ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n) || ts.isAsExpression(n) ? goc(n.expression) : n;

    let thay = false;
    const di = (n: ts.Node): void => {
      if (thay) return;
      if (ts.isBinaryExpression(n)) {
        const k = n.operatorToken.kind;
        if (
          k === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          k === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
          k === ts.SyntaxKind.EqualsEqualsToken ||
          k === ts.SyntaxKind.ExclamationEqualsToken
        ) {
          const t = goc(n.left);
          const p = goc(n.right);
          if ((laLoginMethod(t) && laChuoi(p)) || (laChuoi(t) && laLoginMethod(p))) {
            thay = true;
            return;
          }
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
    return thay;
  }

  it("★★★★ ∀ file nguồn: 0 phép so `loginMethod` với chuỗi (chống phần tử thứ N+1)", () => {
    const pham = NHANH.flatMap((n) => moiFileDuoi(GOC, n))
      .filter((f) => f.duong !== TOI)
      .filter((f) => soLoginMethodVoiChuoi(readFileSync(f.that, "utf8"), f.that))
      .map((f) => f.duong)
      .sort();
    expect(
      pham,
      "⇒ Nhận diện bằng CÁCH VIẾT thay vì bằng KHÁI NIỆM — lớp lỗi đã đẻ phần tử thứ N+1 mười bảy\n" +
        "  lần trong chuỗi pha này, và lần này nó nhốt 4 người dùng thật.\n" +
        "⇒ Hỏi `laXacThucNoiBo()` (`shared/xacThucNoiBo.ts`), đừng thêm một chuỗi thứ hai.",
    ).toEqual([]);
  });

  it("★★★ SÁU điểm gọi đều GỌI chủ — không ai giữ một bản sao thứ hai của luật", () => {
    const DIEM_GOI = [
      "server/routers/userRouters.ts",
      "client/src/pages/ChangePassword.tsx",
      "client/src/pages/Profile.tsx",
      "client/src/pages/Users.tsx",
    ];
    for (const d of DIEM_GOI) {
      const src = doc(d);
      expect(src.includes('from "@shared/xacThucNoiBo"'), `${d} phải GỌI chủ ở \`shared/\``).toBe(true);
      expect(src.includes("laXacThucNoiBo("), `${d} phải THẬT SỰ gọi vị từ, không chỉ import nó`).toBe(true);
    }
  });

  it("★★★ cầu chì — bộ dò bắt ĐÚNG hình dạng cũ, và KHÔNG bắt nhầm chú thích", () => {
    const bat = (s: string) => soLoginMethodVoiChuoi(s, "x.ts");
    // Bắt được — đây đúng là ba hình dạng đã tồn tại ở sáu điểm gọi trước lượt vá.
    expect(bat(`const x = (user as any)?.loginMethod === "local";`)).toBe(true);
    expect(bat(`if (user.loginMethod !== 'local') { throw 1; }`)).toBe(true);
    expect(bat(`const y = u["loginMethod"] === 'password';`)).toBe(true);
    expect(bat(`const z = "local" === u.loginMethod;`), "so ngược vế vẫn là cùng lớp lỗi").toBe(true);
    // KHÔNG bắt nhầm.
    expect(bat(`const v = { loginMethod: "manus" };`), "gán KHÔNG phải so sánh").toBe(false);
    expect(bat(`laXacThucNoiBo(user.loginMethod);`), "lời gọi chủ KHÔNG bị bắt").toBe(false);
    expect(
      bat(`// if (user.loginMethod !== 'local') — hình dạng CŨ, đã bỏ\nconst a = 1;`),
      "★ CHÚ THÍCH kể lại hình dạng cũ KHÔNG phải một vi phạm — nếu không, lưới tự phá tài liệu của chính nó",
    ).toBe(false);
    expect(bat(`const s = "loginMethod === 'local'";`), "chuỗi ký tự KHÔNG phải mã").toBe(false);
  });

  it("★★ cầu chì — phạm vi quét không rỗng, và có gom cả `.tsx` của client", () => {
    const moi = NHANH.flatMap((n) => moiFileDuoi(GOC, n));
    expect(moi.length, "glob rỗng ⇒ ba ca ∀ ở trên khai XANH mà không đo gì").toBeGreaterThan(500);
    expect(moi.some((f) => f.duong === "client/src/pages/ChangePassword.tsx")).toBe(true);
    expect(moi.some((f) => f.duong === "server/routers/userRouters.ts")).toBe(true);
    expect(moi.every((f) => !laFileTest(f.duong) || f.duong.endsWith(".test.ts") || f.duong.endsWith(".test.tsx"))).toBe(true);
  });
});
