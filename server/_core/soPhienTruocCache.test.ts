/**
 * ★★★★ Pha 9 nhóm A · **A2 — BỘ NHỚ ĐỆM KHÔNG ĐƯỢC KÉO DÀI TUỔI THỌ CỦA MỘT PHIÊN ĐÃ CHẾT.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 *   ***∀ lượt xác thực: trạng thái hàng `user_sessions` được hỏi TRƯỚC khi bộ nhớ đệm được phép
 *   trả lời — bất kể lượt thu hồi đi qua đường nào, kể cả đường KHÔNG dọn cache.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐO ĐƯỢC TRÊN DB THẬT TRƯỚC BẢN VÁ — KHÔNG PHẢI SUY LUẬN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nạp cache bằng một lượt xác thực hợp lệ, rồi thu hồi phiên **ngoài đường sản phẩm**:
 *
 *     XOÁ hàng `user_sessions` bằng SQL thẳng  ⇒ lượt kế tiếp **ĐI QUA**   ← LỖ
 *     lật `isActive = false` bằng SQL thẳng    ⇒ lượt kế tiếp **ĐI QUA**   ← LỖ
 *
 * HIỆU CHUẨN bằng sự kiện có đáp số biết trước (thiết bị đo đã nói dối 20 lần/4 ngày):
 *
 *     cùng thí nghiệm với `AUTH_CACHE_TTL_S=0`  ⇒ **CHẶN** (`SESSION_NOT_IN_LEDGER`)
 *
 * ⇒ Cơ chế cưỡng chế CÓ THẬT và đang sống; thứ cho qua đúng là **bộ nhớ đệm**, không phải một
 *   thước hỏng. Đó là toàn bộ lý do file này tồn tại tách khỏi `thuHoiPhienMoiBeMat.test.ts`
 *   (file ấy canh *"vị từ có từ chối không"*; file này canh *"vị từ có ĐƯỢC HỎI không"*).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO CÓ §5 (HÌNH DẠNG) BÊN CẠNH §2–§4 (HÀNH VI)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * §2–§4 đỏ khi bản vá bị gỡ. Nhưng có một cách làm chúng **xanh mà vẫn sai**: chép thêm một lượt
 * gọi `chanNeuPhienDaThuHoi` vào nhánh trúng cache và **giữ nguyên** lượt gọi cũ ở dưới — hai bản
 * sao dưới một bất biến, đúng lớp lỗi đã đẻ ba Critical trong chuỗi pha này (và đúng thứ Pha 7 đo
 * được ở chính phương thức này: *"1/6 lượt rò, 5/6 lượt sạch"*). §5 ghim **MỘT** call site, và
 * ghim rằng nó đứng **TRƯỚC** lượt đọc cache.
 *
 * ⚠ VÙNG MÙ ĐƯỢC KHAI: file này nói về `sdk.xacThucTho`. Nhánh `Authorization: Bearer` của
 *   `validateExternalAuth` gọi `chanNeuPhienDaThuHoi` **thẳng** (không qua cache) nên nó không có
 *   cửa sổ này — `thuHoiPhienMoiBeMat.test.ts` canh nhánh ấy.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

/**
 * ⚠⚠ **PHẢI ĐẶT TRƯỚC MỌI `import`** — `server/_core/env.ts` đọc `process.env` đúng một lần lúc nạp
 * module. Thiếu hai biến này thì `signSession` ném và `verifySession` trả `null` ⇒ lưới ĐỎ VÌ HẠ
 * TẦNG, một màu đỏ **nói dối** về bất biến đang canh.
 */
