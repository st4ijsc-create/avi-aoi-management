/**
 * SCADA R0 Task 7 — hai hàm đọc `ot_telemetry` theo MÃ THIẾT BỊ (deviceId = adapter.code):
 *   - layMoiNhatTheoThietBi: hàng mới nhất mỗi (deviceId, metric) — DISTINCT ON
 *   - layMauThoTheoThietBi: N hàng mới nhất của một (deviceId, metric), giảm dần theo ts
 *
 * Chạy trên DB `_test` (vitest.setup ép DATABASE_URL). Hàng tự chèn mang mã thiết bị riêng, xoá ở afterAll.
 * ⚠ Nếu TSDB_URL được đặt thì hai hàm đọc Timescale trước (rồi mới rơi về DB chính); lưới này đo đường DB chính ⇒ chạy khi TSDB_URL không đặt.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";

import { getDb } from "./connection";
import { otTelemetry } from "../../drizzle/schema";
import { layMauThoTheoThietBi, layMoiNhatTheoThietBi } from "./otTelemetry";

const DEV_A = "ZZ-T7-DEV-A";
const DEV_B = "ZZ-T7-DEV-B";
const DEV_RONG = "ZZ-T7-DEV-RONG";
const BAY_GIO = Date.now();
const phutTruoc = (m: number) => new Date(BAY_GIO - m * 60_000);

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;

beforeAll(async () => {
  const d = await getDb();
  expect(d, "DB test phải kết nối được").toBeTruthy();
  db = d as Db;
  await db.delete(otTelemetry).where(inArray(otTelemetry.deviceId, [DEV_A, DEV_B, DEV_RONG]));
  const base = { protocol: "modbus" as const, quality: "good" as const };
  await db.insert(otTelemetry).values([
    { ...base, deviceId: DEV_A, metric: "nhiet", numValue: 1, ts: phutTruoc(30), meta: { adapterId: 1, tagKey: "nhiet" } },
    { ...base, deviceId: DEV_A, metric: "nhiet", numValue: 2, ts: phutTruoc(20), meta: { adapterId: 1, tagKey: "nhiet" } },
    { ...base, deviceId: DEV_A, metric: "nhiet", numValue: 3, ts: phutTruoc(10), meta: { adapterId: 1, tagKey: "nhiet" } },
    { ...base, deviceId: DEV_A, metric: "ap", numValue: 7, ts: phutTruoc(25) },
    { ...base, deviceId: DEV_B, metric: "nhiet", numValue: 5, ts: phutTruoc(15) },
    // Ngoài cửa sổ since: không được trả về.
    { ...base, deviceId: DEV_A, metric: "cu", numValue: 9, ts: phutTruoc(60 * 48) },
  ]);
});

afterAll(async () => {
  if (db) await db.delete(otTelemetry).where(inArray(otTelemetry.deviceId, [DEV_A, DEV_B, DEV_RONG]));
});

describe("layMoiNhatTheoThietBi", () => {
  it("3 hàng cùng (deviceId, metric) + 1 hàng khác metric ⇒ 2 hàng, đúng hàng mới nhất", async () => {
    const rows = await layMoiNhatTheoThietBi([DEV_A], 24 * 3600_000);
    expect(rows).toHaveLength(2);
    const nhiet = rows.find((r) => r.metric === "nhiet")!;
    expect(nhiet.deviceId).toBe(DEV_A);
    expect(nhiet.numValue).toBe(3);
    expect(nhiet.ts.getTime()).toBe(phutTruoc(10).getTime());
    expect(nhiet.ingestedAt).toBeInstanceOf(Date);
    expect(nhiet.meta).toEqual({ adapterId: 1, tagKey: "nhiet" });
    expect(rows.find((r) => r.metric === "ap")!.numValue).toBe(7);
  });

  it("nhiều thiết bị: mỗi (thiết bị, metric) một hàng; ngoài cửa sổ since bị loại", async () => {
    const rows = await layMoiNhatTheoThietBi([DEV_A, DEV_B], 24 * 3600_000);
    expect(rows.map((r) => `${r.deviceId}/${r.metric}`).sort()).toEqual([`${DEV_A}/ap`, `${DEV_A}/nhiet`, `${DEV_B}/nhiet`]);
    expect(rows.find((r) => r.deviceId === DEV_B)!.numValue).toBe(5);
  });

  it("danh sách rỗng ⇒ [] không truy vấn lỗi; thiết bị không có dữ liệu ⇒ []", async () => {
    expect(await layMoiNhatTheoThietBi([], 24 * 3600_000)).toEqual([]);
    expect(await layMoiNhatTheoThietBi([DEV_RONG], 24 * 3600_000)).toEqual([]);
  });
});

describe("layMauThoTheoThietBi", () => {
  it("limit 2 ⇒ 2 hàng mới nhất, giảm dần theo ts", async () => {
    const rows = await layMauThoTheoThietBi(DEV_A, "nhiet", 2);
    expect(rows.map((r) => r.numValue)).toEqual([3, 2]);
    expect(rows[0].ts.getTime()).toBeGreaterThan(rows[1].ts.getTime());
  });

  it("không lẫn thiết bị khác cùng metric; không có ⇒ []", async () => {
    const rows = await layMauThoTheoThietBi(DEV_B, "nhiet", 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].numValue).toBe(5);
    expect(await layMauThoTheoThietBi(DEV_RONG, "nhiet", 10)).toEqual([]);
  });
});
