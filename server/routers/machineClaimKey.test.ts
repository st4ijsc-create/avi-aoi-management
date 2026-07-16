/**
 * Doc 51 P0 / R1 (router layer) — machine credential delivery.
 *
 * Covers the verified leak and its fix:
 *  - machine.config NEVER returns machines.apiKey, not even for an APPROVED
 *    machine (it was a publicProcedure keyed only by the serial number printed
 *    on the machine's label)
 *  - the MACHINE_CONFIG_EXPOSE_APIKEY escape hatch (QĐ#1 — controlled migration)
 *    is OFF by default and loud when on
 *  - machine.claimKey: right token → key ONCE; replay/expired/wrong → rejected,
 *    every attempt audited
 *  - machine.approve / machine.issueClaimToken mint the one-time token and never
 *    log the plaintext
 *
 * The db layer is mocked here; the token state machine itself (single-use,
 * expiry, revocation) is proven against a fake DB in db/machineClaimToken.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));

const logs = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock("../logger", () => ({ logger: logs, default: logs }));

const dbm = vi.hoisted(() => ({
  createAuditLog: vi.fn(async (): Promise<any> => ({ id: 1 })),
  getDb: vi.fn(async (): Promise<any> => ({ fake: true })),
  getMachineById: vi.fn(async (): Promise<any> => undefined),
  getMachineByCode: vi.fn(async (): Promise<any> => undefined),
  getMachineBySerialNumber: vi.fn(async (): Promise<any> => undefined),
  getStationById: vi.fn(async (): Promise<any> => ({ id: 41, code: "S1", name: "Station 1" })),
  getLineByStationId: vi.fn(async (): Promise<any> => ({ id: 11, code: "L1", name: "Line 1" })),
  approveMachine: vi.fn(async (): Promise<any> => {}),
  issueMachineClaimToken: vi.fn(async (): Promise<any> => ({
    token: "mct_" + "a".repeat(64), tokenPrefix: "mct_aaaaaa", expiresAt: new Date("2026-07-16T10:15:00Z"),
  })),
  redeemMachineClaimToken: vi.fn(async (): Promise<any> => ({ machineId: 51, machineCode: "AOI-01", apiKey: "mach_SECRET" })),
}));
vi.mock("../db", () => dbm);

import { machineRouter, _resetClaimThrottle } from "./hierarchyRouters";

const adminCtx = { user: { id: 7, name: "Admin", role: "admin" }, req: { headers: {} } } as any;
const pubCtx = { user: null, req: { headers: {}, ip: "10.2.2.2" } } as any;

const APPROVED = {
  id: 51, code: "AOI-01", name: "AOI 1", stationId: 41, serialNumber: "SN-777",
  registrationStatus: "approved", apiKey: "mach_SECRET", isActive: true,
  lifecycleStatus: "active", machineType: "AOI", syncMode: "online",
};

/** The WS0.5 middleware also logs a generic `trpc_mutation` row — filter it out. */
function entityAudits(): any[] {
  return dbm.createAuditLog.mock.calls
    .map((c) => c[0] as any)
    .filter((e) => e.entityType !== "trpc_mutation");
}

/** A token that clears the zod min-length floor (the real ones are `mct_<64 hex>`). */
const TOKEN = "mct_" + "a".repeat(64);

beforeEach(() => {
  // clearAllMocks resets CALLS but keeps implementations — a mockRejectedValue
  // from one test would otherwise leak into the next. Restore the happy path.
  vi.clearAllMocks();
  _resetClaimThrottle();
  delete process.env.MACHINE_CONFIG_EXPOSE_APIKEY;
  delete process.env.MACHINE_CLAIM_RATE_LIMIT_PER_HOUR;
  dbm.getMachineBySerialNumber.mockResolvedValue({ ...APPROVED });
  dbm.getMachineById.mockResolvedValue({ ...APPROVED });
  dbm.issueMachineClaimToken.mockResolvedValue({
    token: TOKEN, tokenPrefix: "mct_aaaaaa", expiresAt: new Date("2026-07-16T10:15:00Z"),
  });
  dbm.redeemMachineClaimToken.mockResolvedValue({ machineId: 51, machineCode: "AOI-01", apiKey: "mach_SECRET" });
});

afterEach(() => {
  delete process.env.MACHINE_CONFIG_EXPOSE_APIKEY;
  delete process.env.MACHINE_CLAIM_RATE_LIMIT_PER_HOUR;
});

