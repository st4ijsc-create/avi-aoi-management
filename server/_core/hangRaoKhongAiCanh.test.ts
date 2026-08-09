/**
 * ★★★ Pha 8 Task 4 — **BA HÀNG RÀO CÓ THẬT MÀ KHÔNG CƠ CHẾ NÀO CANH.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * §4a — **LUẬT KHAI BẮT BUỘC cho `user_secrets`** (nợ #6).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO CẦN: CỔNG KIỂU C-2 LÀ MỘT **∃**, KHÔNG PHẢI MỘT **∀**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pha 7 / C-2 dựng `KhongMangBiMat<T>` (`./publicUser`) — *"nhét một ô bí mật vào giá trị trả về là
 * **LỖI BIÊN DỊCH**"*. Nhưng `tsc` chỉ kiểm **nơi kiểu ấy được KHAI**. Câu duy nhất cưỡng chế lời
 * khai, trước hôm nay, là một **regex trên đúng MỘT tên**:
 *
 *     userExposureScan.test.ts:  /get2FAStatus:[\s\S]{0,200}?Promise<\s*KhongMangBiMat</
 *
 * Đó là **∃ x** (*"tồn tại một thủ tục có khai"*), không phải **∀ x**. Đo được ở Bước 1 hôm nay:
 * **9** thủ tục tRPC đọc `user_secrets`, **1** khai, **8 HỞ** — và cả 8 lọt qua `npm run check`,
 * `check:tests`, toàn bộ cổng 42 đường. Một thủ tục **thứ MƯỜI** viết ngày mai cũng vậy.
 *
 * ⇒ Bất biến ở đây là **∀**, và cả hai đầu đều **SUY RA**:
 *   ***∀ thủ tục tRPC trong `server/**` gọi một NGƯỜI ĐỌC BÍ MẬT của `user_secrets`: handler của nó
 *   phải KHAI TƯỜNG MINH kiểu trả về mang `KhongMangBiMat<…>`.***
 *
 *  • **Tập người đọc** — suy từ `server/db/auth.ts` bằng `nguoiDocBiMatCuaUserSecrets()`, **một
 *    chủ dùng chung** với `userExposureScan.test.ts` (Pha 8 Task 4a chuyển nó về
 *    `deployProcedureScan.ts` — hai bản sao thì bản yếu hơn quyết định lưới nào đỏ).
 *  • **Tập cột bí mật** — suy từ `USER_SECRETS_FIELD_VISIBILITY`, nên cột bí mật **thứ BA** tự vào.
 *  • **Phạm vi quét** — `moiFileDuoi` + `laFileTest`, **DÙNG LẠI** bộ suy chung. Một thủ tục **MỚI
 *    trong FILE MỚI** nằm trong lượng từ **theo cấu tạo** — đây là phép thử **M3**, và nó đã được
 *    nghiệm bằng một đột biến THẬT trên đĩa (xem báo cáo Task 4), không chỉ bằng nguồn tổng hợp.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ ĐÂY LÀ LƯỚI **HÌNH DẠNG**, KHÔNG PHẢI LƯỚI **HÀNH VI** — VÀ ĐÓ LÀ CHỦ Ý
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nó trả lời *"thủ tục này có MANG lời khai không"*, **không** trả lời *"giá trị trả về có sạch
 * không"*. Nửa sau do **hai** cơ chế khác canh, và ba cái bổ nhau chứ không thay nhau:
 *   · `tsc` — một khi đã khai, nhét ô bí mật vào là **lỗi biên dịch** (hành vi, lúc biên dịch);
 *   · `userExposureScan.test.ts` §5 — quét **mọi nơi** xem ô bí mật có rời máy chủ (hành vi, lúc chạy);
 *   · ô ∀ dưới đây — bảo đảm nửa `tsc` **được bật ở MỌI thủ tục**, không chỉ ở thủ tục ai đó nhớ.
 * Gỡ bất kỳ cái nào ⇒ hai cái còn lại **không** thay thế được nó.
 *
 * ⚠⚠ VÙNG MÙ ĐƯỢC KHAI VÀ ĐƯỢC **ĐẾM** (đừng đọc màu xanh thành "đã phủ hết")
 *  1. **Điểm đọc NGOÀI thủ tục tRPC** — hôm nay **5** (`authService` · `_core/index.ts` ·
 *     `oauth.ts` ×2 · `_core/trpc.ts`). Chúng là hàm nội bộ, không phải bề mặt trả cho client, nên
 *     cổng KIỂU không áp được nguyên trạng. Số ấy được **GHIM** ở ô cuối §4a: nó tăng ⇒ ĐỎ ⇒ phải
 *     có người **quyết**, thay vì một bề mặt mới trôi vào vùng mù im lặng.
 *  2. Thủ tục **REST** (`express`) không nằm trong lượng từ này; trục ấy do §5 của
 *     `userExposureScan.test.ts` canh (theo giá trị, không theo lời khai).
 *  3. Lời khai được đọc theo **văn bản kiểu** (`KhongMangBiMat` có mặt trong node kiểu). Một bí
 *     danh `type X = KhongMangBiMat<…>` rồi khai `Promise<X>` sẽ **không** được nhận — fail-closed,
 *     và đó là chủ ý: một lớp bí danh nữa là một chỗ nữa để luật trôi đi.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  nguoiDocBiMatCuaUserSecrets,
  quetThuTucDocBiMat,
  moiFileDuoi,
  laFileTest,
} from "../routers/deployProcedureScan";
import { moiCotBiMatCuaUserSecrets } from "./publicUser";
import { readFileSync } from "node:fs";
import ts from "typescript";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/_core
const GOC = join(TEST_DIR, "..", "..");

/** Tên cổng KIỂU phải xuất hiện trong lời khai kiểu trả về. */
const DAU_KHAI = "KhongMangBiMat";