vi.hoisted(() => {
  process.env.JWT_SECRET ||= "pha9-a2-so-truoc-cache-secret";
  process.env.VITE_APP_ID ||= "avi-aoi-management";
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { eq } from "drizzle-orm";
import * as db from "../db";
import { userSessions } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { COOKIE_NAME } from "../../shared/const";
import { clearAuthSessionCache, getCachedAuthUser } from "../services/authSessionCache";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/_core
const GOC = join(TEST_DIR, "..", "..");

/** Dấu riêng của file này — mọi hàng nó tạo mang tiền tố này, lượt dọn khoá đúng vào đó. */
const DAU = "pha9-a2-so-truoc-cache";
const MOT_GIO_MS = 60 * 60 * 1000;

let uid = 0;
let openId = "";

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

/** Thông điệp lỗi của lượt gọi, hoặc `null` nếu KHÔNG ném. */
async function loiCua(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (err) {
    return String((err as Error)?.message ?? err);
  }
}

/** Nạp cache bằng một lượt xác thực hợp lệ, và KHẲNG ĐỊNH là nó đã nóng thật. */
async function napCache(token: string): Promise<void> {
  const u = await sdk.authenticateRequest(reqVoiCookie(token));
  expect(u.id, "lượt nạp cache đã hỏng ⇒ mọi ô dưới đo một tiền đề sai").toBe(uid);
  expect(
    await getCachedAuthUser(token),
    "cache KHÔNG nóng sau một lượt xác thực hợp lệ ⇒ ô dưới là chân lý rỗng (AUTH_CACHE_TTL_S?)",
  ).not.toBeNull();
}

beforeAll(async () => {
  // Cache phải BẬT: toàn bộ file nói về nó. TTL=0 ⇒ mọi ô dưới thành chân lý rỗng.
  process.env.AUTH_CACHE_TTL_S = "60";
  const r = await db.createLocalUser({
    username: `${DAU}-${Date.now()}`,
    passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
    name: "Pha 9 A2 — sổ trước cache",
    role: "user",
  });
  uid = r.id;
  openId = (await db.getUserById(uid))!.openId;
});

afterAll(async () => {
  const d = await db.getDb();
  // Dọn ĐÚNG hàng của chính file này (kỷ luật Pha 8 Task 3).
  if (d && uid) await d.delete(userSessions).where(eq(userSessions.userId, uid));
  if (uid) await db.deleteUser(uid);
});

beforeEach(async () => {
  process.env.AUTH_CACHE_TTL_S = "60";
  await clearAuthSessionCache();
});

describe("★★★ Pha 9 A2 §1 — CẦU CHÌ: tiền đề của cả file", () => {
  it("★★★ tài khoản + phiên dựng được, và cache THẬT SỰ đang bật", async () => {
    expect(uid, "không dựng được tài khoản ⇒ mọi ô dưới rỗng nghĩa").toBeGreaterThan(0);
    const token = await dungPhien("cau-chi");
    await napCache(token);
  });
});

describe("★★★ Pha 9 A2 §2 — HÀNH VI: hàng sổ bị XOÁ ngoài đường sản phẩm", () => {
  it("★★★ xoá hàng `user_sessions` bằng SQL thẳng ⇒ lượt kế tiếp BỊ CHẶN dù cache còn nóng", async () => {
    const token = await dungPhien("xoa-thang");
    await napCache(token);

    const d = await db.getDb();
    await d!.delete(userSessions).where(eq(userSessions.sessionToken, token));
    // Cầu chì: lượt xoá phải THẬT SỰ xảy ra, nếu không ô này chứng minh điều ngược lại.
    const conLai = await d!.select().from(userSessions).where(eq(userSessions.sessionToken, token));
    expect(conLai.length, "hàng sổ vẫn còn ⇒ thí nghiệm chưa xảy ra").toBe(0);
    expect(
      await getCachedAuthUser(token),
      "cache đã nguội trước khi đo ⇒ ô này không còn đo cửa sổ TTL nữa",
    ).not.toBeNull();

    const loi = await loiCua(() => sdk.authenticateRequest(reqVoiCookie(token)));
    expect(
      loi,
      "phiên đã bị xoá khỏi sổ VẪN đi qua ⇒ bộ nhớ đệm đang kéo dài tuổi thọ của nó tới trọn một TTL",
    ).not.toBeNull();
    expect(loi).toMatch(/SESSION_NOT_IN_LEDGER/);
  });
});

describe("★★★ Pha 9 A2 §3 — HÀNH VI: hàng sổ bị LẬT CỜ ngoài đường sản phẩm", () => {
  it("★★★ lật `isActive=false` bằng SQL thẳng ⇒ lượt kế tiếp BỊ CHẶN dù cache còn nóng", async () => {
    const token = await dungPhien("lat-co");
    await napCache(token);

    const d = await db.getDb();
    await d!
      .update(userSessions)
      .set({ isActive: false })
      .where(eq(userSessions.sessionToken, token));
    const [hang] = await d!
      .select()
      .from(userSessions)
      .where(eq(userSessions.sessionToken, token));
    expect(hang!.isActive, "cầu chì: cờ phải THẬT SỰ tắt trước khi đo").toBe(false);

    const loi = await loiCua(() => sdk.authenticateRequest(reqVoiCookie(token)));
    expect(loi, "phiên đã thu hồi VẪN đi qua vì cache trả lời trước khi sổ được hỏi").not.toBeNull();
    expect(loi).toMatch(/revoked/i);
  });
});

describe("★★★ Pha 9 A2 §4 — ĐỐI CHỨNG DƯƠNG: KHÔNG được khoá ai ra ngoài", () => {
  /**
   * ⚠⚠ Không có ô này, §2/§3 xanh được bằng một bản vá *"chặn tất"* — đúng lớp lỗi đã ship một lần
   *    ra **nhà tù thật 4/4 tài khoản** ở Pha 7. Ô này là nửa còn lại của phép đo.
   */
  it("★★★ phiên HỢP LỆ + cache nóng ⇒ vẫn đi qua, nhiều lượt liên tiếp", async () => {
    const token = await dungPhien("doi-chung-duong");
    await napCache(token);
    for (let i = 0; i < 5; i++) {
      const u = await sdk.authenticateRequest(reqVoiCookie(token));
      expect(u.id, `lượt ${i + 1} bị chặn ⇒ bản vá đã dựng một nhà tù`).toBe(uid);
    }
  });

  it("★★ thu hồi MỘT phiên không được đá văng phiên KHÁC của cùng người", async () => {
    const a = await dungPhien("con-song-a");
    const b = await dungPhien("con-song-b");
    await napCache(a);
    await napCache(b);

    const d = await db.getDb();
    await d!.update(userSessions).set({ isActive: false }).where(eq(userSessions.sessionToken, a));

    expect(await loiCua(() => sdk.authenticateRequest(reqVoiCookie(a)))).not.toBeNull();
    expect(
      await loiCua(() => sdk.authenticateRequest(reqVoiCookie(b))),
      "thu hồi một phiên đã khoá luôn phiên khác ⇒ phép tra sổ đang khoá sai khoá",
    ).toBeNull();
  });
});

describe("★★★ Pha 9 A2 §5 — HÌNH DẠNG: MỘT call site, và nó đứng TRƯỚC lượt đọc cache", () => {
  /**
   * ⚠⚠⚠ **BỘ SUY NÀY PHẢI LÀ AST, KHÔNG PHẢI `indexOf` — ĐO ĐƯỢC, KHÔNG PHẢI PHÒNG XA.**
   * Bản đầu của §5 dùng phép tìm chuỗi. Lượt đột biến của chính A2 (bình luận-hoá lượt gọi bằng
   * `// …`) làm §2/§3/§4/§6 **ĐỎ** đúng như thiết kế, nhưng §5 **VẪN XANH**: chuỗi cần tìm còn
   * nguyên trong **một bình luận**. Đó đúng lớp *"thước hỏng cho ra đúng câu mà mã lành sẽ cho ra"*.
   * ⇒ Nay đếm **lượt gọi THẬT** trên cây cú pháp; mã trong bình luận không phải một `CallExpression`.
   */
  const NGUON = readFileSync(join(GOC, "server/_core/sdk.ts"), "utf8");

  /** Vị trí mọi lượt gọi `<ten>(…)` THẬT (AST) trong một nguồn. */
  function viTriGoi(ma: string, ten: string): number[] {
    const sf = ts.createSourceFile("x.ts", ma, ts.ScriptTarget.Latest, true);
    const ra: number[] = [];
    const tenCua = (n: ts.CallExpression): string => {
      const e = n.expression;
      if (ts.isIdentifier(e)) return e.text;
      if (ts.isPropertyAccessExpression(e)) return e.name.text;
      return "";
    };
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && tenCua(n) === ten) ra.push(n.getStart(sf));
      ts.forEachChild(n, di);
    };
    di(sf);
    return ra;
  }

  it("★★★ `chanNeuPhienDaThuHoi` được gọi ĐÚNG MỘT lần trong `sdk.ts` (AST, không đếm bình luận)", () => {
    expect(
      viTriGoi(NGUON, "chanNeuPhienDaThuHoi").length,
      "hai bản sao của cùng một lượt tra sổ ⇒ bản yếu hơn quyết định lưới nào đỏ (đã đẻ ba Critical);\n" +
        "0 lượt gọi ⇒ bản vá A2 đã bị gỡ hoàn toàn",
    ).toBe(1);
  });

  it("★★★ lượt tra sổ đứng TRƯỚC `getCachedAuthUser`", () => {
    const so = viTriGoi(NGUON, "chanNeuPhienDaThuHoi");
    const cache = viTriGoi(NGUON, "getCachedAuthUser");
    expect(so.length, "không tìm thấy lượt gọi tra sổ nào — bản vá A2 đã bị gỡ").toBe(1);
    expect(cache.length, "không tìm thấy lượt đọc cache — hình dạng đã đổi, hãy đọc lại lưới này").toBe(1);
    expect(so[0], "lượt tra sổ nằm SAU lượt đọc cache ⇒ cửa sổ 45 giây đã mở lại").toBeLessThan(cache[0]!);
  });

  it("★★ CẦU CHÌ cho chính §5 — thước phân biệt được ba tình huống có ĐÁP SỐ BIẾT TRƯỚC", () => {
    /**
     * ⚠ Không có ô này, hai ô trên có thể đang xanh vì bộ suy trả rỗng cho mọi thứ, hoặc vì một
     *   phép so sánh luôn đúng. Hiệu chuẩn bằng **đáp số biết trước**, gồm cả ca đã lừa được bản đầu.
     */
    const dung = `async function f(c){ await chanNeuPhienDaThuHoi(c); const u = await getCachedAuthUser(c); return u; }`;
    const sai = `async function f(c){ const u = await getCachedAuthUser(c); await chanNeuPhienDaThuHoi(c); return u; }`;
    const binhLuan = `async function f(c){ // await chanNeuPhienDaThuHoi(c);\n const u = await getCachedAuthUser(c); return u; }`;

    expect(viTriGoi(dung, "chanNeuPhienDaThuHoi").length, "thước mù với một lượt gọi THẬT").toBe(1);
    expect(
      viTriGoi(dung, "chanNeuPhienDaThuHoi")[0],
      "thước khai SAI trên mã có thứ tự ĐÚNG",
    ).toBeLessThan(viTriGoi(dung, "getCachedAuthUser")[0]!);
    expect(
      viTriGoi(sai, "chanNeuPhienDaThuHoi")[0],
      "thước khai ĐÚNG trên mã có thứ tự SAI ⇒ nó không đo thứ tự gì cả",
    ).toBeGreaterThan(viTriGoi(sai, "getCachedAuthUser")[0]!);
    expect(
      viTriGoi(binhLuan, "chanNeuPhienDaThuHoi").length,
      "★ CA ĐÃ LỪA ĐƯỢC BẢN ĐẦU: một lượt gọi bị BÌNH LUẬN-HOÁ vẫn được đếm ⇒ thước đang đọc chữ, không đọc mã",
    ).toBe(0);
  });
});

describe("★★★ Pha 9 A2 §6 — ĐỐI CHỨNG ÂM: cơ chế cưỡng chế KHÔNG phụ thuộc cache", () => {
  it("★★ với `AUTH_CACHE_TTL_S=0` phiên bị xoá cũng bị chặn (đáp số biết trước)", async () => {
    const token = await dungPhien("ttl-0");
    await sdk.authenticateRequest(reqVoiCookie(token)); // hợp lệ
    process.env.AUTH_CACHE_TTL_S = "0";
    try {
      const d = await db.getDb();
      await d!.delete(userSessions).where(eq(userSessions.sessionToken, token));
      const loi = await loiCua(() => sdk.authenticateRequest(reqVoiCookie(token)));
      expect(
        loi,
        "ngay cả khi TẮT cache mà vẫn cho qua ⇒ hỏng ở `chanNeuPhienDaThuHoi`, không phải ở A2",
      ).not.toBeNull();
      expect(loi).toMatch(/SESSION_NOT_IN_LEDGER/);
    } finally {
      process.env.AUTH_CACHE_TTL_S = "60";
    }
  });
});
