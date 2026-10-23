/**
 * SCADA R0 Task 5 — trạng thái kết nối adapter (C3 ghi DB điều tiết 5 s, C1 mẫu xấu khi mất) + callback `onStateChange` của supervisor.
 * Không DB: hàm ghi thay bằng `__datGhiDb`, `ingest` giả.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OtTagAddress } from "./otDriver";

const ingestSamplesMock = vi.hoisted(() => vi.fn(async (_a: unknown, _s: unknown[]) => undefined));
vi.mock("./ingest", () => ({
  ingestSample: async () => undefined,
  ingestSamples: ingestSamplesMock,
}));

import {
  baoTrangThaiAdapter,
  layTrangThaiAdapter,
  __datLaiTrangThaiAdapter,
  __datGhiDb,
  type TrangThaiKetNoi,
} from "./trangThaiAdapter";

const TAGS: OtTagAddress[] = [
  { tagKey: "t1", address: "a1", dataType: "float" },
  { tagKey: "t2", address: "a2", dataType: "float" },
  { tagKey: "t3", address: "a3", dataType: "float" },
];
const AD = { adapterId: 501, code: "r0-t5", machineId: 7, protocol: "stub" as const, tags: TAGS };

type Ghi = { id: number; tt: TrangThaiKetNoi; loi: string | null };
let ghi: Ghi[] = [];

function batCo(ghiDb: boolean, chatLuong: boolean): void {
  vi.stubEnv("OT_GHI_TRANG_THAI_ADAPTER_ENABLED", ghiDb ? "true" : "false");
  vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", chatLuong ? "true" : "false");
}

beforeEach(async () => {
  await import("./ingest"); // nạp bản giả TRƯỚC khi bật fake timers
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T08:00:00Z"));
  ghi = [];
  ingestSamplesMock.mockClear();
  __datLaiTrangThaiAdapter();
  __datGhiDb(async (id, tt, loi) => {
    ghi.push({ id, tt, loi });
  });
});
afterEach(() => {
  __datLaiTrangThaiAdapter();
  __datGhiDb(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("ghi DB điều tiết 5 s (C3)", () => {
  it("connecting → connected → lost trong 1 s ⇒ lần 1 ngay (connecting), lần 2 trailing lúc 5 s mang 'lost' (mới nhất); tổng 2", async () => {
    batCo(true, false);
    baoTrangThaiAdapter(AD, "connecting", null);
    await vi.advanceTimersByTimeAsync(0);
    expect(ghi).toEqual([{ id: 501, tt: "connecting", loi: null }]);

    await vi.advanceTimersByTimeAsync(300);
    baoTrangThaiAdapter(AD, "connected", null);
    await vi.advanceTimersByTimeAsync(600);
    baoTrangThaiAdapter(AD, "lost", "boom");
    await vi.advanceTimersByTimeAsync(0);
    expect(ghi).toHaveLength(1); // chưa đủ 5 s: chưa ghi gì thêm

    await vi.advanceTimersByTimeAsync(4_000); // t = 4,9 s
    expect(ghi).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200); // t = 5,1 s ⇒ trailing
    expect(ghi).toEqual([
      { id: 501, tt: "connecting", loi: null },
      { id: 501, tt: "lost", loi: "boom" },
    ]);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(ghi).toHaveLength(2); // không có lần ghi thừa
  });

  it("đổi trạng thái sau khi lần ghi trước đã ≥ 5 s ⇒ ghi NGAY, không hẹn", async () => {
    batCo(true, false);
    baoTrangThaiAdapter(AD, "connecting", null);
    await vi.advanceTimersByTimeAsync(5_000);
    baoTrangThaiAdapter(AD, "connected", null);
    await vi.advanceTimersByTimeAsync(0);
    expect(ghi.map((g) => g.tt)).toEqual(["connecting", "connected"]);
  });

  it("báo lại CÙNG trạng thái ⇒ không ghi, không hẹn", async () => {
    batCo(true, false);
    baoTrangThaiAdapter(AD, "connected", null);
    baoTrangThaiAdapter(AD, "connected", null);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ghi).toHaveLength(1);
  });

  it("cờ ghi DB tắt ⇒ 0 lần ghi; layTrangThaiAdapter vẫn đúng", async () => {
    batCo(false, false);
    expect(layTrangThaiAdapter(AD.adapterId)).toBeNull();
    baoTrangThaiAdapter(AD, "connecting", null);
    baoTrangThaiAdapter(AD, "connected", null);
    const t = new Date("2026-10-23T08:00:02Z");
    baoTrangThaiAdapter(AD, "lost", "x", t);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ghi).toHaveLength(0);
    expect(layTrangThaiAdapter(AD.adapterId)).toEqual({ tt: "lost", tu: t, loi: "x", soLanMat: 1 });
  });

  it("adapter chưa từng báo (vd do edge sở hữu) ⇒ layTrangThaiAdapter null", () => {
    baoTrangThaiAdapter(AD, "connected", null);
    expect(layTrangThaiAdapter(9999)).toBeNull();
  });

  it("__datLaiTrangThaiAdapter huỷ hẹn ghi đang chờ", async () => {
    batCo(true, false);
    baoTrangThaiAdapter(AD, "connecting", null);
    baoTrangThaiAdapter(AD, "lost", "x");
    __datLaiTrangThaiAdapter();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ghi.map((g) => g.tt)).toEqual(["connecting"]);
    expect(layTrangThaiAdapter(AD.adapterId)).toBeNull();
  });

  it("lỗi ghi DB chỉ log, không ném và không chặn lần ghi sau", async () => {
    batCo(true, false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    __datGhiDb(async () => {
      throw new Error("db down");
    });
    expect(() => baoTrangThaiAdapter(AD, "connecting", null)).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("mẫu xấu khi chuyển 'mất' (C1)", () => {
  it("lost (cờ chất lượng bật) ⇒ ingestSamples 1 lần với N mẫu bad comm_lost; lost lại liền sau ⇒ không gọi thêm; connected rồi lost ⇒ lần 2", async () => {
    batCo(false, true);
    baoTrangThaiAdapter(AD, "connected", null);
    await vi.advanceTimersByTimeAsync(0);
    expect(ingestSamplesMock).not.toHaveBeenCalled();

    const t = new Date("2026-10-23T08:00:03Z");
    baoTrangThaiAdapter(AD, "lost", "e", t);
    await vi.advanceTimersByTimeAsync(0);
    expect(ingestSamplesMock).toHaveBeenCalledTimes(1);
    const [adArg, mau] = ingestSamplesMock.mock.calls[0] as [{ adapterId: number }, Array<Record<string, unknown>>];
    expect(adArg.adapterId).toBe(501);
    expect(mau).toHaveLength(3);
    expect(mau.map((m) => m.tagKey)).toEqual(["t1", "t2", "t3"]);
    for (const m of mau) {
      expect(m).toMatchObject({ quality: "bad", value: null, raw: null, statusCode: "comm_lost", reason: "comm_lost", tsSource: "server" });
      expect(m.timestamp).toEqual(t);
    }

    baoTrangThaiAdapter(AD, "lost", "e2");
    await vi.advanceTimersByTimeAsync(0);
    expect(ingestSamplesMock).toHaveBeenCalledTimes(1);

    baoTrangThaiAdapter(AD, "connected", null);
    baoTrangThaiAdapter(AD, "lost", "e3");
    await vi.advanceTimersByTimeAsync(0);
    expect(ingestSamplesMock).toHaveBeenCalledTimes(2);
    expect(layTrangThaiAdapter(AD.adapterId)?.soLanMat).toBe(2);
  });

  it("chập chờn lost → connecting → lost (nối lại thất bại) CHƯA hết đợt mất ⇒ không phát lại", async () => {
    batCo(false, true);
    baoTrangThaiAdapter(AD, "lost", "e");
    baoTrangThaiAdapter(AD, "connecting", null);
    baoTrangThaiAdapter(AD, "lost", "e");
    await vi.advanceTimersByTimeAsync(0);
    expect(ingestSamplesMock).toHaveBeenCalledTimes(1);
  });

  it("cờ chất lượng tắt ⇒ không phát mẫu xấu", async () => {
    batCo(false, false);
    baoTrangThaiAdapter(AD, "lost", "e");
    await vi.advanceTimersByTimeAsync(0);
    expect(ingestSamplesMock).not.toHaveBeenCalled();
  });

  it("connecting/disabled không phát mẫu xấu", async () => {
    batCo(false, true);
    baoTrangThaiAdapter(AD, "connecting", null);
    baoTrangThaiAdapter(AD, "disabled", null);
    await vi.advanceTimersByTimeAsync(0);
    expect(ingestSamplesMock).not.toHaveBeenCalled();
  });
});

// ── ConnectionSupervisor.onStateChange ────────────────────────────────────────
import { ConnectionSupervisor, type SupervisorState } from "./connectionSupervisor";
import type { OtDriver, OtSample, OtSubscriptionHandle, OnOtSample, OtHealth, OtCommandResult } from "./otDriver";

/** Driver tối thiểu: `failNext` lần connect kế tiếp ném lỗi. */
class DriverLoi implements OtDriver {
  readonly protocol = "stub" as const;
  connected = false;
  failNext = 0;
  async connect(): Promise<void> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error("connect fail");
    }
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
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
    return { protocol: "stub", connected: this.connected };
  }
}

