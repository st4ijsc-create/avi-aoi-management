/**
 * trangThaiThietKe.ts — MÔ HÌNH THUẦN của màn Thiết kế `/twin-studio` (§7.1).
 *
 * ★ Vì sao là module THUẦN (`.ts`, không `.tsx`, không import react/three):
 *   `vitest.config.ts` chạy `environment: "node"` và chỉ thu thập
 *   `client/src/**\/*.unit.test.ts`. Mọi thứ đáng đo của màn này — cây phân cấp,
 *   khu chờ xếp chỗ, dải sức khoẻ dữ liệu, đồng bộ chọn hai chiều, gom thay đổi
 *   để lưu — là biến đổi dữ liệu thuần. Để chúng trong component `.tsx` nghĩa là
 *   KHÔNG ĐO ĐƯỢC, và đó chính là lớp lỗi §1.6 của spec.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐO ĐƯỢC 2026-09-06 — SPEC SAI SỐ, MÃ THEO SỐ ĐO
 * ════════════════════════════════════════════════════════════════════════════
 * Spec §7.1 vẽ dải sức khoẻ là "36/43 máy đã xếp chỗ · 7 chờ xếp". Đo trên DB
 * dev bằng HAI mô hình rời nhau (luật G3/BG-127) cho ra số KHÁC:
 *
 *   Mô hình 1 — LIỆT KÊ toàn phân bố `twin_dat_cho`:
 *     machine=42 · station=36 · line=3 · workshop=1 (tất cả nguon='sinh')
 *   Mô hình 2 — ĐẾM ĐỐI CHIẾU qua join `machines`:
 *     machines isActive = 42 · machines tổng = 43
 *     twin_dat_cho machine khớp máy ĐANG SỐNG = 41  ← LỆCH 1 so với mô hình 1
 *
 * Hàng lệch là `twin_dat_cho.id=776` → `machines.id=250`
 * (`SN-ST4I-TRIAL-WELD-20260818`, `isActive=false`). Tức là bảng đặt-chỗ đang
 * giữ một vị trí cho một máy ĐÃ NGỪNG HOẠT ĐỘNG.
 *
 * ⇒ Hệ quả cho mã này: "đã xếp chỗ" KHÔNG được đếm bằng `twin_dat_cho.length`.
 *   Đếm thế cho ra 42 trong khi chỉ có 41 máy sống thật sự đứng trên sàn, và
 *   con số dôi ra đó không tương ứng với vật thể nào người dùng nhìn thấy.
 *   {@link tinhSucKhoeDuLieu} vì vậy đếm theo GIAO của hai tập (máy đang sống ∩
 *   có đặt chỗ) và tách riêng ô `datChoMoCoi` để chỗ lệch TỰ KÊU thay vì bị làm
 *   tròn mất — đúng tinh thần NT-3 ("không có dữ liệu ≠ bình thường").
 *
 * Số thật của SIM-FAC (factoryId=1): 41 máy sống, 41 đã xếp, 0 chờ xếp.
 * Máy chờ xếp DUY NHẤT của toàn hệ là id=257 thuộc factoryId=18 — nhà máy đó
 * chưa có toà nhà nào, nên nó chờ theo đúng nghĩa "chưa có chỗ để đặt".
 *
 * ĐƠN VỊ: mọi số `*Mm` là milimét (hệ DB). Quy đổi sang mét chỉ xảy ra ở tầng
 * hiển thị; xem `heToaDo.ts`. Module này KHÔNG quy đổi.
 */

import { type BBox, bboxTuTamVaKichThuoc } from "../heToaDo";
import { KICH_THUOC_MAC_DINH, type KichThuocMm } from "../hinhKhoiMay";
import type { LoaiThucThe } from "../sinhBoCuc";

// ---------------------------------------------------------------------------
// Khoá vật thể
// ---------------------------------------------------------------------------

/**
 * Khoá ổn định của một node, dạng `"machine:42"`.
 *
 * ★ CÙNG DẠNG với `khoaThucThe` của `sinhBoCuc.ts` và với `daCoThuCong` của §8.1
 *   — cố ý. Ba module (sinh bố cục, lịch sử thao tác, màn Thiết kế) phải nói
 *   cùng một thứ tiếng về danh tính vật thể, nếu không thì "giữ nguyên máy đã
 *   chỉnh tay" so khoá với một tập khoá khác dạng và KHÔNG BAO GIỜ khớp — lỗi
 *   câm hoàn hảo, vì kết quả là "sinh lại đè hết" mà không có thông báo nào.
 */
