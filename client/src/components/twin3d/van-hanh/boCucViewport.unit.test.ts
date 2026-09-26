/**
 * ════════════════════════════════════════════════════════════════════════════
 * `boCucViewport.unit.test.ts` — ĐỢT 35, Pareto #4: BỐ CỤC THEO VIEWPORT (1600×900 VÀ 1280×720)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * QA Đợt 32 đo 5 ca SAI/HỎNG chỉ vì đổi viewport, và **không lưới nào kêu**:
 *   · `/twin-studio` `h-[calc(100vh-5rem)]` giả định vỏ 80 px; đỉnh thật **133** ⇒ đáy 953 > 900, 773 > 720.
 *   · `/twin/may/14` ở 720: sàn 320 của kit ⇒ cảnh 320 > cockpit **275** — vi phạm bất biến `cockpit.h >
 *     khoiCanh.h` mà e2e Đợt 31 chỉ ghim ở 1600×900.
 *   · `/twin/line/2` ở 720: 11/12 ô trạm gãy 2 dòng (chữ được phép xuống dòng khi `li` bị ép co).
 *
 * ★ G91 — LƯỚI ĐỌC TỪ CHÍNH KIT: hằng số lấy từ `manMay.ts`/`KhungCanh.tsx`, không chép số vào test.
 * ★ HAI HẠNG (như `manLineNoiVaoTrang`): hạng A đo bằng GIÁ TRỊ (`chieuCaoKhoiCanhMay`); hạng B đo bằng
 *   VĂN BẢN của trang đã TƯỚC CHÚ THÍCH (G92) — chỗ nối vào React/WebGL không dựng nổi trong node.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  SAN_KHOI_CANH_MAY_PX,
  SAN_MEM_KHOI_CANH_MAY_PX,
  TRAN_KHOI_CANH_MAY_PX,
  TI_LE_KHOI_CANH_MAY,
  chieuCaoKhoiCanhMay,
} from "./manMay";
import { SAN_CAO_KHUNG_CANH_PX } from "../loi/KhungCanh";
import { chieuCaoTruDinh } from "./useTruDinhKhung";

const GOC = resolve(__dirname, "../../../..");
/** Tước chú thích khối + dòng để không "xanh oan" vì docblock nhắc tên (G92). */
const tuocChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const docTrang = (p: string) => tuocChuThich(readFileSync(resolve(GOC, p), "utf8"));
const STUDIO = docTrang("src/pages/TwinStudio.tsx");
const LINE = docTrang("src/pages/TwinLine.tsx");
const MAY = docTrang("src/pages/TwinMay.tsx");
const KHUNG = docTrang("src/components/twin3d/loi/KhungCanh.tsx");
const CANH = docTrang("src/components/twin3d/van-hanh/CanhVanHanh.tsx");
const DAI = docTrang("src/components/twin3d/van-hanh/DaiLine.tsx");

