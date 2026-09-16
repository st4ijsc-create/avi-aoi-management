// @vitest-environment jsdom
//
/**
 * bamNenBoChon.dom.test.tsx — ★★★ "BẤM NỀN ĐỂ BỎ CHỌN" Ở BẢN 3D.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ TỆP NÀY — MỘT HÀNH VI ĐƯỢC KHAI BA CHỖ MÀ KHÔNG TỒN TẠI
 * ════════════════════════════════════════════════════════════════════════════
 * Khi phân xử PH-41, `thiet-ke/chonTrenCanhStudio.dom.test.tsx` (ca N6/N7) đo
 * được: cú bấm TRƯỢT mọi khối **không đi qua `onChon`** của `LoBatchMay`, và
 * census đếm **0** điểm gắn `onPointerMissed` trên toàn cây `twin3d`. Trong khi
 * đó BA chỗ khai ngược lại:
 *
 *   1. `thiet-ke/XuongThietKe.tsx:1088` — nhánh `machineId === null ⇒ setChon([])`
 *      (mã chết: không nguồn nào phát `null` từ cảnh).
 *   2. `thiet-ke/trangThaiThietKe.ts` — docblock `apChon` (luật G8) khai "bấm nền
 *      để bỏ chọn" là BẮT BUỘC.
 *   3. `van-hanh/CanhVanHanh2D.tsx:94` — *"Click nền = bỏ chọn, cùng hành vi
 *      `onPointerMissed` của bản 3D"* — lời khai về một hành vi không có.
 *
 * ★ Đây nhiều khả năng là NGUYÊN NHÂN GỐC THẬT của PH-41: người đo bấm **trượt**
 *   khối (vào nền) và kỳ vọng bỏ chọn — chứ không phải bấm TRÚNG khối (ca N1 của
 *   tệp kia chứng minh bấm trúng thì tập chọn thu về 1, đúng hợp đồng).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * TỆP NÀY ĐO Ở ĐÂU, VÀ VÌ SAO PHẢI ĐO **CẢ HAI MÀN**
 * ════════════════════════════════════════════════════════════════════════════
 * `loi/LoBatchMay.tsx` là tệp DÙNG CHUNG: `thiet-ke/CanhThietKe.tsx` (Studio),
 * `van-hanh/CanhVanHanh.tsx` (`/twin`, `/twin/line/:id`) và `loi/CanhNhaMay.tsx`
 * (`/factory-command`) đều render nó. Một handler thêm vào đây tới CẢ BA màn,
 * nên lưới phải nối theo ĐÚNG ngữ nghĩa của từng chỗ gọi, không chỉ một chỗ:
 *
 *   · Studio    — `onChonMay(null) ⇒ setChon([])`         (XuongThietKe:1087-1089)
 *   · Vận hành  — `khiChon(null) ⇒ dangChon=null + onChonMay(null)` (CanhVanHanh:515-520),
 *                 mà `TwinVanHanh.chonMay(null)` chỉ `ghiUrl({chon:null})` — KHÔNG điều hướng.
 *
 * Ca B6 ghim ba chỗ nối ấy ở tầng NGUỒN, nên lưới hành vi ở đây không trôi khỏi
 * mã sản phẩm khi ai đó đổi cách nối.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BA BẪY ĐÃ ĐO ĐƯỢC — VÀ CA NÀO CANH CHÚNG
 * ════════════════════════════════════════════════════════════════════════════
 * (1) **Lưới tự thoả**: một lưới "bấm nền ⇒ rỗng" xanh được vì đường sự kiện đã
 *     chết (không cú bấm nào tới đâu cả). B0 là ĐỐI CHỨNG DƯƠNG bắt buộc: cùng
 *     cảnh, cùng thiết bị đo, bấm TRÚNG khối ⇒ `onChon(machineId)` chạy. Thêm
 *     nữa, B1/B2 đã có mốc **ĐỎ trước khi vá** (`doiSoCuoi` là `undefined`, tập
 *     chọn giữ 3) — tức phép đo biết KÊU.
 * (2) **jsdom không có bộ dựng bố cục**, nhưng reconciler R3F thì CHẠY ĐƯỢC:
 *     khuôn `dungGoc`/`bam` ở đây tái dùng nguyên của `loBatchMay.dom.test.tsx`
 *     (Đợt 47) và `chonTrenCanhStudio.dom.test.tsx` — `gl` giả, raycast/three là
 *     toán thuần, sự kiện đẩy qua ĐÚNG đường R3F đi khi có click DOM.
 * (3) **Ngưỡng bấm/kéo**: `phanBietBamKeo` dùng 4 px / 300 ms cho cú bấm TRÚNG
 *     máy. Nhưng đường "bấm trượt" của R3F có ngưỡng RIÊNG — `delta <= 2` px
 *     (bundle 9.5.0 `events-5a94e5eb.esm.js:826`). Hai con số KHÁC NHAU, và B4
 *     ghim đúng khoảng chênh ấy để không ai kết luận sai từ một cú bấm lệch 3 px.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ "BẤM NỀN" PHẢI NGHĨA LÀ BẤM NỀN — KHÔNG PHẢI "BẤM THỨ KHÁC"
 * ════════════════════════════════════════════════════════════════════════════
 * R3F gọi `onPointerMissed` ở HAI tình huống khác hẳn nhau (cùng bundle):
 *   (a) :826-829 — một CLICK không trúng gì (`hits` rỗng, `delta ≤ 2`): gọi cho
 *       MỌI object trong `internal.interaction`. Đây mới là "bấm nền".
 *   (b) :880-890 — một object KHÁC được bấm/nhấn: mọi object **không** nằm trong
 *       `initialHits` đều nhận "missed", kể cả trên `pointerdown`.
 * Ở Studio, `thiet-ke/LopVung.tsx:109` là một `<mesh onClick>` THẬT trong cùng
 * cảnh, nên (b) xảy ra mỗi lần người dùng bấm một vùng an toàn. Nếu không phân
 * biệt, bấm vùng sẽ âm thầm xoá tập chọn máy — một thay đổi hành vi KHÔNG AI
 * YÊU CẦU ở một tệp (`LopVung`) không nằm trong phạm vi vá. B5 ghim phép phân
 * biệt ấy bằng một cặp: bấm vật thể khác ⇒ GIỮ, bấm nền ⇒ BỎ — cùng một cảnh.
 */
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, events as taoSuKien, extend } from "@react-three/fiber";
import * as THREE from "three";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { docMaNguon } from "@shared/testing/docMaNguon";

