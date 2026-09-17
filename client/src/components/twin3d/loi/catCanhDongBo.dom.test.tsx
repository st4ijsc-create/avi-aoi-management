// @vitest-environment jsdom
//
/**
 * catCanhDongBo.dom.test.tsx — ★★★ `far` CỦA CAMERA CÓ THẬT SỰ ĐỔI KHÔNG (PH-50b).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * KHUYẾT TẬT — MỘT PROP ĐI VÀO MÀ KHÔNG BAO GIỜ TỚI NƠI
 * ════════════════════════════════════════════════════════════════════════════
 * `KhungCanh` truyền `camera={{fov, near, far, position}}` cho `<Canvas>`. Prop ấy
 * là **CẤU HÌNH KHỞI TẠO**, không phải trạng thái. Đọc bundle đang dùng
 * (`@react-three/fiber@9.5.0`, `dist/events-5a94e5eb.esm.js:15613`):
 *
 *   if (!state.camera || state.camera === lastCamera && !is.equ(lastCamera, cameraOptions, …))
 *
 * `state.camera` là **THỰC THỂ** `PerspectiveCamera`; `lastCamera` là **OBJECT CẤU
 * HÌNH** của lần trước. Với một cấu hình thuần, hai thứ đó không bao giờ `===`
 * nhau ⇒ vế phải luôn sai ⇒ khối chỉ chạy đúng một lần (`!state.camera`). Nhánh
 * `===` ấy chỉ dành cho người truyền THẲNG một camera instance.
 *
 * Hệ quả đo sống được: `/twin?pv=tapdoan` mount khi `khuonVien` còn `null`, nên
 * `far` lúc ấy rơi về sàn **2000**; dữ liệu về sau đổi prop thành 25.449,6 mà
 * `camera.far` vẫn **2000** ở cả 5 vai QATD.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO ĐO Ở ĐÂY CHỨ KHÔNG PHẢI TRÊN TRÌNH DUYỆT
 * ════════════════════════════════════════════════════════════════════════════
 * Ba lượt trước đã thử moi `camera` qua `canvas.__r3f` / fiber (`p50-probe-cam*.mjs`)
 * và TẮC cả ba — R3F 9.5 không treo store lên phần tử canvas. Ở đây ta chạy CHÍNH
 * reconciler R3F trong jsdom (khuôn `dungGoc` của `loBatchMay.dom.test.tsx` /
 * `bamNenBoChon.dom.test.tsx`): `root.configure()` là ĐÚNG hàm mà `<Canvas>` gọi
 * mỗi render, nên cơ chế đo được ở đây là cơ chế chạy thật.
 *
 * ★★★ CA A LÀ ĐỐI CHỨNG DƯƠNG CHO CHÍNH THIẾT BỊ ĐO: nó chứng minh `configure`
 *   lần hai KHÔNG áp `far` mới. Không có nó, ca C ("đồng bộ rồi") có thể xanh vì
 *   một lý do hoàn toàn khác (ví dụ R3F tự áp), và ta sẽ ghi công cho một bản vá
 *   không làm gì.
 */
import { act, type ReactNode } from "react";
import { createRoot, events as taoSuKien } from "@react-three/fiber";
import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { docMaNguon } from "@shared/testing/docMaNguon";

import { DongBoCatCanh } from "./KhungCanh";
import { NEAR_TOI_DA_M, catCanhTheoBanKinh, nearTheoFar } from "./catCanh";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const KHUNG = { width: 800, height: 600, top: 0, left: 0 };
const GOC = resolve(import.meta.dirname, "..", "..", "..", "..", "..");

/** Renderer GIẢ — y hệt `loBatchMay.dom.test.tsx`; R3F chỉ cần `render` để nhận là renderer. */
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

type Goc = ReturnType<typeof createRoot>;
type Store = ReturnType<Goc["render"]>;

const donDep: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (donDep.length) await donDep.pop()!();
});

