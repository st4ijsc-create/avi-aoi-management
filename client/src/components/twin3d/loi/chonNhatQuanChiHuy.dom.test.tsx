// @vitest-environment jsdom
//
/**
 * chonNhatQuanChiHuy.dom.test.tsx — ★★★ PH-42: BA BỀ MẶT CHỌN CỦA `/factory-command`
 * KHÔNG ĐƯỢC NÓI HAI ĐIỀU KHÁC NHAU.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * BỆNH — MỘT CÚ BẤM, HAI CÂU TRẢ LỜI
 * ════════════════════════════════════════════════════════════════════════════
 * `CanhNhaMay.tsx` nối cảnh vào trang như sau (trước bản vá):
 *
 *     onChon={(id) => { setChon((tt) => apClick(tt, id)); if (id != null) onSelect(id); }}
 *
 * `chonVatThe.apClick` trả `dangChon: null` ở **HAI** nhánh — bấm nền (`:77`) và bấm
 * LẠI đúng máy đang chọn (`:78`). Cả hai nhánh đều **không** báo lên trang: nhánh
 * nền vì `id == null` bị chặn, nhánh toggle vì `onSelect(id)` gửi lại CHÍNH id cũ.
 * Kết quả: `chon.dangChon` (nhấn sáng trong lô) về `null` trong khi `selectedId`
 * của trang giữ nguyên — mà `<VienChon>` và `<LopNhan>` lại đọc `selectedId`.
 * ⇒ **nhấn sáng tắt, viền trắng và nhãn vẫn chỉ vào máy cũ, ngăn chi tiết vẫn mở.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO LƯỚI NÀY Ở TẦNG COMPONENT, KHÔNG Ở TẦNG MÀN HÌNH
 * ════════════════════════════════════════════════════════════════════════════
 * Đo sống trên trình duyệt thật (cổng 3064, `dist-ph42t`, `qatd_giamdoc`, 1.108 máy)
 * cho một kết quả **không ai đoán trước**: trên `/factory-command` bệnh **KHÔNG tái
 * hiện được** — không phải vì cảnh đúng, mà vì cú bấm KHÔNG BAO GIỜ TỚI ĐƯỢC CẢNH.
 * `FactoryCommandView.tsx:639` mở một `<Sheet>` (Radix Dialog, `modal` mặc định) ngay
 * khi `selectedId != null`, và `sheet-overlay` là `fixed inset-0 z-50` phủ kín canvas:
 *
 *   | bước                                   | `document.elementFromPoint` tại tâm máy |
 *   |----------------------------------------|------------------------------------------|
 *   | chưa chọn gì                           | `CANVAS`                                 |
 *   | sau khi chọn một máy                   | `DIV[data-slot=sheet-overlay]`           |
 *   | sau cú bấm kế (chỉ đóng Sheet)         | `CANVAS`                                 |
 *
 * ⇒ Khi canvas bấm được thì **không có gì đang chọn**, nên `apClick` luôn đi nhánh
 *   thứ ba (`dangChon: machineId`). Hai nhánh `null` là **mã không tới được** trên màn
 *   ấy. Thứ che bệnh là một lớp phủ của TRANG, không phải một tính chất của CẢNH —
 *   một tai nạn, không phải một bảo đảm: bỏ `modal`, đổi Sheet thành panel không phủ,
 *   hay chỉ cần thêm một màn thứ hai dùng `CanhNhaMay` là bệnh sống lại ngay.
 *
 * Nên lưới phải ghim **hợp đồng của component**: *cảnh không bao giờ vẽ một trạng
 * thái chọn mâu thuẫn với trạng thái chọn mà người gọi đang giữ*. Đo ở tầng màn hình
 * thì ca nào cũng xanh — và xanh vì lý do không liên quan đến thứ đang đo (G146).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * BA PHÉP ĐỌC ĐỘC LẬP — KHÔNG DỰA VÀO MỘT CỬA SỔ ĐO DUY NHẤT
 * ════════════════════════════════════════════════════════════════════════════
 * ① `window.__demChonChiHuy()` — bốn số do CHÍNH biểu thức JSX cấp (`CanhNhaMay.tsx`).
 * ② Cây cảnh — `THREE.LineSegments` của `<VienChon>`: vị trí của nó nói viền đang ôm
 *    máy nào; **không** có viền là một câu trả lời hợp lệ (`null`).
 * ③ DOM — `[data-testid=nhan-may-twin3d]` của `<LopNhan>`: nhãn nào mang viền primary.
 * Ba nguồn ấy phải đồng ý với nhau; ② và ③ không đọc qua ① nên ① không thể tự thoả.
 */
