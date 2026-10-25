/**
 * ★★★ W21b — trần IP thứ hai, HẸP: chỉ credential chưa verify được (Bearer không-JWT, X-API-Key). Phiên verify + mặt phẳng máy không bị đếm.
 * Mặc định 3000/phút/IP (không đổi env ⇒ đo đúng con số sản phẩm). Gắn ĐÚNG thứ tự như _core/index.ts: limiter chung rồi trần IP.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

process.env.JWT_SECRET = process.env.JWT_SECRET || "w21b-test-secret-w21b-test-secret-w21";
delete process.env.REDIS_URL;
delete process.env.RATE_LIMIT_UNVERIFIED_IP_PER_MINUTE;
delete process.env.RATE_LIMIT_PER_MINUTE;

const rl = await import("./rateLimitConfig");
const { COOKIE_NAME } = await import("@shared/const");
const { sdk } = await import("./sdk");

let server: Server;
let base = "";
const canhBao = vi.spyOn(console, "warn").mockImplementation(() => undefined);

beforeAll(async () => {
  const app = express();
  // IP nguồn giả lập qua header kiểm thử (đúng chỗ `req.ip` được đọc)
  app.use((req, _res, next) => {
    const ip = req.headers["x-test-ip"];
    if (typeof ip === "string") Object.defineProperty(req, "ip", { value: ip, configurable: true });
    next();
  });
  app.use("/api/", rl.createApiLimiter());
  app.use("/api/", rl.createUnverifiedCredentialIpLimiter());
  app.get("/api/*", (_q, r) => r.json({ ok: true }));
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const goi = async (headers: Record<string, string>, path = "/api/trpc/a.b") => (await fetch(`${base}${path}`, { headers })).status;
const dongThoi = async (n: number, mk: (i: number) => Record<string, string>, ip: string) => {
  const ma: number[] = [];
  for (let b = 0; b < n; b += 100) {
    ma.push(...(await Promise.all(Array.from({ length: Math.min(100, n - b) }, (_, k) => goi({ ...mk(b + k), "x-test-ip": ip })))));
  }
  return ma;
};

describe("W21b — trần IP cho credential chưa verify", () => {
  it("vị từ mangCredentialChuaVerify: X-API-Key / Bearer không-JWT = có; Bearer JWT, cookie, mặt phẳng máy, không credential = không", () => {
    const r = (headers: Record<string, string>, url = "/api/trpc/x.y") => ({ headers, originalUrl: url, url, query: {}, method: "GET", ip: "1.1.1.1" }) as never;
    expect(rl.mangCredentialChuaVerify(r({ "x-api-key": "k" }))).toBe(true);
    expect(rl.mangCredentialChuaVerify(r({ authorization: "Bearer avgw_x" }))).toBe(true);
    expect(rl.mangCredentialChuaVerify(r({ authorization: "Bearer a.b.c" }))).toBe(false);
    expect(rl.mangCredentialChuaVerify(r({ cookie: `${COOKIE_NAME}=zzz` }))).toBe(false);
    expect(rl.mangCredentialChuaVerify(r({}))).toBe(false);
    expect(rl.mangCredentialChuaVerify(r({ "x-api-key": "k" }, "/api/machine/heartbeat"))).toBe(false);
  });

  it("★ 4000 X-API-Key rác khác nhau, cùng IP ⇒ đúng 3000 qua, 1000 bị 429; ghi log cảnh báo MỘT lần cho IP đó", async () => {
    const ma = await dongThoi(4000, (i) => ({ "x-api-key": `rac-${i}-${Math.random().toString(36).slice(2)}` }), "10.7.0.1");
    expect(ma.filter((x) => x === 200)).toHaveLength(3000);
    expect(ma.filter((x) => x === 429)).toHaveLength(1000);
    const dong = canhBao.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("10.7.0.1"));
    expect(dong).toHaveLength(1);
    expect(dong[0]).toContain("RATE_LIMIT_UNVERIFIED_IP_PER_MINUTE");
  });

  it("★ cùng lúc IP đó đã cạn: khoá API THẬT từ IP KHÁC không bị kéo theo; Bearer không-JWT từ IP khác cũng qua", async () => {
    expect(await goi({ "x-api-key": "khoa-that-1", "x-test-ip": "10.7.0.2" })).toBe(200);
    expect(await goi({ authorization: "Bearer avgw_that", "x-test-ip": "10.7.0.3" })).toBe(200);
    expect(await goi({ "x-api-key": "khoa-that-2", "x-test-ip": "10.7.0.1" })).toBe(429); // IP đã cạn vẫn bị chặn
  });

  it("★ IP đã cạn: PHIÊN verify (cookie) và Bearer JWT hợp lệ KHÔNG bị trần này; mặt phẳng máy cũng không", async () => {
    const t = await sdk.createSessionToken(`w21b-${Date.now()}`, { name: "S" });
    expect(await goi({ cookie: `${COOKIE_NAME}=${t}`, "x-test-ip": "10.7.0.1" })).toBe(200);
    expect(await goi({ authorization: `Bearer ${t}`, "x-test-ip": "10.7.0.1" })).toBe(200);
    expect(await goi({ "x-api-key": "may-1", "x-test-ip": "10.7.0.1" }, "/api/machine/heartbeat")).toBe(200);
  });
});
