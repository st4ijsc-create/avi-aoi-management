/**
 * ★ Pha 0 AL0-1 (kiểm định đột biến e3–e6) — `coMessageTruocCuaSo` trên SQL THẬT, _test, giao dịch HOÀN TÁC (không commit hàng nào):
 * cửa sổ [now − phút − 24 h, now − phút) liền kề cửa sổ throughput, lọc theo trạm của nhà máy.
 * Phạm vi `gom` cô lập ca khỏi hàng sẵn có của `mqtt_message_logs`.
 */
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { hangKetQua } from "../db/hangKetQua";
import { __coMessageTruocCuaSoChoTest } from "./alertEvaluationService";

const ROLLBACK_AL01 = new Error("rollback-al01");
const GIO = 60 * 60 * 1000;
const PHUT = 60 * 1000;
const CUA_SO = 30; // phút

async function trongHoanTac(f: (tx: any, a: { nhaMay: number; tram: number; tramKhac: number }) => Promise<void>) {
  const db = await getDb();
  if (!db) throw new Error("cần CSDL _test");
  const [{ d }] = hangKetQua(await db.execute(sql`SELECT current_database() AS d`)) as Array<{ d: string }>;
  expect(d).toMatch(/_test$/);
  const nhan = `AL01-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const moiChuoi = async (tx: any, s: string) => {
    const id = async (q: ReturnType<typeof sql>) => (hangKetQua(await tx.execute(q)) as Array<{ id: number }>)[0]!.id;
    const f0 = await id(sql`INSERT INTO factories (code, name) VALUES (${`${nhan}-F${s}`}, 'f') RETURNING id`);
    const w = await id(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f0}, ${`${nhan}-W${s}`}, 'w') RETURNING id`);
    const l = await id(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w}, ${`${nhan}-L${s}`}, 'l') RETURNING id`);
    const t = await id(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l}, ${`${nhan}-S${s}`}, 's') RETURNING id`);
    return { f: f0, t };
  };
  try {
    await db.transaction(async (tx) => {
      const a = await moiChuoi(tx, "A");
      const b = await moiChuoi(tx, "B");
      await f(tx, { nhaMay: a.f, tram: a.t, tramKhac: b.t });
      throw ROLLBACK_AL01;
    });
  } catch (e) {
    if (e !== ROLLBACK_AL01) throw e;
  }
}

/** Hàng log ở `truocMs` trước hiện tại; createdAt là chuỗi UTC, cùng cách cột mặc định now() (DB chạy UTC) và câu đọc so sánh. */
const ghiLog = (tx: any, stationId: number | null, truocMs: number) =>
  tx.execute(sql`INSERT INTO mqtt_message_logs ("messageType", topic, payload, "stationId", "createdAt")
    VALUES ('CUSTOM', 'al01/test', '{}'::json, ${stationId}, ${new Date(Date.now() - truocMs).toISOString()}::timestamp)`);

const co = (tx: any, nhaMay: number) => __coMessageTruocCuaSoChoTest(CUA_SO, { gom: nhaMay }, tx);

describe("AL0-1 — cửa sổ 24 h trước cửa sổ đánh giá (SQL thật, hoàn tác)", () => {
  it("★★★ không hàng ⇒ false; 23 h trước cửa sổ ⇒ true", async () => {
    await trongHoanTac(async (tx, a) => {
      expect(await co(tx, a.nhaMay)).toBe(false);
      await ghiLog(tx, a.tram, CUA_SO * PHUT + 23 * GIO);
      expect(await co(tx, a.nhaMay)).toBe(true);
    });
  });
  it("★★★ 25 h trước cửa sổ ⇒ false (chết quá 24 h ⇒ im)", async () => {
    await trongHoanTac(async (tx, a) => {
      await ghiLog(tx, a.tram, CUA_SO * PHUT + 25 * GIO);
      expect(await co(tx, a.nhaMay)).toBe(false);
    });
  });
  it("★★★ hàng TRONG cửa sổ hiện tại KHÔNG tính (cửa sổ liền kề, không chồng)", async () => {
    await trongHoanTac(async (tx, a) => {
      await ghiLog(tx, a.tram, 10 * PHUT);
      expect(await co(tx, a.nhaMay)).toBe(false);
      await ghiLog(tx, a.tram, CUA_SO * PHUT + 2 * PHUT); // ngay trước mép cửa sổ ⇒ tính
      expect(await co(tx, a.nhaMay)).toBe(true);
    });
  });
  it("★★★ hàng của trạm nhà máy KHÁC / không trạm ⇒ false khi có phạm vi", async () => {
    await trongHoanTac(async (tx, a) => {
      await ghiLog(tx, a.tramKhac, CUA_SO * PHUT + GIO);
      await ghiLog(tx, null, CUA_SO * PHUT + GIO);
      expect(await co(tx, a.nhaMay)).toBe(false);
    });
  });
});
