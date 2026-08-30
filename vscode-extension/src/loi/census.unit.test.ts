/**
 * ★★★ CENSUS — ĐỢT A LÀ CHỈ-ĐỌC (KHÔNG GHI ĐĨA); ĐỢT B MỞ ĐÚNG MỘT CỬA DUYỆT (`confirmAction`).
 * ĐÂY LÀ THỨ GIỮ CẢ HAI LỜI KHAI ĐÓ CÓ RĂNG.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO FILE NÀY TỒN TẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cho tới nay "cổng" giữ Đợt A chỉ-đọc là một lệnh `grep` chạy TAY, một lần, bởi người review —
 * không lặp lại được, không chặn được ai quên chạy nó. File này thay lệnh tay đó bằng một lưới
 * TỰ ĐỘNG: quét MỌI tệp `.ts` dưới `vscode-extension/src/` và khẳng định:
 *   (1) KHÔNG đâu chứa các API ghi đĩa/áp dụng chỉnh sửa mà spec liệt kê ở §4.1/§6.4 (`fs.writeFile`,
 *       `writeFileSync`, `appendFile`, `applyEdit`, `WorkspaceEdit`) — Đợt B/C CHƯA tới lượt các
 *       API này, vẫn phải bằng 0.
 *   (2) ĐÚNG MỘT nơi gọi `aiCopilot.confirmAction` — cửa duyệt của chế độ SERVER, mở ra ở Đợt B
 *       tại `mang/duyetGhi.ts`. Đây LÀ đường ghi hợp lệ DUY NHẤT (byte do MÁY CHỦ ghi, không phải
 *       extension), nên khẳng định không còn là "= 0" mà là "đúng MỘT nơi, đúng tệp".
 *
 * ⚠⚠ TỰ LOẠI TRỪ CHÍNH NÓ: mảng `CAM_TU` bên dưới TẤT YẾU chứa nguyên văn các chuỗi nó tìm kiếm
 *    — quét luôn cả tệp này sẽ dương tính giả VĨNH VIỄN (khớp vào chính mảng khai báo). `moiTepTs`
 *    loại `__filename` khỏi danh sách quét, KHÔNG loại theo tên file (đổi tên vẫn đúng).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ NÓI VỚI ĐỢT SAU (C): KHI THÊM ĐIỂM GHI ĐĨA, SỬA LƯỚI NÀY — ĐỪNG XOÁ NÓ.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Spec (§7, hai bất biến) đòi ĐÚNG MỘT nơi gọi `applyEdit` (chế độ LOCAL, đường ghi cục bộ) — không
 * phải ZERO mãi mãi. Khi Đợt C thêm điểm ghi đĩa đầu tiên (`applyEdit`/`WorkspaceEdit`/
 * `writeFileSync`/...):
 *   1. Đổi khẳng định của TỪ KHOÁ đó từ "mảng rỗng" sang "đúng MỘT lần, tại `<đường dẫn>` cụ thể"
 *      (theo đúng khuôn ca `confirmAction` bên dưới — `toEqual([...])`, KHÔNG `≤1`).
 *   2. GIỮ NGUYÊN khẳng định "= 0" cho các từ khoá còn CHƯA tới lượt, và GIỮ NGUYÊN ca "đúng MỘT
 *      nơi" của `confirmAction` (Đợt B đã chốt, Đợt C không đụng vào).
 * Lưới đi ĐỎ ở đây khi đợt sau thêm điểm ghi là ĐÚNG Ý ĐỒ — nó buộc người viết code đọc lại đúng
 * MỘT nơi mình vừa thêm, không phải lỗi cần né bằng cách xoá `it()`.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const GOC = join(__dirname, "..");

/**
 * ★★★ 2026-08-29 — TỆP NGOÀI `src/` MÀ VẪN VÀO BUNDLE.
 *
 * ⚠⚠ Census chỉ có nghĩa nếu TẬP QUÉT = TẬP CHẠY. Đợt B cho `bangChat.ts` nhập
 * `shared/aiCodingLoop.ts` (vị từ `daBiTuChoiGhi` dùng chung, cố ý KHÔNG nhân bản) ⇒ esbuild GỘP
 * tệp ấy vào `dist/extension.js`, nhưng nó nằm NGOÀI `src/` nên census cũ KHÔNG nhìn thấy. Một
 * đường ghi đĩa nấp trong một tệp `shared/` sẽ lọt qua toàn bộ hàng rào này mà không ai biết.
 * Review toàn nhánh Đợt B nêu đúng chỗ đó và đặt việc siết làm ĐIỀU KIỆN trước Đợt C — đợt mở
 * đường ghi đĩa ĐẦU TIÊN.
 *
 * ⚠ Danh sách này phải bám theo `import` THẬT: thêm một import ngoài-cây mới mà quên thêm vào đây
 *   là tự chọc mù chính mình. Ca "tập quét phủ hết tệp ngoài-cây đang được import" bên dưới canh
 *   đúng điều đó — nó đọc `src/` tìm import vượt lên `../..` và so với danh sách này.
 */