const COT_BI_MAT = moiCotBiMatCuaUserSecrets();
const DOC_BI_MAT = nguoiDocBiMatCuaUserSecrets(GOC, COT_BI_MAT);
const THU_TUC = quetThuTucDocBiMat(GOC, DOC_BI_MAT);

/**
 * ★★★ Điểm gọi người-đọc-bí-mật **NGOÀI** mọi thủ tục tRPC — vùng mù (1) ở trên, đo lại mỗi lượt
 * chạy để con số ghim không bao giờ là một lời kể cũ.
 */
function diemGoiNgoaiThuTuc(): string[] {
  const ra: string[] = [];
  if (DOC_BI_MAT.length === 0) return ra;
  const ten = (n: ts.CallExpression): string => {
    const e = n.expression;
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) return e.name.text;
    return "";
  };
  for (const f of moiFileDuoi(GOC, "server", [".ts"]).filter((x) => !laFileTest(x.duong))) {
    const ma = readFileSync(f.that, "utf8");
    if (!DOC_BI_MAT.some((d) => ma.includes(d))) continue;
    const sf = ts.createSourceFile(f.that, ma, ts.ScriptTarget.Latest, true);
    const trongThuTuc: ts.Node[] = [];
    const d1 = (n: ts.Node): void => {
      if (
        ts.isPropertyAssignment(n) &&
        ts.isCallExpression(n.initializer) &&
        ["query", "mutation", "subscription"].includes(ten(n.initializer))
      ) {
        trongThuTuc.push(n);
      }
      ts.forEachChild(n, d1);
    };
    d1(sf);
    const d2 = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && DOC_BI_MAT.includes(ten(n))) {
        if (!trongThuTuc.some((t) => t.pos <= n.pos && n.end <= t.end)) {
          ra.push(`${f.duong}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}  ${ten(n)}`);
        }
      }
      ts.forEachChild(n, d2);
    };
    d2(sf);
  }
  return ra.sort();
}

/** ★★★ GHIM số điểm đọc nằm ngoài lượng từ. Hôm nay: **5**. Một cái thứ SÁU phải là một quyết định. */
const SO_DIEM_NGOAI = 5;

