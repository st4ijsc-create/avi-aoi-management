/**
 * hinhKhoiMay.ts — Bảy hình khối mặc định phủ 25+ loại máy (§10B.1).
 *
 * `machineTypeEnum` có 24 giá trị (đo được trên `drizzle/schema/enums.ts` ngày
 * 2026-09-06), nhưng không cần 24 hình khối. Bảy hình đủ để phân biệt bằng mắt ở
 * khoảng cách vận hành, mỗi hình khoảng 40-60 tam giác.
 *
 * ★ Module THUẦN DỮ LIỆU: KHÔNG import three.js, KHÔNG import react, KHÔNG import
 *   drizzle (drizzle kéo pg-core vào bundle trình duyệt). Hàm trả về MÔ TẢ hình
 *   học — danh sách hộp con với vị trí + kích thước TƯƠNG ĐỐI. Component .tsx
 *   dịch mô tả này sang BoxGeometry của three sau. Nhờ vậy test chạy được trong
 *   environment "node".
 *
 * ★ Tất định: không Math.random(), không Date.now().
 *
 * ★ Danh sách loại máy KHÔNG được sao chép vào module này. Bánh cóc nằm ở
 *   `hinhKhoiMay.unit.test.ts`: test import THẲNG `machineTypeEnum` từ
 *   `drizzle/schema/enums.ts` (nguồn sự thật) và đòi MỌI giá trị ánh xạ được.
 *   Thêm loại máy mới mà quên cập nhật bảng dưới đây thì test ĐỎ.
 */

import { mmSangMet } from "./heToaDo";

/** Bảy khối mặc định. Không có khối thứ tám. */
export type KhoiKey =
  | "buong_kiem_quang"
  | "ban_test"
  | "may_gap_dat"
  | "lo_nhiet"
  | "may_in_phun"
  | "canh_tay_robot"
  | "tram_chung";

/** Bảy khối, thứ tự cố định — dùng cho legend UI và cho test phủ. */
export const DANH_SACH_KHOI: readonly KhoiKey[] = [
  "buong_kiem_quang",
  "ban_test",
  "may_gap_dat",
  "lo_nhiet",
  "may_in_phun",
  "canh_tay_robot",
  "tram_chung",
] as const;

/** Kích thước THẬT của máy, milimét — lấy từ `twin_dat_cho.rongMm/caoMm/sauMm`. */
export interface KichThuocMm {
  rongMm: number;
  caoMm: number;
  sauMm: number;
}

/**
 * Vai trò thị giác của một hộp con. Component .tsx tra bảng này để chọn vật liệu
 * (§10.1 ISA-101: xám là mặc định, màu chỉ dành cho bất thường và chỉ báo hướng).
 */
export type VaiTroHop =
  | "than" // thân máy chính
  | "phu" // bộ phận phụ (nắp buồng, ống khói, khung in, đồ gá...)
  | "cua" // cửa băng tải / khe vào-ra phôi
  | "vach_huong"; // ★ vạch chỉ hướng mặt trước — đúng MỘT hộp mỗi khối

/**
 * Một hộp con trong mô tả hình học. Mọi số đo là TƯƠNG ĐỐI, trong khoảng [-0.5, 0.5]
 * cho tâm và (0, 1] cho kích thước, so với hộp bao của máy:
 *   - trục x: bề RỘNG máy  (rongMm)
 *   - trục y: bề CAO máy   (caoMm), y = -0.5 là mặt sàn, y = +0.5 là đỉnh
 *   - trục z: bề SÂU máy   (sauMm), z = +0.5 là MẶT TRƯỚC (mặt vào phôi)
 * Component .tsx nhân với kích thước thật (đã đổi sang mét qua `heToaDo.ts`).
 */
export interface HopCon {
  /** Định danh ổn định trong khối — dùng làm React key, không phải để hiển thị. */
  ten: string;
  vaiTro: VaiTroHop;
  /** Tâm hộp con, tương đối với tâm hộp bao máy. */
  tam: { x: number; y: number; z: number };
  /** Kích thước hộp con, tỉ lệ so với hộp bao máy. */
  co: { x: number; y: number; z: number };
}

