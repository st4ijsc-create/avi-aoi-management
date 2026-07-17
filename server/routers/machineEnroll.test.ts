/**
 * Doc 51 P3 / §5.1 (router layer) — ZERO-TOUCH ENROLLMENT.
 *
 * Covers:
 *  - machine.enroll is gated behind ENROLLMENT_ENABLED (default OFF → refused
 *    without ever touching the DB), per-IP throttled, and audited on BOTH
 *    outcomes; a success mints the scoped mk_ key via the SHARED issuer and never
 *    logs the plaintext key/token
 *  - EnrollmentTokenError reasons map to the right HTTP-ish codes
 *  - machine.issueEnrollmentToken (admin): validates scopes, returns the token
 *    ONCE, audits the PREFIX only; admin-only
 *  - list / revoke enrollment tokens (admin)
 *
 * The db layer + machineAuthService are mocked; the token state machine itself is
 * proven against a fake DB in db/machineEnrollment.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));

const logs = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock("../logger", () => ({ logger: logs, default: logs }));

const auth = vi.hoisted(() => ({
  issueMachineKey: vi.fn(async (): Promise<any> => ({
    id: 301, keyPrefix: "mk_abcdef", plaintextKey: "mk_" + "0".repeat(48),
    machineId: 51, scopes: ["ingest:write", "equipment:read"],
  })),
  isValidScopeGrant: (s: string) =>
    ["ingest:write", "equipment:read", "edge:sync", "*"].includes(s) || s.endsWith(":*"),
}));
vi.mock("../services/machineAuthService", () => auth);

const dbm = vi.hoisted(() => ({
  createAuditLog: vi.fn(async (): Promise<any> => ({ id: 1 })),
  getDb: vi.fn(async (): Promise<any> => ({ fake: true })),
  redeemMachineEnrollmentToken: vi.fn(async (): Promise<any> => ({
    machineId: 51, machineCode: "SN-777", scopes: ["ingest:write", "equipment:read"], created: false,
  })),
  issueMachineEnrollmentToken: vi.fn(async (): Promise<any> => ({
    token: "met_" + "a".repeat(64), tokenPrefix: "met_aaaaaa",
    expiresAt: new Date("2026-07-17T10:00:00Z"), serialPattern: null,
    scopes: ["ingest:write", "equipment:read"], maxUses: 1,
  })),
  listMachineEnrollmentTokens: vi.fn(async (): Promise<any> => ([
    { id: 1, tokenPrefix: "met_aaaaaa", serialPattern: null, scopes: ["ingest:write"], maxUses: 1, useCount: 0, revokedAt: null },
  ])),
  revokeMachineEnrollmentToken: vi.fn(async (): Promise<any> => ({ id: 1, tokenPrefix: "met_aaaaaa" })),
}));
vi.mock("../db", () => dbm);

import { machineRouter, _resetEnrollThrottle } from "./hierarchyRouters";

const adminCtx = { user: { id: 7, name: "Admin", role: "admin" }, req: { headers: {} } } as any;
const pubCtx = { user: null, req: { headers: {}, ip: "10.2.2.2" } } as any;
/** Authenticated but NOT admin — the admin gate must return FORBIDDEN (not the
 *  UNAUTHORIZED an unauthenticated caller gets from protectedProcedure first). */
const viewerCtx = { user: { id: 2, name: "Viewer", role: "viewer" }, req: { headers: {} } } as any;

const TOKEN = "met_" + "a".repeat(64);

function entityAudits(): any[] {
  return dbm.createAuditLog.mock.calls.map((c) => c[0] as any).filter((e) => e.entityType !== "trpc_mutation");
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetEnrollThrottle();
  delete process.env.ENROLLMENT_ENABLED;
  delete process.env.MACHINE_ENROLL_RATE_LIMIT_PER_HOUR;
  auth.issueMachineKey.mockResolvedValue({
    id: 301, keyPrefix: "mk_abcdef", plaintextKey: "mk_" + "0".repeat(48),
    machineId: 51, scopes: ["ingest:write", "equipment:read"],
  });
  dbm.redeemMachineEnrollmentToken.mockResolvedValue({
    machineId: 51, machineCode: "SN-777", scopes: ["ingest:write", "equipment:read"], created: false,
  });
});

afterEach(() => {
  delete process.env.ENROLLMENT_ENABLED;
  delete process.env.MACHINE_ENROLL_RATE_LIMIT_PER_HOUR;
});

