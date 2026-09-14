/**
 * sucKhoeMay.ts — §14.5.1 **A-4: SỨC KHOẺ MÁY + NGUY CƠ HỎNG** (mục G-1, F-15).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO A-4 XỨNG ĐÁNG CHIẾM CHỖ — SỐ ĐO, KHÔNG PHẢI LỜI HỨA
 * ════════════════════════════════════════════════════════════════════════════
 * Đo lại 2026-09-08 trên DB dev (`aoi_management`):
 *
 *   machine_health_history      180.800 hàng · mới nhất 2026-09-08 09:40
 *   43/43 máy có ít nhất 1 hàng · 42/43 máy có hàng trong 24h
 *   healthScore        NULL 0/180.800 · miền [55…100] · 45 giá trị rời
 *   predictedFailureRisk NULL 0/180.800 · miền [0…100] · 48.550 hàng khác 0
 *   maintenanceUrgency NULL 0/180.800 · LOW 158.439 · MEDIUM 10.476
 *                                     · CRITICAL 6.199 · HIGH 5.728
 *
 * So với ba nguồn §14.5.6 (`oee_metrics` 0 hàng/24h · `andon_events` 0 hàng
 * `raised` · `product_inspections` 2.880/2.880 `factoryCode` NULL), đây là nguồn
 * **duy nhất** vừa giàu vừa sống vừa **qua được G50**: "có dữ liệu" ở đây thật sự
 * bằng "dùng được", và điều đó được kiểm bằng phép đếm NULL ở trên chứ không suy
 * từ việc bảng có hàng.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI PHÉP ĐO TRÊN CÙNG MỘT MÁY, HAI KÊNH THỊ GIÁC RỜI NHAU
 * ════════════════════════════════════════════════════════════════════════════
 * §14.5.1 cảnh báo đúng chỗ nguy hiểm nhất: A-1 (trạng thái vận hành) đã chiếm
 * **màu thân máy**. Nếu A-4 cũng tô thân thì hai đại lượng khác hẳn nhau tranh
 * một kênh, và ca đắt giá nhất — *máy ĐANG CHẠY mà sức khoẻ 55%* — trở thành
 * không biểu diễn được: một trong hai sự thật bị nuốt.
 *
 * ⇒ A-4 lấy **VÒNG VIỀN ĐẾ MÁY**, A-1 giữ thân. Đọc được đồng thời:
 *   thân xanh + viền hổ phách = "đang chạy, nhưng sắp cần bảo trì".
 *   Đây chính là thông tin MỚI mà §12b.2 xếp vào nhóm GỘP — không phải vẽ lại A-1.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G30 — MỘT ĐIỂM SỨC KHOẺ KHÔNG KÈM MỐC LÀ MỘT LỜI KHAI KHÔNG KIỂM ĐƯỢC
 * ════════════════════════════════════════════════════════════════════════════
 * `machine_health_history` là bảng **lịch sử**: hàng mới nhất của một máy có thể
 * từ hôm nay, hoặc từ 18 ngày trước (đo được: máy cũ nhất 2026-08-21). Hai máy
 * cạnh nhau trên cảnh có thể mang hai lời khai chênh nhau nửa tháng, và không có
 * gì trên vòng viền nói ra điều đó.
 *
 * ⇒ Mỗi bản ghi đi qua module này **bắt buộc** mang `mocMs`, và {@link conHanSucKhoe}
 *   quyết định nó còn được vẽ hay không. Hết hạn ⇒ hạng `het_han`, **KHÔNG** phải
 *   hạng "khoẻ": một lời khai cũ về một máy đang hỏng dần mà bị vẽ thành xanh là
 *   chế độ hỏng tệ hơn hẳn việc không vẽ gì.
 *
 * ★ Dùng lại `conHieuLuc` của `wipTram.ts` (G12) thay vì viết phép so hạn thứ
 *   hai — nhưng với **hạn riêng**, vì hai đại lượng có nhịp sinh khác nhau
 *   (xem {@link HAN_KHAI_SUC_KHOE_MS}).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G72 — MODULE THUẦN TRẢ DỮ LIỆU CÓ CẤU TRÚC, KHÔNG PHÁT VĂN XUÔI
 * ════════════════════════════════════════════════════════════════════════════
 * Không hàm nào ở đây trả chuỗi hiển thị. Hạng là **mã** (`nguy_kich`/`canh`/…),
 * số là **số**, và việc dịch ra chữ cho người đọc thuộc về tầng React qua `t()`.
 * `nhanTuoi` từng in thẳng "(17 ngày ago)" và đó là lỗi module thuần phát văn
 * xuôi — không lặp lại ở đây.
 *
 * ★ RB-8.1 — không đọc `Date.now()` bên trong. `bayGio` là THAM SỐ, vì khi TUA
 *   LẠI lịch sử thì "còn hạn" phải tính theo mốc ĐANG XEM, không theo đồng hồ
 *   tường. Cùng lý lẽ đã ghi ở `wipTram.ts` và `khoTrangThai.ts`.
 */

