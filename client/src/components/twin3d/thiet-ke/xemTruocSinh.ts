/**
 * xemTruocSinh.ts — bảng tổng kết + lớp GHOST của `HopThoaiSinh.tsx` (§7.3).
 *
 * Spec §7.3 đòi đúng một câu trước khi Áp dụng:
 *   *"sẽ tạo N vật thể, GIỮ NGUYÊN M vật thể đã chỉnh tay"*
 * và một lớp xem trước dạng ma trong 3D.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO PHÉP ĐẾM NÀY KHÔNG ĐƯỢC LÀM TRONG COMPONENT
 * ════════════════════════════════════════════════════════════════════════════
 * "Giữ nguyên M vật thể đã chỉnh tay" là lời hứa mà NT-4 dựa vào để người dùng
 * dám bấm nút Sinh. Nếu M sai thì hoặc người dùng mất công chỉnh tay (M đếm
 * thiếu, thực tế bị đè), hoặc người dùng không hiểu vì sao máy không di chuyển
 * (M đếm thừa). Cả hai đều KHÔNG ném lỗi. Đây đúng là hình dạng lỗi mà §1.6 nói
 * là lỗ hổng lớn nhất, nên nó phải nằm trong `.ts` đo được.
 *
 * Module này KHÔNG tự sinh — `sinhBoCuc.ts` (38 test T1-T9) làm việc đó. Nó chỉ
 * ĐỌC `KetQuaSinh` và trả lời hai câu: đếm bao nhiêu, và vẽ ma ở đâu.
 */

import type { KetQuaSinh, LoaiThucThe, ViTriDatCho } from "../sinhBoCuc";
import { khoaThucThe } from "../sinhBoCuc";
import type { DatChoDauVao, KhoaNode } from "./trangThaiThietKe";

// ---------------------------------------------------------------------------
// Bảng tổng kết
// ---------------------------------------------------------------------------

/** Con số của bảng tổng kết trước khi Áp dụng (§7.3). */
export interface TongKetSinh {
  /** Hàng `twin_dat_cho` sẽ được GHI (tạo mới hoặc ghi đè hàng 'sinh' cũ). */
  seTao: number;
  /** Trong `seTao`, bao nhiêu là hàng CHƯA từng tồn tại. */
  seTaoMoi: number;
  /** Trong `seTao`, bao nhiêu là ghi đè lên hàng `nguon='sinh'` đã có. */
  seGhiDe: number;
  /** ★ Vật thể `nguon='tay'` được GIỮ NGUYÊN — con số M của câu spec. */
  giuNguyen: number;
  /** Hạ tầng (tường/cột/vạch) sẽ sinh kèm. */
  vatTheHaTang: number;
  /** Cảnh báo cấu trúc do `sinhBoCuc` phát ra (máy không trạm, xưởng không tầng…). */
  canhBao: readonly string[];
  /** Chi tiết từng mục bị giữ nguyên — để hiện danh sách, không chỉ con số. */
  chiTietGiuNguyen: readonly { loai: string; id: number; lyDo: string }[];
}

/**
 * Đếm cho bảng tổng kết.
 *
 * ★ `seTaoMoi` vs `seGhiDe` tách riêng vì chúng là hai rủi ro khác nhau: tạo mới
 *   không mất gì, ghi đè làm mất vị trí cũ (dù vị trí đó cũng do máy sinh ra).
 *   Một con số gộp không cho người dùng biết mình sắp mất gì.
 *
 * ★ `giuNguyen` lấy từ `ketQua.boQua` — tức là do CHÍNH `sinhBoCuc` khai báo,
 *   không phải do module này đếm lại tập `nguon='tay'`. Đếm lại độc lập ở đây
 *   nghe có vẻ an toàn hơn nhưng thực ra NGUY HIỂM hơn: nếu hai phép đếm lệch
 *   nhau thì con số hiện cho người dùng có thể đúng trong khi hành vi ghi lại
 *   sai. Số hiển thị phải đến từ cùng nguồn với hành vi.
 */
export function tongKetSinh(
  ketQua: KetQuaSinh,
  datChoHienCo: readonly DatChoDauVao[],
): TongKetSinh {
  const daCo = new Set(
    datChoHienCo.map((d) => khoaThucThe(d.loaiThucThe, d.thucTheId)),
  );

  let moi = 0;
  let ghiDe = 0;
  for (const h of ketQua.datCho) {
    if (daCo.has(khoaThucThe(h.loaiThucThe, h.thucTheId))) ghiDe += 1;
    else moi += 1;
  }

  return {
    seTao: ketQua.datCho.length,
    seTaoMoi: moi,
    seGhiDe: ghiDe,
    giuNguyen: ketQua.boQua.length,
    vatTheHaTang: ketQua.vatThe.length,
    canhBao: ketQua.canhBao,
    chiTietGiuNguyen: ketQua.boQua,
  };
}

