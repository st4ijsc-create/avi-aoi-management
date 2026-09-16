/**
 * ════════════════════════════════════════════════════════════════════════════
 * `boCucPanelTrai.unit.test.ts` — ★★★ ĐỢT 59 (mục C): TRẦN CHIỀU CAO CHO DẢI CẢNH BÁO
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Mục 13 (Đợt 57) đổi phần dư của panel trái từ 1:1 sang **7:5** để nhóm "Tồn đọng >24h" đạt
 * **3 hàng đủ @1280×720**. QA lần 10 đo được cái giá: @1600×900 `danh-sach-may` **267 → 249 px
 * = 9 → 8 hàng đủ**. Mục C trả lại hàng thứ 9 **chỉ ở 1600**, không đụng 1280.
 *
 * Tệp này KHÔNG đo pixel (e2e/`.qa-dot59/C-do.mjs` làm việc ấy). Nó giữ hai thứ mà một phép đo
 * pixel không giữ được:
 *   ① **chỗ nối** — trần thật sự nằm trên thẻ `flex-[7]` của dải cảnh báo (G5: có số học mà
 *      không có class = không giao hàng);
 *   ② **số học** — mô hình bố cục thuần, để nếu ai đó đổi trần/tỉ lệ thì ca nào vỡ nói rõ
 *      viewport nào vỡ. Trong đó có ca **1600×720** — ca chứng minh vì sao KHÔNG được dùng
 *      breakpoint `2xl:` (theo BỀ NGANG) cho một ràng buộc CHIỀU CAO.
 *
 * Hằng số lấy từ ĐO THẬT trên hai cỡ (`.qa-dot59/C-truoc/kq.json`), giống nhau ở cả hai nên
 * chúng là hằng của BỐ CỤC, không phải của viewport.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GOC = resolve(__dirname, "../../../..");
const VAN_HANH = readFileSync(resolve(GOC, "src/pages/TwinVanHanh.tsx"), "utf8");

/** Thẻ mở của phần tử mang `data-testid="<id>"`. */
function theMo(ma: string, testId: string): string {
  const i = ma.indexOf(`data-testid="${testId}"`);
  expect(i, `không thấy data-testid="${testId}"`).toBeGreaterThan(-1);
  return ma.slice(ma.lastIndexOf("<", i), ma.indexOf(">", i) + 1);
}

/* ── Hằng bố cục, ĐO THẬT (px) ───────────────────────────────────────────────── */
/*
 * ✅ 2026-09-16 — ĐÃ ĐO LẠI TRÊN BẢN DỰNG THẬT (GPU, 1 worker). Đọc mục "hai bề rộng" bên dưới.
 *
 * Mọi hằng dưới đây là số **viết tay** chép lại từ một lượt đo trình duyệt cũ. Tệp này
 * KHÔNG đo DOM (jsdom không có bộ dựng bố cục — `getBoundingClientRect` trả 0), nên khi
 * giao diện thật đổi chiều cao thì các ca ở đây **vẫn xanh trong khi mô hình đã sai**.
 * Đó chính là lớp lỗi "thiết bị đo không biết kêu", và nó vừa xảy ra:
 *
 *   2026-09-15, Task 12 thêm bảng xếp hạng sức khoẻ vào `khoi-tong-quan`. Ước tính của
 *   agent thực thi: khối ấy cao thêm ~28 px (2 dòng chữ 10 px, không viền, không lề,
 *   tiêu đề chỉ còn ở nhãn trợ năng) ⇒ `KHOI_TONG_QUAN` thật khoảng **69**, không phải 41.
 *   Hệ quả mô hình: @1280×720 nhóm tồn đọng 3 → 2 hàng; @1600×900 `danh-sach-may` 9 → 8
 *   hàng (nhóm tồn đọng giữ 5 vì đã chạm trần 328 px).
 *
 * ⛔ KHÔNG sửa số 41 thành 69 ở đây. 69 là **ước lượng chưa đo**, và ghi một số chưa đo
 *    vào chỗ ghi "ĐO THẬT" là cách nhanh nhất để người sau tin nhầm nó.
 * ✅ Việc đúng: đo lại bằng ảnh trên bản dựng thật ở đợt nghiệm thu (Task 15 của kế hoạch
 *    `docs/superpowers/plans/2026-09-15-hoan-thien-twin-sau-qa11.md`) — mở `/twin` ở
 *    1280×720 và 1600×900, đọc `getBoundingClientRect().height` của `khoi-tong-quan`,
 *    rồi cập nhật hằng kèm ngày đo. Chỉ khi đó mới quyết được có cần cân lại tỉ lệ 7:5
 *    và trần 328 px (hai quyết định của Đợt 57/59) hay không.
 */
