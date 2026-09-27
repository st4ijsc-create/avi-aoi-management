/**
 * doc 81 Đợt 1B Task 1 — probeOtConnection: hạn TỔNG (timeoutMs + 2 s) cho connect +
 * disconnect, luôn dọn kết nối (kể cả kết nối xong MUỘN sau hạn).
 * Driver giả cố ý treo; một ca dùng ModbusDriver thật với cổng đóng (ECONNREFUSED của OS).
 */
import { describe, it, expect } from "vitest";
import net from "node:net";
import type { OtDriver, OtProtocol, OtConnectionConfig, OtHealth } from "./otDriver";
import { probeOtConnection, PROBE_MARGIN_MS } from "./probeConnection";
import { ModbusDriver } from "./drivers/modbusDriver";

async function settleWithin<T>(
  p: Promise<T>,
  ms: number,
): Promise<{ settled: boolean; ok?: boolean; error?: unknown; elapsed: number }> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<"__p">((r) => {
    timer = setTimeout(() => r("__p"), ms);
  });
  try {
    const out = await Promise.race([
      p.then(
        () => ({ settled: true, ok: true }),
        (error) => ({ settled: true, ok: false, error }),
      ),
      guard,
    ]);
    if (out === "__p") return { settled: false, elapsed: Date.now() - t0 };
    return { ...(out as { settled: boolean; ok: boolean }), elapsed: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const never = <T>() => new Promise<T>(() => undefined);

class FakeDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  disconnectCalls = 0;
  constructor(
    private readonly connectImpl: () => Promise<void>,
    private readonly disconnectImpl: () => Promise<void> = async () => undefined,
  ) {}
  connect(_cfg: OtConnectionConfig) {
    return this.connectImpl();
  }
  disconnect() {
    this.disconnectCalls += 1;
    return this.disconnectImpl();
  }
  isConnected() {
    return false;
  }
  async readTags() {
    return [];
  }
  async subscribe() {
    return { close: async () => undefined };
  }
  async writeTags() {
    return [];
  }
  async health(): Promise<OtHealth> {
    return { protocol: this.protocol, connected: false };
  }
}

describe("probeOtConnection (doc 81 Đợt 1B Task 1)", () => {
  it("PROBE_MARGIN_MS = 2000 (hạn tổng = timeoutMs + 2 s)", () => {
    expect(PROBE_MARGIN_MS).toBe(2000);
  });

  it("connect treo vĩnh viễn ⇒ reject trong timeoutMs + 2 s; disconnect được gọi", async () => {
    const d = new FakeDriver(() => never<void>());
    const r = await settleWithin(probeOtConnection(d, { endpoint: "x", timeoutMs: 300 }), 2800);
    expect(r.settled, `probe treo (${r.elapsed} ms)`).toBe(true);
    expect(r.ok).toBe(false);
    expect(String((r.error as Error).message)).toMatch(/timeout/);
    expect(d.disconnectCalls).toBeGreaterThanOrEqual(1);
  });

  it("connect OK nhưng disconnect treo ⇒ vẫn resolve trong hạn tổng", async () => {
    const d = new FakeDriver(async () => undefined, () => never<void>());
    const r = await settleWithin(probeOtConnection(d, { endpoint: "x", timeoutMs: 300 }), 2800);
    expect(r.settled, `probe treo (${r.elapsed} ms)`).toBe(true);
    expect(r.ok).toBe(true);
    expect(d.disconnectCalls).toBe(1);
  });

  it("connect xong MUỘN sau hạn ⇒ kết nối muộn bị disconnect (không rò)", async () => {
    let open!: () => void;
    const d = new FakeDriver(() => new Promise<void>((r) => (open = r)));
    const r = await settleWithin(probeOtConnection(d, { endpoint: "x", timeoutMs: 100 }, 300), 1500);
    expect(r.settled).toBe(true);
    expect(r.ok).toBe(false);
    const before = d.disconnectCalls;
    open();
    await sleep(50);
    expect(d.disconnectCalls).toBeGreaterThan(before);
  });

  it("ModbusDriver thật, cổng đóng ⇒ reject nhanh kèm ECONNREFUSED (lỗi gốc giữ nguyên)", async () => {
    const tmp = net.createServer();
    await new Promise<void>((r) => tmp.listen(0, "127.0.0.1", () => r()));
    const port = (tmp.address() as net.AddressInfo).port;
    await new Promise<void>((r) => tmp.close(() => r()));
    const r = await settleWithin(
      probeOtConnection(new ModbusDriver(), { endpoint: `tcp://127.0.0.1:${port}`, timeoutMs: 1000 }),
      3000,
    );
    expect(r.settled).toBe(true);
    expect(r.ok).toBe(false);
    expect(String((r.error as Error).message)).toMatch(/ECONNREFUSED/);
  });
});