/**
 * Tập khoá `nguon='tay'` để truyền vào `sinhBoCuc(…, daCoThuCong, …)`.
 *
 * ★★★ ĐÂY LÀ CHỖ LỚP LỖI BG-127 SẼ TÁI SINH NẾU VIẾT SAI.
 *   Bài học BG-127: câu đếm di sản MÙ CẤU TRÚC vì lọc theo một cột không bao giờ
 *   khớp. Ở đây hình dạng tương đương là: lọc `nguon === 'tay'` nhưng dựng khoá
 *   bằng một công thức KHÁC với `khoaThucThe` (ví dụ `${id}` trần, hay
 *   `machine-42` gạch nối). Tập trả về vẫn có phần tử, `sinhBoCuc` vẫn chạy,
 *   `boQua` vẫn rỗng, và mọi chỉnh tay bị đè SẠCH — không lỗi nào nổ.
 *   Bản vá cấu trúc: gọi ĐÚNG `khoaThucThe` đã export từ `sinhBoCuc.ts`, tức là
 *   dùng chung MỘT hàm với nơi so khớp. Test ghim điều đó bằng cách so khớp
 *   vòng tròn (dựng khoá → sinh → `boQua` phải chứa đúng mục đó).
 */
export function khoaDaChinhTay(datCho: readonly DatChoDauVao[]): Set<KhoaNode> {
  const ket = new Set<KhoaNode>();
  for (const d of datCho) {
    if (d.nguon === "tay") ket.add(khoaThucThe(d.loaiThucThe, d.thucTheId));
  }
  return ket;
}

// ---------------------------------------------------------------------------
// Lớp GHOST
// ---------------------------------------------------------------------------

/** Một hộp ma để vẽ xem trước. Toạ độ MM — quy sang scene ở tầng vẽ. */
export interface HopMa {
  khoa: KhoaNode;
  loai: LoaiThucThe;
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  rongMm: number;
  caoMm: number;
  sauMm: number;
  /** true = vị trí này KHÁC vị trí hiện tại ⇒ tô màu "sẽ dời". */
  seDoi: boolean;
}

/** Ngưỡng coi là "đã dời", mm. Dưới 1 mm là nhiễu làm tròn numeric(14,3). */
export const NGUONG_DOI_MM = 1;

/**
 * Dựng lớp ghost cho xem trước 3D.
 *
 * ★ CHỈ ghost cho `loaiThucThe==='machine'`: ghost cho station/line/workshop là
 *   những hộp lớn chồng lên nhau che hết máy, và người dùng cần thấy MÁY sẽ đi
 *   đâu chứ không cần thấy hộp bao của chuyền.
 *
 * ★ `seDoi` so với vị trí HIỆN CÓ để ghost phân biệt "máy này sẽ nhảy chỗ" với
 *   "máy này sinh lại đúng chỗ cũ". Không có cờ đó thì 41 ghost đều trông như
 *   nhau và xem trước không trả lời được câu hỏi duy nhất người dùng có.
 */
export function dungLopMa(
  ketQua: KetQuaSinh,
  datChoHienCo: readonly DatChoDauVao[],
): HopMa[] {
  const hienCo = new Map<KhoaNode, DatChoDauVao>();
  for (const d of datChoHienCo) hienCo.set(khoaThucThe(d.loaiThucThe, d.thucTheId), d);

  const ket: HopMa[] = [];
  for (const h of ketQua.datCho) {
    if (h.loaiThucThe !== "machine") continue;
    const khoa = khoaThucThe(h.loaiThucThe, h.thucTheId);
    const cu = hienCo.get(khoa);
    ket.push({
      khoa,
      loai: h.loaiThucThe,
      viTriXMm: h.viTriXMm,
      viTriYMm: h.viTriYMm,
      viTriZMm: h.viTriZMm,
      rongMm: h.rongMm,
      caoMm: h.caoMm,
      sauMm: h.sauMm,
      seDoi: cu === undefined || khoangCachMm(h, cu) > NGUONG_DOI_MM,
    });
  }
  // TẤT ĐỊNH — cùng đầu vào cho cùng thứ tự ghost.
  return ket.sort((a, b) => (a.khoa < b.khoa ? -1 : a.khoa > b.khoa ? 1 : 0));
}

function khoangCachMm(a: ViTriDatCho, b: DatChoDauVao): number {
  return Math.hypot(
    a.viTriXMm - b.viTriXMm,
    a.viTriYMm - b.viTriYMm,
    a.viTriZMm - b.viTriZMm,
  );
}

/**
 * Số máy THẬT SỰ sẽ đổi vị trí — con số đáng lo nhất của hộp thoại.
 *
 * ★ G8 — trả 0 khi chạy Sinh hai lần liên tiếp không đổi tham số (lần hai không
 *   dời gì). Nếu hàm này luôn trả `datCho.length` thì hộp thoại luôn doạ người
 *   dùng rằng 41 máy sắp nhảy chỗ, kể cả khi không máy nào nhúc nhích.
 */
export function soMaySeDoi(ma: readonly HopMa[]): number {
  return ma.filter((m) => m.seDoi).length;
}
