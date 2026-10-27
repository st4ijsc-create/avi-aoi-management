/**
 * SCADA R1b-2b-1 Task 2 fix round 1 (review I1) — luật interlock ghi lệnh lên địa chỉ mà driver ghi thành MỘT BIT bất kể dataType (coil Modbus,
 * bit S7 / SLMP / MC): giá trị gửi phải thuộc tập bool hợp lệ, nếu không dispatch() từ chối (TYPE_MISMATCH ở cổng kênh sớm) ĐÚNG lúc hành động bảo
 * vệ cần chạy. Hai cửa cấu hình:
 *   (b) LƯU luật (`interlock.create` / `enable` ⇒ `kiemLenhInterlockTx` ⇒ `kiemLenhInterlockTrenKenh` có protocol + address) ⇒ INTERLOCK_NGOAI_DAI
 *       lyDo TYPE_MISMATCH, không chèn / không bật;
 *   (a) hàng ĐÃ có (ghi thẳng bảng, có từ trước bản build) ⇒ `luatLenhLechLuoi` + posture `fetchInterlockCauHinhHong` đếm (mọi dataType).
 * CSDL `_test` THẬT; người gọi interlock: admin + 2FA, id giả cho SoD (khuôn interlockRouter.r1b.db.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { like } from "drizzle-orm";
import { interlockRouter } from "./interlockRouter";
import { _internal as oversight } from "./oversightRouter";
import { interlockRules } from "../../drizzle/schema";
import { getDb } from "../db/connection";
import { dongDauDuyetLuat } from "../testing/dauDuyetInterlock";
import { luatLenhLechLuoi } from "../services/scada/lenhInterlockLechLuoi";

const DB_URL = process.env.DATABASE_URL;
const DAU = `ILKBIT-${process.pid}-${Date.now()}`;
const TAC_GIA = 990_543_001;
const DUYET = 990_543_002;

const ilk = (userId: number) =>
  interlockRouter.createCaller({ user: { id: userId, role: "admin", name: `probe-${userId}`, twoFactorEnabled: true } } as never);

async function loiCua(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; message?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: x.code, message: x.message, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

let sql: ReturnType<typeof postgres>;
const ad: Record<string, number> = {};

async function seedLuat(ten: string, giaoThuc: string, commandTag: string, commandValue: unknown, o: { enabled?: boolean } = {}): Promise<number> {
  const [r] = await sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "targetAdapterId",
      "commandTag", "commandValue", enabled, "approvedBy", "createdBy")
    VALUES (${DAU + "-" + ten}, 'machine', 'ng_rate', 'gt', 5, 'reduce_speed', ${ad[giaoThuc]}, ${commandTag},
      ${sql.json(commandValue as never)}, ${o.enabled ?? true}, ${DUYET}, ${TAC_GIA}) RETURNING id`;
  await dongDauDuyetLuat(Number(r.id));
  return Number(r.id);
}
const cuaToi = () => like(interlockRules.name, `${DAU}-%`);

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("R1b-2b-1 T2 fix round 1 — luật interlock trên địa chỉ bit (I1)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    for (const gt of ["modbus", "s7"]) {
      const [a] = await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled")
        VALUES (${DAU + "-" + gt}, ${DAU}, ${gt}::otprotocolenum, 'tcp://192.0.2.1:502', true) RETURNING id`;
      ad[gt] = Number(a.id);
    }
    const tag = (gt: string, k: string, dc: string, dt: string) =>
      sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled") VALUES (${ad[gt]}, ${k}, ${dc}, ${dt}::otdatatypeenum, true, true)`;
    await tag("modbus", "icoil", "coil:3", "int");
    await tag("modbus", "scoil", "coil:4", "string");
    await tag("modbus", "hold", "40005", "int");
    await tag("s7", "xbit", "DB1,X0.0", "int");
    await tag("s7", "word", "DB1,INT2", "int");
  }, 60_000);

  beforeEach(async () => {
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${DAU + "-%"}`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${DAU + "%"}`;
    for (const id of Object.values(ad)) {
      await sql`DELETE FROM device_tags WHERE "adapterId" = ${id}`;
      await sql`DELETE FROM device_adapters WHERE id = ${id}`;
    }
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("(b) LƯU: create luật reduce_speed commandValue 2 lên coil Modbus kiểu INT ⇒ INTERLOCK_NGOAI_DAI TYPE_MISMATCH, không chèn; 1 ⇒ chèn", async () => {
    const base = { scope: "machine" as const, sourceType: "ng_rate" as const, comparisonOperator: "gt" as const, threshold: 5, action: "reduce_speed" as const, targetAdapterId: ad.modbus, commandTag: "icoil" };
    const e = await loiCua(ilk(TAC_GIA).create({ ...base, name: `${DAU}-c2`, commandValue: 2 } as never));
    expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INTERLOCK_NGOAI_DAI" });
    expect(e.appParams).toMatchObject({ lyDo: "TYPE_MISMATCH", tagKey: "icoil" });
    expect((await sql`SELECT count(*)::int AS n FROM interlock_rules WHERE name = ${DAU + "-c2"}`)[0].n).toBe(0);
    await ilk(TAC_GIA).create({ ...base, name: `${DAU}-c1`, commandValue: 1 } as never);
    expect((await sql`SELECT count(*)::int AS n FROM interlock_rules WHERE name = ${DAU + "-c1"}`)[0].n).toBe(1);
  });

  it("(b) BẬT: luật đã duyệt đang tắt, 2 lên bit S7 (DB1,X0.0 kiểu int) ⇒ enable bị từ chối TYPE_MISMATCH, luật vẫn tắt; word S7 (DB1,INT2) 2 ⇒ bật được", async () => {
    const r = await seedLuat("en-bit", "s7", "xbit", 2, { enabled: false });
    const e = await loiCua(ilk(TAC_GIA).enable({ id: r, expectedVersion: (await ilk(TAC_GIA).get({ id: r })).versionToken }));
    expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INTERLOCK_NGOAI_DAI" });
    expect(e.appParams).toMatchObject({ lyDo: "TYPE_MISMATCH", tagKey: "xbit" });
    expect((await sql`SELECT enabled FROM interlock_rules WHERE id = ${r}`)[0].enabled).toBe(false);
    const w = await seedLuat("en-word", "s7", "word", 2, { enabled: false });
    await ilk(TAC_GIA).enable({ id: w, expectedVersion: (await ilk(TAC_GIA).get({ id: w })).versionToken });
    expect((await sql`SELECT enabled FROM interlock_rules WHERE id = ${w}`)[0].enabled).toBe(true);
  });

  it("(a) hàng ghi thẳng bảng: 2 trên coil int, \"on\" trên coil string, 255 trên bit S7 ⇒ luatLenhLechLuoi + posture đếm (TYPE_MISMATCH); 1 / true trên coil, 2 trên holding / word ⇒ không", async () => {
    const d = await getDb();
    expect(await oversight.fetchInterlockCauHinhHong(d, cuaToi())).toEqual({ count: 0, degraded: false });
    const hong = [
      await seedLuat("g-icoil-2", "modbus", "icoil", 2),
      await seedLuat("g-scoil-on", "modbus", "scoil", "on"),
      await seedLuat("g-xbit-255", "s7", "xbit", 255),
    ];
    await seedLuat("g-icoil-1", "modbus", "icoil", 1);
    await seedLuat("g-scoil-true", "modbus", "scoil", "true");
    await seedLuat("g-hold-2", "modbus", "hold", 2);
    await seedLuat("g-word-2", "s7", "word", 2);
    const ds = await luatLenhLechLuoi(d!, cuaToi());
    expect(ds.map((r) => r.id)).toEqual(hong.sort((a, b) => a - b));
    for (const r of ds) {
      expect(r.ma).toBe("TYPE_MISMATCH");
      expect(r.chiTiet).toMatch(/được ghi thành MỘT BIT/);
    }
    expect(await oversight.fetchInterlockCauHinhHong(d, cuaToi())).toEqual({ count: 3, degraded: false });
  });
});