/** Mô tả hình học thuần dữ liệu của một khối, đã co giãn theo kích thước thật. */
export interface MoTaKhoi {
  khoi: KhoiKey;
  /** Kích thước thật (mm) đã dùng để co giãn — sau khi kẹp về ngưỡng hợp lệ. */
  kichThuocMm: KichThuocMm;
  /** Kích thước thật quy đổi sang MÉT, sẵn sàng cho scene (§5.2). */
  kichThuocMet: { rong: number; cao: number; sau: number };
  /** Danh sách hộp con, tất định theo thứ tự. */
  hopCon: HopCon[];
  /** Tổng tam giác ước tính: 12 tam giác mỗi hộp (hộp = 6 mặt × 2). */
  soTamGiacUocTinh: number;
}

/**
 * Kích thước mặc định khi máy chưa được đo (NT-4: số giả định phải tự khai).
 * Người gọi vẫn phải gắn badge "chưa đo" — module này không biết `nguon`.
 */
export const KICH_THUOC_MAC_DINH: KichThuocMm = {
  rongMm: 1400,
  caoMm: 1600,
  sauMm: 1200,
};

/** Ngưỡng chặn kích thước phi lý (mm). Dưới 1mm hoặc trên 100m là dữ liệu rác. */
export const KICH_THUOC_TOI_THIEU_MM = 1;
export const KICH_THUOC_TOI_DA_MM = 100_000;

/**
 * Bảng ánh xạ loại máy sang khối. KHÔNG phải bản sao của enum — chỉ là các
 * trường hợp KHÔNG rơi vào `tram_chung`. Mọi loại vắng mặt ở đây (kể cả loại
 * thêm sau) rơi vào `tram_chung`, nên `hinhKhoiCho` không bao giờ trả `undefined`.
 *
 * Nguồn: spec §10B.1 bảng 7 hàng.
 * Các loại rơi vào `tram_chung` theo dòng "còn lại" của spec (đo trên enum
 * 2026-09-06): ASSEMBLY, PACKAGING, AUTOMATION, IOT_SENSOR, IOT_GATEWAY.
 */
const ANH_XA_LOAI_MAY: Readonly<Record<string, KhoiKey>> = Object.freeze({
  // Buồng kiểm quang — hộp + nắp buồng camera nhô lên + cửa băng tải hai đầu
  AOI: "buong_kiem_quang",
  AVI: "buong_kiem_quang",
  SPI: "buong_kiem_quang",
  AXI: "buong_kiem_quang",
  // Bàn test — hộp thấp + mặt bàn + trụ đồ gá
  ICT: "ban_test",
  FCT: "ban_test",
  ICT_FUNC: "ban_test",
  CMM: "ban_test",
  ROBOT_TEST: "ban_test",
  // Máy gắp đặt — hộp dài + dàn feeder răng lược một bên
  MOUNTER: "may_gap_dat",
  FEEDER: "may_gap_dat",
  // Lò / buồng nhiệt — hộp rất dài + ống khói + băng tải xuyên tâm
  REFLOW: "lo_nhiet",
  WAVE_SOLDER: "lo_nhiet",
  // Máy in / phun — hộp + khung in phía trên + ray ngang
  STENCIL_PRINTER: "may_in_phun",
  DISPENSING: "may_in_phun",
  SCREWDRIVE: "may_in_phun",
  // Cánh tay robot — đế trụ + 3 khúc khớp
  ROBOT: "canh_tay_robot",
  PALLETIZER: "canh_tay_robot",
  WELDER: "canh_tay_robot",
});

/** Khối dùng khi loại máy không có mục riêng — luôn tồn tại, không undefined. */
export const KHOI_MAC_DINH: KhoiKey = "tram_chung";

/**
 * Ánh xạ một giá trị `machineTypeEnum` sang một trong bảy khối.
 *
 * Toàn phần theo thiết kế: mọi chuỗi đều ra một khối, loại lạ ra `tram_chung`.
 * So khớp KHÔNG phân biệt hoa thường và bỏ khoảng trắng thừa, vì dữ liệu di trú
 * từ hai hệ cũ (§5.1) không đảm bảo viết hoa đồng nhất.
 * Chuỗi rỗng / null / undefined cũng ra `tram_chung` — "không có dữ liệu" không
 * được ném lỗi giữa vòng render (NT-3 xử lý ở tầng UI bằng badge, không ở đây).
 */
export function hinhKhoiCho(loaiMay: string | null | undefined): KhoiKey {
  if (typeof loaiMay !== "string") return KHOI_MAC_DINH;
  const khoa = loaiMay.trim().toUpperCase();
  if (khoa === "") return KHOI_MAC_DINH;
  return ANH_XA_LOAI_MAY[khoa] ?? KHOI_MAC_DINH;
}

