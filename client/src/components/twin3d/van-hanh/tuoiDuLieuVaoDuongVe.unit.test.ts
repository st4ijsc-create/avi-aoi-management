/**
 * tuoiDuLieuVaoDuongVe.unit.test.ts — **TUỔI DỮ LIỆU PHẢI ĐI TỚI ĐƯỜNG VẼ**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TỆP NÀY TỒN TẠI — MỘT LUẬT AN TOÀN CÓ MÃ, CÓ TEST, KHÔNG GIAO HÀNG
 * ════════════════════════════════════════════════════════════════════════════
 * `mauTrangThai.mauTheoTuoi` mang luật: dữ liệu cũ 60–300 s ⇒ **nhạt 40 %**.
 * Đo 2026-09-18 bằng grep trên `client/src server shared`: hàm ấy có **0 nơi
 * gọi trong mã sản phẩm** — chỉ dòng khai + 5 lượt trong `mauTrangThai.unit.test.ts`.
 * Đường vẽ thật (`trungThucDuLieu.trangThaiHienThi`) CHỈ rẽ nhánh ở `khong_ro`
 * (> 300 s). Hệ quả người dùng: **một máy im lặng 90 giây được vẽ GIỐNG HỆT một
 * máy vừa gửi tín hiệu** — đúng lớp lỗi NT-3 mà cả hai module sinh ra để chặn.
 *
 * ⚠⚠ **ĐỐI CHỨNG — VÌ SAO KHÔNG GỌI THẲNG `mauTheoTuoi` Ở ĐÂY.**
 *    `mauTrangThai.unit.test.ts:145-165` ĐÃ gọi thẳng và ĐÃ xanh suốt — trong
 *    khi sản phẩm không gọi hàm ấy một lần nào. Một ca gọi thẳng vẫn xanh KỂ CẢ
 *    KHI CHƯA NỐI, nên nó không có sức bác bỏ nào về việc "đã nối hay chưa".
 *    Vì vậy mọi ca dưới đây đo ở **ĐẦU RA CỦA CHỖ LẮP RÁP** (`dungMayVe` —
 *    nguồn DUY NHẤT của mảng `mau`/`doMo` mà `loi/LoBatchMay` nhận), và đi vào
 *    đó bằng ĐÚNG đường mà ba trang đi: `trangThaiHienThi` → hai bản đồ → `dungMayVe`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { mauChoTrangThai, type MucTuoi } from "../mauTrangThai";
import { trangThaiHienThi, type MayVanHanh } from "./trungThucDuLieu";
import { dungMayVe, type DatChoVaoCanh, type MayDaDung } from "./hopNhatCanh";

const T0 = 1_757_000_000_000;

const may = (o: Partial<MayVanHanh> = {}): MayVanHanh => ({
  id: 1,
  ma: "M-1",
  ten: "Máy 1",
  loaiMay: "AOI",
  trangThaiBaoCao: "running",
  thoiDiemDuLieu: T0,
  isActive: true,
  stationId: null,
  lineId: null,
  ...o,
});

const datCho = (): DatChoVaoCanh => ({
  hienThi: true,
  tangId: 1,
  viTriXMm: 1000,
  viTriYMm: 2000,
  viTriZMm: 3000,
  rongMm: null,
  caoMm: null,
  sauMm: null,
  quatX: 0,
  quatY: 0,
  quatZ: 0,
  quatW: 1,
});

/**
 * ★ ĐÚNG khuôn ba trang: `trangThaiHienThi` một lần cho MỖI máy, rút ra HAI bản
 *   đồ (trạng thái hiển thị + mức tươi), rồi đưa cả hai vào `dungMayVe`.
 *   Một bản sao thứ hai của luật tuổi ở đây sẽ làm ca mất khả năng bác bỏ.
 */
function veTheoDuongSanPham(ds: readonly MayVanHanh[], bayGio: number): MayDaDung[] {
  const trangThaiTheoMay = new Map<number, string>();
  const mucTuoiTheoMay = new Map<number, MucTuoi>();
  for (const mv of ds) {
    const tt = trangThaiHienThi(mv, bayGio);
    trangThaiTheoMay.set(mv.id, tt.trangThai);
    mucTuoiTheoMay.set(mv.id, tt.tuoi);
  }
  return dungMayVe({
    may: ds.map((m) => ({
      id: m.id,
      stationId: m.stationId,
      lineId: m.lineId,
      loaiMay: m.loaiMay,
      isActive: m.isActive,
    })),
    datChoTheoMay: new Map(ds.map((m) => [m.id, datCho()])),
    kichThuocTheoLoai: new Map(),
    trangThaiTheoMay,
    mucTuoiTheoMay,
    gocToaTheoTang: new Map(),
    trongPhamVi: () => true,
    mauNenCanh: "rgb(255, 255, 255)",
    tiLePhaNgoaiPhamVi: 0.72,
    congCu: {
      // Token đi thẳng ra `mau` — ca dưới so TOKEN, không so hex.
      mauCss: (token) => token,
      phaVeNen: (mau) => `PHA(${mau})`,
      mauChoTrangThai,
      hinhKhoiCho: () => "tram_chung",
    },
  });
}

