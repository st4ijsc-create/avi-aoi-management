/**
 * Doc 31 Đợt A — threshold governance service tests.
 *
 * Covers OP1 SoD (assertApprovalSoD) and OP2 lifecycle gate (resolveThresholdEditGate /
 * assertThresholdEditAllowed) — the full allow/block matrix + the break-glass override.
 * Uses the in-memory FakeDb (no real DB), mirroring the machineRecipeRouter test setup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb, makeEq, makeAnd, resetSeq } from "../routers/__otFakeDb";
import {
  measurementPointDefs,
  productModels,
  inspectionProgramReleases,
} from "../../drizzle/schema/product";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd };
});
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

import {
  assertApprovalSoD,
  resolveThresholdEditGate,
  assertThresholdEditAllowed,
  isThresholdGateEnforced,
} from "./thresholdGovernanceService";

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  delete process.env.THRESHOLD_GATE_ENFORCED;
});
afterEach(() => {
  delete process.env.THRESHOLD_GATE_ENFORCED;
});

function seedPoint(pointId: number, productModelId: number) {
  fake.seed(measurementPointDefs, [{ id: pointId, productModelId, code: `MP-${pointId}`, name: `Point ${pointId}` }]);
}
function seedProduct(id: number, lifecycleStatus: string) {
  fake.seed(productModels, [{ id, code: `PRD-${id}`, name: `Product ${id}`, lifecycleStatus }]);
}
function seedReleased(productModelId: number) {
  fake.seed(inspectionProgramReleases, [{ id: 1, productModelId, status: "released", version: 1 }]);
}

describe("assertApprovalSoD (OP1)", () => {
  it("throws FORBIDDEN when approver === requester", () => {
    expect(() => assertApprovalSoD(5, 5)).toThrow(/Segregation of duties/i);
  });
  it("allows a different approver", () => {
    expect(() => assertApprovalSoD(20, 5)).not.toThrow();
  });
  it("treats the AI auto-tune sentinel (requestedBy=0) as system/non-self", () => {
    expect(() => assertApprovalSoD(0, 5)).not.toThrow();
    // even if the approver were user 0 (never a real id), it must not self-block
    expect(() => assertApprovalSoD(0, 0)).not.toThrow();
  });
  it("treats a null requester as system/non-self", () => {
    expect(() => assertApprovalSoD(null, 5)).not.toThrow();
    expect(() => assertApprovalSoD(undefined, 5)).not.toThrow();
  });
});

describe("lifecycle gate matrix (OP2 / decision #4)", () => {
  it("development + no released program → direct edit allowed", async () => {
    seedPoint(1, 100);
    seedProduct(100, "development");
    const res = await resolveThresholdEditGate(1);
    expect(res.decision).toBe("direct");
    expect(res.hasReleasedProgram).toBe(false);
    await expect(assertThresholdEditAllowed(1)).resolves.toMatchObject({ decision: "direct" });
  });

  it("development + released program → BLOCKED (requires approval)", async () => {
    seedPoint(1, 100);
    seedProduct(100, "development");
    seedReleased(100);
    const res = await resolveThresholdEditGate(1);
    expect(res.decision).toBe("requires_approval");
    expect(res.hasReleasedProgram).toBe(true);
    await expect(assertThresholdEditAllowed(1)).rejects.toThrow(/require approval|hàng đợi duyệt/i);
  });

  it("active product → BLOCKED", async () => {
    seedPoint(1, 100);
    seedProduct(100, "active");
    expect((await resolveThresholdEditGate(1)).decision).toBe("requires_approval");
    await expect(assertThresholdEditAllowed(1)).rejects.toThrow(/FORBIDDEN|approval|duyệt/i);
  });

  it("eol product → BLOCKED", async () => {
    seedPoint(1, 100);
    seedProduct(100, "eol");
    await expect(assertThresholdEditAllowed(1)).rejects.toThrow(/approval|duyệt/i);
  });

  it("archived product → BLOCKED", async () => {
    seedPoint(1, 100);
    seedProduct(100, "archived");
    await expect(assertThresholdEditAllowed(1)).rejects.toThrow(/approval|duyệt/i);
  });

  it("missing product → fail-safe BLOCK (treated as active)", async () => {
    seedPoint(1, 999); // no productModels row 999
    const res = await resolveThresholdEditGate(1);
    expect(res.lifecycleStatus).toBe("active");
    expect(res.decision).toBe("requires_approval");
  });

  it("missing point → NOT_FOUND", async () => {
    await expect(resolveThresholdEditGate(12345)).rejects.toThrow(/not found/i);
  });
});

describe("emergency override (THRESHOLD_GATE_ENFORCED=false)", () => {
  it("downgrades the block to a pass-through but still reports requires_approval", async () => {
    process.env.THRESHOLD_GATE_ENFORCED = "false";
    expect(isThresholdGateEnforced()).toBe(false);
    seedPoint(1, 100);
    seedProduct(100, "active");
    const res = await assertThresholdEditAllowed(1); // does NOT throw under override
    expect(res.decision).toBe("requires_approval");
    expect(res.enforced).toBe(false);
  });

  it("is enforced by default (no env var)", () => {
    expect(isThresholdGateEnforced()).toBe(true);
  });
});
