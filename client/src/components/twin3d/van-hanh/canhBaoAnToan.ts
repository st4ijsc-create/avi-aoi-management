/**
 * canhBaoAnToan.ts — §11 #26: **E-STOP NỔI LÊN TWIN**. An toàn phải thấy được
 * từ tổng quan, không phải mở từng buồng lái mới biết.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BA TRẠNG THÁI, VÀ Ô THỨ BA LÀ Ô QUAN TRỌNG NHẤT (G15/NT-3)
 * ════════════════════════════════════════════════════════════════════════════
 * E-STOP KHÔNG phải một boolean. Nó có ba câu trả lời khác hẳn nhau:
 *
 *   `nhan`     — E-STOP ĐANG được nhấn. Đỏ, chữ, icon. Ưu tiên tuyệt đối.
 *   `nha`      — đã kiểm, KHÔNG bị nhấn. An toàn.
 *   `khong_ro` — **CHƯA ĐỌC ĐƯỢC** trạng thái an toàn của thiết bị này.
 *
 * ⚠⚠ `khong_ro` **KHÔNG được vẽ như `nha`**. Đây là điểm sinh tử của cả module:
 * một robot mất kết nối có `estop = null`, và nếu ta hiển thị nó giống hệt một
 * robot đã kiểm-và-an-toàn thì màn hình tổng quan đang nói *"mọi thứ ổn"* về
 * một thiết bị mà ta **không biết gì cả**. `RobotCockpit.tsx:515` đã làm đúng
 * điều này ở cấp buồng lái (`estop == null ? "—"`); module này giữ đúng luật ấy
 * khi con số nổi lên Twin.
 *
 * ★ Module THUẦN (RB-8.1) — không react, không three, không `Date.now()` ẩn.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ NỢ CÓ KHAI — VÌ SAO #26 CHƯA THỂ ĐÓNG Ở ĐỢT 6
 * ════════════════════════════════════════════════════════════════════════════
 * Module này tính ĐÚNG trạng thái an toàn, nhưng Twin **chưa có chỗ để gắn nó
 * lên robot**. Đo được 2026-09-07:
 *
 *   • `twin_dat_cho.loaiThucThe` là enum `workshop|line|station|machine|
 *     workstation` (`drizzle/schema/twin3d.ts:149`) — **KHÔNG có `robot`**.
 *   • `duongDanTwin.unit.test.ts:57` ghim `docPhamVi("robot:1") === null`:
 *     robot KHÔNG địa chỉ hoá được trong cảnh.
 *   • DB dev có 3 robot, phân bố `status`: `online` 2 · `idle` 1 —
 *     **KHÔNG robot nào đang `estop`**.
 *
 * Điều thứ ba đáng nói riêng: kể cả khi đã vẽ được badge, một phép nghiệm thu
 * "không thấy badge nào" trên DB này **không chứng minh gì** — nó trông y hệt
 * nhau dù mã chạy đúng hay hỏng hoàn toàn (đúng lớp lỗi G5 "đo trên tập rỗng").
 * Nên hàm `tomTatAnToan` dưới đây được test bằng ca dương DỰNG TAY, và việc
 * nghiệm thu trên cảnh thật phải đợi (a) robot vào được `twin_dat_cho`, và
 * (b) một robot `estop` có thật hoặc một đường tiêm trạng thái an toàn.
 *
 * ⇒ #26 ở Đợt 6: **logic xong + đo được**, **chưa nổi lên cảnh 3D**. Không đánh
 *   dấu "đã di trú VÀ ĐÃ ĐO" cho tới khi hai điều kiện trên xong (luật cổng ra
 *   §11 — và đó chính là lý do luật ấy tồn tại).
 */

/** Ba trạng thái an toàn của một thiết bị. */
export type TrangThaiAnToan = "nhan" | "nha" | "khong_ro";

/** Một thiết bị có mạch an toàn (robot, và về sau là máy có E-STOP). */
export interface ThietBiAnToan {
  id: number;
  ma: string;
  /**
   * `robots.status` — `"estop"` là một giá trị CỦA CỘT NÀY (xem
   * `fleetRouter.ts:325`), không phải một cột riêng.
   */
  status?: string | null;
  /**
   * Cờ E-STOP từ telemetry trực tiếp. `null`/`undefined` = **chưa đọc được**,
   * KHÔNG phải "không bị nhấn".
   */
  estop?: boolean | null;
}

/**
 * ★★★ Quy trạng thái an toàn từ HAI nguồn. Thứ tự KHÔNG được đổi.
 *
 * 1. `estop === true` hoặc `status === "estop"` ⇒ `nhan`. **Bất kỳ nguồn nào
 *    nói "đang nhấn" đều thắng** — với tín hiệu an toàn, dương-tính-giả tốn một
 *    lần đi kiểm tra, âm-tính-giả tốn một người.
 * 2. `estop === false` ⇒ `nha` (đã đọc được, và không bị nhấn).
 * 3. còn lại ⇒ `khong_ro`.
 *
 * ⚠ Ô 3 gồm cả ca `estop == null` **mà `status === "online"`**: máy đang online
 *   không có nghĩa là ta đọc được mạch an toàn của nó. Suy `nha` từ `online` là
 *   đúng lỗi "tag Quality=Good trong khi timestamp ngừng tiến".
 */
export function trangThaiAnToan(tb: ThietBiAnToan): TrangThaiAnToan {
  if (tb.estop === true || tb.status === "estop") return "nhan";
  if (tb.estop === false) return "nha";
  return "khong_ro";
}

/** Tóm tắt cho dải cảnh báo/tổng quan Twin. */
export interface TomTatAnToan {
  /** Thiết bị ĐANG nhấn E-STOP — luôn hiện, không bao giờ bị gộp/ẩn. */
  dangNhan: ThietBiAnToan[];
  /** Số thiết bị KHÔNG đọc được trạng thái an toàn (hiện riêng, không im lặng). */
  soKhongRo: number;
  /** Số thiết bị đã kiểm và an toàn. */
  soNha: number;
  /** `true` khi có ít nhất một E-STOP đang nhấn ⇒ badge đỏ nổi lên tổng quan. */
  coCanhBao: boolean;
}

/**
 * ★ `dangNhan` trả CẢ DANH SÁCH chứ không chỉ một số đếm: người trực ca cần biết
 *   *robot NÀO*, và một con số "2" bắt họ đi mở từng buồng lái — đúng thứ mà
 *   "nổi lên Twin" sinh ra để tránh.
 *
 * ★ `soKhongRo` tách khỏi `soNha` vì hai câu đó dẫn tới hai hành động khác nhau:
 *   `nha` = không phải làm gì; `khong_ro` = đi xem vì sao mất tín hiệu.
 */
export function tomTatAnToan(ds: readonly ThietBiAnToan[]): TomTatAnToan {
  const dangNhan: ThietBiAnToan[] = [];
  let soKhongRo = 0;
  let soNha = 0;
  for (const tb of ds) {
    const tt = trangThaiAnToan(tb);
    if (tt === "nhan") dangNhan.push(tb);
    else if (tt === "khong_ro") soKhongRo += 1;
    else soNha += 1;
  }
  return { dangNhan, soKhongRo, soNha, coCanhBao: dangNhan.length > 0 };
}