import { LoBatchMay, TEN_NHOM_SU_KIEN_LO_MAY, type MayTrongLo } from "./LoBatchMay";
import { TRANG_THAI_CHON_RONG, type TrangThaiChon } from "./chonVatThe";
import { NGUONG_BAM_PX } from "./phanBietBamKeo";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const KHUNG = { width: 800, height: 600, top: 0, left: 0 };
const GOC = resolve(import.meta.dirname, "..", "..", "..", "..", "..");
/** Ngưỡng RIÊNG của đường "bấm trượt" trong R3F 9.5.0 — xem docblock, bẫy (3). */
const NGUONG_TRUOT_R3F_PX = 2;
const TEN_VUNG_GIA = "vung-gia-thay-LopVung";

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

/** Máy hộp 1×1×1 m (`chiHopBao` ⇒ BoxGeometry đơn vị), đáy tại `viTri`. */
const may = (machineId: number, x: number): MayTrongLo => ({
  machineId,
  khoi: "ban_test",
  kichThuocMm: { rongMm: 1000, caoMm: 1000, sauMm: 1000 },
  viTri: { x, y: 0, z: 0 },
  gocXoayRad: 0,
  mau: "#ff0000",
});

/** Tâm khối của máy đặt tại `x` (hộp 1 m, đáy y=0). */
const tamKhoi = (x: number) => new THREE.Vector3(x, 0.5, 0);

