/**
 * SCADA R0 Task 5 — trạng thái adapter ghi ngược DB THẬT (`_test`) qua otManager (nhánh legacy) + stub có kịch bản.
 *
 * Adapter thật trong `device_adapters` (protocol stub, endpoint stub://r0-<ts>) + 2 `device_tags`; loader THẬT (lọc theo hàng của tệp
 * này để không nối adapter của suite khác); driver là StubDriver THẬT (`layStubDangChay(endpoint).simDatLoi`). `ingest` giả chỉ
 * ghi lại lời gọi (oracle cho mẫu xấu khi mất).
 *
 * Điều tiết ghi DB 5 s ⇒ lần đổi đầu ghi ngay, các lần sau tối đa mỗi 5 s (trailing) ⇒ mỗi chặng chờ ≤ ~7 s.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { layStubDangChay } from "./drivers/stubDriver";

const RUN = `r0t5-${process.pid}-${Date.now().toString(36)}`;
const ENDPOINT = `stub://${RUN}`;
const myIds = new Set<number>();

const ingestSamplesMock = vi.hoisted(() => vi.fn(async (_a: unknown, _s: unknown[]) => undefined));
vi.mock("./ingest", () => ({ ingestSample: async () => undefined, ingestSamples: ingestSamplesMock }));
// Chỉ "stub" chạy thật; hàng của suite khác (opcua…) nhận driver giả vì loader THẬT dựng driver cho MỌI hàng bật (registry rỗng ở đây).
vi.mock("./driverRegistry", async (importOriginal) => {
  const real = await importOriginal<typeof import("./driverRegistry")>();
  const { createStubDriver } = await import("./drivers/stubDriver");
  const gia = { protocol: "stub", isConnected: () => false } as never;
  return { ...real, createDriver: (p: string) => (p === "stub" ? createStubDriver() : gia) };
});
vi.mock("./deviceAdapter", async (importOriginal) => {
  const real = await importOriginal<typeof import("./deviceAdapter")>();
  return {
    ...real,
    loadEnabledAdapters: async () => (await real.loadEnabledAdapters()).filter((a) => myIds.has(a.adapterId)),
  };
});

let db: any;
let schema: typeof import("../../../drizzle/schema");
let adapterId = 0;

async function hang() {
  const [r] = await db.select().from(schema.deviceAdapters).where(eq(schema.deviceAdapters.id, adapterId)).limit(1);
  return r as { status: string; lastError: string | null; lastErrorAt: Date | null; lastConnectedAt: Date | null };
}

beforeAll(async () => {
  schema = await import("../../../drizzle/schema");
  const { getDb } = await import("../../db");
  db = await getDb();
  expect(db).toBeTruthy();
  const [a] = await db
    .insert(schema.deviceAdapters)
    .values({
      code: RUN,
      name: "R0 Task5",
      protocol: "stub",
      endpoint: ENDPOINT,
      connectionOptions: null,
      machineId: null,
      pollIntervalMs: 500,
      isEnabled: true,
      status: "disabled",
    })
    .returning({ id: schema.deviceAdapters.id });
  adapterId = a.id;
  myIds.add(a.id);
  await db.insert(schema.deviceTags).values([
    { adapterId, tagKey: "t_a", address: "a", dataType: "float", isEnabled: true },
    { adapterId, tagKey: "t_b", address: "b", dataType: "float", isEnabled: true },
  ]);
}, 30_000);

afterAll(async () => {
  if (db && adapterId) {
    await db.delete(schema.deviceTags).where(eq(schema.deviceTags.adapterId, adapterId));
    await db.delete(schema.deviceAdapters).where(eq(schema.deviceAdapters.id, adapterId));
  }
}, 30_000);

describe("trạng thái adapter → device_adapters (OT_GHI_TRANG_THAI_ADAPTER_ENABLED + OT_CHAT_LUONG_V2_ENABLED)", () => {
  it("connected → rớt kết nối ⇒ error + lastError + mẫu xấu 1 lần → có lại ⇒ connected", async () => {
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    vi.stubEnv("OT_CONN_HA_ENABLED", "false");
    vi.stubEnv("OT_GHI_TRANG_THAI_ADAPTER_ENABLED", "true");
    vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", "true");
    vi.stubEnv("OT_LEGACY_RECONNECT_MS", "500");
    const ot = await import("./otManager");
    const tt = await import("./trangThaiAdapter");
    try {
      expect(await ot.startOt()).toBe(true);

      // connecting ghi ngay, connected là lần ghi cuối (trailing) tròn 5 s ⇒ ≤ ~6 s.
      await vi.waitFor(async () => expect((await hang()).status).toBe("connected"), { timeout: 8_000, interval: 250 });
      expect((await hang()).lastConnectedAt).toBeTruthy();
      expect(tt.layTrangThaiAdapter(adapterId)?.tt).toBe("connected");
      expect(ingestSamplesMock).not.toHaveBeenCalled();

      // rớt kết nối
      const stub = layStubDangChay(ENDPOINT);
      expect(stub).toBeTruthy();
      stub!.simDatLoi({ matKetNoi: true });
      await vi.waitFor(async () => expect((await hang()).status).toBe("error"), { timeout: 8_000, interval: 250 });
      const mat = await hang();
      expect(mat.lastError).toBeTruthy();
      expect(mat.lastErrorAt).toBeTruthy();
      expect(tt.layTrangThaiAdapter(adapterId)).toMatchObject({ tt: "lost", soLanMat: 1 });

      // đợt mất ⇒ ĐÚNG MỘT lần phát mẫu xấu (dù legacyTick nhiều vòng nối lại) với 2 mẫu bad comm_lost
      expect(ingestSamplesMock).toHaveBeenCalledTimes(1);
      const [, mau] = ingestSamplesMock.mock.calls[0] as [unknown, Array<Record<string, unknown>>];
      expect(mau.map((m) => m.tagKey).sort()).toEqual(["t_a", "t_b"]);
      for (const m of mau) expect(m).toMatchObject({ quality: "bad", value: null, statusCode: "comm_lost", reason: "comm_lost" });

      // có lại
      await vi.waitFor(() => expect(layStubDangChay(ENDPOINT)).toBeTruthy(), { timeout: 5_000, interval: 100 });
      layStubDangChay(ENDPOINT)!.simDatLoi({});
      await vi.waitFor(async () => expect((await hang()).status).toBe("connected"), { timeout: 8_000, interval: 250 });
      expect(tt.layTrangThaiAdapter(adapterId)?.tt).toBe("connected");
      expect(ingestSamplesMock).toHaveBeenCalledTimes(1);
    } finally {
      await ot.stopOt();
      tt.__datLaiTrangThaiAdapter();
      vi.unstubAllEnvs();
    }
  }, 60_000);
});