// ── R1: the leak itself ─────────────────────────────────────────────────────
describe("R1 — machine.config no longer leaks the apiKey", () => {
  it("APPROVED machine: apiKey is NULL for an unauthenticated caller with just the serial", async () => {
    const r = await machineRouter.createCaller(pubCtx).config({ serialNumber: "SN-777" });
    expect(r.apiKey).toBeNull();
    expect(r.requiresClaim).toBe(true);
  });

  it("the plaintext key appears NOWHERE in the response payload", async () => {
    const r = await machineRouter.createCaller(pubCtx).config({ serialNumber: "SN-777" });
    expect(JSON.stringify(r)).not.toContain("mach_SECRET");
  });

  it("still returns the harmless mapping/status fields clients poll for", async () => {
    const r = await machineRouter.createCaller(pubCtx).config({ serialNumber: "SN-777" });
    expect(r).toMatchObject({
      machineId: 51,
      code: "AOI-01",
      registrationStatus: "approved",
      isApproved: true,
      stationId: 41,
    });
    expect(r.mapping.station).toEqual({ id: 41, code: "S1", name: "Station 1" });
    expect(r.mapping.line).toEqual({ id: 11, code: "L1", name: "Line 1" });
  });

  it("pending machine: apiKey null (unchanged)", async () => {
    dbm.getMachineBySerialNumber.mockResolvedValue({ ...APPROVED, registrationStatus: "pending", apiKey: null });
    const r = await machineRouter.createCaller(pubCtx).config({ serialNumber: "SN-777" });
    expect(r.apiKey).toBeNull();
  });

  it("unknown serial → NOT_FOUND (unchanged)", async () => {
    dbm.getMachineBySerialNumber.mockResolvedValue(undefined);
    await expect(machineRouter.createCaller(pubCtx).config({ serialNumber: "nope" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ── QĐ#1: controlled migration, not a hard flip ─────────────────────────────
describe("QĐ#1 — MACHINE_CONFIG_EXPOSE_APIKEY escape hatch", () => {
  it("is OFF by default (safe default — an unset env must not leak)", async () => {
    const r = await machineRouter.createCaller(pubCtx).config({ serialNumber: "SN-777" });
    expect(r.apiKey).toBeNull();
  });

  it.each(["false", "0", "TRUE", "yes", ""])("stays OFF for MACHINE_CONFIG_EXPOSE_APIKEY=%j", async (v) => {
    process.env.MACHINE_CONFIG_EXPOSE_APIKEY = v;
    const r = await machineRouter.createCaller(pubCtx).config({ serialNumber: "SN-777" });
    expect(r.apiKey).toBeNull();
  });

  it("exactly 'true' restores the legacy behaviour AND logs a warning naming the machine", async () => {
    process.env.MACHINE_CONFIG_EXPOSE_APIKEY = "true";
    const r = await machineRouter.createCaller(pubCtx).config({ serialNumber: "SN-777" });
    expect(r.apiKey).toBe("mach_SECRET");
    expect(r.requiresClaim).toBe(false);
    expect(logs.warn).toHaveBeenCalledTimes(1);
    expect(logs.warn.mock.calls[0][0]).toMatchObject({ machineCode: "AOI-01", serialNumber: "SN-777" });
  });

  it("the legacy warning is throttled per machine (a 10s poll must not flood the log)", async () => {
    process.env.MACHINE_CONFIG_EXPOSE_APIKEY = "true";
    const caller = machineRouter.createCaller(pubCtx);
    await caller.config({ serialNumber: "SN-777" });
    await caller.config({ serialNumber: "SN-777" });
    await caller.config({ serialNumber: "SN-777" });
    expect(logs.warn).toHaveBeenCalledTimes(1);
  });

  it("legacy flag does NOT expose a key for an unapproved machine", async () => {
    process.env.MACHINE_CONFIG_EXPOSE_APIKEY = "true";
    dbm.getMachineBySerialNumber.mockResolvedValue({ ...APPROVED, registrationStatus: "pending" });
    const r = await machineRouter.createCaller(pubCtx).config({ serialNumber: "SN-777" });
    expect(r.apiKey).toBeNull();
  });
});

// ── R1: claimKey ────────────────────────────────────────────────────────────
describe("R1 — machine.claimKey", () => {
  it("valid token → returns the apiKey and passes the caller IP through for the burn", async () => {
    const r = await machineRouter.createCaller(pubCtx).claimKey({ serialNumber: "SN-777", claimToken: TOKEN });
    expect(r.apiKey).toBe("mach_SECRET");
    expect(r.machineId).toBe(51);
    expect(dbm.redeemMachineClaimToken).toHaveBeenCalledWith({
      serialNumber: "SN-777", claimToken: TOKEN, fromIp: "10.2.2.2",
    });
  });

  it("a successful claim is audited (and the audit carries NO plaintext token/key)", async () => {
    await machineRouter.createCaller(pubCtx).claimKey({ serialNumber: "SN-777", claimToken: TOKEN });
    const audits = entityAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "machine.claimKey", entityType: "machine", entityId: 51 });
    expect(audits[0].details.metadata).toMatchObject({ outcome: "success", ip: "10.2.2.2" });
    const serialized = JSON.stringify(audits[0]);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("mach_SECRET");
  });

  it.each([
    ["used", "Claim token has already been used"],
    ["expired", "Claim token has expired"],
    ["invalid", "Invalid or expired claim token"],
  ])("%s token → UNAUTHORIZED and an audited FAILURE", async (reason, message) => {
    const err = Object.assign(new Error(message), { name: "ClaimTokenError", reason });
    dbm.redeemMachineClaimToken.mockRejectedValue(err);

    await expect(machineRouter.createCaller(pubCtx).claimKey({ serialNumber: "SN-777", claimToken: TOKEN }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED", message });

    const audits = entityAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0].details.metadata).toMatchObject({ outcome: "failed", reason, serialNumber: "SN-777" });
  });

  it("machine with no credential yet → PRECONDITION_FAILED (not UNAUTHORIZED)", async () => {
    const err = Object.assign(new Error("Machine has no active credential to claim"), {
      name: "ClaimTokenError", reason: "no_key",
    });
    dbm.redeemMachineClaimToken.mockRejectedValue(err);
    await expect(machineRouter.createCaller(pubCtx).claimKey({ serialNumber: "SN-777", claimToken: TOKEN }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("an unexpected db error is NOT swallowed into a 401", async () => {
    dbm.redeemMachineClaimToken.mockRejectedValue(new Error("connection reset"));
    await expect(machineRouter.createCaller(pubCtx).claimKey({ serialNumber: "SN-777", claimToken: TOKEN }))
      .rejects.toThrow("connection reset");
  });

  it("brute force is throttled per IP", async () => {
    process.env.MACHINE_CLAIM_RATE_LIMIT_PER_HOUR = "3";
    const err = Object.assign(new Error("Invalid or expired claim token"), { name: "ClaimTokenError", reason: "invalid" });
    dbm.redeemMachineClaimToken.mockRejectedValue(err);
    const caller = machineRouter.createCaller(pubCtx);

    for (let i = 0; i < 3; i++) {
      await expect(caller.claimKey({ serialNumber: "SN-777", claimToken: `${TOKEN}${i}` }))
        .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    await expect(caller.claimKey({ serialNumber: "SN-777", claimToken: TOKEN + "4" }))
      .rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    // the throttled attempt never reached the db
    expect(dbm.redeemMachineClaimToken).toHaveBeenCalledTimes(3);
  });

  it("rejects an obviously-too-short token at the zod boundary", async () => {
    await expect(machineRouter.createCaller(pubCtx).claimKey({ serialNumber: "SN-777", claimToken: "x" }))
      .rejects.toThrow();
    expect(dbm.redeemMachineClaimToken).not.toHaveBeenCalled();
  });
});

// ── R1: token issuance ──────────────────────────────────────────────────────
describe("R1 — claim token issuance", () => {
  it("approve mints a one-time token and returns it to the admin ONCE", async () => {
    dbm.getMachineById.mockResolvedValue({ ...APPROVED, registrationStatus: "pending" });
    const r = await machineRouter.createCaller(adminCtx).approve({ id: 51 });
    expect(r.success).toBe(true);
    expect(r.claimToken).toBe(TOKEN);
    expect(dbm.issueMachineClaimToken).toHaveBeenCalledWith({ machineId: 51, issuedBy: 7 });
  });

  it("approve's audit row records only the token PREFIX + expiry — never the plaintext", async () => {
    dbm.getMachineById.mockResolvedValue({ ...APPROVED, registrationStatus: "pending" });
    await machineRouter.createCaller(adminCtx).approve({ id: 51 });
    const audit = entityAudits().find((a) => a.action === "machine.approve");
    expect(audit.details.metadata).toMatchObject({ claimPrefix: "mct_aaaaaa" });
    expect(JSON.stringify(audit)).not.toContain("a".repeat(64));
  });

  it("approve still succeeds if the token cannot be minted (approval is already committed)", async () => {
    dbm.getMachineById.mockResolvedValue({ ...APPROVED, registrationStatus: "pending" });
    dbm.issueMachineClaimToken.mockRejectedValue(new Error("table missing"));
    const r = await machineRouter.createCaller(adminCtx).approve({ id: 51 });
    expect(r.success).toBe(true);
    expect(r.claimToken).toBeNull();
    expect(logs.warn).toHaveBeenCalled();
  });

  it("issueClaimToken re-mints for an approved machine", async () => {
    const r = await machineRouter.createCaller(adminCtx).issueClaimToken({ id: 51 });
    expect(r.claimToken).toBe(TOKEN);
    expect(r.prefix).toBe("mct_aaaaaa");
    expect(entityAudits()[0]).toMatchObject({ action: "machine.issueClaimToken", entityId: 51 });
  });

  it("issueClaimToken refuses an unapproved machine", async () => {
    dbm.getMachineById.mockResolvedValue({ ...APPROVED, registrationStatus: "pending" });
    await expect(machineRouter.createCaller(adminCtx).issueClaimToken({ id: 51 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dbm.issueMachineClaimToken).not.toHaveBeenCalled();
  });

  it.each(["retired", "decommissioned"] as const)("issueClaimToken refuses a %s machine (R2 — no re-arming a dead asset)", async (state) => {
    dbm.getMachineById.mockResolvedValue({ ...APPROVED, lifecycleStatus: state });
    await expect(machineRouter.createCaller(adminCtx).issueClaimToken({ id: 51 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining(state) });
    expect(dbm.issueMachineClaimToken).not.toHaveBeenCalled();
  });

  it("issueClaimToken → NOT_FOUND for an unknown machine", async () => {
    dbm.getMachineById.mockResolvedValue(undefined);
    await expect(machineRouter.createCaller(adminCtx).issueClaimToken({ id: 404 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
