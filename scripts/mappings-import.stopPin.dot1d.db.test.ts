/**
 * doc 81 Đợt 1D Task 1 fix round 2 (re-review IMPORTANT 1) — CLI `scripts/mappings-import.mjs` (importer
 * SQL thô, contracts/mappings/README.md) phải theo CÙNG luật ghim DỪNG như router và importMapping.
 *
 * Chạy CHÍNH script (tiến trình con `--apply`, DATABASE_URL = `_test` do vitest.setup ép — cầu chì
 * `/_test\b/`), YAML ghi ra thư mục tạm. Oracle: SELECT thô trên hàng tag + control_audit_log/audit_logs.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const SCRIPT = path.resolve(__dirname, "mappings-import.mjs");
const RUN = `D1CLI${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "d1cli-"));

let sql: ReturnType<typeof postgres>;
let adapterId = 0;
let tagId = 0;
let otherId = 0;
let version = 0;
// doc 81 Đợt 4 Task C2 — --apply bắt buộc --actor: một người chạy thử (users, _test).
let actorId = 0;

type TagFile = { address?: string; datatype?: string; writable?: boolean; enabled?: boolean; unit?: string };
function yaml(stop: TagFile | null): string {
  version += 1;
  const s = { address: "DB1.DBX0.0", datatype: "bool", writable: true, enabled: true, ...(stop ?? {}) };
  const lines = [`version: ${version}`, `adapter: "${RUN}"`, "tags:"];
  if (stop !== null) {
    lines.push(`  - name: stop_cmd`, `    address: "${s.address}"`, `    datatype: ${s.datatype}`, `    writable: ${s.writable}`, `    enabled: ${s.enabled}`);
    if (s.unit) lines.push(`    unit: "${s.unit}"`);
  }
  lines.push(`  - name: other`, `    address: "DB1.DBX0.1"`, `    datatype: bool`, `    writable: true`, `    enabled: true`);
  return lines.join("\n") + "\n";
}
function cli(y: string, ...flags: string[]): { code: number | null; out: string } {
  const f = path.join(TMP, `m${version}.mapping.yaml`);
  fs.writeFileSync(f, y, "utf8");
  const r = spawnSync(process.execPath, [SCRIPT, f, "--apply", "--actor", String(actorId), ...flags], {
    env: { ...process.env, DATABASE_URL: DB_URL, SEC_PLATFORM: "" },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const row = async (id: number) =>
  (await sql<{ stop_value: unknown; address: string; isEnabled: boolean }[]>`SELECT stop_value, address, "isEnabled" FROM device_tags WHERE id = ${id}`)[0];
const audits = async (id: number) =>
  sql<{ action: string; actorId: number | null; beforeJson: any; afterJson: any; reason: string }[]>`
    SELECT action, "actorId", "beforeJson", "afterJson", reason FROM control_audit_log
     WHERE "entityType" = 'device_tag_stop_pin' AND "entityId" = ${String(id)} ORDER BY id`;
const auditLogs = async (id: number) =>
  sql<{ userName: string | null; details: string }[]>`
    SELECT "userName", details FROM audit_logs WHERE action = 'deviceTag.setStopPin' AND "entityType" = 'device_tag' AND "entityId" = ${id} ORDER BY id`;

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("doc 81 Đợt 1D fix 2 — CLI mappings-import theo luật ghim DỪNG (DB _test thật)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    adapterId = Number((await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled")
                                  VALUES (${RUN}, 'D1 cli', 'stub', 'stub://cli', false) RETURNING id`)[0].id);
    actorId = Number((await sql`INSERT INTO users ("openId", name, role, "isActive")
                                VALUES (${`${RUN}-actor`}, 'D1 cli actor', 'user', true) RETURNING id`)[0].id);
  }, 60_000);

  beforeEach(async () => {
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`;
    tagId = Number((await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", scale, "offset", stop_value, stop_pinned_by, stop_pinned_at)
                              VALUES (${adapterId}, 'stop_cmd', 'DB1.DBX0.0', 'bool', true, true, 1, 0, 'true'::jsonb, 'sql', now()) RETURNING id`)[0].id);
    otherId = Number((await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", scale, "offset")
                                VALUES (${adapterId}, 'other', 'DB1.DBX0.1', 'bool', true, true, 1, 0) RETURNING id`)[0].id);
  });

  afterAll(async () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    if (!sql) return;
    await sql`DELETE FROM uns_tag_mappings WHERE "adapterId" = ${adapterId}`;
    await sql`DELETE FROM config_snapshots WHERE entity_type = 'mapping_file' AND entity_id = ${adapterId}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`;
    await sql`DELETE FROM device_adapters WHERE id = ${adapterId}`;
    if (actorId) await sql`DELETE FROM users WHERE id = ${actorId}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★ CLI đổi ADDRESS của tag đang ghim ⇒ ghim bị gỡ + MỘT dòng control_audit_log (hình ghiAuditGoStopPinTx) + audit_logs mang NGƯỜI CHẠY (--actor, Đợt 4 C2)", async () => {
    const r = cli(yaml({ address: "DB1.DBX9.9" }));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('[STOP-PIN] gỡ ghim DỪNG của tag "stop_cmd" (tag_redefined)');
    expect(await row(tagId)).toMatchObject({ address: "DB1.DBX9.9", stop_value: null });
    const a = await audits(tagId);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ action: "stop_pin_clear", actorId });
    expect(a[0].beforeJson).toEqual({ tagKey: "stop_cmd", adapterId, dataType: "bool", stopValue: true });
    expect(a[0].afterJson).toEqual({ tagKey: "stop_cmd", adapterId, dataType: "bool", stopValue: null, commissioningRecheckRequired: false, autoClearedBy: "tag_redefined" });
    expect(a[0].reason).toContain("mapping_import_cli");
    const l = await auditLogs(tagId);
    expect(l).toHaveLength(1);
    expect(l[0].userName).toBe("D1 cli actor");
    expect(JSON.parse(l[0].details).after.autoClearedBy).toBe("tag_redefined");
  });

  it("★ CLI --prune xoá tag đang ghim ⇒ audit tag_deleted (reason có prune); tag không ghim bị xoá thì không audit", async () => {
    const f = yaml(null);
    const r = cli(f, "--prune");
    expect(r.code, r.out).toBe(0);
    const [con] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM device_tags WHERE id = ${tagId}`;
    expect(con.n).toBe(0);
    const a = await audits(tagId);
    expect(a).toHaveLength(1);
    expect(a[0].afterJson.autoClearedBy).toBe("tag_deleted");
    expect(a[0].reason).toContain("prune");
    expect(await audits(otherId)).toHaveLength(0);
  });

  it("CLI TẮT rồi BẬT LẠI ⇒ ghim gỡ ở lượt tắt, VẪN null sau lượt bật (một audit)", async () => {
    expect(cli(yaml({ enabled: false })).code).toBe(0);
    expect(await row(tagId)).toMatchObject({ isEnabled: false, stop_value: null });
    expect(cli(yaml({ enabled: true })).code).toBe(0);
    expect(await row(tagId)).toMatchObject({ isEnabled: true, stop_value: null });
    const a = await audits(tagId);
    expect(a.map((x) => x.afterJson.autoClearedBy)).toEqual(["tag_disabled"]);
  });

  it("CLI chỉ đổi unit ⇒ GIỮ ghim, không audit", async () => {
    const r = cli(yaml({ unit: "-" }));
    expect(r.code, r.out).toBe(0);
    expect((await row(tagId)).stop_value).toBe(true);
    expect(await audits(tagId)).toHaveLength(0);
  });
});
