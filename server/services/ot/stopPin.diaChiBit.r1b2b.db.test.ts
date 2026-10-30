/**
 * SCADA R1b-2b-1 Task 2 (điều kiện 1b, preflight C1) — ghim STOP MỚI trên địa chỉ mà driver ghi thành MỘT BIT bất kể dataType (coil Modbus,
 * bit-device SLMP / MC) phải thuộc tập bool hợp lệ (true/false, 1/0, "1"/"0", "true"/"false"); ngoài tập ⇒ `deviceAdapter.tags.setStopPin` (đường
 * THẬT, `datStopPin`) từ chối `INVALID_VALUE` { field: "stopValue", reason: "stopPinBitAddress" }, không ghi, không audit. Địa chỉ word / giao thức
 * ghi theo dataType ⇒ hành vi cũ. Ghim CŨ ngoài tập (có trước luật) vẫn là ghim hợp lệ lúc dispatch (`loadStopPins`) — không "biến mất".
 *
 * CSDL `_test` THẬT; người dùng qua `taoNguoiDungTest`; oracle là SELECT thô. TOTP cấu hình là fixture (cổng có test riêng).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("../scada/totpCauHinh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scada/totpCauHinh")>()),
  kiemTotpCauHinh: async () => undefined,
}));
import { getDb } from "../../db/connection";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import { deviceAdapterRouter } from "../../routers/deviceAdapterRouter";
import { loadStopPins } from "./stopPin";

const RUN = `r1b2bt2sp${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
let mid = 0;
const adapter: Record<string, number> = {};
const tag: Record<string, number> = {};
let eng!: ReturnType<typeof deviceAdapterRouter.createCaller>;

async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}
async function loiCua(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: x.code, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}
let dem = 0;
const lyDo = (n: string) => `${RUN} ${n} ${++dem}`;
const ghim = (giaoThuc: string, tagKey: string, stopValue: unknown, reason: string) =>
  eng.tags.setStopPin({ adapterId: adapter[giaoThuc], tagKey, stopValue, reason });
const stopCua = async (k: string) => (await dung(sql`SELECT stop_value AS v FROM device_tags WHERE id = ${tag[k]}`))[0].v;
const audit = async (reason: string) => dung(sql`SELECT id FROM control_audit_log WHERE "entityType" = 'device_tag_stop_pin' AND reason = ${reason}`);

/** (giao thức, tagKey, địa chỉ, dataType) */
const TAG: Array<[string, string, string, string]> = [
  ["modbus", "coilInt", "coil:5", "int"],
  ["modbus", "coilStr", "coil:6", "string"],
  ["modbus", "coilFloat", "00007", "float"],
  ["modbus", "holdInt", "40010", "int"],
  ["slmp", "mInt", "M100", "int"],
  ["slmp", "dInt", "D100", "int"],
  ["mitsubishi-mc", "bitWordInt", "D6000.1", "int"],
  ["mitsubishi-mc", "dInt", "D200", "int"],
  ["stub", "coilInt", "coil:1", "int"],
  // fix round 1 (lo ngại 4) — bit S7
  ["s7", "xInt", "DB1,X0.0", "int"],
  ["s7", "mInt", "M0.1", "int"],
  ["s7", "wInt", "DB1,INT2", "int"],
  // R1b-2b-2a T3C fix 1 (M4) — tag S7 LƯU TỪ TRƯỚC với địa chỉ nodes7 không ghi được đúng như yêu cầu
  ["s7", "xBit9", "DB1,X0.9", "bool"],
  ["s7", "mx", "MX0.1", "bool"],
  ["s7", "arr", "DB1,INT2.5", "int"],
];

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  const code = RUN;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code}, 'AOI', true) RETURNING id`);
  mid = Number(m.id);
  for (const gt of ["modbus", "slmp", "mitsubishi-mc", "stub", "s7"]) {
    const [a] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "isEnabled")
      VALUES (${mid}, ${code + "-" + gt}, ${code}, ${gt}::otprotocolenum, 'tcp://192.0.2.1:502', false) RETURNING id`);
    adapter[gt] = Number(a.id);
  }
  for (const [gt, k, dc, dt] of TAG) {
    const [t] = await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
      VALUES (${adapter[gt]}, ${k}, ${dc}, ${dt}::otdatatypeenum, true, true) RETURNING id`);
    tag[`${gt}/${k}`] = Number(t.id);
  }
  const u = await taoNguoiDungTest("eng", "engineer", { tienTo: "r1b2bt2sp", ts: RUN });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, true)`);
  eng = deviceAdapterRouter.createCaller({ user: { id: u.id, role: "engineer", name: u.name, twoFactorEnabled: true } } as never);
}, 60_000);