import { act, useState, type ReactNode } from "react";
import { createRoot, events as taoSuKien, extend } from "@react-three/fiber";
import * as THREE from "three";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { docMaNguon } from "@shared/testing/docMaNguon";

import { NoiDungCanh, type CuaSoDoChonChiHuy } from "./CanhNhaMay";
import { resolveLayout, type MachineNode, type PlacedMachine } from "../../factory-scene/sceneTypes";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const KHUNG = { width: 800, height: 600, top: 0, left: 0 };
const GOC = resolve(import.meta.dirname, "..", "..", "..", "..", "..");

/** Renderer GIẢ — y hệt `bamNenBoChon.dom.test.tsx` / `loBatchMay.dom.test.tsx`. */
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
  const huy = async () => {
    await act(async () => {
      root.unmount();
    });
    canvas.remove();
  };
  return { canvas, ve, huy };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Dữ liệu cảnh                                                                */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠ `resolveLayout:202` coi `positionX === 0 && positionZ === 0` là "CHƯA đặt chỗ" và
 *   rải máy lên lưới hàng/cột. Nên mọi máy ở đây phải có toạ độ khác 0, nếu không bố
 *   cục không còn là thứ ta tưởng và điểm bấm trượt khỏi khối.
 */
const may = (id: number, x: number): MachineNode => ({
  id,
  code: `M-${id}`,
  name: `May ${id}`,
  machineType: "AOI",
  lineId: 1,
  lineName: "L1",
  status: "running",
  oeePercent: 80,
  positionX: x,
  positionY: 0,
  positionZ: 0.001,
  width: 1,
  height: 1,
  depth: 1,
  rotation: 0,
  andonActive: false,
  pdmRiskHigh: false,
});

const MAY = [may(201, -2), may(202, 2), may(203, 3.5)];
const BO_CUC = resolveLayout(MAY);
const datCho = (id: number): PlacedMachine => {
  const p = BO_CUC.placed.find((x) => x.node.id === id);
  if (!p) throw new Error(`không có máy ${id} trong bố cục`);
  return p;
};

/** Pixel canvas của một điểm thế giới theo camera của store. */
function pxCua(store: Store, diem: THREE.Vector3) {
  const st = store.getState();
  st.scene.updateMatrixWorld(true);
  st.camera.updateMatrixWorld(true);
  const v = diem.clone().project(st.camera);
  return { x: ((v.x + 1) / 2) * KHUNG.width, y: ((1 - v.y) / 2) * KHUNG.height };
}

const tamKhoi = (id: number) => {
  const p = datCho(id);
  return new THREE.Vector3(p.x, p.y + p.h * 0.5, p.z);
};

/** Sự kiện DOM giả đủ trường R3F đọc. */
function suKien(canvas: HTMLCanvasElement, x: number, y: number, type: string) {
  return {
    type,
    offsetX: x,
    offsetY: y,
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    target: canvas,
    currentTarget: canvas,
    stopPropagation() {},
    preventDefault() {},
  } as unknown as PointerEvent;
}

