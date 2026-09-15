// @vitest-environment jsdom
//
/**
 * chonTrenCanhStudio.dom.test.tsx — ★★★ PH-41: BẤM KHỐI TRÊN CẢNH KHI ĐANG ĐA CHỌN.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ TỆP NÀY — MỘT PHÁT HIỆN **CHƯA PHÂN XỬ**
 * ════════════════════════════════════════════════════════════════════════════
 * Đợt nghiệm thu tập đoàn ghi (`.qa-tapdoan/BANG-CUOI.md:153-157`,
 * `.qa-tapdoan/tho/CUOI/_probe-t2.log`): trên `/twin-studio`, sau khi shift+click
 * 3 node cây, một cú bấm vào TÂM một khối máy khác trên cảnh **không** rút tập
 * chọn về 1 (`bang-thuoc-tinh` vẫn ở nhánh "N vật thể", `cong-tac-khoa` vắng).
 * `XuongThietKe.tsx:1087-1089` khai ý định NGƯỢC LẠI — thay thế toàn bộ tập:
 *
 *     onChonMay={(machineId) =>
 *       setChon(machineId === null ? [] : [khoaNode("machine", machineId)])
 *     }
 *
 * Agent nghiệm thu **không kết luận** được là lỗi sản phẩm hay giới hạn của cú
 * bấm tổng hợp, và đó là điểm mấu chốt: vá một thứ chưa biết có hỏng hay không
 * là vá mù. Tệp này là PHÉP ĐO PHÂN XỬ, dựng trên đúng hạ tầng mà
 * `../loi/loBatchMay.dom.test.tsx` đã kiểm chứng ở Đợt 47 — reconciler R3F
 * THẬT trong jsdom (`gl` giả; raycast/BatchedMesh/three là toán thuần), sự kiện
 * đẩy qua ĐÚNG đường R3F đi khi có click DOM.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HAI GIẢ THUYẾT, VÀ CÁI GÌ PHÂN BIỆT ĐƯỢC CHÚNG
 * ════════════════════════════════════════════════════════════════════════════
 * Đường bấm đọc BA thuộc tính mà một cú bấm tổng hợp có thể KHÔNG đặt:
 *   (1) `internal.initialHits` của R3F — chỉ được ghi ở `onPointerDown`. Click
 *       KHÔNG kèm pointerdown ⇒ R3F bỏ qua handler, im lặng (ca N3).
 *   (2) `e.delta` — px giữa pointerdown và click; ≥ 4 ⇒ KÉO, không phải bấm (N5).
 *   (3) `performance.now()` — khoảng THỜI GIAN giữ; ≥ 300 ms ⇒ không phải bấm
 *       (`phanBietBamKeo.NGUONG_BAM_MS`). Đây là ĐỒNG HỒ TƯỜNG, không phải
 *       thuộc tính của cử chỉ: luồng chính bận > 300 ms giữa pointerdown và
 *       click là đủ để nuốt cú bấm mà không một lỗi nào kêu (ca N4).
 * Ba ca N3/N4/N5 chứng minh: **phép đo có thể cho ra ĐÚNG triệu chứng của
 * PH-41 mà sản phẩm không hỏng gì cả.**
 *
 * Ca N1 là ĐỐI CHỨNG DƯƠNG bắt buộc (bẫy "lưới tự thoả trên tập rỗng"): phép đo
 * phải **thấy được một lần thu lựa chọn THẬT** trước khi ai được phép kết luận
 * nó không xảy ra. N2 bác bỏ giả thuyết của chính agent nghiệm thu ("gizmo của
 * tập chọn nuốt cú bấm") ở tầng raycast.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LỖ HỔNG ĐO ĐƯỢC — ca N6, KHÁC với PH-41
 * ════════════════════════════════════════════════════════════════════════════
 * Nhánh `machineId === null ⇒ setChon([])` ở `XuongThietKe.tsx:1088` **không có
 * đường nào gọi tới từ cảnh 3D**: `LoBatchMay` chỉ phát `onChon` khi tia TRÚNG
 * một máy, và census ca N7 đếm được **0** điểm gắn `onPointerMissed` trên toàn
 * cây `twin3d` (mã sản phẩm, bỏ tệp lưới) — `grep` toàn `client/src` cũng 0. Tức "bấm
 * nền để bỏ chọn" — ngữ nghĩa mà `trangThaiThietKe.apChon` docblock (G8) khai là
 * bắt buộc, và `CanhVanHanh2D.tsx:94` còn khai là "cùng hành vi `onPointerMissed`
 * của bản 3D" — KHÔNG tồn tại ở bản 3D. N6 ghim CƠ CHẾ (cú bấm trượt không đi
 * qua `onChon`) chứ không ghim triệu chứng, nên nó vẫn đúng sau khi ai đó vá
 * bằng một đường khác.
 */
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, events as taoSuKien, extend } from "@react-three/fiber";
import * as THREE from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { docMaNguon } from "@shared/testing/docMaNguon";

