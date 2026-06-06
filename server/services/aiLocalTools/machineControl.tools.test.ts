/**
 * Sprint F4a — machine control write-tools through the HITL lifecycle.
 *
 * Asserts (reusing proposeAction/confirmAction):
 *   - preview does NOT call the dispatcher / writeTags (read-only)
 *   - missing permission → propose denied + audit, nothing stored
 *   - happy path: propose → confirm → execute → dispatch (simulated)
 *   - execute args come from the DB row (not the client)
 *   - RBAC #2 loss at confirm → denied, dispatch NOT called
 *   - execute passes the confirmed actionId to the dispatcher (defense-in-depth)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;
const store = new Map<string, Row>(); // ai_pending_actions
const adapters: Row[] = [{ id: 10, machineId: 5, code: "A10", isEnabled: true }];
const tags: Row[] = [
  { id: 100, adapterId: 10, tagKey: "cmd_start", address: "ns=1;s=Start", writable: true, isEnabled: true },
  { id: 101, adapterId: 10, tagKey: "speed", address: "ns=1;s=Speed", writable: true, isEnabled: true },
  { id: 102, adapterId: 10, tagKey: "recipe_select", address: "ns=1;s=Rcp", writable: true, isEnabled: true },
];

function makeFakeDb() {
  return {
    insert: () => ({ values: async (vals: Row) => { store.set(vals.id, { ...vals }); } }),
    select: () => ({
      from: (table: any) => ({
        where: (pred: (r: Row) => boolean) => ({
          limit: async () => {
            const src = table?.__table === "device_adapters" ? adapters
              : table?.__table === "device_tags" ? tags
              : Array.from(store.values());
            for (const r of src) if (pred(r)) return [r];
            return [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (patch: Row) => ({
        where: async (pred: (r: Row) => boolean) => {
          let c = 0; for (const r of store.values()) if (pred(r)) { Object.assign(r, patch); c++; } return { rowCount: c };
        },
      }),
    }),
  };
}

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
  and: (...p: Array<(r: Row) => boolean>) => (r: Row) => p.every((f) => f(r)),
  lt: (col: any, val: any) => (r: Row) => r[col.__name] < val,
}));
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));

function schemaFactory() {
  return {
    aiPendingActions: { id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" }, expiresAt: { __name: "expiresAt" } },
    // tables touched by machineControl preview/execute
    deviceAdapters: { __table: "device_adapters", machineId: { __name: "machineId" }, id: { __name: "id" }, isEnabled: { __name: "isEnabled" } },
    deviceTags: { __table: "device_tags", adapterId: { __name: "adapterId" }, tagKey: { __name: "tagKey" }, writable: { __name: "writable" }, isEnabled: { __name: "isEnabled" } },
  };
}
vi.mock("../../../drizzle/schema", () => schemaFactory());
vi.mock("../../drizzle/schema", () => schemaFactory());

const checkPermission = vi.fn();
vi.mock("../../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));
vi.mock("../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));

// machineRecipe — select_recipe reads active recipe.
const getActiveRecipe = vi.fn(async () => ({ id: 1, code: "R1", version: 2 }));
vi.mock("../../db/machineRecipe", () => ({ getActiveRecipe: (...a: unknown[]) => getActiveRecipe(...a) }));

// commandDispatcher — the ONLY device path; spied so we can assert preview never calls it.
const dispatchSpy = vi.fn(async () => ({ ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [1] }));
vi.mock("../ot/commandDispatcher", () => ({
  dispatch: (...a: unknown[]) => dispatchSpy(...a),
  isOtControlEnabled: () => false,
}));

// audit — silence.
const logCrudOperation = vi.fn(async () => ({ id: 1 }));
const logUpdate = vi.fn(async () => {});
vi.mock("../auditTrailService", () => ({
  AUDIT_ACTIONS: { AI_ACTION_PROPOSED: "ai_action_proposed", AI_ACTION_CONFIRMED: "ai_action_confirmed", AI_ACTION_EXECUTED: "ai_action_executed", AI_ACTION_DENIED: "ai_action_denied", AI_ACTION_CANCELLED: "ai_action_cancelled" },
  ENTITY_TYPES: { AI_ACTION: "ai_action" },
  createAuditContext: () => ({ userId: 1, source: "web" }),
  logCrudOperation: (...a: unknown[]) => logCrudOperation(...a),
  logUpdate: (...a: unknown[]) => logUpdate(...a),
}));

import { getTool } from "./toolRegistry";
import "./writeHandlers";
import { proposeAction, confirmAction } from "../aiCopilotActions";

const ADMIN = { id: 1, role: "admin", name: "Admin" } as const;
const OPERATOR = { id: 2, role: "operator", name: "Op" } as const;
const ctx = (user: typeof ADMIN | typeof OPERATOR) => ({ user, lang: "vi" as const });

function tool(name: string) {
  const t = getTool(name);
  if (!t) throw new Error(`${name} not registered`);
  return t;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  checkPermission.mockResolvedValue(true);
  getActiveRecipe.mockResolvedValue({ id: 1, code: "R1", version: 2 });
});

describe("machine control — registration + permissions", () => {
  it("all 8 tools registered with correct kind + permission action", () => {
    const create = ["machine_start", "machine_stop", "machine_pause", "machine_reset", "select_recipe", "download_job"];
    const edit = ["set_machine_param", "acknowledge_machine_alarm"];
    for (const n of create) {
      const t = tool(n);
      expect(t.kind).toBe("write");
      expect(t.requiredPermission).toEqual({ module: "machine_control", action: "canCreate" });
    }
    for (const n of edit) {
      const t = tool(n);
      expect(t.requiredPermission).toEqual({ module: "machine_control", action: "canEdit" });
    }
  });
});

describe("machine_start — HITL flow", () => {
  it("preview does NOT call dispatch", async () => {
    const p = await proposeAction(tool("machine_start"), { machineId: 5 }, ctx(ADMIN));
    expect(p.ok).toBe(true);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("missing permission → denied + audit, nothing stored", async () => {
    checkPermission.mockResolvedValue(false);
    const p = await proposeAction(tool("machine_start"), { machineId: 5 }, ctx(OPERATOR));
    expect(p.ok).toBe(false);
    expect(p.denied).toBe(true);
    expect(store.size).toBe(0);
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(logCrudOperation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "ai_action_denied" }));
  });

  it("happy path: propose → confirm → execute → dispatch(simulated), actionId threaded", async () => {
    const p = await proposeAction(tool("machine_start"), { machineId: 5 }, ctx(ADMIN));
    expect(dispatchSpy).not.toHaveBeenCalled();
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(c.status).toBe("executed");
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const arg = dispatchSpy.mock.calls[0][0] as any;
    expect(arg.commandType).toBe("start");
    // F5b: AI write-tools ALWAYS dispatch via the human-confirmed HITL path; they
    // NEVER produce triggeredBy.kind='interlock'.
    expect(arg.triggeredBy.kind).toBe("hitl");
    expect(arg.triggeredBy.confirmedBy).toBe(1);
    expect(arg.triggeredBy.requestedBy).toBe(1);
    expect(arg.triggeredBy.actionId).toBe(p.pendingAction!.actionId); // defense-in-depth id passed through
    expect(arg.writes).toEqual([{ tagKey: "cmd_start", value: true }]);
  });

  it("AI SAFETY: an AI write-tool dispatch is NEVER triggeredBy.kind='interlock'", async () => {
    const p = await proposeAction(tool("machine_stop"), { machineId: 5 }, ctx(ADMIN));
    await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const arg = dispatchSpy.mock.calls[0][0] as any;
    expect(arg.triggeredBy.kind).toBe("hitl");
    expect(arg.triggeredBy.kind).not.toBe("interlock");
  });

  it("RBAC #2 lost at confirm → denied, dispatch NOT called", async () => {
    const p = await proposeAction(tool("machine_start"), { machineId: 5 }, ctx(ADMIN));
    checkPermission.mockResolvedValue(false); // role downgraded between phases
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(c.status).toBe("denied");
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe("execute uses DB-row args (not client)", () => {
  it("set_machine_param dispatch value comes from the stored row", async () => {
    const p = await proposeAction(tool("set_machine_param"), { machineId: 5, tagKey: "speed", value: 42 }, ctx(ADMIN));
    // Tamper the client-side copy AFTER propose — execute must use the DB row.
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(c.status).toBe("executed");
    const arg = dispatchSpy.mock.calls[0][0] as any;
    expect(arg.commandType).toBe("set_param");
    expect(arg.writes).toEqual([{ tagKey: "speed", value: 42 }]);
  });
});

describe("select_recipe", () => {
  it("execute resolves active recipe and dispatches its version", async () => {
    const p = await proposeAction(tool("select_recipe"), { machineId: 5, recipeCode: "R1" }, ctx(ADMIN));
    expect(dispatchSpy).not.toHaveBeenCalled();
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(c.status).toBe("executed");
    const arg = dispatchSpy.mock.calls[0][0] as any;
    expect(arg.commandType).toBe("select_recipe");
    expect(arg.writes[0].value).toBe(2); // active recipe version
  });
});
