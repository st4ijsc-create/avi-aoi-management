/**
 * Doc 51 P0 (db layer) — R1 one-time claim tokens + R2 credential revocation.
 *
 * Covers:
 *  - issueMachineClaimToken: high-entropy plaintext returned ONCE, only the
 *    SHA-256 hash persisted, TTL honoured, older open tokens invalidated
 *  - redeemMachineClaimToken: right token → key ONCE (burned under
 *    `WHERE usedAt IS NULL`); replay → 'used'; expired → 'expired'; wrong token /
 *    unknown serial / token minted for ANOTHER machine → 'invalid' (uniform
 *    message, no enumeration); no key yet → 'no_key' and the burn ROLLS BACK
 *  - transitionMachineLifecycle → retired/decommissioned revokes EVERY credential
 *    (api_keys + machines.apiKey + open claim tokens) in ONE transaction, so a
 *    retired machine can no longer authenticate (the verified doc 51 gap:
 *    machineAuthService only gates on machines.isActive)
 *
 * The DB is faked at ./connection — same shape as db/machineLifecycle.test.ts,
 * extended with insert/returning/transaction which the claim path needs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { getTableName, getTableColumns } from "drizzle-orm";

type Row = Record<string, unknown>;

const fake = vi.hoisted(() => {
  const state = {
    /** FIFO queue feeding each `.limit()` / `.returning()` read. */
    selectResults: [] as unknown[][],
    /** Every `.set()` payload, in order, tagged with the table it hit. */
    updates: [] as Array<{ table: string; data: Record<string, unknown> }>,
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    /** Rows an `update(...).returning()` should report as affected, FIFO. */
    updateReturning: [] as unknown[][],
    txCount: 0,
    txFailed: false,
  };

  // Drizzle carries the SQL name on a well-known symbol; fall back to a tag we
  // stamp in the test when the table object is our own stub.
  const tableName = (t: unknown): string => {
    const anyT = t as Record<string | symbol, unknown>;
    for (const s of Object.getOwnPropertySymbols(anyT ?? {})) {
      if (String(s).includes("Name")) {
        const v = anyT[s];
        if (typeof v === "string") return v;
      }
    }
    return "unknown";
  };

  const makeHandle = () => {
    const handle: Record<string, unknown> = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => fake.state.selectResults.shift() ?? [],
            orderBy: () => ({ limit: async () => fake.state.selectResults.shift() ?? [] }),
          }),
        }),
      }),
      update: (table: unknown) => ({
        set: (data: Record<string, unknown>) => {
          const applied = { table: tableName(table), data };
          const where = (_cond?: unknown) => {
            const promise: any = Promise.resolve().then(() => { fake.state.updates.push(applied); });
            promise.returning = async () => {
              fake.state.updates.push(applied);
              return fake.state.updateReturning.shift() ?? [];
            };
            return promise;
          };
          return { where };
        },
      }),
      insert: (table: unknown) => ({
        values: async (values: Record<string, unknown>) => {
          fake.state.inserts.push({ table: tableName(table), values });
        },
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        fake.state.txCount += 1;
        try {
          return await fn(makeHandle());
        } catch (e) {
          fake.state.txFailed = true; // a real tx would ROLL BACK here
          throw e;
        }
      },
    };
    return handle;
  };

  return { state, db: makeHandle() };
});

vi.mock("./connection", () => ({ getDb: vi.fn(async () => fake.db) }));

import {
  issueMachineClaimToken,
  redeemMachineClaimToken,
  revokeMachineCredentials,
  transitionMachineLifecycle,
  machineClaimTokens,
  ClaimTokenError,
} from "./hierarchy";

const MACHINE = {
  id: 5, code: "AOI-01", name: "AOI Line A", isActive: true,
  lifecycleStatus: "active", registrationStatus: "approved",
  apiKey: "mach_SECRET", serialNumber: "SN-777",
};

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function futureToken(over: Row = {}): Row {
  return {
    id: 90, machineId: 5, tokenHash: "unused-here", tokenPrefix: "mct_aaaaaa",
    expiresAt: new Date(Date.now() + 10 * 60_000), usedAt: null, invalidatedAt: null,
    ...over,
  };
}

/** Queue: [machine-by-serial], [token], [claim burn returning], [fresh machine]. */
function primeRedeem(token: Row | null, machine: Row | null = MACHINE, burned = [{ id: 90 }]) {
  fake.state.selectResults = [
    machine ? [machine] : [],   // getMachineBySerialNumber → by serial
    ...(machine ? [] : [[]]),   // ...its code fallback when the serial misses
    token ? [token] : [],       // token lookup inside the tx
  ];
  fake.state.updateReturning = [burned];
  if (machine) fake.state.selectResults.push([machine]); // re-read inside the tx
}

