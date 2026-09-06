/**
 * vienNoiBat.ts — viền nổi bật vật thể đang chọn bằng `EdgesGeometry`.
 *
 * ★ §4 kỹ thuật 5: **KHÔNG post-processing, KHÔNG `EffectComposer`.**
 * Trên iGPU văn phòng (hồ sơ máy thật của nhà máy này), `EffectComposer` làm mất
 * MSAA rẻ của WebGL và thêm một full-screen pass cho MỖI khung — trả giá toàn màn
 * hình để làm nổi bật đúng MỘT vật thể. `EdgesGeometry` + `LineSegments` tốn đúng
 * một draw call và không đụng gì tới đường ống render.
 *
 * Đánh đổi đã cân nhắc: viền cạnh KHÔNG bao ngoài bóng vật (không "glow"), và bị
 * hình học khác che khuất như mọi vật thể khác. Với nhiệm vụ "cái nào trong 43 máy
 * giống hệt nhau đang được chọn" (NT-1) thì thế là đủ, vì viền chạy đúng theo mép
 * máy nên đọc được cả khi máy chỉ chiếm 20 pixel.
 */

import * as THREE from "three";

/** Ngưỡng góc (độ) để một cạnh được coi là "cạnh nét". 1° = giữ gần như mọi cạnh. */
export const NGUONG_GOC_CANH = 25;

export interface CauHinhVien {
  mau?: THREE.ColorRepresentation;
  /** Độ rộng nét — LƯU Ý: WebGL trên hầu hết trình duyệt bỏ qua, luôn vẽ 1px. */
  doRong?: number;
  nguongGocDo?: number;
  /** Vẽ đè lên mọi thứ (bỏ kiểm tra chiều sâu) — thấy được cả khi bị máy khác che. */
  veDe?: boolean;
}

/**
 * Tạo `LineSegments` viền từ một geometry.
 *
 * ⚠ Người gọi SỞ HỮU kết quả và phải `dispose()` cả `geometry` lẫn `material` của
 * nó (hoặc đăng ký vào `SoTaiNguyen` của `giaiPhong.ts`). `EdgesGeometry` cấp phát
 * buffer mới trên GPU — đây chính là loại rò rỉ RB-7 nói tới, và nó xảy ra MỖI LẦN
 * người dùng đổi máy đang chọn, tức là hàng trăm lần mỗi ca.
 */
export function taoVien(
  hinhHoc: THREE.BufferGeometry,
  cauHinh: CauHinhVien = {},
): THREE.LineSegments {
  const canh = new THREE.EdgesGeometry(hinhHoc, cauHinh.nguongGocDo ?? NGUONG_GOC_CANH);
  const vatLieu = new THREE.LineBasicMaterial({
    color: cauHinh.mau ?? "#ffffff",
    linewidth: cauHinh.doRong ?? 1,
    depthTest: cauHinh.veDe === true ? false : true,
    transparent: true,
    opacity: 0.95,
    // Không nhận ánh sáng và không bị tone-mapping làm xỉn — viền phải luôn rõ.
    toneMapped: false,
  });
  const vien = new THREE.LineSegments(canh, vatLieu);
  vien.renderOrder = 999; // vẽ sau cùng, để `depthTest:false` có tác dụng
  vien.frustumCulled = false;
  vien.name = "twin3d-vien-noi-bat";
  return vien;
}

/**
 * Viền hộp bao — rẻ hơn `taoVien` khi chỉ cần chỉ ra "máy nào", không cần thấy rõ
 * hình dáng. 12 đoạn thẳng cố định, không phụ thuộc độ phức tạp hình học.
 *
 * Dùng ở bậc chất lượng thấp (`chi_hop` của `matDoKhungHinh.ts`) và cho máy ở xa.
 */
export function taoVienHopBao(
  kichThuoc: { rong: number; cao: number; sau: number },
  cauHinh: CauHinhVien = {},
): THREE.LineSegments {
  const hop = new THREE.BoxGeometry(kichThuoc.rong, kichThuoc.cao, kichThuoc.sau);
  const vien = taoVien(hop, cauHinh);
  // `EdgesGeometry` đã sao chép dữ liệu cần thiết; hộp tạm giải phóng ngay.
  hop.dispose();
  return vien;
}

/** Giải phóng một viền do hai hàm trên tạo ra. Gọi TRƯỚC khi bỏ tham chiếu. */
export function giaiPhongVien(vien: THREE.LineSegments | null | undefined): void {
  if (!vien) return;
  vien.geometry.dispose();
  const mat = vien.material;
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else mat.dispose();
  vien.removeFromParent();
}
