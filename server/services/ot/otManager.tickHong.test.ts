/**
 * SCADA R0 Task 12 (D1) — liên kết TREO (TCP nửa mở: cáp rút sau switch, PLC đóng băng): `isConnected()` vẫn true nên
 * legacyTick/healthTick không thấy mất. K = 2 tick poll HỎNG liên tiếp (timeout, quá hạn, hoặc comm_lost cho CẢ tick) ⇒ otManager
 * báo `lost` (baoTrangThaiAdapter) và HẠ phiên driver để đường nối lại nhanh chạy. Nhánh legacy VÀ nhánh HA (ConnectionSupervisor
 * thật). Một tick tốt xoá bộ đếm. Tick của phiên CŨ (đã bị thay) không được hạ phiên mới.
 *
 * Driver giả "nửa mở": isConnected() luôn true khi đã connect; subscribe giữ lại `tuyChon.onTick` để test tự phát sự kiện tick
 * (không có vòng poll thật — bộ đếm là của otManager/supervisor, không của driver).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OnOtSample,
  OtCommandResult,
  OtConnectionConfig,
  OtDriver,
  OtHealth,
  OtProtocol,
  OtSample,
  OtSubscriptionHandle,
  OtTagAddress,
  SuKienDoc,
  TuyChonVongPoll,
} from "./otDriver";

const TAGS: OtTagAddress[] = [
  { tagKey: "t1", address: "1", dataType: "float" },
  { tagKey: "t2", address: "2", dataType: "float" },
];

interface Phien {
  onTick: ((e: SuKienDoc) => void) | undefined;
  closed: boolean;
}

class NuaMoDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  failConnect = false;
  readonly phien: Phien[] = [];
  /** Nhật ký thứ tự connect/disconnect (fix round 1: socket nửa mở phải bị hạ NGAY khi D1 hạ phiên). */
  readonly nhatKy: string[] = [];

  async connect(_cfg: OtConnectionConfig): Promise<void> {
    this.connectCalls += 1;
    this.nhatKy.push("connect");
    if (this.failConnect) throw Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.nhatKy.push("disconnect");
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected; // nửa mở: KHÔNG bao giờ tự lật false khi thiết bị ngừng trả lời
  }
  async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    return tags.map((t) => ({ tagKey: t.tagKey, raw: 1, value: 1, quality: "good", timestamp: new Date() }));
  }
  async subscribe(_tags: OtTagAddress[], _onSample: OnOtSample, _ms?: number, tuyChon?: TuyChonVongPoll): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new Error("not connected");
    const p: Phien = { onTick: tuyChon?.onTick, closed: false };
    this.phien.push(p);
    return {
      close: async () => {
        p.closed = true;
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

const TICK_TIMEOUT: SuKienDoc = { ok: false, timeout: true, ms: 800, tags: [], statusCode: "timeout", reason: "comm_lost" };
const TICK_TOT: SuKienDoc = {
  ok: true,
  timeout: false,
  ms: 20,
  tags: TAGS.map((t) => ({ tagKey: t.tagKey, quality: "good" as const })),
};
/** Tick "tốt" về hình thức nhưng MỌI tag bad/comm_lost (cờ V2 tắt huỷ, hoặc driver trả per-tag) ⇒ vẫn là tick hỏng. */
const TICK_TOAN_COMM_LOST: SuKienDoc = {
  ok: true,
  timeout: false,
  ms: 800,
  tags: TAGS.map((t) => ({ tagKey: t.tagKey, quality: "bad" as const, reason: "comm_lost" as const })),
};

function adapterFixture(driver: OtDriver) {
  return {
    adapterId: 4242,
    code: "D1-HANG",
    machineId: null,
    protocol: "stub" as OtProtocol,
    connection: { endpoint: "stub://d1", timeoutMs: 800 } as OtConnectionConfig,
    pollIntervalMs: 1000,
    tags: TAGS,
    driver,
    backupConnection: undefined,
  };
}

const ngu = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe.each([
  ["legacy", "false", "true"],
  ["HA (ConnectionSupervisor thật)", "true", "true"],
  ["legacy", "false", "false"],
  ["HA (ConnectionSupervisor thật)", "true", "false"],
] as const)("otManager D1 — K=2 tick hỏng liên tiếp ⇒ lost + hạ phiên (%s, HA=%s, OT_CHAT_LUONG_V2_ENABLED=%s)", (_nhan, ha, v2) => {
  let ot: typeof import("./otManager");
  let tt: typeof import("./trangThaiAdapter");
  /** Driver đang giữ phiên (legacy: driver của adapter; HA: driver supervisor tạo cho endpoint primary). */
  let drv: NuaMoDriver;

  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    vi.stubEnv("OT_CONN_HA_ENABLED", ha);
    vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", v2);
    vi.stubEnv("OT_CONN_HA_BACKOFF_MS", "2000"); // khoảng nối lại nhanh = min(2000, max(poll,500)) = 1000 ms
    vi.stubEnv("OT_GHI_TRANG_THAI_ADAPTER_ENABLED", "false");
    vi.stubEnv("OT_LEGACY_RECONNECT_MS", "5000");
    vi.stubEnv("OT_CONN_HA_HEALTH_INTERVAL_MS", "100");
    vi.stubEnv("OT_CONN_HA_BACKOFF_JITTER", "0");
    const legacyDrv = new NuaMoDriver();
    const haDrv: NuaMoDriver[] = [];
    vi.doMock("./driverRegistry", () => ({
      createDriver: () => {
        const d = new NuaMoDriver();
        haDrv.push(d);
        return d;
      },
    }));
    vi.doMock("./ingest", () => ({ ingestSample: async () => undefined, ingestSamples: async () => undefined }));
    vi.doMock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => [adapterFixture(legacyDrv)] }));
    ot = await import("./otManager");
    tt = await import("./trangThaiAdapter");
    tt.__datLaiTrangThaiAdapter();
    expect(await ot.startOt()).toBe(true);
    drv = ha === "true" ? haDrv[0] : legacyDrv;
    await vi.waitFor(() => {
      expect(tt.layTrangThaiAdapter(4242)?.tt).toBe("connected");
      expect(drv.phien).toHaveLength(1);
    });
  });

  afterEach(async () => {
    await ot.stopOt();
    tt.__datLaiTrangThaiAdapter();
    vi.unstubAllEnvs();
  });

  const trangThai = () => tt.layTrangThaiAdapter(4242)?.tt;

  it.skipIf(v2 !== "true")("1 tick hỏng: chưa gì; tick hỏng thứ 2 liên tiếp ⇒ 'lost' + đóng subscription + disconnect driver; rồi nối lại (phiên mới)", async () => {
    const p1 = drv.phien[0];
    p1.onTick!(TICK_TOAN_COMM_LOST); // tick "ok" nhưng cả tick comm_lost ⇒ hỏng #1
    await ngu(50);
    expect(trangThai()).toBe("connected");
    expect(p1.closed).toBe(false);
    expect(drv.disconnectCalls).toBe(0);

    drv.failConnect = true; // thiết bị vẫn treo: lần nối lại thất bại ⇒ trạng thái ở lại 'lost' cho dễ quan sát
    p1.onTick!(TICK_TIMEOUT); // hỏng #2
    await vi.waitFor(() => {
      expect(trangThai()).toBe("lost");
      expect(p1.closed).toBe(true);
      expect(drv.disconnectCalls).toBeGreaterThanOrEqual(1);
    });
    expect(tt.layTrangThaiAdapter(4242)?.soLanMat).toBe(1);

    drv.failConnect = false; // cắm lại ⇒ đường nối lại nhanh mở phiên mới
    await vi.waitFor(
      () => {
        expect(drv.phien).toHaveLength(2);
        expect(trangThai()).toBe("connected");
      },
      { timeout: 4000 },
    );
  });

  it.skipIf(v2 !== "true")("tick tốt xoá bộ đếm: hỏng, tốt, hỏng ⇒ vẫn connected, không hạ phiên", async () => {
    const p1 = drv.phien[0];
    p1.onTick!(TICK_TIMEOUT);
    p1.onTick!(TICK_TOT);
    p1.onTick!(TICK_TIMEOUT);
    await ngu(300);
    expect(trangThai()).toBe("connected");
    expect(p1.closed).toBe(false);
    expect(drv.disconnectCalls).toBe(0);
    expect(drv.phien).toHaveLength(1);
  });

  it.skipIf(v2 !== "true")("tick của phiên CŨ (đã bị thay) không hạ phiên mới", async () => {
    const p1 = drv.phien[0];
    p1.onTick!(TICK_TIMEOUT);
    p1.onTick!(TICK_TIMEOUT); // phiên 1 bị hạ, nối lại ⇒ phiên 2
    await vi.waitFor(
      () => {
        expect(drv.phien).toHaveLength(2);
        expect(trangThai()).toBe("connected");
      },
      { timeout: 4000 },
    );
    const p2 = drv.phien[1];
    const ngatTruoc = drv.disconnectCalls;
    // Vòng poll của phiên 1 còn sót một tick muộn (đã đóng nhưng tick dở dang vẫn báo):
    p1.onTick!(TICK_TIMEOUT);
    p1.onTick!(TICK_TIMEOUT);
    p1.onTick!(TICK_TIMEOUT);
    await ngu(300);
    expect(p2.closed).toBe(false);
    expect(drv.disconnectCalls).toBe(ngatTruoc);
    expect(trangThai()).toBe("connected");
    expect(drv.phien).toHaveLength(2);
  });

  it.skipIf(v2 !== "true")("fix round 1: hạ phiên ngay sau một lần NỐI LẠI (chưa ổn định ⇒ chờ backoff) vẫn ĐÓNG socket nửa mở NGAY, không đợi lần thử kế; rồi nối lại được", async () => {
    const p1 = drv.phien[0];
    p1.onTick!(TICK_TIMEOUT);
    p1.onTick!(TICK_TIMEOUT); // liên kết ổn định rớt ⇒ nối lại ngay ⇒ phiên 2
    await vi.waitFor(
      () => {
        expect(drv.phien).toHaveLength(2);
        expect(trangThai()).toBe("connected");
      },
      { timeout: 4000 },
    );
    const p2 = drv.phien[1];
    const ngatTruoc = drv.disconnectCalls;
    p2.onTick!(TICK_TIMEOUT);
    p2.onTick!(TICK_TIMEOUT); // vừa nối lại mà rớt ⇒ không ổn định ⇒ lần thử kế chờ ~1000 ms
    await ngu(150);
    expect(trangThai()).toBe("lost");
    expect(p2.closed).toBe(true);
    expect(drv.disconnectCalls, "socket nửa mở phải bị hạ NGAY khi D1 hạ phiên").toBeGreaterThan(ngatTruoc);
    expect(drv.connected).toBe(false);
    expect(drv.phien).toHaveLength(2); // lần thử kế chưa tới
    await vi.waitFor(
      () => {
        expect(drv.phien).toHaveLength(3);
        expect(trangThai()).toBe("connected");
      },
      { timeout: 4000 },
    );
    // Mọi lần nối lại đều đi SAU một lần disconnect (không bao giờ connect chồng lên transport cũ).
    const k = drv.nhatKy;
    for (let i = 0; i < k.length; i++) {
      if (k[i] !== "connect") continue;
      const truoc = k.slice(0, i);
      const connectTruoc = truoc.lastIndexOf("connect");
      if (connectTruoc >= 0) expect(truoc.lastIndexOf("disconnect"), `connect #${i} chồng lên transport cũ: ${k.join(",")}`).toBeGreaterThan(connectTruoc);
    }
  });

  it.skipIf(v2 !== "false")("cờ OT_CHAT_LUONG_V2_ENABLED TẮT (đọc lúc subscribe) ⇒ K tick hỏng KHÔNG hạ phiên (hành vi trước R0)", async () => {
    const p1 = drv.phien[0];
    for (let i = 0; i < 5; i++) p1.onTick!(TICK_TIMEOUT);
    p1.onTick!(TICK_TOAN_COMM_LOST);
    await ngu(400);
    expect(trangThai()).toBe("connected");
    expect(p1.closed).toBe(false);
    expect(drv.disconnectCalls).toBe(0);
    expect(drv.phien).toHaveLength(1);
  });

  it.skipIf(v2 !== "true")("stopOt rồi tick muộn của phiên đã dừng ⇒ không báo lost, không nối lại", async () => {
    const p1 = drv.phien[0];
    await ot.stopOt();
    const noiTruoc = drv.connectCalls;
    p1.onTick!(TICK_TIMEOUT);
    p1.onTick!(TICK_TIMEOUT);
    await ngu(700);
    expect(trangThai()).not.toBe("lost");
    expect(drv.connectCalls).toBe(noiTruoc);
  });
});
