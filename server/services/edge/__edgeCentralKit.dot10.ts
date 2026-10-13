/**
 * doc 81 Đợt 10 task B — the shared fixture of the central v2 endpoint suites (edgeAuthorize / edgeReports / edgeIngest /
 * edgeConfig .dot10.db.test.ts). Real `_test` DB (never the dev DB), real migrations 0370–0375, a signing key + keyring
 * written to a temp directory (the R-10-c custody: files only), two v2 nodes A and B in one factory, each OWNING a robot and an
 * OT adapter (A's adapter has a PINNED stop tag and a sealed password). Verification uses the EDGE's own trust path
 * (EdgeTrustStore.fromPinned(pin from the keyring files) + the typed verifiers of edgeTrust.ts) — never central code.
 * Not a test file (no `.test.`): imported by the suites.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import type { EdgeNodePrincipal } from "./edgeNodeCredentials";

export const KIT_ENV: Record<string, string | undefined> = {
  EDGE_RUNTIME_ENABLED: "true",
  FOE_ENABLED: "true",
  FOE_SIM_GATE_REQUIRED: "false",
  EDGE_CLAIM_MIN_INTERVAL_MS: "0",
  ROBOT_CONTROL_ENABLED: undefined,
  OT_CONTROL_ENABLED: undefined,
  ROBOT_COMMISSIONING_REQUIRED: undefined,
  OT_COMMISSIONING_REQUIRED: undefined,
  SEC_PLATFORM: undefined,
  FIELD_V2_ENABLED: undefined,
  SAFETY_AUDIT_ENABLED: "true",
  EDGE_SIGNING_KEY_PEM: undefined,
  EDGE_CONFIG_CACHE_MS: "0",
};

export interface Kit {
  DAU: string;
  sql: ReturnType<typeof postgres>;
  keyDir: string;
  kid: string;
  u: { owner: number; approver: number; admin: number; admin2: number };
  ids: Record<string, number>;
  tokens: { A: string; B: string; V1: string };
  wfIds: number[];
  principal: (which: "A" | "B" | "V1") => Promise<EdgeNodePrincipal>;
  /** the EDGE's trust store of a node (pinned root from the keyring files) */
  store: (nodeId: number, now?: () => number) => Promise<import("./edgeSigning").EdgeTrustStore>;
  /** a run assigned to a node, queued (workflow + run + assignment rows) */
  newRun: (tag: string, node: "A" | "B", steps: unknown[]) => Promise<{ runId: number; def: Record<string, unknown>; defHash: string; workflowId: number }>;
  /** the node's readings of its adapters (verified, fresh) */
  readings: (adapterIds: number[], readAt?: number) => Array<{ adapterId: number; status: "verified"; checksum: string; readAt: number }>;
  /** gate g0 approved centrally by `by` (server source), bound to the definition and the binding digest the node's readings give */
  approveGate: (runId: number, def: Record<string, unknown>, by: number, readings: unknown[]) => Promise<void>;
  saved: Record<string, string | undefined>;
  teardown: () => Promise<void>;
}

export function nonce(): string {
  return randomBytes(18).toString("base64url");
}

