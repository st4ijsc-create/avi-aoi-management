/**
 * doc 81 Đợt 9 task R fix 1 (#6) — `apiKey.setHolder` on the REAL `_test` DB (mig 0369):
 *   • the holder change, its trigger-written history row AND its audit_logs row are ONE transaction: an audit row that cannot
 *     be written refuses the change (holder unchanged, no history row);
 *   • errors are specific and carry no database text to the client: migration missing ⇒ PRECONDITION_FAILED
 *     FEATURE_NOT_CONFIGURED(apiKeyHolder); any other DB failure ⇒ INTERNAL_SERVER_ERROR OPERATION_FAILED(changeApiKeyHolder);
 *     a key that vanished meanwhile ⇒ NOT_FOUND;
 *   • the list flags a DEACTIVATED holder (#5: holderActive false).
 * The router's `getDb` is the real connection wrapped so that a test can make ONE statement inside the transaction fail.
 *
 * ★ `_test` LEFTOVERS, BY DESIGN (doc 81 Đợt 9 final wave F7 / final review M8): `api_key_holder_changes` is APPEND-ONLY (mig
 *   0369 — WORM history written by a trigger; `avi_app` has SELECT + INSERT only, no FK to api_keys). Every test that creates a
 *   key and sets / changes its holder (this file, foeApiKeyHolderDispatchers.dot9.db, edgeExecution.s12.dot9.db, …) leaves its
 *   history rows behind when it deletes the key: measured 1 079 rows for 7 deleted keys after the Đợt 9 runs, growing with every
 *   run. They are harmless (no key references them; nothing reads history of a missing key) and are NOT cleaned up by the
 *   tests — removing WORM rows is an owner-role decision, never a test's.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

const h = vi.hoisted(() => ({
  fail: null as null | { table: string; op: "insert" | "update"; err: Error },
  /** R fix scan — runs right before the transaction opens (after any pre-check the router did outside it). */
  beforeTx: null as null | (() => Promise<void>),
}));
// R fix scan — `admin_system` permission granted to every caller of this file (a canEdit holder who is NOT an admin): the
// admin-only rules under test are the router's own, not the module permission.
vi.mock("../_core/accessControl", () => ({ requirePermission: () => async ({ ctx, next }: any) => next({ ctx }) }));
vi.mock("../db", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../db")>();
  const NAME = Symbol.for("drizzle:Name");
  const wrapTx = (tx: any) =>
    new Proxy(tx, {
      get(t, p, r) {
        if ((p === "insert" || p === "update") && h.fail) {
          return (table: any) => {
            if (h.fail && h.fail.op === p && table?.[NAME] === h.fail.table) throw h.fail.err;
            return t[p](table);
          };
        }
        return Reflect.get(t, p, r);
      },
    });
  return {
    ...orig,
    getDb: async () => {
      const real = await orig.getDb();
      if (!real) return real;
      return new Proxy(real, {
        get(t, p, r) {
          if (p === "transaction")
            return async (fn: (tx: any) => Promise<unknown>) => {
              const pre = h.beforeTx;
              h.beforeTx = null;
              if (pre) await pre();
              return (t as any).transaction((tx: any) => fn(wrapTx(tx)));
            };
          return Reflect.get(t, p, r);
        },
      });
    },
  };
});

import { apiKeyRouter } from "./apiKeyRouter";
import { verifyCrudContentHash } from "../services/auditTrailService";

