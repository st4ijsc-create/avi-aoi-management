/**
 * doc 81 Đợt 10 task A fix review 2 — ruling R-10-h: mig 0376 pins the search_path of every function migrations 0363–0371
 * created (they are on DEV already, so they are re-created by a NEW migration, never edited in place).
 *
 * (1) BEHAVIOUR as avi_app in a FRESH session (a new client — the plpgsql plan cache of an earlier call would hide the hole),
 *     the shadow TEMP tables created BEFORE the first call: every 0363–0371 guard that reads / writes a table still enforces its
 *     rule against the REAL table (api key holder history, assignment insert guard, claim credential check, run workflow pin).
 *     Everything inside one transaction that is ROLLED BACK. `_test` only.
 * (2) CATALOG: every function defined by a drizzle/*.sql numbered ≥ 0363 runs with EXACTLY
 *     `search_path = pg_catalog, public, pg_temp` and is not executable by PUBLIC (unless it is in the callable set).
 * (3) SOURCE CENSUS: for every function a drizzle/*.sql numbered ≥ 0363 defines, its LAST definition in migration order
 *     (CREATE OR REPLACE, or a later ALTER FUNCTION … SET search_path) carries `SET search_path = pg_catalog, public, pg_temp`.
 *     A new migration defining a function without it fails here. (0363–0371 are already on dev — 0376 re-creates their
 *     functions; their original text stays as history.)
 */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const REPO = path.resolve(__dirname, "../../..");
/** the census reads the migrations from here (DOT10_SQL_DIR: a copy, for RED / mutation runs only) */
const SQL_DIR = process.env.DOT10_SQL_DIR || path.join(REPO, "drizzle");
const PIN = "search_path=pg_catalog, public, pg_temp";
/** functions avi_app calls directly (everything else ≥ 0363 is a trigger function: EXECUTE for nobody) */
const CALLABLE = new Set([
  "edge_motion_lock_apply",
  "edge_motion_lock_clear",
  "edge_stop_ack_central",
  "edge_stop_record_central_execution",
  "edge_stop_ack_edge",
  "edge_stop_resolve",
  "edge_robot_trust_request",
  "edge_robot_trust_approve",
  "edge_robot_trust_revoke",
  "edge_robot_trust_is_approved",
]);

/**
 * 0125's SECURITY DEFINER RLS helpers, re-pinned by 0376 with ALTER FUNCTION: RLS policies call them as WHICHEVER role reads the
 * hot tables, so they stay PUBLIC-executable on purpose (body already public.-qualified; pg_temp last).
 */
const PUBLIC_BY_DESIGN = new Set(["app_factory_of_machine_code", "app_factory_of_line_id", "app_factory_of_line_code"]);

class Rollback extends Error {}
type Tx = postgres.TransactionSql;
async function freshSession<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
  const client = postgres(DB_URL, { max: 1, onnotice: () => {} });
  let out: T | undefined;
  try {
    const [who] = await client`SELECT current_database() AS db, r.rolsuper AS su, r.rolbypassrls AS br FROM pg_roles r WHERE r.rolname = current_user`;
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
async function code(tx: Tx, fn: (sp: Tx) => Promise<unknown>): Promise<string | null> {
  try {
    await tx.savepoint((sp) => fn(sp as Tx));
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? (e as Error).message);
  }
}
const hex = (n: number) => randomBytes(n).toString("hex");
const tag = () => `__sp76_${Date.now()}_${hex(3)}`;
async function runFixture(tx: Tx) {
  const t = tag();
  const [node] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${t}, ${t}, 'offline') RETURNING id`;
  const [node2] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${t + "b"}, ${t}, 'offline') RETURNING id`;
  const [cred2] = await tx`INSERT INTO public.edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${node2.id}, ${"edn_" + hex(6)}, ${hex(32)}) RETURNING id`;
  const [wf] = await tx`INSERT INTO public.orchestration_workflows (ref, name, "definitionJson", "scopeKey") VALUES (${t}, ${t}, ${tx.json({ ref: t, name: t, steps: [] })}, ${t}) RETURNING id`;
  const [wf2] = await tx`INSERT INTO public.orchestration_workflows (ref, name, "definitionJson", "scopeKey") VALUES (${t + "2"}, ${t}, ${tx.json({ ref: t + "2", name: t, steps: [] })}, ${t + "2"}) RETURNING id`;
  const [run] = await tx`INSERT INTO public.orchestration_runs ("workflowId", status) VALUES (${wf.id}, 'queued') RETURNING id`;
  return { node: node.id as number, node2: node2.id as number, cred2: cred2.id as number, wf: wf.id as number, wf2: wf2.id as number, run: run.id as number };
}

