/**
 * doc 81 Đợt 5 H6 (mục 10) — dữ liệu của e2e "lệnh DỪNG OT bị từ chối hiện câu ĐÃ DỊCH" trên `aoi_management_test` CHỈ.
 *
 * Gieo (một tiền tố lượt chạy `h6e2e_<id>`, dọn sạch ở teardown, kể cả hàng sót của lượt hỏng trước):
 *   nhà máy → xưởng → chuyền → trạm → MÁY AUTOMATION; adapter OT giao thức `stub` (driver TRONG TIẾN TRÌNH, không mạng)
 *   + MỘT tag ghi được, KHÔNG ghim dừng; bản ghi commissioning `active` (đường ghi thật); hai admin (người chạy ≠ người
 *   duyệt — QĐ-4a); workflow `active` = [gate g1 → lệnh `stop` lên tag đó].
 * Lệnh `stop` KHÔNG ghim ⇒ không được miễn preflight an toàn ⇒ không có safety PLC thật (SAFETY_PLC_ADAPTER_ENABLED tắt)
 * ⇒ dispatcher TỪ CHỐI, mang appError OPERATION_FAILED{reason: softwareStopRefusedUseHardwareEstop, stopPinReason}.
 * Không có nút DỪNG mới nào: lệnh đi qua bề mặt CÓ SẴN (Orchestration Studio → Run → Approve).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(REPO, "package.json"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const postgres = require("postgres") as typeof import("postgres");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bcrypt = require("bcryptjs") as { hash: (s: string, n: number) => Promise<string> };

export const TEST_DB = "aoi_management_test";
export const PREFIX = "h6e2e_";

/** URL của `_test`: H6_TEST_DATABASE_URL, hoặc chuỗi DATABASE_URL của .env (CHỈ đọc chuỗi) đổi tên DB. Khác ⇒ từ chối. */
export function testDatabaseUrl(): string {
  let u: URL;
  if (process.env.H6_TEST_DATABASE_URL) u = new URL(process.env.H6_TEST_DATABASE_URL);
  else {
    const env = fs.readFileSync(path.join(REPO, ".env"), "utf8");
    const m = /^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m.exec(env);
    if (!m) throw new Error("no DATABASE_URL in .env and no H6_TEST_DATABASE_URL");
    u = new URL(m[1]);
    u.pathname = "/" + TEST_DB;
  }
  if (u.pathname !== "/" + TEST_DB) throw new Error(`refusing: H6 runs on ${TEST_DB} only, got ${u.pathname}`);
  return u.toString();
}

