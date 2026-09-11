/**
 * CanhVanHanh.tsx — cảnh 3D của màn Vận hành `/twin`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ RB-4 — ĐÂY LÀ NƠI DUY NHẤT CỦA MÀN VẬN HÀNH DỰNG `<KhungCanh>`
 * ════════════════════════════════════════════════════════════════════════════
 * `KhungCanh` là cửa duy nhất vào WebGL của kit, và nó tự `console.error` khi
 * `window.__soCanvas > 1`. Component này KHÔNG được đặt trong một nhánh điều
 * kiện có thể dựng thêm bản thứ hai; bản 2D thay thế nó (không đứng cạnh nó).
 *
 * ★ RB-3 — `taoDieuKhienQuay` nhận `invalidate` là tham số BẮT BUỘC.
 * ★ RB-5 — không `<Environment>`, không CDN. Đèn do `KhungCanh` lo.
 * ★ RB-7 — mọi geometry/material tự cấp phát đều `dispose()` trong cleanup.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NT-2 — KHÔNG CÓ NÚT NÀO TRÊN 3D
 * ════════════════════════════════════════════════════════════════════════════
 * Cảnh này chỉ ĐỊNH VỊ và CHỌN. Mọi hành động (ack, tạo phiếu, gán KTV) nằm ở
 * `NganXuLy` — bề mặt 2D tuân ISA-101. Đừng thêm nút nổi trên máy 3D: đó chính
 * là chế độ hỏng mà quy tắc "No 3D graphical objects" của ASM sinh ra để phòng.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ §10.3 — BADGE ALARM VẼ Ở KHÔNG GIAN MÀN HÌNH
 * ════════════════════════════════════════════════════════════════════════════
 * Badge KHÔNG phải sprite trong thế giới: phối cảnh sẽ thu nhỏ một badge P1 ở xa
 * thành không đọc nổi. Nó được `LopCanhBao` chiếu ra pixel và vẽ bằng DOM cỡ cố
 * định, và alarm bị hình học che sẽ NỔI LÊN RÌA màn hình kèm mũi tên — luật 3
 * của §10.3 ("góc camera không bao giờ được che một alarm đang hoạt động").
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { useOnDinhTheoGiaTri } from "./onDinhTheoGiaTri";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { useOptionalTheme } from "@/components/factory-scene/useOptionalTheme";

import {
  KhungCanh,
  LoBatchMay,
  LopNhan,
  TRANG_THAI_CHON_RONG,
  taoDieuKhienQuay,
  type CuaSoDoTwin3d,
  type MayTrongLo,
  type NhanTheGioi,
  type TrangThaiChon,
} from "../loi";
import { giaiMauCanh, mauChoTrangThai } from "../mauTrangThai";
import { mauHex, mauThree } from "./mauThree";
import type { KhungNhin } from "./phamViCanh";
import { TWEEN_DOI_CAP_MS } from "./phamViCanh";
import { LopCanhBao, type CanhBaoTheGioi } from "./LopCanhBao";
import { DongChayLine, type DiemDongChay } from "./DongChayLine";
import type { VienDeMay } from "./sucKhoeMay";
import { LopVung } from "../thiet-ke/LopVung";
import type { VungVe } from "../thiet-ke/vungAnToan";

export interface CanhVanHanhProps {
  may: MayTrongLo[];
  nhan: NhanTheGioi[];
  canhBao: CanhBaoTheGioi[];
  /** Đường tâm Line + hướng — chỉ có ở phạm vi Line (§10C.3). */
  dongChay: DiemDongChay | null;
  /** Cột WIP theo trạm — chỉ có ở phạm vi Line (§10C.3). */
  wip: readonly { x: number; z: number; cao: number; nghen: boolean }[];
  /**
   * ★★★ A-4 (§14.5.1, mục G-1) — VÒNG VIỀN SỨC KHOẺ quanh ĐẾ máy.
   *
   * KÊNH THỊ GIÁC RIÊNG, không dùng chung với A-1 (màu thân). Một máy *đang chạy*
   * mà *sức khoẻ 55%* phải đọc được là **thân xanh + viền hổ phách**; nếu A-4
   * cũng tô thân thì một trong hai sự thật bị nuốt.
   *
   * Mặc định `[]` ⇒ lớp `return null`, không cấp phát gì. Nhưng ★ đó cũng đúng
   * là chế độ hỏng G5 mà `wip` đã mắc một lần (`wip={[]}` viết cứng ⇒ lớp chạy
   * qua 994 test mà chưa vẽ pixel nào) — nên `noiLoD.dom.test.tsx`-kiểu test của
   * lớp này phải khẳng định trên tập KHÁC RỖNG.
   */
  vienSucKhoe?: readonly VienDeMay[];
  /**
   * ★★★ A-6 (§14.5.1, mục G-4) — VÙNG AN TOÀN / CHIA SẺ VỚI NGƯỜI, khối trong suốt.
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ TÁI DÙNG `LopVung` CỦA MÀN THIẾT KẾ — KHÔNG VIẾT BẢN THỨ HAI (G12)
   * ════════════════════════════════════════════════════════════════════════
   * `thiet-ke/LopVung.tsx` + `thiet-ke/vungAnToan.ts` (49 test) đã giải trọn bài
   * toán khó của A-6: bẫy hoán vị trục (`Shape` nằm trên X–Y, sàn nằm trên X–Z
   * ⇒ quên xoay −90° cho ra một tấm ván DỰNG ĐỨNG giữa xưởng mà **không có gì
   * nổ**), điểm đặt nhãn nằm trong vùng lõm, RB-7 dispose.
   *
   * Chép nó sang `van-hanh/` để "màn Vận hành có bản riêng" là đúng thứ G12 cấm,
   * và cái giá đã đo được: hai bản cài đặt hiếm khi chỉ lệch MỘT chỗ. Nên lớp
   * này `import` thẳng qua ranh giới thư mục — ranh giới đó là về **quyền ghi**
   * (thiết kế sửa được, vận hành chỉ đọc), không phải về hình học.
   *
   * ★ VẬN HÀNH CHỈ ĐỌC: `onChon` KHÔNG được truyền xuống. Màn Thiết kế cho chọn
   *   vùng để sửa; ở đây vùng là **bối cảnh**, và một cú bấm trúng vùng phải rơi
   *   xuống máy phía dưới chứ không cướp lấy selection (NT-2 — cảnh vận hành chỉ
   *   ĐỊNH VỊ và CHỌN MÁY).
   *
   * ★ NGÂN SÁCH: mỗi vùng là 1 mesh + 1 `<Html>`. Số vùng an toàn của một xưởng
   *   đếm bằng ĐƠN VỊ, không bằng chục (đo được 2026-09-08: `twin_vat_the` có
   *   **0 hàng `loai='vung'`** trên toàn hệ) — nên nó không đe doạ trần 30 nhãn
   *   của §4 như nhãn máy. `tatNhan` vẫn được chuyển tiếp để bậc `tat_nhan` của
   *   `matDoKhungHinh` tắt được cả nhãn vùng.
   */
  vung?: readonly VungVe[];
  machineIdChon: number | null;
  onChonMay: (machineId: number | null) => void;
  /** Khung nhìn đích; đổi giá trị ⇒ camera TWEEN tới (500 ms, §10C.2). */
  khungNhin: KhungNhin | null;
  sanRongM: number;
  sanSauM: number;
  tatNhan: boolean;
  /**
   * ★ ĐỢT 23 M1 — chỉ hiện nhãn máy **bất thường**. Chuyển thẳng xuống
   * `LopNhan`; đo được 45 ứng viên chỉ còn 8 nhãn vì khử chồng, nên cần một
   * chính sách chọn thay vì chỉ một con số trần.
   */
  chiNhanBatThuong?: boolean;
  /** Chữ ĐÃ dịch cho chip "còn N tên bị ẩn" (RB-8.3 — cảnh không gọi `t()`). */
  chuNhanAn?: (n: number) => string;
  /** ★ Đợt 45 (mục 4) — chữ ĐÃ dịch cho chip khi chỉ-nhãn-bất-thường bật (lý do ẩn = chính sách). */
  chuNhanAnTheoChinhSach?: (n: number) => string;
  /** ★ Đợt 35 (Pareto #5) — chữ ĐÃ dịch cho chip "N sự cố ngoài khung" (máy bất thường ngoài frustum). */
  chuSuCoNgoaiKhung?: (n: number) => string;
  chuMatContext: string;
  ariaLabel: string;
  /** Báo camera vừa đổi — tầng trên ghi vào URL bằng `replaceState` (§9.4). */
  onCameraDoi?: (viTri: THREE.Vector3, muc: THREE.Vector3) => void;
  /**
   * ★ Đợt 35 (Pareto #4) — sàn chiều cao khung, chuyển thẳng xuống `KhungCanh.sanCaoPx`.
   * Chỉ màn Máy truyền (`SAN_KHOI_CANH_MAY_PX`); bỏ trống ⇒ mặc định 320 của kit.
   */
  sanCaoPx?: number;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Điều khiển + tween đổi cấp                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * OrbitControls + tween camera khi đổi phạm vi.
 *
 * ★ RB-3 — `noiInvalidate` nằm sẵn trong `taoDieuKhienQuay`, nên xoay chuột luôn
 *   yêu cầu vẽ lại. Nhưng TWEEN thì `frameloop="demand"` KHÔNG tự biết: nó là
 *   animation do ta chạy, không do người dùng chạm. Nên `useFrame` dưới đây gọi
 *   `invalidate()` mỗi khung *trong lúc còn tween* — thiếu dòng đó camera sẽ
 *   "nhảy" một bước rồi đứng im cho tới khi ai đó chạm chuột.
 */
