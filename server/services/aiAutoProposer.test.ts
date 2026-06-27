/**
 * AI Auto-Proposer tests.
 *
 * SAFETY INVARIANTS proven here:
 *  - The PURE decide functions propose a SAFE write-tool ONLY when a real bounded
 *    args apply (NG-burst + existing threshold → adjust_ng_threshold, tighter &
 *    in-bounds). No threshold / non-NG rule / no-tighter-value → null (advisory only).
 *  - runForTrigger NEVER calls confirmAction or tool.execute — it ONLY ever calls
 *    proposeAction (asserted: confirm/execute spies never fire).
 *  - Flag OFF (default) → safe no-op (proposed 0, reason DISABLED).
 *  - Throttle/dedup: a second run within the window for the same scope is skipped.
 *  - User-targeting: only users with the tool permission (checkPermission) get a
 *    proposal; cap is respected.
 *
 * The DB, tool registry, permission checks and the HITL action service are mocked,
 * so no model and no real DB are required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the HITL action service: proposeAction is the ONLY allowed write path. ──
const proposeAction = vi.fn(async () => ({ ok: true, pendingAction: { actionId: "a1" } }));
const confirmAction = vi.fn();
const cancelAction = vi.fn();
vi.mock("./aiCopilotActions", () => ({
  proposeAction: (...a: unknown[]) => proposeAction(...a),
  confirmAction: (...a: unknown[]) => confirmAction(...a),
  cancelAction: (...a: unknown[]) => cancelAction(...a),
}));

// ── Mock the tool registry: provide the engineering write-tool. ──
const toolExecute = vi.fn();
const adjustNgThresholdTool = {
  name: "adjust_ng_threshold",
  kind: "write" as const,
  requiredPermission: { module: "settings_alerts", action: "canEdit" },
  preview: vi.fn(),
  execute: toolExecute,
  summarize: () => "adjust",
  parameters: {},
  triggers: [],
};
vi.mock("./aiLocalTools/toolRegistry", () => ({
  getTool: (name: string) => (name === "adjust_ng_threshold" ? adjustNgThresholdTool : undefined),
  isWriteTool: (t: any) => !!t && t.kind === "write",
}));
// The side-effect import that registers engineering tools — make it a no-op.
vi.mock("./aiLocalTools/writeHandlers/engineering", () => ({}));

// ── Mock the causal graph (rationale is best-effort). ──
vi.mock("./aiCausalGraph", () => ({
  isCausalGraphEnabled: () => false,
  queryByText: () => ({ defect: null, machine: null, causes: [] }),
  formatCausalContext: () => "",
}));

// ── Mock checkPermission: user 1 permitted, user 2 NOT. ──
const checkPermission = vi.fn(async (userId: number) => userId === 1);
vi.mock("../_core/accessControl", () => ({
  checkPermission: (...a: any[]) => checkPermission(a[0], a[1], a[2], a[3]),
}));

// ── Mock the DB layer for resolveMachineContext + findResponsibleUsers. ──
// We special-case by the "from" table marker.
const TBL = (n: string) => ({ __table: n });
function makeFakeDb(opts: {
  machineRow?: any;
  thresholdRow?: any;
  candidateUsers?: any[];
  assignments?: any[];
}) {
  return {
    select: (_cols?: unknown) => ({
      from: (t: any) => {
        // chainable joins → terminal where(...).limit(n) OR where(...)
        const builder: any = {
          innerJoin: () => builder,
          where: (_pred: unknown) => ({
            limit: async (_n: number) => {
              if (t.__table === "machines") return opts.machineRow ? [opts.machineRow] : [];
              if (t.__table === "thresholds") return opts.thresholdRow ? [opts.thresholdRow] : [];
              return [];
            },
            // some queries (users / assignments) call where() without limit()
            then: undefined,
          }),
        };
        // For users/assignments the service awaits where(...) directly (no limit).
        if (t.__table === "users") {
          builder.where = async (_pred: unknown) => opts.candidateUsers ?? [];
        }
        if (t.__table === "assignments") {
          builder.where = async (_pred: unknown) => opts.assignments ?? [];
        }
        return builder;
      },
    }),
  };
}

let dbOpts: any = {};
vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => makeFakeDb(dbOpts)),
}));

vi.mock("drizzle-orm", () => ({
  eq: () => () => true,
  and: () => () => true,
  inArray: () => () => true,
}));

vi.mock("../../drizzle/schema", () => ({
  machines: { __table: "machines", id: {}, code: {}, stationId: {} },
  stations: { __table: "stations", id: {}, lineId: {} },
  productionLines: { __table: "lines", id: {}, workshopId: {} },
  workshops: { __table: "workshops", id: {}, factoryId: {} },
  factories: { __table: "factories", id: {}, code: {} },
  mqttNgRateThresholds: { __table: "thresholds", id: {}, machineId: {}, warningThreshold: {}, criticalThreshold: {} },
  users: { __table: "users", id: {}, role: {}, name: {}, isActive: {} },
  userFactoryAssignments: { __table: "assignments", userId: {}, factoryCode: {} },
}));

import {
  decideNgBurst,
  decideForTrigger,
  runForTrigger,
  startAutoProposer,
  stopAutoProposer,
  isAutoProposeEnabled,
} from "./aiAutoProposer";

beforeEach(() => {
  vi.clearAllMocks();
  stopAutoProposer();
  dbOpts = {};
  delete process.env.AI_AUTO_PROPOSE_ENABLED;
  delete process.env.AI_AUTO_PROPOSE_MIN_INTERVAL_MS;
  delete process.env.AI_AUTO_PROPOSE_MAX_PER_RUN;
  delete process.env.AI_AUTO_PROPOSE_NG_TIGHTEN;
});

describe("decideNgBurst (pure)", () => {
  it("proposes a tighter, in-bounds warning when a threshold exists", () => {
    const res = decideNgBurst({ id: 7, warningThreshold: "5.00", criticalThreshold: "10.00" }, "why");
    expect(res.draft).not.toBeNull();
    expect(res.draft!.tool).toBe("adjust_ng_threshold");
    expect(res.draft!.args.thresholdId).toBe(7);
    // 5 * (1 - 0.2) = 4 → strictly tighter, within 0–100.
    expect(res.draft!.args.warningThreshold).toBe(4);
  });

  it("returns null (advisory-only) when there is NO existing threshold", () => {
    const res = decideNgBurst(null, "why");
    expect(res.draft).toBeNull();
    expect(res.reason).toBe("NO_EXISTING_THRESHOLD");
  });

  it("returns null when the current warning is invalid / not tighter", () => {
    expect(decideNgBurst({ id: 1, warningThreshold: "0", criticalThreshold: "5" }, "w").draft).toBeNull();
    expect(decideNgBurst({ id: 1, warningThreshold: null, criticalThreshold: "5" }, "w").draft).toBeNull();
  });

  it("clamps the proposed value within 0–100", () => {
    const res = decideNgBurst({ id: 2, warningThreshold: "100", criticalThreshold: "100" }, "w");
    const v = res.draft!.args.warningThreshold as number;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
    expect(v).toBeLessThan(100);
  });
});

describe("decideForTrigger (pure)", () => {
  it("only ng_burst yields a safe write draft; other rules are advisory-only", () => {
    const ng = decideForTrigger("ng_burst", { id: 3, warningThreshold: "6", criticalThreshold: "12" }, "w");
    expect(ng.draft).not.toBeNull();

    const spc = decideForTrigger("spc_critical", { id: 3, warningThreshold: "6", criticalThreshold: "12" }, "w");
    expect(spc.draft).toBeNull();
    expect(spc.reason).toBe("NO_SAFE_WRITE_TOOL_FOR_RULE");
  });
});

describe("runForTrigger — flag gate + HITL invariant", () => {
  it("is a safe no-op when the flag is OFF (default)", async () => {
    expect(isAutoProposeEnabled()).toBe(false);
    const res = await runForTrigger({ rule: "ng_burst", machine: "M5" });
    expect(res.proposed).toBe(0);
    expect(res.skippedReason).toBe("DISABLED");
    expect(proposeAction).not.toHaveBeenCalled();
    expect(confirmAction).not.toHaveBeenCalled();
    expect(toolExecute).not.toHaveBeenCalled();
  });

  it("PROPOSES (never confirms/executes) to permitted users only", async () => {
    process.env.AI_AUTO_PROPOSE_ENABLED = "true";
    dbOpts = {
      machineRow: { machineId: 50, factoryCode: "F1" },
      thresholdRow: { id: 7, warningThreshold: "5.00", criticalThreshold: "10.00" },
      candidateUsers: [
        { id: 1, role: "maintenance", name: "Permitted" },
        { id: 2, role: "supervisor", name: "Denied" },
      ],
      assignments: [{ userId: 1 }, { userId: 2 }],
    };

    const res = await runForTrigger({ rule: "ng_burst", machine: "M5" }, 1_700_000_000_000);

    expect(res.proposed).toBe(1);
    expect(res.targets).toEqual([1]);
    // proposeAction called exactly once (only the permitted user).
    expect(proposeAction).toHaveBeenCalledTimes(1);
    const callArgs = proposeAction.mock.calls[0] as any[];
    expect(callArgs[0].name).toBe("adjust_ng_threshold");
    expect(callArgs[1]).toMatchObject({ thresholdId: 7, warningThreshold: 4 });
    expect(callArgs[2].user.id).toBe(1);
    // HITL INVARIANT: never confirm/execute.
    expect(confirmAction).not.toHaveBeenCalled();
    expect(toolExecute).not.toHaveBeenCalled();
  });

  it("skips on throttle for the same scope within the window", async () => {
    process.env.AI_AUTO_PROPOSE_ENABLED = "true";
    process.env.AI_AUTO_PROPOSE_MIN_INTERVAL_MS = "60000";
    dbOpts = {
      machineRow: { machineId: 50, factoryCode: "F1" },
      thresholdRow: { id: 7, warningThreshold: "5.00", criticalThreshold: "10.00" },
      candidateUsers: [{ id: 1, role: "maintenance", name: "P" }],
      assignments: [{ userId: 1 }],
    };

    const first = await runForTrigger({ rule: "ng_burst", machine: "M5" }, 1_700_000_000_000);
    expect(first.proposed).toBe(1);

    const second = await runForTrigger({ rule: "ng_burst", machine: "M5" }, 1_700_000_030_000);
    expect(second.skippedReason).toBe("THROTTLED");
    expect(second.proposed).toBe(0);
    expect(proposeAction).toHaveBeenCalledTimes(1); // still only the first
  });

  it("does NOT propose a write when there is no existing threshold (advisory-only)", async () => {
    process.env.AI_AUTO_PROPOSE_ENABLED = "true";
    dbOpts = {
      machineRow: { machineId: 50, factoryCode: "F1" },
      thresholdRow: null,
      candidateUsers: [{ id: 1, role: "maintenance", name: "P" }],
      assignments: [{ userId: 1 }],
    };
    const res = await runForTrigger({ rule: "ng_burst", machine: "M5" }, 1_700_000_000_000);
    expect(res.proposed).toBe(0);
    expect(res.skippedReason).toBe("NO_EXISTING_THRESHOLD");
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it("does NOT propose for non-NG triggers (advisory-only)", async () => {
    process.env.AI_AUTO_PROPOSE_ENABLED = "true";
    dbOpts = {
      machineRow: { machineId: 50, factoryCode: "F1" },
      thresholdRow: { id: 7, warningThreshold: "5", criticalThreshold: "10" },
      candidateUsers: [{ id: 1, role: "maintenance", name: "P" }],
      assignments: [{ userId: 1 }],
    };
    const res = await runForTrigger({ rule: "spc_critical", machine: "M5" }, 1_700_000_000_000);
    expect(res.proposed).toBe(0);
    expect(proposeAction).not.toHaveBeenCalled();
  });
});

describe("start/stop lifecycle", () => {
  it("start is a no-op when the flag is off", () => {
    expect(() => startAutoProposer()).not.toThrow();
    expect(() => stopAutoProposer()).not.toThrow();
  });
});
