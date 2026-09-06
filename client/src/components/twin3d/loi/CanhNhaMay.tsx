/**
 * CanhNhaMay.tsx — cảnh nhà máy dựng trên KIT `twin3d/loi/`, thay thế
 * `factory-scene/FactoryScene3D.tsx` cho màn `/factory-command`.
 *
 * ★★★ ĐÂY LÀ CỔNG RA CỦA ĐỢT 1. Nó nhận **đúng** `FactorySceneProps` mà
 * `FactoryScene2D`/`FactoryScene3D` nhận, và phải cho ra màn hình **hoạt động y
 * hệt**. Nếu kit sai thì màn đang chạy đổi hành vi — đó là phép đo thật, khác hẳn
 * một màn demo mới tự chấm điểm cho chính nó.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠ VÌ SAO MÀU VẪN ĐI QUA `overlayColorHex` CHỨ KHÔNG QUA `mauTrangThai.ts`
 * ────────────────────────────────────────────────────────────────────────────
 * `mauTrangThai.ts` (Đợt 0) là nguồn sự thật màu cho các trạng thái
 * `operationStatusEnum` (running/stopped/error/…) theo ISA-101. Màn
 * `/factory-command` chạy trên MỘT TẬP TRẠNG THÁI KHÁC — `running | idle | down |
 * offline | maintenance` từ hợp đồng `factoryCommand.overview` — và có **bốn lớp
 * phủ** (status / oee / ng / energy) mà `mauTrangThai.ts` không mô hình hoá.
 * `idle`, `down`, `offline` KHÔNG có ô nào trong `BANG_MAU`, nên nối thẳng vào đó
 * sẽ đẩy cả ba xuống `khong_ro` (xám gạch chéo) — tức là **đổi hành vi màn hình**,
 * đúng thứ cổng ra Đợt 1 cấm.
 *
 * Nên Đợt 1 giữ nguyên `overlayColorHex` cho màn này. Hợp nhất hai hệ trạng thái
 * là việc của màn `/twin` mới (Đợt 5), nơi dữ liệu đến từ `trangThaiHangLoat` với
 * đúng enum của DB. Ghi lại ở đây để đợt sau không tưởng là bỏ sót.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Grid } from "@react-three/drei";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  type FactorySceneProps,
  type PlacedMachine,
  overlayColorHex,
  resolveLayout,
  scenePalette,
} from "../../factory-scene/sceneTypes";
import { useOptionalTheme } from "../../factory-scene/useOptionalTheme";
import { hinhKhoiCho } from "../hinhKhoiMay";
import { KhungCanh } from "./KhungCanh";
import { LoBatchMay, type MayTrongLo } from "./LoBatchMay";
import { LopNhan, type NhanTheGioi } from "./LopNhan";
import { noiInvalidate } from "./dieuKhienQuay";
import { taoVienHopBao, giaiPhongVien } from "./vienNoiBat";
import { TheoDoiMatDoKhungHinh, docBacDaLuu } from "./matDoKhungHinh";
import { apClick, apHover, TRANG_THAI_CHON_RONG, type TrangThaiChon } from "./chonVatThe";

/* ═════════════════════════════════════════════════════════════════════════ */
/* OrbitControls thuần + RB-3 (nối `invalidate`)                             */
/* ═════════════════════════════════════════════════════════════════════════ */

