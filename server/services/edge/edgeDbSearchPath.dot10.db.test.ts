/**
 * doc 81 Đợt 10 task A fix review 1 — ruling R-10-e: TEMP-TABLE SHADOWING of the functions of migrations 0372–0375.
 *
 * With `SET search_path = public` (or no SET at all) PostgreSQL still searches the session's pg_temp FIRST for relations, so an
 * avi_app session that created `TEMP TABLE robots / users / robot_jobs / …` steered SECURITY DEFINER and plain trigger functions
 * onto its own fake rows. The review PROVED: an owner change while a job ran with NO relock and NO history (C1), a non-admin
 * approving a trusted e-stop source (C2), a lock request for a central robot (I1).
 *
 * Every case runs as avi_app (the app role — never superuser / BYPASSRLS) in a FRESH session (a new client: the plpgsql plan
 * cache of an earlier call in the same session would hide the hole) and creates its shadow TEMP tables BEFORE the first call of
 * any guarded function. Everything happens inside one transaction that is ROLLED BACK. `_test` only.
 * Plus the catalog / source census: every function the four files define pins `search_path = pg_catalog, public, pg_temp`, is
 * not executable by PUBLIC, avi_app may EXECUTE only the callable set, and no function body names an unqualified relation.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const REPO = path.resolve(__dirname, "../../..");
/** the source census reads the migrations from here (DOT10_SQL_DIR: a copy, for RED / mutation runs only) */
const SQL_DIR = process.env.DOT10_SQL_DIR || path.join(REPO, "drizzle");
const FILES = [
  "0372_edge_step_authorizations.sql",
  "0373_edge_report_streams_and_keys.sql",
  "0374_edge_device_ownership_and_lock_authority.sql",
  "0375_edge_robot_trust_approvals.sql",
];
const SEARCH_PATH = "search_path=pg_catalog, public, pg_temp";
const CALLABLE = new Set([
  "edge_motion_lock_apply",
  "edge_motion_lock_clear",
  "edge_stop_ack_central",
  "edge_robot_trust_request",
  "edge_robot_trust_approve",
  "edge_robot_trust_revoke",
  "edge_robot_trust_is_approved",
]);

class Rollback extends Error {}
type Tx = postgres.TransactionSql;

