/**
 * ★★★ Pha 8 Task 2 — **`auth.logout` PHẢI THU HỒI PHIÊN THẬT.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐO ĐƯỢC TRÊN MÁY CHỦ SỐNG (PID 25952, mã trước bản vá) — KHÔNG PHẢI SUY LUẬN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đăng nhập `engineer1` (#51) rồi, **cùng một cookie**, gọi ba lượt:
 *
 *     POST /api/trpc/auth.logout  ⇒ HTTP 200  {"success":true}
 *     GET  /api/trpc/auth.me      ⇒ HTTP 200  {"id":51,"username":"engineer1",…}   ← ĐỦ HỒ SƠ
 *     SELECT "isActive" FROM user_sessions WHERE id=277                ⇒ **t**     ← VẪN SỐNG
 *
 * Hiệu chuẩn thước bằng **sự kiện có đáp số biết trước** (thiết bị đo đã nói dối TÁM lần):
 *     cookie rác                       ⇒ `auth.me` = null   ✓ thước phân biệt được
 *     `session.revoke(277)` rồi đo lại ⇒ `auth.me` = null, `isActive`=**f**  ✓ đường thu hồi CÓ THẬT
 * ⇒ *"logout xong vẫn dùng được"* là **tính chất của sản phẩm**, không phải tật của phép đo.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BẤT BIẾN — **HAI VẾ**, và lưới này canh CẢ HAI, ở HAI Ô KHÁC NHAU
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ***"Sau `auth.logout`, phiên ấy KHÔNG dùng được nữa **VÀ** hàng `user_sessions` không còn
 * `isActive`."***
 *
 * ⚠⚠ VÌ SAO PHẢI TÁCH LÀM HAI Ô, KHÔNG GỘP MỘT Ô "đầu-cuối": đường xác thực có **HAI** cửa nối
 * tiếp — `getCachedAuthUser` (cache ngắn hạn) rồi mới tới `getSessionByToken` (sổ DB). Một ô
 * đầu-cuối **đỏ cho CẢ HAI** kiểu hỏng, nên nó **không phân biệt được** "quên vá sổ" với "quên
 * dọn cache" — tức nó canh **một vế và ăn may vế kia**. Pha 5 đã ship đúng lỗi ấy: hai cổng
 * *"độc lập"* cùng canh một TẬP, một phép hoán vị giữ nguyên tập ⇒ **cả hai xanh**.
 * ⇒ §1 đỏ **CHỈ KHI** mất lượt ghi sổ; §2 đỏ **CHỈ KHI** mất lượt dọn cache. §3 giữ lại câu
 *   đầu-cuối vì đó mới là thứ người dùng thật quan tâm — và nó **được khai** là đỏ cho cả hai.
 *
 * ⚠ Lưới chạy trên **DB test THẬT** (`aoi_management_test`): vế §1 nói về **một hàng trong sổ**,
 *   nên một bảng giả trong bộ nhớ sẽ đo đúng thứ nó không được phép giả định. File tự dựng tài
 *   khoản + phiên của mình và **chỉ dọn đúng những hàng ấy** (kỷ luật Pha 8 Task 3).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

/**
 * ⚠⚠ **PHẢI ĐẶT TRƯỚC MỌI `import`** — `server/_core/env.ts` đọc `process.env` **đúng một lần**
 * lúc nạp module, và `vitest.setup.ts` cố ý **KHÔNG** nạp `.env` (nạp vào là kéo theo cờ sản xuất
 * làm hỏng hàng chục ca khẳng định "cờ TẮT mặc định"). Thiếu hai biến này thì `sdk.signSession`
 * ném `DataError: Zero-length key is not supported` và `verifySession` trả `null` vì `appId` rỗng
 * — tức §3 sẽ **ĐỎ VÌ HẠ TẦNG**, một màu đỏ **nói dối** về bất biến đang canh.
 * `vi.hoisted` là thứ duy nhất chạy trước `import` trong ESM.
 */
vi.hoisted(() => {
  process.env.JWT_SECRET ||= "pha8-task2-logout-thuhoi-secret";
  process.env.VITE_APP_ID ||= "avi-aoi-management";
});

import { eq } from "drizzle-orm";
import { appRouter } from "./routers";
import * as db from "./db";
import { userSessions } from "../drizzle/schema";
import type { User } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { sdk } from "./_core/sdk";
import { COOKIE_NAME } from "../shared/const";
import {
  clearAuthSessionCache,
  getCachedAuthUser,
  setCachedAuthUser,
} from "./services/authSessionCache";

