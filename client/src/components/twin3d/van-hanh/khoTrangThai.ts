/**
 * khoTrangThai.ts — ★★★ MỘT KHO TRẠNG THÁI DUY NHẤT CHO **LIVE** VÀ **REPLAY** (§9.8).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MỘT KHO, KHÔNG PHẢI HAI — §9.8 GỌI ĐÍCH DANH
 * ════════════════════════════════════════════════════════════════════════════
 * *"Nguyên tắc bắt buộc: CÙNG MỘT state store cho live và replay, chỉ đổi nguồn
 * (socket `twin:update` → API lịch sử). Tách hai code path thì replay sẽ luôn
 * lệch."*
 *
 * Lý do sâu hơn câu chữ: hai code path nghĩa là hai bản cài đặt của cùng một
 * luật (tuổi → màu, ghi đè `khong_ro`, đếm rỗng ≠ đếm 0). Hai bản chỉ đồng ý tới
 * lần sửa đầu tiên — và khi lệch thì **KHÔNG NỔ**, chỉ âm thầm cho tua lại vẽ
 * khác trực tiếp. Người vận hành tua về 10 phút trước để hiểu một sự cố, và thấy
 * một bức tranh chưa từng tồn tại. Đây đúng luật G12 đã cắn dự án này một lần
 * (`NGUONG_CU_MS` hai bản, Đợt 5).
 *
 * ⇒ Ở đây chỉ có **MỘT** hàm chuyển trạng thái: `apDung()`. Live và replay khác
 *   nhau ĐÚNG ở chỗ ai gọi nó và với `NguonMoc` nào. Không có nhánh `if (replay)`
 *   nào trong phép tính — nếu có, luật trên đã bị phá.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G15 — BA TRẠNG THÁI CỦA MỘT CHỈ SỐ: đã đo · đang đo · CHƯA TỪNG đo
 * ════════════════════════════════════════════════════════════════════════════
 * `useTwinStream` cũ có hai lỗi câm mà kho này sinh ra để thay:
 *   1. `isStreaming` MỘT CHIỀU (`false → true`, không bao giờ về): stream chết
 *      rồi thì cờ vẫn `true` mãi ⇒ UI khai "đang trực tiếp" trên dữ liệu đứng im.
 *   2. `lastUpdate: null` LẪN "chưa bao giờ nhận" với "vừa mount".
 * Cả hai đều biểu hiện thành *màn hình không đổi*, và không cái nào kêu.
 *
 * `TrangThaiKetNoi` tách đúng ba câu đó, và `ketNoiTheoMoc()` cho phép cờ
 * "đang trực tiếp" **TỰ TẮT** khi quá lâu không có sự kiện — chiều mà bản cũ
 * thiếu hoàn toàn.
 *
 * ★ Module THUẦN (RB-8.1): không three, không react, không `Date.now()` ẩn —
 *   `bayGio` luôn là THAM SỐ. Nhờ vậy test được ở `environment: "node"` và tua
 *   lại không phải giả lập đồng hồ hệ thống.
 */

import { trangThaiHienThi, type MayVanHanh, type TrangThaiHienThi } from "./trungThucDuLieu";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* NGUỒN VÀ BA TRẠNG THÁI KẾT NỐI                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Dữ liệu trong kho đến từ đâu. Ô này KHÔNG đổi phép tính — nó chỉ để UI nói
 * đúng câu ("đang trực tiếp" vs "đang xem lại 14:32"). Phép tính giống hệt nhau
 * ở cả hai, và đó chính là điều §9.8 đòi.
 */
export type NguonMoc = "socket" | "truy_van" | "lich_su";

/**
 * ★★★ BA TRẠNG THÁI CỦA ĐƯỜNG SỐ LIỆU (G15) — không phải hai.
 *
 *   `chua_ket_noi` — CHƯA TỪNG nhận gì. UI phải hiện `—`, KHÔNG hiện `0`.
 *   `dang_cho`     — đã kết nối, chưa có sự kiện đầu tiên. Khác hẳn ô trên:
 *                    ở đây ta BIẾT đường đi thông, chỉ là chưa tới lượt phát.
 *   `truc_tiep`    — có sự kiện gần đây (trong `NGUONG_SONG_MS`).
 *   `im_lang`      — ĐÃ từng nhận, nhưng im quá lâu ⇒ dữ liệu đang cũ dần.
 *                    Đây là chiều mà `isStreaming` một chiều KHÔNG diễn đạt nổi.
 *   `xem_lai`      — đang tua lịch sử; "tươi" không còn nghĩa gì.
 */
