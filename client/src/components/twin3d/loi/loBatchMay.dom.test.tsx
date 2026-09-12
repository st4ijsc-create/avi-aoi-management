// @vitest-environment jsdom
//
/**
 * loBatchMay.dom.test.tsx — ★★★ ĐỢT 47 (N2): HANDLER CÒN SỐNG SAU KHI LÔ ĐỔI — đo trên RECONCILER R3F THẬT.
 *
 * QA Đợt 46: bấm/rê máy trên `/twin` và `/twin/line/2` không phản ứng; 46 đợt không ai bấm lên cảnh
 * (G123). Gốc rễ (docblock `LoBatchMay.tsx`): R3F 9.5 `swapInstances` bỏ rơi handler khi
 * `<primitive object>` đổi lô. Một lưới mock `useThree` KHÔNG thấy được điều đó — lỗi nằm TRONG
 * reconciler. Nên tệp này dựng `createRoot(canvas)` của R3F thật trong jsdom với `gl` GIẢ (không
 * WebGL: raycast / BatchedMesh / three là toán thuần), rồi đẩy sự kiện qua ĐÚNG đường R3F đi khi có
 * click DOM (`state.events.handlers.onPointerDown/onClick/onPointerMove` — raycast trên
 * `internal.interaction`, nổi bọt, `initialHits`, `e.delta`).
 *
 * BA TẦNG:
 *   T1 — `LoBatchMay`: mount lô RỖNG → đổi sang lô CÓ MÁY (đúng đường `/twin` đi mỗi lần mở) → bấm
 *        tâm máy ⇒ `onChon(machineId)`; đổi lô lần nữa (thêm máy) ⇒ vẫn chọn đúng máy mới; kéo 50 px
 *        ⇒ KHÔNG chọn; rê ⇒ `onHover(id)`, rời ⇒ `onHover(null)`.
 *   T2 — bất biến trên store: mọi object trong `internal.interaction` CÒN handler và CÒN trong scene.
 *   T3 — ĐỐI CHỨNG (ca dương đã biết, để lưới này biết KÊU): `<primitive object onClick>` đổi object
 *        ⇒ object cũ nằm lại `interaction` không `__r3f`, object mới vắng ⇒ bấm KHÔNG tới. Nếu ca này
 *        ĐỎ sau khi nâng R3F: cơ chế swap đã đổi — đọc lại docblock `LoBatchMay` trước khi bỏ nhóm
 *        bọc; KHÔNG nới ca.
 */
import { act, type ReactNode } from "react";
import { createRoot, events as taoSuKien, extend } from "@react-three/fiber";
import * as THREE from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { LoBatchMay, TEN_LO_MAY, TEN_NHOM_SU_KIEN_LO_MAY, type MayTrongLo } from "./LoBatchMay";
import { TRANG_THAI_CHON_RONG } from "./chonVatThe";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const KHUNG = { width: 800, height: 600, top: 0, left: 0 };

/** Renderer GIẢ: R3F chỉ cần `render` để nhận là renderer (`isRenderer = def => !!def?.render`) + vài no-op. */
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

/** Máy hộp 1×1×1 m (chiHopBao ⇒ BoxGeometry đơn vị), đáy tại `viTri`. */
const may = (machineId: number, x: number): MayTrongLo => ({
  machineId,
  khoi: "ban_test",
  kichThuocMm: { rongMm: 1000, caoMm: 1000, sauMm: 1000 },
  viTri: { x, y: 0, z: 0 },
  gocXoayRad: 0,
  mau: "#ff0000",
});

/** Pixel canvas của một điểm thế giới theo camera của store (ma trận cập nhật tay — không có vòng render). */
function pxCua(store: Store, diem: THREE.Vector3) {
  const st = store.getState();
  st.scene.updateMatrixWorld(true);
  st.camera.updateMatrixWorld(true);
  const v = diem.clone().project(st.camera);
  return { x: ((v.x + 1) / 2) * KHUNG.width, y: ((1 - v.y) / 2) * KHUNG.height };
}

/** Sự kiện DOM giả đủ trường R3F đọc (`offsetX/Y`, pointerId, button…). */
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

