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
 * ⚠ VÌ SAO **KHÔNG** chỉ nới `DAU_KHAI` thành `/Pha \d+/`: đo được — 68 file `*.test.ts` tự khai
 * một pha nào đó, và **4** trong số đó (`appErrorParamsCoverage` · `aiAgentOrchestrator.authCtx` ·
 * `aiGgufEngine` · `kbSyncScheduler.evalGate`) nằm **NGOÀI** mọi đường của §Cổng kiểm chung ⇒ ca
 * *"KHÔNG file nào bị canh mà nằm NGOÀI cổng"* sẽ ĐỎ, và bản vá cho nó là **thêm 4 đường vào cổng
 * dùng chung của cả năm task** — một quyết định vượt tầm một task, kèm rủi ro đỏ có sẵn.
 * ⇒ Bộ thứ ba **giao** điều kiện tự-khai với **chính vị từ `duocPhu`**: nó **không bao giờ** thêm
 * một file nằm ngoài cổng (bất biến ấy đúng **theo cấu tạo**), nên nó chỉ làm **con số ghim** phủ
 * rộng hơn — đúng thứ đang thiếu — mà không đụng tới danh sách đường chạy.
 */
const DAU_KHAI_PHA = /\bPha\s+\d+\b/;

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
/** ⚠ **HỢP**, không phải thay thế: ba vị từ chỉ nới rộng đối tượng bị canh. */
const FILE_CANH = [...new Set([...FILE_PHA5, ...FILE_VRAM, ...FILE_PHA_TRONG_CONG])].sort();

describe("★★★ I-1 + (E) — §Cổng kiểm chung phải PHỦ mọi lưới bị canh (đảo lượng từ, ghim SỐ)", () => {
  it("★★★ cầu chì — đọc được cổng từ file kế hoạch, và nó không rỗng", () => {
    expect(existsSync(KE_HOACH), `không thấy file kế hoạch: ${duong(KE_HOACH)}`).toBe(true);
    // ⚠ Pha 6 Task 1 (M-4): +1 đường — `server/routers/vramStepUpFreshness.test.ts`. Cổng của Pha 6
    //   là **cùng khối lệnh này**, nên một lưới mới ở bất kỳ pha nào cũng phải vào đây, không được
    //   sống ngoài cổng. 11 → 12.
    expect(CONG.length, "không rút được đường nào khỏi §Cổng kiểm chung — khối lệnh đã đổi hình dạng?").toBe(12);
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
    // ⚠ Pha 6 Task 3 (F2): 63 → 67, gồm **BỐN** file và chỉ **HAI** trong số đó là mã mới:
    //   +2 lưới MỚI trong `server/services/aiLocalTools/` (đã nằm trong cổng):
    //     · `programmingTools.agentPath.test.ts` — hai ranh giới an ninh trên đường Agent NL;
    //     · `toolArgCoverage.test.ts` — luật "MỌI tool chọn được theo trigger phải có đường lấy
    //       tham số".
    //   +2 lưới CŨ nay **mới** bị canh nhờ bộ nhận diện thứ ba (`DAU_KHAI_PHA` ∧ `duocPhu`):
    //     · `server/services/aiLocalTools/authCtxInjection.test.ts` (tự khai `Pha 4`);
    //     · `client/src/lib/errorCodes.vramCommands.unit.test.ts` (tên KHÔNG bắt đầu bằng `vram`
    //       nên `laLuoiVram` mù, và nó không chứa chuỗi `Pha 5`).
    //   ⇒ Hai file cuối là **bằng chứng đo được** rằng lỗ "hàng rào không ai canh" có thật và rộng
    //     hơn một file.
    expect(FILE_CANH.length, `danh sách lưới bị canh đã đổi:\n${FILE_CANH.join("\n")}`).toBe(67);
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
