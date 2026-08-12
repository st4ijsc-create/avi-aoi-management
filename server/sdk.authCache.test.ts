/**
 * W4-B (doc 27 B4) — proves the session-user auth cache eliminates the
 * per-request DB traffic of authenticateRequest and that invalidation
 * restores the DB path.
 *
 * MEASUREMENT (asserted below): 5 authenticated requests with the SAME
 * session cookie
 *   - cache DISABLED (AUTH_CACHE_TTL_S=0): 15 DB calls
 *       (5× getUserByOpenId + 5× getSessionByToken + 5× upsertUser)
 *   - cache ENABLED  (TTL 60s):             7 DB calls
 *       (1× getUserByOpenId + 5× getSessionByToken + 1× upsertUser)
 *   → 53% fewer DB round-trips at 5 requests.
 *
 * ★★★★ Pha 9 nhóm A · **A2 — CON SỐ NÀY VỪA XẤU ĐI, VÀ ĐÓ LÀ BẢN VÁ, KHÔNG PHẢI HỒI QUY.**
 *
 * Trước A2 con số là **3** (`getSessionByToken` chỉ chạy ở lượt cache-miss). Nghĩa thật của con số
 * 3 ấy: **phép tra sổ thu hồi bị bộ nhớ đệm nuốt trong trọn một cửa sổ TTL** — đo được trên DB
 * thật, hai hình dạng đều lọt (XOÁ hàng `user_sessions` bằng SQL · lật `isActive=false` bằng SQL)
 * ⇒ lượt xác thực kế tiếp **ĐI QUA**. Đối chứng hiệu chuẩn `AUTH_CACHE_TTL_S=0` ⇒ **CHẶN**, tức cơ
 * chế cưỡng chế còn sống và thứ cho qua đúng là cái cache.
 *
 * ⇒ `getSessionByToken` nay chạy **mỗi lượt** (`sdk.xacThucTho`, TRƯỚC lượt đọc cache). Ô dưới ghim
 *   **7**, không phải 3. ⚠ Ai làm nó về lại 3 là đã mở lại cửa sổ 45 s — hãy đọc khối lý lẽ ở
 *   `server/_core/sdk.ts::xacThucTho` trước khi "tối ưu" con số này.
 * ⚠ Thứ bộ nhớ đệm VẪN mua được, và là phần đắt nhất: `getUserByOpenId` **và lượt GHI**
 *   `upsertUser(lastSignedIn)` — 5 → 1. Lượng từ hành vi của A2: `server/_core/soPhienTruocCache.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { COOKIE_NAME } from "../shared/const";

const dbMocks = vi.hoisted(() => {
  // ENV is read at import time — set before any module loads.
  process.env.JWT_SECRET = "w4b-test-secret-0123456789abcdef0123456789abcdef";
  process.env.VITE_APP_ID = "w4b-test-app";
  process.env.AUTH_CACHE_TTL_S = "60";
  return {
    getUserByOpenId: vi.fn(),
    upsertUser: vi.fn(),
    getSessionByToken: vi.fn(),
    /**
     * ★ Pha 8 Task 1 — `authenticateRequest` nay cưỡng chế cổng buộc-đổi-mật-khẩu ở biên xác thực
     * (`chanNeuPhaiDoiMatKhau` → `db.phaiDoiMatKhau`). ⚠ Nó **KHÔNG** được cộng vào `dbCallCount()`
     * bên dưới: các ô của file này đo *"bộ nhớ đệm phiên tiết kiệm được bao nhiêu lượt DB của đường
     * phân giải danh tính"*, và phép chặn là một lượt đọc **CỐ Ý không cache** (cache nó = giữ
     * người vừa đổi mật khẩu trong nhà tù thêm một TTL). Gộp vào là làm hỏng đúng thứ đang được đo.
     */
    phaiDoiMatKhau: vi.fn(async () => false),
  };
});

vi.mock("./db", () => dbMocks);

import { sdk } from "./_core/sdk";
import {
  clearAuthSessionCache,
  getAuthCacheStats,
  invalidateAuthSession,
  resetAuthCacheStats,
} from "./services/authSessionCache";
import { SERVER_ONLY_USER_FIELDS } from "./_core/publicUser";

const USER_ROW = {
  id: 42,
  openId: "open-42",
  username: "user42",
  name: "Cache Test User",
  email: "u42@example.com",
  phone: null,
  department: null,
  position: null,
  loginMethod: "local",
  role: "operator",
  isActive: true,
  twoFactorEnabled: false,
  loginAttempts: 0,
  lockedUntil: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  lastSignedIn: new Date("2026-07-01T00:00:00Z"),
};

function reqWithCookie(token: string): Request {
  return {
    headers: { cookie: `${COOKIE_NAME}=${token}` },
  } as unknown as Request;
}

function dbCallCount(): number {
  return (
    dbMocks.getUserByOpenId.mock.calls.length +
    dbMocks.getSessionByToken.mock.calls.length +
    dbMocks.upsertUser.mock.calls.length
  );
}

