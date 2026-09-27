/**
 * doc 81 Đợt 1B Task 2 (phán quyết R8) — dò kết nối qua mặt tiền thiết bị CÓ HẠN TỔNG.
 *
 *   • OtEquipmentAdapter.testConnection / readTelemetry: driver OT treo ở connect / health /
 *     readTags / disconnect ⇒ vẫn trả về trong hạn, kết quả ok:false / [], disconnect được gọi;
 *     connect xong MUỘN ⇒ kết nối muộn bị hạ (không rò).
 *   • probeRobotConnection (đường của robotRouter.testConnection): robot treo ở connect /
 *     getState / disconnect ⇒ reject/resolve trong hạn; đường hợp lệ trả đúng state.
 * Mọi khẳng định "không treo" đo bằng settleWithin (hạn tường minh).
 */
import { describe, it, expect, afterEach } from "vitest";
import type { OtDriver, OtProtocol, OtConnectionConfig, OtHealth, OtSample } from "../ot/otDriver";
import { registerDriver } from "../ot/driverRegistry";
import { createStubDriver } from "../ot/drivers/stubDriver";
import { equipmentRegistry } from "./equipmentAdapter";
import { probeRobotConnection } from "../robot/probeRobotConnection";

async function settleWithin<T>(
  p: Promise<T>,
  ms: number,
): Promise<{ settled: boolean; ok?: boolean; value?: T; error?: unknown; elapsed: number }> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<"__p">((r) => {
    timer = setTimeout(() => r("__p"), ms);
  });
  try {
    const out = await Promise.race([
      p.then(
        (value) => ({ settled: true, ok: true, value }),
        (error) => ({ settled: true, ok: false, error }),
      ),
      guard,
    ]);
    if (out === "__p") return { settled: false, elapsed: Date.now() - t0 };
    return { ...(out as object), elapsed: Date.now() - t0 } as {
      settled: boolean;
      ok?: boolean;
      value?: T;
      error?: unknown;
      elapsed: number;
    };
  } finally {
    clearTimeout(timer);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const never = <T>() => new Promise<T>(() => undefined);

interface Knobs {
  connect?: () => Promise<void>;
  health?: () => Promise<OtHealth>;
  readTags?: () => Promise<OtSample[]>;
  disconnect?: () => Promise<void>;
}

class KnobDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  disconnectCalls = 0;
  constructor(private readonly k: Knobs) {}
  connect(_cfg: OtConnectionConfig) {
    return this.k.connect ? this.k.connect() : Promise.resolve();
  }
  disconnect() {
    this.disconnectCalls += 1;
    return this.k.disconnect ? this.k.disconnect() : Promise.resolve();
  }
  isConnected() {
    return true;
  }
  readTags() {
    return this.k.readTags ? this.k.readTags() : Promise.resolve([]);
  }
  async subscribe() {
    return { close: async () => undefined };
  }
  async writeTags() {
    return [];
  }
  health(): Promise<OtHealth> {
    return this.k.health ? this.k.health() : Promise.resolve({ protocol: this.protocol, connected: true });
  }
}

let last: KnobDriver | null = null;
function useStub(k: Knobs): void {
  registerDriver("stub", () => (last = new KnobDriver(k)));
}

afterEach(() => {
  registerDriver("stub", createStubDriver); // trả registry về như cũ cho test khác
  last = null;
});

