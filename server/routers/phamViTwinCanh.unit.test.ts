/**
 * phamViTwinCanh.unit.test.ts — ★★★ ĐỢT 11 LÔ K2/K3: **MỌI THỦ TỤC CỦA
 * `twinCanhRouter` PHẢI ĐƯA DANH TÍNH XUỐNG TẦNG DỮ LIỆU.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TỆP NÀY TỒN TẠI — MỘT ĐỘT BIẾN KHÔNG AI BẮT ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════
 * `twinDemVatThePhamVi.db.test.ts` đo **tầng db** (`demVatTheTheoTang`) và bắt
 * được mọi đột biến ở đó. Nhưng khi tiêm đột biến vào **tầng router** —
 *
 *     - await demVatTheTheoTang(input.tangIds, phamViCua(ctx))
 *     + await demVatTheTheoTang(input.tangIds)
 *
 * — **KHÔNG một lưới nào trong repo đỏ**: lưới db import thẳng hàm db nên không
 * thấy router, và `congDocHinhHoc.unit.test.ts` chỉ kiểm `phamViCua(ctx)` cho
 * ĐÚNG BA thủ tục `DOC_MO`. Tức là lỗ K2 có thể được tái tạo nguyên vẹn mà cổng
 * vẫn xanh. Đó chính là hình dạng của lỗ ban đầu, và nó đã sống sót như thế.
 *
 * ⇒ Tệp này đóng đúng khe ấy, và đóng bằng phép **PHÂN ĐÔI TOÀN TẬP** chứ không
 *   bằng một danh sách tên gõ tay: nó liệt kê MỌI thủ tục của router rồi đòi mỗi
 *   thủ tục hoặc mang `phamViCua(ctx)`, hoặc nằm trong danh sách MIỄN TRỪ có
 *   **lý do viết ra**. Thêm một thủ tục mới mà quên phạm vi ⇒ ĐỎ, kể cả thủ tục
 *   chưa tồn tại hôm nay.
 *
 * ⚠ Vì sao KHÔNG chỉ đếm `grep -c "phamViCua(ctx)"`: một con số 23 không nói
 *   thủ tục NÀO thiếu, và nó xanh y hệt khi ai đó thêm một lời gọi thừa ở chỗ
 *   khác rồi bỏ một chỗ cần. Đếm ĐẦU VÀO không phải đếm ĐẦU RA (họ G7).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NGUON = fs.readFileSync(path.join(__dirname, "twinCanhRouter.ts"), "utf8");

/**
 * MIỄN TRỪ — thủ tục KHÔNG cần `phamViCua(ctx)`, mỗi cái kèm lý do ĐO ĐƯỢC.
 *
 * ⚠ Danh sách này là chỗ một miễn trừ sai sẽ nằm lại. Nên nó ngắn, và mỗi dòng
 *   phải nói được "dữ liệu này không thuộc tenant nào" — không phải "chưa kịp
 *   làm". Hiện tại: RỖNG. Mọi thủ tục của router đều chạm dữ liệu tenant.
 *
 * ★ `traKichThuocTheoLoai` (bảng `twin_kich_thuoc_loai`) là bảng tra CHUNG,
 *   không có cột tenant nào (đo trên information_schema 2026-09-07: `loaiMay`,
 *   `rongMm`, `caoMm`, `sauMm`, `laGiaDinh`, `ghiChu`, `updatedAt`) — nhưng nó
 *   là hàm DB, không phải thủ tục router, nên không cần có mặt ở đây.
 */
const MIEN_TRU: readonly string[] = [];

/** Tên mọi thủ tục của router + thân của nó. Phân tích từ NGUỒN. */
function quetThuTuc(): Array<{ ten: string; than: string }> {
  const ra: Array<{ ten: string; than: string }> = [];
  const re = /^ {2}(\w+): (protectedProcedure|adminProcedure)\b/gm;
  const moc: Array<{ ten: string; i: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(NGUON)) !== null) moc.push({ ten: m[1], i: m.index });
  for (let k = 0; k < moc.length; k++) {
    const het = k + 1 < moc.length ? moc[k + 1].i : NGUON.length;
    ra.push({ ten: moc[k].ten, than: NGUON.slice(moc[k].i, het) });
  }
  return ra;
}

