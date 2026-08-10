/**
 * ★★★ Review TOÀN NHÁNH Pha 8 · **C-2 §3 + C-1** — **BỘ ĐẾM SỔ PHIÊN, CÓ BỀ MẶT QUAN SÁT ĐƯỢC.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI — "KHÔNG IM LẶNG TRONG LƯỚI" ≠ "KHÔNG IM LẶNG TRONG SẢN XUẤT"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `authService.ts` khai rằng lượt ghi sổ phiên hỏng *"không bao giờ im lặng"* vì có `demLoiGhiSoPhien()`
 * + một dòng `console.error`. Reviewer đo lại: bộ đếm ấy **chỉ đọc được TỪ LƯỚI**, tức nó chứng
 * minh "không im lặng" **trong test**, còn trong sản xuất thì vẫn im lặng — không ai đọc `console`
 * của một tiến trình `node dist/index.js` chạy nền. Và chính vì im lặng, C-2 sống được: một header
 * `User-Agent` dài đúc ra một phiên **không có hàng sổ** mà **không cơ chế nào kêu**.
 *
 * ⇒ Hai bộ đếm được gom về **một chủ không phụ thuộc gì** (file này không import `sdk`/`db`/
 *   `express`, nên nó nằm ngoài mọi vòng nhập), và được **kết xuất Prometheus** ở
 *   `GET /api/observability/metrics` — bề mặt đã có sẵn phép xác thực (loopback **hoặc** phiên
 *   admin/supervisor), nên không mở thêm cửa nào.
 *
 * ⚠ VÌ SAO ĐẾM Ở ĐÂY, KHÔNG ĐẾM Ở `authService`/`sdk`: `authService` nhập `sdk`, nên `sdk` **không
 *   được** nhập ngược `authService`. Một chủ trung lập là cách duy nhất để cả hai cùng nhích một bộ
 *   đếm mà không dựng vòng nhập.
 *
 * ⚠ Bộ đếm là **theo TIẾN TRÌNH**, không bền qua lượt khởi động lại. Đó đúng ngữ nghĩa Prometheus
 *   counter (scraper tự xử lý lượt reset), và được nói ra ở đây để không ai đọc số này thành
 *   "tổng từ trước tới nay".
 */

let soLoiGhiSoPhien = 0;
let soChanPhienDaThuHoi = 0;

/** Số lượt **ghi sổ phiên hỏng** kể từ khi tiến trình chạy (hoặc từ lần đặt lại gần nhất). */
export function demLoiGhiSoPhien(): number {
  return soLoiGhiSoPhien;
}

/** Đặt lại bộ đếm — dành cho lưới, để mỗi ca đo trên một mốc sạch. */
export function datLaiDemLoiGhiSoPhien(): void {
  soLoiGhiSoPhien = 0;
}

/** Nhích bộ đếm ghi-sổ-hỏng. Người gọi DUY NHẤT: `authService.ghiSoPhien`. */
export function nhichLoiGhiSoPhien(): void {
  soLoiGhiSoPhien++;
}

/** Số lượt **một phiên ĐÃ THU HỒI bị chặn** kể từ khi tiến trình chạy. */
export function demChanPhienDaThuHoi(): number {
  return soChanPhienDaThuHoi;
}

/** Đặt lại bộ đếm chặn-phiên-đã-thu-hồi — dành cho lưới. */
export function datLaiDemChanPhienDaThuHoi(): void {
  soChanPhienDaThuHoi = 0;
}

/** Nhích bộ đếm chặn-phiên. Người gọi DUY NHẤT: `sdk.chanNeuPhienDaThuHoi`. */
export function nhichChanPhienDaThuHoi(): void {
  soChanPhienDaThuHoi++;
}

/**
 * Kết xuất Prometheus của hai bộ đếm trên.
 *
 * ⚠ Không nhãn (label): hai con số này là **tín hiệu an ninh của cả tiến trình**, không phải một
 *   phép đo theo người dùng. Gắn `userId` vào đây là mở một kênh liệt kê tài khoản trên một bề mặt
 *   mà Prometheus loopback đọc được **không cần đăng nhập**.
 */
export function renderSoPhienPrometheus(): string {
  return [
    "# HELP soPhien_ghiSoLoi_total Số lượt ghi hàng user_sessions HỎNG (phiên đó vô hình với session.list và ngoài tầm session.revoke).",
    "# TYPE soPhien_ghiSoLoi_total counter",
    `soPhien_ghiSoLoi_total ${soLoiGhiSoPhien}`,
    "# HELP soPhien_chanDaThuHoi_total Số lượt một phiên ĐÃ THU HỒI bị chặn ở biên xác thực (tRPC/socket/REST/Bearer).",
    "# TYPE soPhien_chanDaThuHoi_total counter",
    `soPhien_chanDaThuHoi_total ${soChanPhienDaThuHoi}`,
    "",
  ].join("\n");
}
