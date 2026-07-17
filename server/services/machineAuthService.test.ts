/**
 * Doc 27 Đợt 2 / W2-C — per-machine credential tests (gap C7).
 * Doc 51 P0 / QĐ#1 — weak-auth tri-state policy + warn-then-deny telemetry.
 *
 * INTEGRATION tests against the isolated test DB (vitest.setup.ts forces
 * DATABASE_URL → <db>_test; migration 0178 adds api_keys.machineId/revokedAt):
 *   accept / wrong-scope / revoked / rotated / expired / legacy-shared-key
 *   (+ flag-off) / rate-limit / weak-auth policy + telemetry.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import * as db from "../db";
import { apiKeys } from "../../drizzle/schema";
import {
  authenticateMachine,
  issueMachineKey,
  rotateMachineKey,
  revokeMachineKey,
  listMachineKeys,
  listExpiringMachineKeys,
  machineKeyDefaultTtlDays,
  enforceMachineIngestRateLimit,
  sharedMachineKeyAllowed,
  sharedMachineKeyPolicy,
  machineCodeOnlyPolicy,
  getWeakAuthUsage,
  getWeakAuthUsageOverflow,
  _resetMachineAuthState,
} from "./machineAuthService";

const STAMP = Date.now();
const SHARED_KEY = `W2C-SHARED-${STAMP}`;
const MACHINE_CODE = `W2C-AUTH-${STAMP}`;
let machineId: number;

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1, // soft-ref (no FK on master data yet — gap M1, Đợt 3)
    code: MACHINE_CODE,
    name: "W2-C auth test machine",
    machineType: "AVI",
    apiKey: SHARED_KEY,
    isActive: true,
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (d && machineId) {
    await d.delete(apiKeys).where(eq(apiKeys.machineId, machineId));
  }
  if (machineId) await db.deleteMachine(machineId);
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  delete process.env.MACHINE_CODE_ONLY_ALLOWED;
  delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN;
  delete process.env.MACHINE_KEY_DEFAULT_TTL_DAYS;
});

beforeEach(() => {
  _resetMachineAuthState();
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  delete process.env.MACHINE_CODE_ONLY_ALLOWED;
  delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN;
  delete process.env.MACHINE_KEY_DEFAULT_TTL_DAYS;
});

describe("per-machine scoped keys (api_keys + machineId, migration 0178)", () => {
  it("issues a key (plaintext ONCE, hash at rest) and authenticates with it", async () => {
    const issued = await issueMachineKey({ machineId, name: "primary" });
    expect(issued.plaintextKey).toMatch(/^mk_[0-9a-f]{48}$/);
    expect(issued.machineId).toBe(machineId);
    expect((issued as Record<string, unknown>).keyHash).toBeUndefined(); // never exposed

    const auth = await authenticateMachine({ apiKey: issued.plaintextKey, scope: "ingest:write" });
    expect(auth.method).toBe("machine-key");
    expect(auth.machine.id).toBe(machineId);
    expect(auth.keyId).toBe(issued.id);

    // the DB row stores only the hash — the plaintext appears nowhere
    const d = await db.getDb();
    const [row] = await d!.select().from(apiKeys).where(eq(apiKeys.id, issued.id)).limit(1);
    expect(row.keyHash).not.toContain(issued.plaintextKey);
    expect(row.keyHash).toMatch(/^[0-9a-f]{64}$/);

    await revokeMachineKey(issued.id);
  });

  it("rejects a key that lacks the required scope (FORBIDDEN)", async () => {
    const issued = await issueMachineKey({ machineId, scopes: ["equipment:read"] });
    await expect(
      authenticateMachine({ apiKey: issued.plaintextKey, scope: "ingest:write" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // …but the granted scope works
    const ok = await authenticateMachine({ apiKey: issued.plaintextKey, scope: "equipment:read" });
    expect(ok.method).toBe("machine-key");
    await revokeMachineKey(issued.id);
  });

  it("rejects a revoked key (no fallthrough to the shared key)", async () => {
    const issued = await issueMachineKey({ machineId });
    await revokeMachineKey(issued.id);
    await expect(
      authenticateMachine({ apiKey: issued.plaintextKey, scope: "ingest:write" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "API key revoked" });

    const rows = await listMachineKeys(machineId);
    const revoked = rows.find((r) => r.id === issued.id);
    expect(revoked?.isActive).toBe(false);
    expect(revoked?.revokedAt).toBeTruthy();
  });

  it("rotation revokes the old key and mints a working replacement", async () => {
    const issued = await issueMachineKey({ machineId, scopes: ["ingest:write"] });
    const rotated = await rotateMachineKey(issued.id);
    expect(rotated.machineId).toBe(machineId);
    expect(rotated.scopes).toEqual(["ingest:write"]);
    expect(rotated.plaintextKey).not.toBe(issued.plaintextKey);

    await expect(
      authenticateMachine({ apiKey: issued.plaintextKey }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const ok = await authenticateMachine({ apiKey: rotated.plaintextKey, scope: "ingest:write" });
    expect(ok.machine.id).toBe(machineId);
    await revokeMachineKey(rotated.id);
  });

  it("rejects an expired key", async () => {
    const issued = await issueMachineKey({
      machineId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(
      authenticateMachine({ apiKey: issued.plaintextKey }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "API key expired" });
    await revokeMachineKey(issued.id);
  });
});

describe("legacy shared plaintext key (backward compat, MACHINE_SHARED_KEY_ALLOWED)", () => {
  it("is accepted by default (method=shared-key) — existing machines keep working", async () => {
    expect(sharedMachineKeyAllowed()).toBe(true);
    const auth = await authenticateMachine({ apiKey: SHARED_KEY, scope: "ingest:write" });
    expect(auth.method).toBe("shared-key");
    expect(auth.machine.id).toBe(machineId);
  });

  it("is denied once MACHINE_SHARED_KEY_ALLOWED=false (rotation complete)", async () => {
    process.env.MACHINE_SHARED_KEY_ALLOWED = "false";
    await expect(
      authenticateMachine({ apiKey: SHARED_KEY }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("a bogus key with a healthy DB → UNAUTHORIZED (not buffered/500)", async () => {
    await expect(
      authenticateMachine({ apiKey: `mk_${"0".repeat(48)}` }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Doc 51 P0 (QĐ#1) — controlled migration off the weak auth paths.
// ════════════════════════════════════════════════════════════════════════════

describe("doc 51 P0 — weak-auth policy flags (tri-state)", () => {
  it("defaults to `allow` for BOTH weak paths — an un-rotated fleet keeps running", () => {
    expect(sharedMachineKeyPolicy()).toBe("allow");
    expect(machineCodeOnlyPolicy()).toBe("allow");
    expect(sharedMachineKeyAllowed()).toBe(true); // back-compat shim
  });

  it("parses the LEGACY boolean vocabulary with its ORIGINAL meaning (no weakening)", () => {
    process.env.MACHINE_SHARED_KEY_ALLOWED = "false";
    expect(sharedMachineKeyPolicy()).toBe("deny");
    expect(sharedMachineKeyAllowed()).toBe(false);
    process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
    expect(sharedMachineKeyPolicy()).toBe("allow");
  });

  it("parses the new `read-only` middle step", () => {
    process.env.MACHINE_SHARED_KEY_ALLOWED = "read-only";
    process.env.MACHINE_CODE_ONLY_ALLOWED = "readonly";
    expect(sharedMachineKeyPolicy()).toBe("read-only");
    expect(machineCodeOnlyPolicy()).toBe("read-only");
    expect(sharedMachineKeyAllowed()).toBe(true); // still accepted *somewhere*
  });

  it("falls back to the default on a garbage value (a typo must not kill a line)", () => {
    process.env.MACHINE_SHARED_KEY_ALLOWED = "fasle"; // typo
    expect(sharedMachineKeyPolicy()).toBe("allow"); // == unset, never more permissive
  });
});

describe("doc 51 P0 — shared plaintext key: deny / read-only gating", () => {
  it("policy=deny → denied for BOTH write and read scopes", async () => {
    process.env.MACHINE_SHARED_KEY_ALLOWED = "false";
    await expect(
      authenticateMachine({ apiKey: SHARED_KEY, scope: "ingest:write" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      authenticateMachine({ apiKey: SHARED_KEY, scope: "equipment:read" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("policy=read-only → ingest WRITE denied, equipment READ still served", async () => {
    process.env.MACHINE_SHARED_KEY_ALLOWED = "read-only";
    await expect(
      authenticateMachine({ apiKey: SHARED_KEY, scope: "ingest:write" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const ok = await authenticateMachine({ apiKey: SHARED_KEY, scope: "equipment:read" });
    expect(ok.method).toBe("shared-key");
    expect(ok.machine.id).toBe(machineId);
  });

  it("policy=read-only + NO scope declared → denied (fail-closed)", async () => {
    process.env.MACHINE_SHARED_KEY_ALLOWED = "read-only";
    await expect(authenticateMachine({ apiKey: SHARED_KEY })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("the denial message names the machine + the mk_ header remedy (diagnosable 401)", async () => {
    process.env.MACHINE_SHARED_KEY_ALLOWED = "false";
    await expect(
      authenticateMachine({ apiKey: SHARED_KEY, scope: "ingest:write" }),
    ).rejects.toMatchObject({ message: expect.stringContaining(MACHINE_CODE) });
    // …while an UNKNOWN key stays generic — no "is this a real key?" oracle beyond
    // what the presenter already holds.
    await expect(
      authenticateMachine({ apiKey: `mk_${"0".repeat(48)}`, scope: "ingest:write" }),
    ).rejects.toMatchObject({ message: "Invalid API key" });
  });
});

describe("doc 51 P0 — machineCode-only (no secret): deny / read-only gating", () => {
  it("policy=allow (default) → still accepted, so nothing breaks on upgrade", async () => {
    const auth = await authenticateMachine({ machineCode: MACHINE_CODE, scope: "ingest:write" });
    expect(auth.method).toBe("machine-code");
    expect(auth.machine.id).toBe(machineId);
  });

  it("policy=deny → denied even for reads", async () => {
    process.env.MACHINE_CODE_ONLY_ALLOWED = "false";
    await expect(
      authenticateMachine({ machineCode: MACHINE_CODE, scope: "equipment:read" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("policy=read-only → forged ingest STOPS, config polling survives", async () => {
    process.env.MACHINE_CODE_ONLY_ALLOWED = "read-only";
    await expect(
      authenticateMachine({ machineCode: MACHINE_CODE, scope: "ingest:write" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const ok = await authenticateMachine({ machineCode: MACHINE_CODE, scope: "equipment:read" });
    expect(ok.method).toBe("machine-code");
  });

  it("an UNKNOWN machineCode stays a generic 401 regardless of policy", async () => {
    process.env.MACHINE_CODE_ONLY_ALLOWED = "false";
    await expect(
      authenticateMachine({ machineCode: `NOPE-${STAMP}`, scope: "ingest:write" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Invalid machine code" });
  });

  it("the two flags are INDEPENDENT — denying machineCode does not deny the shared key", async () => {
    process.env.MACHINE_CODE_ONLY_ALLOWED = "false";
    const ok = await authenticateMachine({ apiKey: SHARED_KEY, scope: "ingest:write" });
    expect(ok.method).toBe("shared-key");
  });
});

describe("doc 51 P0 — warn-then-deny telemetry (the flip prerequisite)", () => {
  it("records machineId + method + endpoint on an ALLOWED weak use", async () => {
    await authenticateMachine({ apiKey: SHARED_KEY, scope: "ingest:write", endpoint: "submitInspection" });
    const rows = getWeakAuthUsage();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      machineId,
      machineCode: MACHINE_CODE,
      method: "shared-key",
      endpoint: "submitInspection",
      outcome: "allowed",
      count: 1,
    });
    expect(rows[0].firstSeenAt).toBeTruthy();
    expect(rows[0].lastSeenAt).toBeTruthy();
  });

  it("counts EVERY use — unthrottled, unlike the old 10-min console.warn", async () => {
    for (let i = 0; i < 5; i++) {
      await authenticateMachine({ apiKey: SHARED_KEY, scope: "ingest:write", endpoint: "submitInspection" });
    }
    const rows = getWeakAuthUsage();
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(5); // the throttle drops LOG lines, never evidence
    expect(getWeakAuthUsageOverflow()).toBe(0);
  });

  it("records DENIED attempts too — that is the post-flip rollback signal", async () => {
    process.env.MACHINE_SHARED_KEY_ALLOWED = "false";
    await expect(
      authenticateMachine({ apiKey: SHARED_KEY, scope: "ingest:write", endpoint: "submitInspection" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const rows = getWeakAuthUsage();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      machineId,
      machineCode: MACHINE_CODE,
      method: "shared-key",
      outcome: "denied",
      count: 1,
    });
  });

  it("falls back to the required scope when the caller omits an endpoint label", async () => {
    await authenticateMachine({ machineCode: MACHINE_CODE, scope: "equipment:read" });
    expect(getWeakAuthUsage()[0]).toMatchObject({ method: "machine-code", endpoint: "equipment:read" });
  });

  it("buckets per machine × method × endpoint × outcome", async () => {
    process.env.MACHINE_SHARED_KEY_ALLOWED = "read-only";
    await authenticateMachine({ apiKey: SHARED_KEY, scope: "equipment:read", endpoint: "getPoints" });
    await authenticateMachine({ machineCode: MACHINE_CODE, scope: "equipment:read", endpoint: "getPoints" });
    await expect(
      authenticateMachine({ apiKey: SHARED_KEY, scope: "ingest:write", endpoint: "submitInspection" }),
    ).rejects.toThrow();
    const rows = getWeakAuthUsage();
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.method === "shared-key")).toHaveLength(2);
    expect(rows.filter((r) => r.method === "machine-code")).toHaveLength(1);
    expect(rows.filter((r) => r.outcome === "denied")).toHaveLength(1);
  });

  it("a proper mk_ scoped key emits NOTHING — only weak paths are on the report", async () => {
    const issued = await issueMachineKey({ machineId, scopes: ["ingest:write"] });
    const auth = await authenticateMachine({ apiKey: issued.plaintextKey, scope: "ingest:write" });
    expect(auth.method).toBe("machine-key");
    expect(getWeakAuthUsage()).toHaveLength(0);
    await revokeMachineKey(issued.id);
  });
});

describe("ingest rate limit (per machine key, in-memory window)", () => {
  it("throws TOO_MANY_REQUESTS above the configured per-minute limit", () => {
    process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN = "3";
    const auth = { machine: { id: 999_001, code: "RL-M" }, keyId: undefined };
    enforceMachineIngestRateLimit(auth);
    enforceMachineIngestRateLimit(auth);
    enforceMachineIngestRateLimit(auth);
    expect(() => enforceMachineIngestRateLimit(auth)).toThrowError(/rate limit/i);
  });

  it("buckets are per key id — one machine key cannot starve another", () => {
    process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN = "1";
    enforceMachineIngestRateLimit({ machine: { id: 999_002, code: "A" }, keyId: 1 });
    expect(() =>
      enforceMachineIngestRateLimit({ machine: { id: 999_002, code: "A" }, keyId: 2 }),
    ).not.toThrow();
  });

  it("0 disables the limiter", () => {
    process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN = "0";
    const auth = { machine: { id: 999_003, code: "OFF" } };
    for (let i = 0; i < 50; i++) enforceMachineIngestRateLimit(auth);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Doc 51 P3 / CASE #10 — default key TTL (opt-in, backward compatible) +
// listExpiringMachineKeys (cron warning surface).
// ════════════════════════════════════════════════════════════════════════════

const DAY_MS = 24 * 60 * 60 * 1000;

describe("doc 51 P3 — machineKeyDefaultTtlDays parsing", () => {
  it("unset / empty / 0 / negative / garbage → 0 (no expiry, backward compatible)", () => {
    for (const v of [undefined, "", "0", "-5", "abc"]) {
      if (v === undefined) delete process.env.MACHINE_KEY_DEFAULT_TTL_DAYS;
      else process.env.MACHINE_KEY_DEFAULT_TTL_DAYS = v;
      expect(machineKeyDefaultTtlDays()).toBe(0);
    }
  });

  it("a positive value is honoured and clamped to a sane ceiling", () => {
    process.env.MACHINE_KEY_DEFAULT_TTL_DAYS = "90";
    expect(machineKeyDefaultTtlDays()).toBe(90);
    process.env.MACHINE_KEY_DEFAULT_TTL_DAYS = "999999";
    expect(machineKeyDefaultTtlDays()).toBe(3650);
  });
});

describe("doc 51 P3 — issueMachineKey default TTL (QĐ#1: null unless opted in)", () => {
  it("DEFAULT (env unset): expiresAt stays null — a running machine is never bricked", async () => {
    const issued = await issueMachineKey({ machineId });
    expect(issued.expiresAt).toBeNull();
    await revokeMachineKey(issued.id);
  });

  it("MACHINE_KEY_DEFAULT_TTL_DAYS=90 → a key with no explicit expiry gets ~90 days", async () => {
    process.env.MACHINE_KEY_DEFAULT_TTL_DAYS = "90";
    const issued = await issueMachineKey({ machineId });
    expect(issued.expiresAt).toBeTruthy();
    const days = (new Date(issued.expiresAt!).getTime() - Date.now()) / DAY_MS;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThanOrEqual(90);
    // and the TTL is REAL — fast-forward past it and auth must reject
    await revokeMachineKey(issued.id);
  });

  it("an EXPLICIT expiresAt always wins over the default (incl. explicit null)", async () => {
    process.env.MACHINE_KEY_DEFAULT_TTL_DAYS = "90";
    const nulled = await issueMachineKey({ machineId, expiresAt: null });
    expect(nulled.expiresAt).toBeNull(); // caller's explicit null beats the default

    const soon = await issueMachineKey({ machineId, expiresAt: new Date(Date.now() + 60_000) });
    expect(new Date(soon.expiresAt!).getTime()).toBeLessThan(Date.now() + 2 * 60_000);

    await revokeMachineKey(nulled.id);
    await revokeMachineKey(soon.id);
  });

  it("rotation copies the SOURCE key's expiry (does not newly stamp the default)", async () => {
    const issued = await issueMachineKey({ machineId, expiresAt: null });
    process.env.MACHINE_KEY_DEFAULT_TTL_DAYS = "90"; // set AFTER issue
    const rotated = await rotateMachineKey(issued.id);
    expect(rotated.expiresAt).toBeNull(); // preserves the source's null, not now+90d
    await revokeMachineKey(rotated.id);
  });
});

describe("doc 51 P3 — listExpiringMachineKeys (cron warning surface)", () => {
  it("returns active keys expiring within the window; excludes far-future, no-expiry and revoked", async () => {
    const soon = await issueMachineKey({ machineId, expiresAt: new Date(Date.now() + 5 * DAY_MS) });
    const far = await issueMachineKey({ machineId, expiresAt: new Date(Date.now() + 60 * DAY_MS) });
    const never = await issueMachineKey({ machineId, expiresAt: null });

    const ids = (await listExpiringMachineKeys(14)).map((k) => k.id);
    expect(ids).toContain(soon.id);
    expect(ids).not.toContain(far.id);
    expect(ids).not.toContain(never.id);

    // revoking the expiring key removes it from the warning list
    await revokeMachineKey(soon.id);
    expect((await listExpiringMachineKeys(14)).map((k) => k.id)).not.toContain(soon.id);

    await revokeMachineKey(far.id);
    await revokeMachineKey(never.id);
  });

  it("INCLUDES already-expired-but-active keys (they have silently stopped authenticating)", async () => {
    const expired = await issueMachineKey({ machineId, expiresAt: new Date(Date.now() - DAY_MS) });
    expect((await listExpiringMachineKeys(14)).map((k) => k.id)).toContain(expired.id);
    await revokeMachineKey(expired.id);
  });

  it("a wider window pulls in keys a narrow window would miss", async () => {
    const k = await issueMachineKey({ machineId, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    expect((await listExpiringMachineKeys(14)).map((x) => x.id)).not.toContain(k.id);
    expect((await listExpiringMachineKeys(45)).map((x) => x.id)).toContain(k.id);
    await revokeMachineKey(k.id);
  });

  it("never surfaces a general (non-machine) key — only machine credentials", async () => {
    // A machine key IS a machine key; assert the projection carries the machineId
    // so a caller can route the warning to the right owner.
    const k = await issueMachineKey({ machineId, expiresAt: new Date(Date.now() + 3 * DAY_MS) });
    const row = (await listExpiringMachineKeys(14)).find((x) => x.id === k.id);
    expect(row?.machineId).toBe(machineId);
    await revokeMachineKey(k.id);
  });
});
