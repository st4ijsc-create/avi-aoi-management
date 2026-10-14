/**
 * doc 81 Đợt 11 task H (mig 0377) — the last six public functions without the standard search_path pin (Đợt 10 Group A fix
 * round 3, N4 backlog), re-inventoried on `_test`: every non-extension function of schema public either
 *   (P) runs with EXACTLY `search_path = pg_catalog, public, pg_temp` (pg_temp last — a TEMP table never shadows a relation), or
 *   (I) is an INLINABLE `LANGUAGE sql` INVOKER function on purpose (INLINE_BY_DESIGN): a `SET` clause stops the planner from
 *       inlining a SQL function — measured on `_test` (dot11-H/inline.mjs, 300 000 rows): app_tenant_allows 117 → 588 ms (it is in
 *       82 RLS policies), to_factory_time 105 → 5 060 ms (hourly_yield_cache, BI day buckets). Those four name NO relation; 0377
 *       makes them independent of the caller's search_path by qualifying every function and operator (pg_catalog. /
 *       OPERATOR(pg_catalog.=)) — no NULLIF (its `=` is looked up through the search_path).
 *
 * (1) CATALOG census (avi_app): every non-extension function in public is (P) or (I); the (I) ones are sql, INVOKER, unpinned and
 *     really inlined (EXPLAIN shows no call).
 * (2) HOSTILE search_path (owner, rolled back): a schema placed BEFORE pg_catalog with its own current_setting() and `=` operator
 *     never changes what the (I) functions answer.
 * (3) SHADOW (avi_app, fresh session, rolled back): TEMP tables named like the relations of refresh_qw_caches /
 *     ensure_measurement_samples_partition never steer them; as owner (rolled back) the partition is still created in public.
 * (4) BEHAVIOUR unchanged under the normal search_path (truth table of the 0327 body; time-zone functions).
 * (5) SOURCE census of 0377: the (I) bodies call nothing unqualified; the dynamic DDL names public.%I only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const REPO = path.resolve(__dirname, "../..");
/** the source census reads 0377 from here (DOT11_H_SQL_DIR: a copy, for RED / mutation runs only) */
const SQL_DIR = process.env.DOT11_H_SQL_DIR || path.join(REPO, "drizzle");
const FILE_0377 = "0377_pin_invoker_functions_and_stop_lock_order.sql";
const PIN = "search_path=pg_catalog, public, pg_temp";
/** (I) — inlinable SQL functions, kept WITHOUT a SET clause on purpose (measured cost above); qualified instead (0377) */
export const INLINE_BY_DESIGN = new Set(["app_tenant_allows", "factory_timezone", "db_storage_timezone", "to_factory_time"]);

class Rollback extends Error {}
type Tx = postgres.TransactionSql;
async function rolledBack<T>(url: string, body: (tx: Tx) => Promise<T>, check = true): Promise<T> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  let out: T | undefined;
  try {
    const [who] = await client`SELECT current_database() AS db, r.rolbypassrls AS br, r.rolsuper AS su FROM pg_roles r WHERE r.rolname = current_user`;
    if (!String(who.db).endsWith("_test") || (check && (who.su || who.br))) throw new Error(`refused: ${JSON.stringify(who)}`);
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
function ownerUrl(): string {
  const u = new URL(DB_URL);
  u.username = process.env.MIGRATION_DB_USER ?? "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
  return u.toString();
}
const asApp = <T>(body: (tx: Tx) => Promise<T>) => rolledBack(DB_URL, body);
const asOwner = <T>(body: (tx: Tx) => Promise<T>) => rolledBack(ownerUrl(), body, false);
async function code(tx: Tx, fn: (sp: Tx) => Promise<unknown>): Promise<string | null> {
  try {
    await tx.savepoint((sp) => fn(sp as Tx));
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? (e as Error).message);
  }
}