async function withTestDb<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const sql = postgres(testDatabaseUrl(), { max: 1, connect_timeout: 15, onnotice: () => {} });
  try {
    const [{ db }] = await sql`SELECT current_database() AS db`;
    if (db !== TEST_DB) throw new Error(`refusing: current_database()=${db}`);
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export interface H6Fixture {
  run: string;
  factoryId: number; workshopId: number; lineId: number; stationId: number; machineId: number;
  adapterId: number; tagId: number; commissioningId: number;
  owner: { id: number; username: string; password: string };
  approver: { id: number; username: string; password: string };
  workflowId: number; workflowRef: string;
  tagKey: string;
}

/** Hàng của mọi lượt (tiền tố) — dùng cho dọn và đếm. Thứ tự xoá: con → cha. */
export async function teardownFixtures(): Promise<Record<string, number>> {
  return withTestDb(async (sql) => {
    const like = `${PREFIX}%`;
    const out: Record<string, number> = {};
    const wf = (await sql`SELECT id FROM orchestration_workflows WHERE ref LIKE ${like}`).map((r) => Number(r.id));
    const runs = wf.length ? (await sql`SELECT id FROM orchestration_runs WHERE "workflowId" IN ${sql(wf)}`).map((r) => Number(r.id)) : [];
    const users = (await sql`SELECT id FROM users WHERE "openId" LIKE ${like}`).map((r) => Number(r.id));
    const adapters = (await sql`SELECT id FROM device_adapters WHERE code LIKE ${like}`).map((r) => Number(r.id));
    const machines = (await sql`SELECT id FROM machines WHERE code LIKE ${like}`).map((r) => Number(r.id));
    if (runs.length) {
      // the engine's authorisation rows of these runs (id `foe-run<runId>-<step>-a<n>`, foeStepClass.orchestrationActionId)
      let pa = 0;
      for (const r of runs) pa += (await sql`DELETE FROM ai_pending_actions WHERE id LIKE ${`foe-run${r}-%`}`).count;
      out.ai_pending_actions = pa;
      out.engineering_assignments = (await sql`UPDATE engineering_assignments SET active = false WHERE entity_type = 'orchestration_run' AND entity_id IN ${sql(runs)} AND active`.catch(() => ({ count: 0 }))).count;
      out.orchestration_run_events = (await sql`DELETE FROM orchestration_run_events WHERE "runId" IN ${sql(runs)}`.catch(() => ({ count: 0 }))).count;
      out.orchestration_run_steps = (await sql`DELETE FROM orchestration_run_steps WHERE "runId" IN ${sql(runs)}`).count;
      out.orchestration_runs = (await sql`DELETE FROM orchestration_runs WHERE id IN ${sql(runs)}`).count;
    }
    if (wf.length) {
      out.orchestration_workflow_versions = (await sql`DELETE FROM orchestration_workflow_versions WHERE "workflowId" IN ${sql(wf)}`.catch(() => ({ count: 0 }))).count;
      out.orchestration_workflows = (await sql`DELETE FROM orchestration_workflows WHERE id IN ${sql(wf)}`).count;
    }
    if (adapters.length) {
      out.commissioning_records = (await sql`DELETE FROM commissioning_records WHERE "adapterId" IN ${sql(adapters)}`).count;
      out.device_tags = (await sql`DELETE FROM device_tags WHERE "adapterId" IN ${sql(adapters)}`).count;
      out.device_adapters = (await sql`DELETE FROM device_adapters WHERE id IN ${sql(adapters)}`).count;
    }
    if (machines.length) {
      // command_log is the dispatcher's APPEND-ONLY ledger (mig 0279: REVOKE UPDATE, DELETE) — the refused stop's row
      // STAYS, by design; it is counted here, never deleted (no FK to machines).
      out.command_log_retained_worm = Number((await sql`SELECT count(*)::int AS n FROM command_log WHERE "machineId" IN ${sql(machines)}`)[0].n);
      // the stub adapter's polled telemetry for THIS lượt's machine (otManager → ot_telemetry)
      // (hypertable: bound by time so only the recent, uncompressed chunk is touched)
      out.ot_telemetry = (await sql`DELETE FROM ot_telemetry WHERE "machineId" IN ${sql(machines)} AND ts > now() - interval '1 day'`).count;
      out.machines = (await sql`DELETE FROM machines WHERE id IN ${sql(machines)}`).count;
    }
    out.stations = (await sql`DELETE FROM stations WHERE code LIKE ${like}`).count;
    out.production_lines = (await sql`DELETE FROM production_lines WHERE code LIKE ${like}`).count;
    out.workshops = (await sql`DELETE FROM workshops WHERE code LIKE ${like}`).count;
    out.factories = (await sql`DELETE FROM factories WHERE code LIKE ${like}`).count;
    if (users.length) {
      await sql`DELETE FROM user_sessions WHERE "userId" IN ${sql(users)}`.catch(() => undefined);
      await sql`DELETE FROM permissions WHERE "userId" IN ${sql(users)}`;
      await sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(users)}`;
      await sql`DELETE FROM user_secrets WHERE "userId" IN ${sql(users)}`;
      out.notifications = (await sql`DELETE FROM notifications WHERE "userId" IN ${sql(users)}`.catch(() => ({ count: 0 }))).count;
      try {
        out.users = (await sql`DELETE FROM users WHERE id IN ${sql(users)}`).count;
      } catch {
        out.usersDeactivated = (await sql`UPDATE users SET "isActive" = false WHERE id IN ${sql(users)}`).count;
      }
    }
    return out;
  });
}

/** Số hàng mang tiền tố còn lại (phải = 0 trước setup và sau teardown). */
export async function countFixtures(): Promise<Record<string, number>> {
  return withTestDb(async (sql) => {
    const like = `${PREFIX}%`;
    const [r] = await sql`SELECT
      (SELECT count(*)::int FROM factories WHERE code LIKE ${like}) AS factories,
      (SELECT count(*)::int FROM machines WHERE code LIKE ${like}) AS machines,
      (SELECT count(*)::int FROM device_adapters WHERE code LIKE ${like}) AS adapters,
      (SELECT count(*)::int FROM orchestration_workflows WHERE ref LIKE ${like}) AS workflows,
      (SELECT count(*)::int FROM orchestration_runs r JOIN orchestration_workflows w ON w.id = r."workflowId" WHERE w.ref LIKE ${like}) AS runs,
      (SELECT count(*)::int FROM users WHERE "openId" LIKE ${like}) AS users`;
    return r as unknown as Record<string, number>;
  });
}

export async function setupFixtures(): Promise<H6Fixture> {
  const run = `${PREFIX}${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
  const mkPw = () => "H6!" + crypto.randomBytes(10).toString("hex");
  const ownerPw = mkPw();
  const approverPw = mkPw();
  const [ownerHash, approverHash] = await Promise.all([bcrypt.hash(ownerPw, 10), bcrypt.hash(approverPw, 10)]);
  const tagKey = "h6_run";
  return withTestDb((sql) =>
    sql.begin(async (tx) => {
      const one = async (q: Promise<unknown>) => Number(((await q) as Array<{ id: number }>)[0].id);
      const factoryId = await one(tx`INSERT INTO factories (code, name) VALUES (${run}, ${`${run} factory`}) RETURNING id`);
      const workshopId = await one(tx`INSERT INTO workshops ("factoryId", code, name) VALUES (${factoryId}, ${run}, ${`${run} ws`}) RETURNING id`);
      const lineId = await one(tx`INSERT INTO production_lines ("workshopId", code, name) VALUES (${workshopId}, ${run}, ${`${run} line`}) RETURNING id`);
      const stationId = await one(tx`INSERT INTO stations ("lineId", code, name) VALUES (${lineId}, ${run}, ${`${run} station`}) RETURNING id`);
      const machineId = await one(tx`INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
        VALUES (${stationId}, ${run}, ${`${run} machine`}, 'AUTOMATION', true) RETURNING id`);
      const mkUser = async (role: string, suffix: string, hash: string) => {
        const id = await one(tx`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
          VALUES (${`${run}-${suffix}`}, ${`${run}_${suffix}`}, ${`H6 ${suffix}`}, 'password', ${role}, true, false, now()) RETURNING id`);
        await tx`INSERT INTO user_secrets ("userId", "passwordHash", "updatedAt") VALUES (${id}, ${hash}, now())`;
        // H fix 1 (review M8) — NOT admins: engineers scoped to THIS fixture factory only (tiny command-center hierarchy, so the
        // page settles in seconds, and the orchestration factory scope (E2) is exercised for real). Rights = exactly what the
        // flow needs: start / approve (machine_control canCreate) + read the studio (machine_monitoring canView).
        await tx`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit")
          VALUES (${id}, 'machine_control', 'machine_control', true, true, true), (${id}, 'machine_monitoring', 'machine_status', true, false, false)`;
        await tx`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${id}, ${run})`;
        return id;
      };
      const ownerId = await mkUser("engineer", "owner", ownerHash);
      const approverId = await mkUser("engineer", "approver", approverHash);
      const adapterId = await one(tx`INSERT INTO device_adapters (code, name, protocol, endpoint, "machineId", "isEnabled")
        VALUES (${run}, ${`${run} stub adapter`}, 'stub', 'stub://h6', ${machineId}, true) RETURNING id`);
      const tagId = await one(tx`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
        VALUES (${adapterId}, ${tagKey}, 'h6.run', 'int', true, true) RETURNING id`);
      const commissioningId = await one(tx`INSERT INTO commissioning_records ("adapterId", status, "fatReference", "signedBy", notes)
        VALUES (${adapterId}, 'active', ${`${run} FAT`}, ${ownerId}, 'doc 81 dot 5 H6 e2e fixture (_test)') RETURNING id`);
      const workflowRef = run;
      const def = {
        ref: workflowRef,
        name: `${run} OT stop`,
        version: 1,
        steps: [
          { id: "g1", type: "hitl_gate", prompt: "H6: approve the stop" },
          { id: "s1", type: "command", machineId, command: "stop", args: { adapterId, tagKey, value: 0 } },
        ],
      };
      const workflowId = await one(tx`INSERT INTO orchestration_workflows (ref, name, "definitionJson", status)
        VALUES (${workflowRef}, ${def.name}, ${tx.json(def as never)}, 'active') RETURNING id`);
      return {
        run, factoryId, workshopId, lineId, stationId, machineId, adapterId, tagId, commissioningId,
        owner: { id: ownerId, username: `${run}_owner`, password: ownerPw },
        approver: { id: approverId, username: `${run}_approver`, password: approverPw },
        workflowId, workflowRef, tagKey,
      } satisfies H6Fixture;
    }),
  );
}

/** Mọi adapter đang bật của `_test` — đầu vào của hàng rào `assertEnabledAdaptersSafe` (đọc NGAY trước khi dựng instance). */
export async function enabledAdapters(): Promise<Array<{ id: number; protocol: string; endpoint: string; connectionOptions: unknown }>> {
  return withTestDb(async (sql) =>
    (await sql`SELECT id, protocol, endpoint, "connectionOptions" FROM device_adapters WHERE "isEnabled" = true ORDER BY id`).map((r) => ({
      id: Number(r.id), protocol: String(r.protocol), endpoint: String(r.endpoint), connectionOptions: r.connectionOptions,
    })),
  );
}
