/**
 * ★★★ W21 — khoá limiter /api CHUNG chỉ theo PHIÊN khi phiên qua phép kiểm chữ ký; còn lại theo IP.
 * Lỗ cũ: băm GIÁ TRỊ cookie / Bearer chưa kiểm ⇒ xoay giá trị rác mỗi yêu cầu = xô 300/phút MỚI mỗi lần.
 * Oracle độc lập: vé thật ký bằng `sdk.createSessionToken`; biến thể chữ ký dựng bằng tay (đổi bit không dùng của ký tự cuối).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

process.env.RATE_LIMIT_PER_MINUTE = "5";
process.env.JWT_SECRET = process.env.JWT_SECRET || "w21-test-secret-w21-test-secret-w21";
delete process.env.REDIS_URL;

const rl = await import("./rateLimitConfig");
const { parse: phanTichCookie } = await import("cookie");
const { COOKIE_NAME } = await import("@shared/const");
const { sdk } = await import("./sdk");

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const req = (headers: Record<string, string>, ip = "10.1.1.1", url = "/api/trpc/x.y") =>
  ({ headers, ip, originalUrl: url, url, query: {}, method: "GET" }) as never;
const rnd = () => `rac-${Math.random().toString(36).slice(2)}-${Date.now()}`;
/** Biến thể chữ ký: đổi bit thấp nhất của ký tự cuối (HS256 = 32 byte ⇒ 43 ký tự, 2 bit cuối không dùng) — cùng chữ ký, khác chuỗi. */
function bienThe(tok: string): string {
  const c = tok[tok.length - 1]!;
  const i = B64.indexOf(c);
  return tok.slice(0, -1) + B64[i ^ 1];
}

let ve: string;
let ve2: string;
beforeAll(async () => {
  ve = await sdk.createSessionToken(`w21-a-${Date.now()}`, { name: "A" });
  ve2 = await sdk.createSessionToken(`w21-b-${Date.now()}`, { name: "B" });
});