/** A NEW avi_app session (own client), one transaction, always rolled back; the client is closed. */
async function freshSession<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
  const client = postgres(DB_URL, { max: 1, onnotice: () => {} });
  let out: T | undefined;
  try {
    const [who] = await client`SELECT current_database() AS db, r.rolsuper AS su, r.rolbypassrls AS br, current_user AS u FROM pg_roles r WHERE r.rolname = current_user`;
    if (!String(who.db).endsWith("_test") || who.su || who.br) throw new Error(`refused: ${JSON.stringify(who)} — must be avi_app on _test`);
    await client.begin(async (tx) => {
      out = await body(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await client.end({ timeout: 5 });
  }
  return out as T;
}
/** SQLSTATE of one statement inside a savepoint (null = it succeeded). */
async function code(tx: Tx, fn: (sp: Tx) => Promise<unknown>): Promise<string | null> {
  try {
    await tx.savepoint((sp) => fn(sp as Tx));
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? (e as Error).message);
  }
}
const tag = () => `__sp10_${Date.now()}_${randomBytes(3).toString("hex")}`;
const hex = (n: number) => randomBytes(n).toString("hex");

describe.skipIf(!onTest)("R-10-e — temp-table shadowing cannot steer the 0372–0375 functions (avi_app, fresh session)", () => {
  it("★ C1: shadow robot_jobs / robot_motion_locks / device_owner_changes ⇒ an owner change while a job runs is STILL refused", async () => {
    const r = await freshSession(async (tx) => {
      await tx`CREATE TEMP TABLE robot_jobs ("robotId" integer, status text) ON COMMIT DROP`;
      await tx`CREATE TEMP TABLE robot_motion_locks ("robotId" integer PRIMARY KEY, "reasonCode" text, detail text, generation integer,
                 authority text, "authorityNodeId" integer, "ownerEpoch" bigint, "lockedAt" timestamptz) ON COMMIT DROP`;
      await tx`CREATE TEMP TABLE device_owner_changes (id bigserial, "deviceKind" text, "deviceId" integer, "fromEdgeNodeId" integer,
                 "toEdgeNodeId" integer, "generationFloor" integer, "fromOwnerEpoch" bigint, "toOwnerEpoch" bigint, "changedBy" text) ON COMMIT DROP`;
      const t = tag();
      const [node] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${t}, ${t}, 'offline') RETURNING id`;
      const [robot] = await tx`INSERT INTO public.robots (code, name, vendor, endpoint) VALUES (${t}, ${t}, 'sim', 'sim://t') RETURNING id`;
      await tx`INSERT INTO public.robot_jobs ("robotId", "jobType", status) VALUES (${robot.id}, 'move', 'running')`;
      const ownerChange = await code(tx, (sp) => sp`UPDATE public.robots SET "edgeNodeId" = ${node.id} WHERE id = ${robot.id}`);
      const [after] = await tx`SELECT "edgeNodeId" AS n, "ownerEpoch" AS e FROM public.robots WHERE id = ${robot.id}`;
      return { ownerChange, owner: after.n, epoch: Number(after.e) };
    });
    expect(r).toEqual({ ownerChange: "23514", owner: null, epoch: 1 });
  }, 60_000);

  it("★ C1: with the same shadows, a permitted owner change writes the REAL relock row and the REAL WORM history", async () => {
    const r = await freshSession(async (tx) => {
      await tx`CREATE TEMP TABLE robot_jobs ("robotId" integer, status text) ON COMMIT DROP`;
      await tx`CREATE TEMP TABLE robot_motion_locks ("robotId" integer PRIMARY KEY, "reasonCode" text, detail text, generation integer,
                 authority text, "authorityNodeId" integer, "ownerEpoch" bigint, "lockedAt" timestamptz) ON COMMIT DROP`;
      await tx`CREATE TEMP TABLE device_owner_changes (id bigserial, "deviceKind" text, "deviceId" integer, "fromEdgeNodeId" integer,
                 "toEdgeNodeId" integer, "generationFloor" integer, "fromOwnerEpoch" bigint, "toOwnerEpoch" bigint, "changedBy" text) ON COMMIT DROP`;
      await tx`CREATE TEMP TABLE robot_motion_lock_requests (id serial, "robotId" integer, "adapterId" integer, "edgeNodeId" integer, "ownerEpoch" bigint,
                 kind text, "expectedGeneration" integer, reason text, "requestedBy" integer, "createdAt" timestamptz, "expiresAt" timestamptz,
                 "deliveredAt" timestamptz, "ackedAt" timestamptz, "ackGeneration" integer, outcome text) ON COMMIT DROP`;
      const t = tag();
      const [node] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${t}, ${t}, 'offline') RETURNING id`;
      const [robot] = await tx`INSERT INTO public.robots (code, name, vendor, endpoint) VALUES (${t}, ${t}, 'sim', 'sim://t') RETURNING id`;
      const ownerChange = await code(tx, (sp) => sp`UPDATE public.robots SET "edgeNodeId" = ${node.id} WHERE id = ${robot.id}`);
      const [lock] = await tx`SELECT authority, "ownerEpoch" AS e, "reasonCode" AS rc FROM public.robot_motion_locks WHERE "robotId" = ${robot.id}`;
      const [hist] = await tx`SELECT count(*)::int AS n FROM public.device_owner_changes WHERE "deviceKind" = 'robot' AND "deviceId" = ${robot.id}`;
      const [tl] = await tx`SELECT count(*)::int AS n FROM pg_temp.robot_motion_locks`;
      const [th] = await tx`SELECT count(*)::int AS n FROM pg_temp.device_owner_changes`;
      return { ownerChange, lock: lock ? { authority: lock.authority, epoch: Number(lock.e), rc: lock.rc } : null, hist: hist.n, tempLock: tl.n, tempHist: th.n, node: node.id };
    });
    expect(r).toEqual({ ownerChange: null, lock: { authority: `edge:${r.node}`, epoch: 2, rc: "ownerChanged" }, hist: 1, tempLock: 0, tempHist: 0, node: r.node });
  }, 60_000);

  it("★ C2: a shadow `users` (made BEFORE any call) never lets an inactive non-admin approve a trusted e-stop source", async () => {
    const r = await freshSession(async (tx) => {
      await tx`CREATE TEMP TABLE users (id integer, role text, "isActive" boolean) ON COMMIT DROP`;
      await tx`CREATE TEMP TABLE robots (id integer, "edgeNodeId" integer, "ownerEpoch" bigint) ON COMMIT DROP`;
      const t = tag();
      const [node] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${t}, ${t}, 'offline') RETURNING id`;
      const [robot] = await tx`INSERT INTO public.robots (code, name, vendor, endpoint, "edgeNodeId") VALUES (${t}, ${t}, 'sim', 'sim://t', ${node.id}) RETURNING id`;
      const [maker] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${t + "-m"}, 'admin', true) RETURNING id`;
      const [nonAdmin] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${t + "-x"}, 'user', false) RETURNING id`;
      await tx`INSERT INTO pg_temp.users VALUES (${maker.id}, 'admin', true), (${nonAdmin.id}, 'admin', true)`;
      await tx`INSERT INTO pg_temp.robots VALUES (${robot.id}, ${node.id}, 1)`;
      const D = hex(32);
      const request = await code(tx, (sp) => sp`SELECT public.edge_robot_trust_request(${node.id}, ${robot.id}, ${D}, ${maker.id})`);
      const approve = await code(tx, (sp) => sp`SELECT public.edge_robot_trust_approve(${node.id}, ${robot.id}, ${D}, ${nonAdmin.id})`);
      const [row] = await tx`SELECT "approvedBy" AS a FROM public.edge_robot_trust_approvals WHERE "edgeNodeId" = ${node.id} AND "robotId" = ${robot.id}`;
      const [ok] = await tx`SELECT public.edge_robot_trust_is_approved(${node.id}, ${robot.id}, ${D}) AS ok`;
      return { request, approve, approvedBy: row ? row.a : "no-row", isApproved: ok.ok };
    });
    expect(r).toEqual({ request: null, approve: "23514", approvedBy: null, isApproved: false });
  }, 60_000);

  it("★ I1 (invoker trigger, the reviewer's probe3): a shadow `robots` never lets avi_app request a lock for a CENTRAL robot", async () => {
    const r = await freshSession(async (tx) => {
      await tx`CREATE TEMP TABLE robots (id integer, "edgeNodeId" integer, "ownerEpoch" bigint) ON COMMIT DROP`;
      const t = tag();
      const [node] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${t}, ${t}, 'offline') RETURNING id`;
      const [robot] = await tx`INSERT INTO public.robots (code, name, vendor, endpoint) VALUES (${t}, ${t}, 'sim', 'sim://t') RETURNING id`;
      await tx`INSERT INTO pg_temp.robots VALUES (${robot.id}, ${node.id}, 1)`;
      const req = await code(
        tx,
        (sp) => sp`INSERT INTO public.robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "expiresAt")
                   VALUES (${robot.id}, ${node.id}, 1, 'lock', 1, now() + interval '1 minute')`,
      );
      const [n] = await tx`SELECT count(*)::int AS n FROM public.robot_motion_lock_requests WHERE "robotId" = ${robot.id}`;
      return { req, rows: n.n };
    });
    expect(r).toEqual({ req: "23514", rows: 0 });
  }, 60_000);

  it("★ I1 (write guard): a shadow `robots` saying 'central' never lets avi_app write a central lock row for an EDGE-owned robot", async () => {
    const r = await freshSession(async (tx) => {
      await tx`CREATE TEMP TABLE robots (id integer, "edgeNodeId" integer, "ownerEpoch" bigint, "motionLockGenerationFloor" integer) ON COMMIT DROP`;
      const t = tag();
      const [node] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${t}, ${t}, 'offline') RETURNING id`;
      const [robot] = await tx`INSERT INTO public.robots (code, name, vendor, endpoint) VALUES (${t}, ${t}, 'sim', 'sim://t') RETURNING id`;
      await tx`UPDATE public.robots SET "edgeNodeId" = ${node.id} WHERE id = ${robot.id}`;
      const [rb] = await tx`SELECT "ownerEpoch" AS e, "motionLockGenerationFloor" AS f FROM public.robots WHERE id = ${robot.id}`;
      await tx`INSERT INTO pg_temp.robots VALUES (${robot.id}, NULL, ${rb.e}, 0)`;
      const cleared = (await tx`SELECT public.edge_motion_lock_clear(${robot.id}, ${node.id}, ${rb.e}::bigint, ${rb.f}) AS n`)[0].n;
      const direct = await code(tx, (sp) => sp`INSERT INTO public.robot_motion_locks ("robotId", "reasonCode", generation) VALUES (${robot.id}, 'probe', 1)`);
      return { cleared, direct };
    });
    expect(r).toEqual({ cleared: 1, direct: "23514" });
  }, 60_000);

  it("★ I1 (program report): a shadow `device_adapters` never lets a node report a program checksum for an adapter it does not own", async () => {
    const r = await freshSession(async (tx) => {
      await tx`CREATE TEMP TABLE device_adapters (id integer, "edgeNodeId" integer, "ownerEpoch" bigint) ON COMMIT DROP`;
      const t = tag();
      const [node] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${t}, ${t}, 'offline') RETURNING id`;
      const [ad] = await tx`INSERT INTO public.device_adapters (code, name, protocol, endpoint) VALUES (${t}, ${t}, 'stub', 'stub://t') RETURNING id`;
      await tx`INSERT INTO pg_temp.device_adapters VALUES (${ad.id}, ${node.id}, 1)`;
      const rep = await code(
        tx,
        (sp) => sp`INSERT INTO public.edge_node_program_reports ("edgeNodeId", "adapterId", status, checksum, "readAt") VALUES (${node.id}, ${ad.id}, 'verified', 'x', now())`,
      );
      return { rep };
    });
    expect(r).toEqual({ rep: "23514" });
  }, 60_000);

  it("★ I1 (0372 insert guard): a shadow assignment / credential table never yields an authorisation for a run not under a current claim", async () => {
    const r = await freshSession(async (tx) => {
      await tx`CREATE TEMP TABLE orchestration_run_edge_assignments ("runId" integer, "edgeNodeId" integer, "claimSeq" integer, "claimTokenHash" text) ON COMMIT DROP`;
      await tx`CREATE TEMP TABLE edge_node_credentials (id integer, "edgeNodeId" integer) ON COMMIT DROP`;
      const t = tag();
      const [node] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${t}, ${t}, 'offline') RETURNING id`;
      const [cred] = await tx`INSERT INTO public.edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${node.id}, ${"edn_" + hex(6)}, ${hex(32)}) RETURNING id`;
      const [wf] = await tx`INSERT INTO public.orchestration_workflows (ref, name, "definitionJson", "scopeKey") VALUES (${t}, ${t}, ${tx.json({ ref: t, name: t, steps: [] })}, ${t}) RETURNING id`;
      const [run] = await tx`INSERT INTO public.orchestration_runs ("workflowId", status) VALUES (${wf.id}, 'queued') RETURNING id`;
      await tx`INSERT INTO public.orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash") VALUES (${run.id}, ${node.id}, ${wf.id}, 1, ${hex(32)})`;
      // the REAL assignment is NOT claimed; the shadow says claim 1 is current, and a second node's credential "belongs" to it
      await tx`INSERT INTO pg_temp.orchestration_run_edge_assignments VALUES (${run.id}, ${node.id}, 1, ${hex(32)})`;
      await tx`INSERT INTO pg_temp.edge_node_credentials VALUES (${cred.id}, ${node.id})`;
      const auth = await code(
        tx,
        (sp) => sp`INSERT INTO public.edge_step_authorizations (jti, "edgeNodeId", "credentialId", "runId", "claimSeq", "stepId", attempt, "idempotencyKey", kind,
                     "payloadHash", "verdictJson", kid, "reqNonceHash", "issuedAt", "expiresAt")
                   VALUES (gen_random_uuid(), ${node.id}, ${cred.id}, ${run.id}, 1, 'm1', 1, 'foe:m1:1', 'robot', ${"sha256:" + hex(32)}, ${tx.json({})},
                     ${"edk_" + "A".repeat(22)}, ${hex(32)}, now(), now() + interval '10 seconds')`,
      );
      return { auth };
    });
    expect(r).toEqual({ auth: "23514" });
  }, 60_000);
});

