/**
 * doc 81 Đợt 12 task O (+ fix 1) — RETIRE an edge node (`edge-node-credential.ts retire-node`, service retireEdgeNode, mig 0378) on
 * the REAL `_test` DB with real users (bcrypt password):
 *   • a PROVEN admin only (an engineer is refused before anything is read for a write); the secret from the TTY / piped stdin only;
 *     the service refuses a non-admin actor id itself — audited;
 *   • REFUSED — naming what blocks it, nothing changed, audited failure — while the node: owns a robot · owns an adapter · has an
 *     unacknowledged STOP (or a refused one nobody resolved) · has an unacknowledged lock / clear request · has a non-terminal run
 *     (claimed edge assignment, or a legacy v1 delegation);
 *   • fix 1 (O-R3): the retirement waits for the node row at most its lock_timeout ⇒ `nodeBusy`, audited, nothing changed; the
 *     credential rows are locked FOR NO KEY UPDATE (a claim's FK KEY SHARE on the credential is never delayed);
 *   • happy path: every active credential revoked in the same transaction, the node marked retired (row kept, status offline),
 *     audited; a second retire refused; EVERY v2 route accepts the token before and answers 401 after;
 *   • a retired node is given no new credential, device (insert / assign, robot and adapter), run (assignment / delegation / a run
 *     INSERTed on it), claim; re-registering its code is refused (CLI + coordinator); fleet status shows it as RETIRED (fix 1,
 *     O-R4); starting a run on it is refused BY NAME (fix 1, O-R5);
 *   • the DB itself (rolled-back transactions, so nothing stays): a retirement refused while a credential is active / a device is
 *     owned / the actor is not an admin / the reason is missing; fix 1: a node is never BORN retired (INSERT refused, O-R1); the
 *     retiring UPDATE stamps retiredAt = now() itself and cannot change code / factory / lines / protocol (O-R2); un-retire,
 *     back-dating, rename, online, delete refused;
 *   • concurrency: a device assignment racing a retirement is serialised (never a retired owner); L-7 — a STOP request inserted
 *     while a retirement holds the node row is not delayed.
 * fix 1 (O-R8) — test data: ONE node is retired per run (the happy path's; a retired node is never deleted — the property under
 * test), every refusal test reuses one un-retired fixture node (deleted at the end), the DB-level checks run in transactions that
 * are rolled back.
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
/** the un-retired fixture node every refusal test reuses */
const FIX = { code: `${DAU}-fix`, nodeId: 0, token: "" };
/** the ONE node retired per run (happy path), reused by the "retired node" tests */
const RET = { code: `${DAU}-ret`, nodeId: 0, tokens: [] as string[], doneRunId: 0, credId: 0 };
let has0378 = false;

async function cli(argv: string[], io: Partial<CliIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEdgeCredentialCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env: {}, ...io });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const pipe = (...lines: string[]) => ({ readStdin: async () => lines.join("\n") + "\n" });
const asAdmin = pipe(PW.admin);
const F = () => `${DAU}-F`;
const tokenOf = (out: string) => {
  const lines = out.split("\n");
  return lines[lines.findIndex((l) => /shown ONCE/.test(l)) + 1];
};

/** register (v2) + issue through the CLI; returns the node id and the token shown once. */
async function provision(code: string): Promise<{ nodeId: number; token: string }> {
  const reg = await cli(["register-node", "--node", code, "--factory", F(), "--actor", `${DAU}-a`, "--reason", "dot12 O provision"], asAdmin);
  expect(reg.code, reg.err).toBe(0);
  const iss = await cli(["issue", "--node", code, "--actor", `${DAU}-a`, "--reason", "dot12 O provision"], asAdmin);
  expect(iss.code, iss.err).toBe(0);
  const token = tokenOf(iss.out);
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
/** a FIX refusal leaves it exactly as before: one active credential, not retired */
async function fixUnchanged() {
  expect(await activeCreds(FIX.nodeId)).toBe(1);
  expect((await nodeRow(FIX.nodeId)).retiredAt).toBeNull();
}
const ROLLBACK = new Error("rollback");
/** run body in a transaction that is ALWAYS rolled back (DB-level checks leave nothing behind) */
async function rolledBack(body: (tx: postgres.TransactionSql) => Promise<void>) {
  await sql.begin(async (tx) => {
    await body(tx);
    throw ROLLBACK;
  }).catch((e) => {
    if (e !== ROLLBACK) throw e;
  });
}
const spState = async (tx: postgres.TransactionSql, fn: (sp: postgres.TransactionSql) => Promise<unknown>) =>
  tx.savepoint(async (sp) => fn(sp)).then(() => null, (e: { code?: string }) => e?.code ?? String(e));

async function newRun(tag: string): Promise<{ runId: number; workflowId: number }> {
  const ref = `${DAU}-${tag}`;
  const [wf] = await sql`INSERT INTO orchestration_workflows (ref, name, "definitionJson", status, "scopeKey", version) VALUES (${ref}, ${ref}, ${sql.json({ ref, name: ref, steps: [] })}, 'active', 'global', 1) RETURNING id`;
  wfIds.push(Number(wf.id));
  const [run] = await sql`INSERT INTO orchestration_runs ("workflowId", "workflowRef", status, "paramsJson", "contextJson", "startedBy") VALUES (${wf.id}, ${ref}, 'queued', ${sql.json({})}, ${sql.json({})}, ${ids.admin}) RETURNING id`;
  return { runId: Number(run.id), workflowId: Number(wf.id) };
}
const HASH = "a".repeat(64);
async function withEdgeRuntime<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.EDGE_RUNTIME_ENABLED;
  process.env.EDGE_RUNTIME_ENABLED = "true";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.EDGE_RUNTIME_ENABLED;
    else process.env.EDGE_RUNTIME_ENABLED = prev;
  }
}