function DieuKhien({
  banKinh,
  controlsRef,
  onDoiKhoangCach,
}: {
  banKinh: number;
  controlsRef: React.MutableRefObject<OrbitControls | null>;
  onDoiKhoangCach: (d: number) => void;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.maxPolarAngle = Math.PI / 2.15;
    c.minDistance = 4;
    c.maxDistance = banKinh * 5;
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.update();

    // ★★★ RB-3 — thiếu dòng này thì màn hình ĐỨNG HÌNH khi xoay camera.
    const goInvalidate = noiInvalidate(c, invalidate);

    // Báo khoảng cách để tầng trên quyết định hiện nhãn (LOD nhãn của màn cũ).
    let mocCuoi = 0;
    const khiDoi = () => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - mocCuoi < 120) return; // throttle y hệt màn cũ
      mocCuoi = now;
      onDoiKhoangCach(c.object.position.distanceTo(c.target));
    };
    c.addEventListener("change", khiDoi);

    controlsRef.current = c;
    invalidate();
    return () => {
      c.removeEventListener("change", khiDoi);
      goInvalidate();
      c.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl, invalidate, banKinh, controlsRef, onDoiKhoangCach]);

  // Quán tính (`enableDamping`) đòi `update()` mỗi khung KHI CÒN TRÔI. Với
  // `frameloop="demand"`, khung chỉ chạy khi có invalidate — và chính `change`
  // của controls phát ra invalidate, nên vòng lặp tự tắt khi camera dừng hẳn.
  useFrame(() => {
    controlsRef.current?.update();
  });

  return null;
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* Camera bay tới máy được focus (giữ nguyên hành vi màn cũ)                 */
/* ═════════════════════════════════════════════════════════════════════════ */

