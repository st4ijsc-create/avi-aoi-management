/**
 * doc 81 Đợt 1B Task 2 (phán quyết R8) — supervisor.connect() CÓ HẠN.
 *
 * Driver giả CỐ Ý treo ở connect() (không bao giờ resolve, hoặc chỉ resolve khi test mở cổng)
 * để chứng minh lớp supervisor tự có hạn, độc lập với hạn riêng của driver:
 *   (1) connect treo vĩnh viễn ⇒ start() trả về trong connectTimeoutMs + biên, state 'failed',
 *       lastError nêu timeout; vòng thử lại vẫn tiến (attempts tăng);
 *   (2) connect xong MUỘN sau hạn ⇒ kết nối muộn bị hạ (disconnect + close subscription),
 *       supervisor không 'connected' nhờ nó; trong lúc connect cũ còn treo KHÔNG có connect
 *       thứ hai chồng lên cùng driver; sau đó thử lại bình thường ⇒ 'connected';
 *   (3) mặc định connectTimeoutMs = 10000 (khớp OT_ADAPTER_START_TIMEOUT_MS).
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
import {
  ConnectionSupervisor,
  DEFAULT_SUPERVISOR_CONNECT_TIMEOUT_MS,
  SUPERVISOR_CONNECT_GRACE_MS,
} from "./connectionSupervisor";

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

class GatedDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  closeCalls = 0;
  inFlight = 0;
  maxInFlight = 0;
  /** connect() chờ promise này (null ⇒ thành công ngay). */
  gate: Promise<void> | null = null;

  async connect(_cfg: OtConnectionConfig): Promise<void> {
    this.connectCalls += 1;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.gate) await this.gate;
      this.connected = true;
    } finally {
      this.inFlight -= 1;
    }
  }
  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
  async readTags(_tags: OtTagAddress[]): Promise<OtSample[]> {
    return [];
  }
  async subscribe(): Promise<OtSubscriptionHandle> {
    return {
      close: async () => {
        this.closeCalls += 1;
      },
    };
  }
  async writeTags(): Promise<OtCommandResult[]> {
    return [];
  }
  async health(): Promise<OtHealth> {
    return { protocol: this.protocol, connected: this.connected };
  }
}

function makeSup(driver: GatedDriver, connectTimeoutMs?: number) {
  return new ConnectionSupervisor({
    adapterId: 7,
    code: "GATED",
    protocol: "stub",
    tags: [{ tagKey: "t", address: "a", dataType: "int" }],
    pollIntervalMs: 200,
    healthIntervalMs: 50,
    endpoints: [{ label: "primary", connection: { endpoint: "stub://x" } }],
    createDriver: () => driver,
    onSample: () => undefined,
    backoff: { initialMs: 100, maxMs: 200, factor: 2, jitter: 0 },
    linkLossFailThreshold: 1,
    connectTimeoutMs,
  });
}

describe("ConnectionSupervisor connect có hạn (doc 81 Đợt 1B Task 2 / R8)", () => {
  it("(3) mặc định connectTimeoutMs = 10000", () => {
    expect(DEFAULT_SUPERVISOR_CONNECT_TIMEOUT_MS).toBe(10_000);
  });

  it("(1) connect treo vĩnh viễn ⇒ start() trả về ≤ hạn + 1 s, state 'failed', vòng thử lại vẫn tiến", async () => {
    const d = new GatedDriver();
    d.gate = new Promise<void>(() => undefined); // không bao giờ mở
    const sup = makeSup(d, 300);
    const r = await settleWithin(sup.start(), 1300);
    expect(r.settled, `start() treo > 1300 ms (đo ${r.elapsed} ms)`).toBe(true);
    expect(r.elapsed).toBeGreaterThanOrEqual(250); // tôn trọng hạn, không trả sớm giả
    expect(sup.status().state).toBe("failed");
    expect(sup.status().lastError).toMatch(/timeout/);
    expect(sup.getActiveDriver()).toBeUndefined();
    const a = sup.status().attempts;
    await sleep(500);
    expect(sup.status().attempts, "vòng thử lại phải tiến (attempts tăng)").toBeGreaterThan(a);
    expect(d.maxInFlight, "không chồng connect lên driver đang treo").toBe(1);
    const s = await settleWithin(sup.stop(), 3000);
    expect(s.settled).toBe(true);
  });

  it("(FR1-3) endpoint cấu hình timeoutMs > connectTimeoutMs ⇒ hạn = timeoutMs + 1 s, thiết bị chậm nối được ngay lần đầu", async () => {
    expect(SUPERVISOR_CONNECT_GRACE_MS).toBe(1000);
    const d = new GatedDriver();
    let open!: () => void;
    d.gate = new Promise<void>((r) => (open = r));
    const sup = new ConnectionSupervisor({
      adapterId: 8,
      code: "SLOW",
      protocol: "stub",
      tags: [{ tagKey: "t", address: "a", dataType: "int" }],
      pollIntervalMs: 200,
      healthIntervalMs: 50,
      endpoints: [{ label: "primary", connection: { endpoint: "stub://x", timeoutMs: 600 } }],
      createDriver: () => d,
      onSample: () => undefined,
      backoff: { initialMs: 100, maxMs: 200, factor: 2, jitter: 0 },
      linkLossFailThreshold: 1,
      connectTimeoutMs: 200,
    });
    const t = setTimeout(() => open(), 400); // chậm hơn 200 ms, nhanh hơn 600 + 1000 ms
    const r = await settleWithin(sup.start(), 2500);
    clearTimeout(t);
    expect(r.settled).toBe(true);
    expect(sup.status().state, `lastError=${sup.status().lastError}`).toBe("connected");
    expect(sup.status().attempts).toBe(1);
    const s = await settleWithin(sup.stop(), 3000);
    expect(s.settled).toBe(true);
  });

  it("(2) connect xong MUỘN ⇒ kết nối muộn bị hạ, không chồng connect; sau đó nối lại được", async () => {
    const d = new GatedDriver();
    let open!: () => void;
    d.gate = new Promise<void>((r) => (open = r));
    const sup = makeSup(d, 200);
    const r = await settleWithin(sup.start(), 1200);
    expect(r.settled, `start() treo > 1200 ms`).toBe(true);
    expect(sup.status().state).not.toBe("connected");

    // Trong lúc connect cũ còn treo, backoff (100–200 ms) đã tới vài lần: KHÔNG được có
    // connect thứ hai chồng lên cùng driver.
    await sleep(600);
    expect(d.maxInFlight, "không được có hai connect chồng nhau trên một driver").toBe(1);
    expect(sup.status().state).not.toBe("connected");

    const discBefore = d.disconnectCalls;
    const closeBefore = d.closeCalls;
    d.gate = null; // các lần sau thành công ngay
    open(); // connect cũ xong MUỘN
    await sleep(50);
    expect(d.disconnectCalls, "kết nối muộn phải bị disconnect").toBeGreaterThan(discBefore);
    expect(d.closeCalls, "subscription của kết nối muộn phải bị đóng").toBeGreaterThan(closeBefore);

    // Vòng thử lại kế tiếp nối bình thường.
    const t0 = Date.now();
    while (Date.now() - t0 < 2000 && sup.status().state !== "connected") await sleep(25);
    expect(sup.status().state).toBe("connected");
    expect(sup.getActiveDriver()).toBe(d);
    const s = await settleWithin(sup.stop(), 3000);
    expect(s.settled).toBe(true);
  });
});
