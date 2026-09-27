/**
 * doc 81 Đợt 1B Task 11 — `/health`, `/readyz` nói THẬT; `/metrics` có xác thực.
 *
 * ĐO trước khi vá (BE3 §L7):
 *   • `/health` (`index.ts:444-451`) và `/readyz` (`healthProbes.ts:49-57`) chỉ kiểm
 *     `Boolean(getDb())`. `getDb()` trả đối tượng drizzle đã cache (postgres.js nối LƯỜI) ⇒ luôn
 *     truthy khi có DATABASE_URL ⇒ cả hai báo OK cả khi Postgres đã sập.
 *   • `/metrics` (`index.ts:352-354`) không xác thực: 437 KB, có cả RUM, cho bất kỳ ai với tới cổng.
 *
 * ORACLE độc lập với mã sản phẩm: mã HTTP và trường JSON lấy từ ĐẶC TẢ của brief (503 `{db:"down"}`,
 * 401/403), DB giả là một đối tượng tự viết ném/treo/đếm lượt gọi — không so hàm sản phẩm với chính nó.
 * Mọi server test nghe 127.0.0.1 cổng 0, đóng ở afterAll. Treo được đo bằng hạn giờ tường minh.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";

import * as probes from "./healthProbes";
import {
  createDbPinger,
  createHealthHandler,
  createReadyzHandler,
  DB_PING_TIMEOUT_MS,
  HEALTH_DB_CACHE_MS,
} from "./healthProbes";
import { initMetrics, metricsHandler } from "./metrics";

// ─── tiện ích ────────────────────────────────────────────────────────────────────────────────────

const HAN_GIO_TREO = new Promise<never>(() => {}); // treo vĩnh viễn

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        t = setTimeout(() => reject(new Error(`withTimeout: quá ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

interface Resp {
  status: number;
  body: string;
  json: any;
  ms: number;
  headers: http.IncomingHttpHeaders;
}

function goi(port: number, p: string, headers: Record<string, string> = {}): Promise<Resp> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    // agent:false ⇒ mỗi request một socket MỚI (không để socket keep-alive mang remoteAddress giả sang lượt sau)
    const req = http.request(
      { host: "127.0.0.1", port, path: p, method: "GET", headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json: any = null;
          try {
            json = JSON.parse(body);
          } catch {
            /* không phải JSON */
          }
          resolve({ status: res.statusCode ?? 0, body, json, ms: Date.now() - t0, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const servers: http.Server[] = [];
async function nghe(app: express.Express): Promise<number> {
  const srv = http.createServer(app);
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return (srv.address() as AddressInfo).port;
}
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
});

/** Giả lập IP nguồn: ghi đè `req.socket.remoteAddress` (đúng chỗ Express đọc khi không `trust proxy`). */
function giaLapIpNguon(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const ip = req.headers["x-test-remote"];
  if (typeof ip === "string" && ip) {
    Object.defineProperty(req.socket, "remoteAddress", { value: ip, configurable: true });
  }
  next();
}

/** DB giả theo đặc tả: đếm lượt `execute`, hành vi chọn được. */
function dbGia(kieu: "ok" | "nem" | "treo") {
  const dem = { getDb: 0, execute: 0 };
  const db = {
    execute: (_q: unknown) => {
      dem.execute++;
      if (kieu === "ok") return Promise.resolve([{ "?column?": 1 }]);
      if (kieu === "nem") return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:5434"));
      return HAN_GIO_TREO;
    },
  };
  return {
    dem,
    getDb: async () => {
      dem.getDb++;
      return db;
    },
  };
}