function bam(store: Store, canvas: HTMLCanvasElement, xuong: { x: number; y: number }, len = xuong) {
  const h = store.getState().events.handlers!;
  h.onPointerDown(suKien(canvas, xuong.x, xuong.y, "pointerdown"));
  h.onPointerUp(suKien(canvas, len.x, len.y, "pointerup"));
  h.onClick(suKien(canvas, len.x, len.y, "click") as unknown as MouseEvent);
}

function re(store: Store, canvas: HTMLCanvasElement, p: { x: number; y: number }) {
  store.getState().events.handlers!.onPointerMove(suKien(canvas, p.x, p.y, "pointermove"));
}

const doiHuy: Array<() => Promise<void>> = [];
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // Ngoài `<Canvas>` (bản CJS của R3F trong vitest) catalogue phần tử trống — `<group>` cần THREE đăng ký tay.
  // Cùng instance `three` với BatchedMesh của LoBatchMay (ESM), nên object tạo ra đồng nhất với lô.
  extend(THREE as unknown as Parameters<typeof extend>[0]);
});
afterEach(async () => {
  while (doiHuy.length) await doiHuy.pop()!();
});

describe("LoBatchMay trên reconciler R3F thật — Đợt 47 N2", () => {
  it("T1 — lô RỖNG → lô CÓ MÁY: bấm tâm máy ⇒ onChon(machineId); đổi lô lần nữa vẫn chọn đúng; kéo ⇒ không; rê ⇒ hover", async () => {
    const g = await dungGoc();
    doiHuy.push(g.huy);
    const onChon = vi.fn();
    const onHover = vi.fn();
    const ui = (ds: MayTrongLo[]) => (
      <LoBatchMay may={ds} chon={TRANG_THAI_CHON_RONG} onChon={onChon} onHover={onHover} chiHopBao />
    );

    // 1) mount với lô RỖNG — đúng khung đầu của /twin khi truy vấn chưa về.
    const store = await g.ve(ui([]));
    const st = store.getState();
    const nhom0 = st.scene.getObjectByName(TEN_NHOM_SU_KIEN_LO_MAY);
    expect(nhom0, "nhóm bọc mang handler phải có trong scene").toBeTruthy();
    expect(st.internal.interaction).toContain(nhom0);

    // 2) dữ liệu về ⇒ lô MỚI (swap <primitive object>).
    await g.ve(ui([may(101, 0)]));
    const lo1 = st.scene.getObjectByName(TEN_LO_MAY) as THREE.BatchedMesh;
    expect(lo1.instanceCount).toBe(1);
    expect(lo1.parent, "lô mới nằm dưới nhóm bọc").toBe(nhom0);

    // 3) bấm TÂM máy (0, 0.5, 0) ⇒ chọn máy 101.
    const p1 = pxCua(store, new THREE.Vector3(0, 0.5, 0));
    bam(store, g.canvas, p1);
    expect(onChon).toHaveBeenCalledTimes(1);
    expect(onChon).toHaveBeenLastCalledWith(101);

    // 4) lô đổi LẦN NỮA (thêm máy 102 tại x=2) ⇒ bấm máy mới vẫn tới.
    await g.ve(ui([may(101, 0), may(102, 2)]));
    const lo2 = st.scene.getObjectByName(TEN_LO_MAY) as THREE.BatchedMesh;
    expect(lo2).not.toBe(lo1);
    expect(lo2.instanceCount).toBe(2);
    const p2 = pxCua(store, new THREE.Vector3(2, 0.5, 0));
    bam(store, g.canvas, p2);
    expect(onChon).toHaveBeenLastCalledWith(102);
    bam(store, g.canvas, p1);
    expect(onChon).toHaveBeenLastCalledWith(101);
    expect(onChon).toHaveBeenCalledTimes(3);

    // 5) KÉO: pointerdown trên máy, click cách 50 px ⇒ R3F e.delta = 50 ⇒ không chọn.
    bam(store, g.canvas, p1, { x: p1.x + 50, y: p1.y });
    expect(onChon).toHaveBeenCalledTimes(3);

    // 6) RÊ lên máy ⇒ onHover(101); rời ra chỗ trống ⇒ onHover(null).
    re(store, g.canvas, p1);
    expect(onHover).toHaveBeenLastCalledWith(101);
    re(store, g.canvas, { x: 5, y: 5 });
    expect(onHover).toHaveBeenLastCalledWith(null);

    // 7) bấm chỗ trống ⇒ không gọi onChon (không có "chọn null" giả).
    bam(store, g.canvas, { x: 5, y: 5 });
    expect(onChon).toHaveBeenCalledTimes(3);
  });

  it("T2 — bất biến: mọi object trong internal.interaction còn handler và còn trong scene, qua 3 lần đổi lô", async () => {
    const g = await dungGoc();
    doiHuy.push(g.huy);
    const ui = (ds: MayTrongLo[]) => (
      <LoBatchMay may={ds} chon={TRANG_THAI_CHON_RONG} onChon={() => {}} onHover={() => {}} chiHopBao />
    );
    const store = await g.ve(ui([]));
    for (const ds of [[may(1, 0)], [may(1, 0), may(2, 2)], [may(2, 2)]]) {
      await g.ve(ui(ds));
      const st = store.getState();
      const inter = st.internal.interaction;
      expect(inter.length).toBeGreaterThanOrEqual(1);
      for (const o of inter) {
        const r3f = (o as unknown as { __r3f?: { eventCount?: number } }).__r3f;
        expect(r3f?.eventCount ?? 0, `object ${o.name || o.type} trong interaction phải còn handler`).toBeGreaterThan(0);
        let p: THREE.Object3D = o;
        while (p.parent) p = p.parent;
        expect(p, `object ${o.name || o.type} trong interaction phải còn trong scene`).toBe(st.scene);
      }
      // lô đang vẽ là con của một object có handler
      const lo = st.scene.getObjectByName(TEN_LO_MAY)!;
      expect(inter).toContain(lo.parent);
    }
  });

  it("T3 — ĐỐI CHỨNG cơ chế R3F 9.5: handler đặt THẲNG trên <primitive> chết sau khi đổi object (lưới này phải KÊU)", async () => {
    const g = await dungGoc();
    doiHuy.push(g.huy);
    const onClick = vi.fn();
    const hop = () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const a = hop();
    const b = hop();
    a.name = "a";
    b.name = "b";
    const store = await g.ve(<primitive object={a} onClick={onClick} />);
    const st = store.getState();
    expect(st.internal.interaction).toContain(a);
    const p = pxCua(store, new THREE.Vector3(0, 0, 0));
    bam(store, g.canvas, p);
    expect(onClick).toHaveBeenCalledTimes(1);

    await g.ve(<primitive object={b} onClick={onClick} />);
    expect(st.scene.children).toContain(b);
    expect(st.scene.children).not.toContain(a);
    // Cơ chế đo được: object cũ nằm lại danh sách không còn `__r3f`, object mới không được đăng ký.
    expect(st.internal.interaction).toContain(a);
    expect(st.internal.interaction).not.toContain(b);
    expect((a as unknown as { __r3f?: unknown }).__r3f).toBeUndefined();
    bam(store, g.canvas, p);
    expect(onClick, "R3F 9.5: click không tới object mới sau swap — nếu ca này đỏ, cơ chế swap đã đổi").toHaveBeenCalledTimes(1);
  });
});