import { conHieuLuc } from "./wipTram";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* HẠN HIỆU LỰC                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Hạn của một lời khai sức khoẻ: **24 giờ**.
 *
 * Vì sao 24h chứ không phải 8h như `HAN_KHAI_NGHEN_MS`: hai đại lượng có nhịp
 * sinh khác nhau, và hạn phải bám nhịp sinh chứ không bám một con số cho đẹp.
 *
 *   `line_balance` — số liệu theo KỲ SẢN XUẤT, đổi khi đổi ca ⇒ 8h = ranh giới ca.
 *   `machine_health_history` — điểm tổng hợp từ OEE/uptime/lỗi/chu kỳ
 *     (`calculationMethod` đo được: PREDICTIVE_WS4 180.518 · WEIGHTED 324).
 *     Nó là xu hướng HAO MÒN, không phải trạng thái tức thời: một máy 78 điểm
 *     hôm qua rất khó thành 30 điểm hôm nay mà không kèm sự kiện khác.
 *
 * Đo được: 42/43 máy có hàng trong 24h ⇒ ngưỡng này giữ được gần trọn tập máy
 * mà vẫn loại đúng cái máy đã im lặng 18 ngày. Một ngưỡng 8h sẽ loại thêm máy
 * chỉ vì lô tính chạy theo giờ khác, tức là **đo thiết bị đo** chứ không đo máy.
 */
export const HAN_KHAI_SUC_KHOE_MS = 24 * 60 * 60 * 1000;

/**
 * Lời khai sức khoẻ có còn hiệu lực không.
 *
 * ★ G12 — uỷ thác thẳng cho `conHieuLuc` của `wipTram.ts`, chỉ đổi hạn. Viết lại
 *   phép trừ ở đây là bản cài đặt thứ hai của cùng một luật, và hai bản cài đặt
 *   hiếm khi chỉ lệch một chỗ.
 *
 * `mocMs == null` ⇒ **KHÔNG tin**, đúng mặc định của `conHieuLuc`: một lời khai
 * không kèm dấu thời gian thì không kiểm được hạn.
 */