describe.skipIf(!DB_URL)("Đợt 12 O — retire an edge node (CLI retire-node, mig 0378) on _test", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 4, connect_timeout: 30, onnotice: () => {} });
    has0378 = Number((await sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'edge_nodes' AND column_name = 'retiredAt'`)[0].n) === 1;
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
    Object.assign(FIX, await provision(FIX.code));
  }, 60_000);

  afterAll(async () => {
    // devices back to central; their STOPs / lock requests closed (a device with an open STOP cannot be deleted — 0374)
    await sql`UPDATE robots SET "edgeNodeId" = NULL WHERE code LIKE ${DAU + "%"} AND "edgeNodeId" IS NOT NULL`.catch(() => undefined);
    await sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE code LIKE ${DAU + "%"} AND "edgeNodeId" IS NOT NULL`.catch(() => undefined);
    await sql`UPDATE robot_motion_lock_requests SET "ackedAt" = now(), outcome = 'expired' WHERE ("robotId" = ${ids.robot} OR "adapterId" = ${ids.adapter}) AND "ackedAt" IS NULL AND kind <> 'stop'`.catch(() => undefined);
    for (const q of await sql`SELECT id, "robotId", "adapterId" FROM robot_motion_lock_requests WHERE ("robotId" = ${ids.robot} OR "adapterId" = ${ids.adapter}) AND kind = 'stop' AND "ackedAt" IS NULL`.catch(() => [])) {
      const kind = q.robotId ? "robot" : "adapter";
      const [ex] = await sql`SELECT public.edge_stop_record_central_execution(${kind}, ${Number(q.robotId ?? q.adapterId)}, true, 'dot12 O cleanup') AS id`.catch(() => [{ id: null }]);
      if (ex?.id) await sql`SELECT public.edge_stop_ack_central(${q.id}, 'done', ${ex.id}::bigint)`.catch(() => undefined);
    }
    await sql`DELETE FROM robot_motion_locks WHERE "robotId" IN (SELECT id FROM robots WHERE code LIKE ${DAU + "%"})`.catch(() => undefined);
    for (const w of wfIds) {
      await sql`DELETE FROM orchestration_runs WHERE "workflowId" = ${w}`.catch(() => undefined);
      await sql`DELETE FROM orchestration_workflows WHERE id = ${w}`.catch(() => undefined);
    }
    await sql`DELETE FROM robots WHERE code LIKE ${DAU + "%"}`.catch(() => undefined);
    await sql`DELETE FROM device_adapters WHERE code LIKE ${DAU + "%"}`.catch(() => undefined);
    await sql`DELETE FROM edge_nodes WHERE code LIKE ${DAU + "%"} AND to_jsonb(edge_nodes) ->> 'retiredAt' IS NULL`.catch((e) => console.warn(`[d12o] fixture node not deleted: ${e.message}`));
    const [left] = await sql`SELECT count(*)::int AS n FROM edge_nodes WHERE code LIKE ${DAU + "%"}`;
    console.log(`[d12o] edge nodes left by this run: ${left.n} (the retired one by design)`);
    await sql`DELETE FROM machines WHERE id = ${ids.machine}`.catch(() => undefined);
    await sql`DELETE FROM stations WHERE id = ${ids.station}`.catch(() => undefined);
    await sql`DELETE FROM production_lines WHERE id = ${ids.line}`.catch(() => undefined);
    await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`.catch(() => undefined);
    await sql`DELETE FROM factories WHERE id = ${ids.factory}`.catch(() => undefined);
    await sql.end();
  }, 60_000);

  it("arguments + proof: --actor / --reason required (exit 2); env secret refused; engineer refused; the service refuses a non-admin actor itself, AUDITED (fix 1); unknown node ⇒ nodeNotFound", async () => {
    const code = FIX.code;
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
    // the service itself refuses a non-admin actor id (the tRPC path passes the session user — defence in depth) — and audits it
    const svc = await import("../server/services/edge/edgeNodeCredentials");
    const direct = await svc.retireEdgeNode({ nodeCode: code, actorUserId: ids.eng, reason: "engineer direct" }).then(() => "ok", (e: { code?: string }) => e?.code);
    expect(direct).toBe("notAdmin");
    expect((await audits(code)).at(-1)).toMatchObject({ status: "failure", details: { outcome: "notAdmin", actorUserId: ids.eng } });
    const unknown = await retire(`${DAU}-nope`);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toMatch(/nodeNotFound/);
    await fixUnchanged();
  });

  it("fix 1 / R-12-e M-7 — WITHOUT mig 0378 (asserted only on such a DB — the rehearsal at the 0377 state): retire fails closed (migrationMissing, not dbUnavailable), AUDITED, nothing changed", async () => {
    if (has0378) return;
    const r = await retire(FIX.code);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/migrationMissing/);
    expect((await audits(FIX.code)).at(-1)).toMatchObject({ status: "failure", details: { outcome: "migrationMissing" } });
    expect(await activeCreds(FIX.nodeId)).toBe(1);
  });

  it("★ R-12-e M-7: the retirement statements answer 42703 (a database without 0378) ⇒ the specific code migrationMissing — never dbUnavailable (the DB is up) — audited, nothing changed", async () => {
    const svc = await import("../server/services/edge/edgeNodeCredentials");
    svc._setRetirePauseForTests(async () => {
      throw Object.assign(new Error('column "retiredAt" of relation "edge_nodes" does not exist'), { code: "42703" });
    });
    try {
      const e = await svc.retireEdgeNode({ nodeCode: FIX.code, actorUserId: ids.admin, reason: "no 0378 here" }).then(
        () => null,
        (x: { code?: string; message?: string }) => x,
      );
      expect(e?.code).toBe("migrationMissing");
      expect(e?.message).toMatch(/migration 0378/);
    } finally {
      svc._setRetirePauseForTests(null);
    }
    expect((await audits(FIX.code)).at(-1)).toMatchObject({ status: "failure", details: { outcome: "migrationMissing" } });
    await fixUnchanged();
  });

  it("★ refused while the node owns a ROBOT / an ADAPTER — the refusal names them; nothing changed; audited failure", async () => {
    await sql`UPDATE robots SET "edgeNodeId" = ${FIX.nodeId} WHERE id = ${ids.robot}`;
    await sql`UPDATE device_adapters SET "edgeNodeId" = ${FIX.nodeId} WHERE id = ${ids.adapter}`;
    const r = await retire(FIX.code);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/retireBlocked/);
    expect(r.err).toMatch(new RegExp(`robot\\(s\\) ${ids.robot}\\b`));
    expect(r.err).toMatch(new RegExp(`adapter\\(s\\) ${ids.adapter}\\b`));
    await fixUnchanged();
    const a = await audits(FIX.code);
    expect(a.at(-1)?.status).toBe("failure");
    expect(JSON.stringify(a.at(-1)?.details)).toMatch(/robot/);
    await sql`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${ids.robot}`;
    const r2 = await retire(FIX.code);
    expect(r2.code).toBe(1);
    expect(r2.err).not.toMatch(/robot\(s\)/);
    expect(r2.err).toMatch(new RegExp(`adapter\\(s\\) ${ids.adapter}\\b`));
    await sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${ids.adapter}`;
    await sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${ids.robot}`;
    await fixUnchanged();
  });

  it("★ refused while the node has an UNACKNOWLEDGED STOP, or a REFUSED one nobody resolved (its device already released to central)", async () => {
    await sql`UPDATE robots SET "edgeNodeId" = ${FIX.nodeId} WHERE id = ${ids.robot}`;
    const [{ e }] = await sql`SELECT "ownerEpoch" AS e FROM robots WHERE id = ${ids.robot}`;
    const stop = async (why: string) =>
      Number((await sql`INSERT INTO robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "expiresAt", reason) VALUES (${ids.robot}, ${FIX.nodeId}, ${e}, 'stop', ${ids.admin}, now() + interval '1 minute', ${why}) RETURNING id`)[0].id);
    const q1 = await stop("dot12 O stop pending");
    const q2 = await stop("dot12 O stop refused");
    expect((await sql`SELECT public.edge_stop_ack_edge(${q2}, ${FIX.nodeId}, ${ids.robot}::integer, NULL::integer, ${e}::bigint, 'refused', false, NULL) AS ok`)[0].ok).toBe(true);
    await sql`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${ids.robot}`; // q1 stays pending (centralMustExecute), q2 needs a person
    const r = await retire(FIX.code);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/retireBlocked/);
    expect(r.err).toMatch(new RegExp(`unacknowledged STOP request\\(s\\) ${q1}, ${q2}\\b`));
    expect(r.err).not.toMatch(/robot\(s\)/);
    await fixUnchanged();
    const [ex] = await sql`SELECT public.edge_stop_record_central_execution('robot', ${ids.robot}, true, 'dot12 O central') AS id`;
    await sql`SELECT public.edge_stop_ack_central(${q1}, 'done', ${ex.id}::bigint)`;
    const r2 = await retire(FIX.code); // the refused STOP still needs a person (§8.9)
    expect(r2.code).toBe(1);
    expect(r2.err).toMatch(new RegExp(`unacknowledged STOP request\\(s\\) ${q2}\\b`));
    expect(r2.err).not.toMatch(new RegExp(`\\b${q1}\\b`));
    await sql`SELECT public.edge_stop_resolve(${q2}, ${ids.admin}, 'dot12 O checked on site')`;
    await sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${ids.robot}`;
    await fixUnchanged();
  });

  it("★ refused while the node has an unacknowledged LOCK request", async () => {
    await sql`UPDATE robots SET "edgeNodeId" = ${FIX.nodeId} WHERE id = ${ids.robot}`;
    const [{ e }] = await sql`SELECT "ownerEpoch" AS e FROM robots WHERE id = ${ids.robot}`;
    const [q] = await sql`INSERT INTO robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "expiresAt", reason) VALUES (${ids.robot}, ${FIX.nodeId}, ${e}, 'lock', ${ids.admin}, now() + interval '1 minute', 'dot12 O lock') RETURNING id`;
    await sql`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${ids.robot}`;
    const r = await retire(FIX.code);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(new RegExp(`unacknowledged lock / clear request\\(s\\) ${q.id}\\b`));
    await fixUnchanged();
    await sql`UPDATE robot_motion_lock_requests SET "ackedAt" = now(), outcome = 'expired' WHERE id = ${q.id}`; // what the central sweeper does
    await sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${ids.robot}`;
  });

  it("★ refused while a run is CLAIMED by the node or delegated to it (v1) and not terminal; fix 1 (O-R3): a CLAIM is never delayed by a retirement holding the node", async () => {
    const [cred] = await sql`SELECT id FROM edge_node_credentials WHERE "edgeNodeId" = ${FIX.nodeId} AND status = 'active'`;
    const a = await newRun("claimed");
    await sql`INSERT INTO orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash", "assignedBy") VALUES (${a.runId}, ${FIX.nodeId}, ${a.workflowId}, 1, ${HASH}, ${ids.admin})`;
    // the claim lands WHILE a retirement holds the node + credential rows (paused right after its locks) — FK KEY SHARE on the
    // credential, no node lock: it must not wait (FOR UPDATE on the credential / FOR SHARE on the node would block it)
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
      const pending = retire(FIX.code);
      await atLock;
      const claimer = await sql.reserve();
      const t0 = Date.now();
      try {
        await claimer`SET lock_timeout = '1000ms'`;
        await claimer`UPDATE orchestration_run_edge_assignments SET "claimSeq" = 1, "claimTokenHash" = ${HASH}, "claimedByCredentialId" = ${cred.id}, "claimedAt" = now(), "progressSeq" = 0 WHERE "runId" = ${a.runId}`;
      } finally {
        await claimer`RESET lock_timeout`.catch(() => undefined);
        claimer.release();
      }
      expect(Date.now() - t0).toBeLessThan(900);
      release();
      expect((await pending).code).toBe(1);
    } finally {
      svc._setRetirePauseForTests(null);
      release?.();
    }
    await sql`UPDATE orchestration_runs SET status = 'running' WHERE id = ${a.runId}`;
    const b = await newRun("v1");
    await sql`UPDATE orchestration_runs SET "edgeNodeId" = ${FIX.nodeId}, status = 'held' WHERE id = ${b.runId}`;
    const r = await retire(FIX.code);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(new RegExp(`non-terminal run\\(s\\) [0-9, ]*\\b${a.runId}\\b`));
    expect(r.err).toMatch(new RegExp(`\\b${b.runId}\\b`));
    await fixUnchanged();
    await sql`UPDATE orchestration_runs SET status = 'aborted' WHERE id = ${a.runId}`;
    const r2 = await retire(FIX.code);
    expect(r2.code).toBe(1);
    expect(r2.err).not.toMatch(new RegExp(`\\b${a.runId}\\b`));
    expect(r2.err).toMatch(new RegExp(`\\b${b.runId}\\b`));
    await sql`UPDATE orchestration_runs SET status = 'completed' WHERE id = ${b.runId}`;
    await fixUnchanged();
  }, 30_000);

  it("★ fix 1 (O-R3): a retirement that cannot get the node row within its lock_timeout ⇒ nodeBusy, audited, nothing changed (never hangs)", async () => {
    const svc = await import("../server/services/edge/edgeNodeCredentials");
    svc._setRetireLockTimeoutMsForTests(400);
    const holder = await sql.reserve();
    try {
      await holder`BEGIN`;
      await holder`SELECT id FROM edge_nodes WHERE id = ${FIX.nodeId} FOR SHARE`; // e.g. a device assignment in flight
      let settled = false;
      const t0 = Date.now();
      const pending = retire(FIX.code).finally(() => (settled = true));
      const guard = setTimeout(() => void holder`COMMIT`.catch(() => undefined), 5000); // RED: never hang the suite
      const r = await pending;
      clearTimeout(guard);
      expect(settled).toBe(true);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/nodeBusy/);
      expect(Date.now() - t0).toBeLessThan(4500);
    } finally {
      await holder`COMMIT`.catch(() => undefined);
      holder.release();
      svc._setRetireLockTimeoutMsForTests(null);
    }
    expect((await audits(FIX.code)).at(-1)).toMatchObject({ status: "failure", details: { outcome: "nodeBusy" } });
    await fixUnchanged();
  }, 30_000);

  it("★ HAPPY PATH (the one node retired per run): credentials revoked in the same tx, retired (row kept, offline), audited; EVERY v2 route 200-path before, 401 after; second retire refused", async () => {
    Object.assign(RET, await provision(RET.code));
    RET.tokens = [(RET as unknown as { token: string }).token];
    const rot = await cli(["rotate", "--node", RET.code, "--actor", `${DAU}-a`, "--reason", "history"], asAdmin);
    expect(rot.code, rot.err).toBe(0);
    RET.tokens.push(tokenOf(rot.out));
    await sql`UPDATE edge_nodes SET status = 'online', "lastHeartbeatAt" = now() WHERE id = ${RET.nodeId}`;
    // a FINISHED run the node executed: its assignment stays (evidence) — a new claim on it is refused after the retirement
    const done = await newRun("ret-done");
    await sql`INSERT INTO orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash", "assignedBy") VALUES (${done.runId}, ${RET.nodeId}, ${done.workflowId}, 1, ${HASH}, ${ids.admin})`;
    await sql`UPDATE orchestration_runs SET status = 'completed' WHERE id = ${done.runId}`;
    RET.doneRunId = done.runId;
    const before = await sql`SELECT id, status FROM edge_node_credentials WHERE "edgeNodeId" = ${RET.nodeId} ORDER BY id`;
    RET.credId = Number(before[1].id);
    expect(before.map((c) => c.status)).toEqual(["revoked", "active"]);
    await withEdgeRuntime(async () => {
      const { registerEdgeNodeRoutes } = await import("../server/api/v1/edgeNodeRoutes");
      const routes: Array<{ path: string; auth: (req: unknown, res: unknown, next: () => void) => Promise<void> }> = [];
      registerEdgeNodeRoutes({ post: (path: string, auth: never) => routes.push({ path, auth }), get: (path: string, auth: never) => routes.push({ path, auth }) } as never);
      expect(routes.map((x) => x.path).sort()).toEqual(
        [
          "/edge/node/pull", "/edge/node/runs/:runId/claim", "/edge/node/runs/:runId/progress", "/edge/node/runs/:runId/complete",
          "/edge/node/runs/:runId/release", "/edge/node/runs/:runId/interrupted", "/edge/node/config", "/edge/node/heartbeat",
          "/edge/node/program-checks", "/edge/node/runs/:runId/authorize", "/edge/node/runs/:runId/report", "/edge/node/telemetry",
          "/edge/node/robots/state", "/edge/node/locks/events",
        ].sort(),
      );
      const call = async (rt: (typeof routes)[number], token: string) => {
        let status = 0;
        let nextCalled = false;
        const res = { status: (s: number) => ((status = s), res), json: () => res };
        const req = { header: (h: string) => (h.toLowerCase() === "authorization" ? `Bearer ${token}` : undefined), params: { runId: "1" }, body: {} };
        await rt.auth(req, res, () => {
          nextCalled = true;
        });
        return nextCalled ? "next" : status;
      };
      for (const rt of routes) expect(await call(rt, RET.tokens[1]), rt.path).toBe("next");
      const r = await retire(RET.code, "line 3 gateway decommissioned");
      expect(r.code, r.err).toBe(0);
      expect(r.out).toMatch(new RegExp(`retired edge node "${RET.code}" \\(id ${RET.nodeId}\\)`));
      expect(r.out).toMatch(new RegExp(`revoked credential\\(s\\) ${before[1].id}\\b`));
      for (const rt of routes) for (const tk of RET.tokens) expect(await call(rt, tk), rt.path).toBe(401);
      const { authenticateEdgeNodeToken } = await import("../server/services/edge/edgeNodeCredentials");
      expect(await authenticateEdgeNodeToken(RET.tokens[1])).toBeNull();
    });
    const n = await nodeRow(RET.nodeId);
    expect(n.status).toBe("offline");
    expect(Math.abs(new Date(n.retiredAt).getTime() - Date.now())).toBeLessThan(120_000);
    expect(Number(n.retiredBy)).toBe(ids.admin);
    expect(n.retireReason).toBe("line 3 gateway decommissioned");
    const after = await sql`SELECT id, status, "revokedBy", "revokeReason" FROM edge_node_credentials WHERE "edgeNodeId" = ${RET.nodeId} ORDER BY id`;
    expect(after.map((c) => c.status)).toEqual(["revoked", "revoked"]);
    expect(Number(after[1].revokedBy)).toBe(ids.admin);
    expect(after[1].revokeReason).toBe("retired: line 3 gateway decommissioned");
    expect(after[0].revokeReason).toMatch(/^rotated: /);
    expect((await audits(RET.code)).at(-1)).toMatchObject({ status: "success", details: { nodeId: RET.nodeId, revokedCredentialIds: [Number(before[1].id)], reason: "line 3 gateway decommissioned" } });
    const again = await retire(RET.code);
    expect(again.code).toBe(1);
    expect(again.err).toMatch(/nodeRetired/);
    const list = await cli(["list", "--node", RET.code]);
    expect(list.out).toMatch(new RegExp(`node "${RET.code}" is retired since .* by user ${ids.admin}: line 3 gateway decommissioned`));
  }, 30_000);

  it("★ the retired node is never given a credential / device / run again, cannot be re-registered, renamed, brought online or deleted; fleet shows it RETIRED; starting a run on it is refused by name", async () => {
    expect(RET.nodeId, "needs the happy path's retired node").toBeGreaterThan(0);
    const { code, nodeId } = RET;
    const reg = await cli(["register-node", "--node", code, "--factory", F(), "--actor", `${DAU}-a`, "--reason", "again"], asAdmin);
    expect(reg.code).toBe(1);
    expect(reg.err).toMatch(/nodeRetired/);
    expect((await audits(code, "EDGE_NODE_REGISTER")).at(-1)).toMatchObject({ status: "failure", details: { outcome: "retired" } });
    const iss = await cli(["issue", "--node", code, "--actor", `${DAU}-a`, "--reason", "again"], asAdmin);
    expect(iss.code).toBe(1);
    expect(iss.err).toMatch(/nodeRetired/);
    const { changeDeviceOwner } = await import("../server/services/robot/deviceOwnershipService");
    const ch = await changeDeviceOwner({ kind: "adapter", deviceId: ids.adapter, toEdgeNodeId: nodeId, actorUserId: ids.admin, actorName: "d12o" });
    expect(ch.ok).toBe(false);
    expect(JSON.stringify(ch)).toMatch(/retired/);
    const run = await newRun("gone");
    // every direct write — rolled back, nothing stays even if a guard were missing
    await rolledBack(async (tx) => {
      expect(await spState(tx, (sp) => sp`INSERT INTO edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash", status, "createdBy") VALUES (${nodeId}, 'edn_0123456789ab', ${HASH}, 'active', ${ids.admin})`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`UPDATE robots SET "edgeNodeId" = ${nodeId} WHERE id = ${ids.robot}`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`INSERT INTO robots (code, name, vendor, endpoint, "edgeNodeId") VALUES (${`${DAU}-R2`}, 'x', 'sim', 'sim://x', ${nodeId})`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`UPDATE device_adapters SET "edgeNodeId" = ${nodeId} WHERE id = ${ids.adapter}`)).toBe("23514");
      // fix 1 (O-R6) — an adapter / a run INSERTed already on the retired node
      expect(await spState(tx, (sp) => sp`INSERT INTO device_adapters (code, name, protocol, endpoint, "machineId", "edgeNodeId") VALUES (${`${DAU}-A2`}, 'x', 'stub', 'stub://x', ${ids.machine}, ${nodeId})`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`INSERT INTO orchestration_runs ("workflowId", "workflowRef", status, "paramsJson", "contextJson", "startedBy", "edgeNodeId") VALUES (${run.workflowId}, 'x', 'queued', ${sp.json({})}, ${sp.json({})}, ${ids.admin}, ${nodeId})`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`INSERT INTO orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash", "assignedBy") VALUES (${run.runId}, ${nodeId}, ${run.workflowId}, 1, ${HASH}, ${ids.admin})`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`UPDATE orchestration_runs SET "edgeNodeId" = ${nodeId} WHERE id = ${run.runId}`)).toBe("23514");
      // a new claim on the retired node's (finished) assignment
      expect(await spState(tx, (sp) => sp`UPDATE orchestration_run_edge_assignments SET "claimSeq" = 1, "claimTokenHash" = ${"b".repeat(64)}, "claimedByCredentialId" = ${RET.credId}, "claimedAt" = now(), "progressSeq" = 0 WHERE "runId" = ${RET.doneRunId}`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`UPDATE edge_nodes SET "retiredAt" = NULL, "retiredBy" = NULL, "retireReason" = NULL WHERE id = ${nodeId}`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`UPDATE edge_nodes SET "retiredAt" = "retiredAt" - interval '1 day' WHERE id = ${nodeId}`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`UPDATE edge_nodes SET code = ${`${code}-x`} WHERE id = ${nodeId}`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`UPDATE edge_nodes SET "factoryCode" = 'OTHER' WHERE id = ${nodeId}`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`UPDATE edge_nodes SET status = 'online' WHERE id = ${nodeId}`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`DELETE FROM edge_nodes WHERE id = ${nodeId}`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`UPDATE edge_nodes SET name = 'renamed label ok', "updatedAt" = now() WHERE id = ${nodeId}`)).toBeNull();
    });
    expect(await activeCreds(nodeId)).toBe(0);
    await withEdgeRuntime(async () => {
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
      // fix 1 (O-R5) — starting a run on it: a specific refusal (not "not found", not the generic "unavailable")
      const { resolveAssignableNode } = await import("../server/services/edge/edgeExecutionCentral");
      expect(await resolveAssignableNode(code, null)).toMatchObject({ kind: "retired", id: nodeId });
      expect(await resolveAssignableNode(FIX.code, null)).toMatchObject({ kind: "node", id: FIX.nodeId });
      // fix 1 (O-R4) — the fleet / node list show it RETIRED, counted apart (not a permanently "offline" endpoint)
      // (the plane loader itself: getUnifiedFleetStatus's AI-deployment plane fails on _test for an unrelated, pre-existing reason)
      const plane = await (await import("../server/services/fleetStatusService")).loadEdgeNodesPlane();
      const row = plane.nodes.find((x) => x.id === nodeId);
      expect(row).toMatchObject({ status: "retired" });
      expect(row?.retiredAt).toBeTruthy();
      expect(plane.nodes.find((x) => x.id === FIX.nodeId)).toMatchObject({ retiredAt: null });
      expect(plane.retired).toBe(plane.nodes.filter((x) => x.status === "retired").length);
      expect(plane.retired).toBeGreaterThanOrEqual(1);
      expect(plane.total).toBe(plane.online + plane.offline + plane.degraded);
      expect(plane.total).toBe(plane.nodes.length - plane.retired);
      const listed = (await co.listNodes(F())).find((x) => x.id === nodeId);
      expect(listed).toMatchObject({ status: "retired" });
      expect((listed as { retiredAt?: string | null })?.retiredAt).toBeTruthy();
      expect((await co.listNodes(F())).find((x) => x.id === FIX.nodeId)?.status).not.toBe("retired");
    });
    expect((await nodeRow(nodeId)).retiredAt).not.toBeNull();
  }, 30_000);

  it("★ the DB itself (rolled back): refuses a retirement while a credential is active / a device is owned / the actor is not an admin / the reason is missing; fix 1: a node is never BORN retired; the retiring UPDATE stamps now() and freezes identity", async () => {
    await rolledBack(async (tx) => {
      const [n] = await tx`INSERT INTO edge_nodes (code, name, "factoryCode", status) VALUES (${`${DAU}-db`}, 'db', ${F()}, 'online') RETURNING id`;
      const nodeId = Number(n.id);
      await tx`INSERT INTO edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash", status, "createdBy") VALUES (${nodeId}, 'edn_0d1200000aaa', ${HASH}, 'active', ${ids.admin})`;
      const direct = (sp: postgres.TransactionSql, by: number | null, extra = sp``) =>
        sp`UPDATE edge_nodes SET "retiredAt" = now(), "retiredBy" = ${by}, "retireReason" = 'direct write' ${extra} WHERE id = ${nodeId}`;
      expect(await spState(tx, (sp) => direct(sp, ids.admin))).toBe("23514"); // active credential
      await tx`UPDATE edge_node_credentials SET status = 'revoked', "revokedAt" = now(), "revokedBy" = ${ids.admin}, "revokeReason" = 'test' WHERE "edgeNodeId" = ${nodeId} AND status = 'active'`;
      await tx`UPDATE device_adapters SET "edgeNodeId" = ${nodeId} WHERE id = ${ids.adapter}`;
      expect(await spState(tx, (sp) => direct(sp, ids.admin))).toBe("23514"); // owned adapter
      await tx`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${ids.adapter}`;
      expect(await spState(tx, (sp) => direct(sp, ids.eng))).toBe("23514"); // not an admin
      expect(await spState(tx, (sp) => sp`UPDATE edge_nodes SET "retiredAt" = now(), "retiredBy" = ${ids.admin} WHERE id = ${nodeId}`)).toBe("23514"); // no reason (CHECK)
      // fix 1 (O-R2) — the retiring UPDATE cannot change the identity in the same statement
      expect(await spState(tx, (sp) => direct(sp, ids.admin, sp`, code = ${`${DAU}-db-free`}`))).toBe("23514");
      expect(await spState(tx, (sp) => direct(sp, ids.admin, sp`, "factoryCode" = 'OTHER'`))).toBe("23514");
      expect(await spState(tx, (sp) => direct(sp, ids.admin, sp`, "assignedLineCodes" = ${sp.json(["X"])}`))).toBe("23514");
      expect(await spState(tx, (sp) => direct(sp, ids.admin, sp`, "protocolVersion" = 2`))).toBe("23514");
      // fix 1 (O-R2) — the DB stamps the time itself: a far-future value is replaced by now()
      expect(await spState(tx, (sp) => sp`UPDATE edge_nodes SET "retiredAt" = now() + interval '10 years', "retiredBy" = ${ids.admin}, "retireReason" = 'direct write' WHERE id = ${nodeId}`)).toBeNull();
      const [r] = await tx`SELECT status::text AS s, ("retiredAt" BETWEEN now() - interval '1 minute' AND now() + interval '1 minute') AS stamped FROM edge_nodes WHERE id = ${nodeId}`;
      expect(r).toMatchObject({ s: "offline", stamped: true }); // status forced offline, time stamped
      // fix 1 (O-R1) — never BORN retired: an INSERT setting any retirement column is refused (even with a real admin, offline)
      expect(await spState(tx, (sp) => sp`INSERT INTO edge_nodes (code, name, status, "retiredAt", "retiredBy", "retireReason") VALUES (${`${DAU}-born1`}, 'b', 'online', now(), 2147483000, 'squat')`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`INSERT INTO edge_nodes (code, name, status, "retiredAt", "retiredBy", "retireReason") VALUES (${`${DAU}-born2`}, 'b', 'offline', now(), ${ids.admin}, 'a real admin')`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`INSERT INTO edge_nodes (code, name, status, "retireReason") VALUES (${`${DAU}-born3`}, 'b', 'offline', 'only a reason')`)).toBe("23514");
      expect(await spState(tx, (sp) => sp`INSERT INTO edge_nodes (code, name, status, "retiredAt") VALUES (${`${DAU}-half`}, 'half', 'offline', now())`)).toBe("23514");
    });
  });

  it("★ concurrency: an assignment racing a retirement never leaves a retired owner; L-7 — a STOP insert is not delayed by a retirement holding the node row", async () => {
    const holder = await sql.reserve();
    try {
      await holder`BEGIN`;
      await holder`UPDATE device_adapters SET "edgeNodeId" = ${FIX.nodeId} WHERE id = ${ids.adapter}`;
      const [{ pid }] = await holder`SELECT pg_backend_pid() AS pid`;
      let settled = false;
      const pending = retire(FIX.code).finally(() => (settled = true));
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
    await fixUnchanged();
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
      const pending = retire(FIX.code);
      await atLock;
      const [{ e }] = await sql`SELECT "ownerEpoch" AS e FROM device_adapters WHERE id = ${ids.adapter}`;
      const stopper = await sql.reserve();
      let stopId = 0;
      const t0 = Date.now();
      try {
        await stopper`SET lock_timeout = '1000ms'`;
        const [q] = await stopper`INSERT INTO robot_motion_lock_requests ("adapterId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "expiresAt", reason) VALUES (${ids.adapter}, ${FIX.nodeId}, ${e}, 'stop', ${ids.admin}, now() + interval '1 minute', 'dot12 O L-7') RETURNING id`;
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
      await sql`SELECT public.edge_stop_ack_edge(${stopId}, ${FIX.nodeId}, NULL::integer, ${ids.adapter}::integer, ${e}::bigint, 'done', false, NULL)`;
      await sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${ids.adapter}`;
    } finally {
      svc._setRetirePauseForTests(null);
      release?.();
    }
    await fixUnchanged();
  }, 30_000);
});