beforeEach(async () => {
  for (const id of Object.values(adapter)) await dung(sql`UPDATE device_tags SET stop_value = NULL, stop_pinned_by = NULL, stop_pinned_at = NULL WHERE "adapterId" = ${id}`);
});

afterAll(async () => {
  if (!db) return;
  try {
    for (const id of Object.values(adapter)) {
      await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${id}`);
      await dung(sql`DELETE FROM device_adapters WHERE id = ${id}`);
    }
    await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${RUN}`);
    await dung(sql`DELETE FROM machines WHERE code = ${RUN}`);
    await dung(sql`DELETE FROM stations WHERE code = ${RUN}`);
    await dung(sql`DELETE FROM production_lines WHERE code = ${RUN}`);
    await dung(sql`DELETE FROM workshops WHERE code = ${RUN}`);
    await dung(sql`DELETE FROM factories WHERE code = ${RUN}`);
  } catch (e) {
    console.warn("[r1b2bt2sp] dọn:", (e as Error).message);
  }
}, 60_000);

describe("R1b-2b-2a T3C fix 1 (M4) — ghim STOP lên tag S7 mà nodes7 không ghi được đúng như yêu cầu ⇒ từ chối", () => {
  it("DB1,X0.9 / MX0.1 / DB1,INT2.5 ⇒ INVALID_VALUE { field: stopValue, reason: stopPinS7DiaChi }, message mang mã, không ghi, không audit; gỡ ghim (null) vẫn được; DB1,X0.0 ⇒ OK", async () => {
    for (const [k, ma] of [["xBit9", "OT_S7_BIT_NGOAI_DAI"], ["mx", "OT_S7_DIA_CHI_THU_VIEN_BO"], ["arr", "OT_S7_DIA_CHI_THU_VIEN_BO"]] as const) {
      const ld = lyDo(`s7dc-${k}`);
      let msg = "";
      const e = await loiCua(
        ghim("s7", k, k === "arr" ? 0 : true, ld).catch((x: unknown) => {
          msg = String((x as Error)?.message);
          throw x;
        }),
      );
      expect(e, k).toMatchObject({ code: "BAD_REQUEST", appCode: "INVALID_VALUE", appParams: { field: "stopValue", reason: "stopPinS7DiaChi" } });
      expect(msg, k).toContain(`Stop pin refused: ${ma}: `);
      expect(await stopCua(`s7/${k}`)).toBeNull();
      expect(await audit(ld)).toHaveLength(0);
    }
    // gỡ ghim cũ trên tag hỏng không bị chặn (thoát khỏi trạng thái sai)
    await dung(sql`UPDATE device_tags SET stop_value = 'true'::jsonb WHERE id = ${tag["s7/xBit9"]}`);
    await ghim("s7", "xBit9", null, lyDo("s7dc-go"));
    expect(await stopCua("s7/xBit9")).toBeNull();
    expect((await ghim("s7", "xInt", 1, lyDo("s7dc-ok"))).stopValue).toBe(1);
  });
});

