import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { like } from "drizzle-orm";
import { appRouter } from "./routers";
import * as db from "./db";
import { users } from "../drizzle/schema";

/**
 * ★★★ Pha 8 Task 3 — **DẤU RIÊNG CỦA FILE NÀY.** Mọi tài khoản file này tạo mang tiền tố này ở ô
 * `email`; lượt dọn khoá **đúng** vào tiền tố ấy. Nhờ thế câu *"chỉ dọn hàng chính nó tạo"* đúng
 * **theo cấu tạo**, không phải theo thiện chí của người viết ca kế tiếp.
 */
const DAU = "pha8-setupadmin-";
const EMAIL = (s: string) => `${DAU}${s}@test.invalid`;

describe("auth.setupAdmin", () => {
  /**
   * ★★★★ Pha 7 / review TOÀN NHÁNH **I-3 (chẩn đoán THỨ HAI)** — **THÔI XOÁ SẠCH BẢNG `users`.**
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ BẢN TRƯỚC: `const allUsers = await db.getAllUsers(); for (…) await db.deleteUser(u.id)`.
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Sổ `totp_consumed` **không** có khoá ngoại tới `users`, nên `donSo` (kẻ phá trạng thái dùng
   * chung **thứ nhất**, đã vá) và `beforeEach` này là **HAI kẻ khác nhau, trên HAI bảng khác nhau**.
   * Cả hai đều **thật**, và đây là kẻ thứ hai. Đo được (probe, DB test thật):
   *
   *     [PROBE] nạn nhân đã tạo: uid=1025 · đọc lại được = true
   *     [PROBE] beforeEach của setupAdmin sắp xoá 2 tài khoản
   *     [PROBE] SAU beforeEach: nạn nhân còn = false · tổng users = 0
   *
   * ⇒ Vitest chạy các file test **SONG SONG**. Một lượt `beforeEach` ở đây rơi vào **giữa** một ca
   *   của file khác sẽ xoá đúng tài khoản mà file ấy vừa dựng trong `beforeAll`
   *   (`mustChangePassword.test.ts` · `db/authCacheHooks.test.ts` · `totpSeedWriteScan.test.ts` §3)
   *   — và nạn nhân **đổi mỗi lượt chạy**, đúng triệu chứng *"cổng đỏ KHÔNG TẤT ĐỊNH"*.
   *   ⚠ `user_secrets` có `ON DELETE CASCADE` ⇒ lượt xoá kéo theo cả bí mật của nạn nhân.
   *
   * ⚠⚠ **THU HẸP VỀ ĐÚNG TIỀN ĐỀ MÀ THỦ TỤC ĐÒI, KHÔNG HƠN.** `auth.setupAdmin`
   * (`server/routers.ts:357-359`) chỉ hỏi **`getUsersByRole('admin').length === 0`** — nó **không**
   * quan tâm bảng `users` có rỗng hay không. Nên tiền đề của file này là *"không còn ADMIN nào"*,
   * và mọi lượt xoá rộng hơn thế là **tác dụng phụ**, không phải yêu cầu.
   * ⇒ Bán kính phá hoại đi từ **MỌI tài khoản** xuống **chỉ các admin**. Ba file nạn nhân ở trên
   *   đều dựng tài khoản `role: "user"` ⇒ nay chúng sống sót.
   */
  /**
   * ★★★ Pha 8 Task 3 — **BƯỚC THU HẸP THỨ HAI: TỪ "MỌI ADMIN" XUỐNG "HÀNG CỦA CHÍNH TÔI".**
   *
   * `03ad466c` đã đi từ *"mọi tài khoản"* xuống *"mọi admin"* — đủ để **hết nhiễu HÔM NAY**, vì đo
   * được: mọi file test khác dựng hàng `users` thật đều dùng `role: "user"`
   * (`machineApiPanelOperator` · `operatorBadgeService` · `mustChangePassword` ·
   * `totpSeedWriteScan` · `buocDoiMatKhau`), và DB test không có tài khoản hạt giống nào.
   *
   * ⚠ Nhưng *"hôm nay không ai tạo admin"* là một **quan sát theo thời điểm**, không phải bất biến.
   * File test thứ N+1 dựng một admin thật là đủ để nợ này sống lại — và nó sẽ sống lại dưới đúng
   * triệu chứng cũ (**ca đỏ đổi mỗi lượt**) đã làm **ba pha liên tiếp** chẩn đoán sai.
   * ⇒ Lượt dọn nay khoá vào `DAU`, tức **đúng tập hàng file này tạo ra**. Bán kính phá hoại = 0.
   *
   * ⚠⚠ **HỆ QUẢ ĐƯỢC KHAI, ĐỪNG ĐỌC NHẦM THÀNH LỖI:** tiền đề của `auth.setupAdmin` là
   * `getUsersByRole('admin').length === 0` — một điều kiện **TOÀN CỤC**. File này nay **không**
   * cưỡng chế nó bằng cách xoá của người khác nữa, nên nếu một file khác dựng admin thật chạy song
   * song, ca ở đây sẽ **ĐỎ**. Đó là hỏng theo chiều **AN TOÀN**: thà báo động thật còn hơn im lặng
   * xoá dữ liệu của file khác. Đường sửa lúc ấy là cho file kia mang dấu riêng, **không** phải mở
   * lại lượt xoá rộng ở đây.
   *
   * `afterEach` (chứ không chỉ `beforeEach`) là phần bắt buộc: không có nó, file này để lại rác
   * admin cho lượt sau — đã đo được **đúng một hàng như thế** còn sót trong DB test
   * (`id=1161 · name="Test Admin"`), do chính bản trước không hề dọn sau khi chạy.
   */
  const donHangCuaChinhFileNay = async () => {
    const d = await db.getDb();
    if (!d) return;
    await d.delete(users).where(like(users.email, `${DAU}%`));
  };

  beforeEach(donHangCuaChinhFileNay);
  afterEach(donHangCuaChinhFileNay);

  it("should create first admin user successfully", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    const result = await caller.auth.setupAdmin({
      username: "admin",
      email: EMAIL("first"),
      name: "Test Admin",
      password: "password123",
    });

    expect(result.success).toBe(true);
    expect(result.userId).toBeTypeOf("number");

    // Verify user was created with admin role.
    // ⚠ Lọc theo `DAU`: khẳng định nói về **hàng của file này**, không về trạng thái toàn cục của
    //   bảng `users` — file này không còn sở hữu bảng ấy nữa.
    const admins = (await db.getUsersByRole("admin")).filter((u) => u.email?.startsWith(DAU));
    expect(admins.length).toBe(1);
    expect(admins[0].email).toBe(EMAIL("first"));
    expect(admins[0].name).toBe("Test Admin");
    expect(admins[0].role).toBe("admin");
  });

  it("should reject if admin already exists", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    // Create first admin
    await caller.auth.setupAdmin({
      username: "admin1",
      email: EMAIL("dup1"),
      name: "First Admin",
      password: "password123",
    });

    // Try to create second admin
    await expect(
      caller.auth.setupAdmin({
        username: "admin2",
        email: EMAIL("dup2"),
        name: "Second Admin",
        password: "password123",
      })
    ).rejects.toThrow("Admin already exists");
  });

  it("should validate email format", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    await expect(
      caller.auth.setupAdmin({
        username: "admin",
        email: "invalid-email",
        name: "Test Admin",
        password: "password123",
      })
    ).rejects.toThrow();
  });

  it("should validate password length", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    await expect(
      caller.auth.setupAdmin({
        username: "admin",
        email: EMAIL("shortpw"),
        name: "Test Admin",
        password: "short",
      })
    ).rejects.toThrow();
  });

  it("should validate name is not empty", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    await expect(
      caller.auth.setupAdmin({
        username: "admin",
        email: EMAIL("noname"),
        name: "",
        password: "password123",
      })
    ).rejects.toThrow();
  });

  it("should hash password before storing", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    const plainPassword = "password123";
    await caller.auth.setupAdmin({
      username: "testadmin",
      email: EMAIL("hash"),
      name: "Test Admin",
      password: plainPassword,
    });

    const admins = (await db.getUsersByRole("admin")).filter((u) => u.email?.startsWith(DAU));
    // ★ Pha 7 Task 9 (9c) — hash KHÔNG còn trên hàng `users`; nó ở `user_secrets`.
    //   ⚠ Ô này cũng là ĐỐI CHỨNG DƯƠNG cho ràng buộc "hai INSERT trong MỘT giao dịch": nếu hàng
    //     `user_secrets` không được tạo cùng lượt, tài khoản admin đầu tiên sẽ KHÔNG đăng nhập
    //     được — và nó sẽ hỏng **im lặng**.
    const biMat = await db.layBiMatNguoiDung(admins[0].id);
    expect(biMat.passwordHash).toBeDefined();
    expect(biMat.passwordHash).not.toBe(plainPassword);
    expect(biMat.passwordHash?.length).toBeGreaterThan(20); // bcrypt hash is long
    // Và hàng `users` KHÔNG mang bí mật nào nữa (đây là toàn bộ điểm của 9c).
    expect("passwordHash" in admins[0]).toBe(false);
  });
});
