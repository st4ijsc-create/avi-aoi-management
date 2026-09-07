/**
 * khungNhin.ts — TOÁN của "Fit all in view" (§11.9 #58) và cổng vào Fullscreen.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G5 — FIT-ALL TRÊN CẢNH RỖNG LUÔN "ĐÚNG"
 * ════════════════════════════════════════════════════════════════════════════
 * Một `fitAll` viết bằng hằng số (`camera.position.set(30, 24, 30)`) chạy xanh
 * trên MỌI test không đo vị trí đích: cảnh rỗng, cảnh một máy, cảnh 42 máy —
 * đều "fit". Đó đúng lớp lỗi G5: cổng xanh trên tập rỗng trùng khít cổng xanh
 * của hệ đúng.
 *
 * Nên module này KHÔNG nhận "cảnh" mà nhận **BBox thật của nội dung**, và trả
 * về vị trí camera + tâm ngắm **suy ra từ bbox đó**. Test đặt vật ở vị trí biết
 * trước rồi assert camera tới đúng chỗ — sai một hằng là đỏ ngay.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BẪY HOÁN VỊ TRỤC — Y CỦA SCENE LÀ ĐỘ CAO
 * ════════════════════════════════════════════════════════════════════════════
 * `heToaDo.ts` quy ước: `scene.y = viTriZMm/1000` (ĐỘ CAO), `scene.z =
 * viTriYMm/1000` (mặt bằng). Mọi BBox mà module này nhận đã ở **hệ SCENE, đơn
 * vị MÉT** — người gọi quy đổi bằng `bboxMmSangScene` trước.
 *
 * Hệ quả cụ thể: mặt sàn trải trên **X–Z**, chiều cao là **Y**. Camera nhìn
 * xuống nên nó phải nâng theo **Y** và lùi theo **Z**. Viết nhầm thành nâng
 * theo Z thì camera chui vào trong sàn và **không có gì nổ** — cảnh chỉ tối đi.
 * Test `fit-nang-theo-truc-Y-khong-phai-Z` canh đúng chỗ này.
 *
 * ★ Module THUẦN: không three, không react, không DOM (trừ `laFullscreen`/
 *   `doiFullscreen` nhận phần tử vào — chúng nhận `Element | null` và tự thủ
 *   khi API vắng mặt, nên vẫn chạy trong vitest environment "node").
 * ★ Tất định: không Math.random(), không Date.now().
 */

import {
  bboxCoThuc,
  bboxTuTamVaKichThuoc,
  gopNhieuBBox,
  kichThuocBBox,
  mmSangMet,
  tamBBox,
  type BBox,
  type DiemScene,
} from "../heToaDo";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Hằng số                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Đệm quanh nội dung khi fit — 12 % bán kính.
 *
 * Không phải số trang trí: fit khít mép làm vật ngoài cùng chạm đúng biên
 * khung nhìn, và mọi sai số làm tròn của projection đẩy nó ra ngoài. 12 % là
 * đủ để nhìn thấy "đây là toàn bộ" mà không phí nửa khung.
 */
export const HE_SO_DEM_FIT = 1.12;

/**
 * Hướng nhìn mặc định của fit-all — isometric-ish, nhìn từ trên-trước-phải.
 * Đây là hướng mà `CanhThietKe` đã đặt camera lúc mở màn, nên bấm "Fit" không
 * làm người dùng mất phương hướng.
 *
 * Vector đã CHUẨN HOÁ sẵn (kiểm bằng test) — nhân với khoảng cách là ra vị trí.
 */
export const HUONG_NHIN_MAC_DINH: DiemScene = (() => {
  const v = { x: 0.55, y: 0.62, z: 0.85 };
  const d = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return { x: v.x / d, y: v.y / d, z: v.z / d };
})();

/** Khoảng cách camera tối thiểu (mét) — cảnh một điểm vẫn phải nhìn thấy gì đó. */
export const KHOANG_CACH_TOI_THIEU_M = 3;

/** Bán kính tối thiểu (mét) khi bbox suy biến thành một điểm. */
export const BAN_KINH_TOI_THIEU_M = 1.5;

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Kiểu                                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Một vật thể có mặt trong phép fit — vị trí ĐÁY (mét) + kích thước (mm). */
export interface VatTheTrongKhung {
  /** Tâm mặt bằng + đáy, hệ SCENE, đơn vị mét. */
  viTri: { x: number; y: number; z: number };
  /** Kích thước hộp bao, đơn vị MILIMÉT (như DB). */
  kichThuocMm: { rongMm: number; caoMm: number; sauMm: number };
}