// ── flag gate ─────────────────────────────────────────────────────────────────
describe("ENROLLMENT_ENABLED gate (QĐ#1 — off by default)", () => {
  it("OFF by default → PRECONDITION_FAILED and the DB is never touched", async () => {
    await expect(machineRouter.createCaller(pubCtx).enroll({ serialNumber: "SN-777", enrollmentToken: TOKEN }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dbm.redeemMachineEnrollmentToken).not.toHaveBeenCalled();
    expect(auth.issueMachineKey).not.toHaveBeenCalled();
  });

  it.each(["false", "0", "TRUE", "yes", ""])("stays OFF for ENROLLMENT_ENABLED=%j", async (v) => {
    process.env.ENROLLMENT_ENABLED = v;
    await expect(machineRouter.createCaller(pubCtx).enroll({ serialNumber: "SN-777", enrollmentToken: TOKEN }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

// ── enroll happy path ─────────────────────────────────────────────────────────
describe("machine.enroll — success (flag ON)", () => {
  beforeEach(() => { process.env.ENROLLMENT_ENABLED = "true"; });

  it("valid token → mints a scoped mk_ key ONCE and returns it", async () => {
    const r = await machineRouter.createCaller(pubCtx).enroll({ serialNumber: "SN-777", enrollmentToken: TOKEN });
    expect(r.apiKey).toBe("mk_" + "0".repeat(48));
    expect(r.machineId).toBe(51);
    expect(r.code).toBe("SN-777");
    expect(r.created).toBe(false);
    // the key was issued via the shared issuer, with the token's scopes
    expect(auth.issueMachineKey).toHaveBeenCalledWith({
      machineId: 51, name: "enroll:SN-777", scopes: ["ingest:write", "equipment:read"],
    });
    expect(dbm.redeemMachineEnrollmentToken).toHaveBeenCalledWith({
      serialNumber: "SN-777", enrollmentToken: TOKEN, machineInfo: undefined, fromIp: "10.2.2.2",
    });
  });

  it("passes machineInfo through for a one-call create", async () => {
    dbm.redeemMachineEnrollmentToken.mockResolvedValue({ machineId: 88, machineCode: "SN-NEW", scopes: ["ingest:write"], created: true });
    const r = await machineRouter.createCaller(pubCtx).enroll({
      serialNumber: "NEW", enrollmentToken: TOKEN, machineInfo: { machineType: "AOI", name: "New" },
    });
    expect(r.created).toBe(true);
    expect(dbm.redeemMachineEnrollmentToken).toHaveBeenCalledWith(expect.objectContaining({
      machineInfo: { machineType: "AOI", name: "New" },
    }));
  });

  it("audits the success WITHOUT the plaintext token or key", async () => {
    await machineRouter.createCaller(pubCtx).enroll({ serialNumber: "SN-777", enrollmentToken: TOKEN });
    const audits = entityAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "machine.enroll", entityType: "machine", entityId: 51 });
    expect(audits[0].details.metadata).toMatchObject({ outcome: "success", created: false, keyPrefix: "mk_abcdef" });
    const serialized = JSON.stringify(audits[0]);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("mk_" + "0".repeat(48));
  });
});

// ── enroll failures ─────────────────────────────────────────────────────────
describe("machine.enroll — EnrollmentTokenError mapping (flag ON)", () => {
  beforeEach(() => { process.env.ENROLLMENT_ENABLED = "true"; });

  it.each([
    ["invalid", "UNAUTHORIZED"],
    ["expired", "UNAUTHORIZED"],
    ["exhausted", "UNAUTHORIZED"],
    ["machine_locked", "PRECONDITION_FAILED"],
    ["no_station", "PRECONDITION_FAILED"],
    ["needs_info", "BAD_REQUEST"],
  ])("reason '%s' → %s and an audited FAILURE", async (reason, code) => {
    const err = Object.assign(new Error(`enroll failed: ${reason}`), { name: "EnrollmentTokenError", reason });
    dbm.redeemMachineEnrollmentToken.mockRejectedValue(err);

    await expect(machineRouter.createCaller(pubCtx).enroll({ serialNumber: "SN-777", enrollmentToken: TOKEN }))
      .rejects.toMatchObject({ code });

    expect(auth.issueMachineKey).not.toHaveBeenCalled();
    const audits = entityAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0].details.metadata).toMatchObject({ outcome: "failed", reason, serialNumber: "SN-777" });
  });

  it("an unexpected db error is NOT swallowed into a 4xx", async () => {
    dbm.redeemMachineEnrollmentToken.mockRejectedValue(new Error("connection reset"));
    await expect(machineRouter.createCaller(pubCtx).enroll({ serialNumber: "SN-777", enrollmentToken: TOKEN }))
      .rejects.toThrow("connection reset");
  });

  it("rejects an obviously-too-short token at the zod boundary (no db hit)", async () => {
    await expect(machineRouter.createCaller(pubCtx).enroll({ serialNumber: "SN-777", enrollmentToken: "x" }))
      .rejects.toThrow();
    expect(dbm.redeemMachineEnrollmentToken).not.toHaveBeenCalled();
  });

  it("brute force is throttled per IP", async () => {
    process.env.MACHINE_ENROLL_RATE_LIMIT_PER_HOUR = "3";
    const err = Object.assign(new Error("invalid"), { name: "EnrollmentTokenError", reason: "invalid" });
    dbm.redeemMachineEnrollmentToken.mockRejectedValue(err);
    const caller = machineRouter.createCaller(pubCtx);

    for (let i = 0; i < 3; i++) {
      await expect(caller.enroll({ serialNumber: "SN-777", enrollmentToken: `${TOKEN}${i}` }))
        .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    await expect(caller.enroll({ serialNumber: "SN-777", enrollmentToken: TOKEN + "z" }))
      .rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(dbm.redeemMachineEnrollmentToken).toHaveBeenCalledTimes(3);
  });
});

// ── admin: issue / list / revoke ───────────────────────────────────────────
describe("machine.issueEnrollmentToken (admin)", () => {
  it("mints a token and returns it ONCE; audit records only the PREFIX", async () => {
    const r = await machineRouter.createCaller(adminCtx).issueEnrollmentToken({});
    expect(r.enrollmentToken).toBe(TOKEN);
    expect(r.prefix).toBe("met_aaaaaa");
    expect(dbm.issueMachineEnrollmentToken).toHaveBeenCalledWith(expect.objectContaining({ issuedBy: 7 }));
    const audit = entityAudits().find((a) => a.action === "machine.issueEnrollmentToken");
    expect(audit.details.metadata).toMatchObject({ prefix: "met_aaaaaa" });
    expect(JSON.stringify(audit)).not.toContain("a".repeat(64));
  });

  it("reflects that the feature is still OFF so the admin is not surprised", async () => {
    const r = await machineRouter.createCaller(adminCtx).issueEnrollmentToken({});
    expect(r.enrollmentEnabled).toBe(false);
    process.env.ENROLLMENT_ENABLED = "true";
    const r2 = await machineRouter.createCaller(adminCtx).issueEnrollmentToken({});
    expect(r2.enrollmentEnabled).toBe(true);
    delete process.env.ENROLLMENT_ENABLED;
  });

  it("passes an allowlist (serialPattern + maxUses) through to the db", async () => {
    await machineRouter.createCaller(adminCtx).issueEnrollmentToken({ serialPattern: "AOI-2026-*", maxUses: 50 });
    expect(dbm.issueMachineEnrollmentToken).toHaveBeenCalledWith(expect.objectContaining({
      serialPattern: "AOI-2026-*", maxUses: 50,
    }));
  });

  it("rejects a scope outside the published vocabulary BEFORE minting", async () => {
    await expect(machineRouter.createCaller(adminCtx).issueEnrollmentToken({ scopes: ["ingest:write", "bogus:scope"] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(dbm.issueMachineEnrollmentToken).not.toHaveBeenCalled();
  });

  it("is admin-only", async () => {
    await expect(machineRouter.createCaller(viewerCtx).issueEnrollmentToken({}))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("machine.listEnrollmentTokens / revokeEnrollmentToken (admin)", () => {
  it("list returns the safe rows (no hash)", async () => {
    const rows = await machineRouter.createCaller(adminCtx).listEnrollmentTokens();
    expect(rows[0]).toMatchObject({ id: 1, tokenPrefix: "met_aaaaaa" });
    expect(JSON.stringify(rows)).not.toContain("tokenHash");
  });

  it("revoke stamps the token and audits it", async () => {
    const r = await machineRouter.createCaller(adminCtx).revokeEnrollmentToken({ id: 1 });
    expect(r.success).toBe(true);
    expect(dbm.revokeMachineEnrollmentToken).toHaveBeenCalledWith(1);
    expect(entityAudits().find((a) => a.action === "machine.revokeEnrollmentToken")).toBeTruthy();
  });

  it("list is admin-only", async () => {
    await expect(machineRouter.createCaller(viewerCtx).listEnrollmentTokens())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
