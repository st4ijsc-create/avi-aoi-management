/**
 * Doc 81 Đợt 7 task K1 — NEW machine API keys no longer get `edge:sync` by default.
 *
 * Owner decision 2026-10-11: a freshly minted machine key (issueMachineKey with no
 * explicit scopes — the socket-approve path, the admin "issue key" button with no
 * scope list, and the legacy provision script) gets the ingest set only. `edge:sync`
 * gates the WS-2 edge model-deployment procedures (checkModelVersion, getModelPackage,
 * confirmDeployment, edgeHeartbeat, syncEdgeResults) and REST POST /api/v1/edge/sync,
 * so it must be asked for EXPLICITLY.
 *
 * Existing keys are unchanged by code: an explicit scope list is honoured verbatim, and
 * rotation copies the source key's scopes (so a rotated edge key keeps `edge:sync`).
 *
 * Integration tests on the isolated `_test` DB (vitest.setup.ts forces DATABASE_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import * as db from "../db";
import { apiKeys } from "../../drizzle/schema";
import {
  authenticateMachine,
  issueMachineKey,
  rotateMachineKey,
  revokeMachineKey,
  MACHINE_KEY_DEFAULT_SCOPES,
  MACHINE_KEY_FLEET_SCOPES,
  _resetMachineAuthState,
} from "./machineAuthService";

const STAMP = Date.now();
const MACHINE_CODE = `DOT7-K1-${STAMP}`;
let machineId: number;

beforeAll(async () => {
  _resetMachineAuthState();
  machineId = await db.createMachine({
    stationId: 1,
    code: MACHINE_CODE,
    name: "Dot 7 K1 default-scope test machine",
    machineType: "AVI",
    isActive: true,
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (d && machineId) await d.delete(apiKeys).where(eq(apiKeys.machineId, machineId));
  if (machineId) await db.deleteMachine(machineId);
});

describe("K1 — default machine-key scopes exclude edge:sync", () => {
  it("MACHINE_KEY_DEFAULT_SCOPES is the ingest set without edge:sync", () => {
    expect(MACHINE_KEY_DEFAULT_SCOPES).not.toContain("edge:sync");
    expect(MACHINE_KEY_DEFAULT_SCOPES).toEqual(["ingest:write", "equipment:read"]);
    // the fleet issuer already had the minimal set — keep them in step
    expect(MACHINE_KEY_FLEET_SCOPES).not.toContain("edge:sync");
  });

  it("a key issued with no scope list cannot authenticate for edge:sync (FORBIDDEN)", async () => {
    const issued = await issueMachineKey({ machineId, name: "k1-default" });
    expect(issued.scopes).not.toContain("edge:sync");
    const d = await db.getDb();
    const [row] = await d!.select().from(apiKeys).where(eq(apiKeys.id, issued.id)).limit(1);
    expect(row.scopes).toEqual(["ingest:write", "equipment:read"]);

    await expect(
      authenticateMachine({ apiKey: issued.plaintextKey, scope: "edge:sync" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // the ingest scopes still work
    const ok = await authenticateMachine({ apiKey: issued.plaintextKey, scope: "ingest:write" });
    expect(ok.keyId).toBe(issued.id);
    await revokeMachineKey(issued.id);
  });

  it("an empty scope list also falls back to the default WITHOUT edge:sync", async () => {
    const issued = await issueMachineKey({ machineId, name: "k1-empty", scopes: [] });
    expect(issued.scopes).toEqual(["ingest:write", "equipment:read"]);
    await revokeMachineKey(issued.id);
  });

  it("edge:sync asked for EXPLICITLY is still granted", async () => {
    const issued = await issueMachineKey({
      machineId,
      name: "k1-edge",
      scopes: ["ingest:write", "equipment:read", "edge:sync"],
    });
    const ok = await authenticateMachine({ apiKey: issued.plaintextKey, scope: "edge:sync" });
    expect(ok.keyId).toBe(issued.id);
    await revokeMachineKey(issued.id);
  });

  it("existing keys unchanged: rotating a key that HAS edge:sync keeps edge:sync", async () => {
    const issued = await issueMachineKey({
      machineId,
      name: "k1-rotate",
      scopes: ["ingest:write", "equipment:read", "edge:sync"],
    });
    const rotated = await rotateMachineKey(issued.id);
    expect(rotated.scopes).toEqual(["ingest:write", "equipment:read", "edge:sync"]);
    const ok = await authenticateMachine({ apiKey: rotated.plaintextKey, scope: "edge:sync" });
    expect(ok.keyId).toBe(rotated.id);
    await revokeMachineKey(rotated.id);
  });
});

describe("K1 — the legacy provision script mints keys without edge:sync too", () => {
  it("scripts/provision-machine-api-keys.mjs DEFAULT_SCOPES has no edge:sync", () => {
    const src = readFileSync(resolve(process.cwd(), "scripts/provision-machine-api-keys.mjs"), "utf8");
    const m = /const\s+DEFAULT_SCOPES\s*=\s*\[([^\]]*)\]/.exec(src);
    expect(m, "DEFAULT_SCOPES literal not found — the instrument lost its target").not.toBeNull();
    const scopes = m![1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    expect(scopes).toEqual(["ingest:write", "equipment:read"]);
  });
});