const TEP_NGOAI_CAY_VAO_BUNDLE = [join(GOC, "..", "..", "shared", "aiCodingLoop.ts")];

/** Mọi `.ts` dưới `src/`, loại CHÍNH TỆP CENSUS này (xem lý do ở docblock trên). */
function moiTepTs(dir: string): string[] {
  const ra: string[] = [];
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) {
      ra.push(...moiTepTs(p));
      continue;
    }
    if (ten.endsWith(".ts") && p !== __filename) ra.push(p);
  }
  return ra;
}

/** Tập THẬT SỰ được gộp vào bundle: `src/` + các tệp ngoài cây đang được import. */
function moiTepVaoBundle(): string[] {
  return [...moiTepTs(GOC), ...TEP_NGOAI_CAY_VAO_BUNDLE];
}

/** Tệp LƯỚI (vitest) — không phải mã chạy trong extension. Xem `TEP_LUOI_KHONG_VAO_DIST`. */
function laTepLuoi(p: string): boolean {
  return p.endsWith(".unit.test.ts");
}

/**
 * VĨNH VIỄN CẤM: mọi API đặt byte lên đĩa (hoặc lên bộ đệm editor) **ngoài** điểm ghi duy nhất.
 *
 * ⚠⚠ Đây KHÔNG phải "chưa tới lượt" như hai từ `applyEdit`/`WorkspaceEdit` (đã chuyển sang khẳng
 * định "đúng MỘT lần" bên dưới khi Đợt C mở điểm ghi). Danh sách này phải bằng 0 **mãi mãi**:
 * extension ghi qua `WorkspaceEdit` của VSCode nên người dùng **Ctrl+Z hoàn tác được** và editor
 * thấy thay đổi ngay. Ai ghi bằng `fs` là mở một đường ghi THỨ HAI — không hoàn tác được, editor
 * không biết, và nằm ngoài mọi phép đếm ở dưới. Census phải bắt đúng lúc đó.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-29 (I-2) — "MỘT ĐIỂM GHI" CHỈ MẠNH BẰNG DANH SÁCH TỪ NÀY. NỚI DANH SÁCH, MẤT LUÔN
 * LỜI KHAI.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ba từ cũ (`fs.writeFile`, `writeFileSync`, `appendFile`) bỏ lọt những đường ghi TẦM THƯỜNG nhất:
 *   · `import { writeFile } from "node:fs/promises"` rồi `await writeFile(p, s)` — KHÔNG chứa chuỗi
 *     `"fs.writeFile"` ở bất kỳ đâu (dạng destructure là dạng phổ biến NHẤT trong repo này);
 *   · `createWriteStream`, `rename`, `truncate`, `cp` — bốn cách khác đặt/đổi byte của một tệp;
 *   · **`TextEditor.edit()`** — ghi vào BỘ ĐỆM mà không cần đối tượng chỉnh-sửa nào, nên nó lọt
 *     khỏi cả phép đếm "đúng một lần" bên dưới. Đây là đường ghi thứ hai nguy hiểm nhất vì nó
 *     trông y hệt đường hợp lệ.
 * Mỗi từ dưới đây đã được ĐO là 0 lần trên toàn tập vào bundle tại lúc thêm — không từ nào được
 * thêm "cho chắc" mà chưa đo.
 *
 * ⚠ `"cp("` và `".edit("` là chuỗi NGẮN: một ngày nào đó một định danh kết thúc bằng `cp` hay một
 *   phương thức tên `edit` sẽ làm lưới đỏ dù vô hại. Khi ấy cách xử ĐÚNG là **đổi tên định danh**,
 *   không phải nới census. Một census đủ hẹp để không bao giờ đỏ nhầm cũng là một census đủ hẹp để
 *   không bao giờ bắt được gì.
 * ⚠ Danh sách này áp cho **cả tệp lưới**: một tệp test cũng KHÔNG được ghi đĩa bằng `fs` (bài học
 *   §2.1 của Task 6 — census bắt đúng lưới của người viết trước cả đột biến cố ý).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-30 (F4) — BA LÁNG GIỀNG CÒN THIẾU, HAI TRONG SỐ ĐÓ NGAY CẠNH API `apBanVa` ĐANG DÙNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Danh sách trên tự khai là "mọi API đặt byte lên đĩa", nhưng bỏ sót đúng các láng giềng của
 * `workspace.fs.readFile` mà `apBanVa` đã nhập sẵn — tức chúng ở TRONG TẦM TAY của người sửa tiếp
 * theo, không cần thêm một import nào:
 *   · `workspace.fs.delete(…)` — XOÁ tệp/thư mục, **không hoàn tác được** (khác hẳn `WorkspaceEdit`);
 *   · `workspace.fs.copy(…)`   — GHI ĐÈ đích, cũng không hoàn tác được. `cp(` có trong danh sách cũ,
 *     `copy(` thì không — cùng một thao tác, hai cách viết, chỉ một bị canh.
 *   · `WorkspaceEdit.deleteFile(…)` — nguy hiểm KIỂU KHÁC và là chỗ thủng thật sự: nó XOÁ tệp qua
 *     **chính lời gọi áp-chỉnh-sửa** mà phép đếm "đúng MỘT lần" bên dưới đang coi là hợp lệ, nên
 *     thêm một dòng `.deleteFile(` cạnh dòng `.replace(` hiện có sẽ KHÔNG làm số đếm ấy nhúc nhích.
 * Bốn từ khác đã cân nhắc và **KHÔNG** thêm, nói thẳng lý do: `mkdir`/`rmSync` đang được
 * `duongThat.unit.test.ts` dùng hợp lệ để dựng cây thư mục cho ca symlink (và tạo thư mục không
 * phải "đặt byte"); `.createFile(` xuất hiện 1 lần trong **ghi chú** của `ui/apBanVa.ts` (census
 * soi VĂN BẢN, không phân biệt mã với bình luận) nên thêm nó là dựng một lưới đỏ vì một câu chữ;
 * `.renameFile(` đã bị `rename` phủ.
 * ⚠ Mỗi từ thêm ở đây ĐÃ ĐƯỢC ĐO = 0 trên toàn tập vào bundle NGAY TRƯỚC khi thêm.
 */
