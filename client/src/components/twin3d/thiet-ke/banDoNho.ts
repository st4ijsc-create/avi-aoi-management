/**
 * banDoNho.ts — TOÁN của mini-map click-to-navigate (§11.9 #56).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BẪY HOÁN VỊ TRỤC — MINI-MAP LÀ HÌNH CHIẾU X–Z, KHÔNG PHẢI X–Y
 * ════════════════════════════════════════════════════════════════════════════
 * Mini-map nhìn thẳng từ trên xuống. Trong hệ scene của repo (`heToaDo.ts`)
 * trục ĐỨNG là **Y**, nên mặt sàn trải trên **X–Z**:
 *
 *      màn hình px.x  ←  scene.x     (Đông, sang phải)
 *      màn hình px.y  ←  scene.z     (mặt bằng, xuống dưới)
 *      scene.y                        ← BỎ QUA (độ cao)
 *
 * Chiếu nhầm X–Y sẽ cho một mini-map **dẹt gần như một đường** (mọi máy có
 * `y ≈ 0..2 m` trong khi sàn dài 38 m) — và **không gì nổ**: nó vẫn vẽ, vẫn
 * click được, camera vẫn nhảy, chỉ nhảy sai chỗ. Test
 * `chieu-bo-truc-DUNG-Y-khong-phai-Z` canh đúng chỗ này bằng hai máy chỉ khác
 * nhau ở độ cao: chúng PHẢI chồng lên nhau trên mini-map.
 *
 * ★ Không lật trục dọc: trong hệ DB, `viTriYMm` hướng **XUỐNG** mặt bằng (quy
 *   ước ảnh/CAD, xem `heToaDo.ts`), và `scene.z = viTriYMm/1000`. Nên
 *   `scene.z` tăng = đi xuống trong bản vẽ = đi xuống trên mini-map. Trùng
 *   chiều px.y của DOM ⇒ KHÔNG có phép lật nào cả. Thêm một phép lật "cho
 *   chắc" là làm mini-map thành ảnh gương của cảnh.
 *
 * ★ Module THUẦN: không three, không react, không DOM. Tất định.
 */

import { bboxCoThuc, kichThuocBBox, type BBox, type DiemScene } from "../heToaDo";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Hằng số                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Cạnh mini-map (px CSS). Góc dưới phải canvas theo §11.9 #56. */
export const CANH_BAN_DO_PX = 148;

/** Đệm trong mini-map (px) để chấm ở mép không bị cắt nửa. */
export const DEM_BAN_DO_PX = 8;

/** Bán kính chấm máy (px). */
export const BAN_KINH_CHAM_PX = 2.5;

/** ★ Đợt 45 (mục 5) — cạnh mini-map NHỎ NHẤT còn đọc được (px). */
export const CANH_BAN_DO_TOI_THIEU_PX = 88;
/** ★ Đợt 45 (mục 5) — mini-map chiếm tối đa tỉ lệ này của CẠNH NGẮN vùng cảnh. */
export const TI_LE_BAN_DO_TREN_KHUNG = 0.4;

/**
 * ★★★ ĐỢT 45 (mục 5) — CẠNH MINI-MAP THEO VÙNG CẢNH THẬT.
 * QA Đợt 44 @1280 (D-7 mục 10/14): vùng cảnh 541×193 mà mini-map 148 (+viền) = 82 % chiều cao,
 * đè lên ba nút công cụ góc trên-phải. Cạnh = clamp(88, 40 % cạnh ngắn vùng, 148); chưa đo được
 * (0/NaN — jsdom, khung hình đầu) ⇒ 148 như cũ. SVG giữ `viewBox` 148 nên toạ độ chấm/phép chiếu
 * KHÔNG đổi; chỉ kích thước CSS đổi, và `pxTuChuot` đã chuẩn hoá theo `getBoundingClientRect`.
 */
