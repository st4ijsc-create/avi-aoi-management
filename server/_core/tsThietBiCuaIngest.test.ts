/**
 * doc 81 Đợt 1C Task 6 — LUẬT DUY NHẤT cho `ts` KHÔNG múi giờ ở MỌI cửa ingest (ruling R-1C-a,
 * lựa chọn (a): từ chối `ts_no_timezone`) + số đo lệch giờ theo thiết bị.
 *
 * Mỗi cửa được thử với BA dạng chuỗi — naive, `Z`, offset — và oracle là INSTANT cố định tính bằng
 * `Date.UTC(...)` (hàm dựng sẵn của JS, KHÔNG gọi mã sản phẩm):
 *   "2026-09-27T03:00:00.000Z" ≡ "2026-09-27T10:00:00+07:00" ≡ "2026-09-26T22:00:00-0500"
 *     ≡ Date.UTC(2026, 8, 27, 3, 0, 0)
 *   "2026-09-27T10:00:00" (naive) ⇒ bị từ chối `ts_no_timezone`, KHÔNG ghi dòng nào.
 *
 * Trước bản vá, naive đi `new Date(naive)` = giờ TIẾN TRÌNH Node (Asia/Bangkok ở máy dev ⇒ đúng tình
 * cờ; container TZ=UTC ⇒ +7 h tương lai) và được GHI. Test ép `process.env.TZ` không được vì V8 đã
 * nạp múi giờ — nên khẳng định là "bị từ chối", không phải "ghi đúng giờ".
 *
 * Cửa được thử: POST /api/ot/ingest (handler thật) · POST /api/v1/ingest/telemetry (router thật) ·
 * cầu MQTT `synapse/…/telemetry` (parseCanonicalTelemetry) · MTConnect (parseStreamsXml + mapReadings)
 * · CFX (parseAndMapCfx) · plugin driver (wireSampleToOtSample + sampleToCanonical) · cảm biến MQTT
 * `factory/…/sensor` (handleSensorMessage). Chỉ DB bị giả (bắt dòng được ghi); express chạy 127.0.0.1:0.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../db/timescale", () => ({ insertOtTelemetryRows: vi.fn(async () => null) }));
const db = vi.hoisted(() => ({ stored: [] as Array<Record<string, unknown>>, sensor: [] as Array<Record<string, unknown>> }));
vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({
    insert: () => ({
      values: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        if (arr.some((r) => "sensorType" in r)) db.sensor.push(...arr);
        return { onConflictDoNothing: async () => { db.stored.push(...arr); } };
      },
    }),
    select: () => ({ from: () => ({ where: async () => [] }) }),
  })),
}));
vi.mock("./socket", () => ({ emitTelemetrySamples: vi.fn() }));
// /api/v1 — khoá MASTER (mọi scope), không bảng api_keys.
vi.mock("./masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
  getMachineById: vi.fn(async () => undefined),
  getMachines: vi.fn(async () => []),
  getMachineByApiKey: vi.fn(async () => undefined),
}));
vi.mock("../routers", () => ({ appRouter: { createCaller: () => ({}) } }));
vi.mock("./context", () => ({ createContext: vi.fn(async () => ({})) }));
// mqttService — cùng shim với mqttTelemetryBridge.test.ts (không broker, không DB).
vi.mock("../services/unsPublisher", () => ({
  initUnsPublisher: vi.fn(),
  publishNormalized: vi.fn(),
  publishAoiBridge: vi.fn(),
  publishNdeathGraceful: vi.fn(),
  shutdownUnsPublisher: vi.fn(),
}));
vi.mock("../services/uns/aoiBridge", () => ({ mapAoiTopicToSparkplug: vi.fn(() => null) }));

import { createOtIngestHandler } from "./otIngestRoute";
import { createV1Router } from "../api/v1/router";
import { ingestTelemetryDetailed, type CanonicalSample } from "../services/telemetryBus";
import { parseCanonicalTelemetry } from "../services/mqttService";
import { parseStreamsXml } from "../services/mtconnect/mtconnectClient";
import { mapReadings } from "../services/mtconnect/mtconnectPoller";
import { parseAndMapCfx } from "../services/cfx/cfxMessages";
import { wireSampleToOtSample } from "../services/plugins/pluginDriverBridge";
import { sampleToCanonical } from "../services/ot/ingest";
import { handleSensorMessage } from "../services/sensorIngestService";
import { getStatus } from "../services/ot/storeForward";
import { _resetLogGop, _resetTsDropStats } from "../services/ot/otGuards";
import { docTsThietBi } from "../utils/factoryTime";

/** ORACLE — instant cố định, tính bằng Date.UTC (không phải mã sản phẩm). */
const T = Date.UTC(2026, 8, 27, 3, 0, 0);
const TS_Z = "2026-09-27T03:00:00.000Z";
const TS_P7 = "2026-09-27T10:00:00+07:00";
const TS_M5 = "2026-09-26T22:00:00-0500";
const TS_NAIVE = "2026-09-27T10:00:00";

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.post(
    "/api/ot/ingest",
    createOtIngestHandler({
      authenticateMachine: async () => ({ machine: { id: 7, code: "T6-DEV", machineType: "IOT_SENSOR" } }),
      ingestTelemetryDetailed,
    }),
  );
  app.use("/api/v1", createV1Router());
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  db.stored.length = 0;
  db.sensor.length = 0;
  _resetLogGop();
  _resetTsDropStats();
});

