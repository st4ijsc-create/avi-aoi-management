/**
 * Specialist → Action HITL Bridge — router test (doc 69 Giai đoạn 4/Wave 3, D4).
 *
 * Exercises aiSpecialistAgentRouter.proposeRecommendationAsAction:
 *  - a candidate {tool,args} that resolves to a real registered write-tool AND
 *    validates against that tool's own zod schema creates a PROPOSED action via
 *    the (mocked) aiCopilotActions.proposeAction — status proposed, NEVER executed
 *    (proposeAction only ever proposes; confirmAction — a wholly separate,
 *    human-triggered call this endpoint never invokes — is what would execute it).
 *  - a tool outside the SPECIALIST_BRIDGE_TOOLS allow-list is rejected by the input
 *    schema itself (z.enum) — proposeAction is never reached.
 *  - args that fail the tool's OWN zod bounds are rejected (stays advisory) —
 *    proposeAction is never called, nothing is fabricated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Wave 1 (w1-2) — aiSpecialistAgentRouter's procedures now carry
// `.use(moduleGate("MOD_AI"))` (RBAC sweep, see aiSpecialistAgentRouter.ts). This
// file never mocks "../db", so moduleGate's real entitlement resolution runs
// against the isolated test DB and, when that carries no license row, falls back to
// the on-disk `server/license/license-state-cache.json` — a real dev-machine cache
// that predates MOD_AI and would genuinely deny. Bypass license enforcement (the
// same escape hatch offline deployments use) so this file keeps testing what it's
// actually about: the action-bridge tool/args validation, not licensing. Must be
// set before the router's first (dynamic) import below evaluates "../_core/env".
process.env.LICENSE_BYPASS = "true";

const proposeAction = vi.fn();
vi.mock("../services/aiCopilotActions", () => ({
  proposeAction: (...a: unknown[]) => proposeAction(...a),
}));

// Real toolRegistry + the 2 write-handler modules the allow-list draws from — no
// DB/mocking needed to register them (registerTool() is pure, in-memory).
import "../services/aiLocalTools/writeHandlers/qualityAdvisory";
import "../services/aiLocalTools/writeHandlers/maintenance";

const ADMIN = { id: 1, role: "admin", name: "Admin", twoFactorEnabled: true };

function ctx(user: typeof ADMIN = ADMIN) {
  return { user, req: {} } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("aiSpecialistAgentRouter.proposeRecommendationAsAction", () => {
  it("a concrete allow-listed tool mapping with valid args creates a PROPOSED action (never auto-executed)", async () => {
    proposeAction.mockResolvedValue({
      ok: true,
      pendingAction: {
        actionId: "a1",
        token: "a1",
        tool: "run_rca_analysis",
        args: { machineId: 5 },
        summary: "Chạy RCA cho máy #5",
        preview: { entityType: "root_cause_analysis", changes: [], warnings: [], humanSummary: "s" },
        expiresAt: new Date().toISOString(),
      },
    });

    const { aiSpecialistAgentRouter } = await import("./aiSpecialistAgentRouter");
    const caller = aiSpecialistAgentRouter.createCaller(ctx());

    const res: any = await caller.proposeRecommendationAsAction({
      recommendation: "Investigate the root cause for machine #5's rising NG rate",
      tool: "run_rca_analysis",
      args: { machineId: 5 },
      lang: "vi",
    });

    expect(res.ok).toBe(true);
    expect(res.advisory).toBe(false);
    expect(res.pendingAction.actionId).toBe("a1");
    expect(res.sourceRecommendation).toContain("root cause");

    // proposeAction was called exactly once, with the VALIDATED args (never the
    // raw recommendation text) — and it only PROPOSES: this endpoint never calls
    // confirmAction/execute.
    expect(proposeAction).toHaveBeenCalledTimes(1);
    const [toolArg, argsArg] = proposeAction.mock.calls[0];
    expect(toolArg.name).toBe("run_rca_analysis");
    expect(argsArg).toEqual({ machineId: 5 });
  });

  it("args outside the tool's own zod bounds are rejected — stays advisory, proposeAction never called", async () => {
    const { aiSpecialistAgentRouter } = await import("./aiSpecialistAgentRouter");
    const caller = aiSpecialistAgentRouter.createCaller(ctx());

    const res: any = await caller.proposeRecommendationAsAction({
      recommendation: "Create a maintenance work order for the noisy conveyor motor",
      tool: "create_maintenance_workorder",
      args: { machineId: -1, title: "x" }, // machineId must be a positive int → fails safeParse
      lang: "vi",
    });

    expect(res.ok).toBe(false);
    expect(res.advisory).toBe(true);
    expect(res.reason).toBe("ARGS_OUT_OF_BOUNDS");
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it("a tool outside SPECIALIST_BRIDGE_TOOLS is rejected by the input schema itself — proposeAction never reached", async () => {
    const { aiSpecialistAgentRouter } = await import("./aiSpecialistAgentRouter");
    const caller = aiSpecialistAgentRouter.createCaller(ctx());

    // machine_start is a REAL registered write-tool (machineControl.ts) — but it is
    // NOT in SPECIALIST_BRIDGE_TOOLS (it's actuation, autonomy-denylisted), so the
    // z.enum input schema rejects it outright.
    await expect(
      caller.proposeRecommendationAsAction({
        recommendation: "Restart the line to clear the fault",
        tool: "machine_start" as any,
        args: { machineId: 5 },
        lang: "vi",
      }),
    ).rejects.toThrow();

    expect(proposeAction).not.toHaveBeenCalled();
  });

  it("proposeAction returning a denial (RBAC) is surfaced honestly, not silently swallowed", async () => {
    proposeAction.mockResolvedValue({
      ok: false,
      denied: true,
      reason: "MISSING_PERMISSION",
      message: "Bạn không có quyền thực hiện thao tác này.",
    });

    const { aiSpecialistAgentRouter } = await import("./aiSpecialistAgentRouter");
    const caller = aiSpecialistAgentRouter.createCaller(ctx());

    const res: any = await caller.proposeRecommendationAsAction({
      recommendation: "Review the sensitivity of the vibration threshold",
      tool: "request_threshold_review",
      args: { machineId: 5, maxPoints: 3 },
      lang: "vi",
    });

    expect(res.ok).toBe(false);
    expect(res.advisory).toBe(false);
    expect(res.reason).toBe("MISSING_PERMISSION");
    expect(proposeAction).toHaveBeenCalledTimes(1);
  });
});
