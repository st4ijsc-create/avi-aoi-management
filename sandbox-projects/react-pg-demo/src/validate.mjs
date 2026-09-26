/**
 * Kiểm hợp lệ dữ liệu "việc cần làm" (todo) — logic THUẦN, không chạm CSDL nên test được
 * độc lập bằng `node --test`.
 *
 * ⚠ CÓ LỖI CỐ Ý: `validateTodo` hiện KHÔNG cắt khoảng trắng đầu/cuối và KHÔNG chặn tiêu đề
 * chỉ-toàn-khoảng-trắng, nên một tiêu đề "   " (ba dấu cách) bị coi là hợp lệ và lọt vào CSDL
 * dưới dạng rỗng. Nó cũng KHÔNG chặn tiêu đề quá dài.
 *
 * NHIỆM VỤ MẪU cho AI local: sửa `validateTodo` để
 *   (1) cắt khoảng trắng đầu/cuối (`trim`) trước khi kiểm,
 *   (2) từ chối tiêu đề rỗng SAU khi cắt (kể cả chuỗi toàn khoảng trắng),
 *   (3) từ chối tiêu đề dài quá `MAX_TITLE` ký tự,
 * rồi chạy `npm test` (tức `node --test test/`) để hai ca đang ĐỎ chuyển sang XANH.
 */

export const MAX_TITLE = 200;

/**
 * @param {{ title?: unknown }} input
 * @returns {{ ok: true, title: string } | { ok: false, error: string }}
 */
export function validateTodo(input) {
  const title = input?.title;
  if (typeof title !== "string") {
    return { ok: false, error: "title phải là chuỗi" };
  }
  // ⚠ LỖI CỐ Ý — chưa trim, chưa chặn toàn-khoảng-trắng, chưa chặn quá dài.
  if (title.length === 0) {
    return { ok: false, error: "title không được rỗng" };
  }
  return { ok: true, title };
}
