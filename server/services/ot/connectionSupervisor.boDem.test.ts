/**
 * SCADA R0 Task 6 (C8) — supervisor: truyền `tuyChon` vào driver.subscribe và báo `onConnectAttempt` mỗi lần thử nối.
 */
import { describe, it, expect } from "vitest";
import type { OtCommandResult, OtDriver, OtHealth, OtProtocol, OtSample, OtSubscriptionHandle, TuyChonVongPoll } from "./otDriver";
import { ConnectionSupervisor } from "./connectionSupervisor";

class Drv implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  connected = false;
  failConnect = false;
  subscribeArgs: unknown[][] = [];
  async connect(): Promise<void> {
    if (this.failConnect) throw new Error("ECONNREFUSED");
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
  async readTags(): Promise<OtSample[]> {
    return [];
  }
  async subscribe(...a: unknown[]): Promise<OtSubscriptionHandle> {
    this.subscribeArgs.push(a);
    return { close: async () => undefined };
  }
  async writeTags(): Promise<OtCommandResult[]> {
    return [];
  }
  async health(): Promise<OtHealth> {
    return { protocol: this.protocol, connected: this.connected, capabilities: [], tags: [] } as unknown as OtHealth;
  }
}

function make(drv: Drv, extra: Record<string, unknown>) {
  return new ConnectionSupervisor({
    adapterId: 1,
    code: "S1",
    protocol: "stub",
    tags: [{ tagKey: "t", address: "a", dataType: "float" }],
    pollIntervalMs: 1000,
    endpoints: [{ label: "primary", connection: { endpoint: "stub://x" } }],
    createDriver: () => drv,
    onSample: async () => undefined,
    backoff: { initialMs: 5_000, maxMs: 5_000, jitter: 0 },
    ...extra,
  } as never);
}

describe("ConnectionSupervisor — C8", () => {
  it("nối thành công ⇒ subscribe nhận đúng tuyChon (tham chiếu) và onConnectAttempt(true)", async () => {
    const drv = new Drv();
    const tuyChon: TuyChonVongPoll = { deadlineMs: 1234 };
    const lan: boolean[] = [];
    const sup = make(drv, { tuyChon, onConnectAttempt: (ok: boolean) => lan.push(ok) });
    await sup.start();
    try {
      expect(drv.subscribeArgs[0][3]).toBe(tuyChon);
      expect(lan).toEqual([true]);
    } finally {
      await sup.stop();
    }
  });

  it("connect lỗi ⇒ onConnectAttempt(false); người nghe ném không phá vòng nối", async () => {
    const drv = new Drv();
    drv.failConnect = true;
    const lan: boolean[] = [];
    const sup = make(drv, {
      onConnectAttempt: (ok: boolean) => {
        lan.push(ok);
        throw new Error("nghe hong");
      },
    });
    await sup.start();
    try {
      expect(lan).toEqual([false]);
      expect(sup.status().state).toBe("failed");
    } finally {
      await sup.stop();
    }
  });
});