describe("OtEquipmentAdapter có hạn tổng (doc 81 Đợt 1B Task 2 / R8)", () => {
  const adapter = () => equipmentRegistry.getAdapter("ot-stub");

  it("connect treo vĩnh viễn ⇒ testConnection trả ok:false trong 2×timeoutMs + 2 s; disconnect được gọi", async () => {
    useStub({ connect: () => never<void>() });
    const r = await settleWithin(adapter().testConnection({ endpoint: "x", timeoutMs: 300 }), 3000);
    expect(r.settled, `testConnection treo (${r.elapsed} ms)`).toBe(true);
    expect(r.value?.ok).toBe(false);
    expect(r.value?.error).toMatch(/timeout/);
    expect(last!.disconnectCalls).toBeGreaterThanOrEqual(1);
  });

  it("health() treo ⇒ vẫn trả ok:false trong hạn", async () => {
    useStub({ health: () => never<OtHealth>() });
    const r = await settleWithin(adapter().testConnection({ endpoint: "x", timeoutMs: 300 }), 3000);
    expect(r.settled, `testConnection treo ở health (${r.elapsed} ms)`).toBe(true);
    expect(r.value?.ok).toBe(false);
  });

  it("disconnect treo sau connect OK ⇒ vẫn trả ok:true trong hạn (đường hợp lệ không bị chặn oan)", async () => {
    useStub({ disconnect: () => never<void>() });
    const r = await settleWithin(adapter().testConnection({ endpoint: "x", timeoutMs: 300 }), 3000);
    expect(r.settled, `testConnection treo ở disconnect (${r.elapsed} ms)`).toBe(true);
    expect(r.value?.ok).toBe(true);
    expect(typeof r.value?.latencyMs).toBe("number");
  });

  it("connect xong MUỘN sau hạn ⇒ kết nối muộn bị disconnect", async () => {
    let open!: () => void;
    useStub({ connect: () => new Promise<void>((r) => (open = r)) });
    const r = await settleWithin(adapter().testConnection({ endpoint: "x", timeoutMs: 100 }), 3000);
    expect(r.settled).toBe(true);
    expect(r.value?.ok).toBe(false);
    const before = last!.disconnectCalls;
    open();
    await sleep(50);
    expect(last!.disconnectCalls).toBeGreaterThan(before);
  });

  it("readTelemetry: readTags treo ⇒ trả [] trong hạn; disconnect được gọi", async () => {
    useStub({ readTags: () => never<OtSample[]>() });
    const r = await settleWithin(adapter().readTelemetry({ endpoint: "x", timeoutMs: 300, tags: [] }), 3000);
    expect(r.settled, `readTelemetry treo (${r.elapsed} ms)`).toBe(true);
    expect(r.value).toEqual([]);
    expect(last!.disconnectCalls).toBeGreaterThanOrEqual(1);
  });

  it("readTelemetry hợp lệ vẫn trả mẫu", async () => {
    const ts = new Date("2026-01-01T00:00:00Z");
    useStub({
      readTags: async () => [{ tagKey: "k", raw: 7, value: 7, quality: "good", timestamp: ts }],
    });
    const r = await settleWithin(adapter().readTelemetry({ endpoint: "x", timeoutMs: 300, tags: [] }), 3000);
    expect(r.value).toEqual([{ key: "k", value: 7, timestamp: ts }]);
  });
});

class FakeRobot {
  readonly vendor = "fake";
  disconnectCalls = 0;
  constructor(
    private readonly k: {
      connect?: () => Promise<void>;
      getState?: () => Promise<unknown>;
      disconnect?: () => Promise<void>;
    },
  ) {}
  connect() {
    return this.k.connect ? this.k.connect() : Promise.resolve();
  }
  getState() {
    return this.k.getState ? this.k.getState() : Promise.resolve({ mode: "idle" });
  }
  disconnect() {
    this.disconnectCalls += 1;
    return this.k.disconnect ? this.k.disconnect() : Promise.resolve();
  }
}

describe("probeRobotConnection — đường của robotRouter.testConnection (R8)", () => {
  it("connect treo ⇒ reject trong hạn tổng; disconnect được gọi", async () => {
    const d = new FakeRobot({ connect: () => never<void>() });
    const r = await settleWithin(probeRobotConnection(d, { endpoint: "x" }, 400), 2000);
    expect(r.settled, `probe robot treo (${r.elapsed} ms)`).toBe(true);
    expect(r.ok).toBe(false);
    expect(String((r.error as Error).message)).toMatch(/timeout/);
    expect(d.disconnectCalls).toBeGreaterThanOrEqual(1);
  });

  it("getState treo ⇒ reject trong hạn tổng", async () => {
    const d = new FakeRobot({ getState: () => never<unknown>() });
    const r = await settleWithin(probeRobotConnection(d, { endpoint: "x" }, 400), 2000);
    expect(r.settled).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("hợp lệ + disconnect treo ⇒ resolve đúng state trong hạn", async () => {
    const d = new FakeRobot({ getState: async () => ({ mode: "auto", x: 1 }), disconnect: () => never<void>() });
    const r = await settleWithin(probeRobotConnection(d, { endpoint: "x" }, 400), 2000);
    expect(r.settled).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ mode: "auto", x: 1 });
  });
});