describe("★★★ Pha 8 Task 4a — ∀ thủ tục đọc `user_secrets` PHẢI KHAI phân loại (`KhongMangBiMat`)", () => {
  it("★★★ cầu chì — tập cột bí mật và tập NGƯỜI ĐỌC đều KHÁC RỖNG (rỗng ⇒ mọi ô dưới là chân lý rỗng)", () => {
    expect(
      COT_BI_MAT.length,
      "0 cột bí mật ⇒ `KhongMangBiMat<T>` = `T` ⇒ cổng KIỂU là trang trí, và ô ∀ dưới đây vô nghĩa",
    ).toBeGreaterThan(0);
    expect(COT_BI_MAT, "hạt giống TOTP phải nằm trong tập").toContain("twoFactorSecret");
    expect(COT_BI_MAT, "hash mật khẩu phải nằm trong tập").toContain("passwordHash");
    // Neo vào hai người đọc ĐO ĐƯỢC — bộ suy trượt chúng nghĩa là nó mù đúng thứ cần thấy.
    expect(DOC_BI_MAT, "`layBiMatNguoiDung` phải nằm trong tập người đọc").toContain("layBiMatNguoiDung");
    expect(DOC_BI_MAT, "`get2FAStatus` phải nằm trong tập người đọc").toContain("get2FAStatus");
  });

  it("★★★ cầu chì — quét thấy đủ THỦ TỤC (0 ⇒ lưới đang canh một tập rỗng và luôn xanh)", () => {
    expect(
      THU_TUC.length,
      "không tìm thấy thủ tục nào đọc `user_secrets` trong server/** — phạm vi quét đã hỏng?\n" +
        "⚠ Đo được ở Pha 8 Task 4a: **9** thủ tục (twoFactorRouter ×4 · userRouters ×4 · routers.ts#login).",
    ).toBeGreaterThanOrEqual(9);
    // …và chúng phải trải trên NHIỀU file: một tập gom về một file là dấu hiệu quét hỏng phạm vi.
    expect(
      new Set(THU_TUC.map((t) => t.file)).size,
      "mọi thủ tục rơi vào cùng một file ⇒ phạm vi quét đệ quy đã hỏng",
    ).toBeGreaterThanOrEqual(3);
  });

  it("★★★★ ∀ — KHÔNG thủ tục nào đọc `user_secrets` mà THIẾU lời khai `KhongMangBiMat`", () => {
    const ho = THU_TUC.filter((t) => !t.kieuKhai.includes(DAU_KHAI));
    const bao = ho.map((t) => `  · ${t.file}:${t.dong}  ${t.ten}()  ← ${t.nguoiDoc}  kiểu khai: ${t.kieuKhai || "(KHÔNG khai)"}`).join("\n");
    expect(
      bao,
      "MỘT THỦ TỤC ĐỌC `user_secrets` KHÔNG MANG CỔNG KIỂU.\n" +
        "⚠ Cổng `KhongMangBiMat` chỉ chặn **nơi được khai**. Thiếu lời khai ⇒ `tsc` **ban phước** cho\n" +
        "  một giá trị trả về mang `twoFactorSecret`/`passwordHash`, và không ô nào khác nhận ra:\n" +
        "  đúng lượt rò C-2 đã đo được (thêm `twoFactorSecret` vào `user.get2FAStatus` ⇒ check SẠCH,\n" +
        "  58/58 XANH).\n" +
        "⇒ Khai kiểu trả về tường minh: `.query/.mutation(async (…): Promise<KhongMangBiMat<{…}>> => {…})`.\n",
    ).toBe("");
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — `user.get2FAStatus` (thủ tục C-2 vá) vẫn nằm TRONG lượng từ và vẫn KHAI", () => {
    // ⚠ Nếu lượng từ trượt mất chính thủ tục mà Pha 7 đã vá, thì nó đang canh hẹp hơn tên gọi.
    const g = THU_TUC.find((t) => t.file.endsWith("server/routers/userRouters.ts") && t.ten === "get2FAStatus");
    expect(g, "`user.get2FAStatus` rơi khỏi lượng từ ⇒ bộ quét đang mù đúng thủ tục C-2 vá").toBeTruthy();
    expect(g!.kieuKhai).toContain(DAU_KHAI);
  });

  it("★★★ SỐ điểm đọc NGOÀI thủ tục tRPC được GHIM — vùng mù phải được ĐẾM, không được trôi im lặng", () => {
    const ngoai = diemGoiNgoaiThuTuc();
    expect(
      ngoai.length,
      "số điểm đọc `user_secrets` nằm NGOÀI mọi thủ tục tRPC đã đổi:\n" +
        ngoai.map((x) => `  · ${x}`).join("\n") +
        "\n⚠ Đây là vùng lưới này CỐ Ý không canh (hàm nội bộ, không phải bề mặt trả cho client).\n" +
        "  Một điểm MỚI ở đây có thể là một bề mặt mới đang mọc ra ngoài cổng KIỂU ⇒ phải có người\n" +
        "  QUYẾT, rồi cập nhật `SO_DIEM_NGOAI`.\n",
    ).toBe(SO_DIEM_NGOAI);
  });
});