export type KhoaNode = string;

/** Dựng khoá node. Cùng công thức với `sinhBoCuc.khoaThucThe`. */
export function khoaNode(loai: LoaiThucThe, id: number): KhoaNode {
  return `${loai}:${id}`;
}

/** Tách khoá node ngược lại. Trả `null` nếu không đúng dạng. */
export function tachKhoaNode(khoa: KhoaNode): { loai: LoaiThucThe; id: number } | null {
  const viTri = khoa.indexOf(":");
  if (viTri <= 0) return null;
  const loai = khoa.slice(0, viTri) as LoaiThucThe;
  const id = Number(khoa.slice(viTri + 1));
  if (!Number.isInteger(id) || id <= 0) return null;
  return { loai, id };
}

// ---------------------------------------------------------------------------
// Đầu vào — hình dạng TỐI THIỂU đọc từ server
// ---------------------------------------------------------------------------

/** Một máy trong cây, đã kèm đường dẫn phân cấp. */
export interface MayDauVao {
  id: number;
  ma: string;
  ten?: string | null;
  loaiMay: string;
  isActive: boolean;
  stationId: number | null;
}

export interface TramDauVao {
  id: number;
  ma: string;
  ten?: string | null;
  lineId: number;
  thuTu: number | null;
}

export interface ChuyenDauVao {
  id: number;
  ma: string;
  ten?: string | null;
  workshopId: number;
}

export interface XuongDauVao {
  id: number;
  ma: string;
  ten?: string | null;
  factoryId: number;
  tangId: number | null;
}

/**
 * Một hàng `twin_dat_cho` đã quy numeric → number.
 *
 * ⚠ numeric(14,3) về từ drizzle là **string**; quy đổi phải xảy ra TRƯỚC khi
 * vào module này (xem docblock `drizzle/schema/twin3d.ts`). Kiểu `number` ở đây
 * là hợp đồng: cộng thẳng hai string cho ra nối chuỗi ("1000"+"500"="1000500")
 * và không throw.
 */
export interface DatChoDauVao {
  id: number;
  tangId: number;
  loaiThucThe: LoaiThucThe;
  thucTheId: number;
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  rongMm: number | null;
  caoMm: number | null;
  sauMm: number | null;
  kichThuocDaDo: boolean;
  quatX: number;
  quatY: number;
  quatZ: number;
  quatW: number;
  daKhoa: boolean;
  hienThi: boolean;
  nguon: "sinh" | "tay" | "nhap";
}

// ---------------------------------------------------------------------------
// §7.1 — Dải "Sức khoẻ dữ liệu"
// ---------------------------------------------------------------------------

/**
 * Ba con số của dải trên cùng, cộng hai ô trung thực dữ liệu.
 *
 * ★ NT-3.5 — "đếm rỗng khác đếm bằng 0": `chuaTai = true` nghĩa là chưa có dữ
 *   liệu để đếm, và UI phải hiện `—` chứ KHÔNG hiện `0`. Nếu gộp hai ca đó vào
 *   một số 0 thì "chưa tải xong" trông y hệt "đã đo, không có máy nào" — và
 *   người dùng tin vào một sự thật không ai đo.
 */
export interface SucKhoeDuLieu {
  /** Máy đang hoạt động VÀ có hàng `twin_dat_cho`. */
  daXepCho: number;
  /** Máy đang hoạt động NHƯNG chưa có hàng `twin_dat_cho`. */
  choXepCho: number;
  /** Máy đã xếp chỗ mà `kichThuocDaDo = false` ⇒ badge vàng "chưa đo" (NT-4). */
  chuaDoKichThuoc: number;
  /**
   * ★ Hàng `twin_dat_cho` loại 'machine' TRỎ VÀO MÁY KHÔNG CÒN SỐNG (hoặc không
   *   tồn tại). ĐO ĐƯỢC = 1 trên DB dev (datCho 776 → machine 250 isActive=false).
   *   Ô riêng chứ không im lặng bỏ qua: đây là dữ liệu lệch có thật, và NT-3 cấm
   *   làm tròn nó thành "bình thường".
   */
  datChoMoCoi: number;
  /** Tổng máy đang hoạt động trong phạm vi — mẫu số của dải. */
  tongMaySong: number;
  /** true = chưa có gì để đếm ⇒ UI hiện "—". */
  chuaTai: boolean;
}

