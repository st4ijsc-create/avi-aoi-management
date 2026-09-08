/**
 * ════════════════════════════════════════════════════════════════════════════
 * `dinhTuyenTwinCu.ts` — 14 URL CŨ, **KHÔNG URL NÀO ĐƯỢC CHẾT** (§13b 14.2.3)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Đợt 21 gộp `/digital-twin` (vỏ Tabs 7 tab) và `/twin-studio` vào `/twin`.
 * Mười bốn đường vào cũ vì thế trỏ vào chỗ không còn. Chúng nằm trong link đã
 * gửi qua chat, trong bookmark, trong tài liệu — nên **mọi đường phải còn tới
 * được đích đúng**, và §13b đặt thêm một điều kiện: **mỗi đường ≤ 1 chặng**.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ VÌ SAO "≤ 1 CHẶNG" LÀ MỘT LUẬT, KHÔNG PHẢI SỰ CẦU KỲ
 * ────────────────────────────────────────────────────────────────────────────
 * Trước đợt này `/factory-live-map` đi **hai chặng**:
 *     /factory-live-map → /digital-twin?tab=map → (Tabs) bản đồ
 * Mắt xích giữa là `/digital-twin`. Ngày ai đó dọn `/digital-twin` — và Đợt 21
 * chính là ngày ấy — mắt xích mục, và `/factory-live-map` chết **trong im
 * lặng**: không lỗi biên dịch, không lưới đỏ, chỉ một người dùng bấm bookmark
 * và ra trang 404. Nên chuỗi phải được **rút thẳng về đích** trong cùng đợt
 * tạo ra nó, không để lại cho đợt sau.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ HAI ĐIỀU §13b NÓI MÀ ĐỢT NÀY LÀM KHÁC — ghi rõ, không lặng lẽ đổi
 * ────────────────────────────────────────────────────────────────────────────
 * 1. §13b 14.2.3 ghi `?tab=floor` → **`/twin-studio`** và `?tab=layout` →
 *    **`/twin-studio?che-do=botri`**. Nhưng §13c.1 (QD-16, quyết định của chủ
 *    sở hữu, ĐI SAU §13b) gộp `/twin-studio` **vào chính `/twin`**. Nên đích
 *    thật là **`/twin?che-do=botri`**. `/twin-studio` vẫn sống như một redirect
 *    để không đường nào chết.
 * 2. §13b ghi `?tab=cell` → `/twin?thu=moPhong`. ⚠ Đó là **lỗi trong spec**, và
 *    nó đảo ngược ý nghĩa: `thu=` là danh sách panel **ĐANG THU** (vắng mặt =
 *    đang mở — xem `duongDanTwin.ts` `PANEL_THU_DUOC`). `?thu=moPhong` sẽ
 *    **ĐÓNG** ngăn Mô phỏng, tức là đưa người dùng tới đúng nơi họ muốn rồi
 *    đóng thứ họ tới xem. Ngăn Mô phỏng **mặc định đã mở**, nên đích đúng là
 *    `/twin` trơn. Báo lại thay vì chép nguyên spec.
 * 3. §13b ghi `?tab=map` và `/factory-live-map` → **`/twin?lop=uns`**. ⚠ Cũng
 *    là **lỗi trong spec**: `"uns"` KHÔNG nằm trong `LOP_HOP_LE` của
 *    `duongDanTwin.ts` (`["nhan","canhBao","wip","dongChay","tuoi",
 *    "ngungKhaiThac"]` — sáu tên, đóng ở cả hai chiều). `docLop()` **bỏ tên lạ
 *    trong im lặng**, nên `?lop=uns` ghi ra đúng, đọc lại ra rỗng, và không lỗi
 *    nào nổ — đúng lớp G67 "tính năng chết ở tầng ĐẦU TIÊN là KIỂU/DANH SÁCH"
 *    mà chính `duongDanTwin.ts` đã ghi cảnh báo cho `?thu=moPhong`.
 *    ⇒ Đích ở đây là `/twin` trơn. **Không** thêm `"uns"` vào `LOP_HOP_LE`:
 *    tệp ấy nằm dưới `van-hanh/**` mà lô Z đang giữ, và một khoá URL mới cũng
 *    đi ngược G40. Nợ ghi lại: nếu muốn `?lop=uns` thật thì phải thêm tên vào
 *    danh sách ĐÓNG ấy TRƯỚC, ở một đợt có quyền chạm tệp đó.
 *
 * ★ Module THUẦN — không react, không `window`. Bảng ánh xạ test được ở
 *   `environment: "node"`, và test cưỡng chế **cả 14 dòng** cùng luật ≤1 chặng.
 */