const CAM_TU = [
  "fs.writeFile",
  "writeFileSync",
  "appendFile",
  // I-2 — dạng destructure (`import { writeFile } from "node:fs/promises"`) không chứa "fs.writeFile"
  "writeFile",
  "createWriteStream",
  "rename",
  "truncate",
  "cp(",
  // `editor.edit(...)` ghi thẳng vào bộ đệm, KHÔNG qua đối tượng chỉnh-sửa ⇒ lọt mọi phép đếm dưới.
  ".edit(",
  // F4 — xoá tệp qua VSCode. `delete(` TRẦN thì quá rộng (`context.secrets.delete(...)` là hợp lệ
  // và có thật), nên neo vào `fs.` cho đúng đối tượng hệ tệp.
  "fs.delete(",
  // F4 — chép đè. Đối xứng với `cp(` đã có; `fs.copy(` là tập con của mẫu này.
  "copy(",
  // F4 — XOÁ tệp qua CHÍNH lời gọi áp-chỉnh-sửa mà phép đếm dưới coi là hợp lệ ⇒ không đụng số đếm.
  ".deleteFile(",
];

/**
 * ★★★ ĐỢT C (2026-08-29) — ĐIỂM GHI ĐĨA ĐÃ MỞ, VÀ ĐÂY LÀ THỨ GIỮ NÓ **ĐÚNG MỘT**.
 *
 * Spec §7 đòi hai bất biến, mỗi cái đúng MỘT chỗ: một nơi `applyEdit` (chế độ LOCAL) và một nơi
 * `confirmAction` (chế độ SERVER). Hai từ dưới đây trước Đợt C bị khẳng định "= 0"; nay chúng phải
 * là **ĐÚNG MỘT lần, tại đúng `ui/apBanVa.ts`**.
 *
 * ⚠⚠ `toBe(1)`, KHÔNG `toBeLessThanOrEqual(1)`: **0 nghĩa là đường ghi đã bị gỡ** — số TỤT nguy
 *    hiểm ngang số PHÌNH (bài học `viStringCoverage`, `luoi-do-theo-dong-dem-doi`). Một lưới chỉ
 *    canh trần sẽ khai XANH cho một extension đã mất hẳn khả năng ghi, và cũng khai XANH cho một
 *    bản vá vô tình xoá mất cửa duyệt.
 * ⚠ Đếm SỐ LẦN XUẤT HIỆN chứ không chỉ danh sách tệp: một lời gọi thứ hai thêm vào CHÍNH
 *   `apBanVa.ts` giữ nguyên danh sách tệp (xem ca `confirmAction` bên dưới — cùng lỗ, đã vá).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-29 (I-3) — TỆP LƯỚI ĐƯỢC LOẠI KHỎI **PHÉP ĐẾM NÀY**, VÀ CHỈ PHÉP ĐẾM NÀY.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Trước bản vá này, census quét MỌI `.ts` dưới `src/` kể cả lưới. Hệ quả không ai định trước:
 * **không thể viết một lưới cho `apBanVa`**, vì một lưới muốn kiểm thứ tự thì phải giả lập API
 * chỉnh-sửa của VSCode, mà chỉ cần NHẮC TÊN nó là phép đếm nhảy lên 2 và census đỏ. Tức bất biến
 * quan trọng nhất của cả Đợt C (THỨ TỰ các bước trong điểm ghi) bị chính hàng rào của nó cấm không
 * cho có lưới — nó chỉ còn được canh bởi một script nằm ngoài repo.
 *
 * Loại trừ này AN TOÀN, và đây là lý do ĐO ĐƯỢC chứ không phải lời hứa:
 *   1. Bundle dựng từ MỘT điểm vào (`src/extension.ts`, xem `build.mjs`) và esbuild chỉ gộp thứ
 *      được `import` bắc tới. Không tệp sản xuất nào import một tệp `*.unit.test.ts`, nên không
 *      byte nào của lưới vào `dist/extension.js`.
 *   2. Điều (1) không phải niềm tin: ca "KHÔNG tệp SẢN XUẤT nào nhập một tệp lưới" bên dưới canh
 *      đúng nó. Ai đó import một lưới vào mã sản xuất ⇒ ĐỎ, và loại trừ này lập tức mất hiệu lực
 *      đúng lúc nó bắt đầu nguy hiểm.
 *   3. `CAM_TU` **vẫn quét cả lưới**: một tệp test cũng không được `fs.writeFile`. Loại trừ chỉ áp
 *      cho phép đếm "đúng MỘT lần", nơi con số nói về ĐƯỜNG GHI THẬT của extension.
 */
