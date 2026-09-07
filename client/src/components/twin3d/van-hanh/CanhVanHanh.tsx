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
    if (!tw || !controls) return;
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
/* Màu token → THREE.Color                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ `giaiMauCanh()` TRẢ `oklch(...)`, VÀ `THREE.Color` KHÔNG ĐỌC ĐƯỢC OKLCH.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ MỘT LỚP PHỦ VẼ ĐỦ HÌNH MÀ CHỞ **0 BIT** THÔNG TIN — ĐO ĐƯỢC ĐỢT 8
 * ════════════════════════════════════════════════════════════════════════════
 * Nghiệm thu thị giác Đợt 8 (`/twin?pv=line:1`, dữ liệu SIM-FAC thật): mọi cột
 * WIP hiện ra **trắng như nhau** — cột nghẽn và cột thường không phân biệt nổi.
 * Hình học đúng, chiều cao đúng, và kênh MÀU chở đúng 0 bit. Đây là G5 mặc áo
 * mới: dữ liệu KHÁC RỖNG, cổng vẫn xanh, mà thông tin giao được vẫn bằng không.
 *
 * Đo ba bước, mỗi bước một mẫu RỜI (G9):
 *   1. trên trang thật: `getComputedStyle(root).getPropertyValue("--warning")`
 *      = `"oklch(78% .15 75)"` — **chuỗi oklch**, KHÔNG phải `rgb()`;
 *   2. trong node + three r182: `new THREE.Color("oklch(0.78 0.15 75)")` in
 *      `THREE.Color: Unknown color model` (một **warning**, không phải lỗi) rồi
 *      trả về **`#ffffff`** — im lặng, không throw, không ai biết;
 *   3. đối chứng: `new THREE.Color("#f59e0b")` ra đúng `f59e0b`.
 *
 * ⚠ Docblock của `mauTrangThai.ts:44` khẳng định *"trình duyệt tính oklch → rgb
 *   nên không cần thư viện màu"*. Khẳng định đó SAI với biến CSS: **custom
 *   property không được CSS phân giải** — nó thay thế nguyên văn, và
 *   `getPropertyValue` trả lại đúng chuỗi tác giả đã viết. (Đã thử cả cách gán
 *   vào `color` của một phần tử dò: Chrome nay giữ nguyên `oklch()` ở computed
 *   value luôn, nên đường đó cũng không cứu được.)
 *
 * Cách quy ĐÚNG là canvas 2D: `ctx.fillStyle = <bất kỳ cú pháp màu CSS nào>`
 * rồi ĐỌC LẠI PIXEL. Trình duyệt buộc phải rasterise, nên nó trả về RGB thật.
 * Đo trên trang: `--warning` → `rgb(239,168,49)`, `--info` → `rgb(90,163,236)`.
 *
 * ★ Vì sao có canh gác `#010203` thay vì chỉ đọc pixel: một chuỗi RÁC cũng cho
 *   pixel `(0,0,0)`, không phân biệt được với "màu đen hợp lệ". Nhưng canvas 2D
 *   BỎ QUA giá trị không hợp lệ và GIỮ NGUYÊN `fillStyle` cũ — nên đặt một giá
 *   trị canh gác rồi kiểm xem nó có đổi không là phép thử đáng tin, còn đọc
 *   pixel thì không.
 *
 * ⚠ PHẠM VI TỰ KHAI: bản vá này chỉ chữa HAI chỗ `new THREE.Color(...)` trong
 *   tệp này. Cùng lỗi còn ở `DongChayLine.tsx:84/97`, và `phaVeNen()`
 *   (`phamViCanh.ts:124`) thì im lặng KHÔNG LÀM GÌ với oklch (`tachRgb` trả
 *   `null` ⇒ `return mau`), nghĩa là "mờ 12% cho Line ngoài phạm vi" của §10C
 *   cũng chưa từng có hiệu lực. Hai món đó nằm NGOÀI phạm vi tệp của lô này —
 *   đã báo cáo, chưa sửa.
 */