/** Loại máy này có mục ánh xạ RIÊNG (không rơi vào `tram_chung` do thiếu sót)? */
export function coAnhXaRieng(loaiMay: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    ANH_XA_LOAI_MAY,
    loaiMay.trim().toUpperCase(),
  );
}

/**
 * ★★★ DANH SÁCH LOẠI MÁY ĐÃ ĐƯỢC PHÂN LOẠI CÓ Ý THỨC vào `tram_chung`.
 *
 * Vì sao cần: `hinhKhoiCho` TOÀN PHẦN theo thiết kế — loại lạ rơi về `tram_chung`
 * nên KHÔNG BAO GIỜ trả `undefined`. Nghĩa là một bánh cóc chỉ kiểm "0 giá trị
 * undefined" luôn XANH kể cả khi thêm loại máy mới — nó đo một tính chất mà mã
 * bảo đảm về cấu trúc, không đo thứ thực sự quan trọng. (Đo được: thêm một giá
 * trị giả vào `machineTypeEnum` thì bánh cóc kiểu đó vẫn 51/51 xanh.)
 *
 * Thứ thực sự quan trọng là: **mọi loại máy trong enum đã được NGƯỜI quyết định
 * thuộc khối nào** — hoặc có mục trong {@link ANH_XA_LOAI_MAY}, hoặc có tên ở
 * đây. Thêm loại mới mà không đụng một trong hai danh sách ⇒ test ĐỎ.
 *
 * Nguồn: spec §10B.1, dòng "Trạm chung | ASSEMBLY, PACKAGING, AUTOMATION, còn lại".
 * IOT_SENSOR/IOT_GATEWAY không có trong bảng 7 hàng của spec; xếp `tram_chung`
 * theo dòng "còn lại" — đây là quyết định của phiên này, ghi rõ để không im lặng.
 */
export const LOAI_MAY_VE_TRAM_CHUNG: readonly string[] = Object.freeze([
  "ASSEMBLY",
  "PACKAGING",
  "AUTOMATION",
  "IOT_SENSOR",
  "IOT_GATEWAY",
]);

/**
 * Loại máy này đã được phân loại CÓ Ý THỨC chưa (dù vào khối riêng hay vào
 * `tram_chung`)? Trả `false` nghĩa là loại máy mới chưa ai quyết định — đây mới
 * là điều kiện đỏ của bánh cóc, không phải `undefined`.
 */
export function daPhanLoaiCoYThuc(loaiMay: string): boolean {
  const khoa = loaiMay.trim().toUpperCase();
  return coAnhXaRieng(khoa) || LOAI_MAY_VE_TRAM_CHUNG.includes(khoa);
}

// ---------------------------------------------------------------------------
// Hình học từng khối — hình dạng CỐ ĐỊNH, tỉ lệ co giãn theo số đo thật
// ---------------------------------------------------------------------------

/**
 * Vạch chỉ hướng ở mặt trước (§10B.1). Không có nó thì máy xoay 180° trông y hệt
 * và người dùng không phát hiện hướng sai. Đúng MỘT vạch mỗi khối, luôn ở z dương.
 */
function vachHuong(caoTuongDoi: number): HopCon {
  return {
    ten: "vach-huong",
    vaiTro: "vach_huong",
    tam: { x: 0, y: caoTuongDoi, z: 0.5 },
    co: { x: 0.6, y: 0.05, z: 0.02 },
  };
}

/** Hộp thân chính chiếm phần dưới của hộp bao. */
function than(cao: number, yTam: number, ten = "than"): HopCon {
  return {
    ten,
    vaiTro: "than",
    tam: { x: 0, y: yTam, z: 0 },
    co: { x: 1, y: cao, z: 1 },
  };
}

