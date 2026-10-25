/**
 * SCADA R0 Task 5 (fix round 1) — ánh xạ trạng thái supervisor → trạng thái adapter của otManager (nhánh HA), với supervisor GIẢ
 * (bắt `onStateChange` do buildSupervisor truyền). Không DB, không driver thật.
 *
 * Phủ: reconnecting|failed → lost; connecting bị chặn sau lost; stopped → disabled; 'failed' muộn sau 'stopped' bị bỏ; sự kiện sau
 * detach (kể cả detach LÚC supervisor.start() chưa xong) bị bỏ; supervisor thế hệ cũ không đè trạng thái của thế hệ mới.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RuntimeAdapter } from "./deviceAdapter";
import type { SupervisorOptions, SupervisorState } from "./connectionSupervisor";

const hoisted = vi.hoisted(() => ({
  adapters: [] as unknown[],
  sups: [] as Array<{
    opts: SupervisorOptions;
    emit: (next: SupervisorState) => void;
    soltStart: null | (() => void);
  }>,
  startGate: null as null | Promise<void>,
}));

vi.mock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => hoisted.adapters }));
const ingestSamplesMock = vi.hoisted(() => vi.fn(async (_a: unknown, _s: unknown[]) => undefined));
vi.mock("./ingest", () => ({ ingestSample: async () => undefined, ingestSamples: ingestSamplesMock }));
vi.mock("./connectionSupervisor", () => {
  class FakeSupervisor {
    state: SupervisorState = "idle";
    lastError: string | null = null;
    constructor(public opts: SupervisorOptions) {
      hoisted.sups.push({ opts, emit: (n) => this.emit(n), soltStart: null });
    }
    emit(next: SupervisorState): void {
      const prev = this.state;
      if (prev !== "stopped") this.state = next; // vẫn PHÁT sự kiện (prev='stopped') để otManager tự phòng thủ
      this.opts.onStateChange?.(prev, next, this.lastError, null);
    }
    async start(): Promise<void> {
      this.emit("connecting");
      if (hoisted.startGate) await hoisted.startGate;
    }
    async stop(): Promise<void> {
      this.emit("stopped");
    }
    status() {
      return { state: this.state, lastError: this.lastError, code: this.opts.code, protocol: this.opts.protocol, attempts: 0 };
    }
    getActiveDriver() {
      return undefined;
    }
    resetBoundMs() {
      return 1000;
    }
    /** R1b-1 T3 — supervisor giả: 'connected' phát ra đã kèm lần đọc tốt đầu tiên (không mô phỏng chờ đọc tốt ở đây). */
    dangChoDocTot() {
      return false;
    }
  }
  return { ConnectionSupervisor: FakeSupervisor, DEFAULT_SUPERVISOR_DISCONNECT_TIMEOUT_MS: 1000 };
});

import { layTrangThaiAdapter, __datLaiTrangThaiAdapter } from "./trangThaiAdapter";

const TAGS = [
  { tagKey: "t1", address: "a1", dataType: "float" as const },
  { tagKey: "t2", address: "a2", dataType: "float" as const },
];
function adapter(id: number): RuntimeAdapter {
  return {
    adapterId: id,
    code: `ha-${id}`,
    machineId: null,
    protocol: "stub",
    connection: { endpoint: `stub://ha-${id}` },
    pollIntervalMs: 500,
    tags: TAGS,
    driver: { protocol: "stub", isConnected: () => false } as never,
  };
}

let ot: typeof import("./otManager");

beforeEach(async () => {
  hoisted.adapters = [adapter(901)];
  hoisted.sups.length = 0;
  hoisted.startGate = null;
  ingestSamplesMock.mockClear();
  __datLaiTrangThaiAdapter();
  vi.stubEnv("OT_GATEWAY_ENABLED", "true");
  vi.stubEnv("OT_CONN_HA_ENABLED", "true");
  vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", "true");
  vi.stubEnv("OT_GHI_TRANG_THAI_ADAPTER_ENABLED", "false");
  ot = await import("./otManager");
});
afterEach(async () => {
  await ot.stopOt();
  __datLaiTrangThaiAdapter();
  vi.unstubAllEnvs();
});

const tt = (id = 901) => layTrangThaiAdapter(id)?.tt;
const flush = () => new Promise<void>((r) => setTimeout(r, 20));

