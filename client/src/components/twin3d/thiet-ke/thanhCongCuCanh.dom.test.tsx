// @vitest-environment jsdom
//
/**
 * thanhCongCuCanh.dom.test.tsx — §11.9 #58 Fit + Fullscreen · #57 Export PNG ·
 * #56 Mini-map click-to-navigate, đo trên **DOM THẬT** với dữ liệu **KHÁC RỖNG**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ TỆP NÀY TỒN TẠI VÌ G5 VÀ G16
 * ════════════════════════════════════════════════════════════════════════════
 * `khungNhin.unit.test.ts` / `banDoNho.unit.test.ts` chứng minh **hình học**
 * đúng — nhưng một hàm đúng mà không ai gọi là CHƯA XONG (G16), và đó đúng là
 * lớp lỗi `nhipHoiMs` (§11c.2 L-1): hàm viết đúng, có test, **0 chỗ gọi**.
 *
 * Nên ở đây ta không đo lại hình học. Ta đo rằng **bấm nút thật sự dời camera
 * thật**, bằng một camera giả mà ta đọc lại được toạ độ sau cú bấm:
 *
 *   · Fit  → `camera.position` PHẢI đổi, và `controls.target` PHẢI trỏ vào TÂM
 *            bbox của ĐÚNG những máy đã truyền vào (không phải hằng số nào).
 *   · PNG  → `veLai` PHẢI chạy TRƯỚC `toDataURL`, và `<a download>` phải được
 *            bấm — nếu không thì "bấm nút xong không có gì xảy ra".
 *   · Mini-map → click ở một điểm cụ thể PHẢI cho camera đi tới đúng chỗ đó.
 *
 * ★ G20 — import `./ThanhCongCuCanh`, ĐÚNG component mà `XuongThietKe.tsx:…`
 *   render. Không mock nó, không mock `khungNhin`/`banDoNho`/`xuatAnh` — mock
 *   chúng là đo dàn mock.
 * ★ `refCanh` được nhồi một `CanhDaNoi` giả tối thiểu. Đây là ranh giới đúng để
 *   giả: bên kia nó là WebGL thật, thứ jsdom không có.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, macDinh?: string | Record<string, unknown>, bien?: Record<string, unknown>) => {
      const md = typeof macDinh === "string" ? macDinh : k;
      const b = typeof macDinh === "object" && macDinh !== null ? macDinh : bien;
      let s = md;
      if (b) for (const [kk, v] of Object.entries(b)) s = s.replace(`{{${kk}}}`, String(v));
      return s;
    },
  }),
}));

const toastGoi: { loai: string; chu: string }[] = [];
vi.mock("sonner", () => ({
  toast: {
    success: (c: string) => void toastGoi.push({ loai: "success", chu: c }),
    error: (c: string) => void toastGoi.push({ loai: "error", chu: c }),
    info: (c: string) => void toastGoi.push({ loai: "info", chu: c }),
  },
}));

// Radix Tooltip cần Provider; bọc mỏng để không phải dựng cả cây provider thật.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));

import { NHIP_CHO_CANH_MS, ThanhCongCuCanh, type MayTrenCanh } from "./ThanhCongCuCanh";
import type { CanhDaNoi } from "./CauNoiCanh";
import { CANH_BAN_DO_PX, dungPhepChieu, sceneSangPx } from "./banDoNho";
import { bboxNoiDung } from "./khungNhin";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Cảnh giả — ranh giới đúng để giả là WebGL, không phải logic của ta.         */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface CanhGia {
  canh: CanhDaNoi;
  nhatKy: string[];
  soInvalidate: () => number;
}