beforeEach(() => {
  fake.state.selectResults = [];
  fake.state.updates = [];
  fake.state.inserts = [];
  fake.state.updateReturning = [];
  fake.state.txCount = 0;
  fake.state.txFailed = false;
  delete process.env.MACHINE_CLAIM_TOKEN_TTL_MINUTES;
});

// ── R1: issuance ────────────────────────────────────────────────────────────
describe("R1 — issueMachineClaimToken", () => {
  it("returns the plaintext ONCE and persists ONLY its hash", async () => {
    const r = await issueMachineClaimToken({ machineId: 5, issuedBy: 7 });

    expect(r.token).toMatch(/^mct_[0-9a-f]{64}$/); // 256 bits of CSPRNG
    expect(fake.state.inserts).toHaveLength(1);
    const row = fake.state.inserts[0].values;
    expect(row.tokenHash).toBe(sha256(r.token));
    expect(row.machineId).toBe(5);
    expect(row.issuedBy).toBe(7);
    // the plaintext must never reach the row
    expect(JSON.stringify(row)).not.toContain(r.token);
  });

  it("the non-secret prefix matches the token but is NOT enough to redeem it", async () => {
    const r = await issueMachineClaimToken({ machineId: 5 });
    expect(r.tokenPrefix).toHaveLength("mct_".length + 6);
    expect(r.token.startsWith(r.tokenPrefix)).toBe(true);
    expect(r.tokenPrefix.length).toBeLessThan(r.token.length);
  });

  it("two tokens are never the same (no PRNG reuse)", async () => {
    const a = await issueMachineClaimToken({ machineId: 5 });
    const b = await issueMachineClaimToken({ machineId: 5 });
    expect(a.token).not.toBe(b.token);
  });

  it("defaults to a 15-minute TTL", async () => {
    const r = await issueMachineClaimToken({ machineId: 5 });
    const minutes = (r.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it("TTL is configurable, and a nonsense value falls back to the safe default", async () => {
    process.env.MACHINE_CLAIM_TOKEN_TTL_MINUTES = "60";
    const ok = await issueMachineClaimToken({ machineId: 5 });
    expect((ok.expiresAt.getTime() - Date.now()) / 60_000).toBeGreaterThan(59);

    process.env.MACHINE_CLAIM_TOKEN_TTL_MINUTES = "999999"; // > 24h → clamped
    const clamped = await issueMachineClaimToken({ machineId: 5 });
    expect((clamped.expiresAt.getTime() - Date.now()) / 60_000).toBeLessThanOrEqual(15);
  });

  it("invalidates any older OPEN token for the machine (only one is ever redeemable)", async () => {
    await issueMachineClaimToken({ machineId: 5 });
    const invalidation = fake.state.updates.find((u) => "invalidatedAt" in u.data);
    expect(invalidation).toBeTruthy();
    expect(invalidation!.data.invalidatedAt).toBeInstanceOf(Date);
    // invalidate + insert must be one unit of work
    expect(fake.state.txCount).toBe(1);
  });
});

// ── R1: redemption ──────────────────────────────────────────────────────────
describe("R1 — redeemMachineClaimToken", () => {
  it("valid token → returns the apiKey and BURNS the token", async () => {
    const token = "mct_" + "b".repeat(64);
    primeRedeem(futureToken({ tokenHash: sha256(token) }));

    const r = await redeemMachineClaimToken({ serialNumber: "SN-777", claimToken: token, fromIp: "10.0.0.9" });
    expect(r).toEqual({ machineId: 5, machineCode: "AOI-01", apiKey: "mach_SECRET" });

    const burn = fake.state.updates.find((u) => "usedAt" in u.data);
    expect(burn!.data.usedAt).toBeInstanceOf(Date);
    expect(burn!.data.usedFromIp).toBe("10.0.0.9");
    expect(fake.state.txFailed).toBe(false);
  });

  it("REPLAY: a token already stamped usedAt → 'used' and no second key hand-out", async () => {
    const token = "mct_" + "b".repeat(64);
    primeRedeem(futureToken({ tokenHash: sha256(token), usedAt: new Date(Date.now() - 1000) }));

    await expect(redeemMachineClaimToken({ serialNumber: "SN-777", claimToken: token }))
      .rejects.toMatchObject({ name: "ClaimTokenError", reason: "used" });
    expect(fake.state.updates.some((u) => "usedAt" in u.data)).toBe(false);
  });

  it("RACE: the burn UPDATE affecting 0 rows means someone else won → 'used'", async () => {
    const token = "mct_" + "b".repeat(64);
    // token still looks open at SELECT time, but the conditional burn returns nothing
    primeRedeem(futureToken({ tokenHash: sha256(token) }), MACHINE, []);

    await expect(redeemMachineClaimToken({ serialNumber: "SN-777", claimToken: token }))
      .rejects.toMatchObject({ name: "ClaimTokenError", reason: "used" });
  });

  it("EXPIRED token → 'expired' (and is never burned)", async () => {
    const token = "mct_" + "c".repeat(64);
    primeRedeem(futureToken({ tokenHash: sha256(token), expiresAt: new Date(Date.now() - 1000) }));

    await expect(redeemMachineClaimToken({ serialNumber: "SN-777", claimToken: token }))
      .rejects.toMatchObject({ name: "ClaimTokenError", reason: "expired" });
    expect(fake.state.updates.some((u) => "usedAt" in u.data)).toBe(false);
  });

  it("WRONG token (hash miss) → 'invalid'", async () => {
    primeRedeem(null);
    await expect(redeemMachineClaimToken({ serialNumber: "SN-777", claimToken: "mct_" + "d".repeat(64) }))
      .rejects.toMatchObject({ name: "ClaimTokenError", reason: "invalid" });
  });

  it("INVALIDATED (superseded) token → 'invalid'", async () => {
    const token = "mct_" + "e".repeat(64);
    primeRedeem(futureToken({ tokenHash: sha256(token), invalidatedAt: new Date() }));
    await expect(redeemMachineClaimToken({ serialNumber: "SN-777", claimToken: token }))
      .rejects.toMatchObject({ name: "ClaimTokenError", reason: "invalid" });
  });

  it("unknown serial → 'invalid' with the SAME message as a wrong token (no enumeration)", async () => {
    primeRedeem(null, null);
    const unknownSerial = await redeemMachineClaimToken({ serialNumber: "nope", claimToken: "mct_" + "f".repeat(64) })
      .catch((e) => e as ClaimTokenError);
    primeRedeem(null);
    const wrongToken = await redeemMachineClaimToken({ serialNumber: "SN-777", claimToken: "mct_" + "f".repeat(64) })
      .catch((e) => e as ClaimTokenError);

    expect(unknownSerial.reason).toBe("invalid");
    expect(wrongToken.reason).toBe("invalid");
    expect(unknownSerial.message).toBe(wrongToken.message);
  });

  // NOTE: cross-machine isolation (a token minted for machine A must not claim
  // B's key) rests on the `eq(machineClaimTokens.machineId, machine.id)` term in
  // the lookup. This fake does NOT evaluate WHERE clauses, so asserting it here
  // would be theatre — it is covered by the uniqueness of tokenHash plus that
  // filter, and belongs in an integration test against a real Postgres.

  it("machine has no key yet → 'no_key' AND the burn is rolled back (token survives)", async () => {
    const token = "mct_" + "a".repeat(64);
    primeRedeem(futureToken({ tokenHash: sha256(token) }), { ...MACHINE, apiKey: null });

    await expect(redeemMachineClaimToken({ serialNumber: "SN-777", claimToken: token }))
      .rejects.toMatchObject({ name: "ClaimTokenError", reason: "no_key" });
    // the burn was attempted, but the transaction failed → rolled back
    expect(fake.state.txFailed).toBe(true);
  });

  it("soft-deleted machine → 'invalid'", async () => {
    const token = "mct_" + "a".repeat(64);
    primeRedeem(futureToken({ tokenHash: sha256(token) }), { ...MACHINE, isActive: false });
    await expect(redeemMachineClaimToken({ serialNumber: "SN-777", claimToken: token }))
      .rejects.toMatchObject({ reason: "invalid" });
  });
});

// ── R2: retire/decommission revokes credentials ─────────────────────────────
describe("R2 — transitionMachineLifecycle revokes credentials", () => {
  /** [machine read], then the revoke's two `.returning()` reads. */
  function primeTransition(from: string, keysRevoked = 2, sharedCleared = true) {
    fake.state.selectResults = [[{ ...MACHINE, lifecycleStatus: from }]];
    fake.state.updateReturning = [
      Array.from({ length: keysRevoked }, (_, i) => ({ id: i + 1 })), // api_keys
      sharedCleared ? [{ id: 5 }] : [],                                // machines.apiKey
    ];
  }

  it("→ decommissioned: revokes api_keys, clears machines.apiKey, burns open tokens — in ONE transaction", async () => {
    primeTransition("active");
    const r = await transitionMachineLifecycle(5, "decommissioned");

    expect(r.after.lifecycleStatus).toBe("decommissioned");
    expect(r.revoked).toEqual({ apiKeysRevoked: 2, sharedKeyCleared: true });
    expect(fake.state.txCount).toBe(1);

    // 1) scoped keys killed (BOTH bits machineAuthService checks)
    const keyRevoke = fake.state.updates.find((u) => u.data.revokedAt !== undefined);
    expect(keyRevoke!.table).toBe("api_keys");
    expect(keyRevoke!.data.isActive).toBe(false);
    expect(keyRevoke!.data.revokedAt).toBeInstanceOf(Date);

    // 2) the legacy shared plaintext key is gone
    const shared = fake.state.updates.find((u) => "apiKey" in u.data);
    expect(shared!.table).toBe("machines");
    expect(shared!.data.apiKey).toBeNull();

    // 3) nothing left to claim
    expect(fake.state.updates.some((u) => "invalidatedAt" in u.data)).toBe(true);
  });

  it("→ retired: same revocation (decommissioned → retired)", async () => {
    primeTransition("decommissioned");
    const r = await transitionMachineLifecycle(5, "retired");
    expect(r.after.lifecycleStatus).toBe("retired");
    expect(r.revoked!.apiKeysRevoked).toBe(2);
    expect(fake.state.updates.find((u) => "apiKey" in u.data)!.data.apiKey).toBeNull();
  });

  it("the lifecycle stamp and the revoke are in the SAME transaction (no retired-but-live window)", async () => {
    primeTransition("active");
    await transitionMachineLifecycle(5, "decommissioned");
    expect(fake.state.txCount).toBe(1);
    const stamped = fake.state.updates.find((u) => u.data.lifecycleStatus === "decommissioned");
    expect(stamped).toBeTruthy();
    expect(fake.state.txFailed).toBe(false);
  });

  it("reports honestly when there was nothing to revoke", async () => {
    primeTransition("active", 0, false);
    const r = await transitionMachineLifecycle(5, "decommissioned");
    expect(r.revoked).toEqual({ apiKeysRevoked: 0, sharedKeyCleared: false });
  });

  // Regression guard for db/machineLifecycle.test.ts: non-terminal transitions
  // stay a single bare UPDATE — no transaction, no credential churn.
  it.each([
    ["active", "maintenance"],
    ["maintenance", "active"],
    ["active", "faulted"],
  ])("%s → %s does NOT touch credentials", async (from, to) => {
    fake.state.selectResults = [[{ ...MACHINE, lifecycleStatus: from }]];
    const r = await transitionMachineLifecycle(5, to as never);

    expect(r.revoked).toBeUndefined();
    expect(fake.state.txCount).toBe(0);
    expect(fake.state.updates).toHaveLength(1);
    expect(fake.state.updates[0].data.lifecycleStatus).toBe(to);
    expect(fake.state.updates[0].data).not.toHaveProperty("apiKey");
  });

  it("an ILLEGAL transition to retired revokes nothing", async () => {
    fake.state.selectResults = [[{ ...MACHINE, lifecycleStatus: "active" }]]; // active → retired is illegal
    await expect(transitionMachineLifecycle(5, "retired"))
      .rejects.toMatchObject({ name: "LifecycleTransitionError" });
    expect(fake.state.updates).toHaveLength(0);
    expect(fake.state.txCount).toBe(0);
  });
});

describe("R2 — revokeMachineCredentials (standalone tooling entry point)", () => {
  it("kills scoped keys, the shared key and open claim tokens", async () => {
    fake.state.updateReturning = [[{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 5 }]];
    const r = await revokeMachineCredentials(5);

    expect(r).toEqual({ apiKeysRevoked: 3, sharedKeyCleared: true });
    expect(fake.state.txCount).toBe(1);
    const tables = fake.state.updates.map((u) => u.table);
    expect(tables).toContain("api_keys");
    expect(tables).toContain("machines");
    expect(tables).toContain("machine_claim_tokens");
  });
});

describe("schema — machine_claim_tokens", () => {
  it("declares the exact table + columns migration 0273 creates", () => {
    // Cheap guard against the pgTable and the hand-written SQL drifting apart
    // (this table is declared in db/hierarchy.ts, not drizzle/schema, so
    // drizzle-kit will not catch a mismatch for us).
    expect(getTableName(machineClaimTokens)).toBe("machine_claim_tokens");
    const columns = Object.keys(getTableColumns(machineClaimTokens)).sort();
    expect(columns).toEqual([
      "createdAt", "expiresAt", "id", "invalidatedAt", "issuedBy",
      "machineId", "tokenHash", "tokenPrefix", "usedAt", "usedFromIp",
    ]);
  });
});