export type TrangThaiKetNoi =
  | "chua_ket_noi"
  | "dang_cho"
  | "truc_tiep"
  | "im_lang"
  | "xem_lai";

/**
 * Quá bao lâu không có sự kiện thì coi là `im_lang`.
 *
 * ★ 25 giây = 2,5 nhịp của broadcaster `twin:trangThai` (10 s). Chọn bội số của
 *   nhịp phát chứ không phải một số tròn tuỳ ý: một nhịp lỡ vì mạng chậm KHÔNG
 *   được làm cả màn hình đổi trạng thái, nhưng hai nhịp liên tiếp mất thì đúng
 *   là có chuyện. Đây cũng là lý do KHÔNG dùng `NGUONG_TUOI_MS` (60 s) — ngưỡng
 *   đó nói về TUỔI DỮ LIỆU, còn ô này nói về SỨC KHOẺ ĐƯỜNG TRUYỀN. Hai đại
 *   lượng khác nhau; gộp chúng là đúng lỗi G7 "đo nhầm đại lượng".
 */
export const NGUONG_SONG_MS = 25_000;

/* ═══════════════════════════════════════════════════════════════════════════ */
/* KHO                                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Một mốc trạng thái máy — hình dạng CHUNG cho socket, tRPC và lịch sử. */
export interface MocTrangThai {
  machineId: number;
  trangThai: string | null;
  /** ms epoch của DỮ LIỆU. `null` = CHƯA TỪNG báo cáo (KHÔNG quy về 0). */
  capNhatLuc: number | null;
  isActive: boolean;
}

export interface KhoTrangThai {
  /** `machineId` → mốc mới nhất đã biết. */
  theoMay: ReadonlyMap<number, MocTrangThai>;
  /** Thời điểm kho nhận gói cuối (đồng hồ SERVER). `null` = chưa từng nhận. */
  nhanLuc: number | null;
  nguon: NguonMoc | null;
  /** Mốc thời gian đang xem khi tua lại; `null` = đang ở trực tiếp. */
  mocXemLai: number | null;
}

export const KHO_RONG: KhoTrangThai = {
  theoMay: new Map(),
  nhanLuc: null,
  nguon: null,
  mocXemLai: null,
};

/**
 * ★★★ HÀM CHUYỂN TRẠNG THÁI **DUY NHẤT**. Live và replay đều đi qua đây.
 *
 * ⚠ KHÔNG có tham số `laReplay` và sẽ không bao giờ có. Nếu một ngày ai đó cần
 *   thêm nó, đó là dấu hiệu hai đường đã bắt đầu tách — và §9.8 nói thẳng điều
 *   gì xảy ra sau đó.
 *
 * ★ `mocXemLai` chỉ là NHÃN: nó nói "ảnh này chụp lúc T", không tham gia vào
 *   phép hợp nhất. Nhờ vậy tua lại dùng đúng phép tính của trực tiếp.
 */
export function apDung(
  kho: KhoTrangThai,
  goi: {
    may: readonly MocTrangThai[];
    /** Đồng hồ SERVER lúc phát — KHÔNG dùng đồng hồ client (§10.2). */
    bayGio: number;
    nguon: NguonMoc;
    /** Đặt khi đây là ảnh lịch sử; `null`/bỏ trống = trực tiếp. */
    mocXemLai?: number | null;
  },
): KhoTrangThai {
  /*
   * Gói THAY THẾ toàn bộ ảnh, không merge từng máy.
   *
   * ★ Vì sao thay thế: một máy BIẾN MẤT khỏi gói là một thông tin (bị gỡ khỏi
   *   nhà máy, hoặc ra ngoài phạm vi người xem). Merge sẽ giữ nó lại vĩnh viễn
   *   với giá trị cũ — màn hình vẽ một cái máy không còn ở đó nữa, và không gì
   *   kêu. Đây là biến thể "giữ giá trị cuối cùng" của chính lớp lỗi NT-3.
   */
  const theoMay = new Map<number, MocTrangThai>();
  for (const m of goi.may) theoMay.set(m.machineId, m);
  return {
    theoMay,
    nhanLuc: goi.bayGio,
    nguon: goi.nguon,
    mocXemLai: goi.mocXemLai ?? null,
  };
}

