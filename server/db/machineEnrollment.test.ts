/**
 * Doc 51 P3 / §5.1 (db layer) — ZERO-TOUCH ENROLLMENT tokens.
 *
 * Covers:
 *  - issueMachineEnrollmentToken: high-entropy plaintext returned ONCE, only the
 *    SHA-256 hash persisted, TTL honoured, scopes/maxUses/serialPattern stored
 *  - serialMatchesEnrollmentPattern: exact / prefix-glob / null=any / mismatch
 *  - redeemMachineEnrollmentToken:
 *      • existing pending machine → approved + scopes returned, token BURNED
 *      • new machine (machineInfo) → created approved+active
 *      • wrong / expired / revoked / exhausted / serial-mismatch → rejected with
 *        the right reason; uniform message for the secrecy cases
 *      • retired machine / missing machineType → rejected BEFORE the burn (no
 *        token use is wasted on a state error)
 *      • single-use: a burn UPDATE affecting 0 rows → 'exhausted'
 *
 * The DB is faked at ./connection (same idiom as db/machineClaimToken.test.ts,
 * extended with insert(...).returning() which the create path needs).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { getTableName, getTableColumns } from "drizzle-orm";

type Row = Record<string, unknown>;

const fake = vi.hoisted(() => {
  const state = {
    selectResults: [] as unknown[][],
    updates: [] as Array<{ table: string; data: Record<string, unknown> }>,
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    updateReturning: [] as unknown[][],
    insertReturning: [] as unknown[][],
    txCount: 0,
    txFailed: false,
  };

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
    // A chainable, awaitable query: where()/orderBy() chain; limit() (or awaiting
    // an orderBy-terminated query) resolves the next queued select result.
    const makeQuery = () => {
      const resolve = async () => fake.state.selectResults.shift() ?? [];
      const q: any = {};
      q.where = () => q;
      q.orderBy = () => q;
      q.limit = () => resolve();
      q.then = (onF: any, onR: any) => resolve().then(onF, onR);
      return q;
    };

    const handle: Record<string, unknown> = {
      select: () => ({ from: () => makeQuery() }),
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
        values: (values: Record<string, unknown>) => {
          const promise: any = Promise.resolve().then(() => {
            fake.state.inserts.push({ table: tableName(table), values });
          });
          promise.returning = async () => {
            fake.state.inserts.push({ table: tableName(table), values });
            return fake.state.insertReturning.shift() ?? [];
          };
          return promise;
        },
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        fake.state.txCount += 1;
        try {
          return await fn(makeHandle());
        } catch (e) {
          fake.state.txFailed = true;
          throw e;
        }
      },
    };
    return handle;
  };

  return { state, db: makeHandle() };
});

vi.mock("./connection", () => ({ getDb: vi.fn(async () => fake.db) }));
// urnService is dynamically imported by createMachine's queueUrnSync — stub it so
// the fire-and-forget hook resolves to a no-op instead of hitting the real module.
vi.mock("../services/assetRegistry/urnService", () => ({
  queueAssetIdentitySync: vi.fn(),
  queueStationAssetIdentitySync: vi.fn(),
  queueLineAssetIdentitySync: vi.fn(),
}));

import {
  issueMachineEnrollmentToken,
  redeemMachineEnrollmentToken,
  serialMatchesEnrollmentPattern,
  machineEnrollmentTokens,
  EnrollmentTokenError,
} from "./hierarchy";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const PENDING_MACHINE = {
  id: 5, code: "SN-777", name: "AOI 1", isActive: true,
  lifecycleStatus: "commissioning", registrationStatus: "pending",
  apiKey: null, serialNumber: "SN-777", stationId: 41,
};

function futureToken(over: Row = {}): Row {
  return {
    id: 90, tokenHash: "unused", tokenPrefix: "met_aaaaaa",
    serialPattern: null, scopes: ["ingest:write", "equipment:read"],
    maxUses: 1, useCount: 0,
    expiresAt: new Date(Date.now() + 10 * 60_000), revokedAt: null,
    ...over,
  };
}

beforeEach(() => {
  fake.state.selectResults = [];
  fake.state.updates = [];
  fake.state.inserts = [];
  fake.state.updateReturning = [];
  fake.state.insertReturning = [];
  fake.state.txCount = 0;
  fake.state.txFailed = false;
  delete process.env.MACHINE_ENROLLMENT_TOKEN_TTL_MINUTES;
});

// ── issuance ─────────────────────────────────────────────────────────────────
describe("issueMachineEnrollmentToken", () => {
  it("returns the plaintext ONCE and persists ONLY its hash", async () => {
    const r = await issueMachineEnrollmentToken({ issuedBy: 7 });
    expect(r.token).toMatch(/^met_[0-9a-f]{64}$/);
    expect(fake.state.inserts).toHaveLength(1);
    const row = fake.state.inserts[0].values;
    expect(row.tokenHash).toBe(sha256(r.token));
    expect(JSON.stringify(row)).not.toContain(r.token); // plaintext never stored
    expect(row.issuedBy).toBe(7);
  });

  it("defaults: scopes=[ingest:write,equipment:read], maxUses=1, serialPattern=null", async () => {
    const r = await issueMachineEnrollmentToken({});
    expect(r.scopes).toEqual(["ingest:write", "equipment:read"]);
    expect(r.maxUses).toBe(1);
    expect(r.serialPattern).toBeNull();
    const row = fake.state.inserts[0].values;
    expect(row.scopes).toEqual(["ingest:write", "equipment:read"]);
    expect(row.maxUses).toBe(1);
  });

  it("stores a custom allowlist (serialPattern + maxUses + narrowed scopes)", async () => {
    const r = await issueMachineEnrollmentToken({
      serialPattern: "AOI-2026-*", maxUses: 50, scopes: ["ingest:write"],
    });
    expect(r.serialPattern).toBe("AOI-2026-*");
    expect(r.maxUses).toBe(50);
    expect(r.scopes).toEqual(["ingest:write"]);
  });

  it("defaults to a 60-minute TTL, configurable and clamped", async () => {
    const def = await issueMachineEnrollmentToken({});
    const mins = (def.expiresAt.getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(59);
    expect(mins).toBeLessThanOrEqual(60);

    process.env.MACHINE_ENROLLMENT_TOKEN_TTL_MINUTES = String(60 * 24 * 999); // > 30d → clamp
    const clamped = await issueMachineEnrollmentToken({});
    expect((clamped.expiresAt.getTime() - Date.now()) / 60_000).toBeLessThanOrEqual(60);
  });

  it("two tokens are never the same (no PRNG reuse)", async () => {
    const a = await issueMachineEnrollmentToken({});
    const b = await issueMachineEnrollmentToken({});
    expect(a.token).not.toBe(b.token);
  });

  it("the non-secret prefix matches the token but cannot redeem it", async () => {
    const r = await issueMachineEnrollmentToken({});
    expect(r.token.startsWith(r.tokenPrefix)).toBe(true);
    expect(r.tokenPrefix.length).toBeLessThan(r.token.length);
  });
});

// ── pattern matcher (pure) ────────────────────────────────────────────────────
describe("serialMatchesEnrollmentPattern", () => {
  it("null/empty pattern → matches any serial (one-time token)", () => {
    expect(serialMatchesEnrollmentPattern("ANYTHING", null)).toBe(true);
    expect(serialMatchesEnrollmentPattern("ANYTHING", undefined)).toBe(true);
  });
  it("exact match", () => {
    expect(serialMatchesEnrollmentPattern("AOI-777", "AOI-777")).toBe(true);
    expect(serialMatchesEnrollmentPattern("AOI-778", "AOI-777")).toBe(false);
  });
  it("trailing-* prefix match (no regex → no ReDoS)", () => {
    expect(serialMatchesEnrollmentPattern("AOI-2026-01", "AOI-2026-*")).toBe(true);
    expect(serialMatchesEnrollmentPattern("AVI-2026-01", "AOI-2026-*")).toBe(false);
    expect(serialMatchesEnrollmentPattern("AOI-2026-", "AOI-2026-*")).toBe(true); // empty suffix ok
  });
});

// ── redemption: existing (pending) machine ────────────────────────────────────
describe("redeemMachineEnrollmentToken — existing machine", () => {
  /** Queue: [machine-by-serial], [token in tx], [fresh machine]. Burn returns 1 row. */
  function prime(token: Row, machine: Row = PENDING_MACHINE) {
    fake.state.selectResults = [[machine], [token], [machine]];
    fake.state.updateReturning = [[{ id: token.id }]];
  }

  it("valid token → approves the machine, returns its scopes, created=false, BURNS the token", async () => {
    const token = "met_" + "b".repeat(64);
    prime(futureToken({ tokenHash: sha256(token) }));

    const r = await redeemMachineEnrollmentToken({ serialNumber: "SN-777", enrollmentToken: token, fromIp: "10.0.0.9" });
    expect(r).toEqual({ machineId: 5, machineCode: "SN-777", scopes: ["ingest:write", "equipment:read"], created: false });

    // the token use was burned (useCount increment), with the IP
    const burn = fake.state.updates.find((u) => u.table === "machine_enrollment_tokens" && "useCount" in u.data);
    expect(burn).toBeTruthy();
    expect(burn!.data.lastUsedFromIp).toBe("10.0.0.9");
    // the machine was approved (registrationStatus flipped)
    const approve = fake.state.updates.find((u) => u.table === "machines" && u.data.registrationStatus === "approved");
    expect(approve).toBeTruthy();
    expect(fake.state.txFailed).toBe(false);
  });

  it("carries the token's NARROWED scopes through to the caller", async () => {
    const token = "met_" + "c".repeat(64);
    prime(futureToken({ tokenHash: sha256(token), scopes: ["ingest:write"] }));
    const r = await redeemMachineEnrollmentToken({ serialNumber: "SN-777", enrollmentToken: token });
    expect(r.scopes).toEqual(["ingest:write"]);
  });

  it("WRONG token (hash miss) → 'invalid', and nothing is approved/burned", async () => {
    fake.state.selectResults = [[PENDING_MACHINE], []]; // machine found, token lookup empty
    await expect(redeemMachineEnrollmentToken({ serialNumber: "SN-777", enrollmentToken: "met_" + "d".repeat(64) }))
      .rejects.toMatchObject({ name: "EnrollmentTokenError", reason: "invalid" });
    expect(fake.state.updates.some((u) => "useCount" in u.data)).toBe(false);
    expect(fake.state.txFailed).toBe(true); // burn tx rolled back
  });

  it("EXPIRED token → 'expired' (never burned)", async () => {
    const token = "met_" + "e".repeat(64);
    prime(futureToken({ tokenHash: sha256(token), expiresAt: new Date(Date.now() - 1000) }));
    await expect(redeemMachineEnrollmentToken({ serialNumber: "SN-777", enrollmentToken: token }))
      .rejects.toMatchObject({ reason: "expired" });
    expect(fake.state.updates.some((u) => "useCount" in u.data)).toBe(false);
  });

  it("REVOKED token → 'invalid' (uniform — revocation is not revealed)", async () => {
    const token = "met_" + "f".repeat(64);
    prime(futureToken({ tokenHash: sha256(token), revokedAt: new Date() }));
    await expect(redeemMachineEnrollmentToken({ serialNumber: "SN-777", enrollmentToken: token }))
      .rejects.toMatchObject({ reason: "invalid" });
  });

  it("EXHAUSTED token (useCount >= maxUses) → 'exhausted'", async () => {
    const token = "met_" + "1".repeat(64);
    prime(futureToken({ tokenHash: sha256(token), maxUses: 3, useCount: 3 }));
    await expect(redeemMachineEnrollmentToken({ serialNumber: "SN-777", enrollmentToken: token }))
      .rejects.toMatchObject({ reason: "exhausted" });
  });

  it("SINGLE-USE RACE: the burn UPDATE affects 0 rows → 'exhausted'", async () => {
    const token = "met_" + "2".repeat(64);
    fake.state.selectResults = [[PENDING_MACHINE], [futureToken({ tokenHash: sha256(token) })]];
    fake.state.updateReturning = [[]]; // conditional burn matched nothing → someone else won
    await expect(redeemMachineEnrollmentToken({ serialNumber: "SN-777", enrollmentToken: token }))
      .rejects.toMatchObject({ reason: "exhausted" });
  });

  it("SERIAL MISMATCH on an allowlist token → 'invalid' (pattern not revealed)", async () => {
    const token = "met_" + "3".repeat(64);
    // machine exists for a different serial; token only allows AOI-2026-*
    prime(futureToken({ tokenHash: sha256(token), serialPattern: "AOI-2026-*" }), { ...PENDING_MACHINE, serialNumber: "OTHER-1" });
    await expect(redeemMachineEnrollmentToken({ serialNumber: "OTHER-1", enrollmentToken: token }))
      .rejects.toMatchObject({ reason: "invalid" });
    expect(fake.state.updates.some((u) => "useCount" in u.data)).toBe(false);
  });

  it("an allowlist token WHOSE pattern matches enrolls normally", async () => {
    const token = "met_" + "4".repeat(64);
    const m = { ...PENDING_MACHINE, serialNumber: "AOI-2026-05", code: "SN-AOI-2026-05" };
    prime(futureToken({ tokenHash: sha256(token), serialPattern: "AOI-2026-*", maxUses: 10, useCount: 2 }), m);
    const r = await redeemMachineEnrollmentToken({ serialNumber: "AOI-2026-05", enrollmentToken: token });
    expect(r.machineId).toBe(5);
    expect(r.created).toBe(false);
  });
});

