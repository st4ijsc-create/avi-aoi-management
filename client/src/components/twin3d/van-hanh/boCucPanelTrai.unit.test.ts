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
 * ⚠⚠⚠ MỘT HẰNG Ở ĐÂY ĐÃ LẠC THỰC TẾ — ĐỌC TRƯỚC KHI TIN BẤT KỲ SỐ NÀO DƯỚI ĐÂY.
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
const CAO_NGOAI_PANEL = 231; // vp.height − panel.height (header app + breadcrumb + thanh dưới)
const KHOI_TONG_QUAN = 41; //   ⚠ LẠC THỰC TẾ từ 2026-09-15 — xem khối cảnh báo ngay trên
const DAI_CHUYEN_CHE_DO = 30; // "Máy | Cây phân cấp"
const KHUNG_DAI_CANH_BAO = 91; // tiêu đề "Cảnh báo (N)" + hàng chip lọc (349−258 = 244−153)
const TIEU_DE_NHOM = 24; //     "TỒN ĐỌNG >24H (7)" dính đầu ô cuộn
const HANG_TON_DONG = 41;
const KHUNG_DANH_SACH = 44; //  tab Máy|Cây + ô lọc
const HANG_MAY = 24;
const TRAN_DAI_PX = 328; //     mục C

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
