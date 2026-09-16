/**
 * KhungCanh.tsx — `<Canvas>` + camera + đèn + `frameloop="demand"` + `dpr=[1,1.5]`.
 * Đây là cửa duy nhất vào WebGL của kit Twin 3D.
 *
 * ★ RB-5 — KHÔNG `<Environment>`, KHÔNG asset CDN nào.
 *   `CommandCenter.tsx:605-607` đã phải TỰ TAY gỡ `<Environment preset="night">`
 *   vì mạng nhà máy air-gap chặn CDN → khung đen. Đây là lỗi đã xảy ra THẬT, không
 *   phải rủi ro lý thuyết. Ánh sáng ở đây là HemisphereLight + DirectionalLight tự
 *   cân, y như `factory-scene/FactoryScene3D.tsx` đang làm.
 *
 * ★ RB-4 — chỉ MỘT canvas sống tại một thời điểm. `window.__soCanvas` đếm số
 *   canvas đang mount để e2e chứng minh; console.error khi > 1 để lỗi này KÊU
 *   thay vì âm thầm cạn WebGL context.
 *
 * ★ Chống vỡ — bắt `webglcontextlost`: `preventDefault()` rồi chờ
 *   `webglcontextrestored`. Không làm thì canvas ĐEN VĨNH VIỄN. Đây là chuyện *sẽ*
 *   xảy ra (hết VRAM, driver crash, tab ẩn lâu), không phải chuyện có thể xảy ra.
 *
 * ★ RB-6 — WebGLRenderer, KHÔNG WebGPU. three.js#30560 còn mở: WebGPU chậm hơn
 *   WebGL ~4× với nhiều mesh không-instanced trên iGPU — đúng hồ sơ máy của ta.
 */

import { Canvas, useThree, useFrame, type RootState } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

import { laCheDoDo } from "./cheDoDo";
import { THUOC_TINH_CHE_NHAN } from "./LopNhan";
import { taoBoNgheDoiCho } from "./theoDoiDoiCho";

/** Trần DPR — §4 bảng ngân sách. Không nới, kể cả trên màn Retina. */
export const DPR_TRAN: [number, number] = [1, 1.5];

/*
 * ★★★ ĐỢT 40 (QA Đợt 39 Pareto #4) — MỌI PROP CỦA `<Canvas>` LÀ HẰNG MODULE / MEMO, KHÔNG LITERAL MỖI RENDER.
 *
 * Đọc từ cơ chế (`.qa-dot39/nguon-khung/*.json`, hook rAF + devtools): 9–15 khung/40 s của mỗi màn có chữ ký
 * `rootStore.subscribe ⇒ invalidate` ngay sau một commit mà `Canvas` đổi props (`p4{onCreated}`). Đọc bundle R3F
 * (`vendor-three-*.js:4019:79808`): điểm gọi `set` là `setSize` của store — `configure()` chạy ở MỖI render của
 * `<Canvas>` và so `size` mới (8 khoá từ `useMeasure`) với `state.size` (4 khoá) bằng `is.equ` "shallow-loose"
 * (`for (i in a) if (!(i in b)) return false`) ⇒ KHÔNG BAO GIỜ bằng ⇒ `setSize` ⇒ `set` ⇒ mọi listener ⇒
 * `invalidate`. Tức là **một lần `<Canvas>` render = một khung vẽ**, bất kể props có đổi hay không.
 *
 * ⇒ Hai việc, ở hai tầng:
 *   (1) Ở đây: props của `<Canvas>` ổn định (hằng module + `useMemo`) để `Canvas` không re-render vì props;
 *   (2) Ở `CanhVanHanh`: `React.memo` + ổn định theo GIÁ TRỊ mọi prop dữ liệu (`onDinhTheoGiaTri`), để cây
 *       `<Canvas>` chỉ render lại khi CÓ byte dữ liệu cảnh đổi — đó mới là nguồn của "mỗi nguồn refresh 1 khung".
 * ⚠ Mảng literal `position={[…]}` trên phần tử three KHÔNG gây `applyProps` (R3F `is.equ` so nông mảng), nhưng
 *   prop HÀM inline (`raycast={() => null}`, `onClick`) thì CÓ (hàm so theo tham chiếu ⇒ `applyProps` ⇒
 *   `invalidateInstance`) — chữ ký thứ hai đo được (`4019:73057`). Hoist theo đúng cơ chế, không theo cảm giác.
 */
/** Vị trí camera mặc định — hằng module, không phải literal trong destructuring (mỗi render một mảng mới). */
export const VI_TRI_CAMERA_MAC_DINH: readonly [number, number, number] = [30, 24, 30];
/** Vị trí đèn hướng mặc định — cùng lý do. */
export const VI_TRI_DEN_HUONG_MAC_DINH: readonly [number, number, number] = [40, 60, 25];
/** Tuỳ chọn WebGLRenderer — một đối tượng cho cả đời module. ★ RB-6: WebGLRenderer mặc định, KHÔNG WebGPU. */
const GL_MAC_DINH = {
  antialias: true,
  powerPreference: "high-performance" as const,
  // Cho phép trình duyệt hạ thay vì mất context khi tài nguyên eo hẹp.
  failIfMajorPerformanceCaveat: false,
};
/** `onCreated` — hàm module, không phải arrow mới mỗi render. */
function khiTaoCanvas({ gl }: RootState): void {
  gl.toneMapping = THREE.NoToneMapping;
  // Bóng đổ tắt hẳn: bật shadow map làm `demand` mất tác dụng (xem DenCoBan).
  gl.shadowMap.enabled = false;
}

