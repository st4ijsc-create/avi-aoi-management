/**
 * sinhBoCuc.ts — Thuật toán SINH bố cục nhà máy (§8), module THUẦN và TẤT ĐỊNH.
 *
 * Server gọi lại chính module này qua `boCucService.ts` để không có hai bản cài
 * đặt lệch nhau (§8 mở đầu).
 *
 * ★★★ TẤT ĐỊNH TUYỆT ĐỐI (§8.3): không `Math.random()`, không `Date.now()`,
 *   KHÔNG phụ thuộc thứ tự DB trả về. Mọi vòng lặp chạy trên danh sách ĐÃ SẮP
 *   bằng khoá ổn định (mã, rồi id để phá hoà). Cùng đầu vào → cùng đầu ra
 *   byte-for-byte. Đây là điều kiện của T1/T2 và là điều kiện để nút "Sinh tự
 *   động" an toàn khi bấm lần thứ hai.
 *
 * ★★★ ĐÍNH CHÍNH TRỤC (§8.2 bước 3) — chỗ sai đắt nhất của cả thuật toán:
 *     bề RỘNG ô xưởng (trục X) = số TRẠM   × buocTramMm
 *     bề SÂU  ô xưởng (trục Y) = số CHUYỀN × buocChuyenMm
 *   vì bước 4 xếp chuyền cách nhau theo trục Y và bước 5 xếp trạm dọc trục X.
 *   Viết ngược thì ô đóng gói xoay 90° so với nội dung bên trong, và T4 ("không
 *   chồng lấn") đổ ngay ở quy mô nhỏ nhất.
 *
 * ★★★ GC-1 — `CayPhanCapDauVao` PHẢI mang `toaNha` và `tang`. Không có chúng thì
 *   `xuong.tangId` không có gì để ánh xạ, mọi xưởng đã được gán tầng rơi vào
 *   nhánh dự phòng, và LỰA CHỌN TẦNG CỦA NGƯỜI DÙNG BỊ XOÁ mỗi lần bấm "Sinh
 *   tự động" — đúng kiểu tự huỷ mà cờ `nguon` sinh ra để ngăn.
 *
 * ĐƠN VỊ: mọi số ở đây là MILIMÉT, hệ DB của §5.2 (X đông, Y mặt bằng hướng
 * xuống, Z độ cao). Quy đổi sang scene là việc của `heToaDo.ts`, KHÔNG của
 * module này — hai chỗ chia 1000 là hai chỗ có thể lệch nhau.
 *
 * ★ Module THUẦN: không import three.js, không import react (vitest env "node").
 */

import { type Quat, chuanHoaQuat, quatXoayQuanhTrucDung } from "./heToaDo";
import { KICH_THUOC_MAC_DINH, type KichThuocMm } from "./hinhKhoiMay";

// ---------------------------------------------------------------------------
// §8.1 — Chữ ký
// ---------------------------------------------------------------------------

/** Tham số sinh, milimét. Mặc định ở {@link CAU_HINH_SINH_MAC_DINH}. */
export interface CauHinhSinh {
  /** Khoảng cách giữa 2 chuyền (trục Y mặt bằng). */
  buocChuyenMm: number;
  /** Bước dọc chuyền, giữa 2 trạm (trục X). */
  buocTramMm: number;
  /** Lệch giữa nhiều máy trong CÙNG một trạm (trục Y mặt bằng). */
  buocMayTrongTramMm: number;
  /** Lối đi giữa các hàng xưởng và giữa các xưởng cùng hàng. */
  loiDiMm: number;
  /** Bề rộng sàn tối đa trước khi xuống hàng (shelf packing). */
  rongSanToiDaMm: number;
  /** Kích thước dùng khi loại máy không có trong bảng kích thước. */
  kichThuocMacDinh: { rongMm: number; caoMm: number; sauMm: number };
}

/** Mặc định của §8.1. */
export const CAU_HINH_SINH_MAC_DINH: CauHinhSinh = {
  buocChuyenMm: 6_000,
  buocTramMm: 2_500,
  buocMayTrongTramMm: 1_400,
  loiDiMm: 4_000,
  rongSanToiDaMm: 100_000,
  kichThuocMacDinh: {
    rongMm: KICH_THUOC_MAC_DINH.rongMm,
    caoMm: KICH_THUOC_MAC_DINH.caoMm,
    sauMm: KICH_THUOC_MAC_DINH.sauMm,
  },
};

