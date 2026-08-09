import { describe, it, expect, beforeEach } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";

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
  beforeEach(async () => {
    // Tiền đề THẬT của `auth.setupAdmin`: không còn admin nào. KHÔNG xoá cả bảng.
    for (const admin of await db.getUsersByRole("admin")) {
      await db.deleteUser(admin.id);
    }
  });

  it("should create first admin user successfully", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
    });

    const result = await caller.auth.setupAdmin({
      username: "admin",
      email: "admin@test.com",
      name: "Test Admin",
      password: "password123",
    });

    expect(result.success).toBe(true);
    expect(result.userId).toBeTypeOf("number");

    // Verify user was created with admin role
    const admins = await db.getUsersByRole("admin");
    expect(admins.length).toBe(1);
    expect(admins[0].email).toBe("admin@test.com");
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
      email: "admin1@test.com",
      name: "First Admin",
      password: "password123",
    });

    // Try to create second admin
    await expect(
      caller.auth.setupAdmin({
        username: "admin2",
        email: "admin2@test.com",
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
        email: "admin@test.com",
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
        email: "admin@test.com",
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
      email: "admin@test.com",
      name: "Test Admin",
      password: plainPassword,
    });

    const admins = await db.getUsersByRole("admin");
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