/** Hình dạng các cửa sổ đo mà e2e đọc. Khai một chỗ để test và mã không lệch nhau. */
export interface CuaSoDoTwin3d {
  /** Số `<KhungCanh>` đang mount. RB-4 đòi giá trị này ≤ 1. */
  __soCanvas?: number;
  /** `renderer.info.render` của khung vừa vẽ. §4: calls ≤ 150, triangles ≤ 500.000. */
  __thongKeVe?: {
    calls: number;
    triangles: number;
    /** Số lần mất WebGL context kể từ khi tải trang — 0 là bình thường. */
    matContext: number;
    /** Số lần context được khôi phục. */
    khoiPhuc: number;
  };
  /**
   * ★ Đợt 33 — tư thế camera SAU MỖI lần điều khiển dừng / tween kết thúc
   *   (`CanhVanHanh.camDoi`). Cửa sổ đo cho `?cam=` (Pareto #9): không có nó, cách
   *   duy nhất biết camera đã bay là so vị trí nhãn — gián tiếp và mù khi 0 nhãn.
   */
  __tuTheCamera?: { x: number; y: number; z: number; mucX: number; mucZ: number };
  /**
   * ★ Đợt 47 (A.2) — CỬA SỔ ĐO TƯƠNG TÁC, chỉ gắn khi `laCheDoDo()` (build DEV hoặc URL `?do=1`).
   *
   * QA Đợt 46 đo "bấm/rê máy trên cảnh" bằng lưới điểm + đọc cursor — mù cả hai chiều: cursor
   * không ai đặt ở `CanhVanHanh`, còn lưới điểm có thể trượt khỏi hình học. Cửa sổ này đọc thẳng
   * CƠ CHẾ: `demObject` = số object đang nằm trong `internal.interaction` của R3F và bao nhiêu
   * trong đó THẬT SỰ còn handler (`__r3f.eventCount > 0`) + còn trong scene (Đợt 47 đo được
   * `1 / 0 / 0` ở HEAD trước vá — lô rỗng lúc chưa có dữ liệu nằm lại danh sách); `hitTai` =
   * raycast tại NDC qua ĐÚNG danh sách R3F sẽ quét khi có click; `tamMay`/`dsMay` (gắn bởi
   * `LoBatchMay`) = tâm khối máy chiếu ra px canvas để e2e bấm ĐÚNG KHỐI, không bấm nhãn.
   */
  __demTuongTac?: {
    demObject?: () => { soObject: number; coHandler: number; trongScene: number; ten: string[] };
    /**
     * ★ Đợt 49 (A) — trả thêm `machineId` (đã đổi `batchId` → id máy qua bảng tra của `LoBatchMay`)
     * và `domTai` (phần tử DOM TRÊN CÙNG tại điểm ấy). Đợt 48 phải tự đổi id ngoài trang và không
     * biết lớp phủ nào đang nằm trên — hai bước suy diễn mà phép đo tự làm được.
     */
    hitTai?: (
      ndcX: number,
      ndcY: number,
    ) => {
      ten: string;
      batchId: number | null;
      machineId: number | null;
      khoangCach: number;
      domTai: { the: string; testid: string | null; machineId: number | null } | null;
    } | null;
    /** ★ Đợt 49 — `batchId` (chỉ số instance trong lô) → id máy. `LoBatchMay` gắn; `hitTai` dùng. */
    mayTuBatch?: (batchId: number) => number | null;
    /**
     * ★ Đợt 49 (mục B) — SỐ LẦN `LoBatchMay` dựng lại `BatchedMesh` từ lúc tải trang. Bất biến
     * §6.2 nói "không dựng lại vì một cập nhật trạng thái"; số này là cách duy nhất biết nó đúng.
     * Đếm ở SẢN PHẨM (không gác `laCheDoDo`): một phép cộng số nguyên mỗi lần dựng.
     */
    soLanDungLo?: number;
    /**
     * ★ Đợt 49 (A) — thêm `biChe`: raycast camera→TÂM khối; giao đầu tiên KHÔNG phải máy này ⇒ id
     * máy đang che (tâm không bấm được). `null` = tâm thấy được.
     */
    tamMay?: (
      machineId: number,
    ) => { x: number; y: number; ndcX: number; ndcY: number; trongKhung: boolean; biChe: number | null } | null;
    dsMay?: () => Array<{ machineId: number; x: number; y: number; trongKhung: boolean }>;
    /** ★ Đợt 49 (A) — hộp THẬT của các nhãn đang vẽ (`LopNhan` gắn), px gốc canvas. */
    hopNhanDaVe?: () => Array<{ machineId: number; hop: { trai: number; phai: number; tren: number; duoi: number } }>;
    /** ★ Đợt 49 (A) — hình chiếu màn hình của KHỐI 3D từng máy (`LopNhan` gắn), px gốc canvas. */
    hopKhoiMay?: () => Array<{ machineId: number; hop: { trai: number; phai: number; tren: number; duoi: number } }>;
  };
  /**
   * ★★★ TASK 12 — CỬA SỔ ĐO **LỚP PHỦ VÒNG SỨC KHOẺ** (A-4), chỉ gắn khi `laCheDoDo()`.
   *
   * Vì sao phải có, và vì sao không có cách nào khác: vòng viền đế là hình 3D
   * trong buffer WebGL, còn `preserveDrawingBuffer` KHÔNG bật (bật lên là trả giá
   * khung hình ở mọi khung, cho một nhu cầu chỉ của QA). Nên `toDataURL()` /
   * `readPixels` trả **0 điểm ảnh khác nền** — *không phân biệt được cảnh vẽ đủ
   * vòng với cảnh không vẽ gì*. `__demNhan`/`__demBadge` đếm hai lớp KHÁC (nhãn,
   * badge) và mù hoàn toàn với lớp này. Đó là lý do 11 đợt QA không ai đo được
   * A-4: **không phải vì khó, mà vì không có bộ đếm nào cả**.
   *
   * · `tong`     — số vòng lớp nhận để dựng (`inst.count` của `LopVienSucKhoe`).
   * · `theoHang` — chia theo hạng; MỌI hạng có vòng đều có mặt, kể cả khi bằng 0
   *   (một `undefined` ở đây nói "bộ đếm không tồn tại", không nói "không có
   *   vòng nào" — hai câu khác hẳn nhau).
   *
   * ⚠ Số này là số vòng **được giao cho lớp vẽ**, đo ở đúng mảng mà trang truyền
   *   vào `<CanhVanHanh vienSucKhoe={…}>`; lưới `vienSucKhoeDoDuoc.dom.test.tsx`
   *   ghim rằng hai chỗ ấy là CÙNG một định danh, để bộ đếm không thể đếm một
   *   mảng mà cảnh không hề nhận (lớp lỗi `wip={[]}`).
   */
  __demVien?: { tong: number; theoHang: Record<string, number> };
  /**
   * ★★★ TASK 20 — CỬA SỔ ĐO **SA BÀN TẬP ĐOÀN** (`LopSaBan` gắn, chỉ ở chế độ đo).
   *
   * Tiêu chí nghiệm thu của Task 20 là một con số PIXEL ("mỗi biểu tượng toà nhà
   * rộng ≥ 24 px ở khung mặc định 1280×720"), và không phép đo nào đang có nói
   * được nó: `__thongKeVe` đếm draw call, `__demTuongTac.dsMay` chỉ biết máy (sa
   * bàn không vẽ máy nào), `toDataURL` trả 0 điểm khác nền vì
   * `preserveDrawingBuffer` tắt. Suy từ toạ độ chiếu ngoài trang là ĐÚNG cách
   * Task 19 khai "3 cụm" trong khi ảnh chụp vẫn đen.
   *
   * · `bieuTuong()` — bao hình MÀN HÌNH (px gốc canvas) của từng khối, kèm
   *   `factoryId` để gom cụm theo NHÀ MÁY (nguồn độc lập: dải mã của bộ sinh),
   *   không theo khe hở trên màn.
   * · `soNhan()`    — `{ve, an, tong}`: nhãn THẬT SỰ đọc được / bị lớp phủ DOM
   *   nuốt / tổng. Một con số duy nhất ở đây sẽ tái lập đúng lời khai sai của QA
   *   Đợt 32 ("nhãn vẽ rồi" trong khi nó nằm dưới bảng `Metrics` z-30).
   */
  __demSaBan?: {
    bieuTuong: () => Array<{
      toaNhaId: number;
      factoryId: number;
      chiSoCum: number;
      hop: { trai: number; phai: number; tren: number; duoi: number };
      rongPx: number;
      caoPx: number;
      trongKhung: boolean;
    }>;
    /**
     * `{ve, an, tong}` — và từ bản vá NHÃN-CỤM, `ve + an === tong` LUÔN đúng, kèm
     * hai lý do ẩn tách riêng. Trước đó nhánh "không chiếu được" ẩn nhãn mà không
     * cộng vào `an`, nên ở vai `qatd_admin` (khuôn viên 30,8 km) bộ đếm trả
     * `{ve:0, an:0, tong:19}` giữa lúc **cả 19 nhãn** đều `display:none`.
     */
    soNhan: () => {
      ve: number;
      an: number;
      /** Ẩn vì không chỗ nào thoát lớp phủ DOM. */
      anVungCam: number;
      /** Ẩn vì không chiếu được ra khung (sau lưng/ngoài mặt phẳng xa). */
      anNgoaiKhung: number;
      tong: number;
    };
  };
}