describe.skipIf(!onTest)("R-10-h — 0363–0371 guards hold against temp-table shadowing (avi_app, fresh session)", () => {
  it("★ 0369 api_keys_holder_history: a shadow `api_key_holder_changes` never swallows the holder history", async () => {
    const r = await freshSession(async (tx) => {
      await tx`CREATE TEMP TABLE api_key_holder_changes ("apiKeyId" integer, "fromUserId" integer, "toUserId" integer, "changedBy" integer, reason text) ON COMMIT DROP`;
      const t = tag();
      const [u1] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${t + "-1"}, 'admin', true) RETURNING id`;
      const [u2] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${t + "-2"}, 'user', true) RETURNING id`;
      const [k] = await tx`INSERT INTO public.api_keys (name, "keyHash", scopes, "createdBy", "holderUserId") VALUES (${t}, ${t + "-hash"}, ${tx.json(["orchestration:write"])}, ${u1.id}, ${u1.id}) RETURNING id`;
      await tx`UPDATE public.api_keys SET "holderUserId" = ${u2.id} WHERE id = ${k.id}`;
      const [real] = await tx`SELECT count(*)::int AS n FROM public.api_key_holder_changes WHERE "apiKeyId" = ${k.id}`;
      const [shadow] = await tx`SELECT count(*)::int AS n FROM pg_temp.api_key_holder_changes`;
      return { real: real.n, shadow: shadow.n };
    });
    expect(r).toEqual({ real: 2, shadow: 0 });
  }, 60_000);

  it("★ 0370 edge_run_assignment_insert_guard: a shadow `orchestration_runs` never lets a NON-queued run be assigned", async () => {
    const r = await freshSession(async (tx) => {
      await tx`CREATE TEMP TABLE orchestration_runs (id integer, "workflowId" integer, status text) ON COMMIT DROP`;
      const f = await runFixture(tx);
      await tx`UPDATE public.orchestration_runs SET status = 'running' WHERE id = ${f.run}`;
      await tx`INSERT INTO pg_temp.orchestration_runs VALUES (${f.run}, ${f.wf}, 'queued')`;
      return code(tx, (sp) => sp`INSERT INTO public.orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash") VALUES (${f.run}, ${f.node}, ${f.wf}, 1, ${hex(32)})`);
    });
    expect(r).toBe("23514");
  }, 60_000);

  it("★ 0370 edge_run_assignment_guard: a shadow `edge_node_credentials` never lets a claim name ANOTHER node's credential", async () => {
    const r = await freshSession(async (tx) => {
      await tx`CREATE TEMP TABLE edge_node_credentials (id integer, "edgeNodeId" integer) ON COMMIT DROP`;
      const f = await runFixture(tx);
      await tx`INSERT INTO public.orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash") VALUES (${f.run}, ${f.node}, ${f.wf}, 1, ${hex(32)})`;
      await tx`INSERT INTO pg_temp.edge_node_credentials VALUES (${f.cred2}, ${f.node})`; // the shadow claims node2's credential is node's
      return code(tx, (sp) => sp`UPDATE public.orchestration_run_edge_assignments SET "claimSeq" = 1, "claimTokenHash" = ${hex(32)}, "claimedByCredentialId" = ${f.cred2}, "claimedAt" = now() WHERE "runId" = ${f.run}`);
    });
    expect(r).toBe("23514");
  }, 60_000);

  it("★ 0316 kiem_xac_thuc_noi_bo (fix review 3, N4): a shadow `user_secrets` never lets a user WITH a password hash switch to oauth", async () => {
    const r = await freshSession(async (tx) => {
      await tx`CREATE TEMP TABLE user_secrets ("userId" integer, "passwordHash" text) ON COMMIT DROP`;
      const t = tag();
      const [u] = await tx`INSERT INTO public.users ("openId", role, "isActive", "loginMethod") VALUES (${t}, 'user', true, 'local') RETURNING id`;
      await tx`INSERT INTO public.user_secrets ("userId", "passwordHash") VALUES (${u.id}, '$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyzABCDE')`;
      const oauth = await code(tx, (sp) => sp`UPDATE public.users SET "loginMethod" = 'oauth' WHERE id = ${u.id}`);
      const password = await code(tx, (sp) => sp`UPDATE public.users SET "loginMethod" = 'password' WHERE id = ${u.id}`);
      return { oauth, password };
    });
    expect(r).toEqual({ oauth: "23514", password: null });
  }, 60_000);

  it("★ 0370 orch_runs_edge_workflow_pinned: a shadow (empty) assignments table never unpins the workflow of an assigned run", async () => {
    const r = await freshSession(async (tx) => {
      await tx`CREATE TEMP TABLE orchestration_run_edge_assignments ("runId" integer) ON COMMIT DROP`;
      const f = await runFixture(tx);
      await tx`INSERT INTO public.orchestration_run_edge_assignments ("runId", "edgeNodeId", "workflowId", "workflowVersion", "defHash") VALUES (${f.run}, ${f.node}, ${f.wf}, 1, ${hex(32)})`;
      return code(tx, (sp) => sp`UPDATE public.orchestration_runs SET "workflowId" = ${f.wf2} WHERE id = ${f.run}`);
    });
    expect(r).toBe("23514");
  }, 60_000);
});

