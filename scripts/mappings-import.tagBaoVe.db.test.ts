/**
 * kiem-dinh R1b-1 I2 (điều phối 2026-10-25) — CLI `scripts/mappings-import.mjs` ghi SQL thẳng vào device_tags, né cổng T9 (TOTP + kiểm lại).
 * Mặc định TỪ CHỐI lô đụng tag ĐƯỢC BẢO VỆ (cùng định nghĩa `troLaiKenh.ts`); chỉ đi tiếp với `--cho-phep-tag-bao-ve` (ngoại lệ host + DB).
 *
 *   1. TƯƠNG ĐƯƠNG: `tagBaoVeCuaAdapterTx` (SQL của CLI) == công thức TS của máy chủ (`tagDaKhaiKenh` + `duocBaoVe` trên `khoaLuatNhamCapTx` /
 *      `khoaLuatNguonTx` / `kenhCheDoCuaTagTx`) — tập "được bảo vệ" và tập "khoá mồ côi" trên cùng dữ liệu (đã khai, kênh chế độ, đích luật bật,
 *      đích luật đã duyệt mà tắt, đích luật alert, nguồn telemetry đã duyệt, tag trơn, khoá chỉ luật trỏ tới).
 *   2. CLI THẬT (tiến trình con, DATABASE_URL = `_test`): sửa address tag bảo vệ ⇒ thoát 1, không ghi; dry-run nhãn [BẢO VỆ]; cờ ⇒ ghi + metadata audit;
 *      tag trơn / chỉ đổi unit ⇒ ghi như cũ; prune tag bảo vệ / tạo lên khoá mồ côi ⇒ từ chối.
 *   3. Nhờ I1 (a): luật đã duyệt nhắm tag bị CLI đổi (có cờ) TỰ MẤT hiệu lực duyệt.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { getDb } from "../server/db/connection";
import { deviceTags } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { duocBaoVe, kenhCheDoCuaTagTx, khoaLuatNguonTx, khoaLuatNhamCapTx, tagDaKhaiKenh } from "../server/services/scada/troLaiKenh";
import { luatDuyetConHieuLuc } from "../server/services/interlock/dinhNghiaDuyet";
import { taoNguoiDungTest } from "../server/testing/nguoiDungTest";
import { dongDauDuyetLuat } from "../server/testing/dauDuyetInterlock";
// @ts-expect-error — mô-đun .mjs của CLI (không có khai báo kiểu)
import { tagBaoVeCuaAdapterTx, thaoTacChamBaoVe } from "./lib/tagBaoVeCli.mjs";

const DB_URL = process.env.DATABASE_URL;
const SCRIPT = path.resolve(__dirname, "mappings-import.mjs");
const RUN = `i2cli${process.pid}${Date.now().toString(36)}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "i2cli-"));

let sql: ReturnType<typeof postgres>;
const ids = { may: 0, ad: 0, actor: 0 };
const luat: Record<string, number> = {};
let version = 0;

const KHOA = ["k_khai", "k_che_do", "k_dich_bat", "k_dich_duyet", "k_dich_alert", "k_nguon", "k_tron"] as const;

function yaml(tags: Array<{ name: string; address: string; datatype?: string; unit?: string }>): string {
  version += 1;
  const lines = [`version: ${version}`, `adapter: "${RUN}"`, "tags:"];
  for (const t of tags) {
    lines.push(`  - name: ${t.name}`, `    address: "${t.address}"`, `    datatype: ${t.datatype ?? "int"}`, `    writable: true`, `    enabled: true`);
    if (t.unit) lines.push(`    unit: "${t.unit}"`);
  }
  return lines.join("\n") + "\n";
}
function cli(y: string, ...flags: string[]): { code: number | null; out: string } {
  const f = path.join(TMP, `m${version}.mapping.yaml`);
  fs.writeFileSync(f, y, "utf8");
  const r = spawnSync(process.execPath, [SCRIPT, f, ...flags], {
    env: { ...process.env, DATABASE_URL: DB_URL, SEC_PLATFORM: "" },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const apply = (y: string, ...flags: string[]) => cli(y, "--apply", "--actor", String(ids.actor), ...flags);
const addr = async (k: string) => (await sql`SELECT address FROM device_tags WHERE "adapterId" = ${ids.ad} AND "tagKey" = ${k}`)[0]?.address as string | undefined;
/** Tất cả tag hiện có trong file (không prune) — thay `address` của tag chỉ định. */
const fileVoi = async (doi: Record<string, Partial<{ address: string; unit: string }>>) => {
  const rows = await sql`SELECT "tagKey", address, "dataType" FROM device_tags WHERE "adapterId" = ${ids.ad} ORDER BY "tagKey"`;
  return yaml(rows.map((r) => ({ name: String(r.tagKey), address: doi[String(r.tagKey)]?.address ?? String(r.address), datatype: String(r.dataType), unit: doi[String(r.tagKey)]?.unit })));
};

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("kiem-dinh R1b-1 I2 — CLI mappings-import từ chối tag được bảo vệ", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 2, onnotice: () => {} });
    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${RUN}, ${RUN}) RETURNING id`;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${RUN}, ${RUN}, 'AOI', true) RETURNING id`;
    ids.may = Number(m.id);
    ids.ad = Number((await sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "isEnabled")
      VALUES (${ids.may}, ${RUN}, ${RUN}, 'stub', ${"stub://" + RUN}, false) RETURNING id`)[0].id);
    ids.actor = (await taoNguoiDungTest("actor", "engineer", { tienTo: "i2cli", ts: RUN, ten: "I2 CLI actor" })).id;
  }, 60_000);

  beforeEach(async () => {
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${RUN + "-%"}`;
    await sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${ids.may}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${ids.ad}`;
    await sql`DELETE FROM config_snapshots WHERE entity_type = 'mapping_file' AND entity_id = ${ids.ad}`;
    for (const k of KHOA) {
      await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", actuation_level)
        VALUES (${ids.ad}, ${k}, ${"A-" + k}, 'int', true, true, ${k === "k_khai" ? 3 : null})`;
    }
    await sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by) VALUES (${ids.may}, ${ids.ad}, 'k_che_do', '1'::jsonb, 1)`;
    const lu = async (ten: string, o: { tag: string; action: string; enabled: boolean; duyet: boolean; nguon?: boolean }) =>
      Number(
        (o.nguon
          ? await sql`INSERT INTO interlock_rules (name, scope, "machineId", "sourceKey", "sourceType", "comparisonOperator", threshold, action, "targetMachineId", enabled, "approvedBy", "createdBy")
              VALUES (${RUN + "-" + ten}, 'machine', ${ids.may}, ${o.tag}, 'telemetry_tag', 'gt', 1, ${o.action}, ${ids.may}, ${o.enabled}, ${o.duyet ? 1 : null}, 1) RETURNING id`
          : await sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "targetAdapterId", "commandTag", "commandValue", enabled, "approvedBy", "createdBy")
              VALUES (${RUN + "-" + ten}, 'machine', 'ng_rate', 'gt', 1, ${o.action}, ${ids.ad}, ${o.tag}, '0'::jsonb, ${o.enabled}, ${o.duyet ? 1 : null}, 1) RETURNING id`)[0].id,
      );
    luat.dichBat = await lu("dich-bat", { tag: "k_dich_bat", action: "reduce_speed", enabled: true, duyet: false });
    luat.dichDuyet = await lu("dich-duyet", { tag: "k_dich_duyet", action: "stop_line", enabled: false, duyet: true });
    luat.dichAlert = await lu("dich-alert", { tag: "k_dich_alert", action: "alert", enabled: true, duyet: true });
    luat.nguon = await lu("nguon", { tag: "k_nguon", action: "stop_line", enabled: false, duyet: true, nguon: true });
    luat.moCoi = await lu("mo-coi", { tag: "k_mo_coi", action: "alert", enabled: false, duyet: false });
  });

  afterAll(async () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    if (!sql) return;
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${RUN + "-%"}`;
    await sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${ids.may}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${ids.ad}`;
    await sql`DELETE FROM config_snapshots WHERE entity_type = 'mapping_file' AND entity_id = ${ids.ad}`;
    await sql`DELETE FROM uns_tag_mappings WHERE "adapterId" = ${ids.ad}`;
    await sql`DELETE FROM device_adapters WHERE id = ${ids.ad}`;
    await sql`DELETE FROM machines WHERE code = ${RUN}`;
    await sql`DELETE FROM stations WHERE code = ${RUN}`;
    await sql`DELETE FROM production_lines WHERE code = ${RUN}`;
    await sql`DELETE FROM workshops WHERE code = ${RUN}`;
    await sql`DELETE FROM factories WHERE code = ${RUN}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★ TƯƠNG ĐƯƠNG: tập 'được bảo vệ' + 'khoá mồ côi' của SQL CLI == công thức TS của máy chủ (troLaiKenh) trên cùng dữ liệu", async () => {
    const db = (await getDb())!;
    const mongBaoVe: string[] = [];
    const mongMoCoi: string[] = [];
    for (const k of [...KHOA, "k_mo_coi"]) {
      await db.transaction(async (tx) => {
        const e = { adapterId: ids.ad, tagKey: k };
        const lDich = await khoaLuatNhamCapTx(tx, e);
        const lNguon = await khoaLuatNguonTx(tx, ids.may, k);
        const kenh = await kenhCheDoCuaTagTx(tx, e);
        const [t] = await tx.select().from(deviceTags).where(and(eq(deviceTags.adapterId, ids.ad), eq(deviceTags.tagKey, k)));
        if (t && duocBaoVe(tagDaKhaiKenh(t, kenh.length > 0), lDich, lNguon)) mongBaoVe.push(k);
        if (kenh.length > 0 || lDich.length > 0 || lNguon.length > 0) mongMoCoi.push(k);
      });
    }
    const { baoVe, moCoi } = await tagBaoVeCuaAdapterTx(sql, ids.ad);
    expect([...baoVe.keys()].sort()).toEqual(mongBaoVe.sort());
    expect([...moCoi.keys()].sort()).toEqual(mongMoCoi.sort());
    // oracle tay: đúng các khoá chờ đợi (không chỉ "hai bản bằng nhau")
    expect(mongBaoVe.sort()).toEqual(["k_che_do", "k_dich_bat", "k_dich_duyet", "k_khai", "k_nguon"]);
    expect(mongMoCoi.sort()).toEqual(["k_che_do", "k_dich_alert", "k_dich_bat", "k_dich_duyet", "k_mo_coi", "k_nguon"]);
  });

  it("thaoTacChamBaoVe: chỉ cột trỏ lại / bật-tắt tính; unit / deadband / samplingMs không", () => {
    const tap = { baoVe: new Map([["p", ["da_khai_kenh"]]]), moCoi: new Map([["m", ["luat_dich_1"]]]) };
    expect(thaoTacChamBaoVe({ creates: ["m", "x"], updates: [{ tagKey: "p", fields: ["unit", "deadband", "samplingMs"] }], deletes: [] }, tap)).toEqual([
      { tagKey: "m", viec: "tao", lyDo: ["luat_dich_1"] },
    ]);
    expect(thaoTacChamBaoVe({ creates: [], updates: [{ tagKey: "p", fields: ["scale"] }], deletes: ["p", "y"] }, tap)).toEqual([
      { tagKey: "p", viec: "sua", lyDo: ["da_khai_kenh"] },
      { tagKey: "p", viec: "xoa", lyDo: ["da_khai_kenh"] },
    ]);
  });

  it("★ sửa address tag ĐƯỢC BẢO VỆ không cờ ⇒ thoát 1, KHÔNG ghi gì (cả tag trơn cùng lô); dry-run in [BẢO VỆ]", async () => {
    const y = await fileVoi({ k_dich_duyet: { address: "MOI-1" }, k_tron: { address: "MOI-TRON" } });
    const kho = cli(y);
    expect(kho.code).toBe(0);
    expect(kho.out).toContain("[BẢO VỆ] sửa  k_dich_duyet");
    expect(kho.out).toContain("--apply sẽ bị TỪ CHỐI");
    const r = apply(y);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("tag ĐƯỢC BẢO VỆ");
    expect(await addr("k_dich_duyet")).toBe("A-k_dich_duyet");
    expect(await addr("k_tron")).toBe("A-k_tron");
  });

  it("★ mỗi loại bảo vệ đều chặn (đã khai, kênh chế độ, đích luật bật, nguồn telemetry đã duyệt); tag trơn và tag alert-chỉ ⇒ ghi như cũ; chỉ đổi unit trên tag bảo vệ ⇒ ghi", async () => {
    for (const k of ["k_khai", "k_che_do", "k_dich_bat", "k_nguon"]) {
      const r = apply(await fileVoi({ [k]: { address: `MOI-${k}` } }));
      expect(r.code, `${k}: ${r.out}`).toBe(1);
      expect(await addr(k)).toBe(`A-${k}`);
    }
    const ok = apply(await fileVoi({ k_tron: { address: "MOI-TRON" }, k_dich_alert: { address: "MOI-ALERT" }, k_khai: { unit: "bar" } }));
    expect(ok.code, ok.out).toBe(0);
    expect(await addr("k_tron")).toBe("MOI-TRON");
    expect(await addr("k_dich_alert")).toBe("MOI-ALERT");
    expect((await sql`SELECT unit FROM device_tags WHERE "adapterId" = ${ids.ad} AND "tagKey" = 'k_khai'`)[0].unit).toBe("bar");
  });

  it("★ --prune xoá tag bảo vệ / tạo tag lên khoá mồ côi ⇒ từ chối, không ghi", async () => {
    const conLai = (await sql`SELECT "tagKey", address FROM device_tags WHERE "adapterId" = ${ids.ad} AND "tagKey" <> 'k_khai' ORDER BY "tagKey"`).map((r) => ({
      name: String(r.tagKey),
      address: String(r.address),
    }));
    const xoa = apply(yaml(conLai), "--prune");
    expect(xoa.code, xoa.out).toBe(1);
    expect(xoa.out).toContain("[BẢO VỆ] xoá  k_khai");
    expect(await addr("k_khai")).toBe("A-k_khai");
    const tao = apply(yaml([...conLai, { name: "k_khai", address: "A-k_khai" }, { name: "k_mo_coi", address: "MOI" }]));
    expect(tao.code, tao.out).toBe(1);
    expect(tao.out).toContain("[BẢO VỆ] tạo lên khoá được tham chiếu  k_mo_coi");
    expect(await addr("k_mo_coi")).toBeUndefined();
  });

  it("★ --cho-phep-tag-bao-ve (ngoại lệ host + DB) ⇒ ghi, metadata audit ghi lại; luật ĐÃ DUYỆT nhắm tag đó TỰ MẤT hiệu lực duyệt (I1 a)", async () => {
    await dongDauDuyetLuat(luat.dichDuyet);
    const db = (await getDb())!;
    const hang = async () => (await sql`SELECT id, "approvedBy", "approvedDefHash", "sourceType", "machineId", "sourceKey", "targetAdapterId", "commandTag"
      FROM interlock_rules WHERE id = ${luat.dichDuyet}`)[0];
    expect(await luatDuyetConHieuLuc(db as never, (await hang()) as never)).toBe(true);
    const r = apply(await fileVoi({ k_dich_duyet: { address: "MOI-DUYET" } }), "--cho-phep-tag-bao-ve");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("--cho-phep-tag-bao-ve");
    expect(await addr("k_dich_duyet")).toBe("MOI-DUYET");
    const [a] = await sql`SELECT details FROM audit_logs WHERE action = 'mapping_as_code.import' AND "entityId" = ${ids.ad} ORDER BY id DESC LIMIT 1`;
    const meta = JSON.parse(String(a.details)).metadata;
    expect(meta.choPhepTagBaoVe).toBe(true);
    expect(meta.tagBaoVeBiDung).toEqual([{ tagKey: "k_dich_duyet", viec: "sua", lyDo: [`luat_dich_${luat.dichDuyet}`] }]);
    expect(await luatDuyetConHieuLuc(db as never, (await hang()) as never)).toBe(false);
  });
});