/** Pixel canvas của một điểm thế giới theo camera của store. */
function pxCua(store: Store, diem: THREE.Vector3) {
  const st = store.getState();
  st.scene.updateMatrixWorld(true);
  st.camera.updateMatrixWorld(true);
  const v = diem.clone().project(st.camera);
  return { x: ((v.x + 1) / 2) * KHUNG.width, y: ((1 - v.y) / 2) * KHUNG.height };
}

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

/** Đẩy một cử chỉ bấm qua đúng đường R3F. `len` lệch ⇒ KÉO. */
async function bam(
  store: Store,
  canvas: HTMLCanvasElement,
  xuong: { x: number; y: number },
  len: { x: number; y: number } = xuong,
) {
  const h = store.getState().events.handlers!;
  await act(async () => {
    h.onPointerDown(suKien(canvas, xuong.x, xuong.y, "pointerdown"));
  });
  await act(async () => {
    h.onPointerUp(suKien(canvas, len.x, len.y, "pointerup"));
    h.onClick(suKien(canvas, len.x, len.y, "click") as unknown as MouseEvent);
  });
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Sổ tay đo                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

interface SoTay {
  /** Mọi đối số `onChon` đã nhận, theo thứ tự — tách "không gọi" khỏi "gọi mà không đổi". */
  doiSo: Array<number | null>;
  /** Trạng thái chọn hiện tại của màn giả lập (kiểu tuỳ màn). */
  chon: unknown;
}
const soTayMoi = (): SoTay => ({ doiSo: [], chon: undefined });

/* ─────────────────────────────────────────────────────────────────────────── */
/* Vật thể tương tác KHÁC trong cảnh — đứng thay `thiet-ke/LopVung.tsx`        */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * ★ Hình học KHÔNG phải thứ đang đo. Điều kiện duy nhất cần đúng là: object này
 *   có handler R3F ⇒ nó NẰM TRONG `internal.interaction` và tia bấm trúng được —
 *   y như mesh vùng an toàn của `LopVung`. Dùng hộp cho raycast không mơ hồ.
 */
function VungGia({ onChon }: { onChon: () => void }) {
  return (
    <mesh
      name={TEN_VUNG_GIA}
      position={[-4, 0.5, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onChon();
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#00ff00" />
    </mesh>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Màn STUDIO — nối Y NGUYÊN `thiet-ke/XuongThietKe.tsx:1087-1089`             */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Khoá node của `trangThaiThietKe.khoaNode("machine", id)` — viết thẳng để lưới không phụ thuộc thêm module. */
const khoaMay = (id: number) => `machine:${id}`;

function ManStudio({
  ds,
  banDau,
  soTay,
  coVung,
}: {
  ds: MayTrongLo[];
  banDau: string[];
  soTay: SoTay;
  coVung?: boolean;
}) {
  const [chon, setChon] = useState<string[]>(banDau);
  const [vungChon, setVungChon] = useState<string | null>(null);
  useEffect(() => {
    soTay.chon = chon;
  }, [chon, soTay]);

  const cuoi = chon.length === 0 ? null : chon[chon.length - 1];
  const machineIdChon = cuoi?.startsWith("machine:") ? Number(cuoi.slice("machine:".length)) : null;

  return (
    <>
      <LoBatchMay
        may={ds}
        chon={{ ...TRANG_THAI_CHON_RONG, dangChon: machineIdChon }}
        /* ★ ĐÚNG dòng `XuongThietKe.tsx:1087-1089`. */
        onChon={(machineId) => {
          soTay.doiSo.push(machineId);
          setChon(machineId === null ? [] : [khoaMay(machineId)]);
        }}
        onHover={() => {}}
        chiHopBao
      />
      {coVung ? <VungGia onChon={() => setVungChon("vung:1")} /> : null}
      {/* `vungChon` tồn tại để nhánh chọn vùng có thật một hiệu ứng, y như `setVungChon` ở XuongThietKe. */}
      {vungChon === null ? null : <group name={`da-chon-${vungChon}`} />}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Màn VẬN HÀNH — nối Y NGUYÊN `van-hanh/CanhVanHanh.tsx:515-520`             */
/* ─────────────────────────────────────────────────────────────────────────── */

function ManVanHanh({
  ds,
  banDau,
  soTay,
}: {
  ds: MayTrongLo[];
  banDau: number | null;
  soTay: SoTay;
}) {
  const [chon, setChon] = useState<TrangThaiChon>({
    ...TRANG_THAI_CHON_RONG,
    dangChon: banDau,
  });
  useEffect(() => {
    soTay.chon = chon.dangChon;
  }, [chon, soTay]);

  return (
    <LoBatchMay
      may={ds}
      chon={chon}
      /* ★ ĐÚNG `khiChon` của `CanhVanHanh`: đổi state cảnh RỒI báo lên trang. */
      onChon={(id) => {
        setChon((cu) => ({ ...cu, dangChon: id }));
        soTay.doiSo.push(id);
      }}
      onHover={() => {}}
      chiHopBao
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

const doiHuy: Array<() => Promise<void>> = [];
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  extend(THREE as unknown as Parameters<typeof extend>[0]);
});
afterEach(async () => {
  while (doiHuy.length) await doiHuy.pop()!();
});

const LO: MayTrongLo[] = [may(201, 0), may(202, 3), may(203, 6)];
const BA_KHOA = [khoaMay(901), khoaMay(902), khoaMay(903)];
/** Góc trên-trái canvas — xa mọi khối; mỗi ca vẫn tự KIỂM tiền đề bằng raycast. */
const DIEM_NEN = { x: 3, y: 3 };

/** Tiền đề chung: lô đủ máy, nhóm mang handler CÓ trong danh sách R3F quét. */
function kiemTienDe(store: Store) {
  const st = store.getState();
  const nhom = st.scene.getObjectByName(TEN_NHOM_SU_KIEN_LO_MAY);
  expect(nhom, "nhóm bọc mang handler phải có trong scene").toBeTruthy();
  expect(st.internal.interaction).toContain(nhom);
  expect(LO).toHaveLength(3);
  return nhom!;
}

/** Tiền đề của MỌI ca "bấm nền": điểm ấy thật sự KHÔNG trúng object tương tác nào. */
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

async function dungStudio(opt: { coVung?: boolean } = {}) {
  const g = await dungGoc();
  doiHuy.push(g.huy);
  const soTay = soTayMoi();
  const store = await g.ve(
    <ManStudio ds={LO} banDau={BA_KHOA} soTay={soTay} coVung={opt.coVung} />,
  );
  kiemTienDe(store);
  expect(soTay.chon, "tập chọn ban đầu phải KHÁC RỖNG, nếu không mọi ca tự thoả").toHaveLength(3);
  return { g, store, soTay };
}

async function dungVanHanh() {
  const g = await dungGoc();
  doiHuy.push(g.huy);
  const soTay = soTayMoi();
  const store = await g.ve(<ManVanHanh ds={LO} banDau={203} soTay={soTay} />);
  kiemTienDe(store);
  expect(soTay.chon, "phải có MỘT máy đang chọn trước khi đo việc bỏ chọn").toBe(203);
  return { g, store, soTay };
}

describe("Bấm NỀN trên cảnh 3D ⇒ bỏ chọn (LoBatchMay — dùng chung cho Studio, /twin, /factory-command)", () => {
  it("B0 ĐỐI CHỨNG DƯƠNG — đường sự kiện còn sống: bấm TRÚNG khối ⇒ onChon(machineId), tập chọn đổi", async () => {
    const { g, store, soTay } = await dungStudio();

    await bam(store, g.canvas, pxCua(store, tamKhoi(6)));

    expect(soTay.doiSo, "nếu ca này rỗng thì mọi ca 'bấm nền' dưới đây là xanh giả").toEqual([203]);
    expect(soTay.chon).toEqual([khoaMay(203)]);
  });

  it("★★★ B1 STUDIO — bấm NỀN ⇒ onChon(null) đúng MỘT lần ⇒ tập 3 khoá về RỖNG", async () => {
    const { g, store, soTay } = await dungStudio();
    kiemDiemLaNen(store, DIEM_NEN);

    await bam(store, g.canvas, DIEM_NEN);

    expect(soTay.doiSo, "cảnh phải phát ĐÚNG một lần `onChon(null)`").toEqual([null]);
    expect(soTay.chon, "nhánh `machineId === null ⇒ setChon([])` của XuongThietKe:1088 phải TỚI ĐƯỢC").toEqual([]);
  });

  it("★★★ B2 VẬN HÀNH — bấm NỀN ⇒ dangChon về null và trang nhận đúng `null` (KHÔNG id nào ⇒ KHÔNG điều hướng)", async () => {
    const { g, store, soTay } = await dungVanHanh();
    kiemDiemLaNen(store, DIEM_NEN);

    await bam(store, g.canvas, DIEM_NEN);

    expect(soTay.doiSo).toEqual([null]);
    expect(soTay.chon, "`chon.dangChon` của CanhVanHanh phải về null").toBeNull();
    // `TwinVanHanh.chonMay` điều hướng sang màn Máy với MỌI id khác null (B6 ghim
    // nguồn). Nên "không phát id nào" chính là "không điều hướng ngoài ý muốn".
    expect(soTay.doiSo.filter((d) => d !== null)).toEqual([]);
  });

  it("B3 KHÔNG PHÁ — KÉO trên nền (xoay camera) KHÔNG bỏ chọn, ở CẢ HAI màn", async () => {
    const s = await dungStudio();
    kiemDiemLaNen(s.store, DIEM_NEN);
    await bam(s.store, s.g.canvas, DIEM_NEN, {
      x: DIEM_NEN.x + NGUONG_BAM_PX + 96,
      y: DIEM_NEN.y + 60,
    });
    expect(s.soTay.doiSo, "kéo xoay camera mà mất tập chọn là một lỗi khác").toEqual([]);
    expect(s.soTay.chon).toHaveLength(3);

    const v = await dungVanHanh();
    kiemDiemLaNen(v.store, DIEM_NEN);
    await bam(v.store, v.g.canvas, DIEM_NEN, {
      x: DIEM_NEN.x + NGUONG_BAM_PX + 96,
      y: DIEM_NEN.y + 60,
    });
    expect(v.soTay.doiSo).toEqual([]);
    expect(v.soTay.chon).toBe(203);
  });

  it("B4 GIỚI HẠN PHÉP ĐO — đường 'bấm trượt' của R3F dùng ngưỡng 2 px, KHÔNG phải 4 px của phanBietBamKeo", async () => {
    const { g, store, soTay } = await dungStudio();
    kiemDiemLaNen(store, DIEM_NEN);

    // Lệch 3 px: `laBam` (ngưỡng 4) coi là BẤM, nhưng R3F (ngưỡng 2) coi là KÉO
    // ⇒ không phát `pointerMissed`. Hai con số khác nhau là dữ kiện, không phải lỗi.
    const lech = NGUONG_TRUOT_R3F_PX + 1;
    expect(lech).toBeLessThan(NGUONG_BAM_PX);
    await bam(store, g.canvas, DIEM_NEN, { x: DIEM_NEN.x + lech, y: DIEM_NEN.y });
    expect(soTay.doiSo).toEqual([]);
    expect(soTay.chon).toHaveLength(3);

    // ĐỐI CHỨNG cùng cảnh, cùng điểm, CHỈ bỏ độ lệch ⇒ bỏ chọn thật.
    await bam(store, g.canvas, DIEM_NEN);
    expect(soTay.doiSo).toEqual([null]);
    expect(soTay.chon).toEqual([]);
  });

  it("★★★ B5 STUDIO — bấm một VẬT THỂ TƯƠNG TÁC KHÁC (mesh kiểu LopVung) KHÔNG bỏ chọn máy; bấm nền thì CÓ", async () => {
    const { g, store, soTay } = await dungStudio({ coVung: true });
    const st = store.getState();

    // ★ TIỀN ĐỀ: cảnh có ĐÚNG hai object tương tác — nếu chỉ một thì ca không đo gì.
    const ten = [...st.internal.interaction].map((o) => o.name).sort();
    expect(ten).toEqual([TEN_NHOM_SU_KIEN_LO_MAY, TEN_VUNG_GIA].sort());

    await bam(store, g.canvas, pxCua(store, new THREE.Vector3(-4, 0.5, 0)));
    expect(soTay.doiSo, "bấm VÙNG là bấm một thứ khác, không phải bấm nền").toEqual([]);
    expect(soTay.chon, "tập chọn máy phải NGUYÊN VẸN sau khi bấm vùng").toHaveLength(3);

    // ĐỐI CHỨNG trong CÙNG cảnh (có vùng): bấm nền thật ⇒ vẫn bỏ chọn.
    kiemDiemLaNen(store, DIEM_NEN);
    await bam(store, g.canvas, DIEM_NEN);
    expect(soTay.doiSo).toEqual([null]);
    expect(soTay.chon).toEqual([]);
  });

  it("B6 NGUỒN — `onPointerMissed` có ĐÚNG MỘT điểm gắn trong twin3d, và ba màn đều đi qua nó", () => {
    const goc3d = resolve(GOC, "client/src/components/twin3d");
    const duyet = (thuMuc: string): string[] =>
      readdirSync(thuMuc, { withFileTypes: true }).flatMap((m) => {
        const duong = resolve(thuMuc, m.name);
        if (m.isDirectory()) return duyet(duong);
        if (!/\.tsx?$/.test(m.name) || /\.test\.tsx?$/.test(m.name)) return [];
        return [duong];
      });
    const tep = duyet(goc3d);
    // Tập rỗng là HỎNG: census không đọc được tệp nào thì nó không chứng minh gì.
    expect(tep.length).toBeGreaterThan(50);
    const coHandler = tep
      .filter((p) => docMaNguon(p).includes("onPointerMissed="))
      .map((p) => p.slice(goc3d.length + 1).replace(/\\/g, "/"));
    expect(coHandler, "đúng MỘT điểm gắn — thêm chỗ thứ hai là hai nguồn sự thật").toEqual([
      "loi/LoBatchMay.tsx",
    ]);

    // ★ Ba chỗ gọi `LoBatchMay` — bản vá ở một tệp tới cả ba màn.
    for (const p of [
      "thiet-ke/CanhThietKe.tsx",
      "van-hanh/CanhVanHanh.tsx",
      "loi/CanhNhaMay.tsx",
    ]) {
      expect(docMaNguon(resolve(goc3d, p)), `${p} phải render LoBatchMay`).toContain("<LoBatchMay");
    }

    // ★ Studio: nhánh `null` có thật ở chỗ gọi.
    expect(docMaNguon(resolve(GOC, "client/src/components/twin3d/thiet-ke/XuongThietKe.tsx"))).toContain(
      'setChon(machineId === null ? [] : [khoaNode("machine", machineId)])',
    );
    // ★ Vận hành: cảnh báo lên trang qua `khiChon`, và trang KHÔNG điều hướng khi `null`.
    expect(docMaNguon(resolve(goc3d, "van-hanh/CanhVanHanh.tsx"))).toContain("onChon={khiChon}");
    expect(docMaNguon(resolve(GOC, "client/src/pages/TwinVanHanh.tsx"))).toContain(
      "      if (id === null) {\n        ghiUrl({ chon: null });\n        return;\n      }\n",
    );
  });
});
