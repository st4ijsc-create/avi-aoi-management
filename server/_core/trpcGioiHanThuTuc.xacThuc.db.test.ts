/**
 * ★★★ CHỨNG MINH cho ngoại lệ ở ba census xác thực (thuHoiPhienMoiBeMat / taiKhoanBiTatMoiBeMat / buocDoiMatKhauMoiBeMat):
 * `trpcGioiHanThuTuc.ts` chỉ kiểm CHỮ KÝ JWT của phiên để lấy `openId` làm KHOÁ ĐẾM — nó KHÔNG cấp quyền. Xác thực thật vẫn ở context tRPC (`createContext` →
 * `sdk.authenticateRequest`: sổ phiên + isActive + cổng đổi mật khẩu). Test chạy middleware THẬT + context THẬT + `protectedProcedure` THẬT trên DB `_test`:
 * phiên ĐÃ THU HỒI / tài khoản BỊ TẮT / người BỊ BUỘC ĐỔI MẬT KHẨU đi qua middleware giới hạn (không 429, vẫn được đếm) nhưng VẪN bị chặn ở tầng sau (thủ tục không chạy).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import postgres from "postgres";
import { MemoryStore, type Options, type Store } from "express-rate-limit";
import superjson from "superjson";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });
vi.hoisted(() => {
  process.env.JWT_SECRET ||= "trpc-gioi-han-thu-tuc-xac-thuc-test-secret-0123456789";
  process.env.VITE_APP_ID ||= "avi-aoi-management";
  process.env.AUTH_CACHE_TTL_S = "0"; // không cache xác thực: DB trả lời mỗi lượt
});

import { COOKIE_NAME } from "@shared/const";
import { sdk } from "./sdk";
import { createContext } from "./context";
import { router, protectedProcedure } from "./trpc";
import { createTrpcMiddleware } from "./trpcAdapter";
import { trpcGioiHanThuTucMiddleware } from "./trpcGioiHanThuTuc";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `GHTT-${Date.now()}`;

const chay = vi.fn();
const testRouter = router({
  user: router({ verify2FA: protectedProcedure.mutation(() => (chay("user.verify2FA"), { ok: true })) }),
});

describe.skipIf(!onTest)("middleware giới hạn theo thủ tục CHỈ lấy danh tính làm khoá đếm — xác thực thật vẫn ở tầng sau (_test)", () => {
  let sql: ReturnType<typeof postgres>;
  let server: http.Server;
  let base = "";
  const khoaDaDem: string[] = [];
  let reqCoUser: unknown = "chua-do";
  const nguoi = { id: 0, openId: `${TAG}-oid` };

  beforeAll(async () => {
    sql = postgres(DB_URL, { max: 2, onnotice: () => {} });
    nguoi.id = Number(
      (
        await sql`INSERT INTO users ("openId", name, role, "isActive", two_factor_enabled, "loginMethod") VALUES (${nguoi.openId}, 'ghtt xac thuc', 'engineer', true, false, 'local') RETURNING id`
      )[0]!.id,
    );
    const app = express();
    app.use(express.json());
    app.use(
      "/api/trpc",
      trpcGioiHanThuTucMiddleware({
        router: testRouter,
        taoStore: (_prefix, cuaSoMs) => {
          const s = new MemoryStore();
          s.init({ windowMs: cuaSoMs } as Options);
          const boc: Store = {
            init: (o) => s.init?.(o),
            increment: async (k) => (khoaDaDem.push(k), s.increment(k)),
            decrement: (k) => s.decrement(k),
            resetKey: (k) => s.resetKey(k),
          };
          return boc;
        },
      }),
    );
    // đo: sau middleware, yêu cầu KHÔNG mang danh tính nào do middleware gắn
    app.use("/api/trpc", (req, _res, next) => {
      reqCoUser = (req as unknown as { user?: unknown }).user ?? null;
      next();
    });
    app.use("/api/trpc", createTrpcMiddleware({ router: testRouter, createContext }));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/trpc`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await sql`DELETE FROM user_sessions WHERE "userId" = ${nguoi.id}`;
    await sql`DELETE FROM users WHERE id = ${nguoi.id}`;
    await sql.end({ timeout: 2 });
  });

  async function veMoi(): Promise<string> {
    const t = await sdk.signSession({ openId: nguoi.openId, appId: "ghtt-test", name: "ghtt" }, { expiresInMs: 3_600_000 });
    await sql`INSERT INTO user_sessions ("userId", "sessionToken", "expiresAt", "isActive") VALUES (${nguoi.id}, ${t}, now() + interval '1 hour', true)`;
    return t;
  }
  async function goi(token: string): Promise<{ status: number; ketQua: "chay" | "tu-choi"; ma: string | null }> {
    chay.mockClear();
    khoaDaDem.length = 0;
    const res = await fetch(`${base}/user.verify2FA?batch=1`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${COOKIE_NAME}=${token}`, "x-forwarded-for": "10.9.9.9" },
      body: JSON.stringify({ 0: superjson.serialize(undefined) }),
    });
    const j = (await res.json()) as Array<{ error?: { json?: { data?: { code?: string } } } }> | { error?: unknown };
    const ma = Array.isArray(j) ? (j[0]?.error?.json?.data?.code ?? null) : null;
    return { status: res.status, ketQua: chay.mock.calls.length > 0 ? "chay" : "tu-choi", ma };
  }

  it("§1 CẦU CHÌ (đối chứng DƯƠNG): phiên + tài khoản bình thường ⇒ qua middleware, thủ tục CHẠY; middleware đã lấy openId làm KHOÁ ĐẾM (u:<openId>) và KHÔNG gắn danh tính nào vào req", async () => {
    const r = await goi(await veMoi());
    expect(r).toMatchObject({ status: 200, ketQua: "chay" });
    expect(khoaDaDem.some((k) => k === `2fa:u:${nguoi.openId}`), "middleware không dùng openId làm khoá đếm").toBe(true);
    expect(khoaDaDem.some((k) => k.startsWith("2fa:ip:"))).toBe(true);
    expect(reqCoUser, "middleware gắn danh tính vào req ⇒ nó đã thành điểm xác thực").toBeNull();
  });

  it("★★★ §2 phiên ĐÃ THU HỒI ⇒ middleware KHÔNG chặn (chỉ đếm) nhưng tầng sau CHẶN: thủ tục không chạy", async () => {
    const t = await veMoi();
    await sql`UPDATE user_sessions SET "isActive" = false WHERE "sessionToken" = ${t}`;
    const r = await goi(t);
    expect(r.status).not.toBe(429);
    expect(khoaDaDem.length, "middleware phải để yêu cầu đi tiếp (và đếm) — nó không phán quyết").toBeGreaterThan(0);
    expect(r.ketQua, "phiên đã thu hồi mà thủ tục vẫn chạy ⇒ ngoại lệ census SAI").toBe("tu-choi");
    expect(r.ma).toBe("UNAUTHORIZED");
  });

  it("★★★ §3 tài khoản BỊ TẮT ⇒ vẫn chỉ đếm ở middleware; tầng sau CHẶN", async () => {
    const t = await veMoi();
    await sql`UPDATE users SET "isActive" = false WHERE id = ${nguoi.id}`;
    try {
      const r = await goi(t);
      expect(r.status).not.toBe(429);
      expect(khoaDaDem.length).toBeGreaterThan(0);
      expect(r.ketQua, "tài khoản tắt mà thủ tục vẫn chạy ⇒ ngoại lệ census SAI").toBe("tu-choi");
    } finally {
      await sql`UPDATE users SET "isActive" = true WHERE id = ${nguoi.id}`;
    }
  });

  it("★★★ §4 người BỊ BUỘC ĐỔI MẬT KHẨU ⇒ vẫn chỉ đếm ở middleware; tầng sau CHẶN thủ tục không thuộc vòng đời đổi mật khẩu", async () => {
    const t = await veMoi();
    await sql`UPDATE users SET "passwordInvalidBefore" = now(), "passwordChangedAt" = NULL WHERE id = ${nguoi.id}`;
    try {
      const r = await goi(t);
      expect(r.status).not.toBe(429);
      expect(khoaDaDem.length).toBeGreaterThan(0);
      expect(r.ketQua, "người bị buộc đổi mật khẩu mà thủ tục vẫn chạy ⇒ ngoại lệ census SAI").toBe("tu-choi");
    } finally {
      await sql`UPDATE users SET "passwordInvalidBefore" = NULL WHERE id = ${nguoi.id}`;
    }
  });

  it("§5 cookie rác / sai chữ ký ⇒ KHÔNG có khoá người dùng (chỉ khoá IP) và tầng sau từ chối", async () => {
    const r = await goi("khong-phai-jwt");
    expect(khoaDaDem.some((k) => k.startsWith("2fa:u:"))).toBe(false);
    expect(khoaDaDem.some((k) => k.startsWith("2fa:ip:"))).toBe(true);
    expect(r.ketQua).toBe("tu-choi");
  });
});