/**
 * Tính dải sức khoẻ dữ liệu.
 *
 * ★ ĐẾM THEO GIAO CỦA HAI TẬP, không theo `datCho.length` — xem docblock đầu
 *   tệp. `datCho` chở cả station/line/workshop nên lọc `loaiThucThe==='machine'`
 *   là bắt buộc; quên lọc cho ra 82 "máy đã xếp" trên một hệ có 42 máy.
 *
 * @param may     máy trong phạm vi đang xem (đã lọc theo nhà máy/tầng ở tầng gọi)
 * @param datCho  MỌI hàng đặt chỗ của phạm vi đó
 * @param chuaTai true khi query còn đang chạy — ép `chuaTai` bất kể số đếm
 */
export function tinhSucKhoeDuLieu(
  may: readonly MayDauVao[],
  datCho: readonly DatChoDauVao[],
  chuaTai = false,
): SucKhoeDuLieu {
  const maySong = may.filter((m) => m.isActive);
  const idSong = new Set(maySong.map((m) => m.id));

  const datChoMay = datCho.filter((d) => d.loaiThucThe === "machine");
  const datChoTheoMay = new Map<number, DatChoDauVao>();
  let moCoi = 0;
  for (const d of datChoMay) {
    if (idSong.has(d.thucTheId)) datChoTheoMay.set(d.thucTheId, d);
    else moCoi += 1;
  }

  let chuaDo = 0;
  for (const d of datChoTheoMay.values()) if (!d.kichThuocDaDo) chuaDo += 1;

  return {
    daXepCho: datChoTheoMay.size,
    choXepCho: maySong.length - datChoTheoMay.size,
    chuaDoKichThuoc: chuaDo,
    datChoMoCoi: moCoi,
    tongMaySong: maySong.length,
    chuaTai: chuaTai || (maySong.length === 0 && datCho.length === 0),
  };
}

// ---------------------------------------------------------------------------
// §7.1 — Cây phân cấp + Khu chờ xếp chỗ
// ---------------------------------------------------------------------------

/** Một node của cây trái. */
export interface NodeCay {
  khoa: KhoaNode;
  loai: LoaiThucThe;
  id: number;
  /** Nhãn hiển thị — mã là chính, tên là phụ (mã ngắn và duy nhất). */
  nhan: string;
  /** Chuỗi dùng để LỌC: gộp mã + tên, đã hạ chữ thường. */
  chuoiLoc: string;
  con: NodeCay[];
  /**
   * ★ true = máy chưa có `twin_dat_cho` ⇒ vẽ MỜ + VIỀN NÉT ĐỨT (§7.1).
   *   Giữ chúng TRONG cây thay vì ẩn: "nếu ẩn chúng đi, người dùng không bao giờ
   *   biết mình thiếu N máy" — chính câu của spec §7.1.
   */
  choXepCho: boolean;
  /** Khoá của node cha, `null` ở gốc. Dùng để mở đúng nhánh khi chọn từ 3D. */
  cha: KhoaNode | null;
}

/** Kết quả dựng cây: nhánh chính + nhánh "Khu chờ xếp chỗ". */
export interface CayThietKe {
  /** Cây xưởng → chuyền → trạm → máy (chỉ máy ĐÃ có đặt chỗ). */
  goc: NodeCay[];
  /** ★ §7.1 — máy chưa có `twin_dat_cho`, phẳng, không lồng. */
  khuCho: NodeCay[];
  /** Tra ngược khoá → node, cho đồng bộ 2 chiều với 3D. */
  theoKhoa: ReadonlyMap<KhoaNode, NodeCay>;
}

function nhanCua(ma: string, ten?: string | null): string {
  return ten && ten !== ma ? `${ma} — ${ten}` : ma;
}

function chuoiLocCua(ma: string, ten?: string | null): string {
  return `${ma} ${ten ?? ""}`.toLowerCase();
}