type WindowDo = Window & CuaSoDoTwin3d;

export interface KhungCanhProps {
  children: ReactNode;
  /** Vị trí camera ban đầu. Đặt MỘT LẦN — đổi prop sau không dời camera. */
  viTriCamera?: readonly [number, number, number];
  fov?: number;
  far?: number;
  /** Màu nền cảnh. Truyền token đã phân giải, KHÔNG truyền `var(--…)`. */
  mauNen?: string;
  /** Cường độ đèn — chỉnh theo theme sáng/tối ở tầng gọi. */
  cuongDoBanCau?: number;
  cuongDoHuong?: number;
  /** Vị trí đèn hướng; mặc định suy từ bán kính cảnh. */
  viTriDenHuong?: readonly [number, number, number];
  className?: string;
  /**
   * Chữ hiện khi mất WebGL context, ĐÃ qua `t()` ở tầng gọi.
   * Kit không gọi `t()` trực tiếp: nó còn được dùng ngoài cây i18n (Storybook,
   * e2e), và một `useTranslation()` ở đây biến mọi nơi dùng kit thành phụ thuộc
   * i18n. Khoá có sẵn: `twin3d.loi.matContext`.
   */
  chuMatContext?: string;
  /** Gọi khi mất/khôi phục context — để tầng trên hiện thông báo cho người dùng. */
  onMatContext?: () => void;
  onKhoiPhucContext?: () => void;
  "data-testid"?: string;
  /**
   * ★ ĐỢT 35 (Pareto #4) — SÀN chiều cao khung (px). Mặc định {@link SAN_CAO_KHUNG_CANH_PX}.
   *
   * Vì sao thành prop: màn Máy ở 1280×720 chỉ còn 595 px cho cả cảnh 3D lẫn cockpit
   * 2D; sàn 320 cứng làm cảnh 320 > cockpit 275 — **vi phạm bất biến `cockpit.h >
   * khoiCanh.h`** mà e2e Đợt 31 ghim ở 1600×900 (§15.3.3: cấp Máy chỉ ~20–36 %).
   * Màn ấy truyền sàn riêng (`SAN_KHOI_CANH_MAY_PX`, `manMay.ts`); mọi màn khác giữ 320.
   * ⚠ KHÔNG hạ mặc định: `/twin` và studio dựa vào 320 (Đợt 31 đo canvas tràn 14 px
   *   khi khung 306 < 320 — sàn của khung phải ≥ sàn của canvas, hoặc canvas chui).
   */
  sanCaoPx?: number;
}

