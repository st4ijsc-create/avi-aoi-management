/**
 * ★★★ Pha 5 — vá review TOÀN NHÁNH, **I-1: CỔNG GHI TRONG KẾ HOẠCH KHÔNG CHẠY FILE CƯỠNG CHẾ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI: 2/3 ĐỘT BIẾN CỦA REVIEWER **SHIP ĐƯỢC** VÌ ĐÚNG LÝ DO NÀY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * §"Cổng kiểm chung" của kế hoạch liệt kê **9 đường**, và `server/routers/vramPermissionSplit.test.ts`
 * — **662 dòng, TOÀN BỘ phép cưỡng chế của Task 3b** — **không có trong danh sách**. Đo được:
 *
 * | đột biến | cổng **của kế hoạch** | cổng **+ file bị sót** |
 * |---|---|---|
 * | W1 hoán vị `canDelete`↔`canCreate` | ★ **99/1675 XANH** | 2 ca đỏ |
 * | W3 `retryDeferred` lên `deployProcedure` | ★ **XANH** | 1 ca đỏ |
 *
 * Commit cuối của nhánh (`13116471`) tên là *"RR-M4 — cổng thiếu **3 file** test"* và **vẫn** bỏ sót
 * cái nặng nhất — **phần tử thứ N+1 của một danh sách**, tái diễn ngay trong bản vá dựng ra để đóng
 * chính lớp lỗi ấy. (Lượt rà này tìm thêm **một** file nữa: `aiCopilotActions.hardlinkSink.test.ts`,
 * lưới của **Task 1 / C-1** — ba sink của `preview()` ghi thẳng vào DB + sổ audit.)
 *
 * ⇒ Bản vá không thể là *"thêm hai đường nữa"* — danh sách nào cũng có phần tử thứ N+1. Nên lưới ở
 * đây **đảo lượng từ**: thay vì liệt kê, nó phát biểu
 *
 *   ***MỌI file `*.test.ts` tự khai là lưới của Pha 5 (mang chuỗi `"Pha 5"` trong mã) PHẢI được
 *   một đường của §Cổng kiểm chung phủ.***
 *
 * Đối tượng **tự khai**: một lưới Pha 5 mới sinh ra ở bất kỳ thư mục nào cũng tự đưa mình vào lượng
 * từ, không cần ai nhớ cập nhật danh sách.
 *
 * ⚠ **KHÔNG dùng glob để CHẠY cổng** (Global Constraints: glob rỗng ⇒ vitest im lặng, cổng khai
 * XANH — đã che 18 ca đỏ thật). Cổng vẫn chạy bằng **đường dẫn tường minh**; lưới này chỉ kiểm rằng
 * danh sách tường minh ấy **ĐỦ**, và nó **ghim SỐ** để một lượt co/nở im lặng là ĐỎ.
 * ⚠ Mọi đường của cổng phải **TỒN TẠI trên đĩa** — một đường gõ sai là một đường vitest bỏ qua.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../server/services/vram
const GOC = join(TEST_DIR, "..", "..", ".."); // gốc repo
const KE_HOACH = join(GOC, "docs", "superpowers", "plans", "2026-08-06-vram-pha5-tra-no.md");

/**
 * ★★★ Pha 6 Task 1 / (E) — **NHẬN DIỆN BẰNG VỊ TRÍ, KHÔNG BẰNG CHÍNH TẢ.**
 *
 * ⚠⚠⚠ VÌ SAO LUẬT ĐỔI: bản trước nhận diện đối tượng bằng **nội dung** — file có chứa chuỗi
 * `"Pha 5"` hay không. Hai lượt đo bắt nó ngay trong Pha 6:
 *  • lưới `vramStepUpFreshness.test.ts` bản đầu chỉ viết `PHA 5` **viết HOA** ⇒ **lọt khỏi lượng
 *    từ** trong khi cổng vẫn xanh 100%;
 *  • đột biến **R3** của reviewer: một file test **mới**, **không chứa** `Pha 5`, có ca **cố tình
 *    đỏ** ⇒ **cổng khai XANH 103/103**.
 * Và Task 2–5 của Pha 6 sẽ sinh **≥4 lưới nữa**, **không lưới nào** có lý do viết `Pha 5`.
 * ⇒ Nhận diện phải là một sự thật **KHÔNG SỬA ĐƯỢC BẰNG CÁCH VIẾT KHÁC ĐI**: **vị trí trên đĩa**
 *   và **tên file**. Một lưới của module VRAM **ở đâu** thì nó **là** lưới của module VRAM.
 *
 * ⚠ Luật content cũ **KHÔNG bị bỏ** — nó được **HỢP** vào, vì có lưới Pha 5 nằm ngoài module VRAM
 *   (`aiCopilotActions.hardlinkSink.test.ts`, `permissions.machineControl.test.ts`). Hợp hai vị từ
 *   chỉ **nới rộng** đối tượng bị canh, không bao giờ thu hẹp.
 * ⚠ Tên file này giữ nguyên vì lý do lịch sử (được trích dẫn ở hai kế hoạch + một báo cáo đã chốt);
 *   **luật bên trong** mới là bất biến, không phải cái tên.
 */
const DAU_KHAI = "Pha 5";

/**
 * ★★★ Pha 6 Task 3 (F2) — **BỘ NHẬN DIỆN THỨ BA: "tự khai thuộc MỘT pha" ∧ "đã nằm trong cổng".**
 *
 * ⚠⚠ VÌ SAO CẦN: hai bộ trên nhận diện được (a) lưới **module VRAM** (vị trí/tên) và (b) lưới
 * **tự khai chuỗi `Pha 5`**. Lưới của **Pha 6 nằm NGOÀI module VRAM** không rơi vào bộ nào —
 * `toolArgCoverage.test.ts` (luật F2, `server/services/aiLocalTools/`) **được cổng CHẠY** nhưng
 * **không được con số ghim canh**: ai xoá nó đi cũng **không ca nào đỏ**. Bài học Pha 5 nói thẳng:
 * *"ai gỡ nó cũng không thấy ca nào đỏ"* **KHÔNG** phải lý do không canh — nó **CHÍNH LÀ** lý do
 * phải canh.
 *
 * ⚠ Bộ thứ ba **giao** điều kiện tự-khai với **chính vị từ `duocPhu`**: nó **không bao giờ** thêm
 * một file nằm ngoài cổng (bất biến ấy đúng **theo cấu tạo**), nên nó chỉ làm **con số ghim** phủ
 * rộng hơn — đúng thứ đang thiếu — mà không đụng tới danh sách đường chạy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ I-4 (review Task 3) — **MẪU `/\bPha\s+\d+\b/` MÙ VỚI `Pha 2B`, VÀ LỖ VẪN MỞ THẬT.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `\d+\b` đòi một ranh giới từ **ngay sau chữ số**; `Pha 2B` có `B` là ký tự từ ⇒ **không khớp**.
 * Người review đo: xoá `client/src/lib/errorCodes.vram.unit.test.ts` (**121 ca**, lưới VRAM, **nằm
 * trong cổng**, tự khai `Pha 2B`) ⇒ **cổng vẫn XANH**. Đối chứng: xoá `toolArgCoverage.test.ts`
 * ⇒ ĐỎ. ⇒ Bộ nhận diện **chưa** làm đúng việc nó được dựng ra để làm.
 *
 * Đếm cách viết **thật** trong repo (`grep -hoiE "\bPha\s+[0-9][0-9A-Za-z.]*"` trên `*.test.ts`):
 * `Pha 2B` **53** · `Pha 5` 44 · `Pha 4` 39 · `Pha 2A` 36 · `Pha 3` 35 · `Pha 6` 25 ·
 * **`Pha 1.5` 23** · `Pha 1` 22 · `Pha 2` 5 · và các biến thể VIẾT HOA (`PHA 2A`, `PHA 5`…).
 * ⇒ Mẫu phải nhận **hậu tố chữ** (`2A`/`2B`) và **số thập phân** (`1.5`), **không phân biệt hoa
 *   thường**. `\b` mở đầu vẫn giữ để `alpha 2` không bị nhận.
 *
 * ⚠⚠ BÀI HỌC ĐO LƯỜNG (I-3): con số nền của bản trước ("68 file / 4 ngoài cổng") đo bằng
 * `grep -E "Pha [0-9]"` — **một công cụ KHÁC** với mẫu đã ship. Số đúng của mẫu đã ship là
 * **55 file / 1 ngoài cổng**. *Một con số đo bằng công cụ khác công cụ đang chạy thì không mô tả
 * hệ thống.* Nên bộ đếm dưới đây là **thứ duy nhất** được trích dẫn từ nay.
 */
