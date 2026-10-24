/**
 * SCADA R1b-1 Task 9 (kiem-dinh, điều phối duyệt 2026-10-24) — "trỏ lại kênh không cần TOTP": `deviceAdapter.tags.update` và
 * `mappingAsCode.applyImport` đổi được `address` / `scale` / `offset` / `dataType` / `writable` / `tagKey` (+ `adapterId` của tags.update)
 * trên một tag ĐÃ KHAI (actuationLevel | channelKind | dải khác NULL, hoặc là kênh chế độ của một máy) ⇒ phải có TOTP TƯƠI (mức 5,
 * `kiemTotpCauHinh` — cùng mã lỗi / khoá i18n với `scadaKenh.capNhat`) VÀ kiểm lại nhất quán sau khi đổi (dải ↔ ghim DỪNG, dải ↔
 * commandValue của luật interlock, loại kênh ↔ writable). Tag chưa khai: như cũ. Import: MỘT mã cho cả lô, trần 200 tag đã khai, hỏng
 * một tag ⇒ cả lô bị từ chối (nêu tên tag hỏng đầu tiên).
 *
 * CSDL `_test` THẬT; người dùng qua `taoNguoiDungTest` (admin + 2FA thật: speakeasy + setup2FA/enable2FA); TOTP qua `kiemXacThucTheoMuc`
 * THẬT (bộ đếm T16 + sổ mã đã dùng thật). Oracle: SELECT thô.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import speakeasy from "speakeasy";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { setup2FA, enable2FA } from "../db/auth";
import { deviceAdapterRouter } from "./deviceAdapterRouter";
import { mappingAsCodeRouter } from "./mappingAsCodeRouter";

const DB_URL = process.env.DATABASE_URL;
const RUN = `r1bt9tl${process.pid}${Date.now().toString(36)}`;

let sql: ReturnType<typeof postgres>;
let uid = 0;
let secret = "";
let caller!: ReturnType<typeof deviceAdapterRouter.createCaller>;
let mac!: ReturnType<typeof mappingAsCodeRouter.createCaller>;
const ids = { fac: 0, may: 0, ad: 0, ad2: 0, adCap: 0 };
const tg: Record<string, number> = {};
let version = 0;

/** Mã TOTP MỚI (xoay secret ⇒ khác mọi mã đã tiêu; mã dùng một lần). */
async function maMoi(): Promise<string> {
  secret = speakeasy.generateSecret({ length: 20 }).base32;
  await setup2FA(uid, secret);
  await enable2FA(uid);
  return speakeasy.totp({ secret, encoding: "base32" });
}

