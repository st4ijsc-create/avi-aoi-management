/**
 * RCA Copilot — create_maintenance_workorder write-tool through the HITL lifecycle.
 *
 * Asserts (reusing proposeAction/confirmAction):
 *   - registration: kind 'write' + machine_monitoring/canCreate permission.
 *   - preview is READ-ONLY (no insert; resolves machineCode; shows the WO).
 *   - missing permission → propose denied + audit, nothing stored, no insert.
 *   - zod bounds: priority out of [1,5] / empty title rejected by propose.
 *   - happy path: propose → confirm → execute → ONE insert into work orders.
 *   - execute args come from the DB row (not the client).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;
const store = new Map<string, Row>(); // ai_pending_actions
const workOrders: Row[] = [];
const machinesRows: Row[] = [{ id: 5, code: "AOI-05", name: "AOI 5" }];

function makeFakeDb() {
  return {
    insert: (table: any) => ({
      values: async (vals: Row) => {
        if (table?.__table === "maintenance_work_orders") {
          const id = workOrders.length + 1;
          workOrders.push({ id, ...vals });
          return { returning: async () => [{ id }] };
        }
        store.set(vals.id, { ...vals });
        return undefined;
      },
      // drizzle .returning() chained off insert().values() in the tool:
      // emulate by returning an object exposing returning() too.
    }),
    select: () => ({
      from: (table: any) => ({
        where: (pred: (r: Row) => boolean) => ({
          limit: async () => {
            const src = table?.__table === "machines" ? machinesRows : Array.from(store.values());
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

// The tool uses `db.insert(...).values({...}).returning({...})`. Our fake's
// values() returns a Promise; to support `.returning()` we make values() return
// a thenable object that also has returning(). Re-implement insert accordingly.
function makeFakeDbWithReturning() {
  const base = makeFakeDb();
  (base as any).insert = (table: any) => ({
    // Returns a thenable that ALSO exposes returning() — supports both
    // `await db.insert().values({...})` (ai_pending_actions) and
    // `await db.insert().values({...}).returning({...})` (work orders).
    values: (vals: Row) => {
      const isWo = table?.__table === "maintenance_work_orders";
      const doStore = () => {
        if (isWo) {
          const id = workOrders.length + 1;
          workOrders.push({ id, ...vals });
          return [{ id }];
        }
        store.set(vals.id, { ...vals });
        return [];
      };
      return {
        returning: async () => doStore(),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(doStore()).then(resolve),
      };
    },
  });
  return base;
}

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
  and: (...p: Array<(r: Row) => boolean>) => (r: Row) => p.every((f) => f(r)),
  lt: (col: any, val: any) => (r: Row) => r[col.__name] < val,
}));
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDbWithReturning()) }));

function schemaFactory() {
  return {
    aiPendingActions: { id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" }, expiresAt: { __name: "expiresAt" } },
    maintenanceWorkOrders: { __table: "maintenance_work_orders", id: { __name: "id" } },
    machines: { __table: "machines", id: { __name: "id" } },
  };
}
vi.mock("../../../../drizzle/schema", () => schemaFactory());
vi.mock("../../../drizzle/schema", () => schemaFactory());
vi.mock("../../drizzle/schema", () => schemaFactory());

const checkPermission = vi.fn();
vi.mock("../../../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));
vi.mock("../../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));
vi.mock("../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));

const logCrudOperation = vi.fn(async () => ({ id: 1 }));
const logUpdate = vi.fn(async () => {});
vi.mock("../../auditTrailService", () => ({
  AUDIT_ACTIONS: { AI_ACTION_PROPOSED: "ai_action_proposed", AI_ACTION_CONFIRMED: "ai_action_confirmed", AI_ACTION_EXECUTED: "ai_action_executed", AI_ACTION_DENIED: "ai_action_denied", AI_ACTION_CANCELLED: "ai_action_cancelled" },
  ENTITY_TYPES: { AI_ACTION: "ai_action" },
  createAuditContext: () => ({ userId: 1, source: "web" }),
  logCrudOperation: (...a: unknown[]) => logCrudOperation(...a),
  logUpdate: (...a: unknown[]) => logUpdate(...a),
}));

import { getTool } from "../toolRegistry";
import "../writeHandlers";
import { proposeAction, confirmAction } from "../../aiCopilotActions";

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
  workOrders.length = 0;
  vi.clearAllMocks();
  checkPermission.mockResolvedValue(true);
});

describe("create_maintenance_workorder — registration", () => {
  it("registered as a write-tool with machine_monitoring/canCreate", () => {
    const t = tool("create_maintenance_workorder");
    expect(t.kind).toBe("write");
    expect(t.requiredPermission).toEqual({ module: "machine_monitoring", action: "canCreate" });
  });
});

describe("create_maintenance_workorder — HITL flow", () => {
  const goodArgs = { machineId: 5, title: "Clean stencil", priority: 2, type: "CORRECTIVE" };

  it("preview is READ-ONLY: propose stores a pending row but inserts NO work order", async () => {
    const p = await proposeAction(tool("create_maintenance_workorder"), goodArgs, ctx(ADMIN));
    expect(p.ok).toBe(true);
    expect(workOrders.length).toBe(0); // preview must NOT mutate
    // preview resolved machineCode into the entityName
    expect(p.pendingAction!.preview.entityName).toContain("AOI-05");
  });

  it("missing permission → denied, nothing stored, no work order", async () => {
    checkPermission.mockResolvedValue(false);
    const p = await proposeAction(tool("create_maintenance_workorder"), goodArgs, ctx(OPERATOR));
    expect(p.ok).toBe(false);
    expect(p.denied).toBe(true);
    expect(store.size).toBe(0);
    expect(workOrders.length).toBe(0);
    expect(logCrudOperation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "ai_action_denied" }));
  });

  it("zod bounds: priority > 5 is rejected (no propose)", async () => {
    const t = tool("create_maintenance_workorder");
    const parsed = (t.parameters as any).safeParse({ ...goodArgs, priority: 9 });
    expect(parsed.success).toBe(false);
  });

  it("zod bounds: empty title is rejected", async () => {
    const t = tool("create_maintenance_workorder");
    const parsed = (t.parameters as any).safeParse({ machineId: 5, title: "" });
    expect(parsed.success).toBe(false);
  });

  it("happy path: propose → confirm → execute → exactly ONE work order inserted", async () => {
    const p = await proposeAction(tool("create_maintenance_workorder"), goodArgs, ctx(ADMIN));
    expect(workOrders.length).toBe(0); // not yet
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(c.status).toBe("executed");
    expect(workOrders.length).toBe(1);
    const wo = workOrders[0];
    // args came from the DB row → faithful to the proposed args
    expect(wo.machineId).toBe(5);
    expect(wo.title).toBe("Clean stencil");
    expect(wo.priority).toBe(2);
    expect(wo.type).toBe("CORRECTIVE");
    expect(wo.status).toBe("OPEN");
    expect(wo.machineCode).toBe("AOI-05"); // resolved at execute
    expect(typeof wo.workOrderNumber).toBe("string");
  });
});
