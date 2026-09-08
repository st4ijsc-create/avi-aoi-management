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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { useOptionalTheme } from "@/components/factory-scene/useOptionalTheme";

import {
  KhungCanh,
  LoBatchMay,
  LopNhan,
  TRANG_THAI_CHON_RONG,
  taoDieuKhienQuay,
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

export interface CanhVanHanhProps {
  may: MayTrongLo[];
  nhan: NhanTheGioi[];
  canhBao: CanhBaoTheGioi[];
  /** Đường tâm Line + hướng — chỉ có ở phạm vi Line (§10C.3). */
  dongChay: DiemDongChay | null;
  /** Cột WIP theo trạm — chỉ có ở phạm vi Line (§10C.3). */
  wip: readonly { x: number; z: number; cao: number; nghen: boolean }[];
  machineIdChon: number | null;
  onChonMay: (machineId: number | null) => void;
  /** Khung nhìn đích; đổi giá trị ⇒ camera TWEEN tới (500 ms, §10C.2). */
  khungNhin: KhungNhin | null;
  sanRongM: number;
  sanSauM: number;
  tatNhan: boolean;
  chuMatContext: string;
  ariaLabel: string;
  /** Báo camera vừa đổi — tầng trên ghi vào URL bằng `replaceState` (§9.4). */
  onCameraDoi?: (viTri: THREE.Vector3, muc: THREE.Vector3) => void;
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
function San({ rongM, sauM, toi }: { rongM: number; sauM: number; toi: boolean }) {
  const canh = Math.max(rongM, sauM, 10);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[rongM / 2, -0.01, sauM / 2]}>
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
    (viTri: THREE.Vector3, muc: THREE.Vector3) => onCameraDoiNgoai?.(viTri, muc),
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
      <LoBatchMay may={may} chon={chon} onChon={khiChon} onHover={khiHover} />
      {dongChay ? <DongChayLine dongChay={dongChay} /> : null}
      <OngWip wip={wip} />
      <LopNhan nhan={nhan} dangChon={chon.dangChon} dangHover={chon.dangHover} tat={tatNhan} />
      <LopCanhBao canhBao={canhBao} />
    </>
  );
}

export function CanhVanHanh(props: CanhVanHanhProps) {
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

  return (
    <KhungCanh
      viTriCamera={[banKinh * 1.4, banKinh * 0.9, banKinh * 1.4]}
      mauNen={mauNen}
      far={Math.max(2000, banKinh * 24)}
      cuongDoBanCau={toi ? 0.9 : 1.1}
      cuongDoHuong={toi ? 1.0 : 1.3}
      viTriDenHuong={[banKinh, banKinh * 1.4, banKinh * 0.6]}
      chuMatContext={props.chuMatContext}
      data-testid="khoi-canh-3d"
    >
      <NoiDung {...props} toi={toi} />
    </KhungCanh>
  );
}

export default CanhVanHanh;

/** Re-export để trang không phải nhớ hai đường nhập. */
export { mauChoTrangThai };
