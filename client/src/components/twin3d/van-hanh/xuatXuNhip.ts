/**
 * xuatXuNhip.ts — §14.5.3 **B-3: TUỔI DỮ LIỆU + LIVE/POLL TRUNG THỰC** (mục G-6, F-04).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G74 — ĐẾM LẠI TRƯỚC KHI VIẾT. CÁI GÌ ĐÃ CÓ, CÁI GÌ THẬT SỰ THIẾU
 * ════════════════════════════════════════════════════════════════════════════
 * Brief giao mục G-6 là *"lớp phủ UNS realtime + badge live/poll trung thực"*.
 * Đếm lại trên mã (G70 — liệt kê MỌI export, không đếm tên tệp):
 *
 *   `phuUns.ts`     — ĐÃ CÓ và ĐÃ ĐƯỢC GỌI THẬT. `TwinVanHanh.tsx:154` import
 *                     `mocTuAnhChupUns`, và `useKhoTrangThai` nhận `datMocUns`
 *                     (`:416`). Exports: `AnhChupUns` · `trangThaiTuUns` ·
 *                     `mocTuUns` · `mocTuAnhChupUns`. ⇒ **KHÔNG viết bản thứ hai** (G12).
 *   `trang-thai-ket-noi` — ĐÃ CÓ (`TwinVanHanh.tsx:2342`), năm ô G15.
 *   `badge-xuat-xu`      — ĐÃ CÓ (`:2383`), bốn ô SHADOW/MÔ PHỎNG/SƠ ĐỒ/—.
 *   `nguonDuLieu.ts`     — ĐÃ CÓ: `nhipHoiMs` · `xuatXuHienTai` · `laGiaDinh` ·
 *                     `coLuongTheoKetNoi` · `nhipHoiToiDa` + 2 hằng nhịp.
 *
 * ⇒ Phần lớn G-6 **đã nối sẵn** — đúng như G74 cảnh báo. Vậy cái gì THIẾU?
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHOẢNG TRỐNG THẬT — HAI CÂU KHÁC NHAU BỊ TRẢ LỜI BẰNG MỘT CHỈ BÁO
 * ════════════════════════════════════════════════════════════════════════════
 * `trang-thai-ket-noi` trả lời *"**SOCKET** có khoẻ không"*. Nhưng câu người vận
 * hành thật sự hỏi là *"**CON SỐ TÔI ĐANG NHÌN** đến từ đâu"*. Hai câu đó KHÔNG
 * đồng nhất, và chỗ chúng tách ra là chỗ đo được:
 *
 *   `nhipHoiMs`/`nhipHoiToiDa` (`nguonDuLieu.ts:52,144`) làm poll tRPC **chạy
 *   SONG SONG với socket, không bao giờ tắt hẳn** — 30 s khi luồng khoẻ, 5 s khi
 *   không. Docblock của nó nói thẳng vì sao: *"tắt hẳn nghĩa là một luồng chết
 *   âm thầm sẽ đóng băng màn hình vĩnh viễn"*.
 *
 * ⇒ Khi badge nói **"Trực tiếp"**, một phần các con số trên màn vẫn đến từ lượt
 *   **poll 30 s** — và người đọc không có cách nào biết. Ngược lại, khi badge nói
 *   "Im lặng", poll đã rút xuống 5 s và màn hình thật ra đang **tươi hơn** vẻ
 *   ngoài của nó. Cả hai chiều đều là lời khai lệch.
 *
 * ★★★ Đây đúng họ G7 — **CHỈ BÁO ĐO NHẦM ĐẠI LƯỢNG**: nó đo sức khoẻ đường ống,
 *   rồi được đọc như xuất xứ của dữ liệu. Cùng lớp với "đếm ĐẦU VÀO ≠ ĐẦU RA".
 *
 * ⇒ Việc của module này: **nối thêm nguồn vào chỉ báo đã có**, đúng như brief
 *   giao — quy (trạng thái socket × mốc gói cuối × nhịp poll) ra một câu nói
 *   thẳng *cơ chế nào vừa giao con số này*, kèm **nhịp hiệu lực** để người đọc
 *   biết "tối đa bao lâu nữa nó mới đổi".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G72 — MODULE THUẦN TRẢ DỮ LIỆU CÓ CẤU TRÚC, KHÔNG PHÁT VĂN XUÔI
 * ════════════════════════════════════════════════════════════════════════════
 * Không hàm nào ở đây trả chuỗi hiển thị. Trả **mã** (`day`/`hoi`/`hon_hop`/…)
 * và **số ms**; dịch ra chữ là việc của tầng React qua `t()`. `nhanTuoi` từng in
 * thẳng *"(17 ngày ago)"* — lỗi module thuần phát văn xuôi, không lặp lại.
 *
 * ★ RB-8.1 — `bayGio` là THAM SỐ, không đọc `Date.now()` bên trong: khi TUA LẠI
 *   thì mọi phán xét về độ tươi phải tính theo mốc ĐANG XEM.
 */

