/**
 * danhSachMayMaNgan.unit.test.ts — ★★★ TASK 7 (PH-27, QA lần 11): DANH SÁCH MÁY
 * PHẢI RÚT TIỀN TỐ NHƯ MÀN CHUYỀN — **VÀ RÚT TIỀN TỐ MỘT MÌNH LÀ CHƯA ĐỦ.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ SỐ ĐO GỐC — KHÔNG PHẢI SỞ THÍCH
 * ════════════════════════════════════════════════════════════════════════════
 * QA lần 11 (`.qa-tapdoan/tho/F/F4-gpu.json`, ca `twin-tang-dong`, 1280×720):
 * **14 chuỗi** trong `danh-sach-may` có `scrollWidth 124 > clientWidth 66`
 * (mất 47 %). Cả 14 là mã máy 19 ký tự của kịch bản tập đoàn; phần **sống sót**
 * sau khi `truncate` cắt là `QATD-A-T…` — **tiền tố dùng chung của mọi máy** —
 * còn phần phân biệt (`-X1-L1-M05`) nằm ở ĐUÔI và bị cắt mất. Ở 1280 mọi hàng
 * đọc giống hệt nhau (ảnh `F-F5-twin-tang-dong-68may-1280.png`).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐO LẠI TRƯỚC KHI VÁ — VÀ PHÉP ĐO BÁC BỎ NỬA ĐẦU CỦA BẢN VÁ
 * ════════════════════════════════════════════════════════════════════════════
 * Brief nói: "màn Chuyền đã có lời giải — rút tiền tố". Đo thử trên **đúng CSS
 * đã build mà QA đo** (`.qa-tapdoan/dist-sauva/public/assets/index-*.css`,
 * Chromium 1280×720, bản sao DOM của chính hàng này); bản sao được **calibrate**:
 * nó cho lại ĐÚNG `sw=124 / cw=66` của QA khi nhãn trạng thái là `Down/Stopped`
 * và ô tuổi là `13s` — tức thiết bị đo tái hiện được hiện trường.
 *
 *   | biến thể                                   | bề rộng ô mã | `T1-X1-L1-M05` (76,5 px) |
 *   |--------------------------------------------|--------------|--------------------------|
 *   | V0 nguyên trạng, mã 19 ký tự               | 66 px        | — (đang cắt 124→66)      |
 *   | **V1 CHỈ rút tiền tố** (12 ký tự còn lại)  | **66 px**    | **VẪN CẮT** (77 > 66)    |
 *   | W0 chỉ chặn cột trạng thái, giữ mã đầy đủ  | 85 px        | **VẪN CẮT** (124 > 85)   |
 *   | **W1 rút tiền tố + chặn cột trạng thái**   | **85 px**    | **VỪA** (77 ≤ 85)        |
 *
 * ⇒ **CẦN HAI CƠ CHẾ** (G128). Vì sao: tiền tố chung của danh sách này chỉ là
 *   `QATD-A-` (7/19 ký tự) — danh sách trải **3 tầng × 2 xưởng** nên `T#`/`X#`
 *   đã khác nhau ngay; màn Chuyền rút được `QATD-C-T1-X1-L1-` (16 ký tự) vì ở đó
 *   mọi máy CÙNG một chuyền. Chép lời giải của màn Chuyền mà không đo lại tập mã
 *   là đúng lớp lỗi "mượn con số của phép đo khác".
 * ⇒ Cơ chế thứ hai chọn **chặn cột trạng thái** (`max-w-12` = 48 px + `truncate`)
 *   chứ không bóp `gap`/`padding` (đo được: gap-1 + px-1.5 chỉ cho 76 px — thiếu
 *   0,5 px, tức "xanh nhờ dung sai +1" chứ không phải vừa). Cột trạng thái là
 *   **bản sao thứ hai** của chấm màu + hoạ tiết (§10.3 mã hoá dư thừa) mà đang
 *   ăn 66,8 px (`Down/Stopped`) — rộng hơn cả ô danh tính máy; chữ đầy đủ giữ ở
 *   `title`. Đo W1 ở 4 tổ hợp ngôn ngữ/nhãn xấu nhất (`Down/Stopped`+`13s`,
 *   `Decommissioned`+`123 days`, `Ngừng khai thác`+`13s`, `故障/停机`+`13s`):
 *   ô mã **85 / 85 / 85 / 89 px** — không ca nào cắt.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ VÌ SAO ĐO BỀ RỘNG BẰNG **MÔ HÌNH** Ở ĐÂY
 * ════════════════════════════════════════════════════════════════════════════
 * jsdom KHÔNG có layout engine: `scrollWidth`/`clientWidth` luôn **0**, nên một
 * ca `expect(sw).toBeLessThanOrEqual(cw + 1)` trong jsdom là `0 ≤ 1` — **luôn
 * xanh, không đo gì** (họ G5). Nên tệp này đo bằng một **bảng bề rộng ký tự đo
 * được từ chính CSS đã build** (`BANG_PX`), và ca đầu tiên là ca **tự canh
 * thiết bị đo**: mô hình phải tái hiện được con số 124 px mà QA đo trên trình
 * duyệt thật. Mô hình vượt số thật ≤ 1,6 px (1,3 %) — lệch về phía AN TOÀN.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { docMaNguon } from "@shared/testing/docMaNguon";
import { rutTienTo, tienToChung } from "./maNgan";

/* ══════════════════════════════════════════════════════════════════════════ */
/* DỮ KIỆN NỀN — 14 mã THẬT mà QA lần 11 đo được là bị cắt                     */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Nguyên văn từ `.qa-tapdoan/tho/F/F4-gpu.json` → `dep[4].cat[*].chu`. */
const MA_QA11 = [
  "QATD-A-T1-X1-L1-M05",
  "QATD-A-T1-X1-L1-M11",
  "QATD-A-T1-X1-L2-M02",
  "QATD-A-T1-X2-L1-M05",
  "QATD-A-T1-X2-L1-M11",
  "QATD-A-T1-X2-L2-M07",
  "QATD-A-T2-X1-L1-M03",
  "QATD-A-T2-X1-L1-M06",
  "QATD-A-T2-X1-L1-M08",
  "QATD-A-T2-X1-L3-M09",
  "QATD-A-T2-X1-L5-M02",
  "QATD-A-T2-X2-L1-M06",
  "QATD-A-T2-X2-L2-M04",
  "QATD-A-T3-X1-L2-M07",
] as const;