const CAO_NGOAI_PANEL = 231; // vp.height − panel.height — đo lại 2026-09-16: VẪN ĐÚNG
/*
 * ★★★ `khoi-tong-quan` KHÔNG phải một hằng — nó phụ thuộc bề rộng.
 *   Đo `getBoundingClientRect().height` trên bản dựng thật 2026-09-16:
 *     1280×720 ⇒ **85 px**   (hàng số xuống HAI dòng khi hẹp)
 *     1600×900 ⇒ **68 px**
 *   Ước lượng 69 của lượt trước đúng ở 1600 và sai ở 1280 — đó là lý do một mô hình
 *   MỘT-HẰNG không mô tả nổi khối này. Bảng sức khoẻ (Task 12) chiếm 25 px ở CẢ HAI.
 *
 * ⚠ Mô hình còn THIẾU một hằng: dòng tiền tố mã máy (Task 7) cao **17 px** và chưa ai
 *   khai nó ở đây. Đó là vì sao @1600 thực tế hiện **7** hàng `danh-sach-may` chứ không
 *   phải 8 như mô hình đoán. Thêm hằng đó là việc của lượt sau, cùng lúc với việc quyết
 *   có cân lại tỉ lệ 7:5 và trần 328 px hay không.
 */
const KHOI_TONG_QUAN_1280 = 85; // đo 2026-09-16
const KHOI_TONG_QUAN_1600 = 68; // đo 2026-09-16
/*
 * ⚠ MÔ HÌNH LỊCH SỬ vẫn dùng **41** — cố ý, và đây là lý do:
 *   Các ca ở §② và §③ dưới đây sinh ra để đo *quyết định của Đợt 57/59* (tỉ lệ 7:5 và trần
 *   328 px) trên bố cục **lúc ấy**. Thay 41 bằng số đo hôm nay biến chúng thành một câu hỏi
 *   khác, và chúng sẽ đỏ vì **tiêu chí cũ không còn đạt** — chứ không phải vì ai đó làm hỏng
 *   thứ chúng canh. Sửa kỳ vọng của chúng cho khớp số mới chính là "sửa cho xanh".
 *   Nên: giữ mô hình lịch sử nguyên vẹn, và phơi hệ quả của bố cục MỚI ở §④ bên dưới bằng
 *   chính hai số đã đo. Quyết định cân lại tỉ lệ/trần thuộc chủ dự án, không thuộc tệp này.
 */
const KHOI_TONG_QUAN = 41; // mô hình LỊCH SỬ (Đợt 57/59) — đừng đổi; xem §④ cho số hôm nay
const DAI_CHUYEN_CHE_DO = 30; // "Máy | Cây phân cấp"
const KHUNG_DAI_CANH_BAO = 91; // tiêu đề "Cảnh báo (N)" + hàng chip lọc (349−258 = 244−153)
const TIEU_DE_NHOM = 24; //     "TỒN ĐỌNG >24H (7)" dính đầu ô cuộn
const HANG_TON_DONG = 41;
const KHUNG_DANH_SACH = 44; //  tab Máy|Cây + ô lọc
const HANG_MAY = 24;
const TRAN_DAI_PX = 328; //     mục C
const DONG_TIEN_TO = 17; //     dòng "Prefix: …" của Task 7 — đo 2026-09-16

