/**
 * ★★★ Pha 7 Task 9 (9b) / **QĐ-1** — *"buộc đổi mật khẩu"* đặt trên `users`, **KHÔNG rò**.
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ QUYẾT ĐỊNH, RỦI RO, VÀ CHỖ LƯỚI NÀY ĐỨNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đề xuất Task 9 §3.4 đặt hai mốc ở `user_secrets`. **Chủ dự án chọn `users`** (QĐ-1, 2026-08-09).
 * Rủi ro đã nêu, nguyên văn: *"đặt trên `users` mà phân loại `"public"` ⇒ `user.list` phát cho
 * trình duyệt DANH SÁCH tài khoản đang bị buộc đổi mật khẩu"*.
 *
 * ⇒ Vị trí là quyết định của chủ dự án; **giữ nó không rò là ràng buộc kỹ thuật**. Bốn ô dưới đây
 * là toàn bộ phép cưỡng chế của ràng buộc ấy:
 *
 *   §1  vị từ suy ra — bảng chân trị ĐẦY ĐỦ (4 tổ hợp + biên "bằng nhau");
 *   §2  `user.list` **KHÔNG** mang ô ấy (và không mang hai cột gốc);
 *   §3  `auth.me` **CÓ** ô suy ra `mustChangePassword`;
 *   §4  ★★★ ô suy ra đến từ một lượt đọc DB **MỚI**, **KHÔNG** từ `ctx.user`.
 *
 * ⚠⚠ §4 là ô quan trọng nhất và cũng là ô dễ mất nhất. `redactServerOnlyUserFields()` làm **rỗng**
 *    hai mốc trên `ctx.user` — đúng theo thiết kế. Nên một lượt "tối ưu" hiển nhiên
 *    (`suyRaPhaiDoiMatKhau(ctx.user)` thay vì `db.phaiDoiMatKhau(id)`) sẽ trả **`false` LUÔN
 *    LUÔN**: không ai bị buộc đổi mật khẩu, **không một thông báo lỗi nào**. Đó là hỏng **im lặng
 *    theo chiều MỞ** — đúng lớp lỗi mà cặp-hai-mốc được chọn để diệt. §4 dựng đúng tình huống ấy:
 *    `ctx.user` mang hai mốc **rỗng**, DB nói **phải đổi**.
 *
 * ⚠ Lưới chạy trên **DB test THẬT** (`aoi_management_test`), không trên `FakeDb`: bất biến này nói
 *   về **nguồn dữ liệu**, nên một bảng giả trong bộ nhớ sẽ đo đúng thứ nó không được phép giả định.
 *   Nó tự tạo tài khoản của mình và **chỉ xoá đúng tài khoản ấy**.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import {
  PUBLIC_USER_FIELDS,
  SERVER_ONLY_USER_FIELDS,
  USER_FIELD_VISIBILITY,
  suyRaPhaiDoiMatKhau,
  redactServerOnlyUserFields,
} from "../_core/publicUser";

const T0 = new Date("2026-08-01T00:00:00Z");
const T1 = new Date("2026-08-02T00:00:00Z");

describe("★★★ Task 9 §1 (9b) — VỊ TỪ suy ra: bảng chân trị ĐẦY ĐỦ", () => {
  it("★★★ chưa từng thu hồi ⇒ KHÔNG buộc ai (migration trung tính về hành vi lúc áp)", () => {
    expect(suyRaPhaiDoiMatKhau({ passwordChangedAt: null, passwordInvalidBefore: null })).toBe(false);
    expect(suyRaPhaiDoiMatKhau({ passwordChangedAt: T1, passwordInvalidBefore: null })).toBe(false);
  });

  it("★★★ thu hồi + KHÔNG BIẾT đổi lúc nào ⇒ PHẢI ĐỔI (hỏng theo chiều ĐÓNG, không mở cửa)", () => {
    expect(suyRaPhaiDoiMatKhau({ passwordChangedAt: null, passwordInvalidBefore: T0 })).toBe(true);
  });

  it("★★★ thu hồi SAU lượt đổi ⇒ PHẢI ĐỔI · đổi SAU lượt thu hồi ⇒ THÔI (vị từ TỰ DỌN)", () => {
    expect(suyRaPhaiDoiMatKhau({ passwordChangedAt: T0, passwordInvalidBefore: T1 })).toBe(true);
    expect(suyRaPhaiDoiMatKhau({ passwordChangedAt: T1, passwordInvalidBefore: T0 })).toBe(false);
  });

  it("★★ BIÊN — đổi ĐÚNG LÚC thu hồi ⇒ vẫn PHẢI ĐỔI (`<=`, không phải `<`)", () => {
    // ⚠ Lượt xoay ghi `passwordInvalidBefore = now()`; nếu một lượt đổi mật khẩu rơi vào **cùng
    //   mili-giây**, chọn `<` sẽ tha người ấy. Tha nhầm là mở cửa; buộc nhầm chỉ là phiền.
    expect(suyRaPhaiDoiMatKhau({ passwordChangedAt: T0, passwordInvalidBefore: new Date(T0) })).toBe(true);
  });
});

describe("★★★ Task 9 §2 (QĐ-1) — hai mốc KHÔNG RỜI MÁY CHỦ qua bất kỳ hình dạng người dùng nào", () => {
  const MOC = ["passwordChangedAt", "passwordInvalidBefore"] as const;

  it("★★★ cả hai mốc được phân loại `server-only` (đây là rủi ro QĐ-1, đóng theo cấu tạo)", () => {
    for (const m of MOC) {
      expect(
        (USER_FIELD_VISIBILITY as Record<string, string>)[m],
        `\`${m}\` phải là "server-only" — "public" ⇒ user.list phát danh sách tài khoản bị buộc đổi mật khẩu`,
      ).toBe("server-only");
      expect(SERVER_ONLY_USER_FIELDS as readonly string[]).toContain(m);
      expect(PUBLIC_USER_FIELDS as readonly string[]).not.toContain(m);
    }
  });

  it("★★★ `user.list` — hình dạng trả về KHÔNG mang mốc nào, và KHÔNG mang `mustChangePassword`", () => {
    // `user.list` = `toPublicUsers(db.getAllUsers())`; hình dạng của nó ĐÚNG BẰNG `PUBLIC_USER_FIELDS`
    // (ô §2 của `publicUser.test.ts` đã cưỡng chế điều đó). Ở đây khẳng định hệ quả cần cho QĐ-1.
    const khoa = new Set<string>(PUBLIC_USER_FIELDS as readonly string[]);
    for (const m of MOC) expect(khoa.has(m), `\`${m}\` LỌT vào hình dạng công khai`).toBe(false);
    expect(
      khoa.has("mustChangePassword"),
      "`mustChangePassword` là ô của RIÊNG `auth.me`; nó không được thành một cột công khai của mọi người dùng",
    ).toBe(false);
  });
});

/* ── §3 + §4: DB THẬT ────────────────────────────────────────────────────────────────────────── */

