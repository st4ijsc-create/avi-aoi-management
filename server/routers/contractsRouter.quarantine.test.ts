/**
 * contractsRouter quarantine surface tests — doc 44 W2-B2 (G2.6).
 *
 * Router contract only (the enforcement seam itself is covered by
 * services/contracts/ingestValidation.test.ts):
 *   • listQuarantine / ingestValidationStats — protectedProcedure (UNAUTHORIZED when anon)
 *   • reviewQuarantine / replayQuarantine — adminProcedure (admin + 2FA), NOT_FOUND on
 *     unknown id, status/reviewer stamping, and the HONEST replay contract
 *     (reinjected:false + payload returned for manual re-submission).
 *
 * DB is a light fake behind ../db/connection (dynamic-import seam of the router).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const listRows: any[] = [];
let updateResult: any[] = [];
const setSpy = vi.fn((_v: any) => ({ where: () => ({ returning: async () => updateResult }) }));
const whereSpy = vi.fn();
const limitSpy = vi.fn(async (n: number) => listRows.slice(0, n));

const fakeDb = {
  select: () => {
    const chain: any = {
      from: () => chain,
      $dynamic: () => chain,
      where: (...a: any[]) => {
        whereSpy(...a);
        return chain;
      },
      orderBy: () => ({ limit: limitSpy }),
    };
    return chain;
  },
  update: () => ({ set: setSpy }),
};

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => fakeDb),
  getJobsDb: vi.fn(async () => null),
}));

import { contractsRouter } from "./contractsRouter";
import { _resetIngestValidation } from "../services/contracts/ingestValidation";

const anon = () => contractsRouter.createCaller({ user: null } as any);
const user = () => contractsRouter.createCaller({ user: { id: 7, role: "user" } } as any);
const admin = () =>
  contractsRouter.createCaller({ user: { id: 1, role: "admin", twoFactorEnabled: true } } as any);
const adminNo2fa = () =>
  contractsRouter.createCaller({ user: { id: 2, role: "admin", twoFactorEnabled: false } } as any);

beforeEach(() => {
  _resetIngestValidation();
  listRows.length = 0;
  updateResult = [];
  setSpy.mockClear();
  whereSpy.mockClear();
  limitSpy.mockClear();
  delete process.env.CONTRACT_VALIDATE_INGEST_MODE;
});

describe("auth boundaries", () => {
  it("listQuarantine requires auth", async () => {
    await expect(anon().listQuarantine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("reviewQuarantine is admin+2FA only", async () => {
    await expect(user().reviewQuarantine({ id: 1, action: "reviewed" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(adminNo2fa().reviewQuarantine({ id: 1, action: "reviewed" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("replayQuarantine is admin+2FA only", async () => {
    await expect(user().replayQuarantine({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("listQuarantine + stats", () => {
  it("returns rows newest-first with the requested limit; filters add a where clause", async () => {
    listRows.push(
      { id: 2, subject: "syn/+/+/+/+/+/telemetry", source: "mqtt", status: "quarantined" },
      { id: 1, subject: "syn/+/+/+/+/+/telemetry", source: "telemetry_bus", status: "reviewed" },
    );
    const all = await user().listQuarantine();
    expect(all).toHaveLength(2);
    expect(limitSpy).toHaveBeenCalledWith(100); // default limit
    expect(whereSpy).not.toHaveBeenCalled(); // no filters → no where

    await user().listQuarantine({ subject: "syn/+/+/+/+/+/telemetry", status: "quarantined", limit: 5 });
    expect(whereSpy).toHaveBeenCalledTimes(1);
    expect(limitSpy).toHaveBeenLastCalledWith(5);
  });

  it("rejects an unknown status filter (zod enum)", async () => {
    await expect(user().listQuarantine({ status: "banana" as any })).rejects.toThrow();
  });

  it("ingestValidationStats exposes the in-process counters (mode off by default)", async () => {
    const s = await user().ingestValidationStats();
    expect(s).toEqual({ mode: "off", validatorErrors: 0, subjects: [] });
  });
});

describe("reviewQuarantine", () => {
  it("marks reviewed/discarded and stamps the reviewer", async () => {
    updateResult = [{ id: 9, status: "discarded" }];
    const out = await admin().reviewQuarantine({ id: 9, action: "discarded" });
    expect(out).toEqual({ id: 9, status: "discarded" });
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "discarded", reviewedBy: 1, reviewedAt: expect.any(Date) }),
    );
  });

  it("NOT_FOUND for an unknown id", async () => {
    updateResult = [];
    await expect(admin().reviewQuarantine({ id: 12345, action: "reviewed" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("replayQuarantine — honest contract", () => {
  it("marks 'replayed' and returns the payload with reinjected:false (no silent auto-replay)", async () => {
    const payload = { asset_id: "aoi-01", ts: "t", metrics: [] };
    updateResult = [{ id: 3, subject: "syn/+/+/+/+/+/telemetry", source: "mqtt", payload }];
    const out = await admin().replayQuarantine({ id: 3 });
    expect(out).toEqual({
      id: 3,
      subject: "syn/+/+/+/+/+/telemetry",
      source: "mqtt",
      payload,
      reinjected: false,
    });
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "replayed", reviewedBy: 1, reviewedAt: expect.any(Date) }),
    );
  });

  it("NOT_FOUND for an unknown id", async () => {
    updateResult = [];
    await expect(admin().replayQuarantine({ id: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
