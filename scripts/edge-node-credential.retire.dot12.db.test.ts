/**
 * doc 81 Đợt 12 task O — RETIRE an edge node (`edge-node-credential.ts retire-node`, service retireEdgeNode, mig 0378) on the REAL
 * `_test` DB with real users (bcrypt password):
 *   • a PROVEN admin only (an engineer is refused before anything is read for a write); the secret from the TTY / piped stdin only;
 *   • REFUSED — naming what blocks it, nothing changed, audited failure — while the node: owns a robot · owns an adapter · has an
 *     unacknowledged STOP · has an unacknowledged lock / clear request · has a non-terminal run (claimed edge assignment, or a
 *     legacy v1 delegation);
 *   • happy path: every active credential revoked in the same transaction, the node marked retired (row kept, status offline),
 *     audited EDGE_NODE_RETIRE; a second retire is refused (already retired);
 *   • a retired node is refused on EVERY v2 route (the credential it held is dead: the same 401), is given no new credential, no
 *     device, no run, no claim (DB triggers — 23514 even for a direct write), re-registering its code is refused (CLI + tRPC
 *     coordinator), it cannot be un-retired, renamed, brought online or deleted;
 *   • the DB itself refuses a retirement while a credential is active / a device is owned (a direct UPDATE, 23514);
 *   • concurrency: a device assignment racing a retirement is serialised by the node row lock (never a retired owner); L-7 — a
 *     STOP request inserted while a retirement holds the node row is NOT delayed (FK KEY SHARE vs NO KEY UPDATE).
 * Retired test nodes stay on _test by design (a retired node is never deleted — the property under test).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { runEdgeCredentialCli, type CliIo } from "./edge-node-credential";

const DB_URL = process.env.DATABASE_URL;
const DAU = `D12O-${Date.now()}`;
const PW = { admin: `adm-${DAU}-Pw!`, eng: `eng-${DAU}-Pw!` };
const ids = { admin: 0, eng: 0, factory: 0, workshop: 0, line: 0, station: 0, machine: 0, robot: 0, adapter: 0 };
const wfIds: number[] = [];
let sql: ReturnType<typeof postgres>;

async function cli(argv: string[], io: Partial<CliIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEdgeCredentialCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env: {}, ...io });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const pipe = (...lines: string[]) => ({ readStdin: async () => lines.join("\n") + "\n" });
const asAdmin = pipe(PW.admin);
const F = () => `${DAU}-F`;

/** register (v2) + issue through the CLI; returns the node id and the token shown once. */
async function provision(code: string): Promise<{ nodeId: number; token: string }> {
  const reg = await cli(["register-node", "--node", code, "--factory", F(), "--actor", `${DAU}-a`, "--reason", "dot12 O provision"], asAdmin);
  expect(reg.code, reg.err).toBe(0);
  const iss = await cli(["issue", "--node", code, "--actor", `${DAU}-a`, "--reason", "dot12 O provision"], asAdmin);
  expect(iss.code, iss.err).toBe(0);
  const lines = iss.out.split("\n");
  const token = lines[lines.findIndex((l) => /shown ONCE/.test(l)) + 1];
  expect(token).toMatch(/^edn_[0-9a-f]{12}\./);
  const [n] = await sql`SELECT id FROM edge_nodes WHERE code = ${code}`;
  return { nodeId: Number(n.id), token };
}
const retire = (code: string, reason = "dot12 O retire", io: Partial<CliIo> = asAdmin) =>
  cli(["retire-node", "--node", code, "--actor", `${DAU}-a`, "--reason", reason], io);
const nodeRow = async (id: number) =>
  (await sql`SELECT status::text AS status, to_jsonb(n) ->> 'retiredAt' AS "retiredAt", to_jsonb(n) ->> 'retiredBy' AS "retiredBy", to_jsonb(n) ->> 'retireReason' AS "retireReason" FROM edge_nodes n WHERE id = ${id}`)[0];
const activeCreds = async (id: number) => Number((await sql`SELECT count(*)::int AS n FROM edge_node_credentials WHERE "edgeNodeId" = ${id} AND status = 'active'`)[0].n);
const sqlState = async (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e?.code ?? String(e));
const audits = async (code: string, action = "EDGE_NODE_RETIRE") =>
  (await sql`SELECT status::text AS status, details FROM audit_logs WHERE action = ${action} AND "entityName" = ${code} ORDER BY id`).map((r) => ({
    status: r.status,
    details: typeof r.details === "string" ? JSON.parse(r.details) : r.details,
  }));

