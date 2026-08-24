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
  diemDocBiMatCuaUserSecrets,
  diemDocBiMatTrongNguon,
  nhapUserSecrets,
  moiFileNhapUserSecrets,
  quetThuTucDocBiMat,
  moiFileDuoi,
  laFileTest,
  phanGiaiToi,
} from "../routers/deployProcedureScan";
import { moiCotBiMatCuaUserSecrets, tenSqlCuaBangBiMat, moiTenSqlCotBiMat } from "./publicUser";
import { readFileSync, existsSync } from "node:fs";
import ts from "typescript";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/_core
const GOC = join(TEST_DIR, "..", "..");

/** Tên cổng KIỂU phải xuất hiện trong lời khai kiểu trả về. */
const DAU_KHAI = "KhongMangBiMat";

const COT_BI_MAT = moiCotBiMatCuaUserSecrets();
const SQL_BI_MAT = { bang: tenSqlCuaBangBiMat(), cot: moiTenSqlCotBiMat() };
const DOC_BI_MAT = nguoiDocBiMatCuaUserSecrets(GOC, COT_BI_MAT, SQL_BI_MAT);
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

/**
 * ★★★ GHIM số điểm đọc nằm ngoài lượng từ. Một điểm MỚI phải là một quyết định.
 *
 * `5 → 6` (2026-08-24): điểm thứ sáu là `aiCodingCli/danhTinhCli.ts:173` — cổng danh
 * tính của CLI (commit `54b1844d`) gọi `get2FAStatus(user.id)`. ĐÃ XEM XÉT trước khi
 * nâng ghim, đúng nghi thức của cổng này:
 *   • chỉ rút ra MỘT boolean (`twoFactorEnabled === true`) — không bí mật nào rời hàm;
 *   • fail-CLOSED: đọc hỏng hoặc trả `null` ⇒ TỪ CHỐI (`LOI_HE_THONG`), không "coi như
 *     không bật" — docblock tại chỗ nói rõ vì sao;
 *   • giá trị trả về chỉ mang `{ userId, role, ten }` — không trường nào từ `user_secrets`.
 * ⇒ Nâng ghim là ghi nhận một điểm đọc AN TOÀN, không phải nới lỏng. Cái thứ BẢY vẫn
 *   phải qua đúng nghi thức này.
 */
