/**
 * CanhThietKe.tsx — cảnh 3D của màn Thiết kế: canvas + lô máy + gizmo + ghost.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ RB-4 — CHỈ MỘT `<Canvas>` SỐNG
 * ════════════════════════════════════════════════════════════════════════════
 * Tệp này là nơi DUY NHẤT của màn Thiết kế dựng `<KhungCanh>` (và `KhungCanh` là
 * cửa duy nhất vào WebGL của kit). `DungNhaXuong`/`NhapBanVe` của Đợt 3 xem
 * trước bằng SVG chính vì bất biến này. `window.__soCanvas` phải luôn = 1 và
 * `KhungCanh` tự `console.error` khi > 1.
 *
 * ★ RB-3 — `taoDieuKhienQuay` nhận `invalidate` là tham số BẮT BUỘC nên quên nối
 *   là lỗi biên dịch, không phải màn hình đơ lúc chạy.
 * ★ RB-5 — không `<Environment>`, không CDN. Đèn do `KhungCanh` lo.
 * ★ RB-7 — geometry/material của lớp ghost `dispose()` trong cleanup.
 *
 * ★★★ VẬT THỂ MANG GIZMO LÀ MỘT `Object3D` PROXY, KHÔNG PHẢI MÁY TRONG BATCH.
 *   `LoBatchMay` vẽ mọi máy bằng MỘT `BatchedMesh` (1 draw call) — từng máy
 *   KHÔNG có `Object3D` riêng để `TransformControls.attach()` bám vào. Nên ta
 *   dựng một object rỗng, đặt nó đúng vị trí máy đang chọn, cho gizmo bám vào
 *   đó, rồi đọc kết quả ra. Đây KHÔNG phải giải pháp tạm: nó giữ nguyên ngân
 *   sách draw call của §4, và là cách duy nhất để có cả hai thứ.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { KhungCanh, LoBatchMay, taoDieuKhienQuay, type MayTrongLo } from "../loi";
import { mmSangMet } from "../heToaDo";
import { TRANG_THAI_CHON_RONG, type TrangThaiChon } from "../loi/chonVatThe";
import { GizmoBienDoi } from "./GizmoBienDoi";
import type { CheDoGizmo, TrucKhoa } from "./gizmoNoiLogic";
import type { HopMa } from "./xemTruocSinh";

export interface CanhThietKeProps {
  may: MayTrongLo[];
  /** machineId đang chọn (một) — gizmo bám vào máy này. */
  mayDangChon: number | null;
  mayDaKhoa: boolean;
  cheDo: CheDoGizmo;
  snapBat: boolean;
  buocLuoiMm: number;
  buocGocDo: number;
  trucKhoa: TrucKhoa;
  /** Lớp xem trước Sinh tự động; rỗng = không xem trước. */
  ma: readonly HopMa[];
  /** Kích thước sàn (mét) để đặt lưới và camera. */
  sanRongM: number;
  sanSauM: number;
  hienLuoi: boolean;
  onChonMay: (machineId: number | null) => void;
  /** Kéo gizmo xong: vị trí SCENE (mét) + góc ĐỘ. Người gọi quy sang mm. */
  onBienDoiXong: (kq: {
    viTri: { x: number; y: number; z: number };
    gocYDo: number;
  }) => void;
  chuMatContext: string;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* OrbitControls — RB-3                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

function DieuKhien({
  banKinh,
  controlsRef,
}: {
  banKinh: number;
  controlsRef: React.MutableRefObject<OrbitControls | null>;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    // ★ RB-3: `invalidate` là tham số required của `taoDieuKhienQuay`.
    const { controls, huy } = taoDieuKhienQuay(camera, gl.domElement, invalidate, {
      khoangCachToiThieu: 2,
      khoangCachToiDa: Math.max(80, banKinh * 6),
    });
    controlsRef.current = controls;
    return () => {
      controlsRef.current = null;
      huy();
    };
  }, [camera, gl, invalidate, banKinh, controlsRef]);

  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Sàn + lưới                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