/** Sàn chiều cao mặc định của khung (px) — G91: một hằng có tên, test đọc từ đây. */
export const SAN_CAO_KHUNG_CANH_PX = 320;

/**
 * ĐẾM canvas sống toàn cục (RB-4). Biến ở module scope chứ không ở state React:
 * hai `<KhungCanh>` là hai cây React khác nhau, không chia sẻ state được.
 */
let soCanvasDangSong = 0;

/**
 * ★★★ ĐỢT 38 (RB-4/G99) — BỘ ĐẾM CANVAS SỐNG là MỘT HOOK CÓ EXPORT, để một `<Canvas>` KHÔNG đi qua `<KhungCanh>`
 *   (tab "3D model" của `MachineCockpit`, drei) cũng ĐĂNG KÝ vào cùng bộ đếm. QA Đợt 32/37 đo `/twin/may/14` bấm
 *   tab 3D ⇒ DOM **2** canvas mà `window.__soCanvas` = **1**: phép đo RB-4 MÙ đúng canvas nó phải bắt (G99).
 *   Cảnh báo TO khi > 1: nhiều canvas cùng lúc làm cạn WebGL context và biểu hiện là canvas ĐEN, không phải một
 *   lỗi đọc được. Gọi đúng MỘT lần trong component bao `<Canvas>` (một mount = một canvas sống).
 */
export function useDemCanvasSong(): void {
  useEffect(() => {
    soCanvasDangSong += 1;
    if (typeof window !== "undefined") (window as WindowDo).__soCanvas = soCanvasDangSong;
    if (soCanvasDangSong > 1) {
      console.error(
        `[twin3d] RB-4 vi phạm: ${soCanvasDangSong} canvas WebGL đang sống cùng lúc. ` +
          "Chỉ MỘT canvas WebGL được phép mount tại một thời điểm.",
      );
    }
    return () => {
      soCanvasDangSong -= 1;
      if (typeof window !== "undefined") (window as WindowDo).__soCanvas = soCanvasDangSong;
    };
  }, []);
}

/** Một vòng đủ để ĐẾM. Khai tại chỗ chứ không nhập `VienDeMay`: kit `loi` không được phụ thuộc `van-hanh`. */
export interface VienDemDuoc {
  hang: string;
}

