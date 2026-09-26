// @vitest-environment jsdom
/**
 * tuoiDuLieuBan2D.dom.test.tsx — **BẢN 2D PHẢI NÓI CÙNG MỘT CÂU VỚI BẢN 3D VỀ
 * TUỔI DỮ LIỆU.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TỆP NÀY TỒN TẠI — HAI BỀ MẶT, MỘT NHÀ MÁY, HAI CÂU KHÁC NHAU
 * ════════════════════════════════════════════════════════════════════════════
 * Commit `4482aaaaa` nối luật *"dữ liệu cũ 60–300 s ⇒ khối máy nhạt 40 %"* vào
 * đường vẽ **3D** (`van-hanh/hopNhatCanh.ts` `dungMayVe()` → `apDungMucTuoi`).
 * Bản **2D** (`CanhVanHanh2D.tsx`) KHÔNG đi qua `dungMayVe` cho phần màu: nó có
 * kênh `doMo` riêng, tự phân giải màu từ `mauChoTrangThai(tt)` ở `:177`. Nên sau
 * commit ấy, **cùng một máy im lặng 90 giây** được:
 *
 *   bản 3D  · `doMo` 0,6 — "dữ liệu này đã hơi cũ"
 *   bản 2D  · `fill-opacity` 1 — "bình thường"
 *
 * Và bản 2D KHÔNG phải một chế độ trang trí: `TwinVanHanh.tsx` đặt
 * `che2D = epChe2D || webglHong` với nút chuyển `disabled={webglHong}` — nó là
 * **đường DỰ PHÒNG khi WebGL hỏng**, tức đúng lúc người dùng không rời khỏi nó
 * được. Đó là lớp lỗi mà docblock `trungThucDuLieu.ts` sinh ra để chặn:
 * *"cả bảng DOM, dải cảnh báo và ô đếm cũng không thể nói khác cảnh 3D"*.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ ĐO Ở **ĐẦU RA CỦA CHỖ LẮP RÁP**, KHÔNG GỌI THẲNG `apDungMucTuoi`
 * ════════════════════════════════════════════════════════════════════════════
 * `mauTrangThai.unit.test.ts:145-165` đã gọi thẳng `mauTheoTuoi` và đã XANH
 * suốt nhiều đợt — trong khi mã sản phẩm gọi hàm ấy **0 lần**. Một ca gọi thẳng
 * vẫn xanh KỂ CẢ KHI CHƯA NỐI, nên nó không có sức bác bỏ nào về việc "đã nối
 * hay chưa". Vì vậy mọi ca dưới đây dựng **CHÍNH** `CanhVanHanh2D` và đọc
 * `fill-opacity` trên `<rect>` THẬT trong DOM — thứ mắt người nhìn thấy — và đi
 * vào đó bằng ĐÚNG đường mà trang đi: `trangThaiHienThi()` → hai bản đồ
 * (trạng thái + mức tươi) → component.
 *
 * ★ jsdom KHÔNG phân giải custom property, nên `giaiMauCanh()` trả `null` và mọi
 *   khối rơi về `#94a3b8`. Đó là lý do tệp này ghim `fill-opacity` (kênh tuổi)
 *   chứ không ghim màu — màu là việc của trình duyệt thật.
 */
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

/**
 * ★★★ CENSUS PHÂN GIẢI MÀU — bọc `giaiMauCanh` để ĐẾM, không để thay.
 *
 * Docblock `CanhVanHanh2D.tsx:172` khai chủ đích: *"phân giải màu MỘT LẦN cho
 * mỗi trạng thái xuất hiện, không mỗi máy — mỗi lượt `giaiMauCanh` gọi
 * `getComputedStyle`"*. Bản vá tuổi dữ liệu nhân đôi trục của bảng tra, nên nó
 * mở đúng khe cho một bản đồ **theo từng máy** len vào và biến 1 lượt reflow
 * thành 1.108 lượt. Phép đếm này là thứ bác bỏ được điều đó; nó đo CHÍNH cái
 * đắt tiền (`getComputedStyle`), không đo một con số tự khai.
 *
 * `vi.hoisted` là bắt buộc: nhà máy của `vi.mock` chạy trong PHA IMPORT, trước
 * mọi `const` của tệp này — tham chiếu thẳng một `const` thường sẽ nổ TDZ.
 */
const dem = vi.hoisted(() => ({ giaiMau: 0 }));
vi.mock("../mauTrangThai", async (importOriginal) => {
  const that = await importOriginal<typeof import("../mauTrangThai")>();
  return {
    ...that,
    giaiMauCanh: (...args: Parameters<typeof that.giaiMauCanh>) => {
      dem.giaiMau += 1;
      return that.giaiMauCanh(...args);
    },
  };
});

