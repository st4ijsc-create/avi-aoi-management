/**
 * ★★★ Pha 7 Task 8a — **LƯỢNG TỪ TRÊN TRỤC "NGƯỜI GHI":**
 * ***∀ điểm ghi vào `backup_codes.code`, giá trị ghi phải ra từ `bamMaDuPhong()`.***
 * (Tự khai `Pha 5` để `vramPha5Gate.test.ts` kéo file này vào lượng từ *"mọi lưới tự khai một pha
 *  phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KHÔNG LIỆT KÊ HAI NGƯỜI GHI ĐÃ ĐẾM ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bước ĐO trước tìm ra **hai** người ghi (`server/db/auth.ts:generateBackupCodes` — plaintext;
 * `server/routers/twoFactorRouter.ts` — bcrypt). Một danh sách hai tên là một danh sách **có phần
 * tử thứ BA**; lớp *"cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"* đã tái diễn **MƯỜI SÁU** lần.
 *
 * Nên bất biến được cưỡng chế ở **HAI tầng, hai loại lỗi khác nhau**:
 *
 *  1. **KIỂU** (`drizzle/schema/auth.ts` → `.$type<MaDuPhongDaBam>()`): ghi một chuỗi thô là **lỗi
 *     biên dịch**, ở file nào cũng vậy, kể cả file chưa tồn tại. Đó là phần *"đổi kiểu để ghi mã
 *     chưa băm KHÔNG VIẾT RA ĐƯỢC"*.
 *  2. **LƯỚI NÀY** canh **ba lỗ mà tầng kiểu KHÔNG thấy**:
 *     · ai đó **gỡ nhãn** khỏi cột (ca `nhãn còn trên cột`);
 *     · ai đó **ép kiểu** vòng qua (`as MaDuPhongDaBam` / `as unknown as` / `as any`) — kiểu im
 *       lặng, lưới này ĐỎ;
 *     · một `.values(…)`/`.set(…)` mà **không phân tích được** (đối số không phải object literal)
 *       ⇒ **fail-closed**: không hiểu thì ĐỎ, không tha.
 *
 * ⚠ **Phạm vi quét** dùng lại `moiFileDuoi()` của `server/routers/deployProcedureScan.ts` (đúng
 *   §Global Constraints: *"đừng viết bộ suy thứ N+1"*), trên **cả ba nhánh** `server` · `client/src`
 *   · `drizzle`. Một đường ghi **MỚI trong FILE MỚI** nằm trong lượng từ **theo cấu tạo** — đây
 *   chính là **phép thử M3** (*"lưới theo ĐƯỜNG THOÁT, không theo FILE"*).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÙNG MÙ ĐƯỢC KHAI (đừng đọc màu xanh của file này thành "đã phủ hết")
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. **SQL thô** (`sql\`INSERT INTO backup_codes …\``) không được nhận diện. Hôm nay repo có **0**
 *     điểm như thế; đó là một quan sát theo thời điểm, không phải một bất biến. Tầng KIỂU cũng mù
 *     ở đây — SQL thô vòng qua drizzle theo định nghĩa.
 *  2. Nhãn nói *"chuỗi này ra từ `bamMaDuPhong`"*, **không** nói *"chuỗi này là bcrypt hợp lệ"*.
 *     Ca **đối chứng dương** (băm thật → khớp thật, mã sai → không khớp) mới canh nửa ấy.
 *  3. Lan truyền qua **lời gọi hàm khác** (`f(ma)` rồi `f` ghi) không được theo dõi — nhưng giá trị
 *     ấy vẫn phải mang **nhãn**, nên tầng 1 vẫn bắt.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { moiFileDuoi, laFileTest } from "../routers/deployProcedureScan";
import { bamMaDuPhong, khopMaDuPhong, sinhMaDuPhong } from "./backupCodeSecret";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/_core
const GOC = join(TEST_DIR, "..", "..");

/** Bảng bị canh, và ô bị canh. Đổi tên bảng thì đổi ở ĐÚNG MỘT chỗ. */
const BANG = "backupCodes";
const O = "code";
/** Người sản xuất **duy nhất** của giá trị hợp lệ. */
const NGUOI_BAM = "bamMaDuPhong";
/** Module chủ — nơi DUY NHẤT được phép ép kiểu ra nhãn. */
const CHU = "server/_core/backupCodeSecret.ts";
/** File khai cột — nơi nhãn phải có mặt. */
const SCHEMA = "drizzle/schema/auth.ts";

