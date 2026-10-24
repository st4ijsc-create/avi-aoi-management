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
  onSample: OnOtSample;
  closed: boolean;
}

class TcpLenDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  connected = false;
  failConnect = false;
  /** Lần đọc đầu tức thì: phát tick này ĐỒNG BỘ trong subscribe, trước khi trả handle. */
  tickTrongSubscribe: SuKienDoc | null = null;
  /** Fix round 1 — đường PUSH (như OPC UA monitored items): subscribe KHÔNG giữ onTick, chỉ phát mẫu qua onSample. */
  push = false;
  /** Endpoint của lần connect gần nhất (HA dual-endpoint: phân biệt primary / secondary). */
  ep: string | null = null;
  /** Fix round 1 — móc chạy ĐỒNG BỘ đầu mỗi disconnect() (cửa sổ failover của supervisor). */
  onDisconnect: (() => void) | null = null;
  readonly phien: Phien[] = [];

  async connect(cfg: OtConnectionConfig): Promise<void> {
    this.ep = cfg.endpoint ?? null;
    if (this.failConnect) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.onDisconnect?.();
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
  async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    return tags.map((t) => ({ tagKey: t.tagKey, raw: 1, value: 1, quality: "good", timestamp: new Date() }));
  }
  async subscribe(_tags: OtTagAddress[], onSample: OnOtSample, _ms?: number, tuyChon?: TuyChonVongPoll): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new Error("not connected");
    const p: Phien = { onTick: this.push ? undefined : tuyChon?.onTick, onSample, closed: false };
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

const MAU_GOOD: OtSample = { tagKey: "t1", raw: 1, value: 1, quality: "good", timestamp: new Date() };
const MAU_BAD: OtSample = { tagKey: "t1", raw: null, value: null, quality: "bad", timestamp: new Date(), reason: "comm_lost" };

