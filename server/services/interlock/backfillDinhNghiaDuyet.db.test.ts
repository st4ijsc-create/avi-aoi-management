/**
 * kiem-dinh R1b-1 fix round 2 (điều phối 2026-10-25, phương án B — TOFU) — `chayBackfillDinhNghiaDuyet` + CLI `scripts/backfill-approved-def-hash.mjs`.
 *
 * Ca bắt buộc của điều phối (4): luật duyệt trước 0434 rồi backfill ⇒ VẪN đã duyệt; đổi address sau backfill ⇒ chưa duyệt; chạy lại ⇒ 0 hàng;
 * chạy khô không ghi gì; tag vắng ⇒ không đóng dấu + được liệt kê. Thêm: MỘT dòng audit mỗi luật (ai chạy, "TOFU 0434"); hàm bám là CHÍNH hàm của
 * ứng dụng (so với `bamDinhNghiaLuat`); CLI từ chối khi không chỉ đích / `--ghi` thiếu `--actor`; CLI chạy khô trên TEST không ghi.
 *
 * CSDL `_test` THẬT (mig 0434 đã áp TEST). Hàm chạy với `chiRuleIds` (CSDL dùng chung — không đụng luật của tệp khác).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { getDb } from "../../db/connection";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import { bamDinhNghiaLuat, luatDuyetConHieuLuc } from "./dinhNghiaDuyet";
import { AUDIT_TOFU, LY_DO_TOFU, chayBackfillDinhNghiaDuyet } from "./backfillDinhNghiaDuyet";

const DB_URL = process.env.DATABASE_URL;
const RUN = `tofu${process.pid}${Date.now().toString(36)}`;
const SCRIPT = path.resolve(__dirname, "../../../scripts/backfill-approved-def-hash.mjs");

let sql: ReturnType<typeof postgres>;
const ids = { ad: 0, tag: 0, actor: 0 };
const luat: Record<string, number> = {};

const hang = async (id: number) =>
  (await sql`SELECT id, "approvedBy", "approvedDefHash", "sourceType", "machineId", "sourceKey", "targetAdapterId", "commandTag"
    FROM interlock_rules WHERE id = ${id}`)[0] as never;
const hieuLuc = async (id: number) => luatDuyetConHieuLuc((await getDb()) as never, await hang(id));
const chay = async (ghi: boolean) => chayBackfillDinhNghiaDuyet(await getDb(), { ghi, actorId: ids.actor, chiRuleIds: Object.values(luat) });
const soAudit = async (id: number) =>
  Number((await sql`SELECT count(*)::int AS n FROM control_audit_log WHERE "entityType" = 'interlock_rule' AND "entityId" = ${String(id)} AND action = ${AUDIT_TOFU}`)[0].n);

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("kiem-dinh R1b-1 fix round 2 — TOFU backfill approvedDefHash", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    ids.ad = Number((await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled") VALUES (${RUN}, ${RUN}, 'stub', 'stub://tofu', false) RETURNING id`)[0].id);
    ids.actor = (await taoNguoiDungTest("actor", "admin", { tienTo: "tofu", ts: RUN, ten: "TOFU actor" })).id;
  }, 60_000);

  beforeEach(async () => {
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${RUN + "-%"}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${ids.ad}`;
    ids.tag = Number((await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
      VALUES (${ids.ad}, 'van', '40001', 'int', true, true) RETURNING id`)[0].id);
    // luật "duyệt TRƯỚC 0434": approvedBy có, approvedDefHash NULL (gieo thẳng — như hàng có sẵn khi áp 0434)
    const lu = async (ten: string, tag: string, duyet = true) =>
      Number((await sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "targetAdapterId", "commandTag",
          "commandValue", enabled, "approvedBy", "createdBy")
        VALUES (${RUN + "-" + ten}, 'machine', 'ng_rate', 'gt', 5, 'stop_line', ${ids.ad}, ${tag}, '0'::jsonb, true, ${duyet ? 7 : null}, 1) RETURNING id`)[0].id);
    luat.co = await lu("co", "van");
    luat.vang = await lu("vang", "khong_co_tag");
    luat.nhap = await lu("nhap", "van", false);
    luat.nguonVang = Number((await sql`INSERT INTO interlock_rules (name, scope, "machineId", "sourceKey", "sourceType", "comparisonOperator", threshold, action,
        "targetMachineId", enabled, "approvedBy", "createdBy")
      VALUES (${RUN + "-nguon"}, 'machine', 990777001, 'khong_co_nguon', 'telemetry_tag', 'gt', 1, 'stop_line', 990777001, false, 7, 1) RETURNING id`)[0].id);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${RUN + "-%"}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${ids.ad}`;
    await sql`DELETE FROM device_adapters WHERE id = ${ids.ad}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★ luật duyệt trước 0434 (chưa có bám) ⇒ chưa hiệu lực; backfill --ghi ⇒ VẪN ĐÃ DUYỆT (bám = CHÍNH hàm của ứng dụng); MỘT dòng audit 'TOFU 0434' do người chạy", async () => {
    expect(await hieuLuc(luat.co)).toBe(false);
    const kq = await chay(true);
    expect(kq.dongDau.map((h) => h.ruleId)).toEqual([luat.co]);
    expect(kq.daGhi).toBe(1);
    const h = (await hang(luat.co)) as { approvedDefHash: string };
    expect(h.approvedDefHash).toBe(await bamDinhNghiaLuat((await getDb()) as never, (await hang(luat.co)) as never));
    expect(await hieuLuc(luat.co)).toBe(true);
    const [a] = await sql`SELECT "actorId", reason, "afterJson" FROM control_audit_log WHERE "entityType" = 'interlock_rule' AND "entityId" = ${String(luat.co)} AND action = ${AUDIT_TOFU}`;
    expect(a).toMatchObject({ actorId: ids.actor, reason: LY_DO_TOFU });
    expect((a.afterJson as { approvedDefHash: string }).approvedDefHash).toBe(h.approvedDefHash);
    expect(await soAudit(luat.co)).toBe(1);
  });

  it("★ đổi address tag đích SAU backfill ⇒ CHƯA DUYỆT (fail-closed)", async () => {
    await chay(true);
    expect(await hieuLuc(luat.co)).toBe(true);
    await sql`UPDATE device_tags SET address = '40099' WHERE id = ${ids.tag}`;
    expect(await hieuLuc(luat.co)).toBe(false);
  });

  it("★ chạy lại ⇒ 0 hàng (idempotent): không ứng viên mới, không ghi, không thêm dòng audit", async () => {
    await chay(true);
    const lai = await chay(true);
    expect(lai.daGhi).toBe(0);
    expect(lai.dongDau).toEqual([]);
    expect(await soAudit(luat.co)).toBe(1);
  });

  it("★ chạy khô ⇒ KHÔNG ghi gì (bám vẫn NULL, 0 dòng audit) nhưng bảng đã có bám dự kiến", async () => {
    const kho = await chay(false);
    expect(kho.ghi).toBe(false);
    expect(kho.daGhi).toBe(0);
    expect(kho.dongDau.map((h) => [h.ruleId, typeof h.bam])).toEqual([[luat.co, "string"]]);
    expect(((await hang(luat.co)) as { approvedDefHash: string | null }).approvedDefHash).toBeNull();
    expect(await soAudit(luat.co)).toBe(0);
  });

  it("★ tag đích vắng / tag nguồn vắng ⇒ KHÔNG đóng dấu, liệt kê riêng có lý do; luật chưa duyệt không phải ứng viên", async () => {
    const kq = await chay(true);
    expect(kq.khongDongDau.map((h) => [h.ruleId, h.boQua]).sort()).toEqual(
      [
        [luat.vang, "tag_dich_vang"],
        [luat.nguonVang, "tag_nguon_vang"],
      ].sort(),
    );
    expect(((await hang(luat.vang)) as { approvedDefHash: string | null }).approvedDefHash).toBeNull();
    expect(await hieuLuc(luat.vang)).toBe(false);
    expect(await soAudit(luat.vang)).toBe(0);
    expect(kq.ungVien).toBe(3); // nhap (chưa duyệt) không phải ứng viên
  });

  it("CLI: không chỉ đích ⇒ thoát 2; --ghi thiếu --actor ⇒ thoát 2; --test-only chạy khô ⇒ thoát 0, in bảng + số đếm, KHÔNG ghi", () => {
    const cli = (...a: string[]) =>
      spawnSync(process.execPath, ["--import", "tsx", SCRIPT, ...a], { env: { ...process.env, DATABASE_URL: DB_URL }, encoding: "utf8", timeout: 120_000 });
    expect(cli().status).toBe(2);
    expect(cli("--test-only", "--dev-only").status).toBe(2);
    expect(cli("--test-only", "--ghi").status).toBe(2);
    const kho = cli("--test-only");
    expect(kho.status, `${kho.stdout}\n${kho.stderr}`).toBe(0);
    expect(kho.stdout).toContain("[CHẠY KHÔ]");
    expect(kho.stdout).toMatch(/"daGhi":0/);
  }, 240_000);

  it("CLI chạy khô không đổi hàng của tệp này (bám vẫn NULL)", async () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, "--test-only"], { env: { ...process.env, DATABASE_URL: DB_URL }, encoding: "utf8", timeout: 120_000 });
    expect(r.status).toBe(0);
    expect(((await hang(luat.co)) as { approvedDefHash: string | null }).approvedDefHash).toBeNull();
  }, 240_000);
});