/**
 * Cây phân cấp đầu vào.
 *
 * ★★★ GC-1: `toaNha` và `tang` là BẮT BUỘC trong chữ ký, không phải tuỳ chọn.
 *   Xem docblock đầu file.
 */
export interface CayPhanCapDauVao {
  nhaMay: { id: number; ma: string; isActive: boolean }[];
  toaNha: { id: number; factoryId: number; ma: string }[];
  tang: { id: number; toaNhaId: number; capSo: number }[];
  xuong: { id: number; factoryId: number; ma: string; tangId: number | null }[];
  chuyen: { id: number; workshopId: number; ma: string }[];
  tram: { id: number; lineId: number; ma: string; thuTu: number | null }[];
  may: {
    id: number;
    stationId: number | null;
    ma: string;
    loaiMay: string;
    isActive: boolean;
  }[];
}

/** Loại thực thể có vị trí (khớp `twinthucTheenum` của §5.3). */
export type LoaiThucThe = "workshop" | "line" | "station" | "machine" | "workstation";

/** Một hàng `twin_dat_cho` sẽ được ghi. */
export interface ViTriDatCho {
  tangId: number;
  loaiThucThe: LoaiThucThe;
  thucTheId: number;
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  rongMm: number;
  caoMm: number;
  sauMm: number;
  /** false: kích thước là GIẢ ĐỊNH theo loại máy (NT-4 — badge "chưa đo"). */
  kichThuocDaDo: boolean;
  quatX: number;
  quatY: number;
  quatZ: number;
  quatW: number;
  nguon: "sinh";
}

/** Loại vật thể cảnh (khớp `twinvatTheenum` của §5.3). */
export type LoaiVatThe =
  | "tuong"
  | "cot"
  | "cua"
  | "vach_ke"
  | "vung"
  | "ke"
  | "pallet"
  | "bang_tai"
  | "rao_an_toan"
  | "bien_bao"
  | "nhom"
  | "khac";

/** Một hàng `twin_vat_the` sẽ được ghi (hạ tầng sinh kèm — §8.2 bước 8). */
export interface ViTriVatThe {
  tangId: number;
  loai: LoaiVatThe;
  ten: string;
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  rongMm: number;
  caoMm: number;
  sauMm: number;
  nguon: "sinh";
}

/** Một mục bị bỏ qua vì đã có bản ghi `nguon='tay'` (§8.2 bước 9). */
export interface MucBoQua {
  loai: string;
  id: number;
  lyDo: string;
}

/** Kết quả sinh. */
export interface KetQuaSinh {
  datCho: ViTriDatCho[];
  vatThe: ViTriVatThe[];
  boQua: MucBoQua[];
  canhBao: string[];
}

// ---------------------------------------------------------------------------
// Hằng số hình học của hạ tầng sinh kèm (§8.2 bước 8)
// ---------------------------------------------------------------------------

/** Chiều cao tường bao sinh kèm, mm. */
export const CAO_TUONG_MM = 6_000;
/** Bề dày tường bao sinh kèm, mm. */
export const DAY_TUONG_MM = 200;
/** Bước lưới cột, mm (§8.2 bước 8: "cột lưới 12 m"). */
export const BUOC_COT_MM = 12_000;
/** Tiết diện cột vuông, mm. */
export const CANH_COT_MM = 400;
/** Bề rộng vạch kẻ lối đi, mm. */
export const RONG_VACH_KE_MM = 150;
/** Biển tên xưởng: kích thước bảng, mm. */
export const BIEN_TEN_RONG_MM = 2_000;
export const BIEN_TEN_CAO_MM = 600;
/** Độ cao treo biển tên xưởng, mm. */
export const BIEN_TEN_DO_CAO_MM = 3_000;

/** Lề trong của ô xưởng: nửa bước, để nội dung không dính mép ô. */
function leOMm(cauHinh: CauHinhSinh): { x: number; y: number } {
  return { x: cauHinh.buocTramMm / 2, y: cauHinh.buocChuyenMm / 2 };
}

