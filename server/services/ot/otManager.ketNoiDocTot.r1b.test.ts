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
import { laDocTot, laTickHong, mauMayChuDaTraLoi, taoBatDocTot } from "./reconnectNhanh";

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
/** R1b-2a T13 — mẫu xấu mà máy chủ VẪN đã trả lời (K13: chỉ bad + comm_lost là chưa trả lời, như đường poll). */
const mauXau = (reason: OtSample["reason"], tagKey = "t1"): OtSample => ({
  tagKey,
  raw: null,
  value: null,
  quality: "bad",
  timestamp: new Date(),
  ...(reason ? { reason } : {}),
});
const MAU_UNCERTAIN: OtSample = { tagKey: "t1", raw: 1, value: 1, quality: "uncertain", timestamp: new Date(), reason: "device_error" };
/**
 * R1b-2a T13 — tick lỗi `ok:false` mà phân loại lỗi KHÔNG phải mất liên lạc (chatLuongLoiChung: lỗi không nhận ra ⇒ device_error).
 * vongPoll (cờ V2) phát loạt `mauXauChoMoiTag(…, reason)` SAU tick này ⇒ các mẫu bad/device_error đó không được làm đường poll đổi nghĩa.
 */
const TICK_LOI_KHONG_NHAN_RA: SuKienDoc = { ok: false, timeout: false, ms: 5, tags: [], statusCode: "weird", reason: "device_error" };

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

    describe("R1b-2b-1 T5 (mục 51, C5) — MỌI tag sai cấu hình cục bộ ⇒ 'connecting' + lý do 'moi_tag_sai_cau_hinh', không lost, không nối lại", () => {
      const lyDo = () => tt.layTrangThaiAdapter(ID)?.lyDo ?? null;
      const mauTrungTinh = (tagKey: string): OtSample => ({
        tagKey,
        raw: undefined,
        value: null,
        quality: "bad",
        timestamp: new Date(),
        tsSource: "server",
        statusCode: "BadNodeIdInvalid (0x80330000)",
        reason: "config_error",
      });
      const TICK_TRUNG_TINH: SuKienDoc = {
        ok: true,
        timeout: false,
        ms: 1,
        tags: TAGS.map((t) => ({ tagKey: t.tagKey, quality: "bad" as const, reason: "config_error" as const, statusCode: "invalid_address" })),
      };

      it("push OPC UA: mọi item BadNodeIdInvalid (lặp 3 lượt) ⇒ connecting + lý do; không lost, không phiên mới; mẫu good ⇒ connected, lý do xoá", async () => {
        legacyDrv.push = true;
        await khoiDong("true");
        const p = drv.phien[0];
        expect(p.onTick).toBeUndefined();
        for (let i = 0; i < 3; i++) {
          await p.onSample(mauTrungTinh("t1"));
          await p.onSample(mauTrungTinh("t2"));
          await vi.advanceTimersByTimeAsync(1000);
        }
        expect(trangThai()).toBe("connecting");
        expect(lyDo()).toBe("moi_tag_sai_cau_hinh");
        await vi.advanceTimersByTimeAsync(6000);
        expect(bao).not.toContain("connected");
        expect(bao).not.toContain("lost");
        expect(drv.phien).toHaveLength(1);
        expect(ha === "true" ? haDrv.length : 1).toBe(1);
        await p.onSample(MAU_GOOD);
        expect(trangThai()).toBe("connected");
        expect(lyDo()).toBeNull();
      });

      it("poll: tick mọi tag invalid_address (kể cả lần đọc đầu trong subscribe) ⇒ connecting + lý do; tick tốt ⇒ connected, lý do xoá", async () => {
        await khoiDong("true", TICK_TRUNG_TINH);
        for (let i = 0; i < 3; i++) {
          phienCuoi().onTick!(TICK_TRUNG_TINH);
          await vi.advanceTimersByTimeAsync(1000);
        }
        expect(trangThai()).toBe("connecting");
        expect(lyDo()).toBe("moi_tag_sai_cau_hinh");
        expect(bao).not.toContain("lost");
        expect(drv.phien).toHaveLength(1);
        phienCuoi().onTick!(TICK_TOT);
        expect(trangThai()).toBe("connected");
        expect(lyDo()).toBeNull();
      });

      it("lý do không bám sang 'lost': phiên trung tính rồi mất (driver báo ngắt) ⇒ lost, lý do xoá", async () => {
        await khoiDong("true", TICK_TRUNG_TINH);
        await vi.advanceTimersByTimeAsync(500);
        expect(lyDo()).toBe("moi_tag_sai_cau_hinh");
        // phiên nối lại KHÔNG có lần đọc nào (không tick trung tính mới) ⇒ lý do chỉ có thể còn nếu 'lost' không xoá nó
        drv.tickTrongSubscribe = null;
        legacyDrv.tickTrongSubscribe = null;
        drv.connected = false;
        await vi.waitFor(() => expect(trangThai()).toBe("lost"), { timeout: 5000 });
        expect(lyDo()).toBeNull();
      });

      it("mẫu trung tính SAU lần đọc tốt của cùng phiên (push) không gắn lại lý do cho phiên đã connected", async () => {
        legacyDrv.push = true;
        await khoiDong("true");
        const p = drv.phien[0];
        await p.onSample(MAU_GOOD);
        expect(trangThai()).toBe("connected");
        await p.onSample(mauTrungTinh("t2"));
        expect(trangThai()).toBe("connected");
        expect(lyDo()).toBeNull();
      });
    });

    describe("R1b-2a T13 — đường PUSH đếm đọc tốt theo 'máy chủ đã trả lời', cùng luật với đường poll (K13)", () => {
      it.each([
        ["uncertain", MAU_UNCERTAIN],
        ["bad + config_error", mauXau("config_error")],
        ["bad + device_error", mauXau("device_error")],
        ["bad + out_of_range", mauXau("out_of_range")],
        ["bad + stale (K13: stale = đã trả lời, như đường poll)", mauXau("stale")],
      ] as const)("mẫu đầu %s ⇒ connected", async (_n, mau) => {
        legacyDrv.push = true;
        await khoiDong("true");
        const p = drv.phien[0];
        expect(p.onTick).toBeUndefined();
        await vi.advanceTimersByTimeAsync(2000);
        expect(trangThai()).toBe("connecting");
        await p.onSample(mau);
        expect(trangThai()).toBe("connected");
      });

      it("bad + comm_lost (mọi tag, lặp lại) ⇒ VẪN connecting, RAM lẫn DB; mẫu kế bad + config_error ⇒ connected", async () => {
        legacyDrv.push = true;
        await khoiDong("true");
        const p = drv.phien[0];
        for (let i = 0; i < 3; i++) {
          await p.onSample(mauXau("comm_lost", "t1"));
          await p.onSample(mauXau("comm_lost", "t2"));
          await vi.advanceTimersByTimeAsync(1000);
        }
        expect(trangThai()).toBe("connecting");
        await vi.advanceTimersByTimeAsync(6000);
        expect(bao).not.toContain("connected");
        expect(ghiDb).not.toContain("connected");
        await p.onSample(mauXau("config_error", "t2"));
        expect(trangThai()).toBe("connected");
      });

      it("fix round 1 (fail-closed): phiên push CHỈ nhận mẫu bad KHÔNG lý do (OPC UA: item err / terminated(err) sau khi rớt) ⇒ KHÔNG BAO GIỜ connected, RAM lẫn DB; mẫu kế bad + device_error ⇒ connected", async () => {
        legacyDrv.push = true;
        await khoiDong("true");
        const p = drv.phien[0];
        for (let i = 0; i < 4; i++) {
          await p.onSample(mauXau(undefined, "t1"));
          await p.onSample({ ...mauXau(undefined, "t2"), statusCode: "BadSubscriptionIdInvalid" });
          await vi.advanceTimersByTimeAsync(1000);
        }
        expect(trangThai()).toBe("connecting");
        await vi.advanceTimersByTimeAsync(6000);
        expect(bao).not.toContain("connected");
        expect(ghiDb).not.toContain("connected");
        await p.onSample(mauXau("device_error", "t1"));
        expect(trangThai()).toBe("connected");
      });

      it("đường POLL không đổi nghĩa: tick lỗi ok:false (device_error) rồi loạt mẫu xấu của nó ⇒ VẪN connecting; tick laDocTot ⇒ connected", async () => {
        await khoiDong("true");
        const p = phienCuoi();
        expect(p.onTick).toBeDefined();
        p.onTick!(TICK_LOI_KHONG_NHAN_RA);
        await p.onSample(mauXau("device_error", "t1"));
        await p.onSample(mauXau("device_error", "t2"));
        await vi.advanceTimersByTimeAsync(200);
        expect(trangThai()).toBe("connecting");
        p.onTick!(TICK_OK_MOI_TAG_BAD_CAU_HINH);
        expect(trangThai()).toBe("connected");
      });

      it("đường POLL: mẫu của lần đọc THÀNH CÔNG về trước tick của nó (vongPoll phát rồi mới báo tick) ⇒ connected, như laDocTot", async () => {
        await khoiDong("true");
        await phienCuoi().onSample(MAU_UNCERTAIN);
        expect(trangThai()).toBe("connected");
      });
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

    it("R1b-2a T13 — đường PUSH cờ tắt: TCP lên ⇒ 'connected' không cần mẫu nào; mẫu bad/comm_lost không đổi gì", async () => {
      legacyDrv.push = true;
      await khoiDong("false");
      await vi.waitFor(() => expect(trangThai()).toBe("connected"));
      await drv.phien[0].onSample(MAU_BAD);
      await vi.advanceTimersByTimeAsync(1000);
      expect(trangThai()).toBe("connected");
      expect(chuyen(bao)).toEqual(["connecting", "connected"]);
    });
  });
});