async function dungGoc(camera: { fov: number; near: number; far: number }) {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const root = createRoot(canvas);
  await act(async () => {
    await root.configure({ gl: glGia(canvas), size: KHUNG, frameloop: "never", events: taoSuKien, camera });
  });
  let store: Store | null = null;
  const ve = async (ui: ReactNode) => {
    await act(async () => {
      store = root.render(ui);
    });
    return store!;
  };
  /** Gọi lại `configure` ĐÚNG như `<Canvas>` làm ở mỗi render khi prop `camera` đổi. */
  const capHinhLai = async (cam: { fov: number; near: number; far: number }) => {
    await act(async () => {
      await root.configure({ gl: glGia(canvas), size: KHUNG, frameloop: "never", events: taoSuKien, camera: cam });
    });
  };
  donDep.push(async () => {
    await act(async () => {
      root.unmount();
    });
    canvas.remove();
  });
  return { canvas, ve, capHinhLai };
}

const camCua = (store: Store) => store.getState().camera as THREE.PerspectiveCamera;

/** Cây rỗng — CA A đo CƠ CHẾ của R3F, không cần vật thể nào (và không cần `extend`). */
function KhongVe() {
  return null;
}

describe("★★★ CA A (ĐỐI CHỨNG DƯƠNG VỀ CƠ CHẾ) — `<Canvas camera={…}>` KHÔNG áp lại `far`", () => {
  it("đổi cấu hình camera lần hai: prop nói 25.449,6 — `camera.far` vẫn 2000", async () => {
    const { ve, capHinhLai } = await dungGoc({ fov: 45, near: 0.1, far: 2000 });
    const store = await ve(<KhongVe />);
    expect(camCua(store).far).toBe(2000);
    expect(camCua(store).near).toBe(0.1);

    await capHinhLai({ fov: 45, near: 0.5, far: 25_449.6 });
    // ĐÂY LÀ KHUYẾT TẬT, viết ra thành một khẳng định để nó không im lặng biến mất:
    expect(camCua(store).far).toBe(2000);
    expect(camCua(store).near).toBe(0.1);
  });

  it("KHẲNG ĐỊNH KÍCH THƯỚC: camera có thật, là PerspectiveCamera, và `far` khác 0", async () => {
    const { ve } = await dungGoc({ fov: 45, near: 0.1, far: 2000 });
    const store = await ve(<KhongVe />);
    /*
     * ⚠ KHÔNG dùng `toBeInstanceOf(THREE.PerspectiveCamera)`: vitest nạp `three` qua
     *   hai đường (ESM của test và CJS-dev mà R3F require) nên có HAI lớp `PerspectiveCamera`
     *   khác định danh — `instanceof` ĐỎ trên một camera hoàn toàn đúng. Đo bằng cờ của
     *   chính THREE thay vì bằng định danh lớp.
     */
    expect((camCua(store) as unknown as { isPerspectiveCamera?: boolean }).isPerspectiveCamera).toBe(true);
    expect(camCua(store).type).toBe("PerspectiveCamera");
    expect(camCua(store).far).toBeGreaterThan(0);
  });
});

