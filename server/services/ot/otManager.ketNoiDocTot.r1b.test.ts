/**
 * SCADA R1b-1 Task 3 (Review Focus 4) — `connected` (RAM + DB `device_adapters.status`) chỉ sau lần ĐỌC TỐT đầu tiên của PHIÊN,
 * không phải lúc TCP vừa lên. Sau cờ OT_CHAT_LUONG_V2_ENABLED (đọc lúc subscribe). Cờ tắt ⇒ y như cũ (TCP lên ⇒ connected).
 *
 * Nhánh legacy VÀ nhánh HA (ConnectionSupervisor thật). Driver giả: isConnected() true khi đã connect (TCP lên — kể cả proxy cổng
 * Docker accept-rồi-đóng); subscribe giữ `tuyChon.onTick` để test tự phát tick. `tickTrongSubscribe` mô phỏng lần đọc ĐẦU tức thì
 * (vongPoll T12 D2) về TRƯỚC khi subscribe trả handle (phiên chưa kịp thành "hoạt động").
 *
 * Đo: mọi lần gọi baoTrangThaiAdapter (spy bọc bản thật) + mọi lần ghi DB (`__datGhiDb`, OT_GHI_TRANG_THAI_ADAPTER_ENABLED=true,
 * điều tiết 5 s thật — fake timers đẩy qua).
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

class TcpLenDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  connected = false;
  failConnect = false;
  /** Lần đọc đầu tức thì: phát tick này ĐỒNG BỘ trong subscribe, trước khi trả handle. */
  tickTrongSubscribe: SuKienDoc | null = null;
  readonly phien: Phien[] = [];

  async connect(_cfg: OtConnectionConfig): Promise<void> {
    if (this.failConnect) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
  async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    return tags.map((t) => ({ tagKey: t.tagKey, raw: 1, value: 1, quality: "good", timestamp: new Date() }));
  }
  async subscribe(_tags: OtTagAddress[], _onSample: OnOtSample, _ms?: number, tuyChon?: TuyChonVongPoll): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new Error("not connected");
    const p: Phien = { onTick: tuyChon?.onTick, closed: false };
    this.phien.push(p);
    if (this.tickTrongSubscribe) p.onTick?.(this.tickTrongSubscribe);
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
const TICK_TOT: SuKienDoc = { ok: true, timeout: false, ms: 20, tags: TAGS.map((t) => ({ tagKey: t.tagKey, quality: "good" as const })) };
/** Giao dịch đọc THÀNH CÔNG, thiết bị trả lời nhưng mọi tag bad vì lý do KHÔNG phải mất liên lạc (vd địa chỉ sai) ⇒ là đọc tốt. */
const TICK_OK_MOI_TAG_BAD_CAU_HINH: SuKienDoc = {
  ok: true,
  timeout: false,
  ms: 20,
  tags: TAGS.map((t) => ({ tagKey: t.tagKey, quality: "bad" as const, reason: "config_error" as const })),
};
/** ok:true nhưng MỌI tag bad/comm_lost — D1 (laTickHong) coi là tick HỎNG ⇒ không phải đọc tốt (nhất quán với D1). */
const TICK_OK_TOAN_COMM_LOST: SuKienDoc = {
  ok: true,
  timeout: false,
  ms: 800,
  tags: TAGS.map((t) => ({ tagKey: t.tagKey, quality: "bad" as const, reason: "comm_lost" as const })),
};

const ID = 4343;
function adapterFixture(driver: OtDriver) {
  return {
    adapterId: ID,
    code: "T3-DOC-TOT",
    machineId: null,
    protocol: "stub" as OtProtocol,
    connection: { endpoint: "stub://t3", timeoutMs: 800 } as OtConnectionConfig,
    pollIntervalMs: 1000,
    tags: TAGS,
    driver,
    backupConnection: undefined,
  };
}

