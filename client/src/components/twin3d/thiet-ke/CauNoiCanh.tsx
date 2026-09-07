/**
 * CauNoiCanh.tsx — CẦU NỐI giữa cây React **trong** `<Canvas>` và các lớp phủ
 * DOM **ngoài** nó (thanh công cụ canvas #58, xuất PNG #57, mini-map #56).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO CẦN MỘT CẦU NỐI, KHÔNG PHẢI MỘT CONTEXT
 * ════════════════════════════════════════════════════════════════════════════
 * `useThree()` chỉ đọc được BÊN TRONG `<Canvas>`. Nhưng thanh công cụ và
 * mini-map phải là DOM thật (nút bấm, SVG, focus, bàn phím) — nhét chúng vào
 * trong Canvas qua `<Html>` biến chúng thành lớp phủ WebGL, mất tiêu điểm bàn
 * phím và mất cả khả năng nằm trên viền canvas.
 *
 * R3F có `<Canvas eventSource>` và context bắc cầu, nhưng cả hai đòi sửa
 * `loi/KhungCanh.tsx` — tệp ĐÃ QUA QA và là cửa duy nhất vào WebGL của kit
 * (RB-4). Cầu nối bằng `ref` đạt cùng kết quả mà **không đụng một dòng nào**
 * trong `loi/`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ REF, KHÔNG PHẢI STATE — và đây là quyết định, không phải lười
 * ════════════════════════════════════════════════════════════════════════════
 * Ghi `camera`/`controls` vào state sẽ render lại cả cây mỗi khung mà camera
 * đổi (tức mỗi khung người dùng xoay chuột). Với 42 máy trong một `BatchedMesh`
 * đó là ngân sách §4 bị đốt cho một thanh công cụ.
 *
 * Đổi lại: người đọc `ref.current` phải chấp nhận nó có thể `null` ở lượt render
 * ĐẦU (Canvas chưa mount xong). Mọi hàm dưới đây trả một giá trị "chưa sẵn
 * sàng" tường minh thay vì ném — nút bấm khi đó đơn giản là chưa làm gì, chứ
 * không làm sai.
 *
 * ★ RB-3 — mọi thao tác dời camera PHẢI gọi `invalidate()`. Với
 *   `frameloop="demand"`, quên nó nghĩa là camera ĐÃ dời trong dữ liệu mà màn
 *   hình **không đổi một pixel** — người dùng bấm "Fit" và kết luận nút hỏng.
 */

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { DiemScene } from "../heToaDo";
import type { KhungNhin } from "./khungNhin";

/** Những gì lớp phủ DOM cần chạm tới bên trong Canvas. */
export interface CanhDaNoi {
  camera: THREE.Camera;
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  invalidate: () => void;
  /** OrbitControls — `null` cho tới khi `DieuKhien` gắn xong. */
  controls: React.MutableRefObject<OrbitControls | null>;
}

export type RefCanh = React.MutableRefObject<CanhDaNoi | null>;

/**
 * Đặt component này BÊN TRONG `<KhungCanh>`; nó không vẽ gì, chỉ ghi tham chiếu.
 * Trả `null` nên không tốn draw call nào (§4).
 */