// ── redemption: state errors are checked BEFORE the burn (no wasted use) ──────
describe("redeemMachineEnrollmentToken — pre-burn state guards", () => {
  it.each(["retired", "decommissioned"] as const)("a %s machine → 'machine_locked' and the token is NEVER touched", async (state) => {
    fake.state.selectResults = [[{ ...PENDING_MACHINE, lifecycleStatus: state }]];
    await expect(redeemMachineEnrollmentToken({ serialNumber: "SN-777", enrollmentToken: "met_" + "a".repeat(64) }))
      .rejects.toMatchObject({ reason: "machine_locked" });
    // the token lookup/burn transaction never ran → no use consumed
    expect(fake.state.txCount).toBe(0);
    expect(fake.state.updates).toHaveLength(0);
  });

  it("unknown machine + no machineInfo.machineType → 'needs_info', token untouched", async () => {
    fake.state.selectResults = [[], []]; // by-serial miss, by-code miss
    await expect(redeemMachineEnrollmentToken({ serialNumber: "GHOST", enrollmentToken: "met_" + "a".repeat(64) }))
      .rejects.toMatchObject({ reason: "needs_info" });
    expect(fake.state.txCount).toBe(0);
  });
});

// ── redemption: create a brand-new machine ────────────────────────────────────
describe("redeemMachineEnrollmentToken — creates a new machine", () => {
  it("unknown serial + machineInfo → creates an approved+active machine, created=true", async () => {
    const token = "met_" + "9".repeat(64);
    // [by-serial miss], [by-code miss], [default station], [code-collision check miss], [token]
    fake.state.selectResults = [[], [], [{ id: 41, code: "S1", name: "Station 1", isActive: true }], [], [futureToken({ tokenHash: sha256(token) })]];
    fake.state.updateReturning = [[{ id: 90 }]]; // burn
    fake.state.insertReturning = [[{ id: 77 }]]; // createMachine

    const r = await redeemMachineEnrollmentToken({
      serialNumber: "NEW-1",
      enrollmentToken: token,
      machineInfo: { name: "New AOI", machineType: "AOI" },
    });
    expect(r).toMatchObject({ machineId: 77, machineCode: "SN-NEW-1", created: true });

    const inserted = fake.state.inserts.find((i) => i.table === "machines");
    expect(inserted).toBeTruthy();
    expect(inserted!.values).toMatchObject({
      code: "SN-NEW-1", serialNumber: "NEW-1", machineType: "AOI",
      registrationStatus: "approved", lifecycleStatus: "active", stationId: 41,
    });
  });

  it("no active station configured → 'no_station' (token untouched)", async () => {
    fake.state.selectResults = [[], [], []]; // by-serial miss, by-code miss, station miss
    await expect(redeemMachineEnrollmentToken({
      serialNumber: "NEW-2", enrollmentToken: "met_" + "a".repeat(64), machineInfo: { machineType: "AOI" },
    })).rejects.toMatchObject({ reason: "no_station" });
    expect(fake.state.txCount).toBe(0);
  });
});

// ── schema drift guard ────────────────────────────────────────────────────────
describe("schema — machine_enrollment_tokens", () => {
  it("declares the exact table + columns migration 0283 creates", () => {
    expect(getTableName(machineEnrollmentTokens)).toBe("machine_enrollment_tokens");
    const columns = Object.keys(getTableColumns(machineEnrollmentTokens)).sort();
    expect(columns).toEqual([
      "createdAt", "expiresAt", "id", "issuedBy", "lastUsedAt", "lastUsedFromIp",
      "maxUses", "note", "revokedAt", "scopes", "serialPattern", "tokenHash",
      "tokenPrefix", "useCount",
    ]);
  });
});
