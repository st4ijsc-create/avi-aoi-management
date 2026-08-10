/**
 * ★★★★ Review TOÀN NHÁNH Pha 8 · **C-2** — **CẮT THEO TRẦN SUY RA TỪ SCHEMA, KHÔNG THEO DANH SÁCH.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO — MỘT HEADER `User-Agent` DÀI ĐÚC RA MỘT PHIÊN **KHÔNG THU HỒI ĐƯỢC**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `user_sessions.deviceName` là `varchar(255)` và được nạp **thẳng** từ `req.headers["user-agent"]`
 * — không phải dữ liệu người dùng, mà là **dữ liệu KẺ TẤN CÔNG**, đặt tuỳ ý trong một header.
 * Đo sống (`engineer1` #51, UA **3.770** ký tự): đăng nhập ⇒ **200**, `user_sessions` **0 hàng
 * mới**, `auth.logout` ⇒ 200 *"thành công"*, rồi `auth.me` **vẫn trả đủ hồ sơ**. Ba cơ chế đều
 * đúng phần của mình: `ghiSoPhien` không ném (cố ý), `thuHoiPhienTheoToken` lật **0 hàng**, và
 * `chanNeuPhienDaThuHoi` gặp *"không có hàng ⇒ cho qua"*.
 * ⇒ Kẻ tấn công **tự chọn** cho phiên của mình trở nên **vô hình** với `session.list` và **ngoài
 *   tầm** `session.revoke`/`revokeAll`/`auth.logout`, sống tới `exp` (đo được: **2027**).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO **SUY TỪ SCHEMA**, KHÔNG PHẢI `slice(0, 255)` VIẾT TAY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mig `0317` đã viết đúng lý lẽ rồi: *"một con số mới chỉ dời cùng lớp lỗi sang chỗ khác — nó vẫn
 * là một TRẦN ĐOÁN"*. Lượt ấy đóng **một** cột (`sessionToken` → `text`) và **không ai hỏi cột kế
 * bên có trần không** — trong khi câu `INSERT` có **BẢY** cột chuỗi (`deviceName` 255 · `deviceType`
 * 50 · `browser` 100 · `os` 100 · `ipAddress` 45 · `location` 255). Một danh sách viết tay ở đây là
 * danh sách thứ N+1, và nó sẽ lệch với schema đúng vào ngày ai đó thêm cột thứ tám.
 * ⇒ Trần **đọc từ chính đối tượng drizzle** (`getTableColumns` → `PgVarchar.length`). Cột đổi trần,
 *   cột mới sinh ra, cột đổi sang `text` — phép cắt tự đi theo, không ai phải nhớ gì.
 *
 * ⚠⚠⚠ **CỘT KHÔNG PHẢI `varchar` KHÔNG BAO GIỜ BỊ CẮT.** `sessionToken` là `text` (mig 0317) và nó
 *    là **KHOÁ PHIÊN**: cắt nó đi là đúc ra một hàng sổ **không bao giờ khớp** với cookie ⇒ tái tạo
 *    lại chính lỗ C-2 theo một đường khác, im lặng hơn. Lưới ghim chuyện này ở một ô riêng.
 *
 * ⚠ `varchar(n)` của PostgreSQL đếm **KÝ TỰ**, còn `String.prototype.slice` đếm **đơn vị UTF-16**.
 *   Với ký tự ngoài BMP (emoji) một cặp thay thế là 2 đơn vị UTF-16 nhưng **1** ký tự Postgres, nên
 *   phép cắt luôn cho ra **≤ n** ký tự — an toàn theo chiều bảo thủ. Đuôi thay-thế-lẻ (nếu lượt cắt
 *   rơi vào giữa một cặp) được bỏ đi để không đẩy một `U+FFFD` xuống DB.
 */
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/** `varchar` — tên `columnType` mà drizzle gắn cho cột `varchar(n)` của PostgreSQL. */
const KIEU_VARCHAR = "PgVarchar";

/**
 * Trần **khai trong schema** của mọi cột `varchar(n)` của một bảng: `{ tênCột: n }`.
 * Cột `text`/số/thời gian **không** có mặt (không có trần để đoán).
 */
export function tranVarcharCua(bang: PgTable): Record<string, number> {
  const ra: Record<string, number> = {};
  for (const [ten, cot] of Object.entries(getTableColumns(bang))) {
    const c = cot as unknown as { columnType?: string; length?: unknown };
    if (c.columnType !== KIEU_VARCHAR) continue;
    if (typeof c.length !== "number" || !Number.isFinite(c.length) || c.length <= 0) continue;
    ra[ten] = c.length;
  }
  return ra;
}

/** Cắt một chuỗi về `n` ký tự, không để lại nửa cặp thay thế ở đuôi. */
export function catChuoi(gt: string, n: number): string {
  if (gt.length <= n) return gt;
  const cat = gt.slice(0, n);
  const cuoi = cat.charCodeAt(cat.length - 1);
  // 0xD800–0xDBFF = nửa CAO của một cặp thay thế ⇒ nửa thấp đã bị cắt mất.
  return cuoi >= 0xd800 && cuoi <= 0xdbff ? cat.slice(0, -1) : cat;
}

/**
 * Trả về một bản sao của `gt` trong đó **mọi ô chuỗi ứng với một cột `varchar(n)`** đã được cắt về
 * đúng `n`. Ô không phải chuỗi, và ô ứng với cột không có trần, đi qua **nguyên vẹn**.
 *
 * ⚠ Không ném, không log: đây là một phép chuẩn hoá ở biên ghi, không phải một cổng. Bên gọi (và
 *   `ghiSoPhien`) vẫn giữ nguyên đường báo lỗi của mình cho mọi nguyên nhân KHÁC.
 */
export function catTheoTranCot<T extends Record<string, unknown>>(bang: PgTable, gt: T): T {
  const tran = tranVarcharCua(bang);
  let doi = false;
  const ra: Record<string, unknown> = { ...gt };
  for (const [ten, n] of Object.entries(tran)) {
    const v = ra[ten];
    if (typeof v !== "string" || v.length <= n) continue;
    ra[ten] = catChuoi(v, n);
    doi = true;
  }
  return doi ? (ra as T) : gt;
}