async function newRun(tag: string): Promise<{ runId: number; workflowId: number }> {
  const ref = `${DAU}-${tag}`;
  const [wf] = await sql`INSERT INTO orchestration_workflows (ref, name, "definitionJson", status, "scopeKey", version) VALUES (${ref}, ${ref}, ${sql.json({ ref, name: ref, steps: [] })}, 'active', 'global', 1) RETURNING id`;
  wfIds.push(Number(wf.id));
  const [run] = await sql`INSERT INTO orchestration_runs ("workflowId", "workflowRef", status, "paramsJson", "contextJson", "startedBy") VALUES (${wf.id}, ${ref}, 'queued', ${sql.json({})}, ${sql.json({})}, ${ids.admin}) RETURNING id`;
  return { runId: Number(run.id), workflowId: Number(wf.id) };
}
const HASH = "a".repeat(64);

describe.skipIf(!DB_URL)("Đợt 12 O — retire an edge node (CLI retire-node, mig 0378) on _test", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 4, connect_timeout: 30, onnotice: () => {} });
    const user = async (tag: string, role: string, pw: string) => {
      const id = Number((await sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-${tag}`}, ${`${DAU}-${tag}`}, ${`d12o ${tag}`}, ${role}, true) RETURNING id`)[0].id);
      await sql`INSERT INTO user_secrets ("userId", "passwordHash") VALUES (${id}, ${await bcrypt.hash(pw, 4)})`;
      return id;
    };
    ids.admin = await user("a", "admin", PW.admin);
    ids.eng = await user("e", "engineer", PW.eng);
    ids.factory = Number((await sql`INSERT INTO factories (code, name) VALUES (${F()}, 'f') RETURNING id`)[0].id);
    ids.workshop = Number((await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${`${DAU}-W`}, 'w') RETURNING id`)[0].id);
    ids.line = Number((await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${`${DAU}-L`}, 'l') RETURNING id`)[0].id);
    ids.station = Number((await sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${`${DAU}-S`}, 's') RETURNING id`)[0].id);
    ids.machine = Number((await sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.station}, ${`${DAU}-M`}, 'm', 'AUTOMATION', true) RETURNING id`)[0].id);
    ids.robot = Number((await sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId") VALUES (${`${DAU}-R`}, 'd12o robot', 'sim', 'sim://d12o', true, ${ids.line}, ${ids.station}) RETURNING id`)[0].id);
    ids.adapter = Number((await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`${DAU}-A`}, 'd12o adapter', 'stub', 'stub://d12o', true, ${ids.machine}) RETURNING id`)[0].id);
  }, 60_000);

  afterAll(async () => {
    // devices back to central; their STOPs / lock requests closed (a device with an open STOP cannot be deleted — 0374)
    await sql`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${ids.robot} AND "edgeNodeId" IS NOT NULL`.catch(() => undefined);
    await sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${ids.adapter} AND "edgeNodeId" IS NOT NULL`.catch(() => undefined);
    await sql`UPDATE robots SET "edgeNodeId" = NULL WHERE code LIKE ${DAU + "%"} AND "edgeNodeId" IS NOT NULL`.catch(() => undefined); // RED runs only
    await sql`DELETE FROM robots WHERE code = ${`${DAU}-R2`}`.catch(() => undefined);
    await sql`UPDATE robot_motion_lock_requests SET "ackedAt" = now(), outcome = 'expired' WHERE ("robotId" = ${ids.robot} OR "adapterId" = ${ids.adapter}) AND "ackedAt" IS NULL AND kind <> 'stop'`.catch(() => undefined);
    for (const q of await sql`SELECT id, "robotId", "adapterId" FROM robot_motion_lock_requests WHERE ("robotId" = ${ids.robot} OR "adapterId" = ${ids.adapter}) AND kind = 'stop' AND "ackedAt" IS NULL`.catch(() => [])) {
      const kind = q.robotId ? "robot" : "adapter";
      const [ex] = await sql`SELECT public.edge_stop_record_central_execution(${kind}, ${Number(q.robotId ?? q.adapterId)}, true, 'dot12 O cleanup') AS id`.catch(() => [{ id: null }]);
      if (ex?.id) await sql`SELECT public.edge_stop_ack_central(${q.id}, 'done', ${ex.id}::bigint)`.catch(() => undefined);
    }
    await sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${ids.robot}`.catch(() => undefined);
    for (const w of wfIds) {
      await sql`DELETE FROM orchestration_runs WHERE "workflowId" = ${w}`.catch(() => undefined);
      await sql`DELETE FROM orchestration_workflows WHERE id = ${w}`.catch(() => undefined);
    }
    await sql`DELETE FROM robots WHERE id = ${ids.robot}`.catch(() => undefined);
    await sql`DELETE FROM device_adapters WHERE id = ${ids.adapter}`.catch(() => undefined);
    await sql`DELETE FROM edge_nodes WHERE code LIKE ${DAU + "%"} AND to_jsonb(edge_nodes) ->> 'retiredAt' IS NULL`.catch(() => undefined); // retired ones stay (by design)
    await sql`DELETE FROM machines WHERE id = ${ids.machine}`.catch(() => undefined);
    await sql`DELETE FROM stations WHERE id = ${ids.station}`.catch(() => undefined);
    await sql`DELETE FROM production_lines WHERE id = ${ids.line}`.catch(() => undefined);
    await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`.catch(() => undefined);
    await sql`DELETE FROM factories WHERE id = ${ids.factory}`.catch(() => undefined);
    await sql.end();
  }, 60_000);

  it("arguments + proof: retire-node needs --actor and --reason (exit 2); an env secret is refused (exit 2); an engineer is refused before anything; unknown node ⇒ nodeNotFound", async () => {
    const code = `${DAU}-args`;
    const { nodeId } = await provision(code);
    expect((await cli(["retire-node", "--node", code, "--reason", "no actor"], asAdmin)).code).toBe(2);
    const noReason = await cli(["retire-node", "--node", code, "--actor", `${DAU}-a`], asAdmin);
    expect(noReason.code).toBe(2);
    expect(noReason.err).toMatch(/--reason/);
    const env = await cli(["retire-node", "--node", code, "--actor", `${DAU}-a`, "--reason", "env"], { env: { EDGE_CRED_ADMIN_PASSWORD: PW.admin }, ...asAdmin });
    expect(env.code).toBe(2);
    expect((await cli(["retire-node", "--node", code, "--actor", `${DAU}-a`, "--reason", "argv", "--password=x"], asAdmin)).code).toBe(2);
    const eng = await cli(["retire-node", "--node", code, "--actor", `${DAU}-e`, "--reason", "engineer"], pipe(PW.eng));
    expect(eng.code).toBe(1);
    expect(eng.err).toMatch(/notAdmin/);
    const wrongPw = await cli(["retire-node", "--node", code, "--actor", `${DAU}-a`, "--reason", "wrong pw"], pipe("nope"));
    expect(wrongPw.code).toBe(1);
    expect(wrongPw.err).toMatch(/notVerified/);
    // the service itself refuses a non-admin actor id (the tRPC path passes the session user — defence in depth)
    const svc = await import("../server/services/edge/edgeNodeCredentials");
    const direct = await svc.retireEdgeNode({ nodeCode: code, actorUserId: ids.eng, reason: "engineer direct" }).then(() => "ok", (e: { code?: string }) => e?.code);
    expect(direct).toBe("notAdmin");
    const unknown = await retire(`${DAU}-nope`);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toMatch(/nodeNotFound/);
    expect(await activeCreds(nodeId)).toBe(1);
    expect((await nodeRow(nodeId)).retiredAt).toBeNull();
  });

  it("★ refused while the node owns a ROBOT / an ADAPTER — the refusal names them; nothing changed; audited failure", async () => {
    const code = `${DAU}-dev`;
    const { nodeId } = await provision(code);
    await sql`UPDATE robots SET "edgeNodeId" = ${nodeId} WHERE id = ${ids.robot}`;
    await sql`UPDATE device_adapters SET "edgeNodeId" = ${nodeId} WHERE id = ${ids.adapter}`;
    const r = await retire(code);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/retireBlocked/);
    expect(r.err).toMatch(new RegExp(`robot\\(s\\) ${ids.robot}\\b`));
    expect(r.err).toMatch(new RegExp(`adapter\\(s\\) ${ids.adapter}\\b`));
    expect(await activeCreds(nodeId)).toBe(1);
    expect((await nodeRow(nodeId)).retiredAt).toBeNull();
    const a = await audits(code);
    expect(a.at(-1)?.status).toBe("failure");
    expect(JSON.stringify(a.at(-1)?.details)).toMatch(/robot/);
    // only the adapter left ⇒ still refused, naming only it
    await sql`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${ids.robot}`;
    const r2 = await retire(code);
    expect(r2.code).toBe(1);
    expect(r2.err).not.toMatch(/robot\(s\)/);
    expect(r2.err).toMatch(new RegExp(`adapter\\(s\\) ${ids.adapter}\\b`));
    await sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${ids.adapter}`;
    await sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${ids.robot}`;
  });

  it("★ refused while the node has an UNACKNOWLEDGED STOP, or a REFUSED one nobody resolved (its device already released to central) — then retired", async () => {
    const code = `${DAU}-stop`;
    const { nodeId } = await provision(code);
    await sql`UPDATE robots SET "edgeNodeId" = ${nodeId} WHERE id = ${ids.robot}`;
    const [{ e }] = await sql`SELECT "ownerEpoch" AS e FROM robots WHERE id = ${ids.robot}`;
    const stop = async (why: string) =>
      Number((await sql`INSERT INTO robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "expiresAt", reason) VALUES (${ids.robot}, ${nodeId}, ${e}, 'stop', ${ids.admin}, now() + interval '1 minute', ${why}) RETURNING id`)[0].id);
    const q1 = await stop("dot12 O stop pending");
    const q2 = await stop("dot12 O stop refused");
    expect((await sql`SELECT public.edge_stop_ack_edge(${q2}, ${nodeId}, ${ids.robot}::integer, NULL::integer, ${e}::bigint, 'refused', false, NULL) AS ok`)[0].ok).toBe(true);
    await sql`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${ids.robot}`; // q1 stays pending (centralMustExecute), q2 needs a person
    const r = await retire(code);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/retireBlocked/);
    expect(r.err).toMatch(new RegExp(`unacknowledged STOP request\\(s\\) ${q1}, ${q2}\\b`));
    expect(r.err).not.toMatch(/robot\(s\)/);
    expect(await activeCreds(nodeId)).toBe(1);
    const [ex] = await sql`SELECT public.edge_stop_record_central_execution('robot', ${ids.robot}, true, 'dot12 O central') AS id`;
    await sql`SELECT public.edge_stop_ack_central(${q1}, 'done', ${ex.id}::bigint)`;
    const r2 = await retire(code); // the refused STOP still needs a person (§8.9)
    expect(r2.code).toBe(1);
    expect(r2.err).toMatch(new RegExp(`unacknowledged STOP request\\(s\\) ${q2}\\b`));
    await sql`SELECT public.edge_stop_resolve(${q2}, ${ids.admin}, 'dot12 O checked on site')`;
    const ok = await retire(code);
    expect(ok.code, ok.err).toBe(0);
    await sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${ids.robot}`;
  });

  it("★ refused while the node has an unacknowledged LOCK request", async () => {
    const code = `${DAU}-lock`;
    const { nodeId } = await provision(code);
    await sql`UPDATE robots SET "edgeNodeId" = ${nodeId} WHERE id = ${ids.robot}`;
    const [{ e }] = await sql`SELECT "ownerEpoch" AS e FROM robots WHERE id = ${ids.robot}`;
    const [q] = await sql`INSERT INTO robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "expiresAt", reason) VALUES (${ids.robot}, ${nodeId}, ${e}, 'lock', ${ids.admin}, now() + interval '1 minute', 'dot12 O lock') RETURNING id`;
    await sql`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${ids.robot}`;
    const r = await retire(code);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(new RegExp(`unacknowledged lock / clear request\\(s\\) ${q.id}\\b`));
    expect(await activeCreds(nodeId)).toBe(1);
    await sql`UPDATE robot_motion_lock_requests SET "ackedAt" = now(), outcome = 'expired' WHERE id = ${q.id}`; // what the central sweeper does
    expect((await retire(code)).code).toBe(0);
    await sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${ids.robot}`;
  });

  it("★ refused while a run is CLAIMED by the node (edge assignment) or delegated to it (v1) and not terminal", async () => {
    const code = `${DAU}-run`;
    const { nodeId } = await provision(code);
    const [cred] = await sql`SELECT id FROM edge_node_credentials WHERE "edgeNodeId" = ${nodeId} AND status = 'active'`;
    const a = await newRun("claimed");
    await sql`INSERT INTO orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash", "assignedBy") VALUES (${a.runId}, ${nodeId}, ${a.workflowId}, 1, ${HASH}, ${ids.admin})`;
    await sql`UPDATE orchestration_run_edge_assignments SET "claimSeq" = 1, "claimTokenHash" = ${HASH}, "claimedByCredentialId" = ${cred.id}, "claimedAt" = now(), "progressSeq" = 0 WHERE "runId" = ${a.runId}`;
    await sql`UPDATE orchestration_runs SET status = 'running' WHERE id = ${a.runId}`;
    const b = await newRun("v1");
    await sql`UPDATE orchestration_runs SET "edgeNodeId" = ${nodeId}, status = 'held' WHERE id = ${b.runId}`;
    const r = await retire(code);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(new RegExp(`non-terminal run\\(s\\) [0-9, ]*\\b${a.runId}\\b`));
    expect(r.err).toMatch(new RegExp(`\\b${b.runId}\\b`));
    expect(await activeCreds(nodeId)).toBe(1);
    await sql`UPDATE orchestration_runs SET status = 'aborted' WHERE id = ${a.runId}`;
    const r2 = await retire(code);
    expect(r2.code).toBe(1);
    expect(r2.err).not.toMatch(new RegExp(`\\b${a.runId}\\b`));
    expect(r2.err).toMatch(new RegExp(`\\b${b.runId}\\b`));
    await sql`UPDATE orchestration_runs SET status = 'completed' WHERE id = ${b.runId}`;
    expect((await retire(code)).code).toBe(0);
    // a claim of the retired node's (terminal) assignment is refused by the DB
    expect(await sqlState(sql`UPDATE orchestration_run_edge_assignments SET "claimSeq" = 2, "claimTokenHash" = ${"b".repeat(64)}, "claimedByCredentialId" = ${cred.id}, "claimedAt" = now(), "progressSeq" = 0 WHERE "runId" = ${a.runId}`)).toBe("23514");
  });

  it("★ HAPPY PATH: every active credential revoked in the same transaction, node retired (row kept, offline), audited; a second retire refused", async () => {
    const code = `${DAU}-ok`;
    const { nodeId } = await provision(code);
    const rot = await cli(["rotate", "--node", code, "--actor", `${DAU}-a`, "--reason", "history"], asAdmin);
    expect(rot.code, rot.err).toBe(0);
    await sql`UPDATE edge_nodes SET status = 'online', "lastHeartbeatAt" = now() WHERE id = ${nodeId}`;
    const before = await sql`SELECT id, status FROM edge_node_credentials WHERE "edgeNodeId" = ${nodeId} ORDER BY id`;
    expect(before.map((c) => c.status)).toEqual(["revoked", "active"]);
    const r = await retire(code, "line 3 gateway decommissioned");
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(new RegExp(`retired edge node "${code}" \\(id ${nodeId}\\)`));
    expect(r.out).toMatch(new RegExp(`revoked credential\\(s\\) ${before[1].id}\\b`));
    const n = await nodeRow(nodeId);
    expect(n.status).toBe("offline");
    expect(n.retiredAt).not.toBeNull();
    expect(Number(n.retiredBy)).toBe(ids.admin);
    expect(n.retireReason).toBe("line 3 gateway decommissioned");
    const after = await sql`SELECT id, status, "revokedBy", "revokeReason", "revokedAt" FROM edge_node_credentials WHERE "edgeNodeId" = ${nodeId} ORDER BY id`;
    expect(after.map((c) => c.status)).toEqual(["revoked", "revoked"]);
    expect(Number(after[1].revokedBy)).toBe(ids.admin);
    expect(after[1].revokeReason).toMatch(/^retired: line 3 gateway decommissioned$/);
    expect(after[0].revokeReason).toMatch(/^rotated: /); // history untouched
    const a = await audits(code);
    expect(a.at(-1)?.status).toBe("success");
    expect(a.at(-1)?.details).toMatchObject({ nodeId, revokedCredentialIds: [Number(before[1].id)], reason: "line 3 gateway decommissioned" });
    expect((await sql`SELECT count(*)::int AS n FROM edge_nodes WHERE id = ${nodeId}`)[0].n).toBe(1);
    const again = await retire(code);
    expect(again.code).toBe(1);
    expect(again.err).toMatch(/nodeRetired/);
    const list = await cli(["list", "--node", code]);
    expect(list.out).toMatch(new RegExp(`node "${code}" is retired since .* by user ${ids.admin}: line 3 gateway decommissioned`));
  });

  it("★ a retired node is refused on EVERY v2 route (the same 401) — the same token was accepted on every route before", async () => {
    const code = `${DAU}-routes`;
    const { token } = await provision(code);
    const prev = process.env.EDGE_RUNTIME_ENABLED;
    process.env.EDGE_RUNTIME_ENABLED = "true";
    try {
      const { registerEdgeNodeRoutes } = await import("../server/api/v1/edgeNodeRoutes");
      const routes: Array<{ path: string; auth: (req: unknown, res: unknown, next: () => void) => Promise<void> }> = [];
      const r = { post: (path: string, auth: never) => routes.push({ path, auth }), get: (path: string, auth: never) => routes.push({ path, auth }) };
      registerEdgeNodeRoutes(r as never);
      // the whole population (a new route added without the node credential check would be caught by edgeRuntimeLatent's census)
      expect(routes.map((x) => x.path).sort()).toEqual(
        [
          "/edge/node/pull", "/edge/node/runs/:runId/claim", "/edge/node/runs/:runId/progress", "/edge/node/runs/:runId/complete",
          "/edge/node/runs/:runId/release", "/edge/node/runs/:runId/interrupted", "/edge/node/config", "/edge/node/heartbeat",
          "/edge/node/program-checks", "/edge/node/runs/:runId/authorize", "/edge/node/runs/:runId/report", "/edge/node/telemetry",
          "/edge/node/robots/state", "/edge/node/locks/events",
        ].sort(),
      );
      const call = async (rt: (typeof routes)[number]) => {
        let status = 0;
        let nextCalled = false;
        const res = { status: (s: number) => ((status = s), res), json: () => res };
        const req = { header: (h: string) => (h.toLowerCase() === "authorization" ? `Bearer ${token}` : undefined), params: { runId: "1" }, body: {} };
        await rt.auth(req, res, () => {
          nextCalled = true;
        });
        return nextCalled ? "next" : status;
      };
      for (const rt of routes) expect(await call(rt), rt.path).toBe("next");
      expect((await retire(code)).code).toBe(0);
      for (const rt of routes) expect(await call(rt), rt.path).toBe(401);
      const { authenticateEdgeNodeToken } = await import("../server/services/edge/edgeNodeCredentials");
      expect(await authenticateEdgeNodeToken(token)).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.EDGE_RUNTIME_ENABLED;
      else process.env.EDGE_RUNTIME_ENABLED = prev;
    }
  });

  it("★ a retired node is never given a credential / device / run again, cannot be re-registered, un-retired, renamed, brought online or deleted", async () => {
    const code = `${DAU}-gone`;
    const { nodeId } = await provision(code);
    expect((await retire(code)).code).toBe(0);
    // re-registration (CLI): refused, audited failure
    const reg = await cli(["register-node", "--node", code, "--factory", F(), "--actor", `${DAU}-a`, "--reason", "again"], asAdmin);
    expect(reg.code).toBe(1);
    expect(reg.err).toMatch(/nodeRetired/);
    expect((await audits(code, "EDGE_NODE_REGISTER")).at(-1)).toMatchObject({ status: "failure", details: { outcome: "retired" } });
    // credentials: CLI refused; a direct insert refused by the DB
    const iss = await cli(["issue", "--node", code, "--actor", `${DAU}-a`, "--reason", "again"], asAdmin);
    expect(iss.code).toBe(1);
    expect(iss.err).toMatch(/nodeRetired/);
    expect(await sqlState(sql`INSERT INTO edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash", status, "createdBy") VALUES (${nodeId}, 'edn_0123456789ab', ${HASH}, 'active', ${ids.admin})`)).toBe("23514");
    expect(await activeCreds(nodeId)).toBe(0);
    // devices: the owner-change service and a direct write are refused
    const { changeDeviceOwner } = await import("../server/services/robot/deviceOwnershipService");
    const ch = await changeDeviceOwner({ kind: "adapter", deviceId: ids.adapter, toEdgeNodeId: nodeId, actorUserId: ids.admin, actorName: "d12o" });
    expect(ch.ok).toBe(false);
    expect(JSON.stringify(ch)).toMatch(/retired/);
    expect(await sqlState(sql`UPDATE robots SET "edgeNodeId" = ${nodeId} WHERE id = ${ids.robot}`)).toBe("23514");
    expect(await sqlState(sql`INSERT INTO robots (code, name, vendor, endpoint, "edgeNodeId") VALUES (${`${DAU}-R2`}, 'x', 'sim', 'sim://x', ${nodeId})`)).toBe("23514");
    // runs: an edge assignment and a legacy delegation are refused
    const run = await newRun("gone");
    expect(await sqlState(sql`INSERT INTO orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash", "assignedBy") VALUES (${run.runId}, ${nodeId}, ${run.workflowId}, 1, ${HASH}, ${ids.admin})`)).toBe("23514");
    expect(await sqlState(sql`UPDATE orchestration_runs SET "edgeNodeId" = ${nodeId} WHERE id = ${run.runId}`)).toBe("23514");
    // the coordinator (tRPC registerNode / heartbeat / assignRun / deleteNode) refuses it by name
    const prev = process.env.EDGE_RUNTIME_ENABLED;
    process.env.EDGE_RUNTIME_ENABLED = "true";
    try {
      const co = await import("../server/services/edge/edgeCoordinator");
      for (const res of [
        await co.registerNode({ code, factoryCode: F() }),
        await co.heartbeat({ code }),
        await co.assignRun(run.runId, nodeId),
        await co.deleteNode(nodeId),
        await co.syncRunResult({ edgeNodeCode: code, runId: run.runId, status: "completed", steps: [] } as never),
      ]) {
        expect(res.ok).toBe(false);
        expect((res as { message?: string }).message).toMatch(/retired/);
      }
    } finally {
      if (prev === undefined) delete process.env.EDGE_RUNTIME_ENABLED;
      else process.env.EDGE_RUNTIME_ENABLED = prev;
    }
    // the row: never un-retired, renamed, re-factoried, brought online or deleted
    expect(await sqlState(sql`UPDATE edge_nodes SET "retiredAt" = NULL, "retiredBy" = NULL, "retireReason" = NULL WHERE id = ${nodeId}`)).toBe("23514");
    expect(await sqlState(sql`UPDATE edge_nodes SET code = ${`${code}-x`} WHERE id = ${nodeId}`)).toBe("23514");
    expect(await sqlState(sql`UPDATE edge_nodes SET "factoryCode" = 'OTHER' WHERE id = ${nodeId}`)).toBe("23514");
    expect(await sqlState(sql`UPDATE edge_nodes SET status = 'online' WHERE id = ${nodeId}`)).toBe("23514");
    expect(await sqlState(sql`DELETE FROM edge_nodes WHERE id = ${nodeId}`)).toBe("23514");
    expect(await sqlState(sql`UPDATE edge_nodes SET name = 'renamed label ok', "updatedAt" = now() WHERE id = ${nodeId}`)).toBeNull(); // a label is not identity
    expect((await nodeRow(nodeId)).retiredAt).not.toBeNull();
  });

  it("★ the DB refuses a retirement by a direct write while a credential is active, a device is owned, or the actor is not an active admin", async () => {
    const code = `${DAU}-db`;
    const { nodeId } = await provision(code);
    const direct = (by: number) => sql`UPDATE edge_nodes SET "retiredAt" = now(), "retiredBy" = ${by}, "retireReason" = 'direct write' WHERE id = ${nodeId}`;
    expect(await sqlState(direct(ids.admin))).toBe("23514"); // active credential
    await sql`UPDATE edge_node_credentials SET status = 'revoked', "revokedAt" = now(), "revokedBy" = ${ids.admin}, "revokeReason" = 'test' WHERE "edgeNodeId" = ${nodeId} AND status = 'active'`;
    await sql`UPDATE device_adapters SET "edgeNodeId" = ${nodeId} WHERE id = ${ids.adapter}`;
    expect(await sqlState(direct(ids.admin))).toBe("23514"); // owned adapter
    await sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${ids.adapter}`;
    expect(await sqlState(direct(ids.eng))).toBe("23514"); // not an admin
    expect(await sqlState(sql`UPDATE edge_nodes SET "retiredAt" = now() WHERE id = ${nodeId}`)).toBe("23514"); // incomplete (CHECK)
    await sql`UPDATE edge_nodes SET status = 'online', "lastHeartbeatAt" = now() WHERE id = ${nodeId}`;
    expect(await sqlState(direct(ids.admin))).toBeNull(); // the guard forces 'offline' (the direct write did not set it)
    expect((await nodeRow(nodeId)).status).toBe("offline");
    // the retirement time itself is write-once (no back-dating); an INSERT of a half-retired row is refused (CHECK)
    expect(await sqlState(sql`UPDATE edge_nodes SET "retiredAt" = "retiredAt" - interval '1 day' WHERE id = ${nodeId}`)).toBe("23514");
    expect(await sqlState(sql`INSERT INTO edge_nodes (code, name, status, "retiredAt") VALUES (${`${DAU}-half`}, 'half', 'offline', now())`)).toBe("23514");
  });

  it("★ concurrency: an assignment racing a retirement never leaves a retired owner; L-7 — a STOP insert is not delayed by a retirement holding the node row", async () => {
    // (1) the assignment holds the node row (trigger FOR SHARE) ⇒ the retirement waits, then sees the device ⇒ refused
    const code = `${DAU}-race`;
    const { nodeId } = await provision(code);
    const holder = await sql.reserve();
    try {
      await holder`BEGIN`;
      await holder`UPDATE device_adapters SET "edgeNodeId" = ${nodeId} WHERE id = ${ids.adapter}`;
      const [{ pid }] = await holder`SELECT pg_backend_pid() AS pid`;
      let settled = false;
      const pending = retire(code).finally(() => (settled = true));
      // wait until the retirement is BLOCKED by the holder (or finished without waiting — the mutant / RED case)
      for (let i = 0; i < 200 && !settled; i++) {
        const [{ n }] = await sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`;
        if (n > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await holder`COMMIT`;
      const r = await pending;
      expect(r.code).toBe(1);
      expect(r.err).toMatch(new RegExp(`adapter\\(s\\) ${ids.adapter}\\b`));
    } finally {
      await holder`ROLLBACK`.catch(() => undefined);
      holder.release();
    }
    expect((await nodeRow(nodeId)).retiredAt).toBeNull();
    // (2) L-7: the retirement holds the node row (paused right after its lock) — a STOP for the node's adapter goes in at once
    const svc = await import("../server/services/edge/edgeNodeCredentials");
    let release!: () => void;
    const paused = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const atLock = new Promise<void>((r) => (reached = r));
    svc._setRetirePauseForTests(async () => {
      reached();
      await paused;
    });
    try {
      const pending = retire(code);
      await atLock;
      const [{ e }] = await sql`SELECT "ownerEpoch" AS e FROM device_adapters WHERE id = ${ids.adapter}`;
      const stopper = await sql.reserve();
      let stopId = 0;
      const t0 = Date.now();
      try {
        await stopper`SET lock_timeout = '1000ms'`;
        const [q] = await stopper`INSERT INTO robot_motion_lock_requests ("adapterId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "expiresAt", reason) VALUES (${ids.adapter}, ${nodeId}, ${e}, 'stop', ${ids.admin}, now() + interval '1 minute', 'dot12 O L-7') RETURNING id`;
        stopId = Number(q.id);
      } finally {
        await stopper`RESET lock_timeout`.catch(() => undefined);
        stopper.release();
      }
      expect(Date.now() - t0).toBeLessThan(900);
      release();
      const r = await pending;
      expect(r.code).toBe(1);
      expect(r.err).toMatch(new RegExp(`STOP request\\(s\\) ${stopId}\\b`));
      // close it the way the owner's node would (owned at this epoch), then release the adapter
      await sql`SELECT public.edge_stop_ack_edge(${stopId}, ${nodeId}, NULL::integer, ${ids.adapter}::integer, ${e}::bigint, 'done', false, NULL)`;
      await sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${ids.adapter}`;
    } finally {
      svc._setRetirePauseForTests(null);
      release?.();
    }
    expect((await retire(code)).code).toBe(0);
  }, 30_000);
});
