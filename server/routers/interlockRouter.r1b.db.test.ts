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
 *   5. R1b-1 rà soát cuối I-1: posture đếm luật ĐANG BẬT mà lệnh bảo vệ lệch lưới thô trên đích int có scale (T13 dispatch từ chối).
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
import { dongDauDuyetLuat } from "../testing/dauDuyetInterlock";
import { getTool } from "../services/aiLocalTools/toolRegistry";
import { canhBaoLuatLenhLechLuoiKhiKhoiDong, luatLenhLechLuoi, TRUY_VAN_TRUOC_TRIEN_KHAI } from "../services/scada/lenhInterlockLechLuoi";
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
  // kiem-dinh R1b-1 I1 (a) — FIXTURE: luật "đã duyệt" gieo thẳng bảng mang bám định nghĩa HIỆN TẠI (như approve chụp).
  await dongDauDuyetLuat(Number(r.id));
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

  describe("1b — R1b-1 T10b: interlock.enable đòi đích / nguồn còn TỒN TẠI + BẬT (chiều ngược của I2)", () => {
    // kiem-dinh R1b-1 I1 (a) — FIXTURE: các ca dưới đổi tag / adapter nguồn / đích giữa các lần bật để kiểm "đích / nguồn sẵn sàng" (T10b); mỗi
    // lần bật mô phỏng một lần DUYỆT LẠI trên định nghĩa hiện tại (đóng dấu bám) — cổng "định nghĩa đổi sau duyệt" có test riêng (I1 a bên dưới).
    const bat = async (id: number) => {
      await dongDauDuyetLuat(id);
      return ilk(TAC_GIA).enable({ id, expectedVersion: (await ilk(TAC_GIA).get({ id })).versionToken });
    };
    const dangBat = async (id: number) => (await sql`SELECT enabled FROM interlock_rules WHERE id = ${id}`)[0].enabled as boolean;
    const datAdapter = (b: boolean) => sql`UPDATE device_adapters SET "isEnabled" = ${b} WHERE id = ${adapterId}`;

    it("★ tag đích KHÔNG tồn tại ⇒ INTERLOCK_DICH_CHUA_SAN_SANG (dich_khong_ton_tai), luật vẫn tắt", async () => {
      await datAdapter(true);
      try {
        const r = await seedLuat("en-ghost", "khong-co-tag", 1, { enabled: false });
        const e = await loiCua(bat(r));
        expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INTERLOCK_DICH_CHUA_SAN_SANG" });
        expect(e.appParams).toEqual({ ma: "INTERLOCK_DICH_CHUA_SAN_SANG", lyDo: "dich_khong_ton_tai", tagKey: "khong-co-tag", ruleId: r });
        expect(await dangBat(r)).toBe(false);
      } finally {
        await datAdapter(false);
      }
    });

    it("★ tag đích đang TẮT ⇒ dich_tat; tag đích writable=false (chưa khai kênh) ⇒ INTERLOCK_NGOAI_DAI CHANNEL_READ_ONLY; luật vẫn tắt", async () => {
      await datAdapter(true);
      try {
        await sql`UPDATE device_tags SET "isEnabled" = false WHERE id = ${tg.cu}`;
        const r = await seedLuat("en-tat", "cu", 1, { enabled: false });
        expect(await loiCua(bat(r))).toMatchObject({ appCode: "INTERLOCK_DICH_CHUA_SAN_SANG", appParams: { lyDo: "dich_tat", tagKey: "cu", ruleId: r } });
        await sql`UPDATE device_tags SET "isEnabled" = true, writable = false WHERE id = ${tg.cu}`;
        expect(await loiCua(bat(r))).toMatchObject({
          appCode: "INTERLOCK_NGOAI_DAI",
          appParams: expect.objectContaining({ lyDo: "CHANNEL_READ_ONLY", tagKey: "cu", ruleId: r }),
        });
        expect(await dangBat(r)).toBe(false);
      } finally {
        await datAdapter(false);
      }
    });

    it("★ adapter đích đang TẮT ⇒ adapter_dich_tat; bật adapter ⇒ bật luật được", async () => {
      const r = await seedLuat("en-ad", "cu", 1, { enabled: false });
      expect(await loiCua(bat(r))).toMatchObject({ appCode: "INTERLOCK_DICH_CHUA_SAN_SANG", appParams: { lyDo: "adapter_dich_tat", tagKey: "cu" } });
      expect(await dangBat(r)).toBe(false);
      await datAdapter(true);
      try {
        expect((await bat(r)).enabled).toBe(true);
      } finally {
        await datAdapter(false);
      }
    });

    // ── fix round 1 (I-1 / M-2 / M-3) — nguồn telemetry_tag ─────────────────────────────────────────────────────────────────────────
    const MAY_KHAC = MAY + 1; // máy KHÁC (id giả, không FK — như MAY)
    /** Adapter stub gắn máy `may`, kèm (tuỳ chọn) tag `nhiet`; trả id adapter. Dọn bằng `donNguon`. */
    const adapterNguon = async (hau: string, may: number, adapterBat: boolean, tag?: { bat: boolean }) => {
      const [a] = await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId")
        VALUES (${DAU + "-src-" + hau}, ${DAU + "-src-" + hau}, 'stub', ${"stub://ilkr1b-src-" + hau}, ${adapterBat}, ${may}) RETURNING id`;
      if (tag) {
        await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
          VALUES (${a.id}, 'nhiet', ${"addr-nhiet-" + hau}, 'float', false, ${tag.bat})`;
      }
      return Number(a.id);
    };
    const luatNguon = async () => {
      const [r0] = await sql`INSERT INTO interlock_rules (name, scope, "machineId", "sourceKey", "sourceType", "comparisonOperator", threshold, action,
          "targetMachineId", enabled, "approvedBy", "createdBy")
        VALUES (${DAU + "-en-src"}, 'machine', ${MAY}, 'nhiet', 'telemetry_tag', 'gt', 80, 'stop_line', ${MAY}, false, ${DUYET}, ${TAC_GIA}) RETURNING id`;
      return Number(r0.id);
    };
    const donNguon = async () => {
      await sql`DELETE FROM interlock_rules WHERE name = ${DAU + "-en-src"}`;
      await sql`DELETE FROM device_tags WHERE "adapterId" IN (SELECT id FROM device_adapters WHERE code LIKE ${DAU + "-src-%"})`;
      await sql`DELETE FROM device_adapters WHERE code LIKE ${DAU + "-src-%"}`;
    };
    const tatLuat = (id: number) => sql`UPDATE interlock_rules SET enabled = false WHERE id = ${id}`;

    it("★ I-1: KHÔNG tag thiết bị nào của máy khai sourceKey (nguồn ngoài OT — cổng đọc ot_telemetry) ⇒ BẬT được; ★ M-3: tag cùng khoá ĐANG TẮT trên máy KHÁC không bị coi là nguồn đã khai (không nguon_tat)", async () => {
      try {
        // Máy KHÁC có adapter bật mang tag 'nhiet' ĐANG TẮT: nếu bộ lọc máy bị bỏ, nó thành "nguồn đã khai mà tắt" ⇒ nguon_tat. Đúng: bỏ qua ⇒
        // nhánh "không tag thiết bị nào của máy khai" ⇒ bật.
        await adapterNguon("khac", MAY_KHAC, true, { bat: false });
        const r = await luatNguon();
        expect((await bat(r)).enabled).toBe(true);
        expect((await sql`SELECT count(*)::int AS n FROM device_tags t JOIN device_adapters a ON a.id = t."adapterId"
          WHERE a."machineId" = ${MAY} AND t."tagKey" = 'nhiet'`)[0].n, "nhánh đã chạy = không tag thiết bị nào của MÁY khai khoá").toBe(0);
      } finally {
        await donNguon();
      }
    });

    it("★ nguồn ĐÃ KHAI trên máy: tag tắt / adapter tắt ⇒ nguon_tat; đủ ⇒ bật; ★ M-3: tag SỐNG cùng khoá trên máy KHÁC không tính vào mơ hồ", async () => {
      try {
        const adMay = await adapterNguon("may", MAY, false, { bat: false });
        await adapterNguon("khac", MAY_KHAC, true, { bat: true }); // nguồn sống của máy KHÁC
        const r = await luatNguon();
        expect(await loiCua(bat(r))).toMatchObject({
          appCode: "INTERLOCK_DICH_CHUA_SAN_SANG",
          appParams: { ma: "INTERLOCK_DICH_CHUA_SAN_SANG", lyDo: "nguon_tat", tagKey: "nhiet", ruleId: r },
        }); // tag tắt, adapter tắt
        await sql`UPDATE device_tags SET "isEnabled" = true WHERE "adapterId" = ${adMay}`;
        expect(await loiCua(bat(r))).toMatchObject({ appParams: { lyDo: "nguon_tat" } }); // adapter vẫn tắt
        expect(await dangBat(r)).toBe(false);
        await sql`UPDATE device_adapters SET "isEnabled" = true WHERE id = ${adMay}`;
        expect((await bat(r)).enabled, "một nguồn sống trên MÁY + một trên máy khác ⇒ không mơ hồ").toBe(true);
      } finally {
        await donNguon();
      }
    });

    it("★ M-2: >1 adapter BẬT của máy cùng mang tag nguồn BẬT ⇒ INTERLOCK_NGUON_MO_HO (nguon_mo_ho, soAdapter); tắt tag trùng ⇒ bật được", async () => {
      try {
        await adapterNguon("may", MAY, true, { bat: true });
        const adTrung = await adapterNguon("may2", MAY, true, { bat: true });
        const r = await luatNguon();
        const e = await loiCua(bat(r));
        expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INTERLOCK_NGUON_MO_HO" });
        expect(e.appParams).toEqual({ ma: "INTERLOCK_NGUON_MO_HO", lyDo: "nguon_mo_ho", tagKey: "nhiet", ruleId: r, soAdapter: 2 });
        expect(await dangBat(r)).toBe(false);
        await sql`UPDATE device_tags SET "isEnabled" = false WHERE "adapterId" = ${adTrung}`;
        expect((await bat(r)).enabled).toBe(true);
        await tatLuat(r);
      } finally {
        await donNguon();
      }
    });

    it("luật `alert` không kiểm đích / nguồn (alert không bao giờ dispatch): tag đích không có, adapter tắt ⇒ bật được như cũ", async () => {
      const r = await seedLuat("en-alert", "khong-co-tag-2", 1, { enabled: false, action: "alert" });
      expect((await bat(r)).enabled).toBe(true);
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

  describe("5 — R1b-1 rà soát cuối I-1: posture đếm luật ĐANG BẬT mà lệnh bảo vệ lệch lưới thô (T13 dispatch sẽ từ chối)", () => {
    // Đếm CHỈ hàng của tệp này (tiền tố `${DAU}-g`): tệp DB khác chạy song song chèn / xoá luật.
    const cuaToi = () => like(interlockRules.name, `${DAU}-g%`);

    it("★ đích int CHƯA khai scale 10: bật + 25 ⇒ đếm (OFF_STEP); 30 ⇒ không; tắt / alert ⇒ không; commandValue NULL (⇒ true ⇒ 1) ⇒ đếm", async () => {
      const d = await getDb();
      await sql`UPDATE device_tags SET scale = 10 WHERE id = ${tg.cu}`;
      const truoc = await oversight.fetchInterlockCauHinhHong(d, cuaToi());
      expect(truoc).toEqual({ count: 0, degraded: false });

      const r25 = await seedLuat("g25", "cu", 25);
      expect(await oversight.fetchInterlockCauHinhHong(d, cuaToi())).toEqual({ count: 1, degraded: false });
      const ds = await luatLenhLechLuoi(d!, cuaToi());
      expect(ds.map((r) => [r.id, r.ma])).toEqual([[r25, "OFF_STEP"]]);

      await seedLuat("g30", "cu", 30); // đúng lưới (thô 3)
      await seedLuat("gtat", "cu", 25, { enabled: false });
      await seedLuat("galert", "cu", 25, { action: "alert" });
      expect((await oversight.fetchInterlockCauHinhHong(d, cuaToi())).count).toBe(1);

      const [nul] = await sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "targetAdapterId",
          "commandTag", "commandValue", enabled, "approvedBy", "createdBy")
        VALUES (${DAU + "-gnull"}, 'machine', 'ng_rate', 'gt', 5, 'reduce_speed', ${adapterId}, 'cu', NULL, true, ${DUYET}, ${TAC_GIA}) RETURNING id`;
      const rStr = await seedLuat("gstr", "cu", "25"); // chuỗi số ⇒ Number("25") như driver
      const rObj = await seedLuat("gobj", "cu", { pct: 25 }); // không phải số ⇒ driver không làm tròn ⇒ JS không kiểm
      const mong = [r25, Number(nul.id), rStr].sort((a, b) => a - b);
      expect((await luatLenhLechLuoi(d!, cuaToi())).map((r) => r.id)).toEqual(mong);
      expect((await oversight.fetchInterlockCauHinhHong(d, cuaToi())).count).toBe(3);
      // Truy vấn TRƯỚC TRIỂN KHAI của báo cáo §4 (SQL thuần, chép nguyên văn): đúng tập JS là LECH_LUOI; kiem-dinh N-1 — đối tượng ⇒ thêm MỘT hàng
      // KHONG_PARSE_DUOC (SQL không chép bộ đọc số của JS ⇒ báo dư, không bỏ sót).
      const qSql = await sql.unsafe(`SELECT id::int AS id, ket_luan FROM (${TRUY_VAN_TRUOC_TRIEN_KHAI}) q WHERE q.name LIKE $1 ORDER BY id`, [`${DAU}-g%`]);
      expect(qSql.filter((r) => r.ket_luan === "LECH_LUOI").map((r) => Number(r.id))).toEqual(mong);
      expect(qSql.filter((r) => r.ket_luan === "KHONG_PARSE_DUOC").map((r) => Number(r.id))).toEqual([rObj]);

      // Đối chứng: cùng luật trên tag scale 1 ⇒ không lệch (thiết bị đo nhìn thấy được scale).
      await sql`UPDATE device_tags SET scale = 1 WHERE id = ${tg.cu}`;
      expect(await oversight.fetchInterlockCauHinhHong(d, cuaToi())).toEqual({ count: 0, degraded: false });
    });

    it("★ kiem-dinh N-1 — chuỗi \"0x19\", chuỗi có TAB, NBSP, mảng [25] ⇒ SQL trước triển khai trả hàng KHONG_PARSE_DUOC (đếm là chặn); tập JS ⊆ tập SQL", async () => {
      const d = await getDb();
      await sql`UPDATE device_tags SET scale = 10 WHERE id = ${tg.cu}`;
      const rHex = await seedLuat("ghex", "cu", "0x19"); // JS: Number("0x19") = 25 ⇒ OFF_STEP
      const rTab = await seedLuat("gtab", "cu", "\t25"); // JS: 25 ⇒ OFF_STEP
      const rNbsp = await seedLuat("gnbsp", "cu", " 30"); // JS: 30 (đúng lưới) ⇒ không đếm; SQL báo dư
      const rMang = await seedLuat("gmang", "cu", [25]); // JS: Number([25]) = 25 ⇒ OFF_STEP
      const rSpace = await seedLuat("gspace", "cu", " 25 "); // dấu cách đầu/cuối: SQL vẫn đọc được ⇒ LECH_LUOI
      const js = (await luatLenhLechLuoi(d!, cuaToi())).map((r) => r.id);
      expect(js).toEqual([rHex, rTab, rMang, rSpace].sort((a, b) => a - b));
      const q = await sql.unsafe(
        `SELECT id::int AS id, ket_luan, gia_tri_gui, diem_luoi_gan_nhat FROM (${TRUY_VAN_TRUOC_TRIEN_KHAI}) q WHERE q.name LIKE $1 ORDER BY id`,
        [`${DAU}-g%`],
      );
      const theoId = new Map(q.map((r) => [Number(r.id), r]));
      for (const id of [rHex, rTab, rNbsp, rMang]) {
        expect(theoId.get(id), `luật #${id} phải có hàng KHONG_PARSE_DUOC`).toMatchObject({ ket_luan: "KHONG_PARSE_DUOC", gia_tri_gui: null, diem_luoi_gan_nhat: null });
      }
      expect(theoId.get(rSpace)).toMatchObject({ ket_luan: "LECH_LUOI" });
      for (const id of js) expect(theoId.has(id), `JS đếm #${id} nhưng SQL bỏ sót`).toBe(true);
    });

    it("luật vừa hỏng cấu trúc (telemetry_tag thiếu machineId) vừa lệch lưới ⇒ đếm MỘT lần; khối log lúc khởi động nêu luật", async () => {
      const d = await getDb();
      await sql`UPDATE device_tags SET scale = 10 WHERE id = ${tg.cu}`;
      const [h] = await sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "targetAdapterId",
          "commandTag", "commandValue", enabled, "approvedBy", "createdBy")
        VALUES (${DAU + "-ghong"}, 'machine', 'telemetry_tag', 'gt', 5, 'reduce_speed', ${adapterId}, 'cu', ${sql.json(25 as never)}, true, ${DUYET}, ${TAC_GIA})
        RETURNING id`;
      expect((await luatLenhLechLuoi(d!, cuaToi())).map((r) => r.id)).toEqual([Number(h.id)]);
      expect(await oversight.fetchInterlockCauHinhHong(d, cuaToi())).toEqual({ count: 1, degraded: false });

      const log: string[] = [];
      const n = await canhBaoLuatLenhLechLuoiKhiKhoiDong({ layDb: async () => d!, logLoi: (m) => log.push(m) });
      expect(n).toBeGreaterThanOrEqual(1); // toàn bảng: có thể có hàng của tệp khác
      expect(log.join("\n")).toContain(`#${Number(h.id)} "${DAU}-ghong" — OFF_STEP`);
    });
  });
});
