/**
 * hopNhatCanh.ts — T-4 (§15.5.2): **KHỐI HỢP NHẤT DỮ LIỆU**, tách khỏi
 * `TwinVanHanh.tsx` để màn **Line** và màn **Machine** dùng lại.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ Module THUẦN (RB-8.1) — không react, không three, không `Date.now()`.
 * ════════════════════════════════════════════════════════════════════════════
 * Đây là điều kiện để ba màn dùng chung được: một `useMemo` trong
 * `TwinVanHanh.tsx` chỉ chạy trong CÂY REACT CỦA MÀN ĐÓ. Hàm thuần chạy ở bất
 * kỳ đâu — kể cả trong lưới `environment: "node"` (rẻ, không dựng jsdom), và
 * đó là lý do khối này được đo bằng **giá trị trả về thật**, không phải bằng
 * phép đo VĂN BẢN như các hook T-1/T-3 (chúng bọc `trpc`, không gọi thật được).
 *
 * ⇒ Chênh lệch ấy là CÓ CHỦ Ý: cái gì gọi được thì đo bằng giá trị, cái gì
 *   không thì mới hạ xuống đo văn bản. Đừng hạ cấp phép đo của tệp này.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BẪY HOÁN VỊ TRỤC — LÝ DO TỆP NÀY TỒN TẠI THAY VÌ MỘT LẦN COPY-PASTE
 * ════════════════════════════════════════════════════════════════════════════
 * `TwinVanHanh.tsx` ghi nguyên văn tại chỗ dùng `vienSucKhoeCanh`:
 *
 *     ⚠ `viTri` của `mayVe` **đã đổi trục** (DB Y = mặt bằng → scene z).
 *       Lấy nhầm `viTri.y` (độ cao) sẽ dán mọi vòng lên một đường thẳng —
 *       và nó **KHÔNG làm gì nổ**.
 *
 * Quy ước bất biến sống ở `heToaDo.ts` §5.2:
 *
 *     scene.x = viTriXMm/1000   (Đông)
 *     scene.y = viTriZMm/1000   ← Z của DB là **ĐỘ CAO**
 *     scene.z = viTriYMm/1000   ← Y của DB là **MẶT BẰNG**
 *
 * ⚠⚠ Bản trong `TwinVanHanh.tsx` viết phép hoán vị ấy **bằng tay**:
 *     `{ x: mmSangMet(d.viTriXMm), y: mmSangMet(d.viTriZMm), z: mmSangMet(d.viTriYMm) }`
 *     — đúng, nhưng là **bản sao thứ hai** của một quy ước đã có hàm riêng.
 *     Copy nó sang màn Line và màn Machine sẽ thành bản sao thứ ba và thứ tư,
 *     và một trong bốn bản sẽ lệch mà **không cổng nào đỏ**: máy bay lên trời
 *     là một cảnh 3D hợp lệ về mặt kiểu dữ liệu.
 *
 * ⇒ Tệp này gọi thẳng `mmSangScene()` của `heToaDo.ts` — MỘT chỗ quy đổi, đúng
 *   luật "không nơi nào khác được chia 1000" mà `heToaDo.ts` tự khai. Lưới
 *   `hopNhatCanh.unit.test.ts` có một ca ghim **đúng phép hoán vị** (ba trục ba
 *   giá trị KHÁC NHAU, nên hoán vị sai là đỏ — xem lý lẽ ở đó).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ G37 — KHÔNG tự đọc `useSearch()`/`useRoute()`
 * ════════════════════════════════════════════════════════════════════════════
 * Không có gì để đọc: đây là hàm thuần, mọi thứ vào qua tham số. `phamVi` và
 * `factoryId` được dẫn xuất ở trang cha rồi TRUYỀN XUỐNG — cùng luật đã áp cho
 * `useTrangThaiTwin` (T-3), `usePhanTichLine`, `useMoPhongTwin`, `useAnhLichSu`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CÁI **KHÔNG** NẰM Ở ĐÂY, VÀ VÌ SAO
 * ════════════════════════════════════════════════════════════════════════════
 * `cotWipCanh` / `bangWip` / `nhipChuyenMs` trong `TwinVanHanh.tsx` **đã** là
 * lời gọi một dòng tới `cotWip()` / `xepHangWip()` / `nhipTuCanBang()` của
 * `wipTram.ts`. Chúng ĐÃ tách rồi; kéo chúng qua đây chỉ thêm một lớp bọc
 * không mang bất biến nào. Xem `hopNhatCanhKhongTachThem.unit.test.ts` — chỗ
 * ấy biến câu từ chối này thành phép đo chạy được (G91), thay vì một câu trong
 * báo cáo sẽ bay hơi.
 */
import { gocTuQuatTrucDung, mmSangScene, mmSangMet, type DiemScene } from "../heToaDo";
/*
 * ★ `KhoiKey` nhập từ `hinhKhoiMay.ts` — module ấy tự khai THUẦN DỮ LIỆU
 *   (không three, không react), nên nhập nó KHÔNG phá tính thuần của tệp này.
 *   Nhập đúng kiểu thay vì `string` giữ được liên kết kiểu tới `MayTrongLo`
 *   của `loi/LoBatchMay`: nếu ai đó thêm một khối mới mà quên ánh xạ, `check`
 *   đỏ ở đây chứ không im lặng dựng một khối không tồn tại.
 */
