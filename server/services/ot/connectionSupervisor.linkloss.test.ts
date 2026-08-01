/**
 * doc 40 OT-F1 — ConnectionSupervisor LINK-LOSS ("kill-server") tests (vitest, mock driver, NO hardware).
 *
 * Chứng minh supervisor phát hiện MẤT KẾT NỐI GIỮA PHIÊN (rớt cáp / PLC reboot) rồi
 * reconnect — điều trước đây KHÔNG xảy ra vì driver chỉ lật connected=false ở disconnect():
 *   (A) fallback CHUNG: N lần health() báo not-connected LIÊN TIẾP (event-less driver,
 *       isConnected() vẫn true) → đạt ngưỡng OT_LINKLOSS_FAIL_THRESHOLD → reconnecting + reconnect.
 *   (B) dưới ngưỡng KHÔNG kích hoạt (đếm LIÊN TIẾP, reset khi hồi phục).
 *   (C) mất kết nối vĩnh viễn → chuyển 'reconnecting'/'failed' + có GỌI reconnect.
 *   (D) đường CỨNG: driver.isConnected()===false (event transport đã lật) → phát hiện NGAY
 *       trong 1 tick (không đợi ngưỡng).
 * Supervisor không bao giờ ném ra host trong mọi trường hợp.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  OtDriver,
  OtProtocol,
  OtConnectionConfig,
  OtTagAddress,
  OtSample,
  OtSubscriptionHandle,
  OtCommandResult,
  OtHealth,
  OtWrite,
  OnOtSample,
} from "./otDriver";
import { ConnectionSupervisor, type EndpointConfig } from "./connectionSupervisor";

const TAGS: OtTagAddress[] = [{ tagKey: "t1", address: "addr1", dataType: "float" }];

/**
 * Driver giả mô phỏng "đứt giữa phiên":
 *   killSoft()  → health() báo {connected:false} NHƯNG isConnected() vẫn true — mô phỏng
 *                 driver KHÔNG expose event (nodes7/mcprotocol): chỉ tín hiệu MỀM.
 *   killHard()  → isConnected() trả false — mô phỏng driver đã lật connected=false theo
 *                 event transport (opcua/modbus/eip): tín hiệu CỨNG.
 * connect() làm HỒI SINH (reset cả hai) — mô phỏng cáp cắm lại / PLC boot xong.
 */
class FakeDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  connected = false;
  connectCalls = 0;
  subscribeCalls = 0;
  disconnectCalls = 0;
  failConnect = false;

  private softDown = false;
  private hardDown = false;
  private onSample?: OnOtSample;
  private tags: OtTagAddress[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private counter = 0;

  constructor(readonly id = "d") {}

  async connect(_cfg: OtConnectionConfig): Promise<void> {
    this.connectCalls += 1;
    if (this.failConnect) throw new Error(`connect fail (${this.id})`);
    this.connected = true;
    this.softDown = false;
    this.hardDown = false;
  }
  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
    this.stopTimer();
  }
  isConnected(): boolean {
    return this.connected && !this.hardDown;
  }
  async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    return tags.map((t) => this.mk(t));
  }
  async subscribe(tags: OtTagAddress[], onSample: OnOtSample, intervalMs = 1000): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new Error(`subscribe: not connected (${this.id})`);
    this.subscribeCalls += 1;
    this.onSample = onSample;
    this.tags = tags;
    this.tick();
    const timer = setInterval(() => this.tick(), intervalMs > 0 ? intervalMs : 1000);
    if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();
    this.timer = timer;
    return { close: async () => this.stopTimer() };
  }
  async writeTags(writes: OtWrite[]): Promise<OtCommandResult[]> {
    return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
  }
  async health(): Promise<OtHealth> {
    return { protocol: this.protocol, connected: this.connected && !this.hardDown && !this.softDown };
  }

  /** Đứt "mềm": health báo mất, nhưng isConnected() vẫn true (driver không có event). */
  killSoft(): void {
    this.softDown = true;
  }
  /** Hồi phục tín hiệu mềm (health trả connected lại) mà KHÔNG reconnect. */
  reviveSoft(): void {
    this.softDown = false;
  }
  /** Đứt "cứng": isConnected() trả false (event transport đã lật connected=false). */
  killHard(): void {
    this.hardDown = true;
    this.stopTimer();
  }

  private tick(): void {
    for (const t of this.tags) void this.onSample?.(this.mk(t));
  }
  private mk(t: OtTagAddress): OtSample {
    return { tagKey: t.tagKey, raw: this.counter, value: this.counter++, quality: "good", timestamp: new Date() };
  }
  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function endpoints(...labels: Array<"primary" | "secondary">): EndpointConfig[] {
  return labels.map((label) => ({ label, connection: { endpoint: `${label}://host` } }));
}

