/**
 * SCADA R1a Task 12 — `datStopPin` (đường `deviceAdapter.tags.setStopPin` THẬT) từ chối ghim giá trị DỪNG nằm ngoài dải / lệch bước /
 * trên kênh chỉ đọc theo khai báo kênh HIỆN TẠI của tag (mig 0431) ⇒ `STOP_PIN_NGOAI_DAI`, không ghi, không audit. Dải NULL ⇒ hành vi cũ.
 * Chiều ngược lại (khai dải khi đã ghim) ở `server/routers/scadaKenhRouter.db.test.ts`.
 *
 * CSDL `_test` THẬT; người dùng qua `taoNguoiDungTest`; oracle là SELECT thô. `control_audit_log` là WORM (lọc theo lý do của lượt).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import { deviceAdapterRouter } from "../../routers/deviceAdapterRouter";
import { kenhDaKhai, kiemNhatQuanKenh } from "../scada/nhatQuanKenh";
import { kenhDaKhaiGhi } from "./commandDispatcher";

const RUN = `r1at12sp${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
let code = "";
let mid = 0;
let adapterId = 0;
let tagId = 0;
let tagBool = 0;
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
const ghim = (stopValue: unknown, reason: string, tagKey = "stop") => eng.tags.setStopPin({ adapterId, tagKey, stopValue, reason });
const stopCua = async (id: number) => (await dung(sql`SELECT stop_value AS v FROM device_tags WHERE id = ${id}`))[0].v;
const audit = async (reason: string) =>
  dung(sql`SELECT id FROM control_audit_log WHERE "entityType" = 'device_tag_stop_pin' AND reason = ${reason}`);

let dem = 0;
const lyDo = (n: string) => `${RUN} ${n} ${++dem}`;

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  code = RUN;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code}, 'AOI', true) RETURNING id`);
  mid = Number(m.id);
  const [a] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "isEnabled")
    VALUES (${mid}, ${code}, ${code}, 'stub', 'stub://r1at12sp', false) RETURNING id`);
  adapterId = Number(a.id);
  const [t] = await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
    VALUES (${adapterId}, 'stop', 'addr-stop', 'int', true, true) RETURNING id`);
  tagId = Number(t.id);
  const [tb] = await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
    VALUES (${adapterId}, 'estop', 'addr-estop', 'bool', true, true) RETURNING id`);
  tagBool = Number(tb.id);
  const u = await taoNguoiDungTest("eng", "engineer", { tienTo: "r1at12sp", ts: RUN });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, true)`);
  eng = deviceAdapterRouter.createCaller({ user: { id: u.id, role: "engineer", name: u.name, twoFactorEnabled: true } } as never);
}, 60_000);

beforeEach(async () => {
  await dung(sql`UPDATE device_tags SET stop_value = NULL, stop_pinned_by = NULL, stop_pinned_at = NULL, channel_kind = NULL,
    write_min = NULL, write_max = NULL, write_step = NULL WHERE "adapterId" = ${adapterId}`);
});

afterAll(async () => {
  if (!db) return;
  try {
    await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`);
    await dung(sql`DELETE FROM device_adapters WHERE id = ${adapterId}`);
    await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${code}`);
    await dung(sql`DELETE FROM machines WHERE code = ${code}`);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`);
    await dung(sql`DELETE FROM factories WHERE code = ${code}`);
  } catch (e) {
    console.warn("[r1at12sp] dọn:", (e as Error).message);
  }
}, 60_000);

describe("datStopPin ↔ dải/bước đang khai của tag (R1a T12, điều phối mục 4)", () => {
  it("tag có dải 10..20, ghim stop_value=0 ⇒ STOP_PIN_NGOAI_DAI (không ghi, không audit); ghim 10 ⇒ OK", async () => {
    await dung(sql`UPDATE device_tags SET write_min = 10, write_max = 20 WHERE id = ${tagId}`);
    const ld = lyDo("ngoai");
    const e = await loiCua(ghim(0, ld));
    expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "STOP_PIN_NGOAI_DAI" });
    expect(e.appParams).toMatchObject({ ma: "STOP_PIN_NGOAI_DAI", lyDo: "OUT_OF_RANGE", tagKey: "stop", stopValue: "0", min: 10, max: 20, step: "—" });
    expect(await stopCua(tagId)).toBeNull();
    expect(await audit(ld)).toHaveLength(0);

    const ok = await ghim(10, lyDo("trong"));
    expect(ok).toMatchObject({ changed: true, stopValue: 10 });
    expect(await stopCua(tagId)).toBe(10);
  });

  it("lệch bước ⇒ STOP_PIN_NGOAI_DAI (OFF_STEP); đúng bước ⇒ OK", async () => {
    await dung(sql`UPDATE device_tags SET write_min = 0, write_max = 100, write_step = 5 WHERE id = ${tagId}`);
    expect(await loiCua(ghim(7, lyDo("buoc")))).toMatchObject({ appCode: "STOP_PIN_NGOAI_DAI", appParams: expect.objectContaining({ lyDo: "OFF_STEP" }) });
    expect(await ghim(15, lyDo("buoc-ok"))).toMatchObject({ changed: true });
  });

  it("dải NULL ⇒ không kiểm (hành vi cũ); gỡ ghim (null) luôn được dù dải hiện tại loại ghim cũ", async () => {
    expect(await ghim(-999, lyDo("null"))).toMatchObject({ changed: true, stopValue: -999 });
    await dung(sql`UPDATE device_tags SET write_min = 0, write_max = 1 WHERE id = ${tagId}`); // khai thẳng SQL (dữ liệu cũ lệch)
    expect(await ghim(null, lyDo("go"))).toMatchObject({ changed: true, stopValue: null });
  });

  it("kênh khai loại chỉ đọc (input) ⇒ từ chối ghim (cổng kênh của dispatch() sẽ từ chối lệnh DỪNG)", async () => {
    await dung(sql`UPDATE device_tags SET channel_kind = 'input' WHERE id = ${tagId}`);
    expect(await loiCua(ghim(0, lyDo("ro")))).toMatchObject({ appCode: "STOP_PIN_NGOAI_DAI", appParams: expect.objectContaining({ lyDo: "CHANNEL_READ_ONLY" }) });
    expect(await stopCua(tagId)).toBeNull();
  });

  it("tag bool có khai dải (dải không áp cho bool) ⇒ ghim true OK", async () => {
    await dung(sql`UPDATE device_tags SET channel_kind = 'output', write_min = 0, write_max = 0 WHERE id = ${tagBool}`);
    expect(await ghim(1, lyDo("bool"), "estop")).toMatchObject({ changed: true, stopValue: true });
  });
});

describe("nhatQuanKenh.kenhDaKhai là bản sao đúng của commandDispatcher.kenhDaKhaiGhi", () => {
  it("mọi tổ hợp NULL / khác NULL của bốn cột", () => {
    for (let m = 0; m < 16; m++) {
      const t = {
        channelKind: m & 1 ? ("output" as const) : null,
        writeMin: m & 2 ? 0 : null,
        writeMax: m & 4 ? 1 : null,
        writeStep: m & 8 ? 1 : null,
      };
      expect(kenhDaKhai(t)).toBe(kenhDaKhaiGhi(t));
    }
  });

  it("kiemNhatQuanKenh: không khai ⇒ ok kể cả giá trị sai kiểu (hành vi cũ)", () => {
    const tag = { dataType: "int" as const, channelKind: null, writable: false, writeMin: null, writeMax: null, writeStep: null };
    expect(kiemNhatQuanKenh(tag, "abc")).toEqual({ ok: true });
  });
});
