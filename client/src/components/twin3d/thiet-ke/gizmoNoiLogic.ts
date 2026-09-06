/**
 * gizmoNoiLogic.ts — phần LOGIC THUẦN của `GizmoBienDoi.tsx` (§7.2 công cụ #1-#5).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TÁCH RA KHỎI COMPONENT — đây không phải sở thích kiến trúc
 * ════════════════════════════════════════════════════════════════════════════
 * `GizmoBienDoi.tsx` là `.tsx` nên `vitest.config.ts` KHÔNG thu thập nó
 * (`environment: "node"`, include `client/src/**\/*.unit.test.ts`). Nếu quy tắc
 * "Ctrl đảo snap", "phím W/E/R đổi chế độ" và "xoay phải là bội của bước" nằm
 * trong component thì chúng KHÔNG ĐO ĐƯỢC — và RB-2 là đúng cái không được phép
 * không đo, vì vi phạm nó KHÔNG gây lỗi nào: gizmo vẫn xoay, chỉ là không bao
 * giờ chạm 15°.
 *
 * Component giữ lại đúng phần không tách được: `scene.add(controls.getHelper())`
 * và đăng ký listener. Phần đó đo bằng ẢNH CHỤP (cổng ra #3), không bằng unit
 * test — vì `scene.add(controls)` cũng "chạy được", chỉ là không vẽ gì.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ RB-2 nhắc lại — KHÔNG dùng `controls.setRotationSnap()`
 * ════════════════════════════════════════════════════════════════════════════
 * three snap xoay TƯƠNG ĐỐI: 8° + 15° = 23°, không bao giờ chạm 15°.
 * {@link gocSauXoay} gọi `snapGocTuyetDoi` của `hinhHocCanChinh.ts` (đã có 69
 * test, đừng viết lại) và đó là hàm mà `objectChange` phải gọi.
 */

import {
  BUOC_GOC_MAC_DINH_DO,
  BUOC_LUOI_MAC_DINH_MM,
  snapCoHieuLuc,
  snapGocTuyetDoi,
  snapLuoiMatBang,
} from "../hinhHocCanChinh";
import type { DiemScene } from "../heToaDo";

// ---------------------------------------------------------------------------
// Chế độ gizmo
// ---------------------------------------------------------------------------

/** Ba chế độ của `TransformControls`. Tên trùng NGUYÊN VĂN API của three. */
export type CheDoGizmo = "translate" | "rotate" | "scale";

/** Chế độ mở màn — di chuyển, việc chiếm 90 % thời gian dựng bố cục. */
export const CHE_DO_MAC_DINH: CheDoGizmo = "translate";

/**
 * Ánh xạ phím → chế độ, quy ước Unity (§7.2 công cụ #1): W/E/R.
 *
 * ★ So khớp `event.key` đã hạ chữ thường, KHÔNG dùng `event.code`: bàn phím
 *   không-QWERTY (AZERTY, Dvorak) có `code === "KeyW"` ở một phím vật lý khác
 *   chữ W, và người dùng bấm theo CHỮ họ thấy trên phím.
 *
 * ★ Trả `null` cho mọi phím khác — người gọi phải phân biệt "phím này của tôi"
 *   với "phím này để nguyên cho trình duyệt". Trả về một chế độ mặc định thay vì
 *   null sẽ nuốt mọi phím và làm Ctrl+Z / gõ vào ô tìm kiếm chết.
 */