import type { KhoiKey } from "../hinhKhoiMay";
/*
 * ★ `apDungMucTuoi` + kiểu `MucTuoi` nhập THẲNG, không tiêm: `mauTrangThai.ts` là
 *   module LÁ (0 import) và `apDungMucTuoi` là phép nhân THUẦN — nó không kéo DOM
 *   vào đây như `mauCss`/`giaiMauCanh` (lý do `CongCuMau` tồn tại). Nhập thẳng còn
 *   là điều kiện để hệ số 40 % chỉ có ĐÚNG MỘT bản: tiêm nó qua `CongCuMau` sẽ cho
 *   mỗi trang một cơ hội truyền một hàm khác.
 */
import { apDungMucTuoi, type MucTuoi } from "../mauTrangThai";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Kiểu vào                                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Máy sau khi hợp nhất trạng thái — đúng phần khối này cần, không hơn. */
export interface MayVaoCanh {
  id: number;
  stationId: number | null;
  lineId: number | null;
  loaiMay: string;
  isActive?: boolean;
}

/** Một hàng `twin_dat_cho` — vị trí/kích thước/xoay đã đặt. Đơn vị mm (DB). */
export interface DatChoVaoCanh {
  hienThi: boolean;
  tangId: number | null;
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  rongMm: number | null;
  caoMm: number | null;
  sauMm: number | null;
  quatX: number;
  quatY: number;
  quatZ: number;
  quatW: number;
}

/** Kích thước mặc định theo loại máy (mm) khi hàng đặt chỗ không ghi. */
export interface CoMacDinh {
  rongMm: number;
  caoMm: number;
  sauMm: number;
}

/** Kết quả dựng một máy để vẽ — khớp `MayTrongLo` của `loi/LoBatchMay`. */
export interface MayDaDung {
  machineId: number;
  khoi: KhoiKey;
  kichThuocMm: CoMacDinh;
  /** Hệ **CẢNH** (mét), đã hoán vị trục. `y` là ĐỘ CAO. */
  viTri: DiemScene;
  gocXoayRad: number;
  mau: string;
  doMo: number;
}

/**
 * Những hàm màu/phạm vi mà khối này cần, tiêm vào thay vì import.
 *
 * ★ Vì sao TIÊM: `mauCss()` đọc `getComputedStyle(document.documentElement)` —
 *   nó cần DOM. Import thẳng sẽ kéo cả module này vào vùng phải-có-jsdom và
 *   giết mất khả năng đo bằng giá trị thật trong `environment: "node"`.
 *   Tiêm giữ tệp thuần, và lưới đưa vào một `mauCss` giả tất định.
 */
