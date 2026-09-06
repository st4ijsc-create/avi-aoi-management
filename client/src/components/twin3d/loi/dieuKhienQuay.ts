/**
 * dieuKhienQuay.ts — bọc `OrbitControls` THUẦN (three/examples), RB-3.
 *
 * ★★★ RB-3, lỗi câm nguy hiểm nhất của kit này:
 * `frameloop="demand"` chỉ vẽ khi có ai gọi `invalidate()`. `OrbitControls` của
 * **drei** tự gọi `invalidate`; `OrbitControls` **thuần** thì KHÔNG. Ghép
 * demand + controls thuần mà quên nối `change → invalidate` cho ra một màn hình
 * **ĐỨNG HÌNH KHI XOAY CAMERA** — không lỗi console, không cảnh báo, chỉ là
 * "3D bị treo". Hàm `taoDieuKhienQuay()` dưới đây làm việc nối đó BẮT BUỘC:
 * `invalidate` là tham số **required**, không có giá trị mặc định, nên quên nối
 * là lỗi biên dịch chứ không phải lỗi lúc chạy.
 *
 * Vì sao dùng controls thuần thay vì drei: kit này còn được dùng ngoài cây R3F
 * (màn Thiết kế cần TransformControls đứng cạnh OrbitControls, xem RB-1) và
 * việc bật/tắt lẫn nhau giữa hai controls dễ viết hơn khi ta giữ tham chiếu thật.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface CauHinhDieuKhien {
  /** Góc cực tối đa — chặn camera chui xuống dưới sàn. */
  gocCucToiDa?: number;
  khoangCachToiThieu?: number;
  khoangCachToiDa?: number;
  /** Quán tính. Bật thì PHẢI gọi `update()` mỗi khung khi còn trôi. */
  quanTinh?: boolean;
  heSoQuanTinh?: number;
  muc?: THREE.Vector3;
}

export interface DieuKhienQuayDaNoi {
  controls: OrbitControls;
  /** Gỡ listener + `dispose()`. PHẢI gọi trong cleanup của effect. */
  huy: () => void;
}

/**
 * Tạo OrbitControls đã NỐI SẴN `invalidate`.
 *
 * @param invalidate — hàm yêu cầu vẽ một khung (từ `useThree(s => s.invalidate)`).
 *                     KHÔNG có mặc định: xem docblock đầu tệp.
 */
export function taoDieuKhienQuay(
  camera: THREE.Camera,
  phanTu: HTMLElement,
  invalidate: () => void,
  cauHinh: CauHinhDieuKhien = {},
): DieuKhienQuayDaNoi {
  const controls = new OrbitControls(camera, phanTu);

  controls.maxPolarAngle = cauHinh.gocCucToiDa ?? Math.PI / 2.15;
  controls.minDistance = cauHinh.khoangCachToiThieu ?? 4;
  controls.maxDistance = cauHinh.khoangCachToiDa ?? 400;
  controls.enableDamping = cauHinh.quanTinh ?? true;
  controls.dampingFactor = cauHinh.heSoQuanTinh ?? 0.08;
  if (cauHinh.muc) controls.target.copy(cauHinh.muc);
  controls.update();

  // ★ RB-3 — dòng sống còn.
  const khiDoi = () => invalidate();
  controls.addEventListener("change", khiDoi);

  return {
    controls,
    huy: () => {
      controls.removeEventListener("change", khiDoi);
      controls.dispose();
    },
  };
}

/**
 * Nối `invalidate` vào một OrbitControls ĐÃ CÓ (ví dụ ref của drei
 * `<OrbitControls>` — drei tự nối rồi, nhưng nối thêm không hại và biến ý định
 * thành mã đọc được).
 *
 * Trả về hàm gỡ.
 */
export function noiInvalidate(
  controls: Pick<OrbitControls, "addEventListener" | "removeEventListener">,
  invalidate: () => void,
): () => void {
  const f = () => invalidate();
  // ⚠ Kiểu hẹp `Pick<OrbitControls, …>` chứ KHÔNG phải một hình dạng
  // `{addEventListener:(t:string,…)}` tự chế: `OrbitControls` khai
  // `addEventListener<T extends keyof OrbitControlsEventMap>`, và `string` KHÔNG
  // gán được vào `keyof OrbitControlsEventMap`. Bản hình-dạng-tự-chế biên dịch
  // được ở tệp này nhưng ĐỎ ngay chỗ gọi — đã đo bằng `npm run check` (TS2345).
  controls.addEventListener("change", f);
  return () => controls.removeEventListener("change", f);
}

/**
 * Đặt camera nhìn bao trọn một hộp bao — dùng khi mở màn và khi đổi phạm vi.
 *
 * Trả về vị trí camera và mục ngắm đã tính; KHÔNG tự gán, để người gọi quyết định
 * gán ngay hay bay tới từ từ.
 */
export function khungHinhBaoTron(
  bbox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
  fovDo = 45,
  dem = 1.35,
): { viTri: [number, number, number]; muc: [number, number, number]; banKinh: number } {
  const cx = (bbox.min.x + bbox.max.x) / 2;
  const cy = (bbox.min.y + bbox.max.y) / 2;
  const cz = (bbox.min.z + bbox.max.z) / 2;
  const dx = bbox.max.x - bbox.min.x;
  const dy = bbox.max.y - bbox.min.y;
  const dz = bbox.max.z - bbox.min.z;
  const banKinh = Math.max(1, 0.5 * Math.hypot(dx, dy, dz));
  const fovRad = (fovDo * Math.PI) / 180;
  const khoangCach = (banKinh / Math.sin(fovRad / 2)) * dem;
  // Góc nhìn chéo 35° — đủ thấy mặt sàn mà không thành ảnh top-down phẳng lì.
  const cao = khoangCach * 0.62;
  const ngang = khoangCach * 0.62;
  return {
    viTri: [cx + ngang, cy + cao, cz + ngang],
    muc: [cx, cy, cz],
    banKinh,
  };
}
