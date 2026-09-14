/**
 * kiemTraAsset.ts — NGƯỠNG NHẬN/CẢNH BÁO/CHẶN cho model 3D nhập vào (§7.4, §10B.2).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ MODULE THUẦN — không import three, không import react, không chạm mạng.
 * ════════════════════════════════════════════════════════════════════════════
 * Tách riêng vì đây là chỗ DUY NHẤT quyết định "tệp này có được dùng không", và
 * quyết định đó phải test được mà không cần WebGL, không cần server, không cần
 * một tệp GLB thật 15 MB nằm trong repo.
 *
 * Ba bậc của §10B.2 (bảng "Ngưỡng cho model máy" — CHẶT HƠN vỏ nhà, vì máy nhân
 * lên 43 lần và nằm gần camera):
 *
 *   | Số tam giác            | Xử lý                          |
 *   |------------------------|--------------------------------|
 *   | <= 50.000              | Nhận, KHÔNG cảnh báo           |
 *   | 50.001 - 150.000       | Nhận, CẢNH BÁO, gợi ý nén      |
 *   | > 150.000 hoặc > 15 MB | CHẶN                           |
 *
 * ★★★ VÌ SAO NGƯỠNG DUNG LƯỢNG NẰM Ở BẬC "CHẶN" MÀ KHÔNG CÓ BẬC "CẢNH BÁO":
 *   spec chỉ ghi một ngưỡng byte duy nhất (15 MB) và nó ở nhánh chặn. Tự chế
 *   thêm một ngưỡng byte cảnh báo là bịa ra một con số không ai duyệt — đúng
 *   thứ NT-4 cấm. Nếu sau này cần, nó phải vào spec trước, vào đây sau.
 *
 * ⚠ CẢNH BÁO MANG SANG TỪ §10B.2 — `donViDeNghi` của `docBanVe.ts` GIẢ ĐỊNH vật
 *   thể cỡ NHÀ XƯỞNG và tự khai "chắc chắn" cho một khối 10 mm. Module này
 *   KHÔNG gọi nó và không suy đơn vị: model máy nhỏ hơn nhà xưởng vài bậc độ
 *   lớn nên phép suy đó sai ở đúng khoảng cỡ ta đang làm việc. So sánh kích
 *   thước ở đây là so BBOX ĐO ĐƯỢC với SỐ KHAI BÁO — hai con số thật, không
 *   phỏng đoán nào.
 */

/** Trần tam giác: dưới mức này thì im lặng cho qua. */
export const NGUONG_TAM_GIAC_OK = 50_000;
/** Trên mức này thì CHẶN. Khoảng giữa hai số là vùng cảnh báo. */
export const NGUONG_TAM_GIAC_CHAN = 150_000;
/** Trần dung lượng — 15 MB, §7.4 và §10B.2 ghi cùng một con số. */
export const NGUONG_BYTE_CHAN = 15 * 1024 * 1024;
/**
 * Lệch bbox so với kích thước KHAI BÁO vượt mức này thì hỏi người dùng (§10B.2).
 *
 * ★ 0,30 = 30 %. Con số này đã bị Đợt 2 khoá bằng test sau một lần sửa: ví dụ
 *   "model 2,4 m / khai 1,9 m" lệch 26,3 % nên KHÔNG vượt; "2,9 m / 1,9 m" lệch
 *   52,6 % nên vượt. Đổi số này là đổi hành vi của hai ví dụ đó.
 */
export const NGUONG_LECH_BBOX = 0.3;

/** Ba bậc xử lý. */
export type BacKiemTra = "ok" | "canh_bao" | "chan";

/** Lý do — khoá i18n hậu tố, KHÔNG phải câu tiếng Việt viết cứng. */
export type LyDoKiemTra =
  | "tam_giac_cao"
  | "tam_giac_vuot_tran"
  | "dung_luong_vuot_tran"
  | "tep_rong"
  | "duoi_tep_khong_nhan";

export interface SoDoAsset {
  /** Tổng tam giác sau khi duyệt toàn bộ cây scene. */
  soTamGiac: number;
  /** Dung lượng tệp gốc, BYTE. */
  soByte: number;
  /** Số material rời — chỉ để hiện cho người dùng, không tham gia quyết định. */
  soMaterial?: number;
  /** BBox đo được từ file, MILIMÉT (đã quy đổi theo đơn vị người dùng chọn). */
  bboxMm?: { rongMm: number; caoMm: number; sauMm: number } | null;
}

export interface KetQuaKiemTra {
  bac: BacKiemTra;
  /** Rỗng khi `bac === "ok"`. Nhiều lý do cùng lúc là chuyện bình thường. */
  lyDo: LyDoKiemTra[];
  /** Có nên gợi ý nén không — đúng khi và chỉ khi tam giác nằm ở vùng cảnh báo. */
  goiYNen: boolean;
}

/**
 * Đuôi tệp nhận được cho model MÁY.
 *
 * ★ `.svg` CỐ Ý KHÔNG có mặt. §10B.2: SVG là ảnh 2D, không có chiều sâu — chủ
 *   sở hữu có nhắc `.svg` và spec ghi rõ lý do TỪ CHỐI thay vì im lặng bỏ qua.
 * ★ `.step/.stp/.iges/.igs` đi qua `occtWorker.ts` rồi mới thành GLB, nên chúng
 *   KHÔNG nằm ở đây — đây là danh sách thứ nạp thẳng được.
 */
export const DUOI_GLTF = [".glb", ".gltf"] as const;