/**
 * R1b-2b-1 T5 (mục 51, C5) — phiên S7 THẬT (S7Driver + vòng poll chung THẬT; nodes7 giả) mà MỌI địa chỉ sai, cờ V2 bật. Driver không gửi
 * yêu cầu đọc nào (readAllItems không bao giờ được gọi) ⇒ sau 3 tick: 'connecting' + lý do 'moi_tag_sai_cau_hinh'; không 'lost', không nối lại.
 */
describe.each([
  ["legacy", "false"],
  ["HA (ConnectionSupervisor thật)", "true"],
] as const)("R1b-2b-1 T5 — phiên S7 thật, mọi địa chỉ sai (%s)", (_nhan, ha) => {
  const ID_S7 = 4344;
  const TAGS_SAI: OtTagAddress[] = [
    { tagKey: "a", address: "XYZ", dataType: "float" },
    { tagKey: "b", address: "DB1,QQQ9", dataType: "float" },
  ];
  let ot: typeof import("./otManager");
  let tt: typeof import("./trangThaiAdapter");
  let bao: string[];
  let soDoc: number;
  let soTaoDriver: number;
  let lib: { initiateConnection: ReturnType<typeof vi.fn>; readAllItems: ReturnType<typeof vi.fn> };

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
    vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", "true");
    bao = [];
    soDoc = 0;
    soTaoDriver = 0;
    lib = {
      initiateConnection: vi.fn((_o: unknown, cb: (err?: unknown) => void) => cb()),
      readAllItems: vi.fn((cb: (bad: boolean, v: Record<string, unknown>) => void) => cb(false, {})),
    };
    const conn = {
      ...lib,
      setTranslationCB: vi.fn(),
      addItems: vi.fn(),
      removeItems: vi.fn(),
      writeItems: vi.fn(),
      dropConnection: vi.fn((cb: () => void) => cb()),
      isoConnectionState: 4,
    };
    function NodeS7(this: Record<string, unknown>) {
      Object.assign(this, conn);
    }
    vi.doMock("nodes7", () => ({ default: NodeS7 }));
    const { S7Driver } = await import("./drivers/s7Driver");
    const taoDriver = () => {
      soTaoDriver += 1;
      const d = new S7Driver();
      const doc = d.readTags.bind(d);
      d.readTags = async (t) => {
        soDoc += 1;
        return doc(t);
      };
      return d;
    };
    const legacyDrv = taoDriver();
    vi.doMock("./driverRegistry", () => ({ createDriver: () => taoDriver() }));
    vi.doMock("./ingest", () => ({ ingestSample: async () => undefined, ingestSamples: async () => undefined }));
    vi.doMock("./deviceAdapter", () => ({
      loadEnabledAdapters: async () => [
        {
          adapterId: ID_S7,
          code: "T5-S7-SAI",
          machineId: null,
          protocol: "s7" as OtProtocol,
          connection: { endpoint: "tcp://127.0.0.1:102", timeoutMs: 800 } as OtConnectionConfig,
          pollIntervalMs: 1000,
          tags: TAGS_SAI,
          driver: legacyDrv,
        },
      ],
    }));
    vi.doMock("./trangThaiAdapter", async (importOriginal) => {
      const that = await importOriginal<typeof import("./trangThaiAdapter")>();
      return {
        ...that,
        baoTrangThaiAdapter: (...args: Parameters<typeof that.baoTrangThaiAdapter>) => {
          if (args[0].adapterId === ID_S7) bao.push(args[1]);
          return that.baoTrangThaiAdapter(...args);
        },
      };
    });
    ot = await import("./otManager");
    tt = await import("./trangThaiAdapter");
    tt.__datLaiTrangThaiAdapter();
    tt.__datGhiDb(async () => undefined);
  });

  afterEach(async () => {
    await ot.stopOt();
    tt.__datGhiDb(null);
    tt.__datLaiTrangThaiAdapter();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.doUnmock("nodes7");
  });

  it("sau ≥ 3 tick: 'connecting' + lý do 'moi_tag_sai_cau_hinh'; không lost, không connected, không nối lại, không gửi yêu cầu đọc", async () => {
    expect(await ot.startOt()).toBe(true);
    await vi.waitFor(() => expect(soDoc).toBeGreaterThanOrEqual(1));
    await vi.advanceTimersByTimeAsync(2500); // lần đọc đầu (D2) + 2 chu kỳ 1000 ms
    expect(soDoc).toBeGreaterThanOrEqual(3);
    expect(tt.layTrangThaiAdapter(ID_S7)?.tt).toBe("connecting");
    expect(tt.layTrangThaiAdapter(ID_S7)?.lyDo).toBe("moi_tag_sai_cau_hinh");
    await vi.advanceTimersByTimeAsync(10_000); // thêm 10 tick: D1 không bắn, vòng canh/health không nối lại
    expect(tt.layTrangThaiAdapter(ID_S7)?.tt).toBe("connecting");
    expect(tt.layTrangThaiAdapter(ID_S7)?.lyDo).toBe("moi_tag_sai_cau_hinh");
    expect(bao).not.toContain("lost");
    expect(bao).not.toContain("connected");
    expect(lib.initiateConnection).toHaveBeenCalledTimes(1);
    expect(soTaoDriver).toBe(ha === "true" ? 2 : 1); // HA: driver fixture (không dùng) + MỘT driver của supervisor
    expect(lib.readAllItems).not.toHaveBeenCalled();
  });
});