export function mauThree(token: string, duPhong: string): THREE.Color {
  const gt = giaiMauCanh(token);
  if (!gt) return new THREE.Color(duPhong);
  // Hex/rgb/hsl/tên: three đọc thẳng được, không cần vòng qua canvas.
  if (!/^\s*(oklch|oklab|lch|lab|color)\s*\(/i.test(gt)) {
    return new THREE.Color(gt);
  }
  const b = byteMau(gt);
  if (!b) return new THREE.Color(duPhong);
  /*
   * ★★★ `setRGB(..., SRGBColorSpace)` CHỨ KHÔNG `new THREE.Color(r/255, …)`.
   *
   * Bộ dựng ba-số coi đầu vào là **ĐÃ TUYẾN TÍNH** và không quy đổi gì. Nạp
   * thẳng byte sRGB vào đó cho ra một màu SAI SẮC — và sai theo hướng SÁNG LÊN,
   * tức là đúng hướng che mất khuyết tật. Đo được: nền `rgb(7,10,16)` đi vòng
   * qua `getHexString()` ra `#2e3847`, sáng gấp mấy lần.
   *
   * ★ Chính test của tệp này bắt được, ở lượt chạy ĐẦU TIÊN của `mauHex` — một
   *   ví dụ sống cho việc test phải so ở ĐÚNG đơn vị (ở đây: đúng không gian
   *   màu), nếu không nó xanh trên một con số không có nghĩa.
   */
  return new THREE.Color().setRGB(b[0] / 255, b[1] / 255, b[2] / 255, THREE.SRGBColorSpace);
}

/**
 * Đọc MỘT chuỗi màu CSS bất kỳ ra ba byte **sRGB**, bằng canvas 2D.
 *
 * `null` khi không quy được (chuỗi rác, canvas bị chặn, không có DOM) — người
 * gọi tự chọn màu dự phòng; module này KHÔNG bịa một màu câm.
 */
function byteMau(gt: string): [number, number, number] | null {
  if (typeof document === "undefined") return null;
  try {
    const cv = document.createElement("canvas");
    cv.width = 1;
    cv.height = 1;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    const CANH_GAC = "#010203";
    ctx.fillStyle = CANH_GAC;
    ctx.fillStyle = gt;
    if (ctx.fillStyle === CANH_GAC) return null;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  } catch {
    // Canvas bị chặn (fingerprinting guard) — người gọi dùng màu dự phòng ĐÚNG
    // SẮC, còn hơn để `THREE.Color` âm thầm trả về trắng.
    return null;
  }
}

/**
 * ★★★ Cùng phép quy, nhưng trả **chuỗi hex** cho những chỗ nhận `string`.
 *
 * `KhungCanh` nhận `mauNen` là `string` rồi mới dựng `<color args={[mauNen]}/>`
 * bên trong (`KhungCanh.tsx:262`) — tức là `new THREE.Color(...)` xảy ra ở BÊN
 * KIA hàng rào tệp. Truyền một chuỗi `oklch()` qua đó thì nền cảnh 3D thành
 * **TRẮNG** ở theme tối: đo được ở nghiệm thu Đợt 8 (canvas trắng toát trên nền
 * ứng dụng tối) và console in `Unknown color model oklch(14.5% .015 260)`.
 *
 * Quy ở ĐÂY, tại nguồn, thay vì sửa `KhungCanh` — tệp đó ngoài phạm vi lô này,
 * và hex thì MỌI người tiêu thụ đều đọc được, nên đây cũng là chỗ đúng về thiết
 * kế chứ không chỉ là chỗ tiện.
 */
export function mauHex(token: string, duPhong: string): string {
  const gt = giaiMauCanh(token);
  if (!gt) return duPhong;
  if (!/^\s*(oklch|oklab|lch|lab|color)\s*\(/i.test(gt)) return gt;
  // ★ Đi THẲNG từ byte sRGB ra hex. KHÔNG vòng qua `mauThree().getHexString()`:
  //   đường đó nạp byte vào không gian tuyến tính rồi quy ngược ra sRGB, làm màu
  //   sáng vọt lên (`rgb(7,10,16)` → `#2e3847`). Xem chú thích ở `mauThree`.
  const b = byteMau(gt);
  if (!b) return duPhong;
  return `#${b.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}


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
