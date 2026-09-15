// @vitest-environment jsdom
//
/**
 * lopPhuKhongChe.dom.test.tsx — ★★★ QA lần 11 · PH-31.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LỖI ĐƯỢC ĐO: SẢN PHẨM NÓI THẬT RỒI TỰ CHE CÂU ĐÓ
 * ════════════════════════════════════════════════════════════════════════════
 * Ba ảnh vai giám đốc (`.qa-tapdoan/anh/AB-A3-qatd_giamdoc.png`,
 * `AB-B4-…-tang3-trong.png`, `AB-B7-…-tapdoan.png`): lớp phủ `bang-kpi-noi` đè
 * lên banner *"326 machines are outside this load"* và lên **cả hai** dòng
 * banner trung thực của `?pv=tapdoan`, cắt câu giải thích ở giữa.
 *
 * Cơ học (tự đọc mã):
 *   · `DaiHopNhat` vẽ phần MỞ bằng `absolute inset-x-0 top-full z-30` ⇒ nó THẢ
 *     XUỐNG đè lên khung cảnh, cao đúng `gopDuoc.length` dòng.
 *   · `BangKpiNoi` neo `absolute left-2 top-2 z-30` **của khung cảnh**.
 *   · Cùng `z-30`; lớp phủ KPI đứng SAU trong DOM ⇒ nó thắng.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO **KHÔNG** ĐO BẰNG `getBoundingClientRect` — BẪY ĐÃ ĐO ĐƯỢC
 * ════════════════════════════════════════════════════════════════════════════
 * Kế hoạch Task 6 bước 1 đề nghị `expect(dienTichGiao(bbox kpi, bbox banner))
 * .toBe(0)`. **jsdom KHÔNG có layout engine**: `getBoundingClientRect()` trả
 * `{0,0,0,0}` cho MỌI phần tử, `scrollWidth`/`clientWidth` đều `0`. Phép đo ấy
 * vì vậy ra `0` **kể cả trên bản chưa vá** — luôn xanh và không đo gì (G5).
 * Agent Task 7 đã dính đúng bẫy này ở bước 4 của nó.
 *
 * ⇒ Ở đây đo bằng **mô hình px suy từ CSS đã build**, và mô hình được
 *   CALIBRATE khớp số đo thật của ảnh QA trước khi dùng để phán quyết:
 *     · số dòng dải việc: đọc từ DOM THẬT của `DaiHopNhat` (không giả định);
 *     · chiều cao một dòng: `CAO_MOT_DONG_DAI_VIEC_PX` = 25,5 px (suy từ
 *       `px-3 py-1 text-[11px]` + viền — xem docblock của hằng số);
 *     · độ lệch của lớp phủ KPI: đọc lớp `top-N` từ `className` THẬT của
 *       `BangKpiNoi`;
 *     · chỗ chừa của khung neo: `chuaChoDaiViec()` — hàm sản xuất thật.
 *
 *   ★★★ BẰNG CHỨNG THƯỚC NÀY BIẾT KÊU: nhóm "ĐỐI CHỨNG" dưới đây dựng lại
 *   HÌNH HỌC CŨ (khung neo `top: 0`) và bắt buộc mô hình phải tái hiện **đúng
 *   43 px chồng lấn** mà ảnh `AB-B7` đo được. Một thước ra 0 ở đó là thước hỏng.
 *
 * ⚠ CÒN NỢ, KHÔNG GIẤU: mô hình này ĐO GIẢ ĐỊNH BỐ CỤC, không đo pixel thật.
 *   Xác nhận cuối cùng phải là một lượt chụp ảnh ở Task 15 (Playwright, 1600×900
 *   và 1280×720, vai `qatd_giamdoc`, `?pv=tapdoan`) — ghi vào báo cáo.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { resolve } from "node:path";

import { docMaNguon } from "@shared/testing/docMaNguon";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, macDinh?: string | Record<string, unknown>, bien?: Record<string, unknown>) => {
      const md = typeof macDinh === "string" ? macDinh : _k;
      let s = md;
      const b = bien ?? (typeof macDinh === "object" ? macDinh : undefined);
      if (b) for (const [k, v] of Object.entries(b)) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  }),
}));

import DaiHopNhat from "../bo-cuc/DaiHopNhat";
import { tachAnToan, type MucViec } from "../bo-cuc/daiHopNhatLogic";
import { BangKpiNoi, CAO_MOT_DONG_DAI_VIEC_PX, chuaChoDaiViec } from "./BangKpiNoi";
import { tinhKpiNoi } from "./kpiNoiLogic";

afterEach(() => cleanup());

const GOC = resolve(import.meta.dirname, "../../../..");
const TRANG = resolve(GOC, "src/pages/TwinVanHanh.tsx");

/* ───────────────────────── Mô hình px (một trục: y) ───────────────────────── */