const DAU_KHAI_PHA = /\bPha\s+\d+(?:\.\d+)?[A-Za-z]?\b/i;

/**
 * File test này có thuộc **module VRAM** không — hỏi bằng **VỊ TRÍ** (nằm dưới một thư mục tên
 * `vram`) hoặc **TÊN FILE** (`vram*`, không phân biệt hoa thường). Phủ đúng ba vị trí mà reviewer
 * nêu (`server/routers/vram*` · `server/services/vram/**` · `client/src/lib/vram*`) **và rộng hơn**
 * — một lưới VRAM sinh ra ở thư mục thứ tư cũng tự vào lượng từ.
 */
function laLuoiVram(duongTuongDoi: string): boolean {
  const doan = duongTuongDoi.split("/");
  const ten = doan[doan.length - 1] ?? "";
  return doan.slice(0, -1).includes("vram") || /^vram/i.test(ten);
}

/** Thư mục được quét — cả ba nhánh mà Pha 5 chạm tới. */
const NHANH = ["server", join("client", "src"), "shared"];

function duong(p: string): string {
  return relative(GOC, p).split(sep).join("/");
}

function moiFileTest(goc: string, ra: string[] = []): string[] {
  if (!existsSync(goc)) return ra;
  for (const ten of readdirSync(goc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(goc, ten);
    if (statSync(p).isDirectory()) moiFileTest(p, ra);
    else if (ten.endsWith(".test.ts")) ra.push(p);
  }
  return ra;
}

/**
 * Rút **danh sách đường** của §Cổng kiểm chung ra khỏi chính file kế hoạch.
 *
 * ⚠ Đọc từ **văn bản kế hoạch**, không chép lại vào đây: nếu lưới giữ một bản sao thứ hai của cổng
 * thì nó chỉ chứng minh bản sao ấy đúng, còn cái người ta thật sự chạy vẫn tự do lệch đi.
 */
function duongCuaCong(): string[] {
  const md = readFileSync(KE_HOACH, "utf8");
  const i = md.indexOf("**Cổng kiểm chung");
  if (i === -1) return [];
  const mo = md.indexOf("```", i);
  const dong = md.indexOf("```", mo + 3);
  if (mo === -1 || dong === -1) return [];
  const khoi = md.slice(mo + 3, dong);
  const lenh = khoi.slice(0, khoi.indexOf("\nNODE_OPTIONS") === -1 ? undefined : khoi.indexOf("\nNODE_OPTIONS"));
  return lenh
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.includes("/") && !t.startsWith("--") && t !== "\\");
}

/** Một đường của cổng có phủ file này không (khớp đúng, hoặc là thư mục cha). */
function duocPhu(file: string, cong: string[]): boolean {
  return cong.some((c) => file === c || (c.endsWith("/") && file.startsWith(c)));
}

/**
 * ★★★ Pha 7 / I-1 — **CỔNG CANH SỰ TỒN TẠI CỦA ĐƯỜNG DẪN, KHÔNG CANH SỐ CA THẬT SỰ CHẠY.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐO ĐƯỢC: **XOÁ** một lưới thì ĐỎ, **ĐỔI TÊN** nó thì KHÔNG.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đổi `client/src/lib/i18nQuantifierGate.unit.test.ts` → `.test.ts`:
 * `client/src/lib/` **25 file / 517 ca → 24 / 505**, mà lưới này vẫn **10/10 XANH** và
 * `FILE_CANH` vẫn **74** — vì `moiFileTest` gom mọi `*.test.ts`, còn **vitest** chỉ gom
 * `client/src/**` qua `*.unit.test.ts`. **12 ca biến mất, không con số nào nhúc nhích.**
 *
 * ⇒ Ba bộ nhận diện trên trả lời *"file này CÓ BỊ CANH không"*; **không** bộ nào hỏi
 *   ***"vitest có THẬT SỰ GOM nó không"***. Đây là **glob rỗng** ở dạng nguy hiểm nhất: không phải
 *   đường dẫn gõ sai (ca `existsSync` đã canh), mà là **file có thật, đường có thật, mà runner
 *   không bao giờ nạp**.
 *
 * ⚠ Vị từ đọc `include` **từ chính `vitest.config.ts`**, không chép lại vào đây — giữ một bản sao
 *   thứ hai thì chỉ chứng minh bản sao ấy đúng (cùng lý lẽ với `duongCuaCong()`).
 */
const VITEST_CONFIG = join(GOC, "vitest.config.ts");

/** Rút mảng `include: [...]` khỏi `vitest.config.ts`. */
function mauCuaVitest(): string[] {
  const src = readFileSync(VITEST_CONFIG, "utf8");
  const i = src.indexOf("include:");
  if (i === -1) return [];
  const mo = src.indexOf("[", i);
  const dong = src.indexOf("]", mo);
  if (mo === -1 || dong === -1) return [];
  return [...src.slice(mo, dong).matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1] as string);
}

/** Glob của vitest → RegExp. Chỉ cần phủ `**\/` và `*`, đúng hình dạng mà cấu hình này dùng. */
function globSangRegex(g: string): RegExp {
  const than = g
    .split("**/")
    .map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join("(?:.*/)?");
  return new RegExp(`^${than}$`);
}

const MAU_VITEST = mauCuaVitest();

const CONG = duongCuaCong();
const MOI_FILE = NHANH.flatMap((n) => moiFileTest(join(GOC, n))).map((p) => ({ duong: duong(p), that: p }));

/** Lưới nhận diện bằng **NỘI DUNG** (luật cũ) — vẫn giữ, vì có lưới Pha 5 ngoài module VRAM. */
const FILE_PHA5 = MOI_FILE.filter((f) => readFileSync(f.that, "utf8").includes(DAU_KHAI))
  .map((f) => f.duong)
  .sort();
/** Lưới nhận diện bằng **VỊ TRÍ / TÊN** (luật mới) — không sửa được bằng cách viết khác đi. */
const FILE_VRAM = MOI_FILE.filter((f) => laLuoiVram(f.duong))
  .map((f) => f.duong)
  .sort();
/**
 * Lưới **tự khai thuộc một pha** ∧ **đã được cổng phủ** (Pha 6 Task 3). Xem lý lẽ ở `DAU_KHAI_PHA`.
 * ⚠ Bất biến theo cấu tạo: tập này **không bao giờ** đẩy thêm file ra ngoài cổng.
 */
const FILE_PHA_TRONG_CONG = MOI_FILE.filter(
  (f) => DAU_KHAI_PHA.test(readFileSync(f.that, "utf8")) && duocPhu(f.duong, CONG),
)
  .map((f) => f.duong)
  .sort();
