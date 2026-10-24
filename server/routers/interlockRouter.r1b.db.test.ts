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
import { scadaDiagRouter } from "./scadaDiagRouter";
import { _internal as oversight } from "./oversightRouter";
import { and, like, sql as drzSql } from "drizzle-orm";
import { interlockRules } from "../../drizzle/schema";
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
let diag!: ReturnType<typeof scadaDiagRouter.createCaller>;
let version = 0;
const tg: Record<string, number> = {};

async function seedTag(tagKey: string, cot: { dataType?: string; channel_kind?: string | null } = {}): Promise<number> {
  const [r] = await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind)
    VALUES (${adapterId}, ${tagKey}, ${"addr-" + tagKey}, ${cot.dataType ?? "int"}, true, true, ${cot.channel_kind ?? null}) RETURNING id`;
  return Number(r.id);
}

/** Luật ghi thẳng bảng (mặc định ĐÃ duyệt), nhắm (adapterId, commandTag). */
async function seedLuat(
  ten: string,
  commandTag: string,
  commandValue: unknown,
  o: { enabled?: boolean; action?: string; duyet?: boolean } = {},
): Promise<number> {
  const [r] = await sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "targetAdapterId",
      "commandTag", "commandValue", enabled, "approvedBy", "createdBy")
    VALUES (${DAU + "-" + ten}, 'machine', 'ng_rate', 'gt', 5, ${o.action ?? "reduce_speed"}, ${adapterId}, ${commandTag},
      ${sql.json(commandValue as never)}, ${o.enabled ?? true}, ${o.duyet === false ? null : DUYET}, ${TAC_GIA}) RETURNING id`;
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
    diag = scadaDiagRouter.createCaller({ user: { id: u.id, role: "admin", name: u.name, twoFactorEnabled: true } } as never);
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

    it("luật TẮT CHƯA duyệt hoặc luật `alert` ⇒ không bảo vệ, không kiểm (thôi writable qua được, không mã)", async () => {
      await seedLuat("tat", "cu", 1, { enabled: false, duyet: false });
      await seedLuat("al", "cu", 1, { action: "alert" });
      await dev.tags.update({ id: tg.cu, writable: false });
      expect((await hang(tg.cu)).writable).toBe(false);
    });

    it("★ fix round 3 (N2): luật TẮT nhưng ĐÃ DUYỆT vẫn bảo vệ đích ⇒ thôi writable / đổi address cần mã (TOTP_CAN)", async () => {
      await seedLuat("tatduyet", "cu", 1, { enabled: false });
      expect(await loiCua(dev.tags.update({ id: tg.cu, writable: false }))).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
      expect(await loiCua(dev.tags.update({ id: tg.cu, address: "x" }))).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
    });

    it("★ fix round 3 (N2): chuỗi TẮT luật (router thật) → đổi address đích → bật lại bị chặn ở bước đổi address (TOTP_CAN)", async () => {
      const r = await seedLuat("chuoi", "cu", 1);
      await ilk(TAC_GIA).disable({ id: r, reason: "thu chuoi N2" });
      expect((await sql`SELECT enabled, "approvedBy" AS a FROM interlock_rules WHERE id = ${r}`)[0]).toEqual({ enabled: false, a: DUYET });
      expect(await loiCua(dev.tags.update({ id: tg.cu, address: "dia-chi-moi" }))).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
      expect((await sql`SELECT address FROM device_tags WHERE id = ${tg.cu}`)[0].address).toBe("addr-cu");
    });

    it("đổi unit của tag chưa khai là đích luật bật ⇒ qua, không mã; ★ I7: đổi ADDRESS của nó ⇒ tag được bảo vệ ⇒ TOTP_CAN", async () => {
      await seedLuat("u", "cu", 1);
      await dev.tags.update({ id: tg.cu, unit: "rpm" });
      const e = await loiCua(dev.tags.update({ id: tg.cu, address: "addr-cu-2" }));
      expect(e).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_REQUIRED", appParams: { ma: "TOTP_CAN" } });
      expect((await sql`SELECT address FROM device_tags WHERE id = ${tg.cu}`)[0].address).toBe("addr-cu");
    });

    it("★ I2: TẮT tag là đích luật bật ⇒ INTERLOCK_MAT_DICH (dispatch từ chối tag tắt), tag vẫn bật", async () => {
      const r = await seedLuat("tat2", "cu", 1);
      const e = await loiCua(dev.tags.update({ id: tg.cu, isEnabled: false }));
      expect(e).toMatchObject({ appCode: "INTERLOCK_MAT_DICH", appParams: { tagKey: "cu", ruleId: r } });
      expect((await sql`SELECT "isEnabled" AS b FROM device_tags WHERE id = ${tg.cu}`)[0].b).toBe(true);
    });

    it("★ C1: XOÁ tag là đích luật bật ⇒ INTERLOCK_MAT_DICH, tag còn nguyên", async () => {
      const r = await seedLuat("xoa", "cu", 1);
      expect(await loiCua(dev.tags.delete({ id: tg.cu }))).toMatchObject({ appCode: "INTERLOCK_MAT_DICH", appParams: { ruleId: r } });
      expect((await sql`SELECT id FROM device_tags WHERE id = ${tg.cu}`).length).toBe(1);
    });

    it("★ fix round 2 (I2 cấp adapter): TẮT adapter mà luật bật ghi lệnh lên tag của nó ⇒ INTERLOCK_MAT_DICH (trước kiểm mã), adapter vẫn bật", async () => {
      const r = await seedLuat("tatad", "cu", 1);
      await sql`UPDATE device_adapters SET "isEnabled" = true WHERE id = ${adapterId}`;
      try {
        const e = await loiCua(dev.update({ id: adapterId, isEnabled: false }));
        expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INTERLOCK_MAT_DICH", appParams: { tagKey: "cu", ruleId: r } });
        expect((await sql`SELECT "isEnabled" AS b FROM device_adapters WHERE id = ${adapterId}`)[0].b).toBe(true);
      } finally {
        await sql`UPDATE device_adapters SET "isEnabled" = false WHERE id = ${adapterId}`;
      }
    });

    it("★ fix round 3 (N1): scadaDiag.tamTat adapter mà luật bật ghi lệnh lên tag của nó ⇒ INTERLOCK_MAT_DICH, adapter vẫn bật", async () => {
      const r = await seedLuat("tamtat", "cu", 1);
      await sql`UPDATE device_adapters SET "isEnabled" = true WHERE id = ${adapterId}`;
      try {
        const e = await loiCua(diag.tamTat({ adapterId, lyDo: "thu tam tat N1" }));
        expect(e).toMatchObject({ appCode: "INTERLOCK_MAT_DICH", appParams: { tagKey: "cu", ruleId: r } });
        expect((await sql`SELECT "isEnabled" AS b FROM device_adapters WHERE id = ${adapterId}`)[0].b).toBe(true);
      } finally {
        await sql`UPDATE device_adapters SET "isEnabled" = false WHERE id = ${adapterId}`;
      }
    });

    it("★ fix round 3 (N3): xoá adapter (đã tắt) mà luật bật ghi lệnh lên tag của nó ⇒ INTERLOCK_MAT_DICH, adapter + tag còn nguyên", async () => {
      const r = await seedLuat("xoaad", "cu", 1);
      expect(await loiCua(dev.delete({ id: adapterId }))).toMatchObject({ appCode: "INTERLOCK_MAT_DICH", appParams: { ruleId: r } });
      expect((await sql`SELECT id FROM device_adapters WHERE id = ${adapterId}`).length).toBe(1);
      expect((await sql`SELECT id FROM device_tags WHERE id = ${tg.cu}`).length).toBe(1);
    });

    it("chuyển tag đích của luật bật sang adapter khác ⇒ INTERLOCK_MAT_DICH", async () => {
      await seedLuat("mv", "cu", 1);
      const [a2] = await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled")
        VALUES (${DAU + "-2"}, ${DAU + "-2"}, 'stub', 'stub://ilkr1b2', false) RETURNING id`;
      try {
        expect(await loiCua(dev.tags.update({ id: tg.cu, adapterId: Number(a2.id) }))).toMatchObject({ appCode: "INTERLOCK_MAT_DICH" });
      } finally {
        await sql`DELETE FROM device_adapters WHERE id = ${a2.id}`;
      }
    });

    it("★ I3: đổi tên VÀO khoá mà luật bật đang nhắm (khoá mồ côi), giá trị lệnh không ghi được lên tag này ⇒ INTERLOCK_NGOAI_DAI (danh tính MỚI)", async () => {
      await seedLuat("moi", "ghost", 50.5); // luật nhắm khoá 'ghost' — chưa có tag nào mang khoá đó
      const e = await loiCua(dev.tags.update({ id: tg.i, tagKey: "ghost" }));
      expect(e).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI", appParams: expect.objectContaining({ tagKey: "ghost", lyDo: "TYPE_MISMATCH" }) });
      expect((await hang(tg.i)).tagKey).toBe("i");
    });

    it("C1/I3: TẠO tag lên khoá mà luật bật đang nhắm, tag mới không ghi được (writable=false) ⇒ INTERLOCK_NGOAI_DAI, không chèn", async () => {
      await seedLuat("tao", "ghost2", 1);
      const e = await loiCua(dev.tags.create({ adapterId, tagKey: "ghost2", address: "a-g2", dataType: "int", writable: false }));
      expect(e).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI", appParams: expect.objectContaining({ tagKey: "ghost2", lyDo: "CHANNEL_READ_ONLY" }) });
      expect((await sql`SELECT id FROM device_tags WHERE "adapterId" = ${adapterId} AND "tagKey" = 'ghost2'`).length).toBe(0);
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
      // Đếm CHỈ hàng của tệp này, cùng điều kiện posture: đếm toàn bảng bị tệp DB khác chạy song song chèn/xoá luật làm lệch
      // (đỏ khi chạy cả bộ sau merge main 2026-10-24, xanh khi chạy riêng).
      const cuaToi = async () => {
        const [{ c }] = await d!
          .select({ c: drzSql<number>`count(*)::int` })
          .from(interlockRules)
          .where(and(oversight.dieuKienInterlockCauHinhHong(), like(interlockRules.name, `${DAU}-p%`)));
        return c;
      };
      expect(await cuaToi()).toBe(0);
      await sql`INSERT INTO interlock_rules (name, scope, "machineId", "sourceKey", "sourceType", "comparisonOperator", threshold, action, enabled, "approvedBy", "createdBy")
        VALUES (${DAU + "-pl"}, 'line', ${MAY}, 'nhiet_do', 'telemetry_tag', 'gt', 80, 'alert', true, ${DUYET}, ${TAC_GIA})`;
      expect(await cuaToi()).toBe(1);
      await sql`INSERT INTO interlock_rules (name, scope, "machineId", "sourceKey", "sourceType", "comparisonOperator", threshold, action, enabled, "approvedBy", "createdBy")
        VALUES (${DAU + "-pm"}, 'machine', ${MAY}, 'nhiet_do', 'telemetry_tag', 'gt', 80, 'alert', true, ${DUYET}, ${TAC_GIA})`;
      expect(await cuaToi()).toBe(1);
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