export function conHanSucKhoe(
  mocMs: number | null | undefined,
  bayGio: number,
  hanMs: number = HAN_KHAI_SUC_KHOE_MS,
): boolean {
  /*
   * ★★★ VÌ SAO KHÔNG GỌI THẲNG `conHieuLuc` — VÀ VÌ SAO ĐÂY KHÔNG PHẢI G12.
   *
   * `conHieuLuc(moc, bayGio)` ghim `HAN_KHAI_NGHEN_MS = 8h` VÀO TRONG nó; nó
   * không nhận hạn làm tham số. Muốn tái dùng thì phải hoặc (a) sửa chữ ký của
   * nó — đụng module lô khác đang có test ghim, hoặc (b) dời `mocMs` một lượng
   * bù để "lừa" hằng 8h. Bản viết đầu của lô này chọn (b) và ĐÃ BỊ BỎ: một phép
   * dời mốc giả để đi qua một hằng sai là thứ đọc lên không ai kiểm được, và nó
   * hỏng câm ngay khi ai đó chỉnh `HAN_KHAI_NGHEN_MS`.
   *
   * G12 cấm **hai bản cài đặt của một luật**. Ở đây luật là *"quá hạn thì không
   * tin"* và hằng là hai đại lượng khác nhau với hai nhịp sinh khác nhau — nên
   * cái được chia sẻ là **ngữ nghĩa**, không phải dòng mã. Điều bắt buộc giữ
   * chung, và được test ghim ở cả hai module, là nhánh `null ⇒ false`.
   *
   * ⇒ Giữ `conHieuLuc` trong tầm mắt (dùng ở {@link conHanNutThat}) để hai
   *   module không âm thầm tách đôi về ngữ nghĩa, và so trực tiếp ở đây.
   */
  if (mocMs == null || !Number.isFinite(mocMs)) return false;
  return bayGio - mocMs <= hanMs;
}

/**
 * Chuyển tiếp `conHieuLuc` của `wipTram.ts` — hạn NÚT THẮT 8h.
 *
 * Có mặt ở đây để {@link conHanSucKhoe} và nó nằm cạnh nhau trong cùng một tệp,
 * nên chênh lệch ngữ nghĩa giữa hai hạn là thứ đọc thấy ngay chứ không phải thứ
 * phải đi tìm giữa hai module.
 */
export { conHieuLuc as conHanNutThat };

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ĐẦU VÀO                                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Mức khẩn bảo trì — **nguyên văn enum của CSDL**
 * (`pg_enum` của `machine_health_history."maintenanceUrgency"`, đo 2026-09-08).
 *
 * ★ G24 — tên ở đây phải grep ra được trong CSDL. Không đặt tên Việt cho bốn mã
 *   này: chúng là giá trị enum thật đi qua dây, và dịch chúng ở tầng vận chuyển
 *   là chỗ hai bảng mã bắt đầu lệch.
 */