interface ViPham {
  readonly duong: string;
  readonly dong: number;
  readonly vi: string;
}

function nguon(duong: string): ts.SourceFile {
  return ts.createSourceFile(duong, readFileSync(duong, "utf8"), ts.ScriptTarget.Latest, true);
}

function soDong(sf: ts.SourceFile, n: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
}

/** Định danh trái nhất của một chuỗi truy cập (`db.insert(x).values(y)` → `db`). */
function tenGoi(n: ts.Expression): string | null {
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  return null;
}

/**
 * Lời gọi này (hoặc một mắt xích **trước** nó trong cùng chuỗi) có phải `insert(backupCodes)` /
 * `update(backupCodes)` không.
 */
function chuoiChamBang(n: ts.Expression): boolean {
  let cur: ts.Expression | undefined = n;
  while (cur) {
    if (ts.isCallExpression(cur)) {
      const ten = tenGoi(cur.expression);
      if ((ten === "insert" || ten === "update") && cur.arguments.length > 0) {
        const a = cur.arguments[0]!;
        if (tenGoi(a as ts.Expression) === BANG) return true;
      }
      cur = ts.isPropertyAccessExpression(cur.expression) ? cur.expression.expression : undefined;
    } else if (ts.isPropertyAccessExpression(cur)) {
      cur = cur.expression;
    } else {
      cur = undefined;
    }
  }
  return false;
}

/**
 * Tập định danh mà **MỌI** lượt khai báo trong file này đều gán từ `await bamMaDuPhong(...)`.
 *
 * ⚠⚠⚠ **LƯỢNG TỪ — ∀, KHÔNG PHẢI ∃.** Bản đầu của lưới này hỏi *"có TỒN TẠI một lượt gán từ
 * `bamMaDuPhong` cho tên ấy không"*, và **đột biến đo được đã lọt**: đổi `const hashedCode = await
 * bamMaDuPhong(code)` ở đường `enable` thành `const hashedCode = code` ⇒ `tsc` ĐỎ nhưng **lưới này
 * XANH**, vì đường `regenerateBackupCodes` trong **cùng file** vẫn còn một lượt gán hợp lệ cho
 * **cùng cái tên**. Bộ quét không theo phạm vi (scope), nên vị từ phải là *"MỌI khai báo của tên
 * này đều băm"* — đúng lớp lỗi **LƯỢNG TỪ SAI** đã có tên trong dự án.
 */
function bienDaBam(sf: ts.SourceFile): Set<string> {
  const moiLuot = new Map<string, boolean[]>();
  const di = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name)) {
      const ds = moiLuot.get(n.name.text) ?? [];
      ds.push(laLoiGoiBam(n.initializer));
      moiLuot.set(n.name.text, ds);
    }
    ts.forEachChild(n, di);
  };
  ts.forEachChild(sf, di);
  const ra = new Set<string>();
  for (const [ten, ds] of moiLuot) if (ds.length > 0 && ds.every(Boolean)) ra.add(ten);
  return ra;
}

function laLoiGoiBam(e: ts.Expression): boolean {
  const loi = ts.isAwaitExpression(e) ? e.expression : e;
  return ts.isCallExpression(loi) && tenGoi(loi.expression) === NGUOI_BAM;
}

/**
 * ★★★ VỊ TỪ TRUNG TÂM — chạy được trên **một nguồn bất kỳ**, kể cả nguồn của một file **chưa tồn
 * tại**. Đó là điều cho phép ca M3 chứng minh lượng từ chứ không chỉ chứng minh hiện trạng.
 */