/** Dấu riêng của file này — mọi hàng nó tạo mang tiền tố này, và lượt dọn khoá đúng vào đó. */
const DAU = "pha8-logout-thuhoi";
const MOT_GIO_MS = 60 * 60 * 1000;

let uid = 0;
let openId = "";

/** `ctx` đúng hình dạng tầng xác thực thật dựng ra cho một thủ tục `public`. */
function ctxVoiToken(user: User | null, token: string | null): TrpcContext {
  return {
    user,
    sessionToken: token,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
  };
}

/** Một `Request` chỉ mang đúng cookie phiên — đầu vào thật của `sdk.authenticateRequest`. */
function reqVoiCookie(token: string): Parameters<typeof sdk.authenticateRequest>[0] {
  return { headers: { cookie: `${COOKIE_NAME}=${token}` } } as Parameters<
    typeof sdk.authenticateRequest
  >[0];
}

/** Dựng một phiên THẬT (JWT ký đúng cửa đúc + hàng `user_sessions` khớp token). */
async function dungPhien(nhan: string): Promise<string> {
  const token = await sdk.createSessionToken(openId, {
    name: `${DAU}-${nhan}`,
    expiresInMs: MOT_GIO_MS,
  });
  await db.createUserSession({
    userId: uid,
    sessionToken: token,
    deviceName: `${DAU}-${nhan}`,
    expiresAt: new Date(Date.now() + MOT_GIO_MS),
  });
  return token;
}

/** Đọc THẲNG hàng sổ — không qua cache, không qua hàm nào của đường vá. */
async function hangPhien(token: string) {
  const d = await db.getDb();
  const [row] = await d!.select().from(userSessions).where(eq(userSessions.sessionToken, token));
  return row;
}

beforeAll(async () => {
  // Cache phiên phải BẬT: vế §2 nói về nó, và với TTL=0 thì `setCachedAuthUser` là no-op ⇒ ô §2
  // trở thành chân lý rỗng. Cầu chì trong chính §2 đo lại điều này.
  process.env.AUTH_CACHE_TTL_S = "60";
  const r = await db.createLocalUser({
    username: `${DAU}-${Date.now()}`,
    passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
    name: "Pha 8 Task 2 — logout thu hồi",
    role: "user",
  });
  uid = r.id;
  const hang = await db.getUserById(uid);
  openId = hang!.openId;
});

afterAll(async () => {
  const d = await db.getDb();
  // Dọn ĐÚNG hàng của chính file này: phiên khoá theo `userId` mình vừa tạo, rồi tài khoản theo id.
  if (d && uid) await d.delete(userSessions).where(eq(userSessions.userId, uid));
  if (uid) await db.deleteUser(uid);
});

beforeEach(async () => {
  await clearAuthSessionCache();
});

describe("★★★ Pha 8 Task 2 §1 — VẾ SỔ: sau `auth.logout`, hàng `user_sessions` không còn `isActive`", () => {
  /**
   * ⚠ Ô này **KHÔNG** chạm cache. Nó đọc thẳng hàng sổ, nên một bản vá chỉ dọn cache mà quên ghi
   *   sổ **không thể** làm nó xanh — đó là toàn bộ lý do nó tồn tại tách khỏi §2.
   */
  it("★★★ hàng phiên bị lật `isActive` = false", async () => {
    const token = await dungPhien("so");

    // Cầu chì: tiền đề phải ĐÚNG, nếu không ô dưới là chân lý rỗng.
    const truoc = await hangPhien(token);
    expect(truoc, "không dựng được hàng `user_sessions` ⇒ ô dưới đo một tập rỗng").toBeTruthy();
    expect(truoc!.isActive, "phiên vừa dựng phải đang SỐNG").toBe(true);

    const ketQua = await appRouter.createCaller(ctxVoiToken(null, token)).auth.logout();
    expect(ketQua).toEqual({ success: true });

    const sau = await hangPhien(token);
    expect(sau, "hàng phiên biến mất — `logout` KHÔNG được xoá hàng, chỉ thu hồi").toBeTruthy();
    expect(
      sau!.isActive,
      "sổ vẫn ghi phiên SỐNG sau `auth.logout` ⇒ cookie bị bắt vẫn xác thực được cho tới 2027",
    ).toBe(false);
  });

  it("★★ `logout` KHÔNG được đụng phiên KHÁC của cùng người (thu hồi phải ĐÚNG một phiên)", async () => {
    const a = await dungPhien("chi-mot-a");
    const b = await dungPhien("chi-mot-b");

    await appRouter.createCaller(ctxVoiToken(null, a)).auth.logout();

    expect((await hangPhien(a))!.isActive).toBe(false);
    expect(
      (await hangPhien(b))!.isActive,
      "đăng xuất MỘT thiết bị đã đá văng mọi thiết bị còn lại — đó là `revokeAll`, không phải `logout`",
    ).toBe(true);
  });

  it("★★ không có token ⇒ vẫn thành công, và KHÔNG thu hồi bừa (thủ tục `public`)", async () => {
    const con = await dungPhien("khong-token");
    await expect(
      appRouter.createCaller(ctxVoiToken(null, null)).auth.logout(),
    ).resolves.toEqual({ success: true });
    expect((await hangPhien(con))!.isActive).toBe(true);
  });
});

