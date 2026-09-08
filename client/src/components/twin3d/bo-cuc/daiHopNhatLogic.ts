/**
 * ════════════════════════════════════════════════════════════════════════════
 * `daiHopNhatLogic.ts` — DẢI TRẠNG THÁI HỢP NHẤT (spec §13b 14.4)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ VẤN ĐỀ ĐO ĐƯỢC MÀ TỆP NÀY CHỮA (§13b 14.1.2)
 *
 * `/twin` có tới **tám dải ngang `shrink-0`** xếp chồng DỌC trên canvas. Đo trên
 * `TwinVanHanh.tsx` (bản trước Đợt 21):
 *
 *     header công cụ         :2006   48 px   LUÔN
 *     dải kết quả xuất USD   :2055  ~28 px   sau khi bấm Xuất
 *     banner thiếu quyền     :2255  ~26 px   khi có FORBIDDEN
 *     banner đối soát lệch   :2273  ~26 px   khi máy chưa đặt chỗ
 *     banner ngoài lượt nạp  :2303  ~26 px   khi có máy tầng khác
 *     banner hạ cấp phạm vi  :2334  ~26 px   khi ?pv=tapdoan
 *     banner link bỏ qua     :2357  ~26 px   khi link cũ
 *     dải E-STOP             :2381  ~30 px   khi robot estop
 *                                   ──────
 *     ca xấu nhất                   280 px = 39 % của 720
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ VÌ SAO KHÔNG "CHỮA" BẰNG CÁCH BỎ BANNER
 * ────────────────────────────────────────────────────────────────────────────
 * Mỗi banner ở trên là **một lời khai trung thực** mà các đợt trước đổ công vá
 * vào (NT-3, honest-null, F2/F3, CHẶN-2). Bỏ chúng = đổi một lời khai ĐÚNG lấy
 * một chỗ IM LẶNG — chính lỗi mà `TwinVanHanh.tsx:2296-2300` viết ra để cảnh
 * báo. Người dùng sẽ thấy một màn hình sạch sẽ và tin rằng không có gì bất
 * thường, trong khi 373 máy đang nằm ngoài lượt nạp.
 *
 * ⇒ **Chữa đúng: đổi HÌNH DẠNG của lời khai, giữ nguyên NỘI DUNG.** Tám dải
 *   thành MỘT dải cao 26 px; bấm mở thì phần chi tiết **nổi ĐÈ** lên canvas
 *   (`absolute`), nên canvas KHÔNG co lại dù mở hay đóng.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ LUẬT CỨNG 1 — DẢI AN TOÀN KHÔNG BAO GIỜ BỊ GỘP
 * ────────────────────────────────────────────────────────────────────────────
 * Khi có E-STOP, dải an toàn hiện RIÊNG, đỏ, LUÔN MỞ, và dải hợp nhất chỉ mang
 * phần còn lại. An toàn không xếp hàng sau bố cục — đúng nguyên văn
 * `TwinVanHanh.tsx:2370-2374`. `tachAnToan()` cưỡng chế điều đó ở tầng dữ liệu,
 * nên không có đường nào để một lượt render "quên" tách.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ LUẬT CỨNG 2 (G9) — ĐƠN VỊ CỦA CON SỐ
 * ────────────────────────────────────────────────────────────────────────────
 * "3 việc cần biết" phải là số **mục thật sự đang bật**, KHÔNG phải số **loại**
 * mục. Đây đúng lớp lỗi G9 đã ghi ở sổ ("33 mục" = 33 DÒNG = 7 khoá). Nên
 * `demViec()` đếm trên chính mảng đã lọc `hien === true`, và test cưỡng chế
 * một ca có 2 loại tắt / 3 loại bật ⇒ ra **3**, không ra 5.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★ LUẬT CỨNG 3 — GIỮ NGUYÊN `data-testid` CŨ
 * ────────────────────────────────────────────────────────────────────────────
 * Mỗi mục mang lại đúng `data-testid` mà bánh cóc e2e sẵn có đang tra
 * (`banner-doi-soat`, `banner-ngoai-luot-nap`, `banner-ha-cap`,
 * `banner-link-bi-bo-qua`, `banner-thieu-quyen-truy-van`,
 * `bang-ket-qua-xuat-usd`). Đổi bố cục KHÔNG được đổi hợp đồng đo — nếu không,
 * "suite xanh" sau đợt này chỉ chứng minh rằng ta đã đổi cả đề thi lẫn bài làm.
 *
 * ★ Module THUẦN: không react, không DOM, không `window`. `vitest` chạy
 *   `environment: "node"` và thu `*.unit.test.ts` (RB-8.1), nên mọi luật đếm/
 *   tách/sắp xếp phải nằm ở đây thì mới canh được bằng test.
 */

/**
 * Nhóm của một mục — quyết định MÀU và quyết định mục có được phép ẩn không.
 *
 * ★ ISA-101 (§13c.2): xám trung tính là mặc định, **màu chỉ dành cho bất
 *   thường**. Ba nhóm ⇒ đúng ba mức, không đẻ thang mười bậc.
 */
export type NhomViec = "anToan" | "duLieu" | "phamVi";

/** Thứ tự nghiêm ngặt: an toàn trước, rồi dữ liệu, rồi phạm vi. */
const THU_TU_NHOM: Readonly<Record<NhomViec, number>> = {
  anToan: 0,
  duLieu: 1,
  phamVi: 2,
};

