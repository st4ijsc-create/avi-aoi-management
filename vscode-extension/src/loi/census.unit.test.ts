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
import { readdirSync, readFileSync, statSync } from "node:fs";
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

/**
 * VĨNH VIỄN CẤM: ghi đĩa bằng `fs`.
 *
 * ⚠⚠ Đây KHÔNG phải "chưa tới lượt" như hai từ `applyEdit`/`WorkspaceEdit` (đã chuyển sang khẳng
 * định "đúng MỘT lần" bên dưới khi Đợt C mở điểm ghi). Ba từ này phải bằng 0 **mãi mãi**: extension
 * ghi qua `WorkspaceEdit` của VSCode nên người dùng **Ctrl+Z hoàn tác được** và editor thấy thay
 * đổi ngay. Ai ghi bằng `fs` là mở một đường ghi THỨ HAI — không hoàn tác được, editor không biết,
 * và nằm ngoài mọi phép đếm ở dưới. Census phải bắt đúng lúc đó.
 */
const CAM_TU = ["fs.writeFile", "writeFileSync", "appendFile"];

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
    const daKhai = new Set(TEP_NGOAI_CAY_VAO_BUNDLE.map((p) => p.replace(/\\/g, "/").split("/").pop()));
    const thieu: string[] = [];
    for (const p of moiTepTs(GOC)) {
      for (const m of readFileSync(p, "utf8").matchAll(/from\s+"((?:\.\.\/){2,}[^"]+)"/g)) {
        const ten = `${m[1].split("/").pop()}.ts`;
        if (!daKhai.has(ten)) thieu.push(`${relative(GOC, p)} → ${m[1]}`);
      }
    }
    expect(thieu).toEqual([]);
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
