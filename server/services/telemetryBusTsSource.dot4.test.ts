/**
 * doc 81 Đợt 4 Task B6 — bảng lệch giờ theo thiết bị KHÔNG gồm mẫu do SERVER đóng dấu giờ.
 *
 * Trước: mọi mẫu có `ts` đều vào bảng lệch (getTsSkewByDevice) — kể cả mẫu mà driver tự đóng `new Date()` lúc nhận
 * (Modbus, S7, MC, SLMP, EtherNet/IP, OPC UA thiếu sourceTimestamp) ⇒ lệch ≈ 0 giả, thiết bị lệch giờ thật bị che. Sau:
 * `tsSource: "server"` ⇒ không ghi quan sát lệch; `"device"` hoặc VẮNG ⇒ y như cũ (vắng = byte-identical).
 * Oracle: bảng getTsSkewByDevice + hàng đã lưu (CSDL giả trong tiến trình).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("../db/timescale", () => ({ insertOtTelemetryRows: vi.fn(async () => null) }));
const db = vi.hoisted(() => ({ stored: [] as Record<string, unknown>[] }));
const fakeDb = {
  insert: () => ({ values: (rows: Record<string, unknown>[]) => ({ onConflictDoNothing: async () => void db.stored.push(...rows) }) }),
  select: () => ({ from: () => ({ where: async () => [] }) }),
};
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fakeDb) }));
vi.mock("../_core/socket", () => ({ emitTelemetrySamples: vi.fn() }));

import { ingestTelemetry, type CanonicalSample } from "./telemetryBus";
import { getTsSkewByDevice, _resetTsDropStats, _resetLogGop } from "./ot/otGuards";
import { sampleToCanonical } from "./ot/ingest";
import { opcuaSampleTime } from "./ot/drivers/opcuaDriver";
import { wireSampleToOtSample } from "./plugins/pluginDriverBridge";
import { createStubDriver } from "./ot/drivers/stubDriver";

const sample = (dev: string, over: Partial<CanonicalSample> = {}): CanonicalSample => ({
  ts: new Date(Date.now() - 30_000),
  machineId: 1,
  deviceId: dev,
  protocol: "modbus",
  metric: "temp",
  value: 1,
  ...over,
});
const row = (dev: string) => getTsSkewByDevice(1000).find((r) => r.deviceId === dev);

beforeEach(() => {
  db.stored.length = 0;
  _resetTsDropStats();
  _resetLogGop();
});

describe("B6 — clock-drift table excludes server-stamped samples", () => {
  it("★ tsSource 'server' ⇒ persisted, but NO drift observation for the device", async () => {
    await ingestTelemetry([sample("B6-SRV", { tsSource: "server" }), sample("B6-SRV", { tsSource: "server" })]);
    expect(db.stored).toHaveLength(2);
    expect(row("B6-SRV")).toBeUndefined();
  });

  it("tsSource 'device' ⇒ recorded (≈ −30 s)", async () => {
    await ingestTelemetry([sample("B6-DEV", { tsSource: "device" })]);
    const r = row("B6-DEV")!;
    expect(r.samples).toBe(1);
    expect(r.lastSkewMs!).toBeLessThan(-29_000);
  });

  it("tsSource ABSENT ⇒ byte-identical to before (recorded exactly like 'device')", async () => {
    await ingestTelemetry([sample("B6-ABS-A"), sample("B6-ABS-A")]);
    await ingestTelemetry([sample("B6-ABS-B", { tsSource: "device" }), sample("B6-ABS-B", { tsSource: "device" })]);
    const a = row("B6-ABS-A")!;
    const b = row("B6-ABS-B")!;
    expect({ ...a, deviceId: null, lastSeenAt: null, lastSkewMs: null, medianSkewMs: null, maxSkewMs: null, minSkewMs: null }).toEqual({
      ...b,
      deviceId: null,
      lastSeenAt: null,
      lastSkewMs: null,
      medianSkewMs: null,
      maxSkewMs: null,
      minSkewMs: null,
    });
    expect(a.samples).toBe(2);
  });

  it("a server-stamped sample with an invalid ts is still REJECTED (the gate is unchanged), just not counted per device", async () => {
    const r = await ingestTelemetry([sample("B6-BAD", { tsSource: "server", ts: new Date(NaN) })]);
    expect(db.stored).toHaveLength(0);
    expect(row("B6-BAD")).toBeUndefined();
    void r;
  });
});

describe("B6 — producers declare who stamped the time", () => {
  it("sampleToCanonical carries tsSource through; absent stays absent", () => {
    const adapter = { adapterId: 1, code: "A1", machineId: 2, protocol: "modbus" } as any;
    const base = { tagKey: "t", raw: 1, value: 1, quality: "good" as const, timestamp: new Date() };
    expect(sampleToCanonical(adapter, { ...base, tsSource: "server" }).tsSource).toBe("server");
    expect(sampleToCanonical(adapter, { ...base, tsSource: "device" }).tsSource).toBe("device");
    expect("tsSource" in sampleToCanonical(adapter, base)).toBe(false);
  });

  it("OPC UA: 'device' ONLY when the DataValue carries a source timestamp", () => {
    const src = new Date("2026-10-10T01:02:03.000Z");
    expect(opcuaSampleTime({ sourceTimestamp: src })).toEqual({ timestamp: src, tsSource: "device" });
    expect(opcuaSampleTime({}).tsSource).toBe("server");
    expect(opcuaSampleTime(undefined).tsSource).toBe("server");
    expect(opcuaSampleTime({ sourceTimestamp: new Date(NaN) }).tsSource).toBe("server");
  });

  it("plugin sidecar: no timestamp ⇒ 'server'; a zoned timestamp ⇒ 'device'", () => {
    expect(wireSampleToOtSample({ tagKey: "t", value: 1 } as any).tsSource).toBe("server");
    expect(wireSampleToOtSample({ tagKey: "t", value: 1, timestamp: "2026-10-10T01:02:03Z" } as any).tsSource).toBe("device");
  });

  it("stub driver (self-stamped) ⇒ 'server'", async () => {
    const d = createStubDriver();
    await d.connect({ endpoint: "stub://x" } as any);
    const [s] = await d.readTags([{ tagKey: "t", address: "a", dataType: "float" } as any]);
    expect(s.tsSource).toBe("server");
    await d.disconnect();
  });

  it("census: every self-stamped sample literal in the OT drivers declares tsSource 'server'", () => {
    const dir = path.resolve(__dirname, "ot/drivers");
    const offenders: string[] = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith("Driver.ts"))) {
      const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n");
      lines.forEach((l, i) => {
        if (/timestamp: (now\(\)|new Date\(\)|new Date\(now\))/.test(l)) {
          const near = lines.slice(i, i + 3).join("\n");
          if (!/tsSource: "server"/.test(near)) offenders.push(`${f}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