import { NHIP_CO_LUONG_MS, NHIP_KHONG_LUONG_MS, coLuongTheoKetNoi } from "./nguonDuLieu";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* CƠ CHẾ GIAO SỐ                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Cơ chế nào vừa giao con số đang hiện.
 *
 *   `day`      — WEBSOCKET đẩy. Socket khoẻ VÀ vừa có gói trong ngưỡng sống.
 *   `hon_hop`  — socket khoẻ, NHƯNG poll nền vẫn chạy 30 s và một phần số trên
 *                màn đến từ đó. Đây là trạng thái THẬT SỰ THƯỜNG GẶP nhất, và
 *                là ô mà chỉ báo cũ gộp nhầm vào "Trực tiếp".
 *   `hoi`      — CHỈ có poll tRPC. Không luồng, hoặc luồng im quá ngưỡng.
 *   `lich_su`  — đang tua lại; không cơ chế nào "đang giao" gì cả.
 *   `chua_ro`  — chưa có bằng chứng nào (chưa tải xong).
 */
export type CoCheGiao = "day" | "hon_hop" | "hoi" | "lich_su" | "chua_ro";

/** Đầu vào để quy ra cơ chế. Mọi ô đều ĐO ĐƯỢC, không ô nào là ý kiến. */
export interface TinhHinhNguon {
  /** Năm ô của `khoTrangThai.TrangThaiKetNoi`. */
  ketNoi: string;
  /**
   * ms epoch của gói SOCKET cuối cùng. `null` = chưa từng nhận gói nào.
   *
   * ★ Đây là mốc của GÓI, không phải mốc render. NT-3.4: lấy `Date.now()` lúc
   *   gói tới sẽ làm mọi thứ trông như vừa cập nhật kể cả khi ta chỉ nhận lại
   *   một snapshot cũ.
   */
  mocGoiCuoi: number | null;
  /** ms epoch của lượt POLL tRPC cuối. `null` = chưa lượt nào xong. */
  mocPollCuoi: number | null;
  /** Người dùng đang tua lịch sử? */
  dangXemLai: boolean;
}

/**
 * Bao lâu không có gói thì thôi coi socket là đang giao số.
 *
 * ★ Cố ý DÀI HƠN `NHIP_CO_LUONG_MS` (30 s) một chút. Nếu ngắn hơn nhịp poll thì
 *   chỉ báo sẽ nhấp nháy `day` ↔ `hon_hop` mỗi chu kỳ ngay cả khi mọi thứ khoẻ —
 *   một chỉ báo nhấp nháy là chỉ báo bị phớt lờ. 35 s cho socket một cửa sổ ân
 *   hạn đủ để một nhịp poll xen vào mà không đổi kết luận.
 */
export const NGUONG_GOI_CON_MOI_MS = 35_000;

/**
 * ★★★ Quy ra cơ chế giao. Thứ tự kiểm KHÔNG được đổi.
 *
 * 1. `dangXemLai` THẮNG mọi thứ — cùng lý lẽ `dangMoPhong` thắng trong
 *    `xuatXuHienTai`: khi màn đang vẽ lịch sử, việc đường ống live có khoẻ hay
 *    không **không đổi được** câu trả lời cho *"cái tôi đang nhìn đến từ đâu"*.
 * 2. Chưa có bằng chứng nào (không gói, không poll) ⇒ `chua_ro`, KHÔNG phải
 *    `hoi`. Khai "đang hỏi" khi chưa lượt nào xong là bịa một cơ chế chưa chạy.
 * 3. Socket khoẻ + gói còn mới ⇒ `day` hay `hon_hop`, phân biệt bằng việc poll
 *    có thật sự vừa giao gì không.
 * 4. Còn lại ⇒ `hoi`.
 *
 * ★★★ Ô `hon_hop` là TOÀN BỘ giá trị mà module này mua được. Bỏ nó đi thì hàm
 *   này trở thành `coLuongTheoKetNoi` viết dài dòng — và đó chính là bản cài đặt
 *   thứ hai mà G12 cấm.
 */