/**
 * Một "việc cần biết" — một lời khai của trang, ở dạng dữ liệu.
 *
 * ⚠ `noiDung` cố tình là `string`, KHÔNG phải `ReactNode`: giữ module này thuần
 *   để test được ở `environment: "node"`. Chỗ nào cần nút bấm thì khai qua
 *   `hanhDong` (nhãn + khoá), và tầng React tra khoá ra `onClick`.
 */
export interface MucViec {
  /** `data-testid` NGUYÊN VĂN của banner cũ — hợp đồng đo, xem LUẬT CỨNG 3. */
  testId: string;
  nhom: NhomViec;
  /** Điều kiện bật. `false` ⇒ mục KHÔNG được đếm và KHÔNG được render. */
  hien: boolean;
  noiDung: string;
  /** Nút phụ (nếu có): khoá để tầng React tra ra hàm, và nhãn để hiện. */
  hanhDong?: { khoa: string; nhan: string };
  /** Thuộc tính `data-*` phụ mà banner cũ mang — giữ nguyên để e2e không đỏ. */
  dataPhu?: Readonly<Record<string, string | number>>;
}

/** Kết quả tách: phần an toàn (hiện riêng) và phần còn lại (gộp được). */
export interface TachViec {
  /** Mục nhóm `anToan` đang bật — hiện RIÊNG, đỏ, LUÔN MỞ, không ẩn được. */
  anToan: MucViec[];
  /** Mọi mục còn lại đang bật — gộp vào một dải 26 px. */
  gopDuoc: MucViec[];
}

/**
 * Lọc mục đang bật và sắp theo nhóm.
 *
 * ★ `filter` TRƯỚC `sort`: sắp một mảng còn lẫn mục tắt rồi mới lọc cho cùng
 *   kết quả nhưng tốn hơn, và quan trọng hơn là nó mời gọi đếm nhầm trên mảng
 *   chưa lọc (G9).
 */
export function locVaSap(muc: readonly MucViec[]): MucViec[] {
  return muc
    .filter((m) => m.hien)
    .slice()
    .sort((a, b) => THU_TU_NHOM[a.nhom] - THU_TU_NHOM[b.nhom]);
}

/**
 * ★★★ LUẬT CỨNG 1 — tách phần an toàn ra khỏi phần gộp được.
 *
 * Trả về hai mảng RỜI NHAU: không mục nào nằm ở cả hai. Test cưỡng chế điều đó
 * bằng phép đếm tổng (`anToan.length + gopDuoc.length === locVaSap(...).length`)
 * — đúng khuôn "đối chiếu TỔNG" của BG-127, thay cho việc tin vào một bộ lọc.
 */
export function tachAnToan(muc: readonly MucViec[]): TachViec {
  const bat = locVaSap(muc);
  return {
    anToan: bat.filter((m) => m.nhom === "anToan"),
    gopDuoc: bat.filter((m) => m.nhom !== "anToan"),
  };
}

/**
 * ★★★ G9 — ĐẾM SỐ VIỆC, đơn vị là **mục đang bật**, không phải loại mục.
 *
 * ⚠ Đếm trên `gopDuoc` hay trên toàn bộ? Trên **toàn bộ đang bật**: câu "N việc
 *   cần biết" nói về tình trạng của trang, và một E-STOP chắc chắn là một việc
 *   cần biết. Dải hợp nhất hiện nhãn đếm này còn dải an toàn hiện riêng — hai
 *   bề mặt, MỘT con số, nên chúng không thể lệch nhau.
 */
export function demViec(muc: readonly MucViec[]): number {
  return locVaSap(muc).length;
}

/**
 * Nhóm nặng nhất trong tập đang bật — quyết định màu của dải khi THU.
 *
 * ★ Trả `null` khi không có việc nào: dải khi ấy KHÔNG hiện chút nào (0 px),
 *   và đó là ca thường gặp nhất. Trả về một nhóm "mặc định" thay cho `null` sẽ
 *   làm dải luôn chiếm 26 px kể cả khi im lặng — đúng thứ đợt này đi chữa.
 */
export function nhomNangNhat(muc: readonly MucViec[]): NhomViec | null {
  const bat = locVaSap(muc);
  return bat.length === 0 ? null : bat[0].nhom;
}

/**
 * Mục nào ẩn được bằng `[ẩn]` của phiên này.
 *
 * ★★★ LUẬT CỨNG (§13b 14.4 luật 3): **không ẩn được nhóm AN TOÀN**. `[ẩn]` chỉ
 *   ẩn trong phiên, KHÔNG ghi lên server — nên nó không thể trở thành một lời
 *   nói dối lâu dài; nhưng ngay cả trong một phiên, giấu E-STOP là điều màn này
 *   không được phép làm.
 */
export function anDuoc(m: MucViec): boolean {
  return m.nhom !== "anToan";
}

/**
 * Áp tập khoá đã ẩn của phiên lên danh sách mục.
 *
 * ⚠ Ẩn = đặt `hien=false`, KHÔNG phải xoá khỏi mảng: giữ mục lại thì phép đếm
 *   tổng ở test vẫn kiểm được, và một bản vá sau này muốn hiện "đang ẩn 2 mục"
 *   không phải dựng lại nguồn.
 */
export function apDaAn(muc: readonly MucViec[], daAn: ReadonlySet<string>): MucViec[] {
  return muc.map((m) => (anDuoc(m) && daAn.has(m.testId) ? { ...m, hien: false } : m));
}