/**
 * ★★★ TASK 12 — GẮN `window.__demVien` (xem {@link CuaSoDoTwin3d.__demVien}).
 *
 * Đúng khuôn `__demTuongTac`: **chỉ ở chế độ đo** (build DEV hoặc `?do=1`), dọn
 * sạch khi rời màn, và không đổi một byte nào của sản phẩm khi cờ tắt.
 *
 * ★ Gọi ở TRANG, cạnh chỗ tính danh sách vòng, chứ không ở trong `<Canvas>`:
 *   danh sách ấy là thứ trang trao cho `<CanhVanHanh vienSucKhoe={…}>`, nên đếm
 *   ở đây là đếm đúng vật mà lớp vẽ nhận. (Đếm bên trong cảnh thì phải nhận diện
 *   `InstancedMesh` theo MÀU — một phép đo gián tiếp qua bảng màu, và nó sẽ sai
 *   im lặng ngay lần đầu ai đó chỉnh `mauVienSucKhoe`.)
 *
 * @param vien    danh sách vòng sẽ dựng; `null`/`undefined` cũng là **0**, không phải "chưa đo".
 * @param hangNen các hạng phải LUÔN có mặt trong `theoHang` kể cả khi bằng 0. Truyền
 *                `MOI_HANG_CO_VIEN` của `sucKhoeMay.ts` — tri thức về hạng thuộc tầng
 *                nghiệp vụ, kit chỉ đếm.
 * @param cheDoDo mặc định `laCheDoDo()`; tham số hoá để lưới kiểm được CẢ nhánh tắt.
 */
export function useDemVienSucKhoe(
  vien: readonly VienDemDuoc[] | null | undefined,
  hangNen: readonly string[] = [],
  cheDoDo: boolean = laCheDoDo(),
): void {
  useEffect(() => {
    if (typeof window === "undefined" || !cheDoDo) return;
    const w = window as WindowDo;
    const theoHang: Record<string, number> = {};
    for (const h of hangNen) theoHang[h] = 0;
    for (const v of vien ?? []) theoHang[v.hang] = (theoHang[v.hang] ?? 0) + 1;
    w.__demVien = { tong: vien?.length ?? 0, theoHang };
    return () => {
      delete w.__demVien;
    };
  }, [vien, hangNen, cheDoDo]);
}

/**
 * Ba đèn TỐI ĐA (§4: "Đèn ≤ 3, không point-light shadow"). Hemisphere cho ánh
 * sáng nền dịu, Directional cho hình khối đọc được, Ambient nâng vùng tối.
 * KHÔNG shadow map realtime — bật lên là mất `frameloop="demand"` vì bóng phải
 * tính lại mỗi khung.
 */
function DenCoBan({
  cuongDoBanCau,
  cuongDoHuong,
  viTriDenHuong,
}: {
  cuongDoBanCau: number;
  cuongDoHuong: number;
  viTriDenHuong: readonly [number, number, number];
}) {
  return (
    <>
      <hemisphereLight color="#ffffff" groundColor="#94a3b8" intensity={cuongDoBanCau} />
      <directionalLight
        position={viTriDenHuong as [number, number, number]}
        intensity={cuongDoHuong}
        castShadow={false}
      />
      <ambientLight intensity={0.3} />
    </>
  );
}

/**
 * Bơm `renderer.info.render` ra `window.__thongKeVe` SAU mỗi khung được vẽ.
 *
 * ★★★ ĐỢT 49 (mục F) — CHÚ THÍCH CŨ NÓI NGƯỢC CƠ CHẾ. Nguyên văn: *"Ưu tiên -1 để chạy SAU mọi
 * `useFrame` khác trong cùng khung"*. Đọc bundle R3F 9.5 (`events-5a94e5eb.esm.js:1085` và
 * `:16008-16016`): `internal.subscribers` được `sort((a, b) => a.priority - b.priority)` — TĂNG
 * DẦN — rồi chạy theo thứ tự ấy, và `gl.render(scene, camera)` chạy SAU TOÀN BỘ vòng lặp đó.
 * Nghĩa là ưu tiên -1 chạy **ĐẦU TIÊN**, và **trước** cả lần render của khung này.
 *
 * ⇒ `__thongKeVe` luôn mang số của khung TRƯỚC (trễ đúng một khung) — chính điều chú thích cũ
 *   tuyên bố đã tránh được. Giữ nguyên hành vi có chủ đích: `useFrame` KHÔNG có cách nào chạy
 *   sau lần render tự động (mọi ưu tiên > 0 làm R3F giao quyền render cho người gọi —
 *   `!state.internal.priority` ở dòng 16016 — tức tắt hẳn việc vẽ của cảnh). Trễ một khung vô
 *   hại cho công dụng thật của ô này ("cảnh đã vẽ chưa": `calls > 0`), nhưng ai đọc nó như số
 *   của KHUNG HIỆN TẠI (ví dụ ngưỡng "≤ 150 draw calls" ngay sau một thao tác) sẽ đọc nhầm.
 */
function BomThongKe() {
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    if (typeof window === "undefined") return;
    const w = window as WindowDo;
    const truoc = w.__thongKeVe;
    w.__thongKeVe = {
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      matContext: truoc?.matContext ?? 0,
      khoiPhuc: truoc?.khoiPhuc ?? 0,
    };
  }, -1);
  return null;
}