const THU_TUC = quetThuTuc();

describe("K2/K3 — thiết bị đo tự canh mình TRƯỚC", () => {
  it("bộ quét tìm được số thủ tục HỢP LÝ, không phải 0", () => {
    // ⚠ G5 — một regex hỏng trả mảng RỖNG và MỌI khẳng định "mọi thủ tục…" bên
    //   dưới sẽ xanh trên tập rỗng mà không đo gì.
    expect(THU_TUC.length).toBeGreaterThanOrEqual(20);
    expect(THU_TUC.map((x) => x.ten)).toContain("demVatThe");
    expect(THU_TUC.map((x) => x.ten)).toContain("luuToaNha");
  });

  it("★★★ bộ quét CẮT THÂN ĐÚNG — thân thủ tục này không nuốt thủ tục kế", () => {
    // Ca dương cho chính thiết bị đo: nếu `than` trải dài tới cuối tệp thì MỌI
    // thủ tục đều "có `phamViCua(ctx)`" nhờ hàng xóm, và phép phân đôi bên dưới
    // xanh vĩnh viễn mà không đo gì (đúng họ G5/G6).
    const dem = THU_TUC.find((x) => x.ten === "demVatThe")!;
    expect(dem.than).toContain("demVatTheTheoTang");
    // Thân của `demVatThe` KHÔNG được chứa tên thủ tục đứng sau nó.
    expect(dem.than).not.toContain("canhThietKe: protectedProcedure");
  });
});

describe("K2/K3 — MỌI thủ tục đưa danh tính xuống tầng dữ liệu", () => {
  it("★★★ PHÂN ĐÔI TOÀN TẬP: thủ tục nào cũng mang `phamViCua(ctx)`", () => {
    // Đây là phát biểu trung tâm. Nó bắt được đúng đột biến mà cả hai lưới cũ
    // để lọt: router quên truyền phạm vi xuống hàm db.
    const thieu = THU_TUC.filter(
      (x) => !MIEN_TRU.includes(x.ten) && !x.than.includes("phamViCua(ctx)"),
    ).map((x) => x.ten);
    expect(thieu).toEqual([]);
  });

  it("★★★ và thủ tục nào cũng BÓC `ctx` ra ở chữ ký — mẫu thứ hai RỜI HẲN (G9)", () => {
    // Phép đo độc lập với ô trên: `phamViCua(ctx)` có thể xuất hiện trong một
    // dòng chú thích. Chữ ký `async ({ input, ctx })` thì không. Hai chỉ báo sai
    // theo hai kiểu khác nhau nên khó cùng sai một lượt (BG-127).
    const khongBoc = THU_TUC.filter((x) => {
      if (MIEN_TRU.includes(x.ten)) return false;
      const k = x.than.match(/\.(query|mutation)\(async \(\{([^}]*)\}/);
      return !k || !/\bctx\b/.test(k[2]);
    }).map((x) => x.ten);
    expect(khongBoc).toEqual([]);
  });

  it("`demVatThe` ĐÍCH DANH — thủ tục của lô K2, ghim riêng chứ không gộp vào số", () => {
    // Ô đích danh: nếu ai đó nới `MIEN_TRU` cho `demVatThe`, hai ô trên lại xanh
    // còn ô này đỏ. Một danh sách miễn trừ không được phép nuốt chính lỗ vừa vá.
    const dem = THU_TUC.find((x) => x.ten === "demVatThe");
    expect(dem).toBeDefined();
    expect(dem!.than).toContain("demVatTheTheoTang(input.tangIds, phamViCua(ctx))");
    expect(MIEN_TRU).not.toContain("demVatThe");
  });

  it("danh sách MIỄN TRỪ không âm thầm phình ra", () => {
    // Cận trên: một miễn trừ là một lỗ được ký tên. Thêm dòng vào đó phải là một
    // quyết định nhìn thấy được trong diff, không phải một bước dọn cho test xanh.
    expect(MIEN_TRU).toEqual([]);
  });
});