/** Kết quả fit: đặt camera ở `viTri`, ngắm vào `ngam`. */
export interface KhungNhin {
  viTri: DiemScene;
  ngam: DiemScene;
  /** Khoảng cách từ camera tới tâm (mét) — để người gọi đặt `maxDistance`. */
  khoangCach: number;
  /** Bán kính hình cầu bao nội dung (mét). */
  banKinh: number;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* BBox của nội dung — ĐO THẬT, không hằng số                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * BBox (hệ scene, mét) của MỘT vật thể đứng trên sàn.
 *
 * `viTri.y` là ĐÁY (quy ước của `MayTrongLo`), nên tâm hộp cao hơn đáy nửa
 * chiều cao. Quên phép cộng này làm bbox nằm nửa dưới sàn và fit-all ngắm thấp
 * hơn nội dung thật — sai lệch âm thầm, không lỗi nào nổ.
 */
export function bboxVatThe(v: VatTheTrongKhung): BBox {
  const rong = mmSangMet(v.kichThuocMm.rongMm);
  const cao = mmSangMet(v.kichThuocMm.caoMm);
  const sau = mmSangMet(v.kichThuocMm.sauMm);
  return bboxTuTamVaKichThuoc(
    { x: v.viTri.x, y: v.viTri.y + cao / 2, z: v.viTri.z },
    { rong, cao, sau },
  );
}

/**
 * BBox bao TOÀN BỘ nội dung. Danh sách rỗng cho ra bbox rỗng (`bboxCoThuc`
 * false) — người gọi phải xử lý, KHÔNG được coi là "fit xong".
 */
export function bboxNoiDung(ds: readonly VatTheTrongKhung[]): BBox {
  return gopNhieuBBox(ds.map(bboxVatThe));
}

/**
 * BBox của mặt sàn — phương án DỰ PHÒNG khi chưa có vật thể nào.
 *
 * ★ Cố ý là một hàm RIÊNG, không trộn vào `bboxNoiDung`: nếu fit-all tự lặng lẽ
 *   lùi về sàn khi danh sách rỗng thì test "fit trên cảnh rỗng" sẽ XANH mà
 *   không chứng minh gì về cảnh có vật — đúng bẫy G5. Người gọi phải chọn
 *   tường minh, và `fitTatCa` trả `null` cho tập rỗng để buộc điều đó.
 */
export function bboxSan(rongM: number, sauM: number): BBox {
  return {
    minX: 0,
    minY: 0,
    minZ: 0,
    maxX: Math.max(rongM, 0),
    maxY: 0,
    maxZ: Math.max(sauM, 0),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Fit                                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Bán kính hình cầu bao bbox (mét). Nửa đường chéo — phép bao chặt nhất mà
 * không phụ thuộc hướng nhìn.
 */
export function banKinhBao(b: BBox): number {
  if (!bboxCoThuc(b)) return 0;
  const k = kichThuocBBox(b);
  const nua = Math.sqrt(k.rong * k.rong + k.cao * k.cao + k.sau * k.sau) / 2;
  return Math.max(nua, BAN_KINH_TOI_THIEU_M);
}

/**
 * Khoảng cách camera cần lùi để hình cầu bán kính `banKinh` lọt trọn khung nhìn
 * phối cảnh có `fovDo` (dọc) và tỉ lệ khung `tiLeKhung` = rộng/cao.
 *
 * ★★★ FOV NGANG LÀ RÀNG BUỘC CHẶT HƠN KHI KHUNG HẸP.
 *   three chỉ khai `camera.fov` là fov DỌC. Khung 3D của màn Thiết kế nằm giữa
 *   hai panel co giãn được — người dùng kéo hẹp lại thì fov ngang tụt xuống
 *   dưới fov dọc, và một phép fit chỉ tính fov dọc sẽ CẮT hai bên mà vẫn báo
 *   "đã fit". Lấy `min` của hai khoảng cách-cần-lùi là điều kiện đủ cho cả hai
 *   chiều, nên phải lấy `max`.
 *
 * `tiLeKhung <= 0` hoặc không hữu hạn ⇒ coi như vuông (1), vì `clientWidth`
 * bằng 0 lúc panel chưa đo xong là chuyện bình thường, không phải lỗi.
 */
export function khoangCachFit(banKinh: number, fovDo: number, tiLeKhung: number): number {
  const r = Math.max(banKinh, 0) * HE_SO_DEM_FIT;
  if (r === 0) return KHOANG_CACH_TOI_THIEU_M;
  const fov = Number.isFinite(fovDo) && fovDo > 0 && fovDo < 180 ? fovDo : 45;
  const tiLe = Number.isFinite(tiLeKhung) && tiLeKhung > 0 ? tiLeKhung : 1;

  const nuaFovDoc = ((fov / 2) * Math.PI) / 180;
  const dDoc = r / Math.sin(nuaFovDoc);
  // fov ngang suy từ fov dọc và tỉ lệ khung — công thức của three (`Camera.
  // setViewOffset` dùng cùng quan hệ): tan(hNgang/2) = tan(hDoc/2) * aspect.
  const nuaFovNgang = Math.atan(Math.tan(nuaFovDoc) * tiLe);
  const dNgang = r / Math.sin(nuaFovNgang);

  return Math.max(dDoc, dNgang, KHOANG_CACH_TOI_THIEU_M);
}

/**
 * Khung nhìn fit một BBox cho trước. Trả `null` khi bbox không có thực —
 * "không có gì để fit" là một câu trả lời, không phải một vị trí camera.
 */
export function fitBBox(
  b: BBox,
  fovDo: number,
  tiLeKhung: number,
  huong: DiemScene = HUONG_NHIN_MAC_DINH,
): KhungNhin | null {
  if (!bboxCoThuc(b)) return null;
  const ngam = tamBBox(b);
  const banKinh = banKinhBao(b);
  const khoangCach = khoangCachFit(banKinh, fovDo, tiLeKhung);

  // Chuẩn hoá hướng tại chỗ: người gọi truyền hướng chưa chuẩn hoá thì khoảng
  // cách thật sẽ SAI theo đúng độ dài vector đó — một lỗi tỉ lệ câm.
  const d = Math.sqrt(huong.x * huong.x + huong.y * huong.y + huong.z * huong.z);
  const u = d > 0 ? { x: huong.x / d, y: huong.y / d, z: huong.z / d } : HUONG_NHIN_MAC_DINH;

  return {
    ngam,
    banKinh,
    khoangCach,
    viTri: {
      x: ngam.x + u.x * khoangCach,
      // ★ TRỤC ĐỨNG LÀ Y (xem docblock đầu tệp). Nâng theo Z là camera chui sàn.
      y: ngam.y + u.y * khoangCach,
      z: ngam.z + u.z * khoangCach,
    },
  };
}

/**
 * Fit toàn bộ vật thể. **Trả `null` khi danh sách rỗng** — người gọi quyết định
 * có lùi về mặt sàn hay không (xem docblock `bboxSan`, luật G5).
 */
export function fitTatCa(
  ds: readonly VatTheTrongKhung[],
  fovDo: number,
  tiLeKhung: number,
  huong: DiemScene = HUONG_NHIN_MAC_DINH,
): KhungNhin | null {
  if (ds.length === 0) return null;
  return fitBBox(bboxNoiDung(ds), fovDo, tiLeKhung, huong);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Fullscreen (§11.9 #58, nửa sau)                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Hình dạng tối thiểu của API fullscreen mà module này dùng. Khai tường minh
 * thay vì `any`: Safari cũ chỉ có bản `webkit*`, và một `document.exitFullscreen`
 * gọi thẳng sẽ ném `TypeError` ở đó — nút "thoát toàn màn hình" chết im.
 */
export interface CongFullscreen {
  phanTuDangFullscreen: Element | null;
  vao: (el: Element) => Promise<void> | void;
  ra: () => Promise<void> | void;
  /** false = trình duyệt/môi trường không có Fullscreen API (jsdom, node). */
  coHoTro: boolean;
}

type DocFullscreen = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type ElFullscreen = Element & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/**
 * Đọc cổng fullscreen từ một `Document`. Nhận document làm THAM SỐ (không đọc
 * biến toàn cục) để test dựng được document giả và đo cả nhánh "không hỗ trợ" —
 * nhánh mà `typeof document === "undefined"` sẽ giấu đi.
 */
export function congFullscreen(doc: Document | null | undefined): CongFullscreen {
  if (!doc) {
    return { phanTuDangFullscreen: null, vao: () => {}, ra: () => {}, coHoTro: false };
  }
  const d = doc as DocFullscreen;
  const coHoTro =
    typeof d.exitFullscreen === "function" || typeof d.webkitExitFullscreen === "function";
  return {
    phanTuDangFullscreen: d.fullscreenElement ?? d.webkitFullscreenElement ?? null,
    coHoTro,
    vao: (el: Element) => {
      const e = el as ElFullscreen;
      if (typeof e.requestFullscreen === "function") return e.requestFullscreen();
      if (typeof e.webkitRequestFullscreen === "function") return e.webkitRequestFullscreen();
    },
    ra: () => {
      if (typeof d.exitFullscreen === "function") return d.exitFullscreen();
      if (typeof d.webkitExitFullscreen === "function") return d.webkitExitFullscreen();
    },
  };
}

/**
 * Bật/tắt fullscreen cho `el`. Trả về hành động ĐÃ chạy để người gọi ghi log và
 * để test đo được — một hàm `void` ở đây sẽ không phân biệt được "đã vào" với
 * "trình duyệt không hỗ trợ nên không làm gì".
 */
export function doiFullscreen(
  el: Element | null,
  cong: CongFullscreen,
): "vao" | "ra" | "khong-ho-tro" {
  if (!cong.coHoTro || !el) return "khong-ho-tro";
  if (cong.phanTuDangFullscreen === el) {
    void cong.ra();
    return "ra";
  }
  void cong.vao(el);
  return "vao";
}
