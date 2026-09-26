/**
 * giaiPhong.ts — RB-7: dispose() triệt để geometry / material / texture.
 *
 * three.js **KHÔNG** tự thu hồi bộ nhớ GPU. Bỏ tham chiếu tới một `Mesh` chỉ giải
 * phóng phía JS; buffer trên card đồ hoạ ở lại cho tới khi `dispose()` được gọi.
 * Cả 3 engine hiện tại của repo đều thiếu bước này — và hub mount/unmount tab liên
 * tục, nên rò rỉ tích luỹ theo giờ làm việc chứ không theo lần tải trang.
 *
 * ★★★ TÌNH TRẠNG THẬT (đo 2026-09-06, grep toàn repo): **MODULE NÀY CHƯA ĐƯỢC
 * DÙNG Ở ĐÂU.** 0 nơi gọi; nó chỉ được `index.ts` re-export. RB-7 hiện ĐẠT nhờ
 * bốn chỗ dispose VIẾT TAY, không nhờ module này:
 *   - `LoBatchMay.tsx:175-179`      (BatchedMesh + geometry + material)
 *   - `CanhNhaMay.tsx:184`          (viền chọn, gọi `giaiPhongVien`)
 *   - `vienNoiBat.ts:87-94`         (EdgesGeometry + LineBasicMaterial)
 *   - `hinhHocTuMoTa.ts:76`         (các mảnh BoxGeometry sau `mergeGeometries`)
 *
 * ★ QUYẾT ĐỊNH của phiên vá (2026-09-06): **GIỮ NGUYÊN, chưa nối vào bốn chỗ trên.**
 * Đã cân nhắc phương án thay bốn chỗ viết tay bằng module này (gọn hơn, một nguồn
 * sự thật) và BỎ, vì:
 *   1. Bốn chỗ đó mỗi chỗ giải phóng 1-2 vật thể ĐÃ BIẾT TÊN; `giaiPhongCay` duyệt
 *      cây scene TỔNG QUÁT. Đổi sang nó là đổi từ "giải phóng đúng 2 thứ này" sang
 *      "giải phóng mọi thứ tìm thấy dưới gốc này" — phạm vi rộng hơn hẳn, và
 *      BatchedMesh chia sẻ geometry giữa các instance nên "duyệt cây rồi dispose
 *      tất" là đúng loại thao tác có thể dispose nhầm cái còn dùng.
 *   2. Bằng chứng RB-7 hiện tại đo trên bốn chỗ viết tay đó. Thay chúng ⇒ bằng
 *      chứng cũ hết hiệu lực, phải đo lại rò rỉ GPU trên màn thật — việc của một
 *      đợt có ngân sách đo, không phải của một phiên vá 3 việc.
 *   3. Module này CHƯA CÓ TEST NÀO. Nối mã chưa đo vào bốn điểm đang chạy đúng là
 *      đổi rủi ro lấy vẻ gọn gàng.
 *
 * ⇒ ĐỂ ĐỢT SAU: hoặc (a) viết test cho module rồi mới nối và đo lại RB-7, hoặc
 * (b) dùng nó cho các engine CŨ (`factory-scene/`) vốn đang thiếu dispose hoàn
 * toàn — đó mới là chỗ nó có giá trị ròng, vì ở đó nó thay thế SỐ KHÔNG chứ không
 * thay thế mã đang chạy đúng.
 *
 * ⚠ KHÔNG XOÁ: module đã viết xong, có ích cho (b), và xoá tài nguyên dự án phải
 * hỏi chủ dự án.
 *
 * Module này import `three` (kiểu) nên chưa có test node đi kèm; nếu đợt sau nối
 * nó vào thật thì test là điều kiện tiên quyết (xem điểm 3 ở trên).
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
