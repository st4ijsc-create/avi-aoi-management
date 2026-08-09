/**
 * ★★★ Pha 7 / review TOÀN NHÁNH **C-1** — **LƯỢNG TỪ TRÊN TRỤC "NGƯỜI GHI HẠT GIỐNG TOTP":**
 * ***∀ điểm ghi `user_secrets.twoFactorSecret` trong `server/**` (ngoài chủ tầng-DB): hàm bao
 * phải mang MỘT HÀNG RÀO `twoFactorEnabled` — một `if` chạm ô ấy và NÉM.***
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỢNG TỪ, KHÔNG PHẢI "VÁ HAI ĐIỂM"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `server/_core/totpOnce.ts:20-24` **đã đếm** các cặp tuyến SONG SONG quanh TOTP và khai **HAI**
 * (`twoFactor.enable ≡ user.verify2FA`, `twoFactor.disable ≡ user.disable2FA`). Phép đếm ấy **sót
 * cặp thứ BA** — `twoFactor.generateSecret ≡ user.setup2FA` — và đó **chính là** cặp mà hai bản sao
 * **BẤT ĐỒNG**: một bản có hàng rào `twoFactorEnabled` (`twoFactorRouter.ts:80-82`), một bản không.
 * Phần tử thứ N+1, lần thứ **MƯỜI TÁM**. ⇒ Bản vá không được dừng ở việc chép hàng rào sang tuyến
 * thứ hai; cặp song song **thứ TƯ** phải **không sinh ra được im lặng**.
 *
 * Hậu quả đo được của lỗ (đột biến review, DB test thật):
 *   `2FA đang bật=true · secret ĐỔI=true · cờ 2FA sau=true`
 *   `mã do KẺ TẤN CÔNG sinh qua verifyTotpOnce: hopLe=true`
 * ⇒ Một phiên bị chiếm **tự cấp hạt giống mới** rồi **tự sinh mã hợp lệ** cho mọi cổng step-up của
 *   Pha 4–7. Kẻ tấn công **không cần ĐỌC** bí mật — nó **GHI**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ BẰNG CHỨNG ĐỌC TRÊN **CÂY**, KHÔNG TRÊN **VĂN BẢN** — bài học I-2 của cùng lượt review
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `sessionGrantScan.coBangChung` hỏi `than.includes("kiemVe2FA(")` ⇒ **một CHÚ THÍCH tính là bằng
 * chứng**, và một đột biến gỡ hẳn lời gọi thật vẫn 9/9 XANH. Lưới này hỏi trên **AST**: phải tồn
 * tại một `IfStatement` có **điều kiện** chạm `.twoFactorEnabled` và **nhánh then NÉM**. Ca
 * *"chú thích KHÔNG phải bằng chứng"* dưới đây đo lại đúng chuyện ấy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÙNG MÙ ĐƯỢC KHAI (đừng đọc màu xanh của file này thành "đã phủ hết")
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. **SQL thô** (`sql\`UPDATE user_secrets SET …\``) không được nhận diện. Hôm nay repo có **0**
 *     điểm như thế — một quan sát theo thời điểm, không phải một bất biến.
 *  2. Lưới hỏi *"có hàng rào hình dạng ấy trong hàm bao"*, **không** chứng minh hàng rào ấy **chạy
 *     trước** lượt ghi trên mọi nhánh. Nửa ấy do lưới **HÀNH VI** §3 canh (2FA bật ⇒ TỪ CHỐI, và
 *     hạt giống **không đổi**).
 *  3. `scripts/**` nằm ngoài phạm vi: `scripts/xoay-bi-mat-2fa.mjs` là đường **vận hành có chủ ý**
 *     (chạy tay, ngoài request) — nó có lưới riêng `server/_core/xoayBiMatNguon.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { moiFileDuoi, laFileTest } from "./deployProcedureScan";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import type { User } from "../../drizzle/schema";
import * as db from "../db";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/routers
const GOC = join(TEST_DIR, "..", "..");

/**
 * Người ghi hạt giống — **tên hàm**, vì đây là điểm gọi qua một `import`/`db.*`, không một chuỗi
 * drizzle. Đổi tên hàm ấy thì đổi ở ĐÚNG MỘT chỗ (và ca `cầu chì` dưới đây ĐỎ ngay nếu nó trượt).
 */