export function viPhamTrongNguon(duong: string, ma: string): ViPham[] {
  const sf = ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true);
  const daBam = bienDaBam(sf);
  const ra: ViPham[] = [];

  const soatDoiTuong = (o: ts.ObjectLiteralExpression, dong: number): void => {
    for (const p of o.properties) {
      const ten = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
      if (ten !== O) continue;
      if (ts.isShorthandPropertyAssignment(p)) {
        if (!daBam.has(p.name.text)) {
          ra.push({ duong, dong, vi: `\`${O}\` viết tắt từ \`${p.name.text}\` — KHÔNG ra từ ${NGUOI_BAM}()` });
        }
        continue;
      }
      if (!ts.isPropertyAssignment(p)) {
        ra.push({ duong, dong, vi: `\`${O}\` ở dạng không phân tích được (${ts.SyntaxKind[p.kind]})` });
        continue;
      }
      const v = p.initializer;
      if (laLoiGoiBam(v)) continue;
      if (ts.isIdentifier(v) && daBam.has(v.text)) continue;
      ra.push({ duong, dong, vi: `\`${O}\` gán từ \`${v.getText(sf).slice(0, 60)}\` — KHÔNG ra từ ${NGUOI_BAM}()` });
    }
  };

  /** Đào MỌI object literal trong một đối số (phủ cả `codes.map(c => ({ code: c }))`). */
  const daoDoiTuong = (n: ts.Node, dong: number): void => {
    if (ts.isObjectLiteralExpression(n)) soatDoiTuong(n, dong);
    ts.forEachChild(n, (c) => daoDoiTuong(c, dong));
  };

  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const ten = tenGoi(n.expression);
      if ((ten === "values" || ten === "set") && chuoiChamBang(n.expression)) {
        const dong = soDong(sf, n);
        if (n.arguments.length === 0) {
          ra.push({ duong, dong, vi: `\`.${ten}()\` không đối số — không phân tích được` });
        }
        for (const a of n.arguments) {
          // ⚠ FAIL-CLOSED: đối số không phải object/array literal ⇒ không hiểu ⇒ ĐỎ.
          const laHieuDuoc = ts.isObjectLiteralExpression(a) || ts.isArrayLiteralExpression(a) || ts.isCallExpression(a);
          if (!laHieuDuoc) {
            ra.push({ duong, dong, vi: `\`.${ten}(${a.getText(sf).slice(0, 40)})\` — đối số KHÔNG phân tích được` });
            continue;
          }
          daoDoiTuong(a, dong);
        }
      }
    }
    // Ép kiểu vòng qua nhãn — tầng KIỂU im lặng ở đây.
    if (ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) {
      const t = n.type.getText(sf);
      if (/MaDuPhongDaBam/.test(t)) {
        ra.push({ duong, dong: soDong(sf, n), vi: `ép kiểu ra nhãn: \`as ${t}\`` });
      }
    }
    ts.forEachChild(n, di);
  };
  ts.forEachChild(sf, di);
  return ra;
}

const NHANH = ["server", "client/src", "drizzle"] as const;
const FILE = NHANH.flatMap((n) => moiFileDuoi(GOC, n, [".ts", ".tsx"])).filter((f) => !laFileTest(f.duong));
/** Chỉ những file **có nhắc tới bảng** mới cần parse — nhưng cầu chì dưới đây canh con số ấy. */
const UNG_VIEN = FILE.filter((f) => readFileSync(f.that, "utf8").includes(BANG));