export type MucKhanBaoTri = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const MOI_MUC_KHAN: readonly MucKhanBaoTri[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/** Một lời khai sức khoẻ của MỘT máy, kèm ĐỦ thứ để kiểm hạn (G30). */
export interface KhaiSucKhoe {
  machineId: number;
  /**
   * `healthScore` 0–100. `null` = **CHƯA ĐO ĐƯỢC**, KHÔNG phải 0.
   *
   * ★ NT-3.5 — đây đúng chỗ `trangThaiTapMay` đã trả `null` có chủ đích
   *   (`server/db/twinCanh.ts:1232`): một `0` nói "máy hỏng nặng", một `100` nói
   *   "máy hoàn hảo", và cả hai là lời khai bịa về đại lượng chưa hề đọc.
   */
  diem: number | null;
  /** `predictedFailureRisk` 0–100. `null` = chưa đo. Đo được: 48.550/180.800 hàng khác 0. */
  nguyCo: number | null;
  /** `maintenanceUrgency`. `null` = chưa đo. */
  mucKhan: MucKhanBaoTri | null;
  /** ms epoch của bản ghi sinh ra lời khai. `null` = không rõ ⇒ hết hạn (G30). */
  mocMs: number | null;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* HẠNG SỨC KHOẺ                                                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Hạng sức khoẻ — cái điều khiển MÀU VIỀN ĐẾ và quyền giành nhãn.
 *
 * Năm hạng, và `chua_do`/`het_han` là **hai hạng riêng chứ không gộp vào một**:
 *   `chua_do`  — máy chưa từng có hàng nào trong `machine_health_history`
 *   `het_han`  — máy CÓ hàng, nhưng hàng mới nhất đã quá {@link HAN_KHAI_SUC_KHOE_MS}
 *
 * Gộp hai cái này là đúng lớp lỗi NT-3 mà `canhThietKe` đã phải vá ("rỗng vì yên
 * ổn" ≠ "rỗng vì chưa được gán"): người vận hành xử lý hai tình huống này bằng
 * hai hành động khác nhau — một cái đi hỏi vì sao máy chưa vào hệ đo, một cái đi
 * hỏi vì sao lô tính dừng chạy.
 *
 * ★ ≤ 7 mã màu (§10.2 / ISA-101): năm hạng ở đây + không-viền = 5 mã, còn chỗ.
 */
export type HangSucKhoe = "nguy_kich" | "canh" | "theo_doi" | "khoe" | "chua_do" | "het_han";

/** Ngưỡng NGUY KỊCH — dưới mức này là "phải xử lý trong ca". */
export const NGUONG_NGUY_KICH = 60;

/** Ngưỡng CẢNH — dưới mức này là "đưa vào kế hoạch bảo trì". */
export const NGUONG_CANH = 80;

/** Ngưỡng THEO DÕI — dưới mức này là "để mắt, chưa cần hành động". */
export const NGUONG_THEO_DOI = 90;

/**
 * Hạng của một lời khai. Hàm THUẦN, tất định.
 *
 * ★★★ THỨ TỰ KIỂM QUAN TRỌNG VÀ ĐÃ ĐƯỢC CÂN NHẮC: **hạn trước, điểm sau**.
 *   Một máy 31 điểm với lời khai 18 ngày tuổi phải ra `het_han`, KHÔNG ra
 *   `nguy_kich`. Nghe ngược trực giác ("31 điểm mà không báo động?") nhưng đảo
 *   lại thì cảnh 3D sẽ nhấp nháy đỏ vĩnh viễn ở một máy có thể đã được sửa từ
 *   nửa tháng trước — và người vận hành sẽ học cách phớt lờ màu đỏ. Đó là cái
 *   giá đắt hơn nhiều so với việc khai thẳng "lời khai này quá cũ".
 *   `het_han` vẫn ĐƯỢC VẼ (viền xám gạch), chỉ không giành nhãn bất thường.
 *
 * ★ `mucKhan === "CRITICAL"` nâng hạng lên `nguy_kich` bất kể điểm: hai cột này
 *   là hai phép đo độc lập của cùng một câu hỏi (BG-127 — độc lập phải ở MÔ HÌNH).
 *   Đo được chúng KHÔNG luôn đồng ý: 6.199 hàng CRITICAL trong khi miền điểm chỉ
 *   xuống tới 55, tức là có hàng vừa CRITICAL vừa trên ngưỡng 60. Lấy cái nghiêm
 *   trọng hơn trong hai lời khai là lựa chọn an toàn, và nó được nói ra ở đây
 *   thay vì giấu trong một phép cộng có trọng số.
 */
export function hangSucKhoe(k: KhaiSucKhoe, bayGio: number): HangSucKhoe {
  if (k.diem == null && k.nguyCo == null && k.mucKhan == null) return "chua_do";
  if (!conHanSucKhoe(k.mocMs, bayGio)) return "het_han";
  if (k.mucKhan === "CRITICAL") return "nguy_kich";
  if (k.diem == null) return "chua_do";
  if (k.diem < NGUONG_NGUY_KICH) return "nguy_kich";
  if (k.diem < NGUONG_CANH) return "canh";
  if (k.diem < NGUONG_THEO_DOI) return "theo_doi";
  return "khoe";
}

/**
 * Hạng nào được coi là BẤT THƯỜNG — tức là được quyền giành một trong 30 nhãn.
 *
 * ★★★ CHỈ `nguy_kich`. §14.5.2 xếp "sức khoẻ dưới ngưỡng" ở HẠNG 3, sau E-STOP
 *   và andon mức cao, và trần là 30. Đo được: 6/43 máy dưới 60 điểm nhưng
 *   **21/43 máy dưới 80**. Nếu `canh` cũng giành nhãn thì riêng A-4 đã ăn 21 chỗ
 *   trong 30 — nuốt gần trọn ngân sách của cả bốn hạng còn lại, và biến "bất
 *   thường" thành "đa số", tức là không còn bất thường.
 *
 * ⇒ `canh`/`theo_doi` đọc bằng **màu viền** (0 nhãn, 0 draw call thêm). Chỉ
 *   `nguy_kich` mới được nhãn. Đây là §14.5.0 nguyên văn: đừng tiêu ngân sách
 *   bằng nhãn 3D.
 */
export function laBatThuongSucKhoe(hang: HangSucKhoe): boolean {
  return hang === "nguy_kich";
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* VÒNG VIỀN ĐẾ MÁY — nhóm (A), neo vào vật thể                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Token màu của viền đế theo hạng.
 *
 * ★ §14.7.1 / ASM: nền xám, **độ bão hoà dành cho bất thường**. `khoe` trả `null`
 *   = **KHÔNG VẼ VIỀN**, chứ không phải vẽ viền xanh lá. Một nhà máy khoẻ mạnh
 *   phải trông YÊN TĨNH; 240 vòng xanh lá là 240 thứ để mắt phải loại bỏ, và nó
 *   làm 6 vòng đỏ khó thấy hơn chứ không dễ hơn.
 *
 * `chua_do` cũng trả `null`: chưa đo thì không có gì để khai, và một vòng xám
 * quanh mọi máy chưa vào hệ đo là nhiễu chứ không phải thông tin.
 */
export function mauVienSucKhoe(hang: HangSucKhoe): string | null {
  switch (hang) {
    case "nguy_kich":
      return "#dc2626";
    case "canh":
      return "#f59e0b";
    case "theo_doi":
      return "#eab308";
    case "het_han":
      // Xám: "có lời khai nhưng quá cũ" — thấy được là có gì đó, không hô hoán.
      return "#94a3b8";
    case "khoe":
    case "chua_do":
      return null;
  }
}

/** Một vòng viền đế cần vẽ — đủ để dựng hình học, không hơn. */
export interface VienDeMay {
  machineId: number;
  hang: HangSucKhoe;
  mau: string;
  /** Tâm vòng, mét (hệ toạ độ cảnh). */
  x: number;
  z: number;
  /** Bán kính vòng, mét — suy từ bao hình máy, xem {@link banKinhVien}. */
  banKinhM: number;
  /** Viền của lời khai hết hạn ⇒ vẽ đứt nét / mờ, để không đọc nhầm là số sống. */
  motNhat: boolean;
}

/** Vòng phải LỚN HƠN bao hình máy mới thấy được — hệ số nới. */
export const HE_SO_NOI_VIEN = 0.62;

/** Sàn bán kính, mét: máy rất nhỏ vẫn phải có vòng bấm/nhìn được. */
export const BAN_KINH_VIEN_TOI_THIEU_M = 0.35;

/**
 * Bán kính vòng viền từ bao hình máy (mm → m).
 *
 * Lấy **nửa đường chéo mặt bằng** rồi nới, chứ không lấy nửa cạnh lớn: một máy
 * dài 2400×600 mm mà vòng bán kính 1,2 m sẽ CẮT QUA thân ở hai góc. Đường chéo
 * bảo đảm vòng bao trọn mọi hướng xoay — và `gocXoayRad` của máy làm điều đó
 * thành yêu cầu thật, không phải lo xa.
 */
export function banKinhVien(rongMm: number, sauMm: number): number {
  const r = Number.isFinite(rongMm) ? Math.max(0, rongMm) : 0;
  const s = Number.isFinite(sauMm) ? Math.max(0, sauMm) : 0;
  const nuaCheoM = Math.sqrt(r * r + s * s) / 2 / 1000;
  return Math.max(BAN_KINH_VIEN_TOI_THIEU_M, nuaCheoM * (1 + HE_SO_NOI_VIEN));
}

/** Vị trí + bao hình của một máy, đủ để đặt vòng. Khớp `MayTrongLo` mà không nhập nó. */
export interface ChoDatVien {
  machineId: number;
  viTri: { x: number; z: number };
  kichThuocMm: { rong: number; sau: number };
  /** false ⇒ máy đang ẩn (ngoài phạm vi) ⇒ KHÔNG vẽ vòng. */
  hien?: boolean;
}

/**
 * Quy tập lời khai + tập chỗ đặt ra danh sách vòng cần vẽ.
 *
 * ★★★ CHỈ TRẢ VÒNG CÓ MÀU. Hạng `khoe`/`chua_do` bị loại ngay ở đây, nên tầng
 *   React KHÔNG cần biết luật "khoẻ thì không vẽ" — một luật, một chỗ (G12).
 *   Đo được điều này mua gì: 43 máy, 21 dưới 80 điểm ⇒ khoảng 21 vòng thay vì 43,
 *   và không vòng nào nói "mọi thứ ổn" (điều mà việc KHÔNG có vòng đã nói rồi).
 *
 * ★ Máy có lời khai nhưng KHÔNG có chỗ đặt (chưa xếp bố cục) bị **bỏ im lặng** ở
 *   đây — và đó là đúng, vì không có toạ độ thì không có chỗ nào để vẽ. Số máy
 *   đó đã được dải "N máy chưa đặt chỗ" của trang khai riêng; đếm lại ở đây là
 *   bản đếm thứ hai của cùng một sự thật (D-4).
 */
export function vienSucKhoe(
  khai: readonly KhaiSucKhoe[],
  cho: readonly ChoDatVien[],
  bayGio: number,
): VienDeMay[] {
  const theoMay = new Map<number, KhaiSucKhoe>();
  for (const k of khai) theoMay.set(k.machineId, k);

  const ra: VienDeMay[] = [];
  for (const c of cho) {
    if (c.hien === false) continue;
    const k = theoMay.get(c.machineId);
    if (!k) continue;
    const hang = hangSucKhoe(k, bayGio);
    const mau = mauVienSucKhoe(hang);
    if (mau == null) continue;
    ra.push({
      machineId: c.machineId,
      hang,
      mau,
      x: c.viTri.x,
      z: c.viTri.z,
      banKinhM: banKinhVien(c.kichThuocMm.rong, c.kichThuocMm.sau),
      motNhat: hang === "het_han",
    });
  }
  // Tất định: cùng đầu vào ở bất kỳ thứ tự nào cho cùng đầu ra (khuôn `locNhan`).
  ra.sort((a, b) => a.machineId - b.machineId);
  return ra;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* BẢNG XẾP HẠNG 2D SONG SONG — điều kiện §11.5                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * §11.5 bắt: **mọi lớp phủ màu trên 3D phải có bảng xếp hạng 2D song song**.
 * Lý do là giới hạn thị giác thật — viền hổ phách cho biết "máy này tệ hơn máy
 * kia", KHÔNG cho biết "tệ hơn bao nhiêu" và "còn bao lâu tới hạn bảo trì".
 *
 * ★ Cùng đầu vào, cùng `hangSucKhoe()` với {@link vienSucKhoe} — hai bản cài đặt
 *   rời sẽ lệch (G12, đúng khuôn `xepHangWip`/`cotWip` của `wipTram.ts`).
 */
export interface DongXepHangSucKhoe {
  machineId: number;
  hang: HangSucKhoe;
  diem: number | null;
  nguyCo: number | null;
  mucKhan: MucKhanBaoTri | null;
  mocMs: number | null;
  /** Có chỗ đặt trên cảnh không — bảng 2D vẫn liệt kê máy chưa xếp bố cục. */
  coTrenCanh: boolean;
}

const THU_TU_HANG: Record<HangSucKhoe, number> = {
  nguy_kich: 0,
  canh: 1,
  theo_doi: 2,
  het_han: 3,
  khoe: 4,
  chua_do: 5,
};

/**
 * Xếp hạng mọi máy CÓ lời khai — tệ nhất lên đầu.
 *
 * ★ KHÔNG lọc `khoe`: bảng 2D là chỗ để đọc kỹ và so sánh, khác hẳn cảnh 3D là
 *   chỗ để liếc. Một người muốn kiểm "máy tôi phụ trách có ổn không" cần thấy
 *   nó ở đó với điểm 94, chứ không phải suy ra từ việc nó vắng mặt.
 *
 * ★ Hoà thì so `machineId` tăng dần — nhánh hoà KHÔNG được bỏ, nếu không thứ tự
 *   bảng nhảy mỗi lần dữ liệu về (đúng bài học `soSanh` của `locNhan.ts`).
 */
export function xepHangSucKhoe(
  khai: readonly KhaiSucKhoe[],
  idsTrenCanh: readonly number[],
  bayGio: number,
): DongXepHangSucKhoe[] {
  const tapCanh = new Set(idsTrenCanh);
  return khai
    .map((k) => ({
      machineId: k.machineId,
      hang: hangSucKhoe(k, bayGio),
      diem: k.diem,
      nguyCo: k.nguyCo,
      mucKhan: k.mucKhan,
      mocMs: k.mocMs,
      coTrenCanh: tapCanh.has(k.machineId),
    }))
    .sort((a, b) => {
      const ha = THU_TU_HANG[a.hang];
      const hb = THU_TU_HANG[b.hang];
      if (ha !== hb) return ha - hb;
      // Trong cùng hạng: điểm thấp hơn (tệ hơn) lên trước. `null` xuống cuối.
      const da = a.diem ?? Number.POSITIVE_INFINITY;
      const db = b.diem ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return a.machineId - b.machineId;
    });
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TÓM TẮT ĐẾM ĐƯỢC — cho chip nổi / dải trạng thái                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Đếm theo hạng + số máy KHÔNG có lời khai nào.
 *
 * ★★★ G9 — ĐƠN VỊ CỦA CON SỐ. `soKhongCoKhai` đếm **máy trên cảnh mà tập lời
 *   khai không nhắc tới**, khác hẳn hạng `chua_do` (máy CÓ hàng nhưng mọi cột
 *   NULL). Trộn hai cái này lại là nói dối về số lượng, và đó đúng là lớp lỗi
 *   "đếm ĐẦU VÀO ≠ ĐẦU RA" đã phải trả giá ở G5/G6/G7/G10.
 *
 * ★ `tongTrenCanh` được trả ra để người gọi ĐỐI CHIẾU TỔNG (BG-127): tổng bốn
 *   hạng + `soKhongCoKhai` phải bằng `tongTrenCanh`. Bất biến đó được test ghim.
 */
export interface TomTatSucKhoe {
  nguy_kich: number;
  canh: number;
  theo_doi: number;
  khoe: number;
  chua_do: number;
  het_han: number;
  /** Máy có mặt trên cảnh mà KHÔNG có hàng nào trong tập lời khai. */
  soKhongCoKhai: number;
  /** Số máy trên cảnh — mẫu số của mọi tỷ lệ, khai ra để không ai tự đoán. */
  tongTrenCanh: number;
}

export function tomTatSucKhoe(
  khai: readonly KhaiSucKhoe[],
  idsTrenCanh: readonly number[],
  bayGio: number,
): TomTatSucKhoe {
  const theoMay = new Map<number, KhaiSucKhoe>();
  for (const k of khai) theoMay.set(k.machineId, k);

  const ra: TomTatSucKhoe = {
    nguy_kich: 0,
    canh: 0,
    theo_doi: 0,
    khoe: 0,
    chua_do: 0,
    het_han: 0,
    soKhongCoKhai: 0,
    tongTrenCanh: idsTrenCanh.length,
  };

  for (const id of idsTrenCanh) {
    const k = theoMay.get(id);
    if (!k) {
      ra.soKhongCoKhai += 1;
      continue;
    }
    ra[hangSucKhoe(k, bayGio)] += 1;
  }
  return ra;
}