describe("ConnectionSupervisor.onStateChange", () => {
  it("connect lỗi ⇒ connecting→failed (kèm lastError), hết lỗi ⇒ connecting→connected (lastError null); stop ⇒ stopped", async () => {
    const drv = new DriverLoi();
    drv.failNext = 1;
    const got: Array<[SupervisorState, SupervisorState, string | null]> = [];
    const sup = new ConnectionSupervisor({
      adapterId: 1,
      code: "ADP",
      protocol: "stub",
      tags: TAGS,
      pollIntervalMs: 1000,
      endpoints: [{ label: "primary", connection: { endpoint: "primary://host" } }],
      createDriver: () => drv,
      onSample: async () => {},
      healthIntervalMs: 50,
      backoff: { initialMs: 100, maxMs: 1000, factor: 2, jitter: 0 },
      onStateChange: (prev, next, loi) => got.push([prev, next, loi]),
    });
    await sup.start();
    expect(got[0]).toEqual(["idle", "connecting", null]);
    expect(got[1][0]).toBe("connecting");
    expect(got[1][1]).toBe("failed");
    expect(got[1][2]).toContain("connect fail");

    await vi.advanceTimersByTimeAsync(150);
    expect(got.at(-1)).toEqual(["connecting", "connected", null]);
    expect(got.map((g) => g[1])).toEqual(["connecting", "failed", "connecting", "connected"]);

    await sup.stop();
    expect(got.at(-1)?.[1]).toBe("stopped");
  });

  it("callback ném ⇒ supervisor vẫn chạy bình thường", async () => {
    const drv = new DriverLoi();
    const sup = new ConnectionSupervisor({
      adapterId: 2,
      code: "ADP2",
      protocol: "stub",
      tags: TAGS,
      pollIntervalMs: 1000,
      endpoints: [{ label: "primary", connection: { endpoint: "primary://host" } }],
      createDriver: () => drv,
      onSample: async () => {},
      onStateChange: () => {
        throw new Error("cb boom");
      },
    });
    await sup.start();
    expect(sup.status().state).toBe("connected");
    await sup.stop();
  });
});