describe.skipIf(!onTest)("R-10-e — catalog census of every function 0372–0375 define (as avi_app)", () => {
  it("search_path pinned (pg_temp LAST), no PUBLIC EXECUTE, avi_app EXECUTE only on the callable set", async () => {
    const names = new Set<string>();
    for (const f of FILES) {
      for (const m of readFileSync(path.join(REPO, "drizzle", f), "utf8").matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)) names.add(m[1]);
    }
    expect(names.size).toBe(22); // 0372: 2 · 0373: 2 · 0374: 13 · 0375: 5 — a new function must be added here on purpose
    const rows = await freshSession(async (tx) =>
      tx`SELECT p.proname AS name, p.proconfig AS cfg, has_function_privilege('public', p.oid, 'EXECUTE') AS pub,
                has_function_privilege(current_user, p.oid, 'EXECUTE') AS app
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ANY(${[...names]})`,
    );
    const bad = [...names].flatMap((name) => {
      const r = rows.filter((x) => x.name === name);
      if (r.length !== 1) return [`${name}: ${r.length} definitions`];
      const out: string[] = [];
      if (JSON.stringify(r[0].cfg) !== JSON.stringify([SEARCH_PATH])) out.push(`${name}: proconfig ${JSON.stringify(r[0].cfg)}`);
      if (r[0].pub) out.push(`${name}: PUBLIC EXECUTE`);
      if (r[0].app !== CALLABLE.has(name)) out.push(`${name}: avi_app EXECUTE ${r[0].app}`);
      return out;
    });
    expect(bad).toEqual([]);
  }, 60_000);
});

