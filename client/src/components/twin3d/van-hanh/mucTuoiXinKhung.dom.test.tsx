// @vitest-environment jsdom
//
/**
 * mucTuoiXinKhung.dom.test.tsx — ★★★ **MỨC TUỔI LẬT ⇒ MÀU PHẢI ĐƯỢC GHI LẠI.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHE MÀ LƯỚI TRƯỚC KHÔNG THỂ THẤY — ĐO ĐƯỢC TRÊN TRÌNH DUYỆT THẬT
 * ════════════════════════════════════════════════════════════════════════════
 * `tuoiDuLieuVaoDuongVe.unit.test.ts` chứng minh `dungMayVe` TRẢ `doMo` đúng khi
 * mức tuổi là `cu`. Nghiệm thu sống 2026-09-18 (`/twin/line/526`, camera GHIM,
 * chờ 95 s cho dải lật `tuoi`→`cu`) cho thấy điều đó **CHƯA ĐỦ**:
 *
 *     chụp A (t+0) vs chụp B (t+95 s), KHÔNG chạm camera:
 *         tối đi 0 px · sáng lên 0 px · 0,00 %      ← KHÔNG MỘT PIXEL NÀO ĐỔI
 *     rồi hích camera ĐÚNG 1 px để ÉP một khung, chụp C:
 *         A vs C: tối đi 53.934 px (6,46 %) · tỉ số trung vị 0,733
 *
 * 0,733 trúng dự đoán lý thuyết 0,74 (`LoBatchMay:331` nhân `0.35 + 0.65×0.6`)
 * ⇒ **dữ liệu đúng, phép nhân đúng**, nhưng nó KHÔNG tới được khung hình.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐO XONG MỚI BIẾT: **KHÔNG PHẢI THIẾU `invalidate()`** — và đây là bằng chứng
 * ════════════════════════════════════════════════════════════════════════════
 * Giả thuyết đầu tiên là "mức tuổi lật mà không ai xin khung". Bản đầu của tệp
 * này đếm `invalidate()` và cho kết quả **1 ở CẢ HAI nhánh** — cả khi mức tuổi
 * lật LẪN khi đồng hồ chỉ nhích trong cùng một mức. Lý do: R3F gọi
 * `invalidateInstance` ⇒ `root.getState().invalidate()` ở **mọi lượt commit prop**,
 * nên số khung xin KHÔNG phân biệt được hai ca. Một phép đo không phân biệt được
 * thì không bác bỏ được gì — bỏ.
 *
 * ⇒ Thứ quyết định PIXEL không phải "có khung hay không" (poll 10 s vẫn đẻ khung
 *   đều đều), mà là **màu có được GHI LẠI vào lô hay không**. `LoBatchMay:326-338`
 *   ghi màu trong `useLayoutEffect([loMoi, may, chon, invalidate])`, và điều kiện
 *   để nó chạy là **mảng `may` đổi THAM CHIẾU** — tức `useMemo` của `mayVe` ở
 *   trang phải dựng lại. Bản vá "nối `mauTheoTuoi`" đưa `mucTuoiTheoMay` vào ĐỐI
 *   SỐ của `dungMayVe` nhưng **bỏ quên nó trong MẢNG DEPS** ⇒ mức tuổi lật, memo
 *   không chạy, màu cũ nằm nguyên trong buffer, và mọi khung sau đó vẽ lại đúng
 *   màu cũ ấy. Khớp chính xác "0 px đổi trong 95 giây".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ PHÉP ĐO LAI, VÀ VÌ SAO NÓ KHÔNG PHẢI MỘT GREP
 * ════════════════════════════════════════════════════════════════════════════
 * Mảng deps của một `useMemo` nằm trong thân một trang 3,5 nghìn dòng không dựng
 * nổi ở `environment: node`. Nên tệp này **đọc DANH SÁCH TÊN deps từ chính nguồn
 * trang** rồi dựng lại đúng phép ghi nhớ ấy quanh `dungMayVe` + `LoBatchMay` THẬT
 * trên reconciler R3F thật, và khẳng định **HỆ QUẢ BẰNG GIÁ TRỊ**: kênh màu thật
 * sự ghi vào `BatchedMesh.setColorAt`. Text quyết định deps; SỐ là thứ được đo.
 *
 * ⚠ Tên dep lạ (không có trong bảng `bien`) ⇒ **NÉM LỖI**, không im lặng bỏ qua:
 *   một dep bỏ sót âm thầm sẽ làm ca này xanh oan đúng theo cách nó sinh ra để bắt.
 */