const NGUOI_GHI = "setup2FA";
/** Ô mà hàng rào phải chạm. */
const O_HANG_RAO = "twoFactorEnabled";
/**
 * **CHỦ tầng-DB** — nó *là* phép ghi nguyên thuỷ, và nó không có khái niệm cờ 2FA. Miễn trừ này là
 * một **ÁNH XẠ `đường:hàm`**, không phải một tập tên (bài học I-1 của cùng lượt review: hai hàm
 * cùng tên ở hai file khác nhau không được miễn hộ nhau).
 */
const CHU_TANG_DB = "server/db/auth.ts";

interface ViPham {
  readonly duong: string;
  readonly dong: number;
  readonly ham: string;
}

function nguon(duong: string, ma: string): ts.SourceFile {
  return ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true);
}

function soDong(sf: ts.SourceFile, n: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
}

function tenLoiGoi(n: ts.CallExpression): string {
  const e = n.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
}

function laHam(n: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n)
  );
}

/** Hàm bao gần nhất — phạm vi mà hàng rào phải nằm trong. */
function hamBao(n: ts.Node): ts.Node | undefined {
  let cur: ts.Node | undefined = n.parent;
  while (cur && !laHam(cur)) cur = cur.parent;
  return cur;
}

/** Tên hàm bao — chỉ để thông báo lỗi trỏ đúng chỗ. */
function tenHamBao(n: ts.Node): string {
  let cur: ts.Node | undefined = n;
  while (cur) {
    if ((ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) && cur.name) return cur.name.getText();
    if (cur.parent && ts.isVariableDeclaration(cur.parent) && cur.parent.name) return cur.parent.name.getText();
    if (cur.parent && ts.isPropertyAssignment(cur.parent) && cur.parent.name) return cur.parent.name.getText();
    cur = cur.parent;
  }
  return "<ẩn danh>";
}

/** Cây con này có chạm ô `twoFactorEnabled` **như một phép ĐỌC THẬT** không (không phải chú thích)? */
function chamO(n: ts.Node): boolean {
  let co = false;
  const di = (x: ts.Node): void => {
    if (co) return;
    if (ts.isPropertyAccessExpression(x) && x.name.text === O_HANG_RAO) { co = true; return; }
    if (ts.isElementAccessExpression(x) && x.argumentExpression && ts.isStringLiteral(x.argumentExpression) &&
        x.argumentExpression.text === O_HANG_RAO) { co = true; return; }
    // `const { twoFactorEnabled } = …` rồi `if (twoFactorEnabled) throw` — vẫn là một phép đọc thật.
    if (ts.isIdentifier(x) && x.text === O_HANG_RAO) { co = true; return; }
    ts.forEachChild(x, di);
  };
  di(n);
  return co;
}

/** Cây con này có một `throw` không? */
function coNem(n: ts.Node): boolean {
  let co = false;
  const di = (x: ts.Node): void => {
    if (co) return;
    if (ts.isThrowStatement(x)) { co = true; return; }
    ts.forEachChild(x, di);
  };
  di(n);
  return co;
}

/**
 * ★★★ VỊ TỪ TRUNG TÂM — **hàng rào có mặt trong hàm này không.**
 * Hình dạng: một `IfStatement` mà **điều kiện** chạm `twoFactorEnabled` **và** nhánh `then` NÉM.
 * ⚠ Cả hai vế trên **CÂY**: một chú thích mang đúng chữ ấy không tạo ra `IfStatement` nào.
 */
function coHangRao(than: ts.Node): boolean {
  let co = false;
  const di = (x: ts.Node): void => {
    if (co) return;
    if (ts.isIfStatement(x) && chamO(x.expression) && coNem(x.thenStatement)) { co = true; return; }
    ts.forEachChild(x, di);
  };
  di(than);
  return co;
}

/**
 * ★★★ Chạy được trên **một nguồn bất kỳ**, kể cả nguồn của một file **CHƯA TỒN TẠI** — đó là điều
 * cho phép ca M3 chứng minh **lượng từ**, không chỉ chứng minh hiện trạng.
 */