const mau = (ts: unknown, metric: string) => ({ ts, deviceId: "T6-DEV", machineId: 7, protocol: "modbus", metric, value: 1 });
async function post(p: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as any };
}
const tsCuaDongDaGhi = () => db.stored.map((r) => (r.ts as Date).getTime());

describe("docTsThietBi — bảng luật (oracle Date.UTC)", () => {
  it.each([
    [TS_Z, { ok: true, t: T }],
    [TS_P7, { ok: true, t: T }],
    [TS_M5, { ok: true, t: T }],
    ["2026-09-27T03:00:00z", { ok: true, t: T }],
    [TS_NAIVE, { ok: false, reason: "ts_no_timezone" }],
    ["2026-09-27 10:00:00", { ok: false, reason: "ts_no_timezone" }],
    ["2026-09-27", { ok: false, reason: "ts_no_timezone" }],
    ["rác", { ok: false, reason: "invalid_ts" }],
    ["2026-02-30T25:61:00Z", { ok: false, reason: "invalid_ts" }],
  ])("%s", (raw, ky) => {
    const k = docTsThietBi(raw);
    if (ky.ok) expect(k.ok && k.ts?.getTime()).toBe(ky.t);
    else expect(k).toEqual({ ok: false, reason: ky.reason });
  });
  it("vắng/rỗng ⇒ ts undefined (giờ server, hành vi cũ); epoch-ms và Date nhận nguyên", () => {
    expect(docTsThietBi(undefined)).toEqual({ ok: true, ts: undefined });
    expect(docTsThietBi("")).toEqual({ ok: true, ts: undefined });
    expect(docTsThietBi(T)).toEqual({ ok: true, ts: new Date(T) });
    expect(docTsThietBi(new Date(T))).toEqual({ ok: true, ts: new Date(T) });
  });
});

describe("cửa 1 — POST /api/ot/ingest", () => {
  it("★ Z / +07:00 / -0500 ⇒ ghi đúng instant; naive ⇒ 207 với reason ts_no_timezone, KHÔNG ghi", async () => {
    const r = await post("/api/ot/ingest", { samples: [mau(TS_Z, "a"), mau(TS_P7, "b"), mau(TS_M5, "c"), mau(TS_NAIVE, "d")] }, { "x-api-key": "mk_x" });
    expect(r.status).toBe(207);
    expect(r.body.rejected).toEqual([{ index: 3, reason: "ts_no_timezone" }]);
    expect(tsCuaDongDaGhi()).toEqual([T, T, T]);
  });
  it("★ cả lô naive ⇒ 400 all_rejected, 0 dòng, bộ đếm droppedNoTimezone tăng", async () => {
    const r = await post("/api/ot/ingest", { samples: [mau(TS_NAIVE, "a"), mau("2026-09-27 10:00:00", "b")] }, { "x-api-key": "mk_x" });
    expect(r.status).toBe(400);
    expect(r.body.rejected).toEqual([
      { index: 0, reason: "ts_no_timezone" },
      { index: 1, reason: "ts_no_timezone" },
    ]);
    expect(db.stored).toHaveLength(0);
    expect(getStatus().droppedNoTimezone).toBe(2);
  });
});

