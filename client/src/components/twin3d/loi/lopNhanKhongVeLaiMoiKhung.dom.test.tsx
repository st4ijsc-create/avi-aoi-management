// @vitest-environment jsdom
//
/**
 * lopNhanKhongVeLaiMoiKhung.dom.test.tsx — ★★★ KÉO XOAY CAMERA KHÔNG ĐƯỢC LÀ MỘT LƯỢT
 * COMMIT REACT CHO TOÀN BỘ DANH SÁCH NHÃN.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * BỆNH ĐƯỢC GHIM
 * ════════════════════════════════════════════════════════════════════════════
 * `LopNhan` chạy `useFrame(tinhLai)`; cuối `tinhLai` nó so một chuỗi `chuKy` rồi
 * `setHienThi(...)`. Bản trước bản vá đưa **toạ độ** vào chuỗi ấy:
 *
 *     `${soBiGiau}#${soBatThuongNgoaiKhung}#${soAnBadge}#`
 *       + ve.map(v => `${v.khoa}:${Math.round(v.x)}:${Math.round(v.y)}`).join("|")
 *
 * `Math.round(x)` của một nhãn đổi khi camera xê dịch chưa tới 1/800 bề ngang khung
 * nhìn ⇒ **mỗi khung kéo xoay là một `setState`**, tức một lượt reconcile + commit cho
 * CẢ danh sách nhãn — và `<Html>` của drei nuôi cây DOM con bằng một root react-dom
 * RIÊNG nên mỗi lượt ấy còn kéo theo một `root.render()` đầy đủ nữa. Đúng sai lầm số
 * một trong *performance pitfalls* của react-three-fiber.
 *
 * ★★★ NHƯNG **BA SỐ ĐẦU PHẢI Ở LẠI** TRONG KHOÁ. Docblock `LopNhan.tsx:512` ghim một
 *     quyết định đã đo: *"`soBatThuongNgoaiKhung` cũng ĐI VÀO CHỮ KÝ: xoay camera đưa
 *     máy sự cố ra/vào khung phải đổi chip NGAY, không chờ tập nhãn đổi."* Ba số ấy
 *     ĐỔI THEO CAMERA MỘT CÁCH CÓ NGHĨA. ⇒ chỉ `:x:y` bị bỏ khỏi khoá, không phải cả
 *     cụm. Vì thế tệp này ghim CẢ HAI MẶT:
 *       · camera xê dịch mà ba số KHÔNG đổi  ⇒ nhãn DI CHUYỂN THẬT, render ≤ 1
 *       · camera đưa máy sự cố ra khỏi khung ⇒ CÓ render và chip đổi
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ THƯỚC ĐO VÀ BẰNG CHỨNG NÓ BIẾT KÊU
 * ════════════════════════════════════════════════════════════════════════════
 * Đếm render bằng `React.Profiler` bọc NGOÀI `<LopNhan>` — cơ chế của React, không đọc
 * một biến nào của mã đang sửa (không `window.__demNhan`, không đếm trong thân
 * component), nên nó không thể tự thoả. Ca **ĐỐI CHỨNG DƯƠNG** đầu tiên dựng một
 * component cố tình `setState` mỗi khung trong CÙNG cây R3F và bắt `Profiler` phải đếm
 * ≥ N: thước im ở đó ⇒ mọi số 0 dưới đây vô nghĩa, và ca ấy nói ra điều đó.
 *
 * Và một "0 render" cũng vô nghĩa nếu camera không làm gì: mỗi ca đo camera đều KIỂM
 * rằng nhãn ĐÃ DI CHUYỂN THẬT trên DOM (> 30 px) trong chính N khung ấy.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ORACLE ĐỘC LẬP CHO BẤT BIẾN "SỔ HỘP GHI MỖI KHUNG" — KHÔNG DÙNG SỔ LÀM
 *     CHỨNG CHO CHÍNH NÓ (bài học G136: lưới xanh 38/38 vì nó đọc đúng cái sổ thiếu)
 * ════════════════════════════════════════════════════════════════════════════
 * `hopDaVeRef` của `LopNhan` được ghi TRƯỚC cửa chữ ký và phải chạy MỖI KHUNG. Nếu ta
 * chứng minh điều đó bằng `window.__demTuongTac.hopNhanDaVe()` thì ta đang lấy sổ tay
 * của chính component làm bằng chứng cho sổ tay ấy. Nên bất biến này được đo bằng
 * **HÀNH VI SẢN PHẨM**: `khiBam` (`LopNhan.tsx:299`) tra `hopDaVeRef` để biết cú click
 * rơi vào nhãn nào. ⇒ bấm vào chỗ nhãn ĐANG đứng (toạ độ lấy từ DOM — đầu ra thị giác
 * thật) phải chọn đúng máy; bấm vào chỗ nhãn ĐÃ RỜI KHỎI 30 khung trước phải KHÔNG chọn
 * gì. Sổ đứng im ⇒ hai khẳng định ấy đảo nhau.
 * Cửa sổ đo `hopNhanDaVe()` vẫn được kiểm, nhưng chỉ bằng phép ĐỐI CHIẾU với số phần tử
 * DOM thật (bookkeeping vs đầu ra), không bao giờ đứng một mình.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAZARD RIÊNG CỦA BẢN VÁ NÀY: NHÃN TRỄ CAMERA MỘT KHUNG
 * ════════════════════════════════════════════════════════════════════════════
 * Đưa vị trí ra khỏi React mà ghi ở `useEffect` / một rAF riêng / lượt render sau thì
 * nhãn sẽ **trôi lệch khỏi khối máy** trong lúc kéo rồi mới bắt kịp — mắt thấy ngay,
 * jsdom không thấy gì. Ca "KHÔNG TRỄ KHUNG" dưới đây ghim: TRONG CÙNG một lượt
 * `advance()` sau khi camera đổi, toạ độ đọc từ DOM đã là toạ độ MỚI; và lượt
 * `advance()` kế tiếp với camera ĐỨNG YÊN không được làm nhãn nhúc nhích thêm (nhúc
 * nhích = nó đang đuổi theo khung trước).
 */
