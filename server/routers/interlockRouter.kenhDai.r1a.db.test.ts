/**
 * SCADA R1a Task 12 (review T3 M-3) — `interlockRouter` create / update / approve / enable từ chối `commandValue` không ghi được lên
 * khai báo kênh HIỆN TẠI của tag đích (`targetAdapterId` + `commandTag`): ngoài dải / lệch bước / sai kiểu / kênh chỉ đọc ⇒
 * `INTERLOCK_NGOAI_DAI`. Nếu không, hành động bảo vệ của luật sẽ bị cổng kênh của `dispatch()` từ chối (`OUT_OF_RANGE` …) đúng lúc cần.
 * update / approve / enable kiểm trên hàng đã GỘP patch. Tag không khai mô hình ghi (mọi cột kênh NULL) ⇒ không kiểm (hành vi cũ) — TRỪ lưới thô
 * của tag int có scale/offset (R1b-1 T13: dispatch kiểm nó cho mọi tag int, nên cấu hình cũng phải kiểm).
 * Chiều ngược lại (khai dải khi đã có luật bật) ở `scadaKenhRouter.db.test.ts`.
 *
 * CSDL `_test` THẬT (khuôn `interlockRouter.cauHinh.db.test.ts`: người gọi admin + 2FA, id giả cho SoD).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { dongDauDuyetLuat } from "../testing/dauDuyetInterlock";

// kiem-dinh R1b-1 I1 (b) (2026-10-25) — sửa / xoá luật bảo vệ nay đòi TOTP tươi mức 5 (cổng có test riêng: interlockRouter.kiemDinh.r1b.db.test.ts).
// Tệp này kiểm commandValue ↔ dải bằng người gọi id giả (không có 2FA thật) ⇒ FIXTURE: mã luôn hợp lệ.
vi.mock("../services/scada/totpCauHinh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/scada/totpCauHinh")>()),
  kiemTotpCauHinh: async () => undefined,
}));
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
    await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind)
      VALUES (${adapterId}, 'b', 'addr-b', 'bool', true, true, 'output')`;
    // R1b-1 T13 — int KHÔNG khai kênh, scale 10: dispatch kiểm lưới thô ⇒ cấu hình interlock cũng phải kiểm
    await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", scale)
      VALUES (${adapterId}, 'sc10cu', 'addr-sc10cu', 'int', true, true, 10)`;
    // R1b-1 T13 polish (m1 + m3) — int KHÔNG khai kênh, scale 10 offset −5 (lưới …, 15, 25, 35, …)
    await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", scale, "offset")
      VALUES (${adapterId}, 'so5', 'addr-so5', 'int', true, true, 10, -5)`;
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

  it("R1b-1 T13 create: tag int KHÔNG khai kênh, scale 10 — commandValue 25 ⇒ INTERLOCK_NGOAI_DAI (OFF_STEP), không ghi hàng; 30 ⇒ OK (dispatch gửi raw 3)", async () => {
    const e = await loiCua(caller(TAC_GIA).create(input("t13-25", { commandTag: "sc10cu", commandValue: 25 })));
    expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INTERLOCK_NGOAI_DAI" });
    // polish m1 — câu vi/en/zh nêu ĐÚNG lưới thô: bước = |scale|, gốc = offset, giá trị gần nhất; tag không khai dải ⇒ min/max "—"
    expect(e.appParams).toEqual({ ma: "INTERLOCK_NGOAI_DAI", lyDo: "OFF_STEP", tagKey: "sc10cu", min: "—", max: "—", step: 10, goc: 0, goiY: 30 });
    expect((await sql`SELECT id FROM interlock_rules WHERE name = ${DAU + "-t13-25"}`).length).toBe(0);
    const ok = await caller(TAC_GIA).create(input("t13-30", { commandTag: "sc10cu", commandValue: 30 }));
    ruleIds.push(ok.id);
    expect(ok.id).toBeGreaterThan(0);
  });

  it("R1b-1 T13 polish m1 + m3: offset −5 scale 10 — 20 ⇒ INTERLOCK_NGOAI_DAI {step 10, goc −5, goiY 25}; 25 ⇒ OK. Tag ĐÃ khai: lệch bước ⇒ {step 5, goc 0, goiY 50}; ngoài dải ⇒ goc/goiY \"—\"", async () => {
    const e = await loiCua(caller(TAC_GIA).create(input("t13-o20", { commandTag: "so5", commandValue: 20 })));
    expect(e.appParams).toEqual({ ma: "INTERLOCK_NGOAI_DAI", lyDo: "OFF_STEP", tagKey: "so5", min: "—", max: "—", step: 10, goc: -5, goiY: 25 });
    const ok = await caller(TAC_GIA).create(input("t13-o25", { commandTag: "so5", commandValue: 25 }));
    ruleIds.push(ok.id);
    expect((await loiCua(caller(TAC_GIA).create(input("t13-buoc", { commandValue: 52 })))).appParams).toEqual({
      ma: "INTERLOCK_NGOAI_DAI", lyDo: "OFF_STEP", tagKey: "sp", min: 0, max: 100, step: 5, goc: 0, goiY: 50,
    });
    expect((await loiCua(caller(TAC_GIA).create(input("t13-ngoai", { commandValue: 150 })))).appParams).toEqual({
      ma: "INTERLOCK_NGOAI_DAI", lyDo: "OUT_OF_RANGE", tagKey: "sp", min: 0, max: 100, step: 5, goc: "—", goiY: "—",
    });
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
    await dongDauDuyetLuat(Number(b.id)); // I1 (a) FIXTURE — "đã duyệt" gieo thẳng mang bám định nghĩa hiện tại
    const tokB = (await caller(TAC_GIA).list()).find((r) => r.id === Number(b.id))!.versionToken;
    expect(await loiCua(caller(TAC_GIA).enable({ id: Number(b.id), expectedVersion: tokB }))).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI" });
    expect((await sql`SELECT enabled FROM interlock_rules WHERE id = ${b.id}`)[0].enabled).toBe(false);

    // cùng hàng với giá trị trong dải ⇒ bật được — R1b-1 T10b: bật luật đòi adapter đích ĐANG BẬT (INTERLOCK_DICH_CHUA_SAN_SANG), nên bật
    // adapter (stub, không phiên OT nào trong test) trong lúc bật luật.
    await sql`UPDATE interlock_rules SET "commandValue" = '50'::jsonb WHERE id = ${b.id}`;
    const tokB2 = (await caller(TAC_GIA).list()).find((r) => r.id === Number(b.id))!.versionToken;
    await sql`UPDATE device_adapters SET "isEnabled" = true WHERE id = ${adapterId}`;
    try {
      expect((await caller(TAC_GIA).enable({ id: Number(b.id), expectedVersion: tokB2 })).enabled).toBe(true);
    } finally {
      await sql`UPDATE device_adapters SET "isEnabled" = false WHERE id = ${adapterId}`;
    }
  });

  it("c1: kiểm GIÁ TRỊ ENGINE GỬI — commandValue null trên kênh bool đã khai ⇒ OK (engine gửi true); trên kênh float ⇒ từ chối", async () => {
    const ok = await caller(TAC_GIA).create(input("c1-bool", { commandTag: "b", commandValue: null }));
    ruleIds.push(ok.id);
    expect(ok.id).toBeGreaterThan(0);
    expect(await loiCua(caller(TAC_GIA).create(input("c1-float", { commandValue: null })))).toMatchObject({
      appCode: "INTERLOCK_NGOAI_DAI",
      appParams: expect.objectContaining({ lyDo: "TYPE_MISMATCH" }),
    });
  });

  it("c2: update CHỈ kiểm khi patch chạm commandValue / targetAdapterId / commandTag — sửa mô tả luật lệch kênh được; approve / enable vẫn chặn", async () => {
    const [a] = await sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "targetAdapterId",
        "commandTag", "commandValue", "createdBy")
      VALUES (${DAU + "-c2"}, 'machine', 'ng_rate', 'gt', 5, 'reduce_speed', ${adapterId}, 'sp', '500'::jsonb, ${TAC_GIA}) RETURNING id`;
    const id = Number(a.id);
    ruleIds.push(id);
    expect((await caller(TAC_GIA).update({ id, description: "chỉ sửa mô tả" })).description).toBe("chỉ sửa mô tả");
    expect((await caller(TAC_GIA).update({ id, threshold: 7 })).threshold).toBeTruthy();
    for (const patch of [{ commandValue: 501 }, { commandTag: "sp" }, { targetAdapterId: adapterId }]) {
      expect(await loiCua(caller(TAC_GIA).update({ id, ...patch })), JSON.stringify(patch)).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI" });
    }
    const tok = (await caller(DUYET).list()).find((r) => r.id === id)!.versionToken;
    expect(await loiCua(caller(DUYET).approve({ id, expectedVersion: tok }))).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI" });
    await sql`UPDATE interlock_rules SET "approvedBy" = ${DUYET} WHERE id = ${id}`;
    await dongDauDuyetLuat(id); // I1 (a) FIXTURE
    const tok2 = (await caller(TAC_GIA).list()).find((r) => r.id === id)!.versionToken;
    expect(await loiCua(caller(TAC_GIA).enable({ id, expectedVersion: tok2 }))).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI" });
    expect((await sql`SELECT enabled FROM interlock_rules WHERE id = ${id}`)[0].enabled).toBe(false);
    // sửa giá trị về trong dải ⇒ được
    expect((await caller(TAC_GIA).update({ id, commandValue: 50 })).commandValue).toBe(50);
  });
});
