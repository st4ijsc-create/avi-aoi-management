/**
 * hinhHocTuMoTa.ts — DỊCH mô tả dữ liệu thuần của `hinhKhoiMay.ts` sang
 * `THREE.BufferGeometry`. Đây là toàn bộ chỗ "three biết về khối máy".
 *
 * `hinhKhoiMay.ts` (Đợt 2) cố ý KHÔNG import three: nó trả `MoTaKhoi` gồm danh
 * sách hộp con với toạ độ TƯƠNG ĐỐI trong [-0.5, 0.5] và kích thước tỉ lệ (0, 1].
 * Nhờ vậy 55 test của nó chạy trong `environment: "node"`. Tệp này là cây cầu —
 * mỏng, không có quyết định thiết kế nào của riêng nó, chỉ nhân số và ghép hộp.
 *
 * ⚠ Vì sao geometry được dựng ở KÍCH THƯỚC ĐƠN VỊ (hộp bao 1×1×1) chứ không ở
 * kích thước thật: `BatchedMesh` chia sẻ MỘT buffer đỉnh cho tất cả instance dùng
 * chung một `geometryId`. Nếu nướng kích thước thật vào geometry thì mỗi máy có số
 * đo riêng lại thành một geometry riêng — 43 geometry cho 43 máy, mất sạch lợi ích
 * gộp lô. Dựng đơn vị + đưa kích thước thật vào MA TRẬN INSTANCE cho ra đúng 7
 * geometry (một cho mỗi khối) bất kể bao nhiêu máy.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MoTaKhoi, VaiTroHop } from "../hinhKhoiMay";

/**
 * Màu xám nền cho vai trò hộp — §10.1 ISA-101: **xám là mặc định**. Đây là hệ số
 * NHÂN với màu trạng thái của instance, không phải màu tuyệt đối; nhờ vậy một máy
 * lỗi vẫn đỏ toàn thân mà các bộ phận phụ vẫn phân biệt được bằng độ đậm nhạt.
 */
const HE_SO_SANG: Readonly<Record<VaiTroHop, number>> = {
  than: 1,
  phu: 0.82,
  cua: 0.66,
  // Vạch chỉ hướng mặt trước — sáng hơn hẳn để đọc được hướng máy từ xa.
  vach_huong: 1.45,
};

/**
 * Dựng một `BufferGeometry` ĐƠN VỊ (hộp bao 1×1×1, tâm ở gốc) từ mô tả khối.
 *
 * Vertex color mang hệ số sáng của vai trò hộp; shader nhân nó với màu instance.
 * Đây là cách giữ được "7 khối phân biệt bằng mắt" mà vẫn chỉ dùng MỘT material,
 * điều kiện bắt buộc để `BatchedMesh` gộp được thành một draw call.
 */
export function hinhHocDonViTuMoTa(moTa: MoTaKhoi): THREE.BufferGeometry {
  const manh: THREE.BufferGeometry[] = [];

  for (const h of moTa.hopCon) {
    // Kích thước tỉ lệ (0,1] và tâm tương đối [-0.5,0.5] → hộp trong không gian đơn vị.
    const g = new THREE.BoxGeometry(
      Math.max(1e-4, h.co.x),
      Math.max(1e-4, h.co.y),
      Math.max(1e-4, h.co.z),
    );
    g.translate(h.tam.x, h.tam.y, h.tam.z);

    const k = HE_SO_SANG[h.vaiTro] ?? 1;
    const soDinh = g.getAttribute("position").count;
    const mau = new Float32Array(soDinh * 3);
    for (let i = 0; i < soDinh; i++) {
      mau[i * 3] = k;
      mau[i * 3 + 1] = k;
      mau[i * 3 + 2] = k;
    }
    g.setAttribute("color", new THREE.BufferAttribute(mau, 3));

    // `mergeGeometries` từ chối gộp khi các mảnh khác tập attribute — BoxGeometry
    // mang sẵn uv, giữ nguyên cho đồng nhất.
    manh.push(g);
  }

  if (manh.length === 0) {
    // Mô tả rỗng không bao giờ xảy ra với 7 khối hiện có, nhưng trả hộp đơn vị
    // còn hơn trả geometry rỗng: geometry rỗng làm BatchedMesh ném lúc addGeometry.
    return new THREE.BoxGeometry(1, 1, 1);
  }

  const gop = mergeGeometries(manh, false);
  for (const g of manh) g.dispose();
  if (!gop) {
    // Gộp thất bại (không đồng nhất attribute) — dựng lại một hộp bao đơn giản.
    return new THREE.BoxGeometry(1, 1, 1);
  }
  gop.computeVertexNormals();
  return gop;
}

/**
 * Hộp bao đơn vị trần — dùng ở bậc chất lượng `chi_hop` của `matDoKhungHinh.ts`
 * và cho máy ở LOD L2 (xa).
 */
export function hinhHocHopBaoDonVi(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const soDinh = g.getAttribute("position").count;
  const mau = new Float32Array(soDinh * 3).fill(1);
  g.setAttribute("color", new THREE.BufferAttribute(mau, 3));
  return g;
}

/**
 * Ma trận đặt một máy: dịch tới vị trí, xoay quanh trục đứng, co giãn về kích
 * thước THẬT (mét).
 *
 * ⚠ `y` là toạ độ ĐÁY máy (mặt sàn), không phải tâm. Geometry đơn vị có tâm ở gốc
 * nên phải nâng lên nửa chiều cao — quên bước này làm nửa dưới của mọi máy chìm
 * dưới sàn, và vì sàn cũng màu xám nên nhìn qua chỉ thấy "máy hơi lùn".
 */
export function maTranDatMay(
  ra: THREE.Matrix4,
  viTri: { x: number; y: number; z: number },
  kichThuocMet: { rong: number; cao: number; sau: number },
  gocXoayRad: number,
  tam = new THREE.Object3D(),
): THREE.Matrix4 {
  tam.position.set(viTri.x, viTri.y + kichThuocMet.cao / 2, viTri.z);
  tam.rotation.set(0, gocXoayRad, 0);
  tam.scale.set(
    Math.max(1e-4, kichThuocMet.rong),
    Math.max(1e-4, kichThuocMet.cao),
    Math.max(1e-4, kichThuocMet.sau),
  );
  tam.updateMatrix();
  return ra.copy(tam.matrix);
}

/** Đếm đỉnh/chỉ số của một geometry — để cấp phát BatchedMesh vừa đủ. */
export function demDinhVaChiSo(g: THREE.BufferGeometry): { dinh: number; chiSo: number } {
  const pos = g.getAttribute("position");
  const idx = g.getIndex();
  return { dinh: pos ? pos.count : 0, chiSo: idx ? idx.count : 0 };
}