/**
 * Dựng cây phân cấp của màn Thiết kế.
 *
 * ★ Máy KHÔNG có đặt chỗ đi vào {@link CayThietKe.khuCho}, KHÔNG đi vào nhánh
 *   trạm của nó — kể cả khi nó có `stationId`. Lý do: cây chính là "cái đang
 *   đứng trên mặt sàn"; một máy chưa xếp chỗ không có vị trí nào để camera bay
 *   tới, nên để nó trong nhánh trạm sẽ tạo ra một node click-vào-không-đi-đâu.
 *
 * ★ Máy `isActive=false` bị loại HOÀN TOÀN — cả hai nhánh. Máy ngừng hoạt động
 *   không phải "chờ xếp chỗ": nó không cần chỗ.
 *
 * Thứ tự: TẤT ĐỊNH theo mã (`sapTheoMa` cùng công thức `sinhBoCuc.ts`), không
 * `localeCompare` (không tất định giữa các locale).
 */
export function dungCayThietKe(
  xuong: readonly XuongDauVao[],
  chuyen: readonly ChuyenDauVao[],
  tram: readonly TramDauVao[],
  may: readonly MayDauVao[],
  datCho: readonly DatChoDauVao[],
): CayThietKe {
  const coDatCho = new Set(
    datCho.filter((d) => d.loaiThucThe === "machine").map((d) => d.thucTheId),
  );
  const maySong = [...may].filter((m) => m.isActive).sort(soSanhMa);
  const theoKhoa = new Map<KhoaNode, NodeCay>();

  const mayTheoTram = new Map<number, MayDauVao[]>();
  const khuChoMay: MayDauVao[] = [];
  for (const m of maySong) {
    if (!coDatCho.has(m.id) || m.stationId === null) {
      khuChoMay.push(m);
      continue;
    }
    const cu = mayTheoTram.get(m.stationId);
    if (cu) cu.push(m);
    else mayTheoTram.set(m.stationId, [m]);
  }

  const tramTheoChuyen = new Map<number, TramDauVao[]>();
  for (const t of [...tram].sort(soSanhTram)) {
    const cu = tramTheoChuyen.get(t.lineId);
    if (cu) cu.push(t);
    else tramTheoChuyen.set(t.lineId, [t]);
  }

  const chuyenTheoXuong = new Map<number, ChuyenDauVao[]>();
  for (const c of [...chuyen].sort(soSanhMa)) {
    const cu = chuyenTheoXuong.get(c.workshopId);
    if (cu) cu.push(c);
    else chuyenTheoXuong.set(c.workshopId, [c]);
  }

  function ghi(n: NodeCay): NodeCay {
    theoKhoa.set(n.khoa, n);
    return n;
  }

  const goc: NodeCay[] = [...xuong].sort(soSanhMa).map((x) => {
    const khoaX = khoaNode("workshop", x.id);
    const conChuyen = (chuyenTheoXuong.get(x.id) ?? []).map((c) => {
      const khoaC = khoaNode("line", c.id);
      const conTram = (tramTheoChuyen.get(c.id) ?? []).map((t) => {
        const khoaT = khoaNode("station", t.id);
        const conMay = (mayTheoTram.get(t.id) ?? []).map((m) =>
          ghi({
            khoa: khoaNode("machine", m.id),
            loai: "machine",
            id: m.id,
            nhan: nhanCua(m.ma, m.ten),
            chuoiLoc: chuoiLocCua(m.ma, m.ten),
            con: [],
            choXepCho: false,
            cha: khoaT,
          }),
        );
        return ghi({
          khoa: khoaT,
          loai: "station",
          id: t.id,
          nhan: nhanCua(t.ma, t.ten),
          chuoiLoc: chuoiLocCua(t.ma, t.ten),
          con: conMay,
          choXepCho: false,
          cha: khoaC,
        });
      });
      return ghi({
        khoa: khoaC,
        loai: "line",
        id: c.id,
        nhan: nhanCua(c.ma, c.ten),
        chuoiLoc: chuoiLocCua(c.ma, c.ten),
        con: conTram,
        choXepCho: false,
        cha: khoaX,
      });
    });
    return ghi({
      khoa: khoaX,
      loai: "workshop",
      id: x.id,
      nhan: nhanCua(x.ma, x.ten),
      chuoiLoc: chuoiLocCua(x.ma, x.ten),
      con: conChuyen,
      choXepCho: false,
      cha: null,
    });
  });

  const khuCho: NodeCay[] = khuChoMay.map((m) =>
    ghi({
      khoa: khoaNode("machine", m.id),
      loai: "machine",
      id: m.id,
      nhan: nhanCua(m.ma, m.ten),
      chuoiLoc: chuoiLocCua(m.ma, m.ten),
      con: [],
      choXepCho: true,
      cha: null,
    }),
  );

  return { goc, khuCho, theoKhoa };
}