export async function setupKit(prefix: string): Promise<Kit> {
  const DB_URL = process.env.DATABASE_URL ?? "";
  if (!/_test\b/.test(DB_URL)) throw new Error("the central kit runs on the _test DB only");
  const DAU = `${prefix}-${Date.now()}`;
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(KIT_ENV)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of ["EDGE_SIGNING_KEY_FILE", "EDGE_SIGNING_KEY_DIR", "SECRET_ENCRYPTION_KEY"]) saved[k] = process.env[k];
  if (!process.env.SECRET_ENCRYPTION_KEY && !process.env.JWT_SECRET) process.env.SECRET_ENCRYPTION_KEY = `kit-${randomBytes(16).toString("hex")}`;

  // ── signing key + keyring FILES (R-10-c) ──
  const sg = await import("./edgeSigning");
  const keyDir = mkdtempSync(path.join(os.tmpdir(), "edge-kit-"));
  const { key, privateKeyPem } = sg.generateEdgeSigningKey();
  const keyFile = path.join(keyDir, `${key.kid}.pem`);
  writeFileSync(keyFile, privateKeyPem, { mode: 0o600 });
  const now = Date.now();
  writeFileSync(
    path.join(keyDir, sg.EDGE_KEYRING_FILE),
    JSON.stringify({ v: 1, version: 1, updatedAt: now, keys: [{ kid: key.kid, publicKeyPem: key.publicKeyPem, status: "active", notBefore: now - 60_000, retiredAt: null, root: true }] }),
    { mode: 0o600 },
  );
  process.env.EDGE_SIGNING_KEY_FILE = keyFile;
  process.env.EDGE_SIGNING_KEY_DIR = keyDir;
  sg.__resetCentralEdgeSigningKeyForTests();
  (await import("./edgeCentralCommon")).__resetCentralSignerCacheForTests();
  (await import("./edgeConfigCentral")).__resetEdgeConfigCacheForTests();
  (await import("./edgeExecutionCentral")).__resetClaimRateForTests();

  const sql = postgres(DB_URL, { max: 2, connect_timeout: 30, onnotice: () => {} });
  const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
  const u = { owner: 0, approver: 0, admin: 0, admin2: 0 };
  for (const k of Object.keys(u) as Array<keyof typeof u>) {
    u[k] = await one(sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-${k}`}, ${`${DAU}-${k}`}, ${`kit ${k}`}, 'admin', true) RETURNING id`);
  }
  const ids: Record<string, number> = {};
  ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F-${DAU}`}, 'kit', true) RETURNING id`);
  ids.ws = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${`W-${DAU}`}, 'kit ws') RETURNING id`);
  ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.ws}, ${`L-${DAU}`}, 'kit line') RETURNING id`);
  ids.st = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${`S-${DAU}`}, 'kit st') RETURNING id`);
  ids.mOtA = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.st}, ${`MA-${DAU}`}, 'kit ot A', 'AUTOMATION', true) RETURNING id`);
  ids.mOtB = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.st}, ${`MB-${DAU}`}, 'kit ot B', 'AUTOMATION', true) RETURNING id`);
  ids.mRobot = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.st}, ${`MR-${DAU}`}, 'kit robot cell', 'ROBOT', true) RETURNING id`);
  for (const n of ["A", "B", "V1"] as const) {
    ids[`node${n}`] = await one(sql`INSERT INTO edge_nodes (code, name, "factoryCode", status) VALUES (${`N${n}-${DAU}`}, ${`kit node ${n}`}, ${`F-${DAU}`}, 'online') RETURNING id`);
  }
  await sql`UPDATE edge_nodes SET "protocolVersion" = 2 WHERE id IN ${sql([ids.nodeA, ids.nodeB])}`;
  const { encryptSecret } = await import("../security/secretBox");
  // devices — owned at INSERT (no owner change ⇒ no relock)
  ids.robotA = await one(sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId", "edgeNodeId") VALUES (${`RA-${DAU}`}, 'kit robot A', 'fanuc', 'tcp://10.0.0.1', true, ${ids.line}, ${ids.st}, ${ids.nodeA}) RETURNING id`);
  ids.robotB = await one(sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId", "edgeNodeId", "connectionOptions") VALUES (${`RB-${DAU}`}, 'kit robot B', 'sim', 'sim://b', true, ${ids.line}, ${ids.st}, ${ids.nodeB}, ${sql.json({ password: "B-ROBOT-SECRET" })}) RETURNING id`);
  ids.adapterA = await one(
    sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId", "connectionOptions", "edgeNodeId") VALUES (${`AA-${DAU}`}, 'kit adapter A', 'stub', 'stub://a', true, ${ids.mOtA}, ${sql.json({ simProgram: "abc", password: encryptSecret("A-PLC-SECRET") })}, ${ids.nodeA}) RETURNING id`,
  );
  ids.adapterB = await one(
    sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId", "connectionOptions", "edgeNodeId") VALUES (${`AB-${DAU}`}, 'kit adapter B', 'stub', 'stub://b', true, ${ids.mOtB}, ${sql.json({ simProgram: "xyz", password: encryptSecret("B-PLC-SECRET") })}, ${ids.nodeB}) RETURNING id`,
  );
  await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${ids.adapterA}, 'speed_sp', 'D100', 'int', true), (${ids.adapterA}, 'ro_tag', 'D200', 'int', false), (${ids.adapterB}, 'speed_sp', 'D100', 'int', true)`;
  await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, stop_value, stop_pinned_by, stop_pinned_at) VALUES (${ids.adapterA}, 'stop_cmd', 'M0', 'bool', true, ${sql.json(true)}, ${String(u.admin)}, now())`;

  const { issueNodeCredential } = await import("./edgeNodeCredentials");
  const tokens = {
    A: (await issueNodeCredential({ nodeCode: `NA-${DAU}`, actorUserId: u.admin, reason: "kit provision A" })).token,
    B: (await issueNodeCredential({ nodeCode: `NB-${DAU}`, actorUserId: u.admin, reason: "kit provision B" })).token,
    V1: (await issueNodeCredential({ nodeCode: `NV1-${DAU}`, actorUserId: u.admin, reason: "kit provision V1" })).token,
  };
  const wfIds: number[] = [];

  const kit: Kit = {
    DAU,
    sql,
    keyDir,
    kid: key.kid,
    u,
    ids,
    tokens,
    wfIds,
    saved,
    async principal(which) {
      const { authenticateEdgeNodeToken } = await import("./edgeNodeCredentials");
      const p = await authenticateEdgeNodeToken(tokens[which]);
      if (!p) throw new Error(`node ${which} credential not accepted`);
      return p;
    },
    async store(nodeId, nowFn) {
      const s = await import("./edgeSigning");
      return s.EdgeTrustStore.fromPinned(s.edgePinFromKeyring(s.readEdgeKeyring(keyDir)), { nodeId, ...(nowFn ? { now: nowFn } : {}) });
    },
    async newRun(tag, node, steps) {
      const { hashWorkflowDefinition } = await import("../orchestration/foe/foeGateApproval");
      const ref = `${DAU}-${tag}`;
      const def = { ref, name: ref, steps };
      const [wf] = await sql`INSERT INTO orchestration_workflows (ref, name, "definitionJson", status, "scopeKey", version) VALUES (${ref}, ${ref}, ${sql.json(def as never)}, 'active', 'global', 1) RETURNING id`;
      wfIds.push(Number(wf.id));
      const [run] = await sql`INSERT INTO orchestration_runs ("workflowId", "workflowRef", status, "paramsJson", "contextJson", "startedBy") VALUES (${wf.id}, ${ref}, 'queued', ${sql.json({})}, ${sql.json({})}, ${u.owner}) RETURNING id`;
      const defHash = hashWorkflowDefinition(def as never);
      await sql`INSERT INTO orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash", "assignedBy") VALUES (${run.id}, ${ids[`node${node}`]}, ${wf.id}, 1, ${defHash}, ${u.owner})`;
      return { runId: Number(run.id), def, defHash, workflowId: Number(wf.id) };
    },
    readings(adapterIds, readAt) {
      return adapterIds.map((adapterId) => ({ adapterId, status: "verified" as const, checksum: `sim:${adapterId}:abc`, readAt: readAt ?? Date.now() }));
    },
    async approveGate(runId, def, by, readings) {
      const { getDb } = await import("../../db/connection");
      const d = (await getDb())!;
      const { computeBindingDetail, hashWorkflowDefinition } = await import("../orchestration/foe/foeGateApproval");
      const { edgeProgramPreFor } = await import("./edgeAuthorizeCentral");
      const node = await kit.principal("A");
      const detail = await computeBindingDetail(d, def as never, await edgeProgramPreFor(d, node, readings as never)); // the same rule as approval / authorize
      await sql`INSERT INTO orchestration_run_steps ("runId", "stepId", "stepType", status, attempt, "resultJson", "finishedAt")
                VALUES (${runId}, 'g0', 'hitl_gate', 'completed', 0, ${sql.json({ approved: true, approvedBy: by, approvalSource: "server", defHash: hashWorkflowDefinition(def as never), bindingDigest: detail.digest })}, now())`;
    },
    async teardown() {
      const { getDb } = await import("../../db/connection");
      const d = (await getDb())!;
      const { clearEdgeMotionLock } = await import("./edgeControlSchema");
      for (const r of ["robotA", "robotB"]) {
        const rows = await sql`SELECT "authorityNodeId", "ownerEpoch" FROM robot_motion_locks WHERE "robotId" = ${ids[r]} AND "authorityNodeId" IS NOT NULL`;
        for (const row of rows) await clearEdgeMotionLock(d as never, { robotId: ids[r], nodeId: Number(row.authorityNodeId), ownerEpoch: Number(row.ownerEpoch), generation: 2_147_483_647 }).catch(() => undefined);
      }
      for (const w of wfIds) {
        for (const r of await sql`SELECT id FROM orchestration_runs WHERE "workflowId" = ${w}`) {
          await sql`DELETE FROM ai_pending_actions WHERE id LIKE ${`foe-run${r.id}-%`}`.catch(() => undefined);
          await sql`DELETE FROM orchestration_run_steps WHERE "runId" = ${r.id}`;
          await sql`DELETE FROM orchestration_runs WHERE id = ${r.id}`;
        }
        await sql`DELETE FROM orchestration_workflow_versions WHERE "workflowId" = ${w}`.catch(() => undefined);
        await sql`DELETE FROM orchestration_workflows WHERE id = ${w}`;
      }
      // pending requests (a device with an unacked STOP cannot be deleted — 0374 R-10-i): deliver + ack them as done
      for (const col of ["robotId", "adapterId"] as const) {
        const devs = col === "robotId" ? [ids.robotA, ids.robotB] : [ids.adapterA, ids.adapterB];
        // a STOP is acked only through the guarded function (0374 fix review 3)
        await sql`SELECT public.edge_stop_ack_edge(q.id, q."edgeNodeId", q."robotId", q."adapterId", q."ownerEpoch", 'done', false, NULL)
                  FROM robot_motion_lock_requests q WHERE q.${sql(col)} IN ${sql(devs)} AND q."ackedAt" IS NULL AND q.kind = 'stop'`.catch((e) => console.warn(`[kit] STOP acks: ${(e as Error).message}`));
        await sql`UPDATE robot_motion_lock_requests SET "ackedAt" = now(), outcome = 'done' WHERE ${sql(col)} IN ${sql(devs)} AND "ackedAt" IS NULL AND "deliveredAt" IS NOT NULL AND kind <> 'stop'`.catch(() => undefined);
        await sql`UPDATE robot_motion_lock_requests SET "ackedAt" = now(), outcome = 'expired' WHERE ${sql(col)} IN ${sql(devs)} AND "ackedAt" IS NULL AND kind <> 'stop'`.catch(() => undefined);
      }
      for (const r of ["robotA", "robotB"]) {
        await sql`DELETE FROM robot_jobs WHERE "robotId" = ${ids[r]}`.catch(() => undefined);
        await sql`DELETE FROM robot_telemetry WHERE "robotId" = ${ids[r]}`.catch(() => undefined);
        await sql`DELETE FROM safety_events WHERE "robotId" = ${ids[r]}`.catch(() => undefined);
        await sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${ids[r]} AND authority = 'central'`.catch(() => undefined);
        await sql`DELETE FROM robots WHERE id = ${ids[r]}`.catch((e) => console.warn(`[kit] robot ${r} not removed: ${(e as Error).message}`));
      }
      for (const a of ["adapterA", "adapterB"]) {
        await sql`DELETE FROM command_log WHERE "adapterId" = ${ids[a]}`.catch(() => undefined);
        await sql`DELETE FROM ot_telemetry WHERE "deviceId" = ${a === "adapterA" ? `AA-${DAU}` : `AB-${DAU}`}`.catch(() => undefined);
        await sql`DELETE FROM device_tags WHERE "adapterId" = ${ids[a]}`.catch(() => undefined);
        await sql`DELETE FROM device_adapters WHERE id = ${ids[a]}`.catch((e) => console.warn(`[kit] adapter ${a} not removed: ${(e as Error).message}`));
      }
      for (const n of ["nodeA", "nodeB", "nodeV1"]) if (ids[n]) await sql`DELETE FROM edge_nodes WHERE id = ${ids[n]}`.catch((e) => console.warn(`[kit] node ${n} not removed: ${(e as Error).message}`));
      for (const m of ["mOtA", "mOtB", "mRobot"]) if (ids[m]) await sql`DELETE FROM machines WHERE id = ${ids[m]}`.catch(() => undefined);
      if (ids.st) await sql`DELETE FROM stations WHERE id = ${ids.st}`.catch(() => undefined);
      if (ids.line) await sql`DELETE FROM production_lines WHERE id = ${ids.line}`.catch(() => undefined);
      if (ids.ws) await sql`DELETE FROM workshops WHERE id = ${ids.ws}`.catch(() => undefined);
      if (ids.factory) await sql`DELETE FROM factories WHERE id = ${ids.factory}`.catch(() => undefined);
      await sql`DELETE FROM users WHERE id IN ${sql(Object.values(u).filter(Boolean))}`.catch(() => undefined);
      await sql.end();
      rmSync(keyDir, { recursive: true, force: true });
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
  return kit;
}

/** The steps every suite uses (ids from the kit). */
export function kitSteps(k: Kit) {
  return {
    gate: { id: "g0", type: "hitl_gate", prompt: "go?" },
    otWrite: { id: "o1", type: "command", machineId: k.ids.mOtA, command: "write_tag", args: { adapterId: k.ids.adapterA, tagKey: "speed_sp", value: 7 } },
    otRo: { id: "o2", type: "command", machineId: k.ids.mOtA, command: "write_tag", args: { adapterId: k.ids.adapterA, tagKey: "ro_tag", value: 1 } },
    otPinnedStop: { id: "p1", type: "command", machineId: k.ids.mOtA, command: "stop", args: { adapterId: k.ids.adapterA, writes: [{ tagKey: "stop_cmd", value: true }] } },
    otUnpinnedStop: { id: "p2", type: "command", machineId: k.ids.mOtA, command: "stop", args: { adapterId: k.ids.adapterA, writes: [{ tagKey: "speed_sp", value: 0 }] } },
    robotMove: { id: "m1", type: "command", machineId: k.ids.mRobot, command: "start", args: { robotId: k.ids.robotA } },
    robotStop: { id: "s1", type: "command", machineId: k.ids.mRobot, command: "abort", args: { robotId: k.ids.robotA } },
    otWriteB: { id: "b1", type: "command", machineId: k.ids.mOtB, command: "write_tag", args: { adapterId: k.ids.adapterB, tagKey: "speed_sp", value: 7 } },
  };
}