describe.each([
  ["legacy", "false"],
  ["HA (ConnectionSupervisor thật)", "true"],
] as const)("R1b-1 T3 — connected chỉ sau lần đọc tốt đầu tiên của phiên (%s)", (_nhan, ha) => {
  let ot: typeof import("./otManager");
  let tt: typeof import("./trangThaiAdapter");
  let drv: TcpLenDriver;
  let legacyDrv: TcpLenDriver;
  let haDrv: TcpLenDriver[];
  /** Mọi trạng thái otManager báo cho adapter (theo thứ tự). */
  let bao: string[];
  /** Mọi lần ghi DB `device_adapters.status`. */
  let ghiDb: string[];

  const khoiDong = async (v2: "true" | "false", tickDau: SuKienDoc | null = null): Promise<void> => {
    vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", v2);
    legacyDrv.tickTrongSubscribe = tickDau;
    expect(await ot.startOt()).toBe(true);
    await vi.waitFor(() => {
      drv = ha === "true" ? haDrv[0] : legacyDrv;
      expect(drv).toBeDefined();
      expect(drv.phien).toHaveLength(1);
    });
    if (ha === "true") drv.tickTrongSubscribe = tickDau; // HA: driver được tạo trong supervisor; lần đầu đã subscribe xong ở trên
  };
  const trangThai = () => tt.layTrangThaiAdapter(ID)?.tt;
  const phienCuoi = () => drv.phien[drv.phien.length - 1];
  /** Hai tick timeout liên tiếp trên phiên `p` ⇒ D1 hạ phiên ⇒ 'lost'. */
  const haPhien = async (p: Phien): Promise<void> => {
    p.onTick!(TICK_TIMEOUT);
    p.onTick!(TICK_TIMEOUT);
    await vi.waitFor(() => {
      expect(trangThai()).toBe("lost");
      expect(p.closed).toBe(true);
    });
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    vi.stubEnv("OT_CONN_HA_ENABLED", ha);
    vi.stubEnv("OT_CONN_HA_BACKOFF_MS", "2000");
    vi.stubEnv("OT_GHI_TRANG_THAI_ADAPTER_ENABLED", "true");
    vi.stubEnv("OT_LEGACY_RECONNECT_MS", "5000");
    vi.stubEnv("OT_CONN_HA_HEALTH_INTERVAL_MS", "100");
    vi.stubEnv("OT_CONN_HA_BACKOFF_JITTER", "0");
    bao = [];
    ghiDb = [];
    legacyDrv = new TcpLenDriver();
    haDrv = [];
    vi.doMock("./driverRegistry", () => ({
      createDriver: () => {
        const d = new TcpLenDriver();
        d.tickTrongSubscribe = legacyDrv.tickTrongSubscribe;
        haDrv.push(d);
        return d;
      },
    }));
    vi.doMock("./ingest", () => ({ ingestSample: async () => undefined, ingestSamples: async () => undefined }));
    vi.doMock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => [adapterFixture(legacyDrv)] }));
    vi.doMock("./trangThaiAdapter", async (importOriginal) => {
      const that = await importOriginal<typeof import("./trangThaiAdapter")>();
      return {
        ...that,
        baoTrangThaiAdapter: (...args: Parameters<typeof that.baoTrangThaiAdapter>) => {
          if (args[0].adapterId === ID) bao.push(args[1]);
          return that.baoTrangThaiAdapter(...args);
        },
      };
    });
    ot = await import("./otManager");
    tt = await import("./trangThaiAdapter");
    tt.__datLaiTrangThaiAdapter();
    tt.__datGhiDb(async (adapterId, s) => {
      if (adapterId === ID) ghiDb.push(s);
    });
  });

  afterEach(async () => {
    await ot.stopOt();
    tt.__datGhiDb(null);
    tt.__datLaiTrangThaiAdapter();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe("cờ V2 BẬT", () => {
    it("TCP lên + MỌI tick timeout ⇒ không bao giờ 'connected' (RAM lẫn DB), kể cả qua nhiều phiên nối lại", async () => {
      await khoiDong("true");
      // TCP lên, chưa có tick: vòng canh legacy (500 ms) / health HA (100 ms) chạy nhiều lần vẫn không được báo connected.
      await vi.advanceTimersByTimeAsync(3000);
      expect(trangThai()).toBe("connecting");
      for (let vong = 0; vong < 3; vong++) {
        const p = phienCuoi();
        await haPhien(p);
        // Nối lại nhanh mở phiên mới (TCP lại lên) — vẫn chỉ toàn timeout.
        await vi.waitFor(() => expect(drv.phien.length).toBeGreaterThan(vong + 1), { timeout: 10_000 });
        await vi.advanceTimersByTimeAsync(1500);
        expect(trangThai()).toBe("lost");
      }
      await vi.advanceTimersByTimeAsync(12_000); // xả mọi lần ghi DB đang hẹn (điều tiết 5 s)
      expect(bao).not.toContain("connected");
      expect(ghiDb.length).toBeGreaterThan(0);
      expect(ghiDb).not.toContain("connected");
    });

    it("tick ĐỌC TỐT đầu tiên của phiên ⇒ 'connected' (RAM ngay, DB sau điều tiết)", async () => {
      await khoiDong("true");
      await vi.advanceTimersByTimeAsync(2000);
      expect(trangThai()).toBe("connecting");
      expect(bao).not.toContain("connected");
      phienCuoi().onTick!(TICK_TOT);
      expect(trangThai()).toBe("connected");
      await vi.advanceTimersByTimeAsync(6000);
      expect(ghiDb[ghiDb.length - 1]).toBe("connected");
      // legacyTick báo lại cùng trạng thái mỗi vòng (no-op ở baoTrangThaiAdapter) ⇒ đếm CHUYỂN trạng thái, không đếm lời gọi.
      const chuyen = bao.filter((s, i) => i === 0 || bao[i - 1] !== s);
      expect(chuyen.filter((s) => s === "connected")).toHaveLength(1);
    });

    it("lần đọc ĐẦU tức thì về TRƯỚC khi subscribe trả handle ⇒ 'connected' ngay khi phiên thành hoạt động (cổng G3/G4 R0)", async () => {
      await khoiDong("true", TICK_TOT);
      await vi.waitFor(() => expect(trangThai()).toBe("connected"));
    });

    it("phiên MỚI (nối lại) chờ lại lần đọc tốt của CHÍNH nó", async () => {
      await khoiDong("true");
      phienCuoi().onTick!(TICK_TOT);
      expect(trangThai()).toBe("connected");
      await haPhien(drv.phien[0]);
      await vi.waitFor(() => expect(drv.phien).toHaveLength(2), { timeout: 10_000 });
      await vi.advanceTimersByTimeAsync(3000); // TCP đã lên lại: vòng canh/health không được báo connected
      expect(trangThai()).toBe("lost");
      drv.phien[1].onTick!(TICK_TOT);
      expect(trangThai()).toBe("connected");
    });

    it("tick tốt MUỘN của phiên CŨ không báo 'connected' cho phiên mới", async () => {
      await khoiDong("true");
      const p1 = drv.phien[0];
      p1.onTick!(TICK_TOT);
      await haPhien(p1);
      await vi.waitFor(() => expect(drv.phien).toHaveLength(2), { timeout: 10_000 });
      await vi.advanceTimersByTimeAsync(500);
      p1.onTick!(TICK_TOT); // muộn, phiên đã bị thay
      await vi.advanceTimersByTimeAsync(1000);
      expect(trangThai()).toBe("lost");
      drv.phien[1].onTick!(TICK_TOT);
      expect(trangThai()).toBe("connected");
    });

    it("reset phiên (resetAdapterSession — dispatcher sau lệnh ghi quá hạn) ⇒ phiên mới chờ lại, không giữ 'connected' của phiên cũ", async () => {
      await khoiDong("true");
      phienCuoi().onTick!(TICK_TOT);
      expect(trangThai()).toBe("connected");
      const r = await ot.resetAdapterSession(ID, "test reset", 5000);
      expect(r.reset).toBe(true);
      expect(drv.phien).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(2000);
      // legacy: reset không đi qua 'lost' ⇒ 'connecting'; HA: supervisor 'reconnecting' ⇒ 'lost' (như trước).
      expect(trangThai()).toBe(ha === "true" ? "lost" : "connecting");
      drv.phien[0].onTick!(TICK_TOT); // muộn, phiên cũ
      expect(trangThai()).not.toBe("connected");
      drv.phien[1].onTick!(TICK_TOT);
      expect(trangThai()).toBe("connected");
    });

    it("ok:true mà mọi tag bad vì CẤU HÌNH ⇒ là đọc tốt; ok:true mà mọi tag comm_lost (D1 coi là tick hỏng) ⇒ không", async () => {
      await khoiDong("true");
      phienCuoi().onTick!(TICK_OK_TOAN_COMM_LOST);
      await vi.advanceTimersByTimeAsync(200);
      expect(trangThai()).toBe("connecting");
      phienCuoi().onTick!(TICK_OK_MOI_TAG_BAD_CAU_HINH);
      expect(trangThai()).toBe("connected");
    });
  });

  describe("cờ V2 TẮT — hồi quy: y như trước", () => {
    it("TCP lên ⇒ 'connected' không cần tick nào; nối lại ⇒ 'connected' lại không cần tick", async () => {
      await khoiDong("false");
      await vi.waitFor(() => expect(trangThai()).toBe("connected"));
      await vi.advanceTimersByTimeAsync(6000);
      expect(ghiDb).toContain("connected");
      // Mất (driver báo ngắt) ⇒ lost ⇒ nối lại ⇒ connected, không một tick nào.
      drv.connected = false;
      await vi.waitFor(() => expect(trangThai()).toBe("lost"), { timeout: 5000 });
      await vi.waitFor(() => expect(trangThai()).toBe("connected"), { timeout: 10_000 });
    });
  });
});
