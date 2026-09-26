/**
 * doc 81 Đợt 1B Task 8 fix round 1 — bucket giới hạn tần suất KHÔNG xoay được bằng credential thứ hai.
 *
 * Review đo: limiter chạy TRƯỚC xác thực và băm header theo thứ tự KHÁC `extractKey` (auth.ts): bucket
 * lấy `X-API-Key` trước, auth lấy `Bearer` trước ⇒ `Authorization: Bearer K` + một `X-API-Key` ngẫu
 * nhiên mỗi request = một bucket MỚI mỗi request, trong khi vẫn xác thực bằng K.
 *
 * Oracle độc lập: thứ tự của auth được viết lại TẠI ĐÂY theo đặc tả (`Bearer` không phân biệt hoa
 * thường trước, rồi `X-API-Key`) — không gọi hàm sản phẩm để so với chính nó. App dựng ĐÚNG thứ tự
 * mount của `_core/index.ts` (guard + limiter OT trên OT_INGEST_PATHS; guard + limiter máy trên /api/;
 * limiter trình duyệt trên /api/), trần hạ xuống 5 để cạn bucket bằng 6 request.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

process.env.RATE_LIMIT_PER_MINUTE = "5";
process.env.OT_INGEST_RATE_MAX = "5";
process.env.MACHINE_INGEST_RATE_MAX = "5";
delete process.env.REDIS_URL;

const rl = await import("./rateLimitConfig");
const { COOKIE_NAME } = await import("@shared/const");

let server: Server;
let base = "";
let handled = 0;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use([...rl.OT_INGEST_PATHS], rl.credentialConflictGuard, rl.createOtIngestLimiter());
  app.use("/api/", rl.credentialConflictGuard, rl.createMachineIngestLimiter());
  app.use("/api/", rl.createApiLimiter());
  const ok = (_req: express.Request, res: express.Response) => {
    handled += 1;
    res.status(202).json({ ok: true });
  };
  app.post("/api/v1/ingest/telemetry", ok);
  app.post("/api/ot/ingest", ok);
  app.post("/api/machine/heartbeat", ok);
  app.post("/api/trpc/*", ok);
  app.get("/api/trpc/*", ok);
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const rnd = () => `rot-${Math.random().toString(36).slice(2)}-${Date.now()}`;

describe("thứ tự khoá bucket = thứ tự xác thực (Bearer trước, không phân biệt hoa thường)", () => {
  const req = (headers: Record<string, string>, extra: Record<string, unknown> = {}) =>
    ({ headers, ip: "10.9.9.9", originalUrl: "/api/v1/ingest/telemetry", url: "/api/v1/ingest/telemetry", query: {}, ...extra }) as never;

  it("★ Bearer K + X-API-Key ngẫu nhiên ⇒ CÙNG bucket với Bearer K (bucket theo credential auth dùng)", () => {
    const chiBearer = rl.apiKeyGenerator(req({ authorization: "Bearer K-real" }));
    for (let i = 0; i < 5; i++) {
      expect(rl.apiKeyGenerator(req({ authorization: "Bearer K-real", "x-api-key": rnd() }))).toBe(chiBearer);
    }
  });

  it("scheme viết thường / thừa khoảng trắng vẫn là cùng credential (như extractKey)", () => {
    expect(rl.apiKeyGenerator(req({ authorization: "bearer   K-real  " }))).toBe(
      rl.apiKeyGenerator(req({ authorization: "Bearer K-real" })),
    );
  });

  it("mặt phẳng MÁY: body apiKey đứng TRƯỚC cookie phiên (thủ tục máy không xác thực bằng phiên)", () => {
    const trpcReq = (cookie: string) =>
      ({
        headers: { cookie: `${COOKIE_NAME}=${cookie}` },
        ip: "10.9.9.9",
        originalUrl: "/api/trpc/machineApi.heartbeat",
        url: "/api/trpc/machineApi.heartbeat",
        query: {},
        body: { json: { apiKey: "mk_body_K" } },
      }) as never;
    expect(rl.apiKeyGenerator(trpcReq(rnd()))).toBe(rl.apiKeyGenerator(trpcReq(rnd())));
  });
});

describe("HTTP thật — xoay credential thứ hai không thoát bucket", () => {
  it("★ Bearer K + X-API-Key KHÁC ⇒ 400 conflicting_credentials, handler KHÔNG chạy, limiter không đếm", async () => {
    const truoc = handled;
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${base}/api/v1/ingest/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer K-guard", "x-api-key": rnd() },
        body: "{}",
      });
      expect(r.status).toBe(400);
      // fix round 2 — /api/v1 envelope: SDK đọc error.code
      const body = await r.json();
      expect(body).toMatchObject({ ok: false, error: { code: "conflicting_credentials" } });
      expect(typeof body.error.message).toBe("string");
    }
    expect(handled).toBe(truoc);
  });

  it("REST máy /api/machine/*: header K + body apiKey KHÁC ⇒ 400", async () => {
    const r = await fetch(`${base}/api/machine/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "K-hdr" },
      body: JSON.stringify({ apiKey: rnd() }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe("conflicting_credentials");
  });

  // ── fix round 2 — FactoryAlertSystem (in-repo) gửi Bearer <JWT phiên> + x-api-key <khoá cấu hình>
  // (authService.getAuthHeaders) cho tRPC publicProductApi.* và machineApi.* (mutation kèm apiKey body).
  it("★ FactoryAlertSystem: Bearer JWT + x-api-key KHÁC tới /api/trpc/publicProductApi.* ⇒ KHÔNG bị 400", async () => {
    const input = encodeURIComponent(JSON.stringify({ json: { apiKey: "fas-configured-key" } }));
    const r = await fetch(`${base}/api/trpc/publicProductApi.getProducts?input=${input}`, {
      method: "GET",
      headers: { accept: "application/json", authorization: "Bearer fas-session-jwt", "x-master-key": "fas-configured-key", "x-api-key": "fas-configured-key" },
    });
    expect(r.status).toBe(202);
  });

  it("FactoryAlertSystem: mutation /api/trpc/machineApi.syncMeasurementPoints (Bearer JWT + x-api-key + body apiKey) ⇒ KHÔNG bị 400", async () => {
    const r = await fetch(`${base}/api/trpc/machineApi.syncMeasurementPoints`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer fas-session-jwt", "x-api-key": "fas-configured-key" },
      body: JSON.stringify({ json: { apiKey: "fas-configured-key" } }),
    });
    expect(r.status).toBe(202);
  });

  it("★ cùng cặp (Bearer JWT + x-api-key khác) tới /api/v1/ingest/telemetry ⇒ VẪN 400", async () => {
    const r = await fetch(`${base}/api/v1/ingest/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer fas-session-jwt", "x-api-key": "fas-configured-key" },
      body: "{}",
    });
    expect(r.status).toBe(400);
  });

  it("★ /api/ot/ingest: Bearer NGẪU NHIÊN mỗi request + auth bằng machineCode ⇒ bucket theo machineCode, request thứ 6 bị 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${base}/api/ot/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${rnd()}` },
        body: JSON.stringify({ machineCode: "OT-CODE-ONLY", samples: [] }),
      });
      statuses.push(r.status);
    }
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
  });

  it("/api/ot/ingest: header X-Machine-Code cũng là danh tính bucket (Bearer ngẫu nhiên bị bỏ qua)", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${base}/api/ot/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${rnd()}`, "x-machine-code": "OT-HDR-CODE" },
        body: JSON.stringify({ samples: [] }),
      });
      statuses.push(r.status);
    }
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
  });

  it("đường hợp lệ SDK: Bearer K + X-API-Key K (CÙNG giá trị) ⇒ đi qua (202)", async () => {
    const r = await fetch(`${base}/api/v1/ingest/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer K-same", "x-api-key": "K-same" },
      body: "{}",
    });
    expect(r.status).toBe(202);
  });

  it("★ thủ tục máy: body apiKey K + cookie phiên ngẫu nhiên mỗi request ⇒ request thứ 6 bị 429 (bucket theo K)", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${base}/api/trpc/machineApi.heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${COOKIE_NAME}=${rnd()}` },
        body: JSON.stringify({ json: { apiKey: "mk_body_rotate_K" } }),
      });
      statuses.push(r.status);
    }
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
  });

  it("★ /api/v1/ingest: Bearer K (lúc hoa lúc thường) ⇒ cùng bucket, request thứ 6 bị 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${base}/api/v1/ingest/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `${i % 2 ? "bearer" : "Bearer"} K-case` },
        body: "{}",
      });
      statuses.push(r.status);
    }
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
  });
});