const GHI_DUNG_MOT_LAN: Array<{ tu: string; tep: string }> = [
  { tu: "applyEdit", tep: "ui/apBanVa.ts" },
  { tu: "WorkspaceEdit", tep: "ui/apBanVa.ts" },
];

describe("census — không đường ghi ĐĨA nào ngoài ĐÚNG MỘT điểm ghi", () => {
  const tep = moiTepVaoBundle();

  it("★★★ lưới quét được tệp thật (không tự làm rỗng danh sách nguồn)", () => {
    expect(tep.length).toBeGreaterThan(5);
  });

  it("★★★ TẬP QUÉT = TẬP VÀO BUNDLE: mọi import vượt ra ngoài `src/` phải nằm trong danh sách", () => {
    /**
     * ★★ Census chỉ có nghĩa nếu nó quét ĐÚNG những gì sẽ chạy. `bangChat.ts` nhập
     * `shared/aiCodingLoop.ts` ⇒ esbuild gộp tệp đó vào bundle, nhưng nó ngoài `src/`. Nếu mai
     * ai đó nhập thêm một tệp ngoài-cây nữa mà quên khai vào `TEP_NGOAI_CAY_VAO_BUNDLE`, census
     * sẽ mù đúng tệp mới ấy — và mù MỘT CÁCH IM LẶNG. Ca này bắt đúng lúc đó.
     */
    /**
     * ⚠⚠ 2026-08-29 (Minor) — MẪU CŨ CHỈ BẮT `from "…"`. Ba dạng nhập khác cũng làm esbuild gộp
     * tệp vào bundle mà mẫu cũ MÙ hoàn toàn:
     *   · `import "../../shared/x"`      — nhập CHỈ ĐỂ CHẠY tác dụng phụ (không có `from`);
     *   · `import("../../shared/x")`     — nhập ĐỘNG, esbuild vẫn gộp (chỉ tách chunk);
     *   · `require("../../shared/x")`    — vẫn hợp lệ ở đích `cjs` mà build.mjs đang dùng.
     * Nhận cả nháy đơn: một lần chạy prettier khác cấu hình là đủ để đổi hết dấu nháy.
     */
    const daKhai = new Set(TEP_NGOAI_CAY_VAO_BUNDLE.map((p) => p.replace(/\\/g, "/").split("/").pop()));
    const thieu: string[] = [];
    for (const p of moiTepTs(GOC)) {
      for (const m of readFileSync(p, "utf8").matchAll(
        /(?:from|import|require)\s*\(?\s*["']((?:\.\.\/){2,}[^"']+)["']/g,
      )) {
        const ten = `${m[1].split("/").pop()}.ts`;
        if (!daKhai.has(ten)) thieu.push(`${relative(GOC, p)} → ${m[1]}`);
      }
    }
    expect(thieu).toEqual([]);
  });

  it("★★★ KHÔNG tệp SẢN XUẤT nào nhập một tệp LƯỚI — điều kiện làm cho loại-trừ-lưới an toàn", () => {
    /**
     * ★★ Phép đếm "đúng MỘT lần" bên dưới loại tệp `*.unit.test.ts` ra khỏi tập đếm, với lý do
     * "lưới không vào `dist`". Ca này biến lý do ấy từ LỜI HỨA thành ĐIỀU ĐƯỢC CANH: chỉ cần một
     * tệp sản xuất `import` một tệp lưới là lưới đi vào bundle, và loại trừ kia lập tức trở thành
     * một lỗ — census phải đỏ ĐÚNG LÚC ĐÓ, không phải khi có người tình cờ đọc lại docblock.
     */
    const cham: string[] = [];
    for (const p of moiTepVaoBundle()) {
      if (laTepLuoi(p)) continue;
      for (const m of readFileSync(p, "utf8").matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)) {
        if (m[1].includes(".unit.test")) cham.push(`${relative(GOC, p)} → ${m[1]}`);
      }
    }
    expect(cham).toEqual([]);
  });

  for (const tu of CAM_TU) {
    it(`★★★ KHÔNG chỗ nào trong TẬP VÀO BUNDLE chứa "${tu}"`, () => {
      const cham: string[] = [];
      for (const p of tep) {
        const noiDung = readFileSync(p, "utf8");
        if (noiDung.includes(tu)) cham.push(relative(GOC, p));
      }
      expect(cham).toEqual([]);
    });
  }

  for (const { tu, tep: tepMongDoi } of GHI_DUNG_MOT_LAN) {
    it(`★★★ ĐÚNG MỘT lần "${tu}" trong TẬP VÀO BUNDLE, tại "${tepMongDoi}" (Đợt C: điểm ghi đĩa LOCAL)`, () => {
      /**
       * ⚠ Census là phép soi VĂN BẢN — nó không phân biệt mã với bình luận. Vì thế `ui/apBanVa.ts`
       * CỐ Ý không nhắc tên hai API này trong docblock/ghi chú (nói "API áp chỉnh sửa của VSCode"),
       * để con số ở đây nói về LỜI GỌI THẬT chứ không về số lần ai đó viết chữ ấy ra.
       * ⚠⚠ `toBe(1)` hai phía: >1 ⇒ có đường ghi thứ hai chưa ai rà; 0 ⇒ đường ghi đã bị gỡ (hoặc
       * bị đổi sang một API khác lọt khỏi mọi phép đếm) — hai hỏng hóc ngược nhau, cùng một lưới.
       */
      const dem = (s: string) => s.split(tu).length - 1;
      const theoTep = tep
        // Loại TỆP LƯỚI — và CHỈ ở phép đếm này. Xem docblock `GHI_DUNG_MOT_LAN` (§I-3): lưới
        // không vào `dist` (có ca riêng canh điều đó), còn `CAM_TU` vẫn quét chúng đầy đủ.
        .filter((p) => !laTepLuoi(p))
        .map((p) => ({ ten: relative(GOC, p).replace(/\\/g, "/"), soLan: dem(readFileSync(p, "utf8")) }))
        .filter((x) => x.soLan > 0);
      const tong = theoTep.reduce((s, x) => s + x.soLan, 0);
      expect(theoTep, `phải là ĐÚNG một lời gọi "${tu}"; thực tế: ${JSON.stringify(theoTep)}`).toEqual([
        { ten: tepMongDoi, soLan: 1 },
      ]);
      expect(tong).toBe(1);
    });
  }

  it("★★★ ĐÚNG MỘT nơi gọi confirmAction trong toàn extension (Đợt B: cửa duyệt SERVER)", () => {
    // Cửa duyệt là bất biến an toàn của cả hệ: mỗi đường gọi mới là một đường ghi mới không ai rà.
    // Con số này phải là ĐÚNG MỘT — KHÔNG phải "≤1", vì 0 nghĩa là cửa duyệt đã bị gỡ mất, và >1
    // nghĩa là có một đường ghi thứ hai chưa ai kiểm.
    const noiGoi = tep.filter((p) => readFileSync(p, "utf8").includes("aiCopilot.confirmAction"));
    expect(noiGoi.map((p) => relative(GOC, p).replace(/\\/g, "/"))).toEqual(["mang/duyetGhi.ts"]);
  });

  it("★★★ ĐÚNG MỘT LỜI GỌI, không chỉ đúng một TỆP — lời gọi thứ hai TRONG CÙNG tệp cũng phải ĐỎ", () => {
    /**
     * ★★ LỖ CỦA CHÍNH LƯỚI TRÊN: nó khẳng định DANH SÁCH TỆP. Một lời gọi `confirmAction` thứ hai
     * thêm vào **chính `mang/duyetGhi.ts`** giữ nguyên danh sách đó ⇒ ca trên vẫn XANH trong khi
     * cửa duyệt đã có hai đường. Đây đúng khuôn "phép đếm thô ≠ kiểm kê" đã trả giá ở doc 78.
     * Nên: đếm SỐ LẦN XUẤT HIỆN trên toàn bộ tập quét, và khẳng định bằng `toBe(1)`.
     * ⚠ `toBe`, không phải `toBeLessThanOrEqual`: số TỤT (cửa duyệt bị gỡ) nguy hiểm ngang số PHÌNH.
     */
    const dem = (s: string) => s.split("aiCopilot.confirmAction").length - 1;
    const theoTep = tep
      .map((p) => ({ ten: relative(GOC, p).replace(/\\/g, "/"), soLan: dem(readFileSync(p, "utf8")) }))
      .filter((x) => x.soLan > 0);
    const tong = theoTep.reduce((s, x) => s + x.soLan, 0);
    expect(theoTep, `phải là ĐÚNG một lời gọi duy nhất; thực tế: ${JSON.stringify(theoTep)}`).toEqual([
      { ten: "mang/duyetGhi.ts", soLan: 1 },
    ]);
    expect(tong).toBe(1);
  });
});

