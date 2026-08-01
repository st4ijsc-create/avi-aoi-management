/**
 * Doc 56 Đ0-A (RTM-6 + GAP-1) — socket machine-event auth helper tests.
 *
 * Covers: SOCKET_MACHINE_AUTH_MODE parsing (default `off` = today's behaviour),
 * verifyMachineSocketAuth legacy-OR-mk decision (mock machine + mocked
 * machineAuthService — no socket client, no DB), the mismatch registry that
 * backs the GAP-1 "0 mismatch ≥1 tuần" prerequisite of runbook 52 §3.f, and a
 * source-scan invariant that socket.ts actually wires the mode gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const authenticateMachine = vi.hoisted(() => vi.fn());
vi.mock("../services/machineAuthService", () => ({ authenticateMachine }));

// Silence the pino instance (and skip its pretty-transport) in unit tests.
vi.mock("../logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  socketMachineAuthMode,
  verifyMachineSocketAuth,
  recordSocketMachineAuthMismatch,
  getSocketMachineAuthMismatches,
  getSocketMachineAuthMismatchOverflow,
  _resetSocketMachineAuthState,
} from "./socketMachineAuth";

const ORIG_MODE = process.env.SOCKET_MACHINE_AUTH_MODE;

beforeEach(() => {
  vi.clearAllMocks();
  _resetSocketMachineAuthState();
  delete process.env.SOCKET_MACHINE_AUTH_MODE;
});

afterEach(() => {
  if (ORIG_MODE === undefined) delete process.env.SOCKET_MACHINE_AUTH_MODE;
  else process.env.SOCKET_MACHINE_AUTH_MODE = ORIG_MODE;
});

/** A machine still on the legacy shared plaintext key. */
const legacyMachine = { id: 7, code: "AOI-L1-01", apiKey: "mach_legacy_secret" };
/** A rotated machine — runbook 52 §3.f already NULLed machines.apiKey (GAP-1). */
const rotatedMachine = { id: 7, code: "AOI-L1-01", apiKey: null };

describe("socketMachineAuthMode — rollout gate (default off = byte-identical)", () => {
  it("missing env → off", () => {
    expect(socketMachineAuthMode()).toBe("off");
  });

  it("off / log / enforce parsed (trimmed, case-insensitive)", () => {
    process.env.SOCKET_MACHINE_AUTH_MODE = "off";
    expect(socketMachineAuthMode()).toBe("off");
    process.env.SOCKET_MACHINE_AUTH_MODE = " log ";
    expect(socketMachineAuthMode()).toBe("log");
    process.env.SOCKET_MACHINE_AUTH_MODE = "ENFORCE";
    expect(socketMachineAuthMode()).toBe("enforce");
  });

  it("unrecognised value → off (fail-open, never a silent enforce)", () => {
    process.env.SOCKET_MACHINE_AUTH_MODE = "enforced"; // typo
    expect(socketMachineAuthMode()).toBe("off");
  });
});

describe("verifyMachineSocketAuth — legacy path", () => {
  it("machines.apiKey matches → ok/legacy WITHOUT consulting the mk_ service", async () => {
    const res = await verifyMachineSocketAuth(legacyMachine, "mach_legacy_secret");
    expect(res).toEqual({ ok: true, method: "legacy" });
    expect(authenticateMachine).not.toHaveBeenCalled();
  });

  it("NULLed column never matches (GAP-1: no null/empty footgun after §3.f)", async () => {
    expect(await verifyMachineSocketAuth(rotatedMachine, "mach_legacy_secret")).toEqual({
      ok: false,
      method: "none",
    });
    expect(authenticateMachine).not.toHaveBeenCalled();
  });

  it("wrong non-mk_ key → none WITHOUT consulting the service", async () => {
    expect(await verifyMachineSocketAuth(legacyMachine, "wrong")).toEqual({ ok: false, method: "none" });
    expect(authenticateMachine).not.toHaveBeenCalled();
  });

  it("missing machine / empty key → none, no service call", async () => {
    expect(await verifyMachineSocketAuth(undefined, "mk_x")).toEqual({ ok: false, method: "none" });
    expect(await verifyMachineSocketAuth(null, "mk_x")).toEqual({ ok: false, method: "none" });
    expect(await verifyMachineSocketAuth(legacyMachine, "")).toEqual({ ok: false, method: "none" });
    expect(await verifyMachineSocketAuth(legacyMachine, undefined)).toEqual({ ok: false, method: "none" });
    expect(await verifyMachineSocketAuth(legacyMachine, null)).toEqual({ ok: false, method: "none" });
    expect(authenticateMachine).not.toHaveBeenCalled();
  });
});