/** Bề rộng ô mã ĐO ĐƯỢC trên bản đang phục vụ, 1280×720 (QA lần 11). */
const RONG_O_MA_TRUOC_PX = 66;
/** Bề rộng ô mã ĐO ĐƯỢC sau khi chặn cột trạng thái ở 48 px (biến thể W1). */
const RONG_O_MA_SAU_PX = 85;
/** `scrollWidth` QA đo được cho mã 19 ký tự — mốc để tự canh mô hình. */
const RONG_MA_19_QA_PX = 124;

/**
 * Bề rộng MỘT ký tự ở `text-xs` với bộ chữ của sản phẩm (Geist → fallback
 * `ui-sans-serif`), đo bằng Chromium trên CSS đã build của bản QA đo:
 * trung bình 20 lần lặp để bớt sai số làm tròn.
 */
const BANG_PX: Record<string, number> = {
  "0": 6.469,
  "1": 6.469,
  "2": 6.469,
  "3": 6.469,
  "4": 6.469,
  "5": 6.469,
  "6": 6.469,
  "7": 6.469,
  "8": 6.469,
  "9": 6.469,
  A: 7.741,
  B: 6.879,
  C: 7.124,
  D: 8.414,
  E: 6.07,
  F: 5.859,
  G: 8.233,
  H: 8.52,
  I: 3.194,
  J: 3.838,
  K: 6.961,
  L: 5.648,
  M: 10.776,
  N: 8.977,
  O: 9.047,
  P: 6.721,
  Q: 9.047,
  R: 7.178,
  S: 6.375,
  T: 6.51,
  U: 8.245,
  V: 7.453,
  W: 11.209,
  X: 7.078,
  Y: 6.633,
  Z: 6.844,
  "-": 4.799,
  _: 4.98,
  ".": 2.602,
  "/": 4.676,
  " ": 3.288,
};