/* ════════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 64 — ĐO LẠI TOÀN BỘ BẰNG TRÌNH DUYỆT THẬT, VÀ BA HẰNG NỮA ĐÃ LỆCH
 * ════════════════════════════════════════════════════════════════════════════════
 * Nguồn: `.qa-tapdoan/khung-dem/truoc.json` — Playwright, bản dựng
 * `index-DrD4Djtg.js` trên cổng 3064, tài khoản `e2e_tai_loE`, nhà máy SIM-FAC
 * (42 máy · 7 andon đang mở, **cả 7 đều >24 h** nên nhóm tồn đọng là ca DƯƠNG
 * thật, không phải tập rỗng — G146). Mỗi số là `getBoundingClientRect().height`.
 *
 * Lượt đo trước (cùng ngày) chỉ đọc `khoi-tong-quan` rồi dừng, nên nó khai
 * `CAO_NGOAI_PANEL`/`TRAN_DAI_PX`/`HANG_MAY` "vẫn đúng" mà **không đo ba hằng
 * còn lại**. Đo đủ thì ra:
 *
 *   ✔ ĐÚNG NGUYÊN: CAO_NGOAI_PANEL 231 · TIEU_DE_NHOM 24 · KHUNG_DANH_SACH 44
 *                  · HANG_MAY 24 · KHOI_TONG_QUAN_1280 85 · KHOI_TONG_QUAN_1600 68
 *   ✘ LỆCH:        KHUNG_DAI_CANH_BAO 91 → **111 @1280 / 84,5 @1600**
 *                  HANG_TON_DONG      41 → **54,66** (ở CẢ HAI bề rộng)
 *                  DAI_CHUYEN_CHE_DO  30 → 29,5 (lệch nhỏ, giữ 30 cho mô hình cũ)
 *   ⚠ CÓ ĐIỀU KIỆN: DONG_TIEN_TO — đo được **VẮNG MẶT (0 px)** trên SIM-FAC.
 *
 * ★★★ VÀ ĐÂY LÀ PHÁT HIỆN QUAN TRỌNG NHẤT CỦA ĐỢT: brief giao việc nói thủ phạm
 *   là "hai thứ mới" (khối tổng quan + dòng tiền tố). Đo đủ thì **hai thứ ấy
 *   giải thích chưa được một nửa**, và thứ nặng thứ hai chưa ai khai:
 *
 *     khối tổng quan   41 → 85  =  +44 px   (bảng sức khoẻ Task 12 + hàng số 2 dòng)
 *     hàng tồn đọng    41 → 54,66 = +13,66 px **MỖI HÀNG** ⇒ ×3 hàng = +41 px
 *     khung dải        91 → 111 =  +20 px   (dòng `dai-pham-vi`, chốt 2026-09-15)
 *     dòng tiền tố             =    0 px   (không rút được tiền tố ⇒ không render)
 *                                ─────────
 *     tổng thiệt hại cho tiêu chí 3 hàng @1280        **105 px**
 *
 *   61 px trong đó đến từ HAI BẢN VÁ CỦA QA lần 11 — dòng phụ danh tính (PH-30)
 *   và dòng nhãn phạm vi — cả hai đều đúng, đều được chủ dự án chốt, và **cả hai
 *   đều chưa từng vào mô hình này**. Đó là lý do mô hình khai "tồn đọng 2 hàng"
 *   trong khi màn thật chỉ có **1**.
 */
const KHUNG_DAI_1280 = 111; //  đo 2026-09-16 — hàng chip XUỐNG HAI DÒNG ở `w-56`
const KHUNG_DAI_1600 = 84.5; // đo 2026-09-16 — hàng chip một dòng ở `w-72`
const HANG_TON_DONG_NAY = 54.66; // đo 2026-09-16 — 41 + dòng phụ danh tính (PH-30)
/*
 * ⚠ 29,5 chứ không 30 — nửa pixel, và nó KHÔNG vô hại: mô hình dùng 30 cho ra
 *   `dai = 218,17` trong khi trình duyệt đo **218,45**. Sai số 0,28 px ấy tự nó
 *   không lật hàng nào, nhưng nó là dấu hiệu mô hình và thực tế đang trôi khỏi
 *   nhau — và một mô hình lệch 0,28 px thì không dùng để phán "đủ hay không đủ
 *   một hàng 54,66 px" được nữa. §④ vì thế dùng trị ĐO, §②/§③ giữ 30 (lịch sử).
 */
const DAI_CHUYEN_CHE_DO_NAY = 29.5; // đo 2026-09-16

/** Mô hình: từ chiều cao viewport ⇒ số hàng ĐỦ của hai ô. `tran = null` = bản trước mục C. */
function duDoan(vpH: number, tran: number | null) {
  const duPanel = vpH - CAO_NGOAI_PANEL - KHOI_TONG_QUAN - DAI_CHUYEN_CHE_DO;
  const daiMuon = (duPanel * 7) / 12;
  const dai = tran === null ? daiMuon : Math.min(daiMuon, tran);
  const danhSach = duPanel - dai;
  return {
    duPanel,
    dai: Math.round(dai),
    danhSach: Math.round(danhSach),
    hangTonDong: Math.max(0, Math.floor((dai - KHUNG_DAI_CANH_BAO - TIEU_DE_NHOM) / HANG_TON_DONG)),
    hangMay: Math.max(0, Math.floor((danhSach - KHUNG_DANH_SACH) / HANG_MAY)),
  };
}

