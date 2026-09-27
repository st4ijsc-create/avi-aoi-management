/**
 * doc 81 Đợt 1B Task 11 — Fix round 1 mục 2: probe DB KHÔNG được lấy slot của pool request.
 *
 * Trước fix: pinger mặc định gọi `getDb()` (pool request, max 25). Một SELECT 1 treo (mạng hố đen)
 * giữ một slot tới khi TCP chết; mỗi 10 s một lượt mới bị bỏ rơi lại giữ thêm một slot.
 * Oracle độc lập: (1) bộ đếm lượt gọi `getDb` của pool request (vi.mock CÓ factory, bọc hàm gốc);
 * (2) `pg_stat_activity` đọc từ một client quan sát riêng — đếm kết nối mang application_name
 * `aoi-health-ping` (chuỗi cố định viết trong test, không import từ mã sản phẩm).
 * DB `_test` thật (vitest.setup ép DATABASE_URL).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

const dem = vi.hoisted(() => ({ getDb: 0 }));

vi.mock("../db/connection", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../db/connection")>();
  return {
    ...goc,
    getDb: async () => {
      dem.getDb++;
      return goc.getDb();
    },
  };
});

import * as probes from "./healthProbes";

const quanSat = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

afterAll(async () => {
  await (probes as any).dongClientPing?.();
  await quanSat.end({ timeout: 1 });
});

async function soKetNoiPing(): Promise<number> {
  const r = await quanSat`
    select count(*)::int as n from pg_stat_activity
    where application_name = 'aoi-health-ping' and datname = current_database()`;
  return r[0]!.n as number;
}

describe("T11 FR1 — pinger mặc định chạy trên client RIÊNG, không chạm pool request", () => {
  it("5 lượt SELECT 1 thật (không cache) ⇒ đều ok, getDb() của pool request được gọi 0 lần, đúng 1 kết nối ping", async () => {
    const pinger = probes.createDbPinger();
    for (let i = 0; i < 5; i++) {
      const r = await pinger.ping({ maxAgeMs: -1 });
      expect(r.ok, `lượt ${i}: ${r.reason}`).toBe(true);
    }
    expect(dem.getDb, "probe đã lấy slot của pool request (getDb)").toBe(0);
    expect(await soKetNoiPing(), "client ping riêng phải là MỘT kết nối mang application_name riêng").toBe(1);
  });

  it("client ping là `max: 1`: 5 SELECT 1 bắn ĐỒNG THỜI trên nguồn riêng ⇒ vẫn đúng 1 kết nối", async () => {
    const nguon = await Promise.all(Array.from({ length: 5 }, () => (probes as any).layNguonPingRieng()));
    await Promise.all(nguon.map((n: any) => n.execute("select 1")));
    expect(await soKetNoiPing()).toBe(1);
    expect(dem.getDb).toBe(0);
  });

  it("dongClientPing() đóng kết nối ping (tắt sạch, không rò)", async () => {
    await (probes as any).dongClientPing();
    let n = await soKetNoiPing();
    for (let i = 0; i < 20 && n > 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
      n = await soKetNoiPing();
    }
    expect(n).toBe(0);
  });
});