describe("sdk.authenticateRequest session-user cache (B4)", () => {
  let token: string;

  beforeEach(async () => {
    process.env.AUTH_CACHE_TTL_S = "60";
    await clearAuthSessionCache();
    resetAuthCacheStats();
    vi.clearAllMocks();
    dbMocks.getUserByOpenId.mockResolvedValue({ ...USER_ROW });
    dbMocks.upsertUser.mockResolvedValue(undefined);
    token = await sdk.createSessionToken("open-42", { name: "Cache Test User" });
    /**
     * ★★★★ 2026-08-11 SIẾT FAIL-OPEN — dòng này TRƯỚC ĐÂY là `mockResolvedValue(undefined)` với chú
     * thích *"no session row → JWT authoritative"*. Đó chính là **lỗ vừa bị siết**: một vé không nằm
     * trong sổ vẫn dùng được. Nay `chanNeuPhienDaThuHoi` TỪ CHỐI vé không có hàng, nên một phiên
     * **hợp lệ** trong file này phải có hàng sổ SỐNG — nếu không, mọi ô dưới sẽ đỏ vì
     * `SESSION_NOT_IN_LEDGER`, tức đo nhầm thứ khác hẳn thay vì đo bộ nhớ đệm.
     * ⚠ Số lượt gọi DB **không đổi**: `getSessionByToken` vẫn được gọi đúng một lần mỗi lượt cache-miss.
     */
    dbMocks.getSessionByToken.mockResolvedValue({
      id: 1,
      userId: 42,
      sessionToken: token,
      isActive: true,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });

  it("BEFORE (cache disabled): every request pays 3 DB calls — 5 requests = 15", async () => {
    process.env.AUTH_CACHE_TTL_S = "0";
    for (let i = 0; i < 5; i++) {
      const user = await sdk.authenticateRequest(reqWithCookie(token));
      expect(user.id).toBe(42);
    }
    expect(dbMocks.getUserByOpenId).toHaveBeenCalledTimes(5);
    expect(dbMocks.getSessionByToken).toHaveBeenCalledTimes(5);
    expect(dbMocks.upsertUser).toHaveBeenCalledTimes(5);
    expect(dbCallCount()).toBe(15);
  });

  it("AFTER (cache enabled, TTL 60s): 5 requests = 7 DB calls (sổ mỗi lượt, hồ sơ một lượt)", async () => {
    for (let i = 0; i < 5; i++) {
      const user = await sdk.authenticateRequest(reqWithCookie(token));
      expect(user.id).toBe(42);
      expect(user.role).toBe("operator");
    }
    expect(dbMocks.getUserByOpenId, "hồ sơ người dùng phải CÒN được cache").toHaveBeenCalledTimes(1);
    expect(
      dbMocks.getSessionByToken,
      "★ A2: phép tra sổ thu hồi phải chạy MỖI LƯỢT — về 1 là mở lại cửa sổ 45 s",
    ).toHaveBeenCalledTimes(5);
    expect(dbMocks.upsertUser, "lượt GHI lastSignedIn phải CÒN được tiết chế").toHaveBeenCalledTimes(1);
    expect(dbCallCount()).toBe(7);

    const stats = getAuthCacheStats();
    expect(stats.hits).toBe(4);
    expect(stats.misses).toBe(1);
  });

  it("cache hit returns the same user shape (Dates intact, secrets stripped)", async () => {
    const first = await sdk.authenticateRequest(reqWithCookie(token));
    const second = await sdk.authenticateRequest(reqWithCookie(token));
    expect(second.id).toBe(first.id);
    expect(second.openId).toBe(first.openId);
    expect(second.role).toBe(first.role);
    expect(second.twoFactorEnabled).toBe(first.twoFactorEnabled);
    expect(second.lastSignedIn).toBeInstanceOf(Date);
    // Pha 7 Task 9 / R1 — LUONG TU tren tap SUY RA, khong phai hai ten (hai ten ay da roi `users`).
    expect(SERVER_ONLY_USER_FIELDS.length).toBeGreaterThan(0);
    for (const k of SERVER_ONLY_USER_FIELDS) {
      expect((second as unknown as Record<string, unknown>)[k]).toBeNull();
    }
  });

  it("invalidation on logout: next request goes back to the DB", async () => {
    await sdk.authenticateRequest(reqWithCookie(token));
    await sdk.authenticateRequest(reqWithCookie(token));
    expect(dbMocks.getUserByOpenId).toHaveBeenCalledTimes(1);

    await invalidateAuthSession(token); // what auth.logout does with ctx.sessionToken

    await sdk.authenticateRequest(reqWithCookie(token));
    expect(dbMocks.getUserByOpenId, "lượt dọn cache phải đẩy hồ sơ về đường DB").toHaveBeenCalledTimes(2);
    // ★ A2: 3, không phải 2 — phép tra sổ chạy mỗi lượt, độc lập với cache (3 lượt gọi = 3 lượt tra).
    expect(dbMocks.getSessionByToken).toHaveBeenCalledTimes(3);
  });

  it("a REVOKED session row is rejected and never cached", async () => {
    dbMocks.getSessionByToken.mockResolvedValue({
      id: 1,
      userId: 42,
      sessionToken: token,
      isActive: false,
      expiresAt: null,
    });
    await expect(sdk.authenticateRequest(reqWithCookie(token))).rejects.toThrow(/revoked/i);
    // the failed auth must not have cached anything
    await expect(sdk.authenticateRequest(reqWithCookie(token))).rejects.toThrow(/revoked/i);
    expect(dbMocks.getSessionByToken).toHaveBeenCalledTimes(2);
  });

  it("different session cookies do not share cache entries", async () => {
    // different expiry → different JWT bytes → different cache key
    const otherToken = await sdk.createSessionToken("open-42", {
      name: "Cache Test User",
      expiresInMs: 12 * 60 * 60 * 1000,
    });
    await sdk.authenticateRequest(reqWithCookie(token));
    await sdk.authenticateRequest(reqWithCookie(otherToken));
    // both first-requests hit the DB (key = hash of the cookie, not the user)
    expect(dbMocks.getUserByOpenId).toHaveBeenCalledTimes(2);
  });
});
