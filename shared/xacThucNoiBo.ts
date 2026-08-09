/**
 * ★★★ Pha 7 / vá **NHÀ TÙ I-4** — **CHỦ DUY NHẤT của khái niệm *"tài khoản xác thực NỘI BỘ"*.**
 * (Tự khai `Pha 5` ở lưới đi kèm để `server/services/vram/vramPha5Gate.test.ts` kéo nó vào lượng
 *  từ *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO MODULE NÀY TỒN TẠI — MỘT CỔNG AN NINH ĐÃ THÀNH **NHÀ TÙ THẬT**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cổng buộc-đổi-mật-khẩu (`shared/buocDoiMatKhau.ts`) cho `user.changePassword` đi qua — đúng, vì
 * chặn nó là biến cổng thành nhà tù. Nhưng **bên trong** thủ tục ấy có một cửa thứ hai:
 *
 *     if (user.loginMethod !== 'local') throw 'Chỉ tài khoản nội bộ mới có thể đổi mật khẩu'
 *
 * và dữ liệu **thật đang chạy** mang `loginMethod = 'password'` (do `scripts/seed-test-data.mjs`
 * tạo). Đo được ngày 2026-08-09 trên DB sản xuất: **4/4** tài khoản không-admin đang hoạt động
 * (`operator1` · `supervisor1` · `maint1` · `engineer1`) mang `'password'` ⇒ cả bốn **bị khoá ra
 * ngoài**: cổng đẩy họ vào màn đổi mật khẩu, màn ấy từ chối họ, và đường admin đặt lại hộ
 * (`user.updatePassword`) mang **đúng vị từ ấy** nên cũng đóng.
 *
 * ⚠⚠⚠ **LƯỚI §5 CỦA LƯỢT I-4 XANH SUỐT** — vì fixture dựng người dùng qua `createUser`, mà hàm ấy
 *    ghi cứng `'local'`. **Lưới đo một hình dạng dữ liệu KHÔNG TỒN TẠI trong sản xuất.** Đó là bài
 *    học chính, và nó được đóng bằng `server/_core/xacThucNoiBo.test.ts` §2: tập hằng dưới đây bị
 *    **neo hai chiều vào chính mã SINH RA hàng `users`**, không vào fixture.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO **MỘT** HẰNG CÓ TÊN, KHÔNG PHẢI `=== 'local' || === 'password'` RẢI SÁU CHỖ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Thêm một chuỗi thứ hai cạnh chuỗi thứ nhất là **nhận diện bằng CÁCH VIẾT thay vì bằng KHÁI
 * NIỆM** — lớp lỗi đã đẻ ra phần tử thứ N+1 **mười bảy lần** trong chuỗi pha này. Sáu điểm gọi
 * (ba máy chủ, ba client) nay hỏi **một** chủ; muốn công nhận phương thức thứ ba thì phải sửa
 * **hằng này**, và lưới §2 lập tức đòi một **mã sản xuất thật** ghi ra giá trị ấy — không tự khai
 * được.
 *
 * ⚠ **FAIL-CLOSED.** Giá trị lạ / `null` / không phải chuỗi ⇒ **KHÔNG** nội bộ. Hỏng theo chiều
 *   *"không đổi được mật khẩu"* thì phiền và **nhìn thấy được**; hỏng theo chiều ngược lại là mở
 *   cửa đặt mật khẩu cho một tài khoản mà mật khẩu **không phải** thứ xác thực nó.
 */

/**
 * ★★★ **TẬP PHƯƠNG THỨC XÁC THỰC NỘI BỘ** — mật khẩu do **hệ này** giữ (`user_secrets.passwordHash`),
 * không phải do một IdP bên ngoài.
 *
 * ⚠⚠ Mỗi phần tử phải có **một mã sản xuất ghi ra nó**, và lưới §2 đo lại điều đó **hai chiều**:
 *   · chiều A — ∀ giá trị mà một *nguồn sinh nội bộ* ghi vào cột `loginMethod` ⇒ **PHẢI** ở đây
 *     (thiếu một giá trị = nhốt đúng nhóm người dùng mà nguồn ấy tạo ra — chính sự cố này);
 *   · chiều B — ∀ phần tử ở đây ⇒ **PHẢI** được ít nhất một nguồn sinh nội bộ ghi ra (một phần tử
 *     không ai sinh ra là **nới lỏng không có lý do**, và người sau sẽ xoá nó — rồi nhốt lại
 *     đúng những người mà nó đang cứu).
 *
 * Nguồn sinh, đo tại `d775d6c9` (danh sách sống ở `server/_core/xacThucNoiBo.test.ts::NGUON_SINH`):
 *   · `'local'`    ← `server/db/auth.ts` (`createLocalUser` · `createUserWithPassword`);
 *   · `'password'` ← `scripts/seed-test-data.mjs` (**đường đã tạo 4 tài khoản đang chạy**).
 *
 * ⚠ `'saml'` · `'manus'` · mọi tên nhà cung cấp OAuth ⇒ **KHÔNG** ở đây, theo cấu tạo.
 */
export const PHUONG_THUC_XAC_THUC_NOI_BO: readonly string[] = ["local", "password"];

/**
 * ★★★ **VỊ TỪ DUY NHẤT**: *"tài khoản này có được hệ NÀY xác thực bằng mật khẩu không"*.
 *
 * Dùng cho **cả ba câu hỏi** mà trước đây mỗi chỗ tự trả lời bằng một phép so chuỗi:
 *   · người dùng có được **tự đổi** mật khẩu không (`user.changePassword`);
 *   · admin có được **đặt lại hộ** không (`user.updatePassword`);
 *   · lượt tắt 2FA có phải **kiểm mật khẩu** không (`user.disable2FA`).
 *
 * ⚠ Nhận `unknown` **cố ý**: ô này đi từ DB (`varchar` nullable) và từ `auth.me` qua JSON, nên
 *   *"không phải chuỗi"* là một trạng thái **có thật**, không phải một khả năng lý thuyết.
 */
export function laXacThucNoiBo(loginMethod: unknown): boolean {
  if (typeof loginMethod !== "string") return false;
  return PHUONG_THUC_XAC_THUC_NOI_BO.includes(loginMethod);
}