export function canhBanDoTheoKhung(rongPx: number, caoPx: number, canhMax: number = CANH_BAN_DO_PX): number {
  if (!(rongPx > 0) || !(caoPx > 0) || !Number.isFinite(rongPx) || !Number.isFinite(caoPx)) return canhMax;
  const theoKhung = Math.floor(Math.min(rongPx, caoPx) * TI_LE_BAN_DO_TREN_KHUNG);
  return Math.max(CANH_BAN_DO_TOI_THIEU_PX, Math.min(canhMax, theoKhung));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Kiểu                                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Điểm trên mặt phẳng mini-map, đơn vị px, gốc ở góc trên-trái. */
export interface DiemPx {
  px: number;
  py: number;
}

/**
 * Phép chiếu hai chiều giữa mặt sàn (scene, mét) và mini-map (px).
 * `tiLe` là px trên mỗi mét — giữ lại để vẽ thước và để test đối chiếu.
 */
export interface PhepChieu {
  tiLe: number;
  /** Gốc chiếu — điểm scene rơi vào (DEM, DEM) của mini-map. */
  gocX: number;
  gocZ: number;
  rongPx: number;
  caoPx: number;
}

/** Một chấm trên mini-map. */
export interface ChamBanDo {
  khoa: string;
  px: number;
  py: number;
  mau: string;
  chon: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Phép chiếu                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Dựng phép chiếu vừa khít `vung` (bbox scene, mét) vào một ô vuông `canhPx`.
 *
 * ★ MỘT tỉ lệ cho CẢ HAI trục (lấy `min`) — không co giãn phi tỉ lệ. Dùng hai
 *   tỉ lệ riêng thì mini-map luôn lấp đầy ô, trông "đẹp hơn", nhưng hình dạng
 *   nhà xưởng bị bóp: một xưởng 38×30 m hiện thành vuông, và người dùng ước
 *   lượng khoảng cách sai trên chính công cụ dùng để định vị.
 *
 * Vùng suy biến (rộng hoặc sâu = 0) vẫn cho tỉ lệ hữu hạn: `Math.max(…, 1e-6)`
 * chặn chia 0, vốn sẽ cho `Infinity` rồi `NaN` — và một chấm ở toạ độ NaN biến
 * mất khỏi SVG mà không có lỗi nào.
 */
export function dungPhepChieu(vung: BBox, canhPx: number = CANH_BAN_DO_PX): PhepChieu {
  const canh = Number.isFinite(canhPx) && canhPx > 0 ? canhPx : CANH_BAN_DO_PX;
  const trong = Math.max(canh - DEM_BAN_DO_PX * 2, 1);
  if (!bboxCoThuc(vung)) {
    return { tiLe: 1, gocX: 0, gocZ: 0, rongPx: canh, caoPx: canh };
  }
  const k = kichThuocBBox(vung);
  const rong = Math.max(k.rong, 1e-6);
  const sau = Math.max(k.sau, 1e-6);
  const tiLe = Math.min(trong / rong, trong / sau);
  return { tiLe, gocX: vung.minX, gocZ: vung.minZ, rongPx: canh, caoPx: canh };
}

/**
 * Scene (mét) → mini-map (px). **Bỏ `diem.y`** — nó là độ cao (xem docblock
 * đầu tệp).
 */
export function sceneSangPx(diem: DiemScene, chieu: PhepChieu): DiemPx {
  return {
    px: DEM_BAN_DO_PX + (diem.x - chieu.gocX) * chieu.tiLe,
    py: DEM_BAN_DO_PX + (diem.z - chieu.gocZ) * chieu.tiLe,
  };
}

/**
 * Mini-map (px) → scene (mét). Nghịch đảo chính xác của {@link sceneSangPx};
 * `y` trả về **0** vì mini-map không mang thông tin độ cao — và trả 0 là lời
 * khai đúng, khác hẳn với đoán một độ cao nào đó.
 */
export function pxSangScene(diem: DiemPx, chieu: PhepChieu): DiemScene {
  const tiLe = chieu.tiLe > 0 ? chieu.tiLe : 1;
  return {
    x: chieu.gocX + (diem.px - DEM_BAN_DO_PX) / tiLe,
    y: 0,
    z: chieu.gocZ + (diem.py - DEM_BAN_DO_PX) / tiLe,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Click-to-navigate                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Toạ độ click trong hệ px của mini-map, từ toạ độ chuột và hộp bao phần tử.
 *
 * ★ Trừ `rect.left/top` chứ KHÔNG dùng `offsetX/offsetY`: `offset*` tính theo
 *   phần tử **nhận sự kiện**, nên click trúng một `<circle>` con cho toạ độ
 *   trong hệ của circle đó, và mọi cú click vào một chấm sẽ nhảy về cùng một
 *   chỗ. Đây là lỗi đã cắn `FactoryLiveMap3D` — xem `locNhan.ts` cùng họ.
 */
export function pxTuChuot(
  chuot: { clientX: number; clientY: number },
  hop: { left: number; top: number; width: number; height: number },
  canhPx: number = CANH_BAN_DO_PX,
): DiemPx {
  // Phần tử có thể được CSS co giãn khác kích thước logic của SVG viewBox.
  const heSoX = hop.width > 0 ? canhPx / hop.width : 1;
  const heSoY = hop.height > 0 ? canhPx / hop.height : 1;
  return {
    px: (chuot.clientX - hop.left) * heSoX,
    py: (chuot.clientY - hop.top) * heSoY,
  };
}

/**
 * Điểm SCENE mà một cú click trên mini-map trỏ tới — **cái mà camera phải bay
 * tới**. Kẹp vào trong `vung` để click ngoài mép (vào phần đệm) không đẩy
 * camera ra khỏi nhà xưởng.
 */
export function diemNgamTuClick(
  chuot: { clientX: number; clientY: number },
  hop: { left: number; top: number; width: number; height: number },
  chieu: PhepChieu,
  vung: BBox,
): DiemScene {
  const p = pxSangScene(pxTuChuot(chuot, hop, chieu.rongPx), chieu);
  if (!bboxCoThuc(vung)) return p;
  return {
    x: Math.min(Math.max(p.x, vung.minX), vung.maxX),
    y: 0,
    z: Math.min(Math.max(p.z, vung.minZ), vung.maxZ),
  };
}

/**
 * Dời camera sao cho nó NGẮM vào `ngamMoi` mà **giữ nguyên hướng và khoảng
 * cách** hiện tại.
 *
 * ★★★ ĐÂY LÀ ĐIỀU KHIẾN "CLICK ĐỂ ĐI TỚI" DÙNG ĐƯỢC.
 *   Cách làm ngây thơ — đặt `camera.position = ngamMoi` — nhét camera vào ngay
 *   giữa đám máy, và người dùng thấy màn hình đầy mặt trong của một cái hộp.
 *   Cách thứ hai — chỉ đổi `controls.target` — làm camera QUAY tại chỗ chứ
 *   không ĐI, nên click vào góc xa của bản đồ gần như không đổi gì.
 *   Đúng là **tịnh tiến cả cặp (camera, target)** theo cùng một vector.
 */
export function camDiToi(
  viTriCam: DiemScene,
  ngamCu: DiemScene,
  ngamMoi: DiemScene,
): { viTri: DiemScene; ngam: DiemScene } {
  const dx = ngamMoi.x - ngamCu.x;
  const dz = ngamMoi.z - ngamCu.z;
  // Chỉ tịnh tiến trên MẶT BẰNG: mini-map không mang độ cao, nên đổi `y` là bịa
  // ra một con số người dùng không hề chỉ định.
  return {
    viTri: { x: viTriCam.x + dx, y: viTriCam.y, z: viTriCam.z + dz },
    ngam: { x: ngamMoi.x, y: ngamCu.y, z: ngamMoi.z },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Chấm                                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Dựng danh sách chấm để vẽ. Giữ nguyên thứ tự đầu vào (vẽ chồng ổn định). */
export function dungCham(
  ds: readonly { khoa: string; viTri: DiemScene; mau: string; chon?: boolean }[],
  chieu: PhepChieu,
): ChamBanDo[] {
  return ds.map((v) => {
    const p = sceneSangPx(v.viTri, chieu);
    return { khoa: v.khoa, px: p.px, py: p.py, mau: v.mau, chon: v.chon === true };
  });
}