describe("cửa 2 — POST /api/v1/ingest/telemetry", () => {
  it("★ Z / +07:00 / -0500 ⇒ ghi đúng instant; naive ⇒ 207 reason ts_no_timezone, KHÔNG ghi", async () => {
    const r = await post("/api/v1/ingest/telemetry", { samples: [mau(TS_Z, "a"), mau(TS_P7, "b"), mau(TS_M5, "c"), mau(TS_NAIVE, "d")] }, { authorization: "Bearer MASTER" });
    expect(r.status).toBe(207);
    expect(r.body.error?.details?.rejected ?? r.body.rejected).toEqual([{ index: 3, reason: "ts_no_timezone" }]);
    expect(tsCuaDongDaGhi()).toEqual([T, T, T]);
  });
  it("đường hợp lệ cũ (ts có offset) vẫn 202 như trước", async () => {
    const r = await post("/api/v1/ingest/telemetry", { samples: [mau(TS_P7, "a")] }, { authorization: "Bearer MASTER" });
    expect(r.status).toBe(202);
    expect(tsCuaDongDaGhi()).toEqual([T]);
  });
});

describe("cửa 3 — cầu MQTT synapse/…/telemetry", () => {
  const khung = (ts: string) => JSON.stringify({ asset_id: "machine:7", ts, metrics: [{ name: "temp", value: 1 }] });
  it("★ Z / offset ⇒ đúng instant; naive ⇒ mẫu mang tsReject và bus loại ts_no_timezone", async () => {
    const topic = "synapse/f/a/l/c/m/telemetry";
    const [z] = parseCanonicalTelemetry(topic, khung(TS_Z));
    const [p7] = parseCanonicalTelemetry(topic, khung(TS_P7));
    const [nv] = parseCanonicalTelemetry(topic, khung(TS_NAIVE));
    expect(z.ts?.getTime()).toBe(T);
    expect(p7.ts?.getTime()).toBe(T);
    const r = await ingestTelemetryDetailed([z, nv]);
    expect(r.rejected).toEqual([{ index: 1, reason: "ts_no_timezone" }]);
    expect(tsCuaDongDaGhi()).toEqual([T]);
  });
});

describe("cửa 4 — MTConnect", () => {
  const xml = (ts: string) =>
    `<MTConnectStreams><Streams><DeviceStream name="M1" uuid="M1"><ComponentStream component="Linear">` +
    `<Samples><Position dataItemId="Xact" timestamp="${ts}">1.5</Position></Samples>` +
    `<Events><Execution dataItemId="exec" timestamp="${ts}">ACTIVE</Execution></Events>` +
    `</ComponentStream></DeviceStream></Streams></MTConnectStreams>`;
  const ctx = { adapterId: 1, machineId: 7, machineCode: "T6-DEV" };
  it("★ Z / offset ⇒ đúng instant (mẫu + sự kiện); naive ⇒ mẫu bị bus loại ts_no_timezone, sự kiện KHÔNG ghi", async () => {
    for (const ts of [TS_Z, TS_P7, TS_M5]) {
      const m = mapReadings(parseStreamsXml(xml(ts)), ctx);
      expect(m.telemetry[0].ts?.getTime()).toBe(T);
      expect(m.events.map((e) => (e.measuredAt as Date).getTime())).toEqual([T]);
    }
    const nv = mapReadings(parseStreamsXml(xml(TS_NAIVE)), ctx);
    expect(nv.events).toEqual([]);
    const r = await ingestTelemetryDetailed(nv.telemetry);
    expect(r.rejected).toEqual([{ index: 0, reason: "ts_no_timezone" }]);
    expect(db.stored).toHaveLength(0);
  });
});

describe("cửa 5 — IPC-CFX", () => {
  const env = (ts: string) => ({
    MessageName: "CFX.Production.UnitsProcessed",
    Source: "SMT.P1",
    TimeStamp: ts,
    MessageBody: { UnitProcessData: [{ UnitIdentifier: "U1", OverallResult: "Passed" }] },
  });
  it("★ Z / offset ⇒ đúng instant; naive ⇒ bus loại ts_no_timezone", async () => {
    for (const ts of [TS_Z, TS_P7, TS_M5]) {
      const s = parseAndMapCfx(env(ts), undefined, { machineId: 7, machineCode: "T6-DEV" });
      expect(s.length).toBeGreaterThan(0);
      expect(s.every((x) => x.ts?.getTime() === T)).toBe(true);
    }
    const nv = parseAndMapCfx(env(TS_NAIVE), undefined, { machineId: 7, machineCode: "T6-DEV" });
    const r = await ingestTelemetryDetailed(nv);
    expect(r.accepted).toBe(0);
    expect(r.rejected.every((x) => x.reason === "ts_no_timezone")).toBe(true);
  });
});

