/**
 * doc 81 Đợt 1D final wave 1 (Ruling R-1D-k, final review I1) — otManager GHI dấu vân tay kết nối LÚC NỐI.
 *
 * Sửa adapter không nối lại driver (otManager chỉ có stopOt+startOt toàn khung), nên dấu của kết nối đang chạy
 * phải là dấu của cấu hình driver ĐÃ nối — không phải của hàng DB hiện tại. commandDispatcher so hai dấu đó
 * trước khi miễn preflight cho lệnh DỪNG ghim (pinnedStop.dot1d.db.test.ts, ca I1).
 * Oracle: hàng adapter viết tay (cùng hình hàng DB); RuntimeAdapter dựng như loadEnabledAdapters (options null ⇒
 * undefined). Driver giả, không I/O.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OtConnectionConfig, OtProtocol, OtTagAddress } from "./otDriver";
import { adapterTargetFingerprint, adapterTargetCanonical } from "./adapterTarget";

type Row = { id: number; protocol: string; endpoint: string; machineId: number | null; connectionOptions: Record<string, unknown> | null };

class FakeDriver {
  readonly protocol = "stub";
  connected = false;
  constructor(private readonly onConnect?: (cfg: OtConnectionConfig) => void, private readonly fail = false) {}
  async connect(cfg: OtConnectionConfig) {
    if (this.fail) throw new Error("connect refused");
    this.onConnect?.(cfg);
    this.connected = true;
  }
  async disconnect() {
    this.connected = false;
  }
  isConnected() {
    return this.connected;
  }
  async subscribe(_tags: OtTagAddress[], _on: unknown, _ms: number) {
    return { close: async () => undefined };
  }
  async readTags() {
    return [];
  }
  async writeTags() {
    return [];
  }
  async health() {
    return { ok: true } as never;
  }
}

/** RuntimeAdapter như loadEnabledAdapters dựng từ một hàng. */
function runtimeFrom(row: Row, driver: FakeDriver) {
  return {
    adapterId: row.id,
    code: `A${row.id}`,
    machineId: row.machineId,
    protocol: row.protocol as OtProtocol,
    connection: { endpoint: row.endpoint, options: row.connectionOptions ?? undefined, timeoutMs: undefined } as OtConnectionConfig,
    pollIntervalMs: 1000,
    tags: [] as OtTagAddress[],
    driver: driver as never,
    backupConnection: undefined as OtConnectionConfig | undefined,
  };
}

const ROW: Row = { id: 41, protocol: "modbus", endpoint: "tcp://10.0.0.5:502", machineId: 7, connectionOptions: { unitId: 1, password: "enc:v1:xx" } };

describe("adapterTarget — MỘT định nghĩa 'thiết bị nào' (thuần)", () => {
  it("bí mật / tài khoản / chế độ bảo mật KHÔNG đổi dấu; endpoint / protocol / machineId / unitId / ha.secondaryEndpoint ĐỔI dấu", () => {
    const fp = (r: Partial<Row>) => adapterTargetFingerprint({ ...ROW, ...r });
    const base = fp({});
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(fp({ connectionOptions: { unitId: 1, password: "enc:v1:KHAC", userName: "u2", securityMode: "None" } })).toBe(base);
    expect(fp({ connectionOptions: { password: "enc:v1:xx", unitId: 1 } })).toBe(base); // thứ tự khoá không quan trọng
    for (const doi of [
      { endpoint: "tcp://10.0.0.6:502" },
      { protocol: "s7" },
      { machineId: 8 },
      { machineId: null },
      { connectionOptions: { unitId: 2, password: "enc:v1:xx" } },
      { connectionOptions: { unitId: 1, ha: { secondaryEndpoint: "tcp://10.0.0.9:502" } } },
      { connectionOptions: null },
    ] as Array<Partial<Row>>) {
      expect(fp(doi), JSON.stringify(doi)).not.toBe(base);
    }
    // connectionOptions vắng ≡ null (RuntimeAdapter mang undefined khi hàng là null).
    expect(adapterTargetCanonical({ ...ROW, connectionOptions: undefined })).toBe(adapterTargetCanonical({ ...ROW, connectionOptions: null }));
  });
});