function soSanhMa(a: { ma: string }, b: { ma: string }): number {
  return a.ma < b.ma ? -1 : a.ma > b.ma ? 1 : 0;
}

/** Trạm sắp theo `thuTu` (null xuống cuối), phá hoà bằng mã — TẤT ĐỊNH. */
function soSanhTram(a: TramDauVao, b: TramDauVao): number {
  const ta = a.thuTu ?? Number.MAX_SAFE_INTEGER;
  const tb = b.thuTu ?? Number.MAX_SAFE_INTEGER;
  if (ta !== tb) return ta - tb;
  return soSanhMa(a, b);
}

/**
 * Lọc cây theo chuỗi tìm (§7.1 ô "🔍 lọc...").
 *
 * ★ GIỮ NODE CHA khi có con khớp — nếu chỉ giữ node khớp thì kết quả là một
 *   danh sách phẳng mất ngữ cảnh, và người dùng không biết máy tìm được nằm ở
 *   chuyền nào. Đây là hành vi của mọi cây lọc quen thuộc (VS Code, Figma).
 * ★ Chuỗi rỗng trả về cây NGUYÊN VẸN (không phải rỗng).
 */
export function locCay(nodes: readonly NodeCay[], tim: string): NodeCay[] {
  const q = tim.trim().toLowerCase();
  if (q === "") return [...nodes];
  const ket: NodeCay[] = [];
  for (const n of nodes) {
    const conKhop = locCay(n.con, q);
    const tuKhop = n.chuoiLoc.includes(q);
    if (tuKhop || conKhop.length > 0) {
      ket.push({ ...n, con: tuKhop ? n.con : conKhop });
    }
  }
  return ket;
}

/**
 * Đường từ gốc tới một node, để cây TỰ MỞ đúng nhánh khi chọn trong 3D (§7.3
 * "đồng bộ hai chiều bắt buộc").
 *
 * Trả về khoá của mọi TỔ TIÊN, KHÔNG gồm chính node đó: đây là tập cần `mở`,
 * và mở chính node lá là vô nghĩa (nó không có con).
 */
export function duongToiNode(cay: CayThietKe, khoa: KhoaNode): KhoaNode[] {
  const duong: KhoaNode[] = [];
  let hienTai = cay.theoKhoa.get(khoa)?.cha ?? null;
  // Chặn vòng lặp vô hạn nếu dữ liệu có chu trình (cha trỏ ngược vào con).
  let canBao = 0;
  while (hienTai !== null && canBao < 64) {
    duong.push(hienTai);
    hienTai = cay.theoKhoa.get(hienTai)?.cha ?? null;
    canBao += 1;
  }
  return duong.reverse();
}

// ---------------------------------------------------------------------------
// Chọn — đồng bộ hai chiều (§7.3)
// ---------------------------------------------------------------------------

/** Tập đang chọn. Mảng (không Set) để so sánh trong test và serialise được. */
export type TapChon = readonly KhoaNode[];

/**
 * Áp một cú click vào tập chọn.
 *
 * ★ Ngữ nghĩa CHUẨN của mọi trình sửa đồ hoạ, và ba nhánh phải khác nhau:
 *   - click thường  → thay TOÀN BỘ tập bằng đúng node đó
 *   - Shift+click   → BẬT/TẮT node đó trong tập (toggle), giữ phần còn lại
 *   - click nền     → xoá tập
 *
 * ★ G8 — đầu vào làm hàm này trả về tập RỖNG: `apChon(tap, null, false)` và
 *   `apChon(["machine:1"], "machine:1", true)` (shift-click node duy nhất đang
 *   chọn ⇒ bỏ chọn nó). Nếu hàm không bao giờ trả rỗng thì "click nền để bỏ
 *   chọn" không hoạt động và Inspector không bao giờ đóng.
 */
export function apChon(tap: TapChon, khoa: KhoaNode | null, giuShift: boolean): TapChon {
  if (khoa === null) return [];
  if (!giuShift) return [khoa];
  return tap.includes(khoa) ? tap.filter((k) => k !== khoa) : [...tap, khoa];
}