import { Profiler, act, useState, type ReactNode } from "react";
import { createRoot, events as taoSuKien, extend, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LopNhan, type NhanTheGioi, type WindowCoDo } from "./LopNhan";
import type { CuaSoDoTwin3d } from "./KhungCanh";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const KHUNG = { width: 800, height: 600, top: 0, left: 0 };

/** Renderer GIẢ — y hệt `lopCanhBaoKhongVeLaiMoiKhung.dom.test.tsx` / `bamNenBoChon.dom.test.tsx`. */
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
const daChon: number[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  extend(THREE as unknown as Parameters<typeof extend>[0]);
});

afterEach(async () => {
  while (donDep.length) await donDep.pop()!();
  document.body.innerHTML = "";
  delete (window as WindowCoDo).__demNhan;
  delete (window as Window & CuaSoDoTwin3d).__demTuongTac;
  // `?do=1` là trạng thái TOÀN CỤC — rò sang ca sau là một lớp lỗi riêng.
  window.history.replaceState({}, "", "/");
  daChon.length = 0;
});

async function dungGoc() {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const root = createRoot(canvas);
  await act(async () => {
    await root.configure({ gl: glGia(canvas), size: KHUNG, frameloop: "never", events: taoSuKien });
  });
  let store: Store | null = null;
  const ve = async (ui: ReactNode) => {
    await act(async () => {
      store = root.render(ui);
    });
    return store!;
  };
  donDep.push(async () => {
    await act(async () => {
      root.unmount();
    });
    canvas.remove();
  });
  return { canvas, ve };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Dụng cụ đọc — KHÔNG đi qua một cửa sổ đo nào của chính `LopNhan`            */
/* ═══════════════════════════════════════════════════════════════════════════ */

let dongHo = 1000;
/**
 * Quay MỘT khung, sau khi (tuỳ chọn) xê dịch camera `dy` mét theo trục Y.
 *
 * ★ `updateMatrixWorld(true)` là việc mà `OrbitControls`/vòng lặp thật làm trước khi vẽ;
 *   thiếu nó `Vector3.project` đọc ma trận cũ và camera "di chuyển" mà không ai thấy —
 *   tức phép đo tự tạo ra kết luận "0 render" (G5).
 *
 * ★★★ VÌ SAO XÊ DỊCH THEO **Y** CHỨ KHÔNG THEO X — và đây là một phát hiện, không phải
 *   một tiện tay. Lượt đo đầu tiên trên bản ĐÃ VÁ cho **2** lượt render trên 30 khung
 *   (không phải 0), và nguyên nhân KHÔNG phải toạ độ còn sót trong khoá: `diemUuTienNhan`
 *   xếp hạng trong cùng hạng theo **khoảng cách tới camera**, nên camera trượt ngang qua
 *   một hàng máy làm THỨ TỰ `kq.ve` đảo — một thay đổi THẬT của cây được render, đúng
 *   nghĩa phải có commit. Muốn câu "0 render" nói về TOẠ ĐỘ thì cảnh thử phải có thứ hạng
 *   BẤT BIẾN: ba máy nằm cùng phía (x = 0 / 4 / 8) và camera chỉ đi theo Y ⇒
 *   `d = √(x² + cy² + 100)` tăng đơn điệu theo x ở MỌI `cy` ⇒ thứ tự [1, 2, 3] cố định.
 *   (Nới ngưỡng lên "≤ 2" thì rẻ hơn, nhưng nó sẽ nuốt luôn một bản vá hỏng làm đúng 2
 *   lượt commit thừa — ngưỡng phải là 1, và cảnh thử phải xứng với ngưỡng ấy.)
 */
async function quayKhung(store: Store, dy = 0) {
  if (dy !== 0) {
    const cam = store.getState().camera;
    cam.position.y += dy;
    cam.updateMatrixWorld(true);
  }
  dongHo += 16;
  await act(async () => {
    store.getState().advance(dongHo);
  });
}

const cacNhan = () => [...document.querySelectorAll<HTMLElement>('[data-testid="nhan-may-twin3d"]')];

const motNhan = (machineId: number) =>
  document.querySelector<HTMLElement>(`[data-testid="nhan-may-twin3d"][data-machine-id="${machineId}"]`);

const maMay = () =>
  cacNhan()
    .map((e) => e.getAttribute("data-machine-id") ?? "")
    .sort();

/**
 * Vị trí nhãn ĐỌC TỪ DOM, không phụ thuộc bản vá dùng `left/top` hay `transform`.
 *
 * jsdom không có layout engine nên `getBoundingClientRect()` trả 0 cho mọi phần tử ⇒ phải
 * đọc chính hai kênh mà mã sản phẩm có thể dùng để đặt nhãn và cộng chúng lại: `left/top`
 * (px) + mọi `translate(<px>, <px>)` trong `transform`. `translate(-50%, -100%)` bị bỏ qua
 * vì nó là phép neo (x = GIỮA, y = CẠNH DƯỚI của hộp), không phải toạ độ.
 */
function viTriDom(el: HTMLElement): { x: number; y: number } {
  const s = el.style;
  let x = Number.parseFloat(s.left);
  let y = Number.parseFloat(s.top);
  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(y)) y = 0;
  for (const m of (s.transform || "").matchAll(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/g)) {
    x += Number.parseFloat(m[1]);
    y += Number.parseFloat(m[2]);
  }
  return { x, y };
}