/**
 * ★★★ Pha 7 Task 4a — **TẬP TỰ-KHAI ĐẦY ĐỦ, KHÔNG GIAO VỚI `duocPhu`.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO PHẢI CÓ TẬP THỨ HAI: `FILE_PHA_TRONG_CONG` **KHÔNG BAO GIỜ ĐỎ ĐƯỢC** cho lỗ này
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bộ nhận diện thứ ba **giao** điều kiện tự-khai với chính `duocPhu` — cố ý, và ca "KHÔNG TÁC HẠI"
 * ở dưới đo lại điều đó. Nhưng hệ quả là: một lưới **tự khai một pha mà nằm NGOÀI cổng** rơi khỏi
 * **cả ba** bộ nhận diện, nên **theo cấu tạo** nó không làm con số nào nhúc nhích. Đó chính là
 * *"hàng rào canh cái đã ở TRONG hàng rào"* — một lượng từ **tự thoả**.
 *
 * Đo được tại `d7227094`: **10 file** ở tình trạng ấy, trong khi kế hoạch Pha 7 (soạn từ báo cáo
 * review Pha 6) nêu **3**. Bảy file kia **vừa gia nhập trong chính Pha 7 Task 9**. ⇒ Một danh sách
 * ba tên đã có phần tử thứ N+1 **trước khi ai kịp đóng nó** — lần thứ **MƯỜI BẢY** của lớp lỗi ấy.
 *
 * ⇒ Tập này **KHÔNG giao với `duocPhu`**, và ca ∀ dưới đòi phần bù của nó **RỖNG**. Phần tử thứ
 *   mười một tự làm cổng ĐỎ, không cần ai nhớ đếm lại.
 */
const FILE_TU_KHAI_PHA = MOI_FILE.filter((f) => DAU_KHAI_PHA.test(readFileSync(f.that, "utf8")))
  .map((f) => f.duong)
  .sort();
/** ⚠ **HỢP**, không phải thay thế: ba vị từ chỉ nới rộng đối tượng bị canh. */
const FILE_CANH = [...new Set([...FILE_PHA5, ...FILE_VRAM, ...FILE_PHA_TRONG_CONG])].sort();

