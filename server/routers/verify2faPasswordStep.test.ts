/**
 * ★★★ Pha 7 Task 6 — **`verify-2fa` CHỈ cấp phiên khi bước mật khẩu của CHÍNH `userId` ấy đã qua.**
 * (Lưới này đóng nợ Pha 5/6/7 nên nó tự khai `Pha 5` để `vramPha5Gate.test.ts` kéo nó vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LỖ ĐÃ ĐO ĐƯỢC TRÊN HỆ THẬT (Bước 1), KHÔNG PHẢI GIẢ THUYẾT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *     POST /api/auth/login       {supervisor1, MẬT KHẨU SAI}  ⇒ 401
 *     POST /api/auth/verify-2fa  {userId: 49, token: OTP}     ⇒ 200 + Set-Cookie (1 NĂM)
 * ⇒ 2FA là yếu tố **DUY NHẤT**, không phải yếu tố thứ hai. Ca §1 dưới đây là **chính hai lượt ấy**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ ĐỐI CHỨNG DƯƠNG LÀ ĐIỀU KIỆN TỒN TẠI CỦA MỌI CA CÒN LẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một bản vá **chặn hết** thoả mọi ca "phải 401". Bài học `215/215` xanh suốt thời gian một tool
 * chết. Nên §2 chạy **luồng đúng đầy đủ** — `login` (mật khẩu ĐÚNG) ⇒ `verify-2fa` (OTP ĐÚNG) ⇒
 * **phải có cookie phiên** — và §6 canh chiều *"không bắt nhầm"* (gõ nhầm OTP vẫn thử lại được).
 *
 * ⚠ Lưới gọi **CHÍNH handler express thật** do `registerOAuthRoutes` đăng ký (bắt bằng một `app`
 *   giả), không gọi lại logic chép tay — nếu không thì nó chỉ chứng minh bản sao ấy đúng.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Express, Request, RequestHandler, Response } from "express";
import { COOKIE_NAME } from "@shared/const";

const dbm = vi.hoisted(() => ({
  getUserById: vi.fn(async (_id: number): Promise<any> => undefined),
  get2FAStatus: vi.fn(async (_id: number): Promise<any> => null),
  getUserByUsername: vi.fn(async (_u: string): Promise<any> => undefined),
  updateUserLoginAttempts: vi.fn(async (): Promise<void> => {}),
  verifyBackupCode: vi.fn(async (): Promise<boolean> => false),
  createAuditLog: vi.fn(async (): Promise<any> => ({})),
  upsertUser: vi.fn(async (): Promise<any> => ({})),
  createUserSession: vi.fn(async (): Promise<any> => ({})),
  // ★ Pha 7 Task 9 (9c) — hash mật khẩu nay đọc từ `user_secrets` qua CỬA DUY NHẤT. Thiếu ô này
  //   thì `verifyCredentials` gọi `undefined(...)` và **mọi** ca dưới đỏ vì một lý do sai.
  layBiMatNguoiDung: vi.fn(async (_id: number | null): Promise<any> => ({ passwordHash: null, twoFactorSecret: null })),
}));
vi.mock("../db", () => dbm);

const totp = vi.hoisted(() => ({
  verifyTotpOnce: vi.fn(async (_a: any) => ({ hopLe: false })),
  dauLuotGoiMoi: vi.fn(() => "luot-test"),
}));
vi.mock("../_core/totpOnce", () => totp);

/** `sdk` giả — chỉ để `establishSession` đúc được một chuỗi thẻ mà không cần ENV thật. */
vi.mock("../_core/sdk", () => ({
  sdk: {
    createSessionToken: vi.fn(async () => "PHIEN-DA-CAP"),
    exchangeCodeForToken: vi.fn(),
    getUserInfo: vi.fn(),
  },
}));

import { registerOAuthRoutes } from "../_core/oauth";
import { VE_COOKIE, VE_SO_LUOT, __resetSoVe, __soVeDangSong, __laoHoaVe } from "../_core/pendingTwoFactor";

const MAT_KHAU = "Correct-Horse-Battery-Staple-9";
let HASH_THAT: string;

const USER_49 = {
  id: 49,
  openId: "seed-supervisor1",
  name: "Chị Hương (Quản đốc)",
  email: null,
  role: "supervisor",
  isActive: true,
  loginAttempts: 0,
  lockedUntil: null,
} as any;
const USER_51 = { ...USER_49, id: 51, openId: "seed-engineer1", name: "Anh Minh", role: "engineer" } as any;