export function coCheGiao(t: TinhHinhNguon, bayGio: number): CoCheGiao {
  if (t.dangXemLai) return "lich_su";
  if (t.mocGoiCuoi == null && t.mocPollCuoi == null) return "chua_ro";

  const goiConMoi =
    t.mocGoiCuoi != null &&
    Number.isFinite(t.mocGoiCuoi) &&
    bayGio - t.mocGoiCuoi <= NGUONG_GOI_CON_MOI_MS;

  if (coLuongTheoKetNoi(t.ketNoi) && goiConMoi) {
    /*
     * Socket đang giao. Nhưng poll nền KHÔNG tắt (`nguonDuLieu.ts:52` — 30 s khi
     * có luồng), nên nếu có lượt poll đã xong thì một phần số trên màn đến từ
     * đó. Nói `hon_hop` thay vì `day` là chỗ chỉ báo này trung thực hơn cái cũ.
     */
    return t.mocPollCuoi != null ? "hon_hop" : "day";
  }
  return "hoi";
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* NHỊP HIỆU LỰC — "tối đa bao lâu nữa con số này mới đổi"                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Chu kỳ làm mới TỆ NHẤT của những con số đang hiện, ms.
 *
 * ★★★ Vì sao đại lượng này cần được khai, và vì sao nó KHÔNG phải "tuổi dữ liệu":
 *   tuổi nói *"số này sinh ra bao lâu rồi"* (quá khứ); nhịp hiệu lực nói *"tối đa
 *   bao lâu nữa tôi mới biết nếu nó đổi"* (tương lai). Người vận hành cần cái
 *   thứ hai để quyết định có được rời mắt khỏi màn hình hay không, và hiện
 *   KHÔNG chỉ báo nào trên `/twin` trả lời nó.
 *
 * `null` khi đang tua lịch sử: một ảnh lịch sử **không tự làm mới**, và trả một
 * con số ms ở đó là hứa một điều không xảy ra.
 *
 * ★ Với `day`/`hon_hop` trả `NHIP_CO_LUONG_MS` (30 s) chứ KHÔNG trả 0: socket
 *   đẩy khi CÓ thay đổi, nên bảo đảm xấu nhất mà hệ thật sự đưa ra vẫn là lượt
 *   poll nền. Khai `0` ("luôn tức thời") là đúng thứ lời khai không kiểm được mà
 *   §14.5.6 cấm với `oee_metrics` (`?? 0` là lời khai sai).
 */
export function nhipHieuLucMs(cc: CoCheGiao): number | null {
  switch (cc) {
    case "lich_su":
      return null;
    case "day":
    case "hon_hop":
      return NHIP_CO_LUONG_MS;
    case "hoi":
    case "chua_ro":
      return NHIP_KHONG_LUONG_MS;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* LỜI KHAI GỘP — thứ tầng React đọc                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Mọi thứ chỉ báo B-3 cần, ở dạng CÓ CẤU TRÚC.
 *
 * ★ G72 — không ô nào là câu chữ. `coChe` là mã để `t()` tra khoá; `tuoiMs` và
 *   `nhipHieuLucMs` là số để tầng trên định dạng theo ngôn ngữ người dùng.
 */
export interface KhaiNguonSo {
  coChe: CoCheGiao;
  /** Tuổi của con số MỚI NHẤT trên màn, ms. `null` = chưa từng có dữ liệu. */
  tuoiMs: number | null;
  /** Chu kỳ làm mới tệ nhất, ms. `null` = không tự làm mới (đang tua). */
  nhipHieuLucMs: number | null;
  /**
   * `true` khi con số đang hiện KHÔNG đến từ đường đẩy — UI nên nói rõ.
   *
   * ★ Tách thành cờ riêng để không nơi nào phải nhớ danh sách mã, đúng khuôn
   *   `laGiaDinh(xuatXu)` của `nguonDuLieu.ts`.
   */
  chiTuHoi: boolean;
}

/**
 * Gộp lời khai B-3.
 *
 * ★★★ `tuoiMs` lấy **MỚI NHẤT của cả hai cơ chế**, không phải của riêng socket.
 *   Đây là chỗ dễ sai nhất và nó đã cắn dự án này một lần: `chonNguonMocTuoi`
 *   (`server/db/twinCanh.ts`) phải vá đúng lớp lỗi ngược lại — lấy `max` của
 *   những nguồn KHÔNG cùng đại lượng làm máy im lặng 52 ngày tự khai là mới
 *   0,4 ngày.
 *
 *   Khác biệt then chốt: ở ĐÓ hai nguồn trả lời hai câu khác nhau (nhịp tim vs
 *   log trạng thái) nên `max` là sai. Ở ĐÂY cả hai trả lời ĐÚNG MỘT câu — *"lần
 *   cuối màn hình này nhận được dữ liệu mới là khi nào"* — chỉ khác đường vận
 *   chuyển. Nên `max` là ĐÚNG, và lý do phải nói ra thay vì để người đọc sau
 *   tưởng đây là cùng cái bẫy.
 */
export function khaiNguonSo(t: TinhHinhNguon, bayGio: number): KhaiNguonSo {
  const cc = coCheGiao(t, bayGio);

  const mocs = [t.mocGoiCuoi, t.mocPollCuoi].filter(
    (m): m is number => m != null && Number.isFinite(m),
  );
  const moiNhat = mocs.length > 0 ? Math.max(...mocs) : null;

  return {
    coChe: cc,
    /*
     * ★ Tuổi ÂM bị kẹp về 0. Một mốc ở tương lai (đồng hồ client lệch, hoặc
     *   server gửi mốc lệch múi giờ) sẽ cho tuổi âm, và "-3 giây trước" là câu
     *   không ai đọc được. Kẹp, chứ không `null`: ta CÓ dữ liệu, chỉ là đồng hồ
     *   lệch — trả `null` sẽ khai nhầm thành "chưa từng có dữ liệu".
     */
    tuoiMs: moiNhat == null ? null : Math.max(0, bayGio - moiNhat),
    nhipHieuLucMs: nhipHieuLucMs(cc),
    chiTuHoi: cc === "hoi",
  };
}
