/**
 * doc 81 Đợt 1D Task 1 fix round 1 (review Critical 1) — đường GHI device_tags THỨ HAI: import
 * mapping-as-code (`importMapping`, mappingAsCodeRouter.applyImport) phải theo CÙNG luật ghim DỪNG như
 * `deviceAdapter.tags.*`: đổi nghĩa (address/dataType/scale/offset), thôi writable, tắt, prune ⇒ gỡ ghim
 * trong CÙNG transaction + audit; một lượt import sau BẬT LẠI tag KHÔNG hồi sinh ghim; import không đổi
 * nghĩa (vd chỉ unit) ⇒ GIỮ ghim.
 *
 * DB `_test` THẬT (mig 0362). Oracle độc lập: ghim dựng bằng SQL thô, trạng thái/audit đọc bằng SELECT thô.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import { importMapping } from "./mappingAsCode";

const DB_URL = process.env.DATABASE_URL;
const RUN = `D1MAC${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const ACTOR = 990_100_777;

let sql: ReturnType<typeof postgres>;
let adapterId = 0;
let tagId = 0;
let otherId = 0;
let version = 0;

type TagFile = { address?: string; datatype?: string; writable?: boolean; enabled?: boolean; unit?: string | null; scale?: number };
function yaml(stop: TagFile | null, other = true): string {
  version += 1;
  const s = { address: "DB1.DBX0.0", datatype: "bool", writable: true, enabled: true, unit: null, scale: 1, ...(stop ?? {}) };
  const lines = [`version: ${version}`, `adapter: "${RUN}"`, "tags:"];
  if (stop !== null) {
    lines.push(
      `  - name: stop_cmd`,
      `    address: "${s.address}"`,
      `    datatype: ${s.datatype}`,
      `    writable: ${s.writable}`,
      `    enabled: ${s.enabled}`,
      `    scale: ${s.scale}`,
      ...(s.unit ? [`    unit: "${s.unit}"`] : []),
    );
  }
  if (other) lines.push(`  - name: other`, `    address: "DB1.DBX0.1"`, `    datatype: bool`, `    writable: true`, `    enabled: true`);
  if (stop === null && !other) lines[lines.length - 1] = "tags: []";
  return lines.join("\n") + "\n";
}
const apply = (y: string, prune = false) => importMapping(y, { dryRun: false, prune, actorId: ACTOR, actorName: "d1-import", source: "system" });
const row = async (id: number) =>
  (await sql<{ stop_value: unknown; address: string; writable: boolean; isEnabled: boolean }[]>`
    SELECT stop_value, address, writable, "isEnabled" FROM device_tags WHERE id = ${id}`)[0];
const audits = async (id: number) =>
  sql<{ action: string; actorId: number | null; beforeJson: any; afterJson: any; reason: string }[]>`
    SELECT action, "actorId", "beforeJson", "afterJson", reason FROM control_audit_log
     WHERE "entityType" = 'device_tag_stop_pin' AND "entityId" = ${String(id)} ORDER BY id`;
// sql.json(...) — tham số `${chuoi}::jsonb` bị postgres-js JSON.stringify thành CHUỖI "true" (đo được).
const pinSql = (id: number, v: boolean | number) =>
  sql`UPDATE device_tags SET stop_value = ${sql.json(v)}, stop_pinned_by = 'sql', stop_pinned_at = now() WHERE id = ${id}`;

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("doc 81 Đợt 1D Task 1 fix 1 — importMapping theo luật ghim DỪNG (DB _test thật)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    adapterId = Number((await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled")
                                  VALUES (${RUN}, 'D1 mac', 'stub', 'stub://mac', false) RETURNING id`)[0].id);
  }, 60_000);

  // Mỗi ca: bộ tag gốc (stop_cmd ĐÃ GHIM true + other không ghim), không phụ thuộc thứ tự.
  beforeEach(async () => {
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`;
    tagId = Number((await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", scale, "offset")
                              VALUES (${adapterId}, 'stop_cmd', 'DB1.DBX0.0', 'bool', true, true, 1, 0) RETURNING id`)[0].id);
    otherId = Number((await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", scale, "offset")
                                VALUES (${adapterId}, 'other', 'DB1.DBX0.1', 'bool', true, true, 1, 0) RETURNING id`)[0].id);
    await pinSql(tagId, true);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM uns_tag_mappings WHERE "adapterId" = ${adapterId}`;
    await sql`DELETE FROM config_snapshots WHERE "entityType" = 'mapping_file' AND "entityId" = ${adapterId}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`;
    await sql`DELETE FROM device_adapters WHERE id = ${adapterId}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★ import đổi ADDRESS của tag đang ghim ⇒ ghim bị gỡ + audit (tag_redefined, actor = người import)", async () => {
    const r = await apply(yaml({ address: "DB1.DBX9.9" }));
    expect(r.applied?.tagUpdates).toBe(1);
    expect(await row(tagId)).toMatchObject({ address: "DB1.DBX9.9", stop_value: null });
    const a = await audits(tagId);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ action: "stop_pin_clear", actorId: ACTOR });
    expect(a[0].beforeJson.stopValue).toBe(true);
    expect(a[0].afterJson).toMatchObject({ stopValue: null, autoClearedBy: "tag_redefined" });
    expect(a[0].reason).toContain("mappingAsCode.import");
  });

  it("★ import TẮT rồi import BẬT LẠI ⇒ ghim bị gỡ ở lượt tắt và VẪN null sau lượt bật (không hồi sinh)", async () => {
    await apply(yaml({ enabled: false }));
    expect(await row(tagId)).toMatchObject({ isEnabled: false, stop_value: null });
    expect((await audits(tagId))[0].afterJson.autoClearedBy).toBe("tag_disabled");
    await apply(yaml({ enabled: true }));
    expect(await row(tagId)).toMatchObject({ isEnabled: true, stop_value: null });
    expect(await audits(tagId)).toHaveLength(1);
  });

  it("import thôi WRITABLE ⇒ gỡ (tag_not_writable); import đổi DATATYPE / SCALE ⇒ gỡ (tag_redefined)", async () => {
    await apply(yaml({ writable: false }));
    expect((await row(tagId)).stop_value).toBeNull();
    expect((await audits(tagId))[0].afterJson.autoClearedBy).toBe("tag_not_writable");

    await pinSql(tagId, true);
    await sql`UPDATE device_tags SET writable = true WHERE id = ${tagId}`;
    await apply(yaml({ datatype: "int" }));
    expect((await row(tagId)).stop_value).toBeNull();
    let a = await audits(tagId);
    expect(a[a.length - 1].afterJson.autoClearedBy).toBe("tag_redefined");

    await pinSql(tagId, 1);
    await apply(yaml({ datatype: "int", scale: 2 }));
    expect((await row(tagId)).stop_value).toBeNull();
    a = await audits(tagId);
    expect(a).toHaveLength(3);
  });

  it("★ import PRUNE xoá tag đang ghim ⇒ audit gỡ (tag_deleted); tag không ghim bị xoá thì không audit", async () => {
    const r = await apply(yaml(null, false), true);
    expect(r.applied?.tagDeletes).toBe(2);
    const [con] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM device_tags WHERE id = ANY(${[tagId, otherId]})`;
    expect(con.n).toBe(0);
    const a = await audits(tagId);
    expect(a).toHaveLength(1);
    expect(a[0].afterJson.autoClearedBy).toBe("tag_deleted");
    expect(a[0].reason).toContain("prune");
    expect(await audits(otherId)).toHaveLength(0);
  });

  it("import KHÔNG đổi nghĩa (chỉ thêm unit) ⇒ GIỮ ghim, không audit", async () => {
    const r = await apply(yaml({ unit: "-" }));
    expect(r.applied?.tagUpdates).toBe(1);
    expect((await row(tagId)).stop_value).toBe(true);
    expect(await audits(tagId)).toHaveLength(0);
  });
});
