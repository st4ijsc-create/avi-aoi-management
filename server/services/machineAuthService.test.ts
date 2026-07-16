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
});

beforeEach(() => {
  _resetMachineAuthState();
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  delete process.env.MACHINE_CODE_ONLY_ALLOWED;
  delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN;
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