describe("W21 — khoá phiên chỉ khi verify được", () => {
  it("★ 50 cookie RÁC khác nhau từ cùng IP ⇒ MỘT xô theo IP (không xô mới mỗi yêu cầu)", async () => {
    const khoa = new Set<string>();
    for (let i = 0; i < 50; i++) khoa.add(await rl.apiKeyGeneratorXacThuc(req({ cookie: `${COOKIE_NAME}=${rnd()}` })));
    expect(khoa.size).toBe(1);
    expect([...khoa][0]).toBe(rl.apiKeyGenerator(req({}))); // = khoá IP trần
  });
  it("★ 50 Bearer có HÌNH JWT nhưng chữ ký rác ⇒ MỘT xô theo IP; IP khác ⇒ xô khác", async () => {
    const khoa = new Set<string>();
    for (let i = 0; i < 50; i++) khoa.add(await rl.apiKeyGeneratorXacThuc(req({ authorization: `Bearer aaa.bbb.${rnd()}` })));
    expect(khoa.size).toBe(1);
    expect(await rl.apiKeyGeneratorXacThuc(req({ authorization: `Bearer aaa.bbb.${rnd()}` }, "10.2.2.2"))).not.toBe([...khoa][0]);
  });
  it("vé HỢP LỆ (cookie hoặc Bearer) ⇒ xô theo PHIÊN, ổn định, khác nhau giữa hai người, không phụ thuộc IP", async () => {
    const a1 = await rl.apiKeyGeneratorXacThuc(req({ cookie: `${COOKIE_NAME}=${ve}` }));
    const a2 = await rl.apiKeyGeneratorXacThuc(req({ cookie: `${COOKIE_NAME}=${ve}` }, "10.3.3.3"));
    const b = await rl.apiKeyGeneratorXacThuc(req({ cookie: `${COOKIE_NAME}=${ve2}` }));
    expect(a1).toMatch(/^sess:/);
    expect(a2).toBe(a1);
    expect(b).not.toBe(a1);
    expect(await rl.apiKeyGeneratorXacThuc(req({ authorization: `Bearer ${ve}` }))).toMatch(/^bearer:/);
  });
  it("★ biến thể chữ ký của CÙNG một vé hợp lệ ⇒ CÙNG xô (băm cả token sẽ ra xô khác)", async () => {
    const bt = bienThe(ve);
    expect(bt).not.toBe(ve);
    expect(await sdk.verifySession(bt), "jose phải chấp nhận biến thể chữ ký (nếu đổi phiên bản jose làm ca này vô nghĩa ⇒ đỏ để xét lại)").not.toBeNull();
    const goc = await rl.apiKeyGeneratorXacThuc(req({ cookie: `${COOKIE_NAME}=${ve}` }));
    expect(await rl.apiKeyGeneratorXacThuc(req({ cookie: `${COOKIE_NAME}=${bt}` }))).toBe(goc);
    expect(await rl.apiKeyGeneratorXacThuc(req({ authorization: `Bearer ${bt}` }))).toBe(await rl.apiKeyGeneratorXacThuc(req({ authorization: `Bearer ${ve}` })));
  });
  it("vé đúng hình nhưng đổi payload (chữ ký không còn khớp) ⇒ IP, KHÔNG mượn xô của vé thật", async () => {
    const [h, , s] = ve.split(".");
    const gia = `${h}.${Buffer.from(JSON.stringify({ openId: "ke-la", appId: "x", name: "x" })).toString("base64url")}.${s}`;
    expect(await rl.apiKeyGeneratorXacThuc(req({ cookie: `${COOKIE_NAME}=${gia}` }))).toBe(rl.apiKeyGenerator(req({})));
  });
  it("khoá API / X-API-Key / mặt phẳng máy KHÔNG đổi (vẫn theo apiKeyGenerator)", async () => {
    for (const r of [req({ authorization: "Bearer avgw_abc123" }), req({ "x-api-key": "K1" }), req({ cookie: `${COOKIE_NAME}=${rnd()}` }, "10.1.1.1", "/api/machine/heartbeat")]) {
      expect(await rl.apiKeyGeneratorXacThuc(r)).toBe(rl.apiKeyGenerator(r));
    }
  });
  it("limiter CHỈ chọn xô: không gắn danh tính vào req (không user/userId/openId/externalUser), trả đúng một chuỗi khoá không chứa openId", async () => {
    const r = req({ cookie: `${COOKIE_NAME}=${ve}` }) as unknown as Record<string, unknown>;
    const truoc = Object.keys(r).sort();
    const khoa = await rl.apiKeyGeneratorXacThuc(r as never);
    const them = Object.keys(r).filter((k) => !truoc.includes(k)); // vd bộ nhớ đệm parseurl của Express — không phải danh tính
    expect(them.filter((k) => /user|open|principal|machine|session|phien/i.test(k))).toEqual([]);
    for (const k of ["user", "userId", "externalUser", "apiPrincipal", "machine"]) expect(r[k]).toBeUndefined();
    expect(typeof khoa).toBe("string");
    expect(khoa).not.toContain("w21-a-"); // openId của vé không rò vào khoá
  });
  it("phép kiểm ném lỗi ⇒ rơi về IP (không bao giờ ném ra limiter)", async () => {
    const k = await rl.apiKeyGeneratorXacThuc(req({ cookie: `${COOKIE_NAME}=a.b.c` }), async () => {
      throw new Error("boom");
    });
    expect(k).toBe(rl.apiKeyGenerator(req({})));
  });
  it("phanDaKyJwt: chỉ chấp nhận hình a.b.c; trả header.payload", () => {
    expect(rl.phanDaKyJwt("a.b.c")).toBe("a.b");
    expect(rl.phanDaKyJwt("a.b")).toBeNull();
    expect(rl.phanDaKyJwt("a..c")).toBeNull();
    expect(rl.phanDaKyJwt("avgw_x")).toBeNull();
  });
});

