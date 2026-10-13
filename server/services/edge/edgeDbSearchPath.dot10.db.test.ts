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
  "edge_stop_record_central_execution",
  "ot_write_intent_resolve",
  "ot_write_late_result_review",
  "edge_stop_ack_edge",
  "edge_stop_resolve",
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
    expect(names.size).toBe(37); // 0372: 2 · 0373: 3 · 0374: 27 · 0375: 5 — a new function must be added here on purpose
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

/** fix review 3 (N3): the relation census also covers 0376 (it re-creates the 0316 / 0363–0371 functions) */
const REL_FILES = [...FILES, "0376_pin_function_search_path.sql"];
const QUALIFIED = /^(public|pg_catalog|"public"|"pg_catalog")\./i;
/**
 * Every relation reference in the routine BODIES of one migration that is not schema-qualified, plus every dynamic `EXECUTE`
 * (a string built at run time can name anything — banned in these bodies). fix review 3 (N3 — hardened): any dollar tag
 * ($$, $fn$, $body1$); comma joins (every item of a FROM list); FROM / JOIN / UPDATE / INSERT INTO / DELETE FROM / LOCK TABLE /
 * TRUNCATE / COPY; `IS DISTINCT FROM`, `ON CONFLICT … DO UPDATE`, `FOR UPDATE / SHARE` are not relations.
 */