const ID = 4343;
/** Fix round 1 — adapter có endpoint dự phòng (failover HA). */
let coDuPhong = false;
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
    backupConnection: coDuPhong ? ({ endpoint: "stub://t3b", timeoutMs: 800 } as OtConnectionConfig) : undefined,
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
  /** Fix round 1 — số loạt mẫu xấu khi mất (trangThaiAdapter.phatMauXau ⇒ ingestSamples, mọi mẫu bad). */
  let loatXau: number;
  /** Chuyển trạng thái (bỏ lời gọi lặp lại cùng trạng thái — legacyTick báo lại mỗi vòng, no-op ở baoTrangThaiAdapter). */
  const chuyen = (xs: string[]): string[] => xs.filter((x, i) => i === 0 || xs[i - 1] !== x);
  const soLanMat = () => tt.layTrangThaiAdapter(ID)?.soLanMat;

  const khoiDong = async (v2: "true" | "false", tickDau: SuKienDoc | null = null): Promise<void> => {
    vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", v2);
    legacyDrv.tickTrongSubscribe = tickDau;
    expect(await ot.startOt()).toBe(true);
    if (coDuPhong) return;
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
    loatXau = 0;
    coDuPhong = false;
    legacyDrv = new TcpLenDriver();
    haDrv = [];
    vi.doMock("./driverRegistry", () => ({
      createDriver: () => {
        const d = new TcpLenDriver();
        d.tickTrongSubscribe = legacyDrv.tickTrongSubscribe;
        d.push = legacyDrv.push;
        haDrv.push(d);
        return d;
      },
    }));
    vi.doMock("./ingest", () => ({
      ingestSample: async () => undefined,
      ingestSamples: async (a: { adapterId: number }, mau: OtSample[]) => {
        if (a.adapterId === ID && mau.length > 0 && mau.every((m) => m.quality === "bad")) loatXau += 1;
      },
    }));
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

    /** Đợt mất #1, nối lại, liên kết ỔN ĐỊNH (> thoiGianOnDinhMs = 5 s), rồi reset phiên (dispatcher sau lệnh ghi quá hạn). */
    const matRoiOnDinhRoiReset = async (): Promise<void> => {
      await khoiDong("true");
      phienCuoi().onTick!(TICK_TOT);
      expect(trangThai()).toBe("connected");
      await haPhien(drv.phien[0]);
      await vi.waitFor(() => expect(loatXau).toBe(1));
      expect(soLanMat()).toBe(1);
      await vi.waitFor(() => expect(drv.phien).toHaveLength(2), { timeout: 10_000 });
      drv.phien[1].onTick!(TICK_TOT);
      expect(trangThai()).toBe("connected");
      await vi.advanceTimersByTimeAsync(12_000);
      expect(soLanMat()).toBe(1);
      const r = await ot.resetAdapterSession(ID, "test reset", 5000);
      expect(r.reset).toBe(true);
      expect(drv.phien).toHaveLength(3);
      // legacy: reset không đi qua 'lost' ⇒ 'connecting'; HA: supervisor 'reconnecting' ⇒ 'lost' (như trước).
      expect(trangThai()).toBe(ha === "true" ? "lost" : "connecting");
    };

    it("reset phiên sau liên kết ỔN ĐỊNH ⇒ phiên mới chờ lại; phiên mới chỉ timeout ⇒ đợt mất MỚI (soLanMat+1, loạt mẫu xấu)", async () => {
      await matRoiOnDinhRoiReset();
      await vi.advanceTimersByTimeAsync(2000);
      drv.phien[1].onTick!(TICK_TOT); // muộn, phiên cũ
      expect(trangThai()).not.toBe("connected");
      await haPhien(drv.phien[2]);
      await vi.waitFor(() => expect(loatXau).toBe(2));
      expect(soLanMat()).toBe(2);
      expect(bao).not.toContain("disabled");
    });

    it("reset phiên sau liên kết ỔN ĐỊNH ⇒ đọc tốt ⇒ connected ⇒ rớt NGAY (< 5 s) ⇒ vẫn là đợt MỚI, không gộp vào đợt cũ", async () => {
      await matRoiOnDinhRoiReset();
      drv.phien[2].onTick!(TICK_TOT);
      expect(trangThai()).toBe("connected");
      await vi.advanceTimersByTimeAsync(1000);
      await haPhien(drv.phien[2]);
      await vi.waitFor(() => expect(loatXau).toBe(2));
      expect(soLanMat()).toBe(2);
    });

    it("đường PUSH (không bao giờ onTick — OPC UA monitored items): mẫu good đầu tiên ⇒ connected; phiên mới chờ lại; mẫu good muộn của phiên cũ không báo", async () => {
      legacyDrv.push = true;
      await khoiDong("true");
      const p1 = drv.phien[0];
      expect(p1.onTick).toBeUndefined();
      await vi.advanceTimersByTimeAsync(2000);
      expect(trangThai()).toBe("connecting");
      await p1.onSample(MAU_BAD);
      expect(trangThai()).toBe("connecting");
      await p1.onSample(MAU_GOOD);
      expect(trangThai()).toBe("connected");
      // Mất (driver báo ngắt) ⇒ lost ⇒ nối lại ⇒ phiên 2 (TCP lên lại) — chờ mẫu good của CHÍNH nó.
      drv.connected = false;
      await vi.waitFor(() => expect(trangThai()).toBe("lost"), { timeout: 5000 });
      await vi.waitFor(() => expect(drv.phien).toHaveLength(2), { timeout: 10_000 });
      await vi.advanceTimersByTimeAsync(2000);
      expect(trangThai()).toBe("lost");
      await p1.onSample(MAU_GOOD); // muộn, phiên cũ
      expect(trangThai()).toBe("lost");
      await drv.phien[1].onSample(MAU_GOOD);
      expect(trangThai()).toBe("connected");
    });

    it.skipIf(ha !== "true")("HA failover: tick tốt về trong CỬA SỔ giữa phienHoatDong=phien và setState('connected') (lúc safeDisconnect endpoint cũ) ⇒ connected", async () => {
      coDuPhong = true;
      await khoiDong("true");
      let pri: TcpLenDriver | undefined;
      await vi.waitFor(() => {
        pri = haDrv.find((d) => d.ep === "stub://t3" && d.phien.length === 1);
        expect(pri).toBeDefined();
      });
      drv = pri!;
      drv.phien[0].onTick!(TICK_TOT);
      expect(trangThai()).toBe("connected");
      let trangThaiTrongCuaSo: string | undefined;
      drv.onDisconnect = () => {
        const sec = haDrv.find((d) => d.ep === "stub://t3b" && d.phien.length > 0);
        if (!sec || trangThaiTrongCuaSo !== undefined) return; // lần disconnect của onActiveLost (secondary chưa có phiên) bỏ qua
        trangThaiTrongCuaSo = trangThai();
        sec.phien[sec.phien.length - 1].onTick!(TICK_TOT);
      };
      drv.phien[0].onTick!(TICK_TIMEOUT);
      drv.phien[0].onTick!(TICK_TIMEOUT); // D1 ⇒ onActiveLost ⇒ failover sang secondary ⇒ safeDisconnect(primary) ⇒ móc phát tick tốt
      await vi.waitFor(() => expect(trangThaiTrongCuaSo).toBeDefined(), { timeout: 5000 });
      expect(trangThaiTrongCuaSo).toBe("lost");
      await vi.waitFor(() => expect(trangThai()).toBe("connected"), { timeout: 5000 });
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
    it("TCP lên ⇒ 'connected' không cần tick nào; mất ⇒ lost; nối lại ⇒ 'connected' không cần tick — đúng dãy chuyển, soLanMat 1", async () => {
      await khoiDong("false");
      await vi.waitFor(() => expect(trangThai()).toBe("connected"));
      await vi.advanceTimersByTimeAsync(6000);
      expect(ghiDb).toContain("connected");
      drv.connected = false;
      await vi.waitFor(() => expect(trangThai()).toBe("lost"), { timeout: 5000 });
      await vi.waitFor(() => expect(trangThai()).toBe("connected"), { timeout: 10_000 });
      expect(chuyen(bao)).toEqual(["connecting", "connected", "lost", "connected"]);
      expect(soLanMat()).toBe(1);
      await vi.advanceTimersByTimeAsync(100);
      expect(loatXau).toBe(0); // mẫu xấu khi mất chỉ phát khi cờ V2 bật (trangThaiAdapter) — cờ tắt: không có, như trước
    });

    it("reset phiên: legacy GIỮ 'connected' (không chuyển nào); HA đi qua 'lost' như trước", async () => {
      await khoiDong("false");
      await vi.waitFor(() => expect(trangThai()).toBe("connected"));
      await vi.advanceTimersByTimeAsync(1000);
      const n = bao.length;
      const r = await ot.resetAdapterSession(ID, "test reset", 5000);
      expect(r.reset).toBe(true);
      await vi.advanceTimersByTimeAsync(2000);
      expect(trangThai()).toBe("connected");
      if (ha === "true") {
        expect(chuyen(bao.slice(n))).toEqual(["lost", "connected"]);
        expect(soLanMat()).toBe(1);
      } else {
        expect(chuyen(bao.slice(n)).filter((x) => x !== "connected")).toEqual([]);
        expect(soLanMat()).toBe(0);
      }
    });
  });
});