import { CanhVanHanh2D } from "./CanhVanHanh2D";
import { mauChoTrangThai, type MucTuoi } from "../mauTrangThai";
import { trangThaiHienThi, type MayVanHanh } from "./trungThucDuLieu";
import { dungMayVe, type DatChoVaoCanh, type MayDaDung } from "./hopNhatCanh";
import type { MayTrongLo } from "../loi";

afterEach(() => cleanup());
beforeEach(() => {
  dem.giaiMau = 0;
});

const T0 = 1_757_000_000_000;

/** Một phút / năm phút — viết bằng ms để ca đọc ra được ngưỡng đang thử. */
const PHUT = 60_000;

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

/**
 * ★ ĐÚNG khuôn trang: `trangThaiHienThi` chạy MỘT lần cho mỗi máy, rút ra HAI
 *   bản đồ song song rồi đưa cả hai xuống bề mặt. Một phép tính tuổi thứ hai ở
 *   đây sẽ làm ca mất khả năng bác bỏ (G12).
 */
function haiBanDo(ds: readonly MayVanHanh[], bayGio: number) {
  const trangThaiTheoMay = new Map<number, string>();
  const mucTuoiTheoMay = new Map<number, MucTuoi>();
  for (const mv of ds) {
    const tt = trangThaiHienThi(mv, bayGio);
    trangThaiTheoMay.set(mv.id, tt.trangThai);
    mucTuoiTheoMay.set(mv.id, tt.tuoi);
  }
  return { trangThaiTheoMay, mucTuoiTheoMay };
}

/** Khối máy cho bản 2D — hình học tối thiểu, tệp này không đo hình học. */
function khoiMay(ds: readonly MayVanHanh[]): MayTrongLo[] {
  return ds.map((mv, i) => ({
    machineId: mv.id,
    khoi: "hop" as MayTrongLo["khoi"],
    kichThuocMm: { rongMm: 2_000, sauMm: 1_500, caoMm: 2_200 },
    viTri: { x: 3 + i * 4, y: 0, z: 5 },
    gocXoayRad: 0,
    mau: "#22c55e",
  }));
}

/** Dựng CHÍNH `CanhVanHanh2D` mà `TwinVanHanh.tsx:4321` render. */
function ve2D(ds: readonly MayVanHanh[], bayGio: number) {
  const { trangThaiTheoMay, mucTuoiTheoMay } = haiBanDo(ds, bayGio);
  const r = render(
    <CanhVanHanh2D
      may={khoiMay(ds)}
      trangThaiTheoMay={trangThaiTheoMay}
      mucTuoiTheoMay={mucTuoiTheoMay}
      maTheoMay={new Map(ds.map((m) => [m.id, m.ma]))}
      machineIdChon={null}
      onChonMay={() => {}}
      sanRongM={40}
      sanSauM={30}
      nhanTrangThai={(tt) => tt}
      ariaLabel="cảnh 2D"
    />,
  );
  const oMay = (id: number) =>
    r.container.querySelector(`[data-testid='may-2d-${id}']`) as SVGGElement | null;
  return {
    r,
    oMay,
    /** `fill-opacity` của khối máy — kênh mà luật tuổi đi qua. */
    doMo: (id: number) => {
      const o = oMay(id);
      if (!o) throw new Error(`không thấy khối máy ${id} trên cảnh 2D`);
      const rect = o.querySelector("rect");
      if (!rect) throw new Error(`khối máy ${id} không có <rect>`);
      return Number(rect.getAttribute("fill-opacity"));
    },
    trangThai: (id: number) => oMay(id)?.getAttribute("data-trang-thai") ?? null,
    /** Lớp hoạ tiết gạch chéo (mã hoá dư thừa cho `khong_ro`, §10.3 luật 2). */
    coGachCheo: (id: number) =>
      [...(oMay(id)?.querySelectorAll("rect") ?? [])].some(
        (x) => x.getAttribute("fill") === "url(#twin-gach-cheo)",
      ),
  };
}