import { LoBatchMay, TEN_NHOM_SU_KIEN_LO_MAY, type MayTrongLo } from "../loi/LoBatchMay";
import { TRANG_THAI_CHON_RONG } from "../loi/chonVatThe";
import { NGUONG_BAM_MS, NGUONG_BAM_PX } from "../loi/phanBietBamKeo";
import { GizmoBienDoi } from "./GizmoBienDoi";
import { khoaNode, type KhoaNode, type TapChon } from "./trangThaiThietKe";
import type { CuaSoDoGizmo } from "./GizmoBienDoi";

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

interface TuyChonBam {
  /** Điểm nhả (mặc định = điểm bấm). Lệch ≥ NGUONG_BAM_PX ⇒ KÉO. */
  len?: { x: number; y: number };
  /** Bỏ hẳn pointerdown — mô phỏng cú bấm tổng hợp thiếu nửa đầu cử chỉ. */
  boPointerDown?: boolean;
  /** Số ms ĐỒNG HỒ TƯỜNG trôi giữa pointerdown và click. */
  giuMs?: number;
}

/**
 * Đẩy một cử chỉ bấm qua đúng đường R3F. Bọc `act` vì handler đổi state React.
 *
 * `giuMs` giả lập bằng cách điều khiển `performance.now()` — đây là nguồn duy
 * nhất mà `LoBatchMay` đọc để tính thời gian giữ, nên đây là cách DUY NHẤT đo
 * được ngưỡng ấy mà không phải chờ thật.
 */
async function bam(
  store: Store,
  canvas: HTMLCanvasElement,
  xuong: { x: number; y: number },
  tuyChon: TuyChonBam = {},
) {
  const { len = xuong, boPointerDown = false, giuMs } = tuyChon;
  const h = store.getState().events.handlers!;
  const dongHo = giuMs === undefined ? null : vi.spyOn(performance, "now");
  try {
    if (dongHo) dongHo.mockReturnValue(1_000_000);
    await act(async () => {
      if (!boPointerDown) h.onPointerDown(suKien(canvas, xuong.x, xuong.y, "pointerdown"));
    });
    if (dongHo) dongHo.mockReturnValue(1_000_000 + giuMs!);
    await act(async () => {
      h.onPointerUp(suKien(canvas, len.x, len.y, "pointerup"));
      h.onClick(suKien(canvas, len.x, len.y, "click") as unknown as MouseEvent);
    });
  } finally {
    dongHo?.mockRestore();
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Màn giả lập — NỐI Y NGUYÊN `XuongThietKe.tsx:1087-1089` (ca N7 ghim nguồn)  */
/* ─────────────────────────────────────────────────────────────────────────── */

interface SoTay {
  chon: TapChon;
  /** Số lần `onChon` của `LoBatchMay` thực sự được gọi — tách "không gọi" khỏi "gọi mà không đổi". */
  soLanOnChon: number;
  /** Đối số của lần gọi gần nhất (`null` = cảnh báo "chọn nền" nếu có đường nào phát ra). */
  doiSoCuoi: number | null | undefined;
}

function ManGiaLap({
  ds,
  banDau,
  soTay,
  gizmoTai,
}: {
  ds: MayTrongLo[];
  banDau: TapChon;
  soTay: SoTay;
  /** Có gizmo đang gắn hay không, và nó đứng ở đâu (thế giới). */
  gizmoTai?: THREE.Vector3;
}) {
  const [chon, setChon] = useState<TapChon>(banDau);
  useEffect(() => {
    soTay.chon = chon;
  }, [chon, soTay]);

  // `machineIdChon` của `XuongThietKe` = PHẦN TỬ CUỐI tập (`nodeChuDao`).
  const cuoi = chon.length === 0 ? null : chon[chon.length - 1];
  const machineIdChon = cuoi?.startsWith("machine:") ? Number(cuoi.slice("machine:".length)) : null;

  const [proxy] = useState(() => {
    const o = new THREE.Object3D();
    o.name = "twin-gizmo-proxy";
    return o;
  });
  if (gizmoTai) proxy.position.copy(gizmoTai);

  return (
    <>
      <LoBatchMay
        may={ds}
        chon={{ ...TRANG_THAI_CHON_RONG, dangChon: machineIdChon }}
        /* ★ ĐÚNG dòng `XuongThietKe.tsx:1088`. */
        onChon={(machineId) => {
          soTay.soLanOnChon += 1;
          soTay.doiSoCuoi = machineId;
          setChon(machineId === null ? [] : [khoaNode("machine", machineId)]);
        }}
        onHover={() => {}}
        chiHopBao
      />
      {gizmoTai ? (
        <>
          <primitive object={proxy} />
          <GizmoBienDoi
            vatThe={proxy}
            cheDo="translate"
            snapBat={false}
            buocLuoiMm={100}
            buocGocDo={15}
            trucKhoa={null}
          />
        </>
      ) : null}
    </>
  );
}

const doiHuy: Array<() => Promise<void>> = [];
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  extend(THREE as unknown as Parameters<typeof extend>[0]);
});
afterEach(async () => {
  while (doiHuy.length) await doiHuy.pop()!();
});

