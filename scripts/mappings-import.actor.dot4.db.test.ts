/**
 * doc 81 Đợt 4 Task C2 — CLI `scripts/mappings-import.mjs --apply` phải ghi lại AI chạy nó.
 *
 * Luật (ruling C2): `--apply` BẮT BUỘC `--actor <userId|email>`; thiếu hoặc không tra được ⇒ thoát ≠ 0 với câu rõ
 * TRƯỚC mọi lượt ghi DB. Người chạy tra trong `users` (đang hoạt động; email không phân biệt hoa thường, trùng ⇒ từ
 * chối) TRONG CÙNG transaction của import, và được ghi vào audit: dòng `mapping_as_code.import` (audit_logs),
 * `config_snapshots.payload_summary`, và audit gỡ ghim DỪNG (control_audit_log.actorId + audit_logs.userId/userName).
 * Dry-run không đổi.
 *
 * Chạy CHÍNH script (tiến trình con), DATABASE_URL = `_test` (vitest.setup ép; cầu chì `/_test\b/`). Oracle: SELECT thô.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const SCRIPT = path.resolve(__dirname, "mappings-import.mjs");
const RUN = `C2ACT${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "c2act-"));
const EMAIL = `${RUN.toLowerCase()}@actor.test`;
const EMAIL_DUP = `${RUN.toLowerCase()}-dup@actor.test`;

let sql: ReturnType<typeof postgres>;
let adapterId = 0;
let tagId = 0;
let version = 0;
const users: number[] = [];
let uActive = 0;
let uInactive = 0;

function yaml(address = "DB1.DBX9.9"): string {
  version += 1;
  return [
    `version: ${version}`,
    `adapter: "${RUN}"`,
    "tags:",
    "  - name: stop_cmd",
    `    address: "${address}"`,
    "    datatype: bool",
    "    writable: true",
    "    enabled: true",
  ].join("\n") + "\n";
}
function cli(y: string, ...flags: string[]): { code: number | null; out: string } {
  return cliVoiDb(DB_URL!, y, ...flags);
}
function cliVoiDb(dbUrl: string, y: string, ...flags: string[]): { code: number | null; out: string } {
  const f = path.join(TMP, `m${version}.mapping.yaml`);
  fs.writeFileSync(f, y, "utf8");
  const r = spawnSync(process.execPath, [SCRIPT, f, ...flags], {
    env: { ...process.env, DATABASE_URL: dbUrl, SEC_PLATFORM: "" },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const tagRow = async () =>
  (await sql<{ address: string; stop_value: unknown }[]>`SELECT address, stop_value FROM device_tags WHERE id = ${tagId}`)[0];
const snapshot = async () =>
  (await sql<{ payload_summary: any }[]>`SELECT payload_summary FROM config_snapshots WHERE entity_type = 'mapping_file' AND entity_id = ${adapterId}`)[0];
const pinAudits = async () =>
  sql<{ actorId: number | null }[]>`SELECT "actorId" FROM control_audit_log WHERE "entityType" = 'device_tag_stop_pin' AND "entityId" = ${String(tagId)} ORDER BY id`;
const pinAuditLogs = async () =>
  sql<{ userId: number | null; userName: string | null }[]>`
    SELECT "userId", "userName" FROM audit_logs WHERE action = 'deviceTag.setStopPin' AND "entityType" = 'device_tag' AND "entityId" = ${tagId} ORDER BY id`;
const importAuditLogs = async () =>
  sql<{ userId: number | null; userName: string | null; details: string }[]>`
    SELECT "userId", "userName", details FROM audit_logs WHERE action = 'mapping_as_code.import' AND "entityType" = 'device_adapter_mapping' AND "entityId" = ${adapterId} ORDER BY id`;
/** audit_logs là WORM ⇒ đếm mốc ĐẦU mỗi ca (beforeEach), "không ghi gì" = không thêm dòng nào so với mốc. */
let importAuditMoc = 0;
/** Không một dấu vết ghi nào của adapter thử. */
async function expectNothingWritten() {
  expect(await tagRow()).toMatchObject({ address: "DB1.DBX0.0", stop_value: true });
  expect(await snapshot()).toBeUndefined();
  expect(await pinAudits()).toHaveLength(0);
  expect(await importAuditLogs()).toHaveLength(importAuditMoc);
}

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("doc 81 Đợt 4 C2 — mappings-import --apply ghi người chạy (DB _test thật)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    adapterId = Number((await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled")
                                  VALUES (${RUN}, 'C2 actor', 'stub', 'stub://c2', false) RETURNING id`)[0].id);
    const mk = async (suffix: string, email: string, active: boolean) => {
      const id = Number((await sql`INSERT INTO users ("openId", name, email, role, "isActive")
                                   VALUES (${`${RUN}-${suffix}`}, ${`C2 ${suffix}`}, ${email}, 'user', ${active}) RETURNING id`)[0].id);
      users.push(id);
      return id;
    };
    uActive = await mk("active", EMAIL, true);
    uInactive = await mk("inactive", `${RUN.toLowerCase()}-off@actor.test`, false);
    await mk("dup1", EMAIL_DUP, true);
    await mk("dup2", EMAIL_DUP.toUpperCase(), true);
  }, 60_000);

  beforeEach(async () => {
    await sql`DELETE FROM config_snapshots WHERE entity_type = 'mapping_file' AND entity_id = ${adapterId}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`;
    tagId = Number((await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", scale, "offset", stop_value, stop_pinned_by, stop_pinned_at)
                              VALUES (${adapterId}, 'stop_cmd', 'DB1.DBX0.0', 'bool', true, true, 1, 0, 'true'::jsonb, 'sql', now()) RETURNING id`)[0].id);
    importAuditMoc = (await importAuditLogs()).length;
  });

  afterAll(async () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    if (!sql) return;
    await sql`DELETE FROM uns_tag_mappings WHERE "adapterId" = ${adapterId}`;
    await sql`DELETE FROM config_snapshots WHERE entity_type = 'mapping_file' AND entity_id = ${adapterId}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`;
    await sql`DELETE FROM device_adapters WHERE id = ${adapterId}`;
    if (users.length) await sql`DELETE FROM users WHERE id IN ${sql(users)}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★ --apply THIẾU --actor ⇒ thoát ≠ 0, câu nêu --actor, KHÔNG ghi gì", async () => {
    const r = cli(yaml(), "--apply");
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("--actor");
    await expectNothingWritten();
  });

  it("★ --actor không tra được (id lạ / email lạ / tài khoản tắt / email trùng) ⇒ thoát ≠ 0, KHÔNG ghi gì", async () => {
    for (const [actor, hint] of [
      ["999999999", "999999999"],
      [`khong-co-${EMAIL}`, `khong-co-${EMAIL}`],
      [String(uInactive), "inactive"],
      [EMAIL_DUP, "ambiguous"],
    ] as const) {
      const r = cli(yaml(), "--apply", "--actor", actor);
      expect(r.code, r.out).not.toBe(0);
      expect(r.out).toContain("--actor");
      expect(r.out).toContain(hint);
      await expectNothingWritten();
    }
  });

  it("★ thiếu --actor bị chặn TRƯỚC khi mở kết nối DB: DATABASE_URL tới cổng chết vẫn ra đúng câu --actor (không phải lỗi kết nối)", () => {
    const chet = "postgres://khong:co@127.0.0.1:1/khong_co_test";
    const r = cliVoiDb(chet, yaml(), "--apply");
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("--apply cần --actor");
    expect(r.out).not.toMatch(/ECONNREFUSED|connect/i);
  });

  it("--actor= rỗng ⇒ cùng lỗi thiếu, không ghi", async () => {
    const r = cli(yaml(), "--apply", "--actor=");
    expect(r.code, r.out).not.toBe(0);
    await expectNothingWritten();
  });

  it("★ --apply --actor <userId> ⇒ import chạy; người chạy có ở audit import, snapshot và audit gỡ ghim", async () => {
    const r = cli(yaml(), "--apply", "--actor", String(uActive));
    expect(r.code, r.out).toBe(0);
    expect(await tagRow()).toMatchObject({ address: "DB1.DBX9.9", stop_value: null });
    const imp = (await importAuditLogs()).slice(importAuditMoc);
    expect(imp).toHaveLength(1);
    expect(imp[0]).toMatchObject({ userId: uActive, userName: "C2 active" });
    expect(JSON.parse(imp[0].details).metadata).toMatchObject({ via: "cli:mappings-import", fileVersion: version });
    expect((await snapshot()).payload_summary).toMatchObject({ importedBy: "C2 active", importedByUserId: uActive, importedVia: "cli:mappings-import" });
    expect((await pinAudits()).map((a) => a.actorId)).toEqual([uActive]);
    expect(await pinAuditLogs()).toEqual([{ userId: uActive, userName: "C2 active" }]);
  });

  it("--actor <email> (khác hoa thường, dạng --actor=) ⇒ cùng người", async () => {
    const r = cli(yaml(), "--apply", `--actor=${EMAIL.toUpperCase()}`);
    expect(r.code, r.out).toBe(0);
    expect((await importAuditLogs()).at(-1)).toMatchObject({ userId: uActive });
  });

  it("dry-run (không --apply, không --actor) không đổi: thoát 0, không ghi", async () => {
    const r = cli(yaml());
    // ca đầu chứng minh thiếu --actor với --apply; ở đây KHÔNG --apply.
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("[DRY-RUN]");
    await expectNothingWritten();
  });
});