describe("★★★ TUỔI DỮ LIỆU → ĐỘ MỜ trên BẢN 2D, đo ở `<rect>` thật trong DOM", () => {
  it("★★★ máy im lặng 90 s ⇒ `fill-opacity` < 1, ĐÚNG hệ số 0,6 so với máy tươi cùng trạng thái", () => {
    const c = ve2D(
      [
        may({ id: 1, ma: "M-CU", thoiDiemDuLieu: T0 - 90_000 }),
        may({ id: 2, ma: "M-TUOI", thoiDiemDuLieu: T0 - 30_000 }),
      ],
      T0,
    );
    // Cùng một `trangThai` hiển thị — khác biệt DUY NHẤT là tuổi dữ liệu.
    expect(c.trangThai(1)).toBe(c.trangThai(2));
    expect(c.doMo(1)).toBeLessThan(1);
    expect(c.doMo(1)).toBeCloseTo(c.doMo(2) * 0.6, 10);
  });

  it("★ máy tươi (< 60 s) ⇒ `fill-opacity` GIỮ NGUYÊN giá trị bảng màu, không đổi gì", () => {
    const c = ve2D([may({ thoiDiemDuLieu: T0 - 30_000 })], T0);
    expect(c.doMo(1)).toBe(mauChoTrangThai("running").doMo);
  });

  it("★ HAI mốc biên: 59 999 ms vẫn tươi · 60 000 ms đã nhạt", () => {
    const sat = ve2D([may({ thoiDiemDuLieu: T0 - 59_999 })], T0);
    expect(sat.doMo(1)).toBe(1);
    cleanup();
    const qua = ve2D([may({ thoiDiemDuLieu: T0 - 60_000 })], T0);
    expect(qua.doMo(1)).toBeCloseTo(0.6, 10);
  });

  it("★★★ HÀNH VI CŨ KHÔNG ĐỔI — quá 300 s vẫn `khong_ro`: KHÔNG nhạt thêm, VẪN gạch chéo", () => {
    const c = ve2D([may({ thoiDiemDuLieu: T0 - 300_001 })], T0);
    expect(c.trangThai(1)).toBe("khong_ro");
    // `khong_ro` đã là KẾT LUẬN CUỐI, không phải "hơi cũ" nữa. Nhân tiếp 0,6 là
    // nói dối về mức độ — và sẽ làm bản 2D lệch khỏi bản 3D theo chiều ngược lại.
    expect(c.doMo(1)).toBe(mauChoTrangThai("khong_ro").doMo);
    expect(c.coGachCheo(1)).toBe(true);
  });

  it("★★★ ĐỐI CHỨNG NGƯỢC — máy NGỪNG KHAI THÁC giữ `fill-opacity` 0,35, không bị luật tuổi nuốt", () => {
    /*
     * ⚠ Cái bẫy của bản nối NGÂY THƠ (`mauTheoTuoi` 3 đối số): `khong_ro` THẮNG
     * mọi trạng thái — đúng cho đầu vào THÔ, nhưng trên đường sản phẩm
     * `trangThaiHienThi` ĐÃ quyết `ngung_khai_thac` (ưu tiên 1) và trả kèm
     * `tuoi: "khong_ro"`. Áp lại luật ấy lần thứ hai ở tầng màu sẽ đẩy `doMo`
     * 0,35 → 1 và xoá luôn ý nghĩa "đã lùi khỏi tiền cảnh".
     */
    const c = ve2D([may({ isActive: false, thoiDiemDuLieu: T0 - 10 * PHUT })], T0);
    expect(c.trangThai(1)).toBe("ngung_khai_thac");
    expect(c.doMo(1)).toBeCloseTo(0.35, 10);
  });

  it("★ máy CHƯA TỪNG báo cáo (`thoiDiemDuLieu = null`) ⇒ `khong_ro`, doMo 1 — y như bản 3D", () => {
    const c = ve2D([may({ thoiDiemDuLieu: null })], T0);
    expect(c.trangThai(1)).toBe("khong_ro");
    expect(c.doMo(1)).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ BẤT BIẾN LIÊN BỀ MẶT — 2D và 3D nói CÙNG một câu về CÙNG một máy        */
/* ═══════════════════════════════════════════════════════════════════════════ */

const datCho = (): DatChoVaoCanh => ({
  hienThi: true,
  tangId: 1,
  viTriXMm: 1_000,
  viTriYMm: 2_000,
  viTriZMm: 3_000,
  rongMm: null,
  caoMm: null,
  sauMm: null,
  quatX: 0,
  quatY: 0,
  quatZ: 0,
  quatW: 1,
});

/** Đường vẽ 3D — `dungMayVe()`, nguồn DUY NHẤT của `doMo` mà `LoBatchMay` nhận. */
function ve3D(ds: readonly MayVanHanh[], bayGio: number): MayDaDung[] {
  const { trangThaiTheoMay, mucTuoiTheoMay } = haiBanDo(ds, bayGio);
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
      mauCss: (token) => token,
      phaVeNen: (mau) => `PHA(${mau})`,
      mauChoTrangThai,
      hinhKhoiCho: () => "tram_chung",
    },
  });
}

describe("★★★ HAI BỀ MẶT KHÔNG ĐƯỢC NÓI KHÁC NHAU VỀ CÙNG MỘT MÁY", () => {
  /**
   * Năm máy phủ cả năm nhánh của `trangThaiHienThi` mà luật tuổi chạm tới. Đây
   * là ca bác bỏ TRỰC TIẾP câu hỏi của chủ dự án: *"nếu 3D nói máy này dữ liệu
   * cũ mà 2D nói bình thường"*.
   */
  const NAM_MAY: readonly MayVanHanh[] = [
    may({ id: 1, ma: "M-1", thoiDiemDuLieu: T0 - 10_000 }), // tươi
    may({ id: 2, ma: "M-2", thoiDiemDuLieu: T0 - 90_000 }), // cũ (60–300 s)
    may({ id: 3, ma: "M-3", thoiDiemDuLieu: T0 - 10 * PHUT }), // không rõ
    may({ id: 4, ma: "M-4", isActive: false, thoiDiemDuLieu: T0 - 10 * PHUT }), // ngừng khai thác
    may({ id: 5, ma: "M-5", trangThaiBaoCao: "blocked", thoiDiemDuLieu: T0 - 120_000 }), // cũ, trạng thái khác
  ];

  it("★★★ `fill-opacity` của bản 2D KHỚP `doMo` của `dungMayVe` trên CẢ NĂM máy", () => {
    const ba = ve3D(NAM_MAY, T0);
    const c = ve2D(NAM_MAY, T0);
    for (const m of ba) {
      expect(c.doMo(m.machineId), `máy ${m.machineId}`).toBeCloseTo(m.doMo ?? 1, 10);
    }
  });

  it("★ dữ kiện nền — bộ mẫu THẬT SỰ có máy nhạt và máy không nhạt (phép đo biết KÊU)", () => {
    const ba = ve3D(NAM_MAY, T0);
    expect(ba).toHaveLength(5);
    expect(ba.filter((m) => (m.doMo ?? 1) < 1).length).toBeGreaterThanOrEqual(3);
    expect(ba.filter((m) => (m.doMo ?? 1) === 1).length).toBeGreaterThanOrEqual(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ BẢNG TRA THEO **TỔ HỢP**, KHÔNG THEO MÁY                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ bảng màu phân giải MỘT LẦN cho mỗi TỔ HỢP (trạng thái × mức tuổi)", () => {
  /** 12 máy tươi + 12 máy cũ, CÙNG một trạng thái báo cáo ⇒ đúng HAI tổ hợp. */
  const HAI_TO_HOP: readonly MayVanHanh[] = [
    ...Array.from({ length: 12 }, (_, i) =>
      may({ id: i + 1, ma: `T-${i + 1}`, thoiDiemDuLieu: T0 - 10_000 }),
    ),
    ...Array.from({ length: 12 }, (_, i) =>
      may({ id: 100 + i, ma: `C-${i}`, thoiDiemDuLieu: T0 - 90_000 }),
    ),
  ];

  it("★★★ 24 máy · 2 tổ hợp ⇒ `giaiMauCanh` (tức `getComputedStyle`) chạy ĐÚNG 2 lượt", () => {
    const c = ve2D(HAI_TO_HOP, T0);
    // Phép đo phải KÊU: hai nhóm thật sự khác nhau trên màn.
    expect(c.doMo(1)).toBe(1);
    expect(c.doMo(100)).toBeCloseTo(0.6, 10);
    // …và bảng tra KHÔNG phình theo số máy.
    expect(dem.giaiMau).toBe(2);
  });

  it("★ thêm MỘT tổ hợp thứ ba ⇒ đúng 3 lượt (phép đếm biết GẬT, không chỉ biết KÊU)", () => {
    const c = ve2D(
      [...HAI_TO_HOP, may({ id: 900, ma: "K-1", thoiDiemDuLieu: T0 - 10 * PHUT })],
      T0,
    );
    expect(c.trangThai(900)).toBe("khong_ro");
    expect(dem.giaiMau).toBe(3);
  });

  it("★★★ ĐỐI CHỨNG — 24 máy CÙNG một tổ hợp vẫn chỉ 1 lượt (không phải đếm theo máy)", () => {
    ve2D(
      Array.from({ length: 24 }, (_, i) =>
        may({ id: i + 1, ma: `X-${i}`, thoiDiemDuLieu: T0 - 10_000 }),
      ),
      T0,
    );
    expect(dem.giaiMau).toBe(1);
  });
});