describe.skipIf(!onTest)("0377 — catalog census: every non-extension public function is pinned, or an inlinable SQL function by design", () => {
  it("★ (1) pinned EXACTLY (pg_temp last) — or in INLINE_BY_DESIGN: sql, INVOKER, no SET (re-inventory of the Đợt 10 N4 backlog)", async () => {
    const rows = await asApp(
      (tx) => tx`
        SELECT p.proname AS name, p.oid::regprocedure::text AS sig, l.lanname AS lang, p.prosecdef AS definer, p.proconfig AS cfg
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
         WHERE n.nspname = 'public'
           AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(55); // 2026-10-14 on _test: 55 — 0 rows ⇒ the instrument is blind
    const bad = rows.flatMap((r) => {
      if (INLINE_BY_DESIGN.has(r.name)) return r.lang === "sql" && !r.definer && r.cfg === null ? [] : [`${r.sig}: inline-by-design must be sql, INVOKER, no SET (${r.lang}, definer=${r.definer}, ${JSON.stringify(r.cfg)})`];
      return JSON.stringify(r.cfg) === JSON.stringify([PIN]) ? [] : [`${r.sig}: proconfig ${JSON.stringify(r.cfg)}`];
    });
    expect(bad).toEqual([]);
    expect([...INLINE_BY_DESIGN].filter((n) => !rows.some((r) => r.name === n))).toEqual([]);
  }, 60_000);

  it("★ (1) the INLINE_BY_DESIGN functions really ARE inlined (a SET clause would turn each row into a function call)", async () => {
    const plans = await asApp(async (tx) => {
      const text = async (q: string) => (await tx.unsafe(`EXPLAIN (VERBOSE, COSTS OFF) ${q}`)).map((r) => String(Object.values(r)[0])).join("\n");
      return {
        tenant: await text(`SELECT public.app_tenant_allows(g::text, NULL) FROM generate_series(1, 3) g`),
        tz: await text(`SELECT public.to_factory_time(LOCALTIMESTAMP - make_interval(secs => g)) FROM generate_series(1, 3) g`),
        ftz: await text(`SELECT public.factory_timezone() || g::text FROM generate_series(1, 3) g`),
      };
    });
    expect({
      tenant: /app_tenant_allows\(/.test(plans.tenant),
      tz: /to_factory_time\(|factory_timezone\(|db_storage_timezone\(/.test(plans.tz),
      ftz: /factory_timezone\(/.test(plans.ftz),
    }).toEqual({ tenant: false, tz: false, ftz: false });
  }, 60_000);
});

describe.skipIf(!onTest)("0377 — the inlinable SQL functions do not depend on the caller's search_path", () => {
  it("★ (2) a schema BEFORE pg_catalog with its own current_setting() and `=` never changes the answers (owner, rolled back)", async () => {
    const r = await asOwner(async (tx) => {
      await tx`SET LOCAL app.tenant_rls_active = 'on'`;
      await tx`SET LOCAL app.tenant_bypass = 'off'`;
      await tx`SET LOCAL app.tenant_factory_codes = 'F1'`;
      await tx`SET LOCAL app.tenant_corporate_codes = ''`;
      await tx`SET LOCAL app.factory_tz = 'UTC'`;
      await tx`SET LOCAL app.factory_storage_tz = 'Asia/Tokyo'`;
      const ask = async () => {
        const [x] = await tx`SELECT public.app_tenant_allows('X', NULL) AS other, public.app_tenant_allows('F1', NULL) AS own,
                                    public.factory_timezone() AS ftz, public.db_storage_timezone() AS stz,
                                    public.to_factory_time('2026-01-01 09:00:00'::timestamp)::text AS t`;
        return x;
      };
      const trusted = await ask();
      await tx`CREATE SCHEMA evil_0377`;
      await tx`CREATE FUNCTION evil_0377.current_setting(text, boolean) RETURNS text LANGUAGE sql AS $$ SELECT 'on'::pg_catalog.text $$`;
      await tx`CREATE FUNCTION evil_0377.always(text, text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$`;
      await tx`CREATE OPERATOR evil_0377.= (LEFTARG = text, RIGHTARG = text, FUNCTION = evil_0377.always)`;
      await tx`SET LOCAL search_path = evil_0377, pg_catalog, public`;
      const hostile = await ask();
      return { trusted, hostile };
    });
    expect(r.trusted).toEqual({ other: false, own: true, ftz: "UTC", stz: "Asia/Tokyo", t: "2026-01-01 00:00:00" });
    expect(r.hostile).toEqual(r.trusted);
  }, 60_000);

  it("(4) behaviour unchanged under the normal search_path: the 0327 truth table, the time-zone defaults and overrides (avi_app)", async () => {
    const r = await asApp(async (tx) => {
      const allows = async (gucs: Record<string, string>, f: string | null, c: string | null) => {
        for (const [k, v] of Object.entries(gucs)) await tx.unsafe(`SET LOCAL ${k} = '${v}'`);
        return (await tx`SELECT public.app_tenant_allows(${f}, ${c}) AS ok`)[0].ok as boolean;
      };
      const off = { "app.tenant_rls_active": "off", "app.tenant_bypass": "off", "app.tenant_factory_codes": "", "app.tenant_corporate_codes": "" };
      const on = { ...off, "app.tenant_rls_active": "on" };
      const t = {
        inert: await allows(off, "X", "Y"),
        bypass: await allows({ ...on, "app.tenant_bypass": "on" }, "X", "Y"),
        shared: await allows(on, null, null),
        otherFactory: await allows({ ...on, "app.tenant_factory_codes": "F1,F2" }, "X", null),
        ownFactory: await allows({ ...on, "app.tenant_factory_codes": "F1,F2" }, "F2", null),
        ownCorporate: await allows({ ...on, "app.tenant_corporate_codes": "C1" }, "X", "C1"),
        otherCorporate: await allows({ ...on, "app.tenant_corporate_codes": "C1" }, null, "C2"),
      };
      await tx`SET LOCAL app.factory_tz = ''`;
      await tx`SET LOCAL app.factory_storage_tz = ''`;
      const [d] = await tx`SELECT public.factory_timezone() AS f, public.db_storage_timezone() AS s, public.to_factory_time('2026-01-01 00:00:00'::timestamp)::text AS t`;
      await tx`SET LOCAL app.factory_tz = 'Asia/Tokyo'`;
      const [o] = await tx`SELECT public.factory_timezone() AS f, public.to_factory_time('2026-01-01 00:00:00'::timestamp)::text AS t`;
      return { t, d, o };
    });
    expect(r).toEqual({
      t: { inert: true, bypass: true, shared: true, otherFactory: false, ownFactory: true, ownCorporate: true, otherCorporate: false },
      d: { f: "Asia/Ho_Chi_Minh", s: "UTC", t: "2026-01-01 07:00:00" },
      o: { f: "Asia/Tokyo", t: "2026-01-01 09:00:00" },
    });
  }, 60_000);
});

describe.skipIf(!onTest)("0377 — the two plpgsql INVOKER functions are pinned: a TEMP table never steers them", () => {
  it("★ (3) refresh_qw_caches: shadow TEMP tables machine_status_latest / hourly_yield_cache ⇒ the REAL views are refreshed (avi_app)", async () => {
    const r = await asApp(async (tx) => {
      await tx`CREATE TEMP TABLE machine_status_latest (x integer) ON COMMIT DROP`;
      await tx`CREATE TEMP TABLE hourly_yield_cache (x integer) ON COMMIT DROP`;
      await tx`SET LOCAL statement_timeout = '120s'`;
      return code(tx, (sp) => sp`SELECT public.refresh_qw_caches()`);
    });
    expect(r).toBeNull();
  }, 180_000);

  it("★ (3) ensure_measurement_samples_partition: a shadow TEMP measurement_samples ⇒ the public table is still the one checked (avi_app, existing month)", async () => {
    const r = await asApp(async (tx) => {
      const [p] = await tx`SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'public.measurement_samples'::regclass AND c.relname ~ '_y[0-9]{4}m[0-9]{2}$' ORDER BY 1 LIMIT 1`;
      const m = String(p.relname).match(/_y(\d{4})m(\d{2})$/)!;
      await tx`CREATE TEMP TABLE measurement_samples (x integer) ON COMMIT DROP`;
      return code(tx, (sp) => sp`SELECT public.ensure_measurement_samples_partition(${Number(m[1])}, ${Number(m[2])})`);
    });
    expect(r).toBeNull();
  }, 60_000);

  it("★ (3) as owner (rolled back): a NEW month is created in public — with and without a TEMP shadow — with its indexes", async () => {
    const r = await asOwner(async (tx) => {
      await tx`SET LOCAL lock_timeout = '5s'`;
      const made = async (y: number, m: number) => {
        const name = `measurement_samples_y${y}m${String(m).padStart(2, "0")}`;
        const [c] = await tx`SELECT n.nspname AS ns, (SELECT count(*)::int FROM pg_index i WHERE i.indrelid = c.oid) AS idx,
                                   EXISTS (SELECT 1 FROM pg_inherits h WHERE h.inhrelid = c.oid AND h.inhparent = 'public.measurement_samples'::regclass) AS part
                              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = ${name} AND c.relkind IN ('r', 'p')`;
        return c ? `${c.ns}:${c.part ? "partition" : "table"}:${c.idx}` : "absent";
      };
      const plain = await code(tx, (sp) => sp`SELECT public.ensure_measurement_samples_partition(2099, 1)`);
      await tx`CREATE TEMP TABLE measurement_samples (x integer) ON COMMIT DROP`;
      const shadowed = await code(tx, (sp) => sp`SELECT public.ensure_measurement_samples_partition(2099, 2)`);
      return { plain, jan: await made(2099, 1), shadowed, feb: await made(2099, 2) };
    });
    expect(r).toEqual({ plain: null, jan: "public:partition:4", shadowed: null, feb: "public:partition:4" }); // the inherited pkey + its three
  }, 60_000);
});

/** Every call / operator in a SQL body that is not schema-qualified (the body parsed in the CALLER's search_path when inlined). */
export function unqualifiedInSqlBody(body: string): string[] {
  const code = body.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
  const bad: string[] = [];
  const SYNTAX = new Set(["select", "coalesce", "any", "all", "exists", "case", "when", "then", "else", "end", "and", "or", "not", "is", "null", "from", "where", "operator", "array", "cast", "as", "on"]);
  for (const m of code.matchAll(/(?<![\w."$])([A-Za-z_][\w$]*)\s*\(/g)) {
    const w = m[1].toLowerCase();
    if (w === "in") bad.push("IN ( (its = is resolved through the search_path — use OPERATOR(pg_catalog.=) ANY (ARRAY[…]))");
    else if (!SYNTAX.has(w)) bad.push(`unqualified call ${m[1]}(`);
  }
  for (const m of code.matchAll(/\b(nullif)\s*\(/gi)) bad.push(`${m[1]} (its = is resolved through the search_path)`);
  // fix 1 (review H-R7): the other names a body resolves through the caller's search_path
  const QUAL = /^"?(pg_catalog|public)"?$/i;
  for (const m of code.matchAll(/::\s*("?[A-Za-z_][\w$]*"?)(\s*\.\s*"?[A-Za-z_][\w$]*"?)?/g)) if (!m[2] || !QUAL.test(m[1])) bad.push(`cast ::${m[1]}${m[2] ?? ""} (a type name — qualify it pg_catalog.)`);
  for (const m of code.matchAll(/\bCAST\s*\([\s\S]*?\bAS\s+("?[A-Za-z_][\w$]*"?)(\s*\.\s*"?[A-Za-z_][\w$]*"?)?/gi)) if (!m[2] || !QUAL.test(m[1])) bad.push(`cast AS ${m[1]}${m[2] ?? ""} (a type name — qualify it pg_catalog.)`);
  for (const m of code.matchAll(/\b(FROM|JOIN)\s+(?!\()("?[A-Za-z_][\w$]*"?)(\s*\.)?/gi)) {
    if (/^(SELECT|LATERAL)$/i.test(m[2]) || /DISTINCT\s+$/i.test(code.slice(Math.max(0, (m.index ?? 0) - 12), m.index))) continue;
    if (!m[3]) bad.push(`relation ${m[2]} unqualified (${m[1].toUpperCase()}; pg_temp is searched first)`);
    else if (!QUAL.test(m[2])) bad.push(`relation in schema ${m[2]} (${m[1].toUpperCase()})`);
  }
  for (const m of code.matchAll(/\bIS\s+(?:NOT\s+)?DISTINCT\s+FROM\b/gi)) bad.push(`${m[0].replace(/\s+/g, " ")} → IS DISTINCT FROM (its = is resolved through the search_path)`);
  for (const m of code.matchAll(/\b(I?LIKE)\b/gi)) bad.push(`${m[1]} → LIKE (~~ is resolved through the search_path)`);
  const noOps = code.replace(/OPERATOR\s*\(\s*pg_catalog\.[^)]+\)/gi, " ");
  for (const m of noOps.matchAll(/(<>|!=|<=|>=|\|\||[=<>+\-*/%~])/g)) bad.push(`bare operator ${m[1]}`);
  return [...new Set(bad)];
}
/** The function bodies of one migration text, by name. */
function bodiesOf(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.("?)([A-Za-z_][\w]*)\1\s*\([\s\S]*?\bAS\s+(\$[A-Za-z_]*\$)([\s\S]*?)\3/gi)) out.set(m[2].toLowerCase(), m[4]);
  return out;
}

describe("0377 — source census of the migration (no DB)", () => {
  it("★ (5) the INLINE_BY_DESIGN bodies call nothing unqualified (no NULLIF, every operator OPERATOR(pg_catalog.…)) and carry no SET", () => {
    const src = readFileSync(path.join(SQL_DIR, FILE_0377), "utf8");
    const bodies = bodiesOf(src);
    const bad: string[] = [];
    for (const n of INLINE_BY_DESIGN) {
      const b = bodies.get(n);
      if (b === undefined) bad.push(`${n}: not re-created by 0377`);
      else for (const x of unqualifiedInSqlBody(b)) bad.push(`${n}: ${x}`);
    }
    for (const m of src.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([A-Za-z_]\w*)\s*\(([\s\S]*?)\bAS\s+\$/gi)) {
      if (INLINE_BY_DESIGN.has(m[1].toLowerCase()) && /\bSET\s+search_path\b|\bSECURITY\s+DEFINER\b/i.test(m[2])) bad.push(`${m[1]}: SET / SECURITY DEFINER would stop inlining`);
    }
    expect(bad).toEqual([]);
  });

  it("★ (5) the dynamic DDL of ensure_measurement_samples_partition names only public.%I relations; refresh_qw_caches only public.* views", () => {
    const bodies = bodiesOf(readFileSync(path.join(SQL_DIR, FILE_0377), "utf8"));
    const part = bodies.get("ensure_measurement_samples_partition") ?? "";
    const fmts = [...part.matchAll(/format\(\s*'((?:[^']|'')*)'/g)].map((m) => m[1]);
    expect(fmts.length).toBe(7); // partition name, start, end + CREATE TABLE + 3 × CREATE INDEX
    const ddl = fmts.filter((f) => /\b(TABLE|INDEX)\b/i.test(f));
    expect(ddl.length).toBe(4);
    const unq = ddl.flatMap((f) => [...f.matchAll(/\b(?:OF|ON|TABLE)\s+(?!public\.)(?!IF\b)(%I|[A-Za-z_]\w*)/gi)].map((m) => `${f} → ${m[1]}`));
    expect(unq).toEqual([]);
    expect([...part.matchAll(/\bFROM\s+(?!pg_catalog\.)([A-Za-z_]\w*)/gi)].map((m) => m[1])).toEqual([]);
    const refresh = bodies.get("refresh_qw_caches") ?? "";
    expect([...refresh.matchAll(/MATERIALIZED\s+VIEW\s+(CONCURRENTLY\s+)?(\S+)/gi)].map((m) => m[2]).filter((v) => !/^public\./.test(v))).toEqual([]);
    expect([...refresh.matchAll(/MATERIALIZED\s+VIEW/gi)].length).toBe(4);
  });

  it("the instrument: unqualified forms are caught, qualified ones pass", () => {
    expect(unqualifiedInSqlBody(`SELECT coalesce(current_setting('a', true), 'off') <> 'on'`)).toEqual(["unqualified call current_setting(", "bare operator <>"]);
    expect(unqualifiedInSqlBody(`SELECT COALESCE(NULLIF(pg_catalog.current_setting('a', true), ''), 'UTC')`)).toEqual(["unqualified call NULLIF(", "NULLIF (its = is resolved through the search_path)"]);
    expect(unqualifiedInSqlBody(`SELECT x = ANY (pg_catalog.string_to_array(y, ','))`)).toEqual(["bare operator ="]);
    expect(unqualifiedInSqlBody(`SELECT coalesce(pg_catalog.current_setting('a', true), 'off') OPERATOR(pg_catalog.<>) 'on' OR p IS NULL`)).toEqual([]);
    expect(unqualifiedInSqlBody(`SELECT (ts AT TIME ZONE public.db_storage_timezone()) AT TIME ZONE public.factory_timezone()`)).toEqual([]);
  });

  it("★ fix 1 (review H-R7): casts, relations, IN, IS DISTINCT FROM and LIKE are caught too (what a TEMP object / a schema can shadow)", () => {
    const has = (body: string, re: RegExp) => unqualifiedInSqlBody(body).some((x) => re.test(x));
    // casts: a type name resolves through the search_path (a TEMP table's row type shadows it)
    expect(has(`SELECT p_factory::text`, /cast ::text/)).toBe(true);
    expect(has(`SELECT CAST(p_factory AS text)`, /cast AS text/)).toBe(true);
    expect(has(`SELECT p_factory::pg_catalog.text`, /cast/)).toBe(false);
    expect(has(`SELECT CAST(p_factory AS pg_catalog.text)`, /cast/)).toBe(false);
    // relations: FROM / JOIN an unqualified relation (pg_temp is searched first for relations)
    expect(has(`SELECT 1 FROM program_deployments d`, /relation program_deployments/)).toBe(true);
    expect(has(`SELECT 1 FROM public.a x JOIN b y ON true`, /relation b/)).toBe(true);
    expect(has(`SELECT 1 FROM public.program_deployments d JOIN pg_catalog.pg_class c ON true`, /relation/)).toBe(false);
    // IN / IS DISTINCT FROM / LIKE: operator lookups (= / <> / ~~) through the search_path
    expect(has(`SELECT p IN ('a', 'b')`, /IN \(/)).toBe(true);
    expect(has(`SELECT p IS DISTINCT FROM q`, /IS DISTINCT FROM/)).toBe(true);
    expect(has(`SELECT p IS NOT DISTINCT FROM q`, /IS DISTINCT FROM/)).toBe(true);
    expect(has(`SELECT p LIKE 'a%'`, /LIKE/)).toBe(true);
    expect(has(`SELECT p ILIKE 'a%'`, /LIKE/)).toBe(true);
    expect(has(`SELECT p OPERATOR(pg_catalog.=) ANY (ARRAY['a', 'b'])`, /IN \(|LIKE|DISTINCT/)).toBe(false);
  });
});
