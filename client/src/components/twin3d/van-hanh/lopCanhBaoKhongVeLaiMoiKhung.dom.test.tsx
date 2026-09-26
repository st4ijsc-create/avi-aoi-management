// @vitest-environment jsdom
//
/**
 * lopCanhBaoKhongVeLaiMoiKhung.dom.test.tsx — ★★★ KÉO XOAY CAMERA KHÔNG ĐƯỢC LÀ MỘT LƯỢT
 * COMMIT REACT CHO TOÀN BỘ DANH SÁCH BADGE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * BỆNH ĐƯỢC GHIM
 * ════════════════════════════════════════════════════════════════════════════
 * `LopCanhBao` chạy `useFrame(tinhLai)`, và cuối `tinhLai` nó so một chuỗi `chuKy` rồi
 * `setHienThi(ve)`. Bản trước bản vá đưa **toạ độ** vào chuỗi ấy:
 *
 *     `${an}|${ve.map(v => `${v.id}:${Math.round(v.x)}:${Math.round(v.y)}:…`).join("|")}`
 *
 * `Math.round(x)` của một badge đổi khi camera xê dịch chưa tới 1/400 chiều ngang khung
 * nhìn ⇒ **mỗi khung kéo xoay là một `setState` ⇒ một lượt reconcile + commit cho CẢ danh
 * sách badge** (và vì `LopCanhBao` render lại thì `<Html>` của drei cũng `root.render()`
 * lại toàn bộ cây DOM con của nó). Tài liệu *performance pitfalls* của chính react-three-
 * fiber gọi đây là sai lầm số một: "never bind a component to state that changes per frame".
 *
 * ⇒ BẤT BIẾN: **vị trí đi qua `ref` vào thẳng node DOM; `setState` chỉ cho TẬP badge.**
 *   Đổi camera N khung ⇒ số lần render KHÔNG tăng theo N. Đổi TẬP badge ⇒ có render.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ THƯỚC ĐO VÀ BẰNG CHỨNG NÓ BIẾT KÊU
 * ════════════════════════════════════════════════════════════════════════════
 * Đếm render bằng `React.Profiler` bọc NGOÀI `<LopCanhBao>` — một cơ chế của React, không
 * đọc bất cứ biến nào của mã đang sửa (không `window.__dem*`, không đếm trong thân
 * component), nên nó không thể tự thoả.
 *
 * ⚠ Một thước "đếm render" mà không bao giờ đếm được gì thì mọi số 0 dưới đây là vô nghĩa
 *   (G5/G139: số 0 phải kèm đối chứng). Vì vậy ca **ĐỐI CHỨNG DƯƠNG** đầu tiên dựng một
 *   component cố tình `setState` mỗi khung trong CÙNG cây R3F và bắt buộc `Profiler` phải
 *   đếm ≥ N. Thước im ở đó ⇒ cả tệp này vô giá trị và ca ấy nói ra điều đó.
 *
 * ⚠ Và một "0 render" cũng vô nghĩa nếu camera không thật sự làm gì: mỗi ca đo camera đều
 *   KIỂM rằng badge ĐÃ DI CHUYỂN THẬT trên DOM (≥ 30 px) trong chính N khung ấy. Không
 *   render mà cũng không nhúc nhích thì đó là lớp chết, không phải bản vá.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HAI BẤT BIẾN CŨ ĐI KÈM — CHÚNG LÀ THỨ DỄ BỊ BẢN VÁ GIẾT NHẤT
 * ════════════════════════════════════════════════════════════════════════════
 * ① "badge VẼ == badge VÀO SỔ" (Đợt 53/55, G136): `ghiHopDaVe` phải chạy **MỖI KHUNG**,
 *    không phải "mỗi lần setState". Nếu ai đó dời lời ghi sổ vào nhánh có `setState`, sổ
 *    sẽ đứng im ở khung đầu trong khi badge chạy theo camera ⇒ `LopNhan` né chỗ theo một
 *    tấm bản đồ cũ. Ca `bomBanSo` dưới đây **đầu độc** sổ giữa chừng rồi bắt một khung
 *    dựng lại — phép thử này chỉ xanh khi lời ghi nằm trên đường chạy của MỌI khung.
 * ② `ghiSoAn` ghi CẢ KHI 0 ("chưa ai ghi" ≠ "ghi 0") — đầu độc y hệt.
 */