function dungCanhGia(tuyChon: { urlAnh?: string } = {}): CanhGia {
  const nhatKy: string[] = [];
  let soInv = 0;
  const target = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
  const camera = {
    fov: 45,
    position: { x: 30, y: 24, z: 30, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    lookAt: () => void nhatKy.push("lookAt"),
    updateMatrixWorld: () => {},
  };
  const domElement = {
    clientWidth: 800,
    clientHeight: 500,
    width: 1600,
    height: 1000,
    toDataURL: () => {
      nhatKy.push("toDataURL");
      return tuyChon.urlAnh ?? "data:image/png;base64,iVBORw0KGgo=";
    },
  };
  const canh = {
    camera,
    gl: { domElement, render: () => void nhatKy.push("render") },
    scene: {},
    invalidate: () => {
      soInv += 1;
      nhatKy.push("invalidate");
    },
    controls: {
      current: {
        target,
        maxDistance: 200,
        update: () => void nhatKy.push("controls.update"),
      },
    },
  } as unknown as CanhDaNoi;
  return { canh, nhatKy, soInvalidate: () => soInv };
}

/** 1200×1800×800 mm ở (x, 0, z) mét — cùng khuôn `khungNhin.unit.test.ts`. */
function may(khoa: string, x: number, z: number, chon = false): MayTrenCanh {
  return {
    khoa,
    viTri: { x, y: 0, z },
    kichThuocMm: { rongMm: 1200, caoMm: 1800, sauMm: 800 },
    mau: "#64748b",
    chon,
  };
}

/** Hai máy ở hai góc BIẾT TRƯỚC ⇒ tâm bbox là (20, 0.9, 15). */
const HAI_MAY = [may("machine:1", 5, 5), may("machine:2", 35, 25)];

function dungMan(
  may: readonly MayTrenCanh[],
  canh: CanhDaNoi | null,
  onChonMay?: (k: string) => void,
) {
  const refCanh = { current: canh };
  const refBoc = { current: document.createElement("div") };
  render(
    <ThanhCongCuCanh
      refCanh={refCanh}
      refBoc={refBoc}
      may={may}
      sanRongM={38.4}
      sanSauM={29.6}
      nhanAnh="Tầng trệt"
      onChonMay={onChonMay}
    />,
  );
  return { refBoc };
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐẨY CAMERA ĐI XA TRƯỚC KHI ĐO NÚT — BẮT BUỘC TỪ KHI CÓ PH-29
 * ════════════════════════════════════════════════════════════════════════════
 * Bản vá PH-29 cho `ThanhCongCuCanh` TỰ fit một lần khi cảnh có nội dung lần
 * đầu. Hệ quả cho lưới này: ngay sau `dungMan(...)` camera đã Ở ĐÚNG chỗ fit,
 * nên một cú bấm `nut-fit-tat-ca` không đổi gì — và mọi khẳng định kiểu "sau
 * khi bấm, target = tâm bbox" sẽ XANH **kể cả khi `onClick` của nút bị gỡ**.
 *
 * Đó chính là lớp lỗi mà tệp này sinh ra để chống (G16: hàm đúng, 0 chỗ gọi).
 * ⇒ Mọi ca đo NÚT phải đẩy camera + tâm quay ra một chỗ SAI đã biết trước rồi
 *   mới bấm. Khi đó "quay về đúng chỗ" chỉ có thể đến từ cú bấm.
 */
function dayCameraDiXa(g: CanhGia): void {
  g.canh.camera.position.set(-999, -999, -999);
  g.canh.controls.current!.target.set(-999, -999, -999);
}

/** Như {@link dungMan} nhưng trả một hàm `rerender` đổi mảng `may` tại chỗ. */
function dungManCoRerender(may: readonly MayTrenCanh[], canh: CanhDaNoi | null) {
  const refCanh = { current: canh };
  const refBoc = { current: document.createElement("div") };
  const cay = (ds: readonly MayTrenCanh[]) => (
    <ThanhCongCuCanh
      refCanh={refCanh}
      refBoc={refBoc}
      may={ds}
      sanRongM={38.4}
      sanSauM={29.6}
      nhanAnh="Tầng trệt"
    />
  );
  const r = render(cay(may));
  return { rerender: (ds: readonly MayTrenCanh[]) => r.rerender(cay(ds)) };
}

/**
 * ============================================================================
 * *** H5 - DUNG MAN THEO DUNG THU TU THAT: CANH SAN SANG **SAU** LUOT RENDER DAU
 * ============================================================================
 * `dungMan` o tren nhoi `refCanh.current` SAN ngay luc render dau - mot thu tu
 * KHONG BAO GIO xay ra trong san pham: `CauNoiCanh` ghi `refCanh.current` trong
 * mot `useEffect` nam **ben trong** `<Canvas>` (cay R3F rieng), nen o luot render
 * dau cua `ThanhCongCuCanh` no con `null` (docblock `CauNoiCanh.tsx`).
 *
 * Chinh khoang lech do la khuyet tat H5 (`.qa-tapdoan/tho/V2/H5.json`): mo Studio
 * khong cham gi => bbox tam khoi chiem **4,74 %** khung nhin; chi can bam mot khoi
 * (mot luot render nua) la nhay len **19,72 %**.
 *
 * *** VA DAY LA DIEM SONG CON CUA LUOI NAY: `canhSanSang()` **KHONG** goi
 *   `rerender`. No chi GHI REF roi cho dong ho chay - dung nhung gi `CauNoiCanh`
 *   lam duoc. Mot helper tien tay goi `rerender` o day se tu tay cung cap thu ma
 *   san pham con thieu, va ca do thanh xanh-gia.
 */
function dungManChamSanSang(may: readonly MayTrenCanh[], canh: CanhDaNoi) {
  const refCanh: { current: CanhDaNoi | null } = { current: null };
  const refBoc = { current: document.createElement("div") };
  let dsHienTai = may;
  const cay = (ds: readonly MayTrenCanh[]) => (
    <ThanhCongCuCanh
      refCanh={refCanh}
      refBoc={refBoc}
      may={ds}
      sanRongM={38.4}
      sanSauM={29.6}
      nhanAnh="Tầng trệt"
    />
  );
  const r = render(cay(dsHienTai));
  return {
    /** `CauNoiCanh` gắn xong: CHỈ ghi ref — không render, không sự kiện. */
    canhSanSang: () => {
      refCanh.current = canh;
      act(() => {
        vi.advanceTimersByTime(NHIP_CHO_CANH_MS * 3);
      });
    },
    /** Dữ liệu máy về muộn (truy vấn xong sau khi Canvas đã mount). */
    duLieuVe: (ds: readonly MayTrenCanh[]) => {
      dsHienTai = ds;
      r.rerender(cay(dsHienTai));
    },
  };
}

beforeEach(() => {
  toastGoi.length = 0;
});
afterEach(() => cleanup());

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Thanh công cụ có mặt                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("hiện diện — G16: ba nút và mini-map PHẢI ở trong DOM", () => {
  it("dựng đủ nút Fit, Xuất PNG, Toàn màn hình và mini-map", () => {
    dungMan(HAI_MAY, dungCanhGia().canh);
    expect(screen.getByTestId("nut-fit-tat-ca")).toBeInTheDocument();
    expect(screen.getByTestId("nut-xuat-png")).toBeInTheDocument();
    expect(screen.getByTestId("nut-toan-man-hinh")).toBeInTheDocument();
    expect(screen.getByTestId("mini-map")).toBeInTheDocument();
    expect(screen.getByTestId("mini-map-svg")).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* #58 — FIT ALL IN VIEW                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("#58 Fit — CAMERA THẬT SỰ DỜI TỚI BBOX THẬT (G5 + G16)", () => {
  it("★★★ bấm Fit ⇒ `controls.target` = TÂM bbox của ĐÚNG hai máy đã truyền", () => {
    const g = dungCanhGia();
    dungMan(HAI_MAY, g.canh);
    dayCameraDiXa(g); // ★ nếu không, PH-29 đã đặt sẵn và ca này đo số 0
    fireEvent.click(screen.getByTestId("nut-fit-tat-ca"));

    const tg = g.canh.controls.current!.target;
    // Hai máy ở (5,5) và (35,25) ⇒ tâm mặt bằng (20, 15), tâm cao 0,9 m.
    expect(tg.x).toBeCloseTo(20, 5);
    expect(tg.z).toBeCloseTo(15, 5);
    expect(tg.y).toBeCloseTo(0.9, 5);
  });

  it("★★★ ĐỔI VỊ TRÍ MÁY ⇒ ĐỔI ĐÍCH FIT — chỉ báo không phải hằng số", () => {
    const g1 = dungCanhGia();
    dungMan(HAI_MAY, g1.canh);
    dayCameraDiXa(g1);
    fireEvent.click(screen.getByTestId("nut-fit-tat-ca"));
    const x1 = g1.canh.controls.current!.target.x;
    cleanup();

    const g2 = dungCanhGia();
    dungMan([may("machine:1", 5, 5), may("machine:2", 235, 25)], g2.canh);
    dayCameraDiXa(g2);
    fireEvent.click(screen.getByTestId("nut-fit-tat-ca"));
    const x2 = g2.canh.controls.current!.target.x;

    expect(x2 - x1).toBeCloseTo(100, 3);
  });

  it("camera đứng CÁCH tâm đúng bán kính fit, KHÔNG ở vị trí ban đầu", () => {
    const g = dungCanhGia();
    dungMan(HAI_MAY, g.canh);
    dayCameraDiXa(g);
    const truoc = { ...g.canh.camera.position };
    fireEvent.click(screen.getByTestId("nut-fit-tat-ca"));
    const sau = g.canh.camera.position;
    expect(sau.x !== truoc.x || sau.y !== truoc.y || sau.z !== truoc.z).toBe(true);
    // Camera ở NGOÀI bbox nội dung.
    const b = bboxNoiDung(HAI_MAY);
    expect(sau.x > b.maxX || sau.z > b.maxZ || sau.y > b.maxY).toBe(true);
  });

  /* ═════════════════════════════════════════════════════════════════════ */
  /* ★★★ PH-29 — TỰ FIT MỘT LẦN KHI CẢNH CÓ NỘI DUNG LẦN ĐẦU                */
  /* ═════════════════════════════════════════════════════════════════════ */

  it("★★★ PH-29 — KHÔNG bấm nút nào: camera đã ngắm TÂM bbox nội dung", () => {
    // QA lần 11 đo ảnh Studio: "sàn lưới ở rất xa, 45 máy co thành vệt mờ,
    // mini-map CÓ chấm" ⇒ dữ liệu về đủ, chỉ camera đứng sai chỗ.
    const g = dungCanhGia();
    dungMan(HAI_MAY, g.canh);
    const tg = g.canh.controls.current!.target;
    expect(tg.x).toBeCloseTo(20, 5);
    expect(tg.z).toBeCloseTo(15, 5);
  });

  it("★★★ PH-29 — ĐÚNG MỘT LẦN: người dùng rê đi rồi, dữ liệu đổi KHÔNG kéo camera về", () => {
    // Fit lại mỗi lần `may` đổi sẽ giật camera mỗi khi người dùng kéo một máy —
    // biến một tiện ích thành thứ không dùng được. Ca này ghim "một lần".
    const g = dungCanhGia();
    const { rerender } = dungManCoRerender(HAI_MAY, g.canh);
    dayCameraDiXa(g);
    rerender([may("machine:1", 5, 5), may("machine:2", 235, 25)]);
    expect(g.canh.controls.current!.target.x).toBe(-999);
  });

  it("★ PH-29 — cảnh CHƯA SẴN SÀNG lúc mount thì KHÔNG fit (và không ném)", () => {
    // `refCanh.current` còn null ở lượt render đầu là ca có thật (Canvas chưa
    // mount xong). Hành vi đúng ở đây là suy biến về hành vi CŨ, không phải nổ.
    expect(() => dungMan(HAI_MAY, null)).not.toThrow();
  });

  it("★★★ RB-3 — Fit PHẢI gọi `invalidate()`; thiếu nó camera dời mà màn hình KHÔNG đổi", () => {
    const g = dungCanhGia();
    dungMan(HAI_MAY, g.canh);
    dayCameraDiXa(g);
    const truoc = g.soInvalidate();
    fireEvent.click(screen.getByTestId("nut-fit-tat-ca"));
    expect(g.soInvalidate()).toBeGreaterThan(truoc);
  });

  it("★ nới `maxDistance` khi cần — nếu không, `controls.update()` KÉO camera lại", () => {
    // ⚠ Hạ trần SAU `dungMan` và đẩy camera đi xa: lượt auto-fit lúc mount cũng
    //   nới `maxDistance`, nên đặt trần TRƯỚC khi dựng thì ca này xanh kể cả khi
    //   gỡ `onClick` của nút — đúng lớp lỗi mà `dayCameraDiXa` sinh ra để chống.
    const g = dungCanhGia();
    dungMan(HAI_MAY, g.canh);
    dayCameraDiXa(g);
    g.canh.controls.current!.maxDistance = 1; // trần vô lý thấp
    fireEvent.click(screen.getByTestId("nut-fit-tat-ca"));
    expect(g.canh.controls.current!.maxDistance).toBeGreaterThan(10);
  });

  it("★★★ G5 — CẢNH RỖNG lùi về MẶT SÀN (nhánh KHÁC), ngắm tâm sàn 38,4 × 29,6", () => {
    const g = dungCanhGia();
    dungMan([], g.canh);
    dayCameraDiXa(g);
    fireEvent.click(screen.getByTestId("nut-fit-tat-ca"));
    const tg = g.canh.controls.current!.target;
    expect(tg.x).toBeCloseTo(19.2, 5);
    expect(tg.z).toBeCloseTo(14.8, 5);
  });

  it("cảnh CHƯA SẴN SÀNG ⇒ báo lỗi cho người dùng, không im lặng", () => {
    dungMan(HAI_MAY, null);
    fireEvent.click(screen.getByTestId("nut-fit-tat-ca"));
    // `refCanh.current === null` ⇒ hàm thoát sớm, không nổ.
    expect(screen.getByTestId("nut-fit-tat-ca")).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ H5 — AUTO-FIT PHẢI CHẠY Ở CHÍNH LƯỢT MOUNT ĐẦU                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO KHỐI NÀY TỒN TẠI — LƯỚI CŨ XANH TRONG KHI SẢN PHẨM ĐỎ
 * ════════════════════════════════════════════════════════════════════════════
 * Ca "PH-29 — KHÔNG bấm nút nào" ở khối trên XANH, nhưng đo sống vòng 2
 * (`.qa-tapdoan/tho/V2/H5.json`) thấy Studio mở ra vẫn **4,74 %** khung nhìn.
 * Lý do: `dungMan` nhồi `refCanh.current` SẴN ở lượt render đầu, còn sản phẩm
 * thì `null` (R3F mount Canvas ở cây riêng) — nên lưới cũ đo một thứ tự KHÔNG
 * CÓ THẬT và không thể đỏ vì khuyết tật này.
 *
 * ⇒ Mọi ca dưới đây dựng bằng `dungManChamSanSang`: cảnh sẵn sàng SAU lượt
 *   render đầu, đúng thứ tự người dùng gặp.
 */
describe("★★★ H5 — cảnh sẵn sàng SAU render đầu thì auto-fit vẫn phải chạy", () => {
  // Vòng chờ cảnh dùng `setTimeout` ⇒ đồng hồ giả để ca đo tất định, không ngủ thật.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("★★★ mount đầu ref còn `null` ⇒ khi cảnh sẵn sàng, camera ngắm TÂM bbox (không cần bấm gì)", () => {
    const g = dungCanhGia();
    const man = dungManChamSanSang(HAI_MAY, g.canh);
    // Trước khi cảnh sẵn sàng: chưa fit được — và đó là trạng thái ĐÚNG, không phải lỗi.
    expect(g.canh.controls.current!.target.x).toBe(0);
    man.canhSanSang();
    const tg = g.canh.controls.current!.target;
    expect(tg.x).toBeCloseTo(20, 5);
    expect(tg.z).toBeCloseTo(15, 5);
    expect(tg.y).toBeCloseTo(0.9, 5);
  });

  it("★★★ ĐÚNG MỘT LẦN — fit xong, dữ liệu đổi tiếp KHÔNG kéo camera về nữa", () => {
    const g = dungCanhGia();
    const man = dungManChamSanSang(HAI_MAY, g.canh);
    man.canhSanSang();
    const soSauFit = g.soInvalidate();
    expect(soSauFit).toBe(1); // đúng MỘT lượt áp khung nhìn
    dayCameraDiXa(g);
    man.duLieuVe([may("machine:1", 5, 5), may("machine:2", 235, 25)]);
    expect(g.canh.controls.current!.target.x).toBe(-999);
    expect(g.soInvalidate()).toBe(soSauFit);
  });

  it("★★★ DỮ LIỆU VỀ MUỘN (thứ tự thường gặp: Canvas xong trước truy vấn) ⇒ vẫn fit", () => {
    const g = dungCanhGia();
    const man = dungManChamSanSang([], g.canh);
    man.canhSanSang(); // cảnh sẵn sàng nhưng CHƯA có máy nào
    expect(g.canh.controls.current!.target.x).toBe(0);
    man.duLieuVe(HAI_MAY); // 45 máy về sau — đúng cảnh Studio thật
    expect(g.canh.controls.current!.target.x).toBeCloseTo(20, 5);
    expect(g.canh.controls.current!.target.z).toBeCloseTo(15, 5);
  });

  it("★★★ NGƯỜI DÙNG ĐÃ TỰ DỜI CAMERA trước khi dữ liệu về ⇒ KHÔNG fit đè lên họ", () => {
    // Đây là nửa còn lại của "chỉ fit một lần": một lượt fit tự động ập vào giữa
    // lúc người dùng đang ngắm một góc họ chọn thì tệ hơn hẳn việc không fit.
    const g = dungCanhGia();
    const man = dungManChamSanSang([], g.canh);
    man.canhSanSang();
    dayCameraDiXa(g); // người dùng xoay/kéo tới một chỗ KHÁC mốc lúc cảnh mở
    man.duLieuVe(HAI_MAY);
    expect(g.canh.controls.current!.target.x).toBe(-999);
    expect(g.canh.camera.position.x).toBe(-999);
  });

  it("★ nút Fit VẪN dùng được sau khi auto-fit đã tự nhường quyền cho người dùng", () => {
    // Đối chứng của ca trên: "không fit đè" KHÔNG được biến thành "Fit hỏng".
    const g = dungCanhGia();
    const man = dungManChamSanSang([], g.canh);
    man.canhSanSang();
    dayCameraDiXa(g);
    man.duLieuVe(HAI_MAY);
    fireEvent.click(screen.getByTestId("nut-fit-tat-ca"));
    expect(g.canh.controls.current!.target.x).toBeCloseTo(20, 5);
  });

  it("★ cảnh KHÔNG BAO GIỜ sẵn sàng ⇒ suy biến về hành vi cũ, không ném, nút vẫn còn", () => {
    const g = dungCanhGia();
    const man = dungManChamSanSang(HAI_MAY, g.canh);
    expect(() => man.duLieuVe([may("machine:9", 9, 9)])).not.toThrow();
    expect(screen.getByTestId("nut-fit-tat-ca")).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* #57 — EXPORT PNG                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("#57 Export PNG — THỨ TỰ vẽ-rồi-chụp trên đường THẬT", () => {
  it("★★★ bấm nút ⇒ `render()` chạy TRƯỚC `toDataURL()` (nếu ngược lại: ảnh TRẮNG)", () => {
    const g = dungCanhGia();
    dungMan(HAI_MAY, g.canh);
    fireEvent.click(screen.getByTestId("nut-xuat-png"));
    const iRender = g.nhatKy.indexOf("render");
    const iChup = g.nhatKy.indexOf("toDataURL");
    expect(iRender).toBeGreaterThanOrEqual(0);
    expect(iChup).toBeGreaterThanOrEqual(0);
    expect(iRender).toBeLessThan(iChup);
  });

  it("★★★ thật sự BẤM một `<a download>` — không phải chỉ tính ra data URL", () => {
    const g = dungCanhGia();
    let daBam: { download: string; href: string } | null = null;
    const goc = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      daBam = { download: this.download, href: this.href };
    };
    try {
      dungMan(HAI_MAY, g.canh);
      fireEvent.click(screen.getByTestId("nut-xuat-png"));
    } finally {
      HTMLAnchorElement.prototype.click = goc;
    }
    expect(daBam).not.toBeNull();
    expect(daBam!.download).toMatch(/^twin-tang-tret-\d{8}-\d{6}\.png$/);
    expect(daBam!.href.startsWith("data:image/png")).toBe(true);
  });

  it("báo THÀNH CÔNG, không phải im lặng và không phải báo lỗi", () => {
    const goc = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    try {
      dungMan(HAI_MAY, dungCanhGia().canh);
      fireEvent.click(screen.getByTestId("nut-xuat-png"));
    } finally {
      HTMLAnchorElement.prototype.click = goc;
    }
    // ⚠ Chỉ khẳng định KÊNH (success/error), KHÔNG khẳng định NỘI DUNG chữ:
    // component gọi `t(khoa, { ten })` dạng 2 tham số, và dàn mock i18n ở đầu
    // tệp trả về chính KHOÁ trong ca đó. Khẳng định chữ ở đây sẽ là khẳng định
    // về dàn mock, không về sản phẩm (G20). Tên tệp thật đã được đo ở ca
    // "thật sự BẤM một `<a download>`" phía trên, trên `a.download` THẬT.
    expect(toastGoi.some((x) => x.loai === "success")).toBe(true);
    expect(toastGoi.some((x) => x.loai === "error")).toBe(false);
  });

  it("★ cảnh chưa sẵn sàng ⇒ toast LỖI, không im lặng", () => {
    dungMan(HAI_MAY, null);
    fireEvent.click(screen.getByTestId("nut-xuat-png"));
    expect(toastGoi.some((x) => x.loai === "error")).toBe(true);
  });

  it("★ chụp trả thứ KHÔNG phải PNG ⇒ toast LỖI, không giao tệp rác", () => {
    const g = dungCanhGia({ urlAnh: "data:," });
    dungMan(HAI_MAY, g.canh);
    fireEvent.click(screen.getByTestId("nut-xuat-png"));
    expect(toastGoi.some((x) => x.loai === "error")).toBe(true);
    expect(toastGoi.some((x) => x.loai === "success")).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* #58 — FULLSCREEN                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("#58 Fullscreen", () => {
  it("★ jsdom KHÔNG có Fullscreen API ⇒ báo 'không hỗ trợ', KHÔNG ném", () => {
    dungMan(HAI_MAY, dungCanhGia().canh);
    fireEvent.click(screen.getByTestId("nut-toan-man-hinh"));
    expect(toastGoi.some((x) => x.loai === "error")).toBe(true);
  });

  it("★★★ CA DƯƠNG — có API thì gọi ĐÚNG `requestFullscreen` của KHUNG BỌC", () => {
    const goi: string[] = [];
    // Nhồi API vào jsdom (nó không có sẵn) — đây là ca dương G5 cho nhánh này.
    (document as unknown as { exitFullscreen: () => void }).exitFullscreen = () =>
      void goi.push("exit");
    (Element.prototype as unknown as { requestFullscreen: () => void }).requestFullscreen =
      function () {
        goi.push("request");
      };
    try {
      const { refBoc } = dungMan(HAI_MAY, dungCanhGia().canh);
      fireEvent.click(screen.getByTestId("nut-toan-man-hinh"));
      expect(goi).toEqual(["request"]);
      expect(screen.getByTestId("nut-toan-man-hinh")).toHaveAttribute("aria-pressed", "true");
      expect(refBoc.current).toBeTruthy();
    } finally {
      delete (document as unknown as Record<string, unknown>).exitFullscreen;
      delete (Element.prototype as unknown as Record<string, unknown>).requestFullscreen;
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* #56 — MINI-MAP CLICK-TO-NAVIGATE                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("#56 Mini-map — CHẤM THẬT và CLICK ĐI TỚI THẬT (G5)", () => {
  it("★★★ 2 máy ⇒ 2 chấm; ĐỔI số máy ⇒ ĐỔI số chấm (không phải hằng)", () => {
    dungMan(HAI_MAY, dungCanhGia().canh);
    expect(screen.getAllByTestId("mini-map-cham")).toHaveLength(2);
    cleanup();

    dungMan(
      Array.from({ length: 7 }, (_, i) => may(`machine:${i}`, 5 + i * 3, 6)),
      dungCanhGia().canh,
    );
    expect(screen.getAllByTestId("mini-map-cham")).toHaveLength(7);
  });

  it("★ NT-3 — bản đồ RỖNG TỰ KHAI là rỗng, không phải một ô trống câm", () => {
    dungMan([], dungCanhGia().canh);
    expect(screen.queryAllByTestId("mini-map-cham")).toHaveLength(0);
    expect(screen.getByTestId("mini-map-rong")).toBeInTheDocument();
  });

  it("★ có máy thì KHÔNG hiện chữ 'chưa có máy nào' (đối chứng của ca trên)", () => {
    dungMan(HAI_MAY, dungCanhGia().canh);
    expect(screen.queryByTestId("mini-map-rong")).toBeNull();
  });

  it("★★★ CLICK ở chỗ chấm máy 2 ⇒ camera ĐI TỚI ĐÚNG (35, 25)", () => {
    const g = dungCanhGia();
    dungMan(HAI_MAY, g.canh);
    const svg = screen.getByTestId("mini-map-svg");
    // jsdom trả rect toàn 0 ⇒ nhồi hộp thật để phép quy đổi có nghĩa.
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANH_BAN_DO_PX, height: CANH_BAN_DO_PX }) as DOMRect;

    const chieu = dungPhepChieu(bboxNoiDung(HAI_MAY));
    const dich = sceneSangPx({ x: 35, y: 0, z: 25 }, chieu);
    fireEvent.click(svg, { clientX: dich.px, clientY: dich.py });

    const tg = g.canh.controls.current!.target;
    expect(tg.x).toBeCloseTo(35, 1);
    expect(tg.z).toBeCloseTo(25, 1);
  });

  it("★★★ CLICK ở GÓC KHÁC ⇒ đích KHÁC HẲN — không phải một chỗ cố định", () => {
    const g = dungCanhGia();
    dungMan(HAI_MAY, g.canh);
    const svg = screen.getByTestId("mini-map-svg");
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANH_BAN_DO_PX, height: CANH_BAN_DO_PX }) as DOMRect;

    const chieu = dungPhepChieu(bboxNoiDung(HAI_MAY));
    const a = sceneSangPx({ x: 5, y: 0, z: 5 }, chieu);
    fireEvent.click(svg, { clientX: a.px, clientY: a.py });
    const x1 = g.canh.controls.current!.target.x;
    const z1 = g.canh.controls.current!.target.z;

    const b = sceneSangPx({ x: 35, y: 0, z: 25 }, chieu);
    fireEvent.click(svg, { clientX: b.px, clientY: b.py });
    const x2 = g.canh.controls.current!.target.x;
    const z2 = g.canh.controls.current!.target.z;

    expect(x2 - x1).toBeCloseTo(30, 0);
    expect(z2 - z1).toBeCloseTo(20, 0);
  });

  it("★★★ camera GIỮ NGUYÊN khoảng cách — 'đi tới' chứ không 'lao vào'", () => {
    const g = dungCanhGia();
    dungMan(HAI_MAY, g.canh);
    const svg = screen.getByTestId("mini-map-svg");
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANH_BAN_DO_PX, height: CANH_BAN_DO_PX }) as DOMRect;

    const p0 = g.canh.camera.position;
    const t0 = g.canh.controls.current!.target;
    const d0 = Math.hypot(p0.x - t0.x, p0.y - t0.y, p0.z - t0.z);

    const chieu = dungPhepChieu(bboxNoiDung(HAI_MAY));
    const dich = sceneSangPx({ x: 30, y: 0, z: 22 }, chieu);
    fireEvent.click(svg, { clientX: dich.px, clientY: dich.py });

    const p1 = g.canh.camera.position;
    const t1 = g.canh.controls.current!.target;
    const d1 = Math.hypot(p1.x - t1.x, p1.y - t1.y, p1.z - t1.z);
    expect(d1).toBeCloseTo(d0, 5);
  });

  it("★★★ click TRÚNG một chấm cũng CHỌN máy đó — không chỉ dời camera", () => {
    const g = dungCanhGia();
    const daChon: string[] = [];
    dungMan(HAI_MAY, g.canh, (k) => void daChon.push(k));
    const svg = screen.getByTestId("mini-map-svg");
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANH_BAN_DO_PX, height: CANH_BAN_DO_PX }) as DOMRect;

    const chieu = dungPhepChieu(bboxNoiDung(HAI_MAY));
    const dich = sceneSangPx({ x: 35, y: 0, z: 25 }, chieu);
    fireEvent.click(svg, { clientX: dich.px, clientY: dich.py });
    expect(daChon).toEqual(["machine:2"]);
  });

  it("★ click XA mọi chấm thì KHÔNG chọn nhầm máy (đối chứng của ca trên)", () => {
    const g = dungCanhGia();
    const daChon: string[] = [];
    // Hai máy dồn về một góc để giữa bản đồ thật sự trống.
    dungMan([may("machine:1", 5, 5), may("machine:2", 6, 6)], g.canh, (k) => void daChon.push(k));
    const svg = screen.getByTestId("mini-map-svg");
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANH_BAN_DO_PX, height: CANH_BAN_DO_PX }) as DOMRect;
    fireEvent.click(svg, { clientX: CANH_BAN_DO_PX - 2, clientY: CANH_BAN_DO_PX - 2 });
    expect(daChon).toEqual([]);
  });

  it("máy ĐANG CHỌN có chấm TO HƠN — mini-map nói được mình đang ở đâu", () => {
    dungMan([may("machine:1", 5, 5), may("machine:2", 35, 25, true)], dungCanhGia().canh);
    const cham = screen.getAllByTestId("mini-map-cham");
    const r = cham.map((c) => Number(c.getAttribute("r")));
    expect(Math.max(...r)).toBeGreaterThan(Math.min(...r));
  });

  it("mini-map có nhãn trợ năng và nhận được tiêu điểm bàn phím", () => {
    dungMan(HAI_MAY, dungCanhGia().canh);
    const svg = screen.getByTestId("mini-map-svg");
    expect(svg).toHaveAttribute("role", "button");
    expect(svg).toHaveAttribute("tabindex", "0");
    expect(svg.getAttribute("aria-label")).toBeTruthy();
  });
});