function makeSup(drv: FakeDriver, opts?: { threshold?: number }): ConnectionSupervisor {
  return new ConnectionSupervisor({
    adapterId: 1,
    code: "LL",
    protocol: "stub",
    tags: TAGS,
    pollIntervalMs: 1000,
    endpoints: endpoints("primary"),
    createDriver: () => drv,
    onSample: async () => {},
    healthIntervalMs: 50,
    backoff: { initialMs: 50, maxMs: 200, factor: 2, jitter: 0 },
    linkLossFailThreshold: opts?.threshold ?? 3,
  });
}

describe("ConnectionSupervisor — OT-F1 link-loss detection (kill-server)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // ── (A) event-less fallback: N consecutive health failures → reconnect ─────────
  it("(A) reconnects after OT_LINKLOSS_FAIL_THRESHOLD consecutive health failures", async () => {
    const drv = new FakeDriver("A");
    const sup = makeSup(drv, { threshold: 3 });

    await sup.start();
    expect(sup.status().state).toBe("connected");
    expect(drv.connectCalls).toBe(1);

    // Đứt giữa phiên: health báo not-connected, isConnected() VẪN true (không có event).
    drv.killSoft();

    // 2 tick (100ms) — dưới ngưỡng 3 → CHƯA coi là mất kết nối.
    await vi.advanceTimersByTimeAsync(100);
    expect(sup.status().state).toBe("connected");
    expect(drv.connectCalls).toBe(1);

    // Tick thứ 3 (50ms nữa) → đạt ngưỡng → onActiveLost → reconnect (connect() hồi sinh).
    await vi.advanceTimersByTimeAsync(50);
    expect(drv.connectCalls).toBe(2); // ĐÃ gọi reconnect
    expect(sup.status().reconnects).toBe(1);
    expect(sup.status().state).toBe("connected");

    await sup.stop();
  });

  // ── (B) below-threshold does NOT trigger; counter resets on recovery ──────────
  it("(B) below-threshold soft failures never reconnect (consecutive + resets)", async () => {
    const drv = new FakeDriver("B");
    const sup = makeSup(drv, { threshold: 3 });

    await sup.start();

    // 2 tick lỗi mềm (counter=2) rồi HỒI PHỤC → tick khỏe reset counter về 0.
    drv.killSoft();
    await vi.advanceTimersByTimeAsync(100); // 2 fails
    expect(sup.status().state).toBe("connected");
    drv.reviveSoft();
    await vi.advanceTimersByTimeAsync(50); // 1 healthy tick → reset

    // Lại 2 tick lỗi mềm — vẫn dưới ngưỡng vì đã reset → KHÔNG reconnect.
    drv.killSoft();
    await vi.advanceTimersByTimeAsync(100);
    expect(sup.status().state).toBe("connected");
    expect(sup.status().reconnects).toBe(0);
    expect(drv.connectCalls).toBe(1);

    await sup.stop();
  });

  // ── (C) permanent loss → reconnecting/failed + reconnect attempted ────────────
  it("(C) permanent mid-session loss → leaves 'connected', attempts reconnect", async () => {
    const drv = new FakeDriver("C");
    const sup = makeSup(drv, { threshold: 3 });

    await sup.start();
    expect(sup.status().state).toBe("connected");

    // Đứt mềm + mọi lần reconnect sau đó đều thất bại → không hồi phục được.
    drv.killSoft();
    drv.failConnect = true;

    // Vượt ngưỡng (3 tick = 150ms) → onActiveLost → reconnecting → attempt fails → failed.
    await vi.advanceTimersByTimeAsync(150);
    expect(["reconnecting", "failed"]).toContain(sup.status().state);
    expect(sup.status().state).not.toBe("connected");
    expect(drv.connectCalls).toBeGreaterThan(1); // ĐÃ gọi reconnect

    await sup.stop();
  });

  // ── (D) hard signal (transport event flipped connected) → immediate (1 tick) ──
  it("(D) driver.isConnected()===false is detected immediately (no threshold wait)", async () => {
    const drv = new FakeDriver("D");
    const sup = makeSup(drv, { threshold: 3 });

    await sup.start();
    expect(sup.status().state).toBe("connected");
    expect(drv.connectCalls).toBe(1);

    // Event transport lật connected=false → isConnected() trả false.
    drv.killHard();

    // MỘT tick (50ms) đủ để phát hiện + reconnect (không đợi 3 lần như đường mềm).
    await vi.advanceTimersByTimeAsync(50);
    expect(drv.connectCalls).toBe(2);
    expect(sup.status().reconnects).toBe(1);
    expect(sup.status().state).toBe("connected");

    await sup.stop();
  });

  // ── never throws to the host on the link-loss path ────────────────────────────
  it("(E) the link-loss detection path never throws to the host", async () => {
    const drv = new FakeDriver("E");
    const sup = makeSup(drv, { threshold: 2 });

    // Ý định: đường phát hiện link-loss KHÔNG BAO GIỜ throw ra host (không quan tâm
    // giá trị trả về của start/stop). Nếu bất kỳ bước nào throw, test tự fail.
    await sup.start();
    drv.killSoft();
    await vi.advanceTimersByTimeAsync(500);
    await sup.stop();
    expect(true).toBe(true); // tới được đây nghĩa là không có throw nào
  });
});