export interface CongCuMau {
  /** Token CSS → chuỗi màu three đọc được. */
  mauCss: (token: string, duPhong: string) => string;
  /** Pha một màu về phía màu nền theo tỉ lệ. */
  phaVeNen: (mau: string, nen: string, tiLe: number) => string;
  /** Trạng thái máy → token màu + độ mờ + cờ bất thường. */
  mauChoTrangThai: (tt: string | undefined) => {
    token: string;
    doMo: number;
    khoaNhan: string;
    laBatThuong: boolean;
  };
  /** Loại máy → khoá hình khối. */
  hinhKhoiCho: (loaiMay: string) => KhoiKey;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ Task 17c LỖI HAI — GỐC CỦA TOÀ NHÀ, số hạng chưa bao giờ được cộng      */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Chỗ dời của một toà nhà so với GỐC CẢNH, tính bằng **mm của hệ DB**
 * (X = Đông, Y = mặt bằng, Z = độ cao — chưa hoán vị).
 */
export interface GocToaMm {
  xMm: number;
  yMm: number;
  zMm: number;
}

/** Không dời — dùng cho tầng mà người gọi không biết toà nhà của nó. */
export const GOC_TOA_KHONG: GocToaMm = { xMm: 0, yMm: 0, zMm: 0 };

/** `numeric(14,3)` về từ drizzle là **string**. `Number()` tường minh, không `+`. */
function soMm(gt: number | string | null | undefined): number {
  const n = Number(gt);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Bản đồ `tangId → chỗ dời của toà chứa tầng ấy`, ĐÃ QUY VỀ GỐC CẢNH.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO HÀM NÀY TỒN TẠI — nợ hình học đã đến hạn, KHÔNG phải chi phí của
 *     việc gộp nhiều nhà máy
 * ════════════════════════════════════════════════════════════════════════════
 * `twin_dat_cho.viTriXMm/YMm` là toạ độ **TRONG TẦNG**: đo được trên dữ liệu
 * thật, cả 13 toà đều bắt đầu từ 0 (`X[0…55.000]`, `Y[0…58.000]`). Vị trí của
 * toà nằm ở **`twin_toa_nha.viTriXMm/YMm`** — cột CÓ THẬT và ĐÃ ĐIỀN (QATD-A:
 * hai toà ở X = 0 và X = 130.000).
 *
 * `dungMayVe` trước đây đưa **thẳng** toạ độ đặt chỗ vào cảnh, không số hạng nào
 * của toà ⇒ **hai toà của CÙNG MỘT nhà máy chồng khít lên nhau**. Chưa ai thấy
 * vì cả ba màn vận hành chỉ nạp tầng của **một** toà (`chiTietToaNha`), nên phép
 * dời là một hằng số chung và bức tranh y hệt. Nó sẽ lộ ra ngay lượt đầu tiên
 * cảnh mang hai toà — và khi ấy dễ bị đổ nhầm cho việc gộp nhà máy.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO QUY VỀ **GỐC CẢNH** CHỨ KHÔNG DÙNG TOẠ ĐỘ TUYỆT ĐỐI
 * ════════════════════════════════════════════════════════════════════════════
 * Cảnh vận hành hôm nay vẽ mặt sàn tại **gốc toạ độ** (`CanhVanHanh.San`:
 * `position=[rongM/2, -0.01, sauM/2]`, không nhận vị trí toà). Cộng toạ độ
 * TUYỆT ĐỐI cho riêng máy sẽ đẩy máy ra khỏi mặt sàn 130 m — **một lỗi mới do
 * chính bản vá đẻ ra**, đúng lớp "vá xong quên kiểm nhánh kia".
 *
 * Nên chỗ dời ở đây là **hiệu** so với toà NEO (`toaNhaNeoId`, thường là toà
 * đang xem): toà neo ra `{0,0,0}` ⇒ cảnh một toà **không đổi một pixel nào**,
 * còn toà thứ hai được dời đúng bằng khoảng cách thật giữa hai toà.
 *
 * ⚠⚠ **KHÔNG CỘNG HAI LẦN.** Số hạng duy nhất là `twin_toa_nha.viTri*Mm`. Bộ
 *   sinh dữ liệu đo đã nướng sẵn 1 km mỗi nhà máy **vào chính cột ấy**
 *   (`.qa-tapdoan/sinh-tap-doan.mjs:166`), nên một lưới dời cố định chồng lên
 *   đây sẽ cộng hai lần. Dữ liệu cũ (SIM-FAC) thì toà ở (0,0) — tức khoảng cách
 *   giữa các nhà máy là **quyết định của bộ sinh, không phải luật của hệ**. Hàm
 *   này không bịa ra khoảng cách nào; nó chỉ đọc cái đã có.
 *
 * @param tangs      tầng kèm `toaNhaId` — lấy từ `chiTietToaNha().tangs`.
 * @param toaNhas    toà nhà kèm toạ độ — lấy từ `danhSachToaNha()` (numeric là
 *                   **string**, hàm tự quy đổi).
 * @param toaNhaNeoId toà làm gốc cảnh. `null` ⇒ giữ toạ độ TUYỆT ĐỐI (cảnh nhiều
 *                   nhà máy sau này, khi mặt sàn cũng biết vị trí của mình).
 */
export function gocToaTheoTang(
  tangs: readonly { id: number; toaNhaId: number }[],
  toaNhas: readonly {
    id: number;
    viTriXMm?: number | string | null;
    viTriYMm?: number | string | null;
    viTriZMm?: number | string | null;
  }[],
  toaNhaNeoId: number | null,
): Map<number, GocToaMm> {
  const theoToa = new Map<number, GocToaMm>();
  for (const b of toaNhas) {
    theoToa.set(b.id, { xMm: soMm(b.viTriXMm), yMm: soMm(b.viTriYMm), zMm: soMm(b.viTriZMm) });
  }
  // Toà neo không có trong danh sách (chưa tải xong / ngoài phạm vi) ⇒ neo về 0,
  // tức giữ nguyên hành vi cũ. KHÔNG được đoán một gốc khác.
  const neo = (toaNhaNeoId !== null ? theoToa.get(toaNhaNeoId) : null) ?? GOC_TOA_KHONG;

  const ra = new Map<number, GocToaMm>();
  for (const t of tangs) {
    const g = theoToa.get(t.toaNhaId);
    // ⚠ Tầng có toà KHÔNG biết toạ độ ⇒ **không ghi vào bản đồ**. `dungMayVe` khi
    //   ấy không dời gì — đúng hành vi cũ. Ghi một số 0 bịa ra ở đây sẽ biến
    //   "chưa biết" thành "biết rồi, bằng gốc", đúng lớp lỗi NT-3.
    if (!g) continue;
    ra.set(t.id, { xMm: g.xMm - neo.xMm, yMm: g.yMm - neo.yMm, zMm: g.zMm - neo.zMm });
  }
  return ra;
}

/** Tham số dựng tập máy vẽ trên mặt bằng. */
export interface ThamSoMayVe {
  may: readonly MayVaoCanh[];
  datChoTheoMay: ReadonlyMap<number, DatChoVaoCanh>;
  kichThuocTheoLoai: ReadonlyMap<string, CoMacDinh>;
  trangThaiTheoMay: ReadonlyMap<number, string>;
  /**
   * ★★★ `machineId → MỨC TƯƠI của dữ liệu` — ô thứ hai của `trangThaiHienThi()`.
   *
   * ════════════════════════════════════════════════════════════════════════
   * VÌ SAO LÀ **MỨC** CHỨ KHÔNG PHẢI `bayGio` + `thoiDiemDuLieu`
   * ════════════════════════════════════════════════════════════════════════
   * Cám dỗ là cho khối này nhận `bayGio` rồi tự gọi `mauTheoTuoi(tt, ts, bayGio)`.
   * Làm vậy là buộc màu thành **hàm của ĐỒNG HỒ**: cả ba trang khai
   * `const bayGioThat = Date.now()` MỖI RENDER, nên `mayVe` sẽ dựng lại mỗi
   * render ⇒ `LoBatchMay` `setColorAt` ⇒ `invalidate()` ⇒ một khung vẽ cho mỗi
   * phản hồi poll và mỗi gói socket — đúng cái churn mà Đợt 38
   * (`onDinhTheoGiaTri.ts`) và hai commit `7adc49600`/`f232e791c` vừa dọn.
   *
   * `MucTuoi` chỉ có BA giá trị, nên nó là phép **lượng tử hoá tự nhiên** của
   * `bayGio`: hai render cách nhau 1 giây cho CÙNG một bản đồ ⇒ `khoaBanDo`
   * không đổi ⇒ `useOnDinhTheoGiaTri` giữ nguyên tham chiếu ⇒ cảnh đứng yên.
   * Màu chỉ đổi khi một máy thật sự VƯỢT NGƯỠNG — đúng lúc nó phải đổi.
   *
   * ⚠ Trường **BẮT BUỘC**, cùng chủ ý với `gocToaTheoTang` ngay dưới: để mặc
   *   định (bản đồ rỗng ⇒ không nhạt) là giữ nguyên lỗi cũ ở mọi chỗ gọi quên
   *   truyền mà không cổng nào đỏ. Bắt buộc thì `npm run check` gọi tên từng
   *   chỗ gọi. Máy VẮNG trong bản đồ ⇒ coi như `tuoi` (không nhạt thêm) — đúng
   *   hành vi trước bản vá, vì luật `khong_ro` đã do `trangThaiTheoMay` mang.
   */
  mucTuoiTheoMay: ReadonlyMap<number, MucTuoi>;
  /**
   * `tangId → chỗ dời của toà chứa tầng ấy` ({@link gocToaTheoTang}).
   *
   * ⚠ Trường này **BẮT BUỘC**, và đó là chủ ý: để mặc định `{0,0,0}` là giữ
   *   nguyên lỗi cũ ở mọi chỗ gọi quên truyền, mà không cổng nào đỏ. Bắt buộc
   *   thì `npm run check` gọi tên từng chỗ gọi — bài học "mặc định mới là hàng
   *   rào". Tầng vắng mặt trong bản đồ ⇒ không dời (hành vi cũ).
   */
  gocToaTheoTang: ReadonlyMap<number, GocToaMm>;
  /** `true` = máy nằm TRONG phạm vi đang xem (đã quyết ở trang cha). */
  trongPhamVi: (may: MayVaoCanh, tangId: number | null) => boolean;
  mauNenCanh: string;
  /** Tỉ lệ pha về nền cho máy NGOÀI phạm vi (`TI_LE_PHA_NGOAI_PHAM_VI`). */
  tiLePhaNgoaiPhamVi: number;
  congCu: CongCuMau;
}

/** Kích thước dự phòng khi cả hàng đặt chỗ lẫn bảng loại máy đều im lặng. */
export const CO_DU_PHONG: CoMacDinh = { rongMm: 1000, caoMm: 1800, sauMm: 1000 };

/**
 * Dựng tập máy để vẽ trên mặt bằng — **nguồn dữ liệu chung** của 3D, 2D, bảng
 * và ô đếm (chính là câu mà docblock khối gốc trong `TwinVanHanh.tsx` khai).
 *
 * ⚠ Bỏ qua máy không có hàng đặt chỗ HOẶC `hienThi = false`. Điều kiện ấy phải
 *   là **phủ định chính xác** của điều kiện vào khu chờ ({@link dungMayKhuCho})
 *   — máy rơi vào khe giữa hai điều kiện sẽ **biến mất khỏi cảnh hoàn toàn** mà
 *   không lỗi nào nổ. Xem docblock `mayKhuCho` trong `khuChoVaNhanLine.ts`.
 */
export function dungMayVe(ts: ThamSoMayVe): MayDaDung[] {
  const ra: MayDaDung[] = [];
  for (const mv of ts.may) {
    const d = ts.datChoTheoMay.get(mv.id);
    if (!d || !d.hienThi) continue;
    const co = ts.kichThuocTheoLoai.get(mv.loaiMay) ?? CO_DU_PHONG;
    /*
     * ★★★ TUỔI DỮ LIỆU VÀO ĐƯỜNG VẼ (2026-09-18) — NT-3 mục 3, nay CÓ HIỆU LỰC.
     *
     * Trước dòng này, `trangThaiHienThi` chỉ rẽ nhánh ở `khong_ro` (> 300 s), nên
     * một máy im lặng **90 giây được vẽ GIỐNG HỆT** một máy vừa gửi tín hiệu;
     * khác biệt duy nhất nổi lên là một ô đếm (`trungThucDuLieu.demTheoTuoi`).
     * `apDungMucTuoi` là chỗ mức `cu` (60–300 s) trở thành **nhạt 40 %** trên
     * chính khối máy — mã hoá DƯ THỪA cạnh ô đếm, không thay nó.
     *
     * ⚠ Áp SAU `mauChoTrangThai`, trên KẾT QUẢ đã tiêm: `kieu.doMo` của
     *   `ngung_khai_thac` là 0,35 và phép nhân giữ đúng tỉ lệ ấy thay vì đè lên.
     */
    const kieu = apDungMucTuoi(
      ts.congCu.mauChoTrangThai(ts.trangThaiTheoMay.get(mv.id)),
      ts.mucTuoiTheoMay.get(mv.id) ?? "tuoi",
    );
    const trong = ts.trongPhamVi(mv, d.tangId);
    const mauGoc = ts.congCu.mauCss(kieu.token, "#94a3b8");
    ra.push({
      machineId: mv.id,
      khoi: ts.congCu.hinhKhoiCho(mv.loaiMay),
      kichThuocMm: {
        rongMm: d.rongMm ?? co.rongMm,
        caoMm: d.caoMm ?? co.caoMm,
        sauMm: d.sauMm ?? co.sauMm,
      },
      /*
       * ★★★ HOÁN VỊ TRỤC — qua `mmSangScene`, KHÔNG viết tay.
       * DB: X = Đông, Y = mặt bằng, Z = độ cao.
       * Scene: x = X, y = Z (độ cao), z = Y (mặt bằng).
       *
       * ★★★ Task 17c LỖI HAI — CỘNG GỐC CỦA TOÀ NHÀ. Toạ độ đặt chỗ là toạ độ
       *   TRONG TẦNG (mọi toà đều bắt đầu từ 0), nên thiếu số hạng này thì hai
       *   toà của CÙNG MỘT nhà máy chồng khít lên nhau. Số hạng lấy từ
       *   `twin_toa_nha.viTri*Mm` — xem {@link gocToaTheoTang} về việc vì sao
       *   đây là chỗ dời DUY NHẤT và vì sao không được cộng thêm một lưới nào.
       */
      viTri: (() => {
        const g = (d.tangId !== null ? ts.gocToaTheoTang.get(d.tangId) : undefined) ?? GOC_TOA_KHONG;
        return mmSangScene({
          xMm: g.xMm + d.viTriXMm,
          yMm: g.yMm + d.viTriYMm,
          zMm: g.zMm + d.viTriZMm,
        });
      })(),
      gocXoayRad: gocTuQuatTrucDung({ x: d.quatX, y: d.quatY, z: d.quatZ, w: d.quatW }),
      /*
       * "Mờ đi" = PHA VỀ NỀN, không phải làm tối: kênh `doMo` của `LoBatchMay`
       * nhân màu với `0.35 + 0.65*doMo` (vật liệu ĐỤC), nên làm tối một màu vốn
       * nhạt cho ra khối gần ĐEN trên theme sáng — đọc như MÁY HỎNG. Vì vậy pha
       * ở tầng này rồi truyền `doMo: 1`.
       */
      mau: trong ? mauGoc : ts.congCu.phaVeNen(mauGoc, ts.mauNenCanh, ts.tiLePhaNgoaiPhamVi),
      doMo: trong ? kieu.doMo : 1,
    });
  }
  return ra;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Khu chờ — phủ định CHÍNH XÁC của điều kiện vẽ                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Tham số chọn tập máy vào khu chờ. */
export interface ThamSoChuaDat {
  may: readonly MayVaoCanh[];
  datChoTheoMay: ReadonlyMap<number, DatChoVaoCanh>;
  /** Tập id máy mà LƯỢT NẠP hiện tại thật sự phủ (F2). */
  idDuocNap: ReadonlySet<number>;
}

/**
 * Id những máy **chưa đặt lên mặt bằng** nhưng thuộc lượt nạp hiện tại.
 *
 * ⚠⚠ Điều kiện phải là `!d || !d.hienThi` — **phủ định chính xác** của
 * {@link dungMayVe}. Bản viết đầu ở `TwinVanHanh.tsx` lọc `!has(mv.id)`, chỉ bắt
 * máy KHÔNG CÓ hàng đặt chỗ; máy CÓ hàng mà `hienThi = false` rơi vào khe giữa
 * hai điều kiện và **biến mất khỏi cảnh hoàn toàn**.
 *
 * ⚠ `idDuocNap` không phải tối ưu: thiếu nó, 373 máy của tầng khác (đã có chỗ
 *   THẬT ở tầng đó) sẽ bị dựng thành 373 khối trong khu chờ của tầng đang xem —
 *   một lời nói dối bằng hình khối, mà người dùng còn tin hơn chữ.
 */
export function idMayChuaDat(ts: ThamSoChuaDat): number[] {
  const ra: number[] = [];
  for (const mv of ts.may) {
    if (mv.isActive === false) continue;
    if (!ts.idDuocNap.has(mv.id)) continue;
    const d = ts.datChoTheoMay.get(mv.id);
    if (!d || !d.hienThi) ra.push(mv.id);
  }
  return ra;
}

/**
 * Mép trái-trên của mặt bằng đang vẽ — điểm neo khu chờ.
 * Không có máy nào trên mặt bằng ⇒ neo về gốc, khu chờ vẫn hiện được
 * (trả `Infinity` sẽ đẩy mọi khối ra vô cực, và không gì nổ).
 */
export function mepMatBang(mayVe: readonly Pick<MayDeNeo, "viTri">[]): { mepX: number; mepZ: number } {
  let mepX = Number.POSITIVE_INFINITY;
  let mepZ = Number.POSITIVE_INFINITY;
  for (const m of mayVe) {
    if (m.viTri.x < mepX) mepX = m.viTri.x;
    if (m.viTri.z < mepZ) mepZ = m.viTri.z;
  }
  if (!Number.isFinite(mepX)) mepX = 0;
  if (!Number.isFinite(mepZ)) mepZ = 0;
  return { mepX, mepZ };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Nhãn máy và cảnh báo 3D — đều neo theo ĐỘ CAO của máy                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Máy đã dựng, ở vị trí **ĐẦU VÀO** — chỉ đòi những trường thật sự được đọc.
 *
 * ★ Vì sao tách khỏi {@link MayDaDung}: `MayTrongLo` của `loi/LoBatchMay` khai
 *   `doMo?` và `hien?` là TUỲ CHỌN, còn `MayDaDung` (kết quả của `dungMayVe`)
 *   luôn điền `doMo`. Nếu tham số vào cũng đòi `MayDaDung` thì trang không
 *   truyền `MayTrongLo[]` xuống được, và cách "sửa" dễ nhất sẽ là một `as` —
 *   tức là vứt đúng phép kiểm mà kiểu sinh ra để làm.
 *
 * ⇒ Đầu vào đòi ÍT, đầu ra hứa NHIỀU. Ba hàm dưới chỉ đọc `machineId`,
 *   `viTri` và `kichThuocMm.caoMm`, nên chúng chỉ được đòi đúng ngần ấy.
 */
export interface MayDeNeo {
  machineId: number;
  viTri: DiemScene;
  kichThuocMm: { caoMm: number };
}

/** Nhãn tên máy trong không gian cảnh — khớp `NhanTheGioi` của `loi/LopNhan`. */
export interface NhanMay {
  khoa: string;
  machineId: number;
  viTri: DiemScene;
  ma: string;
  phu?: string;
  batThuong?: boolean;
}

/** Khoảng nhô của nhãn trên NÓC máy (mét). */
export const HO_NHAN_MAY = 0.4;
/** Khoảng nhô của biểu tượng cảnh báo trên NÓC máy (mét) — cao hơn nhãn. */
export const HO_CANH_BAO = 0.9;

/**
 * Điểm neo phía trên nóc một máy.
 *
 * ⚠⚠ **CHỈ `y` được cộng.** `y` của hệ cảnh là ĐỘ CAO (xem `heToaDo.ts` §5.2);
 * `caoMm` cũng là chiều cao. Cộng vào `z` sẽ đẩy nhãn ra sau máy trên mặt bằng
 * thay vì lên nóc — và trên một cảnh nhìn từ trên xuống nó **trông vẫn hợp lý**,
 * nên không phép đo hình ảnh nào bắt được. Lưới ghim cả ba trục.
 */
export function neoTrenNoc(m: MayDeNeo, ho: number): DiemScene {
  return {
    x: m.viTri.x,
    y: m.viTri.y + mmSangMet(m.kichThuocMm.caoMm) + ho,
    z: m.viTri.z,
  };
}

/** Tham số dựng nhãn máy. */
export interface ThamSoNhanMay {
  mayVe: readonly MayDeNeo[];
  trangThaiTheoMay: ReadonlyMap<number, string>;
  maTheoMay: ReadonlyMap<number, string>;
  mauChoTrangThai: CongCuMau["mauChoTrangThai"];
  /** i18n — tiêm vào để module giữ thuần. */
  t: (khoa: string) => string;
  /**
   * ★★★ Đợt 35 (Pareto #5) — máy đang có ANDON mở. Nhãn của chúng là `batThuong`
   * DÙ trạng thái máy nói gì (máy 14: andon `raised` mà trạng thái `khong_ro`
   * ⇒ trước đợt này nhãn KHÔNG bất thường ⇒ declutter được phép giấu nó, và chip
   * "N sự cố ngoài khung" đếm 0 khi nó ở ngoài frustum). NT-2: alarm không bao
   * giờ bị góc camera che — kể cả trong luật ưu tiên nhãn. Bỏ trống ⇒ như cũ.
   */
  andonTheoMay?: ReadonlySet<number>;
}

/** Nhãn tên máy, một nhãn cho mỗi máy ĐANG ĐƯỢC VẼ. */
export function dungNhanMay(ts: ThamSoNhanMay): NhanMay[] {
  return ts.mayVe.map((m) => {
    const tt = ts.trangThaiTheoMay.get(m.machineId) ?? "khong_ro";
    const kieu = ts.mauChoTrangThai(tt);
    return {
      khoa: `may-${m.machineId}`,
      machineId: m.machineId,
      viTri: neoTrenNoc(m, HO_NHAN_MAY),
      ma: ts.maTheoMay.get(m.machineId) ?? `#${m.machineId}`,
      phu: ts.t(kieu.khoaNhan),
      batThuong: kieu.laBatThuong || (ts.andonTheoMay?.has(m.machineId) ?? false),
    };
  });
}

/** Một nhãn Line tại centroid, đã dựng sẵn ở `khuChoVaNhanLine.ts`. */
export interface NhanLineVao {
  lineId: number;
  viTri: DiemScene;
  ma: string;
  ten: string;
}

/**
 * Gộp nhãn máy và nhãn Line vào **MỘT** lớp nhãn.
 *
 * ★ Dùng chung `LopNhan` chứ KHÔNG dựng lớp thứ hai: `LopNhan` là nơi luật
 *   declutter (§9.6) sống — 300 nhãn CSS2D đã lag, nên nhãn phải đi qua bộ cull
 *   và trần `TRAN_NHAN_DOM`. Một lớp riêng cho Line nằm NGOÀI trần ấy.
 *
 * ★★★ `machineId` của nhãn Line là **`-lineId`** (ÂM). `LopNhan` so `machineId`
 *   với `dangChon`/`dangHover`; một nhãn Line mang id TRÙNG một máy sẽ sáng lên
 *   khi máy đó được chọn. Hai không gian khoá phải KHÔNG va nhau.
 */
export function gopNhan(
  nhanMay: readonly NhanMay[],
  nhanLine: readonly NhanLineVao[],
): NhanMay[] {
  return [
    ...nhanMay,
    ...nhanLine.map((l) => ({
      khoa: `line-${l.lineId}`,
      machineId: -l.lineId,
      viTri: l.viTri,
      ma: l.ma,
      phu: l.ten,
      batThuong: false,
    })),
  ];
}

/** Một andon đang mở, đúng phần khối này cần. */
export interface AndonVao {
  id: number;
  machineId: number | null;
  state: string;
  status: string;
}

/** Cảnh báo neo trong không gian cảnh — khớp `CanhBaoTheGioi` của `LopCanhBao`. */
export interface CanhBaoDaNeo {
  id: number;
  machineId: number;
  viTri: DiemScene;
  muc: string;
  nhan: string;
  daAck: boolean;
}

/** Ba mức mà `LopCanhBao` biết vẽ. Mức lạ quy về `call` (không im lặng bỏ). */
export const MUC_CANH_BAO_HOP_LE = ["red", "yellow", "call"] as const;

/**
 * Neo cảnh báo lên nóc máy tương ứng.
 *
 * ⚠ Andon của máy KHÔNG có trên cảnh bị BỎ (không có toạ độ để neo). Đó là câu
 *   trả lời đúng ở tầng 3D; đài cảnh báo 2D vẫn liệt kê đủ, nên không có cảnh
 *   báo nào biến mất khỏi màn hình — chỉ khỏi cảnh.
 */
export function dungCanhBao3D(
  andon: readonly AndonVao[],
  mayVe: readonly MayDeNeo[],
  maTheoMay: ReadonlyMap<number, string>,
): CanhBaoDaNeo[] {
  const theoId = new Map(mayVe.map((m) => [m.machineId, m]));
  const ra: CanhBaoDaNeo[] = [];
  for (const a of andon) {
    if (a.machineId == null) continue;
    const m = theoId.get(a.machineId);
    if (!m) continue;
    ra.push({
      id: a.id,
      machineId: a.machineId,
      viTri: neoTrenNoc(m, HO_CANH_BAO),
      muc: (MUC_CANH_BAO_HOP_LE as readonly string[]).includes(a.state) ? a.state : "call",
      nhan: maTheoMay.get(a.machineId) ?? `#${a.machineId}`,
      daAck: a.status === "acknowledged",
    });
  }
  return ra;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* SA BÀN TẬP ĐOÀN — mm (CSDL) → mét (scene), MỘT chỗ quy đổi (Task 20)        */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Một biểu tượng toà nhà ĐÃ sẵn sàng cho cảnh: **tâm khối**, mét, trục scene.
 *
 * ⚠ `viTri` là TÂM, không phải góc — `<boxGeometry>` của three lấy tâm làm gốc.
 *   `MayTrongLo.viTri` ngược lại là ĐÁY máy. Hai quy ước khác nhau trong cùng
 *   một cảnh là chỗ trượt chân kinh điển, nên nó được khai ngay ở kiểu.
 */
export interface BieuTuongToaVe {
  toaNhaId: number;
  factoryId: number;
  chiSoCum: number;
  /** Chữ ĐÃ sẵn sàng hiển thị (trang lo `t()`; cảnh không được gọi `t()` — RB-8.3). */
  nhan: string;
  viTri: { x: number; y: number; z: number };
  co: { rong: number; cao: number; sau: number };
}

/** Nền một cụm (một nhà máy) — tấm mỏng nằm dưới nhóm biểu tượng. */
export interface CumSaBanVe {
  factoryId: number;
  chiSoCum: number;
  nhan: string;
  viTri: { x: number; y: number; z: number };
  co: { rong: number; sau: number };
}

/** Hình dạng sa bàn mà {@link dungSaBanVe} cần — khớp `SaBanTapDoan` của `canhTapDoan.ts`. */
export interface SaBanVao {
  bieuTuong: readonly {
    toaNhaId: number;
    factoryId: number;
    chiSoCum: number;
    ten: string;
    ma: string;
    xMm: number;
    yMm: number;
    rongMm: number;
    sauMm: number;
    caoMm: number;
  }[];
  oCum: readonly {
    factoryId: number;
    chiSoCum: number;
    xMm: number;
    yMm: number;
    rongMm: number;
    sauMm: number;
    soToa: number;
  }[];
}

/** Bề dày tấm nền cụm (m) — mỏng để không thành một khối thứ hai tranh chỗ với toà. */
export const DAY_NEN_CUM_M = 0.4;

/*
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BẢNG MÀU SA BÀN — MỘT NGUỒN CHO **CẢ HAI** CHẾ ĐỘ VẼ
 * ════════════════════════════════════════════════════════════════════════════
 * Ba hằng dưới đây sinh ra ở `LopSaBan.tsx` (bản 3D, Task 20) và ở đó chúng là
 * hằng RIÊNG TƯ của tệp. Khi bản 2D cũng vẽ sa bàn, "chép sang tệp kia" là cách
 * chắc chắn nhất để hai chế độ tách nhau lần nữa — lần này ở MÀU thay vì ở đơn
 * vị vẽ, và tách kiểu đó không lưới nào bắt vì cả hai vẫn xanh.
 *
 * ⇒ Bảng màu về đây, cạnh `BieuTuongToaVe`/`CumSaBanVe` mà cả hai chế độ đã dùng
 *   chung. Tệp này không nhập `three` và không nhập React, nên cả lớp R3F lẫn
 *   lớp SVG đọc được mà không kéo theo phụ thuộc chéo.
 *
 * ★ LÝ LẼ MÀU GIỮ NGUYÊN (nguyên văn từ `LopSaBan.tsx`): bảng màu CÓ SẮC của màn
 *   này ĐÃ có nghĩa — đỏ = critical, hổ phách = warning, vàng = watch, lục =
 *   healthy, xám = chưa rõ. Một toà nhà màu lục cạnh một toà hổ phách sẽ bị đọc
 *   là *trạng thái*. Nên biểu tượng toà là **một màu xám duy nhất**, còn NHÓM
 *   đọc bằng (a) khe hở giữa cụm, (b) bậc độ sáng của nền cụm, (c) nhãn mang tên
 *   công ty — ba dấu hiệu, không cái nào mượn ý nghĩa của bảng trạng thái.
 */

/** Màu biểu tượng toà nhà — một sắc duy nhất, đổi theo theme. */
export const MAU_BIEU_TUONG_TOA = { sang: "#9aa8ba", toi: "#7e8ea4" } as const;

/**
 * Bậc độ sáng của tấm nền cụm. 4 bậc chứ không phải 8: quá 4 bậc thì hai bậc
 * cạnh nhau không phân biệt được bằng mắt, và trần nhà máy một lượt là 8 — nên
 * bậc được LẶP LẠI có chủ ý, vì khoảng cách mới là thứ tách cụm, không phải màu.
 */
export const NEN_CUM_SANG = ["#cbd5e1", "#dbe2ea", "#b9c4d2", "#e7ecf1"] as const;
export const NEN_CUM_TOI = ["#27364b", "#1f2c3e", "#2f4058", "#18222f"] as const;

/**
 * Quy đổi sa bàn (mm, góc trái-dưới) sang cảnh (m, tâm khối).
 *
 * ★ Đi qua `mmSangScene()` như mọi thứ khác trong tệp này: viết tay ba lời gọi
 *   `mmSangMet` ở đây là bản sao thứ hai của phép hoán vị trục
 *   (`hopNhatCanhKhongTachThem.unit.test.ts` TỪ CHỐI 3 ghim điều đó).
 *
 * ⚠ Sa bàn đặt mọi toà **trên mặt sàn** (đáy ở `y = 0`), cố ý bỏ `viTriZMm` của
 *   toà: ở cấp tập đoàn cao độ nền của từng toà là một chi tiết không đọc được
 *   ở 2,8 m/px, còn một toà chìm dưới sàn thì đọc thành "thiếu toà". Đây là một
 *   phần của lời khai `laSoDo`, không phải một phép làm tròn giấu đi.
 *
 * @param tenNhaMay `factoryId → tên hiển thị`; thiếu ⇒ nhãn cụm RỖNG (trang lo
 *   câu dự phòng, vì chỉ ở trang mới gọi được `t()`).
 * @param tenDuPhong câu cho toà KHÔNG có tên trong CSDL — ĐÃ dịch.
 */
export function dungSaBanVe(
  saBan: SaBanVao,
  tenNhaMay: ReadonlyMap<number, string>,
  tenDuPhong: (toaNhaId: number) => string,
): { toa: BieuTuongToaVe[]; cum: CumSaBanVe[] } {
  const toa = saBan.bieuTuong.map((v) => {
    const tam = mmSangScene({
      xMm: v.xMm + v.rongMm / 2,
      yMm: v.yMm + v.sauMm / 2,
      zMm: v.caoMm / 2,
    });
    const co = mmSangScene({ xMm: v.rongMm, yMm: v.sauMm, zMm: v.caoMm });
    return {
      toaNhaId: v.toaNhaId,
      factoryId: v.factoryId,
      chiSoCum: v.chiSoCum,
      nhan: v.ten || v.ma || tenDuPhong(v.toaNhaId),
      viTri: tam,
      // `mmSangScene` hoán vị trục, nên bề SÂU về `z` và chiều CAO về `y`.
      co: { rong: co.x, cao: co.y, sau: co.z },
    };
  });

  const cum = saBan.oCum.map((o) => {
    const tam = mmSangScene({ xMm: o.xMm + o.rongMm / 2, yMm: o.yMm + o.sauMm / 2, zMm: 0 });
    const co = mmSangScene({ xMm: o.rongMm, yMm: o.sauMm, zMm: 0 });
    return {
      factoryId: o.factoryId,
      chiSoCum: o.chiSoCum,
      nhan: tenNhaMay.get(o.factoryId) ?? "",
      viTri: tam,
      co: { rong: co.x, sau: co.z },
    };
  });

  return { toa, cum };
}