// ── bắt handler thật ────────────────────────────────────────────────────────────────────────
const tuyen = new Map<string, RequestHandler>();
const appGia = {
  get: (p: string, h: RequestHandler) => tuyen.set(`GET ${p}`, h),
  post: (p: string, h: RequestHandler) => tuyen.set(`POST ${p}`, h),
  use: () => {},
} as unknown as Express;
registerOAuthRoutes(appGia);

type KetQua = {
  status: number;
  body: any;
  cookies: { ten: string; gia: string }[];
  xoaCookie: string[];
};

function resGia(): { res: Response; kq: KetQua } {
  const kq: KetQua = { status: 200, body: undefined, cookies: [], xoaCookie: [] };
  const res = {
    status(code: number) {
      kq.status = code;
      return this;
    },
    json(b: any) {
      kq.body = b;
      return this;
    },
    cookie(ten: string, gia: string) {
      kq.cookies.push({ ten, gia });
      return this;
    },
    clearCookie(ten: string) {
      kq.xoaCookie.push(ten);
      return this;
    },
    redirect() {
      return this;
    },
  } as unknown as Response;
  return { res, kq };
}

function reqGia(body: any, cookieHeader?: string): Request {
  return {
    body,
    query: {},
    params: {},
    headers: { "user-agent": "vitest", ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    protocol: "http",
    hostname: "localhost",
    get: () => "localhost:3000",
  } as unknown as Request;
}

async function goi(tuyenTen: string, body: any, cookieHeader?: string): Promise<KetQua> {
  const h = tuyen.get(tuyenTen);
  if (!h) throw new Error(`không bắt được handler: ${tuyenTen}`);
  const { res, kq } = resGia();
  await (h as any)(reqGia(body, cookieHeader), res, () => {});
  return kq;
}

/** Rút mã vé khỏi các cookie mà handler `login` vừa đặt. */
function veTu(kq: KetQua): string | null {
  return kq.cookies.find((c) => c.ten === VE_COOKIE)?.gia ?? null;
}
const headerVe = (ma: string) => `${VE_COOKIE}=${ma}`;
const coPhien = (kq: KetQua) => kq.cookies.some((c) => c.ten === COOKIE_NAME);

/** Luồng đúng bước 1: mật khẩu ĐÚNG, 2FA bật ⇒ `requires2FA` + một vé. */
async function loginDung(user: any = USER_49): Promise<KetQua> {
  dbm.getUserByUsername.mockResolvedValue({ ...user, passwordHash: HASH_THAT });
  dbm.get2FAStatus.mockResolvedValue({ twoFactorEnabled: true, twoFactorSecret: "SECRET32" });
  return goi("POST /api/auth/login", { username: "supervisor1", password: MAT_KHAU });
}

beforeEach(async () => {
  vi.clearAllMocks();
  __resetSoVe();
  if (!HASH_THAT) {
    const bcrypt = await import("bcryptjs");
    HASH_THAT = await bcrypt.hash(MAT_KHAU, 10);
  }
  dbm.getUserById.mockImplementation(async (id: number) =>
    id === 49 ? USER_49 : id === 51 ? USER_51 : undefined,
  );
  dbm.get2FAStatus.mockResolvedValue({ twoFactorEnabled: true, twoFactorSecret: "SECRET32" });
  dbm.verifyBackupCode.mockResolvedValue(false);
  // ★ Pha 7 Task 9 — hash THẬT nay đến từ `user_secrets`, không từ hàng `users`.
  dbm.layBiMatNguoiDung.mockImplementation(async (id: number | null) =>
    id === null ? { passwordHash: null, twoFactorSecret: null } : { passwordHash: HASH_THAT, twoFactorSecret: "SECRET32" },
  );
  totp.verifyTotpOnce.mockResolvedValue({ hopLe: true });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ Task 6 §0 — cầu chì (không có nó thì mọi ca dưới là chân lý rỗng)", () => {
  it("★★★ bắt được CHÍNH hai handler thật của `registerOAuthRoutes`", () => {
    expect(tuyen.has("POST /api/auth/login"), "không bắt được `/api/auth/login`").toBe(true);
    expect(tuyen.has("POST /api/auth/verify-2fa"), "không bắt được `/api/auth/verify-2fa`").toBe(true);
  });

  it("★★★ `login` (mật khẩu ĐÚNG, 2FA bật) CẤP một vé — nếu không, mọi ca 401 dưới thoả rỗng", async () => {
    const kq = await loginDung();
    expect(kq.status).toBe(200);
    expect(kq.body?.requires2FA, "nhánh 2FA của `login` không chạy").toBe(true);
    expect(veTu(kq), `\`login\` không đặt cookie \`${VE_COOKIE}\``).toBeTruthy();
    expect(coPhien(kq), "`login` KHÔNG được cấp phiên ở bước 1").toBe(false);
    expect(__soVeDangSong()).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ Task 6 §1 — CA ĐỎ GỐC: nguyên văn hai lượt đã đo trên hệ thật", () => {
  it("★★★ mật khẩu SAI ⇒ 401, rồi `verify-2fa` ngay sau đó ⇒ **401, KHÔNG set-cookie**", async () => {
    dbm.getUserByUsername.mockResolvedValue({ ...USER_49, passwordHash: HASH_THAT });
    const a = await goi("POST /api/auth/login", { username: "supervisor1", password: "chac-chan-sai" });
    expect(a.status, "lượt A phải 401").toBe(401);
    expect(veTu(a), "mật khẩu SAI TUYỆT ĐỐI không được cấp vé").toBeNull();

    const b = await goi("POST /api/auth/verify-2fa", { userId: 49, token: "230145" });
    expect(b.status, "🔴 lỗ gốc: `verify-2fa` vẫn cấp phiên sau một lượt mật khẩu SAI").toBe(401);
    expect(coPhien(b), "🔴 KHÔNG được set cookie phiên").toBe(false);
    expect(
      totp.verifyTotpOnce,
      "cổng phải chặn TRƯỚC sổ OTP — nếu không, kẻ chưa qua mật khẩu ĐỐT được mã trong `totp_consumed`",
    ).not.toHaveBeenCalled();
    expect(dbm.getUserById, "cổng phải chặn TRƯỚC lượt đọc DB (404/400 là máy dò tài khoản)").not.toHaveBeenCalled();
  });

  it("★★★ KHÔNG có lượt `login` nào trước đó ⇒ 401", async () => {
    const b = await goi("POST /api/auth/verify-2fa", { userId: 49, token: "230145" });
    expect(b.status).toBe(401);
    expect(coPhien(b)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ Task 6 §2 — ĐỐI CHỨNG DƯƠNG: luồng ĐÚNG vẫn cấp phiên", () => {
  it("★★★ mật khẩu ĐÚNG → OTP ĐÚNG ⇒ **200 + cookie phiên** (+ vé bị xoá)", async () => {
    const a = await loginDung();
    const ma = veTu(a)!;
    const b = await goi("POST /api/auth/verify-2fa", { userId: 49, token: "230145" }, headerVe(ma));

    expect(b.status, `luồng đúng bị chặn — bản vá đang "chặn hết": ${JSON.stringify(b.body)}`).toBe(200);
    expect(b.body?.success).toBe(true);
    expect(b.body?.user?.id).toBe(49);
    expect(coPhien(b), "luồng đúng PHẢI được set cookie phiên").toBe(true);
    expect(b.xoaCookie, "vé phải được xoá khỏi trình duyệt sau khi tiêu").toContain(VE_COOKIE);
    expect(__soVeDangSong(), "vé phải rời sổ sau khi tiêu").toBe(0);
  });

  it("★★★ mật khẩu ĐÚNG → **mã dự phòng** ĐÚNG ⇒ 200 + cookie phiên (đường backup không bị vá chặn)", async () => {
    totp.verifyTotpOnce.mockResolvedValue({ hopLe: false });
    dbm.verifyBackupCode.mockResolvedValue(true);
    const a = await loginDung();
    const b = await goi("POST /api/auth/verify-2fa", { userId: 49, token: "BACKUP-01" }, headerVe(veTu(a)!));
    expect(b.status).toBe(200);
    expect(coPhien(b)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ Task 6 §3 — ĐỘT BIẾN: mỗi cửa một ca đỏ RIÊNG", () => {
  it("★★★ (a) THIẾU vé ⇒ 401, không cookie phiên", async () => {
    const b = await goi("POST /api/auth/verify-2fa", { userId: 49, token: "230145" });
    expect(b.status).toBe(401);
    expect(coPhien(b)).toBe(false);
  });

  it("★★★ (b) vé LẠ (không có trong sổ) ⇒ 401", async () => {
    const b = await goi("POST /api/auth/verify-2fa", { userId: 49, token: "230145" }, headerVe("a".repeat(64)));
    expect(b.status).toBe(401);
    expect(coPhien(b)).toBe(false);
  });

  it("★★★ (c) vé CỦA NGƯỜI KHÁC ⇒ 401 (vé của 49 KHÔNG mở được 51)", async () => {
    const a = await loginDung(USER_49);
    const b = await goi("POST /api/auth/verify-2fa", { userId: 51, token: "230145" }, headerVe(veTu(a)!));
    expect(b.status, "vé phải RÀNG vào đúng `userId` đã qua mật khẩu").toBe(401);
    expect(coPhien(b)).toBe(false);
  });

  it("★★★ (d) vé QUÁ HẠN ⇒ 401", async () => {
    const a = await loginDung();
    const ma = veTu(a)!;
    __laoHoaVe(ma, 10 * 60 * 1000); // đẩy lùi hạn 10 phút — vé hạn 5 phút
    const b = await goi("POST /api/auth/verify-2fa", { userId: 49, token: "230145" }, headerVe(ma));
    expect(b.status).toBe(401);
    expect(coPhien(b)).toBe(false);
  });

  it("★★★ (e) vé DÙNG LẠI ⇒ 401 ở lượt thứ hai", async () => {
    const a = await loginDung();
    const ma = veTu(a)!;
    const lan1 = await goi("POST /api/auth/verify-2fa", { userId: 49, token: "230145" }, headerVe(ma));
    expect(lan1.status, "lượt đầu phải qua").toBe(200);

    const lan2 = await goi("POST /api/auth/verify-2fa", { userId: 49, token: "230145" }, headerVe(ma));
    expect(lan2.status, "vé phải là MỘT-LẦN").toBe(401);
    expect(coPhien(lan2)).toBe(false);
  });

  it(`★★★ (f) ngân sách ${VE_SO_LUOT} lượt OTP sai ⇒ vé CHẾT, mã đúng sau đó cũng 401`, async () => {
    const a = await loginDung();
    const ma = veTu(a)!;
    totp.verifyTotpOnce.mockResolvedValue({ hopLe: false });
    for (let i = 0; i < VE_SO_LUOT; i++) {
      const x = await goi("POST /api/auth/verify-2fa", { userId: 49, token: "000000" }, headerVe(ma));
      expect(x.status, `lượt sai thứ ${i + 1} phải 401`).toBe(401);
    }
    totp.verifyTotpOnce.mockResolvedValue({ hopLe: true });
    const cuoi = await goi("POST /api/auth/verify-2fa", { userId: 49, token: "230145" }, headerVe(ma));
    expect(cuoi.status, "hết ngân sách ⇒ vé chết").toBe(401);
    expect(coPhien(cuoi)).toBe(false);
    expect(__soVeDangSong()).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ Task 6 §4 — KHÔNG BẮT NHẦM", () => {
  it(`★★★ gõ nhầm OTP ${VE_SO_LUOT - 1} lần rồi gõ ĐÚNG ⇒ **vẫn cấp phiên** (vé không tiêu khi OTP sai)`, async () => {
    const a = await loginDung();
    const ma = veTu(a)!;
    totp.verifyTotpOnce.mockResolvedValue({ hopLe: false });
    for (let i = 0; i < VE_SO_LUOT - 1; i++) {
      const x = await goi("POST /api/auth/verify-2fa", { userId: 49, token: "000000" }, headerVe(ma));
      expect(x.status).toBe(401);
    }
    totp.verifyTotpOnce.mockResolvedValue({ hopLe: true });
    const ok = await goi("POST /api/auth/verify-2fa", { userId: 49, token: "230145" }, headerVe(ma));
    expect(ok.status, "một lượt gõ nhầm KHÔNG được bắt người dùng nhập lại mật khẩu").toBe(200);
    expect(coPhien(ok)).toBe(true);
  });

  it("★★★ hai người đăng nhập song song: vé của mỗi người mở ĐÚNG tài khoản mình", async () => {
    const a49 = await loginDung(USER_49);
    const a51 = await loginDung(USER_51);
    const b51 = await goi("POST /api/auth/verify-2fa", { userId: 51, token: "111111" }, headerVe(veTu(a51)!));
    expect(b51.status).toBe(200);
    expect(b51.body?.user?.id).toBe(51);
    const b49 = await goi("POST /api/auth/verify-2fa", { userId: 49, token: "222222" }, headerVe(veTu(a49)!));
    expect(b49.status).toBe(200);
    expect(b49.body?.user?.id).toBe(49);
  });

  it("★★★ tài khoản KHÔNG bật 2FA: `login` cấp phiên thẳng, KHÔNG cấp vé (đường cũ không đổi)", async () => {
    dbm.getUserByUsername.mockResolvedValue({ ...USER_49, passwordHash: HASH_THAT });
    dbm.get2FAStatus.mockResolvedValue({ twoFactorEnabled: false, twoFactorSecret: null });
    const kq = await goi("POST /api/auth/login", { username: "supervisor1", password: MAT_KHAU });
    expect(kq.status).toBe(200);
    expect(kq.body?.success).toBe(true);
    expect(coPhien(kq), "không 2FA ⇒ `login` phải cấp phiên ngay như trước").toBe(true);
    expect(veTu(kq), "không 2FA ⇒ không có gì để gác ⇒ không cấp vé").toBeNull();
  });
});