/**
 * Đích của mọi đường vào Twin cũ.
 *
 * ★ Khoá là **đường dẫn + query đầy đủ** đúng như người dùng gõ/dán; giá trị là
 *   đích **CUỐI CÙNG**, không phải chặng kế tiếp. Đó là cách bảng này cưỡng chế
 *   luật ≤1 chặng ở tầng dữ liệu: không có giá trị nào trong bảng lại là một
 *   khoá của chính bảng (test kiểm điều đó).
 */
export const DICH_TWIN_CU: Readonly<Record<string, string>> = {
  // ── Vỏ `/digital-twin` và 7 tab của nó ───────────────────────────────────
  "/digital-twin": "/twin",
  "/digital-twin?tab=overview": "/twin",
  "/digital-twin?tab=center": "/twin",
  "/digital-twin?tab=map": "/twin",
  // ★ QD-16: hai tab soạn thảo về VÙNG SỬA của `/twin`, không về `/twin-studio`.
  "/digital-twin?tab=floor": "/twin?che-do=botri",
  "/digital-twin?tab=layout": "/twin?che-do=botri",
  // ★ Xem "HAI ĐIỀU §13b NÓI MÀ ĐỢT NÀY LÀM KHÁC" mục 2: KHÔNG `?thu=moPhong`.
  "/digital-twin?tab=cell": "/twin",
  // ★ §13b: RF là mô phỏng thuần (đo được **0 lời gọi tRPC** trong 792 dòng) —
  //   nó không trả lời "nhà máy đang thế nào", nên đứng RIÊNG ngoài Twin.
  "/digital-twin?tab=rf": "/rf-test-cell",

  // ── Sáu tuyến cũ trước đây đi VÒNG qua `/digital-twin` (hai chặng) ───────
  "/factory-live-map": "/twin",
  "/factory-floor-editor": "/twin?che-do=botri",
  "/cell-twin": "/twin",
  "/digital-twin-center": "/twin",
  "/layout": "/twin?che-do=botri",

  // ── `/twin-studio` — nay là một vùng của `/twin` (QD-16) ─────────────────
  "/twin-studio": "/twin?che-do=botri",
};

/**
 * Tra đích cho một đường vào cũ.
 *
 * ⚠ Trả `null` cho đường không có trong bảng — KHÔNG đoán. Một redirect đoán mò
 *   sẽ nuốt cả những URL chưa từng thuộc Twin, và người dùng mất trang mà không
 *   biết vì sao.
 */
export function traDichCu(duongDan: string): string | null {
  return DICH_TWIN_CU[duongDan] ?? null;
}

/**
 * ★★★ Cưỡng chế luật ≤1 chặng ở tầng DỮ LIỆU.
 *
 * Trả danh sách khoá mà **đích của nó lại là một khoá khác** — tức là một chuỗi
 * hai chặng. Bảng đúng phải cho **mảng rỗng**.
 *
 * ★ Đây là phép đo, không phải lời khai: nó ĐỌC bảng thật thay vì tin vào chú
 *   thích ở trên. Ai thêm một dòng `"/x": "/digital-twin?tab=map"` sẽ làm lưới
 *   ĐỎ ngay, chứ không phải để người dùng phát hiện bằng một cú bấm bookmark.
 */
export function timChuoiNhieuChang(): string[] {
  const khoa = new Set(Object.keys(DICH_TWIN_CU));
  return Object.entries(DICH_TWIN_CU)
    .filter(([, dich]) => khoa.has(dich))
    .map(([k]) => k);
}
