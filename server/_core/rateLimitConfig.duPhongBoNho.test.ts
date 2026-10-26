/**
 * SCADA R1b-2b-1 T14 (kiem-dinh G3, mục 45; điều phối điều kiện 4 — PHƯƠNG ÁN (b), phán quyết C4 / C13 / KD-T14).
 *
 * Mọi bộ giới hạn chạy trên MỘT client ioredis dùng chung có hạn lệnh `HAN_LENH_REDIS_GIOI_HAN_MS` (250 ms), và MỌI store Redis của chúng được
 * bọc trong `StoreDuPhongBoNho` (gắn ở MỘT chỗ — `storeOption`): Redis lỗi / quá hạn ⇒ đếm trong BỘ NHỚ của tiến trình, KHÔNG fail-open.
 *
 * Oracle: express THẬT + bộ giới hạn THẬT + client ioredis THẬT (hạn lệnh là của ioredis, không giả) nói RESP2 với một máy chủ Redis GIẢ trong
 * tiến trình (TCP 127.0.0.1, cổng ngẫu nhiên — không chạm Redis thật). Máy chủ giả: chế độ "khoe" (trả lời ngay), "loi" (mọi lệnh dữ liệu trả
 * `-ERR`), trễ `treMs` cho mọi lệnh dữ liệu (EVAL / INCR / PTTL / PEXPIRE / DECR / DEL; lệnh bắt tay INFO / CLIENT trả ngay), và tắt hẳn (sập).
 * Fix round 1 (review I1): khoá có hạn theo đồng hồ riêng của máy chủ giả; ca chậm ⇒ khoẻ KHÔNG xoá trạng thái.
 * Vé phiên ký bằng `sdk.signSession` THẬT. Yêu cầu gửi ĐỒNG THỜI ⇒ mỗi ca < 10 s.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { MemoryStore, type ClientRateLimitInfo, type Options, type Store } from "express-rate-limit";
import { COOKIE_NAME } from "@shared/const";
import { batDauDoLag } from "../testing/doLagBucleSuKien";

// ── Máy chủ Redis GIẢ (RESP2 qua TCP) ─────────────────────────────────────────
// Fix round 1 (review I1): khoá có HẠN thật theo đồng hồ của máy chủ giả (`Date.now() + gia.lechMs` — test tua đồng hồ Redis qua cửa sổ mà
// không chạm đồng hồ tiến trình), và hiểu `EVAL` của ĐÚNG hai script đã xuất (văn bản khác ⇒ -ERR).
const LENH_DU_LIEU = new Set(["incr", "pttl", "pexpire", "decr", "del", "get", "eval", "evalsha"]);
const CRLF = "\r\n";
const gia = {
  cheDo: "khoe" as "khoe" | "loi",
  treMs: 0,
  lechMs: 0,
  dem: new Map<string, number>(),
  /** hạn TUYỆT ĐỐI (ms, đồng hồ máy chủ giả) của khoá; vắng = khoá KHÔNG có TTL */
  het: new Map<string, number>(),
  lenh: new Map<string, number>(),
  choTraLoi: 0,
  socket: new Set<net.Socket>(),
};
const bayGia = () => Date.now() + gia.lechMs;
function donHetHan(k: string): void {
  const h = gia.het.get(k);
  if (h !== undefined && h <= bayGia()) {
    gia.dem.delete(k);
    gia.het.delete(k);
  }
}
/** PTTL như Redis: -2 không có khoá, -1 khoá không TTL, ngược lại ms còn lại. */
function pttlGia(k: string): number {
  donHetHan(k);
  if (!gia.dem.has(k)) return -2;
  const h = gia.het.get(k);
  return h === undefined ? -1 : h - bayGia();
}
function incrGia(k: string): number {
  donHetHan(k);
  const v = (gia.dem.get(k) ?? 0) + 1;
  gia.dem.set(k, v);
  return v;
}
const soNguyen = (n: number) => `:${n}${CRLF}`;

