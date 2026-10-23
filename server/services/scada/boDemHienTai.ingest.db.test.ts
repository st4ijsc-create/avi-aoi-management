/**
 * SCADA R0 Task 7 (fix bao mat) - bo dem chi tin DUONG OT TRONG TIEN TRINH, khong tin `meta` cua hang telemetry.
 *  - Hang gia mao `meta.adapterId/tagKey` di thang qua `ingestTelemetry` (nhu duong ingest NGOAI) KHONG doi bo dem.
 *  - `ingestSamples(adapter, samples)` (duong OT that) CAP NHAT bo dem (napBoDem chay TRUOC ingestTelemetry).
 * DB `_test`; hang tu chen (deviceId rieng) xoa o afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { inArray } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { otTelemetry } from "../../../drizzle/schema";
import { ingestTelemetry } from "../telemetryBus";
import { ingestSamples } from "../ot/ingest";
import type { RuntimeAdapter } from "../ot/deviceAdapter";
import { __datLaiBoDemHienTai, datThongTinAdapter, khoiDongBoDemHienTai, layGiaTri } from "./boDemHienTai";

const CODE = "ZZ-T7-ING";
const ADAPTER_ID = 987654;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;

const adapter = (): RuntimeAdapter => ({
  adapterId: ADAPTER_ID,
  code: CODE,
  machineId: null,
  protocol: "stub",
  connection: { endpoint: "stub://" },
  pollIntervalMs: 1000,
  tags: [],
  driver: {} as never,
});

beforeAll(async () => {
  const d = await getDb();
  expect(d, "DB test phai ket noi duoc").toBeTruthy();
  db = d as Db;
});
beforeEach(() => {
  __datLaiBoDemHienTai();
  process.env.SCADA_LIVE_CACHE_ENABLED = "true";
  datThongTinAdapter(ADAPTER_ID, { pollMs: 1000, coDeadband: false, machineId: null, code: CODE });
});
afterEach(() => {
  delete process.env.SCADA_LIVE_CACHE_ENABLED;
});
afterAll(async () => {
  if (db) await db.delete(otTelemetry).where(inArray(otTelemetry.deviceId, [CODE]));
});

describe("bo dem - nguon tin cay", () => {
  it("hang gia mao meta.adapterId/tagKey qua ingestTelemetry truc tiep KHONG doi bo dem", async () => {
    await khoiDongBoDemHienTai(); // bo dem dang chay that (khong con tap nao de nuoi no)
    await ingestTelemetry([
      {
        ts: new Date(),
        machineId: null,
        deviceId: CODE,
        protocol: "other",
        metric: "t",
        value: 999,
        quality: "good",
        meta: { adapterId: ADAPTER_ID, tagKey: "t" },
      },
    ]);
    expect(layGiaTri(ADAPTER_ID, "t")).toBeNull();
  });

  it("ingestSamples(adapter, samples) CAP NHAT bo dem (khoa tu adapter + mau)", async () => {
    await ingestSamples(adapter(), [
      { tagKey: "t", raw: 42, value: 42, quality: "good", timestamp: new Date() },
      { tagKey: "u", raw: 1, value: null, quality: "bad", timestamp: new Date(), statusCode: "BadX", reason: "comm_lost" },
    ]);
    expect(layGiaTri(ADAPTER_ID, "t")).toMatchObject({ v: 42, q: "good", stale: false });
    expect(layGiaTri(ADAPTER_ID, "u")).toMatchObject({ v: null, q: "bad", statusCode: "BadX", reason: "comm_lost" });
  });
});
