/**
 * LoBatchMay.tsx — vẽ TOÀN BỘ máy bằng MỘT `THREE.BatchedMesh` = 1 draw call.
 *
 * Vì sao `BatchedMesh` chứ không `InstancedMesh` (§4 kỹ thuật 2): `InstancedMesh`
 * dùng ĐÚNG MỘT geometry cho mọi instance, nên 7 khối máy khác nhau cần 7
 * InstancedMesh = 7 draw call, và nếu chia nhỏ theo LOD thì thành 21.
 * `BatchedMesh` render nhiều object **cùng material nhưng KHÁC hình học** trong
 * một draw call, `perObjectFrustumCulled` mặc định `true`, và **giữ ID từng
 * object** nên click vào máy vẫn hoạt động. Đã kiểm chứng có sẵn trong three
 * r182 tại `node_modules/three/src/objects/BatchedMesh.js`.
 *
 * ★ Bẫy đã kiểm chứng trong mã nguồn three: raycast của `BatchedMesh` gán
 * `intersect.batchId`, **KHÔNG** gán `instanceId` (r182 dòng 1415). R3F trải
 * nguyên `...hit` vào event nên `batchId` có mặt, nhưng KHÔNG có trong kiểu
 * `ThreeEvent`. Đọc nhầm `e.instanceId` cho ra `undefined` với MỌI cú click —
 * và vì không ai ném lỗi, biểu hiện duy nhất là "click vào máy không có gì xảy ra".
 *
 * Bất biến §6.2: **hình học tĩnh tách hẳn khỏi trạng thái động.** Cập nhật
 * realtime CHỈ được chạm `setColorAt`/`setVisibleAt`; không bao giờ dựng lại
 * BatchedMesh vì một cập nhật trạng thái.
 */

import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { hinhHocKhoi, type KhoiKey, type KichThuocMm } from "../hinhKhoiMay";
import { hinhHocDonViTuMoTa, maTranDatMay, demDinhVaChiSo } from "./hinhHocTuMoTa";
import { dungBangTra, mucNhanSang, type BangTraLo, type TrangThaiChon } from "./chonVatThe";

/** Một máy sẵn sàng để vẽ. Toạ độ đã ở hệ SCENE (mét) — quy đổi ở `heToaDo.ts`. */
export interface MayTrongLo {
  /** id máy trong DB — cái mà DOM biết. KHÔNG phải chỉ số instance. */
  machineId: number;
  khoi: KhoiKey;
  kichThuocMm: KichThuocMm;
  /** Vị trí ĐÁY máy trên sàn, mét. */
  viTri: { x: number; y: number; z: number };
  /** Góc xoay quanh trục đứng, radian. */
  gocXoayRad: number;
  /** Màu đã phân giải sang chuỗi CSS dùng được (`giaiMauCanh()` của mauTrangThai). */
  mau: string;
  /** Độ mờ 0–1 từ `mauTrangThai.ts` — hiện tại dùng để làm nhạt màu, xem docblock. */
  doMo?: number;
  /** false = ẩn (ngoài phạm vi đang chọn). Mặc định hiện. */
  hien?: boolean;
}

export interface LoBatchMayProps {
  may: MayTrongLo[];
  chon: TrangThaiChon;
  onChon: (machineId: number | null) => void;
  onHover: (machineId: number | null) => void;
  /** Bậc `chi_hop` của matDoKhungHinh → vẽ hộp bao trần thay vì khối chi tiết. */
  chiHopBao?: boolean;
  /** Nhận tham chiếu bảng tra để lớp nhãn / e2e dùng chung. */
  onBangTra?: (bang: BangTraLo) => void;
}

const TRANG = new THREE.Color("#ffffff");

/**
 * Ngân sách cấp phát. `BatchedMesh` cấp buffer CỐ ĐỊNH lúc dựng và ném khi tràn,
 * nên ta cộng thật số đỉnh/chỉ số của 7 geometry rồi mới dựng — không đoán.
 * Đệm 20 % cho phép đổi LOD tại chỗ mà không phải cấp phát lại.
 */