/**
 * ★★★ BA (thực ra NĂM) TRẠNG THÁI KẾT NỐI — phép đo, không phải cờ tự khai.
 *
 * `daKetNoi` là sự thật của tầng transport (socket đã `connect` chưa). Kho không
 * tự biết điều đó nên nhận vào; mọi thứ còn lại suy từ SỐ, không từ cờ:
 *
 *   chưa kết nối          → `chua_ket_noi`   (UI: `—`, KHÔNG phải `0`)
 *   đã nối, chưa có gói   → `dang_cho`
 *   có gói, còn mới       → `truc_tiep`
 *   có gói, quá NGƯỠNG    → `im_lang`        ← chiều `isStreaming` cũ KHÔNG có
 *   đang tua              → `xem_lai`
 */
export function ketNoiTheoMoc(
  kho: KhoTrangThai,
  daKetNoi: boolean,
  bayGio: number,
): TrangThaiKetNoi {
  if (kho.mocXemLai != null) return "xem_lai";
  if (kho.nhanLuc == null) return daKetNoi ? "dang_cho" : "chua_ket_noi";
  // ĐÃ từng nhận: cờ transport không còn quyết định — SỐ quyết định. Một socket
  // "connected" mà 5 phút không phát gì thì không phải là "trực tiếp".
  return bayGio - kho.nhanLuc <= NGUONG_SONG_MS ? "truc_tiep" : "im_lang";
}

/**
 * Hợp nhất kho vào danh sách máy để ra `MayVanHanh` — đầu vào của
 * `trangThaiHienThi` (NT-3) và của mọi bề mặt (3D, 2D, bảng, ô đếm).
 *
 * ★ Máy KHÔNG có trong kho giữ nguyên `trangThaiBaoCao`/`thoiDiemDuLieu` từ
 *   truy vấn nền. Kho là lớp PHỦ realtime, không phải nguồn duy nhất — lúc mới
 *   mở trang kho còn rỗng, và một cảnh trống trơn ở giây đầu tiên là chính cái
 *   "0 giả" mà NT-3 cấm.
 */
export function hopNhat(
  nen: readonly MayVanHanh[],
  kho: KhoTrangThai,
): MayVanHanh[] {
  if (kho.theoMay.size === 0) return [...nen];
  return nen.map((m) => {
    const moc = kho.theoMay.get(m.id);
    if (!moc) return m;
    return {
      ...m,
      trangThaiBaoCao: moc.trangThai,
      thoiDiemDuLieu: moc.capNhatLuc,
      isActive: moc.isActive,
    };
  });
}

/**
 * Trạng thái HIỂN THỊ theo máy — đi qua `trangThaiHienThi` (NT-3) nên tua lại
 * và trực tiếp cưỡng chế CÙNG luật `khong_ro`.
 *
 * ⚠ `bayGio` khi tua lại phải là **mốc đang xem**, không phải giờ hiện tại: một
 *   máy im lặng lúc 14:32 phải hiện y như nó đã hiện lúc 14:32, chứ không phải
 *   "cũ 3 tiếng" tính từ bây giờ. Người gọi truyền `mocXemLai ?? Date.now()`.
 */
export function trangThaiTheoMay(
  may: readonly MayVanHanh[],
  bayGio: number,
): Map<number, TrangThaiHienThi> {
  const m = new Map<number, TrangThaiHienThi>();
  for (const mv of may) m.set(mv.id, trangThaiHienThi(mv, bayGio));
  return m;
}

/**
 * Đồng hồ dùng để xét tuổi: mốc đang tua nếu có, nếu không thì giờ hiện tại.
 * Tách thành hàm vì đây là chỗ DUY NHẤT được quyết định điều đó — chép tay ở
 * nhiều nơi là đường chắc chắn dẫn tới live và replay xét tuổi khác nhau.
 */
export function dongHoHienThi(kho: KhoTrangThai, bayGio: number): number {
  return kho.mocXemLai ?? bayGio;
}
