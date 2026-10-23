/**
 * SCADA R0 (cổng "sau khi nối lại ⇒ good trong ≤ 2 chu kỳ poll") — nối lại NHANH 10 lần đầu của đợt mất, sau đó backoff lũy thừa.
 * Fake timers; driver giả; supervisor THẬT (HA) và otManager THẬT (legacy, deviceAdapter/ingest giả).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  OtDriver,
  OtTagAddress,
  OtSample,
  OtSubscriptionHandle,
  OnOtSample,
  OtHealth,
  OtCommandResult,
  OtConnectionConfig,
} from "./otDriver";
import type { RuntimeAdapter } from "./deviceAdapter";
import { ConnectionSupervisor } from "./connectionSupervisor";
import { khoangNoiLaiMs, khoangNoiLaiNhanhMs, NOI_LAI_NHANH_SO_LAN } from "./reconnectNhanh";
import { layTrangThaiAdapter, __datLaiTrangThaiAdapter } from "./trangThaiAdapter";

const hoisted = vi.hoisted(() => ({ adapters: [] as unknown[] }));
vi.mock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => hoisted.adapters }));
vi.mock("./ingest", () => ({ ingestSample: async () => undefined, ingestSamples: async () => undefined }));

const TAGS: OtTagAddress[] = [{ tagKey: "t1", address: "a1", dataType: "float" }];

/** Driver giả: `down` ⇒ connect ném, isConnected false; ghi lại thời điểm mỗi lần connect. */
class DriverGia implements OtDriver {
  readonly protocol = "stub" as const;
  down = false;
  connected = false;
  connectTimes: number[] = [];
  async connect(_c?: OtConnectionConfig): Promise<void> {
    this.connectTimes.push(Date.now());
    if (this.down) throw new Error("connect refused");
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected && !this.down;
  }
  async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    return tags.map((t) => ({ tagKey: t.tagKey, raw: 1, value: 1, quality: "good" as const, timestamp: new Date() }));
  }
  async subscribe(_t: OtTagAddress[], _on: OnOtSample): Promise<OtSubscriptionHandle> {
    return { close: async () => undefined };
  }
  async writeTags(): Promise<OtCommandResult[]> {
    return [];
  }
  async health(): Promise<OtHealth> {
    return { protocol: "stub", connected: this.isConnected() };
  }
}