/**
 * Bắt `webglcontextlost` / `webglcontextrestored` trên đúng phần tử canvas.
 *
 * `preventDefault()` trên `webglcontextlost` là dòng SỐNG CÒN: không gọi thì trình
 * duyệt KHÔNG BAO GIỜ phát `webglcontextrestored`, và canvas đen vĩnh viễn dù mọi
 * mã khôi phục đều đúng.
 */
function BatMatContext({
  onMat,
  onKhoiPhuc,
}: {
  onMat?: () => void;
  onKhoiPhuc?: () => void;
}) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const canvas = gl.domElement;

    const khiMat = (e: Event) => {
      e.preventDefault(); // ★ không có dòng này thì không có khôi phục
      if (typeof window !== "undefined") {
        const w = window as WindowDo;
        w.__thongKeVe = {
          calls: w.__thongKeVe?.calls ?? 0,
          triangles: w.__thongKeVe?.triangles ?? 0,
          matContext: (w.__thongKeVe?.matContext ?? 0) + 1,
          khoiPhuc: w.__thongKeVe?.khoiPhuc ?? 0,
        };
      }
      onMat?.();
    };

    const khiKhoiPhuc = () => {
      if (typeof window !== "undefined") {
        const w = window as WindowDo;
        w.__thongKeVe = {
          calls: w.__thongKeVe?.calls ?? 0,
          triangles: w.__thongKeVe?.triangles ?? 0,
          matContext: w.__thongKeVe?.matContext ?? 0,
          khoiPhuc: (w.__thongKeVe?.khoiPhuc ?? 0) + 1,
        };
      }
      // Sau khi khôi phục, three cần dựng lại toàn bộ trạng thái GPU rồi vẽ.
      // `frameloop="demand"` nghĩa là không ai vẽ hộ — phải tự gọi.
      gl.resetState();
      invalidate();
      onKhoiPhuc?.();
    };

    canvas.addEventListener("webglcontextlost", khiMat, false);
    canvas.addEventListener("webglcontextrestored", khiKhoiPhuc, false);
    return () => {
      canvas.removeEventListener("webglcontextlost", khiMat);
      canvas.removeEventListener("webglcontextrestored", khiKhoiPhuc);
    };
  }, [gl, invalidate, onMat, onKhoiPhuc]);

  return null;
}

/**
 * ★ Đợt 47 (A.2) — cửa sổ đo tương tác `window.__demTuongTac` (xem `CuaSoDoTwin3d`).
 *
 * Chỉ gắn khi `laCheDoDo()` — sản phẩm không có gì thay đổi. Mọi hàm đọc `get()` LÚC GỌI
 * (không giữ bản chụp state): `internal.interaction` và camera đổi theo thời gian, và chính
 * sự đổi đó là thứ cần đo (lô máy đổi ⇒ handler còn không?).
 */
function CuaSoDoTuongTac() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (typeof window === "undefined" || !laCheDoDo()) return;
    const w = window as WindowDo;
    const cua = w.__demTuongTac ?? (w.__demTuongTac = {});
    const coHandler = (o: THREE.Object3D) =>
      ((o as unknown as { __r3f?: { eventCount?: number } }).__r3f?.eventCount ?? 0) > 0;
    cua.demObject = () => {
      const st = get();
      const inter = st.internal.interaction;
      const trongScene = (o: THREE.Object3D) => {
        let p: THREE.Object3D = o;
        while (p.parent) p = p.parent;
        return p === st.scene;
      };
      return {
        soObject: inter.length,
        coHandler: inter.filter(coHandler).length,
        trongScene: inter.filter(trongScene).length,
        ten: inter.map((o) => o.name || o.type),
      };
    };
    cua.hitTai = (ndcX, ndcY) => {
      const st = get();
      st.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), st.camera);
      const hits = st.raycaster.intersectObjects(st.internal.interaction.filter(coHandler), true);
      const h = hits[0] as (THREE.Intersection & { batchId?: number }) | undefined;
      if (!h) return null;
      const batchId = typeof h.batchId === "number" ? h.batchId : null;
      // ★ Đợt 49 — phần tử DOM TRÊN CÙNG tại đúng điểm ấy: NDC → px client qua bbox canvas thật.
      let domTai: { the: string; testid: string | null; machineId: number | null } | null = null;
      try {
        const r = st.gl.domElement.getBoundingClientRect();
        const el = document.elementFromPoint(
          r.left + ((ndcX + 1) / 2) * r.width,
          r.top + ((1 - ndcY) / 2) * r.height,
        );
        if (el) {
          const idAttr = el.closest("[data-machine-id]")?.getAttribute("data-machine-id") ?? null;
          domTai = {
            the: el.tagName,
            testid: el.getAttribute("data-testid"),
            machineId: idAttr === null ? null : Number(idAttr),
          };
        }
      } catch {
        domTai = null;
      }
      return {
        ten: h.object.name || h.object.type,
        batchId,
        machineId: batchId === null ? null : (cua.mayTuBatch?.(batchId) ?? null),
        khoangCach: h.distance,
        domTai,
      };
    };
    return () => {
      delete cua.demObject;
      delete cua.hitTai;
    };
  }, [get]);
  return null;
}