export function cheDoTuPhim(phim: string): CheDoGizmo | null {
  switch (phim.toLowerCase()) {
    case "w":
      return "translate";
    case "e":
      return "rotate";
    case "r":
      return "scale";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Snap — ngữ nghĩa ĐẢO của Blender (§7.2 công cụ #2)
// ---------------------------------------------------------------------------

/**
 * Snap có hiệu lực cho lần kéo này không?
 *
 * ★ Ctrl ĐẢO trạng thái, không phải BẬT: "snap không có đường thoát còn tệ hơn
 *   không snap" (§7.2). Người bật snap trong thanh công cụ vẫn phải đặt được
 *   một máy lệch lưới bằng cách giữ Ctrl.
 *
 * Uỷ quyền cho `snapCoHieuLuc` của `hinhHocCanChinh.ts` — một công thức, một chỗ.
 */
export const snapDangBat = snapCoHieuLuc;

/**
 * Vị trí SAU khi áp snap tịnh tiến.
 *
 * ★ Snap MẶT BẰNG (X,Z), giữ nguyên độ cao Y — `snapLuoiMatBang`. Snap cả Y sẽ
 *   nhấc máy khỏi mặt sàn khi cao độ tầng không phải bội của bước lưới, và cao
 *   độ tầng là số người dùng nhập tự do (2.850 mm chẳng hạn).
 */
export function viTriSauKeo(
  viTri: DiemScene,
  snapBat: boolean,
  giuCtrl: boolean,
  buocMm: number = BUOC_LUOI_MAC_DINH_MM,
): DiemScene {
  if (!snapDangBat(snapBat, giuCtrl)) return { ...viTri };
  return snapLuoiMatBang(viTri, buocMm);
}

/**
 * ★★★ RB-2 — góc SAU khi áp snap xoay, đơn vị ĐỘ.
 *
 * Đây là hàm mà handler `objectChange` phải gọi để ghi đè `object.rotation.y`.
 * Bằng chứng nó khác công thức của three:
 *   `gocSauXoay(8, true, false, 15)  === 15`   ← tuyệt đối, ĐÚNG
 *   `8 + 15 === 23`                             ← tương đối của three, SAI
 */
export function gocSauXoay(
  gocDo: number,
  snapBat: boolean,
  giuCtrl: boolean,
  buocDo: number = BUOC_GOC_MAC_DINH_DO,
): number {
  if (!snapDangBat(snapBat, giuCtrl)) return gocDo;
  return snapGocTuyetDoi(gocDo, buocDo);
}

// ---------------------------------------------------------------------------
// Khoá trục (§7.2 công cụ #5)
// ---------------------------------------------------------------------------

/** Trục đang bị khoá khi kéo; `null` = tự do cả ba. */
export type TrucKhoa = "X" | "Y" | "Z" | null;

/**
 * Phím X/Y/Z ĐẢO khoá trục — bấm lại cùng phím là mở khoá.
 *
 * ★ Đảo, không phải gán: không có đảo thì người dùng khoá trục X rồi không có
 *   cách nào quay lại tự do ngoài việc bỏ chọn và chọn lại vật thể.
 */
export function trucSauPhim(hienTai: TrucKhoa, phim: string): TrucKhoa {
  const p = phim.toUpperCase();
  if (p !== "X" && p !== "Y" && p !== "Z") return hienTai;
  return hienTai === p ? null : (p as TrucKhoa);
}

/**
 * Ba cờ `showX/showY/showZ` của `TransformControls` suy từ trục khoá.
 *
 * ⚠ Ngữ nghĩa NGƯỢC với trực giác tên gọi: "khoá trục X" trong ngôn ngữ của
 * Blender nghĩa là **CHỈ cho di chuyển theo X**, không phải "cấm X". Người dùng
 * bấm X là để trượt dọc X. Ghi ở đây vì đây đúng là chỗ hai cách hiểu đối
 * nghịch gặp nhau, và chọn nhầm cho ra một gizmo làm ngược mọi thao tác.
 */
export function coTrucHienThi(khoa: TrucKhoa): { x: boolean; y: boolean; z: boolean } {
  if (khoa === null) return { x: true, y: true, z: true };
  return { x: khoa === "X", y: khoa === "Y", z: khoa === "Z" };
}

// ---------------------------------------------------------------------------
// Điều kiện gắn gizmo
// ---------------------------------------------------------------------------

/**
 * Có gắn gizmo vào vật thể này không?
 *
 * ★ G8 — trả FALSE khi: không có gì được chọn · vật thể `daKhoa` (§7.2 công cụ
 *   #8 — "chặn lỗi phổ biến nhất: kéo nhầm thứ đã đặt đúng"). Nếu hàm luôn trả
 *   true thì cột `daKhoa` mua được số 0 — nó có trong DB, có trong Inspector, và
 *   không chặn được gì.
 */
export function nenGanGizmo(coVatThe: boolean, daKhoa: boolean): boolean {
  return coVatThe && !daKhoa;
}
