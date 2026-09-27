/**
 * doc 81 Đợt 1B Task 7 — POST /api/ot/ingest qua HTTP THẬT (express trên 127.0.0.1:0), handler
 * THẬT (`createOtIngestHandler`) + bus THẬT (`ingestTelemetryDetailed`); chỉ DB bị giả.
 *
 * DB giả mô phỏng Postgres theo tài liệu (trần 65535 tham số bind/câu; 11 cột mỗi dòng) và có
 * công tắc "sập" (ECONNREFUSED) — KHÔNG gọi mã sản phẩm. Xác thực máy được thay bằng một hàm giả
 * đếm lượt gọi: bài này đo HỢP ĐỒNG mã HTTP/thân phản hồi, không đo khoá máy (đã có test riêng).
 * Bản chạy trên CSDL `_test` thật: otIngestRoute.db.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../db/timescale", () => ({ insertOtTelemetryRows: vi.fn(async () => null) }));
const db = vi.hoisted(() => ({ down: false, stored: 0 }));
const pgInsert = (rows: unknown[]) => {
  if (db.down) throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5434"), { code: "ECONNREFUSED" });
  if (rows.length * 11 > 65535) throw Object.assign(new Error("Max number of parameters (65535) exceeded"), { code: "MAX_PARAMETERS_EXCEEDED" });
  db.stored += rows.length;
};
vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({
    insert: () => ({ values: (rows: unknown[]) => ({ onConflictDoNothing: async () => pgInsert(rows) }) }),
    select: () => ({ from: () => ({ where: async () => [] }) }),
  })),
}));
vi.mock("./socket", () => ({ emitTelemetrySamples: vi.fn() }));

import { createOtIngestHandler, otIngestHttpStatus } from "./otIngestRoute";
import { ingestTelemetryDetailed } from "../services/telemetryBus";

let authCalls = 0;
let authFail: "UNAUTHORIZED" | null = null;
const authenticateMachine = async () => {
  authCalls += 1;
  if (authFail) throw Object.assign(new Error("Invalid API key"), { code: authFail });
  // Task 8 fix round 1 (R17): máy thật luôn có id; "T7-GW" là GATEWAY (chuyển tiếp nhiều deviceId).
  // Đợt 1C Task 4: gateway không còn được miễn — nó chỉ ghi cho thiết bị trong allowlist, nên ca T7
  // tiêm allowlist {T7-DEV (id 7)} khớp đúng mẫu `sample()`. Các ca ở đây đo sổ sách/mã HTTP; luật
  // allowlist có nghiệm thu riêng trên DB thật (api/v1/ingestRangBuoc.db.test.ts, khối "Task 4").
  return { machine: { id: 7007, code: "T7-GW", machineType: "IOT_GATEWAY" } };
};
let allowlistHong = false;
const thietBiDuocPhepCuaGateway = async () => {
  if (allowlistHong) throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5434"), { code: "ECONNREFUSED" });
  return [{ id: 7, code: "T7-DEV" }];
};

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "25mb" })); // = DEFAULT_BODY_LIMIT của _core/index.ts
  app.post("/api/ot/ingest", createOtIngestHandler({ authenticateMachine, ingestTelemetryDetailed, thietBiDuocPhepCuaGateway }));
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  db.down = false;
  db.stored = 0;
  authCalls = 0;
  authFail = null;
  allowlistHong = false;
  delete process.env.OT_INGEST_MAX_BATCH;
});

const NOW = Date.now();
const sample = (i: number, ts: unknown = new Date(NOW - 60_000 + i).toISOString()) => ({
  ts,
  deviceId: "T7-DEV",
  machineId: 7,
  protocol: "modbus",
  metric: "temp",
  value: i,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => sample(i));
async function post(samples: unknown[]) {
  const r = await fetch(`${base}/api/ot/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "mk_test" },
    body: JSON.stringify({ samples }),
  });
  return { status: r.status, body: (await r.json()) as any };
}

describe("T7 — đường hợp lệ cũ KHÔNG đổi (1–2000 mẫu ⇒ 200, accepted === received, thân y cũ)", () => {
  it.each([1, 2000])("%i mẫu hợp lệ ⇒ 200 {ok, accepted, received, machine}", async (n) => {
    const r = await post(many(n));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, accepted: n, received: n, machine: "T7-GW" });
    expect(db.stored).toBe(n);
  });
});

describe("T7 — lô lớn / trần", () => {
  it("★ 12.000 mẫu ⇒ 200 và lưu đủ (trước: 200 accepted:0)", async () => {
    const r = await post(many(12000));
    expect(r.status).toBe(200);
    expect(r.body.accepted).toBe(12000);
    expect(db.stored).toBe(12000);
  });

  it("★ 20.001 mẫu ⇒ 413, KHÔNG gọi xác thực, KHÔNG ghi DB; 20.000 ⇒ 200", async () => {
    const big = await post(many(20001));
    expect(big.status).toBe(413);
    expect(big.body).toMatchObject({ ok: false, code: "batch_too_large", received: 20001, maxBatch: 20000 });
    expect(authCalls).toBe(0);
    expect(db.stored).toBe(0);
    const ok = await post(many(20000));
    expect(ok.status).toBe(200);
    expect(db.stored).toBe(20000);
  });

  it("OT_INGEST_MAX_BATCH cấu hình được", async () => {
    process.env.OT_INGEST_MAX_BATCH = "10";
    expect((await post(many(11))).status).toBe(413);
    expect((await post(many(10))).status).toBe(200);
  });
});

describe("T7 — phản hồi trung thực", () => {
  it("★ lô trộn 3 mẫu ts sai ⇒ 207, đúng 3 chỉ số bị loại", async () => {
    const s = many(50);
    s[4] = sample(4, "rác");
    s[17] = sample(17, "2026-02-30T25:61:00Z");
    s[33] = sample(33, new Date(NOW + 2 * 86_400_000).toISOString());
    const r = await post(s);
    expect(r.status).toBe(207);
    expect(r.body).toMatchObject({ ok: false, code: "partial", accepted: 47, received: 50, rejectedCount: 3 });
    expect(r.body.rejected).toEqual([
      { index: 4, reason: "invalid_ts" },
      { index: 17, reason: "invalid_ts" },
      { index: 33, reason: "ts_too_far_future" },
    ]);
    expect(db.stored).toBe(47);
  });

  it("★ cả lô ts hỏng ⇒ 400 (gửi lại vô ích), không ghi gì", async () => {
    const r = await post([sample(0, "x"), sample(1, "y")]);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ ok: false, code: "all_rejected", accepted: 0, received: 2, rejectedCount: 2 });
    expect(db.stored).toBe(0);
  });

  it("★ DB giả lỗi ⇒ 503 (không bao giờ 200 ok:true với accepted 0)", async () => {
    db.down = true;
    const r = await post(many(5));
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, code: "db_unavailable", accepted: 0, received: 5 });
    expect(r.body.rejected.every((x: { reason: string }) => x.reason === "db_error")).toBe(true);
  });

  it("xác thực hỏng vẫn 401 (không đổi)", async () => {
    authFail = "UNAUTHORIZED";
    expect((await post(many(1))).status).toBe(401);
  });

  it("★ Đợt 1C Task 4 — đọc allowlist gateway HỎNG ⇒ 503 db_unavailable (gửi lại được), KHÔNG ghi gì, không đoán cho qua", async () => {
    allowlistHong = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await post(many(3));
      expect(r.status).toBe(503);
      expect(r.body).toMatchObject({ ok: false, code: "db_unavailable" });
      expect(db.stored).toBe(0);
    } finally {
      err.mockRestore();
    }
  });

  it("body rỗng vẫn 400 như cũ", async () => {
    const r = await post([]);
    expect(r.status).toBe(400);
  });
});

describe("otIngestHttpStatus — bảng quyết định (dùng lại ở Task 8)", () => {
  it("không bao giờ 200 khi accepted < received", () => {
    expect(otIngestHttpStatus({ received: 3, accepted: 3, rejected: [] })).toBe(200);
    expect(otIngestHttpStatus({ received: 3, accepted: 2, rejected: [{ index: 0, reason: "invalid_ts" }] })).toBe(207);
    expect(otIngestHttpStatus({ received: 3, accepted: 2, rejected: [{ index: 0, reason: "db_error" }] })).toBe(207);
    expect(
      otIngestHttpStatus({ received: 2, accepted: 0, rejected: [{ index: 0, reason: "invalid_ts" }, { index: 1, reason: "db_error" }] }),
    ).toBe(503);
    expect(otIngestHttpStatus({ received: 1, accepted: 0, rejected: [{ index: 0, reason: "invalid_value" }] })).toBe(400);
  });
});