describe("verifyMachineSocketAuth — mk_ path (GAP-1: mk_-only machines keep presence)", () => {
  it("valid mk_ key for THIS machine → ok/mk (even when machines.apiKey is NULL)", async () => {
    authenticateMachine.mockResolvedValue({
      machine: { id: 7, code: "AOI-L1-01" },
      method: "machine-key",
      keyId: 42,
    });
    const res = await verifyMachineSocketAuth(rotatedMachine, "mk_valid", "socket:machine:sync_started");
    expect(res).toEqual({ ok: true, method: "mk" });
    expect(authenticateMachine).toHaveBeenCalledWith({
      apiKey: "mk_valid",
      endpoint: "socket:machine:sync_started",
    });
  });

  it("mk_ key belonging to ANOTHER machine → refused", async () => {
    authenticateMachine.mockResolvedValue({ machine: { id: 99, code: "OTHER" }, method: "machine-key" });
    expect(await verifyMachineSocketAuth(rotatedMachine, "mk_other")).toEqual({ ok: false, method: "none" });
  });

  it("service rejects (revoked/expired/unknown/DB down) → refused, never thrown", async () => {
    authenticateMachine.mockRejectedValue(new Error("UNAUTHORIZED"));
    await expect(verifyMachineSocketAuth(rotatedMachine, "mk_revoked")).resolves.toEqual({
      ok: false,
      method: "none",
    });
  });

  it("shared-key fallthrough resolution does NOT count as mk", async () => {
    // machines.apiKey of some machine coincidentally storing an mk_-looking value
    // resolves via the WEAK shared path — that is not a per-machine credential.
    authenticateMachine.mockResolvedValue({ machine: { id: 7, code: "AOI-L1-01" }, method: "shared-key" });
    expect(await verifyMachineSocketAuth(rotatedMachine, "mk_lookalike")).toEqual({ ok: false, method: "none" });
  });

  it("legacy match wins first: mk_ service untouched when plaintext matches", async () => {
    const machine = { id: 7, code: "AOI-L1-01", apiKey: "mk_stored_as_plaintext" };
    const res = await verifyMachineSocketAuth(machine, "mk_stored_as_plaintext");
    expect(res).toEqual({ ok: true, method: "legacy" });
    expect(authenticateMachine).not.toHaveBeenCalled();
  });
});

describe("mismatch registry — GAP-1 observation evidence", () => {
  it("aggregates per machine+event, keeps first/last seen and latest mode", () => {
    recordSocketMachineAuthMismatch({
      event: "machine:sync_started", mode: "log", machineId: 7, machineCode: "AOI-L1-01", method: "none",
    });
    recordSocketMachineAuthMismatch({
      event: "machine:sync_started", mode: "log", machineId: 7, machineCode: "AOI-L1-01", method: "none",
    });
    recordSocketMachineAuthMismatch({
      event: "machine:confirm_mapping", mode: "enforce", machineId: 8, machineCode: null, method: "none",
    });
    const rows = getSocketMachineAuthMismatches();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.event === "machine:sync_started")).toMatchObject({
      machineId: 7, machineCode: "AOI-L1-01", count: 2, mode: "log",
    });
    expect(rows.find((r) => r.event === "machine:confirm_mapping")).toMatchObject({
      machineId: 8, machineCode: "?", count: 1, mode: "enforce",
    });
    expect(getSocketMachineAuthMismatchOverflow()).toBe(0);
  });

  it("_reset clears the registry (test isolation)", () => {
    recordSocketMachineAuthMismatch({
      event: "machine:sync_started", mode: "log", machineId: 1, machineCode: "M1", method: "none",
    });
    expect(getSocketMachineAuthMismatches()).toHaveLength(1);
    _resetSocketMachineAuthState();
    expect(getSocketMachineAuthMismatches()).toHaveLength(0);
  });
});

describe("SAFETY — socket.ts wiring (source scan)", () => {
  const src = readFileSync(join(__dirname, "socket.ts"), "utf8");

  it("off mode keeps the legacy plaintext comparison on sync_started", () => {
    expect(src).toMatch(/machine\.apiKey !== data\.apiKey/);
  });

  it("both machine events consult the mode gate + verifier", () => {
    expect((src.match(/socketMachineAuthMode\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((src.match(/verifyMachineSocketAuth\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/recordSocketMachineAuthMismatch/);
  });
});