/** Sinh danh sách hộp con cho từng khối. Thuần hằng số, không nhánh ngẫu nhiên. */
function hopConCuaKhoi(khoi: KhoiKey): HopCon[] {
  switch (khoi) {
    case "buong_kiem_quang":
      // Hộp + nắp buồng camera nhô lên + cửa băng tải hai đầu.
      return [
        than(0.72, -0.14),
        {
          ten: "nap-buong-camera",
          vaiTro: "phu",
          tam: { x: 0, y: 0.36, z: 0 },
          co: { x: 0.62, y: 0.28, z: 0.62 },
        },
        {
          ten: "cua-vao",
          vaiTro: "cua",
          tam: { x: -0.5, y: -0.05, z: 0 },
          co: { x: 0.06, y: 0.22, z: 0.5 },
        },
        {
          ten: "cua-ra",
          vaiTro: "cua",
          tam: { x: 0.5, y: -0.05, z: 0 },
          co: { x: 0.06, y: 0.22, z: 0.5 },
        },
        vachHuong(-0.05),
      ];

    case "ban_test":
      // Hộp thấp + mặt bàn + trụ đồ gá (cổng chữ U gộp thành 2 hộp để giữ
      // ngân sách 40-60 tam giác: hai trụ + dầm ngang vẽ bằng 1 khung).
      return [
        than(0.5, -0.25),
        {
          ten: "mat-ban",
          vaiTro: "phu",
          tam: { x: 0, y: 0.03, z: 0 },
          co: { x: 1.04, y: 0.06, z: 1.04 },
        },
        {
          ten: "tru-do-ga",
          vaiTro: "phu",
          tam: { x: 0, y: 0.26, z: -0.15 },
          co: { x: 0.68, y: 0.4, z: 0.12 },
        },
        {
          ten: "dam-ngang-do-ga",
          vaiTro: "phu",
          tam: { x: 0, y: 0.48, z: -0.15 },
          co: { x: 0.8, y: 0.08, z: 0.16 },
        },
        vachHuong(0.06),
      ];

    case "may_gap_dat":
      // Hộp dài + dàn feeder răng lược MỘT bên (mặt trước, z dương).
      return [
        than(0.8, -0.1),
        {
          ten: "nap-truc-gap",
          vaiTro: "phu",
          tam: { x: 0, y: 0.42, z: -0.1 },
          co: { x: 0.85, y: 0.16, z: 0.55 },
        },
        {
          ten: "dan-feeder",
          vaiTro: "phu",
          tam: { x: -0.1, y: -0.18, z: 0.56 },
          co: { x: 0.74, y: 0.3, z: 0.14 },
        },
        {
          ten: "rang-luoc",
          vaiTro: "phu",
          tam: { x: -0.1, y: 0.02, z: 0.58 },
          co: { x: 0.78, y: 0.06, z: 0.1 },
        },
        vachHuong(0.24),
      ];

    case "lo_nhiet":
      // Hộp rất dài + ống khói + băng tải XUYÊN TÂM (chạy suốt theo trục X).
      return [
        // Thân cao hơn (đã gộp vòm lò vào thân) để giữ ngân sách 40-60 tam giác.
        than(0.9, -0.05),
        {
          ten: "ong-khoi-1",
          vaiTro: "phu",
          tam: { x: -0.22, y: 0.55, z: -0.18 },
          co: { x: 0.1, y: 0.3, z: 0.1 },
        },
        {
          ten: "ong-khoi-2",
          vaiTro: "phu",
          tam: { x: 0.22, y: 0.55, z: -0.18 },
          co: { x: 0.1, y: 0.3, z: 0.1 },
        },
        {
          ten: "bang-tai-xuyen-tam",
          vaiTro: "cua",
          tam: { x: 0, y: -0.02, z: 0 },
          co: { x: 1.12, y: 0.08, z: 0.28 },
        },
        vachHuong(-0.02),
      ];

    case "may_in_phun":
      // Hộp + khung in phía trên + ray ngang.
      return [
        than(0.58, -0.21),
        {
          // Hai cột khung gộp thành một khung chữ U (giữ ngân sách 40-60 tam giác).
          ten: "cot-khung",
          vaiTro: "phu",
          tam: { x: 0, y: 0.24, z: 0 },
          co: { x: 0.94, y: 0.42, z: 0.7 },
        },
        {
          ten: "khung-in-tren",
          vaiTro: "phu",
          tam: { x: 0, y: 0.45, z: 0 },
          co: { x: 0.94, y: 0.12, z: 0.7 },
        },
        {
          ten: "ray-ngang",
          vaiTro: "phu",
          tam: { x: 0, y: 0.18, z: 0.2 },
          co: { x: 0.88, y: 0.07, z: 0.07 },
        },
        vachHuong(0.08),
      ];

    case "canh_tay_robot":
      // Đế trụ + 3 khúc khớp (dùng lại ArticulatedRobot khi có dữ liệu khớp).
      return [
        {
          // Đế + trụ xoay gộp làm một (giữ ngân sách 40-60 tam giác); phần loe
          // của đế thể hiện bằng tỉ lệ rộng, không bằng hộp riêng.
          ten: "de-tru",
          vaiTro: "than",
          tam: { x: 0, y: -0.29, z: 0 },
          co: { x: 0.6, y: 0.42, z: 0.6 },
        },
        {
          ten: "khuc-1",
          vaiTro: "phu",
          tam: { x: 0, y: 0.06, z: 0.02 },
          co: { x: 0.22, y: 0.32, z: 0.22 },
        },
        {
          ten: "khuc-2",
          vaiTro: "phu",
          tam: { x: 0.1, y: 0.3, z: 0.12 },
          co: { x: 0.2, y: 0.2, z: 0.42 },
        },
        {
          ten: "khuc-3",
          vaiTro: "phu",
          tam: { x: 0.18, y: 0.42, z: 0.3 },
          co: { x: 0.14, y: 0.14, z: 0.24 },
        },
        vachHuong(-0.32),
      ];

    case "tram_chung":
    default:
      // Hộp bo góc (xấp xỉ bằng thân + hai gờ) + bảng điều khiển NGHIÊNG.
      return [
        than(0.78, -0.11),
        {
          ten: "go-tren",
          vaiTro: "phu",
          tam: { x: 0, y: 0.31, z: 0 },
          co: { x: 0.9, y: 0.06, z: 0.9 },
        },
        {
          ten: "go-duoi",
          vaiTro: "phu",
          tam: { x: 0, y: -0.47, z: 0 },
          co: { x: 0.9, y: 0.06, z: 0.9 },
        },
        {
          ten: "bang-dieu-khien",
          vaiTro: "phu",
          tam: { x: 0.28, y: 0.28, z: 0.42 },
          co: { x: 0.36, y: 0.24, z: 0.12 },
        },
        vachHuong(0.05),
      ];
  }
}