function San({ rongM, sauM, hienLuoi }: { rongM: number; sauM: number; hienLuoi: boolean }) {
  const canh = Math.max(rongM, sauM, 10);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[rongM / 2, -0.01, sauM / 2]}>
        <planeGeometry args={[rongM, sauM]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      {hienLuoi ? (
        <gridHelper
          args={[canh, Math.max(4, Math.round(canh)), "#94a3b8", "#cbd5e1"]}
          position={[rongM / 2, 0, sauM / 2]}
        />
      ) : null}
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Lớp GHOST xem trước Sinh tự động                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Ghost vẽ bằng MỘT `InstancedMesh` — mọi hộp ma dùng chung một `BoxGeometry`
 * đơn vị và co giãn bằng ma trận. Vẽ 41 mesh rời sẽ tốn 41 draw call và đẩy
 * ngân sách §4 (≤ 150) đi một phần ba chỉ để xem trước.
 */
function LopMa({ ma }: { ma: readonly HopMa[] }) {
  const ref = useRef<THREE.InstancedMesh | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  const { hinh, chatLieu } = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.MeshBasicMaterial({
      color: "#0ea5e9",
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    return { hinh: g, chatLieu: m };
  }, []);

  // ★ RB-7 — three KHÔNG tự thu hồi bộ nhớ GPU.
  useEffect(() => {
    return () => {
      hinh.dispose();
      chatLieu.dispose();
    };
  }, [hinh, chatLieu]);

  useEffect(() => {
    const inst = ref.current;
    if (!inst) return;
    const mt = new THREE.Matrix4();
    const mauDoi = new THREE.Color("#f59e0b");
    const mauYen = new THREE.Color("#0ea5e9");
    ma.forEach((h, i) => {
      mt.compose(
        new THREE.Vector3(
          mmSangMet(h.viTriXMm),
          mmSangMet(h.viTriZMm) + mmSangMet(h.caoMm) / 2,
          mmSangMet(h.viTriYMm),
        ),
        new THREE.Quaternion(),
        new THREE.Vector3(mmSangMet(h.rongMm), mmSangMet(h.caoMm), mmSangMet(h.sauMm)),
      );
      inst.setMatrixAt(i, mt);
      // Máy SẼ DỜI tô cam, máy đứng yên tô xanh — xem trước phải trả lời được
      // câu hỏi duy nhất người dùng có (§ xemTruocSinh.dungLopMa).
      inst.setColorAt(i, h.seDoi ? mauDoi : mauYen);
    });
    inst.count = ma.length;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    invalidate();
  }, [ma, invalidate]);

  if (ma.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[hinh, chatLieu, Math.max(1, ma.length)]}
      frustumCulled={false}
      renderOrder={2}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Proxy mang gizmo                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

function NoiDung(props: CanhThietKeProps) {
  const {
    may,
    mayDangChon,
    mayDaKhoa,
    cheDo,
    snapBat,
    buocLuoiMm,
    buocGocDo,
    trucKhoa,
    ma,
    sanRongM,
    sanSauM,
    hienLuoi,
    onChonMay,
    onBienDoiXong,
  } = props;

  const orbitRef = useRef<OrbitControls | null>(null);
  const [proxy, setProxy] = useState<THREE.Object3D | null>(null);
  const proxyRef = useRef<THREE.Object3D | null>(null);

  const chon: TrangThaiChon = useMemo(
    () => ({ ...TRANG_THAI_CHON_RONG, dangChon: mayDangChon }),
    [mayDangChon],
  );

  // Dựng proxy MỘT LẦN. Nó là `Object3D` rỗng (0 tam giác, 0 draw call) — chỉ
  // tồn tại để `TransformControls.attach()` có chỗ bám.
  useEffect(() => {
    const o = new THREE.Object3D();
    o.name = "twin-gizmo-proxy";
    proxyRef.current = o;
    setProxy(o);
    return () => {
      proxyRef.current = null;
      setProxy(null);
    };
  }, []);

  // Đồng bộ proxy tới vị trí máy đang chọn.
  const mayChon = useMemo(
    () => may.find((m) => m.machineId === mayDangChon) ?? null,
    [may, mayDangChon],
  );
  useEffect(() => {
    const o = proxyRef.current;
    if (!o || !mayChon) return;
    o.position.set(
      mayChon.viTri.x,
      mayChon.viTri.y + mmSangMet(mayChon.kichThuocMm.caoMm) / 2,
      mayChon.viTri.z,
    );
    o.rotation.set(0, mayChon.gocXoayRad, 0);
    o.updateMatrixWorld();
  }, [mayChon]);

  const banKinh = Math.max(sanRongM, sanSauM) / 2;

  return (
    <>
      <DieuKhien banKinh={banKinh} controlsRef={orbitRef} />
      <San rongM={sanRongM} sauM={sanSauM} hienLuoi={hienLuoi} />
      <LoBatchMay
        may={may}
        chon={chon}
        onChon={onChonMay}
        onHover={() => {
          /* hover không đổi state ở màn Thiết kế — tránh render lại 41 máy mỗi lần rê chuột */
        }}
      />
      <LopMa ma={ma} />
      {/* ★★★ Gizmo — RB-1/RB-2 ở trong `GizmoBienDoi`. */}
      <GizmoBienDoi
        vatThe={mayDangChon !== null && !mayDaKhoa ? proxy : null}
        cheDo={cheDo}
        snapBat={snapBat}
        buocLuoiMm={buocLuoiMm}
        buocGocDo={buocGocDo}
        trucKhoa={trucKhoa}
        orbitRef={orbitRef}
        onXong={(kq) => {
          if (!mayChon) return;
          // Trả về TÂM đáy máy: proxy đứng ở giữa chiều cao, mô hình dữ liệu ghi
          // vị trí đáy. Quên phép trừ này làm máy nhích lên nửa chiều cao MỖI
          // LẦN kéo — trôi tích luỹ, và không lỗi nào nổ.
          onBienDoiXong({
            viTri: {
              x: kq.viTri.x,
              y: kq.viTri.y - mmSangMet(mayChon.kichThuocMm.caoMm) / 2,
              z: kq.viTri.z,
            },
            gocYDo: kq.gocYDo,
          });
        }}
      />
    </>
  );
}

export function CanhThietKe(props: CanhThietKeProps) {
  const { sanRongM, sanSauM, chuMatContext } = props;
  // Camera nhìn bao trọn mặt sàn ngay lần mở đầu — người dùng không phải zoom
  // ra để tìm nhà xưởng của mình.
  const viTriCamera = useMemo<[number, number, number]>(() => {
    const r = Math.max(sanRongM, sanSauM, 10);
    return [sanRongM / 2 + r * 0.55, r * 0.62, sanSauM / 2 + r * 0.85];
  }, [sanRongM, sanSauM]);

  return (
    <KhungCanh
      viTriCamera={viTriCamera}
      far={Math.max(2000, Math.max(sanRongM, sanSauM) * 8)}
      chuMatContext={chuMatContext}
      data-testid="khoi-canh-3d"
    >
      <NoiDung {...props} />
    </KhungCanh>
  );
}

export default CanhThietKe;
