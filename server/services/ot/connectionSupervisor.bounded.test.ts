/**
 * doc 81 Đợt 1B Task 1 — lớp SUPERVISOR tự có hạn giờ, độc lập với driver.
 *
 * Lớp driver đã được vá (boundedClose) và có test riêng với giả lập thật
 * (modbusDriver.sim.test.ts). Ở đây driver giả CỐ Ý treo (disconnect / close subscription
 * không bao giờ resolve; connect chỉ xong SAU khi stop) để chứng minh supervisor không phụ
 * thuộc vào việc mọi driver đều ngoan:
 *   (1) stop() trả về < 3 s dù driver.disconnect() và handle.close() treo vĩnh viễn;
 *   (2) vòng nối lại vẫn tiến (số lần thử tăng) dù disconnect của nhánh lỗi treo;
 *   (3) connect xong SAU stop() ⇒ supervisor không sống lại ('stopped' giữ nguyên) và hạ
 *       kết nối muộn đó (không rò socket/poll).
 */
import { describe, it, expect } from "vitest";
import type {
  OtDriver,
  OtProtocol,
  OtConnectionConfig,
  OtTagAddress,
  OtSample,
  OtSubscriptionHandle,
  OtCommandResult,
  OtHealth,
} from "./otDriver";
import { ConnectionSupervisor } from "./connectionSupervisor";

async function settleWithin<T>(p: Promise<T>, ms: number): Promise<{ settled: boolean; elapsed: number }> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<false>((r) => {
    timer = setTimeout(() => r(false), ms);
  });
  try {
    const settled = await Promise.race([p.then(() => true, () => true), guard]);
    return { settled, elapsed: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const never = <T>() => new Promise<T>(() => undefined);

class HangingDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  failConnect = false;
  /** Nếu đặt: connect() chờ promise này rồi mới thành công. */
  connectGate: Promise<void> | null = null;

  async connect(_cfg: OtConnectionConfig): Promise<void> {
    this.connectCalls += 1;
    if (this.connectGate) await this.connectGate;
    if (this.failConnect) throw new Error("connect refused");
    this.connected = true;
  }
  disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
    return never<void>(); // treo vĩnh viễn — mô phỏng close(cb) không bao giờ gọi cb
  }
  isConnected(): boolean {
    return this.connected;
  }
  async readTags(_tags: OtTagAddress[]): Promise<OtSample[]> {
    return [];
  }
  async subscribe(): Promise<OtSubscriptionHandle> {
    return { close: () => never<void>() }; // treo vĩnh viễn
  }
  async writeTags(): Promise<OtCommandResult[]> {
    return [];
  }
  async health(): Promise<OtHealth> {
    return { protocol: this.protocol, connected: this.connected };
  }
}

function makeSup(driver: HangingDriver) {
  return new ConnectionSupervisor({
    adapterId: 9,
    code: "HANG",
    protocol: "stub",
    tags: [{ tagKey: "t", address: "a", dataType: "int" }],
    pollIntervalMs: 200,
    healthIntervalMs: 50,
    endpoints: [{ label: "primary", connection: { endpoint: "stub://x" } }],
    createDriver: () => driver,
    onSample: () => undefined,
    backoff: { initialMs: 50, maxMs: 100, factor: 2, jitter: 0 },
    linkLossFailThreshold: 1,
  });
}

describe("ConnectionSupervisor có hạn giờ (doc 81 Đợt 1B Task 1)", () => {
  it("(1) stop() < 3 s dù disconnect() và subscription.close() treo vĩnh viễn", async () => {
    const d = new HangingDriver();
    const sup = makeSup(d);
    await sup.start();
    expect(sup.status().state).toBe("connected");
    const r = await settleWithin(sup.stop(), 3000);
    expect(r.settled, `stop() treo > 3000 ms`).toBe(true);
    expect(sup.status().state).toBe("stopped");
    expect(d.disconnectCalls).toBeGreaterThanOrEqual(1);
  });

  it("(2) mất kết nối + connect lỗi + disconnect treo ⇒ vòng nối lại vẫn tiến (số lần thử tăng)", async () => {
    const d = new HangingDriver();
    const sup = makeSup(d);
    await sup.start();
    d.failConnect = true;
    d.connected = false; // tín hiệu cứng: driver báo mất kết nối
    await sleep(300);
    const a = sup.status().attempts;
    await sleep(6000);
    const b = sup.status().attempts;
    expect(b, `attempts phải tăng (a=${a}, b=${b})`).toBeGreaterThan(a);
    const r = await settleWithin(sup.stop(), 3000);
    expect(r.settled).toBe(true);
  }, 20_000);

  it("(3) connect xong SAU stop() ⇒ vẫn 'stopped' và kết nối muộn bị hạ", async () => {
    const d = new HangingDriver();
    let open!: () => void;
    d.connectGate = new Promise<void>((r) => (open = r));
    const sup = makeSup(d);
    const started = sup.start();
    await sleep(50);
    const r = await settleWithin(sup.stop(), 3000);
    expect(r.settled).toBe(true);
    const before = d.disconnectCalls;
    open(); // connect thành công MUỘN
    await settleWithin(started, 3000);
    await sleep(50);
    expect(sup.status().state).toBe("stopped");
    expect(sup.getActiveDriver()).toBeUndefined();
    expect(d.disconnectCalls, "kết nối muộn phải bị disconnect").toBeGreaterThan(before);
  });
});