describe("otManager — dấu vân tay kết nối ghi LÚC NỐI (R-1D-k)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("legacy: dấu = dấu của hàng đã nối; hàng đổi sang thiết bị khác (chưa nối lại) ⇒ dấu VẪN của thiết bị cũ; stopOt ⇒ không còn dấu; startOt lại ⇒ dấu mới", async () => {
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    let rows: Row[] = [ROW];
    vi.doMock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => rows.map((r) => runtimeFrom(r, new FakeDriver())) }));
    vi.doMock("./ingest", () => ({ ingestSample: async () => undefined }));
    const ot = await import("./otManager");
    try {
      expect(await ot.startOt()).toBe(true);
      expect(ot.getActiveConnectionFingerprint(ROW.id)).toBe(adapterTargetFingerprint(ROW));

      const repointed: Row = { ...ROW, endpoint: "tcp://10.0.0.99:502" };
      rows = [repointed]; // hàng DB đổi — otManager KHÔNG nạp lại
      expect(ot.getActiveConnectionFingerprint(ROW.id)).toBe(adapterTargetFingerprint(ROW));
      expect(ot.getActiveConnectionFingerprint(ROW.id)).not.toBe(adapterTargetFingerprint(repointed));

      await ot.stopOt();
      expect(ot.getActiveConnectionFingerprint(ROW.id)).toBeUndefined();
      expect(await ot.startOt()).toBe(true); // khởi động lại toàn khung = nối lại
      expect(ot.getActiveConnectionFingerprint(ROW.id)).toBe(adapterTargetFingerprint(repointed));
    } finally {
      await ot.stopOt();
    }
  });

  it("legacy: dấu chụp TRƯỚC connect — driver sửa options lúc nối không làm lệch dấu", async () => {
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    const mutating = new FakeDriver((cfg) => {
      (cfg.options as Record<string, unknown>).unitId = 99;
    });
    vi.doMock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => [runtimeFrom({ ...ROW, connectionOptions: { unitId: 1 } }, mutating)] }));
    vi.doMock("./ingest", () => ({ ingestSample: async () => undefined }));
    const ot = await import("./otManager");
    try {
      await ot.startOt();
      expect(ot.getActiveConnectionFingerprint(ROW.id)).toBe(adapterTargetFingerprint({ ...ROW, connectionOptions: { unitId: 1 } }));
    } finally {
      await ot.stopOt();
    }
  });

  it("legacy: adapter nối THẤT BẠI ⇒ không có dấu (dispatcher coi như không khớp)", async () => {
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    vi.stubEnv("OT_LEGACY_RECONNECT_MS", "3600000");
    vi.doMock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => [runtimeFrom(ROW, new FakeDriver(undefined, true))] }));
    vi.doMock("./ingest", () => ({ ingestSample: async () => undefined }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ot = await import("./otManager");
    try {
      await ot.startOt();
      expect(ot.getActiveConnectionFingerprint(ROW.id)).toBeUndefined();
    } finally {
      await ot.stopOt();
      warn.mockRestore();
    }
  });

  it("HA: supervisor đăng ký kèm dấu của cấu hình đã nối", async () => {
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    vi.stubEnv("OT_CONN_HA_ENABLED", "true");
    vi.doMock("./driverRegistry", () => ({ createDriver: () => new FakeDriver() }));
    vi.doMock("./deviceAdapter", () => ({ loadEnabledAdapters: async () => [runtimeFrom(ROW, new FakeDriver())] }));
    vi.doMock("./ingest", () => ({ ingestSample: async () => undefined }));
    const ot = await import("./otManager");
    try {
      await ot.startOt();
      expect(ot.getActiveConnectionFingerprint(ROW.id)).toBe(adapterTargetFingerprint(ROW));
    } finally {
      await ot.stopOt();
    }
  });
});
