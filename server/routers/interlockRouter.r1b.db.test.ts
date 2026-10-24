/**
 * SCADA R1b-1 Task 9 — interlock: kiểm lại khi tag đổi + ba nợ R0.1.
 *
 *   1. `deviceAdapter.tags.update` / `mappingAsCode.applyImport` làm một luật interlock ĐANG BẬT (không phải `alert`) mất hợp lệ — giá trị
 *      GỬI thật (`giaTriLenhInterlock`) không còn ghi được lên tag đích sau khi đổi dataType / writable / scale / offset ⇒ `INTERLOCK_NGOAI_DAI`
 *      (bất kể tag đã khai kênh hay chưa — tag thôi `writable` ⇒ dispatch từ chối `TAG_NOT_WRITABLE`). Đổi tên / chuyển adapter của tag
 *      đích ⇒ `INTERLOCK_MAT_DICH` (hành động bảo vệ mất đích). Luật tắt / luật `alert` ⇒ không kiểm.
 *   2. `cooldownSeconds`: update một phần KHÔNG đặt lại về 300 (default chỉ ở create).
 *   3. Posture: `fetchInterlockCauHinhHong` đếm luật `telemetry_tag` có `scope <> 'machine'` (D11).
 *   4. `propose_interlock_rule`: D11 kiểm TRƯỚC khi chèn (helper dùng chung `telemetryTagDungPhamVi`).
 *
 * CSDL `_test` THẬT. Người gọi interlock: admin + 2FA, id giả cho SoD (khuôn `interlockRouter.kenhDai.r1a.db.test.ts`); người gọi
 * deviceAdapter / mappingAsCode: `taoNguoiDungTest` admin. Không ca nào cần mã TOTP (tag chưa khai, hoặc từ chối nhất quán đứng TRƯỚC mã).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { interlockRouter } from "./interlockRouter";
import { deviceAdapterRouter } from "./deviceAdapterRouter";
import { mappingAsCodeRouter } from "./mappingAsCodeRouter";
import { _internal as oversight } from "./oversightRouter";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { getTool } from "../services/aiLocalTools/toolRegistry";
import "../services/aiLocalTools/writeHandlers/interlock";

const DB_URL = process.env.DATABASE_URL;
const DAU = `ILKR1B-${process.pid}-${Date.now()}`;
const TAC_GIA = 990_541_001;
const DUYET = 990_541_002;
const MAY = 990_541_100;

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
let adapterId = 0;
let dev!: ReturnType<typeof deviceAdapterRouter.createCaller>;
let mac!: ReturnType<typeof mappingAsCodeRouter.createCaller>;
let version = 0;
const tg: Record<string, number> = {};

async function seedTag(tagKey: string, cot: { dataType?: string; channel_kind?: string | null } = {}): Promise<number> {
  const [r] = await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind)
    VALUES (${adapterId}, ${tagKey}, ${"addr-" + tagKey}, ${cot.dataType ?? "int"}, true, true, ${cot.channel_kind ?? null}) RETURNING id`;
  return Number(r.id);
}

/** Luật ghi thẳng bảng (đã duyệt), nhắm (adapterId, commandTag). */
async function seedLuat(ten: string, commandTag: string, commandValue: unknown, o: { enabled?: boolean; action?: string } = {}): Promise<number> {
  const [r] = await sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "targetAdapterId",
      "commandTag", "commandValue", enabled, "approvedBy", "createdBy")
    VALUES (${DAU + "-" + ten}, 'machine', 'ng_rate', 'gt', 5, ${o.action ?? "reduce_speed"}, ${adapterId}, ${commandTag},
      ${sql.json(commandValue as never)}, ${o.enabled ?? true}, ${DUYET}, ${TAC_GIA}) RETURNING id`;
  return Number(r.id);
}

const hang = async (id: number) =>
  (await sql`SELECT "tagKey" AS "tagKey", "dataType" AS "dataType", scale::float8 AS scale, writable FROM device_tags WHERE id = ${id}`)[0];

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("R1b-1 T9 — interlock kiểm lại khi tag đổi + nợ R0.1", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const [a] = await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled")
      VALUES (${DAU}, ${DAU}, 'stub', 'stub://ilkr1b', false) RETURNING id`;
    adapterId = Number(a.id);
    const u = await taoNguoiDungTest("ad", "admin", { tienTo: "ilkr1b", ts: DAU.replace(/[^A-Za-z0-9]/g, ""), ten: "ILK R1b admin" });
    dev = deviceAdapterRouter.createCaller({ user: { id: u.id, role: "admin", name: u.name, twoFactorEnabled: true } } as never);
    mac = mappingAsCodeRouter.createCaller({ user: { id: u.id, role: "admin", name: u.name, twoFactorEnabled: true } } as never);
  }, 60_000);

  beforeEach(async () => {
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${DAU + "-%"}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`;
    tg.cu = await seedTag("cu"); // CHƯA khai kênh
    tg.f = await seedTag("f", { dataType: "float", channel_kind: "output" }); // đã khai loại kênh, không dải
    tg.i = await seedTag("i", { channel_kind: "output" }); // int, đã khai loại kênh
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${DAU + "%"}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`;
    await sql`DELETE FROM config_snapshots WHERE entity_type = 'mapping_file' AND entity_id = ${adapterId}`;
    await sql`DELETE FROM device_adapters WHERE id = ${adapterId}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  describe("1 — tags.update / import làm luật interlock ĐANG BẬT mất hợp lệ ⇒ từ chối", () => {
    it("★ tag CHƯA khai, luật bật nhắm nó: thôi writable ⇒ INTERLOCK_NGOAI_DAI (CHANNEL_READ_ONLY, ruleId), hàng giữ nguyên", async () => {
      const r = await seedLuat("w", "cu", 1);
      const e = await loiCua(dev.tags.update({ id: tg.cu, writable: false }));
      expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INTERLOCK_NGOAI_DAI" });
      expect(e.appParams).toMatchObject({ ma: "INTERLOCK_NGOAI_DAI", lyDo: "CHANNEL_READ_ONLY", tagKey: "cu", ruleId: r });
      expect((await hang(tg.cu)).writable).toBe(true);
    });

    it("★ tag đã khai, đổi dataType float → int làm commandValue 50.5 sai kiểu ⇒ INTERLOCK_NGOAI_DAI TYPE_MISMATCH (trước kiểm mã)", async () => {
      await seedLuat("dt", "f", 50.5);
      const e = await loiCua(dev.tags.update({ id: tg.f, dataType: "int" }));
      expect(e).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI", appParams: expect.objectContaining({ lyDo: "TYPE_MISMATCH", tagKey: "f" }) });
      expect((await hang(tg.f)).dataType).toBe("float");
    });

    it("tag int đã khai, scale 1 → 2 làm commandValue 3 lệch lưới thô ⇒ INTERLOCK_NGOAI_DAI OFF_STEP", async () => {
      await seedLuat("sc", "i", 3);
      const e = await loiCua(dev.tags.update({ id: tg.i, scale: 2 }));
      expect(e).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI", appParams: expect.objectContaining({ lyDo: "OFF_STEP" }) });
      expect((await hang(tg.i)).scale).toBe(1);
    });

    it("luật null commandValue (engine gửi `true`): đổi tag sang int ⇒ TYPE_MISMATCH — kiểm giá trị GỬI, không phải giá trị lưu", async () => {
      await seedLuat("nul", "f", null);
      expect(await loiCua(dev.tags.update({ id: tg.f, dataType: "int" }))).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI" });
    });

    it("luật TẮT hoặc luật `alert` ⇒ không kiểm (thôi writable qua được)", async () => {
      await seedLuat("tat", "cu", 1, { enabled: false });
      await seedLuat("al", "cu", 1, { action: "alert" });
      await dev.tags.update({ id: tg.cu, writable: false });
      expect((await hang(tg.cu)).writable).toBe(false);
    });

    it("đổi trường không ảnh hưởng giá trị lệnh (unit / address) của tag chưa khai ⇒ không kiểm luật", async () => {
      await seedLuat("u", "cu", 1);
      await dev.tags.update({ id: tg.cu, unit: "rpm", address: "addr-cu-2" });
    });

    it("★ đổi tên tag đích của luật bật ⇒ INTERLOCK_MAT_DICH {tagKey cũ, ruleId}, tên giữ nguyên", async () => {
      const r = await seedLuat("ten", "cu", 1);
      const e = await loiCua(dev.tags.update({ id: tg.cu, tagKey: "cu_moi" }));
      expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INTERLOCK_MAT_DICH", appParams: { ma: "INTERLOCK_MAT_DICH", tagKey: "cu", ruleId: r } });
      expect((await hang(tg.cu)).tagKey).toBe("cu");
    });

    it("★ import: file thôi writable của tag đích ⇒ INTERLOCK_NGOAI_DAI, cả lô không ghi", async () => {
      await seedLuat("imp", "cu", 1);
      version += 1;
      const y = [`version: ${version}`, `adapter: "${DAU}"`, "tags:",
        "  - name: cu", '    address: "addr-cu"', "    datatype: int", "    writable: false", "    enabled: true",
        "  - name: f", '    address: "addr-f-2"', "    datatype: float", "    writable: true", "    enabled: true"].join("\n") + "\n";
      const e = await loiCua(mac.applyImport({ yaml: y }));
      expect(e).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI", appParams: expect.objectContaining({ tagKey: "cu", lyDo: "CHANNEL_READ_ONLY" }) });
      expect((await hang(tg.cu)).writable).toBe(true);
    });
  });

  describe("2 — cooldownSeconds: update một phần không đặt lại về 300", () => {
    it("★ create cooldown 60 → update chỉ mô tả ⇒ cooldown vẫn 60; create không khai ⇒ 300", async () => {
      const r = await ilk(TAC_GIA).create({
        name: `${DAU}-cd`, scope: "machine", sourceType: "ng_rate", comparisonOperator: "gt", threshold: 5, action: "alert", cooldownSeconds: 60,
      });
      expect(r.cooldownSeconds).toBe(60);
      const u = await ilk(TAC_GIA).update({ id: r.id, description: "chỉ sửa mô tả" });
      expect(u.cooldownSeconds).toBe(60);
      expect((await sql`SELECT "cooldownSeconds" AS c FROM interlock_rules WHERE id = ${r.id}`)[0].c).toBe(60);
      const md = await ilk(TAC_GIA).create({ name: `${DAU}-cd2`, scope: "machine", sourceType: "ng_rate", comparisonOperator: "gt", threshold: 5, action: "alert" });
      expect(md.cooldownSeconds).toBe(300);
    });
  });

  describe("3 — posture đếm luật telemetry_tag ngoài phạm vi máy", () => {
    it("★ luật BẬT + DUYỆT, telemetry_tag đủ machineId + sourceKey nhưng scope 'line' ⇒ được đếm; cùng luật scope 'machine' ⇒ không", async () => {
      const d = await getDb();
      const truoc = await oversight.fetchInterlockCauHinhHong(d);
      expect(truoc.degraded).toBe(false);
      await sql`INSERT INTO interlock_rules (name, scope, "machineId", "sourceKey", "sourceType", "comparisonOperator", threshold, action, enabled, "approvedBy", "createdBy")
        VALUES (${DAU + "-pl"}, 'line', ${MAY}, 'nhiet_do', 'telemetry_tag', 'gt', 80, 'alert', true, ${DUYET}, ${TAC_GIA})`;
      expect((await oversight.fetchInterlockCauHinhHong(d)).count).toBe(truoc.count + 1);
      await sql`INSERT INTO interlock_rules (name, scope, "machineId", "sourceKey", "sourceType", "comparisonOperator", threshold, action, enabled, "approvedBy", "createdBy")
        VALUES (${DAU + "-pm"}, 'machine', ${MAY}, 'nhiet_do', 'telemetry_tag', 'gt', 80, 'alert', true, ${DUYET}, ${TAC_GIA})`;
      expect((await oversight.fetchInterlockCauHinhHong(d)).count).toBe(truoc.count + 1);
    });
  });

  describe("4 — propose_interlock_rule kiểm D11 trước khi chèn", () => {
    const base = {
      name: `${DAU}-ai`,
      sourceType: "telemetry_tag" as const,
      sourceKey: "nhiet_do",
      machineId: MAY,
      comparisonOperator: "gt" as const,
      threshold: 80,
      action: "alert" as const,
    };
    const ctx = { user: { id: TAC_GIA, role: "supervisor", name: "AI" }, lang: "vi" as const };

    it("★ telemetry_tag + scope 'line' ⇒ tham số bị từ chối VÀ execute (nếu bị gọi thẳng) không chèn hàng", async () => {
      const tool = getTool("propose_interlock_rule")!;
      const sai = { ...base, name: `${DAU}-ai-line`, scope: "line" as const };
      expect(tool.parameters.safeParse(sai).success).toBe(false);
      await expect(tool.execute!(sai as never, ctx as never)).rejects.toThrow(/telemetry_tag/);
      expect((await sql`SELECT id FROM interlock_rules WHERE name = ${DAU + "-ai-line"}`).length).toBe(0);
    });

    it("telemetry_tag + scope 'machine' ⇒ chèn (tắt, chưa duyệt) như cũ", async () => {
      const tool = getTool("propose_interlock_rule")!;
      const ok = { ...base, name: `${DAU}-ai-may`, scope: "machine" as const };
      expect(tool.parameters.safeParse(ok).success).toBe(true);
      const res = await tool.execute!(ok as never, ctx as never);
      const id = (res.data as { id: number }).id;
      expect((await sql`SELECT enabled, "approvedBy" AS a FROM interlock_rules WHERE id = ${id}`)[0]).toEqual({ enabled: false, a: null });
    });
  });
});