describe("otManager HA — ánh xạ onStateChange → trạng thái adapter", () => {
  it("connecting/connected/reconnecting|failed → lost; connecting sau lost bị chặn; stopped → disabled; 'failed' muộn sau stopped bị bỏ", async () => {
    expect(await ot.startOt()).toBe(true);
    const s = hoisted.sups[0];
    expect(tt()).toBe("connecting"); // FakeSupervisor.start() phát connecting
    s.emit("connected");
    expect(tt()).toBe("connected");

    s.emit("reconnecting");
    expect(tt()).toBe("lost");
    s.emit("connecting"); // nối lại sau mất vẫn là lost
    expect(tt()).toBe("lost");
    s.emit("failed");
    expect(tt()).toBe("lost");
    expect(layTrangThaiAdapter(901)?.soLanMat).toBe(1);
    await flush();
    expect(ingestSamplesMock).toHaveBeenCalledTimes(1); // MỘT đợt mất

    s.emit("connected");
    expect(tt()).toBe("connected");
    s.emit("failed"); // rớt ngay sau khi nối (chưa ổn định) ⇒ VẪN là đợt mất cũ: không phát lại mẫu xấu, soLanMat giữ 1
    expect(tt()).toBe("lost");
    await flush();
    expect(ingestSamplesMock).toHaveBeenCalledTimes(1);
    expect(layTrangThaiAdapter(901)?.soLanMat).toBe(1);

    s.emit("stopped");
    expect(tt()).toBe("disabled");
    s.emit("failed"); // vòng nối trễ sau stop()
    s.emit("reconnecting");
    expect(tt()).toBe("disabled");
    await flush();
    expect(ingestSamplesMock).toHaveBeenCalledTimes(1); // không thêm mẫu xấu
  });

  it("liên kết đã ỔN ĐỊNH (giữ ≥ max(3 × poll, 5 s)) rồi rớt ⇒ đợt mất MỚI: soLanMat 2 và mẫu xấu lần 2", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      expect(await ot.startOt()).toBe(true);
      const s = hoisted.sups[0];
      s.emit("connected");
      s.emit("reconnecting");
      await flush();
      expect(ingestSamplesMock).toHaveBeenCalledTimes(1);
      s.emit("connected");
      vi.setSystemTime(Date.now() + 4_000); // poll 500 ⇒ ổn định = 5 s
      s.emit("failed");
      expect(layTrangThaiAdapter(901)?.soLanMat).toBe(1); // 4 s < 5 s: chưa ổn định
      s.emit("connected");
      vi.setSystemTime(Date.now() + 6_000);
      s.emit("failed");
      expect(layTrangThaiAdapter(901)?.soLanMat).toBe(2);
      await flush();
      expect(ingestSamplesMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("statusCode của supervisor được dùng cho mẫu xấu", async () => {
    expect(await ot.startOt()).toBe(true);
    const s = hoisted.sups[0];
    s.emit("connected");
    s.opts.onStateChange?.("connected", "reconnecting", "ECONNRESET text", "ECONNRESET");
    await flush();
    const [, mau] = ingestSamplesMock.mock.calls[0] as [unknown, Array<Record<string, unknown>>];
    expect(mau).toHaveLength(2);
    for (const m of mau) expect(m).toMatchObject({ quality: "bad", statusCode: "ECONNRESET", reason: "comm_lost" });
  });

  it("sau detachOtAdapter: stopped → disabled được báo, nhưng sự kiện muộn của supervisor đó bị bỏ", async () => {
    expect(await ot.startOt()).toBe(true);
    const s = hoisted.sups[0];
    s.emit("connected");
    expect(await ot.detachOtAdapter(901)).toBe(true);
    expect(tt()).toBe("disabled");
    s.opts.onStateChange?.("connecting", "failed", "late", "ECONNREFUSED"); // sự kiện muộn (không phải từ stopped)
    s.opts.onStateChange?.("connected", "reconnecting", "late", null);
    expect(tt()).toBe("disabled");
    await flush();
    expect(ingestSamplesMock).not.toHaveBeenCalled();
  });

  it("detach XẢY RA LÚC supervisor.start() chưa xong: sự kiện 'failed' đến sau detach bị bỏ; khi start xong → stop → disabled", async () => {
    let mo!: () => void;
    hoisted.startGate = new Promise<void>((r) => {
      mo = r;
    });
    const khoiDong = ot.startOt();
    await flush();
    const s = hoisted.sups[0];
    expect(tt()).toBe("connecting");
    // supervisor chưa được đăng ký (start còn treo) ⇒ detach không tìm thấy, nhưng đổi dấu detach
    expect(await ot.detachOtAdapter(901)).toBe(false);
    s.emit("failed"); // đến SAU detach: adapter có thể đã thuộc edge ⇒ không được ghi lost
    expect(tt()).toBe("connecting");
    mo();
    await khoiDong;
    expect(tt()).toBe("disabled"); // otManager thấy dấu detach đổi ⇒ supervisor.stop() ⇒ stopped ⇒ disabled
    await flush();
    expect(ingestSamplesMock).not.toHaveBeenCalled();
  });

  it("supervisor thế hệ cũ (đã bị thay) không đè trạng thái của thế hệ mới", async () => {
    expect(await ot.startOt()).toBe(true);
    const cu = hoisted.sups[0];
    cu.emit("connected");
    await ot.stopOt();
    expect(tt()).toBe("disabled");
    expect(await ot.startOt()).toBe(true);
    const moi = hoisted.sups[1];
    moi.emit("connected");
    expect(tt()).toBe("connected");
    cu.opts.onStateChange?.("connected", "failed", "stale", null); // sự kiện muộn của thế hệ cũ
    cu.opts.onStateChange?.("connected", "stopped", null, null);
    expect(tt()).toBe("connected");
  });
});
