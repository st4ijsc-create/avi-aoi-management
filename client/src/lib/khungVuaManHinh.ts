/**
 * ★★★ 2026-08-23 — CHIỀU CAO KHUNG LÀM VIỆC: **ĐO, ĐỪNG ĐOÁN**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỚP LỖI ĐANG CANH
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `/ai-coding-workspace` ghim chiều cao khung bằng một hằng **đoán**: `h-[calc(100vh-8.5rem)]`.
 * `8.5rem = 136 px` là *lời khai* về chiều cao phần khung ứng dụng nằm phía trên. Nghiệm thu live
 * 2026-08-23 (Playwright) **bác bỏ lời khai ấy ở CẢ BA cỡ màn**:
 *
 *   1600×1000 → `document.scrollHeight 1138` vs `clientHeight 1000` ⇒ **thừa 138 px**
 *   1280×800  → `938` vs `800`                                     ⇒ **thừa 138 px**
 *    900×700  → `867` vs `700`                                     ⇒ **thừa 167 px** (tiêu đề xuống 2 dòng)
 *
 * Phần thiếu không bí ẩn: `<main>` mang `pb-24` (**96 px**) cộng `p-3`, và hằng 136 px không đếm
 * chúng. Hậu quả **không phải** thẩm mỹ:
 *   • TRANG trở nên CUỘN ĐƯỢC ⇒ cú `scrollIntoView` lúc gắn kéo cả trang xuống **138 px**, giấu
 *     tiêu đề và hai huy hiệu quyền — *hiện tượng 1.6*.
 *   • Ở 900×700 (4 khung xếp dọc) ô nhập rơi xuống `y ≈ 1405` trong một màn cao 700 và **cuộn hết
 *     cỡ vẫn không tới** — *hiện tượng 1.3: không gõ được câu hỏi*.
 *
 * ⚠ Hai lỗi ấy có **một** gốc rễ. Vá riêng từng cái (ví dụ chỉ chỉnh `scrollIntoView`) là để
 *   nguyên cái trần sai — và cái trần sai sẽ đẻ lại triệu chứng ở cỡ màn khác.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO KHÔNG SỬA HẰNG SỐ THÀNH MỘT HẰNG SỐ KHÁC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Vì phần thiếu **KHÔNG phải hằng**: 138 px ở màn rộng, 167 px ở 900 px vì thanh tiêu đề trang
 * xuống hai dòng. Một hằng mới chỉ đúng ở đúng cỡ màn nó được đo, rồi im lặng sai ở cỡ khác — đúng
 * lớp lỗi đang vá. Nên: **đo vị trí thật của khung rồi trừ đi phần đệm thật.**
 *
 * ⚠ Hàm này THUẦN và nhận toạ độ **tuyệt đối trong tài liệu** (`dinhTuyetDoi = rect.top + scrollY`)
 *   chứ không nhận `rect.top`. Lý do là chống TỰ THOẢ: `rect.top` phụ thuộc trang ĐANG cuộn bao
 *   nhiêu, mà chính chiều cao ta trả về lại quyết định trang cuộn được bao nhiêu ⇒ vòng lặp có thể
 *   "hội tụ" về một giá trị sai mà trông vẫn ổn định. `dinhTuyetDoi` không đổi theo cuộn ⇒ phép
 *   tính cho **cùng một đáp số ở mọi vị trí cuộn**, và đó là điều lưới kiểm được.
 */

/** Sàn cứng: dưới ngưỡng này khung không còn dùng được, thà để trang cuộn còn hơn. */
export const SAN_CAO_KHUNG_PX = 320;

export interface ThamSoCaoKhung {
  /** `rect.top + window.scrollY` của khung — vị trí đỉnh trong TÀI LIỆU (không đổi theo cuộn). */
  dinhTuyetDoi: number;
  /** `window.innerHeight`. */
  caoManHinh: number;
  /**
   * Tổng `padding-bottom` của các tổ tiên tới (và gồm) khối cuộn gần nhất — với trang này là
   * `<main class="… pb-24">` ⇒ 96 px. **Không trừ ô này thì trang vẫn cuộn** đúng bằng nó, và cú
   * `scrollIntoView` vẫn kéo trang đi được: bản vá sẽ "gần đúng", tức vẫn hỏng.
   */
  demDuoi: number;
}

/**
 * Chiều cao để ĐÁY khung trùng ĐÁY vùng nhìn khi trang ở đỉnh — tức `scrollHeight == clientHeight`,
 * tức trang **không cuộn được**, tức không cú `scrollIntoView` nào kéo nổi nó.
 *
 * ⚠ `Math.max` với sàn là **có chủ ý và có hậu quả**: ở màn quá thấp, hàm trả về sàn và trang LẠI
 *   cuộn được. Đó là đánh đổi được chọn (một khung 200 px vô dụng còn tệ hơn một trang cuộn được),
 *   và nó phải được nói ra — im lặng ở đây là nói dối về phạm vi bản vá.
 */