/**
 * ★★★ M2 (review toàn nhánh 2026-08-30) — CENSUS TRÊN NGUỒN KHÔNG ĐỦ: NÓ KHÔNG SOI `dist/`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO NHÓM CA NÀY TỒN TẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Review đo được: `dist/extension.js` (12:49) và `avi-ai-local-0.1.0.vsix` (29/08 03:38) KHÔNG
 * chứa Đợt D.1 (thiếu văn bản dạy giao thức + hàng rào thụt lề fa5dddf1) TẠI THỜI ĐIỂM 396 ca lưới
 * và census trên nguồn đều đã xanh — "lưới xanh" khi đó chỉ chứng minh MÃ NGUỒN đúng, không chứng
 * minh ARTIFACT đã build đúng, và người cài `.vsix`/chạy `F5` dùng đúng cái thứ hai. Nhóm ca dưới
 * đây chạy lại ĐÚNG vòng `CAM_TU` + `GHI_DUNG_MOT_LAN` trên chính `dist/extension.js`, cộng thêm
 * hai câu neo CHỈ có mặt nếu bản vá D.1 (dạy giao thức đọc) đã vào bundle.
 *
 * ⚠ BỎ QUA (không đỏ) nếu `dist/extension.js` chưa tồn tại — `npx vitest run` một mình không được
 *   ép phải build trước. Nhưng MỌI lời khai LIVE (nghiệm thu, đo tỉ lệ tuân thủ...) PHẢI chạy
 *   `npm run ext:build` trước, và khi đã build thì nhóm ca này PHẢI xanh trên đúng bundle đang có
 *   — nếu không, lần sau lại đo trên mã nguồn rồi ship một artifact khác (đúng lỗ M2 vừa vá).
 */