/**
 * ★★★ ĐỢT 49 (mục B) — DỰNG LẠI LÔ CHỈ KHI HÌNH/VỊ TRÍ ĐỔI, KHÔNG KHI MÀU ĐỔI.
 *
 * Bất biến §6.2 ("cập nhật realtime CHỈ được chạm `setColorAt`/`setVisibleAt`") đã nằm trong
 * docblock `LoBatchMay` từ Đợt 5, trong khi deps `useMemo` là `[may]` — và `may` là mảng MỚI mỗi
 * gói ws. 48 đợt, 2.424 lưới, không ai kêu: không có lưới nào ĐẾM số lần dựng. Nhóm này đếm.
 *
 * Phép đo là `window.__demTuongTac.soLanDungLo` — chính con số QA sẽ đọc trên màn thật (60 s
 * live), không phải một spy riêng cho test (một phép đo, hai nơi dùng).
 */
describe("Đợt 49 mục B — số lần dựng BatchedMesh", () => {
  const soLan = () =>
    (window as unknown as { __demTuongTac?: { soLanDungLo?: number } }).__demTuongTac?.soLanDungLo ?? 0;

  it("★★★ ĐỔI MÀU (mảng `may` mới, cùng hình/vị trí) ⇒ KHÔNG dựng lại lô; đổi HÌNH/VỊ TRÍ ⇒ dựng lại", async () => {
    const g = await dungGoc();
    doiHuy.push(g.huy);
    const ui = (ds: MayTrongLo[]) => (
      <LoBatchMay may={ds} chon={TRANG_THAI_CHON_RONG} onChon={() => {}} onHover={() => {}} chiHopBao />
    );
    const store = await g.ve(ui([may(101, 0), may(102, 2)]));
    const st = store.getState();
    const lo1 = st.scene.getObjectByName(TEN_LO_MAY) as THREE.BatchedMesh;
    const n0 = soLan();

    // 5 "gói realtime": MẢNG MỚI mỗi lần, chỉ `mau`/`doMo`/`hien` đổi.
    for (let i = 0; i < 5; i += 1) {
      await g.ve(
        ui([
          { ...may(101, 0), mau: `#00ff0${i}`, doMo: 0.5 },
          { ...may(102, 2), mau: "#0000ff", hien: true },
        ]),
      );
    }
    expect(soLan(), "5 gói đổi màu KHÔNG được dựng lại lô lần nào").toBe(n0);
    expect(st.scene.getObjectByName(TEN_LO_MAY), "vẫn đúng object lô cũ").toBe(lo1);

    // Màu THẬT SỰ đã đổi trên lô (không phải "không dựng vì không làm gì").
    const c = new THREE.Color();
    lo1.getColorAt(0, c);
    expect(c.getHexString()).not.toBe("ffffff");

    // Đổi KÍCH THƯỚC ⇒ hình đổi ⇒ PHẢI dựng lại.
    await g.ve(ui([{ ...may(101, 0), kichThuocMm: { rongMm: 2000, caoMm: 1000, sauMm: 1000 } }, may(102, 2)]));
    expect(soLan()).toBe(n0 + 1);
    expect(st.scene.getObjectByName(TEN_LO_MAY)).not.toBe(lo1);

    // Đổi VỊ TRÍ ⇒ dựng lại.
    const lo2 = st.scene.getObjectByName(TEN_LO_MAY);
    await g.ve(ui([{ ...may(101, 0), kichThuocMm: { rongMm: 2000, caoMm: 1000, sauMm: 1000 } }, may(102, 5)]));
    expect(soLan()).toBe(n0 + 2);
    expect(st.scene.getObjectByName(TEN_LO_MAY)).not.toBe(lo2);

    // Đổi TẬP MÁY ⇒ dựng lại.
    await g.ve(ui([{ ...may(101, 0), kichThuocMm: { rongMm: 2000, caoMm: 1000, sauMm: 1000 } }]));
    expect(soLan()).toBe(n0 + 3);
  });

  it("★★★ sau khi bỏ dựng lại, BẤM MÁY vẫn tới đúng máy (handler + bảng tra không lệch với lô giữ lại)", async () => {
    const g = await dungGoc();
    doiHuy.push(g.huy);
    const onChon = vi.fn();
    const ui = (ds: MayTrongLo[]) => (
      <LoBatchMay may={ds} chon={TRANG_THAI_CHON_RONG} onChon={onChon} onHover={() => {}} chiHopBao />
    );
    const store = await g.ve(ui([may(101, 0), may(102, 2)]));
    const p101 = pxCua(store, new THREE.Vector3(0, 0.5, 0));
    const p102 = pxCua(store, new THREE.Vector3(2, 0.5, 0));
    const n0 = soLan();
    await g.ve(ui([{ ...may(101, 0), mau: "#123456" }, { ...may(102, 2), mau: "#654321" }]));
    expect(soLan()).toBe(n0);
    bam(store, g.canvas, p101);
    expect(onChon).toHaveBeenLastCalledWith(101);
    bam(store, g.canvas, p102);
    expect(onChon).toHaveBeenLastCalledWith(102);
  });
});