function docLenh(buf: Buffer): { args: string[]; dung: number } | null {
  if (buf.length === 0) return null;
  if (buf[0] !== 0x2a) throw new Error("Redis giả: chỉ hiểu mảng RESP");
  const i = buf.indexOf("\r\n");
  if (i < 0) return null;
  const n = Number(buf.subarray(1, i).toString());
  let pos = i + 2;
  const args: string[] = [];
  for (let k = 0; k < n; k++) {
    const j = buf.indexOf("\r\n", pos);
    if (j < 0) return null;
    const len = Number(buf.subarray(pos + 1, j).toString());
    const s = j + 2;
    if (buf.length < s + len + 2) return null;
    args.push(buf.subarray(s, s + len).toString());
    pos = s + len + 2;
  }
  return { args, dung: pos };
}

/**
 * Thực thi NGAY lúc nhận (như Redis thật — kể cả lệnh mà client đã BỎ vì quá hạn); chỉ CÂU TRẢ LỜI bị trễ (`treMs`) — Redis chậm-mà-sống.
 */
function thucThi(args: string[]): string {
  const ten = args[0]!.toLowerCase();
  if (LENH_DU_LIEU.has(ten)) gia.lenh.set(ten, (gia.lenh.get(ten) ?? 0) + 1);
  if (LENH_DU_LIEU.has(ten) && gia.cheDo === "loi") return `-ERR redis gia sap${CRLF}`;
  const k = args[1] ?? "";
  switch (ten) {
    case "incr":
      return soNguyen(incrGia(k));
    case "pttl":
      return soNguyen(pttlGia(k));
    case "pexpire":
      donHetHan(k);
      if (!gia.dem.has(k)) return soNguyen(0);
      gia.het.set(k, bayGia() + Number(args[2]));
      return soNguyen(1);
    case "decr": {
      donHetHan(k);
      const v = (gia.dem.get(k) ?? 0) - 1;
      gia.dem.set(k, v);
      return soNguyen(v);
    }
    case "del":
      gia.dem.delete(k);
      gia.het.delete(k);
      return soNguyen(1);
    case "eval": {
      // EVAL <script> <numkeys> <key> [argv…] — chỉ hai script đã xuất, theo ngữ nghĩa ghi trong JSDoc của chúng
      const [, script, , khoa = "", argv1] = args;
      if (script === rl.LUA_TANG_DEM) {
        const v = incrGia(khoa);
        let t = pttlGia(khoa);
        if (t < 0) {
          gia.het.set(khoa, bayGia() + Number(argv1));
          t = Number(argv1);
        }
        return `*2${CRLF}${soNguyen(v)}${soNguyen(t)}`;
      }
      if (script === rl.LUA_GIAM_DEM) {
        donHetHan(khoa);
        const v = gia.dem.get(khoa) ?? 0;
        if (v <= 0) return soNguyen(0);
        gia.dem.set(khoa, v - 1);
        return soNguyen(v - 1);
      }
      return `-ERR Redis gia: script khong biet${CRLF}`;
    }
    case "info": {
      const b = "# Server\r\nredis_version:7.2.0\r\nloading:0\r\n";
      return `$${Buffer.byteLength(b)}\r\n${b}\r\n`;
    }
    default:
      return "+OK\r\n";
  }
}

const redisGia = net.createServer((sock) => {
  gia.socket.add(sock);
  sock.on("close", () => gia.socket.delete(sock));
  sock.on("error", () => {});
  let buf = Buffer.alloc(0);
  let hang: Promise<void> = Promise.resolve(); // trả lời ĐÚNG THỨ TỰ nhận (như Redis)
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const r = docLenh(buf);
      if (!r) break;
      buf = buf.subarray(r.dung);
      const han = Date.now() + (LENH_DU_LIEU.has(r.args[0]!.toLowerCase()) ? gia.treMs : 0);
      const traLoi = thucThi(r.args);
      gia.choTraLoi++;
      hang = hang
        .then(
          () =>
            new Promise<void>((xong) => {
              const con = han - Date.now();
              if (con <= 0) xong();
              else setTimeout(xong, con);
            }),
        )
        .then(() => {
          gia.choTraLoi--;
          if (!sock.destroyed) sock.write(traLoi);
        });
    }
  });
});
await new Promise<void>((r) => redisGia.listen(0, "127.0.0.1", () => r()));
const CONG_REDIS_GIA = (redisGia.address() as AddressInfo).port;