import { act, useMemo, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, events as taoSuKien, extend } from "@react-three/fiber";
import * as THREE from "three";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LoBatchMay, TEN_LO_MAY, type MayTrongLo } from "../loi/LoBatchMay";
import { TRANG_THAI_CHON_RONG } from "../loi/chonVatThe";
import { mauChoTrangThai, type MucTuoi } from "../mauTrangThai";
import { khoaBanDo, useOnDinhTheoGiaTri } from "./onDinhTheoGiaTri";
import { trangThaiHienThi, type MayVanHanh } from "./trungThucDuLieu";
import { dungMayVe, type DatChoVaoCanh } from "./hopNhatCanh";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const KHUNG = { width: 800, height: 600, top: 0, left: 0 };
const T0 = 1_757_000_000_000;
const GOC = resolve(__dirname, "../../../..");

/** Hệ số mà `LoBatchMay:331` áp cho `doMo = 0,6`: `0.35 + 0.65 × 0.6`. */
const TI_SO_MONG_DOI = 0.35 + 0.65 * 0.6;

/**
 * ⚠⚠ Callback RỖNG **ở tầm module**, không phải `() => {}` viết tại chỗ: một
 * closure mới mỗi render là một PROP MỚI xuống cây R3F, và nó tự sinh thêm commit.
 * Đúng lớp bẫy "phép đo tự sinh ra phát hiện giả".
 */
const KHONG = () => {};

