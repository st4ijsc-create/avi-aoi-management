/**
 * ★★★ Pha 9 nhóm A · **A6 — CHỦ DUY NHẤT của *"phân giải danh tính cho một tuyến REST"*.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO MODULE NÀY TỒN TẠI — MỘT NHÁNH `if` ĐÃ VIẾT SẴN MÀ **KHÔNG BAO GIỜ CHẠY**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `sdk.authenticateRequest` **NÉM** khi không xác thực được; nó không bao giờ trả `null`. Nhưng sáu
 * tuyến REST viết:
 *
 *     const user = await sdk.authenticateRequest(req);
 *     if (!user) { res.status(401).json(…); return; }   // ← MÃ CHẾT, không đời nào chạy
 *     …
 *   } catch (err) { res.status(500).json({ error: err.message }); }   // ← lượt ném rơi VÀO ĐÂY
 *
 * ⇒ Fail-closed **ĐÚNG CHIỀU** (không ai vào được), nhưng mã trạng thái **SAI**: một yêu cầu thiếu
 *   cookie nhận **500 Internal Server Error** thay vì **401**. Hệ quả thật, không lý thuyết:
 *   client không phân biệt được *"tôi cần đăng nhập lại"* với *"máy chủ hỏng"*, mọi bảng theo dõi
 *   lỗi 5xx bị nhiễm, và thông điệp ngoại lệ nội bộ bị bắn ra ngoài trong `err.message`.
 *
 * **ĐO ĐƯỢC** (gọi THẬT từng tuyến, không cookie — `xacThucBeMatRest.test.ts`): **6** bề mặt trả
 * 500. ⚠ Brief khai **2**; phép đếm thật gấp **ba**. Đừng tin một danh sách viết tay.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO HÀM NÀY **KHÔNG** TỰ GỬI THÂN PHẢN HỒI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hai họ tuyến đang có **hai hợp đồng thân khác nhau** (`{error}` vs `{success:false,error}`), và
 * client của chúng đã đọc theo hai hình dạng ấy. Gộp thân về một chủ là **đổi hợp đồng API** — một
 * quyết định sản phẩm, không phải một lượt trả nợ an ninh. ⇒ Chủ này sở hữu đúng **một** thứ:
 * *"lượt xác thực hỏng ⇒ `null`, KHÔNG ném"*; người gọi giữ nguyên thân của mình và nay nhánh
 * `if (!user)` **có thật sự chạy**.
 *
 * ⚠⚠ BÀI HỌC `xacThucNoiBo` ĐƯỢC ÁP DỤNG: gộp về một chủ là đúng, **nhưng chủ ấy không được ghim
 *    cứng một đường dẫn / một danh sách tuyến**. Hàm này nhận `req` bất kỳ và không biết gì về
 *    đường dẫn nào — nên một tuyến REST **ở một file chưa tồn tại** dùng được nó ngay.
 *
 * ⚠ **KHÔNG nuốt lỗi theo chiều MỞ**: mọi lượt ném (phiên rác · `SESSION_NOT_IN_LEDGER` ·
 *   `MUST_CHANGE_PASSWORD`) đều thành `null` ⇒ người gọi từ chối. Fail-closed giữ nguyên; chỉ **mã
 *   trạng thái** được sửa.
 */
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import { sdk } from "../_core/sdk";

/**
 * Phân giải *"yêu cầu này là ai"* cho một tuyến REST.
 *
 * @returns hàng `users` khi xác thực được; **`null`** khi KHÔNG (mọi nguyên nhân). Người gọi
 *   **phải** trả 401 và dừng — nhánh ấy nay là mã SỐNG.
 */
export async function thuXacThucRest(req: Request | unknown): Promise<User | null> {
  try {
    return await sdk.authenticateRequest(req as Request);
  } catch {
    return null;
  }
}