export function viPhamTrongNguon(duong: string, ma: string): ViPham[] {
  if (duong === CHU_TANG_DB) return [];
  const sf = nguon(duong, ma);
  const ra: ViPham[] = [];
  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && tenLoiGoi(n) === NGUOI_GHI) {
      // ⚠ Bỏ qua **lượt KHAI BÁO** chính hàm ấy (`export async function setup2FA(…)`) — nó không
      //   phải một lời gọi; chỉ `CallExpression` mới vào lượng từ, nên không cần lọc thêm.
      const h = hamBao(n);
      if (!h) {
        // ⚠ FAIL-CLOSED: một lời gọi ở **tầng module** không có hàm bao để mà mang hàng rào.
        ra.push({ duong, dong: soDong(sf, n), ham: "<tầng module — KHÔNG hàm bao>" });
      } else if (!coHangRao((h as ts.FunctionLikeDeclaration).body ?? h)) {
        ra.push({ duong, dong: soDong(sf, n), ham: tenHamBao(n) });
      }
    }
    ts.forEachChild(n, di);
  };
  ts.forEachChild(sf, di);
  return ra;
}

const SAN_XUAT = moiFileDuoi(GOC, "server", [".ts"]).filter((f) => !laFileTest(f.duong));
const UNG_VIEN = SAN_XUAT.filter((f) => readFileSync(f.that, "utf8").includes(NGUOI_GHI));

/** Mọi điểm gọi người-ghi trong `server/**` sản xuất (kể cả đã có hàng rào) — dùng cho cầu chì. */
function moiDiemGoi(): { duong: string; dong: number }[] {
  const ra: { duong: string; dong: number }[] = [];
  for (const f of UNG_VIEN) {
    if (f.duong === CHU_TANG_DB) continue;
    const sf = nguon(f.duong, readFileSync(f.that, "utf8"));
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && tenLoiGoi(n) === NGUOI_GHI) ra.push({ duong: f.duong, dong: soDong(sf, n) });
      ts.forEachChild(n, di);
    };
    ts.forEachChild(sf, di);
  }
  return ra;
}

const DIEM_GOI = moiDiemGoi();