describe("★★★ CA B — `DongBoCatCanh` ĐƯA `near`/`far` MỚI VÀO CAMERA ĐANG SỐNG", () => {
  it("đổi prop ⇒ `camera.far` đi theo (ĐỎ trước bản vá PH-50b)", async () => {
    const { ve } = await dungGoc({ fov: 45, near: 0.1, far: 2000 });
    const store = await ve(<DongBoCatCanh near={0.1} far={2000} />);
    expect(camCua(store).far).toBe(2000);

    await ve(<DongBoCatCanh near={0.5} far={12_478.4} />);
    expect(camCua(store).far).toBe(12_478.4);
    expect(camCua(store).near).toBe(0.5);
  });

  it("★ MA TRẬN CHIẾU phải được dựng lại — không thì `far` mới là số trang trí", async () => {
    const { ve } = await dungGoc({ fov: 45, near: 0.1, far: 2000 });
    const store = await ve(<DongBoCatCanh near={0.1} far={2000} />);
    const truoc = camCua(store).projectionMatrix.elements.slice();

    await ve(<DongBoCatCanh near={0.5} far={12_478.4} />);
    const sau = camCua(store).projectionMatrix.elements.slice();

    // Phần tử [10] và [14] của ma trận phối cảnh CHỈ phụ thuộc near/far.
    expect(sau[10]).not.toBe(truoc[10]);
    expect(sau[14]).not.toBe(truoc[14]);
    // …và đúng bằng công thức của THREE cho cặp near/far mới.
    const doiChung = new THREE.PerspectiveCamera(45, KHUNG.width / KHUNG.height, 0.5, 12_478.4);
    doiChung.updateProjectionMatrix();
    expect(sau[10]).toBeCloseTo(doiChung.projectionMatrix.elements[10], 10);
    expect(sau[14]).toBeCloseTo(doiChung.projectionMatrix.elements[14], 10);
  });

  it("★ KHÔNG đổi prop ⇒ KHÔNG đụng camera (tránh `updateProjectionMatrix` mỗi render)", async () => {
    const { ve } = await dungGoc({ fov: 45, near: 0.1, far: 2000 });
    const store = await ve(<DongBoCatCanh near={0.1} far={2000} />);
    const cam = camCua(store);
    let dem = 0;
    const that = cam.updateProjectionMatrix.bind(cam);
    cam.updateProjectionMatrix = () => {
      dem += 1;
      that();
    };
    await ve(<DongBoCatCanh near={0.1} far={2000} />);
    expect(dem).toBe(0);
    await ve(<DongBoCatCanh near={0.1} far={9999} />);
    expect(dem).toBe(1);
  });

  it("★ ĐỐI CHỨNG ÂM — cảnh nhỏ (far = sàn 2000) đi qua bộ đồng bộ mà KHÔNG đổi gì", async () => {
    const { ve } = await dungGoc({ fov: 45, near: 0.1, far: 2000 });
    const nho = catCanhTheoBanKinh(40);
    const store = await ve(<DongBoCatCanh near={nho.near} far={nho.far} />);
    expect(camCua(store).near).toBe(0.1);
    expect(camCua(store).far).toBe(2000);
  });
});

describe("★★★ CA C — CHỖ NỐI: bộ đồng bộ phải nằm TRONG `<Canvas>` và trang phải dùng đúng phép tính", () => {
  const nguon = (duong: string) => docMaNguon(resolve(GOC, duong));

  it("`KhungCanh` render `<DongBoCatCanh>` bên trong `<Canvas>`", () => {
    const s = nguon("client/src/components/twin3d/loi/KhungCanh.tsx");
    const trong = s.slice(s.indexOf("<Canvas"), s.indexOf("</Canvas>"));
    expect(trong).toContain("<DongBoCatCanh");
    // Một component dùng `useThree` mà đặt ngoài `<Canvas>` sẽ ném lúc chạy —
    // nhưng "ngoài" ở đây là lỗi im lặng kiểu khác: nó không ném, nó chỉ không chạy.
    expect(trong.indexOf("<DongBoCatCanh")).toBeGreaterThan(0);
  });

  it("`KhungCanh` KHÔNG còn hằng `near: 0.1` trong cấu hình camera — `near` suy từ `far`", () => {
    const s = nguon("client/src/components/twin3d/loi/KhungCanh.tsx");
    expect(s).toContain("nearTheoFar");
    expect(s).not.toMatch(/\{\s*fov,\s*near:\s*0\.1,\s*far,/);
  });

  it("★★★ `CanhVanHanh` lấy `far` VÀ `maxDistance` từ CÙNG một hằng", () => {
    const s = nguon("client/src/components/twin3d/van-hanh/CanhVanHanh.tsx");
    expect(s).toContain("farTheoBanKinh");
    expect(s).toContain("khoangCachZoomXaNhat");
    // Công thức cũ phải biến mất hẳn, không được còn bản sao nào.
    expect(s).not.toContain("Math.max(2000, banKinh * 24)");
    expect(s).not.toMatch(/banKinhToiDa \* 8/);
  });

  it("★ `nearTheoFar` là đường DUY NHẤT đặt `near` trong kit — census", () => {
    const s = nguon("client/src/components/twin3d/loi/KhungCanh.tsx");
    const soLanNearHang = (s.match(/near:\s*0\.\d/g) ?? []).length;
    expect(soLanNearHang).toBe(0);
    expect(nearTheoFar(2000)).toBe(0.1);
    expect(nearTheoFar(1_000_000)).toBe(NEAR_TOI_DA_M);
  });
});
