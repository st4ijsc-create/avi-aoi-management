/**
 * Doc 27 Đợt 2 / W2-C — per-machine credential tests (gap C7).
 *
 * INTEGRATION tests against the isolated test DB (vitest.setup.ts forces
 * DATABASE_URL → <db>_test; migration 0178 adds api_keys.machineId/revokedAt):
 *   accept / wrong-scope / revoked / rotated / expired / legacy-shared-key
 *   (+ flag-off) / rate-limit.
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
  _resetMachineAuthState,
} from "./machineAuthService";

const STAMP = Date.now();
const SHARED_KEY = `W2C-SHARED-${STAMP}`;
let machineId: number;

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1, // soft-ref (no FK on master data yet — gap M1, Đợt 3)
    code: `W2C-AUTH-${STAMP}`,
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
  delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN;
});

beforeEach(() => {
  _resetMachineAuthState();
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
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
