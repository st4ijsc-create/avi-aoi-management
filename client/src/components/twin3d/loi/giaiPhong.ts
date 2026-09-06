/**
 * giaiPhong.ts — RB-7: dispose() triệt để geometry / material / texture.
 *
 * three.js **KHÔNG** tự thu hồi bộ nhớ GPU. Bỏ tham chiếu tới một `Mesh` chỉ giải
 * phóng phía JS; buffer trên card đồ hoạ ở lại cho tới khi `dispose()` được gọi.
 * Cả 3 engine hiện tại của repo đều thiếu bước này — và hub mount/unmount tab liên
 * tục, nên rò rỉ tích luỹ theo giờ làm việc chứ không theo lần tải trang.
 *
 * Module này import `three` (kiểu) nên KHÔNG có test node đi kèm; nó cố ý mỏng và
 * không chứa nhánh logic nào đáng test — phần đáng test đã ở `locNhan`/`matDoKhungHinh`.
 */

import * as THREE from "three";

/** Đếm những gì đã giải phóng — dùng cho `window.__thongKeVe` và để chứng minh. */
export interface SoDaGiaiPhong {
  geometry: number;
  material: number;
  texture: number;
  renderTarget: number;
}

function soRong(): SoDaGiaiPhong {
  return { geometry: 0, material: 0, texture: 0, renderTarget: 0 };
}

/**
 * Giải phóng mọi texture nằm trong một material.
 *
 * Duyệt TOÀN BỘ thuộc tính thay vì liệt kê `map`/`normalMap`/... : danh sách khe
 * texture của three dài và còn nở thêm; liệt kê tay đảm bảo bỏ sót một khe nào đó
 * mà không ai phát hiện, vì rò rỉ không gây lỗi — chỉ làm chậm dần.
 */
function giaiPhongTextureCuaMaterial(mat: THREE.Material, so: SoDaGiaiPhong): void {
  const bang = mat as unknown as Record<string, unknown>;
  for (const khoa of Object.keys(bang)) {
    const gt = bang[khoa];
    if (gt && (gt as THREE.Texture).isTexture === true) {
      (gt as THREE.Texture).dispose();
      so.texture += 1;
    }
  }
}

/** Giải phóng một material (hoặc mảng material) kèm texture của nó. */
export function giaiPhongMaterial(
  mat: THREE.Material | THREE.Material[] | null | undefined,
  so: SoDaGiaiPhong = soRong(),
): SoDaGiaiPhong {
  if (!mat) return so;
  const ds = Array.isArray(mat) ? mat : [mat];
  for (const m of ds) {
    if (!m) continue;
    giaiPhongTextureCuaMaterial(m, so);
    m.dispose();
    so.material += 1;
  }
  return so;
}

/**
 * Giải phóng ĐỆ QUY một Object3D và toàn bộ con cháu.
 *
 * ⚠ Duyệt trên BẢN SAO danh sách con: `traverse` của three đi trên mảng sống, và
 * ta sẽ gỡ con khỏi cha trong lúc duyệt — sửa mảng đang duyệt là cách bỏ sót
 * đúng một nửa số con, lỗi kinh điển.
 *
 * Không gọi `dispose()` trên material DÙNG CHUNG giữa nhiều cây nếu bạn còn cây
 * khác đang dùng: `boLoc` cho phép người gọi bỏ qua những vật thể đó.
 */
export function giaiPhongCay(
  goc: THREE.Object3D | null | undefined,
  boLoc?: (o: THREE.Object3D) => boolean,
  so: SoDaGiaiPhong = soRong(),
): SoDaGiaiPhong {
  if (!goc) return so;

  const tatCa: THREE.Object3D[] = [];
  goc.traverse((o) => tatCa.push(o));

  for (const o of tatCa) {
    if (boLoc && !boLoc(o)) continue;

    const coHinhHoc = o as unknown as { geometry?: THREE.BufferGeometry };
    if (coHinhHoc.geometry && typeof coHinhHoc.geometry.dispose === "function") {
      coHinhHoc.geometry.dispose();
      so.geometry += 1;
    }

    const coVatLieu = o as unknown as {
      material?: THREE.Material | THREE.Material[];
    };
    if (coVatLieu.material) giaiPhongMaterial(coVatLieu.material, so);

    // BatchedMesh/InstancedMesh có dispose() riêng (giải phóng texture ma trận
    // và buffer nội bộ) — gọi thêm, KHÔNG thay cho phần trên.
    const coDispose = o as unknown as { dispose?: () => void };
    if (
      typeof coDispose.dispose === "function" &&
      ((o as THREE.InstancedMesh).isInstancedMesh === true ||
        (o as THREE.BatchedMesh).isBatchedMesh === true)
    ) {
      coDispose.dispose();
    }
  }

  // Gỡ khỏi cha SAU khi đã dispose xong — làm trước thì `traverse` cụt.
  goc.removeFromParent();
  return so;
}

/** Giải phóng một render target. */
export function giaiPhongRenderTarget(
  rt: THREE.WebGLRenderTarget | null | undefined,
  so: SoDaGiaiPhong = soRong(),
): SoDaGiaiPhong {
  if (!rt) return so;
  rt.dispose();
  so.renderTarget += 1;
  return so;
}

/**
 * Sổ đăng ký tài nguyên — cách AN TOÀN NHẤT để không quên dispose.
 *
 * Cách dùng: mọi chỗ `new THREE.XxxGeometry()` trong component đều gọi
 * `so.ghi(hinhHoc)`, rồi `useEffect` cleanup gọi `so.giaiPhongTatCa()`. Không phải
 * nhớ danh sách nào cả — chính là điểm khác so với "nhớ gọi dispose ở cleanup".
 */
export class SoTaiNguyen {
  private hinhHoc = new Set<THREE.BufferGeometry>();
  private vatLieu = new Set<THREE.Material>();
  private ketCau = new Set<THREE.Texture>();
  private dich = new Set<THREE.WebGLRenderTarget>();

  ghiHinhHoc<T extends THREE.BufferGeometry>(g: T): T {
    this.hinhHoc.add(g);
    return g;
  }

  ghiVatLieu<T extends THREE.Material>(m: T): T {
    this.vatLieu.add(m);
    return m;
  }

  ghiKetCau<T extends THREE.Texture>(t: T): T {
    this.ketCau.add(t);
    return t;
  }

  ghiDich<T extends THREE.WebGLRenderTarget>(rt: T): T {
    this.dich.add(rt);
    return rt;
  }

  /** Số tài nguyên đang giữ — cho phép e2e chứng minh sổ về 0 sau unmount. */
  get soDangGiu(): number {
    return this.hinhHoc.size + this.vatLieu.size + this.ketCau.size + this.dich.size;
  }

  giaiPhongTatCa(): SoDaGiaiPhong {
    const so = soRong();
    for (const g of this.hinhHoc) {
      g.dispose();
      so.geometry += 1;
    }
    for (const m of this.vatLieu) {
      giaiPhongTextureCuaMaterial(m, so);
      m.dispose();
      so.material += 1;
    }
    for (const t of this.ketCau) {
      t.dispose();
      so.texture += 1;
    }
    for (const rt of this.dich) {
      rt.dispose();
      so.renderTarget += 1;
    }
    this.hinhHoc.clear();
    this.vatLieu.clear();
    this.ketCau.clear();
    this.dich.clear();
    return so;
  }
}