describe("★★★ I-1 + (E) — §Cổng kiểm chung phải PHỦ mọi lưới bị canh (đảo lượng từ, ghim SỐ)", () => {
  it("★★★ cầu chì — đọc được cổng từ file kế hoạch, và nó không rỗng", () => {
    expect(existsSync(KE_HOACH), `không thấy file kế hoạch: ${duong(KE_HOACH)}`).toBe(true);
    // ⚠ Pha 6 Task 1 (M-4): +1 đường — `server/routers/vramStepUpFreshness.test.ts`. Cổng của Pha 6
    //   là **cùng khối lệnh này**, nên một lưới mới ở bất kỳ pha nào cũng phải vào đây, không được
    //   sống ngoài cổng. 11 → 12.
    // ⚠ Pha 6 Task 3 / I-4: 12 → 13, thêm `server/services/aiAgentOrchestrator.authCtx.test.ts`.
    //   Lý do KHÔNG phải "cho đủ": nó canh **Critical của Pha 4** trên **người gọi `Tool.handler`
    //   THỨ HAI** (Agent tự trị, `argsWithAuthCtx` FAIL-OPEN ⇒ god-mode 29 tool) — tức **đúng bề
    //   mặt mà Task 3 vừa mở rộng** khi cho 8 tool lập trình với tới được từ đường Agent. Chi phí
    //   đo được: **5/5 xanh, 862 ms**.
    // ⚠ Pha 6 Task 1b: 13 → 14, thêm `server/routers/deployStepUpFreshness.test.ts` — lưới HÀNH VI
    //   của **cả 5 thủ tục deploy** sau khi `requirePerCallFreshTotp` được gộp vào **GỐC**
    //   `deployProcedure`. Nó nằm NGOÀI module VRAM và **không** chứa chuỗi `Pha 5`, nên hai bộ
    //   nhận diện đầu **MÙ** với nó; chỉ bộ thứ ba (`DAU_KHAI_PHA` ∧ `duocPhu`) thấy, và **chỉ khi**
    //   đường này có mặt ở §Cổng kiểm chung. Đó đúng là cơ chế mà (E) được dựng ra để làm.
    // ⚠ Pha 6 Task 6: 14 → 16, thêm `server/routers/totpReplay.test.ts` (lưới HÀNH VI của phép
    //   chống phát lại — một mã tiêu ĐÚNG MỘT LẦN, kèm ba đối chứng dương) và
    //   `server/routers/totpReplayScan.test.ts` (lưới ∀ *"MỌI lượt xác minh TOTP đi qua sổ"*, quét
    //   AST toàn `server/**`). Cả hai nằm NGOÀI module VRAM ⇒ bộ nhận diện theo vị trí MÙ với
    //   chúng; chúng tự khai `Pha 5` nên bộ theo nội dung thấy, và **chính vì thế** thiếu đường ở
    //   đây là ĐỎ ngay — đúng cơ chế I-1 được dựng ra để làm.
    // ⚠ Pha 7 Task 7: 19 → 21. Hai lưới của bản vá *"`auth.me` trả `passwordHash` +
    //   `twoFactorSecret` ra client"*, canh **HAI TRỤC KHÁC NHAU** của cùng một bất biến:
    //     · `server/_core/publicUser.test.ts` — **∀ CỘT**: mọi cột của `users` phải được phân loại
    //       (hai chiều với `getTableColumns`) ⇒ một cột bí mật **MỚI** làm nó ĐỎ. Đây là phép thử
    //       của **LUẬT**; một danh sách ba tên không bao giờ vượt qua được.
    //     · `server/routers/userExposureScan.test.ts` — **∀ BỀ MẶT**: quét AST toàn `server/**`,
    //       tập người-đọc-thô **SUY RA** từ chính `server/db/auth.ts` ⇒ một route MỚI trong FILE
    //       MỚI nằm trong lượng từ theo cấu tạo (phép thử M3).
    //   ⚠ `server/_core/` và `server/routers/*.test.ts` **không** có đường bao trong cổng, nên cả
    //     hai phải có đường RIÊNG — nếu không, chúng "theo cấu tạo không bao giờ được canh".
    // ⚠ Pha 7 Task 8a: 21 → 22. `server/_core/backupCodeWriteScan.test.ts` — lượng từ trên trục
    //   **NGƯỜI GHI** (*"∀ điểm ghi `backup_codes.code` phải ra từ `bamMaDuPhong()`"*). Nó canh ba
    //   lỗ mà tầng KIỂU (`.$type<MaDuPhongDaBam>()`) **không** thấy: gỡ nhãn · ép kiểu vòng qua ·
    //   đối số `.values()` không phân tích được. `server/_core/` **không** có đường bao trong cổng
    //   (chỉ `publicUser.test.ts` có đường riêng) ⇒ thiếu dòng này thì lưới ấy *"theo cấu tạo không
    //   bao giờ được canh"*.
    // ⚠ Pha 7 Task 9: 22 → 25. **BA** đường mới, ba trục khác nhau của cùng một lượt DDL:
    //   · `server/_core/backupCodeWidth.test.ts` — lượng từ **BỀ RỘNG** (9a): ∀ giá trị
    //     `bamMaDuPhong()` sinh ra phải vừa bề rộng khai của `backup_codes.code`, **cả hai vế suy
    //     ra**; kèm một ô ghi THẬT xuống DB (drizzle khai 255 mà DB còn 20 thì `tsc` vẫn xanh).
    //   · `server/_core/xoayBiMatNguon.test.ts` — **R2**: script xoay phải THẤT BẠI khi trỏ sai
    //     bảng, thay vì "báo cáo thành công mà không xoay gì" (lớp Critical của Pha 3).
    //   · `server/routers/mustChangePassword.test.ts` — **QĐ-1**: hai mốc trên `users` là
    //     `server-only`, `auth.me` có ô SUY RA, và ô ấy KHÔNG đến từ `ctx.user` (đã bị làm rỗng).
    //   `server/_core/` và `server/routers/` **không** có đường bao trong cổng ⇒ thiếu ba dòng này
    //   thì cả ba lưới *"theo cấu tạo không bao giờ được canh"*.
    // ⚠⚠⚠ Pha 7 Task 4a: 25 → 35. **MƯỜI** đường mới — và con số ấy là **phép đếm độc lập tại
    //   `d7227094`**, không phải con số của kế hoạch. Kế hoạch Pha 7 nêu **BA** file
    //   (`appErrorParamsCoverage` · `aiGgufEngine` · `kbSyncScheduler.evalGate`, đo bởi reviewer
    //   Pha 6); lượt đếm lại tìm **BẢY file nữa** — `server/_core/authService.test.ts` ·
    //   `server/api.test.ts` · `server/auth.sessionCacheLogout.test.ts` ·
    //   `server/auth.setupAdmin.test.ts` · `server/db/authCacheHooks.test.ts` ·
    //   `server/sdk.authCache.test.ts` · `server/services/authSessionCache.test.ts` — **vừa gia
    //   nhập trong CHÍNH Pha 7 Task 9** (tách `user_secrets`), tự khai `Pha 7 Task 9`, và **hai**
    //   trong số đó mang lượng từ **R1** trên `SERVER_ONLY_USER_FIELDS`.
    //   ⇒ Danh sách ba phần tử đã có **phần tử thứ N+1 trước khi ai kịp đóng nó**. Vì thế lượt này
    //     **không dừng ở việc thêm mười dòng**: ca *"∀ lưới TỰ KHAI một pha phải nằm trong cổng"*
    //     bên dưới biến danh sách thành **LUẬT**, suy ra từ một lượt quét đĩa.
    // ⚠ Pha 7 / review TOÀN NHÁNH **C-1**: 35 → 36. **Đúng MỘT** đường mới —
    //   `server/routers/totpSeedWriteScan.test.ts`, lượng từ trên trục **NGƯỜI GHI HẠT GIỐNG TOTP**
    //   (*"∀ điểm ghi `user_secrets.twoFactorSecret` trong `server/**` phải có hàng rào
    //   `twoFactorEnabled`"*) cộng lưới **HÀNH VI** của cùng bất biến. `server/routers/*.test.ts`
    //   **không** có đường bao trong cổng ⇒ thiếu dòng này thì lưới ấy *"theo cấu tạo không bao giờ
    //   được canh"*, đúng lỗ mà ca ∀ Task 4a bên dưới được dựng ra để bắt.
    // ⚠ Pha 7 / review TOÀN NHÁNH **I-4**: 36 → 37. **Đúng MỘT** đường mới —
    //   `server/_core/buocDoiMatKhau.test.ts`, lưới của **cổng buộc đổi mật khẩu phía máy chủ**
    //   (cờ Task 8 đặt ra có **0 người đọc client** + **0 phép cưỡng chế máy chủ** ⇒ một lời hứa
    //   an ninh không có thật). Ô chủ của nó là một **∀ trên 2.2k thủ tục** của `appRouter`, cộng
    //   ca ghim **lỗ MIỄN TRỪ CỐ Ý** cho vai `admin` (quyết định chủ dự án 2026-08-09).
    //   `server/_core/` **không** có đường bao trong cổng ⇒ thiếu dòng này thì lưới ấy *"theo cấu
    //   tạo không bao giờ được canh"*.
    // ⚠ Pha 7 / vá **NHÀ TÙ I-4**: 37 → 38. **Đúng MỘT** đường mới —
    //   `server/_core/xacThucNoiBo.test.ts`. Cổng I-4 ở trên cho `user.changePassword` đi qua,
    //   nhưng **bên trong** thủ tục ấy còn một cửa thứ hai (`loginMethod !== 'local'`) trong khi
    //   dữ liệu THẬT mang `'password'` ⇒ 4/4 tài khoản không-admin đang hoạt động **bị khoá ra
    //   ngoài**. Ô chủ của lưới mới là một **neo HAI CHIỀU vào mã SINH DỮ LIỆU** (seed script +
    //   `server/db/auth.ts`), cộng một **∀ trên AST** cấm mọi phép so `loginMethod` với chuỗi.
    //   `server/_core/` **không** có đường bao trong cổng ⇒ thiếu dòng này thì lưới ấy *"theo cấu
    //   tạo không bao giờ được canh"* — đúng lỗ đã để lưới §5 của I-4 khai XANH suốt.
    // ⚠ Pha 7 / mig `0316`: 38 → **39**, thêm `server/_core/xacThucNoiBoDb.test.ts`. Lý do KHÔNG
    //   phải "cho đủ": `0316` chốt tập *"phương thức xác thực nội bộ"* **lần thứ hai** (plpgsql,
    //   trong `kiem_xac_thuc_noi_bo()`) cạnh hằng TS đã có ⇒ **hai nguồn cho một khái niệm**, đúng
    //   cơ chế đã đẻ ra phần tử thứ N+1 mười bảy lần. Lưới mới đọc `pg_get_functiondef` **từ DB
    //   đang chạy** rồi neo HAI CHIỀU vào hằng TS. `server/_core/` không có đường bao trong cổng ⇒
    //   thiếu dòng này thì nó *"theo cấu tạo không bao giờ được canh"*.
    // ⚠ Pha 8 Task 3: 39 → **40**. Một lưới MỚI (`server/_core/xoaHangKhongGioiHanTrongTest.test.ts`
    //   — lượng từ *"∀ file test: xoá hàng `users` phải giới hạn theo hàng chính nó tạo"*). Nó tự
    //   khai `Pha 8` nên bộ nhận diện THỨ BA (`DAU_KHAI_PHA`) kéo nó vào tập bị canh ⇒ nó phải có
    //   đường riêng ở §Cổng kiểm chung. Gỡ đường ấy ⇒ **hai** ô đỏ trên **hai** trục.
    // ⚠ Pha 8 Task 1: 40 → **41**. Một lưới MỚI (`server/_core/buocDoiMatKhauMoiBeMat.test.ts` —
    //   lượng từ *"∀ điểm xác thực HTTP/socket trong `server/**`, cờ buộc-đổi-mật-khẩu phải được
    //   kiểm"*). Nó tự khai `Pha 8` ⇒ bộ nhận diện THỨ BA (`DAU_KHAI_PHA`) kéo nó vào tập bị canh
    //   ⇒ nó phải có đường riêng ở §Cổng kiểm chung. Gỡ đường ấy ⇒ **hai** ô đỏ trên **hai** trục.
    // ⚠ Pha 8 Task 2: 41 → **42**. Một lưới MỚI (`server/auth.logoutThuHoi.test.ts` — bất biến
    //   HAI VẾ *"sau `auth.logout`, phiên ấy không dùng được nữa **VÀ** hàng `user_sessions` không
    //   còn `isActive`"*). Nó tự khai `Pha 5` **và** `Pha 8` ⇒ bộ nhận diện THỨ NHẤT (nội dung) kéo
    //   nó vào tập bị canh ⇒ nó phải có đường riêng ở §Cổng kiểm chung. Gỡ đường ấy ⇒ **hai** ô đỏ
    //   trên **hai** trục.
    // ⚠ Pha 8 Task 4a: 42 → **43**. Một lưới MỚI (`server/_core/hangRaoKhongAiCanh.test.ts` — luật
    //   **KHAI BẮT BUỘC**: *"∀ thủ tục tRPC đọc `user_secrets` phải khai `KhongMangBiMat`"*). Nó
    //   đóng nửa mà cổng KIỂU C-2 để hở: C-2 chỉ chặn **nơi được khai**, và câu cưỡng chế lời khai
    //   trước đó là một **∃** trên đúng MỘT tên (`get2FAStatus`) ⇒ 8/9 thủ tục hở, cổng vẫn xanh.
    //   Nó tự khai `Pha 5` ⇒ bộ nhận diện THỨ NHẤT (nội dung) kéo nó vào tập bị canh ⇒ phải có
    //   đường riêng ở §Cổng kiểm chung. Gỡ đường ấy ⇒ **hai** ô đỏ trên **hai** trục.
    // ⚠ Pha 8 Task 5: 43 → **44**. Một lưới MỚI (`server/routers/hoTuyenSongSong.test.ts` — lượng
    //   từ trên **toàn HỌ tuyến song song xác thực**: *"∀ cặp thủ tục thao tác trên cùng một tài
    //   nguyên xác thực phải áp cùng bộ phép kiểm, trừ các cặp được KHAI TÊN kèm lý do"*). Phép đếm
    //   TAY ở `server/_core/totpOnce.ts:20-24` khai **HAI** cặp; phép đếm đảo lượng từ ra **29**.
    //   Nó tự khai `Pha 5` ⇒ bộ nhận diện THỨ NHẤT (nội dung) kéo nó vào tập bị canh ⇒ phải có
    //   đường riêng ở §Cổng kiểm chung. Gỡ đường ấy ⇒ **hai** ô đỏ trên **hai** trục.
    // ⚠ Pha 8 / siết 2FA: 44 → **45**. `server/routers/tat2FaDoiMatKhau.test.ts` — lưới **HÀNH VI**
    //   của bản vá *"`twoFactor.disable` đòi MẬT KHẨU + một yếu tố 2FA"*. Nó KHÔNG thay
    //   `hoTuyenSongSong.test.ts` (lưới HÌNH DẠNG, đọc mã) mà canh trục còn lại: **gọi thật** rồi
    //   đọc `users.two_factor_enabled`. Hai ô của nó không lưới nào khác canh được:
    //     · thứ tự phép kiểm — sai mật khẩu KHÔNG được ĐỐT mã 2FA của người dùng;
    //     · **chống NHÀ TÙ** — mật khẩu đúng + **mã dự phòng** vẫn tắt được 2FA (chủ dự án chọn
    //       SIẾT, không chọn XOÁ TUYẾN; siết quá tay là lớp lỗi đã ship nhà tù 4/4 ở Pha 7).
    //   `server/routers/*.test.ts` **không** có đường bao trong cổng ⇒ thiếu dòng này thì lưới ấy
    //   *"theo cấu tạo không bao giờ được canh"*.
    expect(CONG.length, "không rút được đường nào khỏi §Cổng kiểm chung — khối lệnh đã đổi hình dạng?").toBe(45); // Pha 8 siết 2FA: +1
  });

  it("★★★ MỌI đường của cổng TỒN TẠI trên đĩa (một đường gõ sai là một đường vitest bỏ qua)", () => {
    const thieu = CONG.filter((c) => !existsSync(join(GOC, c)));
    expect(thieu.join(" · "), "đường của cổng không tồn tại ⇒ cổng khai XANH cho một tập rỗng").toBe("");
  });

  it("★★★ cầu chì — cả HAI bộ nhận diện đều thấy đủ nhiều file (0 file ⇒ mọi khẳng định dưới là chân lý rỗng)", () => {
    expect(FILE_PHA5.length, "bộ quét NỘI DUNG không thấy file nào — nó đã hỏng?").toBeGreaterThanOrEqual(10);
    expect(FILE_VRAM.length, "bộ quét VỊ TRÍ/TÊN không thấy file nào — nó đã hỏng?").toBeGreaterThanOrEqual(40);
    // ⚠ Bộ VỊ TRÍ phải RỘNG HƠN HẲN bộ NỘI DUNG — nếu không, luật mới không thêm được gì.
    expect(
      FILE_VRAM.filter((f) => !FILE_PHA5.includes(f)).length,
      "luật VỊ TRÍ không bắt thêm file nào so với luật NỘI DUNG ⇒ (E) chưa đóng",
    ).toBeGreaterThanOrEqual(20);
    // ⚠ GHIM SỐ: một lưới mới sinh ra, hoặc một lưới cũ bị xoá, đều phải là một **quyết định nói
    //   ra**, không phải một lượt trôi im lặng.
    // ⚠ Pha 6 Task 2: +1 lưới — `server/services/vram/vramReadModel.drift.test.ts` (bẫy đo lường
    //   `effective`). Nó nằm **trong** vùng `server/services/vram/` mà cổng đã chạy, nên chỉ con số
    //   ghim này phải đổi: 62 → 63.
    // ⚠ Pha 6 Task 3 (F2 + I-4): 63 → 69. Chỉ **HAI** file là mã mới; **BA** file còn lại là lưới
    //   CŨ mà **trước Task 3 KHÔNG CON SỐ NÀO CANH** — đó là số đo của lỗ, không phải suy đoán.
    //   +2 lưới MỚI trong `server/services/aiLocalTools/` (đã nằm trong cổng):
    //     · `programmingTools.agentPath.test.ts` — hai ranh giới an ninh trên đường Agent NL;
    //     · `toolArgCoverage.test.ts` — luật ∀ "có đường lấy tham số" + "đường ấy SINH RA args hợp lệ".
    //   +3 lưới CŨ nay mới bị canh nhờ bộ nhận diện thứ ba (`DAU_KHAI_PHA` ∧ `duocPhu`):
    //     · `server/services/aiLocalTools/authCtxInjection.test.ts` (tự khai `Pha 4`);
    //     · `client/src/lib/errorCodes.vramCommands.unit.test.ts` (tên không bắt đầu bằng `vram`);
    //     · `client/src/lib/errorCodes.vram.unit.test.ts` — **121 ca**, tự khai `Pha 2B`.
    //       ⚠⚠ Chính là file người review dùng để chứng minh lỗ **VẪN MỞ** sau lượt vá đầu: mẫu
    //       `/\bPha\s+\d+\b/` **mù với `Pha 2B`** nên xoá file này đi mà cổng vẫn XANH. Nay ĐỎ.
    //   +1 đường cổng mới (`aiAgentOrchestrator.authCtx.test.ts`) cũng tự vào tập bị canh.
    // ⚠ Pha 6 Task 1b: 69 → 70. **Đúng MỘT** file mới —
    //   `server/routers/deployStepUpFreshness.test.ts` — và nó vào tập bị canh **chỉ nhờ bộ nhận
    //   diện thứ ba**: tên không bắt đầu bằng `vram`, không nằm dưới thư mục `vram`, không chứa
    //   chuỗi `Pha 5`. Nếu ai đó gỡ đường của nó khỏi §Cổng kiểm chung thì `CONG.length` ĐỎ **và**
    //   con số này ĐỎ — hai trục, cùng một lượt gỡ.
    // ⚠ Pha 6 Task 5: 70 → 71. **Đúng MỘT** file mới —
    //   `server/services/vram/sharedLedgerIdentityCut.test.ts` (lưới I-2 đầu THỨ BA: sổ chung thôi
    //   cắt `owner` âm thầm). Nó vào tập bị canh qua bộ nhận diện **VỊ TRÍ** (nằm dưới thư mục
    //   `vram`) và đã được đường `server/services/vram/` của §Cổng kiểm chung phủ ⇒ `CONG.length`
    //   giữ nguyên **14**, chỉ con số này đổi.
    // ⚠ Pha 6 Task 6: 71 → 73. **Đúng HAI** file mới — `server/routers/totpReplay.test.ts` và
    //   `server/routers/totpReplayScan.test.ts` (chống phát lại mã OTP). Cả hai vào tập bị canh qua
    //   bộ nhận diện **NỘI DUNG** (tự khai `Pha 5`, có chủ ý — xem docstring của chúng), và cả hai
    //   phải có đường riêng ở §Cổng kiểm chung ⇒ `CONG.length` 14 → **16** cùng lượt.
    // ⚠ Pha 7 §4.1: 73 → 74. **Đúng MỘT** file mới —
    //   `client/src/lib/i18nQuantifierGate.unit.test.ts` (lưới canh **CHÍNH BỘ CƯỠNG CHẾ mặt
    //   NGƯỜI**: nó THỰC THI `scripts/i18n-check.mjs` trên bộ đầu vào dựng sẵn). Đo được trước khi
    //   có nó: hoàn nguyên PASS B + xoá `vramBroker.preempt` khỏi cả ba locale ⇒ `i18n:check`
    //   **exit 0** và cổng này **1902/1902 XANH** — lưới giả ở tầng CÔNG CỤ.
    //   Nó vào tập bị canh qua bộ nhận diện **THỨ BA** (`DAU_KHAI_PHA` ∧ `duocPhu`): tên không bắt
    //   đầu bằng `vram`, không nằm dưới thư mục `vram`. Vì `client/src/lib/` **đã** là một đường
    //   của §Cổng kiểm chung nên `CONG.length` giữ nguyên **16**; chỉ con số này đổi.
    //   ⚠ Đuôi `.unit.test.ts` là bắt buộc: `vitest.config.ts` gom client bằng `*.unit.test.ts`,
    //     nên đặt tên `.test.ts` thì vitest **lặng lẽ bỏ qua** trong khi cổng vẫn khai XANH.
    // ⚠ Pha 7 Task 2: 74 → 75. **Đúng MỘT** file mới —
    //   `server/services/vram/vramReadModel.readers.test.ts` (luật *"MỌI ô của mặt đọc VRAM phải có
    //   NGƯỜI ĐỌC THẬT — hoặc bị XOÁ"*, đảo lượng từ thay cho lối vá theo TỪNG Ô của Pha 6).
    //   Nó vào tập bị canh qua bộ nhận diện **VỊ TRÍ** (dưới thư mục `vram`) **và** **TÊN**
    //   (`vram*`), và đường `server/services/vram/` của §Cổng kiểm chung đã phủ nó ⇒ `CONG.length`
    //   giữ nguyên **16**; chỉ con số này đổi.
    //   ⚠ File **không phải test** đi kèm (`vramStateFieldPaths.ts` — bộ suy "ô TỪ KIỂU", nay có
    //     MỘT chỗ ở cho cả hai lưới) **không** vào con số này: `moiFileTest` chỉ gom `*.test.ts`.
    // ⚠ Pha 7 Task 7: 79 → 81. **Đúng HAI** file mới — `server/_core/publicUser.test.ts` và
    //   `server/routers/userExposureScan.test.ts`. Cả hai vào tập bị canh qua bộ nhận diện **NỘI
    //   DUNG** (tự khai `Pha 5`, có chủ ý — xem docstring của chúng), và cả hai phải có đường riêng
    //   ở §Cổng kiểm chung ⇒ `CONG.length` 19 → **21** cùng lượt. Gỡ một trong hai khỏi cổng ⇒
    //   **hai** ô đỏ trên **hai** trục, không phải một.
    // ⚠ Pha 7 Task 8a: 81 → 82. **Đúng MỘT** file mới — `server/_core/backupCodeWriteScan.test.ts`.
    //   Nó vào tập bị canh qua bộ nhận diện **NỘI DUNG** (tự khai `Pha 5`, có chủ ý), và phải có
    //   đường riêng ở §Cổng kiểm chung ⇒ `CONG.length` 21 → **22** cùng lượt.
    // ⚠ Pha 7 Task 8b: 82 → 83. **Đúng MỘT** file mới —
    //   `client/src/lib/localStorageUserScan.unit.test.ts` (luật *"KHÔNG khoá kho-trên-đĩa nào mang
    //   ĐỐI TƯỢNG người dùng"*, suy từ `auth.me` chứ không từ tên khoá). Vì `client/src/lib/`
    //   **đã** là một đường của §Cổng kiểm chung nên `CONG.length` giữ nguyên **22**.
    //   ⚠ Đuôi `.unit.test.ts` là bắt buộc — `vitest.config.ts` gom client bằng `*.unit.test.ts`.
    // ⚠ Pha 7 Task 9: 83 → 86. **Đúng BA** file mới (xem khối lý do ở ô `CONG.length`). Cả ba vào
    //   tập bị canh qua bộ nhận diện **NỘI DUNG** (tự khai `Pha 5`, có chủ ý — xem docstring của
    //   chúng), và cả ba phải có đường riêng ở §Cổng kiểm chung ⇒ `CONG.length` 22 → **25** cùng
    //   lượt. Gỡ một trong ba khỏi cổng ⇒ **hai** ô đỏ trên **hai** trục, không phải một.
    // ⚠ Pha 7 Task 3: 86 → 87. **Đúng MỘT** file mới —
    //   `server/services/vram/vramEventColumnLimits.test.ts` (neo `VARCHAR_LIMITS` của `vram_events`
    //   vào drizzle bằng lượng từ HAI CHIỀU, đúng phép neo Task 5 Pha 6 đã dựng cho `vram_leases`).
    //   Nó vào tập bị canh qua bộ nhận diện **VỊ TRÍ** (dưới thư mục `vram`) **và** **TÊN**
    //   (`vram*`), và đường `server/services/vram/` của §Cổng kiểm chung đã phủ nó ⇒ `CONG.length`
    //   giữ nguyên **25**; chỉ con số này đổi.
    //   ⚠ File **không phải test** đi kèm (`drizzleCotDoc.ts` — bộ suy "bóc cột khỏi đối tượng
    //     drizzle", nay dùng chung với `sharedLedgerIdentityCut.test.ts` để không có bộ suy thứ hai)
    //     **không** vào con số này: `moiFileTest` chỉ gom `*.test.ts`.
    // ⚠ Pha 7 Task 4a: 87 → 97. **Đúng MƯỜI** file — không file nào là mã mới; cả mười là lưới
    //   **CŨ** mà trước lượt này *"theo cấu tạo không bao giờ được canh"* (xem khối lý do ở ô
    //   `CONG.length`). Chúng vào tập bị canh qua bộ nhận diện **THỨ BA** (`DAU_KHAI_PHA` ∧
    //   `duocPhu`) — tức **chỉ vì** mười đường vừa được thêm vào §Cổng kiểm chung. Gỡ một đường ra
    //   ⇒ **hai** ô đỏ trên **hai** trục (`CONG.length` và con số này), cộng ca ∀ mới bên dưới.
    // ⚠ Pha 7 / review TOÀN NHÁNH **C-1**: 97 → 98. **Đúng MỘT** file mới —
    //   `server/routers/totpSeedWriteScan.test.ts`. Nó vào tập bị canh qua bộ nhận diện **NỘI DUNG**
    //   (tự khai `Pha 5`, có chủ ý — xem docstring của nó), và phải có đường riêng ở §Cổng kiểm
    //   chung ⇒ `CONG.length` 35 → **36** cùng lượt. Gỡ nó khỏi cổng ⇒ **hai** ô đỏ trên **hai** trục.
    // ⚠ Pha 7 / review TOÀN NHÁNH **I-4**: 98 → 99. **Đúng MỘT** file mới —
    //   `server/_core/buocDoiMatKhau.test.ts`. Nó vào tập bị canh qua bộ nhận diện **NỘI DUNG**
    //   (tự khai `Pha 5`, có chủ ý — xem docstring của nó), và phải có đường riêng ở §Cổng kiểm
    //   chung ⇒ `CONG.length` 36 → **37** cùng lượt. Gỡ nó khỏi cổng ⇒ **hai** ô đỏ trên **hai** trục.
    // ⚠ Pha 7 / I-4 (nửa CLIENT): 99 → 100. **Đúng MỘT** file mới —
    //   `client/src/lib/congDoiMatKhau.unit.test.ts` (vị từ khoá điều hướng + ca ghim **miễn trừ
    //   CỐ Ý** phía client + lưới CẤU TRÚC *"cổng bọc CHÍNH `<Router/>`"*). Nó vào tập bị canh qua
    //   bộ nhận diện **NỘI DUNG** (tự khai `Pha 5`, có chủ ý). Vì `client/src/lib/` **đã** là một
    //   đường của §Cổng kiểm chung nên `CONG.length` giữ nguyên **37**; chỉ con số này đổi.
    //   ⚠ Đuôi `.unit.test.ts` là bắt buộc — `vitest.config.ts` gom client bằng `*.unit.test.ts`.
    // ⚠ Pha 7 / vá **NHÀ TÙ I-4**: 100 → 101. **Đúng MỘT** file mới —
    //   `server/_core/xacThucNoiBo.test.ts`. Nó vào tập bị canh qua bộ nhận diện **NỘI DUNG** (tự
    //   khai `Pha 5`, có chủ ý — xem docstring của nó), và phải có đường riêng ở §Cổng kiểm chung
    //   ⇒ `CONG.length` 37 → **38** cùng lượt. Gỡ nó khỏi cổng ⇒ **hai** ô đỏ trên **hai** trục.
    // ⚠ Pha 7 / mig `0316`: 101 → **102**. **Đúng MỘT** file mới
    //   (`server/_core/xacThucNoiBoDb.test.ts`, xem lý do ở ô `CONG.length`). Nó tự khai `Pha 5`
    //   nên vào tập bị canh qua bộ nhận diện **THỨ NHẤT** (nội dung), và nó phải có đường riêng ở
    //   §Cổng kiểm chung ⇒ `CONG.length` 38 → **39** cùng lượt. Gỡ nó khỏi cổng ⇒ **hai** ô đỏ
    //   trên **hai** trục.
    // ⚠ Pha 8 Task 3: 102 → **103**. Đúng MỘT lưới mới (xem khối lý do ở ô `CONG.length`).
    // ⚠ Pha 8 Task 1: 103 → **104**. Đúng MỘT lưới mới (xem khối lý do ở ô `CONG.length`).
    // ⚠ Pha 8 Task 2: 104 → **105**. Đúng MỘT lưới mới (xem khối lý do ở ô `CONG.length`).
    // ⚠ Pha 8 Task 4a: 105 → **106**. Đúng MỘT lưới mới (xem khối lý do ở ô `CONG.length`).
    // ⚠ Pha 8 Task 5: 106 → **107**. Đúng MỘT lưới mới (xem khối lý do ở ô `CONG.length`).
    // ⚠ Pha 8 / siết 2FA: 107 → **108**. Đúng MỘT lưới mới (xem khối lý do ở ô `CONG.length`). Nó
    //   tự khai `Pha 5` nên bộ nhận diện theo NỘI DUNG thấy, và nó phải có đường riêng ở §Cổng
    //   kiểm chung ⇒ `CONG.length` 44 → **45** cùng lượt. Gỡ nó khỏi cổng ⇒ **hai** ô đỏ trên
    //   **hai** trục.
    expect(FILE_CANH.length, `danh sách lưới bị canh đã đổi:\n${FILE_CANH.join("\n")}`).toBe(108); // Pha 8 siết 2FA: +1
  });

  it("★★★ Pha 6 Task 3 — bộ nhận diện THỨ BA bắt thêm thật, và KHÔNG BAO GIỜ đẩy file ra ngoài cổng", () => {
    /**
     * ⚠ Hai khẳng định, hai chiều:
     *  • **CÓ TÁC DỤNG**: nó phải tóm ít nhất một file mà hai bộ kia mù (nếu không, nó là trang trí
     *    và ô "lưới Pha 6 ngoài module VRAM" vẫn không ai canh — đúng lỗ vừa đóng);
     *  • **KHÔNG TÁC HẠI**: theo cấu tạo nó giao với `duocPhu`, nên tập này **luôn** nằm trong cổng.
     *    Ca dưới đo lại điều đó thay vì tin vào cách viết.
     */
    const themMoi = FILE_PHA_TRONG_CONG.filter((f) => !FILE_PHA5.includes(f) && !FILE_VRAM.includes(f));
    expect(
      themMoi.length,
      "bộ nhận diện thứ ba không bắt thêm file nào ⇒ lưới Pha 6 ngoài module VRAM vẫn KHÔNG AI CANH",
    ).toBeGreaterThanOrEqual(1);
    const ngoai = FILE_PHA_TRONG_CONG.filter((f) => !duocPhu(f, CONG));
    expect(ngoai.join(" · "), "bộ thứ ba KHÔNG được đẩy file nằm ngoài cổng vào tập bị canh").toBe("");
  });

  it("★★★ Pha 7 Task 4a — MỌI lưới TỰ KHAI một pha phải nằm TRONG cổng (đảo lượng từ, phần tử thứ N+1 ⇒ ĐỎ)", () => {
    /**
     * ⚠⚠⚠ Đây là ca **CHỦ** của (E), và nó là thứ ba bộ nhận diện cũ **không thể** làm:
     *  • bộ NỘI DUNG chỉ thấy chuỗi `"Pha 5"` — mù với `Pha 7` / `Pha 2B` / `Pha 1.5`;
     *  • bộ VỊ TRÍ/TÊN chỉ thấy lưới module VRAM;
     *  • bộ THỨ BA **giao với `duocPhu`** ⇒ **không bao giờ đỏ được** cho một file ngoài cổng.
     * ⇒ Câu ở đây phát biểu **cái nó PHẢI LÀ**: *một lưới tự khai thuộc một pha là một lưới của
     *   công trình này, nên nó PHẢI được cổng chạy.* Suy ra từ một lượt **quét đĩa**, không từ một
     *   danh sách — nên phần tử thứ N+1 tự vào lượng từ.
     *
     * ⚠ Cầu chì trước: 0 file tự khai ⇒ khẳng định dưới là **chân lý rỗng** (đúng lớp "glob rỗng").
     */
    expect(FILE_TU_KHAI_PHA.length, "bộ quét TỰ-KHAI không thấy file nào — mẫu đã hỏng?").toBeGreaterThanOrEqual(80);
    const ngoai = FILE_TU_KHAI_PHA.filter((f) => !duocPhu(f, CONG));
    expect(
      ngoai.join("\n"),
      "lưới TỰ KHAI thuộc một pha mà nằm NGOÀI §Cổng kiểm chung ⇒ theo CẤU TẠO nó không bao giờ " +
        "được canh: một đột biến trong đúng file ấy ship được với cổng xanh 100%.\n" +
        "⇒ Thêm đường của nó vào §Cổng kiểm chung (kế hoạch Pha 5), rồi cập nhật `CONG`/`FILE_CANH`.",
    ).toBe("");
  });

  it("★★ KHÔNG BẮT NHẦM — tập TỰ-KHAI phải RỘNG HƠN tập trong-cổng-cũ, và không nuốt file không khai gì", () => {
    // ⚠ Nếu hai tập BẰNG nhau thì ca trên là một phép lặp của bộ thứ ba, không thêm sức mạnh nào.
    expect(FILE_TU_KHAI_PHA.length).toBeGreaterThanOrEqual(FILE_PHA_TRONG_CONG.length);
    // ⚠ …và nó KHÔNG được tóm mọi file: một lưới không nhắc pha nào phải nằm ngoài lượng từ.
    const khongKhai = MOI_FILE.filter((f) => !DAU_KHAI_PHA.test(readFileSync(f.that, "utf8")));
    expect(khongKhai.length, "MỌI file test đều tự khai một pha? ⇒ mẫu đang bắt bừa").toBeGreaterThan(100);
  });

  it("★★★ I-4 — mẫu tự-khai phải nhận `Pha 2B` / `Pha 1.5` / VIẾT HOA (mẫu `\\d+\\b` cũ MÙ ở đây)", () => {
    /**
     * ⚠⚠⚠ Đây là ca **neo vào cơ chế**, không vào một cái tên file: mẫu cũ `/\bPha\s+\d+\b/` đòi
     * ranh giới từ **ngay sau chữ số**, nên `Pha 2B` (53 lượt trong repo) và `Pha 1.5` (23 lượt)
     * **lọt sạch**. Hậu quả đo được: xoá `client/src/lib/errorCodes.vram.unit.test.ts` (121 ca)
     * ⇒ cổng vẫn XANH. Ca này ĐỎ ngay lượt ai đó thu mẫu về dạng cũ.
     */
    for (const s of ["Pha 2B", "Pha 2A", "Pha 1.5", "PHA 5", "pha 3", "Pha 4.", "★ Pha 6 Task 3"]) {
      expect(DAU_KHAI_PHA.test(s), `mẫu phải nhận ${JSON.stringify(s)}`).toBe(true);
    }
    // KHÔNG BẮT NHẦM: `\b` mở đầu phải chặn một từ chỉ *chứa* "pha".
    for (const s of ["alpha 2", "sapha 1", "Phase 2", "Pha X"]) {
      expect(DAU_KHAI_PHA.test(s), `mẫu KHÔNG được nhận ${JSON.stringify(s)}`).toBe(false);
    }
    // …và file đích danh mà người review dùng làm bằng chứng phải nằm trong tập bị canh.
    const bc = "client/src/lib/errorCodes.vram.unit.test.ts";
    expect(existsSync(join(GOC, bc)), `${bc} phải tồn tại`).toBe(true);
    expect(FILE_CANH, `${bc} phải bị canh — xoá nó đi thì cổng PHẢI đỏ`).toContain(bc);
  });

  it("★★★ Pha 7 / I-1 — MỌI lưới bị canh phải được **VITEST THẬT SỰ GOM** (xoá thì đỏ, ĐỔI TÊN cũng phải đỏ)", () => {
    expect(existsSync(VITEST_CONFIG), `không thấy ${duong(VITEST_CONFIG)}`).toBe(true);
    // Cầu chì: rút được mẫu, và mẫu không rỗng — mẫu rỗng ⇒ khẳng định dưới là chân lý rỗng.
    expect(MAU_VITEST.length, "không rút được `include` khỏi vitest.config.ts — nó đã đổi hình dạng?").toBeGreaterThanOrEqual(3);
    const re = MAU_VITEST.map(globSangRegex);
    const khongGom = FILE_CANH.filter((f) => !re.some((r) => r.test(f)));
    expect(
      khongGom.join("\n"),
      "lưới bị canh mà VITEST KHÔNG GOM ⇒ file có thật, đường có thật, mà runner không bao giờ nạp:\n" +
        `mẫu include hiện tại: ${MAU_VITEST.join(" · ")}`,
    ).toBe("");
  });

  it("★★ KHÔNG BẮT NHẦM — `globSangRegex` dịch đúng `**/` và `*`, không nhận bừa", () => {
    const r = globSangRegex("client/src/**/*.unit.test.ts");
    expect(r.test("client/src/lib/i18nQuantifierGate.unit.test.ts")).toBe(true);
    expect(r.test("client/src/a/b/c/x.unit.test.ts")).toBe(true);
    // ⚠ ĐÚNG cái đột biến đổi-tên phải bị bắt:
    expect(r.test("client/src/lib/i18nQuantifierGate.test.ts")).toBe(false);
    // ⚠ `*` KHÔNG được vượt qua dấu `/`.
    expect(globSangRegex("server/*.test.ts").test("server/a/b.test.ts")).toBe(false);
    expect(globSangRegex("server/**/*.test.ts").test("server/a/b.test.ts")).toBe(true);
    // ⚠ Không nhận tiền tố/hậu tố thừa.
    expect(r.test("other/client/src/lib/x.unit.test.ts")).toBe(false);
    expect(r.test("client/src/lib/x.unit.test.ts.bak")).toBe(false);
  });

  it("★★★ KHÔNG file nào bị canh mà nằm NGOÀI cổng — ô mà I-1 đã lọt, và ô mà R3 đã lọt", () => {
    const ngoai = FILE_CANH.filter((f) => !duocPhu(f, CONG));
    expect(
      ngoai.join("\n"),
      "lưới bị canh KHÔNG nằm trong cổng ⇒ một đột biến trong đúng file ấy SHIP ĐƯỢC với cổng xanh 100%",
    ).toBe("");
  });

  it("★★★ R3 — một lưới VRAM MỚI **không chứa** chuỗi `Pha 5` vẫn bị lượng từ tóm (luật cũ MÙ ở đây)", () => {
    /**
     * ⚠⚠⚠ Đột biến R3 nguyên văn: file test mới, **không** chứa `Pha 5`, có ca cố tình đỏ ⇒ cổng
     * khai XANH 103/103. Ca này chứng minh luật MỚI thấy nó, và luật CŨ thì không.
     */
    const moi = ["server/routers/vramR3Moi.test.ts", "server/services/vram/r3Moi.test.ts", "client/src/lib/vramR3Moi.test.ts"];
    for (const f of moi) {
      expect(laLuoiVram(f), `${f} phải bị luật VỊ TRÍ/TÊN nhận là lưới VRAM`).toBe(true);
    }
    // Đối chứng: hai file này CHƯA tồn tại trên đĩa ⇒ chúng không nằm trong `FILE_CANH` hôm nay,
    // nhưng ngay khi ai đó tạo ra chúng, chúng vào lượng từ **mà không cần chứa chữ nào**.
    expect(moi.every((f) => !existsSync(join(GOC, f))), "ca này giả định ba đường ấy chưa tồn tại").toBe(true);
    // ⚠ `server/routers/vramR3Moi.test.ts` KHÔNG được cổng phủ ⇒ nếu nó ra đời, cổng ĐỎ cho tới khi
    //   có người thêm đường. Đó chính là hành vi mà (E) đòi.
    expect(duocPhu("server/routers/vramR3Moi.test.ts", CONG), "một lưới router VRAM mới phải BUỘC cập nhật cổng").toBe(false);
  });

  it("★★★ ba file đích danh phải nằm trong cổng (đối chứng cho `duocPhu`)", () => {
    // ⚠ Không phải một danh sách trắng mới — đây là **đối chứng** cho ca trên: nếu vị từ `duocPhu`
    //   hỏng theo chiều "phủ hết", ca trên vẫn xanh còn ca này vẫn bắt được.
    for (const f of [
      "server/routers/vramPermissionSplit.test.ts",
      "server/routers/vramStepUpFreshness.test.ts",
      "server/services/aiCopilotActions.hardlinkSink.test.ts",
    ]) {
      expect(existsSync(join(GOC, f)), `${f} phải tồn tại`).toBe(true);
      expect(FILE_CANH, `${f} phải nằm trong tập bị canh`).toContain(f);
      expect(duocPhu(f, CONG), `${f} phải được §Cổng kiểm chung phủ`).toBe(true);
    }
  });

  it("★★ KHÔNG BẮT NHẦM — `laLuoiVram` không tóm file ngoài module VRAM", () => {
    expect(laLuoiVram("server/routers/permissions.machineControl.test.ts")).toBe(false);
    expect(laLuoiVram("server/services/aiCopilotActions.hardlinkSink.test.ts")).toBe(false);
    // ⚠ Một thư mục tên `vramOther` KHÔNG phải thư mục `vram`.
    expect(laLuoiVram("server/services/vramOther/x.test.ts")).toBe(false);
    // ⚠ …nhưng một FILE tên `vram*` ở bất kỳ đâu thì có.
    expect(laLuoiVram("server/services/aiLocalTools/vramTools.test.ts")).toBe(true);
  });

  it("★★ KHÔNG BẮT NHẦM — `duocPhu` chỉ nhận khớp-đúng hoặc thư-mục-cha, không nhận tiền tố cụt", () => {
    const cong = ["server/services/vram/", "server/routers/vramRouter.test.ts"];
    expect(duocPhu("server/services/vram/x.test.ts", cong)).toBe(true);
    expect(duocPhu("server/routers/vramRouter.test.ts", cong)).toBe(true);
    // ⚠ `server/services/vramOther/…` KHÔNG được coi là nằm trong `server/services/vram/`.
    expect(duocPhu("server/services/vramOther/x.test.ts", cong)).toBe(false);
    // Một tiền tố cụt của một đường FILE cũng không được nhận.
    expect(duocPhu("server/routers/vramRouter.test.ts.bak", cong)).toBe(false);
    expect(duocPhu("server/routers/other.test.ts", cong)).toBe(false);
  });
});