let uid = 0;
const OPEN_ID = `__task9_mcp_${Date.now()}`;

async function datMoc(doiLuc: Date | null, thuHoiLuc: Date | null): Promise<void> {
  const { getDb } = await import("../db/connection");
  const { eq } = await import("drizzle-orm");
  const { users } = await import("../../drizzle/schema");
  const d = await getDb();
  await d!
    .update(users)
    .set({ passwordChangedAt: doiLuc, passwordInvalidBefore: thuHoiLuc })
    .where(eq(users.id, uid));
  // ⚠ `db.getUserById` đi qua CACHE phiên ở tầng trên; ở đây ta đọc thẳng nên không cần dọn cache
  //   — nhưng `auth.me` đọc DB mới qua `db.phaiDoiMatKhau`, đúng thứ ô §4 muốn đo.
}

/** `ctx` như tầng xác thực THẬT dựng ra: hàng `users` **đã qua** `redactServerOnlyUserFields`. */
async function ctxNhuThat(): Promise<TrpcContext> {
  const hang = await db.getUserById(uid);
  const daLamSach = redactServerOnlyUserFields(hang as unknown as Record<string, unknown>) as unknown as User;
  return {
    user: daLamSach,
    sessionToken: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as unknown as TrpcContext["res"],
  };
}

