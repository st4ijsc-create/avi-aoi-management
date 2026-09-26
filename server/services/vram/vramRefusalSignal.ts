/**
 * ★★★ Pha 2B Task 5 — VỊ TỪ *"lỗi này có phải một LỜI TỪ CHỐI không"*. **Module LÁ: không import gì.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO MỘT FILE RIÊNG CHO MỘT HÀM BỐN DÒNG — ĐỌC TRƯỚC KHI "DỌN DẸP" NÓ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Có **mười một** điểm gọi `beginVramAllocation()` trong mã sản xuất, và **mười một** cái `catch`
 * quanh chúng, mỗi cái mang cùng một chính sách từ Pha 1: *"telemetry chết thì hệ vẫn phải nạp
 * được model"* ⇒ nuốt lỗi, trả giấy phép rỗng, **cấp phát chạy tiếp**.
 *
 * Từ Task 5, `beginVramAllocation()` **NÉM `VramRefusedError`**. Nếu dù chỉ MỘT trong mười một
 * `catch` đó nuốt nó, thì tại điểm gọi ấy **cưỡng chế không tồn tại**: broker từ chối → catch nuốt
 * → model vẫn nạp → OOM. Một vị từ chép mười một lần là mười một cơ hội để một bản chép trôi khỏi
 * những bản còn lại — đúng lớp lỗi đã đẻ **ba Critical liên tiếp** ở pha trước và **tái diễn hai
 * lần** ở pha này.
 *
 * ⚠⚠ VÌ SAO SO **TÊN** CHỨ KHÔNG `instanceof`, và đây là một quyết định chứ không phải lười:
 *   1. Nhiều `catch` trong số đó chạy ở ca *"chính lượt `await import()` vừa hỏng"* — lúc đó
 *      **không có lớp nào để `instanceof` cả**, và một `await import("./vramRefusal")` thứ hai
 *      trong `catch` sẽ hỏng đúng cách cái đầu đã hỏng.
 *   2. Mười một điểm gọi nhập `vramWiring` **động**; dưới `vi.mock`/`vi.resetModules` một module
 *      có thể tồn tại hai thể hiện, và `instanceof` giữa hai thể hiện là `false` **im lặng** —
 *      tức cưỡng chế tắt trong test mà không ca nào đỏ.
 *   ⇒ `name` là thứ đi qua được cả hai ranh giới đó. Giá phải trả: một lớp lỗi khác đặt
 *      `name = "VramRefusedError"` sẽ được thả đi qua — chấp nhận được, vì hậu quả là "một lỗi
 *      hiếm được ném lại thay vì bị nuốt", không phải "một lượt cấp phát lọt cổng".
 *
 * ⚠ Hằng số tên nằm ở ĐÂY và `VramRefusedError` **đọc chính nó** (`vramRefusal.ts`), nên hai bên
 * không thể trôi khỏi nhau. Có ca test khoá đúng điều đó — nếu không, đây lại là một sợi DÂY.
 */

/** Tên `Error.name` của `VramRefusedError`. Đổi ở đây thì lớp lỗi đổi theo, không ngược lại. */
export const VRAM_REFUSED_ERROR_NAME = "VramRefusedError";

/**
 * `true` ⇔ lỗi này là một **lời từ chối của cổng sổ**, KHÔNG phải một lỗi telemetry.
 *
 * Điểm gọi dùng đúng một khuôn, và khuôn đó phải là dòng ĐẦU TIÊN của `catch`:
 *
 *     } catch (err) {
 *       if (isVramRefusal(err)) throw err;   // từ chối ≠ telemetry hỏng: PHẢI đi tiếp
 *       …chính sách nuốt-lỗi cũ giữ nguyên…
 *     }
 */
export function isVramRefusal(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { readonly name?: unknown }).name === VRAM_REFUSED_ERROR_NAME
  );
}