import { Profiler, act, useState, type ReactNode } from "react";
import { createRoot, events as taoSuKien, extend, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LOP_BADGE, docHopDaVe, docSoAn, ghiHopDaVe, ghiSoAn } from "../loi/hopDaVe";
import { LopCanhBao, type CanhBaoTheGioi, type WindowCoDoBadge } from "./LopCanhBao";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const KHUNG = { width: 800, height: 600, top: 0, left: 0 };

/** Renderer GIẢ — y hệt `bamNenBoChon.dom.test.tsx` / `chonNhatQuanChiHuy.dom.test.tsx`. */
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

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  extend(THREE as unknown as Parameters<typeof extend>[0]);
});

afterEach(async () => {
  while (donDep.length) await donDep.pop()!();
  document.body.innerHTML = "";
  delete (window as WindowCoDoBadge).__demBadge;
  // Theme là trạng thái TOÀN CỤC (`<html class>`), rò sang ca sau là một lớp lỗi riêng.
  document.documentElement.className = "";
  for (const s of document.querySelectorAll('style[data-thu="theme"]')) s.remove();
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
/* Dụng cụ đọc — KHÔNG đi qua một cửa sổ đo nào của chính `LopCanhBao`          */
/* ═══════════════════════════════════════════════════════════════════════════ */

let dongHo = 1000;
/**
 * Quay MỘT khung, sau khi (tuỳ chọn) xê dịch camera `dx` mét theo trục X.
 *
 * ★ `updateMatrixWorld(true)` là việc mà `OrbitControls`/vòng lặp thật làm trước khi
 *   vẽ; thiếu nó `Vector3.project` đọc ma trận cũ và camera "di chuyển" mà không ai
 *   thấy — tức phép đo tự tạo ra kết luận "0 render" (G5).
 */
async function quayKhung(store: Store, dx = 0) {
  if (dx !== 0) {
    const cam = store.getState().camera;
    cam.position.x += dx;
    cam.updateMatrixWorld(true);
  }
  dongHo += 16;
  await act(async () => {
    store.getState().advance(dongHo);
  });
}

const cacBadge = () =>
  [...document.querySelectorAll<HTMLElement>('[data-testid^="badge-canh-bao-"]')].sort((a, b) =>
    (a.dataset.testid ?? "").localeCompare(b.dataset.testid ?? ""),
  );

const motBadge = (id: number) => document.querySelector<HTMLElement>(`[data-testid="badge-canh-bao-${id}"]`);

/**
 * Vị trí badge ĐỌC TỪ DOM, không phụ thuộc bản vá dùng `left/top` hay `transform`.
 *
 * jsdom không có layout engine nên `getBoundingClientRect()` trả 0 cho mọi phần tử
 * (bẫy đã ghi ở `lopPhuKhongChe.dom.test.tsx`) ⇒ phải đọc chính hai kênh mà mã sản
 * phẩm có thể dùng để đặt badge, và cộng chúng lại: `left/top` (px) + mọi
 * `translate(<px>, <px>)` trong `transform`. `translate(-50%, -50%)` bị bỏ qua vì nó
 * là phép neo TÂM, không phải toạ độ.
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

/** Mũi tên của badge `id` có ĐANG HIỆN không — "không dựng" và "dựng rồi ẩn" cùng nghĩa với người xem. */
function muiTenHien(id: number): boolean {
  const el = document.querySelector<HTMLElement>(`[data-testid="mui-ten-${id}"]`);
  return el !== null && el.style.display !== "none";
}

const cb = (id: number, x: number, muc: CanhBaoTheGioi["muc"] = "red", daAck = false): CanhBaoTheGioi => ({
  id,
  machineId: id,
  viTri: { x, y: 0, z: 0 },
  muc,
  nhan: `AL-${id}`,
  daAck,
});

/**
 * BA cảnh báo dàn ngang, cách nhau 3 m. Với camera mặc định của R3F (fov 75, `position
 * [0,0,5]` — ca nào cũng đẩy về z = 10) và khung 800×600: nửa chiều rộng khung nhìn ở
 * z = 10 là 10·tan(37,5°)·(800/600) ≈ 10,23 m ⇒ ba badge rơi vào x ≈ 283 / 400 / 517 px,
 * hộp rộng 84 px (`RONG_BADGE_SUY_DOAN_PX`, vì jsdom không đo được cỡ thật) ⇒ KHÔNG cặp
 * nào chồng, không badge nào chạm rìa. Tức: tập badge ỔN ĐỊNH suốt quãng kéo camera —
 * điều kiện cần để câu "0 render" nói được về TOẠ ĐỘ chứ không về thứ khác.
 */
const BA_CANH_BAO: readonly CanhBaoTheGioi[] = [cb(1, -3, "red"), cb(2, 0, "yellow"), cb(3, 3, "call")];

/** Đặt camera về chỗ đã tính ở docblock của `BA_CANH_BAO`. */
function datCamera(store: Store) {
  const cam = store.getState().camera;
  cam.position.set(0, 0, 10);
  cam.updateMatrixWorld(true);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Bàn thử ĐỔI THEME                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Bảng biến CSS hai theme, chèn thật vào `<head>`.
 *
 * ★ Đây KHÔNG phải một mô hình: `giaiMauCanh` (`mauTrangThai.ts:334`) đọc bằng
 *   `getComputedStyle(document.documentElement).getPropertyValue(token)`, và jsdom CÓ
 *   phân giải biến CSS qua cascade lớp (đã thử: `:root` cho `#7f0000`, thêm class `dark`
 *   cho `#ff8f8f`). Nên đường đi trong ca này là **đúng đường của sản phẩm**:
 *   class trên `<html>` → biến CSS → `giaiMauCanh` → `mauCss` → `style.background`.
 * ★ Dùng HEX chứ không `oklch()`: `laCuPhapLa` cho `false` ⇒ không phải đi vòng canvas
 *   2D (jsdom không có `getContext`), nên ca này đo phần màu mà không đo nhầm jsdom.
 * ★ `--foreground`/`--background` cũng lật theo theme vì `mauChuTrenNen` chọn màu CHỮ
 *   giữa đúng hai token ấy — lật cả hai thì cả `background` lẫn `color` của badge phải đổi.
 */
const CSS_HAI_THEME = `
:root { --destructive: #7f0000; --destructive-foreground: #ffffff;
        --warning: #7f5500; --warning-foreground: #ffffff;
        --info: #00447f; --info-foreground: #ffffff;
        --foreground: #111111; --background: #ffffff; }
.dark { --destructive: #ff8f8f; --destructive-foreground: #000000;
        --warning: #ffd08f; --warning-foreground: #000000;
        --info: #8fd0ff; --info-foreground: #000000;
        --foreground: #eeeeee; --background: #000000; }
`;

function ganCssTheme(): void {
  const el = document.createElement("style");
  el.dataset.thu = "theme";
  el.textContent = CSS_HAI_THEME;
  document.head.appendChild(el);
}

/** Đổi theme ĐÚNG như `ThemeContext.tsx:38` làm: đổi class trên `documentElement`. */
async function doiSangToi() {
  await act(async () => {
    document.documentElement.classList.remove("light");
    document.documentElement.classList.add("dark");
    // MutationObserver giao callback ở microtask — nhường một nhịp để nó chạy trong `act`.
    await Promise.resolve();
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
/* CA CHÍNH                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ LopCanhBao — kéo camera N khung KHÔNG được sinh N lượt render", () => {
  it("★★★ 30 khung xê dịch camera ⇒ badge DI CHUYỂN THẬT trên DOM mà số render KHÔNG tăng theo N", async () => {
    const { ve } = await dungGoc();
    let dem = 0;
    const store = await ve(
      <Profiler id="badge" onRender={() => (dem += 1)}>
        <LopCanhBao canhBao={BA_CANH_BAO} />
      </Profiler>,
    );
    datCamera(store);
    // Hai khung để lớp hiện ra và ổn định (khung 1 dựng DOM, khung 2 dùng số đo thật nếu có).
    await quayKhung(store);
    await quayKhung(store);

    // TIỀN ĐỀ (G5): có đúng 3 badge trên DOM, nếu không mọi khẳng định dưới nói về cái rỗng.
    expect(cacBadge()).toHaveLength(3);
    const truoc = viTriDom(motBadge(3)!);

    dem = 0;
    const N = 30;
    for (let i = 0; i < N; i += 1) await quayKhung(store, -0.1);

    const sau = viTriDom(motBadge(3)!);
    // ① Camera THẬT SỰ đã làm badge chạy — "0 render" không được mua bằng một lớp đứng im.
    expect(Math.abs(sau.x - truoc.x), `badge không nhúc nhích: ${truoc.x} → ${sau.x}`).toBeGreaterThan(30);
    // ② …mà React KHÔNG commit lại danh sách badge theo từng khung.
    expect(dem, `render ${dem} lần trên ${N} khung — toạ độ vẫn đang đi qua React state`).toBeLessThanOrEqual(1);
    // ③ Tập badge không đổi trong suốt quãng ấy (nếu đổi thì ② nói về một chuyện khác).
    expect(cacBadge()).toHaveLength(3);
    expect(document.querySelector('[data-testid="lop-canh-bao"]')?.getAttribute("data-so-badge")).toBe("3");
  });

  it("★★★ ① 'badge VẼ == badge VÀO SỔ': `ghiHopDaVe` chạy MỖI KHUNG, không phải mỗi `setState`", async () => {
    const { canvas, ve } = await dungGoc();
    let dem = 0;
    const store = await ve(
      <Profiler id="badge" onRender={() => (dem += 1)}>
        <LopCanhBao canhBao={BA_CANH_BAO} />
      </Profiler>,
    );
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);
    expect(docHopDaVe(canvas, LOP_BADGE), "TIỀN ĐỀ: sổ phải có đủ 3 hộp trước khi đo").toHaveLength(3);

    // Sổ phải ĐỔI THEO camera ở TỪNG khung — `LopNhan` chạy sau trong cùng khung và né theo nó.
    dem = 0;
    let soKhungSoDoi = 0;
    let truoc = docHopDaVe(canvas, LOP_BADGE)[0].trai;
    for (let i = 0; i < 20; i += 1) {
      await quayKhung(store, -0.1);
      const nay = docHopDaVe(canvas, LOP_BADGE)[0].trai;
      if (nay !== truoc) soKhungSoDoi += 1;
      truoc = nay;
    }
    expect(soKhungSoDoi, "sổ hộp ĐỨNG IM trong khi badge chạy ⇒ lớp nhãn né theo bản đồ cũ").toBe(20);

    // ★ ĐẦU ĐỘC: xoá trắng đóng góp của lớp badge rồi quay ĐÚNG MỘT khung (không có setState nào).
    //   Sổ phải tự dựng lại — chỉ xanh khi lời ghi nằm trên đường chạy của MỌI khung.
    ghiHopDaVe(canvas, LOP_BADGE, []);
    ghiSoAn(canvas, LOP_BADGE, 99);
    (window as WindowCoDoBadge).__demBadge = undefined;
    await quayKhung(store, -0.1);
    expect(docHopDaVe(canvas, LOP_BADGE), "sổ hộp KHÔNG được dựng lại ở khung không-setState").toHaveLength(3);
    // ② `ghiSoAn` ghi CẢ KHI 0 — "chưa ai ghi" và "ghi 0" phải khác nhau.
    expect(docSoAn(canvas, LOP_BADGE), "số badge bị ẩn không được ghi lại khi nó bằng 0").toBe(0);
    // ③ `window.__demBadge` cũng phải sống lại mỗi khung, đủ MỌI trường e2e đọc.
    const d = (window as WindowCoDoBadge).__demBadge;
    expect(d).toBeDefined();
    expect(Object.keys(d!).sort()).toEqual(
      [
        "biChe",
        "capConChong",
        "doiCho",
        "soAn",
        "soBiChongLap",
        "soVuotTran",
        "soVungCam",
        "tong",
        "tran",
        "ve",
      ].sort(),
    );
    expect(d!.ve).toBe(3);
    expect(d!.tong).toBe(3);
    expect(d!.capConChong).toBe(0);
    expect(dem, "quãng đo này lẽ ra không có lượt commit nào").toBeLessThanOrEqual(1);
  });

  it("★★★ cờ `ngoai-khung`/`doi-cho` + mũi tên đi thẳng vào DOM — đổi được mà KHÔNG cần render", async () => {
    // MỘT cảnh báo ⇒ không có khử chồng badge×badge ⇒ tập badge chắc chắn không đổi,
    // nên mọi thay đổi quan sát được đều thuộc về VỊ TRÍ/CỜ, không thuộc về TẬP.
    const MOT: readonly CanhBaoTheGioi[] = [cb(7, 6, "red")];
    const { ve } = await dungGoc();
    let dem = 0;
    const store = await ve(
      <Profiler id="badge" onRender={() => (dem += 1)}>
        <LopCanhBao canhBao={MOT} />
      </Profiler>,
    );
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);

    expect(motBadge(7), "TIỀN ĐỀ: badge phải có mặt").not.toBeNull();
    expect(motBadge(7)!.getAttribute("data-ngoai-khung")).toBe("0");
    expect(muiTenHien(7), "badge đang trong khung thì KHÔNG có mũi tên chỉ hướng").toBe(false);

    dem = 0;
    for (let i = 0; i < 20; i += 1) await quayKhung(store, -0.25);

    // Alarm đã trôi khỏi mép ⇒ §10.3 luật 3: kẹp về rìa + mũi tên. Không alarm nào biến mất.
    expect(motBadge(7), "badge BIẾN MẤT khi ra ngoài khung — đúng chế độ hỏng luật 3 cấm").not.toBeNull();
    expect(motBadge(7)!.getAttribute("data-ngoai-khung")).toBe("1");
    expect(muiTenHien(7)).toBe(true);
    expect(motBadge(7)!.getAttribute("data-doi-cho")).toBe("0");
    expect(dem, "đổi cờ vẽ mà phải commit lại cả danh sách ⇒ cờ vẫn đang nằm trong state").toBeLessThanOrEqual(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* MẶT KIA CỦA BẤT BIẾN — không render theo khung, NHƯNG phải render theo TẬP  */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ LopCanhBao — TẬP badge đổi thì PHẢI render (bản vá không được là 'đóng băng lớp')", () => {
  it("bớt một cảnh báo ⇒ có render và DOM còn đúng 2 badge", async () => {
    const { ve } = await dungGoc();
    let dem = 0;
    const store = await ve(
      <Profiler id="badge" onRender={() => (dem += 1)}>
        <LopCanhBao canhBao={BA_CANH_BAO} />
      </Profiler>,
    );
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);
    expect(cacBadge()).toHaveLength(3);

    dem = 0;
    await ve(
      <Profiler id="badge" onRender={() => (dem += 1)}>
        <LopCanhBao canhBao={[BA_CANH_BAO[0], BA_CANH_BAO[2]]} />
      </Profiler>,
    );
    await quayKhung(store);

    expect(cacBadge().map((e) => e.dataset.testid)).toEqual(["badge-canh-bao-1", "badge-canh-bao-3"]);
    expect(document.querySelector('[data-testid="lop-canh-bao"]')?.getAttribute("data-so-badge")).toBe("2");
    expect(dem, "tập badge đổi mà không có lượt commit nào ⇒ lớp đã bị đóng băng").toBeGreaterThanOrEqual(1);
  });

  it("★ `daAck` đổi ⇒ viền nét đứt xuất hiện (khoá state phải mang `daAck`, không chỉ `id`)", async () => {
    const { ve } = await dungGoc();
    const store = await ve(<LopCanhBao canhBao={[cb(9, 0, "red", false)]} />);
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);
    expect(motBadge(9)!.getAttribute("data-da-ack")).toBe("0");
    expect(motBadge(9)!.style.outline).not.toContain("dashed");

    await ve(<LopCanhBao canhBao={[cb(9, 0, "red", true)]} />);
    await quayKhung(store);
    expect(motBadge(9)!.getAttribute("data-da-ack")).toBe("1");
    expect(motBadge(9)!.style.outline).toContain("dashed");
  });

  /**
   * ★★★ HỒI QUY DO CHÍNH BẢN VÁ PH-55 MỞ RA — và nó có THẬT, không phải giả định.
   *
   * `mauCss`/`mauChuTrenNen` đọc biến CSS của `<html>` **trong thân render**. Trước PH-55,
   * lớp badge render lại mỗi khung nên đổi theme tự lành sau ~16 ms; sau PH-55 nó chỉ render
   * khi TẬP badge đổi, mà `ThemeContext.tsx:38` đổi theme bằng `root.classList.add("dark")` —
   * một thao tác KHÔNG chạm tới `canhBao`, KHÔNG xin khung (`frameloop="demand"`). ⇒ badge
   * giữ nguyên màu của theme cũ vô thời hạn: nền sáng của theme sáng nằm dưới màu chữ của
   * theme sáng trên nền tối, đúng thứ mà ba vòng đo WCAG của Đợt 57 vừa loại bỏ.
   *
   * Ca này ghim CẢ HAI chiều trong một mạch, vì tách ra thì mỗi nửa đều dễ thoả một cách
   * rỗng: (+) đổi class ⇒ ĐÚNG MỘT lượt render và màu đổi thật; (−) 30 khung xê dịch camera
   * NGAY SAU ĐÓ ⇒ render vẫn ≤ 1 (bản vá theme không được mua bằng cách trả lại tật cũ).
   */
  it("★★★ đổi theme lúc camera ĐỨNG YÊN ⇒ ĐÚNG MỘT render + badge đổi màu; rồi 30 khung camera vẫn ≤ 1", async () => {
    ganCssTheme();
    const { ve } = await dungGoc();
    let dem = 0;
    const store = await ve(
      <Profiler id="badge" onRender={() => (dem += 1)}>
        <LopCanhBao canhBao={BA_CANH_BAO} />
      </Profiler>,
    );
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);

    const lop = () => document.querySelector('[data-testid="lop-canh-bao"]');
    const nenTruoc = motBadge(1)!.style.background;
    const chuTruoc = motBadge(1)!.style.color;
    // TIỀN ĐỀ (G5): biến CSS phải THẬT SỰ tới được badge, nếu không "màu đổi" là câu nói suông.
    expect(nenTruoc, "biến CSS không tới được badge ⇒ ca này không đo gì").not.toBe("");
    expect(chuTruoc).not.toBe("");
    // Đọc TRƯỚC, khẳng định SAU: khẳng định về kết cục người dùng (màu) phải là khẳng định
    // vỡ ĐẦU TIÊN, nếu không bằng chứng "đỏ trước khi sửa" chỉ nói về một thuộc tính mới.
    const themeKhai = lop()?.getAttribute("data-theme");

    // (+) CHỈ đổi class trên <html>. Không quay khung nào: camera đứng yên, `frameloop="demand"`
    //     không tự xin khung — đúng hoàn cảnh người dùng bấm nút đổi theme rồi ngồi im.
    dem = 0;
    await doiSangToi();

    expect(motBadge(1)!.style.background, "nền badge KẸT ở màu theme cũ").not.toBe(nenTruoc);
    expect(motBadge(1)!.style.color, "màu chữ badge KẸT ở màu theme cũ").not.toBe(chuTruoc);
    expect(dem, "đổi theme phải là ĐÚNG MỘT lượt commit — không 0 (kẹt màu), không nhiều hơn").toBe(1);
    // Cửa sổ đo: lớp phải KHAI theme nó đang vẽ theo, ở cả hai chiều.
    expect(themeKhai, "lớp badge chưa khai theme nó đang vẽ theo").toBe("light");
    expect(lop()?.getAttribute("data-theme")).toBe("dark");

    // (−) …và bất biến cũ không được vỡ để đổi lấy điều trên.
    const xTruoc = viTriDom(motBadge(3)!).x;
    dem = 0;
    for (let i = 0; i < 30; i += 1) await quayKhung(store, -0.1);
    expect(Math.abs(viTriDom(motBadge(3)!).x - xTruoc)).toBeGreaterThan(30);
    expect(dem, "theo dõi theme đã kéo toạ độ trở lại đường React").toBeLessThanOrEqual(1);
  });

  it("★ `soAn` là một phần của trạng thái đọc được: trần 2 trên 3 cảnh báo ⇒ `data-so-an=\"1\"`", async () => {
    const { canvas, ve } = await dungGoc();
    const store = await ve(<LopCanhBao canhBao={BA_CANH_BAO} tran={2} />);
    datCamera(store);
    await quayKhung(store);
    await quayKhung(store);
    const lop = document.querySelector('[data-testid="lop-canh-bao"]');
    expect(lop?.getAttribute("data-so-badge")).toBe("2");
    expect(lop?.getAttribute("data-so-an")).toBe("1");
    expect(docSoAn(canvas, LOP_BADGE)).toBe(1);
  });
});