/** Đuôi tệp (chữ thường, kèm dấu chấm) của một tên tệp. Rỗng nếu không có. */
export function duoiTep(tenTep: string): string {
  const i = tenTep.lastIndexOf(".");
  return i < 0 ? "" : tenTep.slice(i).toLowerCase();
}

/** Tên tệp này có đuôi glTF nhận được không. */
export function laDuoiGltf(tenTep: string): boolean {
  return (DUOI_GLTF as readonly string[]).includes(duoiTep(tenTep));
}

/**
 * Chấm một model theo ba bậc §10B.2.
 *
 * ★★★ THỨ TỰ KIỂM CÓ Ý NGHĨA: dung lượng và tam giác đều có thể CHẶN, và một
 *   tệp có thể vi phạm CẢ HAI. Trả về MỌI lý do thay vì dừng ở lý do đầu —
 *   người dùng nén xong tam giác rồi mới biết còn vướng dung lượng là hai lượt
 *   thử thay vì một.
 */
export function chamModel(so: SoDoAsset): KetQuaKiemTra {
  const lyDo: LyDoKiemTra[] = [];

  if (so.soByte <= 0) {
    return { bac: "chan", lyDo: ["tep_rong"], goiYNen: false };
  }
  if (so.soByte > NGUONG_BYTE_CHAN) lyDo.push("dung_luong_vuot_tran");
  if (so.soTamGiac > NGUONG_TAM_GIAC_CHAN) lyDo.push("tam_giac_vuot_tran");

  if (lyDo.length > 0) return { bac: "chan", lyDo, goiYNen: false };

  // Ranh giới: 50.000 là OK (spec ghi "<= 50.000"), 50.001 mới cảnh báo.
  if (so.soTamGiac > NGUONG_TAM_GIAC_OK) {
    return { bac: "canh_bao", lyDo: ["tam_giac_cao"], goiYNen: true };
  }
  return { bac: "ok", lyDo: [], goiYNen: false };
}

/** Kiểm nhanh theo TÊN TỆP trước khi đọc byte — rẻ hơn và nói sớm hơn. */
export function chamTenTep(tenTep: string): KetQuaKiemTra | null {
  if (laDuoiGltf(tenTep)) return null;
  return { bac: "chan", lyDo: ["duoi_tep_khong_nhan"], goiYNen: false };
}

export interface LechKichThuoc {
  /** Có vượt ngưỡng 30 % ở BẤT KỲ chiều nào không. */
  vuotNguong: boolean;
  /** Tỉ lệ lệch LỚN NHẤT trong ba chiều (0,526 = 52,6 %). */
  lechLonNhat: number;
  /** Chiều gây lệch lớn nhất — để câu hỏi nói đúng chiều nào. */
  chieu: "rong" | "cao" | "sau" | null;
}

/**
 * So bbox ĐO ĐƯỢC từ file với kích thước KHAI BÁO trong `twin_dat_cho` (§10B.2).
 *
 * ★★★ MẪU SỐ LÀ SỐ KHAI BÁO, KHÔNG PHẢI SỐ ĐO. Đây không phải chuyện làm tròn:
 *   câu hỏi người dùng phải trả lời là "model lệch bao nhiêu so với thứ tôi đã
 *   khai", nên khai báo là mốc. Lấy số đo làm mẫu số cho ra tỉ lệ khác và ví dụ
 *   26,3 % của spec sẽ không còn tái lập được.
 *
 * ⚠ Khai báo <= 0 (chưa ai đo máy đó) ⇒ KHÔNG so được, trả `vuotNguong=false`.
 *   Chia cho 0 ra Infinity và "lệch vô hạn" là một lời khai vô nghĩa: ta không
 *   biết máy to bằng nào, chứ không phải biết rằng nó lệch.
 */
export function soLechKichThuoc(
  bboxMm: { rongMm: number; caoMm: number; sauMm: number },
  khaiBaoMm: { rongMm: number; caoMm: number; sauMm: number },
  nguong: number = NGUONG_LECH_BBOX,
): LechKichThuoc {
  const cap: Array<["rong" | "cao" | "sau", number, number]> = [
    ["rong", bboxMm.rongMm, khaiBaoMm.rongMm],
    ["cao", bboxMm.caoMm, khaiBaoMm.caoMm],
    ["sau", bboxMm.sauMm, khaiBaoMm.sauMm],
  ];
  let lechLonNhat = 0;
  let chieu: "rong" | "cao" | "sau" | null = null;
  for (const [ten, do_, khai] of cap) {
    if (!Number.isFinite(do_) || !Number.isFinite(khai) || khai <= 0) continue;
    const lech = Math.abs(do_ - khai) / khai;
    if (lech > lechLonNhat) {
      lechLonNhat = lech;
      chieu = ten;
    }
  }
  return { vuotNguong: lechLonNhat > nguong, lechLonNhat, chieu };
}

/**
 * `bounds` ghi vào `equipment_3d_models` (§10B.2 — cột này NULL ở 5/5 hàng).
 *
 * Hình dạng `{ min:[x,y,z], max:[x,y,z] }` là hình dạng mà docblock của
 * `drizzle/schema/twin.ts` nêu. Chọn nó thay vì `{w,h,d}` vì nó mang cả GỐC —
 * một model có tâm lệch khỏi gốc toạ độ đặt xuống sàn sẽ chìm hoặc bay, và
 * `{w,h,d}` không mang thông tin để phát hiện điều đó.
 */
export function boundsTuBBox(bbox: {
  min: [number, number, number];
  max: [number, number, number];
}): Record<string, unknown> {
  return { min: bbox.min, max: bbox.max };
}