async function bam(store: Store, canvas: HTMLCanvasElement, diem: { x: number; y: number }) {
  const h = store.getState().events.handlers!;
  await act(async () => {
    h.onPointerDown(suKien(canvas, diem.x, diem.y, "pointerdown"));
  });
  await act(async () => {
    h.onPointerUp(suKien(canvas, diem.x, diem.y, "pointerup"));
    h.onClick(suKien(canvas, diem.x, diem.y, "click") as unknown as MouseEvent);
  });
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* MÀN CHỈ HUY — nối Y NGUYÊN `FactoryCommandView.tsx:365 + :521-522`          */
/* ─────────────────────────────────────────────────────────────────────────── */

interface SoTay {
  /** Mọi đối số `onSelect` đã nhận — tách "không gọi" khỏi "gọi mà không đổi". */
  doiSo: Array<number | null>;
}

function ManChiHuy({ banDau, soTay }: { banDau: number | null; soTay: SoTay }) {
  // `FactoryCommandView.tsx:221` — trang SỞ HỮU `selectedId`; `:639` mở ngăn chi
  // tiết theo đúng biến này, `:599` tô vòng ở rail phải cũng vậy.
  const [selectedId, setSelectedId] = useState<number | null>(banDau);
  return (
    <NoiDungCanh
      machines={MAY}
      selectedId={selectedId}
      onSelect={(id) => {
        soTay.doiSo.push(id as number | null);
        setSelectedId(id as number | null);
      }}
      overlay="status"
      focusId={null}
      theme="light"
      nhanTrangThai={(p) => p.node.status}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* BA PHÉP ĐỌC                                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

/** ① cửa sổ đo của sản phẩm. */
function docCuaSo() {
  const w = window as CuaSoDoChonChiHuy;
  const f = w.__demChonChiHuy;
  expect(f, "cửa sổ đo phải được gắn — không có nó thì mọi ca dưới đây không đo gì").toBeTypeOf(
    "function",
  );
  return f!();
}

/**
 * ② Viền `<VienChon>` đang ôm máy nào, đọc TỪ CÂY CẢNH.
 *
 * `taoVienHopBao` đặt viền tại `(may.x, may.y + may.h/2, may.z)`, nên so vị trí với
 * tâm khối của từng máy là phép nhận dạng chứ không phải phép đếm.
 */
function mayCuaVien(store: Store): number | null {
  const st = store.getState();
  const vien: THREE.LineSegments[] = [];
  st.scene.traverse((o) => {
    if ((o as THREE.LineSegments).isLineSegments) vien.push(o as THREE.LineSegments);
  });
  expect(vien.length, "nhiều hơn MỘT viền chọn là một lỗi khác").toBeLessThanOrEqual(1);
  if (vien.length === 0) return null;
  const p = vien[0].position;
  const khop = BO_CUC.placed.find(
    (m) => Math.abs(m.x - p.x) < 1e-6 && Math.abs(m.z - p.z) < 1e-6 && Math.abs(m.y + m.h / 2 - p.y) < 1e-6,
  );
  expect(khop, `viền ở (${p.x}, ${p.y}, ${p.z}) không ôm máy nào trong bố cục`).toBeTruthy();
  return khop!.node.id;
}

/** ③ Nhãn nào mang viền `--primary` — đọc TỪ DOM. */
function mayCuaNhan(): { chon: number[]; tong: number } {
  const ds = [...document.querySelectorAll("[data-testid='nhan-may-twin3d']")] as HTMLElement[];
  const chon = ds
    .filter((e) => /--primary|#3b82f6/.test(e.style.border))
    .map((e) => Number(e.getAttribute("data-machine-id")));
  return { chon, tong: ds.length };
}

/**
 * ★ `LopNhan` chiếu toạ độ nhãn TRONG `useFrame`, nên với `frameloop: "never"` DOM
 *   nhãn vĩnh viễn rỗng và phép đọc ③ sẽ "xanh" bằng cách không đo gì. Quay tay vài
 *   khung: khung đầu dựng div bằng bề rộng ƯỚC LƯỢNG, khung sau khử chồng lấp trên
 *   số đo THẬT (xem docblock `LopNhan.tsx`, chỗ `ref` đo `getBoundingClientRect`).
 */
async function veKhung(store: Store, so = 3) {
  for (let i = 0; i < so; i += 1) {
    await act(async () => {
      store.getState().advance(1000 + i * 16);
    });
  }
}

/** Gộp ba phép đọc thành MỘT câu "màn hình đang nói gì". */
async function manHinhDangNoi(store: Store) {
  await veKhung(store);
  const cua = docCuaSo();
  const noi = {
    trang: cua.trang,
    nhanSang: cua.nhanSang,
    vienCuaSo: cua.vien,
    nhanCuaSo: cua.nhan,
    vienCayCanh: mayCuaVien(store),
    nhanDom: mayCuaNhan(),
  };
  // ★ `PH42_IN=1` in ĐỦ SÁU số mỗi lần đọc. Khẳng định cứng dừng ở số SAI đầu tiên,
  //   nên khi chép mốc ĐỎ vào sổ ta cần thấy cả sáu, không chỉ cái đầu tiên vỡ.
  if (process.env.PH42_IN) console.log("[ph42]", JSON.stringify(noi));
  return noi;
}

/* ─────────────────────────────────────────────────────────────────────────── */

const doiHuy: Array<() => Promise<void>> = [];
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  extend(THREE as unknown as Parameters<typeof extend>[0]);
});
afterEach(async () => {
  while (doiHuy.length) await doiHuy.pop()!();
  document.body.innerHTML = "";
});

/** Góc trên-trái canvas — mỗi ca vẫn tự KIỂM là điểm ấy không trúng vật thể nào. */
const DIEM_NEN = { x: 3, y: 3 };

function kiemDiemLaNen(store: Store, diem: { x: number; y: number }) {
  const st = store.getState();
  st.scene.updateMatrixWorld(true);
  st.raycaster.setFromCamera(
    new THREE.Vector2((diem.x / KHUNG.width) * 2 - 1, 1 - (diem.y / KHUNG.height) * 2),
    st.camera,
  );
  expect(
    st.raycaster.intersectObjects([...st.internal.interaction], true),
    "điểm 'nền' mà lại trúng vật thể thì ca vô nghĩa",
  ).toHaveLength(0);
}

async function dungMan(banDau: number | null) {
  const g = await dungGoc();
  doiHuy.push(g.huy);
  const soTay: SoTay = { doiSo: [] };
  const store = await g.ve(<ManChiHuy banDau={banDau} soTay={soTay} />);
  // TIỀN ĐỀ: cảnh có lô máy tương tác được — nếu không, mọi ca "bấm" là xanh giả.
  expect(store.getState().internal.interaction.length).toBeGreaterThan(0);
  expect(MAY).toHaveLength(3);
  return { g, store, soTay };
}

describe("PH-42 · ba bề mặt chọn của `/factory-command` phải nói MỘT điều", () => {
  it("N0 ĐỐI CHỨNG DƯƠNG — đường sự kiện còn sống: bấm TRÚNG khối ⇒ cả ba bề mặt cùng chỉ vào máy ấy", async () => {
    const { g, store, soTay } = await dungMan(null);

    await bam(store, g.canvas, pxCua(store, tamKhoi(202)));

    expect(soTay.doiSo, "nếu ca này rỗng thì mọi ca dưới đây xanh vì KHÔNG CÓ GÌ XẢY RA").toEqual([
      202,
    ]);
    const noi = await manHinhDangNoi(store);
    expect(noi.trang).toBe(202);
    expect(noi.nhanSang).toBe(202);
    expect(noi.vienCayCanh).toBe(202);
    expect(noi.nhanDom.chon).toEqual([202]);
  });

  it("★★★ N1 — bấm NỀN khi đang chọn một máy ⇒ nhấn sáng, viền và nhãn KHÔNG được nói khác trang", async () => {
    const { g, store, soTay } = await dungMan(null);
    await bam(store, g.canvas, pxCua(store, tamKhoi(202)));
    expect((await manHinhDangNoi(store)).nhanSang, "tiền đề: phải ĐANG chọn 202").toBe(202);
    kiemDiemLaNen(store, DIEM_NEN);
    soTay.doiSo.length = 0;

    await bam(store, g.canvas, DIEM_NEN);

    const noi = await manHinhDangNoi(store);
    expect(noi.nhanSang, "nhấn sáng tắt ⇒ hai bề mặt kia phải tắt theo").toBeNull();
    expect(noi.trang, "trang phải được báo là KHÔNG còn máy nào được chọn").toBeNull();
    expect(noi.vienCayCanh, "viền trắng còn ôm máy cũ trong khi nhấn sáng đã tắt").toBeNull();
    expect(noi.nhanDom.chon, "nhãn còn viền primary trong khi nhấn sáng đã tắt").toEqual([]);
    expect(soTay.doiSo, "cảnh phải báo ĐÚNG MỘT lần `null` lên trang").toEqual([null]);
  });

  it("★★★ N2 — bấm LẠI đúng máy đang chọn (nhánh toggle `apClick:78`) cũng phải nhất quán", async () => {
    const { g, store, soTay } = await dungMan(null);
    await bam(store, g.canvas, pxCua(store, tamKhoi(202)));
    expect((await manHinhDangNoi(store)).nhanSang, "tiền đề: phải ĐANG chọn 202").toBe(202);
    soTay.doiSo.length = 0;

    await bam(store, g.canvas, pxCua(store, tamKhoi(202)));

    const noi = await manHinhDangNoi(store);
    expect(noi.nhanSang, "`apClick` bỏ chọn khi bấm lại — đó là luật của kit").toBeNull();
    expect(noi.trang, "trang phải theo cùng quyết định ấy").toBeNull();
    expect(noi.vienCayCanh).toBeNull();
    expect(noi.nhanDom.chon).toEqual([]);
    expect(soTay.doiSo, "nhánh toggle phải báo `null`, KHÔNG báo lại chính id cũ").toEqual([null]);
  });

  it("N3 — bấm sang MÁY KHÁC: cả ba bề mặt chuyển sang máy mới, không ai ở lại máy cũ", async () => {
    const { g, store, soTay } = await dungMan(null);
    await bam(store, g.canvas, pxCua(store, tamKhoi(202)));
    soTay.doiSo.length = 0;

    await bam(store, g.canvas, pxCua(store, tamKhoi(201)));

    const noi = await manHinhDangNoi(store);
    expect(soTay.doiSo).toEqual([201]);
    expect(noi.trang).toBe(201);
    expect(noi.nhanSang).toBe(201);
    expect(noi.vienCayCanh).toBe(201);
    expect(noi.nhanDom.chon).toEqual([201]);
  });

  it("N4 KHÔNG PHÁ — chiều DOM→3D: trang tự đặt `selectedId` (rail phải) ⇒ cảnh theo, không cần cú bấm nào", async () => {
    const { g, store, soTay } = await dungMan(203);
    // Không bấm gì cả: đây là đường `FactoryCommandView.tsx:595` (bấm dòng vấn đề).
    expect(soTay.doiSo, "không cú bấm nào ⇒ cảnh không được tự báo ngược lên trang").toEqual([]);
    const noi = await manHinhDangNoi(store);
    expect(noi.trang).toBe(203);
    expect(noi.nhanSang, "hiệu ứng đồng bộ `selectedId → chon.dangChon` phải chạy").toBe(203);
    expect(noi.vienCayCanh).toBe(203);
    expect(noi.nhanDom.chon).toEqual([203]);
    expect(g.canvas.isConnected).toBe(true);
  });

  it("N5 NGUỒN — `CanhNhaMay` có ĐÚNG MỘT người dùng, nên bản vá không thể rò sang màn khác", () => {
    const goc = resolve(GOC, "client/src");
    const duyet = (thuMuc: string): string[] =>
      readdirSync(thuMuc, { withFileTypes: true }).flatMap((m) => {
        const duong = resolve(thuMuc, m.name);
        if (m.isDirectory()) return duyet(duong);
        if (!/\.tsx?$/.test(m.name) || /\.test\.tsx?$/.test(m.name)) return [];
        return [duong];
      });
    const tep = duyet(goc);
    // Tập rỗng là HỎNG: census không đọc được tệp nào thì nó không chứng minh gì.
    expect(tep.length).toBeGreaterThan(500);

    const nhapKit = tep.filter((p) => /from "@\/components\/twin3d\/loi"/.test(docMaNguon(p)));
    const dungCanhNhaMay = nhapKit
      .filter((p) => /\bCanhNhaMay\b/.test(docMaNguon(p)))
      .map((p) => p.slice(goc.length + 1).replace(/\\/g, "/"));
    expect(
      dungCanhNhaMay,
      "sổ PH-42 chép rằng CanhThietKe/CanhVanHanh/CanhVanHanh2D cũng dùng — census nói KHÔNG: ba tệp ấy chỉ NHẮC TÊN trong docblock",
    ).toEqual(["pages/FactoryCommandView.tsx"]);

    // ★ Trang vẫn phải là nơi GIỮ `selectedId` (nếu ai đó dời quyền sở hữu sang cảnh,
    //   lưới hành vi ở trên vẫn xanh mà hợp đồng đã khác hẳn).
    const trang = docMaNguon(resolve(goc, "pages/FactoryCommandView.tsx"));
    expect(trang).toContain("const [selectedId, setSelectedId] = useState<number | null>(null);");
    expect(trang).toContain("<Sheet open={selectedId != null}");
  });
});
