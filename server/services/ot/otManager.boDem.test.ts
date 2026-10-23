/**
 * SCADA R0 Task 6 (C8) — otManager nối bộ đếm truyền thông + hạn đọc vào CẢ HAI đường (legacy và HA).
 * Supervisor GIẢ; driver GIẢ (bắt tham số 4 của subscribe).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RuntimeAdapter } from "./deviceAdapter";
import type { SupervisorOptions } from "./connectionSupervisor";
import type { TuyChonVongPoll } from "./otDriver";

const hoisted = vi.hoisted(() => ({
  adapters: [] as unknown[],
  sups: [] as Array<{ opts: SupervisorOptions }>,
}));

vi.mock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => hoisted.adapters }));
vi.mock("./ingest", () => ({ ingestSample: async () => undefined, ingestSamples: async () => undefined }));
vi.mock("./connectionSupervisor", () => {
  class FakeSupervisor {
    constructor(public opts: SupervisorOptions) {
      hoisted.sups.push({ opts });
    }
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    status() {
      return { state: "idle", lastError: null, code: this.opts.code, protocol: this.opts.protocol, attempts: 0 };
    }
    getActiveDriver() {
      return undefined;
    }
    resetBoundMs() {
      return 1000;
    }
  }
  return { ConnectionSupervisor: FakeSupervisor, DEFAULT_SUPERVISOR_DISCONNECT_TIMEOUT_MS: 1000 };
});

import { __datLaiBoDem, layBoDem } from "./boDemTruyenThong";

const TAGS = [{ tagKey: "t1", address: "a1", dataType: "float" as const }];

function adapter(id: number, over: Partial<RuntimeAdapter> & { subscribe?: unknown; connect?: unknown } = {}): RuntimeAdapter {
  const { subscribe, connect, ...rest } = over;
  return {
    adapterId: id,
    code: `bd-${id}`,
    machineId: null,
    protocol: "stub",
    connection: { endpoint: `stub://bd-${id}`, timeoutMs: 800 },
    pollIntervalMs: 1000,
    tags: TAGS,
    driver: {
      protocol: "stub",
      connect: connect ?? (async () => undefined),
      disconnect: async () => undefined,
      isConnected: () => true,
      subscribe: subscribe ?? (async () => ({ close: async () => undefined })),
    } as never,
    ...rest,
  } as RuntimeAdapter;
}

let ot: typeof import("./otManager");

beforeEach(async () => {
  hoisted.sups.length = 0;
  __datLaiBoDem();
  vi.stubEnv("OT_GATEWAY_ENABLED", "true");
  ot = await import("./otManager");
});
afterEach(async () => {
  await ot.stopOt();
  __datLaiBoDem();
  vi.unstubAllEnvs();
});

describe("otManager — đường legacy", () => {
  beforeEach(() => {
    vi.stubEnv("OT_CONN_HA_ENABLED", "false");
  });

  it("subscribe nhận tuyChon: deadlineMs = max(2×poll, timeout+1000) và onTick ghi vào bộ đếm; phiên thành công được đếm", async () => {
    const subscribe = vi.fn(async (..._a: unknown[]) => ({ close: async () => undefined }));
    hoisted.adapters = [adapter(801, { subscribe })];
    expect(await ot.startOt()).toBe(true);
    expect(subscribe).toHaveBeenCalledTimes(1);
    const tuyChon = subscribe.mock.calls[0][3] as TuyChonVongPoll;
    expect(tuyChon.deadlineMs).toBe(2000); // poll 1000, timeout 800 ⇒ max(2000, 1800)
    tuyChon.onTick?.({ ok: true, timeout: false, ms: 12, tags: [{ tagKey: "t1", quality: "good" }] });
    const b = layBoDem(801);
    expect(b.request).toBe(1);
    expect(b.theoTag.t1.good).toBe(1);
    expect(b.phien).toBe(1);
    expect(b.phienLoi).toBe(0);
  });

  it("connect lỗi ⇒ phiên lỗi được đếm", async () => {
    hoisted.adapters = [adapter(802, { connect: async () => { throw new Error("ECONNREFUSED"); } })];
    await ot.startOt();
    const b = layBoDem(802);
    expect(b.phien).toBeGreaterThanOrEqual(1);
    expect(b.phienLoi).toBe(b.phien);
  });

  it("không có timeoutMs ⇒ hạn = max(2×poll, 6000)", async () => {
    const subscribe = vi.fn(async (..._a: unknown[]) => ({ close: async () => undefined }));
    hoisted.adapters = [adapter(803, { subscribe, pollIntervalMs: 500, connection: { endpoint: "stub://x" } })];
    await ot.startOt();
    expect((subscribe.mock.calls[0][3] as TuyChonVongPoll).deadlineMs).toBe(6000);
  });
});

describe("otManager — đường HA", () => {
  beforeEach(() => {
    vi.stubEnv("OT_CONN_HA_ENABLED", "true");
  });

  it("supervisor nhận tuyChon (deadline + onTick) và onConnectAttempt ghi phiên", async () => {
    hoisted.adapters = [adapter(811)];
    expect(await ot.startOt()).toBe(true);
    const o = hoisted.sups[0].opts;
    expect(o.tuyChon?.deadlineMs).toBe(2000);
    o.tuyChon?.onTick?.({ ok: false, timeout: true, ms: 2000, tags: [] });
    o.onConnectAttempt?.(false);
    o.onConnectAttempt?.(true);
    const b = layBoDem(811);
    expect(b).toMatchObject({ request: 1, loi: 1, timeout: 1, phien: 2, phienLoi: 1 });
  });
});