const PIN_LIST = "pg_catalog,public,pg_temp";
/** `SET search_path = …` / `SET search_path TO …` (quoted or not) ⇒ the exact list, normalised; null when no such clause. */
function searchPathIn(options: string): string | null | "unpinned" {
  let last: string | null | "unpinned" = null;
  for (const m of options.matchAll(/\b(RESET\s+(?:search_path|ALL)\b|SET\s+search_path\s+FROM\s+CURRENT\b|SET\s+search_path\s*(?:=|\bTO\b)\s*((?:\s*(?:"[^"]*"|'[^']*'|[A-Za-z_$][\w$]*)\s*,?)+))/gi)) {
    if (/^RESET|FROM\s+CURRENT/i.test(m[1])) last = "unpinned";
    else last = m[2].replace(/["'\s]/g, "").replace(/,+$/, "").toLowerCase();
  }
  return last;
}
/** where a routine body starts (index into `text` from `from`), its kind, and where the statement's trailing options end */
function bodyOf(text: string, from: number): { headerEnd: number; trailer: string; next: number } {
  const re = /\bAS\s+(\$([A-Za-z_][A-Za-z0-9_]*)?\$|')|\bBEGIN\s+ATOMIC\b|\bRETURN\s/gi;
  re.lastIndex = from;
  const m = re.exec(text);
  if (!m) return { headerEnd: text.length, trailer: "", next: text.length };
  if (/^BEGIN|^RETURN/i.test(m[0])) {
    // SQL-standard body: options must precede it; the statement ends at the END; / ; that closes it
    const close = /\bEND\s*;|;/gi;
    close.lastIndex = m.index;
    const c = close.exec(text);
    return { headerEnd: m.index, trailer: "", next: c ? c.index + c[0].length : text.length };
  }
  let i = m.index + m[0].length;
  if (m[1] === "'") {
    for (; i < text.length; i++) {
      if (text[i] === "'" && text[i + 1] === "'") i++;
      else if (text[i] === "'") break;
    }
    i++;
  } else {
    const tag = m[1];
    const e = text.indexOf(tag, i);
    i = e < 0 ? text.length : e + tag.length;
  }
  const semi = text.indexOf(";", i);
  const stop = semi < 0 ? text.length : semi;
  return { headerEnd: m.index, trailer: text.slice(i, stop), next: stop + 1 };
}
const nameOf = (raw: string) => (raw.startsWith('"') ? raw.slice(1, -1) : raw.toLowerCase());

/**
 * The pin state of each routine after applying `sources` in order. fix review 3 (N3 — hardened): CREATE [OR REPLACE] FUNCTION
 * and PROCEDURE; any dollar tag ($$, $fn$, $body1$), a single-quoted body, a SQL-standard BEGIN ATOMIC / RETURN body; options
 * before AND after the body; `SET search_path = …` and `SET search_path TO …` (quoted or not) — pinned only when the list is
 * EXACTLY pg_catalog, public, pg_temp (an extra schema is unpinned); ALTER FUNCTION / PROCEDURE / ROUTINE … SET | RESET
 * search_path | RESET ALL | SET search_path FROM CURRENT.
 */
export function pinStateOf(sources: ReadonlyArray<readonly [file: string, text: string]>): Map<string, { file: string; pinned: boolean }> {
  const last = new Map<string, { file: string; pinned: boolean }>();
  const NAME = String.raw`(?:public\.|"public"\.)?("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)`;
  for (const [f, text] of sources) {
    const src = text.replace(/--[^\n]*/g, "");
    const events: Array<{ at: number; name: string; pinned: boolean }> = [];
    for (const m of src.matchAll(new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+${NAME}\s*\(`, "gi"))) {
      const b = bodyOf(src, (m.index ?? 0) + m[0].length);
      const sp = searchPathIn(src.slice((m.index ?? 0) + m[0].length, b.headerEnd) + " " + b.trailer);
      events.push({ at: m.index ?? 0, name: nameOf(m[1]), pinned: sp === PIN_LIST });
    }
    for (const m of src.matchAll(new RegExp(String.raw`ALTER\s+(?:FUNCTION|PROCEDURE|ROUTINE)\s+${NAME}\s*(?:\([^)]*\))?([^;]*);`, "gi"))) {
      const sp = searchPathIn(m[2]);
      if (sp !== null) events.push({ at: m.index ?? 0, name: nameOf(m[1]), pinned: sp === PIN_LIST });
    }
    for (const e of events.sort((a, b) => a.at - b.at)) last.set(e.name, { file: f, pinned: e.pinned });
  }
  return last;
}
/**
 * fix review 4 (re-review R2): every function ANY migration (all numbers, not only ≥ 0363) hooks to a trigger (`EXECUTE
 * FUNCTION x()`) or creates SECURITY DEFINER — the functions that must stay pinned. Removing the re-creation that pinned one
 * (e.g. 0376's 0316 block) leaves the LAST state at the old, unpinned definition ⇒ the census turns red.
 */
export function requiredPinned(sources: ReadonlyArray<readonly [file: string, text: string]>): Map<string, string> {
  const need = new Map<string, string>();
  for (const [f, t] of sources) {
    const src = t.replace(/--[^\n]*/g, "");
    for (const m of src.matchAll(/EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*\(/gi)) need.set(nameOf(m[1]), f);
    for (const m of src.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?:public\.)?("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*\(/gi)) {
      const b = bodyOf(src, (m.index ?? 0) + m[0].length);
      if (/\bSECURITY\s+DEFINER\b/i.test(src.slice((m.index ?? 0) + m[0].length, b.headerEnd) + " " + b.trailer)) need.set(nameOf(m[1]), f);
    }
  }
  return need;
}
export function allMigrations(dir: string): Array<readonly [string, string]> {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((f) => [f, readFileSync(path.join(dir, f), "utf8")] as const);
}

/** The migrations numbered ≥ 0363 of `dir`, in order, and the pin state of every function they define. */
export function migrationFunctionCensus(dir: string): { files: string[]; last: Map<string, { file: string; pinned: boolean }> } {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 363)
    .sort();
  return { files, last: pinStateOf(files.map((f) => [f, readFileSync(path.join(dir, f), "utf8")] as const)) };
}

describe("R-10-h — census: every function a migration ≥ 0363 defines ends PINNED", () => {
  it("the LAST definition (in migration order) of each function carries SET search_path = pg_catalog, public, pg_temp", () => {
    const { files, last } = migrationFunctionCensus(SQL_DIR);
    expect(files.length).toBeGreaterThanOrEqual(14); // 0363 … 0376 — 0 files ⇒ the instrument is blind
    expect(last.size).toBeGreaterThanOrEqual(30);
    const unpinned = [...last.entries()].filter(([, v]) => !v.pinned).map(([k, v]) => `${k} (last defined in ${v.file})`);
    expect(unpinned).toEqual([]);
  });

  it("★ fix review 4 (R2): every trigger / SECURITY DEFINER function of ANY migration ends pinned (a dropped re-pin turns it red)", () => {
    const srcs = allMigrations(SQL_DIR);
    const state = pinStateOf(srcs);
    const need = requiredPinned(srcs);
    expect(need.size).toBeGreaterThanOrEqual(39);
    expect(need.has("kiem_xac_thuc_noi_bo")).toBe(true);
    const unpinned = [...need.entries()].filter(([n]) => !state.get(n)?.pinned).map(([n, f]) => `${n} (needed by ${f}; last ${state.get(n)?.file ?? "never"} )`);
    expect(unpinned).toEqual([]);
    // the instrument: the 0316 trigger function re-pinned by a later file, then that re-pin removed
    const old = ["0316_x.sql", `CREATE OR REPLACE FUNCTION kiem() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;\nCREATE TRIGGER t AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION kiem();`] as const;
    const repin = ["0376_y.sql", `CREATE OR REPLACE FUNCTION public.kiem() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$ BEGIN RETURN NEW; END; $$;`] as const;
    const ok = (xs: ReadonlyArray<readonly [string, string]>) => [...requiredPinned(xs).keys()].every((n) => pinStateOf(xs).get(n)?.pinned === true);
    expect(ok([old, repin])).toBe(true);
    expect(ok([old])).toBe(false); // the 0376 block removed
    expect(ok([old, ["0376_y.sql", repin[1].replace("kiem()", "kiem_renamed()")]])).toBe(false); // renamed in 0376
    expect(ok([["0200_d.sql", `CREATE FUNCTION d() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;`]])).toBe(false); // an old definer
  });

  it("the instrument itself: an unpinned CREATE is caught; a later CREATE / ALTER with the pin repairs it; a later unpin is caught", () => {
    const parse = (sqls: Record<string, string>) => new Map([...pinStateOf(Object.entries(sqls).sort(([a], [b]) => a.localeCompare(b)))].map(([k, v]) => [k, v.pinned]));
    const bare = "CREATE OR REPLACE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;";
    const pinned = "CREATE OR REPLACE FUNCTION public.f() RETURNS trigger LANGUAGE plpgsql\nSET search_path = pg_catalog, public, pg_temp AS $$ BEGIN RETURN NEW; END $$;";
    expect(parse({ "0363_a.sql": bare }).get("f")).toBe(false);
    expect(parse({ "0363_a.sql": bare, "0376_b.sql": pinned }).get("f")).toBe(true);
    expect(parse({ "0363_a.sql": bare, "0376_b.sql": "ALTER FUNCTION public.f() SET search_path = pg_catalog, public, pg_temp;" }).get("f")).toBe(true);
    expect(parse({ "0376_b.sql": pinned, "0377_c.sql": bare }).get("f")).toBe(false);
    expect(parse({ "0376_b.sql": pinned, "0377_c.sql": "ALTER FUNCTION f() SET search_path = public;" }).get("f")).toBe(false);
  });

  it("★ fix review 3 (N3): each form the re-review listed is parsed — an unpinned one turns the census RED", () => {
    const st = (sql: string, name = "f") => pinStateOf([["0377_x.sql", sql]]).get(name)?.pinned;
    const P = "SET search_path = pg_catalog, public, pg_temp";
    expect(st(`CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $body1$ BEGIN RETURN 1; END $body1$;`)).toBe(false); // $tag1$
    expect(st(`CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql ${P} AS $body1$ BEGIN RETURN 1; END $body1$;`)).toBe(true);
    expect(st(`CREATE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 1';`)).toBe(false); // single-quoted body
    expect(st(`CREATE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT ''x''' ${P};`)).toBe(true); // pin AFTER a quoted body
    expect(st(`CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END;`)).toBe(false); // BEGIN ATOMIC
    expect(st(`CREATE FUNCTION f() RETURNS int LANGUAGE sql ${P} BEGIN ATOMIC SELECT 1; END;`)).toBe(true);
    expect(st(`CREATE FUNCTION f() RETURNS int LANGUAGE sql RETURN 1;`)).toBe(false);
    expect(st(`CREATE PROCEDURE f() LANGUAGE plpgsql AS $$ BEGIN END $$;`)).toBe(false); // procedure
    expect(st(`CREATE OR REPLACE PROCEDURE public.f() LANGUAGE plpgsql ${P} AS $$ BEGIN END $$;`)).toBe(true);
    expect(st(`CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql SET search_path TO public AS $$ BEGIN RETURN 1; END $$;`)).toBe(false); // TO form
    expect(st(`CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql SET search_path TO pg_catalog, public, pg_temp AS $$ BEGIN RETURN 1; END $$;`)).toBe(true);
    expect(st(`CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql SET search_path = 'pg_catalog', 'public', 'pg_temp' AS $$ BEGIN RETURN 1; END $$;`)).toBe(true);
    expect(st(`CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp, zz AS $$ BEGIN RETURN 1; END $$;`)).toBe(false); // extra schema
    expect(st(`CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$ ${P};`)).toBe(true); // pin after the body
    const pinnedThen = (alter: string) => pinStateOf([["0376_a.sql", `CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql ${P} AS $$ BEGIN RETURN 1; END $$;`], ["0377_b.sql", alter]]).get("f")?.pinned;
    expect(pinnedThen(`ALTER FUNCTION f() RESET search_path;`)).toBe(false); // RESET
    expect(pinnedThen(`ALTER FUNCTION public.f() RESET ALL;`)).toBe(false);
    expect(pinnedThen(`ALTER ROUTINE f SET search_path TO public;`)).toBe(false);
    expect(pinnedThen(`ALTER PROCEDURE f() SET search_path FROM CURRENT;`)).toBe(false);
    expect(pinnedThen(`ALTER FUNCTION f() OWNER TO aoi;`)).toBe(true); // an unrelated ALTER changes nothing
    expect(st(`CREATE FUNCTION "MixedCase"() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$;`, "MixedCase")).toBe(false);
  });
});

describe.skipIf(!onTest)("R-10-h — catalog: every function of the migrations ≥ 0363 is pinned and not PUBLIC-executable", () => {
  it("proconfig = {search_path=pg_catalog, public, pg_temp}; no PUBLIC EXECUTE; avi_app EXECUTE only on the callable set", async () => {
    const names = [...migrationFunctionCensus(path.join(REPO, "drizzle")).last.keys()];
    const rows = await freshSession(async (tx) =>
      tx`SELECT p.proname AS name, p.proconfig AS cfg, has_function_privilege('public', p.oid, 'EXECUTE') AS pub, has_function_privilege(current_user, p.oid, 'EXECUTE') AS app
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ANY(${names})`,
    );
    const bad = names.flatMap((name) => {
      const r = rows.filter((x) => x.name === name);
      if (r.length !== 1) return [`${name}: ${r.length} definitions`];
      const out: string[] = [];
      if (JSON.stringify(r[0].cfg) !== JSON.stringify([PIN])) out.push(`${name}: proconfig ${JSON.stringify(r[0].cfg)}`);
      if (PUBLIC_BY_DESIGN.has(name)) {
        if (!r[0].pub) out.push(`${name}: RLS helper lost PUBLIC EXECUTE`);
        return out;
      }
      if (r[0].pub) out.push(`${name}: PUBLIC EXECUTE`);
      if (r[0].app !== CALLABLE.has(name)) out.push(`${name}: avi_app EXECUTE ${r[0].app}`);
      return out;
    });
    expect(bad).toEqual([]);
  }, 60_000);
});