describe("★★★ Pha 5/7 C-1 §1 — ∀ điểm ghi hạt giống TOTP phải có hàng rào `twoFactorEnabled`", () => {
  it("★★★ cầu chì — bộ quét thấy đủ file và tìm ra ĐIỂM GỌI THẬT (0 ⇒ mọi ca dưới là chân lý rỗng)", () => {
    expect(SAN_XUAT.length, "quét trúng 0 file nguồn — bộ suy phạm vi đã hỏng?").toBeGreaterThan(300);
    expect(
      UNG_VIEN.length,
      `không file nào nhắc \`${NGUOI_GHI}\` — tên người ghi đã đổi? (lưới này nay canh một tập RỖNG)`,
    ).toBeGreaterThanOrEqual(3);
    // ⚠ Hai tuyến SONG SONG phải cùng nằm trong lượng từ — nếu chỉ thấy một, lưới đang canh nửa bài.
    expect(DIEM_GOI.length, "phải thấy ≥2 điểm gọi ngoài chủ tầng-DB (hai tuyến song song)").toBeGreaterThanOrEqual(2);
    const file = [...new Set(DIEM_GOI.map((d) => d.duong))];
    expect(file, "tuyến `twoFactor.generateSecret` phải nằm trong lượng từ").toContain("server/routers/twoFactorRouter.ts");
    expect(file, "tuyến `user.setup2FA` phải nằm trong lượng từ").toContain("server/routers/userRouters.ts");
  });

  it("★★★ TOÀN `server/**` — 0 điểm ghi hạt giống TOTP thiếu hàng rào", () => {
    const vp = UNG_VIEN.flatMap((f) => viPhamTrongNguon(f.duong, readFileSync(f.that, "utf8")));
    expect(
      vp.map((v) => `  · ${v.duong}:${v.dong}  (${v.ham})`).join("\n"),
      "MỘT ĐƯỜNG GHI HẠT GIỐNG TOTP KHÔNG ĐÒI BẰNG CHỨNG NÀO.\n" +
        "⚠ `twoFactorSecret` là HẠT GIỐNG sinh mọi mã OTP. Ghi đè được nó = tự sinh mã hợp lệ cho\n" +
        "  MỌI cổng step-up (requirePerCallFreshTotp · vé một-lần · sổ totp_consumed · vram.preempt).\n" +
        "⇒ Thêm hàng rào đúng khuôn `server/routers/twoFactorRouter.ts:80-82`:\n" +
        "     if (<x>.twoFactorEnabled) throw appError(…);\n",
    ).toBe("");
  });

  it("★★★ M3 — một đường ghi KHÔNG hàng rào trong **FILE MỚI CHƯA TỒN TẠI** vẫn nằm trong lượng từ", () => {
    const fileMoi = "server/routers/totpSeedN1Router.ts"; // chưa tồn tại trên đĩa
    expect(existsSync(join(GOC, fileMoi)), "ca này giả định file ấy chưa tồn tại").toBe(false);
    const ma = `
      import { setup2FA } from "../db";
      export const r = { capLaiHatGiong: async (ctx: any, secret: string) => {
        await setup2FA(ctx.user.id, secret);
        return { secret };
      } };`;
    expect(viPhamTrongNguon(fileMoi, ma).length, "đường ghi không hàng rào ở file MỚI phải bị bắt").toBeGreaterThanOrEqual(1);
  });

  it("★★★ CHÚ THÍCH KHÔNG PHẢI BẰNG CHỨNG — bằng chứng đọc trên CÂY, không trên văn bản (bài học I-2)", () => {
    const ma = `
      export async function capLai(ctx: any, secret: string) {
        // đã kiểm twoFactorEnabled ở tầng trên rồi, if (u.twoFactorEnabled) throw …
        /** twoFactorEnabled: throw */
        await setup2FA(ctx.user.id, secret);
      }`;
    expect(
      viPhamTrongNguon("server/x/chuThich.ts", ma).length,
      "một CHÚ THÍCH mang đúng chữ ấy được nhận làm hàng rào ⇒ lưới đang canh CHÍNH TẢ, không canh sự thật",
    ).toBeGreaterThanOrEqual(1);
  });

  it("★★★ bốn biến thể vòng tránh đều bị bắt (đọc-mà-không-ném · ném-mà-không-đọc · tầng module · hàm khác)", () => {
    const ca: Array<[string, string]> = [
      [
        "đọc mà KHÔNG ném",
        `export async function f(ctx: any, u: any, secret: string) {
           if (u.twoFactorEnabled) { console.warn("2FA đang bật"); }
           await setup2FA(ctx.user.id, secret);
         }`,
      ],
      [
        "ném mà KHÔNG đọc ô",
        `export async function f(ctx: any, u: any, secret: string) {
           if (!u) throw new Error("no user");
           await setup2FA(ctx.user.id, secret);
         }`,
      ],
      [
        "hàng rào ở HÀM KHÁC trong cùng file",
        `export function kiem(u: any) { if (u.twoFactorEnabled) throw new Error("bật rồi"); }
         export async function f(ctx: any, secret: string) { await setup2FA(ctx.user.id, secret); }`,
      ],
      ["tầng module", `await setup2FA(1, "AAAA");`],
    ];
    for (const [ten, ma] of ca) {
      expect(viPhamTrongNguon("server/x/bienThe.ts", ma).length, `biến thể "${ten}" phải bị bắt`).toBeGreaterThanOrEqual(1);
    }
  });

  it("★★ KHÔNG BẮT NHẦM — hàng rào ĐÚNG không bị bắt, và chủ tầng-DB được miễn theo ĐƯỜNG:HÀM", () => {
    const dung = `
      export async function f(ctx: any, u: any, secret: string) {
        if (u.twoFactorEnabled) throw appError("BAD_REQUEST", "OPERATION_FAILED", {}, "2FA đã bật");
        await setup2FA(ctx.user.id, secret);
      }`;
    expect(viPhamTrongNguon("server/x/dung.ts", dung), "hàng rào hợp lệ KHÔNG được bị bắt").toEqual([]);
    // Biến thể phá cấu trúc — vẫn là một phép đọc thật.
    const pha = `
      export async function g(ctx: any, u: any, secret: string) {
        const { twoFactorEnabled } = u;
        if (twoFactorEnabled) throw new Error("bật rồi");
        await setup2FA(ctx.user.id, secret);
      }`;
    expect(viPhamTrongNguon("server/x/pha.ts", pha), "biến thể phá cấu trúc là hàng rào hợp lệ").toEqual([]);
    // ⚠ Miễn trừ là ÁNH XẠ `đường:hàm`: **cùng nội dung** ở một đường KHÁC vẫn bị bắt.
    const nhuChu = `export async function setup2FA(userId: number, secret: string) {
        await ghiBiMatNguoiDung(userId, { twoFactorSecret: secret });
      }
      export async function h(ctx: any, secret: string) { await setup2FA(ctx.user.id, secret); }`;
    expect(viPhamTrongNguon(CHU_TANG_DB, nhuChu), "chủ tầng-DB được miễn").toEqual([]);
    expect(
      viPhamTrongNguon("server/db/authKhac.ts", nhuChu).length,
      "một file KHÁC mang CÙNG nội dung KHÔNG được miễn hộ (miễn trừ theo ĐƯỜNG, không theo TÊN)",
    ).toBeGreaterThanOrEqual(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * §3 — LƯỚI **HÀNH VI**: lượng từ ở trên chứng minh *hàng rào CÓ MẶT*; ô dưới chứng minh nó **CHẠY**
 * (và — quan trọng ngang bằng — rằng nó **KHÔNG khoá ai ra khỏi 2FA**).
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

const OPEN_ID = `c1_setup2fa_${Date.now()}`;
let uid = 0;

async function ctxCua(): Promise<TrpcContext> {
  const hang = await db.getUserById(uid);
  return {
    user: hang as unknown as User,
    sessionToken: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as unknown as TrpcContext["res"],
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ Pha 8 Task 4b (#9) — **GỠ PHỤ THUỘC THỨ TỰ.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ Ba ô dưới đây từng dùng chung **một** hàng `users` **và** trạng thái `twoFactorEnabled` của
 * nó, mỗi ô **thừa hưởng** tiền đề từ ô chạy trước. Đo được (`--sequence.shuffle.tests`, hạt giống
 * tất định): **2/6 hạt cho ĐỎ** — `seed=2` ⇒ 2 ô đỏ, `seed=3` ⇒ 1 ô đỏ, bốn hạt còn lại xanh.
 * Cơ chế, đã truy tới tận cùng chứ không đoán:
 *   · ô *"2FA ĐANG BẬT"* chạy **trước** ô *"chưa bật"* ⇒ chưa có hạt giống nào ⇒ cầu chì
 *     `truoc` **null**; và nó đã kịp `enable2FA` ⇒ ô *"chưa bật"* sau đó bị TỪ CHỐI ⇒ đỏ **thứ hai**.
 * ⇒ Đây là **ca đỏ GIẢ**: sản phẩm đúng, tiền đề của phép đo sai. Và ca đỏ giả bào mòn lòng tin vào
 *   cổng — dự án này đã **ba pha liên tiếp** chẩn đoán sai vì nhiễu kiểu ấy.
 *
 * ⇒ Bản vá: **mỗi ô TỰ DỰNG tiền đề của mình**, không thừa hưởng của ai. Tiền đề nay **đọc được
 *   ngay trong ô** thay vì nằm ẩn ở vị trí sắp xếp — một ô test không được phụ thuộc vào việc ai
 *   chạy trước nó. Cổng ra: chạy một mình + shuffle, **5/5 xanh** (xem báo cáo Task 4).
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

describe("★★★ C-1 §3 — HÀNH VI: 2FA đang bật ⇒ `user.setup2FA` TỪ CHỐI, hạt giống KHÔNG đổi", () => {
  beforeAll(async () => {
    const r = await db.createLocalUser({
      username: OPEN_ID,
      passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
      name: "C-1 — setup2FA guard",
      role: "user",
    });
    uid = r.id;
  });

  afterAll(async () => {
    if (uid) await db.deleteUser(uid); // FK ON DELETE CASCADE dọn hàng `user_secrets` hộ
  });

  /**
   * Tiền đề *"tài khoản đang TẮT 2FA"* — dựng tường minh, không thừa hưởng.
   * ⚠ `disable2FA` **xoá** hạt giống, nên gọi nó là đủ để về trạng thái đầu.
   */
  async function tatHai2Fa(): Promise<void> {
    await db.disable2FA(uid);
  }

  /**
   * Tiền đề *"tài khoản đang BẬT 2FA **và** có một hạt giống ĐANG DÙNG"* — dựng tường minh qua
   * **tầng DB**, không qua router (router chính là thứ đang được đo; dùng nó để dựng tiền đề thì
   * ô test đo chính nó).
   */
  async function bat2FaCoHatGiong(): Promise<string> {
    await db.disable2FA(uid);
    const hat = "JBSWY3DPEHPK3PXP";
    await db.setup2FA(uid, hat);
    await db.enable2FA(uid);
    return hat;
  }

  it("★★★ ĐỐI CHỨNG DƯƠNG — người CHƯA bật 2FA VẪN đăng ký được (bản vá là THU HẸP, không phải KHOÁ)", async () => {
    expect(uid).toBeGreaterThan(0);
    await tatHai2Fa(); // ★ Task 4b — tiền đề TỰ DỰNG, không thừa hưởng ô chạy trước
    const ra = await appRouter.createCaller(await ctxCua()).user.setup2FA();
    expect(ra.secret, "người chưa bật 2FA phải nhận được hạt giống mới").toMatch(/^[A-Z2-7]{16,}$/);
    expect(ra.qrCode.startsWith("data:image/"), "QR phải sinh được").toBe(true);
    const luu = await db.get2FAStatus(uid);
    expect(luu?.twoFactorSecret, "hạt giống phải được GHI xuống `user_secrets`").toBe(ra.secret);
  }, 20_000);

  it("★★★★ 2FA ĐANG BẬT ⇒ TỪ CHỐI, và hạt giống ĐANG DÙNG **KHÔNG ĐỔI**", async () => {
    // ★ Task 4b — tiền đề TỰ DỰNG: trước đây ô này mượn hạt giống do ô "chưa bật" ghi hộ, nên chạy
    //   trước ô ấy là cầu chì `truoc` null ⇒ ĐỎ GIẢ.
    const hat = await bat2FaCoHatGiong();
    const truoc = (await db.get2FAStatus(uid))!.twoFactorSecret;
    expect(truoc, "cầu chì: phải có một hạt giống ĐANG DÙNG để mà bảo vệ").toBeTruthy();
    expect(truoc, "cầu chì: hạt giống đang dùng phải đúng cái vừa dựng").toBe(hat);

    await expect(
      appRouter.createCaller(await ctxCua()).user.setup2FA(),
      "một phiên bị chiếm tự cấp được hạt giống mới ⇒ MỌI cổng step-up của Pha 4–7 thành trang trí",
    ).rejects.toThrow();

    const sau = (await db.get2FAStatus(uid))!;
    expect(sau.twoFactorSecret, "hạt giống ĐANG DÙNG bị ghi đè ⇒ người dùng hợp lệ mất 2FA IM LẶNG").toBe(truoc);
    expect(sau.twoFactorEnabled, "cờ 2FA phải giữ nguyên").toBe(true);
  }, 20_000);

  it("★★★ ĐỐI CHỨNG DƯƠNG — tắt 2FA rồi thì thiết lập lại được (đường hợp lệ KHÔNG bị chặn)", async () => {
    // ★ Task 4b — tiền đề TỰ DỰNG: ô này phải thật sự đi qua lượt **BẬT → TẮT**, chứ không ăn may
    //   một tài khoản vốn đã tắt sẵn do thứ tự sắp xếp.
    await bat2FaCoHatGiong();
    await db.disable2FA(uid);
    const ra = await appRouter.createCaller(await ctxCua()).user.setup2FA();
    expect(ra.secret, "sau khi tắt 2FA, người dùng phải thiết lập lại được").toMatch(/^[A-Z2-7]{16,}$/);
  }, 20_000);
});
