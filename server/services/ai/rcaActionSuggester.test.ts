/**
 * rcaActionSuggester tests (doc69 Wave2 A3).
 *
 * Proves:
 *  - A recommendation that matches a KNOWN tool + resolves to VALID args (zod
 *    safeParse passes) + an EXISTING entity + a PERMITTED user yields a
 *    suggestedActions entry with the correct tool/args/requiredPermission.
 *  - A recommendation with no tool mapping / invalid args / a missing entity /
 *    a non-permitted user yields NO action — advisory text only, no fabrication.
 *  - The resulting suggested action, when handed to the REAL (unmocked)
 *    aiCopilotActions.proposeAction, goes through the genuine dry-run preview +
 *    RBAC gate (never calls execute at propose time) — same pattern as
 *    aiCopilotActions.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// ─── Fake write-tool registry (mirrors aiAutoProposer.test.ts's technique) ───────
const runRcaAnalysisTool = {
  name: "run_rca_analysis",
  kind: "write" as const,
  requiredPermission: { module: "machine_monitoring", action: "canView" as const },
  parameters: z
    .object({ machineId: z.number().int().positive(), defectType: z.string().min(1).max(128).optional() })
    .strict(),
  summarize: (p: any) => `Chạy RCA cho máy #${p.machineId}`,
  preview: vi.fn(async () => ({ entityType: "root_cause_analysis", changes: [], warnings: [], humanSummary: "preview" })),
  execute: vi.fn(async () => ({ type: "action_result", title: "ok", data: {}, textSummary: "x" })),
  triggers: [],
};

const requestThresholdReviewTool = {
  name: "request_threshold_review",
  kind: "write" as const,
  requiredPermission: { module: "settings_alerts", action: "canView" as const },
  parameters: z
    .object({
      machineId: z.number().int().positive().optional(),
      pointDefId: z.number().int().positive().optional(),
      maxPoints: z.number().int().min(1).max(5).default(3),
      note: z.string().max(500).optional(),
    })
    .strict()
    .refine((p) => p.machineId != null || p.pointDefId != null),
  summarize: (p: any) => `Xem lại ngưỡng cho máy #${p.machineId}`,
  preview: vi.fn(async () => ({ entityType: "threshold_approvals", changes: [], warnings: [], humanSummary: "preview" })),
  execute: vi.fn(async () => ({ type: "action_result", title: "ok", data: {}, textSummary: "x" })),
  triggers: [],
};

const createMaintenanceWorkOrderTool = {
  name: "create_maintenance_workorder",
  kind: "write" as const,
  requiredPermission: { module: "machine_monitoring", action: "canCreate" as const },
  parameters: z
    .object({
      machineId: z.number().int().positive(),
      title: z.string().min(3).max(256),
      description: z.string().max(4000).optional(),
      priority: z.number().int().min(1).max(5).default(3),
      type: z.enum(["CORRECTIVE", "PREVENTIVE", "PREDICTIVE", "INSPECTION"]).default("CORRECTIVE"),
      assignedTo: z.number().int().positive().nullable().optional(),
    })
    .strict(),
  summarize: (p: any) => `Tạo lệnh bảo trì cho máy #${p.machineId}: "${p.title}"`,
  preview: vi.fn(async () => ({ entityType: "maintenance_work_order", changes: [], warnings: [], humanSummary: "preview" })),
  execute: vi.fn(async () => ({ type: "action_result", title: "ok", data: { id: 1 }, textSummary: "x" })),
  triggers: [],
};

const TOOLS: Record<string, any> = {
  run_rca_analysis: runRcaAnalysisTool,
  request_threshold_review: requestThresholdReviewTool,
  create_maintenance_workorder: createMaintenanceWorkOrderTool,
};

vi.mock("../aiLocalTools/toolRegistry", () => ({
  getTool: (name: string) => TOOLS[name],
  isWriteTool: (t: any) => !!t && t.kind === "write",
  assertExecutable: (tool: any) => {
    if (!tool || tool.kind !== "write") return;
    const missing: string[] = [];
    if (typeof tool.preview !== "function") missing.push("preview");
    if (typeof tool.execute !== "function") missing.push("execute");
    if (!tool.requiredPermission) missing.push("requiredPermission");
    if (typeof tool.summarize !== "function") missing.push("summarize");
    if (missing.length) throw new Error(`Write tool "${tool.name}" is missing: ${missing.join(", ")}`);
  },
}));
// The side-effect registration imports — make them safe no-ops (we register the
// fake tools above directly via the mocked registry instead).
vi.mock("../aiLocalTools/writeHandlers/qualityAdvisory", () => ({}));
vi.mock("../aiLocalTools/writeHandlers/maintenance", () => ({}));

// ─── checkPermission (shared by rcaActionSuggester AND the real aiCopilotActions) ─
const checkPermission = vi.fn(async () => true);
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermission(...a),
}));

// ─── Fake DB: `machines` existence lookup (rcaActionSuggester) + `ai_pending_actions`
// CRUD (the REAL aiCopilotActions.proposeAction) share the SAME mocked module. ──────
type Row = Record<string, any>;
const pendingStore = new Map<string, Row>();
const existingMachineIds = new Set<number>();

function makeFakeDb() {
  return {
    insert: (_table: unknown) => ({
      values: async (vals: Row) => {
        pendingStore.set(vals.id, { ...vals });
      },
    }),
    select: (_cols?: unknown) => ({
      from: (table: any) => {
        if (table?.__table === "machines") {
          return {
            where: (pred: (r: Row) => boolean) => ({
              limit: async (_n: number) => [...existingMachineIds].map((id) => ({ id })).filter(pred),
            }),
          };
        }
        return {
          where: (pred: (r: Row) => boolean) => ({
            limit: async (_n: number) => {
              for (const r of pendingStore.values()) if (pred(r)) return [r];
              return [];
            },
          }),
        };
      },
    }),
    update: (_table: unknown) => ({
      set: (patch: Row) => ({
        where: async (pred: (r: Row) => boolean) => {
          let count = 0;
          for (const r of pendingStore.values()) {
            if (pred(r)) {
              Object.assign(r, patch);
              count++;
            }
          }
          return { rowCount: count };
        },
      }),
    }),
  };
}

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../../../drizzle/schema", () => ({
  machines: { __table: "machines", id: { __name: "id" } },
  aiPendingActions: {
    id: { __name: "id" },
    status: { __name: "status" },
    userId: { __name: "userId" },
    expiresAt: { __name: "expiresAt" },
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
  and: (...preds: Array<(r: Row) => boolean>) => (r: Row) => preds.every((p) => p(r)),
  lt: (col: any, val: any) => (r: Row) => r[col.__name] < val,
}));

// ─── Audit trail (the REAL proposeAction logs through it) ────────────────────────
const logCrudOperation = vi.fn(async () => ({ id: 1 }));
const logUpdate = vi.fn(async () => {});
vi.mock("../auditTrailService", () => ({
  AUDIT_ACTIONS: {
    AI_ACTION_PROPOSED: "ai_action_proposed",
    AI_ACTION_CONFIRMED: "ai_action_confirmed",
    AI_ACTION_EXECUTED: "ai_action_executed",
    AI_ACTION_DENIED: "ai_action_denied",
    AI_ACTION_CANCELLED: "ai_action_cancelled",
  },
  ENTITY_TYPES: { AI_ACTION: "ai_action" },
  createAuditContext: () => ({ userId: 1, source: "web" }),
  logCrudOperation: (...a: unknown[]) => logCrudOperation(...a),
  logUpdate: (...a: unknown[]) => logUpdate(...a),
}));

import { suggestActionsForRecommendations, RCA_SUGGESTED_ACTION_TOOLS } from "./rcaActionSuggester";
import { proposeAction } from "../aiCopilotActions";

const MAINTENANCE_USER = { id: 1, role: "maintenance", name: "Tech" };

beforeEach(() => {
  vi.clearAllMocks();
  checkPermission.mockResolvedValue(true);
  pendingStore.clear();
  existingMachineIds.clear();
  existingMachineIds.add(12);
});

describe("RCA_SUGGESTED_ACTION_TOOLS", () => {
  it("is the small, explicit allow-list from the brief", () => {
    expect(RCA_SUGGESTED_ACTION_TOOLS).toEqual([
      "run_rca_analysis",
      "request_threshold_review",
      "create_maintenance_workorder",
    ]);
  });
});

describe("suggestActionsForRecommendations — mapped recommendations", () => {
  it("maps a 'root cause' recommendation to run_rca_analysis with validated args", async () => {
    const actions = await suggestActionsForRecommendations(
      { recommendations: ['Investigate root cause of "solder bridge" defect type'] },
      { machineId: 12, user: MAINTENANCE_USER },
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      recommendationIndex: 0,
      tool: "run_rca_analysis",
      args: { machineId: 12 },
      requiredPermission: { module: "machine_monitoring", action: "canView" },
    });
    expect(actions[0].summary).toContain("#12");
  });

  it("maps a 'preventive maintenance' recommendation to create_maintenance_workorder with validated args", async () => {
    const actions = await suggestActionsForRecommendations(
      { recommendations: ["Implement preventive maintenance schedule for high-defect machines"] },
      { machineId: 12, user: MAINTENANCE_USER },
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].tool).toBe("create_maintenance_workorder");
    expect(actions[0].args).toMatchObject({ machineId: 12, type: "PREVENTIVE", priority: 3 });
    // zod .min(3) on title must genuinely pass — never a fabricated/empty title.
    expect(typeof actions[0].args.title).toBe("string");
    expect((actions[0].args.title as string).length).toBeGreaterThanOrEqual(3);
    expect(actions[0].requiredPermission).toEqual({ module: "machine_monitoring", action: "canCreate" });
  });

  it("maps a 'xem lại ngưỡng' (vi) recommendation to request_threshold_review", async () => {
    const actions = await suggestActionsForRecommendations(
      { recommendations: ["Xem lại ngưỡng cảnh báo cho máy đang trục trặc"] },
      { machineId: 12, user: MAINTENANCE_USER },
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].tool).toBe("request_threshold_review");
    expect(actions[0].args).toMatchObject({ machineId: 12, maxPoints: 3 });
  });

  it("carries the top rootCause as a defectType hint into run_rca_analysis args", async () => {
    const actions = await suggestActionsForRecommendations(
      {
        rootCauses: [{ cause: "Solder bridge on U4" }],
        recommendations: ["Run root cause analysis on this machine"],
      },
      { machineId: 12, user: MAINTENANCE_USER },
    );
    expect(actions[0].args).toMatchObject({ machineId: 12, defectType: "Solder bridge on U4" });
  });

  it("maps MULTIPLE recommendations independently, preserving recommendationIndex", async () => {
    const actions = await suggestActionsForRecommendations(
      {
        recommendations: [
          "Review and standardize operator inspection procedures", // no match
          "Implement preventive maintenance schedule for high-defect machines", // match
          "Investigate root cause of the defect", // match
        ],
      },
      { machineId: 12, user: MAINTENANCE_USER },
    );
    expect(actions.map((a) => a.recommendationIndex)).toEqual([1, 2]);
    expect(actions.map((a) => a.tool)).toEqual(["create_maintenance_workorder", "run_rca_analysis"]);
  });
});

describe("suggestActionsForRecommendations — advisory-only fallback (no fabrication)", () => {
  it("yields NO action for a recommendation with no known tool mapping", async () => {
    const actions = await suggestActionsForRecommendations(
      { recommendations: ["Set up automated alerts for defect rate thresholds trending up"] },
      { machineId: 12, user: MAINTENANCE_USER },
    );
    expect(actions).toEqual([]);
  });

  it("yields NO action when the built args fail the tool's OWN zod schema (invalid args)", async () => {
    // Simulate a schema drift: the registered tool now requires a field the mapper
    // does not (and must not) fabricate. The mapper must silently skip, not error.
    const strictTool = {
      ...createMaintenanceWorkOrderTool,
      parameters: z.object({ machineId: z.number(), title: z.string(), mustHave: z.string() }).strict(),
    };
    TOOLS.create_maintenance_workorder = strictTool;
    try {
      const actions = await suggestActionsForRecommendations(
        { recommendations: ["Schedule preventive maintenance for this line"] },
        { machineId: 12, user: MAINTENANCE_USER },
      );
      expect(actions).toEqual([]);
    } finally {
      TOOLS.create_maintenance_workorder = createMaintenanceWorkOrderTool;
    }
  });

  it("yields NO action when the referenced machine does NOT exist (missing entity)", async () => {
    existingMachineIds.clear(); // machine 12 no longer "exists"
    const actions = await suggestActionsForRecommendations(
      { recommendations: ["Implement preventive maintenance schedule for high-defect machines"] },
      { machineId: 12, user: MAINTENANCE_USER },
    );
    expect(actions).toEqual([]);
  });

  it("yields NO action for a NON-PERMITTED user (RBAC gate #1 — advisory text only)", async () => {
    checkPermission.mockResolvedValue(false);
    const actions = await suggestActionsForRecommendations(
      { recommendations: ["Implement preventive maintenance schedule for high-defect machines"] },
      { machineId: 12, user: { id: 2, role: "operator", name: "Op" } },
    );
    expect(actions).toEqual([]);
    expect(checkPermission).toHaveBeenCalledWith(2, "operator", "machine_monitoring", "canCreate");
  });

  it("yields [] when there is no machineId context at all (nothing to safely bind args to)", async () => {
    const actions = await suggestActionsForRecommendations(
      { recommendations: ["Implement preventive maintenance schedule for high-defect machines"] },
      { user: MAINTENANCE_USER },
    );
    expect(actions).toEqual([]);
  });

  it("yields [] for an empty/undefined recommendations list", async () => {
    expect(await suggestActionsForRecommendations({ recommendations: [] }, { machineId: 12, user: MAINTENANCE_USER })).toEqual([]);
    expect(
      await suggestActionsForRecommendations({ recommendations: undefined as any }, { machineId: 12, user: MAINTENANCE_USER }),
    ).toEqual([]);
  });
});

describe("suggested action → the REAL aiCopilotActions.proposeAction (reuse, not a new write path)", () => {
  it("proposes via dry-run preview (never execute) and is RBAC-checked, for each of the 3 mapped tools", async () => {
    const actions = await suggestActionsForRecommendations(
      {
        recommendations: [
          "Implement preventive maintenance schedule for high-defect machines",
          "Investigate root cause of the defect",
          "Xem lại ngưỡng cảnh báo cho máy đang trục trặc",
        ],
      },
      { machineId: 12, user: MAINTENANCE_USER },
    );
    expect(actions).toHaveLength(3);

    for (const suggested of actions) {
      const tool = TOOLS[suggested.tool];
      const res = await proposeAction(tool, suggested.args, { user: MAINTENANCE_USER, lang: "vi" });
      expect(res.ok).toBe(true);
      expect(res.pendingAction?.tool).toBe(suggested.tool);
      expect(res.pendingAction?.args).toEqual(suggested.args);
      expect(tool.preview).toHaveBeenCalled(); // dry-run preview ran
      expect(tool.execute).not.toHaveBeenCalled(); // NEVER executes at propose time
      // RBAC re-checked INSIDE proposeAction too (gate #2 — independent of the
      // mapper's own gate #1 checked above).
      expect(checkPermission).toHaveBeenCalledWith(
        MAINTENANCE_USER.id,
        MAINTENANCE_USER.role,
        suggested.requiredPermission.module,
        suggested.requiredPermission.action,
      );
    }
  });

  it("the real proposeAction DENIES a suggested action when the user lacks the tool's permission", async () => {
    const actions = await suggestActionsForRecommendations(
      { recommendations: ["Implement preventive maintenance schedule for high-defect machines"] },
      { machineId: 12, user: MAINTENANCE_USER },
    );
    expect(actions).toHaveLength(1);
    const suggested = actions[0];
    const tool = TOOLS[suggested.tool];

    checkPermission.mockResolvedValue(false); // role changed / never had it — propose-time gate
    const res = await proposeAction(tool, suggested.args, { user: { id: 2, role: "operator" }, lang: "vi" });
    expect(res.ok).toBe(false);
    expect(res.denied).toBe(true);
    expect(tool.execute).not.toHaveBeenCalled();
    expect(pendingStore.size).toBe(0); // denied propose never persists a row
  });
});
