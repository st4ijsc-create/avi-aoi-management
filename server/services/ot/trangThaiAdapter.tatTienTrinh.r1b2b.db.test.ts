/**
 * SCADA R1b-2b-1 T8 (mục 13) — tắt TIẾN TRÌNH không ghi `disabled` vào `device_adapters.status`; tắt thật (stopOt() trần: khởi động lại
 * khung OT / gateway tắt) vẫn ghi. DB THẬT (`_test`), adapter stub THẬT, cả nhánh legacy lẫn nhánh HA (supervisor.stop() cũng báo disabled).
 * Điều tiết ghi DB 5 s ⇒ mỗi chặng chờ ≤ ~7 s.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";

const RUN = `r1b2bt8-${process.pid}-${Date.now().toString(36)}`;
const myIds = new Set<number>();

vi.mock("./ingest", () => ({ ingestSample: async () => undefined, ingestSamples: async () => undefined }));
vi.mock("./driverRegistry", async (importOriginal) => {
  const real = await importOriginal<typeof import("./driverRegistry")>();
  const { createStubDriver } = await import("./drivers/stubDriver");
  const gia = { protocol: "stub", isConnected: () => false } as never;
  return { ...real, createDriver: (p: string) => (p === "stub" ? createStubDriver() : gia) };
});
vi.mock("./deviceAdapter", async (importOriginal) => {
  const real = await importOriginal<typeof import("./deviceAdapter")>();
  return { ...real, loadEnabledAdapters: async () => (await real.loadEnabledAdapters()).filter((a) => myIds.has(a.adapterId)) };
});

let db: any;
let schema: typeof import("../../../drizzle/schema");
let adapterId = 0;

async function status(): Promise<string> {
  const [r] = await db.select().from(schema.deviceAdapters).where(eq(schema.deviceAdapters.id, adapterId)).limit(1);
  return r.status as string;
}
const choTre = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  schema = await import("../../../drizzle/schema");
  const { getDb } = await import("../../db");
  db = await getDb();
  expect(db).toBeTruthy();
  const [a] = await db
    .insert(schema.deviceAdapters)
    .values({ code: RUN, name: "R1b-2b-1 T8", protocol: "stub", endpoint: `stub://${RUN}`, connectionOptions: null, machineId: null, pollIntervalMs: 500, isEnabled: true, status: "disabled" })
    .returning({ id: schema.deviceAdapters.id });
  adapterId = a.id;
  myIds.add(a.id);
  await db.insert(schema.deviceTags).values([{ adapterId, tagKey: "t_a", address: "a", dataType: "float", isEnabled: true }]);
}, 30_000);

afterAll(async () => {
  if (db && adapterId) {
    await db.delete(schema.deviceTags).where(eq(schema.deviceTags.adapterId, adapterId));
    await db.delete(schema.deviceAdapters).where(eq(schema.deviceAdapters.id, adapterId));
  }
}, 30_000);

for (const ha of ["false", "true"] as const) {
  describe(`tắt tiến trình không ghi 'disabled' (OT_CONN_HA_ENABLED=${ha})`, () => {
    async function dung(): Promise<{ ot: typeof import("./otManager"); tt: typeof import("./trangThaiAdapter") }> {
      vi.stubEnv("OT_GATEWAY_ENABLED", "true");
      vi.stubEnv("OT_CONN_HA_ENABLED", ha);
      vi.stubEnv("OT_GHI_TRANG_THAI_ADAPTER_ENABLED", "true");
      vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", "false");
      const ot = await import("./otManager");
      const tt = await import("./trangThaiAdapter");
      await db.update(schema.deviceAdapters).set({ status: "disabled" }).where(eq(schema.deviceAdapters.id, adapterId));
      tt.__datLaiTrangThaiAdapter();
      expect(await ot.startOt()).toBe(true);
      await vi.waitFor(async () => expect(await status()).toBe("connected"), { timeout: 9_000, interval: 250 });
      return { ot, tt };
    }

    it("stopOt({ tatTienTrinh: true }) ⇒ DB vẫn 'connected', RAM 'disabled'; startOt sau đó ghi như thường", async () => {
      const { ot, tt } = await dung();
      try {
        await ot.stopOt({ tatTienTrinh: true });
        expect(tt.layTrangThaiAdapter(adapterId)?.tt).toBe("disabled");
        await choTre(7_000); // quá khoảng điều tiết 5 s: mọi lượt ghi hẹn đã chạy
        expect(await status()).toBe("connected");

        // startOt (cùng tiến trình) ⇒ tắt chế độ: báo connecting rồi ghi DB như thường
        expect(await ot.startOt()).toBe(true);
        await vi.waitFor(() => expect(tt.layTrangThaiAdapter(adapterId)?.tt).not.toBe("disabled"), { timeout: 3_000, interval: 50 });
        await db.update(schema.deviceAdapters).set({ status: "disabled" }).where(eq(schema.deviceAdapters.id, adapterId));
        await vi.waitFor(async () => expect(await status()).toBe("connected"), { timeout: 9_000, interval: 250 });
      } finally {
        await ot.stopOt();
        tt.__datLaiTrangThaiAdapter();
        vi.unstubAllEnvs();
      }
    }, 60_000);

    it("đối chứng: stopOt() trần (khởi động lại khung OT / gateway tắt thật) ⇒ DB 'disabled'", async () => {
      const { ot, tt } = await dung();
      try {
        await ot.stopOt();
        await vi.waitFor(async () => expect(await status()).toBe("disabled"), { timeout: 9_000, interval: 250 });
      } finally {
        await ot.stopOt();
        tt.__datLaiTrangThaiAdapter();
        vi.unstubAllEnvs();
      }
    }, 60_000);
  });
}