const SO_DIEM_NGOAI = 6;

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

  /* ════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★★ §4b — **LƯỢNG TỪ THEO KHÁI NIỆM, KHÔNG THEO ĐƯỜNG DẪN** (review TOÀN NHÁNH Pha 8 · I-1)
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Bộ suy *"người đọc bí mật"* trả về **TÊN HÀM KHAI BÁO**. Một lượt đọc nằm trong một **hàm mũi
   * tên** — chính là thân một thủ tục tRPC — **không có tên để trả** ⇒ nó rơi khỏi tập ấy **theo
   * cấu tạo**, và cả hai lưới tiêu thụ đều mù. Đo được: tiêm vào một **FILE MỚI** một thủ tục đọc
   * `userSecrets` thẳng bằng drizzle rồi **trả hạt giống TOTP** ⇒ **39/39 XANH**, `check` sạch.
   *
   * ⇒ Hai ô dưới đây đóng khe ấy bằng **hai lượng từ ĐỘC LẬP**, cố ý không thay nhau:
   *   · §4b — *"∀ điểm đọc bí mật phải nằm trong một HÀM CÓ TÊN"* (⇒ nó vào tập người đọc ⇒ chịu
   *     luật KHAI BẮT BUỘC ở trên). Bắt theo **HÌNH DẠNG LƯỢT ĐỌC**.
   *   · §4c — *"∀ file sản xuất `server/**` CẦM bảng `userSecrets` phải nằm trong tập KHAI"*. Bắt
   *     theo **QUYỀN TRUY CẬP**, kể cả khi lượt đọc dùng một hình dạng bộ suy chưa biết (SQL thô).
   * ══════════════════════════════════════════════════════════════════════════════════════════════ */
  it("★★★★ §4b ∀ điểm đọc bí mật `user_secrets` phải nằm trong một HÀM CÓ TÊN", () => {
    const diem = diemDocBiMatCuaUserSecrets(GOC, COT_BI_MAT, SQL_BI_MAT);
    // Cầu chì: bộ suy phải THẤY kho mã thật (0 điểm ⇒ ô này là chân lý rỗng).
    expect(
      diem.length,
      "0 điểm đọc bí mật trong `server/**` — bộ suy đang mù với repo",
    ).toBeGreaterThanOrEqual(2);
    expect(
      diem.filter((d) => d.hamBao === null).map((d) => `  · ${d.file}:${d.dong}`).join("\n"),
      "MỘT LƯỢT ĐỌC BÍ MẬT `user_secrets` KHÔNG NẰM TRONG MỘT HÀM CÓ TÊN.\n" +
        "⚠ Tập NGƯỜI ĐỌC được suy theo **tên hàm khai báo**; một lượt đọc trong hàm mũi tên (thân\n" +
        "  một thủ tục tRPC chẳng hạn) KHÔNG có tên để trả ⇒ nó rơi khỏi tập **theo cấu tạo**, và\n" +
        "  luật KHAI BẮT BUỘC ở trên không bao giờ chạm tới nó. Đo được: một thủ tục như vậy TRẢ\n" +
        "  HẠT GIỐNG TOTP xuống trình duyệt với 39/39 XANH và `npm run check` sạch.\n" +
        "⇒ Đọc bí mật qua một hàm CÓ TÊN của `server/db/auth.ts` (`layBiMatNguoiDung`/`get2FAStatus`),\n" +
        "  đừng dựng câu truy vấn tại chỗ trong thân thủ tục.\n",
    ).toBe("");
  });

  /**
   * **TẬP KHAI — mọi file sản xuất được phép CẦM bảng `user_secrets`.** Ghim SỐ; mỗi mục một lý do.
   * ⚠ Đo được hôm nay: đúng **hai**. Chốt một con số đang gần 0 thì rẻ.
   */
  const CAM_USER_SECRETS: { duong: string; vi_sao: string }[] = [
    {
      duong: "server/db/auth.ts",
      vi_sao: "CỬA DUY NHẤT tới `user_secrets` (Pha 7 Task 9c) — ba hàm đọc/ghi bí mật sống ở đây.",
    },
    {
      duong: "server/_core/publicUser.ts",
      vi_sao:
        "chỉ lấy **tên cột** (`getTableColumns(userSecrets)`) để suy `USER_SECRETS_FIELD_VISIBILITY` " +
        "— không có lượt đọc dữ liệu nào; đó là nguồn sự thật của chính tập COT_BI_MAT.",
    },
  ];

  it("★★★★ §4c ∀ file sản xuất `server/**` CẦM bảng `userSecrets`: phải nằm trong tập KHAI", () => {
    const cam = moiFileNhapUserSecrets(GOC);
    // Cầu chì HAI CHIỀU: bộ suy phải thấy chủ thật, nếu không ô này xanh vì mù.
    expect(cam, "`server/db/auth.ts` rơi khỏi bộ suy ⇒ nó đang mù, không phải kho mã đang sạch").toContain(
      "server/db/auth.ts",
    );
    const khai = new Set(CAM_USER_SECRETS.map((c) => c.duong));
    expect(
      cam.filter((f) => !khai.has(f)).map((f) => `  · ${f}`).join("\n"),
      "MỘT FILE SẢN XUẤT NGOÀI TẬP KHAI ĐANG CẦM BẢNG `user_secrets`.\n" +
        "⚠ Cầm được bảng là dựng được câu truy vấn — kể cả bằng một hình dạng mà bộ suy §4b chưa\n" +
        "  biết (SQL thô, `sql\\`…\\``). Đây là cầu chì ĐẢO LƯỢNG TỪ: nó chốt **quyền truy cập**, không\n" +
        "  chốt hình dạng lượt đọc.\n" +
        "⇒ Đi qua `server/db/auth.ts`. Nếu thật sự cần một chủ mới, thêm mục vào `CAM_USER_SECRETS`\n" +
        "  kèm lý do — đó là một quyết định an ninh phải viết ra.\n",
    ).toBe("");
    // …và lời khai không được RỘNG hơn tập thật (mục ma vẫn tiếp tục THA cho một file mới trùng chỗ).
    expect(
      CAM_USER_SECRETS.filter((c) => !cam.includes(c.duong)).map((c) => c.duong),
      "mục KHAI trỏ tới một file không còn cầm bảng ⇒ gỡ dòng ấy đi",
    ).toEqual([]);
    expect(CAM_USER_SECRETS.every((c) => c.vi_sao.length > 0), "mỗi mục phải có lý do").toBe(true);
  });

  it("★★★★ §4d M3 — một thủ tục đọc `userSecrets` trong FILE CHƯA TỒN TẠI bị BẮT bởi CẢ HAI ô", () => {
    /**
     * ⚠⚠⚠ Đây **đúng** đột biến mà reviewer dùng để chứng minh lỗ I-1 (đã tái hiện trên đĩa: 39/39
     * XANH trước bản vá). Giữ nó ở dạng nguồn tổng hợp để lượt hồi quy không cần đột biến trên đĩa.
     */
    const FILE_MOI = "server/routers/rotHatGiongN1Router.ts";
    const ma = `
      import { eq } from "drizzle-orm";
      import { router, protectedProcedure } from "../_core/trpc";
      import { getDb } from "../db/connection";
      import { userSecrets } from "../../drizzle/schema";
      export const r = router({
        rotHatGiong: protectedProcedure.query(async ({ ctx }) => {
          const db = await getDb();
          const hang = await db
            .select({ twoFactorSecret: userSecrets.twoFactorSecret })
            .from(userSecrets)
            .where(eq(userSecrets.userId, ctx.user.id))
            .limit(1);
          return { twoFactorSecret: hang[0]?.twoFactorSecret ?? null };
        }),
      });`;
    // (a) trục HÌNH DẠNG LƯỢT ĐỌC — điểm đọc nằm trong một hàm mũi tên ⇒ `hamBao === null`.
    const diem = diemDocBiMatTrongNguon(FILE_MOI, ma, COT_BI_MAT, SQL_BI_MAT);
    expect(diem.length, "lượt đọc mới rơi khỏi bộ suy ⇒ nó mù với file mới").toBeGreaterThanOrEqual(1);
    expect(
      diem.some((d) => d.hamBao === null),
      "lượt đọc trong thân thủ tục vẫn được coi là 'có tên' ⇒ §4b sẽ không bao giờ đỏ",
    ).toBe(true);
    // (b) trục QUYỀN TRUY CẬP — file mới CẦM bảng, và nó không nằm trong tập KHAI.
    expect(nhapUserSecrets(GOC, FILE_MOI, ma), "bộ suy 'cầm bảng' mù với nhập TĨNH").toBe(true);
    expect(CAM_USER_SECRETS.some((c) => c.duong === FILE_MOI), "file mới KHÔNG được tự vào tập khai").toBe(false);
    // (c) …và cùng bộ suy ấy phải thấy được **nhập ĐỘNG** (hình dạng reviewer đã dùng).
    const maDong = `
      export async function f(db: any, id: number) {
        const { userSecrets } = await import("../../drizzle/schema");
        return db.select({ twoFactorSecret: userSecrets.twoFactorSecret }).from(userSecrets);
      }`;
    expect(nhapUserSecrets(GOC, FILE_MOI, maDong), "bộ suy 'cầm bảng' mù với nhập ĐỘNG").toBe(true);
    // (d) ĐỐI CHỨNG DƯƠNG — chỉ nhập KIỂU thì KHÔNG cầm được bảng lúc chạy ⇒ được tha.
    const maKieu = `import type { UserSecrets } from "../../drizzle/schema";\nexport type X = UserSecrets;`;
    expect(nhapUserSecrets(GOC, FILE_MOI, maKieu), "nhập KIỂU bị coi là cầm bảng ⇒ dương tính giả").toBe(false);
  });

  /* ════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★★ Pha 9 nhóm A · **A3 — SQL THÔ ĐỌC `user_secrets`: TRƯỚC LƯỢT NÀY, **KHÔNG LƯỚI NÀO THẤY**.
   * ════════════════════════════════════════════════════════════════════════════════════════════
   * §4b suy người đọc theo **lời gọi drizzle** (`.select({…})` / `.select().from(userSecrets)`).
   * §4c bắt theo **quyền truy cập**, nhưng nó hỏi *"file này có NHẬP định danh `userSecrets` không"*.
   * Một câu SQL **thô** không làm cả hai việc ấy: nó không gọi drizzle, và nó **không nhập gì cả** —
   * nó chỉ viết chữ `user_secrets` trong một chuỗi.
   *
   * **ĐO ĐƯỢC TRƯỚC BẢN VÁ** (ba hình dạng dựng sẵn, đối chứng là hình dạng drizzle tương đương):
   *     drizzle có phép chiếu                       ⇒ **1** điểm
   *     `sql\`SELECT "twoFactorSecret" FROM user_secrets …\``  ⇒ **0** điểm  ← MÙ
   *     `sql\`SELECT * FROM user_secrets\``                    ⇒ **0** điểm  ← MÙ
   * ⇒ Lượt rò qua cánh cửa ấy vô hình với **cả hai** lưới, và `npm run check` sạch.
   *
   * ⚠⚠⚠ **PHÉP ĐO ĐÃ BÁC BỎ MỘT TIỀN ĐỀ CỦA CHÍNH BẢN VÁ, VÀ ĐÓ LÀ LÝ DO TÊN SQL PHẢI SUY TỪ DRIZZLE.**
   *    Bản đầu của lượt đo dùng `two_factor_secret` / `password_hash` — tức **giả định** quy ước
   *    camelCase → snake_case. Sự thật của kho mã này: `drizzle/schema/auth.ts` khai
   *    `pgTable("user_secrets", { twoFactorSecret: varchar("twoFactorSecret", …) })` — **BẢNG
   *    snake_case, CỘT camelCase**. Một hàm `camelToSnake` viết tay sẽ sinh ra tên **không tồn tại
   *    trong DB này**, và lưới sẽ xanh vĩnh viễn vì nó đi tìm thứ không có. ⇒ Tên lấy từ
   *    `getTableName()` + `.name` của cột — **nguồn sự thật DUY NHẤT** (`_core/publicUser.ts`).
   * ════════════════════════════════════════════════════════════════════════════════════════════ */
  describe("★★★★ §4e A3 — SQL THÔ chạm bí mật `user_secrets`", () => {
    it("★★★ CẦU CHÌ — tên SQL suy từ drizzle, KHÔNG phải quy ước viết tay", () => {
      expect(SQL_BI_MAT.bang, "tên bảng suy sai ⇒ mọi ô dưới đi tìm một thứ không tồn tại").toBe("user_secrets");
      expect(
        SQL_BI_MAT.cot,
        "★ Kho mã này khai CỘT camelCase trong khi BẢNG snake_case — một phép đổi quy ước viết tay\n" +
          "  sẽ cho `two_factor_secret` và lưới sẽ XANH VĨNH VIỄN vì đi tìm tên không có thật.",
      ).toEqual(["passwordHash", "twoFactorSecret"]);
    });

    it("★★★★ M3 — SQL THÔ trong một FILE CHƯA TỒN TẠI bị BẮT (ca phân biệt 'theo ĐƯỜNG THOÁT' với 'theo FILE')", () => {
      const FILE_MOI = "server/routes/rotHatGiongSqlThoN1.ts";
      expect(existsSync(join(GOC, FILE_MOI)), "ca này giả định file ấy chưa tồn tại").toBe(false);

      /**
       * ⚠ File này **KHÔNG nhập `userSecrets`** và **KHÔNG gọi drizzle** — đó là cả điểm mấu chốt:
       *   §4b và §4c đều mù với nó theo **cấu tạo**. Nó vẫn rót hạt giống TOTP xuống client.
       */
      const maTho = [
        'import { sql } from "drizzle-orm";',
        'import { getDb } from "../db/connection";',
        "export async function rotHatGiong(userId: number) {",
        "  const db = await getDb();",
        '  const r = await db!.execute(sql`SELECT "twoFactorSecret" FROM user_secrets WHERE "userId" = ${userId}`);',
        "  return r.rows[0];",
        "}",
      ].join("\n");

      const diem = diemDocBiMatTrongNguon(FILE_MOI, maTho, COT_BI_MAT, SQL_BI_MAT);
      expect(
        diem.length,
        "SQL THÔ đọc cột bí mật KHÔNG bị bắt ⇒ một lượt rò đi qua cánh cửa này là VÔ HÌNH với cả hai lưới",
      ).toBeGreaterThanOrEqual(1);
      // …và nó phải mù với hai bộ suy CŨ — đó là bằng chứng ô này canh một trục MỚI, không trùng lặp.
      expect(
        nhapUserSecrets(GOC, FILE_MOI, maTho),
        "file SQL thô KHÔNG nhập `userSecrets` — nếu ô này `true` thì §4c đã phủ rồi và §4e thừa",
      ).toBe(false);
    });

    it("★★★ `SELECT *` trên bảng bí mật bị bắt (không cần nêu tên cột nào)", () => {
      const ma = [
        'import { sql } from "drizzle-orm";',
        "export async function docSao(db: any, id: number) {",
        "  return db.execute(sql`SELECT * FROM user_secrets WHERE \"userId\" = ${id}`);",
        "}",
      ].join("\n");
      expect(
        diemDocBiMatTrongNguon("server/routes/saoN1.ts", ma, COT_BI_MAT, SQL_BI_MAT).length,
        "`SELECT *` kéo MỌI cột kể cả bí mật — không bắt là để ngỏ đúng hình dạng lười nhất",
      ).toBeGreaterThanOrEqual(1);
    });

    it("★★★★ I-3 — `SELECT <bí danh>.*` (hình dạng tự nhiên nhất của một JOIN) cũng bị bắt", () => {
      /**
       * ══════════════════════════════════════════════════════════════════════════════════════════
       * ⚠⚠⚠ Review TOÀN NHÁNH Pha 9 · **I-3 — LƯỚI CANH HẸP HƠN TÊN GỌI CỦA CHÍNH NÓ.**
       * ══════════════════════════════════════════════════════════════════════════════════════════
       * Ca ngay trên tên là *"`SELECT *` … **không cần nêu tên cột nào**"*, nhưng vị từ đứng sau nó
       * là `\bselect\s+\*` (không nhận bí danh) — chỉ dạng **trần**. Đo trước bản vá, qua chính bộ suy này:
       *
       *     SELECT *  (trần)                     => 1 điểm
       *     SELECT s.*                           => **0** điểm   ← MÙ
       *     SELECT us.*, u.id (JOIN với users)   => **0** điểm   ← MÙ
       *
       * ⇒ Cách viết **có xác suất cao nhất** để một câu SQL thô chạm `user_secrets` là gắn nó vào
       *   `users` bằng `JOIN` rồi lấy `us.*`. Đúng hình dạng ấy đi qua **cả ba** lưới (§4b · §4c ·
       *   §4e) mà không lưới nào thấy — tức lỗ A3 vừa vá **còn nguyên một nửa**, và nay có một ca
       *   XANH mang tên *"`SELECT *` … bị bắt"* đứng cạnh. Đây là *"biến thể thứ năm"* của lớp lỗi
       *   **lưới canh hẹp hơn tên gọi**.
       */
      const biDanhTran = [
        'import { sql } from "drizzle-orm";',
        "export async function docBiDanh(db: any, id: number) {",
        '  return db.execute(sql`SELECT s.* FROM user_secrets s WHERE s."userId" = ${id}`);',
        "}",
      ].join("\n");
      expect(
        diemDocBiMatTrongNguon("server/routes/biDanhN1.ts", biDanhTran, COT_BI_MAT, SQL_BI_MAT).length,
        "`SELECT s.*` KHÔNG bị bắt ⇒ đúng nửa lỗ A3 còn mở, và một ca xanh đứng cạnh nói ngược lại",
      ).toBeGreaterThanOrEqual(1);

      const join = [
        'import { sql } from "drizzle-orm";',
        "export async function docJoin(db: any, id: number) {",
        "  return db.execute(sql`SELECT us.*, u.id FROM users u JOIN user_secrets us ON us.\"userId\" = u.id WHERE u.id = ${id}`);",
        "}",
      ].join("\n");
      expect(
        diemDocBiMatTrongNguon("server/routes/joinN1.ts", join, COT_BI_MAT, SQL_BI_MAT).length,
        "`SELECT us.*, u.id` trong một JOIN — hình dạng có xác suất cao nhất — vẫn lọt",
      ).toBeGreaterThanOrEqual(1);
    });

    it("★★★ chuỗi THƯỜNG (không phải `sql` tag) cũng bị bắt — bộ dò ở tầng LITERAL, không ở tầng một API", () => {
      /**
       * ⚠ Người ta chạm DB bằng nhiều cửa: `sql` tag, `pool.query`, `client.query`, một hằng chuỗi
       *   nối vào sau. Ghim bộ dò vào **một** cửa là dựng lại đúng vùng mù vừa vá.
       */
      const ma = [
        "export async function docPool(pool: any, id: number) {",
        "  const CAU = 'SELECT \"passwordHash\" FROM user_secrets WHERE \"userId\" = $1';",
        "  return pool.query(CAU, [id]);",
        "}",
      ].join("\n");
      expect(
        diemDocBiMatTrongNguon("server/routes/poolN1.ts", ma, COT_BI_MAT, SQL_BI_MAT).length,
        "một hằng chuỗi SQL gán vào biến rồi mới dùng ⇒ vẫn phải bị bắt",
      ).toBeGreaterThanOrEqual(1);
    });

    it("★★★★ ĐỐI CHỨNG DƯƠNG — câu SQL KHÔNG chạm bí mật KHÔNG bị bắt (chống dương tính giả)", () => {
      /**
       * ⚠⚠ Không có ô này, vị từ *"chuỗi có chứa `user_secrets`"* sẽ xanh một cách vô nghĩa: nó đỏ
       *    cho **mọi** câu chạm bảng, kể cả `SELECT "userId"` (đếm hàng), kể cả một dòng bình luận.
       *    Lưới đỏ vì chuyện vô hại là lưới sẽ bị người sau tắt đi.
       */
      const dem = [
        'import { sql } from "drizzle-orm";',
        "export async function demHang(db: any) {",
        "  return db.execute(sql`SELECT COUNT(*) AS n FROM user_secrets`);",
        "}",
      ].join("\n");
      // ⚠ `COUNT(*)` chứa dấu `*` nhưng KHÔNG phải `SELECT *` — vị từ phải phân biệt được.
      // ⚠⚠ I-3 nới vị từ sang `SELECT <bí danh>.*`. Ô này là **nửa còn lại** của lượt nới: nếu ai
      //    nới thành `/select[\s\S]*\*/` thì `COUNT(*)` khớp và lưới đỏ vì chuyện vô hại — một lưới
      //    như thế sẽ bị người sau tắt đi. Giữ ô này ĐÚNG CHỖ NÓ ĐANG ĐỨNG.
      expect(
        diemDocBiMatTrongNguon("server/routes/demN1.ts", dem, COT_BI_MAT, SQL_BI_MAT).length,
        "`SELECT COUNT(*)` bị xếp là đọc bí mật ⇒ dương tính giả (dấu `*` không phải `SELECT *`)",
      ).toBe(0);

      // ⚠ Và một bí danh KHÔNG đứng ngay sau `select` cũng không được kéo vào: `SELECT n.name … `
      const cotThuong = [
        'import { sql } from "drizzle-orm";',
        "export async function docCot(db: any) {",
        '  return db.execute(sql`SELECT us."userId" FROM user_secrets us`);',
        "}",
      ].join("\n");
      expect(
        diemDocBiMatTrongNguon("server/routes/cotThuongN1.ts", cotThuong, COT_BI_MAT, SQL_BI_MAT).length,
        "`SELECT us.\"userId\"` (đếm hàng, không chạm bí mật) bị bắt ⇒ lượt nới I-3 đã đi quá một bậc",
      ).toBe(0);

      const bangKhac = [
        'import { sql } from "drizzle-orm";',
        "export async function docBangKhac(db: any) {",
        '  return db.execute(sql`SELECT "passwordHash" FROM user_secrets_backup_2024`);',
        "}",
      ].join("\n");
      expect(
        diemDocBiMatTrongNguon("server/routes/khacN1.ts", bangKhac, COT_BI_MAT, SQL_BI_MAT).length,
        "một bảng KHÁC có tên bắt đầu bằng `user_secrets` bị nhận nhầm ⇒ vị từ thiếu biên từ",
      ).toBe(0);
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ §4c (nợ #8) — **LỚP `vi.mock` ĐỔI HÀNH VI MÃ SẢN PHẨM.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sự cố gốc: `vi.mock("drizzle-orm")` thay các **nguyên thuỷ dựng truy vấn** (`eq` · `and` · `sql`)
 * bằng bản giả, nên một `DELETE` khớp **0 hàng** — **không ném, không kêu** — và lưới vẫn xanh
 * **trên một bản mã đã bị thay**. Nguy hiểm của lớp này là nó **im lặng**: mọi cơ chế báo lỗi đều
 * dựa vào một ngoại lệ, mà ở đây không có ngoại lệ nào.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ CÂU CỦA KẾ HOẠCH **KHÔNG CƯỠNG CHẾ ĐƯỢC NGUYÊN VĂN** — VÀ ĐÂY LÀ SỐ ĐO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Kế hoạch phát biểu: *"KHÔNG file test nào được `vi.mock` một module hạ tầng DB mà không
 * `importOriginal`"*. Đếm thật hôm nay (Bước 1 Task 4):
 *   · `vi.mock(<chuỗi>)` trong test toàn repo: **1.515** lượt
 *   · nhắm nguyên thuỷ ORM/driver + `db/connection`: **306** lượt, **305** không `importOriginal`
 *   · nhắm tầng `db` của ứng dụng (`./db`, `./db/*`, `drizzle/schema`): **320** lượt nữa
 *   ⇒ **~624 lượt / 225+ file**. Một tập ngoại lệ 624 phần tử **không phải một cổng** — nó là một
 *     ảnh chụp sẽ mục, và mỗi lượt sửa sẽ là một lượt "cập nhật con số" vô nghĩa.
 * ⇒ **Rút lại phạm vi, và NÓI THẲNG.** Lưới này canh **đúng tiền đề của sự cố**, nơi số vi phạm
 *   hôm nay là **0** nên nó là một cổng thật:
 *
 *   ***∀ file test giả các NGUYÊN THUỶ DỰNG TRUY VẤN của `drizzle-orm` (không `importOriginal`):
 *   nó PHẢI vô hiệu hoá đường tới một KẾT NỐI DB THẬT (`vi.mock` `server/db/connection.ts`).***
 *
 * Vì sao đúng tiền đề: nguyên thuỷ giả **chỉ vô hại** khi không có kết nối thật nào để chạy phải
 * mệnh đề `WHERE` méo. Giả `eq()` **+ kết nối THẬT** = đúng hình dạng đã đẻ ra `DELETE` khớp 0 hàng.
 * Đo được: **77** file giả nguyên thuỷ, **77/77** đã chặn `db/connection` ⇒ vi phạm **0**.
 *
 * ⚠⚠ VÙNG MÙ ĐƯỢC KHAI (lưới này HẸP HƠN câu của kế hoạch — đừng đọc màu xanh thành "đã phủ hết")
 *  1. **~624 lượt giả tầng `db`/`drizzle/schema` KHÔNG được canh.** Lớp lỗi ở đó là **TRÔI HÌNH
 *     DẠNG** (bản giả thiếu một khoá mà mã sản phẩm vừa bắt đầu cần) — Task 1 hôm nay đã đẻ ra
 *     đúng một ca (`sdk.authCache.test.ts` phải bổ sung `phaiDoiMatKhau` vào bản giả `./db`).
 *     ⚠ Nó **không quyết định được tĩnh**: "thiếu khoá nào" phụ thuộc mã sản phẩm nào đang được
 *     đo, tức cần phân tích liên module. Ghi vào **nợ mới** của Task 4, không giả vờ đã phủ.
 *  2. Lưới đọc **HÌNH DẠNG mã test**, không chạy nó. Nó không biết bản giả có ngữ nghĩa đúng không —
 *     chỉ biết *"có kết nối thật nào còn với tới được không"*.
 *  3. `vi.mock` với đường nhập **không phải chuỗi hằng** (biến/`import.meta`) nằm ngoài tầm.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Đường nhập bị coi là **nguyên thuỷ dựng truy vấn**. */
const LA_NGUYEN_THUY = (spec: string): boolean => spec === "drizzle-orm" || spec.startsWith("drizzle-orm/");

/** Dấu khai ngoại lệ có chủ ý, kèm lý do một dòng ngay tại chỗ. */
const DAU_MIEN_MOCK = "@MOCK-DB-OK";
/** GHIM số ngoại lệ. Hôm nay: 0. Một ngoại lệ mới phải là một quyết định NÓI RA. */
const SO_MIEN_MOCK = 0;

/** File **sản xuất** dựng một kết nối drizzle — SUY RA, không viết tay. Hôm nay: 2. */
function congKetNoi(): string[] {
  const ra: string[] = [];
  for (const f of moiFileDuoi(GOC, "server", [".ts"]).filter((x) => !laFileTest(x.duong))) {
    const ma = readFileSync(f.that, "utf8");
    if (!ma.includes("drizzle(")) continue;
    const sf = ts.createSourceFile(f.that, ma, ts.ScriptTarget.Latest, true);
    let co = false;
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "drizzle") co = true;
      ts.forEachChild(n, di);
    };
    di(sf);
    if (co) ra.push(f.duong);
  }
  return ra.sort();
}

/**
 * Factory của `vi.mock` có **DÙNG** `importOriginal` không — hỏi theo **VIỆC DÙNG THAM SỐ**, không
 * theo **TÊN** tham số.
 * ⚠⚠ Đây là một lỗi THIẾT BỊ đã đo được trong chính lượt Task 4: bản dò đầu tiên hỏi
 *    `ten.includes("importOriginal")` ⇒ **bỏ sót** `vi.mock("drizzle-orm", async (orig) => …)` ở
 *    `server/db/stationTraceScope.test.ts` và khai nhầm nó là vi phạm. Tên tham số là quy ước của
 *    người viết; **việc gọi nó** mới là sự thật.
 */
function dungImportOriginal(fab: ts.Node | undefined, sf: ts.SourceFile): boolean {
  if (!fab || !(ts.isArrowFunction(fab) || ts.isFunctionExpression(fab))) return false;
  if (fab.parameters.length === 0) return false;
  const ten = fab.parameters[0]!.name.getText(sf);
  let dung = false;
  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      let e: ts.Node = n.expression;
      while (ts.isCallExpression(e) || ts.isPropertyAccessExpression(e)) e = e.expression;
      if (ts.isIdentifier(e) && e.text === ten) dung = true;
    }
    ts.forEachChild(n, di);
  };
  di(fab.body ?? fab);
  return dung;
}

interface FileGia {
  readonly duong: string;
  readonly dong: number;
  readonly chanKetNoi: boolean;
  readonly mien: boolean;
}

/** Mọi file test giả nguyên thuỷ dựng truy vấn, kèm việc nó có chặn kết nối thật hay không. */
function quetGiaNguyenThuy(): FileGia[] {
  const ra: FileGia[] = [];
  const CONN = join(GOC, "server", "db", "connection.ts");
  for (const nhanh of ["server", "shared", "client"]) {
    for (const f of moiFileDuoi(GOC, nhanh, [".ts", ".tsx"]).filter((x) => laFileTest(x.duong))) {
      const ma = readFileSync(f.that, "utf8");
      if (!ma.includes("vi.mock")) continue;
      const sf = ts.createSourceFile(f.that, ma, ts.ScriptTarget.Latest, true);
      let dong: number | null = null;
      let chan = false;
      const di = (n: ts.Node): void => {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          ts.isIdentifier(n.expression.expression) &&
          n.expression.expression.text === "vi" &&
          n.expression.name.text === "mock" &&
          n.arguments.length >= 1 &&
          ts.isStringLiteral(n.arguments[0]!)
        ) {
          const spec = (n.arguments[0] as ts.StringLiteral).text;
          if (LA_NGUYEN_THUY(spec) && !dungImportOriginal(n.arguments[1], sf)) {
            dong ??= sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
          }
          // Danh tính module hỏi bằng **phép nối đường dẫn**, không bằng chính tả chuỗi:
          // `"./connection"` từ `server/db/x.test.ts` và `"../../db/connection"` là MỘT module.
          if (phanGiaiToi(f.that, spec, CONN)) chan = true;
        }
        ts.forEachChild(n, di);
      };
      di(sf);
      if (dong !== null) ra.push({ duong: f.duong, dong, chanKetNoi: chan, mien: ma.includes(DAU_MIEN_MOCK) });
    }
  }
  return ra.sort((a, b) => a.duong.localeCompare(b.duong));
}