export function unqualifiedRelationsOf(src: string): string[] {
  const bad: string[] = [];
  for (const m of src.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([A-Za-z_."]+)\s*\(/gi)) if (!/^("?public"?)\./i.test(m[1])) bad.push(`CREATE FUNCTION ${m[1]}`);
  for (const m of src.matchAll(/EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+([A-Za-z_."]+)\s*\(/gi)) if (!/^("?public"?)\./i.test(m[1])) bad.push(`EXECUTE FUNCTION ${m[1]}`);
  const bodies = [...src.matchAll(/\bAS\s+(\$([A-Za-z_][A-Za-z0-9_]*)?\$)([\s\S]*?)\1/g)].map((m) => m[3]);
  // fix review 4 (re-review R1): a single-quoted body (`AS 'SELECT … FROM users'`) is a body too ('' ⇒ ')
  for (const m of src.matchAll(/\bAS\s+'((?:[^']|'')*)'/g)) bodies.push(m[1].replace(/''/g, "'"));
  for (const body of bodies) {
    const noComments = body.replace(/--[^\n]*/g, "");
    const code = noComments.replace(/'(?:[^']|'')*'/g, "''"); // string literals out first (a message may say "execute")
    for (const m of code.matchAll(/\bEXECUTE\s+(?!FUNCTION\b|PROCEDURE\b)/gi)) bad.push(`dynamic EXECUTE at …${code.slice(m.index ?? 0, (m.index ?? 0) + 40).replace(/\s+/g, " ")}`);
    const notRel = (at: number) => /(DISTINCT|DO|FOR)\s+$/i.test(code.slice(Math.max(0, at - 12), at));
    // single-target statements
    for (const m of code.matchAll(/\b(JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM|LOCK\s+TABLE|TRUNCATE(?:\s+TABLE)?|COPY)\s+(?:ONLY\s+)?([^\s(,;]+)/gi)) {
      if (notRel(m.index ?? 0)) continue;
      if (/^(UPDATE)$/i.test(m[1]) && /^SET$/i.test(m[2])) continue; // DO UPDATE SET handled by notRel; a bare "UPDATE SET" cannot occur
      if (!QUALIFIED.test(m[2])) bad.push(`unqualified ${m[2]} (${m[1].toUpperCase()})`);
    }
    // FROM lists: EVERY comma-separated item (a comma join hides its 2nd relation from a "next token" check)
    for (const m of code.matchAll(/\bFROM\b/gi)) {
      const at = m.index ?? 0;
      if (notRel(at) || /DELETE\s+$/i.test(code.slice(Math.max(0, at - 8), at))) continue;
      let i = at + 4;
      let depth = 0;
      let item = "";
      const items: string[] = [];
      for (; i < code.length; i++) {
        const ch = code[i];
        if (ch === "(") depth++;
        if (ch === ")") {
          if (depth === 0) break;
          depth--;
        }
        if (depth === 0 && (ch === ";" || /^\s(WHERE|GROUP|ORDER|LIMIT|HAVING|JOIN|LEFT|RIGHT|INNER|FULL|CROSS|ON|UNION|EXCEPT|INTERSECT|FOR|RETURNING|WINDOW|INTO|LOOP|THEN)\b/i.test(code.slice(i, i + 12)))) break;
        if (depth === 0 && ch === ",") {
          items.push(item);
          item = "";
        } else item += ch;
      }
      items.push(item);
      for (const it of items.map((x) => x.trim()).filter(Boolean)) {
        if (it.startsWith("(") || /^LATERAL\b/i.test(it)) continue; // sub-query
        const first = it.split(/\s+/)[0];
        if (/^[A-Za-z_][\w.]*\(/.test(it) || /^[A-Za-z_][\w]*\s*\(/.test(it)) continue; // a function call (never resolved in pg_temp)
        if (!QUALIFIED.test(first)) bad.push(`unqualified ${first} (FROM list)`);
      }
    }
  }
  return bad;
}

describe("R-10-e — source census: no function body of 0372–0376 names an unqualified relation", () => {
  it("every relation in a routine body is public.* or pg_catalog.*; every CREATE / EXECUTE FUNCTION is public.*; no dynamic EXECUTE", () => {
    const bad: string[] = [];
    for (const f of REL_FILES) {
      const src = readFileSync(path.join(SQL_DIR, f), "utf8");
      expect([...src.matchAll(/\bAS\s+\$([A-Za-z_][A-Za-z0-9_]*)?\$/g)].length, f).toBeGreaterThan(0);
      for (const b of unqualifiedRelationsOf(src)) bad.push(`${f}: ${b}`);
    }
    expect(bad).toEqual([]);
  });

  it("★ fix review 3 (N3): each form the re-review listed turns the census RED; qualified forms stay green", () => {
    const fn = (body: string, tag = "$$") => `CREATE OR REPLACE FUNCTION public.f() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS ${tag}\nBEGIN\n${body}\nEND ${tag};`;
    expect(unqualifiedRelationsOf(fn(`PERFORM 1 FROM public."robots" rr, "robot_jobs" j WHERE j."robotId" = rr.id;`))).toEqual(["unqualified \"robot_jobs\" (FROM list)"]); // comma join
    expect(unqualifiedRelationsOf(fn(`EXECUTE 'LOCK TABLE robot_jobs IN SHARE MODE';`))).toHaveLength(1); // dynamic EXECUTE
    expect(unqualifiedRelationsOf(fn(`EXECUTE format('SELECT 1 FROM %I', 'robots');`))).toHaveLength(1);
    expect(unqualifiedRelationsOf(fn(`PERFORM 1 FROM robots;`, "$body1$"))).toEqual(["unqualified robots (FROM list)"]); // $tag1$
    expect(unqualifiedRelationsOf(fn(`LOCK TABLE robot_jobs IN SHARE MODE;`))).toEqual(["unqualified robot_jobs (LOCK TABLE)"]);
    expect(unqualifiedRelationsOf(fn(`DELETE FROM robot_jobs WHERE false;`))).toEqual(["unqualified robot_jobs (DELETE FROM)"]);
    expect(unqualifiedRelationsOf(fn(`UPDATE robot_jobs SET status = 'x';`))).toEqual(["unqualified robot_jobs (UPDATE)"]);
    expect(unqualifiedRelationsOf(fn(`PERFORM 1 FROM public."a" x JOIN "b" y ON true;`))).toEqual(["unqualified \"b\" (JOIN)"]);
    expect(unqualifiedRelationsOf(`CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;`)).toEqual(["CREATE FUNCTION f"]);
    // fix review 4 (R1): a single-quoted body is scanned
    expect(unqualifiedRelationsOf(`CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql SET search_path = pg_catalog, public, pg_temp AS 'SELECT count(*)::int FROM users';`)).toEqual(["unqualified users (FROM list)"]);
    expect(unqualifiedRelationsOf(`CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS 'SELECT count(*)::int FROM public."users" WHERE x = ''a''';`)).toEqual([]);
    // green: qualified, a function in FROM, a sub-query, IS DISTINCT FROM, ON CONFLICT DO UPDATE, FOR UPDATE / SHARE
    expect(
      unqualifiedRelationsOf(
        fn(
          `PERFORM 1 FROM public."robots" r, unnest(ARRAY[1]) u, (SELECT 1) s WHERE NEW."a" IS DISTINCT FROM OLD."a";\n` +
            `INSERT INTO public."t" AS t (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = 1;\nSELECT 1 INTO x FROM public."robots" WHERE true FOR SHARE;\nPERFORM 1 FROM pg_catalog.pg_class c;`,
        ),
      ),
    ).toEqual([]);
  });
});