/** Một đoạn thẳng đứng, px, gốc toạ độ = **mép trên khung cảnh**. */
interface DoanY {
  dau: number;
  cuoi: number;
}

/** Độ chồng lấn của hai đoạn, px. 0 = không giao. */
function giaoY(a: DoanY, b: DoanY): number {
  return Math.max(0, Math.min(a.cuoi, b.cuoi) - Math.max(a.dau, b.dau));
}

/**
 * Đọc `top-N` (thang Tailwind, 1 đơn vị = 4 px) từ `className` THẬT.
 * Ném khi không tìm thấy — một lớp phủ không khai `top` là dữ kiện THIẾU, và
 * trả `0` ở đó sẽ biến phép đo thành lời khai (`??` vá lỗ đọc — luật toàn cục).
 */
function pxTuLopTop(className: string): number {
  const m = /(?:^|\s)top-(\d+)(?:\s|$)/.exec(className);
  if (!m) throw new Error(`KHÔNG ĐỌC ĐƯỢC: không có lớp "top-N" trong "${className}"`);
  return Number(m[1]) * 4;
}

/* ───────────────────────────── Dữ kiện nền thật ───────────────────────────── */

/**
 * ĐÚNG hai mục banner của ảnh `AB-B7-qatd_giamdoc-tapdoan.png` — nguyên văn
 * chuỗi trên màn, cùng `testId` mà `TwinVanHanh.tsx` khai.
 */
const HAI_BANNER: MucViec[] = [
  {
    testId: "banner-ngoai-luot-nap",
    nhom: "phamVi",
    hien: true,
    noiDung:
      "326 machines are outside this load (other buildings were not asked) — whether they are placed is not known yet",
  },
  {
    testId: "banner-ha-cap",
    nhom: "phamVi",
    hien: true,
    noiDung:
      "Showing data for ONE factory (3 factories in the system). The Corporate scope cannot load several factories at once yet — use the Factory box to switch.",
  },
];

/** Dựng `DaiHopNhat` THẬT rồi MỞ nó ra, trả số dòng của lớp phủ thả xuống. */
function soDongDaiDaMo(muc: MucViec[]): number {
  const r = render(<DaiHopNhat muc={muc} />);
  const nut = r.container.querySelector('[data-testid="nut-mo-dai-hop-nhat"]');
  if (!nut) throw new Error("KHÔNG ĐỌC ĐƯỢC: dải việc không có nút mở");
  fireEvent.click(nut);
  const chiTiet = r.container.querySelector('[data-testid="dai-hop-nhat-chi-tiet"]');
  if (!chiTiet) throw new Error("KHÔNG ĐỌC ĐƯỢC: bấm mở mà không có lớp phủ chi tiết");
  return chiTiet.children.length;
}

/** Lớp phủ KPI THẬT — trả `className` gốc của nó. */
function lopKpi(): string {
  const r = render(
    <BangKpiNoi kpi={tinhKpiNoi([])} dangTai={false} mo onDoiMo={() => {}} nhanPhamVi="X · Y · Z" />,
  );
  const el = r.container.querySelector('[data-testid="bang-kpi-noi"]');
  if (!el) throw new Error("KHÔNG ĐỌC ĐƯỢC: không tìm thấy bang-kpi-noi");
  return el.className;
}