describe("R1b-2b-1 T2 — setStopPin trên địa chỉ coil / bit: chỉ tập bool hợp lệ (điều kiện 1b)", () => {
  it("coil Modbus kiểu INT: 2 / 255 / -1 ⇒ INVALID_VALUE stopPinBitAddress, không ghi, không audit; 1 / 0 ⇒ OK", async () => {
    for (const v of [2, 255, -1]) {
      const ld = lyDo(`coilInt-${v}`);
      const e = await loiCua(ghim("modbus", "coilInt", v, ld));
      expect(e, String(v)).toMatchObject({ code: "BAD_REQUEST", appCode: "INVALID_VALUE", appParams: { field: "stopValue", reason: "stopPinBitAddress" } });
      expect(await stopCua("modbus/coilInt")).toBeNull();
      expect(await audit(ld)).toHaveLength(0);
    }
    for (const v of [1, 0]) {
      const r = await ghim("modbus", "coilInt", v, lyDo(`coilInt-ok-${v}`));
      expect(r).toMatchObject({ changed: true, stopValue: v });
      expect(await stopCua("modbus/coilInt")).toBe(v);
    }
  });

  it('coil Modbus kiểu STRING: "on" / "yes" / "off" ⇒ từ chối; "true" / " FALSE " / "1" ⇒ OK (chuỗi giữ nguyên)', async () => {
    for (const v of ["on", "yes", "off"]) {
      const e = await loiCua(ghim("modbus", "coilStr", v, lyDo(`coilStr-${v}`)));
      expect(e, v).toMatchObject({ appCode: "INVALID_VALUE", appParams: { reason: "stopPinBitAddress" } });
    }
    for (const v of ["true", " FALSE ", "1"]) {
      const r = await ghim("modbus", "coilStr", v, lyDo(`coilStr-ok`));
      expect(r.stopValue).toBe(v);
    }
  });

  it("coil Modbus dạng số Modicon (00007) kiểu FLOAT: 0.5 ⇒ từ chối; 1 ⇒ OK", async () => {
    expect(await loiCua(ghim("modbus", "coilFloat", 0.5, lyDo("coilFloat")))).toMatchObject({ appParams: { reason: "stopPinBitAddress" } });
    expect((await ghim("modbus", "coilFloat", 1, lyDo("coilFloat-ok"))).stopValue).toBe(1);
  });

  it("bit-device SLMP (M100) / MC (D6000.1) kiểu INT: 2 ⇒ từ chối; word-device (D100 / D200) 2 ⇒ OK như cũ", async () => {
    expect(await loiCua(ghim("slmp", "mInt", 2, lyDo("slmp-m")))).toMatchObject({ appParams: { reason: "stopPinBitAddress" } });
    expect(await loiCua(ghim("mitsubishi-mc", "bitWordInt", 2, lyDo("mc-bit")))).toMatchObject({ appParams: { reason: "stopPinBitAddress" } });
    expect((await ghim("slmp", "dInt", 2, lyDo("slmp-d"))).stopValue).toBe(2);
    expect((await ghim("mitsubishi-mc", "dInt", 2, lyDo("mc-d"))).stopValue).toBe(2);
    expect((await ghim("slmp", "mInt", 1, lyDo("slmp-m-ok"))).stopValue).toBe(1);
  });

  it("fix round 1 (lo ngại 4): bit S7 (DB1,X0.0 / M0.1) kiểu INT: 2 ⇒ từ chối, không ghi; 1 ⇒ OK; word S7 (DB1,INT2) 2 ⇒ OK như cũ", async () => {
    for (const k of ["xInt", "mInt"]) {
      const ld = lyDo(`s7-${k}`);
      expect(await loiCua(ghim("s7", k, 2, ld)), k).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "stopValue", reason: "stopPinBitAddress" } });
      expect(await stopCua(`s7/${k}`)).toBeNull();
      expect(await audit(ld)).toHaveLength(0);
    }
    expect((await ghim("s7", "xInt", 1, lyDo("s7-x-ok"))).stopValue).toBe(1);
    expect((await ghim("s7", "wInt", 2, lyDo("s7-w"))).stopValue).toBe(2);
  });

  it("holding Modbus kiểu INT (không phải bit) 255 ⇒ OK; adapter stub địa chỉ 'coil:1' (driver không phải Modbus) 2 ⇒ OK", async () => {
    expect((await ghim("modbus", "holdInt", 255, lyDo("hold"))).stopValue).toBe(255);
    expect((await ghim("stub", "coilInt", 2, lyDo("stub"))).stopValue).toBe(2);
  });

  it("GỠ ghim luôn được; ghim CŨ 255 trên coil int (ghi thẳng DB, có trước luật) VẪN là ghim hợp lệ lúc dispatch (loadStopPins) — không biến mất", async () => {
    await dung(sql`UPDATE device_tags SET stop_value = '255'::jsonb WHERE id = ${tag["modbus/coilInt"]}`);
    const pins = await loadStopPins(db, adapter.modbus);
    expect(pins).toEqual([{ tagKey: "coilInt", value: 255 }]);
    const r = await ghim("modbus", "coilInt", null, lyDo("go"));
    expect(r).toMatchObject({ changed: true, stopValue: null });
    expect(await stopCua("modbus/coilInt")).toBeNull();
  });
});