/** Điểm giữa hộp nhãn, suy từ ĐẦU RA DOM (neo giữa-đáy, cao suy đoán 22 px — `CAO_SUY_DOAN_PX`). */
function tamNhanTuDom(el: HTMLElement): { x: number; y: number } {
  const v = viTriDom(el);
  return { x: v.x, y: v.y - 11 };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Cảnh thử                                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

const nhanThe = (id: number, x: number, batThuong = false, y = 0): NhanTheGioi => ({
  khoa: `may:${id}`,
  machineId: id,
  viTri: { x, y, z: 0 },
  ma: `M-${id}`,
  batThuong,
});

/**
 * BA nhãn dàn ngang CÙNG MỘT PHÍA, cách nhau 4 m. Camera đặt về `(0, 0, 10)` và chỉ đi
 * theo Y (xem `quayKhung`).
 *
 * Số học của cảnh — cần ghi ra, vì mọi ngưỡng dưới đây dựa vào nó. fov 75, khung 800×600,
 * mọi nhãn ở z = 0 ⇒ chiều sâu 10 m: nửa bề ngang khung nhìn = 10·tan(37,5°)·(800/600)
 * ≈ 10,23 m ⇒ **39,1 px/m** ở cả hai trục. Ba nhãn rơi vào x ≈ 400 / 556 / 713 px, y = 300
 * px lúc `cy = 0`; camera đi 3 m theo Y ⇒ cả ba trôi 117 px theo trục y màn hình.
 *
 * · Bề rộng `locNhan` dùng = `uocLuongRongNhanPx("M-1")` = 38 px (jsdom không đo được cỡ
 *   thật) ⇒ không cặp nào chồng, không hộp nào chạm mép ở bất kỳ khung nào.
 * · `demCapChongLap` lại đo bằng `coNhanRef` (RỖNG trong jsdom) ⇒ rơi về
 *   `RONG_SUY_DOAN_PX` = 150 px; khoảng cách 156 px giữa hai nhãn kề vẫn đủ để nó ra 0.
 * · Thứ hạng ưu tiên BẤT BIẾN: `d = √(x² + cy² + 100)` tăng đơn điệu theo x ở mọi `cy`.
 * ⇒ TẬP nhãn, THỨ TỰ nhãn và cả BA SỐ ĐẦU (`soBiGiau` = 0, `soBatThuongNgoaiKhung` = 0,
 *   `soAnBadge` = 0 — không có `LopCanhBao` trong cây) đứng yên suốt quãng kéo camera:
 *   điều kiện cần để câu "0 render" nói về TOẠ ĐỘ chứ không về thứ khác.
 */
const BA_NHAN: NhanTheGioi[] = [nhanThe(1, 0), nhanThe(2, 4), nhanThe(3, 8)];

function datCamera(store: Store) {
  const cam = store.getState().camera;
  cam.position.set(0, 0, 10);
  cam.updateMatrixWorld(true);
}

/** Hàm ỔN ĐỊNH (hằng module): prop mới mỗi render sẽ là một biến gây nhiễu cho phép đếm. */
const ghiChon = (machineId: number) => {
  daChon.push(machineId);
};

/** Một cú BẤM thật trên canvas (pointerdown + click cùng chỗ, < 4 px và < 300 ms — `laBam`). */
async function bamTaiCanvas(canvas: HTMLCanvasElement, x: number, y: number) {
  await act(async () => {
    canvas.dispatchEvent(new MouseEvent("pointerdown", { button: 0, clientX: x, clientY: y, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent("click", { button: 0, clientX: x, clientY: y, bubbles: true }));
  });
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ĐỐI CHỨNG DƯƠNG — thước có biết kêu không                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Component cố tình phạm ĐÚNG lỗi đang bị cấm: `setState` mỗi khung. */
function NhipGia() {
  const [, dat] = useState(0);
  useFrame(() => dat((n) => n + 1));
  return null;
}

describe("★★★ ĐỐI CHỨNG DƯƠNG — `Profiler` trong cây R3F có ĐẾM ĐƯỢC render mỗi khung không", () => {
  it("component `setState` mỗi khung ⇒ Profiler đếm ≥ số khung đã quay (thước biết kêu)", async () => {
    const { ve } = await dungGoc();
    let dem = 0;
    const store = await ve(
      <Profiler id="doi-chung" onRender={() => (dem += 1)}>
        <NhipGia />
      </Profiler>,
    );
    dem = 0;
    for (let i = 0; i < 8; i += 1) await quayKhung(store);
    expect(dem, "Profiler KHÔNG nghe thấy render trong cây R3F ⇒ mọi số 0 dưới đây vô nghĩa").toBeGreaterThanOrEqual(8);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* CA CHÍNH — toạ độ KHÔNG được đi qua React                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ LopNhan — kéo camera N khung KHÔNG được sinh N lượt render", () => {
  it("★★★ 30 khung xê dịch camera ⇒ nhãn DI CHUYỂN THẬT trên DOM mà số render KHÔNG tăng theo N", async () => {
    const { ve } = await dungGoc();
    let dem = 0;
    const store = await ve(
      <Profiler id="nhan" onRender={() => (dem += 1)}>
        <LopNhan nhan={BA_NHAN} dangChon={null} dangHover={null} />
      </Profiler>,
    );
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);

    // TIỀN ĐỀ (G5): có đúng 3 nhãn trên DOM, nếu không mọi khẳng định dưới nói về cái rỗng.
    expect(cacNhan()).toHaveLength(3);
    const truoc = viTriDom(motNhan(3)!);

    dem = 0;
    const N = 30;
    for (let i = 0; i < N; i += 1) await quayKhung(store, -0.1);

    const sau = viTriDom(motNhan(3)!);
    // ① Camera THẬT SỰ đã làm nhãn chạy — "0 render" không được mua bằng một lớp đứng im.
    expect(Math.abs(sau.y - truoc.y), `nhãn không nhúc nhích: ${truoc.y} → ${sau.y}`).toBeGreaterThan(30);
    // ② …mà React KHÔNG commit lại danh sách nhãn theo từng khung.
    expect(dem, `render ${dem} lần trên ${N} khung — toạ độ vẫn đang đi qua React state`).toBeLessThanOrEqual(1);
    // ③ TẬP nhãn không đổi trong suốt quãng ấy (nếu đổi thì ② nói về một chuyện khác).
    expect(maMay()).toEqual(["1", "2", "3"]);
  });

  it("★★★ KHÔNG TRỄ KHUNG: ngay TRONG lượt `advance()` có camera đổi, DOM đã mang toạ độ MỚI", async () => {
    const { ve } = await dungGoc();
    const store = await ve(<LopNhan nhan={BA_NHAN} dangChon={null} dangHover={null} />);
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);
    expect(cacNhan(), "TIỀN ĐỀ: phải có nhãn để đo").toHaveLength(3);

    const y0 = viTriDom(motNhan(2)!).y;
    // MỘT lượt advance duy nhất, camera dịch 1 m ≈ 39 px.
    await quayKhung(store, -1);
    const y1 = viTriDom(motNhan(2)!).y;
    expect(
      Math.abs(y1 - y0),
      `nhãn TRỄ camera: ngay lượt advance có camera đổi nó mới dịch ${Math.abs(y1 - y0).toFixed(1)} px`,
    ).toBeGreaterThan(30);

    // …và lượt kế tiếp với camera ĐỨNG YÊN không được làm nó nhúc nhích thêm.
    await quayKhung(store, 0);
    expect(viTriDom(motNhan(2)!).y, "nhãn còn dịch tiếp khi camera đã đứng yên ⇒ nó đang chạy sau một khung").toBe(y1);
  });

  it("★★★ BẤT BIẾN 1 (oracle ĐỘC LẬP = hành vi bấm): `hopDaVeRef` dựng lại ở MỌI khung, kể cả khung không-setState", async () => {
    const { canvas, ve } = await dungGoc();
    let dem = 0;
    const store = await ve(
      <Profiler id="nhan" onRender={() => (dem += 1)}>
        <LopNhan nhan={BA_NHAN} dangChon={null} dangHover={null} onChonNhan={ghiChon} />
      </Profiler>,
    );
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);
    expect(cacNhan(), "TIỀN ĐỀ: phải có 3 nhãn").toHaveLength(3);

    // TIỀN ĐỀ: bấm vào chỗ nhãn ĐANG đứng chọn đúng máy — nếu không, mọi khẳng định dưới là rỗng.
    const cu = tamNhanTuDom(motNhan(3)!);
    await bamTaiCanvas(canvas, cu.x, cu.y);
    expect(daChon, "bấm lên nhãn không chọn được máy ⇒ oracle của ca này hỏng").toEqual([3]);

    daChon.length = 0;
    dem = 0;
    for (let i = 0; i < 30; i += 1) await quayKhung(store, -0.1);
    const moi = tamNhanTuDom(motNhan(3)!);
    expect(Math.abs(moi.y - cu.y), "nhãn phải đã rời đi đủ xa để hai điểm bấm không dính nhau").toBeGreaterThan(60);

    // ★ Sổ ĐỨNG IM ⇒ chỗ CŨ vẫn "là nhãn" ⇒ vẫn chọn máy 3. Sổ sống ⇒ chỗ cũ là nền.
    await bamTaiCanvas(canvas, cu.x, cu.y);
    expect(
      daChon,
      "bấm vào chỗ nhãn ĐÃ RỜI KHỎI vẫn chọn máy ⇒ `hopDaVeRef` đứng im ở khung cuối có setState",
    ).toEqual([]);
    // ★ …và chỗ MỚI (đọc từ DOM) phải chọn được.
    await bamTaiCanvas(canvas, moi.x, moi.y);
    expect(daChon, "bấm đúng chỗ nhãn đang đứng mà không chọn được ⇒ sổ hộp không theo kịp khung").toEqual([3]);

    expect(dem, "quãng đo này lẽ ra không có lượt commit nào").toBeLessThanOrEqual(1);
  });

  it("★★★ BẤT BIẾN 3: `window.__demNhan` + `__demTuongTac` dựng lại MỖI KHUNG, đủ MỌI trường", async () => {
    window.history.replaceState({}, "", "/?do=1");
    const { ve } = await dungGoc();
    let dem = 0;
    const store = await ve(
      <Profiler id="nhan" onRender={() => (dem += 1)}>
        <LopNhan nhan={BA_NHAN} dangChon={null} dangHover={null} />
      </Profiler>,
    );
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);
    expect(cacNhan(), "TIỀN ĐỀ: phải có 3 nhãn").toHaveLength(3);

    // ★ ĐẦU ĐỘC: xoá trắng cửa sổ đo rồi quay ĐÚNG MỘT khung (không có setState nào).
    delete (window as WindowCoDo).__demNhan;
    dem = 0;
    await quayKhung(store, -0.1);

    const d = (window as WindowCoDo).__demNhan;
    expect(d, "`__demNhan` KHÔNG được dựng lại ở khung không-setState").toBeDefined();
    expect(Object.keys(d!).sort()).toEqual(
      [
        "biChe",
        "biGiau",
        "capConChong",
        "chongLap",
        "deKhoiKhac",
        "deKhoiKhacDoLai",
        "ngoaiKhung",
        "soHopBadge",
        "soHopKhoi",
        "soLopPhuDom",
        "soVungCam",
        "suCoNgoaiKhung",
        "tong",
        "tran",
        "ve",
        "vuotMep",
        "vuotTran",
      ].sort(),
    );
    expect(d!.ve).toBe(3);
    expect(d!.tong).toBe(3);
    expect(d!.biGiau).toBe(0);
    expect(d!.capConChong).toBe(0);
    expect(d!.suCoNgoaiKhung).toBe(0);

    // Cửa sổ đo tương tác giữ nguyên hai hàm — và số mục trong sổ phải BẰNG số nhãn DOM thật
    // (đối chiếu bookkeeping ↔ đầu ra; sổ KHÔNG được đứng một mình làm chứng cho chính nó).
    const cua = (window as Window & CuaSoDoTwin3d).__demTuongTac;
    expect(cua?.hopNhanDaVe, "`__demTuongTac.hopNhanDaVe` biến mất").toBeTypeOf("function");
    expect(cua?.hopKhoiMay, "`__demTuongTac.hopKhoiMay` biến mất").toBeTypeOf("function");
    expect(cua!.hopNhanDaVe!().length, "sổ hộp nhãn LỆCH số nhãn thật trên DOM").toBe(cacNhan().length);
    expect(
      cua!
        .hopNhanDaVe!()
        .map((v) => v.machineId)
        .sort(),
    ).toEqual([1, 2, 3]);
    expect(dem, "quãng đo này lẽ ra không có lượt commit nào").toBeLessThanOrEqual(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* MẶT KIA — ba số đầu Ở LẠI trong khoá, và TẬP đổi thì PHẢI render            */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ LopNhan — bản vá KHÔNG được là 'đóng băng lớp'", () => {
  it("★★★ camera đưa MÁY SỰ CỐ ra khỏi khung ⇒ CÓ render và chip 'N sự cố ngoài khung' đổi", async () => {
    // Máy 8 BẤT THƯỜNG, treo cao 6 m ⇒ y màn hình ≈ 65 px, CÒN trong khung. Máy 2 bình thường
    // ở y = 0 (≈ 300 px) để lớp không bao giờ rỗng (rỗng là nhánh khác, có ca riêng bên dưới).
    // Camera đi xuống 3 m ⇒ máy 8 trôi lên −52 px (ra khỏi frustum), máy 2 dừng ở 183 px.
    const CANH: NhanTheGioi[] = [nhanThe(2, 0), nhanThe(8, 0, true, 6)];
    const { ve } = await dungGoc();
    let dem = 0;
    const store = await ve(
      <Profiler id="nhan" onRender={() => (dem += 1)}>
        <LopNhan nhan={CANH} dangChon={null} dangHover={null} chuSuCoNgoaiKhung={(n) => `${n} sự cố ngoài khung`} />
      </Profiler>,
    );
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);

    const chip = () => document.querySelector('[data-testid="chip-su-co-ngoai-khung"]');
    expect(motNhan(8), "TIỀN ĐỀ: máy sự cố phải đang CÓ nhãn trong khung").not.toBeNull();
    expect(chip(), "TIỀN ĐỀ: chưa có sự cố nào ngoài khung thì chưa được có chip").toBeNull();

    dem = 0;
    // Đẩy nhãn máy 8 vượt mép TRÊN (65 px − 30 khung × 0,1 m × 39,1 px/m ≈ −52 px < 0).
    for (let i = 0; i < 30; i += 1) await quayKhung(store, -0.1);

    expect(chip(), "máy sự cố đã ra ngoài khung mà màn KHÔNG nói gì — ba số đầu đã rơi khỏi chữ ký").not.toBeNull();
    expect(chip()!.getAttribute("data-so")).toBe("1");
    expect(chip()!.textContent).toBe("1 sự cố ngoài khung");
    expect(dem, "chip đổi mà KHÔNG có lượt commit nào ⇒ chip đang in một con số cũ").toBeGreaterThanOrEqual(1);
  });

  it("bớt một nhãn ⇒ có render và DOM còn đúng 2 nhãn", async () => {
    const { ve } = await dungGoc();
    let dem = 0;
    const store = await ve(
      <Profiler id="nhan" onRender={() => (dem += 1)}>
        <LopNhan nhan={BA_NHAN} dangChon={null} dangHover={null} />
      </Profiler>,
    );
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);
    expect(cacNhan()).toHaveLength(3);

    dem = 0;
    await ve(
      <Profiler id="nhan" onRender={() => (dem += 1)}>
        <LopNhan nhan={[BA_NHAN[0], BA_NHAN[2]]} dangChon={null} dangHover={null} />
      </Profiler>,
    );
    await quayKhung(store);

    expect(maMay()).toEqual(["1", "3"]);
    expect(dem, "tập nhãn đổi mà không có lượt commit nào ⇒ lớp đã bị đóng băng").toBeGreaterThanOrEqual(1);
  });

  it("★ thêm một nhãn ⇒ có render và DOM có đủ 4 nhãn", async () => {
    const { ve } = await dungGoc();
    const store = await ve(<LopNhan nhan={BA_NHAN} dangChon={null} dangHover={null} />);
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);
    expect(cacNhan()).toHaveLength(3);

    await ve(<LopNhan nhan={[...BA_NHAN, nhanThe(4, -4)]} dangChon={null} dangHover={null} />);
    await quayKhung(store);
    expect(maMay()).toEqual(["1", "2", "3", "4"]);
  });

  /**
   * ★★★ CÙNG BẪY VỚI `LopCanhBao` (commit `7adc49600`, lỗi CÓ SẴN số 2): nhánh rỗng
   * KHÔNG xoá `chuKyRef`. Với khoá không-toạ-độ, một tập nhãn biến mất rồi QUAY LẠI sinh
   * ĐÚNG chuỗi cũ ⇒ `chuKy === chuKyRef.current` ⇒ `setHienThi` không bao giờ được gọi lại
   * ⇒ nhãn biến mất VĨNH VIỄN trong khi `window.__demNhan.ve` vẫn khai là có vẽ.
   *
   * ⚠ Bẫy này CÓ SẴN từ trước bản vá, không phải do bản vá sinh ra: camera ĐỨNG YÊN thì
   *   `Math.round(x)/(y)` của khoá cũ cũng không đổi, nên bật/tắt bậc mật độ `tat_nhan`
   *   (`matDoKhungHinh`) đã đủ để giết lớp nhãn. Bản vá làm nó xảy ra ở MỌI tư thế camera
   *   chứ không chỉ khi camera đứng yên — nên phải vá kèm.
   */
  it("★★★ `tat` BẬT rồi TẮT lúc camera đứng yên ⇒ nhãn phải QUAY LẠI (nhánh rỗng phải xoá `chuKyRef`)", async () => {
    const { ve } = await dungGoc();
    const store = await ve(<LopNhan nhan={BA_NHAN} dangChon={null} dangHover={null} tat={false} />);
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);
    expect(cacNhan(), "TIỀN ĐỀ: phải có 3 nhãn trước khi tắt").toHaveLength(3);

    await ve(<LopNhan nhan={BA_NHAN} dangChon={null} dangHover={null} tat={true} />);
    await quayKhung(store);
    expect(cacNhan(), "bậc `tat_nhan` phải xoá sạch nhãn").toHaveLength(0);

    // Camera KHÔNG nhúc nhích giữa hai lần — đúng hoàn cảnh người dùng đổi mật độ rồi ngồi im.
    await ve(<LopNhan nhan={BA_NHAN} dangChon={null} dangHover={null} tat={false} />);
    await quayKhung(store);
    await quayKhung(store);
    expect(
      cacNhan(),
      "nhãn KHÔNG quay lại sau khi bật lại — `chuKyRef` giữ chữ ký cũ nên cửa chữ ký đóng vĩnh viễn",
    ).toHaveLength(3);
  });

  /**
   * ★ Khoá state phải mang NỘI DUNG nhãn, không chỉ `khoa` — cùng lớp lỗi mà `LopCanhBao`
   * bắt được ở `muc`/`daAck`/`nhan`: camera đứng yên mà đổi máy đang chọn thì viền nhãn
   * phải đổi NGAY. `chonNhatQuanChiHuy.dom.test.tsx` ghim kết cục ấy ở tầng màn hình;
   * ca này ghim nó ở tầng component, nơi khoá state sống.
   *
   * ★★★ MỘT NHÃN DUY NHẤT, CÓ LÝ DO ĐO ĐƯỢC. Với BA nhãn ca này vẫn xanh kể cả khi khoá
   *   KHÔNG mang `dangChon` — vì `diemUuTienNhan` cộng 3.000.000 cho máy đang chọn nên
   *   `kq.ve` ĐẢO THỨ TỰ, và chính thứ tự ấy làm khoá đổi. Tức ca ba-nhãn "đúng vì một lý
   *   do sai" và sẽ không kêu khi trường `dangChon` bị bỏ khỏi khoá (đã đo: đột biến D chỉ
   *   làm ca `ma`/`phu` đỏ, ca này vẫn xanh). Một nhãn thì không có thứ tự nào để đảo, nên
   *   khẳng định dưới đây nói ĐÚNG về trường `dangChon` trong khoá — và nó mới là chỗ mà
   *   màn Máy (`/twin/may/:id`, một nhãn) thật sự đi qua.
   */
  it("★★★ đổi `dangChon` lúc camera ĐỨNG YÊN, cảnh MỘT nhãn ⇒ viền đổi (khoá phải mang `dangChon`)", async () => {
    const MOT: NhanTheGioi[] = [nhanThe(2, 0)];
    const { ve } = await dungGoc();
    const store = await ve(<LopNhan nhan={MOT} dangChon={null} dangHover={null} />);
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);
    expect(motNhan(2)!.style.border, "TIỀN ĐỀ: chưa chọn thì không được có viền primary").not.toMatch(
      /--primary|#3b82f6/,
    );

    await ve(<LopNhan nhan={MOT} dangChon={2} dangHover={null} />);
    await quayKhung(store);
    expect(motNhan(2)!.style.border, "máy đang chọn mà nhãn không đổi viền ⇒ nội dung nhãn kẹt trong state cũ").toMatch(
      /--primary|#3b82f6/,
    );

    // Và chiều ngược lại: BỎ chọn cũng phải hiện ra ngay.
    await ve(<LopNhan nhan={MOT} dangChon={null} dangHover={null} />);
    await quayKhung(store);
    expect(motNhan(2)!.style.border, "bỏ chọn mà viền primary còn nguyên ⇒ nhãn kẹt ở trạng thái cũ").not.toMatch(
      /--primary|#3b82f6/,
    );
  });

  it("★★★ đổi CHỮ của nhãn (`ma`/`phu`) lúc camera đứng yên ⇒ chữ trên DOM phải đổi", async () => {
    const { ve } = await dungGoc();
    const store = await ve(<LopNhan nhan={[nhanThe(5, 0)]} dangChon={null} dangHover={null} />);
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);
    expect(motNhan(5)!.textContent).toBe("M-5");

    await ve(<LopNhan nhan={[{ ...nhanThe(5, 0), ma: "M-5b", phu: "chạy" }]} dangChon={null} dangHover={null} />);
    await quayKhung(store);
    expect(motNhan(5)!.textContent, "chữ nhãn kẹt ở giá trị cũ ⇒ `ma`/`phu` chưa vào khoá state").toBe("M-5b · chạy");
  });
});