describe("★★★ Pha 5/7 Task 8a — ∀ điểm ghi `backup_codes.code` phải ra từ `bamMaDuPhong()`", () => {
  it("★★★ cầu chì — bộ quét thấy đủ file, và thấy bảng ở ít nhất 2 file (0 ⇒ mọi ca dưới là chân lý rỗng)", () => {
    expect(FILE.length, "quét trúng 0 file nguồn — bộ suy phạm vi đã hỏng?").toBeGreaterThan(500);
    expect(UNG_VIEN.length, `không file nào nhắc \`${BANG}\` — tên bảng đã đổi?`).toBeGreaterThanOrEqual(2);
  });

  it("★★★ TOÀN REPO — 0 điểm ghi mã chưa băm, 0 ép kiểu vòng qua nhãn", () => {
    const vp = UNG_VIEN.flatMap((f) =>
      f.duong === CHU ? [] : viPhamTrongNguon(f.duong, readFileSync(f.that, "utf8")),
    );
    expect(
      vp.map((v) => `${v.duong}:${v.dong} — ${v.vi}`).join("\n"),
      "có điểm ghi vào `backup_codes.code` KHÔNG đi qua chủ duy nhất",
    ).toBe("");
  });

  it("★★★ cầu chì thứ hai — bộ quét THẬT SỰ tìm ra các điểm ghi hợp lệ (không phải quét trượt)", () => {
    // ⚠ Nếu vị từ `chuoiChamBang` hỏng thì ca trên xanh vì **không thấy gì**. Ca này đo rằng nó
    //   vẫn nhìn thấy đường ghi thật — bằng cách chạy trên nguồn thật với `NGUOI_BAM` bị đổi tên.
    const that = join(GOC, "server", "routers", "twoFactorRouter.ts");
    expect(existsSync(that), "đường ghi thật phải tồn tại").toBe(true);
    const ma = readFileSync(that, "utf8").replace(/bamMaDuPhong/g, "bamGiaVo");
    const vp = viPhamTrongNguon("server/routers/twoFactorRouter.ts", ma);
    expect(vp.length, "đổi tên người băm mà lưới KHÔNG thấy ⇒ bộ quét đang quét trượt").toBeGreaterThanOrEqual(2);
  });

  it("★★★ M3 — một đường ghi plaintext trong **FILE MỚI CHƯA TỒN TẠI** vẫn nằm trong lượng từ", () => {
    const fileMoi = "server/routers/backupCodesN1Router.ts"; // chưa tồn tại trên đĩa
    expect(existsSync(join(GOC, fileMoi)), "ca này giả định file ấy chưa tồn tại").toBe(false);
    const ma = `
      import { backupCodes } from "../../drizzle/schema";
      export async function ghiLen(db: any, userId: number, ma: string) {
        await db.insert(backupCodes).values({ userId, code: ma, isUsed: false });
      }`;
    expect(viPhamTrongNguon(fileMoi, ma).length, "đường ghi plaintext ở file mới phải bị bắt").toBeGreaterThanOrEqual(1);
  });

  it("★★★ M3b — bốn biến thể vòng tránh đều bị bắt (map · set · ép kiểu · đối số mờ)", () => {
    const ca: Array<[string, string]> = [
      [
        "map",
        `const insertData = codes.map(code => ({ userId, code, isUsed: false }));
         await db.insert(backupCodes).values(insertData);`,
      ],
      ["set", `await db.update(backupCodes).set({ code: "PLAINTEXT" });`],
      ["ép kiểu", `await db.insert(backupCodes).values({ code: raw as MaDuPhongDaBam });`],
      ["đối số mờ", `await db.insert(backupCodes).values(duLieuTuNoiKhac);`],
    ];
    for (const [ten, than] of ca) {
      const vp = viPhamTrongNguon("server/x/moi.ts", `async function f(db: any, codes: string[], userId: number, raw: string, duLieuTuNoiKhac: any) { ${than} }`);
      expect(vp.length, `biến thể "${ten}" phải bị bắt`).toBeGreaterThanOrEqual(1);
    }
  });

  it("★★★ LƯỢNG TỪ ∀ — cùng MỘT TÊN, một lượt gán băm + một lượt gán thô ⇒ vẫn ĐỎ (∃ thì lọt)", () => {
    // ⚠⚠ Đột biến đo được, đã lọt qua bản đầu của lưới này: đổi ĐÚNG MỘT trong hai lượt
    //    `const hashedCode = await bamMaDuPhong(code)` của `twoFactorRouter.ts` thành `= code`
    //    ⇒ `tsc` ĐỎ nhưng lưới XANH, vì lượt còn lại "chứng nhận" hộ cái tên.
    const hai = `
      async function f(db: any, code: string, userId: number) {
        const hashedCode = code;                       // đường A — THÔ
        await db.insert(backupCodes).values({ userId, code: hashedCode, isUsed: false });
      }
      async function g(db: any, code: string, userId: number) {
        const hashedCode = await bamMaDuPhong(code);   // đường B — băm
        await db.insert(backupCodes).values({ userId, code: hashedCode, isUsed: false });
      }`;
    const vp = viPhamTrongNguon("server/x/hai.ts", hai);
    expect(vp.length, "một tên có lượt gán THÔ ở đâu đó trong file ⇒ mọi điểm ghi dùng tên ấy phải ĐỎ").toBeGreaterThanOrEqual(2);
  });

  it("★★ KHÔNG BẮT NHẦM — đường ghi ĐÚNG (qua `bamMaDuPhong`) không bị bắt, và bảng khác không bị đụng", () => {
    const dung = `
      async function f(db: any, userId: number, ma: string) {
        const hashedCode = await bamMaDuPhong(ma);
        await db.insert(backupCodes).values({ userId, code: hashedCode, isUsed: false });
        await db.insert(backupCodes).values({ userId, code: await bamMaDuPhong(ma), isUsed: false });
      }`;
    expect(viPhamTrongNguon("server/x/dung.ts", dung), "đường băm hợp lệ KHÔNG được bị bắt").toEqual([]);
    // Một bảng KHÁC có cột tên `code` thì không liên quan.
    const khac = `async function g(db: any) { await db.insert(apiKeys).values({ code: "ABC" }); }`;
    expect(viPhamTrongNguon("server/x/khac.ts", khac), "bảng khác KHÔNG được bị bắt").toEqual([]);
  });

  it("★★★ nhãn phải CÒN trên cột — gỡ `.$type<MaDuPhongDaBam>()` thì tầng KIỂU tắt lặng lẽ", () => {
    const src = readFileSync(join(GOC, ...SCHEMA.split("/")), "utf8");
    expect(
      /code:\s*varchar\("code"[^)]*\)\s*\.\$type<\s*MaDuPhongDaBam\s*>\(\)/.test(src),
      `${SCHEMA}: cột \`code\` phải mang nhãn \`.$type<MaDuPhongDaBam>()\``,
    ).toBe(true);
  });

  it("★★★ cổng KIỂU tự canh phải còn trong module chủ (`@ts-expect-error` + phép gán mã thô)", () => {
    const src = readFileSync(join(GOC, ...CHU.split("/")), "utf8");
    expect(src.includes("@ts-expect-error"), `${CHU}: mất cổng kiểu tự canh`).toBe(true);
    expect(/InsertBackupCode\["code"\]\s*=\s*"/.test(src), `${CHU}: mất phép gán mã thô của cổng kiểu`).toBe(true);
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — luồng băm VẪN CHẠY: băm thật khớp thật, mã sai KHÔNG khớp", async () => {
    const ma = sinhMaDuPhong();
    expect(ma).toMatch(/^[0-9A-F]{8}$/);
    const daBam = await bamMaDuPhong(ma);
    // ⚠ Nếu ai biến `bamMaDuPhong` thành phép ép kiểu suông thì ô này ĐỎ — nhãn không canh được.
    expect(daBam.startsWith("$2"), "phải là hash bcrypt thật, không phải chuỗi thô ép kiểu").toBe(true);
    expect(daBam).not.toBe(ma);
    expect(await khopMaDuPhong(ma, daBam), "mã ĐÚNG phải khớp").toBe(true);
    expect(await khopMaDuPhong(ma.toLowerCase(), daBam), "chuẩn hoá HOA: gõ thường vẫn khớp").toBe(true);
    expect(await khopMaDuPhong(sinhMaDuPhong(), daBam), "mã KHÁC KHÔNG được khớp").toBe(false);
    expect(await khopMaDuPhong(ma, ma), "so với chính chuỗi thô KHÔNG được khớp").toBe(false);
  }, 20_000);

  it("★★ hai hàm ghi plaintext cũ đã BIẾN MẤT khỏi `server/db/auth.ts` (đối chứng cho lượt xoá)", () => {
    const src = readFileSync(join(GOC, "server", "db", "auth.ts"), "utf8");
    expect(/export\s+async\s+function\s+generateBackupCodes\b/.test(src), "`generateBackupCodes` phải bị xoá").toBe(false);
    expect(/export\s+async\s+function\s+getBackupCodes\b/.test(src), "`getBackupCodes` (0 người gọi) phải bị xoá").toBe(false);
    const ur = readFileSync(join(GOC, "server", "routers", "userRouters.ts"), "utf8");
    expect(/generateBackupCodes:\s*protectedProcedure/.test(ur), "thủ tục `user.generateBackupCodes` phải bị xoá").toBe(false);
  });
});