describe("★★★ Task 9 §3+§4 (QĐ-1) — `auth.me` CÓ ô suy ra, và nó KHÔNG đến từ `ctx.user`", () => {
  beforeAll(async () => {
    const r = await db.createLocalUser({
      username: OPEN_ID,
      passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
      name: "Task 9 — mustChangePassword",
      role: "user",
    });
    uid = r.id;
  });

  afterAll(async () => {
    if (uid) await db.deleteUser(uid); // FK ON DELETE CASCADE dọn hàng `user_secrets` hộ
  });

  it("★★ cầu chì — tài khoản dựng được, và lượt tạo đã sinh CẢ hàng `user_secrets` (một giao dịch)", async () => {
    expect(uid).toBeGreaterThan(0);
    const biMat = await db.layBiMatNguoiDung(uid);
    expect(
      biMat.passwordHash,
      "hàng `user_secrets` KHÔNG được tạo cùng lượt ⇒ tài khoản này KHÔNG đăng nhập được, và nó hỏng IM LẶNG",
    ).toBeTruthy();
  });

  it("★★★ §3 — `auth.me` mang ô `mustChangePassword` (client biết mà KHÔNG cần mở cột)", async () => {
    await datMoc(new Date(), null); // chưa từng thu hồi
    const me = await appRouter.createCaller(await ctxNhuThat()).auth.me();
    expect(me, "`auth.me` trả null cho một ctx có người dùng").not.toBeNull();
    expect("mustChangePassword" in (me as object), "thiếu ô SUY RA ⇒ client không có đường nào biết").toBe(true);
    expect(me!.mustChangePassword).toBe(false);
    // …và nó KHÔNG kéo theo hai cột gốc.
    for (const m of ["passwordChangedAt", "passwordInvalidBefore"]) {
      expect(m in (me as object), `\`${m}\` LỌT ra qua auth.me`).toBe(false);
    }
  });

  it("★★★★ §4 — ô suy ra đọc DB MỚI: `ctx.user` rỗng hai mốc mà `auth.me` VẪN nói PHẢI ĐỔI", async () => {
    // Đây là lượt xoay: thu hồi BÂY GIỜ, và người dùng chưa đổi lại.
    await datMoc(new Date(Date.now() - 60_000), new Date());

    const ctx = await ctxNhuThat();
    // Bằng chứng tại chỗ rằng `ctx.user` KHÔNG mang thông tin ấy — nếu ai đó suy từ đây thì kết
    // quả sẽ là `false`, và ô dưới đây bắt được đúng lượt "tối ưu" ấy.
    const u = ctx.user as unknown as Record<string, unknown>;
    expect(u.passwordInvalidBefore, "`ctx.user` phải ĐÃ ĐƯỢC làm rỗng — nếu không, Task 7 đã hồi quy").toBeNull();
    expect(suyRaPhaiDoiMatKhau(ctx.user as unknown as { passwordChangedAt: null; passwordInvalidBefore: null })).toBe(
      false,
    );

    const me = await appRouter.createCaller(ctx).auth.me();
    expect(
      me!.mustChangePassword,
      "`auth.me` suy `mustChangePassword` từ `ctx.user` (đã bị làm rỗng) ⇒ KHÔNG AI bị buộc đổi mật khẩu, im lặng",
    ).toBe(true);
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — người dùng đổi mật khẩu ⇒ vị từ TỰ tắt (không ai phải nhớ xoá cờ)", async () => {
    await datMoc(new Date(Date.now() - 60_000), new Date());
    expect((await appRouter.createCaller(await ctxNhuThat()).auth.me())!.mustChangePassword).toBe(true);

    // `updateUserPassword` ghi hash MỚI **và** `passwordChangedAt = now()`, trong một giao dịch.
    await db.updateUserPassword(uid, "$2b$10$saukhidoimatkhau000000000000000000000000000000000000000000");

    expect(
      (await appRouter.createCaller(await ctxNhuThat()).auth.me())!.mustChangePassword,
      "đổi mật khẩu xong mà vẫn bị buộc đổi ⇒ `updateUserPassword` quên ghi `passwordChangedAt`",
    ).toBe(false);
    const biMat = await db.layBiMatNguoiDung(uid);
    expect(biMat.passwordHash, "hash mới không được ghi vào `user_secrets`").toContain("saukhidoimatkhau");
  });
});