describe("cửa 6 — plugin driver (sidecar)", () => {
  const adapter = { adapterId: 3, code: "T6-DEV", machineId: 7, protocol: "stub" } as never;
  it("★ Z / offset ⇒ đúng instant; naive ⇒ bus loại ts_no_timezone", async () => {
    for (const ts of [TS_Z, TS_P7, TS_M5]) {
      expect(sampleToCanonical(adapter, wireSampleToOtSample({ tagKey: "t", value: 1, timestamp: ts })).ts?.getTime()).toBe(T);
    }
    const nv = sampleToCanonical(adapter, wireSampleToOtSample({ tagKey: "t", value: 1, timestamp: TS_NAIVE }));
    const r = await ingestTelemetryDetailed([nv]);
    expect(r.rejected).toEqual([{ index: 0, reason: "ts_no_timezone" }]);
  });
});

describe("cửa 7 — cảm biến MQTT factory/…/sensor (machine_sensor_readings)", () => {
  beforeEach(() => {
    process.env.PDM_SENSOR_INGEST_ENABLED = "true";
    delete process.env.SENSOR_INGEST_BATCH_ENABLED;
  });
  const topic = "factory/1/T6-DEV/sensor/vibration";
  it("★ Z / offset ⇒ ghi đúng instant; naive ⇒ KHÔNG ghi; tương lai > 24 h ⇒ KHÔNG ghi (cùng luật bus)", async () => {
    for (const ts of [TS_Z, TS_P7, TS_M5]) {
      expect(await handleSensorMessage(topic, JSON.stringify({ value: 1, timestamp: ts }), { machineId: 7 })).toBe(true);
    }
    expect(db.sensor.map((r) => (r.timestamp as Date).getTime())).toEqual([T, T, T]);
    expect(await handleSensorMessage(topic, JSON.stringify({ value: 1, timestamp: TS_NAIVE }), { machineId: 7 })).toBe(false);
    const xa = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(await handleSensorMessage(topic, JSON.stringify({ value: 1, timestamp: xa }), { machineId: 7 })).toBe(false);
    expect(db.sensor).toHaveLength(3);
    const st = getStatus();
    expect(st.droppedNoTimezone).toBe(1);
    expect(st.droppedFutureSkew).toBe(1);
  });
});

describe("số đo lệch giờ theo thiết bị (storeForward.getStatus().skewByDevice)", () => {
  const H = 3_600_000;
  const s = (deviceId: string, machineId: number, lechMs: number, metric: string): CanonicalSample => ({
    ts: new Date(Date.now() + lechMs),
    deviceId,
    machineId,
    protocol: "modbus",
    metric,
    value: 1,
  });
  it("★ trung vị / lớn nhất / nhỏ nhất theo thiết bị — kể cả mẫu bị loại vì > 24 h; thiết bị lệch nhiều xếp đầu", async () => {
    await ingestTelemetryDetailed([
      s("DEV-A", 11, -1 * H, "m1"),
      s("DEV-A", 11, 2 * H, "m2"),
      s("DEV-A", 11, 30 * H, "m3"), // bị loại ts_too_far_future — vẫn phải hiện trong số đo
      s("DEV-B", 12, 1_000, "m4"),
      s("DEV-B", 12, 3_000, "m5"),
      { ts: undefined, deviceId: "DEV-C", machineId: 13, protocol: "modbus", metric: "m6", value: 1 }, // giờ server ⇒ không đo
      { ...s("DEV-B", 12, 0, "m7"), ts: undefined, tsReject: "ts_no_timezone" },
    ]);
    const bang = getStatus().skewByDevice;
    const a = bang.find((x) => x.deviceId === "DEV-A")!;
    const b = bang.find((x) => x.deviceId === "DEV-B")!;
    expect(bang[0].deviceId).toBe("DEV-A");
    expect(bang.some((x) => x.deviceId === "DEV-C")).toBe(false);
    expect(a.machineId).toBe(11);
    expect(a.samples).toBe(3);
    expect(Math.abs(a.medianSkewMs! - 2 * H)).toBeLessThan(5_000);
    expect(Math.abs(a.maxSkewMs! - 30 * H)).toBeLessThan(5_000);
    expect(Math.abs(a.minSkewMs! + 1 * H)).toBeLessThan(5_000);
    expect(a.droppedFutureSkew).toBe(1);
    expect(b.samples).toBe(2);
    expect(Math.abs(b.medianSkewMs! - 2_000)).toBeLessThan(5_000);
    expect(b.droppedNoTimezone).toBe(1);
  });
});