process.env.REDIS_URL = `redis://127.0.0.1:${CONG_REDIS_GIA}`;
delete process.env.RATE_LIMIT_REDIS;
process.env.RATE_LIMIT_PER_MINUTE = "1000000"; // tầng chung không xen vào phép đếm của ca
process.env.AUTH_RATE_LIMIT_PER_15MIN = "20";
process.env.JWT_SECRET ||= "r1b2b1-t14-du-phong-bo-nho-secret";
process.env.VITE_APP_ID ||= "avi-aoi-management";

const rl = await import("./rateLimitConfig");
const { sdk } = await import("./sdk");

const STOP = "/api/trpc/scadaCommands.dungMay";
const THONG_DIEP_STOP = { error: "Too many STOP requests — use the hard E-STOP" };
const TRAN_LOGIN = rl.AUTH_RATE_LIMIT.max;

type ClientThat = { status: string; options: { commandTimeout?: number }; once(ev: string, f: () => void): unknown; disconnect(): void };
const clientThat = (): ClientThat => rl.getRateLimitRedis() as unknown as ClientThat;

async function choSanSang(): Promise<void> {
  const c = clientThat();
  if (c.status === "ready") return;
  await new Promise<void>((r) => c.once("ready", () => r()));
}
async function choHetHang(): Promise<void> {
  while (gia.choTraLoi > 0) await new Promise((r) => setTimeout(r, 20));
}
async function datLai(cheDo: "khoe" | "loi", treMs: number): Promise<void> {
  gia.treMs = 0;
  await choHetHang(); // trả lời muộn của ca trước không được xếp hàng trước lệnh của ca này
  gia.cheDo = cheDo;
  gia.treMs = treMs;
  gia.lechMs = 0;
  gia.dem.clear();
  gia.het.clear();
  gia.lenh.clear();
}
/** Đổi chế độ / độ trễ, GIỮ NGUYÊN dữ liệu của Redis giả (fix round 1, I1: chậm ⇒ khoẻ không xoá trạng thái). */
async function doiCheDo(cheDo: "khoe" | "loi", treMs: number): Promise<void> {
  gia.treMs = 0;
  await choHetHang();
  gia.cheDo = cheDo;
  gia.treMs = treMs;
}