function appProbe(getDb: () => Promise<unknown>, now?: () => number) {
  const pinger = createDbPinger({ getDb, now });
  const app = express();
  const checkBroker = async () => null; // broker không phải cổng readiness — cô lập khỏi mqttService
  app.get("/health", createHealthHandler({ pinger }));
  app.get("/readyz", createReadyzHandler({ pinger, checkBroker }));
  return { app, pinger };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("T11 §1 — /readyz chạy SELECT 1 có hạn giờ; lỗi/treo ⇒ 503 {db:'down'} trong ≤ 2 s", () => {
  it("hằng số đúng brief: hạn ping 1500 ms, cache /health ≤ 5 s", () => {
    expect(DB_PING_TIMEOUT_MS).toBe(1500);
    expect(HEALTH_DB_CACHE_MS).toBeLessThanOrEqual(5000);
  });

  it("★ getDb TRẢ đối tượng (truthy) nhưng SELECT 1 ném ⇒ 503 — đây là ca Boolean(getDb()) nói dối", async () => {
    const g = dbGia("nem");
    const port = await nghe(appProbe(g.getDb).app);
    const r = await withTimeout(goi(port, "/readyz"), 5000);
    expect(r.status).toBe(503);
    expect(r.json.db).toBe("down");
    expect(r.json.ready).toBe(false);
    expect(g.dem.execute, "phải chạy một truy vấn THẬT, không chỉ lấy đối tượng db").toBe(1);
  });

  it("getDb giả NÉM ⇒ 503 {db:'down'} trong ≤ 2 s", async () => {
    const port = await nghe(
      appProbe(async () => {
        throw new Error("DATABASE_URL hỏng");
      }).app,
    );
    const r = await withTimeout(goi(port, "/readyz"), 5000);
    expect(r.status).toBe(503);
    expect(r.json.db).toBe("down");
    expect(r.ms).toBeLessThanOrEqual(2000);
  });

  it("getDb giả TREO ⇒ 503 {db:'down'} trong ≤ 2 s", async () => {
    const port = await nghe(appProbe(() => HAN_GIO_TREO).app);
    const r = await withTimeout(goi(port, "/readyz"), 5000);
    expect(r.status).toBe(503);
    expect(r.json.db).toBe("down");
    expect(r.ms).toBeLessThanOrEqual(2000);
  });

  it("SELECT 1 TREO (TCP nhận rồi im) ⇒ 503 trong ≤ 2 s", async () => {
    const g = dbGia("treo");
    const port = await nghe(appProbe(g.getDb).app);
    const r = await withTimeout(goi(port, "/readyz"), 5000);
    expect(r.status).toBe(503);
    expect(r.json.db).toBe("down");
    expect(r.ms).toBeLessThanOrEqual(2000);
  });

  it("getDb trả null (không DATABASE_URL) ⇒ 503", async () => {
    const port = await nghe(appProbe(async () => null).app);
    const r = await withTimeout(goi(port, "/readyz"), 5000);
    expect(r.status).toBe(503);
    expect(r.json.db).toBe("down");
  });

  it("đường HỢP LỆ: SELECT 1 trả lời ⇒ 200 {db:'ok'}", async () => {
    const g = dbGia("ok");
    const port = await nghe(appProbe(g.getDb).app);
    const r = await withTimeout(goi(port, "/readyz"), 5000);
    expect(r.status).toBe(200);
    expect(r.json.db).toBe("ok");
    expect(r.json.ready).toBe(true);
    expect(g.dem.execute).toBe(1);
  });

  it("20 /readyz đồng thời khi SELECT 1 treo ⇒ đúng MỘT truy vấn bay (không vét cạn pool), tất cả 503 ≤ 2 s", async () => {
    const g = dbGia("treo");
    const port = await nghe(appProbe(g.getDb).app);
    const rs = await withTimeout(Promise.all(Array.from({ length: 20 }, () => goi(port, "/readyz"))), 5000);
    expect(rs.every((r) => r.status === 503)).toBe(true);
    expect(Math.max(...rs.map((r) => r.ms))).toBeLessThanOrEqual(2000);
    expect(g.dem.execute).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("T11 §2 — /health (liveness) nhẹ, KHÔNG chết vì DB, trạng thái DB lấy từ ping gần nhất ≤ 5 s", () => {
  it("DB sập ⇒ /health vẫn 200 (liveness) nhưng KHÔNG nói db 'connected' / status 'ok'", async () => {
    const g = dbGia("nem");
    const port = await nghe(appProbe(g.getDb).app);
    const r = await withTimeout(goi(port, "/health"), 5000);
    expect(r.status).toBe(200);
    expect(r.json.db).not.toBe("connected");
    expect(r.json.status).not.toBe("ok");
    expect(g.dem.execute, "trạng thái DB phải đến từ một lần ping THẬT").toBe(1);
  });

  it("DB treo ⇒ /health 200 trong ≤ 2 s, db không phải 'connected'", async () => {
    const g = dbGia("treo");
    const port = await nghe(appProbe(g.getDb).app);
    const r = await withTimeout(goi(port, "/health"), 5000);
    expect(r.status).toBe(200);
    expect(r.ms).toBeLessThanOrEqual(2000);
    expect(r.json.db).not.toBe("connected");
  });

  it("DB sống ⇒ 200 {status:'ok', db:'connected'} (hợp đồng edition-smoke / FactoryAlert giữ nguyên)", async () => {
    const g = dbGia("ok");
    const port = await nghe(appProbe(g.getDb).app);
    const r = await withTimeout(goi(port, "/health"), 5000);
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("ok");
    expect(r.json.db).toBe("connected");
    for (const k of ["memoryMB", "uptimeSec", "version", "checkMs", "timestamp"]) expect(r.json).toHaveProperty(k);
  });

  it("cache ≤ 5 s: trong cửa sổ không ping lại; quá 5 s thì ping lại (đồng hồ giả)", async () => {
    let t = 1_000_000;
    const g = dbGia("ok");
    const port = await nghe(appProbe(g.getDb, () => t).app);
    await goi(port, "/health");
    await goi(port, "/health");
    expect(g.dem.execute).toBe(1);
    t += HEALTH_DB_CACHE_MS + 1;
    await goi(port, "/health");
    expect(g.dem.execute, "kết quả cũ hơn 5 s không được đem ra làm trạng thái hiện tại").toBe(2);
  });

  it("DB hồi phục ⇒ lần ping sau cửa sổ cache báo lại 'connected'", async () => {
    let t = 5_000_000;
    let song = false;
    let dem = 0;
    const getDb = async () => ({
      execute: () => {
        dem++;
        return song ? Promise.resolve([]) : Promise.reject(new Error("down"));
      },
    });
    const port = await nghe(appProbe(getDb, () => t).app);
    expect((await goi(port, "/health")).json.db).not.toBe("connected");
    song = true;
    t += HEALTH_DB_CACHE_MS + 1;
    expect((await goi(port, "/health")).json.db).toBe("connected");
    expect(dem).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("T11 §3 — DB `_test` THẬT: handler mặc định (đúng cái index.ts gắn) ⇒ 200", () => {
  it("/readyz 200 {db:'ok'} và /health 200 {db:'connected'} trên DB _test sống", async () => {
    const app = express();
    app.get("/health", createHealthHandler());
    app.get("/readyz", createReadyzHandler({ checkBroker: async () => null }));
    const port = await nghe(app);
    const r = await withTimeout(goi(port, "/readyz"), 10_000);
    expect(r.status).toBe(200);
    expect(r.json.db).toBe("ok");
    const h = await withTimeout(goi(port, "/health"), 10_000);
    expect(h.status).toBe(200);
    expect(h.json.db).toBe("connected");
  });

  it("index.ts gắn ĐÚNG các handler đã test (không phải bản sao nội tuyến)", () => {
    const src = readFileSync(path.resolve(__dirname, "index.ts"), "utf8");
    expect(src).toMatch(/app\.get\('\/health', createHealthHandler\(\)\);/);
    expect(src).toMatch(/app\.get\('\/readyz', createReadyzHandler\(\)\);/);
    expect(src).toMatch(/app\.get\("\/metrics", metricsHandler\);/);
    // /api/network/health (FactoryAlertSystem) cũng không còn tin Boolean(getDb())
    // (Fix round 1: hành vi được đo ở §7 trên ĐÚNG handler này; ở đây chỉ ghim điểm gắn.)
    expect(src).toMatch(/app\.get\('\/api\/network\/health', createNetworkHealthHandler\(\)\);/);
    expect(src).not.toMatch(/if \(dbInstance\) dbStatus = 'connected'/);
  });

  afterAll(async () => {
    await (probes as any).dongClientPing?.();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("T11 §4 — /metrics: Bearer METRICS_TOKEN khi đặt; không đặt ⇒ chỉ loopback, không tin XFF", () => {
  const envCu = { token: process.env.METRICS_TOKEN, enabled: process.env.METRICS_ENABLED };
  let port = 0;
  let portTrustProxy = 0;

  beforeAll(async () => {
    process.env.METRICS_ENABLED = "true";
    const bat = await initMetrics();
    expect(bat, "prom-client phải có mặt để đo đường 200").toBe(true);
    const app = express();
    app.use(giaLapIpNguon);
    app.get("/metrics", metricsHandler);
    port = await nghe(app);
    const app2 = express();
    app2.set("trust proxy", "loopback");
    app2.use(giaLapIpNguon);
    app2.get("/metrics", metricsHandler);
    portTrustProxy = await nghe(app2);
  });
  afterEach(() => {
    if (envCu.token === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = envCu.token;
  });
  afterAll(() => {
    if (envCu.enabled === undefined) delete process.env.METRICS_ENABLED;
    else process.env.METRICS_ENABLED = envCu.enabled;
  });

  const laMetrics = (r: Resp) => r.status === 200 && r.body.includes("avi_aoi_");

  it("KHÔNG token: từ IP ngoài (remoteAddress 10.1.2.3) ⇒ 403, không lộ nội dung", async () => {
    delete process.env.METRICS_TOKEN;
    const r = await goi(port, "/metrics", { "x-test-remote": "10.1.2.3" });
    expect(r.status).toBe(403);
    expect(r.body).not.toContain("avi_aoi_");
  });

  it("KHÔNG token: từ loopback 127.0.0.1 ⇒ 200 (Prometheus cạnh app vẫn chạy)", async () => {
    delete process.env.METRICS_TOKEN;
    expect(laMetrics(await goi(port, "/metrics"))).toBe(true);
  });

  it("KHÔNG token: ::1 và ::ffff:127.0.0.1 là loopback ⇒ 200", async () => {
    delete process.env.METRICS_TOKEN;
    expect(laMetrics(await goi(port, "/metrics", { "x-test-remote": "::1" }))).toBe(true);
    expect(laMetrics(await goi(port, "/metrics", { "x-test-remote": "::ffff:127.0.0.1" }))).toBe(true);
  });

  it("KHÔNG token, KHÔNG trust proxy: IP ngoài giả XFF 127.0.0.1 ⇒ vẫn 403", async () => {
    delete process.env.METRICS_TOKEN;
    const r = await goi(port, "/metrics", { "x-test-remote": "10.1.2.3", "x-forwarded-for": "127.0.0.1" });
    expect(r.status).toBe(403);
  });

  it("KHÔNG token, KHÔNG trust proxy: socket loopback nhưng mang XFF (reverse proxy cùng máy) ⇒ 403", async () => {
    delete process.env.METRICS_TOKEN;
    const r = await goi(port, "/metrics", { "x-forwarded-for": "203.0.113.9" });
    expect(r.status).toBe(403);
  });

  it("KHÔNG token, CÓ trust proxy 'loopback': proxy cùng máy chuyển khách 203.0.113.9 ⇒ 403; khách 127.0.0.1 ⇒ 200", async () => {
    delete process.env.METRICS_TOKEN;
    expect((await goi(portTrustProxy, "/metrics", { "x-forwarded-for": "203.0.113.9" })).status).toBe(403);
    expect(laMetrics(await goi(portTrustProxy, "/metrics", { "x-forwarded-for": "127.0.0.1" }))).toBe(true);
  });

  it("CÓ token: đúng token từ IP ngoài ⇒ 200", async () => {
    process.env.METRICS_TOKEN = "tk-metrics-9f2c7a";
    const r = await goi(port, "/metrics", { "x-test-remote": "10.1.2.3", authorization: "Bearer tk-metrics-9f2c7a" });
    expect(laMetrics(r)).toBe(true);
  });

  it("CÓ token: token SAI ⇒ 401 (kể cả từ loopback); THIẾU header ⇒ 401 (loopback không còn đủ)", async () => {
    process.env.METRICS_TOKEN = "tk-metrics-9f2c7a";
    const sai = await goi(port, "/metrics", { authorization: "Bearer tk-metrics-9f2c7b" });
    expect(sai.status).toBe(401);
    expect(sai.body).not.toContain("avi_aoi_");
    expect((await goi(port, "/metrics", { authorization: "Bearer " })).status).toBe(401);
    expect((await goi(port, "/metrics", { authorization: "Basic dGs6dGs=" })).status).toBe(401);
    expect((await goi(port, "/metrics")).status).toBe(401);
    expect((await goi(port, "/metrics", { "x-test-remote": "10.1.2.3" })).status).toBe(401);
  });

  it("METRICS_TOKEN rỗng/khoảng trắng = KHÔNG đặt (không mở cửa bằng 'Bearer ' rỗng)", async () => {
    process.env.METRICS_TOKEN = "   ";
    expect((await goi(port, "/metrics", { "x-test-remote": "10.1.2.3", authorization: "Bearer " })).status).toBe(403);
    expect(laMetrics(await goi(port, "/metrics"))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("T11 §5 — nhánh anh em /api/observability/metrics áp CÙNG quy tắc", () => {
  let port = 0;
  const envCu = process.env.METRICS_TOKEN;
  beforeAll(async () => {
    const { registerObservabilityRoutes } = await import("../routes/observabilityRoutes");
    const app = express();
    app.use(giaLapIpNguon);
    registerObservabilityRoutes(app);
    port = await nghe(app);
  });
  afterEach(() => {
    if (envCu === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = envCu;
  });

  it("không token: loopback ⇒ 200 (như cũ); IP ngoài không phiên ⇒ 401 (như cũ)", async () => {
    delete process.env.METRICS_TOKEN;
    expect((await goi(port, "/api/observability/metrics")).status).toBe(200);
    expect((await goi(port, "/api/observability/metrics", { "x-test-remote": "10.1.2.3" })).status).toBe(401);
  });

  it("không token, không trust proxy: IP ngoài giả XFF 127.0.0.1 ⇒ 401; loopback mang XFF ⇒ 401", async () => {
    delete process.env.METRICS_TOKEN;
    expect(
      (await goi(port, "/api/observability/metrics", { "x-test-remote": "10.1.2.3", "x-forwarded-for": "127.0.0.1" })).status,
    ).toBe(401);
    expect((await goi(port, "/api/observability/metrics", { "x-forwarded-for": "203.0.113.9" })).status).toBe(401);
    // Fix round 1 mục 5: MỌI `x-forwarded-*` (không chỉ XFF) ⇒ nguồn không rõ
    expect((await goi(port, "/api/observability/metrics", { "x-forwarded-host": "metrics.example" })).status).toBe(401);
  });

  it("CÓ token: đúng Bearer từ IP ngoài ⇒ 200; loopback KHÔNG token ⇒ 401; token sai ⇒ 401", async () => {
    process.env.METRICS_TOKEN = "tk-obs-41d0";
    expect(
      (await goi(port, "/api/observability/metrics", { "x-test-remote": "10.1.2.3", authorization: "Bearer tk-obs-41d0" }))
        .status,
    ).toBe(200);
    expect((await goi(port, "/api/observability/metrics")).status).toBe(401);
    expect((await goi(port, "/api/observability/metrics", { authorization: "Bearer sai" })).status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// FIX ROUND 1 (review cc8518e24)
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/** Lời hứa điều khiển tay (kết thúc lượt ping đúng lúc test muốn). */
function hoan<T>() {
  let resolve!: (v: T) => void;
  const p = new Promise<T>((r) => (resolve = r));
  return { p, resolve };
}

describe("T11 FR1 §6 — kết quả MUỘN không được lật readiness (DB chậm 2,5 s)", () => {
  it("DB trả lời sau 2500 ms ⇒ /readyz 503 ở t≈1,5 s VÀ vẫn 503 ở t≈2,7 s (không nhấp nháy sang 200)", async () => {
    let dem = 0;
    const getDb = async () => ({
      execute: () => {
        dem++;
        return new Promise((r) => setTimeout(() => r([{ x: 1 }]), 2500));
      },
    });
    const port = await nghe(appProbe(getDb).app);
    const t0 = Date.now();
    const r1 = await withTimeout(goi(port, "/readyz"), 5000);
    expect(r1.status).toBe(503);
    await new Promise((r) => setTimeout(r, Math.max(0, 2700 - (Date.now() - t0))));
    const r2 = await withTimeout(goi(port, "/readyz"), 5000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2600);
    expect(r2.status, "câu trả lời về SAU hạn 1500 ms là quá hạn, không phải 'ok'").toBe(503);
    expect(r2.json.db).toBe("down");
    expect(dem).toBe(1);
  });

  it("pinger: câu trả lời 'ok' về sau hạn được ghi là {ok:false, reason:'timeout'}", async () => {
    let t = 0;
    const h = hoan<unknown>();
    const pinger = createDbPinger({ getDb: async () => ({ execute: () => h.p }), timeoutMs: 50, now: () => t });
    const r1 = await pinger.ping({ maxAgeMs: 0 });
    expect(r1).toMatchObject({ ok: false, reason: "timeout" });
    t = 2500; // đồng hồ giả: DB trả lời ở 2500 ms
    h.resolve([]);
    await new Promise((r) => setTimeout(r, 10));
    expect(pinger.last()).toMatchObject({ ok: false, reason: "timeout" });
  });
});

describe("T11 FR1 §7 — ping KHÔNG chiếm pool request; lượt treo bị HUỶ; bỏ rơi 10 s; thứ tự kết quả", () => {
  it("quá hạn ⇒ nguồn ping bị HUỶ đúng một lần (đóng kết nối của lượt treo)", async () => {
    let huy = 0;
    const pinger = createDbPinger({
      getDb: async () => ({ execute: () => new Promise(() => {}), huy: () => void huy++ }),
      timeoutMs: 50,
    });
    const rs = await withTimeout(Promise.all([pinger.ping({ maxAgeMs: 0 }), pinger.ping({ maxAgeMs: 0 })]), 2000);
    expect(rs.every((r) => r.reason === "timeout")).toBe(true);
    expect(huy).toBe(1);
  });

  it("bỏ rơi sau INFLIGHT_BO_ROI_MS (10 s): trước mốc ⇒ nhập lượt cũ (1 truy vấn); sau mốc ⇒ lượt MỚI", async () => {
    expect((probes as any).INFLIGHT_BO_ROI_MS ?? 10_000).toBe(10_000);
    let t = 100_000;
    let dem = 0;
    const pinger = createDbPinger({
      getDb: async () => ({
        execute: () => {
          dem++;
          return new Promise(() => {});
        },
      }),
      timeoutMs: 50,
      now: () => t,
    });
    await withTimeout(pinger.ping({ maxAgeMs: 0 }), 2000);
    expect(dem).toBe(1);
    t += 9_999;
    const r = await withTimeout(pinger.ping({ maxAgeMs: 0 }), 2000);
    expect(r.reason).toBe("timeout");
    expect(dem, "trước mốc 10 s không được mở truy vấn thứ hai").toBe(1);
    t += 2; // 10 001 ms sau lượt đầu
    await withTimeout(pinger.ping({ maxAgeMs: 0 }), 2000);
    expect(dem, "sau mốc 10 s lượt treo bị bỏ rơi ⇒ hỏi lại").toBe(2);
  });

  it("thứ tự: kết quả MUỘN của lượt CŨ không đè kết quả của lượt MỚI hơn", async () => {
    let t = 0;
    const cu = hoan<unknown>();
    let lan = 0;
    const pinger = createDbPinger({
      getDb: async () => ({ execute: () => (++lan === 1 ? cu.p : Promise.resolve([])) }),
      timeoutMs: 50,
      now: () => t,
    });
    await pinger.ping({ maxAgeMs: 0 }); // lượt A treo ⇒ quá hạn
    t = 10_001;
    const b = await pinger.ping({ maxAgeMs: 0 }); // A bị bỏ rơi, lượt B ok
    expect(b.ok).toBe(true);
    t = 10_002;
    cu.resolve([]); // A về muộn
    await new Promise((r) => setTimeout(r, 10));
    expect(pinger.last()?.ok, "kết quả muộn của lượt A (startedAt 0) đè lên B (startedAt 10001)").toBe(true);
    expect(pinger.last()?.startedAt).toBe(10_001);
  });
});

describe("T11 FR1 §8 — /api/network/health: hành vi trên ĐÚNG handler index.ts gắn", () => {
  const taoApp = (getDb: () => Promise<unknown>) => {
    const tao = (probes as any).createNetworkHealthHandler;
    const app = express();
    app.get("/api/network/health", (req, res, next) =>
      tao({
        pinger: createDbPinger({ getDb, timeoutMs: 200 }),
        mqtt: async () => ({ isMqttRunning: () => true, getConnectedClientsCount: () => 3 }),
      })(req, res, next),
    );
    return app;
  };

  it("SELECT 1 NÉM ⇒ dbStatus 'error' (trạng thái 'error' đến được một cách trung thực)", async () => {
    const port = await nghe(taoApp(async () => ({ execute: () => Promise.reject(new Error("x")) })));
    const r = await withTimeout(goi(port, "/api/network/health"), 5000);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: "ok", dbStatus: "error", mqttStatus: "running", mqttClients: 3 });
  });

  it("SELECT 1 TREO ⇒ dbStatus 'disconnected' trong ≤ 2 s", async () => {
    const port = await nghe(taoApp(async () => ({ execute: () => new Promise(() => {}) })));
    const r = await withTimeout(goi(port, "/api/network/health"), 5000);
    expect(r.json.dbStatus).toBe("disconnected");
    expect(r.ms).toBeLessThanOrEqual(2000);
  });

  it("getDb trả đối tượng truthy nhưng DB sập ⇒ KHÔNG 'connected' (ca Boolean(getDb()))", async () => {
    const port = await nghe(taoApp(async () => ({ execute: () => Promise.reject(new Error("ECONNREFUSED")) })));
    expect((await goi(port, "/api/network/health")).json.dbStatus).not.toBe("connected");
  });

  it("đường HỢP LỆ: SELECT 1 trả lời ⇒ dbStatus 'connected' + đủ trường FactoryAlert đọc", async () => {
    const port = await nghe(taoApp(async () => ({ execute: () => Promise.resolve([]) })));
    const r = await goi(port, "/api/network/health");
    expect(r.json.dbStatus).toBe("connected");
    for (const k of ["status", "timestamp", "mqttStatus", "mqttClients", "memoryUsageMB", "uptime"]) {
      expect(r.json).toHaveProperty(k);
    }
  });
});

describe("T11 FR1 §9 — MỌI `x-forwarded-*` làm mất tư cách loopback (không trust proxy)", () => {
  let port = 0;
  const envCu = { token: process.env.METRICS_TOKEN, enabled: process.env.METRICS_ENABLED };
  beforeAll(async () => {
    process.env.METRICS_ENABLED = "true";
    await initMetrics();
    const app = express();
    app.get("/metrics", metricsHandler);
    port = await nghe(app);
  });
  afterAll(() => {
    if (envCu.token === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = envCu.token;
    if (envCu.enabled === undefined) delete process.env.METRICS_ENABLED;
    else process.env.METRICS_ENABLED = envCu.enabled;
  });

  it("X-Forwarded-Proto MỘT MÌNH từ socket loopback ⇒ 403", async () => {
    delete process.env.METRICS_TOKEN;
    expect((await goi(port, "/metrics", { "x-forwarded-proto": "https" })).status).toBe(403);
  });

  it("X-Forwarded-Host / X-Forwarded-Port một mình ⇒ 403; loopback trần ⇒ 200 (đối chứng)", async () => {
    delete process.env.METRICS_TOKEN;
    expect((await goi(port, "/metrics", { "x-forwarded-host": "a.example" })).status).toBe(403);
    expect((await goi(port, "/metrics", { "x-forwarded-port": "443" })).status).toBe(403);
    expect((await goi(port, "/metrics")).status).toBe(200);
  });
});