async function loiCua(p: Promise<unknown>): Promise<{ code?: string; appCode?: string; appParams?: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: x.code, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

async function seedTag(adapterId: number, tagKey: string, cot: Record<string, unknown> = {}): Promise<number> {
  const c = { dataType: "int", writable: true, write_min: null, write_max: null, write_step: null, channel_kind: null, actuation_level: null, stop: null, ...cot };
  const [r] = await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", write_min, write_max, write_step,
      channel_kind, actuation_level, stop_value)
    VALUES (${adapterId}, ${tagKey}, ${"addr-" + tagKey}, ${c.dataType as string}, ${c.writable as boolean}, true, ${c.write_min as number | null},
      ${c.write_max as number | null}, ${c.write_step as number | null}, ${c.channel_kind as string | null}, ${c.actuation_level as number | null},
      ${c.stop === null ? null : sql.json(c.stop as never)})
    RETURNING id`;
  return Number(r.id);
}

const hang = async (id: number) =>
  (await sql`SELECT "tagKey" AS "tagKey", address, "dataType" AS "dataType", scale::float8 AS scale, "offset"::float8 AS "offset", writable,
      unit, stop_value AS "stopValue" FROM device_tags WHERE id = ${id}`)[0];

function yamlCua(adapterCode: string, tags: Array<{ name: string; datatype?: string; scale?: number; writable?: boolean; address?: string }>): string {
  version += 1;
  const lines = [`version: ${version}`, `adapter: "${adapterCode}"`, "tags:"];
  for (const t of tags) {
    lines.push(`  - name: ${t.name}`, `    address: "${t.address ?? "addr-" + t.name}"`, `    datatype: ${t.datatype ?? "int"}`);
    if (t.scale !== undefined) lines.push(`    scale: ${t.scale}`);
    lines.push(`    writable: ${t.writable ?? true}`, `    enabled: true`);
  }
  return lines.join("\n") + "\n";
}

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("R1b-1 T9 — trỏ lại kênh ĐÃ KHAI cần TOTP tươi + kiểm lại nhất quán", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${RUN}, ${RUN}) RETURNING id`;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${RUN}, ${RUN}, 'AOI', true) RETURNING id`;
    ids.fac = Number(f.id);
    ids.may = Number(m.id);
    const ad = async (code: string, machineId: number | null) =>
      Number((await sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "isEnabled")
        VALUES (${machineId}, ${code}, ${code}, 'stub', ${"stub://" + code}, false) RETURNING id`)[0].id);
    ids.ad = await ad(`${RUN}-a`, ids.may);
    ids.ad2 = await ad(`${RUN}-b`, ids.may);
    ids.adCap = await ad(`${RUN}-cap`, null);

    const u = await taoNguoiDungTest("ad", "admin", { tienTo: "r1bt9tl", ts: RUN, ten: "R1bT9 tro lai" });
    uid = u.id;
    caller = deviceAdapterRouter.createCaller({ user: { id: u.id, role: "admin", name: u.name, twoFactorEnabled: true } } as never);
    mac = mappingAsCodeRouter.createCaller({ user: { id: u.id, role: "admin", name: u.name, twoFactorEnabled: true } } as never);
  }, 60_000);

  beforeEach(async () => {
    await sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${ids.may}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" IN (${ids.ad}, ${ids.ad2}, ${ids.adCap})`;
    await sql`DELETE FROM totp_khoa_sai WHERE user_id = ${uid}`;
    await sql`UPDATE device_adapters SET "machineId" = ${ids.may}, endpoint = ${"stub://" + RUN + "-a"} WHERE id = ${ids.ad}`;
    tg.dk = await seedTag(ids.ad, "dk", { write_min: 0, write_max: 100 }); // khai dải
    tg.dkpin = await seedTag(ids.ad, "dkpin", { write_min: 0, write_max: 100, stop: 3 }); // khai dải + ghim DỪNG 3
    tg.cu = await seedTag(ids.ad, "cu"); // CHƯA khai
    tg.lv = await seedTag(ids.ad, "lv", { dataType: "float", actuation_level: 3 }); // chỉ khai mức
    tg.out = await seedTag(ids.ad, "out", { channel_kind: "output" }); // khai loại kênh ghi
    tg.mode = await seedTag(ids.ad, "mode", { writable: false }); // kênh chế độ (không khai cột kênh nào)
    await sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by)
      VALUES (${ids.may}, ${ids.ad}, 'mode', '1'::jsonb, ${uid})`;
    await maMoi();
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${ids.may}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" IN (${ids.ad}, ${ids.ad2}, ${ids.adCap})`;
    await sql`DELETE FROM config_snapshots WHERE entity_type = 'mapping_file' AND entity_id IN (${ids.ad}, ${ids.ad2}, ${ids.adCap})`;
    await sql`DELETE FROM device_adapters WHERE id IN (${ids.ad}, ${ids.ad2}, ${ids.adCap})`;
    await sql`DELETE FROM machines WHERE code = ${RUN}`;
    await sql`DELETE FROM stations WHERE code = ${RUN}`;
    await sql`DELETE FROM production_lines WHERE code = ${RUN}`;
    await sql`DELETE FROM workshops WHERE code = ${RUN}`;
    await sql`DELETE FROM factories WHERE code = ${RUN}`;
    await sql`DELETE FROM totp_khoa_sai WHERE user_id = ${uid}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  describe("tags.update", () => {
    it("★ tag ĐÃ KHAI (dải) đổi scale KHÔNG có mã ⇒ TOTP_CAN (SCADA_CONFIG_TOTP_REQUIRED), hàng giữ nguyên", async () => {
      const e = await loiCua(caller.tags.update({ id: tg.dk, scale: 2 }));
      expect(e).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_REQUIRED", appParams: { ma: "TOTP_CAN" } });
      expect((await hang(tg.dk)).scale).toBe(1);
    });

    it("★ có mã nhưng scale mới làm giá trị DỪNG ghim lệch lưới thô ⇒ STOP_PIN_NGOAI_DAI (mã KHÔNG bị tiêu — kiểm TOTP đứng cuối)", async () => {
      const m = await maMoi();
      const e = await loiCua(caller.tags.update({ id: tg.dkpin, scale: 2, totpCode: m }));
      expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "STOP_PIN_NGOAI_DAI" });
      expect(e.appParams).toMatchObject({ ma: "STOP_PIN_NGOAI_DAI", lyDo: "OFF_STEP", tagKey: "dkpin", stopValue: "3" });
      expect(await hang(tg.dkpin)).toMatchObject({ scale: 1, stopValue: 3 });
      // CÙNG mã vẫn dùng được cho một lượt hợp lệ ⇒ lượt bị từ chối ở trên không tiêu mã
      const ok = await caller.tags.update({ id: tg.dk, scale: 2, totpCode: m });
      expect(Number((ok as { scale: unknown }).scale)).toBe(2);
    });

    it("có mã đúng + nhất quán ⇒ ghi, kèm một dòng audit `kenh_da_khai_tro_lai` (before/after cột trỏ lại)", async () => {
      await caller.tags.update({ id: tg.dk, scale: 2, address: "addr-dk-moi", totpCode: speakeasy.totp({ secret, encoding: "base32" }) });
      expect(await hang(tg.dk)).toMatchObject({ scale: 2, address: "addr-dk-moi" });
      const au = await sql`SELECT action, "actorId", "beforeJson" AS b, "afterJson" AS a FROM control_audit_log
        WHERE "entityType" = 'device_tag' AND "entityId" = ${String(tg.dk)} AND action = 'kenh_da_khai_tro_lai'`;
      expect(au).toHaveLength(1);
      expect(au[0].actorId).toBe(uid);
      expect(au[0].b).toMatchObject({ address: "addr-dk" });
      expect(au[0].a).toMatchObject({ address: "addr-dk-moi", doi: expect.arrayContaining(["address", "scale"]) });
    });

    it("★ tag CHƯA khai ⇒ như cũ: đổi scale / address / dataType / writable không cần mã", async () => {
      await caller.tags.update({ id: tg.cu, scale: 5, address: "addr-cu-2", dataType: "float", writable: false });
      expect(await hang(tg.cu)).toMatchObject({ scale: 5, address: "addr-cu-2", dataType: "float", writable: false });
    });

    it("★ tag đã khai, sửa trường KHÔNG trỏ lại (unit) ⇒ không cần mã; form gửi lại nguyên các giá trị cũ (scale 1 / offset trống) cũng không", async () => {
      await caller.tags.update({ id: tg.dk, unit: "bar" });
      await caller.tags.update({ id: tg.dk, tagKey: "dk", address: "addr-dk", dataType: "int", unit: "kPa", scale: 1, offset: null, writable: true, isEnabled: true });
      expect(await hang(tg.dk)).toMatchObject({ unit: "kPa", scale: 1, address: "addr-dk" });
    });

    it("tag chỉ khai MỨC tác động (actuationLevel) cũng là đã khai ⇒ đổi address cần mã", async () => {
      expect(await loiCua(caller.tags.update({ id: tg.lv, address: "x" }))).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
    });

    it("loại kênh GHI (output) ↔ writable: tắt writable ⇒ từ chối scadaKenhGhiTrenTagKhongGhi (trước kiểm mã)", async () => {
      const e = await loiCua(caller.tags.update({ id: tg.out, writable: false }));
      expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INVALID_VALUE", appParams: { field: "writable", reason: "scadaKenhGhiTrenTagKhongGhi" } });
      expect((await hang(tg.out)).writable).toBe(true);
    });

    it("dải ↔ dataType: tag khai dải đổi sang kiểu không phải số ⇒ từ chối scadaDaiChiChoKenhSo", async () => {
      const e = await loiCua(caller.tags.update({ id: tg.dk, dataType: "bool" }));
      expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INVALID_VALUE", appParams: { field: "dataType", reason: "scadaDaiChiChoKenhSo" } });
    });

    it("★ kênh chế độ: đổi tagKey không mã ⇒ TOTP_CAN (kênh chế độ nguyên); có mã ⇒ scada_kenh_che_do đổi theo trong CÙNG giao dịch + audit", async () => {
      expect(await loiCua(caller.tags.update({ id: tg.mode, tagKey: "mode_moi" }))).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
      expect((await sql`SELECT tag_key FROM scada_kenh_che_do WHERE machine_id = ${ids.may}`)[0].tag_key).toBe("mode");
      await caller.tags.update({ id: tg.mode, tagKey: "mode_moi", totpCode: await maMoi() });
      expect((await hang(tg.mode)).tagKey).toBe("mode_moi");
      expect((await sql`SELECT adapter_id, tag_key FROM scada_kenh_che_do WHERE machine_id = ${ids.may}`)[0]).toEqual({ adapter_id: ids.ad, tag_key: "mode_moi" });
      const au = await sql`SELECT "beforeJson" AS b, "afterJson" AS a FROM control_audit_log
        WHERE "entityType" = 'scada_kenh_che_do' AND "entityId" = ${String(ids.may)} AND action = 'scada_kenh_che_do_doi_tag'`;
      expect(au).toHaveLength(1);
      expect(au[0]).toMatchObject({ b: { tagKey: "mode" }, a: { tagKey: "mode_moi" } });
    });

    it("kênh chế độ: chuyển tag sang adapter khác ⇒ từ chối scadaKenhCheDoKhongDoiAdapter (kể cả có mã)", async () => {
      const e = await loiCua(caller.tags.update({ id: tg.mode, adapterId: ids.ad2, totpCode: await maMoi() }));
      expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INVALID_VALUE", appParams: { field: "adapterId", reason: "scadaKenhCheDoKhongDoiAdapter" } });
      expect((await hang(tg.mode)).tagKey).toBe("mode");
    });
  });

  describe("mappingAsCode.applyImport", () => {
    const code = () => `${RUN}-a`;

    it("★ hai tag ĐÃ KHAI đổi scale: không mã ⇒ TOTP_CAN, KHÔNG ghi gì; MỘT mã ⇒ cả hai được ghi", async () => {
      const y = yamlCua(code(), [
        { name: "dk", scale: 2 },
        { name: "out", scale: 4 },
        { name: "cu", scale: 3 },
      ]);
      const e = await loiCua(mac.applyImport({ yaml: y }));
      expect(e).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_REQUIRED", appParams: { ma: "TOTP_CAN" } });
      expect([(await hang(tg.dk)).scale, (await hang(tg.out)).scale, (await hang(tg.cu)).scale]).toEqual([1, 1, 1]);
      const kq = await mac.applyImport({ yaml: y, totpCode: await maMoi() });
      expect(kq.applied?.tagUpdates).toBe(3);
      expect([(await hang(tg.dk)).scale, (await hang(tg.out)).scale, (await hang(tg.cu)).scale]).toEqual([2, 4, 3]);
    });

    it("★ một tag trong lô hỏng nhất quán (ghim DỪNG lệch lưới) ⇒ CẢ lô bị từ chối, nêu tên tag hỏng; tag khác KHÔNG đổi", async () => {
      const y = yamlCua(code(), [
        { name: "dk", scale: 2 },
        { name: "dkpin", scale: 2 },
      ]);
      const e = await loiCua(mac.applyImport({ yaml: y, totpCode: await maMoi() }));
      expect(e).toMatchObject({ appCode: "STOP_PIN_NGOAI_DAI", appParams: { tagKey: "dkpin", lyDo: "OFF_STEP" } });
      expect((await hang(tg.dk)).scale).toBe(1);
      expect((await hang(tg.dkpin)).scale).toBe(1);
    });

    it("lô CHỈ đụng tag chưa khai ⇒ như cũ, không cần mã", async () => {
      const kq = await mac.applyImport({ yaml: yamlCua(code(), [{ name: "cu", scale: 7, address: "addr-cu-x" }]) });
      expect(kq.applied?.tagUpdates).toBe(1);
      expect(await hang(tg.cu)).toMatchObject({ scale: 7, address: "addr-cu-x" });
    });

    it("trần: > 200 tag đã khai bị trỏ lại trong một lô ⇒ QUA_NHIEU_KENH_DA_KHAI {soTag, toiDa}, không ghi gì", async () => {
      await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", actuation_level)
        SELECT ${ids.adCap}, 'k' || g, 'addr-k' || g, 'int', true, true, 3 FROM generate_series(1, 201) g`;
      const tags = Array.from({ length: 201 }, (_, i) => ({ name: `k${i + 1}`, scale: 2 }));
      const e = await loiCua(mac.applyImport({ yaml: yamlCua(`${RUN}-cap`, tags), totpCode: await maMoi() }));
      expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "QUA_NHIEU_KENH_DA_KHAI", appParams: { soTag: 201, toiDa: 200 } });
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM device_tags WHERE "adapterId" = ${ids.adCap} AND scale <> 1`;
      expect(n).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Fix round 1 (review T9: C1 / I1 / I3 / I5 / I6 / M5 + phán quyết a / b) — mọi đường ghi device_tags, đổi đích adapter, ô mã.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  describe("fix round 1", () => {
    const maHienTai = () => speakeasy.totp({ secret, encoding: "base32" });
    const maSai = () => String((Number(maHienTai()) + 500_000) % 1_000_000).padStart(6, "0");
    /** YAML liệt kê MỌI tag hiện có (giá trị như seed) trừ `bo`, kèm `them` — để prune chỉ xoá đúng `bo`. */
    const yamlDayDu = (bo: string[], them: Array<{ name: string; datatype?: string; scale?: number; writable?: boolean; address?: string }> = []) =>
      yamlCua(`${RUN}-a`, [
        ...[
          { name: "dk" },
          { name: "dkpin" },
          { name: "cu" },
          { name: "lv", datatype: "float" },
          { name: "out" },
          { name: "mode", writable: false },
        ].filter((t) => !bo.includes(t.name)),
        ...them,
      ]);

    it("M5: mã SAI ⇒ SCADA_CONFIG_TOTP_INVALID; mã ĐÃ DÙNG lần hai ⇒ SCADA_CONFIG_TOTP_INVALID; hàng chỉ đổi đúng một lần", async () => {
      expect(await loiCua(caller.tags.update({ id: tg.dk, scale: 2, totpCode: maSai() }))).toMatchObject({
        code: "PRECONDITION_FAILED",
        appCode: "SCADA_CONFIG_TOTP_INVALID",
      });
      expect((await hang(tg.dk)).scale).toBe(1);
      const m = maHienTai();
      await caller.tags.update({ id: tg.dk, scale: 2, totpCode: m });
      expect(await loiCua(caller.tags.update({ id: tg.dk, scale: 3, totpCode: m }))).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_INVALID" });
      expect((await hang(tg.dk)).scale).toBe(2);
    });

    it("★ I1: scale 1 → 0 trên tag đã khai là MỘT thay đổi (đường đọc nhân 0) ⇒ TOTP_CAN; tag chưa khai ⇒ qua như cũ", async () => {
      expect(await loiCua(caller.tags.update({ id: tg.dk, scale: 0 }))).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
      expect((await hang(tg.dk)).scale).toBe(1);
      await caller.tags.update({ id: tg.cu, scale: 0 });
      expect((await hang(tg.cu)).scale).toBe(0);
    });

    it("M5: chuyển tag ĐÃ KHAI (không phải kênh chế độ) sang adapter khác ⇒ TOTP_CAN; có mã ⇒ chuyển + audit", async () => {
      expect(await loiCua(caller.tags.update({ id: tg.dk, adapterId: ids.ad2 }))).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
      await caller.tags.update({ id: tg.dk, adapterId: ids.ad2, totpCode: await maMoi() });
      expect((await sql`SELECT "adapterId" AS a FROM device_tags WHERE id = ${tg.dk}`)[0].a).toBe(ids.ad2);
    });

    it("★ phán quyết b: tag đã khai ĐANG GHIM, đổi address (ghim vẫn hợp lệ) ⇒ STOP_PIN_GO_TRUOC kể cả có mã; ghim + address giữ nguyên", async () => {
      const e = await loiCua(caller.tags.update({ id: tg.dkpin, address: "addr-khac", totpCode: await maMoi() }));
      expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "STOP_PIN_GO_TRUOC", appParams: { ma: "STOP_PIN_GO_TRUOC", tagKey: "dkpin", stopValue: "3" } });
      expect(await hang(tg.dkpin)).toMatchObject({ address: "addr-dkpin", stopValue: 3 });
    });

    it("phán quyết b: tắt tag đã khai đang ghim ⇒ STOP_PIN_GO_TRUOC; tắt tag đã khai KHÔNG ghim ⇒ qua, không cần mã", async () => {
      expect(await loiCua(caller.tags.update({ id: tg.dkpin, isEnabled: false }))).toMatchObject({ appCode: "STOP_PIN_GO_TRUOC" });
      await caller.tags.update({ id: tg.dk, isEnabled: false });
      expect((await sql`SELECT "isEnabled" AS b FROM device_tags WHERE id = ${tg.dk}`)[0].b).toBe(false);
    });

    it("phán quyết b: CHỈ đổi tên tag đã khai đang ghim ⇒ được (có mã), ghim giữ nguyên", async () => {
      await caller.tags.update({ id: tg.dkpin, tagKey: "dkpin2", totpCode: await maMoi() });
      expect(await hang(tg.dkpin)).toMatchObject({ tagKey: "dkpin2", stopValue: 3 });
    });

    it("phán quyết b (import): file đổi address của tag đã khai đang ghim ⇒ STOP_PIN_GO_TRUOC, cả lô không ghi", async () => {
      const e = await loiCua(mac.applyImport({ yaml: yamlCua(`${RUN}-a`, [{ name: "dk", scale: 2 }, { name: "dkpin", address: "x-1" }]), totpCode: await maMoi() }));
      expect(e).toMatchObject({ appCode: "STOP_PIN_GO_TRUOC", appParams: { tagKey: "dkpin" } });
      expect((await hang(tg.dk)).scale).toBe(1);
    });

    it("★ C1 xoá: kênh chế độ ⇒ scadaKenhCheDoGoTruoc; đã khai đang ghim ⇒ STOP_PIN_GO_TRUOC; đã khai: không mã ⇒ TOTP_CAN, có mã ⇒ xoá + audit; chưa khai ⇒ như cũ", async () => {
      expect(await loiCua(caller.tags.delete({ id: tg.mode, totpCode: await maMoi() }))).toMatchObject({
        appCode: "INVALID_VALUE",
        appParams: { field: "tagKey", reason: "scadaKenhCheDoGoTruoc" },
      });
      expect(await loiCua(caller.tags.delete({ id: tg.dkpin }))).toMatchObject({ appCode: "STOP_PIN_GO_TRUOC" });
      expect(await loiCua(caller.tags.delete({ id: tg.dk }))).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
      expect((await sql`SELECT id FROM device_tags WHERE id IN (${tg.mode}, ${tg.dkpin}, ${tg.dk})`).length).toBe(3);
      await caller.tags.delete({ id: tg.dk, totpCode: await maMoi() });
      expect((await sql`SELECT id FROM device_tags WHERE id = ${tg.dk}`).length).toBe(0);
      const au = await sql`SELECT "beforeJson" AS b FROM control_audit_log WHERE "entityType" = 'device_tag' AND "entityId" = ${String(tg.dk)} AND action = 'kenh_da_khai_xoa'`;
      expect(au).toHaveLength(1);
      expect(au[0].b).toMatchObject({ tagKey: "dk", writeMin: 0, writeMax: 100 });
      await caller.tags.delete({ id: tg.cu });
      expect((await sql`SELECT id FROM device_tags WHERE id = ${tg.cu}`).length).toBe(0);
    });

    it("★ C1 prune: lô prune xoá kênh chế độ ⇒ scadaKenhCheDoGoTruoc; prune xoá tag đã khai: không mã ⇒ TOTP_CAN, có mã ⇒ xoá", async () => {
      expect(await loiCua(mac.applyImport({ yaml: yamlDayDu(["mode"]), prune: true, totpCode: await maMoi() }))).toMatchObject({
        appParams: { reason: "scadaKenhCheDoGoTruoc" },
      });
      expect((await sql`SELECT id FROM device_tags WHERE id = ${tg.mode}`).length).toBe(1);
      expect(await loiCua(mac.applyImport({ yaml: yamlDayDu(["dk"]), prune: true }))).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
      expect((await sql`SELECT id FROM device_tags WHERE id = ${tg.dk}`).length).toBe(1);
      const kq = await mac.applyImport({ yaml: yamlDayDu(["dk"]), prune: true, totpCode: await maMoi() });
      expect(kq.applied?.tagDeletes).toBe(1);
      expect((await sql`SELECT id FROM device_tags WHERE id = ${tg.dk}`).length).toBe(0);
    });

    it("★ C1 tạo lên khoá MỒ CÔI (kênh chế độ còn trỏ tới khoá đã mất tag): không mã ⇒ TOTP_CAN, không chèn; có mã ⇒ chèn + audit", async () => {
      await sql`DELETE FROM device_tags WHERE id = ${tg.mode}`; // kênh chế độ của máy giờ trỏ vào (ad, 'mode') không có tag
      const tao = (totpCode?: string) =>
        caller.tags.create({ adapterId: ids.ad, tagKey: "mode", address: "dia-chi-khac", dataType: "int", ...(totpCode ? { totpCode } : {}) });
      expect(await loiCua(tao())).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
      expect((await sql`SELECT id FROM device_tags WHERE "adapterId" = ${ids.ad} AND "tagKey" = 'mode'`).length).toBe(0);
      const row = await tao(await maMoi());
      const au = await sql`SELECT action FROM control_audit_log WHERE "entityType" = 'device_tag' AND "entityId" = ${String(row.id)} AND action = 'kenh_tao_tren_khoa_mo_coi'`;
      expect(au).toHaveLength(1);
    });

    it("C1 tạo lên khoá mà một luật interlock (dù TẮT) trỏ tới ⇒ TOTP_CAN; khoá thường ⇒ như cũ", async () => {
      await sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "targetAdapterId", "commandTag", "commandValue", enabled, "createdBy")
        VALUES (${RUN + "-ghost"}, 'machine', 'ng_rate', 'gt', 5, 'stop_line', ${ids.ad}, 'ghost', '1'::jsonb, false, ${uid})`;
      try {
        expect(await loiCua(caller.tags.create({ adapterId: ids.ad, tagKey: "ghost", address: "g", dataType: "int" }))).toMatchObject({
          appCode: "SCADA_CONFIG_TOTP_REQUIRED",
        });
        await caller.tags.create({ adapterId: ids.ad, tagKey: "thuong", address: "t", dataType: "int" });
      } finally {
        await sql`DELETE FROM interlock_rules WHERE name = ${RUN + "-ghost"}`;
      }
    });

    it("★ I3 đổi tên VÀO khoá mồ côi của kênh chế độ ⇒ TOTP_CAN (tag chưa khai thành kênh chế độ); có mã ⇒ được", async () => {
      await sql`DELETE FROM device_tags WHERE id = ${tg.mode}`;
      expect(await loiCua(caller.tags.update({ id: tg.cu, tagKey: "mode" }))).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
      expect((await hang(tg.cu)).tagKey).toBe("cu");
      await caller.tags.update({ id: tg.cu, tagKey: "mode", totpCode: await maMoi() });
      expect((await hang(tg.cu)).tagKey).toBe("mode");
    });

    it("M3: đổi tên trùng một tag khác ⇒ ENTITY_DUPLICATE TRƯỚC kiểm mã (mã không bị tiêu)", async () => {
      const m = await maMoi();
      expect(await loiCua(caller.tags.update({ id: tg.dk, tagKey: "cu", totpCode: m }))).toMatchObject({ code: "CONFLICT", appCode: "ENTITY_DUPLICATE" });
      await caller.tags.update({ id: tg.dk, scale: 2, totpCode: m }); // cùng mã vẫn dùng được
    });

    it("★ I6 import TẠO lên khoá mồ côi của kênh chế độ ⇒ TOTP_CAN, không chèn", async () => {
      await sql`DELETE FROM device_tags WHERE id = ${tg.mode}`;
      expect(await loiCua(mac.applyImport({ yaml: yamlCua(`${RUN}-a`, [{ name: "mode", writable: false }]) }))).toMatchObject({
        appCode: "SCADA_CONFIG_TOTP_REQUIRED",
      });
      expect((await sql`SELECT id FROM device_tags WHERE "adapterId" = ${ids.ad} AND "tagKey" = 'mode'`).length).toBe(0);
    });

    it("★ I5 deviceAdapter.update: đổi endpoint adapter có tag được bảo vệ ⇒ TOTP_CAN; có mã ⇒ đổi + audit; adapter không có tag bảo vệ ⇒ như cũ", async () => {
      expect(await loiCua(caller.update({ id: ids.ad, endpoint: "stub://khac" }))).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
      expect((await sql`SELECT endpoint FROM device_adapters WHERE id = ${ids.ad}`)[0].endpoint).toBe(`stub://${RUN}-a`);
      await caller.update({ id: ids.ad, endpoint: "stub://khac", totpCode: await maMoi() });
      expect((await sql`SELECT endpoint FROM device_adapters WHERE id = ${ids.ad}`)[0].endpoint).toBe("stub://khac");
      const au = await sql`SELECT "beforeJson" AS b FROM control_audit_log WHERE "entityType" = 'device_adapter' AND "entityId" = ${String(ids.ad)} AND action = 'adapter_bao_ve_doi_dich'`;
      expect(au.length).toBeGreaterThanOrEqual(1);
      await caller.update({ id: ids.adCap, endpoint: "stub://cap-khac" }); // không tag ⇒ không mã
      await sql`UPDATE device_adapters SET endpoint = ${"stub://" + RUN + "-a"} WHERE id = ${ids.ad}`;
    });

    it("I5 deviceAdapter.update: đổi máy khi adapter còn kênh chế độ ⇒ scadaKenhCheDoDoiMay (kể cả có mã); sửa tên ⇒ không mã", async () => {
      const e = await loiCua(caller.update({ id: ids.ad, machineId: null, totpCode: await maMoi() }));
      expect(e).toMatchObject({ appCode: "INVALID_VALUE", appParams: { field: "machineId", reason: "scadaKenhCheDoDoiMay" } });
      await caller.update({ id: ids.ad, name: "ten-moi" });
    });
  });
});