/**
 * ★★★ Đợt 47 (N1) — LỚP PHỦ DOM ĐỔI KÍCH THƯỚC / XUẤT HIỆN ⇒ YÊU CẦU MỘT KHUNG.
 *
 * `LopNhan`/`LopCanhBao` đọc vùng cấm (`[data-che-nhan]`) trong `useFrame` — tức chỉ ở khung ĐƯỢC VẼ.
 * Với `frameloop="demand"`, thẻ "Chỉ số" (`bang-kpi-noi`) lớn lên khi truy vấn KPI về mà KHÔNG có khung
 * nào ⇒ badge/nhãn giữ vị trí tính trên vùng cấm CŨ. Đo được sau vá N1 (`.qa-dot47/probe/nhan47-sau.json`):
 * `__demBadge.soVungCam = 5`, `biChe = 0` mà badge SPI đỏ vẫn nằm trọn dưới thẻ KPI 1.428 px² — thuật toán
 * đúng trên dữ liệu cũ. ResizeObserver trên MỌI lớp phủ + quét lớp phủ mới khi DOM đổi ⇒ `invalidate()`
 * đúng lúc hình dạng vùng cấm đổi; không đổi ⇒ không khung (giữ idle 0 khung/40 s của Đợt 40 T4).
 *
 * ★★★ ĐỢT 59 (mục A) — **LỚP PHỦ DỜI CHỖ MÀ KHÔNG ĐỔI CỠ: `ResizeObserver` MÙ HOÀN TOÀN.**
 *
 * QA lần 10 (§14q.37) đo được: ở 1600×900, THU rồi MỞ LẠI panel trái ⇒ 2 nhãn 3D nằm dưới tay nắm
 * và **ở lì ≥ 17 s**, chỉ một lần đổi cỡ cửa sổ mới dọn. Brief đoán "tay nắm không nằm trong tập
 * quan sát" — SAI: `nut-thu-trai` CÓ `data-che-nhan` nên `quet()` ĐÃ `ro.observe` nó từ khung đầu.
 * Lỗ nằm ở CHỖ KHÁC: tay nắm đổi `left` (`left-0` ↔ `left-56 2xl:left-72`) qua
 * `transition-[left] duration-200` — **kích thước không đổi một pixel nào**, và `ResizeObserver`
 * theo đặc tả chỉ báo khi hộp CỠ đổi, không báo khi phần tử DỜI CHỖ. Chuỗi thật:
 *   t=0   panel `w-0 → w-72` ⇒ RO kêu ⇒ `invalidate()` ⇒ khung được vẽ **trong khi tay nắm còn ở left≈0**
 *         ⇒ `locNhan` chỉ tránh dải x∈[0,21], thả nhãn vào chỗ tay nắm SẮP tới.
 *   t=200 tay nắm tới `left=288`. **Không ai kêu** ⇒ `frameloop="demand"` không vẽ khung nào nữa
 *         ⇒ nhãn ở lì dưới tay nắm cho tới lần `invalidate()` kế (đổi cỡ cửa sổ, xoay camera…).
 *
 * ★ Vá = **đóng đúng cái lỗ ấy trong CÙNG cơ chế**, không đẻ cơ chế mới: RO lo "đổi CỠ",
 *   `transitionend`/`transitioncancel` lo "đổi CHỖ". Cả hai cùng đổ về một `invalidate()`.
 * ★ Lọc theo `propertyName` thuộc nhóm HÌNH HỌC (`left/right/top/bottom/width/height/transform/…`):
 *   `transition-colors` của mọi nút hover trong panel KHÔNG được phép mua một khung — nếu không
 *   thì "idle 0 khung/40 s" (Đợt 40 T4) chết ngay. Màu/mờ/đổ bóng không dời vùng cấm một pixel nào.
 * ★ Nghe ở `document` pha bắt (`transitionend` có nổi bọt) rồi `closest([data-che-nhan])`: một
 *   lớp phủ có thể transition ở phần tử CON (ví dụ khung trong của một panel), và vùng cấm là
 *   bbox của phần tử tự khai — con dời thì hộp cha vẫn có thể đổi.
 */