/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ PH-31 — dữ kiện nền: cả hai lớp phủ CÓ THẬT và đo được", () => {
  it("dải việc mở ra ĐÚNG 2 dòng, và chữ trên màn là câu banner THẬT", () => {
    const r = render(<DaiHopNhat muc={HAI_BANNER} />);
    fireEvent.click(r.container.querySelector('[data-testid="nut-mo-dai-hop-nhat"]')!);
    const chiTiet = r.container.querySelector('[data-testid="dai-hop-nhat-chi-tiet"]')!;
    expect(chiTiet.children.length).toBe(2);
    expect(chiTiet.textContent).toContain("326 machines are outside this load");
    expect(chiTiet.textContent).toContain("Showing data for ONE factory");
  });

  it("lớp phủ chi tiết THẢ XUỐNG khung cảnh — `absolute … top-full`, không phải khối trong dòng chảy", () => {
    const r = render(<DaiHopNhat muc={HAI_BANNER} />);
    fireEvent.click(r.container.querySelector('[data-testid="nut-mo-dai-hop-nhat"]')!);
    const lop = r.container.querySelector('[data-testid="dai-hop-nhat-chi-tiet"]')!.className;
    expect(lop).toContain("absolute");
    expect(lop).toContain("top-full");
  });

  it("lớp phủ KPI neo `absolute … top-2` ⇒ 8 px kể từ mép trên khung cảnh", () => {
    const lop = lopKpi();
    expect(lop).toContain("absolute");
    expect(pxTuLopTop(lop)).toBe(8);
  });

  it("`tachAnToan` cho ĐÚNG 2 mục gộp — dải AN TOÀN nằm trong dòng chảy, không thả xuống", () => {
    expect(tachAnToan(HAI_BANNER).gopDuoc.length).toBe(2);
    const coEstop: MucViec[] = [
      ...HAI_BANNER,
      { testId: "canh-bao-estop", nhom: "anToan", hien: true, noiDung: "E-STOP" },
    ];
    expect(tachAnToan(coEstop).gopDuoc.length).toBe(2);
    expect(tachAnToan(coEstop).anToan.length).toBe(1);
  });
});

describe("★★★ PH-31 — ĐỐI CHỨNG: thước này BIẾT KÊU trên hình học CŨ", () => {
  it("★★★ tái hiện số đo của ảnh AB-B7: khung neo `top: 0` ⇒ chồng lấn ĐÚNG 43 px", () => {
    const soDong = soDongDaiDaMo(HAI_BANNER);
    expect(soDong).toBe(2);
    const dai: DoanY = { dau: 0, cuoi: soDong * CAO_MOT_DONG_DAI_VIEC_PX }; // 0 → 51
    // Hình học CŨ: khung neo `inset-y-0` ⇒ top 0; KPI `top-2` ⇒ 8.
    const kpiCu: DoanY = { dau: 0 + pxTuLopTop(lopKpi()), cuoi: 1_000 };
    expect(giaoY(dai, kpiCu)).toBe(43); // 51 − 8, khớp ảnh (banner 207→258, KPI 215)
  });

  it("★ và nó kêu cả với MỘT banner (ảnh AB-A3/AB-B4) — không phải chỉ đúng một ca", () => {
    const soDong = soDongDaiDaMo([HAI_BANNER[0]]);
    expect(soDong).toBe(1);
    const dai: DoanY = { dau: 0, cuoi: soDong * CAO_MOT_DONG_DAI_VIEC_PX };
    const kpiCu: DoanY = { dau: pxTuLopTop(lopKpi()), cuoi: 1_000 };
    expect(giaoY(dai, kpiCu)).toBeGreaterThan(0);
  });
});