const DEM_DU_PHONG = 1.2;

export function LoBatchMay({
  may,
  chon,
  onChon,
  onHover,
  chiHopBao = false,
  onBangTra,
}: LoBatchMayProps) {
  const invalidate = useThree((s) => s.invalidate);
  const meshRef = useRef<THREE.BatchedMesh | null>(null);

  // ── Bảng tra instanceId ↔ machineId. Dựng từ CÙNG mảng, CÙNG useMemo với lô. ──
  const bangTra = useMemo(() => dungBangTra(may.map((m) => m.machineId)), [may]);

  useEffect(() => {
    onBangTra?.(bangTra);
  }, [bangTra, onBangTra]);

  /**
   * ── HÌNH HỌC TĨNH ──
   * Phụ thuộc: danh sách khối + kích thước (hình dạng), KHÔNG phụ thuộc màu.
   * Đây chính là chỗ cưỡng chế bất biến §6.2: đổi trạng thái không đụng useMemo này.
   */
  const loMoi = useMemo(() => {
    // Khoá geometry = khối + kích thước làm tròn mm. Hai máy AOI cùng số đo dùng
    // CHUNG một geometryId; khác số đo thì tách — đúng ý "AOI 1400 và AOI 2200
    // nhìn khác nhau ngay" của hinhKhoiMay.ts.
    const khoaHinh = (m: MayTrongLo) =>
      chiHopBao
        ? "hop"
        : `${m.khoi}|${Math.round(m.kichThuocMm.rongMm)}x${Math.round(m.kichThuocMm.caoMm)}x${Math.round(m.kichThuocMm.sauMm)}`;

    const hinhTheoKhoa = new Map<string, THREE.BufferGeometry>();
    for (const m of may) {
      const k = khoaHinh(m);
      if (hinhTheoKhoa.has(k)) continue;
      hinhTheoKhoa.set(
        k,
        chiHopBao
          ? (() => {
              const g = new THREE.BoxGeometry(1, 1, 1);
              const n = g.getAttribute("position").count;
              g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
              return g;
            })()
          : hinhHocDonViTuMoTa(hinhKhoiKhongLoi(m)),
      );
    }

    let tongDinh = 0;
    let tongChiSo = 0;
    for (const g of hinhTheoKhoa.values()) {
      const d = demDinhVaChiSo(g);
      tongDinh += d.dinh;
      tongChiSo += d.chiSo;
    }

    const soMay = Math.max(1, may.length);
    const mesh = new THREE.BatchedMesh(
      Math.ceil(soMay * DEM_DU_PHONG),
      Math.ceil(Math.max(1, tongDinh) * DEM_DU_PHONG),
      Math.ceil(Math.max(1, tongChiSo) * DEM_DU_PHONG),
      new THREE.MeshStandardMaterial({
        // Màu trắng + vertexColors: màu thật đến từ `setColorAt` per-instance,
        // nhân với hệ số sáng vai trò hộp nằm trong vertex color của geometry.
        color: "#ffffff",
        vertexColors: true,
        metalness: 0.12,
        roughness: 0.68,
      }),
    );
    mesh.name = "twin3d-lo-may";
    mesh.perObjectFrustumCulled = true;
    mesh.sortObjects = false; // vật liệu đục — không cần sắp theo chiều sâu

    const geoIdTheoKhoa = new Map<string, number>();
    for (const [k, g] of hinhTheoKhoa) {
      geoIdTheoKhoa.set(k, mesh.addGeometry(g));
      // BatchedMesh đã SAO CHÉP dữ liệu vào buffer chung; bản gốc không còn cần.
      g.dispose();
    }

    const mt = new THREE.Matrix4();
    const tam = new THREE.Object3D();
    for (const m of may) {
      const geoId = geoIdTheoKhoa.get(khoaHinh(m));
      if (geoId === undefined) continue;
      const id = mesh.addInstance(geoId);
      const met = {
        rong: m.kichThuocMm.rongMm / 1000,
        cao: m.kichThuocMm.caoMm / 1000,
        sau: m.kichThuocMm.sauMm / 1000,
      };
      mesh.setMatrixAt(id, maTranDatMay(mt, m.viTri, met, m.gocXoayRad, tam));
    }
    mesh.computeBoundingSphere();
    return mesh;
  }, [may, chiHopBao]);

  // Gắn ref + RB-7: giải phóng lô CŨ khi useMemo sinh lô mới hoặc khi unmount.
  useEffect(() => {
    meshRef.current = loMoi;
    invalidate();
    return () => {
      // `BatchedMesh.dispose()` trả buffer chung; material và geometry gộp phải
      // dispose tay — three không đi tìm chúng hộ ta (RB-7).
      loMoi.dispose();
      loMoi.geometry.dispose();
      const mat = loMoi.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    };
  }, [loMoi, invalidate]);

  /**
   * ── TRẠNG THÁI ĐỘNG ──
   * Chỉ `setColorAt` + `setVisibleAt`. KHÔNG dựng lại geometry (§6.2).
   */
  useLayoutEffect(() => {
    const mesh = loMoi;
    const c = new THREE.Color();
    may.forEach((m, i) => {
      c.set(m.mau || "#808080");
      // `doMo` của mauTrangThai.ts nghĩa là "vật thể mờ đi". Vật liệu đục dùng
      // chung cho cả lô nên KHÔNG bật `transparent` được (một cờ, cả lô mờ theo).
      // Ta chuyển độ mờ thành pha về màu nền xưởng — đọc y hệt trên nền tối/sáng,
      // và giữ nguyên 1 draw call. Đây là đánh đổi có ý thức, không phải bỏ sót.
      if (m.doMo !== undefined && m.doMo < 1) c.multiplyScalar(0.35 + 0.65 * m.doMo);
      const nhan = mucNhanSang(m.machineId, chon);
      if (nhan > 0) c.lerp(TRANG, nhan);
      mesh.setColorAt(i, c);
      mesh.setVisibleAt(i, m.hien !== false);
    });
    invalidate();
  }, [loMoi, may, chon, invalidate]);

  const doiHover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const id = docBatchId(e);
    onHover(id === null ? null : (bangTra.mayTheoInstance[id] ?? null));
  };

  return (
    <primitive
      object={loMoi}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        const id = docBatchId(e);
        onChon(id === null ? null : (bangTra.mayTheoInstance[id] ?? null));
      }}
      onPointerMove={doiHover}
      onPointerOut={() => onHover(null)}
    />
  );
}

/**
 * Đọc `batchId` khỏi event của R3F.
 *
 * ★ `batchId` KHÔNG có trong kiểu `ThreeEvent` (R3F chỉ khai `instanceId` cho
 * InstancedMesh), nhưng R3F trải `...hit` nguyên vẹn vào event object nên trường
 * này CÓ MẶT lúc chạy — đã đọc `events-5a94e5eb.esm.js` để xác nhận. Ép kiểu ở
 * đúng một chỗ, có chú thích, thay vì rắc `any` khắp nơi.
 */
function docBatchId(e: { batchId?: number; instanceId?: number | null }): number | null {
  if (typeof e.batchId === "number") return e.batchId;
  // Dự phòng: nếu three đổi tên trường ở bản sau, instanceId là ứng viên kế tiếp.
  if (typeof e.instanceId === "number") return e.instanceId;
  return null;
}

/** Mô tả khối, không bao giờ ném — kích thước rác đã được `hinhHocKhoi` kẹp. */
function hinhKhoiKhongLoi(m: MayTrongLo) {
  return hinhHocKhoi(m.khoi, m.kichThuocMm);
}

export default LoBatchMay;
