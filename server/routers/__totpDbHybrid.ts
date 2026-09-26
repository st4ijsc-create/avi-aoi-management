/**
 * ★★★ Pha 7 Task 5 (A) — **ĐỊNH TUYẾN `totp_consumed` XUỐNG DB THẬT, PHẦN CÒN LẠI GIỮ `FakeDb`.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KHÔNG DẠY `FakeDb` LÀM BẢNG NÀY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sổ mã OTP đã tiêu là **trạng thái XUYÊN TIẾN TRÌNH** — đó là toàn bộ lý do Pha 7 dời nó xuống DB.
 * Một bảng giả **trong bộ nhớ** chính là thứ vừa bị bác bỏ: nếu sổ chạy trên `FakeDb`, mọi ca sẽ
 * xanh **kể cả khi** trạng thái không sống qua tiến trình ⇒ lưới đo đúng cái nó **không được phép
 * giả định**. ⇒ Chỉ những lượt chạm **`totp_consumed`** đi xuống DB test THẬT; `users`,
 * `permissions`… vẫn đi `FakeDb` như cũ (chúng không phải đối tượng của Task này).
 *
 * ⚠ **ĐỊNH TUYẾN THEO TÊN BẢNG, KHÔNG THEO TÊN PHƯƠNG THỨC.** `db.delete(users)` và
 *   `db.delete(totpConsumed)` là **cùng một phương thức**, hai đích khác nhau — nên vị từ phải hỏi
 *   *"bảng nào"*, không hỏi *"gọi hàm gì"*.
 *
 * ⚠ MỘT bản cài đặt duy nhất, dùng chung cho **ba** file test đang mock `../db/connection`. Ba bản
 *   sao của cùng một phép định tuyến là ba bản sẽ trôi khỏi nhau (ràng buộc 12).
 */

/** Những bảng **BẮT BUỘC** đi xuống Postgres thật. */
const BANG_THAT = new Set(["totp_consumed"]);

/** Tên bảng mà drizzle gắn vào đối tượng bảng. `""` ⇒ không phải một bảng drizzle. */
const tenBang = (x: unknown): string =>
  ((x as Record<symbol, unknown> | null)?.[Symbol.for("drizzle:Name")] as string) ?? "";

/** Lấy một ô, **giữ đúng `this`** — nếu không, mọi phương thức của `FakeDb` mất ngữ cảnh. */
function lay(o: any, p: string | symbol): any {
  const v = o?.[p];
  return typeof v === "function" ? v.bind(o) : v;
}

/**
 * Trộn một `FakeDb` với một kết nối THẬT.
 * @param gia  `FakeDb` (hoặc bất kỳ thứ gì các ca đang dùng).
 * @param that kết nối drizzle thật, hoặc `null` ⇒ **trả nguyên `gia`** (không có DB test thì các ca
 *             về sổ sẽ đỏ với một câu rõ ràng, thay vì âm thầm chạy trên một bảng giả).
 */
export function soHonHop(gia: any, that: any): any {
  if (!that) return gia;
  return new Proxy(gia, {
    get(t, p) {
      if (p === "insert" || p === "delete" || p === "update") {
        return (bang: any) => (BANG_THAT.has(tenBang(bang)) ? lay(that, p)(bang) : lay(t, p)(bang));
      }
      // ⚠ `select()` nhận PROJECTION; bảng chỉ tới ở `.from()` ⇒ phải bọc thêm một tầng.
      if (p === "select") {
        return (...a: any[]) => {
          const bGia = lay(t, "select")(...a);
          const bThat = lay(that, "select")(...a);
          return new Proxy(bGia, {
            get(tb, pb) {
              if (pb === "from") {
                return (bang: any) =>
                  BANG_THAT.has(tenBang(bang)) ? lay(bThat, "from")(bang) : lay(bGia, "from")(bang);
              }
              return lay(tb, pb);
            },
          });
        };
      }
      return lay(t, p);
    },
  });
}