// ---------------------------------------------------------------------------
// Khoá thủ công
// ---------------------------------------------------------------------------

/** Khoá dạng "machine:42" — cùng dạng với `daCoThuCong` của §8.1. */
export function khoaThucThe(loai: LoaiThucThe, id: number): string {
  return `${loai}:${id}`;
}

// ---------------------------------------------------------------------------
// Sắp xếp TẤT ĐỊNH
// ---------------------------------------------------------------------------

/** So chuỗi ổn định, không phụ thuộc locale (`localeCompare` KHÔNG tất định). */
function soChuoi(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sắp theo mã rồi id — khoá phá hoà để hai bản ghi cùng mã không đảo chỗ. */
function sapTheoMa<T extends { ma: string; id: number }>(ds: readonly T[]): T[] {
  return [...ds].sort((a, b) => soChuoi(a.ma, b.ma) || a.id - b.id);
}

/** Sắp trạm theo `orderIndex` (fallback `code`), rồi id — §8.2 bước 5. */
function sapTram<T extends { ma: string; id: number; thuTu: number | null }>(
  ds: readonly T[],
): T[] {
  return [...ds].sort((a, b) => {
    const ta = a.thuTu ?? Number.POSITIVE_INFINITY;
    const tb = b.thuTu ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return soChuoi(a.ma, b.ma) || a.id - b.id;
  });
}

/** Nhóm theo khoá, giữ nguyên thứ tự đã sắp của danh sách nguồn. */
function nhomTheo<T>(ds: readonly T[], khoa: (t: T) => number | null): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const t of ds) {
    const k = khoa(t);
    if (k === null) continue;
    const cu = map.get(k);
    if (cu) cu.push(t);
    else map.set(k, [t]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Kích thước máy — §5.3 thứ tự ưu tiên (phần module này biết được)
// ---------------------------------------------------------------------------

/**
 * Kích thước cho một loại máy: bảng `twin_kich_thuoc_loai` trước, mặc định sau.
 * Trả kèm `daDo = false` LUÔN LUÔN ở tầng này: cả hai nhánh đều là GIẢ ĐỊNH
 * theo chủng loại (NT-4). Kích thước ĐO THẬT chỉ đến từ `twin_dat_cho` của một
 * máy cụ thể, mà máy đó khi ấy đã mang `nguon='tay'` và không đi qua đây.
 */
function kichThuocCho(
  loaiMay: string,
  bang: ReadonlyMap<string, KichThuocMm>,
  cauHinh: CauHinhSinh,
): { rongMm: number; caoMm: number; sauMm: number } {
  const tuBang = bang.get(loaiMay);
  if (tuBang) {
    return { rongMm: tuBang.rongMm, caoMm: tuBang.caoMm, sauMm: tuBang.sauMm };
  }
  return { ...cauHinh.kichThuocMacDinh };
}

// ---------------------------------------------------------------------------
// Bước 3 — shelf packing các xưởng
// ---------------------------------------------------------------------------

/** Ô chữ nhật của một xưởng trên mặt sàn, mm. */
export interface ODatXuong {
  xuongId: number;
  /** Góc trên-trái của ô (x nhỏ nhất, y nhỏ nhất). */
  gocXMm: number;
  gocYMm: number;
  rongMm: number;
  sauMm: number;
}

/**
 * Xếp kệ (shelf packing) các ô xưởng trên một mặt sàn (§8.2 bước 3).
 *
 * Sắp GIẢM DẦN theo bề rộng (khoá phá hoà: xuongId) rồi xếp thành hàng; xuống
 * hàng khi vượt `rongSanToiDaMm`; chừa `loiDiMm` giữa các hàng và giữa các
 * xưởng cùng hàng.
 *
 * ⚠ Ô ĐẦU TIÊN của một hàng luôn được đặt kể cả khi nó RỘNG HƠN `rongSanToiDaMm`:
 *   nếu không, một xưởng quá khổ sẽ lặp vô hạn hoặc bị bỏ rơi im lặng. Nó tràn
 *   ra ngoài biên và việc đó phải nhìn thấy được, không phải biến mất.
 */
export function xepKeXuong(
  o: readonly { xuongId: number; rongMm: number; sauMm: number }[],
  cauHinh: CauHinhSinh,
): ODatXuong[] {
  const daSap = [...o].sort((a, b) => b.rongMm - a.rongMm || a.xuongId - b.xuongId);
  const ket: ODatXuong[] = [];
  let conX = 0;
  let conY = 0;
  let caoHang = 0;
  for (const x of daSap) {
    const daCoTrongHang = conX > 0;
    if (daCoTrongHang && conX + x.rongMm > cauHinh.rongSanToiDaMm) {
      conY += caoHang + cauHinh.loiDiMm;
      conX = 0;
      caoHang = 0;
    }
    ket.push({
      xuongId: x.xuongId,
      gocXMm: conX,
      gocYMm: conY,
      rongMm: x.rongMm,
      sauMm: x.sauMm,
    });
    conX += x.rongMm + cauHinh.loiDiMm;
    if (x.sauMm > caoHang) caoHang = x.sauMm;
  }
  // Trả về theo xuongId để kết quả TẤT ĐỊNH bất kể thứ tự đầu vào.
  return ket.sort((a, b) => a.xuongId - b.xuongId);
}

// ---------------------------------------------------------------------------
// §8.2 — Thuật toán chính
// ---------------------------------------------------------------------------

/**
 * Sinh bố cục cho toàn cây phân cấp (§8.2, 9 bước).
 *
 * @param cay              cây phân cấp — xem GC-1
 * @param kichThuocTheoLoai bảng `twin_kich_thuoc_loai`, khoá theo `machineType`
 * @param daCoThuCong      khoá dạng "machine:42" của mọi bản ghi `nguon='tay'`
 * @param cauHinh          tham số sinh
 */
export function sinhBoCuc(
  cay: CayPhanCapDauVao,
  kichThuocTheoLoai: ReadonlyMap<string, KichThuocMm>,
  daCoThuCong: ReadonlySet<string>,
  cauHinh: CauHinhSinh = CAU_HINH_SINH_MAC_DINH,
): KetQuaSinh {
  const datCho: ViTriDatCho[] = [];
  const vatThe: ViTriVatThe[] = [];
  const boQua: MucBoQua[] = [];
  const canhBao: string[] = [];

  // --- Bước 1+2: toà nhà & tầng, ánh xạ xưởng → tầng (GC-1) ----------------
  const nhaMayHoatDong = sapTheoMa(cay.nhaMay.filter((n) => n.isActive));
  const toaNhaTheoNhaMay = nhomTheo(sapTheoMa(cay.toaNha), (t) => t.factoryId);
  const tangTheoId = new Map(cay.tang.map((t) => [t.id, t]));
  // Tầng của mỗi toà, sắp theo capSo tăng dần (id phá hoà) — "tầng 1 của toà".
  const tangTheoToa = new Map<number, typeof cay.tang>();
  for (const t of [...cay.tang].sort((a, b) => a.capSo - b.capSo || a.id - b.id)) {
    const cu = tangTheoToa.get(t.toaNhaId);
    if (cu) cu.push(t);
    else tangTheoToa.set(t.toaNhaId, [t]);
  }

  const xuongTheoNhaMay = nhomTheo(sapTheoMa(cay.xuong), (x) => x.factoryId);
  const chuyenTheoXuong = nhomTheo(sapTheoMa(cay.chuyen), (c) => c.workshopId);
  const tramTheoChuyen = nhomTheo(sapTram(cay.tram), (t) => t.lineId);
  const mayHoatDong = sapTheoMa(cay.may.filter((m) => m.isActive));
  const mayTheoTram = nhomTheo(mayHoatDong, (m) => m.stationId);

  // --- Bước 9 (phần cảnh báo cấu trúc, đo TRƯỚC khi xếp) -------------------
  const mayKhongTram = mayHoatDong.filter((m) => m.stationId === null);
  if (mayKhongTram.length > 0) {
    canhBao.push(
      `${mayKhongTram.length} máy không thuộc trạm nào — không xếp được chỗ, đưa vào Khu chờ`,
    );
  }
  const chuyenKhongTram = cay.chuyen.filter(
    (c) => (tramTheoChuyen.get(c.id) ?? []).length === 0,
  );
  if (chuyenKhongTram.length > 0) {
    canhBao.push(`${chuyenKhongTram.length} chuyền không có trạm nào`);
  }
  const xuongKhongChuyen = cay.xuong.filter(
    (x) => (chuyenTheoXuong.get(x.id) ?? []).length === 0,
  );
  if (xuongKhongChuyen.length > 0) {
    canhBao.push(`${xuongKhongChuyen.length} xưởng không có chuyền nào`);
  }

  // Gom xưởng theo TẦNG đích, để shelf packing chạy độc lập trên từng mặt sàn.
  const xuongTheoTang = new Map<number, typeof cay.xuong>();
  const xuongKhongTang: typeof cay.xuong = [];

  for (const nhaMay of nhaMayHoatDong) {
    const dsXuong = xuongTheoNhaMay.get(nhaMay.id) ?? [];
    if (dsXuong.length === 0) continue;
    const dsToa = toaNhaTheoNhaMay.get(nhaMay.id) ?? [];
    // Bước 1 (QĐ-5): mỗi nhà máy có máy → 1 toà, 1 tầng. Đã tồn tại → GIỮ NGUYÊN.
    const toaDau = dsToa[0];
    const tangMacDinh = toaDau ? (tangTheoToa.get(toaDau.id) ?? [])[0] : undefined;

    for (const x of dsXuong) {
      // Bước 2: xưởng đã có tangId → GIỮ NGUYÊN tầng đó (đọc qua mảng `tang`).
      // ★★★ GC-1 sống ở đúng dòng này: không có `cay.tang` thì `tangTheoId` rỗng,
      //     mọi xưởng rơi xuống `tangMacDinh` và lựa chọn của người dùng bị xoá.
      const tangDaGan = x.tangId !== null ? tangTheoId.get(x.tangId) : undefined;
      const tang = tangDaGan ?? tangMacDinh;
      if (!tang) {
        xuongKhongTang.push(x);
        continue;
      }
      const cu = xuongTheoTang.get(tang.id);
      if (cu) cu.push(x);
      else xuongTheoTang.set(tang.id, [x]);
    }
  }

  if (xuongKhongTang.length > 0) {
    canhBao.push(
      `${xuongKhongTang.length} xưởng không có toà nhà/tầng để đặt — cần tạo toà nhà trước`,
    );
  }

  // --- Bước 3..8, chạy trên từng TẦNG -------------------------------------
  const tangIds = [...xuongTheoTang.keys()].sort((a, b) => a - b);
  for (const tangId of tangIds) {
    const dsXuong = sapTheoMa(xuongTheoTang.get(tangId) ?? []);

    // Bước 3: kích thước ô mỗi xưởng.
    // ★★★ ĐÍNH CHÍNH TRỤC: rộng (X) = số TRẠM; sâu (Y) = số CHUYỀN.
    const le = leOMm(cauHinh);
    const oNguon = dsXuong.map((x) => {
      const dsChuyen = chuyenTheoXuong.get(x.id) ?? [];
      const soChuyen = Math.max(1, dsChuyen.length);
      const soTramNhieuNhat = Math.max(
        1,
        ...dsChuyen.map((c) => (tramTheoChuyen.get(c.id) ?? []).length),
      );
      return {
        xuongId: x.id,
        rongMm: soTramNhieuNhat * cauHinh.buocTramMm + 2 * le.x,
        sauMm: soChuyen * cauHinh.buocChuyenMm + 2 * le.y,
      };
    });
    const oTheoXuong = new Map(
      xepKeXuong(oNguon, cauHinh).map((o) => [o.xuongId, o]),
    );

    for (const x of dsXuong) {
      const o = oTheoXuong.get(x.id);
      if (!o) continue;

      // Ô xưởng — hàng `twin_dat_cho` loại 'workshop'.
      ghiHoacBoQua(
        {
          tangId,
          loaiThucThe: "workshop",
          thucTheId: x.id,
          viTriXMm: o.gocXMm + o.rongMm / 2,
          viTriYMm: o.gocYMm + o.sauMm / 2,
          viTriZMm: 0,
          rongMm: o.rongMm,
          caoMm: CAO_TUONG_MM,
          sauMm: o.sauMm,
          kichThuocDaDo: false,
          ...phangQuat(quatXoayQuanhTrucDung(0)),
          nguon: "sinh",
        },
        daCoThuCong,
        datCho,
        boQua,
      );

      // Bước 8 (phần theo xưởng): biển tên xưởng.
      vatThe.push({
        tangId,
        loai: "bien_bao",
        ten: `Biển tên xưởng ${x.ma}`,
        viTriXMm: o.gocXMm + o.rongMm / 2,
        viTriYMm: o.gocYMm,
        viTriZMm: BIEN_TEN_DO_CAO_MM,
        rongMm: BIEN_TEN_RONG_MM,
        caoMm: BIEN_TEN_CAO_MM,
        sauMm: DAY_TUONG_MM,
        nguon: "sinh",
      });

      // Bước 4: chuyền trong xưởng — dải song song DỌC TRỤC X, cách nhau
      // buocChuyenMm theo trục Y. Thứ tự theo `production_lines.code`.
      const dsChuyen = sapTheoMa(chuyenTheoXuong.get(x.id) ?? []);
      dsChuyen.forEach((c, iChuyen) => {
        // Tâm dải chuyền thứ i: lề + (i + 0.5) × bước.
        const yChuyen = o.gocYMm + le.y + (iChuyen + 0.5) * cauHinh.buocChuyenMm;
        const dsTram = sapTram(tramTheoChuyen.get(c.id) ?? []);

        ghiHoacBoQua(
          {
            tangId,
            loaiThucThe: "line",
            thucTheId: c.id,
            // §10C.1: vị trí của hàng 'line' BỊ BỎ QUA khi đọc — hàng này chỉ
            // giữ nhãn/màu. Ghi tâm dải để hàng không mang số rác, KHÔNG phải
            // để ai đó đọc ngược ra hình học Line (dùng `phamViLine.ts`).
            viTriXMm: o.gocXMm + o.rongMm / 2,
            viTriYMm: yChuyen,
            viTriZMm: 0,
            rongMm: Math.max(1, dsTram.length) * cauHinh.buocTramMm,
            caoMm: 1,
            sauMm: cauHinh.buocChuyenMm,
            kichThuocDaDo: false,
            ...phangQuat(quatXoayQuanhTrucDung(0)),
            nguon: "sinh",
          },
          daCoThuCong,
          datCho,
          boQua,
        );

        // Bước 7: hướng máy — dải CHẴN quay 0°, dải LẺ quay 180°, để mặt trước
        // hai dải liền kề cùng hướng ra lối đi chung giữa chúng.
        const gocRad = iChuyen % 2 === 0 ? 0 : Math.PI;
        const quat = chuanHoaQuat(quatXoayQuanhTrucDung(gocRad));

        // Bước 5: trạm dọc trục X theo orderIndex.
        dsTram.forEach((t, iTram) => {
          const xTram = o.gocXMm + le.x + (iTram + 0.5) * cauHinh.buocTramMm;

          ghiHoacBoQua(
            {
              tangId,
              loaiThucThe: "station",
              thucTheId: t.id,
              viTriXMm: xTram,
              viTriYMm: yChuyen,
              viTriZMm: 0,
              rongMm: cauHinh.buocTramMm,
              caoMm: 1,
              sauMm: cauHinh.buocChuyenMm,
              kichThuocDaDo: false,
              ...phangQuat(quat),
              nguon: "sinh",
            },
            daCoThuCong,
            datCho,
            boQua,
          );

          // Bước 6: máy trong trạm — máy đầu ở TÂM trạm; máy 2, 3… lệch
          // ±buocMayTrongTramMm theo trục Y mặt bằng (trục Z của scene, §5.2:
          // "lệch theo trục Z" của spec là trục Z SCENE = Y mặt bằng).
          const dsMay = mayTheoTram.get(t.id) ?? [];
          dsMay.forEach((m, iMay) => {
            const co = kichThuocCho(m.loaiMay, kichThuocTheoLoai, cauHinh);
            ghiHoacBoQua(
              {
                tangId,
                loaiThucThe: "machine",
                thucTheId: m.id,
                viTriXMm: xTram,
                viTriYMm: yChuyen + lechTrongTram(iMay, cauHinh.buocMayTrongTramMm),
                viTriZMm: 0,
                rongMm: co.rongMm,
                caoMm: co.caoMm,
                sauMm: co.sauMm,
                // NT-4: kích thước theo CHỦNG LOẠI là giả định, không phải số đo.
                kichThuocDaDo: false,
                ...phangQuat(quat),
                nguon: "sinh",
              },
              daCoThuCong,
              datCho,
              boQua,
            );
          });
        });
      });
    }

    // Bước 8: hạ tầng của cả tầng — tường bao, sàn, cột lưới, vạch kẻ lối đi.
    vatThe.push(...sinhHaTangTang(tangId, [...oTheoXuong.values()], cauHinh));
  }

  return { datCho, vatThe, boQua, canhBao };
}

// ---------------------------------------------------------------------------
// Phụ trợ
// ---------------------------------------------------------------------------

/** Tách quaternion thành 4 trường phẳng của `twin_dat_cho`. */
function phangQuat(q: Quat): Pick<ViTriDatCho, "quatX" | "quatY" | "quatZ" | "quatW"> {
  const c = chuanHoaQuat(q);
  return { quatX: c.x, quatY: c.y, quatZ: c.z, quatW: c.w };
}

/**
 * Độ lệch của máy thứ `i` trong một trạm: 0, +b, −b, +2b, −2b…
 *
 * Toả ĐỀU HAI PHÍA quanh tâm trạm chứ không xếp một chiều: máy thứ 4 xếp một
 * chiều sẽ nằm cách tâm 3 bước và lấn sang dải chuyền kế bên, còn toả hai phía
 * thì nó chỉ cách tâm 2 bước.
 */
export function lechTrongTram(i: number, buocMm: number): number {
  if (i <= 0) return 0;
  const bac = Math.ceil(i / 2);
  const dau = i % 2 === 1 ? 1 : -1;
  return dau * bac * buocMm;
}

/**
 * Ghi một hàng `twin_dat_cho`, HOẶC đưa vào `boQua` nếu thực thể đã có bản ghi
 * `nguon='tay'` (§8.2 bước 9 + T3).
 *
 * Đây là điểm DUY NHẤT trong module kiểm `daCoThuCong` — mọi loại thực thể đi
 * qua đây. Kiểm rải rác ở nhiều nhánh là cách chắc chắn để bỏ sót một nhánh, và
 * nhánh bỏ sót đó sẽ ĐÈ lên vị trí người dùng đã chỉnh tay.
 */
function ghiHoacBoQua(
  hang: ViTriDatCho,
  daCoThuCong: ReadonlySet<string>,
  datCho: ViTriDatCho[],
  boQua: MucBoQua[],
): void {
  const khoa = khoaThucThe(hang.loaiThucThe, hang.thucTheId);
  if (daCoThuCong.has(khoa)) {
    boQua.push({
      loai: hang.loaiThucThe,
      id: hang.thucTheId,
      lyDo: "đã chỉnh tay (nguon='tay') — giữ nguyên",
    });
    return;
  }
  datCho.push(hang);
}

/**
 * Bước 8 — hạ tầng sinh kèm cho một tầng: sàn, 4 tường bao, cột lưới 12 m,
 * vạch kẻ lối đi giữa các HÀNG xưởng.
 *
 * Biên tầng suy ra từ bao ngoài các ô xưởng đã xếp, cộng một lối đi mỗi phía —
 * không đọc `factories.floorWidthM` (§10A.0: SIM-FAC có 1500 × 1200 "mét", số
 * rác do ai đó nhập pixel vào ô mét).
 *
 * Tầng KHÔNG có xưởng nào trả về mảng rỗng: sinh 4 bức tường quanh một khoảng
 * trống là dựng một cái hộp rỗng mà người dùng không hiểu vì sao có.
 */
export function sinhHaTangTang(
  tangId: number,
  oXuong: readonly ODatXuong[],
  cauHinh: CauHinhSinh,
): ViTriVatThe[] {
  if (oXuong.length === 0) return [];
  const daSap = [...oXuong].sort((a, b) => a.xuongId - b.xuongId);

  const minX = Math.min(...daSap.map((o) => o.gocXMm)) - cauHinh.loiDiMm;
  const minY = Math.min(...daSap.map((o) => o.gocYMm)) - cauHinh.loiDiMm;
  const maxX = Math.max(...daSap.map((o) => o.gocXMm + o.rongMm)) + cauHinh.loiDiMm;
  const maxY = Math.max(...daSap.map((o) => o.gocYMm + o.sauMm)) + cauHinh.loiDiMm;
  const rong = maxX - minX;
  const sau = maxY - minY;
  const tamX = (minX + maxX) / 2;
  const tamY = (minY + maxY) / 2;

  const ket: ViTriVatThe[] = [];

  // Sàn — khối mỏng, mặt trên tại z = 0.
  ket.push({
    tangId,
    loai: "khac",
    ten: "Sàn tầng",
    viTriXMm: tamX,
    viTriYMm: tamY,
    viTriZMm: -DAY_TUONG_MM / 2,
    rongMm: rong,
    caoMm: DAY_TUONG_MM,
    sauMm: sau,
    nguon: "sinh",
  });

  // 4 tường bao. Hai tường theo trục X kéo hết bề rộng; hai tường theo trục Y
  // RÚT NGẮN đúng hai lần bề dày để bốn góc KHÔNG chồng nhau (cùng quy ước với
  // `boCucTang.sinhTuongBao` — chồng góc làm mọi phép đếm thể tích sai một
  // lượng nhỏ mà không ai truy ra).
  const sauTuongDoc = Math.max(sau - 2 * DAY_TUONG_MM, 0);
  const tuong: [string, number, number, number, number][] = [
    ["Tường Bắc", tamX, minY + DAY_TUONG_MM / 2, rong, DAY_TUONG_MM],
    ["Tường Nam", tamX, maxY - DAY_TUONG_MM / 2, rong, DAY_TUONG_MM],
    ["Tường Tây", minX + DAY_TUONG_MM / 2, tamY, DAY_TUONG_MM, sauTuongDoc],
    ["Tường Đông", maxX - DAY_TUONG_MM / 2, tamY, DAY_TUONG_MM, sauTuongDoc],
  ];
  for (const [ten, cx, cy, r, s] of tuong) {
    ket.push({
      tangId,
      loai: "tuong",
      ten,
      viTriXMm: cx,
      viTriYMm: cy,
      viTriZMm: CAO_TUONG_MM / 2,
      rongMm: r,
      caoMm: CAO_TUONG_MM,
      sauMm: s,
      nguon: "sinh",
    });
  }

  // Cột lưới 12 m — chỉ trong lòng tầng, không đè lên tường.
  const soCotX = Math.max(0, Math.floor(rong / BUOC_COT_MM) - 1);
  const soCotY = Math.max(0, Math.floor(sau / BUOC_COT_MM) - 1);
  for (let i = 1; i <= soCotX; i++) {
    for (let j = 1; j <= soCotY; j++) {
      ket.push({
        tangId,
        loai: "cot",
        ten: `Cột ${i}-${j}`,
        viTriXMm: minX + i * BUOC_COT_MM,
        viTriYMm: minY + j * BUOC_COT_MM,
        viTriZMm: CAO_TUONG_MM / 2,
        rongMm: CANH_COT_MM,
        caoMm: CAO_TUONG_MM,
        sauMm: CANH_COT_MM,
        nguon: "sinh",
      });
    }
  }

  // Vạch kẻ lối đi giữa các HÀNG xưởng: một vạch chạy ngang ở mỗi ranh giới
  // hàng. Hàng = tập ô cùng `gocYMm` (shelf packing sinh ra đúng như vậy).
  const gocYs = [...new Set(daSap.map((o) => o.gocYMm))].sort((a, b) => a - b);
  for (let i = 1; i < gocYs.length; i++) {
    const hangTruoc = daSap.filter((o) => o.gocYMm === gocYs[i - 1]);
    const dayHangTruoc = Math.max(...hangTruoc.map((o) => o.gocYMm + o.sauMm));
    ket.push({
      tangId,
      loai: "vach_ke",
      ten: `Vạch lối đi hàng ${i}`,
      viTriXMm: tamX,
      viTriYMm: (dayHangTruoc + gocYs[i]) / 2,
      viTriZMm: 0,
      rongMm: rong,
      caoMm: 1,
      sauMm: RONG_VACH_KE_MM,
      nguon: "sinh",
    });
  }

  return ket;
}