/** Node đang là "chủ đạo" của Inspector — phần tử CUỐI của tập (vừa chạm nhất). */
export function nodeChuDao(tap: TapChon): KhoaNode | null {
  return tap.length === 0 ? null : tap[tap.length - 1];
}

// ---------------------------------------------------------------------------
// Kích thước — chuỗi dự phòng §5.3
// ---------------------------------------------------------------------------

/**
 * Kích thước dùng để VẼ một máy, theo chuỗi dự phòng §5.3:
 *   `twin_dat_cho` (đã đo) → `twin_kich_thuoc_loai` (theo loại) → mặc định.
 *
 * ★ NULL trong `twin_dat_cho` nghĩa **chưa biết**, KHÔNG phải 0 — schema ghi rõ
 *   là cố ý không đặt DEFAULT. Một cạnh 0 làm máy biến mất khỏi cảnh (bbox suy
 *   biến) mà không lỗi nào nổ, nên `<= 0` cũng rơi xuống bậc dự phòng kế tiếp.
 *
 * Trả kèm `daDo` để Inspector biết bật badge vàng "chưa đo" (NT-4): badge phụ
 * thuộc CẢ cờ `kichThuocDaDo` LẪN việc số đo có thật sự đến từ hàng đặt chỗ hay
 * không — một hàng `kichThuocDaDo=true` mà cả ba cạnh NULL vẫn là chưa đo.
 */
export function kichThuocDeVe(
  datCho: Pick<DatChoDauVao, "rongMm" | "caoMm" | "sauMm" | "kichThuocDaDo"> | null | undefined,
  theoLoai: KichThuocMm | null | undefined,
): { kichThuoc: KichThuocMm; daDo: boolean } {
  const hopLe = (v: number | null | undefined): v is number =>
    typeof v === "number" && Number.isFinite(v) && v > 0;

  if (datCho && hopLe(datCho.rongMm) && hopLe(datCho.caoMm) && hopLe(datCho.sauMm)) {
    return {
      kichThuoc: { rongMm: datCho.rongMm, caoMm: datCho.caoMm, sauMm: datCho.sauMm },
      daDo: datCho.kichThuocDaDo,
    };
  }
  if (theoLoai && hopLe(theoLoai.rongMm) && hopLe(theoLoai.caoMm) && hopLe(theoLoai.sauMm)) {
    return { kichThuoc: { ...theoLoai }, daDo: false };
  }
  return { kichThuoc: { ...KICH_THUOC_MAC_DINH }, daDo: false };
}

/**
 * BBox mm của một đặt chỗ, ĐÃ HOÁN VỊ SANG TRỤC SCENE — đầu vào cho
 * align/distribute của `hinhHocCanChinh.ts`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HOÁN VỊ TRỤC — chỗ dễ sai nhất của cả module, và sai KHÔNG BÁO LỖI
 * ════════════════════════════════════════════════════════════════════════════
 * Hai hệ trục gặp nhau đúng ở hàm này:
 *
 *   DB (`twin_dat_cho`, §5.2)      three/scene (`hinhHocCanChinh.ts`)
 *   ─────────────────────────      ────────────────────────────────
 *   viTriXMm  = Đông-Tây           x = Đông-Tây          ← trùng
 *   viTriYMm  = mặt bằng Bắc-Nam   y = ĐỘ CAO
 *   viTriZMm  = ĐỘ CAO             z = mặt bằng Bắc-Nam
 *
 * tức **Y và Z ĐỔI CHỖ**. `canhTheoBien` khai rõ nó chạy align "trên/dưới" trên
 * **trục Z của scene** và "độ cao Y KHÔNG BAO GIỜ đổi"; `danDeu` **TỪ CHỐI**
 * trục Y. Truyền thẳng `y: d.viTriYMm` vào đó nghĩa là:
 *   · align "canh lên trên" so trên ĐỘ CAO thay vì mặt bằng ⇒ không máy nào
 *     nhúc nhích (mọi máy cùng cao độ sàn) — nút bấm không làm gì;
 *   · `danDeu` trục "Z" rải theo ĐỘ CAO ⇒ máy bay lên trời.
 * Cả hai đều KHÔNG ném lỗi. Đây đúng lớp lỗi G10 mà spec cảnh báo (đảo trục làm
 * ĐỎ một chỉ báo khác với chỉ báo người ta đoán).
 *
 * Vì vậy hoán vị xảy ra TẠI ĐÂY, một chỗ duy nhất, và
 * {@link dichSceneSangDatCho} là phép ngược dùng khi ghi kết quả trở lại. Test
 * ghim vòng tròn DB → scene → DB phải trả về đúng số ban đầu.
 *
 * Kích thước hoán vị theo: `sauMm` là bề sâu MẶT BẰNG (trục Y của DB) nên thành
 * bề sâu trục Z của scene; `caoMm` là độ cao nên thành trục Y của scene.
 */