describe("★★★ TUỔI DỮ LIỆU → ĐỘ MỜ, đo ở ĐẦU RA của chỗ lắp ráp (`dungMayVe`)", () => {
  it("★★★ máy im lặng 90 s ⇒ `doMo` < 1, và NHỎ HƠN máy tươi ĐÚNG hệ số 0,6", () => {
    const [cu] = veTheoDuongSanPham([may({ thoiDiemDuLieu: T0 - 90_000 })], T0);
    const [tuoi] = veTheoDuongSanPham([may({ thoiDiemDuLieu: T0 - 30_000 })], T0);

    expect(cu.doMo).toBeLessThan(1);
    expect(cu.doMo).toBeCloseTo(tuoi.doMo * 0.6, 10);
  });

  it("★ máy tươi (< 60 s) ⇒ `doMo` GIỮ NGUYÊN giá trị gốc của bảng màu", () => {
    const [m] = veTheoDuongSanPham([may({ thoiDiemDuLieu: T0 - 30_000 })], T0);
    expect(m.doMo).toBe(mauChoTrangThai("running").doMo);
    expect(m.mau).toBe(mauChoTrangThai("running").token);
  });

  it("★ HAI mốc biên: 59 999 ms vẫn tươi · 60 000 ms đã nhạt", () => {
    const [sat] = veTheoDuongSanPham([may({ thoiDiemDuLieu: T0 - 59_999 })], T0);
    const [qua] = veTheoDuongSanPham([may({ thoiDiemDuLieu: T0 - 60_000 })], T0);
    expect(sat.doMo).toBe(1);
    expect(qua.doMo).toBeCloseTo(0.6, 10);
  });

  it("★★★ HÀNH VI CŨ KHÔNG ĐỔI — quá 300 s vẫn là `khong_ro` (xám gạch chéo, KHÔNG nhạt thêm)", () => {
    const [m] = veTheoDuongSanPham([may({ thoiDiemDuLieu: T0 - 300_001 })], T0);
    expect(m.mau).toBe(mauChoTrangThai("khong_ro").token);
    // `khong_ro` KHÔNG được nhân 0,6 lần nữa: nó đã là kết luận cuối, không phải
    // một trạng thái "hơi cũ" nữa. Nhân tiếp là nói dối về mức độ.
    expect(m.doMo).toBe(mauChoTrangThai("khong_ro").doMo);
  });

  it("★★★ ĐỐI CHỨNG NGƯỢC — máy NGỪNG KHAI THÁC giữ `doMo` 0,35, KHÔNG bị luật tuổi nuốt", () => {
    /*
     * ⚠ Đây là cái bẫy của bản nối NGÂY THƠ. `mauTheoTuoi(tt, ts, bayGio)` cho
     * `khong_ro` THẮNG mọi trạng thái — đúng cho đầu vào THÔ, nhưng trên đường
     * sản phẩm `trangThaiHienThi` ĐÃ quyết `ngung_khai_thac` (ưu tiên 1) và trả
     * kèm `tuoi: "khong_ro"`. Áp lại luật ấy lần thứ hai ở tầng màu sẽ đổi
     * `doMo` 0,35 → 1 và mất luôn ý nghĩa "đã lùi khỏi tiền cảnh".
     */
    const [m] = veTheoDuongSanPham(
      [may({ isActive: false, thoiDiemDuLieu: T0 - 10 * 60_000 })],
      T0,
    );
    expect(m.mau).toBe(mauChoTrangThai("ngung_khai_thac").token);
    expect(m.doMo).toBeCloseTo(0.35, 10);
  });

  it("★ máy CHƯA TỪNG báo cáo (`thoiDiemDuLieu = null`) ⇒ `khong_ro`, doMo 1", () => {
    const [m] = veTheoDuongSanPham([may({ thoiDiemDuLieu: null })], T0);
    expect(m.mau).toBe(mauChoTrangThai("khong_ro").token);
    expect(m.doMo).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ G93 — KHỚP NỐI Ở TRANG: lưới module không biết trang gọi bằng đối số nào */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `hopNhatCanhNoiVaoTrang.unit.test.ts` đã trả giá để học điều này: ba đột biến
 * **ở chỗ gọi** sống sót cả 1.998 test. Bản đồ mức tuổi là một khớp nối MỚI ở
 * BA trang, nên nó phải được ghim ngay — một trang quên truyền là một màn vẽ
 * dữ liệu 90 giây tuổi y như dữ liệu tươi, và không cổng nào đỏ.
 */
const GOC = resolve(__dirname, "../../../..");
const TRANG = ["TwinVanHanh.tsx", "TwinLine.tsx", "TwinMay.tsx"] as const;

describe("★★★ BA TRANG cùng nối bản đồ MỨC TUỔI vào `dungMayVe`", () => {
  it.each(TRANG)("%s dựng `mucTuoiTheoMay` và TRUYỀN vào `dungMayVe`", (ten) => {
    const src = readFileSync(resolve(GOC, "src/pages", ten), "utf8");
    // ① bản THÔ dựng từ CÙNG `trangThaiHienThi` đã cho `trangThaiTheoMayTho` —
    //    hai luật tuổi trong một trang là cách chắc chắn để chúng lệch nhau.
    expect(src).toContain("const mucTuoiTheoMayTho = useMemo");
    expect(src).toContain("trangThaiHienThi(mv, bayGio).tuoi");
    // ② ổn định theo GIÁ TRỊ — `bayGio` đổi mỗi render, mảng máy KHÔNG được
    //    đổi tham chiếu theo từng giây (Đợt 38, `onDinhTheoGiaTri.ts`).
    expect(src).toContain(
      "const mucTuoiTheoMay = useOnDinhTheoGiaTri(mucTuoiTheoMayTho, khoaBanDo(mucTuoiTheoMayTho));",
    );
    // ③ và thật sự đi vào chỗ lắp ráp.
    expect(src).toMatch(/dungMayVe\(\{[\s\S]{0,1200}?mucTuoiTheoMay,/);
  });
});