describe("R1b-2a T13 — luật chung `mauMayChuDaTraLoi` / `taoBatDocTot` (reconnectNhanh, thuần)", () => {
  const Q = ["good", "uncertain", "bad"] as const;
  const R = [undefined, "comm_lost", "device_error", "config_error", "out_of_range", "stale"] as const;
  const moiMau = Q.flatMap((quality) => R.map((reason) => (reason ? { quality, reason } : { quality })));

  it("chỉ bad + comm_lost HOẶC bad KHÔNG lý do là CHƯA trả lời (K13 + fix round 1 fail-closed): stale, device_error, uncertain + comm_lost đều ĐÃ trả lời", () => {
    expect(mauMayChuDaTraLoi({ quality: "bad", reason: "comm_lost" })).toBe(false);
    expect(mauMayChuDaTraLoi({ quality: "bad" })).toBe(false);
    expect(mauMayChuDaTraLoi({ quality: "bad", reason: undefined })).toBe(false);
    expect(mauMayChuDaTraLoi({ quality: "bad", reason: "stale" })).toBe(true);
    expect(mauMayChuDaTraLoi({ quality: "bad", reason: "device_error" })).toBe(true);
    expect(mauMayChuDaTraLoi({ quality: "bad", reason: "out_of_range" })).toBe(true);
    expect(mauMayChuDaTraLoi({ quality: "uncertain" })).toBe(true);
    expect(mauMayChuDaTraLoi({ quality: "bad", reason: "config_error" })).toBe(true);
    expect(mauMayChuDaTraLoi({ quality: "uncertain", reason: "comm_lost" })).toBe(true);
    expect(mauMayChuDaTraLoi({ quality: "good" })).toBe(true);
  });

  it("fix round 1 — đường poll cùng luật: tick ok:true mà MỌI tag bad KHÔNG lý do ⇒ tick hỏng, không phải đọc tốt; thêm một tag device_error ⇒ đọc tốt", () => {
    const e: SuKienDoc = { ok: true, timeout: false, ms: 1, tags: [{ tagKey: "a", quality: "bad" }, { tagKey: "b", quality: "bad" }] };
    expect(laTickHong(e)).toBe(true);
    expect(laDocTot(e)).toBe(false);
    const e2: SuKienDoc = { ...e, tags: [...e.tags, { tagKey: "c", quality: "bad", reason: "device_error" }] };
    expect(laTickHong(e2)).toBe(false);
    expect(laDocTot(e2)).toBe(true);
  });

  it("tương đương CHÍNH XÁC với laDocTot trên mọi tick ok:true một và hai tag (mọi tổ hợp chất lượng × lý do)", () => {
    const tick = (tags: { quality: OtSample["quality"]; reason?: OtSample["reason"] }[]): SuKienDoc => ({
      ok: true,
      timeout: false,
      ms: 1,
      tags: tags.map((t, i) => ({ tagKey: `t${i}`, ...t })),
    });
    let n = 0;
    for (const a of moiMau) {
      expect(laDocTot(tick([a]))).toBe(mauMayChuDaTraLoi(a));
      for (const b of moiMau) {
        expect(laDocTot(tick([a, b]))).toBe(mauMayChuDaTraLoi(a) || mauMayChuDaTraLoi(b));
        n++;
      }
    }
    expect(n).toBe(moiMau.length ** 2);
  });

  it("taoBatDocTot: mẫu đã trả lời TRƯỚC mọi tick ⇒ báo; sau MỘT tick bất kỳ (kể cả ok:false) mẫu không còn quyết định; tick laDocTot ⇒ báo", () => {
    const bao1 = vi.fn();
    const b1 = taoBatDocTot(bao1);
    b1.quaMau({ quality: "bad", reason: "comm_lost" });
    expect(bao1).not.toHaveBeenCalled();
    b1.quaMau({ quality: "bad", reason: "stale" });
    expect(bao1).toHaveBeenCalledTimes(1);

    const bao2 = vi.fn();
    const b2 = taoBatDocTot(bao2);
    b2.quaTick(TICK_LOI_KHONG_NHAN_RA);
    b2.quaMau({ quality: "bad", reason: "device_error" });
    b2.quaMau({ quality: "good" });
    expect(bao2).not.toHaveBeenCalled();
    b2.quaTick(TICK_OK_TOAN_COMM_LOST);
    expect(bao2).not.toHaveBeenCalled();
    b2.quaTick(TICK_OK_MOI_TAG_BAD_CAU_HINH);
    expect(bao2).toHaveBeenCalledTimes(1);
  });
});