function BayToi({
  byId,
  focusId,
  controlsRef,
}: {
  byId: Map<number, PlacedMachine>;
  focusId: number | null;
  controlsRef: React.MutableRefObject<OrbitControls | null>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const dangBay = useRef(false);
  const dich = useRef(new THREE.Vector3());
  const dichMuc = useRef(new THREE.Vector3());

  useEffect(() => {
    if (focusId == null) return;
    const p = byId.get(focusId);
    if (!p) return;
    dichMuc.current.set(p.x, p.y + p.h * 0.5, p.z);
    const d = Math.max(5, (p.w + p.h + p.d) * 1.6);
    dich.current.set(p.x + d, p.y + p.h + d * 0.7, p.z + d);
    dangBay.current = true;
    invalidate();
  }, [focusId, byId, invalidate]);

  useFrame(({ camera }) => {
    if (!dangBay.current) return;
    const c = controlsRef.current;
    camera.position.lerp(dich.current, 0.12);
    if (c) {
      c.target.lerp(dichMuc.current, 0.12);
      c.update();
    }
    if (camera.position.distanceTo(dich.current) < 0.12) {
      dangBay.current = false;
      camera.position.copy(dich.current);
      if (c) {
        c.target.copy(dichMuc.current);
        c.update();
      }
    } else {
      invalidate();
    }
  });

  return null;
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* Viền nổi bật máy đang chọn — EdgesGeometry, KHÔNG post-processing (§4.5)  */
/* ═════════════════════════════════════════════════════════════════════════ */

function VienChon({ may }: { may: PlacedMachine | null }) {
  const invalidate = useThree((s) => s.invalidate);
  const [vien, setVien] = useState<THREE.LineSegments | null>(null);

  useEffect(() => {
    if (!may) {
      setVien(null);
      return;
    }
    const v = taoVienHopBao(
      { rong: may.w * 1.06, cao: may.h * 1.06, sau: may.d * 1.06 },
      { mau: "#ffffff", veDe: false },
    );
    v.position.set(may.x, may.y + may.h / 2, may.z);
    v.rotation.set(0, may.node.rotation || 0, 0);
    setVien(v);
    invalidate();
    // ★ RB-7 — EdgesGeometry cấp phát buffer GPU MỚI mỗi lần đổi máy đang chọn,
    // tức là hàng trăm lần mỗi ca. Không dispose là rò rỉ tích luỹ theo giờ.
    return () => giaiPhongVien(v);
  }, [may, invalidate]);

  return vien ? <primitive object={vien} /> : null;
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* Theo dõi fps → tự hạ chất lượng                                           */
/* ═════════════════════════════════════════════════════════════════════════ */

function TheoDoiFps({ onDoiBac }: { onDoiBac: (chiHopBao: boolean, coNhan: boolean) => void }) {
  const doRef = useRef<TheoDoiMatDoKhungHinh | null>(null);
  if (doRef.current === null) {
    doRef.current = new TheoDoiMatDoKhungHinh({ bacBanDau: docBacDaLuu() ?? "day_du" });
  }
  useFrame(() => {
    const kq = doRef.current!.ghiKhungHinh(
      typeof performance !== "undefined" ? performance.now() : Date.now(),
    );
    if (kq.daDoi) {
      const d = doRef.current!.dacTinh;
      onDoiBac(d.chiHopBao, d.nhan);
    }
  });
  return null;
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* Nội dung cảnh                                                             */
/* ═════════════════════════════════════════════════════════════════════════ */

function NoiDungCanh({
  machines,
  selectedId,
  onSelect,
  overlay,
  focusId,
  theme,
  nhanTrangThai,
}: Required<Omit<FactorySceneProps, "className">> & {
  nhanTrangThai: (m: PlacedMachine) => string;
}) {
  const palette = scenePalette(theme);
  const invalidate = useThree((s) => s.invalidate);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [chon, setChon] = useState<TrangThaiChon>(TRANG_THAI_CHON_RONG);
  const [zoomGan, setZoomGan] = useState(false);
  const [chiHopBao, setChiHopBao] = useState(false);
  const [coNhan, setCoNhan] = useState(true);

  const layout = useMemo(() => resolveLayout(machines), [machines]);

  // Đồng bộ DOM → 3D: `selectedId` do trang sở hữu; trạng thái chọn nội bộ chỉ
  // theo đuôi. Đây là chiều thứ hai của "đồng bộ hai chiều" (chonVatThe.ts).
  useEffect(() => {
    setChon((tt) => (tt.dangChon === selectedId ? tt : { ...tt, dangChon: selectedId }));
  }, [selectedId]);

  useEffect(() => {
    invalidate();
  }, [theme, overlay, selectedId, chiHopBao, coNhan, invalidate]);

  /**
   * ── HÌNH HỌC TĨNH ── phụ thuộc bố cục, KHÔNG phụ thuộc màu (§6.2).
   * `hinhKhoiCho()` của Đợt 2 ánh xạ mọi `machineType` sang một trong 7 khối và
   * không bao giờ trả `undefined`.
   */
  const hinhHocMay = useMemo(
    () =>
      layout.placed.map((p) => ({
        machineId: p.node.id,
        khoi: hinhKhoiCho(p.node.machineType),
        // `resolveLayout` đã trả kích thước MÉT; `hinhHocKhoi` nhận mm.
        kichThuocMm: { rongMm: p.w * 1000, caoMm: p.h * 1000, sauMm: p.d * 1000 },
        viTri: { x: p.x, y: p.y, z: p.z },
        gocXoayRad: p.node.rotation || 0,
      })),
    [layout],
  );

  /** ── TRẠNG THÁI ĐỘNG ── chỉ màu, ghép lên hình học tĩnh ở trên. */
  const may = useMemo<MayTrongLo[]>(
    () =>
      hinhHocMay.map((h, i) => ({
        ...h,
        mau: overlayColorHex(layout.placed[i].node, overlay),
      })),
    [hinhHocMay, layout, overlay],
  );

  const byId = layout.byId;
  const mayDangChon = selectedId != null ? (byId.get(selectedId) ?? null) : null;

  /**
   * Tập nhãn: giữ NGUYÊN luật của màn cũ (chọn ∪ hover ∪ andon ∪ pdm, hoặc TẤT CẢ
   * khi zoom gần) rồi để `locNhan.ts` cắt xuống 30. Màn cũ cắt cứng ở 60 và không
   * khử chồng lấp — đây là điểm kit mới TỐT HƠN, không phải khác đi.
   */
  const nhan = useMemo<NhanTheGioi[]>(() => {
    const canHien = (p: PlacedMachine) =>
      zoomGan ||
      p.node.id === selectedId ||
      p.node.id === chon.dangHover ||
      p.node.andonActive ||
      p.node.pdmRiskHigh;

    return layout.placed.filter(canHien).map((p) => ({
      khoa: `may:${p.node.id}`,
      machineId: p.node.id,
      viTri: { x: p.x, y: p.y + p.h + 0.45, z: p.z },
      ma: p.node.code,
      phu: nhanTrangThai(p),
      batThuong: p.node.andonActive || p.node.status === "down",
    }));
  }, [layout, zoomGan, selectedId, chon.dangHover, nhanTrangThai]);

  // Con trỏ pointer khi rê lên máy — hành vi màn cũ.
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.domElement.style.cursor = chon.dangHover != null ? "pointer" : "grab";
  }, [chon.dangHover, gl]);

  const banKinh = layout.radius;

  return (
    <>
      <fog attach="fog" args={[palette.fog, banKinh * 2.4, banKinh * 6]} />

      {/* Sàn + lưới — giữ nguyên diện mạo màn cũ. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[banKinh * 8, banKinh * 8]} />
        <meshStandardMaterial color={palette.floor} roughness={1} metalness={0} />
      </mesh>
      <Grid
        position={[0, 0, 0]}
        args={[banKinh * 4, banKinh * 4]}
        cellSize={2}
        cellThickness={0.6}
        cellColor={palette.gridCell}
        sectionSize={10}
        sectionThickness={1}
        sectionColor={palette.gridSection}
        fadeDistance={banKinh * 5}
        fadeStrength={1.2}
        infiniteGrid
      />

      {/* ★ TOÀN BỘ máy trong MỘT BatchedMesh = 1 draw call. */}
      <LoBatchMay
        may={may}
        chon={chon}
        chiHopBao={chiHopBao}
        onChon={(id) => {
          setChon((tt) => apClick(tt, id));
          if (id != null) onSelect(id);
        }}
        onHover={(id) => setChon((tt) => apHover(tt, id))}
      />

      <VienChon may={mayDangChon} />
      <LopNhan nhan={nhan} dangChon={selectedId} dangHover={chon.dangHover} tat={!coNhan} />

      <DieuKhien
        banKinh={banKinh}
        controlsRef={controlsRef}
        onDoiKhoangCach={(d) => {
          const gan = d < Math.max(10, banKinh * 0.8);
          setZoomGan((truoc) => (truoc === gan ? truoc : gan));
        }}
      />
      <BayToi byId={byId} focusId={focusId} controlsRef={controlsRef} />
      <TheoDoiFps
        onDoiBac={(hop, nhanBat) => {
          setChiHopBao(hop);
          setCoNhan(nhanBat);
        }}
      />
    </>
  );
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* Component xuất khẩu — CÙNG chữ ký `FactorySceneProps`                     */
/* ═════════════════════════════════════════════════════════════════════════ */

export interface CanhNhaMayProps extends FactorySceneProps {
  /** Nhãn trạng thái đã qua `t()` — trang truyền vào để chuỗi không bị cứng ở đây. */
  nhanTrangThai?: (status: string) => string;
  /** Chữ khi mất WebGL context, đã qua `t()` (`twin3d.loi.matContext`). */
  chuMatContext?: string;
}

export function CanhNhaMay(props: CanhNhaMayProps) {
  const themeCtx = useOptionalTheme();
  const theme = props.theme ?? themeCtx;
  const palette = scenePalette(theme);

  const banKinh = useMemo(() => resolveLayout(props.machines).radius, [props.machines]);
  const camStart = banKinh * 1.8;

  const nhanTrangThai = props.nhanTrangThai;
  const nhanCho = useMemo(
    () => (p: PlacedMachine) => (nhanTrangThai ? nhanTrangThai(p.node.status) : p.node.status),
    [nhanTrangThai],
  );

  return (
    <KhungCanh
      className={props.className}
      viTriCamera={[camStart, camStart * 0.8, camStart]}
      mauNen={palette.background}
      far={Math.max(2000, banKinh * 20)}
      cuongDoBanCau={theme === "dark" ? 0.9 : 1.1}
      cuongDoHuong={theme === "dark" ? 1.0 : 1.3}
      viTriDenHuong={[banKinh, banKinh * 1.4, banKinh * 0.6]}
      chuMatContext={props.chuMatContext}
      data-testid="khoi-canh-3d"
    >
      <NoiDungCanh
        machines={props.machines}
        selectedId={props.selectedId}
        onSelect={props.onSelect}
        overlay={props.overlay}
        focusId={props.focusId}
        theme={theme}
        nhanTrangThai={nhanCho}
      />
    </KhungCanh>
  );
}

export default CanhNhaMay;