describe("W21 — họ biến thể văn bản của MỘT vé (oracle: auth chấp nhận ⇔ cùng xô phiên; không chấp nhận ⇔ xô IP)", () => {
  it("★ cookie có khoảng trắng / nháy / %-mã / tên lặp / padding-biến thể chữ ký ⇒ mỗi biến thể hoặc CÙNG xô phiên với vé gốc (auth chấp nhận) hoặc xô IP (auth từ chối) — không bao giờ xô riêng", async () => {
    const t = ve;
    const bt = bienThe(t);
    const [h, p, sg] = t.split(".");
    const ma = (x: string) => x.replace(/\./g, "%2E");
    const cookieVariants: string[] = [
      `${COOKIE_NAME}=${t}`,
      ` ${COOKIE_NAME}=${t}`,
      `${COOKIE_NAME}=${t} `,
      `${COOKIE_NAME} = ${t}`,
      `${COOKIE_NAME}= ${t} `,
      `${COOKIE_NAME}="${t}"`,
      `${COOKIE_NAME}=${ma(t)}`,
      `other=1; ${COOKIE_NAME}=${t}`,
      `${COOKIE_NAME}=${t}; other=1`,
      `${COOKIE_NAME}=${t};${COOKIE_NAME}=rac-${Math.random()}`, // tên lặp: lần ĐẦU thắng (đúng vé)
      `${COOKIE_NAME}=rac-${Math.random()}; ${COOKIE_NAME}=${t}`, // tên lặp: lần ĐẦU là rác ⇒ auth từ chối
      `${COOKIE_NAME}=${bt}`,
      `${COOKIE_NAME}=${t}=`,
      `${COOKIE_NAME}=${t}==`,
      `${COOKIE_NAME}=${h}.${p}.${sg}=`,
      `${COOKIE_NAME}=${h}.${p}.${sg} `,
      `${COOKIE_NAME}=${h}.${p}.${sg}%20`,
      `${COOKIE_NAME}=${h}.${p}.${sg}%0A`,
      `${COOKIE_NAME}=${h}.${p}.`, // thiếu chữ ký
      `${COOKIE_NAME}=${h}.${p}.${"A".repeat(sg!.length)}`, // chữ ký sai
      `${COOKIE_NAME}=${h}.${p}x.${sg}`, // payload bị sửa
      `${COOKIE_NAME.toUpperCase()}=${t}`, // tên khác hoa/thường ⇒ không phải cookie phiên
    ];
    const goc = await rl.apiKeyGeneratorXacThuc(req({ cookie: cookieVariants[0]! }));
    const khoaIp = rl.apiKeyGenerator(req({}));
    expect(goc).toMatch(/^sess:/);
    let chapNhan = 0;
    let tuChoi = 0;
    for (const cookie of cookieVariants) {
      const tok = phanTichCookie(cookie)[COOKIE_NAME];
      const authChapNhan = !!tok && (await sdk.verifySession(tok)) !== null;
      const khoa = await rl.apiKeyGeneratorXacThuc(req({ cookie }));
      if (authChapNhan) {
        chapNhan++;
        expect(khoa, `auth CHẤP NHẬN ⇒ phải cùng xô phiên: ${cookie.slice(0, 60)}`).toBe(goc);
      } else {
        tuChoi++;
        expect(khoa, `auth TỪ CHỐI ⇒ phải rơi xô IP: ${cookie.slice(0, 60)}`).toBe(khoaIp);
      }
    }
    expect(chapNhan).toBeGreaterThanOrEqual(8);
    expect(tuChoi).toBeGreaterThanOrEqual(6);
  });
  it("Bearer: scheme hoa/thường, khoảng trắng thừa, biến thể chữ ký ⇒ cùng xô; chữ ký sai ⇒ IP", async () => {
    const goc = await rl.apiKeyGeneratorXacThuc(req({ authorization: `Bearer ${ve}` }));
    expect(goc).toMatch(/^bearer:/);
    for (const a of [`bearer ${ve}`, `BEARER   ${ve}  `, `Bearer ${bienThe(ve)}`]) {
      const tok = a.replace(/^bearer\s+/i, "").trim();
      const ok = (await sdk.verifySession(tok)) !== null;
      expect(await rl.apiKeyGeneratorXacThuc(req({ authorization: a }))).toBe(ok ? goc : rl.apiKeyGenerator(req({})));
    }
    expect(await rl.apiKeyGeneratorXacThuc(req({ authorization: `Bearer ${ve.slice(0, -4)}AAAA` }))).toBe(rl.apiKeyGenerator(req({})));
  });
});

describe("W21 — đầu-cuối qua createApiLimiter (trần hạ xuống 5)", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.use("/api/", rl.createApiLimiter());
    app.get("/api/trpc/*", (_q, r) => r.json({ ok: true }));
    await new Promise<void>((r) => {
      server = app.listen(0, "127.0.0.1", () => r());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });
  const dem = async (mk: (i: number) => Record<string, string>, n: number) => {
    const ma: number[] = [];
    for (let i = 0; i < n; i++) ma.push((await fetch(`${base}/api/trpc/a.b`, { headers: mk(i) })).status);
    return ma;
  };
  it("★ 12 cookie RÁC khác nhau, cùng IP ⇒ chạm trần 429 (trước vá: 12 lần 200)", async () => {
    const ma = await dem((i) => ({ cookie: `${COOKIE_NAME}=rac${i}-${rnd()}` }), 12);
    expect(ma.filter((x) => x === 200)).toHaveLength(5);
    expect(ma.filter((x) => x === 429).length).toBe(7);
  });
  it("vé HỢP LỆ và biến thể chữ ký chia chung MỘT xô theo phiên (xô IP của cookie rác không ảnh hưởng)", async () => {
    const t = await sdk.createSessionToken(`w21-e2e-${Date.now()}`, { name: "E" });
    const ma = await dem((i) => ({ cookie: `${COOKIE_NAME}=${i % 2 ? bienThe(t) : t}` }), 8);
    expect(ma.filter((x) => x === 200)).toHaveLength(5);
    expect(ma.filter((x) => x === 429)).toHaveLength(3);
  });
});