/** Express với các bộ giới hạn THẬT gắn như `_core/index.ts` (STOP trước tầng chung trên '/api/', auth trên '/api/auth/'). */
async function taoApp(): Promise<{ server: Server; base: string }> {
  const app = express();
  app.use("/api/", rl.createHmiStopLimiter());
  app.use("/api/", rl.createApiLimiter());
  app.use("/api/auth/", rl.createAuthLimiter());
  const ok = (_q: express.Request, r: express.Response) => void r.status(200).json({ ok: true });
  app.post("/api/trpc/:p", ok);
  app.post("/api/auth/login", ok);
  let server!: Server;
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
const dong = (s: Server) => new Promise<void>((r) => s.close(() => r()));
const cookieCua = async (openId: string) =>
  `${COOKIE_NAME}=${encodeURIComponent(await sdk.signSession({ openId, appId: process.env.VITE_APP_ID!, name: "HMI operator" }))}`;

async function stop(base: string, cookie: string): Promise<{ status: number; body: string }> {
  const r = await fetch(`${base}${STOP}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" });
  return { status: r.status, body: await r.text() };
}
async function login(base: string): Promise<number> {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  await r.arrayBuffer();
  return r.status;
}
/** `n` yêu cầu, tối đa `song` cùng lúc (600 kết nối mở một lúc vượt hàng đợi listen của Windows ⇒ ECONNREFUSED — đo 2026-10-26). */
async function dongThoi<T>(n: number, f: () => Promise<T>, song = 100): Promise<T[]> {
  const ra: T[] = new Array(n);
  let ke = 0;
  const tho = async () => {
    while (ke < n) {
      const i = ke++;
      ra[i] = await f();
    }
  };
  await Promise.all(Array.from({ length: Math.min(song, n) }, tho));
  return ra;
}
const tongRedis = (tienTo: string) => [...gia.dem].filter(([k]) => k.startsWith(tienTo)).reduce((s, [, v]) => s + v, 0);

const memInc = vi.spyOn(MemoryStore.prototype, "increment");

beforeAll(async () => {
  // khởi động client dùng chung + làm ấm import động của phép kiểm vé (lần đầu nạp mô-đun không được tính vào cận thời gian)
  await datLai("khoe", 0);
  const app = await taoApp();
  await choSanSang();
  expect((await stop(app.base, await cookieCua("t14-lam-am"))).status).toBe(200);
  await dong(app.server);
}, 30_000);
afterAll(async () => {
  memInc.mockRestore();
  try {
    clientThat().disconnect();
  } catch {
    /* đã ngắt */
  }
  for (const s of gia.socket) s.destroy();
  await new Promise<void>((r) => redisGia.close(() => r()));
});

describe("client Redis của bộ giới hạn — hạn lệnh", () => {
  it("client ioredis THẬT dựng với commandTimeout === HAN_LENH_REDIS_GIOI_HAN_MS (250)", () => {
    expect(rl.HAN_LENH_REDIS_GIOI_HAN_MS).toBe(250);
    expect(clientThat().options.commandTimeout).toBe(rl.HAN_LENH_REDIS_GIOI_HAN_MS);
  });
});

describe("★★★ Redis giả NÉM ở mọi lệnh ⇒ tầng STOP + đăng nhập đếm trong bộ nhớ (không fail-open)", () => {
  it("một phiên: 600 STOP ký hợp lệ ⇒ 0 lần 429; lượt 601 ⇒ 429 E-STOP; phiên khác ⇒ 200; đăng nhập 429 đúng lượt", async () => {
    await datLai("loi", 0);
    const app = await taoApp();
    try {
      memInc.mockClear();
      const a = await cookieCua(`t14-loi-a-${Date.now()}`);
      const lo = await dongThoi(600, () => stop(app.base, a));
      expect(lo.filter((r) => r.status === 429), "STOP của một người dùng tay không bao giờ 429 dưới 600 / phút").toHaveLength(0);
      expect(lo.every((r) => r.status === 200)).toBe(true);
      const thu601 = await stop(app.base, a);
      expect(thu601.status).toBe(429);
      expect(JSON.parse(thu601.body)).toEqual(THONG_DIEP_STOP);
      expect((await stop(app.base, await cookieCua(`t14-loi-b-${Date.now()}`))).status, "phiên khác không bị chặn").toBe(200);
      expect(gia.lenh.get("eval") ?? 0, "Redis đã được hỏi (rồi lỗi)").toBeGreaterThan(0);
      expect(memInc.mock.calls.length, "đếm rơi xuống bộ nhớ").toBeGreaterThanOrEqual(602);

      const dn = await dongThoi(TRAN_LOGIN, () => login(app.base));
      expect(dn.every((s) => s === 200)).toBe(true);
      expect(await login(app.base), `đăng nhập lượt ${TRAN_LOGIN + 1} ⇒ 429`).toBe(429);
    } finally {
      await dong(app.server);
    }
  }, 30_000);

  it("bộ đếm theo thủ tục (OTP / 2FA — `taoStoreDem`) cũng đếm trong bộ nhớ, không ném", async () => {
    await datLai("loi", 0);
    const s = rl.taoStoreDem("rl:proc:t14:", 60_000);
    const hits: number[] = [];
    for (let i = 0; i < 3; i++) hits.push((await s.increment("otp:ip:1")).totalHits);
    expect(hits).toEqual([1, 2, 3]);
  });
});

for (const treMs of [400, 2000]) {
  describe(`★★★ Redis giả CHẬM-MÀ-SỐNG — ${treMs} ms mỗi lệnh (KD-T14 / C13)`, () => {
    it(`(1) bộ giới hạn đăng nhập vẫn đếm: ${TRAN_LOGIN} lượt đồng thời 200, lượt kế ⇒ 429 (không fail-open)`, async () => {
      await datLai("khoe", treMs);
      const app = await taoApp();
      try {
        const dn = await dongThoi(TRAN_LOGIN, () => login(app.base));
        expect(dn.filter((s) => s !== 200)).toEqual([]);
        expect(await login(app.base)).toBe(429);
      } finally {
        await dong(app.server);
      }
    }, 10_000);

    it("(2) STOP ký hợp lệ qua tầng giới hạn < 1 s TRONG KHI 50 luồng đăng nhập đồng thời đang chờ cùng Redis chậm; (3) lượt 601 trong một phiên ⇒ 429 E-STOP", async () => {
      await datLai("khoe", treMs);
      const app = await taoApp();
      try {
        const c = await cookieCua(`t14-cham-${treMs}-c-${Date.now()}`);
        // review M2 / KD-T14: tải ĐỒNG THỜI trên CÙNG client Redis chậm trong suốt phép đo
        let chay = true;
        let soLogin = 0;
        const nen = Promise.all(
          Array.from({ length: 50 }, async () => {
            while (chay) {
              await login(app.base);
              soLogin++;
            }
          }),
        );
        try {
          await new Promise((r) => setTimeout(r, 300)); // tải đã vào guồng (lượt đầu của mỗi luồng đang chờ Redis)
          for (let i = 0; i < 3; i++) {
            const evalTruoc = gia.lenh.get("eval") ?? 0;
            const lag = batDauDoLag();
            const t0 = performance.now();
            const r = await stop(app.base, c);
            const ms = performance.now() - t0;
            const nho = await lag.dung();
            expect(r.status).toBe(200);
            expect(ms, `STOP thứ ${i + 1} qua tầng giới hạn dưới tải (máy không chạy ta: ${nho} ms)`).toBeLessThan(1000 + nho);
            expect((gia.lenh.get("eval") ?? 0) - evalTruoc, "tải đồng thời thật sự đang gửi lệnh tới Redis chậm").toBeGreaterThan(1);
          }
        } finally {
          chay = false;
          await nen;
        }
        expect(soLogin, "các luồng đăng nhập đã chạy trong lúc đo").toBeGreaterThan(50);
        const a = await cookieCua(`t14-cham-${treMs}-a-${Date.now()}`);
        const lo = await dongThoi(600, () => stop(app.base, a));
        expect(lo.filter((r) => r.status !== 200).map((r) => r.status)).toEqual([]);
        const thu601 = await stop(app.base, a);
        expect(thu601.status).toBe(429);
        expect(JSON.parse(thu601.body)).toEqual(THONG_DIEP_STOP);
      } finally {
        await dong(app.server);
      }
    }, 10_000);
  });
}

describe("★★★ fix round 1 (review I1) — đợt Redis CHẬM rồi KHOẺ, KHÔNG xoá trạng thái Redis giả giữa hai pha", () => {
  it("lệnh quá hạn mà Redis vẫn chạy để lại khoá CÓ TTL (≤ cửa sổ); qua cửa sổ, lượt đăng nhập đầu tiên ⇒ 200 (không 429 cả cửa sổ sau hồi phục); có dòng 'Redis answering again'", async () => {
    await datLai("khoe", 400);
    const app = await taoApp();
    const warn = vi.spyOn(console, "warn");
    try {
      memInc.mockClear();
      const c = await cookieCua(`t14-i1-${Date.now()}`);
      // pha CHẬM: mọi EVAL quá hạn ở client (250 ms < 400 ms) nhưng máy chủ giả vẫn THỰC THI chúng
      await dongThoi(TRAN_LOGIN + 5, () => login(app.base), 25);
      await dongThoi(5, () => stop(app.base, c), 5);
      expect(memInc.mock.calls.length, "pha chậm: đếm đã rơi xuống bộ nhớ").toBeGreaterThan(0);

      await doiCheDo("khoe", 0); // KHÔNG xoá gia.dem / gia.het
      const khoaAuth = [...gia.dem.keys()].filter((k) => k.startsWith("rl:auth:"));
      expect(khoaAuth, "một khoá đăng nhập (một IP)").toHaveLength(1);
      const kA = khoaAuth[0]!;
      expect(gia.dem.get(kA), "Redis đã thực thi các lệnh client bỏ vì quá hạn").toBeGreaterThanOrEqual(TRAN_LOGIN + 5);
      const ttlA = pttlGia(kA);
      expect(ttlA, "khoá đăng nhập tạo trong đợt chậm PHẢI có TTL").toBeGreaterThan(0);
      expect(ttlA).toBeLessThanOrEqual(rl.AUTH_RATE_LIMIT.windowMs);
      const khoaStop = [...gia.dem.keys()].filter((k) => k.startsWith("rl:hmistop:"));
      expect(khoaStop).toHaveLength(1);
      const ttlS = pttlGia(khoaStop[0]!);
      expect(ttlS, "khoá STOP tạo trong đợt chậm PHẢI có TTL").toBeGreaterThan(0);
      expect(ttlS).toBeLessThanOrEqual(60_000);
      // không còn khoá nào thiếu TTL (không rò khoá)
      expect([...gia.dem.keys()].filter((k) => pttlGia(k) === -1)).toEqual([]);

      // tua đồng hồ Redis giả qua cửa sổ đăng nhập (15 phút) ⇒ khoá hết hạn như Redis thật
      gia.lechMs += rl.AUTH_RATE_LIMIT.windowMs + 1;
      warn.mockClear();
      expect(await login(app.base), "lượt đầu sau cửa sổ ⇒ 200, không phải 429 cả cửa sổ mới").toBe(200);
      expect(gia.dem.get(kA), "đếm lại từ 1 TRONG Redis").toBe(1);
      expect(pttlGia(kA)).toBeGreaterThan(0);
      expect(
        warn.mock.calls.map((x) => String(x[0])).filter((d) => d.includes("rl:auth:") && d.includes("Redis answering again")),
        "Minor M4: một dòng khi tầng quay về Redis",
      ).toHaveLength(1);
    } finally {
      warn.mockRestore();
      await dong(app.server);
    }
  }, 10_000);
});

describe("★★★ Redis KHOẺ ⇒ đếm ở Redis, bộ nhớ không tăng", () => {
  it("600 STOP một phiên ⇒ Redis 600 INCR trên rl:hmistop:, 0 lượt MemoryStore.increment; lượt 601 ⇒ 429 (đếm Redis); đăng nhập đếm ở rl:auth:", async () => {
    await datLai("khoe", 0);
    const app = await taoApp();
    try {
      memInc.mockClear();
      const a = await cookieCua(`t14-khoe-a-${Date.now()}`);
      const lo = await dongThoi(600, () => stop(app.base, a));
      expect(lo.every((r) => r.status === 200)).toBe(true);
      expect(tongRedis("rl:hmistop:")).toBe(600);
      expect(memInc.mock.calls.length, "Redis khoẻ ⇒ không đếm dự phòng").toBe(0);
      const thu601 = await stop(app.base, a);
      expect(thu601.status).toBe(429);
      expect(JSON.parse(thu601.body)).toEqual(THONG_DIEP_STOP);
      const dn = await dongThoi(TRAN_LOGIN, () => login(app.base));
      expect(dn.every((s) => s === 200)).toBe(true);
      expect(await login(app.base)).toBe(429);
      expect(tongRedis("rl:auth:")).toBe(TRAN_LOGIN + 1);
      expect(memInc.mock.calls.length).toBe(0);
    } finally {
      await dong(app.server);
    }
  }, 10_000);
});

// ── StoreDuPhongBoNho — đơn vị ───────────────────────────────────────────────
function storeNem(): Store & { initGoi: number } {
  return {
    initGoi: 0,
    prefix: "rl:nem:",
    localKeys: false,
    init(this: { initGoi: number }) {
      this.initGoi++;
    },
    async increment(): Promise<ClientRateLimitInfo> {
      throw new Error("Command timed out");
    },
    async decrement() {
      throw new Error("Command timed out");
    },
    async resetKey() {
      throw new Error("Command timed out");
    },
  };
}

describe("StoreDuPhongBoNho (đơn vị)", () => {
  // review M5: chỉ khôi phục spy CỦA khối này — `vi.restoreAllMocks()` cũng gỡ `memInc` cấp mô-đun (đổi thứ tự ca ⇒ mù quan sát ca Redis khoẻ)
  const spyDonVi: Array<{ mockRestore(): unknown }> = [];
  const theoDoi = <T extends { mockRestore(): unknown }>(s: T): T => {
    spyDonVi.push(s);
    return s;
  };
  afterEach(() => {
    vi.useRealTimers();
    for (const s of spyDonVi.splice(0)) s.mockRestore();
  });

  it("Minor (review M4): lần gọi chính THÀNH CÔNG đầu tiên sau một đợt dự phòng in ĐÚNG một dòng 'Redis answering again'; chính luôn khoẻ ⇒ không in", async () => {
    const warn = theoDoi(vi.spyOn(console, "warn")).mockImplementation(() => {});
    let hong = true;
    const chinh: Store = {
      prefix: "rl:hoiphuc:",
      localKeys: false,
      init() {},
      async increment() {
        if (hong) throw new Error("Command timed out");
        return { totalHits: 1, resetTime: new Date(Date.now() + 1000) };
      },
      async decrement() {},
      async resetKey() {},
    };
    const duPhong = new MemoryStore();
    const s = new rl.StoreDuPhongBoNho(chinh, duPhong);
    s.init({ windowMs: 60_000 } as Options);
    await s.increment("k");
    await s.increment("k");
    hong = false;
    await s.increment("k");
    await s.increment("k");
    const dong = warn.mock.calls.map((c) => String(c[0]));
    expect(dong.filter((d) => d.includes("Redis store failed"))).toHaveLength(1);
    expect(dong.filter((d) => d.includes("rl:hoiphuc:") && d.includes("Redis answering again"))).toHaveLength(1);
    duPhong.shutdown();

    warn.mockClear();
    const s2 = new rl.StoreDuPhongBoNho({ ...chinh, prefix: "rl:khoe2:" }, new MemoryStore());
    s2.init({ windowMs: 60_000 } as Options);
    await s2.increment("k");
    expect(warn).not.toHaveBeenCalled();
  });

  it("★ C4: init(options) gọi trên CẢ store chính và store dự phòng; cửa sổ bộ nhớ ĐẶT LẠI sau windowMs (đồng hồ giả)", async () => {
    vi.useFakeTimers();
    theoDoi(vi.spyOn(console, "warn")).mockImplementation(() => {});
    const chinh = storeNem();
    const duPhong = new MemoryStore();
    const initDuPhong = theoDoi(vi.spyOn(duPhong, "init"));
    const s = new rl.StoreDuPhongBoNho(chinh, duPhong);
    s.init({ windowMs: 60_000 } as Options);
    expect(chinh.initGoi).toBe(1);
    expect(initDuPhong).toHaveBeenCalledTimes(1);
    expect((await s.increment("k")).totalHits).toBe(1);
    expect((await s.increment("k")).totalHits).toBe(2);
    expect((await s.increment("k")).totalHits).toBe(3);
    vi.advanceTimersByTime(59_000);
    expect((await s.increment("k")).totalHits, "còn trong cửa sổ").toBe(4);
    vi.advanceTimersByTime(1_001);
    expect((await s.increment("k")).totalHits, "qua windowMs ⇒ cửa sổ mới (không khoá vĩnh viễn)").toBe(1);
    duPhong.shutdown();
  });

  it("chính lỗi ⇒ dự phòng với CÙNG khoá; decrement / resetKey cũng rơi xuống; log tối đa 1 dòng / 60 s", async () => {
    vi.useFakeTimers();
    const warn = theoDoi(vi.spyOn(console, "warn")).mockImplementation(() => {});
    const duPhong = new MemoryStore();
    const s = new rl.StoreDuPhongBoNho(storeNem(), duPhong);
    s.init({ windowMs: 600_000 } as Options);
    for (let i = 0; i < 50; i++) await s.increment("khoa-x");
    expect((await duPhong.get("khoa-x"))?.totalHits).toBe(50);
    await s.decrement("khoa-x");
    expect((await duPhong.get("khoa-x"))?.totalHits).toBe(49);
    expect(warn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    await s.increment("khoa-x");
    expect(warn).toHaveBeenCalledTimes(2);
    await s.resetKey("khoa-x");
    expect(await duPhong.get("khoa-x")).toBeUndefined();
    duPhong.shutdown();
  });

  it("chính KHOẺ ⇒ dự phòng không được chạm; prefix / localKeys của chính (singleCount của express-rate-limit)", async () => {
    const goi: string[] = [];
    const chinh: Store = {
      prefix: "rl:khoe:",
      localKeys: false,
      init() {},
      async increment(k) {
        goi.push(k);
        return { totalHits: 7, resetTime: new Date(Date.now() + 1000) };
      },
      async decrement() {},
      async resetKey() {},
    };
    const duPhong = new MemoryStore();
    const inc = theoDoi(vi.spyOn(duPhong, "increment"));
    const s = new rl.StoreDuPhongBoNho(chinh, duPhong);
    s.init({ windowMs: 60_000 } as Options);
    expect((await s.increment("k1")).totalHits).toBe(7);
    expect(goi).toEqual(["k1"]);
    expect(inc).not.toHaveBeenCalled();
    expect(s.prefix).toBe("rl:khoe:");
    expect(s.localKeys).toBe(false);
    duPhong.shutdown();
  });

  it("chính VẮNG (chế độ bộ nhớ) ⇒ chỉ dự phòng, localKeys true", async () => {
    const duPhong = new MemoryStore();
    const s = new rl.StoreDuPhongBoNho(undefined, duPhong);
    s.init({ windowMs: 60_000 } as Options);
    expect((await s.increment("m")).totalHits).toBe(1);
    expect((await s.increment("m")).totalHits).toBe(2);
    expect(s.localKeys).toBe(true);
    duPhong.shutdown();
  });
});

describe("★★★ Redis SẬP HẲN (máy chủ đóng, client mất kết nối) ⇒ tầng STOP vẫn trần 600 / phút / phiên theo tiến trình", () => {
  it("600 STOP ⇒ 200, lượt 601 ⇒ 429 E-STOP (chạy CUỐI: đóng máy chủ giả)", async () => {
    await datLai("khoe", 0);
    const app = await taoApp();
    try {
      const daDong = new Promise<void>((r) => redisGia.close(() => r()));
      for (const s of gia.socket) s.destroy();
      await daDong;
      for (let i = 0; i < 100 && clientThat().status === "ready"; i++) await new Promise((r) => setTimeout(r, 10));
      expect(clientThat().status).not.toBe("ready");
      const a = await cookieCua(`t14-sap-a-${Date.now()}`);
      const lo = await dongThoi(600, () => stop(app.base, a));
      expect(lo.every((r) => r.status === 200)).toBe(true);
      const thu601 = await stop(app.base, a);
      expect(thu601.status).toBe(429);
      expect(JSON.parse(thu601.body)).toEqual(THONG_DIEP_STOP);
    } finally {
      await dong(app.server);
    }
  }, 10_000);
});
