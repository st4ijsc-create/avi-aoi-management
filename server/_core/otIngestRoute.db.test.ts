/**
 * doc 81 Đợt 1B Task 7 — NGHIỆM THU trên CSDL THẬT (`_test`, ép bởi vitest.setup).
 *
 * BE3 §L4 đo trên instance riêng: POST /api/ot/ingest với 7.000 / 8.000 / 12.000 mẫu ⇒
 * `200 {ok:true, accepted:0}`, 0 dòng — trần 65535 tham số bind của Postgres. Ở đây: handler
 * THẬT + bus THẬT + Postgres THẬT, qua HTTP thật (express 127.0.0.1:0). Chỉ xác thực máy được
 * thay (đếm lượt gọi) — khoá máy có test riêng, không phải đối tượng của phép đo này.
 *
 * ORACLE ĐỘC LẬP: số dòng đếm bằng một client `postgres` RIÊNG (`SELECT count(*)`), không qua
 * drizzle/bus. Hàng test mang tiền tố DAU (duy nhất theo lượt) và được dọn trong afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import postgres from "postgres";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("./socket", () => ({ emitTelemetrySamples: vi.fn() }));

import { createOtIngestHandler } from "./otIngestRoute";
import { ingestTelemetryDetailed, wireStoreForward } from "../services/telemetryBus";
import { restore, backfill, buffer, getStatus, _reset } from "../services/ot/storeForward";

const DAU = `T7DB-${Date.now()}`;
const sqlc = postgres(process.env.DATABASE_URL as string, { max: 2 });
const countDev = async (dev: string): Promise<number> =>
  Number((await sqlc`SELECT count(*)::int AS n FROM ot_telemetry WHERE "deviceId" = ${dev}`)[0].n);

let server: Server;
let base = "";
let walDir = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.post(
    "/api/ot/ingest",
    createOtIngestHandler({
      // Task 8 (R17): máy thật luôn có id; "T7-GW" là GATEWAY. Đợt 1C Task 4: gateway chỉ ghi cho
      // thiết bị trong allowlist ⇒ tiêm allowlist phủ đúng các deviceId mà ca T7 gửi (id giả — cột
      // ot_telemetry."machineId" không có FK; dòng dọn theo deviceId). Các ca ở đây đo sổ sách/WAL,
      // luật allowlist nghiệm thu riêng ở api/v1/ingestRangBuoc.db.test.ts (khối "Task 4").
      authenticateMachine: async () => ({ machine: { id: 7007, code: "T7-GW", machineType: "IOT_GATEWAY" } }),
      ingestTelemetryDetailed,
      thietBiDuocPhepCuaGateway: async () =>
        ["7000", "12000", "mix", "retry", "nul"].map((h, i) => ({ id: 990_700_001 + i, code: `${DAU}-${h}` })),
    }),
  );
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  walDir = await fsp.mkdtemp(path.join(os.tmpdir(), "t7-db-wal-"));
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await sqlc`DELETE FROM ot_telemetry WHERE "deviceId" LIKE ${DAU + "%"}`;
  await sqlc`DELETE FROM ot_telemetry WHERE "deviceId" IS NULL AND metric = ${DAU + "-nulldev"}`;
  await sqlc.end();
  _reset();
  delete process.env.OT_STORE_FORWARD_ENABLED;
  delete process.env.OT_STORE_FORWARD_FILE;
  await fsp.rm(walDir, { recursive: true, force: true });
});

const T0 = Date.now() - 3_600_000;
const batch = (dev: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    ts: new Date(T0 + i).toISOString(),
    deviceId: dev,
    protocol: "modbus",
    metric: "t7_temp",
    value: i,
  }));
async function post(samples: unknown[]) {
  const r = await fetch(`${base}/api/ot/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "mk_t7" },
    body: JSON.stringify({ samples }),
  });
  return { status: r.status, body: (await r.json()) as any };
}

describe("T7 — CSDL _test thật: lô lớn lưu ĐỦ", () => {
  it.each([7000, 12000])(
    "★ POST %i mẫu ⇒ 200, accepted === received, số dòng DB đúng bằng số gửi",
    async (n) => {
      const dev = `${DAU}-${n}`;
      const r = await post(batch(dev, n));
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true, accepted: n, received: n, machine: "T7-GW" });
      expect(await countDev(dev)).toBe(n);
    },
    60_000,
  );

  it("★ lô trộn 3 mẫu ts sai ⇒ 207, đúng 3 bị loại, DB có đúng n−3 dòng", async () => {
    const dev = `${DAU}-mix`;
    const s: Array<Record<string, unknown>> = batch(dev, 100);
    s[10] = { ...s[10], ts: "không-phải-ngày" };
    s[50] = { ...s[50], ts: "2026-02-30T25:61:00Z" };
    s[99] = { ...s[99], ts: new Date(Date.now() + 3 * 86_400_000).toISOString() };
    const r = await post(s);
    expect(r.status).toBe(207);
    expect(r.body.accepted).toBe(97);
    expect(r.body.rejected).toEqual([
      { index: 10, reason: "invalid_ts" },
      { index: 50, reason: "invalid_ts" },
      { index: 99, reason: "ts_too_far_future" },
    ]);
    expect(await countDev(dev)).toBe(97);
  }, 30_000);

  it("gửi lại đúng lô 200 mẫu (retry) ⇒ 200 và KHÔNG nhân đôi dòng (ON CONFLICT DO NOTHING)", async () => {
    const dev = `${DAU}-retry`;
    expect((await post(batch(dev, 200))).status).toBe(200);
    const again = await post(batch(dev, 200));
    expect(again.status).toBe(200);
    expect(await countDev(dev)).toBe(200);
  }, 30_000);

  it("★ Postgres từ chối DỮ LIỆU một dòng (byte NUL) ⇒ 207 invalid_value đúng dòng đó, các dòng khác lưu", async () => {
    const dev = `${DAU}-nul`;
    const s: Array<Record<string, unknown>> = batch(dev, 30);
    s[7] = { ...s[7], metric: "t7\u0000temp" };
    const r = await post(s);
    expect(r.status).toBe(207);
    expect(r.body.rejected).toEqual([{ index: 7, reason: "invalid_value" }]);
    expect(await countDev(dev)).toBe(29);
  }, 30_000);
});

describe("T7 — CSDL _test thật: WAL chứa dòng hỏng ⇒ replay vẫn lưu các dòng tốt", () => {
  it("★ restore bỏ dòng hỏng; backfill cách ly dòng Postgres từ chối; dòng tốt vào DB", async () => {
    const dev = `${DAU}-wal`;
    process.env.OT_STORE_FORWARD_ENABLED = "true";
    process.env.OT_STORE_FORWARD_FILE = path.join(walDir, "ot-store-forward.jsonl");
    _reset();
    const line = (metric: string, ts: string) =>
      JSON.stringify({
        key: `${dev}|${metric}|${ts}`,
        enqueuedAt: Date.now(),
        row: { ts, deviceId: dev, protocol: "modbus", metric, numValue: 1, quality: "good" },
      });
    const t = (k: number) => new Date(T0 + k).toISOString();
    await fsp.writeFile(
      process.env.OT_STORE_FORWARD_FILE,
      [
        line("good_a", t(1)),
        line("bad_ts", "rác"),
        '{"key":"cut","row":{"ts":"2026-09-2', // dòng cụt do tiến trình chết giữa lúc ghi (writer cũ)
        line("po\u0000ison", t(2)), // Postgres từ chối (22021) — phải bị cách ly, không chặn dòng sau
        line("good_b", t(3)),
        line("good_c", t(4)),
      ].join("\n") + "\n",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await restore()).toBe(4);
      expect(getStatus().corruptLinesSkipped).toBe(2);
      await wireStoreForward();
      const r = await backfill();
      expect(r.remaining).toBe(0);
      expect(r.drained).toBe(3);
      expect(getStatus().quarantined).toBe(1);
    } finally {
      warn.mockRestore();
    }
    const rows = await sqlc`SELECT metric FROM ot_telemetry WHERE "deviceId" = ${dev} ORDER BY ts`;
    expect(rows.map((x) => x.metric)).toEqual(["good_a", "good_b", "good_c"]);
  }, 30_000);
});

describe("T7 fix r1 — CSDL _test thật: backfill KHÔNG nhân đôi khối đã lưu (deviceId NULL, NULLS DISTINCT)", () => {
  it("★ drain batch 2500, khối 2 có dòng Postgres từ chối ⇒ 0 dòng trùng, đúng 2499 dòng", async () => {
    process.env.OT_STORE_FORWARD_ENABLED = "true";
    process.env.OT_STORE_FORWARD_FILE = path.join(walDir, "ot-sf-dup.jsonl");
    process.env.OT_STORE_FORWARD_DRAIN_BATCH = "2500";
    _reset();
    const metric = `${DAU}-nulldev`;
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      ts: new Date(T0 + i),
      deviceId: null,
      protocol: "modbus" as const,
      metric: i === 1500 ? `${metric}\u0000x` : metric,
      numValue: i,
      textValue: null,
      boolValue: null,
      unit: null,
      quality: "good" as const,
      meta: { adapterId: DAU, tagKey: `k${i}` },
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await buffer(rows)).toBe(2500);
      await wireStoreForward();
      const r = await backfill();
      expect(r.remaining).toBe(0);
    } finally {
      warn.mockRestore();
      err.mockRestore();
      delete process.env.OT_STORE_FORWARD_DRAIN_BATCH;
    }
    const [{ n, d }] = await sqlc`SELECT count(*)::int AS n, count(DISTINCT "numValue")::int AS d
      FROM ot_telemetry WHERE "deviceId" IS NULL AND metric = ${metric}`;
    expect({ n, d }).toEqual({ n: 2499, d: 2499 });
  }, 60_000);
});