export function bboxCuaDatCho(d: DatChoDauVao, kichThuoc: KichThuocMm): BBox {
  return bboxTuTamVaKichThuoc(
    { x: d.viTriXMm, y: d.viTriZMm, z: d.viTriYMm },
    { rong: kichThuoc.rongMm, cao: kichThuoc.caoMm, sau: kichThuoc.sauMm },
  );
}

/**
 * Phép NGƯỢC của {@link bboxCuaDatCho} cho một VECTOR DỊCH: scene → DB.
 *
 * `canhTheoBien` / `danDeu` / `nudge` trả `dich` theo trục SCENE. Cộng thẳng
 * `dich.z` vào `viTriZMm` sẽ nhấc máy lên trời. Đây là chỗ DUY NHẤT được phép
 * biết chiều hoán vị ngược.
 */
export function dichSceneSangDatCho(dich: { x: number; y: number; z: number }): {
  dXMm: number;
  dYMm: number;
  dZMm: number;
} {
  return { dXMm: dich.x, dYMm: dich.z, dZMm: dich.y };
}

/** Áp một vector dịch SCENE vào một hàng đặt chỗ, trả hàng MỚI (bất biến). */
export function apDichVaoDatCho(
  d: DatChoDauVao,
  dich: { x: number; y: number; z: number },
): DatChoDauVao {
  const { dXMm, dYMm, dZMm } = dichSceneSangDatCho(dich);
  return {
    ...d,
    viTriXMm: d.viTriXMm + dXMm,
    viTriYMm: d.viTriYMm + dYMm,
    viTriZMm: d.viTriZMm + dZMm,
  };
}

// ---------------------------------------------------------------------------
// Gom thay đổi để LƯU (§7.3 "N thay đổi chưa lưu" + batch 1 transaction)
// ---------------------------------------------------------------------------

/** Một bản ghi sẽ gửi lên `twinCanh.luuHangLoat`. */
export interface ThayDoiDatCho {
  loaiThucThe: LoaiThucThe;
  thucTheId: number;
  tangId: number;
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  rongMm: number | null;
  caoMm: number | null;
  sauMm: number | null;
  kichThuocDaDo: boolean;
  quatX: number;
  quatY: number;
  quatZ: number;
  quatW: number;
  daKhoa: boolean;
  hienThi: boolean;
}

/** Trần một lô ghi — khớp `luuHangLoat` của router (§7 nhiệm vụ 7). */
export const TRAN_LO_GHI = 500;

/**
 * So sánh bản gốc với bản đang sửa, trả về CHỈ những hàng thật sự đổi.
 *
 * ★ Vì sao không gửi tất: 82 hàng mỗi lần Lưu biến mọi lần bấm thành một lượt
 *   ghi toàn bảng, và `updatedAt` của 82 hàng nhảy trong khi người dùng chỉ kéo
 *   một máy. Điều đó phá luôn phép đo G5b ("`updatedAt` đã tiến" chứng minh
 *   đường ghi có chạy) vì mọi hàng luôn tiến bất kể có đổi gì không.
 *
 * ★ So sánh số bằng SAI SỐ, không bằng `===`: toạ độ đi qua `numeric(14,3)` nên
 *   quay vòng DB→UI→DB có thể lệch ở chữ số thứ ba. Ngưỡng 1e-3 mm = 1 micromet,
 *   nhỏ hơn mọi thứ có nghĩa trong nhà xưởng và đúng bằng độ phân giải cột.
 */
export const SAI_SO_MM = 1e-3;

function lechSo(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a !== b;
  return Math.abs(a - b) > SAI_SO_MM;
}