/** Ba khoá đang chọn — cố ý có node KHÔNG nằm trên sàn đang vẽ, y như hiện trường. */
const BA_KHOA: TapChon = [
  khoaNode("machine", 901),
  khoaNode("machine", 902),
  khoaNode("machine", 903),
];
const LO: MayTrongLo[] = [may(201, 0), may(202, 3), may(203, 6)];

function soTayMoi(): SoTay {
  return { chon: [], soLanOnChon: 0, doiSoCuoi: undefined };
}

async function dungMan(gizmoTai?: THREE.Vector3) {
  const g = await dungGoc();
  doiHuy.push(g.huy);
  const soTay = soTayMoi();
  const store = await g.ve(
    <ManGiaLap ds={LO} banDau={BA_KHOA} soTay={soTay} gizmoTai={gizmoTai} />,
  );
  // ★ TIỀN ĐỀ (chống lưới tự thoả): tập chọn ban đầu KHÁC RỖNG và có ĐÚNG 3 khoá;
  //   lô có đủ 3 khối; nhóm mang handler CÓ trong danh sách R3F quét.
  expect(soTay.chon).toHaveLength(3);
  expect(LO).toHaveLength(3);
  const st = store.getState();
  const nhom = st.scene.getObjectByName(TEN_NHOM_SU_KIEN_LO_MAY);
  expect(nhom, "nhóm bọc mang handler phải có trong scene").toBeTruthy();
  expect(st.internal.interaction).toContain(nhom);
  return { g, store, soTay, nhom: nhom! };
}