function glGia(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  return {
    domElement: canvas,
    render() {},
    setSize() {},
    setPixelRatio() {},
    getPixelRatio: () => 1,
    dispose() {},
    shadowMap: { enabled: false, type: THREE.PCFShadowMap, needsUpdate: false },
    toneMapping: THREE.NoToneMapping,
    outputColorSpace: THREE.SRGBColorSpace,
    info: { render: { calls: 0, triangles: 0 } },
    setClearAlpha() {},
    getClearAlpha: () => 1,
    setClearColor() {},
  } as unknown as THREE.WebGLRenderer;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* DANH SÁCH DEPS — đọc từ NGUỒN TRANG, không chép tay                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Tên các dep của `const mayVe = useMemo(...)` trong một trang, theo đúng thứ tự. */
function tenDepsMayVe(tepTrang: string): string[] {
  const src = readFileSync(resolve(GOC, "src/pages", tepTrang), "utf8");
  const i = src.indexOf("const mayVe = useMemo");
  expect(i, `không tìm thấy \`mayVe\` trong ${tepTrang}`).toBeGreaterThan(-1);
  // Cắt theo DẤU KẾT của chính memo (bài học `usePhanTichLine`: cửa sổ cố định
  // đọc lấn hàng xóm và cho ra một ca xanh oan).
  const j = src.indexOf("\n  );", i);
  expect(j, `không tìm thấy dấu kết của \`mayVe\` trong ${tepTrang}`).toBeGreaterThan(i);
  const doan = src.slice(i, j);
  const mo = doan.lastIndexOf("[");
  expect(mo, `không tìm thấy mảng deps của \`mayVe\` trong ${tepTrang}`).toBeGreaterThan(-1);
  return doan
    .slice(mo + 1, doan.indexOf("]", mo))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Giáo cụ                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

const datCho = (): DatChoVaoCanh => ({
  hienThi: true,
  tangId: 1,
  viTriXMm: 0,
  viTriYMm: 0,
  viTriZMm: 0,
  rongMm: 1000,
  caoMm: 1000,
  sauMm: 1000,
  quatX: 0,
  quatY: 0,
  quatZ: 0,
  quatW: 1,
});

const mayNen: MayVanHanh[] = [
  {
    id: 101,
    ma: "M-101",
    ten: "Máy 101",
    loaiMay: "AOI",
    trangThaiBaoCao: "running",
    thoiDiemDuLieu: T0,
    isActive: true,
    stationId: null,
    lineId: null,
  },
];

/**
 * Bản sao TRUNG THỰC của khối hợp nhất ở ba trang: hai bản đồ rút từ CÙNG một
 * `trangThaiHienThi`, cùng đi qua `useOnDinhTheoGiaTri`, rồi vào `dungMayVe` với
 * **đúng mảng deps mà trang thật dùng**.
 */
function TrangGia({ bayGio, tenDeps }: { bayGio: number; tenDeps: string[] }) {
  const mayVanHanh = mayNen;

  const trangThaiTheoMayTho = useMemo(() => {
    const m = new Map<number, string>();
    for (const mv of mayVanHanh) m.set(mv.id, trangThaiHienThi(mv, bayGio).trangThai);
    return m;
  }, [mayVanHanh, bayGio]);
  const trangThaiTheoMay = useOnDinhTheoGiaTri(trangThaiTheoMayTho, khoaBanDo(trangThaiTheoMayTho));

  const mucTuoiTheoMayTho = useMemo(() => {
    const m = new Map<number, MucTuoi>();
    for (const mv of mayVanHanh) m.set(mv.id, trangThaiHienThi(mv, bayGio).tuoi);
    return m;
  }, [mayVanHanh, bayGio]);
  const mucTuoiTheoMay = useOnDinhTheoGiaTri(mucTuoiTheoMayTho, khoaBanDo(mucTuoiTheoMayTho));

  const datChoTheoMay = useMemo(() => new Map(mayVanHanh.map((m) => [m.id, datCho()])), [mayVanHanh]);
  const kichThuocTheoLoai = useMemo(() => new Map(), []);
  const gocToa = useMemo(() => new Map(), []);

  /** Mọi tên dep mà ba trang có thể dùng. Tên lạ ⇒ ném, không im lặng. */
  const bien: Record<string, unknown> = {
    mayVanHanh,
    mayTatCa: mayVanHanh,
    mayLine: mayVanHanh,
    hangXom: mayVanHanh,
    datChoTheoMay,
    kichThuocTheoLoai,
    trangThaiTheoMay,
    mucTuoiTheoMay,
    gocToa,
    phamVi: null,
    lineId: 1,
    machineId: 101,
    factoryId: 1,
    mauNenCanh: "rgb(255, 255, 255)",
  };
  const deps = tenDeps.map((ten) => {
    if (!(ten in bien)) {
      throw new Error(`dep lạ trong \`mayVe\`: \`${ten}\` — bổ sung vào bảng \`bien\``);
    }
    return bien[ten];
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps CỐ Ý lấy từ nguồn trang: đó là thứ đang được đo.
  const mayVe = useMemo<MayTrongLo[]>(
    () =>
      dungMayVe({
        may: mayVanHanh.map((m) => ({
          id: m.id,
          stationId: m.stationId,
          lineId: m.lineId,
          loaiMay: m.loaiMay,
          isActive: m.isActive,
        })),
        datChoTheoMay,
        kichThuocTheoLoai,
        trangThaiTheoMay,
        mucTuoiTheoMay,
        gocToaTheoTang: gocToa,
        trongPhamVi: () => true,
        mauNenCanh: "rgb(255, 255, 255)",
        tiLePhaNgoaiPhamVi: 0.72,
        congCu: {
          mauCss: () => "rgb(255, 0, 0)",
          phaVeNen: (mau) => mau,
          mauChoTrangThai,
          hinhKhoiCho: () => "ban_test",
        },
      }),
    deps,
  );

  return <LoBatchMay may={mayVe} chon={TRANG_THAI_CHON_RONG} onChon={KHONG} onHover={KHONG} chiHopBao />;
}

/* ═══════════════════════════════════════════════════════════════════════════ */

const doiHuy: Array<() => Promise<void>> = [];
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  extend(THREE as unknown as Parameters<typeof extend>[0]);
});
afterEach(async () => {
  while (doiHuy.length) await doiHuy.pop()!();
});

async function dungGoc() {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const root = createRoot(canvas);
  await act(async () => {
    await root.configure({ gl: glGia(canvas), size: KHUNG, frameloop: "never", events: taoSuKien });
  });
  let store: ReturnType<typeof root.render> | null = null;
  const ve = async (ui: ReactNode) => {
    await act(async () => {
      store = root.render(ui);
    });
    return store!;
  };
  doiHuy.push(async () => {
    await act(async () => {
      try {
        root.unmount();
      } catch {
        /*
         * ⚠ NỢ CÓ SẴN, KHÔNG THUỘC ĐỢT NÀY — `BatchedMesh.dispose()` bị gọi HAI
         * lượt lúc tháo (R3F tự dispose object nó quản lý, rồi `LoBatchMay:310`
         * dispose lần nữa; lần hai đọc `_matricesTexture` đã `null` ⇒ ném).
         * Tệp này đo MÀU LÚC ĐANG SỐNG, không đo đường tháo; nuốt ở đây để một
         * nợ sẵn có không biến thành đỏ giả cho ca khác. ĐÃ BÁO chủ đợt.
         */
      }
    });
    canvas.remove();
  });
  return { canvas, ve };
}

/** Kênh ĐỎ của mọi lượt `setColorAt` kể từ khi gài — đọc TẠI LÚC GỌI (three tái dùng một `Color`). */
function gaiBoGhiMau(store: ReturnType<Awaited<ReturnType<typeof dungGoc>>["ve"]> extends Promise<infer S> ? S : never) {
  const lo = store.getState().scene.getObjectByName(TEN_LO_MAY) as THREE.BatchedMesh | undefined;
  expect(lo, "phải tìm thấy lô máy trong cảnh").toBeTruthy();
  const ghi: number[] = [];
  const goc = lo!.setColorAt.bind(lo!);
  lo!.setColorAt = ((i: number, c: THREE.Color) => {
    ghi.push(c.r);
    return goc(i, c);
  }) as THREE.BatchedMesh["setColorAt"];
  return ghi;
}

const TRANG = ["TwinVanHanh.tsx", "TwinLine.tsx", "TwinMay.tsx"] as const;

describe("★★★ MỨC TUỔI LẬT ⇒ MÀU PHẢI ĐƯỢC GHI LẠI VÀO LÔ", () => {
  it.each(TRANG)("%s — đồng hồ tick mà mức tuổi KHÔNG đổi ⇒ KHÔNG ghi lại màu", async (ten) => {
    const deps = tenDepsMayVe(ten);
    const g = await dungGoc();
    const store = await g.ve(<TrangGia bayGio={T0 + 30_000} tenDeps={deps} />);
    const ghi = gaiBoGhiMau(store);

    // 50 s: vẫn `tuoi` (< 60 s). Đồng hồ đã nhích 20 s — nếu cảnh cập nhật theo
    // NHỊP thì ca này đỏ, và đó đúng là điều phải cấm (vứt `frameloop="demand"`).
    await g.ve(<TrangGia bayGio={T0 + 50_000} tenDeps={deps} />);
    expect(ghi, "đồng hồ nhích trong CÙNG một mức tuổi không được ghi lại màu").toEqual([]);
  });

  it.each(TRANG)("%s — mức tuổi `tuoi`→`cu` ⇒ ghi lại màu ĐÚNG MỘT lượt, nhạt đúng 0,74", async (ten) => {
    const deps = tenDepsMayVe(ten);
    const g = await dungGoc();
    const store = await g.ve(<TrangGia bayGio={T0 + 30_000} tenDeps={deps} />);

    // Màu nền so sánh: đọc bằng chính bộ ghi, ở một lượt KHÔNG đổi mức tuổi.
    const lo = store.getState().scene.getObjectByName(TEN_LO_MAY) as THREE.BatchedMesh;
    const mauTuoi = new THREE.Color();
    lo.getColorAt(0, mauTuoi);

    const ghi = gaiBoGhiMau(store);
    // 70 s ⇒ vượt `NGUONG_TUOI_MS` ⇒ mức lật `tuoi` → `cu` ⇒ khối máy phải nhạt 40 %.
    await g.ve(<TrangGia bayGio={T0 + 70_000} tenDeps={deps} />);

    expect(
      ghi,
      "mức tuổi lật mà không ghi lại màu ⇒ buffer giữ màu cũ và MỌI khung sau đó vẽ lại màu cũ ấy",
    ).toHaveLength(1);
    expect(ghi[0] / mauTuoi.r, "tỉ số phải là `0.35 + 0.65 × 0.6` — cùng số mà đo sống thấy 0,733").toBeCloseTo(
      TI_SO_MONG_DOI,
      6,
    );
  });
});