const GIA = quetGiaNguyenThuy();
const CONG_KET_NOI = congKetNoi();

describe("★★★ Pha 8 Task 4c — ∀ test giả nguyên thuỷ `drizzle-orm` PHẢI chặn kết nối DB THẬT", () => {
  it("★★★ cầu chì — quét thấy đủ file giả nguyên thuỷ (0 ⇒ lưới canh tập RỖNG và luôn xanh)", () => {
    expect(
      GIA.length,
      "không thấy file test nào giả `drizzle-orm` — phạm vi quét đã hỏng?\n" +
        "⚠ Đo được ở Pha 8 Task 4c: 77 file.",
    ).toBeGreaterThanOrEqual(50);
  });

  it("★★★★ ∀ — KHÔNG file nào vừa giả nguyên thuỷ truy vấn VỪA để lọt một kết nối DB THẬT", () => {
    const vp = GIA.filter((g) => !g.chanKetNoi && !g.mien);
    expect(
      vp.map((v) => `  · ${v.duong}:${v.dong}`).join("\n"),
      "MỘT FILE TEST GIẢ NGUYÊN THUỶ DỰNG TRUY VẤN MÀ VẪN VỚI TỚI KẾT NỐI DB THẬT.\n" +
        "⚠ Đây là tiền đề CHÍNH XÁC của sự cố: `eq()` giả ⇒ mệnh đề `WHERE` méo ⇒ `DELETE` khớp\n" +
        "  0 hàng, KHÔNG NÉM KHÔNG KÊU ⇒ lưới xanh trên một bản mã đã bị thay.\n" +
        "⇒ Hoặc `vi.mock` luôn `server/db/connection.ts` (không còn kết nối thật nào để chạy sai),\n" +
        "  hoặc dùng `importOriginal()` rồi chỉ ghi đè thứ thật sự cần,\n" +
        "  hoặc khai ngoại lệ bằng dấu `" +
        DAU_MIEN_MOCK +
        "` kèm lý do một dòng (và cập nhật SO_MIEN_MOCK).\n",
    ).toBe("");
  });

  it("★★★ SỐ ngoại lệ được GHIM — một vùng mù mới phải là một quyết định NÓI RA", () => {
    const mien = GIA.filter((g) => g.mien);
    expect(
      mien.length,
      "số lượt khai `" + DAU_MIEN_MOCK + "` đã đổi:\n" + mien.map((m) => `  · ${m.duong}`).join("\n"),
    ).toBe(SO_MIEN_MOCK);
  });

  it("★★★ CẦU CHÌ CỔNG KẾT NỐI — tập module sản xuất dựng kết nối drizzle được GHIM (nay: 2)", () => {
    /**
     * ⚠⚠ Luật ở trên đòi chặn `server/db/connection.ts` vì đó là **cổng chính** ra kết nối thật.
     * Nhưng nó **không phải cổng duy nhất**: `server/db/timescale.ts` cũng dựng một kết nối riêng.
     * Một cổng **thứ BA** xuất hiện ngày mai sẽ làm luật trên **hẹp hơn tên gọi của nó** — nên tập
     * ấy được **SUY RA và GHIM**, thay vì để nó nở ra im lặng.
     */
    expect(
      CONG_KET_NOI.join("\n"),
      "tập module dựng kết nối drizzle đã đổi — luật ∀ ở trên chỉ đòi chặn `server/db/connection.ts`,\n" +
        "nên một cổng MỚI nghĩa là có đường tới kết nối thật mà lưới này KHÔNG canh ⇒ phải QUYẾT.\n",
    ).toBe(["server/db/connection.ts", "server/db/timescale.ts"].join("\n"));
  });

  it("★★ KHÔNG BẮT NHẦM — `importOriginal` nhận theo VIỆC DÙNG, không theo TÊN tham số", () => {
    /**
     * ⚠⚠⚠ Ca này neo vào một lỗi **THIẾT BỊ** đã xảy ra thật trong lượt dựng lưới: bản dò đầu tiên
     * so tên tham số với chuỗi `"importOriginal"` ⇒ khai nhầm `stationTraceScope.test.ts`
     * (`async (orig) => { const actual = await orig(); … }`) là vi phạm. Nếu ô này đỏ, bộ dò đã
     * quay về so tên — và con số 0 vi phạm ở trên sẽ là một con số SAI.
     */
    const ca: Array<[string, string, boolean]> = [
      ["tên `importOriginal`", `vi.mock("drizzle-orm", async (importOriginal) => ({ ...(await importOriginal()) }));`, true],
      ["tên `orig` — CÙNG cơ chế", `vi.mock("drizzle-orm", async (orig) => ({ ...(await orig()) }));`, true],
      ["có tham số nhưng KHÔNG dùng", `vi.mock("drizzle-orm", async (orig) => ({ eq: () => 1 }));`, false],
      ["không factory", `vi.mock("drizzle-orm");`, false],
      ["factory không tham số", `vi.mock("drizzle-orm", () => ({ eq: () => 1 }));`, false],
    ];
    for (const [ten, ma, mong] of ca) {
      const sf = ts.createSourceFile("x.test.ts", ma, ts.ScriptTarget.Latest, true);
      let thay: boolean | null = null;
      const di = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "mock") {
          thay = dungImportOriginal(n.arguments[1], sf);
        }
        ts.forEachChild(n, di);
      };
      di(sf);
      expect(thay, `biến thể "${ten}" bị nhận sai`).toBe(mong);
    }
  });
});