function TheoDoiLopPhu() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof ResizeObserver === "undefined" ||
      typeof MutationObserver === "undefined"
    )
      return;
    const daTheoDoi = new WeakSet<Element>();
    const ro = new ResizeObserver(() => invalidate());
    const quet = () => {
      let moi = false;
      for (const el of document.querySelectorAll(`[${THUOC_TINH_CHE_NHAN}]`)) {
        if (daTheoDoi.has(el)) continue;
        daTheoDoi.add(el);
        ro.observe(el);
        moi = true;
      }
      if (moi) invalidate();
    };
    quet();
    // Chỉ `childList`: lớp phủ MỚI gắn vào cây. Không `attributes` — mỗi khung nhãn/badge đổi style hàng chục lần.
    const mo = new MutationObserver(quet);
    mo.observe(document.body, { childList: true, subtree: true });
    // ★ Đợt 59 (A) — lớp phủ DỜI CHỖ (xem `theoDoiDoiCho.ts`): RO mù, `transitionend` là chỗ duy nhất biết.
    const khiXongChuyenTiep = taoBoNgheDoiCho(invalidate, THUOC_TINH_CHE_NHAN);
    document.addEventListener("transitionend", khiXongChuyenTiep, true);
    document.addEventListener("transitioncancel", khiXongChuyenTiep, true);
    return () => {
      mo.disconnect();
      ro.disconnect();
      document.removeEventListener("transitionend", khiXongChuyenTiep, true);
      document.removeEventListener("transitioncancel", khiXongChuyenTiep, true);
    };
  }, [invalidate]);
  return null;
}

/** Đặt camera ban đầu ĐÚNG MỘT LẦN — đổi prop sau không giật camera của người dùng. */
function CameraBanDau({ viTri }: { viTri: readonly [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const xong = useRef(false);
  useEffect(() => {
    if (xong.current) return;
    xong.current = true;
    camera.position.set(viTri[0], viTri[1], viTri[2]);
    camera.lookAt(0, 0, 0);
    invalidate();
  }, [camera, viTri, invalidate]);
  return null;
}

export function KhungCanh({
  children,
  viTriCamera = VI_TRI_CAMERA_MAC_DINH,
  fov = 45,
  far = 2000,
  mauNen = "#eef2f6",
  cuongDoBanCau = 1.1,
  cuongDoHuong = 1.3,
  viTriDenHuong = VI_TRI_DEN_HUONG_MAC_DINH,
  className,
  chuMatContext,
  onMatContext,
  onKhoiPhucContext,
  "data-testid": testId = "khoi-canh-3d",
  sanCaoPx = SAN_CAO_KHUNG_CANH_PX,
}: KhungCanhProps) {
  const [matContext, setMatContext] = useState(false);

  // RB-4 — đếm canvas sống qua MỘT cài đặt (`useDemCanvasSong`, Đợt 38: cockpit dùng chung bộ đếm).
  useDemCanvasSong();

  // ★ Đợt 40 — tuỳ chọn camera chỉ đổi khi GIÁ TRỊ đổi (camera chỉ đặt một lần, nhưng prop ổn định thì
  //   `Canvas` không có lý do re-render vì ta). `viTriCamera` là mảng: người gọi giữ tham chiếu ổn định
  //   (`CanhVanHanh` memo theo `banKinh`), còn ở đây ghim theo ba số để không phụ thuộc kỷ luật ấy.
  const camera = useMemo(
    () => ({ fov, near: 0.1, far, position: viTriCamera as [number, number, number] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ghim theo GIÁ TRỊ ba toạ độ, không theo tham chiếu mảng
    [fov, far, viTriCamera[0], viTriCamera[1], viTriCamera[2]],
  );
  const mauNenArgs = useMemo(() => [mauNen] as [string], [mauNen]);
  // Hai callback context: ổn định theo callback của tầng trên (thường `undefined` ⇒ hằng).
  const khiMat = useMemo(
    () => () => {
      setMatContext(true);
      onMatContext?.();
    },
    [onMatContext],
  );
  const khiKhoiPhuc = useMemo(
    () => () => {
      setMatContext(false);
      onKhoiPhucContext?.();
    },
    [onKhoiPhucContext],
  );

  return (
    <div
      className={className}
      data-testid={testId}
      style={{ position: "relative", width: "100%", height: "100%", minHeight: sanCaoPx, background: mauNen }}
    >
      <Canvas
        frameloop="demand"
        dpr={DPR_TRAN}
        shadows={false}
        // ★ RB-6: WebGLRenderer mặc định. KHÔNG truyền `gl` WebGPU. ★ Đợt 40: hằng module, không literal.
        gl={GL_MAC_DINH}
        camera={camera}
        onCreated={khiTaoCanvas}
      >
        <color attach="background" args={mauNenArgs} />
        <DenCoBan
          cuongDoBanCau={cuongDoBanCau}
          cuongDoHuong={cuongDoHuong}
          viTriDenHuong={viTriDenHuong}
        />
        <CameraBanDau viTri={viTriCamera} />
        <BatMatContext onMat={khiMat} onKhoiPhuc={khiKhoiPhuc} />
        <BomThongKe />
        <CuaSoDoTuongTac />
        <TheoDoiLopPhu />
        {children}
      </Canvas>

      {/* Lớp phủ khi mất context — người dùng phải biết mình đang nhìn khung chết. */}
      {matContext ? (
        <div
          data-testid="canh-bao-mat-context"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(15,23,42,0.55)",
            color: "#f8fafc",
            fontSize: 13,
            fontWeight: 600,
            pointerEvents: "none",
          }}
        >
          {chuMatContext ?? ""}
        </div>
      ) : null}
    </div>
  );
}

export default KhungCanh;
