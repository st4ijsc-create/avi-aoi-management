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

/** Tham số dựng tập máy vẽ trên mặt bằng. */
export interface ThamSoMayVe {
  may: readonly MayVaoCanh[];
  datChoTheoMay: ReadonlyMap<number, DatChoVaoCanh>;
  kichThuocTheoLoai: ReadonlyMap<string, CoMacDinh>;
  trangThaiTheoMay: ReadonlyMap<number, string>;
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
    const kieu = ts.congCu.mauChoTrangThai(ts.trangThaiTheoMay.get(mv.id));
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
       */
      viTri: mmSangScene({ xMm: d.viTriXMm, yMm: d.viTriYMm, zMm: d.viTriZMm }),
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
      batThuong: kieu.laBatThuong,
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
