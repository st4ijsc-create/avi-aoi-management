/**
 * SCADA R1a Task 12 (review T3 M-3) — `interlockRouter` create / update / approve / enable từ chối `commandValue` không ghi được lên
 * khai báo kênh HIỆN TẠI của tag đích (`targetAdapterId` + `commandTag`): ngoài dải / lệch bước / sai kiểu / kênh chỉ đọc ⇒
 * `INTERLOCK_NGOAI_DAI`. Nếu không, hành động bảo vệ của luật sẽ bị cổng kênh của `dispatch()` từ chối (`OUT_OF_RANGE` …) đúng lúc cần.
 * update / approve / enable kiểm trên hàng đã GỘP patch. Tag không khai mô hình ghi (mọi cột kênh NULL) ⇒ không kiểm (hành vi cũ).
 * Chiều ngược lại (khai dải khi đã có luật bật) ở `scadaKenhRouter.db.test.ts`.
 *
 * CSDL `_test` THẬT (khuôn `interlockRouter.cauHinh.db.test.ts`: người gọi admin + 2FA, id giả cho SoD).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { interlockRouter } from "./interlockRouter";

const DB_URL = process.env.DATABASE_URL;
const DAU = `ILKDAI-${process.pid}-${Date.now()}`;
const TAC_GIA = 990_531_001;
const DUYET = 990_531_002;

function caller(userId: number) {
  return interlockRouter.createCaller({ user: { id: userId, role: "admin", name: `probe-${userId}`, twoFactorEnabled: true } } as never);
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

let sql: ReturnType<typeof postgres>;
let adapterId = 0;
const ruleIds: number[] = [];

function input(name: string, over: Record<string, unknown> = {}) {
  return {
    name: `${DAU}-${name}`,
    scope: "machine" as const,
    sourceType: "ng_rate" as const,
    comparisonOperator: "gt" as const,
    threshold: 5,
    action: "reduce_speed" as const,
    targetAdapterId: adapterId,
    commandTag: "sp",
    commandValue: 50,
    ...over,
  };
}

describe.skipIf(!DB_URL)("interlockRouter — commandValue ↔ dải/bước của tag đích (R1a T12)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const [a] = await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled")
      VALUES (${DAU}, ${DAU}, 'stub', 'stub://ilkdai', false) RETURNING id`;
    adapterId = Number(a.id);
    await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind, write_min, write_max, write_step)
      VALUES (${adapterId}, 'sp', 'addr-sp', 'float', true, true, 'output', 0, 100, 5)`;
    await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
      VALUES (${adapterId}, 'cu', 'addr-cu', 'float', true, true)`; // không khai kênh
    await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind)
      VALUES (${adapterId}, 'doc', 'addr-doc', 'float', true, true, 'input')`;
  }, 60_000);

  afterAll(async () => {
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${DAU + "-%"}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`;
    await sql`DELETE FROM device_adapters WHERE id = ${adapterId}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("create: commandValue ngoài dải / lệch bước / sai kiểu / kênh chỉ đọc ⇒ INTERLOCK_NGOAI_DAI, không ghi hàng", async () => {
    for (const [ten, over, lyDo] of [
      ["c-ngoai", { commandValue: 150 }, "OUT_OF_RANGE"],
      ["c-buoc", { commandValue: 52 }, "OFF_STEP"],
      ["c-kieu", { commandValue: { v: 50 } }, "TYPE_MISMATCH"],
      ["c-null", { commandValue: null }, "TYPE_MISMATCH"], // engine gửi `true` khi null
      ["c-doc", { commandTag: "doc" }, "CHANNEL_READ_ONLY"],
    ] as const) {
      const e = await loiCua(caller(TAC_GIA).create(input(ten, over)));
      expect(e, ten).toMatchObject({ code: "BAD_REQUEST", appCode: "INTERLOCK_NGOAI_DAI" });
      expect(e.appParams, ten).toMatchObject({ ma: "INTERLOCK_NGOAI_DAI", lyDo });
      expect((await sql`SELECT id FROM interlock_rules WHERE name = ${DAU + "-" + ten}`).length, ten).toBe(0);
    }
  });

  it("create: trong dải + đúng bước ⇒ OK; tag không khai kênh ⇒ không kiểm; luật alert / không có đích ⇒ không kiểm", async () => {
    const ok = await caller(TAC_GIA).create(input("c-ok", { commandValue: "55" }));
    ruleIds.push(ok.id);
    const cu = await caller(TAC_GIA).create(input("c-cu", { commandTag: "cu", commandValue: 9999 }));
    ruleIds.push(cu.id);
    const al = await caller(TAC_GIA).create(input("c-al", { action: "alert", commandValue: 9999 }));
    ruleIds.push(al.id);
    const khongCoTag = await caller(TAC_GIA).create(input("c-kt", { commandTag: "khong-co", commandValue: 9999 }));
    ruleIds.push(khongCoTag.id);
    expect([ok.id, cu.id, al.id, khongCoTag.id].every((x) => x > 0)).toBe(true);
  });

  it("update: gộp patch lên hàng — đổi commandValue ra ngoài dải, hoặc đổi commandTag sang tag có dải loại giá trị cũ ⇒ từ chối, hàng giữ nguyên", async () => {
    const r = await caller(TAC_GIA).create(input("u1", { commandTag: "cu", commandValue: 9999 }));
    ruleIds.push(r.id);
    const e1 = await loiCua(caller(TAC_GIA).update({ id: r.id, commandTag: "sp" })); // giá trị cũ 9999 trên tag sp (0..100)
    expect(e1).toMatchObject({ code: "BAD_REQUEST", appCode: "INTERLOCK_NGOAI_DAI" });
    const r2 = await caller(TAC_GIA).create(input("u2"));
    ruleIds.push(r2.id);
    const e2 = await loiCua(caller(TAC_GIA).update({ id: r2.id, commandValue: 101 }));
    expect(e2).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI" });
    const e3 = await loiCua(caller(TAC_GIA).update({ id: r2.id, action: "stop_line", targetAdapterId: adapterId, commandValue: 3 }));
    expect(e3).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI", appParams: expect.objectContaining({ lyDo: "OFF_STEP" }) });
    const [row] = await sql`SELECT "commandTag" AS t, "commandValue" AS v, action FROM interlock_rules WHERE id = ${r.id}`;
    expect(row).toEqual({ t: "cu", v: 9999, action: "reduce_speed" });
    const [row2] = await sql`SELECT "commandValue" AS v FROM interlock_rules WHERE id = ${r2.id}`;
    expect(row2.v).toBe(50);
    // patch không đụng đích/giá trị vẫn phải qua (hàng hiện tại hợp lệ)
    expect((await caller(TAC_GIA).update({ id: r2.id, description: "chỉ sửa mô tả" })).description).toBe("chỉ sửa mô tả");
  });

  it("approve / enable: hàng ghi thẳng bảng (seed / AI tool) có commandValue ngoài dải ⇒ từ chối, không duyệt / không bật", async () => {
    const [a] = await sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "targetAdapterId",
        "commandTag", "commandValue", "createdBy")
      VALUES (${DAU + "-a1"}, 'machine', 'ng_rate', 'gt', 5, 'reduce_speed', ${adapterId}, 'sp', '500'::jsonb, ${TAC_GIA}) RETURNING id`;
    ruleIds.push(Number(a.id));
    const tokA = (await caller(DUYET).list()).find((r) => r.id === Number(a.id))!.versionToken;
    expect(await loiCua(caller(DUYET).approve({ id: Number(a.id), expectedVersion: tokA }))).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI" });
    expect((await sql`SELECT "approvedBy" AS x FROM interlock_rules WHERE id = ${a.id}`)[0].x).toBeNull();

    const [b] = await sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "targetAdapterId",
        "commandTag", "commandValue", "approvedBy", "createdBy")
      VALUES (${DAU + "-e1"}, 'machine', 'ng_rate', 'gt', 5, 'reduce_speed', ${adapterId}, 'sp', '500'::jsonb, ${DUYET}, ${TAC_GIA}) RETURNING id`;
    ruleIds.push(Number(b.id));
    const tokB = (await caller(TAC_GIA).list()).find((r) => r.id === Number(b.id))!.versionToken;
    expect(await loiCua(caller(TAC_GIA).enable({ id: Number(b.id), expectedVersion: tokB }))).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI" });
    expect((await sql`SELECT enabled FROM interlock_rules WHERE id = ${b.id}`)[0].enabled).toBe(false);

    // cùng hàng với giá trị trong dải ⇒ bật được
    await sql`UPDATE interlock_rules SET "commandValue" = '50'::jsonb WHERE id = ${b.id}`;
    const tokB2 = (await caller(TAC_GIA).list()).find((r) => r.id === Number(b.id))!.versionToken;
    expect((await caller(TAC_GIA).enable({ id: Number(b.id), expectedVersion: tokB2 })).enabled).toBe(true);
  });
});