describe("★★★ PH-31 — SAU BẢN VÁ: lớp phủ KPI KHÔNG giao với dải việc", () => {
  it("★★★ 2 banner (ảnh AB-B7) ⇒ chồng lấn 0 px", () => {
    const soDong = soDongDaiDaMo(HAI_BANNER);
    expect(soDong).toBe(2);
    const dai: DoanY = { dau: 0, cuoi: soDong * CAO_MOT_DONG_DAI_VIEC_PX };
    const kpi: DoanY = { dau: chuaChoDaiViec(soDong) + pxTuLopTop(lopKpi()), cuoi: 1_000 };
    expect(dai.cuoi).toBeGreaterThan(0); // không đo trên đoạn rỗng
    expect(giaoY(dai, kpi)).toBe(0);
  });

  it("★★★ quét 1..8 banner — không số nào cho chồng lấn", () => {
    for (let n = 1; n <= 8; n += 1) {
      const muc: MucViec[] = Array.from({ length: n }, (_, i) => ({
        testId: `banner-${i}`,
        nhom: "phamVi",
        hien: true,
        noiDung: `banner ${i}`,
      }));
      const soDong = soDongDaiDaMo(muc);
      expect(soDong, `n=${n}`).toBe(n);
      const dai: DoanY = { dau: 0, cuoi: soDong * CAO_MOT_DONG_DAI_VIEC_PX };
      const kpi: DoanY = { dau: chuaChoDaiViec(soDong) + pxTuLopTop(lopKpi()), cuoi: 1_000 };
      expect(giaoY(dai, kpi), `n=${n}: dải cao ${dai.cuoi}, KPI bắt đầu ${kpi.dau}`).toBe(0);
      cleanup();
    }
  });

  it("★ KHÔNG có banner nào ⇒ chừa ĐÚNG 0 px (không đánh thuế ca thường gặp nhất)", () => {
    const r = render(<DaiHopNhat muc={[]} />);
    expect(r.container.querySelector('[data-testid="dai-hop-nhat"]')).toBeNull();
    expect(chuaChoDaiViec(0)).toBe(0);
  });

  it("★ chỉ có E-STOP ⇒ chừa 0 px: dải an toàn nằm TRONG dòng chảy, không đè cảnh", () => {
    const estop: MucViec[] = [
      { testId: "canh-bao-estop", nhom: "anToan", hien: true, noiDung: "E-STOP" },
    ];
    const r = render(<DaiHopNhat muc={estop} />);
    // Không có dải gộp ⇒ không có lớp phủ thả xuống.
    expect(r.container.querySelector('[data-testid="dai-hop-nhat-chi-tiet"]')).toBeNull();
    expect(chuaChoDaiViec(tachAnToan(estop).gopDuoc.length)).toBe(0);
  });

  it("★ mục `hien: false` KHÔNG được tính chỗ chừa (đếm mục ĐANG BẬT — G9)", () => {
    const tat: MucViec[] = HAI_BANNER.map((m) => ({ ...m, hien: false }));
    expect(tachAnToan(tat).gopDuoc.length).toBe(0);
    expect(chuaChoDaiViec(0)).toBe(0);
  });

  it("★ hàm chừa chỗ ĐƠN ĐIỆU TĂNG và không trả rác cho đầu vào rác", () => {
    expect(chuaChoDaiViec(-1)).toBe(0);
    expect(chuaChoDaiViec(Number.NaN)).toBe(0);
    for (let n = 1; n <= 8; n += 1) {
      expect(chuaChoDaiViec(n)).toBeGreaterThan(chuaChoDaiViec(n - 1));
      expect(chuaChoDaiViec(n)).toBeGreaterThanOrEqual(n * CAO_MOT_DONG_DAI_VIEC_PX);
    }
  });
});

describe("★★★ PH-31 — dây đã nối vào trang, không phải hàm chết", () => {
  const nguon = docMaNguon(TRANG);

  it("dữ kiện nền: đọc được trang và nó có khung neo lớp phủ", () => {
    expect(nguon.length).toBeGreaterThan(50_000);
    expect(nguon).toContain('data-testid="khung-neo-lop-phu"');
  });

  it("★★★ khung neo KHÔNG còn `inset-y-0` cứng — top phải phụ thuộc dải việc", () => {
    expect(nguon).not.toMatch(/"pointer-events-none absolute inset-y-0 "/);
  });

  it("★★★ trang tính số mục gộp bằng `tachAnToan` và truyền vào `chuaChoDaiViec`", () => {
    expect(nguon).toMatch(/const soMucDaiGop\s*=[\s\S]{0,400}?tachAnToan\(\s*mucViec\s*\)\.gopDuoc\.length/);
    expect(nguon).toMatch(/chuaChoDaiViec\(\s*soMucDaiGop\s*\)/);
  });

  it("★★★ chỗ chừa THẬT SỰ đi vào style của khung neo (và đo được từ ngoài)", () => {
    expect(nguon).toMatch(/style=\{\{\s*top:\s*chuaChoDai\s*\}\}/);
    expect(nguon).toMatch(/data-chua-cho-dai=\{chuaChoDai\}/);
  });
});