describe("★★★ ① Chỗ nối — trần nằm ĐÚNG trên thẻ `flex-[7]` của dải cảnh báo", () => {
  it("thẻ bọc `DaiCanhBao` mang `max-h-[328px]` CÙNG `flex-[7] basis-0 min-h-0`", () => {
    const the = VAN_HANH.slice(VAN_HANH.indexOf('className="flex max-h-[328px]'));
    expect(the.slice(0, 90)).toContain("flex max-h-[328px] min-h-0 flex-[7] basis-0 flex-col overflow-hidden");
  });
  it("`basis-0` GIỮ NGUYÊN ở cả hai anh em (bài học Đợt 22: bỏ nó ⇒ `danh-sach-may` về h=0)", () => {
    expect(VAN_HANH).toContain("flex max-h-[328px] min-h-0 flex-[7] basis-0");
    expect(VAN_HANH).toContain("min-h-0 flex-[5] basis-0");
  });
  it("KHÔNG dùng breakpoint bề ngang cho ràng buộc chiều cao (`2xl:flex-`/`2xl:max-h-` vắng mặt)", () => {
    expect(VAN_HANH).not.toMatch(/2xl:flex-\[/);
    expect(VAN_HANH).not.toMatch(/2xl:max-h-/);
  });
  it("panel trái vẫn `w-56 2xl:w-72` và tay nắm vẫn đọc CÙNG hai trị ấy (mục C không đụng bề ngang)", () => {
    expect(theMo(VAN_HANH, "panel-trai")).toContain("w-56 2xl:w-72");
    expect(theMo(VAN_HANH, "nut-thu-trai")).toContain("left-56 2xl:left-72");
  });
});

describe("★★★ ② Số học — mục C mua được hàng thứ 9 @1600 mà 1280 không mất gì", () => {
  it("@1600×900: 8 → 9 hàng máy, tồn đọng vẫn 5 hàng (tiêu chí cần ≥3)", () => {
    const truoc = duDoan(900, null);
    const sau = duDoan(900, TRAN_DAI_PX);
    expect(truoc.hangMay).toBe(8);
    expect(sau.hangMay).toBeGreaterThanOrEqual(9);
    expect(sau.hangTonDong).toBeGreaterThanOrEqual(3);
    expect(sau.hangTonDong).toBe(truoc.hangTonDong); // không mất hàng cảnh báo nào
  });
  it("@1280×720: trần KHÔNG chạm ⇒ 0 px đổi (3 hàng tồn đọng + 5 hàng máy y nguyên)", () => {
    const truoc = duDoan(720, null);
    const sau = duDoan(720, TRAN_DAI_PX);
    expect(sau).toEqual(truoc);
    expect(sau.hangTonDong).toBeGreaterThanOrEqual(3);
    expect(sau.hangMay).toBeGreaterThanOrEqual(5);
  });
  it("trần chỉ bắt đầu chạm khi viewport cao > 864 px — dưới ngưỡng đó mục C là NO-OP", () => {
    expect(duDoan(864, TRAN_DAI_PX)).toEqual(duDoan(864, null));
    expect(duDoan(880, TRAN_DAI_PX).danhSach).toBeGreaterThan(duDoan(880, null).danhSach);
  });
});

describe("★★★ ③ ĐỐI CHỨNG — vì sao `2xl:` (bề ngang) là câu trả lời SAI", () => {
  /** Nếu ai đó đổi tỉ lệ theo breakpoint bề ngang, đây là cửa sổ làm vỡ tiêu chí ≥3 hàng. */
  function duDoanTiLe(vpH: number, tu: number, mau: number) {
    const duPanel = vpH - CAO_NGOAI_PANEL - KHOI_TONG_QUAN - DAI_CHUYEN_CHE_DO;
    const dai = (duPanel * tu) / mau;
    return Math.max(0, Math.floor((dai - KHUNG_DAI_CANH_BAO - TIEU_DE_NHOM) / HANG_TON_DONG));
  }
  it("1600×720 khớp `2xl` nhưng chỉ cao 720: tỉ lệ 7:13 cho 2 hàng tồn đọng ⇒ PHÁ tiêu chí ≥3", () => {
    expect(duDoanTiLe(720, 7, 13)).toBeLessThan(3);
  });
  it("cùng cửa sổ ấy, TRẦN chiều cao giữ nguyên 3 hàng (trần không chạm ở panel thấp)", () => {
    expect(duDoan(720, TRAN_DAI_PX).hangTonDong).toBeGreaterThanOrEqual(3);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════
 * ★★★ ④ BỐ CỤC HÔM NAY — số ĐO THẬT 2026-09-16, và hệ quả cho tiêu chí Đợt 57/59
 * ════════════════════════════════════════════════════════════════════════════════
 * §② ở trên đo mô hình LỊCH SỬ. Khối này đo bố cục **thật sau khi thêm bảng sức khoẻ
 * (Task 12) và dòng tiền tố mã máy (Task 7)**, dùng đúng hai con số đọc được từ
 * `getBoundingClientRect()` trên bản dựng `index-r3rg0upv.js`.
 *
 * Nó KHÔNG phán quyết đúng/sai — nó **ghim sự thật** để lần sửa bố cục kế tiếp không
 * âm thầm làm xấu thêm, và để chủ dự án có số mà quyết.
 */
describe("★★★ ④ Bố cục HÔM NAY (đo thật 2026-09-16) — ghim sự thật, không phán quyết", () => {
  /**
   * Mô hình bố cục HÔM NAY: nhận chiều cao khối tổng quan VÀ khung dải theo đúng
   * bề rộng, và dùng chiều cao hàng tồn đọng THẬT (54,66) chứ không phải 41.
   *
   * ⚠ `tienTo` là tham số CÓ ĐIỀU KIỆN, không phải hằng: `DanhSachMay.tsx:330`
   *   chỉ render dòng tiền tố khi rút được tiền tố chung. Trên SIM-FAC (mã
   *   `ESP32-…`/`GLUE-…`/`SIM-L1-…`) không rút được ⇒ 0 px; trên bộ QATD (mọi mã
   *   `QATD-A-T1-X1-L1-M…`) rút được ⇒ 17 px. Ca nào cũng phải nói rõ mình dùng trị nào.
   */
  function duDoanThat(vpH: number, khoiTongQuan: number, khungDai: number, tienTo: number, tran = TRAN_DAI_PX) {
    const duPanel = vpH - CAO_NGOAI_PANEL - khoiTongQuan - DAI_CHUYEN_CHE_DO_NAY;
    const dai = Math.min((duPanel * 7) / 12, tran);
    const danhSach = duPanel - dai;
    return {
      duPanel,
      dai: Math.round(dai * 100) / 100,
      hangTonDong: Math.max(0, Math.floor((dai - khungDai - TIEU_DE_NHOM) / HANG_TON_DONG_NAY)),
      hangMay: Math.max(0, Math.floor((danhSach - KHUNG_DANH_SACH - tienTo) / HANG_MAY)),
    };
  }

  it("khối tổng quan KHÔNG phải một hằng: 85 px @1280 vs 68 px @1600 (hàng số xuống hai dòng khi hẹp)", () => {
    expect(KHOI_TONG_QUAN_1280).toBeGreaterThan(KHOI_TONG_QUAN_1600);
    expect(KHOI_TONG_QUAN_1280 - KHOI_TONG_QUAN_1600).toBe(17);
  });

  it("★★★ khung dải cũng KHÔNG phải hằng: 111 @1280 vs 84,5 @1600 — hàng chip WRAP ở `w-56`", () => {
    // Cùng lớp lỗi với khối tổng quan, và cùng nguyên nhân: một khối `flex-wrap`
    // ở cột 224 px xuống hai dòng, ở cột 288 px thì không. Mô hình MỘT-HẰNG
    // (`KHUNG_DAI_CANH_BAO = 91`) không mô tả nổi cả hai, và 91 thì SAI ở cả hai.
    expect(KHUNG_DAI_1280).toBeGreaterThan(KHUNG_DAI_1600);
    expect(KHUNG_DAI_1280 - KHUNG_DAI_1600).toBeCloseTo(26.5, 2);
    // Hằng cũ 91 nằm GIỮA hai trị thật ⇒ nó sai ở CẢ HAI bề rộng, chỉ sai ít hơn
    // ở một bên. Đó là hình dạng điển hình của một hằng "trung bình hoá" hai ca.
    expect(KHUNG_DAI_CANH_BAO).toBeGreaterThan(KHUNG_DAI_1600);
    expect(KHUNG_DAI_CANH_BAO).toBeLessThan(KHUNG_DAI_1280);
  });

  it("★★★ hàng tồn đọng cao 54,66 px chứ không 41 — dòng phụ danh tính PH-30 cộng 13,66 px MỖI HÀNG", () => {
    expect(HANG_TON_DONG_NAY).toBeGreaterThan(HANG_TON_DONG);
    expect(HANG_TON_DONG_NAY - HANG_TON_DONG).toBeCloseTo(13.66, 2);
    // Ba hàng tồn đọng đắt thêm ~41 px — gần bằng NGUYÊN khối tổng quan của mô
    // hình lịch sử (41). Một dòng phụ 13,66 px ăn đúng bằng một khối 5 chỉ số.
    expect(3 * (HANG_TON_DONG_NAY - HANG_TON_DONG)).toBeCloseTo(KHOI_TONG_QUAN, 0);
  });

  it("@1280×720 mô hình cho 1 hàng tồn đọng + 4 hàng máy — KHỚP ĐÚNG số đo trình duyệt", () => {
    const nay = duDoanThat(720, KHOI_TONG_QUAN_1280, KHUNG_DAI_1280, 0);
    // `.qa-tapdoan/khung-dem/truoc.json` @1280×720: dai 218,45 · hangTonDongDu 1 · hangMayDu 4
    expect(nay.dai).toBeCloseTo(218.45, 1); // mô hình khớp trình duyệt tới 0,01 px
    expect(nay.hangTonDong).toBe(1);
    expect(nay.hangMay).toBe(4);
    expect(nay.hangTonDong).toBeLessThan(3); // tiêu chí Đợt 57 — KHÔNG đạt
  });

  it("@1600×900 mô hình cho 4 hàng tồn đọng + 8 hàng máy — KHỚP ĐÚNG số đo trình duyệt", () => {
    const nay = duDoanThat(900, KHOI_TONG_QUAN_1600, KHUNG_DAI_1600, 0);
    // `.qa-tapdoan/khung-dem/truoc.json` @1600×900: dai 328 (chạm trần) · 4 · 8
    expect(nay.dai).toBe(TRAN_DAI_PX);
    expect(nay.hangTonDong).toBe(4);
    expect(nay.hangMay).toBe(8);
    expect(nay.hangTonDong).toBeGreaterThanOrEqual(3); // tiêu chí Đợt 57 — ĐẠT
  });

  /* ════════════════════════════════════════════════════════════════════════════
   * ★★★ PHÁN QUYẾT ĐỢT 64 — VÌ SAO **KHÔNG** CÂN LẠI TỈ LỆ, VÀ BẰNG CHỨNG SỐ HỌC
   * ════════════════════════════════════════════════════════════════════════════
   * Việc được giao là chia lại chỗ sao cho @cả hai bề rộng: tồn đọng ≥3 hàng VÀ
   * danh sách máy KHÔNG tụt dưới số hàng đang đạt (4 @1280 · 8 @1600).
   * Đo xong thì @1280×720 **hai ràng buộc ấy loại trừ nhau**, và không tỉ lệ nào
   * cứu được — đó là một mệnh đề SỐ HỌC, không phải một lựa chọn thiết kế.
   */
  describe("★★★ ④b Phán quyết — @1280×720 tiêu chí ≥3 hàng tồn đọng là BẤT KHẢ", () => {
    const DU_PANEL_1280 = 720 - CAO_NGOAI_PANEL - KHOI_TONG_QUAN_1280 - DAI_CHUYEN_CHE_DO_NAY;

    it("ngân sách 374,5 px < 438,98 px mà hai ràng buộc đòi ⇒ THIẾU 64,5 px", () => {
      expect(DU_PANEL_1280).toBe(374.5);
      const caiDaiCan = KHUNG_DAI_1280 + TIEU_DE_NHOM + 3 * HANG_TON_DONG_NAY; // 3 hàng tồn đọng
      const caiDanhSachCan = KHUNG_DANH_SACH + 4 * HANG_MAY; // giữ 4 hàng máy như hiện tại
      expect(caiDaiCan).toBeCloseTo(298.98, 1);
      expect(caiDanhSachCan).toBe(140);
      expect(caiDaiCan + caiDanhSachCan).toBeGreaterThan(DU_PANEL_1280);
      expect(caiDaiCan + caiDanhSachCan - DU_PANEL_1280).toBeCloseTo(64.48, 1);
    });

    it("QUÉT MỌI TỈ LỆ 1..11 — không tỉ lệ nào cho (tồn đọng ≥3 VÀ máy ≥4)", () => {
      const daQuet: Array<{ tu: number; tonDong: number; may: number }> = [];
      for (let tu = 1; tu <= 11; tu += 1) {
        const dai = (DU_PANEL_1280 * tu) / 12;
        daQuet.push({
          tu,
          tonDong: Math.max(0, Math.floor((dai - KHUNG_DAI_1280 - TIEU_DE_NHOM) / HANG_TON_DONG_NAY)),
          may: Math.max(0, Math.floor((DU_PANEL_1280 - dai - KHUNG_DANH_SACH) / HANG_MAY)),
        });
      }
      expect(daQuet).toHaveLength(11); // quét THẬT, không phải tập rỗng
      expect(daQuet.filter((x) => x.tonDong >= 3 && x.may >= 4)).toHaveLength(0);
      // ★★★ ĐỐI CHỨNG BIẾT KÊU — chạy ĐÚNG mô hình LỊCH SỬ (khối 41 · khung 91 ·
      //   hàng 41 · dải chuyển 30) thì bài toán CÓ nghiệm, và nghiệm ấy chính là
      //   7:5 đang dùng. Tức tỉ lệ chưa bao giờ sai; cái đổi là BỐN HẰNG dưới nó.
      const duCu = 720 - CAO_NGOAI_PANEL - KHOI_TONG_QUAN - DAI_CHUYEN_CHE_DO;
      expect(duCu).toBe(418);
      const cu = [] as number[];
      for (let tu = 1; tu <= 11; tu += 1) {
        const dai = (duCu * tu) / 12;
        const td = Math.max(0, Math.floor((dai - KHUNG_DAI_CANH_BAO - TIEU_DE_NHOM) / HANG_TON_DONG));
        const may = Math.max(0, Math.floor((duCu - dai - KHUNG_DANH_SACH) / HANG_MAY));
        if (td >= 3 && may >= 4) cu.push(tu);
      }
      expect(cu).toEqual([7]); // ⇒ bài toán vỡ vì BỐN HẰNG, không vì tỉ lệ
    });

    it("7:5 ĐÃ LÀ phần chia lớn nhất cho dải mà danh sách máy còn giữ được 4 hàng", () => {
      const tai = (tu: number) => {
        const dai = (DU_PANEL_1280 * tu) / 12;
        return {
          tonDong: Math.max(0, Math.floor((dai - KHUNG_DAI_1280 - TIEU_DE_NHOM) / HANG_TON_DONG_NAY)),
          may: Math.max(0, Math.floor((DU_PANEL_1280 - dai - KHUNG_DANH_SACH) / HANG_MAY)),
        };
      };
      expect(tai(7)).toEqual({ tonDong: 1, may: 4 }); // hiện tại
      expect(tai(8).may).toBe(3); // nhích lên một nấc ⇒ danh sách máy TỤT, vi phạm ràng buộc
      expect(tai(8).tonDong).toBe(2); // và vẫn CHƯA đạt ≥3
    });

    it("@1600×900 CẢ HAI ràng buộc đã đạt sẵn ⇒ không có gì để cân lại", () => {
      const nay = duDoanThat(900, KHOI_TONG_QUAN_1600, KHUNG_DAI_1600, 0);
      expect(nay.hangTonDong).toBeGreaterThanOrEqual(3);
      expect(nay.hangMay).toBeGreaterThanOrEqual(8);
    });

    /*
     * ★ LỰA CHỌN ĐÃ CÂN NHẮC RỒI BỎ — ghi lại kèm SỐ để chủ dự án quyết, chứ
     *   không im lặng: hạ trần 328 → 305 mua được hàng máy thứ 9 @1600×900
     *   (tiêu chí cũ của Đợt 59) bằng cách TRẢ một hàng tồn đọng (4 → 3).
     *   Tôi KHÔNG làm, vì docblock Đợt 57 đã cân đúng cái đổi chác này theo
     *   chiều ngược lại: *"danh sách máy là danh sách 42 máy CÓ Ô LỌC, luôn phải
     *   cuộn ở mọi chiều cao"* còn nhóm tồn đọng là **tập hữu hạn phải phơi ra**
     *   (ISA-18.2). Đổi một hàng cảnh báo quá hạn lấy một hàng của danh sách
     *   luôn-phải-cuộn là đi ngược quyết định ấy.
     */
    it("ĐÃ CÂN NHẮC — trần 305 cho 9 hàng máy @1600 nhưng TRẢ một hàng tồn đọng", () => {
      const v305 = duDoanThat(900, KHOI_TONG_QUAN_1600, KHUNG_DAI_1600, 0, 305);
      expect(v305.hangMay).toBe(9);
      expect(v305.hangTonDong).toBe(3); // vẫn đạt tiêu chí, nhưng mất hàng thứ 4
      // ★ TÔI ĐÃ NGHI TRẦN 305 LÀM HỒI QUY Ở CỬA SỔ 1280 CAO — ĐO THÌ KHÔNG.
      //   1280×1024 giữ nguyên 3 hàng tồn đọng ở cả hai trần (305 > 298,98 = chỗ
      //   ba hàng cần), và còn ĐƯỢC thêm một hàng máy. Ghi lại vì lý lẽ bác bỏ
      //   305 KHÔNG được dựa vào một hồi quy không tồn tại — nó chỉ còn dựa vào
      //   đánh đổi 1 hàng cảnh báo ⇄ 1 hàng máy ở 1600×900, và đó là chỗ docblock
      //   Đợt 57 đã phán.
      expect(duDoanThat(1024, KHOI_TONG_QUAN_1280, KHUNG_DAI_1280, 0).hangTonDong).toBe(3);
      expect(duDoanThat(1024, KHOI_TONG_QUAN_1280, KHUNG_DAI_1280, 0, 305).hangTonDong).toBe(3);
      expect(duDoanThat(1024, KHOI_TONG_QUAN_1280, KHUNG_DAI_1280, 0, 305).hangMay).toBe(13);
    });

    it("★ cửa sổ khả thi của TRẦN chỉ rộng 12,5 px — cái nút này gần cạn", () => {
      // Cận trên: máy ≥9 @1600×900. Cận dưới: tồn đọng ≥3 ở cửa sổ 1280 CAO.
      const canTren = 900 - CAO_NGOAI_PANEL - KHOI_TONG_QUAN_1600 - DAI_CHUYEN_CHE_DO_NAY - KHUNG_DANH_SACH - 9 * HANG_MAY;
      const canDuoi = KHUNG_DAI_1280 + TIEU_DE_NHOM + 3 * HANG_TON_DONG_NAY;
      expect(canTren).toBe(311.5);
      expect(canDuoi).toBeCloseTo(298.98, 1);
      expect(canTren - canDuoi).toBeLessThan(13);
      expect(canTren - canDuoi).toBeGreaterThan(0); // vẫn còn nghiệm — nhưng vừa đủ
    });
  });

  it("★★★ ĐỐI CHỨNG TÁCH THỦ PHẠM — gỡ khối tổng quan thôi thì VẪN KHÔNG đạt", () => {
    // Brief giao việc quy tội cho "hai thứ mới" (khối tổng quan + dòng tiền tố).
    // Ca này tách từng thủ phạm ra bằng cách gỡ đúng một thứ mỗi lần.
    const duCu1280 = (720 - CAO_NGOAI_PANEL - KHOI_TONG_QUAN - DAI_CHUYEN_CHE_DO) * (7 / 12);
    const hang = (dai: number, khung: number, caoHang: number) =>
      Math.max(0, Math.floor((dai - khung - TIEU_DE_NHOM) / caoHang));

    // (1) mô hình LỊCH SỬ nguyên vẹn ⇒ ĐẠT — đây là nền so sánh.
    expect(hang(duCu1280, KHUNG_DAI_CANH_BAO, HANG_TON_DONG)).toBeGreaterThanOrEqual(3);
    // (2) gỡ khối tổng quan về 41 NHƯNG giữ hàng thật 54,66 ⇒ **VẪN KHÔNG ĐẠT**.
    expect(hang(duCu1280, KHUNG_DAI_CANH_BAO, HANG_TON_DONG_NAY)).toBeLessThan(3);
    // (3) giữ khối tổng quan thật 85 NHƯNG hàng cũ 41 ⇒ cũng KHÔNG đạt.
    const duNay1280 = (720 - CAO_NGOAI_PANEL - KHOI_TONG_QUAN_1280 - DAI_CHUYEN_CHE_DO_NAY) * (7 / 12);
    expect(hang(duNay1280, KHUNG_DAI_1280, HANG_TON_DONG)).toBeLessThan(3);
    // ⇒ KHÔNG có MỘT thủ phạm nào đủ để giải thích; phải gỡ CẢ HAI mới đạt lại.
    //   Nên "cân lại tỉ lệ" không thể là lời giải — tỉ lệ không phải thủ phạm nào.
  });
});