/* ══════════════════════════════════════════════════════════════════════════ */
/* ① Màn Máy — `chieuCaoKhoiCanhMay`: hạng A, đo bằng GIÁ TRỊ                   */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ① chieuCaoKhoiCanhMay — clamp theo PHẦN CÒN LẠI, bất biến cockpit > cảnh", () => {
  /** Chiều cao thanh trên màn Máy (đo DOM: 125 − 80 = 45 px) — chỉ để dựng ca, không phải hằng của kit. */
  const THANH_TREN = 45;
  const VO = 80;

  it("★ 1600×900 (Đợt 31): còn lại 775 ⇒ 324, cockpit 451 — KHÔNG đổi số đã nghiệm thu", () => {
    const canh = chieuCaoKhoiCanhMay(900 - VO - THANH_TREN, 900);
    expect(canh).toBe(324);
    expect(775 - canh).toBe(451);
  });

  it("★★★ 1280×720 (QA Đợt 32): còn lại 595 ⇒ cảnh < cockpit (trước: 320 > 275); Đợt 45 sàn mềm ⇒ 280 (trước 259)", () => {
    const canh = chieuCaoKhoiCanhMay(720 - VO - THANH_TREN, 720);
    // ★ Đợt 45 (mục 6) — QA Đợt 44 đo 259 "thấp": sàn mềm 280 áp vì 280 ≤ ⌊594/2⌋ = 297; cockpit 315 > 280.
    expect(canh).toBe(SAN_MEM_KHOI_CANH_MAY_PX);
    expect(canh).toBe(280);
    expect(595 - canh).toBeGreaterThan(canh);
    expect(canh).toBeGreaterThanOrEqual(SAN_KHOI_CANH_MAY_PX);
  });

  it("★ Đợt 45 — sàn mềm CO theo còn-lại (không phá bất biến) và KHÔNG áp khi chưa đo", () => {
    expect(SAN_MEM_KHOI_CANH_MAY_PX).toBe(280);
    expect(SAN_MEM_KHOI_CANH_MAY_PX).toBeGreaterThan(SAN_KHOI_CANH_MAY_PX);
    expect(SAN_MEM_KHOI_CANH_MAY_PX).toBeLessThan(TRAN_KHOI_CANH_MAY_PX);
    // còn lại 560 ⇒ ⌊559/2⌋ = 279 < 280 ⇒ sàn mềm co về 279; cockpit 281 > 279.
    expect(chieuCaoKhoiCanhMay(560, 720)).toBe(279);
    // còn lại 500 ⇒ 249; cockpit 251 > 249.
    expect(chieuCaoKhoiCanhMay(500, 720)).toBe(249);
    // chưa đo (null) ⇒ theo vh như cũ: 720 ⇒ 259, KHÔNG 280.
    expect(chieuCaoKhoiCanhMay(null, 720)).toBe(Math.round(0.36 * 720));
    // 1600×900 KHÔNG đổi (36 vh = 324 > 280).
    expect(chieuCaoKhoiCanhMay(900 - VO - THANH_TREN, 900)).toBe(324);
  });

  it("★ bất biến cockpit > cảnh giữ trên MỌI viewport cao ≥ 2·SÀN + vỏ (quét 606…1400)", () => {
    for (let H = 2 * SAN_KHOI_CANH_MAY_PX + VO + THANH_TREN + 1; H <= 1400; H += 7) {
      const conLai = H - VO - THANH_TREN;
      const canh = chieuCaoKhoiCanhMay(conLai, H);
      expect(conLai - canh, `H=${H}`).toBeGreaterThan(canh);
      expect(canh).toBeGreaterThanOrEqual(SAN_KHOI_CANH_MAY_PX);
      expect(canh).toBeLessThanOrEqual(TRAN_KHOI_CANH_MAY_PX);
    }
  });

  it("sàn THẮNG dưới ngưỡng — giới hạn NÓI RA, không giấu: còn lại 400 ⇒ 240 (cockpit 160 < 240)", () => {
    expect(chieuCaoKhoiCanhMay(400, 560)).toBe(SAN_KHOI_CANH_MAY_PX);
  });

  it("trần 360 ở màn rất cao; chưa đo được còn-lại (null) ⇒ theo vh kẹp [sàn, trần]", () => {
    expect(chieuCaoKhoiCanhMay(2000, 2000)).toBe(TRAN_KHOI_CANH_MAY_PX);
    expect(chieuCaoKhoiCanhMay(null, 900)).toBe(Math.round(TI_LE_KHOI_CANH_MAY * 900));
    expect(chieuCaoKhoiCanhMay(null, 500)).toBe(SAN_KHOI_CANH_MAY_PX);
    expect(chieuCaoKhoiCanhMay(NaN, 900)).toBe(324);
  });

  it("★★★ ĐỘT BIẾN: bỏ vế còn-lại (chỉ `36vh`) PHẢI phá bất biến ở 720 — lưới biết kêu", () => {
    const chiVh = Math.round(Math.max(320, Math.min(360, 0.36 * 720))); // = clamp(320px,36vh,360px) cũ
    expect(chiVh).toBe(320);
    expect(595 - chiVh).toBeLessThan(chiVh); // 275 < 320: ĐÚNG lỗi QA đo
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ② Hằng của kit — một sàn cho khung VÀ canvas (G12)                            */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ② sàn khung/canvas — kit giữ 320, màn Máy 240 < 320, hai chỗ đọc MỘT hằng", () => {
  it("`KhungCanh` mặc định `sanCaoPx = SAN_CAO_KHUNG_CANH_PX` (320) và `minHeight: sanCaoPx` — không còn số 320 cứng", () => {
    expect(SAN_CAO_KHUNG_CANH_PX).toBe(320);
    expect(KHUNG).toMatch(/sanCaoPx = SAN_CAO_KHUNG_CANH_PX/);
    expect(KHUNG).toMatch(/minHeight:\s*sanCaoPx/);
    expect(KHUNG).not.toMatch(/minHeight:\s*320\b/);
  });
  it("sàn màn Máy THẤP hơn sàn kit (không thì 720 lại 320 > 275) và ≤ trần", () => {
    expect(SAN_KHOI_CANH_MAY_PX).toBeLessThan(SAN_CAO_KHUNG_CANH_PX);
    expect(SAN_KHOI_CANH_MAY_PX).toBeLessThanOrEqual(TRAN_KHOI_CANH_MAY_PX);
  });
  it("`CanhVanHanh` chuyển `sanCaoPx` xuống `<KhungCanh`; `TwinMay` truyền `SAN_KHOI_CANH_MAY_PX` (canvas không CHUI)", () => {
    expect(CANH).toMatch(/<KhungCanh[\s\S]*?sanCaoPx=\{props\.sanCaoPx\}/);
    expect(MAY).toMatch(/<CanhVanHanh[\s\S]*?sanCaoPx=\{SAN_KHOI_CANH_MAY_PX\}/);
  });
  it("`TwinMay` đặt chiều cao khối bằng `chieuCaoKhoiCanhMay` — KHÔNG còn `clamp(320px`", () => {
    expect(MAY).toMatch(/chieuCaoKhoiCanhMay\(/);
    expect(MAY).toMatch(/data-testid="khoi-canh-may"/);
    expect(MAY).not.toMatch(/clamp\(320px/);
    // Đo bằng ResizeObserver trên CỘT TRÁI (phần còn lại), không đoán từ vh.
    expect(MAY).toMatch(/ref=\{cotTraiRef\}/);
    expect(MAY).toMatch(/new ResizeObserver\(doLai\);\s*ro\.observe\(el\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ③ Đỉnh khung ĐO lúc chạy — ba màn, ba biến RIÊNG, một hook                      */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ③ useTruDinhKhung — Studio/Line/Máy đo `top` lúc chạy, không `h-[calc(100vh-5rem)]`", () => {
  it("`chieuCaoTruDinh` là `calc(100vh - var(--x, 5rem))` — `5rem` chỉ là MỒI trước effect", () => {
    expect(chieuCaoTruDinh("--twin-studio-top")).toBe("calc(100vh - var(--twin-studio-top, 5rem))");
  });
  it("★★★ Studio: hook + biến riêng `--twin-studio-top`, KHÔNG còn lớp `h-[calc(100vh-5rem)]`", () => {
    expect(STUDIO).toMatch(/useTruDinhKhung\(khungRef,\s*"--twin-studio-top"\)/);
    expect(STUDIO).toMatch(/chieuCaoTruDinh\("--twin-studio-top"\)/);
    expect(STUDIO).toMatch(/ref=\{khungRef\}[\s\S]{0,200}data-testid="man-twin-studio"/);
    expect(STUDIO).not.toMatch(/h-\[calc\(100vh-5rem\)\]/);
  });
  it("Line/Máy dùng CÙNG hook với tên biến RIÊNG (G12 — không còn ba bản chép tay)", () => {
    expect(LINE).toMatch(/useTruDinhKhung\(khungRef,\s*"--twin-line-top"\)/);
    expect(LINE).toMatch(/chieuCaoTruDinh\("--twin-line-top"\)/);
    expect(MAY).toMatch(/useTruDinhKhung\(khungRef,\s*"--twin-may-top"\)/);
    expect(MAY).toMatch(/chieuCaoTruDinh\("--twin-may-top"\)/);
    for (const m of [LINE, MAY]) expect(m).not.toMatch(/setProperty\("--twin-(line|may)-top"/);
  });
  it("★★★ Đợt 38 (Pareto #5): hook CỘNG đệm dưới của CHA (`parentElement` + `paddingBottom`) và `scrollY` — cùng luật `demDuoi` của TwinVanHanh", async () => {
    // Đo Đợt 37/38: `<main>` vỏ `md:p-6` ⇒ paddingBottom 24 px ⇒ Line/Máy/Studio cuộn dọc ĐÚNG 24 px ở cả 2 viewport.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const HOOK = readFileSync(resolve(__dirname, "useTruDinhKhung.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(HOOK).toContain("el.parentElement");
    expect(HOOK).toMatch(/getComputedStyle\(cha\)\.paddingBottom/);
    expect(HOOK).toMatch(/getBoundingClientRect\(\)\.top \+ window\.scrollY/);
    expect(HOOK).toMatch(/Math\.round\(tren \+ demDuoi\)/);
  });
  it("★ ba tên biến ĐÔI MỘT khác nhau — dùng chung là khớp nối ẩn giữa hai màn", () => {
    const ten = ["--twin-studio-top", "--twin-line-top", "--twin-may-top"];
    expect(new Set(ten).size).toBe(3);
    expect(STUDIO).not.toMatch(/--twin-(line|may)-top/);
    expect(LINE).not.toMatch(/--twin-(studio|may)-top/);
    expect(MAY).not.toMatch(/--twin-(studio|line)-top/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ④ Dải trạm — ô MỘT dòng, thiếu chỗ thì CUỘN, không gãy chữ                     */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ④ DaiLine — ô trạm `whitespace-nowrap` + `shrink-0`; `ol` cuộn ngang thanh mảnh", () => {
  it("nút ô trạm không được xuống dòng và không bị ép co (1280: 11/12 ô gãy 2 dòng trước vá)", () => {
    const nut = DAI.match(/<button[\s\S]*?data-testid=\{`o-tram-\$\{s\.id\}`\}[\s\S]*?className=\{`([^`]*)`/);
    expect(nut, "nút o-tram-<id> phải có className").not.toBeNull();
    const lop = nut![1];
    expect(lop).toMatch(/\bwhitespace-nowrap\b/);
    expect(lop).toMatch(/\bshrink-0\b/);
    expect(lop).not.toMatch(/\bmin-w-16\b/);
  });
  it("`ol` giữ `overflow-x-auto` (cuộn là câu thật) và `[scrollbar-width:thin]` (không cao thêm 17 px)", () => {
    const ol = DAI.match(/<ol[\s\S]*?className="([^"]*)"/);
    expect(ol).not.toBeNull();
    expect(ol![1]).toMatch(/\boverflow-x-auto\b/);
    expect(ol![1]).toMatch(/\[scrollbar-width:thin\]/);
  });
});