/** Kẹp một số đo về khoảng hợp lệ; giá trị rác lấy mặc định của trục đó. */
function kepSoDo(giaTri: number, macDinh: number): number {
  if (!Number.isFinite(giaTri) || giaTri < KICH_THUOC_TOI_THIEU_MM) return macDinh;
  if (giaTri > KICH_THUOC_TOI_DA_MM) return KICH_THUOC_TOI_DA_MM;
  return giaTri;
}

/**
 * Mô tả hình học của một khối, đã co giãn theo KÍCH THƯỚC THẬT.
 *
 * Hình dạng CỐ ĐỊNH (danh sách hộp con và vị trí tương đối của chúng không đổi),
 * chỉ tỉ lệ co giãn theo số đo — nên máy AOI 1400mm và AOI 2200mm nhìn khác nhau
 * ngay, mà vẫn nhận ra cùng một chủng loại.
 *
 * Không import three: `hopCon[].tam/co` là số TƯƠNG ĐỐI, `kichThuocMet` là số
 * TUYỆT ĐỐI (mét). Component .tsx nhân hai thứ đó với nhau.
 */
export function hinhHocKhoi(khoi: KhoiKey, kichThuoc: KichThuocMm): MoTaKhoi {
  const rongMm = kepSoDo(kichThuoc.rongMm, KICH_THUOC_MAC_DINH.rongMm);
  const caoMm = kepSoDo(kichThuoc.caoMm, KICH_THUOC_MAC_DINH.caoMm);
  const sauMm = kepSoDo(kichThuoc.sauMm, KICH_THUOC_MAC_DINH.sauMm);
  const hopCon = hopConCuaKhoi(khoi);
  return {
    khoi,
    kichThuocMm: { rongMm, caoMm, sauMm },
    // Quy đổi mm->m ĐI QUA `heToaDo` chứ không tự chia 1000 ở đây: spec §5.2 đòi
    // "toàn bộ quy đổi nằm trong MỘT module". Hai chỗ chia 1000 là hai nguồn sự
    // thật, và chỗ thứ hai không bao giờ được test khi chỗ thứ nhất đổi.
    kichThuocMet: {
      rong: mmSangMet(rongMm),
      cao: mmSangMet(caoMm),
      sau: mmSangMet(sauMm),
    },
    hopCon,
    // 12 tam giác mỗi hộp chữ nhật (6 mặt × 2 tam giác).
    soTamGiacUocTinh: hopCon.length * 12,
  };
}

/** Đường tắt: từ loại máy thẳng ra mô tả hình học. */
export function hinhHocChoLoaiMay(
  loaiMay: string | null | undefined,
  kichThuoc: KichThuocMm = KICH_THUOC_MAC_DINH,
): MoTaKhoi {
  return hinhHocKhoi(hinhKhoiCho(loaiMay), kichThuoc);
}
