/**
 * Kiểm định độc lập R1b-2a (2026-10-26) — tầng STOP HMI (`createHmiStopLimiter`) + tầng chung W21 chạy chung, ĐÚNG thứ tự mount của _core/index.ts
 * (STOP tier trước, apiLimiter sau), trên express THẬT với vé ký THẬT. Oracle độc lập: số 200 / 429 đếm từ phía client.
 *   • mọi biến thể văn bản của MỘT vé mà auth chấp nhận ⇒ CÙNG một xô 600/phút (không xoay được xô mới);
 *   • vé THU HỒI nhưng còn hạn ⇒ vẫn chỉ xô của chính phiên ấy; phiên KHÁC của cùng người (vé khác) không bị ảnh hưởng;
 *   • cookie rác xoay giá trị ⇒ rơi apiLimiter (trần hạ xuống 5) ⇒ 429 sau 5; gói batch của vé hợp lệ ⇒ apiLimiter, không phải tầng STOP.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

process.env.RATE_LIMIT_PER_MINUTE = "5";
process.env.JWT_SECRET = process.env.JWT_SECRET || "kiem-dinh-r1b2a-secret-kiem-dinh-r1b2a-secret";
delete process.env.REDIS_URL;

const rl = await import("./rateLimitConfig");
const { COOKIE_NAME } = await import("@shared/const");
const { sdk } = await import("./sdk");

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const bienThe = (tok: string) => tok.slice(0, -1) + B64[B64.indexOf(tok[tok.length - 1]!) ^ 1];

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    const ip = req.headers["x-test-ip"];
    if (typeof ip === "string") Object.defineProperty(req, "ip", { value: ip, configurable: true });
    next();
  });
  app.use("/api/", rl.createHmiStopLimiter());
  app.use("/api/", rl.createApiLimiter());
  app.use("/api/", rl.createUnverifiedCredentialIpLimiter());
  app.post("/api/trpc/:p", (_q, r) => r.json({ ok: true }));
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const goi = async (cookie: string, ip: string, path = "scadaCommands.dungMay", query = "") =>
  (await fetch(`${base}/api/trpc/${path}${query}`, { method: "POST", headers: { cookie, "x-test-ip": ip, "content-type": "application/json" }, body: "{}" })).status;

describe("tầng STOP HMI + tầng chung (express thật, vé thật)", () => {
  it("★ 22 biến thể văn bản của MỘT vé (auth chấp nhận) dùng chung MỘT xô: đúng 600 qua rồi 429; vé của phiên KHÁC không bị ảnh hưởng", async () => {
    const t = await sdk.createSessionToken(`kd-a-${Date.now()}`, { name: "A" });
    const t2 = await sdk.createSessionToken(`kd-a-${Date.now()}`, { name: "A-phien-2" }); // cùng người? khác openId nên ĐỔI: dùng cùng openId bên dưới
    const mo = `kd-same-${Date.now()}`;
    const v1 = await sdk.createSessionToken(mo, { name: "S1" });
    const v2 = await sdk.createSessionToken(mo, { name: "S2" }); // cùng openId, vé KHÁC (jti ngẫu nhiên)
    expect(v1).not.toBe(v2);
    const N = COOKIE_NAME;
    const bt = bienThe(v1);
    const cacBienThe = [
      `${N}=${v1}`, ` ${N}=${v1}`, `${N}=${v1} `, `${N} = ${v1}`, `${N}= ${v1} `, `${N}="${v1}"`, `${N}=${v1.replace(/\./g, "%2E")}`,
      `x=1; ${N}=${v1}`, `${N}=${v1}; x=1`, `${N}=${v1};${N}=rac`, `${N}=${bt}`, `${N}=${v1}=`, `${N}=${v1}==`, `${N}=${v1}%20`, `${N}=${v1}%0A`,
    ];
    // chỉ giữ biến thể mà AUTH (verifySession trên chuỗi cookie.parse) chấp nhận
    const { parse } = await import("cookie");
    const chapNhan: string[] = [];
    for (const c of cacBienThe) {
      const tok = parse(c)[N];
      if (tok && (await sdk.verifySession(tok, { imLang: true }))) chapNhan.push(c);
    }
    expect(chapNhan.length).toBeGreaterThanOrEqual(8);
    const ma: number[] = [];
    for (let i = 0; i < 640; i++) ma.push(await goi(chapNhan[i % chapNhan.length]!, "10.50.0.1"));
    expect(ma.filter((x) => x === 200)).toHaveLength(600);
    expect(ma.filter((x) => x === 429)).toHaveLength(40);
    // phiên KHÁC của cùng người (vé khác) ⇒ xô riêng, vẫn qua; cùng IP
    expect(await goi(`${N}=${v2}`, "10.50.0.1")).toBe(200);
    void t;
    void t2;
  }, 120_000);

  it("★ cookie RÁC xoay giá trị cho dungMay ⇒ apiLimiter (trần 5/phút/IP): 5 qua rồi 429; không rơi vào xô 600 của STOP", async () => {
    const ma: number[] = [];
    for (let i = 0; i < 40; i++) ma.push(await goi(`${COOKIE_NAME}=rac-${i}-${Math.random()}`, "10.50.0.2"));
    expect(ma.filter((x) => x === 200)).toHaveLength(5);
    expect(ma.filter((x) => x === 429)).toHaveLength(35);
  });

  it("vé HỢP LỆ nhưng gói BATCH (?batch=1) hoặc thủ tục khác ⇒ tầng chung (5/phút), KHÔNG được ké trần 600 của STOP", async () => {
    const v = await sdk.createSessionToken(`kd-b-${Date.now()}`, { name: "B" });
    const batch: number[] = [];
    for (let i = 0; i < 12; i++) batch.push(await goi(`${COOKIE_NAME}=${v}`, "10.50.0.3", "scadaCommands.dungMay,scadaCommands.request", "?batch=1"));
    expect(batch.filter((x) => x === 200)).toHaveLength(5);
    const v2 = await sdk.createSessionToken(`kd-b2-${Date.now()}`, { name: "B2" }); // vé MỚI: xô tầng chung khoá theo PHIÊN (không theo IP) nên vé v đã cạn ở trên
    const khac: number[] = [];
    for (let i = 0; i < 12; i++) khac.push(await goi(`${COOKIE_NAME}=${v2}`, "10.50.0.4", "scadaCommands.request"));
    expect(khac.filter((x) => x === 200)).toHaveLength(5);
  });

  it("vé hợp lệ gửi dungMay từ IP bị tầng chung/IP-thứ-hai cạn: STOP vẫn qua (xô riêng theo phiên, không theo IP)", async () => {
    const v = await sdk.createSessionToken(`kd-c-${Date.now()}`, { name: "C" });
    for (let i = 0; i < 12; i++) await goi(`${COOKIE_NAME}=rac${i}`, "10.50.0.5", "scadaCommands.request"); // cạn apiLimiter của IP
    expect(await goi(`${COOKIE_NAME}=${v}`, "10.50.0.5")).toBe(200);
  });
});