function DieuKhien({
  khungNhin,
  banKinhToiDa,
  controlsRef,
  onCameraDoi,
}: {
  khungNhin: KhungNhin | null;
  banKinhToiDa: number;
  controlsRef: React.MutableRefObject<OrbitControls | null>;
  onCameraDoi: (viTri: THREE.Vector3, muc: THREE.Vector3) => void;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  /** Trạng thái tween. `null` = không tween. */
  const tween = useRef<{
    tuViTri: THREE.Vector3;
    denViTri: THREE.Vector3;
    tuMuc: THREE.Vector3;
    denMuc: THREE.Vector3;
    batDau: number;
  } | null>(null);

  useEffect(() => {
    const { controls, huy } = taoDieuKhienQuay(camera, gl.domElement, invalidate, {
      khoangCachToiThieu: 1.5,
      khoangCachToiDa: Math.max(80, banKinhToiDa * 8),
    });
    controlsRef.current = controls;
    // Báo camera đổi để tầng trên ghi vào URL (`replaceState`, §9.4).
    const bao = () => onCameraDoi(camera.position, controls.target);
    controls.addEventListener("end", bao);
    return () => {
      controls.removeEventListener("end", bao);
      controlsRef.current = null;
      huy();
    };
  }, [camera, gl, invalidate, banKinhToiDa, controlsRef, onCameraDoi]);

  // Khởi động tween mỗi khi khung nhìn đích đổi.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!khungNhin || !controls) return;
    tween.current = {
      tuViTri: camera.position.clone(),
      denViTri: new THREE.Vector3(...khungNhin.viTri),
      tuMuc: controls.target.clone(),
      denMuc: new THREE.Vector3(...khungNhin.muc),
      batDau: performance.now(),
    };
    invalidate();
  }, [khungNhin, camera, controlsRef, invalidate]);

  useFrame(() => {
    const tw = tween.current;
    const controls = controlsRef.current;
    // ★★★ RB-3b (Lô U, Đợt 16) — QUÁN TÍNH ĐÒI `update()` MỖI KHUNG, KỂ CẢ KHI
    // KHÔNG TWEEN. Trước bản vá này thân hàm `return` ngay khi `tween` rỗng —
    // tức `controls.update()` CHỈ chạy trong lúc đổi phạm vi. Mà `enableDamping`
    // thì luôn bật: mỗi `update()` chỉ áp 8% cú chuột, phần dư 92% chờ lần sau
    // (three r182, OrbitControls.js:617-618, 701-704). Không tween ⇒ không ai
    // gọi ⇒ phần dư bị vứt ⇒ camera khựng lại khi nhả chuột.
    //
    // Đây đúng là điều kiện kích hoạt của chữ *"thi thoảng"*: quán tính chỉ
    // chạy trơn trong lúc còn tween đổi phạm vi, mọi lúc khác thì cụt.
    if (!controls) return;
    if (!tw) {
      // `update()` tự phát `change` (⇒ `invalidate`) chỉ khi camera còn dịch
      // quá `_EPS` (OrbitControls.js:812-815), nên vòng này TỰ TẮT khi camera
      // đứng yên — `frameloop="demand"` vẫn được tôn trọng.
      controls.update();
      return;
    }
    const t = Math.min(1, (performance.now() - tw.batDau) / TWEEN_DOI_CAP_MS);
    // ease-out cubic — dừng êm, không phanh gấp ở cuối.
    const e = 1 - (1 - t) ** 3;
    camera.position.lerpVectors(tw.tuViTri, tw.denViTri, e);
    controls.target.lerpVectors(tw.tuMuc, tw.denMuc, e);
    controls.update();
    // ★ Bắt buộc với `frameloop="demand"`: tween là animation của TA.
    invalidate();
    if (t >= 1) {
      tween.current = null;
      onCameraDoi(camera.position, controls.target);
    }
  });

  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Sàn                                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Sàn xám trung tính (§10.1: "sàn, tường, cột: xám trung tính, phân biệt nhau
 * bằng độ sáng, không bằng sắc"). Cả ba màu đổi theo theme cùng nhau — giữ một
 * màu sáng ở theme tối biến mặt sàn thành tấm trắng chói hơn cả lỗi ban đầu.
 */
/** Xoay mặt sàn nằm ngang — hằng module (★ Đợt 40: không literal mỗi render). */
const XOAY_SAN: [number, number, number] = [-Math.PI / 2, 0, 0];

function San({ rongM, sauM, toi }: { rongM: number; sauM: number; toi: boolean }) {
  const canh = Math.max(rongM, sauM, 10);
  return (
    <group>
      <mesh rotation={XOAY_SAN} position={[rongM / 2, -0.01, sauM / 2]}>
        <planeGeometry args={[rongM, sauM]} />
        <meshStandardMaterial color={toi ? "#1e293b" : "#e2e8f0"} />
      </mesh>
      <gridHelper
        args={[canh, Math.max(4, Math.round(canh / 5)), toi ? "#475569" : "#94a3b8", toi ? "#334155" : "#cbd5e1"]}
        position={[rongM / 2, 0, sauM / 2]}
      />
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Màu token → THREE.Color — RE-EXPORT, cài đặt ở `mauThree.ts`                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ ĐÃ RÚT RA `mauThree.ts` (Đợt 8 lô D) — ĐÂY CHỈ CÒN LÀ CỬA TƯƠNG THÍCH.
 *
 * Lô A viết bản vá oklch→RGB ngay trong tệp này vì phạm vi tệp của nó, và tự
 * khai đúng: cùng lỗi còn ở `DongChayLine.tsx`, ở đường vào `LoBatchMay`
 * (`TwinVanHanh.tsx`, **84 warning** đếm được) và ở `phaVeNen()`
 * (`phamViCanh.ts`, "mờ 12%" của §10C **chưa từng có hiệu lực**).
 *
 * Chép bản vá sang bốn chỗ = bốn bản cài đặt sẽ lệch nhau ở lần sửa đầu tiên
 * (G12). Nên nó nằm ở `./mauThree` và MỌI người tiêu thụ import từ đó.
 * Re-export ở đây giữ nguyên các call site cũ + test G20 của lô A
 * (`mauThree.dom.test.tsx` import từ chính tệp giao hàng này).
 */
export { mauHex, mauThree };

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Ống WIP theo trạm — §10C.3 mục 2                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Mỗi trạm một cột đứng, cao theo số WIP đang chờ. Trạm nghẽn → cột cao + màu
 * cảnh báo. Đây là cách đọc nút thắt bằng MẮT trong 2 giây.
 *
 * Vẽ bằng MỘT `InstancedMesh` (1 draw call cho cả 12 cột) — 12 mesh rời tốn 12
 * draw call chỉ để vẽ 12 hình trụ giống hệt nhau.
 */
function OngWip({ wip }: { wip: CanhVanHanhProps["wip"] }) {
  const ref = useRef<THREE.InstancedMesh | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  const { hinh, chatLieu } = useMemo(() => {
    // Trụ đơn vị cao 1, tâm ở giữa → dịch lên nửa chiều cao khi đặt.
    const g = new THREE.CylinderGeometry(0.18, 0.18, 1, 8);
    const m = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.75 });
    return { hinh: g, chatLieu: m };
  }, []);

  // ★ RB-7 — three KHÔNG tự thu hồi bộ nhớ GPU.
  useEffect(() => () => {
    hinh.dispose();
    chatLieu.dispose();
  }, [hinh, chatLieu]);

  useEffect(() => {
    const inst = ref.current;
    if (!inst) return;
    const mt = new THREE.Matrix4();
    const mauNghen = mauThree("--warning", "#f59e0b");
    const mauThuong = mauThree("--info", "#3b82f6");
    wip.forEach((w, i) => {
      const cao = Math.max(0.05, w.cao);
      mt.compose(
        new THREE.Vector3(w.x, cao / 2, w.z),
        new THREE.Quaternion(),
        new THREE.Vector3(1, cao, 1),
      );
      inst.setMatrixAt(i, mt);
      inst.setColorAt(i, w.nghen ? mauNghen : mauThuong);
    });
    inst.count = wip.length;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    invalidate();
  }, [wip, invalidate]);

  if (wip.length === 0) return null;
  return <instancedMesh ref={ref} args={[hinh, chatLieu, Math.max(1, wip.length)]} frustumCulled={false} />;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* A-4 — VÒNG VIỀN SỨC KHOẺ (§14.5.1, mục G-1 / F-15)                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Vòng viền quanh ĐẾ máy, tô theo hạng sức khoẻ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NGÂN SÁCH — MỘT `InstancedMesh` = **1 DRAW CALL** cho MỌI vòng
 * ════════════════════════════════════════════════════════════════════════════
 * §14.5.0: nhãn 3D tốn **1 draw call MỖI nhãn** và trần đọc-được là 30; màu trên
 * thân tốn **0** vì đã nằm trong `BatchedMesh`. Vòng viền là thứ ba: nó KHÔNG
 * miễn phí như màu thân, nhưng nó gộp được — 43 vòng (hay 240) vẫn là **1** call
 * vì cùng hình học cùng material, chỉ khác ma trận và màu instance.
 *
 * Đo được trước lô này: cảnh 240 máy = **3 draw calls**, trần §4 là 150.
 * Lớp này đưa 3 → **4**. Đó là cái giá đã biết và nói ra, khác hẳn với việc neo
 * 43 nhãn troika (3 → 46) cho cùng một thông tin.
 *
 * ★ Vì sao `RingGeometry` chứ không `TorusGeometry`: ring là hình PHẲNG nằm trên
 *   sàn (xoay -90° quanh X), nên nó không bao giờ che thân máy dù camera ở đâu.
 *   Torus nhô lên khỏi sàn và ở góc nhìn thấp sẽ cắt ngang chân máy.
 *
 * ★ RB-7 — geometry và material tự cấp phát ⇒ `dispose()` trong cleanup.
 * ★ `frameloop="demand"`: mọi thay đổi phải gọi `invalidate()`, nếu không lớp
 *   này cập nhật buffer rồi đứng im cho tới khi ai đó chạm chuột (đúng bẫy đã
 *   ghi ở `DieuKhien`).
 */
/**
 * Hằng rỗng ỔN ĐỊNH cho `vienSucKhoe` khi người gọi không truyền.
 *
 * ★ `?? []` viết thẳng trong thân component sinh một mảng MỚI mỗi lần render,
 *   làm `useEffect([vien])` của lớp chạy lại mỗi khung và gọi `invalidate()` —
 *   tức là biến `frameloop="demand"` thành vòng lặp vô hạn im lặng. Đây là bẫy
 *   đã trả giá ở lớp khác của kit, ghi ra để không ai "dọn" dòng này đi.
 */
const EMPTY_VIEN: readonly VienDeMay[] = [];

/** Hằng rỗng ổn định cho `vung` — cùng lý do như {@link EMPTY_VIEN}. */
const EMPTY_VUNG: readonly VungVe[] = [];

function LopVienSucKhoe({ vien }: { vien: readonly VienDeMay[] }) {
  const ref = useRef<THREE.InstancedMesh | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  const { hinh, chatLieu } = useMemo(() => {
    /*
     * Vành ĐƠN VỊ: bán kính ngoài 1, trong 0,82 ⇒ bề dày 18% bán kính. Scale
     * theo `banKinhM` lúc đặt, nên một hình học phục vụ mọi cỡ máy.
     *
     * ★ 48 phân đoạn: dưới ~32 vòng trông thành đa giác ở cận cảnh; trên 64 thì
     *   thêm đỉnh mà mắt không phân biệt được. Đây là hình học DÙNG CHUNG cho
     *   mọi instance nên chi phí trả MỘT lần, không nhân theo số máy.
     */
    const g = new THREE.RingGeometry(0.82, 1, 48);
    // Nằm ngang trên sàn. `RingGeometry` sinh ra ở mặt phẳng XY.
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      // ★ `depthWrite: false` — vòng nằm SÁT sàn; ghi depth sẽ gây z-fighting
      //   nhấp nháy với mặt sàn ở góc camera thấp.
      depthWrite: false,
    });
    return { hinh: g, chatLieu: m };
  }, []);

  // ★ RB-7 — three KHÔNG tự thu hồi bộ nhớ GPU.
  useEffect(
    () => () => {
      hinh.dispose();
      chatLieu.dispose();
    },
    [hinh, chatLieu],
  );

  useEffect(() => {
    const inst = ref.current;
    if (!inst) return;
    const mt = new THREE.Matrix4();
    const mau = new THREE.Color();
    vien.forEach((v, i) => {
      const r = Math.max(0.05, v.banKinhM);
      mt.compose(
        // ★ NHÍCH LÊN KHỎI SÀN. Đặt đúng y=0 cho z-fighting với mặt sàn ngay cả
        //   khi đã tắt `depthWrite` ở một số GPU. 12 mm — đủ để tách, đủ nhỏ để
        //   vẫn đọc là "vòng trên sàn" chứ không phải "vòng lơ lửng".
        new THREE.Vector3(v.x, 0.012, v.z),
        new THREE.Quaternion(),
        new THREE.Vector3(r, 1, r),
      );
      inst.setMatrixAt(i, mt);
      /*
       * ★★★ `motNhat` (lời khai HẾT HẠN) làm NHẠT MÀU, không đổi sang màu khác.
       *   Hạng `het_han` đã có màu xám riêng từ `mauVienSucKhoe`; việc nhạt thêm
       *   là lớp tín hiệu THỨ HAI cho cùng một sự thật, và nó cần thiết vì xám
       *   nhạt trên nền xám sáng (§14.7.1) là cặp dễ lẫn nhất trong bảng màu.
       */
      mau.set(v.mau);
      if (v.motNhat) mau.lerp(new THREE.Color("#ffffff"), 0.35);
      inst.setColorAt(i, mau);
    });
    inst.count = vien.length;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    invalidate();
  }, [vien, invalidate]);

  if (vien.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[hinh, chatLieu, Math.max(1, vien.length)]}
      frustumCulled={false}
      // ★ `renderOrder` — vẽ SAU sàn, TRƯỚC máy. Vòng trong suốt phải hoà với
      //   sàn phía dưới nó, nhưng không được đè lên thân máy phía trên.
      renderOrder={1}
      // Vòng là CHỈ BÁO, không phải đích bấm: chọn máy vẫn đi qua `LoBatchMay`.
      // Không đặt `raycast` rỗng ở đây thì một vòng lớn sẽ nuốt cú bấm vào máy
      // bên cạnh — và người dùng bấm máy A lại chọn trúng máy B.
      raycast={() => null}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Nội dung cảnh                                                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

function NoiDung(props: CanhVanHanhProps & { toi: boolean }) {
  const {
    may,
    nhan,
    canhBao,
    dongChay,
    wip,
    machineIdChon,
    onChonMay,
    khungNhin,
    sanRongM,
    sanSauM,
    tatNhan,
    toi,
  } = props;
  const chiNhanBatThuong = props.chiNhanBatThuong ?? false;
  const chuNhanAn = props.chuNhanAn;
  const vienSK = props.vienSucKhoe ?? EMPTY_VIEN;
  const vungAT = props.vung ?? EMPTY_VUNG;

  const controlsRef = useRef<OrbitControls | null>(null);
  const [chon, setChon] = useState<TrangThaiChon>(TRANG_THAI_CHON_RONG);

  // Đồng bộ selection TỪ NGOÀI vào (click ở danh sách DOM / deep-link) — điều
  // kiện của §9.9 "selection 3D ↔ focus DOM đồng bộ HAI CHIỀU".
  useEffect(() => {
    setChon((cu) => ({ ...cu, dangChon: machineIdChon }));
  }, [machineIdChon]);

  const banKinh = Math.max(sanRongM, sanSauM, 10);

  const khiChon = useCallback(
    (id: number | null) => {
      setChon((cu) => ({ ...cu, dangChon: id }));
      onChonMay(id);
    },
    [onChonMay],
  );

  const khiHover = useCallback((id: number | null) => {
    setChon((cu) => ({ ...cu, dangHover: id }));
  }, []);

  const onCameraDoiNgoai = props.onCameraDoi;
  const camDoi = useCallback(
    (viTri: THREE.Vector3, muc: THREE.Vector3) => {
      // ★ Đợt 33 — cửa sổ đo `__tuTheCamera` (xem `CuaSoDoTwin3d` ở KhungCanh.tsx):
      //   ghi cho MỌI màn, kể cả màn không truyền `onCameraDoi` (Line/Máy).
      (window as Window & CuaSoDoTwin3d).__tuTheCamera = {
        x: viTri.x,
        y: viTri.y,
        z: viTri.z,
        mucX: muc.x,
        mucZ: muc.z,
      };
      onCameraDoiNgoai?.(viTri, muc);
    },
    [onCameraDoiNgoai],
  );

  return (
    <>
      <DieuKhien
        khungNhin={khungNhin}
        banKinhToiDa={banKinh}
        controlsRef={controlsRef}
        onCameraDoi={camDoi}
      />
      <San rongM={sanRongM} sauM={sanSauM} toi={toi} />
      {/* ★ A-6 — VÙNG AN TOÀN, sát sàn nhất, dưới cả vòng sức khoẻ. Nó là NỀN
          bối cảnh ("chỗ này chia sẻ với người"), không phải chỉ báo về một máy.
          ★ KHÔNG truyền `onChon`: vận hành chỉ đọc, cú bấm thuộc về máy. */}
      <LopVung vung={vungAT} tatNhan={tatNhan} />
      {/* ★ A-4 TRƯỚC `LoBatchMay`: vòng nằm dưới chân máy, phải vẽ trước để thân
          máy đè lên phần vòng bị che — đúng thứ tự vật lý của cảnh. */}
      <LopVienSucKhoe vien={vienSK} />
      <LoBatchMay may={may} chon={chon} onChon={khiChon} onHover={khiHover} />
      {dongChay ? <DongChayLine dongChay={dongChay} /> : null}
      <OngWip wip={wip} />
      <LopNhan
        nhan={nhan}
        dangChon={chon.dangChon}
        dangHover={chon.dangHover}
        tat={tatNhan}
        chiNhanBatThuong={chiNhanBatThuong}
        chuNhanAn={chuNhanAn}
        chuNhanAnTheoChinhSach={props.chuNhanAnTheoChinhSach}
        chuSuCoNgoaiKhung={props.chuSuCoNgoaiKhung}
      />
      <LopCanhBao canhBao={canhBao} />
    </>
  );
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 40 (QA Đợt 39 Pareto #4) — "ĐỔI THAM CHIẾU ⇔ ĐỔI GIÁ TRỊ" CHO TOÀN BỘ CẢNH, MỘT CHỖ
 * ════════════════════════════════════════════════════════════════════════════
 * Đọc từ cơ chế (`.qa-dot39/nguon-khung/*.json`, `phan-tich-nguon-khung-*.txt`): 9–15 trong 13–19 commit R3F/40 s
 * của mỗi màn là `Canvas` re-render (`p4{onCreated}`) vì TRANG re-render (phản hồi poll `andon.active` 20 s,
 * `anToanRobot` 20 s, `overview+sucKhoeMay` 30 s, `machineDetail` 10 s, `aiInbox.count`…) — dữ liệu cảnh Y NGUYÊN.
 * Mỗi lần `<Canvas>` render, R3F `configure()` gọi `setSize` của store ⇒ `set` ⇒ `subscribe ⇒ invalidate`
 * (bundle `vendor-three-*.js:4019:79808`) ⇒ **một khung vẽ cho một re-render không mang byte nào**.
 *
 * `frameloop="demand"` chỉ có nghĩa khi "đổi tham chiếu" ⇔ "đổi giá trị" (`onDinhTheoGiaTri.ts`, Đợt 38 — áp
 * cho `mayVe`/`cotWip`/`khungNhin` ở TRANG). Nhưng làm ở trang là làm theo DANH SÁCH: `nhan`, `canhBao`,
 * `vienSucKhoe` (deps `bayGio`), `vung`, `dongChay` (literal `{ diem, nhipMs }` ở hai chỗ gọi), bốn callback
 * inline (`chuNhanAn`, `chuSuCoNgoaiKhung`, `onChonMay` ở màn Máy, `onCameraDoi`) đều lọt. Đây là BẤT BIẾN đặt
 * ở CỬA VÀO cảnh: mọi prop dữ liệu ghim theo GIÁ TRỊ (`JSON.stringify` — dữ liệu cảnh là số/chuỗi thuần, ≤ 43 máy,
 * rẻ hơn một khung vẽ), mọi prop hàm đi qua trampoline ổn định đọc `ref` mới nhất — rồi `React.memo` phần thân.
 * Thêm một prop dữ liệu mới vào `CanhVanHanhProps` mà quên ghim ⇒ `CanhVanHanhOnDinh` KHÔNG nhận được nó ⇒ tsc đỏ
 * (kiểu `Props` được liệt kê tường minh dưới đây), không phải lặng lẽ vẽ thừa.
 *
 * ⚠ Vì sao KHÔNG bỏ `bayGio` khỏi deps `vienSucKhoeCanh` ở trang (brief Đợt 40 đề nghị): `vienSucKhoe()` dùng
 *   `bayGio` để hạ hạng lời khai HẾT HẠN (`het_han`/`motNhat`); bỏ dep là đóng băng phép hết hạn — một hồi quy
 *   trung thực dữ liệu đội lốt tối ưu. Tính lại thì rẻ; chỉ cần KHÔNG lan tham chiếu mới khi giá trị y nguyên.
 */
type PropsDuLieu = Pick<
  CanhVanHanhProps,
  "may" | "nhan" | "canhBao" | "dongChay" | "wip" | "vienSucKhoe" | "vung" | "khungNhin"
>;
type PropsHam = Pick<
  CanhVanHanhProps,
  "onChonMay" | "onCameraDoi" | "chuNhanAn" | "chuNhanAnTheoChinhSach" | "chuSuCoNgoaiKhung"
>;

/** Khoá giá trị của một prop dữ liệu — `undefined` và `null` phân biệt (bỏ trống ≠ tắt). */
function khoaGiaTri(v: unknown): string {
  // Chuoi canh cho `undefined` khong the trung voi JSON.stringify (JSON string luon co dau ngoac kep).
  return v === undefined ? "@undefined" : JSON.stringify(v);
}

export function CanhVanHanh(props: CanhVanHanhProps) {
  // ── Prop dữ liệu: cùng khoá ⇒ cùng tham chiếu (bản THÔ tính ở trang mỗi render — rẻ). ──
  const may = useOnDinhTheoGiaTri(props.may, khoaGiaTri(props.may));
  const nhan = useOnDinhTheoGiaTri(props.nhan, khoaGiaTri(props.nhan));
  const canhBao = useOnDinhTheoGiaTri(props.canhBao, khoaGiaTri(props.canhBao));
  const dongChay = useOnDinhTheoGiaTri(props.dongChay, khoaGiaTri(props.dongChay));
  const wip = useOnDinhTheoGiaTri(props.wip, khoaGiaTri(props.wip));
  const vienSucKhoe = useOnDinhTheoGiaTri(props.vienSucKhoe, khoaGiaTri(props.vienSucKhoe));
  const vung = useOnDinhTheoGiaTri(props.vung, khoaGiaTri(props.vung));
  const khungNhin = useOnDinhTheoGiaTri(props.khungNhin, khoaGiaTri(props.khungNhin));

  // ── Prop hàm: trampoline ổn định đọc bản MỚI NHẤT — tầng ngoài luôn render nên `ref` luôn tươi. ──
  // ★ Đợt 45 (mục 4) — G5 đo được: thêm prop hàm ở `CanhVanHanhProps` mà KHÔNG thêm vào ba chỗ dưới ⇒ prop
  //   "có mặt" nhưng không bao giờ tới `LopNhan` (chip vẫn in câu cũ). Lưới `chinhSachNhan.unit.test.ts` ghim.
  const hamRef = useRef<PropsHam>({
    onChonMay: props.onChonMay,
    onCameraDoi: props.onCameraDoi,
    chuNhanAn: props.chuNhanAn,
    chuNhanAnTheoChinhSach: props.chuNhanAnTheoChinhSach,
    chuSuCoNgoaiKhung: props.chuSuCoNgoaiKhung,
  });
  hamRef.current = {
    onChonMay: props.onChonMay,
    onCameraDoi: props.onCameraDoi,
    chuNhanAn: props.chuNhanAn,
    chuNhanAnTheoChinhSach: props.chuNhanAnTheoChinhSach,
    chuSuCoNgoaiKhung: props.chuSuCoNgoaiKhung,
  };
  const onChonMay = useCallback((id: number | null) => hamRef.current.onChonMay(id), []);
  const onCameraDoi = useCallback(
    (viTri: THREE.Vector3, muc: THREE.Vector3) => hamRef.current.onCameraDoi?.(viTri, muc),
    [],
  );
  // `undefined` phải GIỮ là `undefined` (chip "còn N tên bị ẩn" chỉ hiện khi có chữ) — không bọc thành hàm rỗng.
  const coChuNhanAn = props.chuNhanAn !== undefined;
  const coChuNhanAnTheoChinhSach = props.chuNhanAnTheoChinhSach !== undefined;
  const coChuSuCo = props.chuSuCoNgoaiKhung !== undefined;
  const chuNhanAnOnDinh = useCallback((n: number) => hamRef.current.chuNhanAn?.(n) ?? "", []);
  const chuNhanAnTheoChinhSachOnDinh = useCallback(
    (n: number) => hamRef.current.chuNhanAnTheoChinhSach?.(n) ?? "",
    [],
  );
  const chuSuCoOnDinh = useCallback((n: number) => hamRef.current.chuSuCoNgoaiKhung?.(n) ?? "", []);

  return (
    <CanhVanHanhOnDinh
      may={may}
      nhan={nhan}
      canhBao={canhBao}
      dongChay={dongChay}
      wip={wip}
      vienSucKhoe={vienSucKhoe}
      vung={vung}
      khungNhin={khungNhin}
      machineIdChon={props.machineIdChon}
      onChonMay={onChonMay}
      onCameraDoi={onCameraDoi}
      chuNhanAn={coChuNhanAn ? chuNhanAnOnDinh : undefined}
      chuNhanAnTheoChinhSach={coChuNhanAnTheoChinhSach ? chuNhanAnTheoChinhSachOnDinh : undefined}
      chuSuCoNgoaiKhung={coChuSuCo ? chuSuCoOnDinh : undefined}
      sanRongM={props.sanRongM}
      sanSauM={props.sanSauM}
      tatNhan={props.tatNhan}
      chiNhanBatThuong={props.chiNhanBatThuong}
      chuMatContext={props.chuMatContext}
      ariaLabel={props.ariaLabel}
      sanCaoPx={props.sanCaoPx}
    />
  );
}

/** Thân cảnh — chỉ render lại khi một prop ĐỔI THAM CHIẾU, mà tầng ngoài đã bảo đảm "đổi tham chiếu ⇔ đổi giá trị". */
const CanhVanHanhOnDinh = memo(function CanhVanHanhOnDinh(props: CanhVanHanhProps) {
  const theme = useOptionalTheme();
  const toi = theme === "dark";
  const banKinh = Math.max(props.sanRongM, props.sanSauM, 10);

  /**
   * ★ §10.4 — nền cảnh lấy từ token `--background`, KHÔNG hardcode. 3D phải đúng
   *   ở CẢ HAI theme; một nền cứng sẽ đúng ở một theme và sai ở theme kia.
   */
  //
  // ★★★ Qua `mauHex` chứ KHÔNG `giaiMauCanh` trần: token này là `oklch()`, và
  //   `KhungCanh` đưa thẳng chuỗi vào `<color/>`. Trước bản vá, nền cảnh ra
  //   **TRẮNG** ở theme tối — thấy được bằng mắt ở nghiệm thu Đợt 8.
  const mauNen = mauHex("--background", toi ? "#0f172a" : "#f8fafc");
  // ★ Đợt 40 — hai mảng theo `banKinh`: memo để `KhungCanh` không nhận mảng mới mỗi render.
  const viTriCamera = useMemo<[number, number, number]>(
    () => [banKinh * 1.4, banKinh * 0.9, banKinh * 1.4],
    [banKinh],
  );
  const viTriDenHuong = useMemo<[number, number, number]>(
    () => [banKinh, banKinh * 1.4, banKinh * 0.6],
    [banKinh],
  );

  return (
    <KhungCanh
      viTriCamera={viTriCamera}
      mauNen={mauNen}
      far={Math.max(2000, banKinh * 24)}
      cuongDoBanCau={toi ? 0.9 : 1.1}
      cuongDoHuong={toi ? 1.0 : 1.3}
      viTriDenHuong={viTriDenHuong}
      chuMatContext={props.chuMatContext}
      sanCaoPx={props.sanCaoPx}
      data-testid="khoi-canh-3d"
    >
      <NoiDung {...props} toi={toi} />
    </KhungCanh>
  );
});

export default CanhVanHanh;

/** Re-export để trang không phải nhớ hai đường nhập. */
export { mauChoTrangThai };