export function tinhChieuCaoVua({ dinhTuyetDoi, caoManHinh, demDuoi }: ThamSoCaoKhung): number {
  const con = caoManHinh - dinhTuyetDoi - demDuoi;
  return Math.max(SAN_CAO_KHUNG_PX, Math.round(con));
}

/**
 * Trang có cuộn được nữa không, theo chính con số hàm trên trả về. Đây là **vị từ lưới dùng để
 * bác bỏ**, không phải đồ trang trí: nó cho phép hỏi *"ở cỡ màn X, bản vá có THẬT SỰ triệt tiêu
 * lượt cuộn trang không"* mà không cần trình duyệt.
 */
export function conCuonDuoc(p: ThamSoCaoKhung): boolean {
  return tinhChieuCaoVua(p) + p.dinhTuyetDoi + p.demDuoi > p.caoManHinh;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA KHUNG CẠNH NHAU, HAY MỘT KHUNG MỖI LẦN — QUYẾT ĐỊNH THEO **BỀ RỘNG KHUNG**, KHÔNG THEO MÀN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ Bố cục cũ dùng điểm ngắt `lg:` của Tailwind, tức hỏi **bề rộng CỬA SỔ**. Câu hỏi ấy SAI, và
 * phép đo nói rõ vì sao: ở cửa sổ 1600 px, khung làm việc chỉ rộng **1240 px** — thanh điều hướng
 * trái ăn ~360 px, và nó **gập vào/mở ra được**. Hỏi cửa sổ trong khi thứ quyết định là khung ⇒
 * bố cục "đúng" ở 1600 và **vỡ** ở 1280 (đo được: khung Trình xem còn **82 px**, chữ rơi một từ
 * mỗi dòng) — mà không cổng nào bắt được, vì cổng cũng hỏi cửa sổ.
 *
 * Ở đây hỏi ĐÚNG đại lượng: các khung chỉ được đứng cạnh nhau khi khung cha **thật sự** chứa nổi
 * tổng bề rộng tối thiểu của chúng. Các số dưới đây phải khớp `grid-cols` của trang — lệch là
 * trang lại nói dối, nên chúng ở CÙNG MỘT CHỖ và có lưới canh.
 *
 * ★★★ 2026-08-23 · CỘT "PHIÊN" ĐÃ THÀNH NÚT + POPOVER — lưới từ BỐN khung còn **BA**.
 * Danh sách phiên chuyển vào popover trên thanh đầu khung Hội thoại (mẫu bộ chọn phiên của Claude
 * Code trong VS Code — xem `@/components/ai/BoChonPhien`). Hệ quả ĐO ĐƯỢC (Playwright 2026-08-23,
 * grid thật dựng trong Chromium, không phải tính tay từ spec):
 *   · khung 1240 (cửa sổ 1600): Trình xem 370 px → **560 px** (+190 — đúng bề rộng cột đã bỏ);
 *   · khung  920 (cửa sổ 1280): TRƯỚC là chế độ một-khung (920 < 1110); NAY ba khung vừa KHÍT
 *     (920 = 240+320+360) — Trình xem 320 px, ba khung cùng hiện thay vì một khung mỗi lần.
 * ⚠ Ngưỡng tụt 1110 → 920 là hệ quả số học của việc bỏ cột, nhưng hai con số bề rộng Trình xem ở
 *   trên là PHÉP ĐO trên grid `minmax` thật — thuật toán chia chỗ của grid (maximize tracks trước,
 *   fr sau) không hiển nhiên tới mức được phép suy bằng tay.
 */
/** Cây tệp · Trình xem (SÀN) · Hội thoại (SÀN). Khớp `grid-cols` của trang. */
export const SAN_KHUNG_PX = { tep: 240, xem: 320, chat: 360 } as const;
export const TONG_TOI_THIEU_BA_KHUNG_PX =
  SAN_KHUNG_PX.tep + SAN_KHUNG_PX.xem + SAN_KHUNG_PX.chat;

/**
 * `true` ⇔ phải chuyển sang chế độ **một khung mỗi lần** (có thanh chọn khung).
 *
 * ⚠ `beRongKhung <= 0` ⇒ `false`: nhịp render ĐẦU TIÊN chưa đo được gì, và mặc định lúc ấy phải là
 *   bố cục ba khung — đảo lại thì mọi màn rộng đều nháy qua chế độ hẹp một nhịp.
 */
export function xepMotKhung(beRongKhung: number): boolean {
  return beRongKhung > 0 && beRongKhung < TONG_TOI_THIEU_BA_KHUNG_PX;
}