/** Bề rộng px của một chuỗi mã ở `text-xs`. Ký tự lạ ⇒ HỎNG, không im lặng bỏ qua. */
function rongPx(chu: string): number {
  let s = 0;
  for (const c of chu) {
    const w = BANG_PX[c];
    if (w === undefined) {
      throw new Error(`BANG_PX thiếu ký tự ${JSON.stringify(c)} — mô hình không đo được chuỗi này`);
    }
    s += w;
  }
  return s;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⓪ TỰ CANH THIẾT BỊ ĐO                                                       */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("⓪ Mô hình bề rộng phải tái hiện được con số QA đo trên trình duyệt thật", () => {
  it("★★★ mã 19 ký tự cho lại 124 px (± 2) — nếu ca này đỏ thì MỌI ca dưới vô giá trị", () => {
    const px = rongPx("QATD-A-T1-X1-L1-M05");
    expect(px).toBeGreaterThan(RONG_MA_19_QA_PX - 2);
    expect(px).toBeLessThan(RONG_MA_19_QA_PX + 2);
  });

  it("★ mô hình biết KÊU: mã 19 ký tự KHÔNG vừa ô 66 px mà QA đo", () => {
    expect(rongPx("QATD-A-T1-X1-L1-M05")).toBeGreaterThan(RONG_O_MA_TRUOC_PX);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ① HỢP ĐỒNG THẬT CỦA `tienToChung` / `rutTienTo` — lưới HỌC, không ÁP ĐẶT    */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("① Hợp đồng hai hàm dùng lại từ màn Chuyền", () => {
  const ma = ["QATD-A-T1-X1-L1-M01", "QATD-A-T1-X1-L1-M02", "QATD-A-T1-X1-L1-M03"];

  it("tiền tố chung được nhận ra, cắt tại ranh giới `-`", () => {
    expect(tienToChung(ma)).toBe("QATD-A-T1-X1-L1-");
  });

  it("phần rút ra phân biệt được từng máy", () => {
    const tienTo = tienToChung(ma);
    const ngan = ma.map((m) => rutTienTo(m, tienTo));
    expect(ngan).toEqual(["M01", "M02", "M03"]);
    expect(new Set(ngan).size).toBe(ma.length);
  });

  it('một máy duy nhất ⇒ "" (luật 1 `maNgan.ts`: cần ≥ 2 mã mới rút)', () => {
    expect(tienToChung(["QATD-A-T1-X1-L1-M01"])).toBe("");
    // …và `rutTienTo` với tiền tố rỗng trả NGUYÊN mã — không nuốt ký tự nào.
    expect(rutTienTo("QATD-A-T1-X1-L1-M01", "")).toBe("QATD-A-T1-X1-L1-M01");
  });

  it("ĐỐI CHỨNG ÂM — một mã lạc loài ⇒ KHÔNG rút gì cả (không rút 'gần đúng')", () => {
    expect(tienToChung([...ma, "SIM-L2-AOI01"])).toBe("");
  });

  it('ĐỐI CHỨNG ÂM — tập rỗng ⇒ "", không nổ', () => {
    expect(tienToChung([])).toBe("");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ② KỊCH BẢN TẬP ĐOÀN — 14 mã THẬT, hai cơ chế và vì sao cần CẢ HAI          */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ② 14 mã THẬT của QA lần 11 — cần HAI cơ chế, chứng minh bằng px", () => {
  it("dữ kiện nền: đủ 14 mã, dài 19 ký tự, đôi một khác nhau", () => {
    expect(MA_QA11.length).toBe(14);
    expect(new Set(MA_QA11).size).toBe(14);
    for (const m of MA_QA11) expect(m.length).toBe(19);
  });

  it("★ tiền tố chung của DANH SÁCH NÀY chỉ là `QATD-A-` — KHÔNG phải 16 ký tự như màn Chuyền", () => {
    // Danh sách trải 3 tầng × 2 xưởng nên `T#`/`X#` khác nhau ngay từ ký tự 8.
    expect(tienToChung([...MA_QA11])).toBe("QATD-A-");
  });

  it("★★★ CƠ CHẾ 1 MỘT MÌNH LÀ CHƯA ĐỦ — phần rút ra VẪN không vừa ô 66 px cũ", () => {
    const tienTo = tienToChung([...MA_QA11]);
    const ngan = MA_QA11.map((m) => rutTienTo(m, tienTo));
    expect(ngan.length).toBe(14);
    // Đây là ca đã BÁC BỎ nửa đầu bản vá: 76,7 px > 66 px.
    for (const n of ngan) expect(rongPx(n)).toBeGreaterThan(RONG_O_MA_TRUOC_PX);
  });

  it("★★★ CƠ CHẾ 2 MỘT MÌNH CŨNG CHƯA ĐỦ — mã đầy đủ không vừa ô 85 px mới", () => {
    for (const m of MA_QA11) expect(rongPx(m)).toBeGreaterThan(RONG_O_MA_SAU_PX);
  });

  it("★★★ HAI CƠ CHẾ CÙNG NHAU ⇒ MỌI mã vừa ô, và 14 hàng đọc KHÁC NHAU", () => {
    const tienTo = tienToChung([...MA_QA11]);
    const ngan = MA_QA11.map((m) => rutTienTo(m, tienTo));
    expect(ngan.length).toBe(14);
    expect(new Set(ngan).size).toBe(14); // ← tiêu chí (b) của QA: chữ NHÌN THẤY phải khác nhau
    for (const n of ngan) expect(rongPx(n)).toBeLessThanOrEqual(RONG_O_MA_SAU_PX);
  });

  it("ĐỐI CHỨNG f(x)=x — bộ mã CŨ (`SIM-L2-*`, 42 máy) không hỏng đi vì bản vá", () => {
    const cu = ["SIM-L2-AOI01", "SIM-L2-AOI02", "SIM-L2-SPI01", "SIM-L2-CONVEYOR"];
    const tienTo = tienToChung(cu);
    expect(tienTo).toBe("SIM-L2-");
    const ngan = cu.map((m) => rutTienTo(m, tienTo));
    expect(new Set(ngan).size).toBe(cu.length);
    for (const n of ngan) expect(rongPx(n)).toBeLessThanOrEqual(RONG_O_MA_SAU_PX);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ③ NỐI VÀO TRANG (G93) — lưới module không biết THÀNH PHẦN gọi bằng gì       */
/* ══════════════════════════════════════════════════════════════════════════ */

/** G92 — mã của thành phần, ĐÃ TƯỚC chú thích: docblock trên kia nhắc đủ mọi tên. */
const MA_TP = docMaNguon(resolve(__dirname, "DanhSachMay.tsx"))
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("★★★ ③ `DanhSachMay.tsx` THẬT SỰ nối vào hai cơ chế", () => {
  it("dữ kiện nền: đọc được mã nguồn thành phần và nó là thành phần đúng", () => {
    expect(MA_TP.length).toBeGreaterThan(2000);
    expect(MA_TP).toContain("export function DanhSachMay(");
  });

  it("CƠ CHẾ 1 — dùng lại `maNgan` của màn Chuyền (G12), không viết bản thứ hai", () => {
    expect(MA_TP).toContain('import { rutTienTo, tienToChung } from "./maNgan";');
    expect(MA_TP).toMatch(/tienToChung\(may\.map\(\(m\) => m\.ma\)\)/);
    expect(MA_TP).toContain("rutTienTo(m.ma, tienToMa)");
  });

  it("CƠ CHẾ 2 — cột trạng thái bị CHẶN bề rộng và cắt được, chữ đầy đủ ở `title`", () => {
    const i = MA_TP.indexOf('className="shrink-0 max-w-12');
    expect(i).toBeGreaterThan(-1);
    const o = MA_TP.slice(i, i + 400);
    expect(o).toContain("truncate");
    expect(o).toContain("title={t(kieu.khoaNhan)}");
  });

  it("★ RÚT ĐỂ ĐỌC, KHÔNG PHẢI ĐỂ GIẤU (luật 4 `maNgan.ts`) — tiền tố in MỘT lần + mã đầy đủ giữ nguyên", () => {
    expect(MA_TP).toContain('data-testid="danh-sach-may-tien-to"');
    expect(MA_TP).toContain("title={m.ma}");
    expect(MA_TP).toContain("data-ma={m.ma}");
  });

  it("★ tiền tố tính trên `may` (tập của panel), KHÔNG trên `hienThi` (đã lọc)", () => {
    // `hienThi` đổi theo từng ký tự gõ vào ô lọc; tính trên nó thì tiền tố (và
    // do đó MỌI hàng) nhảy chữ khi gõ, và lọc còn 1 máy sẽ bung lại mã đầy đủ.
    expect(MA_TP).not.toMatch(/tienToChung\(hienThi\./);
  });
});
