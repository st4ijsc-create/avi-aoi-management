/**
 * doc 81 Đợt 9 task R fix 1 (#6) — `apiKey.setHolder` on the REAL `_test` DB (mig 0369):
 *   • the holder change, its trigger-written history row AND its audit_logs row are ONE transaction: an audit row that cannot
 *     be written refuses the change (holder unchanged, no history row);
 *   • errors are specific and carry no database text to the client: migration missing ⇒ PRECONDITION_FAILED
 *     FEATURE_NOT_CONFIGURED(apiKeyHolder); any other DB failure ⇒ INTERNAL_SERVER_ERROR OPERATION_FAILED(changeApiKeyHolder);
 *     a key that vanished meanwhile ⇒ NOT_FOUND;
 *   • the list flags a DEACTIVATED holder (#5: holderActive false).
 * The router's `getDb` is the real connection wrapped so that a test can make ONE statement inside the transaction fail.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

const h = vi.hoisted(() => ({ fail: null as null | { table: string; op: "insert" | "update"; err: Error } }));
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
          if (p === "transaction") return (fn: (tx: any) => Promise<unknown>) => (t as any).transaction((tx: any) => fn(wrapTx(tx)));
          return Reflect.get(t, p, r);
        },
      });
    },
  };
});

import { apiKeyRouter } from "./apiKeyRouter";

const DB_URL = process.env.DATABASE_URL;
const DAU = `R9F1-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
const u = { admin: 0, a: 0, b: 0, off: 0 };
let keyId = 0;
const ctx = () => ({ user: { id: u.admin, role: "admin", name: "R9F1 admin", twoFactorEnabled: true } }) as never;
const holderOf = async () => Number((await sql`SELECT "holderUserId" AS h FROM api_keys WHERE id = ${keyId}`)[0].h);
const histCount = async () => Number((await sql`SELECT count(*)::int AS n FROM api_key_holder_changes WHERE "apiKeyId" = ${keyId}`)[0].n);
const auditCount = async () => Number((await sql`SELECT count(*)::int AS n FROM audit_logs WHERE "entityType" = 'api_key' AND "entityId" = ${keyId}`)[0].n);

describe.skipIf(!DB_URL)("doc 81 Đợt 9 R fix 1 #6 — setHolder: one transaction with its audit row, specific errors (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    for (const [k, role, active] of [["admin", "admin", true], ["a", "engineer", true], ["b", "engineer", true], ["off", "engineer", true]] as const) {
      u[k] = Number((await sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-${k}`}, ${`${DAU}-${k}`}, ${`R9F1 ${k}`}, ${role}, ${active}) RETURNING id`)[0].id);
    }
    keyId = Number((await sql`INSERT INTO api_keys (name, "keyHash", scopes, "createdBy", "holderUserId") VALUES (${`${DAU}-k`}, ${`${DAU}-k-hash`}, ${sql.json(["orchestration:write"])}, ${u.admin}, ${u.a}) RETURNING id`)[0].id);
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    h.fail = null;
    await sql`DELETE FROM api_keys WHERE id = ${keyId}`;
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
});