describe("R-10-e — source census: no function body of 0372–0375 names an unqualified relation", () => {
  it("every FROM / JOIN / UPDATE / INSERT INTO / DELETE FROM inside $$ … $$ is public.* or pg_catalog.*; every CREATE FUNCTION is public.*", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(path.join(SQL_DIR, f), "utf8");
      for (const m of src.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-z_."]+)\s*\(/gi)) if (!m[1].startsWith("public.")) bad.push(`${f}: CREATE FUNCTION ${m[1]}`);
      for (const m of src.matchAll(/EXECUTE\s+FUNCTION\s+([a-z_."]+)\s*\(/gi)) if (!m[1].startsWith("public.")) bad.push(`${f}: EXECUTE FUNCTION ${m[1]}`);
      const bodies = [...src.matchAll(/AS \$\$([\s\S]*?)\$\$/g)].map((m) => m[1]);
      expect(bodies.length, f).toBeGreaterThan(0);
      for (const body of bodies) {
        const code = body.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
        const refs = [
          ...code.matchAll(/\b(?:FROM|JOIN|UPDATE)\s+(?!public\.|pg_catalog\.)("?[A-Za-z_][A-Za-z0-9_]*"?)/gi),
          ...code.matchAll(/\bINSERT\s+INTO\s+(?!public\.)("?[A-Za-z_][A-Za-z0-9_]*"?)/gi),
        ]
          .filter((m) => !/(DISTINCT|DO)\s+$/i.test(code.slice(Math.max(0, (m.index ?? 0) - 12), m.index)))
          .map((m) => m[1]);
        for (const r of refs) bad.push(`${f}: unqualified ${r}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