describe("census — TRÊN BUNDLE ĐÃ BUILD (dist/extension.js), M2", () => {
  // ⚠ `GOC` = `vscode-extension/src` (một cấp TRÊN `src/loi`, xem khai báo `GOC` đầu tệp) — `dist/`
  //   nằm ở GỐC GÓI (`vscode-extension/`), tức MỘT CẤP NỮA lên trên `GOC`, không phải bên trong nó.
  const DIST = join(GOC, "..", "dist", "extension.js");
  const coBundle = existsSync(DIST);
  const noiDungBundle = coBundle ? readFileSync(DIST, "utf8") : "";

  it.skipIf(!coBundle)("★★★ KHÔNG chỗ nào trong BUNDLE ĐÃ BUILD chứa API ghi đĩa bị cấm (CAM_TU)", () => {
    const cham = CAM_TU.filter((tu) => noiDungBundle.includes(tu));
    expect(cham, `bundle chứa API bị cấm: ${JSON.stringify(cham)}`).toEqual([]);
  });

  it.skipIf(!coBundle)(
    "★★★ ĐÚNG MỘT lần applyEdit/WorkspaceEdit trong BUNDLE ĐÃ BUILD (GHI_DUNG_MOT_LAN)",
    () => {
      for (const { tu } of GHI_DUNG_MOT_LAN) {
        const soLan = noiDungBundle.split(tu).length - 1;
        expect(soLan, `"${tu}" phải xuất hiện ĐÚNG 1 lần trong bundle; thực tế: ${soLan}`).toBe(1);
      }
    },
  );

  it.skipIf(!coBundle)(
    "★★★ BUNDLE ĐÃ BUILD chứa hàm dạy giao thức ĐỌC của Đợt D.1 — không phải bản trước D.1",
    () => {
      /**
       * ⚠⚠ ĐO ĐƯỢC, ĐÃ SỬA MỘT LẦN: bản đầu của ca này so khớp văn bản tiếng Việt CÓ DẤU
       * ("NGUYÊN TẮC TRẢ LỜI"/"Nhắc lại") lấy trực tiếp từ chuỗi trả về của hai hàm bên dưới — và
       * ĐỎ trên chính bundle vừa build ĐÚNG (build.mjs không đặt `charset: "utf8"`, nên esbuild
       * TỰ ĐỘNG thoát mọi ký tự ngoài ASCII trong CHUỖI thành `\uXXXX`/`\xXX`, khác hẳn dạng chữ
       * có dấu nguyên văn mà một câu `.toContain(...)` chép tay mong đợi — trong khi CHÚ THÍCH thì
       * esbuild KHÔNG đụng, nên grep tay trên `dist/` của chính review (khớp theo COMMENT, không
       * phải chuỗi) từng "đỡ" được điều này mà không ai nhận ra hai đường khác nhau).
       * Vá: so khớp TÊN HÀM (`function dungVanBanDayGiaoThucDoc(`/`function nhacLaiCuoiCauHoi(`) —
       * định danh ASCII, esbuild GIỮ NGUYÊN (không có xung đột tên buộc phải đổi, xác nhận bằng
       * chính đầu ra bundle) — chắc chắn hơn một chuỗi có dấu có thể bị thoát ký tự bất kỳ lúc nào.
       */
      expect(
        noiDungBundle,
        "thiếu function dungVanBanDayGiaoThucDoc — bundle có thể là bản TRƯỚC D.1",
      ).toContain("function dungVanBanDayGiaoThucDoc(");
      expect(
        noiDungBundle,
        "thiếu function nhacLaiCuoiCauHoi — bundle có thể là bản TRƯỚC D.1",
      ).toContain("function nhacLaiCuoiCauHoi(");
    },
  );

  if (!coBundle) {
    it("★ (bỏ qua nhóm ca trên) dist/extension.js chưa tồn tại — chạy `npm run ext:build` trước khi đo LIVE hoặc đóng gói .vsix", () => {
      expect(coBundle).toBe(false);
    });
  }
});
