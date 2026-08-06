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

/** Chuỗi mà một file test dùng để **tự khai** nó là lưới của pha này. */
const DAU_KHAI = "Pha 5";

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
const FILE_PHA5 = NHANH.flatMap((n) => moiFileTest(join(GOC, n)))
  .filter((p) => readFileSync(p, "utf8").includes(DAU_KHAI))
  .map(duong)
  .sort();

describe("★★★ I-1 — §Cổng kiểm chung phải PHỦ mọi lưới của Pha 5 (đảo lượng từ, ghim SỐ)", () => {
  it("★★★ cầu chì — đọc được cổng từ file kế hoạch, và nó không rỗng", () => {
    expect(existsSync(KE_HOACH), `không thấy file kế hoạch: ${duong(KE_HOACH)}`).toBe(true);
    expect(CONG.length, "không rút được đường nào khỏi §Cổng kiểm chung — khối lệnh đã đổi hình dạng?").toBe(11);
  });

  it("★★★ MỌI đường của cổng TỒN TẠI trên đĩa (một đường gõ sai là một đường vitest bỏ qua)", () => {
    const thieu = CONG.filter((c) => !existsSync(join(GOC, c)));
    expect(thieu.join(" · "), "đường của cổng không tồn tại ⇒ cổng khai XANH cho một tập rỗng").toBe("");
  });

  it("★★★ cầu chì — quét thấy đủ nhiều lưới tự khai `Pha 5` (0 file ⇒ mọi khẳng định dưới là chân lý rỗng)", () => {
    expect(FILE_PHA5.length, "bộ quét không thấy file nào mang dấu khai `Pha 5` — nó đã hỏng?").toBeGreaterThanOrEqual(10);
    // ⚠ GHIM SỐ: một lưới Pha 5 mới sinh ra, hoặc một lưới cũ bị xoá, đều phải là một **quyết định
    //   nói ra**, không phải một lượt trôi im lặng.
    expect(FILE_PHA5.length, `danh sách lưới Pha 5 đã đổi:\n${FILE_PHA5.join("\n")}`).toBe(16);
  });

  it("★★★ KHÔNG file nào tự khai `Pha 5` mà nằm NGOÀI cổng — đây là ô mà I-1 đã lọt", () => {
    const ngoai = FILE_PHA5.filter((f) => !duocPhu(f, CONG));
    expect(
      ngoai.join("\n"),
      "lưới của Pha 5 KHÔNG nằm trong cổng ⇒ một đột biến trong đúng file ấy SHIP ĐƯỢC với cổng xanh 100%",
    ).toBe("");
  });

  it("★★★ hai file mà lượt rà này tìm ra phải nằm trong cổng (đối chứng ĐÍCH DANH)", () => {
    // ⚠ Không phải một danh sách trắng mới — đây là **đối chứng** cho ca trên: nếu vị từ `duocPhu`
    //   hỏng theo chiều "phủ hết", ca trên vẫn xanh còn ca này vẫn bắt được.
    for (const f of ["server/routers/vramPermissionSplit.test.ts", "server/services/aiCopilotActions.hardlinkSink.test.ts"]) {
      expect(existsSync(join(GOC, f)), `${f} phải tồn tại`).toBe(true);
      expect(FILE_PHA5, `${f} phải tự khai là lưới Pha 5`).toContain(f);
      expect(duocPhu(f, CONG), `${f} phải được §Cổng kiểm chung phủ`).toBe(true);
    }
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