describe("★★★ Pha 8 Task 2 §2 — VẾ CACHE: sau `auth.logout`, mục cache của phiên ấy bị xoá", () => {
  /**
   * ⚠ Ô này **KHÔNG** đọc sổ DB. Một bản vá chỉ ghi sổ mà quên dọn cache vẫn để cookie bị bắt
   *   *"cưỡi cache"* thêm trọn một cửa sổ TTL (≤60 s) — đủ dài cho một lượt lấy dữ liệu.
   */
  it("★★★ mục cache của CHÍNH phiên ấy biến mất", async () => {
    const token = await dungPhien("cache");
    const hang = (await db.getUserById(uid)) as unknown as User;

    await setCachedAuthUser(token, hang);
    // Cầu chì: cache phải THẬT SỰ đang bật (TTL=0 ⇒ mọi khẳng định dưới là chân lý rỗng).
    expect(
      await getCachedAuthUser(token),
      "cache phiên đang TẮT ⇒ ô này không đo được gì (AUTH_CACHE_TTL_S)",
    ).not.toBeNull();

    await appRouter.createCaller(ctxVoiToken(null, token)).auth.logout();

    expect(
      await getCachedAuthUser(token),
      "mục cache còn nguyên sau `auth.logout` ⇒ cookie bị bắt vẫn cưỡi cache trọn cửa sổ TTL",
    ).toBeNull();
  });

  it("★★ dọn cache khoá ĐÚNG phiên ấy, không quét sạch cache của phiên khác", async () => {
    const a = await dungPhien("cache-a");
    const b = await dungPhien("cache-b");
    const hang = (await db.getUserById(uid)) as unknown as User;
    await setCachedAuthUser(a, hang);
    await setCachedAuthUser(b, hang);

    await appRouter.createCaller(ctxVoiToken(null, a)).auth.logout();

    expect(await getCachedAuthUser(a)).toBeNull();
    expect(
      await getCachedAuthUser(b),
      "một lượt đăng xuất đã thổi bay cache của mọi phiên — đúng hành vi thì hại hiệu năng, và nó che mất lỗi thật",
    ).not.toBeNull();
  });
});

describe("★★★ Pha 8 Task 2 §3 — ĐẦU-CUỐI: phiên đã đăng xuất KHÔNG xác thực được nữa", () => {
  /**
   * ⚠⚠ **Ô NÀY ĐỎ CHO CẢ HAI KIỂU HỎNG** — được khai, không phải sơ suất. Nó là câu người dùng
   *    thật quan tâm (*"đăng xuất rồi thì cookie ấy chết"*), nhưng vì đường xác thực có hai cửa
   *    nối tiếp, nó **không phân biệt** được cửa nào hỏng. Việc phân biệt là của §1 và §2.
   */
  it("★★★ `sdk.authenticateRequest` với CHÍNH cookie ấy: trước ⇒ đi qua · sau `logout` ⇒ chặn", async () => {
    const token = await dungPhien("dau-cuoi");
    const req = reqVoiCookie(token);

    const truoc = await sdk.authenticateRequest(req);
    expect(truoc.id, "chưa đăng xuất mà đã không vào được ⇒ tiền đề sai, ô dưới vô nghĩa").toBe(uid);

    await appRouter.createCaller(ctxVoiToken(null, token)).auth.logout();

    await expect(
      sdk.authenticateRequest(req),
      "cookie ấy VẪN xác thực được sau `auth.logout` — đúng thứ đo được trên máy chủ sống",
    ).rejects.toThrow();
  });
});