describe("PH-41 — bấm khối trên cảnh Thiết kế khi đang ĐA CHỌN", () => {
  it("N1 ĐỐI CHỨNG DƯƠNG — phép đo THẤY ĐƯỢC một lần thu lựa chọn thật: 3 khoá ⇒ bấm khối 203 ⇒ đúng 1 khoá", async () => {
    const { g, store, soTay } = await dungMan();

    await bam(store, g.canvas, pxCua(store, tamKhoi(6)));

    expect(soTay.soLanOnChon, "đường `onChon` của LoBatchMay phải CHẠY").toBe(1);
    expect(soTay.doiSoCuoi).toBe(203);
    expect(soTay.chon).toEqual([khoaNode("machine", 203)]);
    expect(soTay.chon).toHaveLength(1);
  });

  it("N2 — GIZMO ĐANG GẮN không nuốt cú bấm: nó KHÔNG nằm trong danh sách R3F quét, và tập chọn vẫn thu về 1", async () => {
    // Gizmo đứng ĐÚNG tâm khối sắp bấm — trường hợp xấu nhất về hình học.
    const { g, store, soTay } = await dungMan(tamKhoi(6));
    const st = store.getState();

    // ★ TIỀN ĐỀ: gizmo THẬT SỰ đã vào scene (ca này không được rỗng).
    const cua = (window as Window & CuaSoDoGizmo).__gizmo;
    expect(cua?.daGanHelper, "GizmoBienDoi phải đã add helper vào scene").toBe(true);
    expect(cua?.helperTrongScene).toBe(true);
    expect((cua?.soConHelper ?? 0), "helper rỗng = gizmo không vẽ gì, ca sẽ vô nghĩa").toBeGreaterThan(0);

    // ★★★ PHÂN XỬ giả thuyết "gizmo nuốt cú bấm": R3F CHỈ raycast
    //     `internal.interaction`, và không object nào của gizmo có handler R3F
    //     nên không object nào của nó lọt vào đó.
    expect(st.internal.interaction).toHaveLength(1);
    expect(st.internal.interaction[0]?.name).toBe(TEN_NHOM_SU_KIEN_LO_MAY);

    await bam(store, g.canvas, pxCua(store, tamKhoi(6)));

    expect(soTay.soLanOnChon).toBe(1);
    expect(soTay.chon).toEqual([khoaNode("machine", 203)]);
  });

  it("N3 GIỚI HẠN PHÉP ĐO (a) — click KHÔNG kèm pointerdown: R3F bỏ qua handler, tập chọn GIỮ NGUYÊN 3", async () => {
    const { g, store, soTay } = await dungMan();
    const diem = pxCua(store, tamKhoi(6));

    await bam(store, g.canvas, diem, { boPointerDown: true });
    expect(soTay.soLanOnChon, "R3F chỉ gọi handler click cho object có trong `initialHits`").toBe(0);
    expect(soTay.chon).toHaveLength(3);

    // ĐỐI CHỨNG cùng điểm, cùng mọi thứ, CHỈ thêm pointerdown ⇒ thu về 1.
    await bam(store, g.canvas, diem);
    expect(soTay.soLanOnChon).toBe(1);
    expect(soTay.chon).toEqual([khoaNode("machine", 203)]);
  });

  it("N4 GIỚI HẠN PHÉP ĐO (b) — ĐỒNG HỒ TƯỜNG ≥ 300 ms giữa pointerdown và click nuốt cú bấm, im lặng", async () => {
    const { g, store, soTay } = await dungMan();
    const diem = pxCua(store, tamKhoi(6));

    // Cùng điểm, `e.delta` = 0, tia trúng đúng khối — KHÁC DUY NHẤT là thời gian giữ.
    await bam(store, g.canvas, diem, { giuMs: NGUONG_BAM_MS + 200 });
    expect(soTay.soLanOnChon, "`onChon` KHÔNG chạy vì `laBam` loại theo thời gian").toBe(0);
    expect(soTay.chon).toHaveLength(3);

    await bam(store, g.canvas, diem, { giuMs: Math.round(NGUONG_BAM_MS / 3) });
    expect(soTay.soLanOnChon).toBe(1);
    expect(soTay.chon).toEqual([khoaNode("machine", 203)]);
  });

  it("N5 GIỚI HẠN PHÉP ĐO (c) — nhả cách chỗ bấm ≥ 4 px là KÉO, không phải bấm", async () => {
    const { g, store, soTay } = await dungMan();
    const diem = pxCua(store, tamKhoi(6));

    await bam(store, g.canvas, diem, { len: { x: diem.x + NGUONG_BAM_PX + 46, y: diem.y } });
    expect(soTay.soLanOnChon).toBe(0);
    expect(soTay.chon).toHaveLength(3);

    await bam(store, g.canvas, diem);
    expect(soTay.chon).toEqual([khoaNode("machine", 203)]);
  });

  it("N6 LỖ HỔNG — bấm TRƯỢT mọi khối không đi qua `onChon`, nên nhánh `machineId === null` ở XuongThietKe:1088 không tới được từ cảnh", async () => {
    const { g, store, soTay } = await dungMan();

    // ★ TIỀN ĐỀ: điểm này thật sự KHÔNG trúng khối nào (nếu trúng, ca vô nghĩa).
    const goc = { x: 3, y: 3 };
    const st = store.getState();
    st.raycaster.setFromCamera(
      new THREE.Vector2((goc.x / KHUNG.width) * 2 - 1, 1 - (goc.y / KHUNG.height) * 2),
      st.camera,
    );
    expect(st.raycaster.intersectObjects([...st.internal.interaction], true)).toHaveLength(0);

    await bam(store, g.canvas, goc);

    // CƠ CHẾ, không phải triệu chứng: `LoBatchMay` chỉ phát `onChon` khi tia TRÚNG máy.
    expect(soTay.soLanOnChon).toBe(0);
    expect(soTay.doiSoCuoi, "chưa từng có ai gọi `onChon(null)` từ cảnh").toBeUndefined();
    expect(soTay.chon, "tập chọn KHÔNG bị xoá — 'bấm nền để bỏ chọn' không tồn tại ở bản 3D").toHaveLength(3);
  });

  it("N7 NGUỒN — `XuongThietKe` nối cảnh bằng ngữ nghĩa THAY THẾ, và `onPointerMissed` vắng mặt trong toàn client", () => {
    const ma = docMaNguon(resolve(GOC, "client/src/components/twin3d/thiet-ke/XuongThietKe.tsx"));
    expect(ma).toContain(
      'onChonMay={(machineId) =>\n                setChon(machineId === null ? [] : [khoaNode("machine", machineId)])\n              }',
    );

    // ★ CENSUS trên TOÀN cây `twin3d` (mã sản phẩm, bỏ tệp lưới): 0 điểm gắn
    //   `onPointerMissed` ⇒ nhánh `null` ở trên KHÔNG có nguồn phát. Đây là dữ
    //   kiện của PH-41, không phải trang trí — và nó KÊU ngay khi ai đó thêm.
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
    const coHandler = tep.filter((p) => docMaNguon(p).includes("onPointerMissed="));
    expect(coHandler).toEqual([]);
  });
});