export function CauNoiCanh({
  refCanh,
  controls,
}: {
  refCanh: RefCanh;
  controls: React.MutableRefObject<OrbitControls | null>;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    refCanh.current = { camera, gl, scene, invalidate, controls };
    return () => {
      refCanh.current = null;
    };
  }, [refCanh, camera, gl, scene, invalidate, controls]);

  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Thao tác camera — dùng chung cho Fit (#58) và mini-map (#56)                */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Điểm camera đang ngắm. `OrbitControls.target` là nguồn sự thật khi có. */
export function diemDangNgam(canh: CanhDaNoi | null): DiemScene | null {
  if (!canh) return null;
  const t = canh.controls.current?.target;
  if (t) return { x: t.x, y: t.y, z: t.z };
  return { x: 0, y: 0, z: 0 };
}

/**
 * Áp một khung nhìn: dời camera + đổi tâm quay + vẽ lại.
 *
 * ★★★ PHẢI ĐỔI `controls.target` CÙNG LÚC. Đặt mỗi `camera.position` thì
 *   `OrbitControls` vẫn giữ tâm quay CŨ, và cú xoay chuột kế tiếp quăng camera
 *   trở về quỹ đạo cũ — người dùng thấy "Fit chạy rồi tự nhảy lại". Đây là lỗi
 *   kinh điển của cặp camera/controls và nó không nổ ở đâu cả.
 *
 * ★ Nới `maxDistance` khi cần: `taoDieuKhienQuay` đặt trần theo bán kính SÀN,
 *   nhưng fit-all một cảnh rộng hơn sàn cần lùi xa hơn trần đó. Không nới thì
 *   `controls.update()` KÉO camera trở lại và fit "chỉ fit một nửa".
 *
 * Trả `false` khi cảnh chưa sẵn sàng — người gọi biết mà không phải đoán.
 */
export function apKhungNhin(canh: CanhDaNoi | null, kn: KhungNhin | null): boolean {
  if (!canh || !kn) return false;
  const { camera, controls, invalidate } = canh;
  camera.position.set(kn.viTri.x, kn.viTri.y, kn.viTri.z);
  const c = controls.current;
  if (c) {
    if (c.maxDistance < kn.khoangCach * 1.05) c.maxDistance = kn.khoangCach * 1.05;
    c.target.set(kn.ngam.x, kn.ngam.y, kn.ngam.z);
    c.update();
  } else {
    camera.lookAt(kn.ngam.x, kn.ngam.y, kn.ngam.z);
  }
  camera.updateMatrixWorld();
  invalidate();
  return true;
}

/**
 * Tịnh tiến camera + tâm ngắm theo một cặp đã tính sẵn (mini-map click).
 * Tách khỏi {@link apKhungNhin} vì nó KHÔNG đổi khoảng cách — giữ nguyên mức
 * zoom người dùng đang có là điều khiến "click để đi tới" không gây chóng mặt.
 */
export function apDiemNgam(
  canh: CanhDaNoi | null,
  cap: { viTri: DiemScene; ngam: DiemScene } | null,
): boolean {
  if (!canh || !cap) return false;
  const { camera, controls, invalidate } = canh;
  camera.position.set(cap.viTri.x, cap.viTri.y, cap.viTri.z);
  const c = controls.current;
  if (c) {
    c.target.set(cap.ngam.x, cap.ngam.y, cap.ngam.z);
    c.update();
  } else {
    camera.lookAt(cap.ngam.x, cap.ngam.y, cap.ngam.z);
  }
  camera.updateMatrixWorld();
  invalidate();
  return true;
}

/**
 * Tỉ lệ khung nhìn (rộng/cao) THẬT của canvas — đầu vào bắt buộc của
 * `khoangCachFit`. Đọc từ `gl.domElement` chứ không từ `window`: canvas nằm
 * giữa hai panel co giãn được, nên kích thước cửa sổ không nói gì về nó.
 */
export function tiLeKhungCua(canh: CanhDaNoi | null): number {
  const el = canh?.gl.domElement;
  if (!el || !(el.clientHeight > 0)) return 1;
  return el.clientWidth / el.clientHeight;
}

/** `fov` dọc hiện tại (độ). Camera trực giao không có fov ⇒ mặc định 45. */
export function fovCua(canh: CanhDaNoi | null): number {
  const cam = canh?.camera as THREE.PerspectiveCamera | undefined;
  return typeof cam?.fov === "number" && cam.fov > 0 ? cam.fov : 45;
}

/**
 * Vẽ lại NGAY LẬP TỨC vào backbuffer — bước bắt buộc trước `toDataURL` (#57).
 * Xem docblock `xuatAnh.ts`: `preserveDrawingBuffer` là `false`, nên chụp mà
 * không vẽ lại cho ra ảnh TRẮNG và không lỗi nào.
 */
export function veNgay(canh: CanhDaNoi | null): void {
  if (!canh) return;
  canh.gl.render(canh.scene, canh.camera);
}