const gaps = (xs: number[]): number[] => xs.slice(1).map((x, i) => x - xs[i]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-23T08:00:00Z"));
  __datLaiTrangThaiAdapter();
});
afterEach(() => {
  __datLaiTrangThaiAdapter();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("khoangNoiLaiMs (thuần)", () => {
  const exp = (n: number) => Math.min(30_000, 2_000 * Math.pow(2, n - 1));
  it("khoảng nhanh = max(poll, 500)", () => {
    expect(khoangNoiLaiNhanhMs(200)).toBe(500);
    expect(khoangNoiLaiNhanhMs(5000)).toBe(5000);
    expect(khoangNoiLaiNhanhMs(0)).toBe(500);
  });
  it("10 lần đầu: min(backoff cũ, khoảng nhanh); từ lần 11: backoff lũy thừa bắt đầu lại, trần không đổi", () => {
    for (let f = 1; f <= NOI_LAI_NHANH_SO_LAN; f++) expect(khoangNoiLaiMs(f, 500, exp)).toBe(500);
    expect([11, 12, 13, 14, 15, 16, 20].map((f) => khoangNoiLaiMs(f, 500, exp))).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    // cấu hình cũ NHANH hơn khoảng nhanh (vd backoff 100 ms, poll 1000) ⇒ giữ cấu hình cũ, không chậm đi
    expect(khoangNoiLaiMs(2, 1000, (n) => 100 * Math.pow(2, n - 1))).toBe(200);
  });
});

describe("HA — ConnectionSupervisor.nextBackoffDelay", () => {
  function tao(drv: DriverGia): ConnectionSupervisor {
    return new ConnectionSupervisor({
      adapterId: 1,
      code: "ADP",
      protocol: "stub",
      tags: TAGS,
      pollIntervalMs: 500,
      endpoints: [{ label: "primary", connection: { endpoint: "primary://host" } }],
      createDriver: () => drv,
      onSample: async () => {},
      healthIntervalMs: 50,
      backoff: { initialMs: 2000, maxMs: 30_000, factor: 2, jitter: 0 },
    });
  }

  it("mất kết nối ⇒ nối lại mỗi poll (500 ms), có lại ⇒ connected trong ≤ 2 × poll sau khi thiết bị quay lại", async () => {
    const drv = new DriverGia();
    const sup = tao(drv);
    await sup.start();
    expect(sup.status().state).toBe("connected");
    drv.connectTimes.length = 0;

    const t0 = Date.now();
    drv.down = true; // đợt mất bắt đầu
    await vi.advanceTimersByTimeAsync(1_200);
    expect(sup.status().state).not.toBe("connected");
    const quayLai = Date.now();
    drv.down = false; // thiết bị quay lại (sau 3 lần nối lại thất bại)
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sup.status().state).toBe("connected");

    expect(drv.connectTimes.length).toBeGreaterThanOrEqual(4);
    expect(gaps(drv.connectTimes).every((g) => g === 500)).toBe(true); // đúng nhịp poll, KHÔNG phải 2000/4000
    const ketNoi = drv.connectTimes.at(-1)!;
    expect(ketNoi - quayLai).toBeLessThanOrEqual(2 * 500);
    expect(ketNoi - t0).toBeLessThan(2_000);
    await sup.stop();
  });

  it("sau 10 lần thất bại: khoảng chờ tăng lũy thừa như cũ (2000, 4000, 8000…)", async () => {
    const drv = new DriverGia();
    drv.down = true;
    const sup = tao(drv);
    await sup.start();
    await vi.advanceTimersByTimeAsync(120_000);
    const g = gaps(drv.connectTimes);
    expect(g.slice(0, 10)).toEqual(Array(10).fill(500));
    expect(g.slice(10, 15)).toEqual([2000, 4000, 8000, 16000, 30000]);
    await sup.stop();
  });
});

describe("legacy — watchdog + nextRetryAt", () => {
  function adapter(drv: DriverGia): RuntimeAdapter {
    return {
      adapterId: 777,
      code: "legacy-777",
      machineId: null,
      protocol: "stub",
      connection: { endpoint: "stub://legacy-777" },
      pollIntervalMs: 1000,
      tags: TAGS,
      driver: drv,
    };
  }

  it("mất kết nối ⇒ nối lại mỗi ~poll (không phải 5 s); có lại ⇒ connected trong ≤ 2 × poll", async () => {
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    vi.stubEnv("OT_CONN_HA_ENABLED", "false");
    vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", "false");
    vi.stubEnv("OT_GHI_TRANG_THAI_ADAPTER_ENABLED", "false");
    // OT_LEGACY_RECONNECT_MS mặc định 5000: chính cấu hình làm backoff cũ chậm
    const drv = new DriverGia();
    hoisted.adapters = [adapter(drv)];
    const ot = await import("./otManager");
    try {
      expect(await ot.startOt()).toBe(true);
      expect(layTrangThaiAdapter(777)?.tt).toBe("connected");
      drv.connectTimes.length = 0;

      drv.down = true;
      await vi.advanceTimersByTimeAsync(4_000);
      expect(layTrangThaiAdapter(777)?.tt).toBe("lost");
      expect(drv.connectTimes.length).toBeGreaterThanOrEqual(3); // cũ: tối đa 1 lần trong 4 s
      for (const g of gaps(drv.connectTimes)) {
        expect(g).toBeGreaterThanOrEqual(1000);
        expect(g).toBeLessThanOrEqual(1500); // poll 1000 + độ hạt vòng canh 500
      }

      const quayLai = Date.now();
      drv.down = false;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(layTrangThaiAdapter(777)?.tt).toBe("connected");
      expect(drv.connectTimes.at(-1)! - quayLai).toBeLessThanOrEqual(2 * 1000);
    } finally {
      await ot.stopOt();
    }
  });
});