const DB_URL = process.env.DATABASE_URL;
const DAU = `R9F1-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
const u = { admin: 0, a: 0, b: 0, off: 0, eng: 0, late: 0, admin2: 0 };
let keyId = 0;
const ctx = () => ({ user: { id: u.admin, role: "admin", name: "R9F1 admin", twoFactorEnabled: true } }) as never;
const holderOf = async () => Number((await sql`SELECT "holderUserId" AS h FROM api_keys WHERE id = ${keyId}`)[0].h);
const histCount = async () => Number((await sql`SELECT count(*)::int AS n FROM api_key_holder_changes WHERE "apiKeyId" = ${keyId}`)[0].n);
const auditCount = async () => Number((await sql`SELECT count(*)::int AS n FROM audit_logs WHERE "entityType" = 'api_key' AND "entityId" = ${keyId}`)[0].n);

describe.skipIf(!DB_URL)("doc 81 Đợt 9 R fix 1 #6 — setHolder: one transaction with its audit row, specific errors (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    for (const [k, role, active] of [["admin", "admin", true], ["a", "engineer", true], ["b", "engineer", true], ["off", "engineer", true], ["eng", "engineer", true], ["late", "engineer", true], ["admin2", "admin", true]] as const) {
      u[k] = Number((await sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-${k}`}, ${`${DAU}-${k}`}, ${`R9F1 ${k}`}, ${role}, ${active}) RETURNING id`)[0].id);
    }
    keyId = Number((await sql`INSERT INTO api_keys (name, "keyHash", scopes, "createdBy", "holderUserId") VALUES (${`${DAU}-k`}, ${`${DAU}-k-hash`}, ${sql.json(["orchestration:write"])}, ${u.admin}, ${u.a}) RETURNING id`)[0].id);
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    h.fail = null;
    h.beforeTx = null;
    await sql`DELETE FROM api_keys WHERE id = ${keyId} OR name LIKE ${DAU + "%"}`;
    await sql`DELETE FROM users WHERE id IN ${sql(Object.values(u).filter(Boolean))}`.catch(() => undefined); // audit_logs may reference (WORM)
    await sql.end();
  });

  it("★ the audit_logs row cannot be written ⇒ the change is REFUSED: holder unchanged, no history row, no audit row; no DB text to the client", async () => {
    const [h0, n0, a0] = [await holderOf(), await histCount(), await auditCount()];
    h.fail = { table: "audit_logs", op: "insert", err: Object.assign(new Error("RAW-DB-TEXT relation audit_logs is locked"), { code: "55P03" }) };
    try {
      const p = apiKeyRouter.createCaller(ctx()).setHolder({ id: keyId, holderUserId: u.b, reason: "audit must hold" });
      await expect(p).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
      await p.catch((e: Error) => {
        expect(e.message).not.toMatch(/RAW-DB-TEXT/);
        expect(e.message).toMatch(/nothing was changed/);
      });
    } finally {
      h.fail = null;
    }
    expect([await holderOf(), await histCount(), await auditCount()]).toEqual([h0, n0, a0]);
    // control: the same change with a writable audit row goes through, atomically with history + audit
    await apiKeyRouter.createCaller(ctx()).setHolder({ id: keyId, holderUserId: u.b, reason: "audit holds" });
    expect([await holderOf(), await histCount(), await auditCount()]).toEqual([u.b, n0 + 1, a0 + 1]);
  });

  it("★ migration 0369 missing (42703 on the holder update) ⇒ PRECONDITION_FAILED naming the feature, no DB text; nothing changed", async () => {
    const before = await holderOf();
    h.fail = { table: "api_keys", op: "update", err: Object.assign(new Error('RAW-DB-TEXT column "holderUserId" does not exist'), { code: "42703" }) };
    try {
      const p = apiKeyRouter.createCaller(ctx()).setHolder({ id: keyId, holderUserId: u.a, reason: "pre-0369" });
      await expect(p).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await p.catch((e: Error & { data?: unknown; cause?: unknown }) => {
        expect(e.message).not.toMatch(/RAW-DB-TEXT/);
        expect(e.message).toMatch(/migration 0369/);
      });
    } finally {
      h.fail = null;
    }
    expect(await holderOf()).toBe(before);
  });

  it("★ #5 the list flags a DEACTIVATED holder (holderActive false); an active one true", async () => {
    await apiKeyRouter.createCaller(ctx()).setHolder({ id: keyId, holderUserId: u.off, reason: "will leave" });
    let row = (await apiKeyRouter.createCaller(ctx()).list()).find((r) => r.id === keyId);
    expect(row).toMatchObject({ holderUserId: u.off, holderActive: true });
    await sql`UPDATE users SET "isActive" = false WHERE id = ${u.off}`;
    row = (await apiKeyRouter.createCaller(ctx()).list()).find((r) => r.id === keyId);
    expect(row).toMatchObject({ holderUserId: u.off, holderActive: false, holderName: "R9F1 off" });
  });

  // ════════════ doc 81 Đợt 9 R fix scan (security scan on 89a4e31d4: audit integrity + authorization) ════════════
  const holderAudits = async () =>
    (await sql`SELECT details, "ipAddress" FROM audit_logs WHERE "entityType" = 'api_key' AND "entityId" = ${keyId} AND details LIKE '%API_KEY_HOLDER_CHANGE%' ORDER BY id`) as Array<{ details: string; ipAddress: string | null }>;
  const ctxWithReq = (id: number, role: string) =>
    ({ user: { id, role, name: `R9F1 ${role}`, twoFactorEnabled: true }, req: { ip: "198.51.100.7", headers: { "user-agent": "r9-scan" } } }) as never;

  it("★ scan (1): exactly ONE durable audit row per successful change, built like every CRUD row (SEC_PLATFORM content hash verifies, request ip), none for a failed change", async () => {
    const saved = process.env.SEC_PLATFORM;
    process.env.SEC_PLATFORM = "true";
    try {
      const n0 = (await holderAudits()).length;
      await apiKeyRouter.createCaller(ctxWithReq(u.admin, "admin")).setHolder({ id: keyId, holderUserId: u.a, reason: "scan audit ok" });
      const rows = await holderAudits();
      expect(rows.length).toBe(n0 + 1);
      const last = rows[rows.length - 1];
      const details = JSON.parse(last.details);
      expect(details).toMatchObject({ operation: "API_KEY_HOLDER_CHANGE", after: { holderUserId: u.a }, source: "web" });
      expect(typeof details.contentHash).toBe("string");
      expect(
        verifyCrudContentHash({ userId: u.admin, action: "UPDATE", entityType: "api_key", entityId: keyId, entityName: `${DAU}-k`, details }),
      ).toEqual({ ok: true });
      expect(last.ipAddress).toBe("198.51.100.7");
      // a FAILED change (inactive holder) leaves no holder-change audit row and changes nothing
      await sql`UPDATE users SET "isActive" = false WHERE id = ${u.late}`;
      await expect(apiKeyRouter.createCaller(ctxWithReq(u.admin, "admin")).setHolder({ id: keyId, holderUserId: u.late, reason: "inactive" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect((await holderAudits()).length).toBe(n0 + 1);
      expect(await holderOf()).toBe(u.a);
    } finally {
      if (saved === undefined) delete process.env.SEC_PLATFORM;
      else process.env.SEC_PLATFORM = saved;
      await sql`UPDATE users SET "isActive" = true WHERE id = ${u.late}`;
    }
  });

  it("★ scan (2): the holder is deactivated AFTER any pre-check but before the change ⇒ refused under the lock (nothing changed, no audit row)", async () => {
    await apiKeyRouter.createCaller(ctx()).setHolder({ id: keyId, holderUserId: u.a, reason: "baseline" });
    const n0 = (await holderAudits()).length;
    const hist0 = await histCount();
    h.beforeTx = async () => {
      await sql`UPDATE users SET "isActive" = false WHERE id = ${u.late}`;
    };
    try {
      await expect(apiKeyRouter.createCaller(ctx()).setHolder({ id: keyId, holderUserId: u.late, reason: "race" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    } finally {
      h.beforeTx = null;
      await sql`UPDATE users SET "isActive" = true WHERE id = ${u.late}`;
    }
    expect([await holderOf(), await histCount(), (await holderAudits()).length]).toEqual([u.a, hist0, n0]);
  });

  it("★ scan (2): user 0 / negative / missing ⇒ refused; non-admin, no session, admin without 2FA ⇒ FORBIDDEN — nothing changed, no audit row", async () => {
    const before = [await holderOf(), (await holderAudits()).length];
    for (const bad of [0, -5]) {
      await expect(apiKeyRouter.createCaller(ctx()).setHolder({ id: keyId, holderUserId: bad, reason: "zero" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(apiKeyRouter.createCaller(ctx()).setHolder({ id: keyId, holderUserId: 2_000_000_000, reason: "ghost" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(apiKeyRouter.createCaller(ctxWithReq(u.eng, "engineer")).setHolder({ id: keyId, holderUserId: u.eng, reason: "mine now" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(apiKeyRouter.createCaller({ user: null } as never).setHolder({ id: keyId, holderUserId: u.eng, reason: "anon" })).rejects.toBeTruthy();
    const saved2fa = process.env.AUTH_2FA_BAT_BUOC;
    delete process.env.AUTH_2FA_BAT_BUOC;
    try {
      await expect(
        apiKeyRouter.createCaller({ user: { id: u.admin, role: "admin", name: "no2fa", twoFactorEnabled: false } } as never).setHolder({ id: keyId, holderUserId: u.eng, reason: "no 2fa" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      if (saved2fa !== undefined) process.env.AUTH_2FA_BAT_BUOC = saved2fa;
    }
    expect([await holderOf(), (await holderAudits()).length]).toEqual(before);
  });

  it("★ scan (2) / R-9-c: a NON-admin with admin_system canEdit cannot RE-ACTIVATE a key or EXTEND its expiry (it restores API runs' actuation); revoke / shorten stay allowed; an admin can", async () => {
    const [k] = await sql`INSERT INTO api_keys (name, "keyHash", scopes, "createdBy", "holderUserId", "isActive", "expiresAt")
                          VALUES (${`${DAU}-k2`}, ${`${DAU}-k2-hash`}, ${sql.json(["orchestration:write"])}, ${u.admin}, ${u.a}, false, now() + interval '1 day') RETURNING id`;
    const id = Number(k.id);
    const eng = apiKeyRouter.createCaller(ctxWithReq(u.eng, "engineer"));
    await expect(eng.update({ id, isActive: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await sql`SELECT "isActive" FROM api_keys WHERE id = ${id}`)[0].isActive).toBe(false);
    await expect(eng.update({ id, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(eng.update({ id, expiresAt: null })).rejects.toMatchObject({ code: "FORBIDDEN" }); // "never expires" extends too
    await eng.update({ id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }); // shorten: allowed
    await eng.update({ id, isActive: false, name: `${DAU}-k2b` }); // revoke / other fields: allowed
    await apiKeyRouter.createCaller(ctxWithReq(u.admin, "admin")).update({ id, isActive: true }); // an admin re-activates
    expect((await sql`SELECT "isActive" FROM api_keys WHERE id = ${id}`)[0].isActive).toBe(true);
  });

  // ════════════ doc 81 Đợt 9 R fix scan 2 — authorization TOCTOU, TWO REAL TRANSACTIONS on _test ════════════
  /**
   * Opens a second, REAL transaction on its own connection, runs `stmt` in it (taking that row's lock) and keeps it open until
   * `release()` — then commits. `ready` resolves once the statement has run (the lock is held).
   */
  function holdInOtherTx(stmt: (tx: postgres.TransactionSql) => Promise<unknown>) {
    const other = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let ready!: () => void;
    const readyP = new Promise<void>((r) => (ready = r));
    const done = other
      .begin(async (tx) => {
        await stmt(tx);
        ready();
        await gate;
      })
      .finally(() => other.end());
    return { ready: readyP, release, done };
  }
  const settle = <T,>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e: { code?: string }) => ({ ok: false as const, code: e?.code }));
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("★ scan 2: a REVOKE committing while a non-admin's update({ isActive: true }) is in flight ⇒ the update decides on the LOCKED (revoked) row ⇒ FORBIDDEN; the key stays revoked", async () => {
    const [k] = await sql`INSERT INTO api_keys (name, "keyHash", scopes, "createdBy", "holderUserId", "isActive")
                          VALUES (${`${DAU}-k3`}, ${`${DAU}-k3-hash`}, ${sql.json(["orchestration:write"])}, ${u.admin}, ${u.a}, true) RETURNING id`;
    const id = Number(k.id);
    const other = holdInOtherTx((tx) => tx`UPDATE api_keys SET "isActive" = false WHERE id = ${id}`);
    await other.ready;
    // a non-admin "re-saves" the key as active — harmless on the row it would have read without a lock (active)
    const inFlight = settle(apiKeyRouter.createCaller(ctxWithReq(u.eng, "engineer")).update({ id, isActive: true, name: `${DAU}-k3` }));
    await pause(400); // it must be WAITING on the row lock now
    other.release();
    await other.done;
    const r = await inFlight;
    expect(r).toEqual({ ok: false, code: "FORBIDDEN" });
    expect((await sql`SELECT "isActive" FROM api_keys WHERE id = ${id}`)[0].isActive).toBe(false);
  });

  it("★ scan 2 (the FOR SHARE gap): the new holder is DEACTIVATED by a transaction committing while setHolder is in flight ⇒ refused (BAD_REQUEST), holder unchanged", async () => {
    await apiKeyRouter.createCaller(ctx()).setHolder({ id: keyId, holderUserId: u.a, reason: "baseline 2" });
    const other = holdInOtherTx((tx) => tx`UPDATE users SET "isActive" = false WHERE id = ${u.late}`);
    await other.ready;
    const inFlight = settle(apiKeyRouter.createCaller(ctx()).setHolder({ id: keyId, holderUserId: u.late, reason: "racing a deactivation" }));
    await pause(400);
    other.release();
    await other.done;
    try {
      expect(await inFlight).toEqual({ ok: false, code: "BAD_REQUEST" });
      expect(await holderOf()).toBe(u.a);
    } finally {
      await sql`UPDATE users SET "isActive" = true WHERE id = ${u.late}`;
    }
  });

  it("★ scan 2: the ADMIN is demoted by a transaction committing while their setHolder is in flight ⇒ FORBIDDEN (re-checked in the transaction), nothing changed", async () => {
    const before = await holderOf();
    const n0 = await histCount();
    const other = holdInOtherTx((tx) => tx`UPDATE users SET role = 'engineer' WHERE id = ${u.admin2}`);
    await other.ready;
    const inFlight = settle(
      apiKeyRouter.createCaller({ user: { id: u.admin2, role: "admin", name: "R9F1 admin2", twoFactorEnabled: true } } as never).setHolder({ id: keyId, holderUserId: u.b, reason: "demoted meanwhile" }),
    );
    await pause(400);
    other.release();
    await other.done;
    try {
      expect(await inFlight).toEqual({ ok: false, code: "FORBIDDEN" });
      expect([await holderOf(), await histCount()]).toEqual([before, n0]);
    } finally {
      await sql`UPDATE users SET role = 'admin' WHERE id = ${u.admin2}`;
    }
  });

  it("★ scan 2: the key is DELETED by a transaction committing while setHolder is in flight ⇒ NOT_FOUND — no holder-change audit row for a change that never happened", async () => {
    const [k] = await sql`INSERT INTO api_keys (name, "keyHash", scopes, "createdBy", "holderUserId") VALUES (${`${DAU}-k5`}, ${`${DAU}-k5-hash`}, ${sql.json(["orchestration:write"])}, ${u.admin}, ${u.a}) RETURNING id`;
    const id = Number(k.id);
    const audits = async () => Number((await sql`SELECT count(*)::int AS n FROM audit_logs WHERE "entityType" = 'api_key' AND "entityId" = ${id} AND details LIKE '%API_KEY_HOLDER_CHANGE%'`)[0].n);
    const other = holdInOtherTx((tx) => tx`DELETE FROM api_keys WHERE id = ${id}`);
    await other.ready;
    let finished = false;
    const inFlight = settle(apiKeyRouter.createCaller(ctx()).setHolder({ id, holderUserId: u.b, reason: "racing a delete" }).finally(() => (finished = true)));
    await pause(400);
    expect(finished).toBe(false); // waiting on the key row lock
    other.release();
    await other.done;
    expect(await inFlight).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await audits()).toBe(0);
  });

  it("★ scan 2: an admin demoted while their update({ isActive: true }) of a revoked key is in flight ⇒ FORBIDDEN, the key stays revoked", async () => {
    const [k] = await sql`INSERT INTO api_keys (name, "keyHash", scopes, "createdBy", "holderUserId", "isActive")
                          VALUES (${`${DAU}-k4`}, ${`${DAU}-k4-hash`}, ${sql.json(["orchestration:write"])}, ${u.admin}, ${u.a}, false) RETURNING id`;
    const id = Number(k.id);
    const other = holdInOtherTx((tx) => tx`UPDATE users SET role = 'engineer' WHERE id = ${u.admin2}`);
    await other.ready;
    const inFlight = settle(
      apiKeyRouter.createCaller({ user: { id: u.admin2, role: "admin", name: "R9F1 admin2", twoFactorEnabled: true } } as never).update({ id, isActive: true }),
    );
    await pause(400);
    other.release();
    await other.done;
    try {
      expect(await inFlight).toEqual({ ok: false, code: "FORBIDDEN" });
      expect((await sql`SELECT "isActive" FROM api_keys WHERE id = ${id}`)[0].isActive).toBe(false);
    } finally {
      await sql`UPDATE users SET role = 'admin' WHERE id = ${u.admin2}`;
    }
  });
});