/**
 * R1b-2b-1 T5 fix round 1 (I1) — phiên OPC UA THẬT (OpcuaDriver + node-opcua giả, OT_OPCUA_MONITORED_ITEMS bật, cờ V2 bật), qua otManager
 * (legacy và HA). MỌI địa chỉ sai cục bộ ⇒ đường push lui về poll ⇒ 'connecting' + lý do; MỘT PHẦN sai ⇒ đường push thật: lý do tạm cho
 * tới thay đổi good đầu của item hợp lệ ⇒ 'connected', lý do xoá.
 */
describe.each([
  ["legacy", "false"],
  ["HA (ConnectionSupervisor thật)", "true"],
] as const)("R1b-2b-1 T5 fix round 1 — phiên OPC UA thật, địa chỉ sai cục bộ (%s)", (_nhan, ha) => {
  const ID_OPC = 4345;
  let ot: typeof import("./otManager");
  let tt: typeof import("./trangThaiAdapter");
  let bao: string[];
  let tagsAdapter: OtTagAddress[];
  let session: { read: ReturnType<typeof vi.fn> };
  let taoItem: ReturnType<typeof vi.fn>;
  let items: Array<{ fire: (dv: unknown) => void }>;
  let soConnect: number;

  const khoiDong = async (tags: OtTagAddress[]): Promise<void> => {
    tagsAdapter = tags;
    vi.doMock("./deviceAdapter", () => ({
      loadEnabledAdapters: async () => [
        {
          adapterId: ID_OPC,
          code: "T5-OPC-SAI",
          machineId: null,
          protocol: "opcua" as OtProtocol,
          connection: { endpoint: "opc.tcp://127.0.0.1:4840", timeoutMs: 800 } as OtConnectionConfig,
          pollIntervalMs: 1000,
          tags: tagsAdapter,
          driver: await taoDriver(),
        },
      ],
    }));
    ot = await import("./otManager");
    tt = await import("./trangThaiAdapter");
    tt.__datLaiTrangThaiAdapter();
    tt.__datGhiDb(async () => undefined);
    expect(await ot.startOt()).toBe(true);
  };
  let taoDriver: () => Promise<OtDriver>;

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
    vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", "true");
    vi.stubEnv("OT_OPCUA_MONITORED_ITEMS", "true");
    bao = [];
    items = [];
    soConnect = 0;
    session = { read: vi.fn(async (nodes: unknown[]) => nodes.map(() => ({ statusCode: { value: 0 }, sourceTimestamp: new Date(), value: { value: 2 } }))) };
    const s = { ...session, write: vi.fn(async () => []), close: vi.fn(async () => {}), createSubscription2: vi.fn(async () => ({ terminate: vi.fn(async () => {}) })) };
    taoItem = vi.fn(async () => {
      let h: ((dv: unknown) => void) | null = null;
      const item = {
        on: (evt: string, cb: (dv: unknown) => void) => {
          if (evt === "changed") h = cb;
        },
        fire: (dv: unknown) => h?.(dv),
      };
      items.push(item);
      return item;
    });
    vi.doMock("node-opcua", () => ({
      OPCUAClient: {
        create: vi.fn(() => ({
          connect: vi.fn(async () => {
            soConnect += 1;
          }),
          createSession: vi.fn(async () => s),
          disconnect: vi.fn(async () => {}),
        })),
      },
      AttributeIds: { Value: 13 },
      DataType: { Boolean: 1, Int32: 6, Double: 11, String: 12 },
      Variant: class {},
      ClientSubscription: { create: vi.fn(async () => ({ terminate: vi.fn(async () => {}) })) },
      ClientMonitoredItem: { create: taoItem },
      TimestampsToReturn: { Both: 2 },
      MonitoringMode: { Reporting: 1 },
    }));
    taoDriver = async () => {
      const { OpcuaDriver } = await import("./drivers/opcuaDriver");
      return new OpcuaDriver();
    };
    vi.doMock("./driverRegistry", () => ({ createDriver: () => taoDriverDongBo() }));
    const { OpcuaDriver } = await import("./drivers/opcuaDriver");
    const taoDriverDongBo = () => new OpcuaDriver();
    vi.doMock("./ingest", () => ({ ingestSample: async () => undefined, ingestSamples: async () => undefined }));
    vi.doMock("./trangThaiAdapter", async (importOriginal) => {
      const that = await importOriginal<typeof import("./trangThaiAdapter")>();
      return {
        ...that,
        baoTrangThaiAdapter: (...args: Parameters<typeof that.baoTrangThaiAdapter>) => {
          if (args[0].adapterId === ID_OPC) bao.push(args[1]);
          return that.baoTrangThaiAdapter(...args);
        },
      };
    });
  });

  afterEach(async () => {
    await ot?.stopOt();
    tt?.__datGhiDb(null);
    tt?.__datLaiTrangThaiAdapter();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.doUnmock("node-opcua");
  });

  const SAI = (k: string): OtTagAddress => ({ tagKey: k, address: `garbage-not-a-node-${k}`, dataType: "float" });

  it("MỌI địa chỉ sai ⇒ (lui về poll) sau ≥ 3 tick: 'connecting' + lý do 'moi_tag_sai_cau_hinh'; không lost/connected, không nối lại, không session.read", async () => {
    await khoiDong([SAI("a"), SAI("b")]);
    await vi.advanceTimersByTimeAsync(2500);
    await vi.waitFor(() => expect(tt.layTrangThaiAdapter(ID_OPC)?.lyDo).toBe("moi_tag_sai_cau_hinh"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tt.layTrangThaiAdapter(ID_OPC)?.tt).toBe("connecting");
    expect(tt.layTrangThaiAdapter(ID_OPC)?.lyDo).toBe("moi_tag_sai_cau_hinh");
    expect(bao).not.toContain("lost");
    expect(bao).not.toContain("connected");
    expect(soConnect).toBe(1);
    expect(taoItem).not.toHaveBeenCalled();
    expect(session.read).not.toHaveBeenCalled();
  });

  it("MỘT PHẦN sai (đường push thật) ⇒ lý do tạm khi chỉ có mẫu trung tính; thay đổi good đầu của item hợp lệ ⇒ 'connected', lý do xoá", async () => {
    await khoiDong([{ tagKey: "tot", address: "ns=2;s=Temp", dataType: "float" }, SAI("a")]);
    await vi.waitFor(() => expect(items).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(500);
    expect(tt.layTrangThaiAdapter(ID_OPC)?.tt).toBe("connecting");
    expect(tt.layTrangThaiAdapter(ID_OPC)?.lyDo).toBe("moi_tag_sai_cau_hinh");
    items[0].fire({ statusCode: { value: 0 }, sourceTimestamp: new Date(), value: { value: 2 } });
    await vi.waitFor(() => expect(tt.layTrangThaiAdapter(ID_OPC)?.tt).toBe("connected"));
    expect(tt.layTrangThaiAdapter(ID_OPC)?.lyDo).toBeNull();
    expect(bao).not.toContain("lost");
  });
});