export function gomThayDoi(
  goc: ReadonlyMap<KhoaNode, DatChoDauVao>,
  hienTai: ReadonlyMap<KhoaNode, DatChoDauVao>,
): ThayDoiDatCho[] {
  const ket: ThayDoiDatCho[] = [];
  for (const [khoa, moi] of hienTai) {
    const cu = goc.get(khoa);
    const doi =
      cu === undefined ||
      lechSo(moi.viTriXMm, cu.viTriXMm) ||
      lechSo(moi.viTriYMm, cu.viTriYMm) ||
      lechSo(moi.viTriZMm, cu.viTriZMm) ||
      lechSo(moi.rongMm, cu.rongMm) ||
      lechSo(moi.caoMm, cu.caoMm) ||
      lechSo(moi.sauMm, cu.sauMm) ||
      lechSo(moi.quatX, cu.quatX) ||
      lechSo(moi.quatY, cu.quatY) ||
      lechSo(moi.quatZ, cu.quatZ) ||
      lechSo(moi.quatW, cu.quatW) ||
      moi.kichThuocDaDo !== cu.kichThuocDaDo ||
      moi.daKhoa !== cu.daKhoa ||
      moi.hienThi !== cu.hienThi ||
      moi.tangId !== cu.tangId;
    if (!doi) continue;
    ket.push({
      loaiThucThe: moi.loaiThucThe,
      thucTheId: moi.thucTheId,
      tangId: moi.tangId,
      viTriXMm: moi.viTriXMm,
      viTriYMm: moi.viTriYMm,
      viTriZMm: moi.viTriZMm,
      rongMm: moi.rongMm,
      caoMm: moi.caoMm,
      sauMm: moi.sauMm,
      kichThuocDaDo: moi.kichThuocDaDo,
      quatX: moi.quatX,
      quatY: moi.quatY,
      quatZ: moi.quatZ,
      quatW: moi.quatW,
      daKhoa: moi.daKhoa,
      hienThi: moi.hienThi,
    });
  }
  // TẤT ĐỊNH: cùng tập thay đổi luôn cho cùng thứ tự lô, bất kể thứ tự Map.
  return ket.sort((a, b) =>
    a.loaiThucThe < b.loaiThucThe ? -1 : a.loaiThucThe > b.loaiThucThe ? 1 : a.thucTheId - b.thucTheId,
  );
}

/**
 * Chia thành các lô ≤ {@link TRAN_LO_GHI}.
 *
 * ★ G8 — mảng rỗng trả về `[]` (KHÔNG phải `[[]]`): một lô rỗng gửi lên server
 *   là một transaction không ghi gì, và nó làm chỉ báo "đã lưu" bật lên trong
 *   khi không có byte nào rời máy.
 */
export function chiaLo<T>(ds: readonly T[], tran: number = TRAN_LO_GHI): T[][] {
  if (ds.length === 0) return [];
  const buoc = Number.isFinite(tran) && tran > 0 ? Math.floor(tran) : TRAN_LO_GHI;
  const lo: T[][] = [];
  for (let i = 0; i < ds.length; i += buoc) lo.push(ds.slice(i, i + buoc));
  return lo;
}

// ---------------------------------------------------------------------------
// §7.3 — Kéo giới hạn trong mặt sàn
// ---------------------------------------------------------------------------

/**
 * Kẹp một vị trí mm vào trong lòng mặt sàn (§7.3 "không cho máy bay lơ lửng").
 *
 * ★ Kẹp theo TÂM có tính nửa kích thước, nên máy không thò một nửa ra ngoài
 *   tường. Sàn nhỏ hơn máy ⇒ kẹp về đúng tâm sàn thay vì cho ra khoảng rỗng
 *   (min > max) — `Math.min(Math.max())` với khoảng rỗng cho kết quả phụ thuộc
 *   thứ tự và sẽ dán máy vào một mép ngẫu nhiên.
 */
export function kepVaoSan(
  viTri: { x: number; y: number; z: number },
  kichThuoc: KichThuocMm,
  san: { rongMm: number; sauMm: number },
): { x: number; y: number; z: number } {
  const nuaR = kichThuoc.rongMm / 2;
  const nuaS = kichThuoc.sauMm / 2;
  const kep = (v: number, nua: number, canh: number): number => {
    const lo = nua;
    const hi = canh - nua;
    if (hi < lo) return canh / 2;
    return Math.min(Math.max(v, lo), hi);
  };
  return {
    x: kep(viTri.x, nuaR, san.rongMm),
    y: viTri.y,
    z: kep(viTri.z, nuaS, san.sauMm),
  };
}
