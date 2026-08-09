/**
 * ★★★ Pha 7 / review TOÀN NHÁNH **I-4** — **CHỦ DUY NHẤT của vị từ *"lượt gọi này có bị cổng
 * BUỘC-ĐỔI-MẬT-KHẨU chặn không"*.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo lưới của module này vào
 *  lượng từ *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO MODULE NÀY TỒN TẠI — MỘT LỜI HỨA AN NINH KHÔNG CÓ THẬT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Task 8 của Pha 7 **xoay bí mật thật trên 8/8 tài khoản** (bí mật cũ đã lộ) và đặt cờ *"phải đổi
 * mật khẩu"*. Lượt review TOÀN NHÁNH đo được (finding **I-4**):
 *   · **0** người đọc cờ ấy trong toàn `client/**`;
 *   · **0** phép cưỡng chế phía máy chủ.
 * ⇒ Cờ được **GHI**, không ai **ĐỌC**. Hệ mang một lời hứa an ninh mà không cơ chế nào giữ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO VỊ TỪ NẰM Ở `shared/`, KHÔNG PHẢI HAI BẢN Ở HAI PHÍA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cổng này có **hai mặt** (máy chủ từ chối thủ tục · client khoá điều hướng) và chúng phải nói
 * **cùng một câu**. Nếu mỗi phía giữ một bản sao của tập miễn trừ thì một ngày nào đó máy chủ tha
 * `admin` còn client vẫn nhốt `admin` trong màn đổi mật khẩu (hoặc ngược lại — client thả, máy chủ
 * chặn ⇒ mọi trang trắng mà không câu lỗi nào giải thích). Lớp lỗi *"nhiều chủ cho một bất biến"*
 * đã đẻ **ba** Critical trong chuỗi pha này. ⇒ **Một** chủ, hai người gọi.
 */

/**
 * 🔴🔴 **LỖ CỐ Ý — QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN NGÀY 2026-08-09, KHÔNG PHẢI SƠ SUẤT.**
 *
 * Tài khoản mang vai trong tập này **KHÔNG** bị cổng buộc-đổi-mật-khẩu chặn, kể cả khi cờ của nó
 * đang bật.
 *
 * ⚠⚠⚠ RỦI RO ĐÃ ĐƯỢC NÊU RÕ VỚI CHỦ DỰ ÁN TRƯỚC KHI CHỌN, nguyên văn: `admin` là vai **nhiều
 * quyền nhất**, và bí mật của họ nằm trong **đúng 8 cái đã lộ** ở Task 8 ⇒ miễn trừ này tha đúng
 * **nhóm nguy hiểm nhất**. Khuyến nghị kỹ thuật là **KHÔNG** miễn trừ. Chủ dự án đã cân nhắc và
 * **vẫn chọn** như vậy. Đó là quyết định của họ.
 *
 * ⚠ Vì là một lỗ **CỐ Ý**, nó phải **NHÌN THẤY ĐƯỢC**: một hằng **CÓ TÊN** (không phải một `if
 *   role === "admin"` nằm lẫn trong thân middleware), và một **ca lưới ghim chính sự miễn trừ**
 *   (`server/_core/buocDoiMatKhau.test.ts` §4 · `client/src/lib/congDoiMatKhau.unit.test.ts` §2).
 *   Người sau đọc mã sẽ **không** tưởng `admin` cũng được bảo vệ; và ai muốn bỏ miễn trừ thì phải
 *   sửa **hằng này** + **ca lưới ấy** — tức bỏ **có chủ đích**, hiện thành diff trong review.
 */
export const VAI_MIEN_TRU_BUOC_DOI_MAT_KHAU: readonly string[] = ["admin"];

/** Vai này có nằm trong tập miễn trừ **cố ý** ở trên không. */
export function duocMienTruBuocDoiMatKhau(vai: string | null | undefined): boolean {
  return vai != null && VAI_MIEN_TRU_BUOC_DOI_MAT_KHAU.includes(vai);
}

/**
 * ★★★ **VỊ TỪ DUY NHẤT** của cổng buộc-đổi-mật-khẩu: *"người này, lúc này, có bị chặn không"*.
 *
 *   BỊ_CHẶN  <=>  phaiDoiMatKhau ∧ ¬duocMienTru(vai)
 *
 * ⚠ `phaiDoiMatKhau` **phải** là kết quả của `suyRaPhaiDoiMatKhau()` trên hai mốc đọc **MỚI TỪ
 *   DB** (`server/db/auth.ts::phaiDoiMatKhau`) — **KHÔNG** suy từ `ctx.user`, vì hai mốc ở đó đã
 *   bị `redactServerOnlyUserFields` làm rỗng (Pha 7 Task 7) nên sẽ cho `false` **luôn luôn**: một
 *   lời nói dối im lặng **theo chiều MỞ**. Phía client, giá trị đúng là ô suy ra `mustChangePassword`
 *   của `auth.me`, cũng do chính lượt đọc DB ấy sinh ra.
 */
export function biChanBoiCongDoiMatKhau(
  vai: string | null | undefined,
  phaiDoiMatKhau: boolean,
): boolean {
  if (!phaiDoiMatKhau) return false;
  return !duocMienTruBuocDoiMatKhau(vai);
}
