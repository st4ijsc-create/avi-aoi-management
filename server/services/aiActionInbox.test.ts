/**
 * AI Action Inbox tests.
 *
 * Proves:
 *  - Aggregation shape: proposals + insights merged into one severity-sorted feed,
 *    each item carrying its supported 1-tap actions + (proposals) the confirm token.
 *  - Per-user scoping: proposals are filtered to the current user; a non-admin only
 *    sees insights for machines in their factory scope; admin sees all.
 *  - dismiss() NEVER executes a tool: proposal → reuses the HITL cancel flow;
 *    insight → marks acknowledged. (confirm/execute spies never fire.)
 *
 * The DB, factory assignments and the HITL cancel flow are mocked — no real DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── HITL cancel flow (the ONLY thing dismiss(proposal) may call). ──
const cancelAction = vi.fn(async () => ({ ok: true, status: "cancelled" }));
const confirmAction = vi.fn();
vi.mock("./aiCopilotActions", () => ({
  cancelAction: (...a: unknown[]) => cancelAction(...a),
  confirmAction: (...a: unknown[]) => confirmAction(...a),
}));

// ── Anomaly source: the REAL per-machine reader (server/routers/aiAnomalyRouter.ts),
//    dynamically imported by listAlerts. Default: no statuses (alerts no-op) unless a
//    test overrides the resolved value. ──
const readMachineStatuses = vi.fn(async (_ids: number[], _productModelId: number | null) => ({}) as Record<number, any>);
vi.mock("../routers/aiAnomalyRouter", () => ({
  readMachineStatuses: (...a: [number[], number | null]) => readMachineStatuses(...a),
}));

// ── Factory assignments per user. ──
const getUserFactoryAssignments = vi.fn(async (_userId: number) => [] as Array<{ factoryCode: string }>);
vi.mock("../db/auth", () => ({
  getUserFactoryAssignments: (...a: any[]) => getUserFactoryAssignments(a[0]),
}));

// ── Fake DB routed by table marker. ──
let data: {
  proposals?: any[];
  insights?: any[];
  machines?: any[]; // machineScope() join result rows {code}
  insightById?: Record<number, any>;
  updated?: any[];
} = {};

function makeFakeDb() {
  // A thenable that resolves to `rows` (so `await where(...)` works for the
  // count() + machineScope join paths) while ALSO exposing orderBy()/limit()
  // for the list paths (.where().orderBy().limit() and .where().limit()).
  function terminal(rows: any[]): any {
    return {
      orderBy: () => ({ limit: async (_n: number) => rows }),
      limit: async (_n: number) => rows,
      then: (resolve: (v: any[]) => void) => resolve(rows),
    };
  }
  return {
    select: (_cols?: unknown) => ({
      from: (t: any) => {
        const builder: any = {
          innerJoin: () => builder,
          where: (_pred: unknown) => terminal(rowsFor(t)),
        };
        return builder;
      },
    }),
    update: (_t: any) => ({
      set: (patch: any) => ({
        where: async (_pred: unknown) => {
          (data.updated ??= []).push(patch);
          return { rowCount: 1 };
        },
      }),
    }),
  };

  function rowsFor(t: any): any[] {
    switch (t.__table) {
      case "proposals":
        return data.proposals ?? [];
      case "insights":
        return data.insights ?? [];
      case "machines":
        return data.machines ?? [];
      default:
        return [];
    }
  }
}

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => makeFakeDb()),
}));

vi.mock("drizzle-orm", () => ({
  eq: () => () => true,
  and: () => () => true,
  gt: () => () => true,
  desc: () => () => true,
  inArray: () => () => true,
}));

vi.mock("../../drizzle/schema", () => ({
  aiPendingActions: { __table: "proposals", id: {}, userId: {}, status: {}, expiresAt: {}, createdAt: {} },
  aiInsights: { __table: "insights", id: {}, status: {}, machineCode: {}, createdAt: {} },
  machines: { __table: "machines", id: {}, code: {}, stationId: {} },
  stations: { __table: "stations", id: {}, lineId: {} },
  productionLines: { __table: "lines", id: {}, workshopId: {} },
  workshops: { __table: "workshops", id: {}, factoryId: {} },
  factories: { __table: "factories", id: {}, code: {} },
}));

import { listInbox, countInbox, dismissInboxItem, listAlerts } from "./aiActionInbox";

const NOW = Date.now();
const future = new Date(NOW + 5 * 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  data = {};
  getUserFactoryAssignments.mockResolvedValue([]);
  readMachineStatuses.mockResolvedValue({});
});

describe("listInbox — aggregation shape", () => {
  it("merges proposals + insights, severity-sorted, with per-item actions & token (admin)", async () => {
    data.proposals = [
      { id: "uuid-1", tool: "adjust_ng_threshold", summary: "Hạ ngưỡng NG 5%→4%", expiresAt: future, createdAt: new Date(NOW) },
    ];
    data.insights = [
      { id: 11, title: "Critical RCA", body: "b", severity: "critical", machineCode: "M5", recommendation: "do x", createdAt: new Date(NOW) },
      { id: 12, title: "Info", body: "b2", severity: "info", machineCode: "M6", recommendation: null, createdAt: new Date(NOW) },
    ];

    const { items } = await listInbox({ id: 1, role: "admin" });

    // critical insight first, then proposal (warning), then info insight.
    expect(items.map((i) => i.type)).toEqual(["insight", "proposal", "insight"]);
    expect(items[0].severity).toBe("critical");

    const proposal = items.find((i) => i.type === "proposal")!;
    expect(proposal.actions).toEqual(["approve", "dismiss", "ask"]);
    expect(proposal.token).toBe("uuid-1");
    expect(proposal.actionId).toBe("uuid-1");
    expect(proposal.tool).toBe("adjust_ng_threshold");
    expect(proposal.expiresAt).toBe(future.toISOString());

    const insight = items.find((i) => i.type === "insight")!;
    expect(insight.actions).toEqual(["view", "dismiss", "ask"]);
  });
});

describe("listInbox — per-user scoping", () => {
  it("non-admin with NO factory assignment sees only their own proposals (no insights)", async () => {
    data.proposals = [{ id: "p1", tool: "t", summary: "s", expiresAt: future, createdAt: new Date(NOW) }];
    data.insights = [{ id: 9, title: "x", body: "b", severity: "warning", machineCode: "M5", createdAt: new Date(NOW) }];
    // empty assignments → machineScope === [] → insights filtered out.
    getUserFactoryAssignments.mockResolvedValue([]);

    const { items } = await listInbox({ id: 2, role: "maintenance" });
    expect(items.map((i) => i.type)).toEqual(["proposal"]);
  });

  it("non-admin WITH a factory + machines sees insights for those machines", async () => {
    getUserFactoryAssignments.mockResolvedValue([{ factoryCode: "F1" }]);
    data.machines = [{ code: "M5" }]; // machineScope join result
    data.insights = [{ id: 9, title: "x", body: "b", severity: "warning", machineCode: "M5", createdAt: new Date(NOW) }];

    const { items } = await listInbox({ id: 2, role: "maintenance" });
    expect(items.some((i) => i.type === "insight" && i.machineCode === "M5")).toBe(true);
  });

  it("non-admin WITH machines sees an anomaly alert sourced from readMachineStatuses (the real source)", async () => {
    getUserFactoryAssignments.mockResolvedValue([{ factoryCode: "F1" }]);
    data.machines = [{ id: 5, code: "M5" }]; // machineScope join result, now carrying id.
    readMachineStatuses.mockResolvedValue({
      5: {
        hasData: true,
        latestScore: 0.91,
        latestThreshold: 0.5,
        isAnomaly: true,
        latestAt: new Date(NOW),
        recent: { windowCount: 10, anomalyCount: 3, anomalyRate: 0.3 },
      },
    });

    const { items } = await listInbox({ id: 2, role: "maintenance" });
    expect(readMachineStatuses).toHaveBeenCalledWith([5], null);
    const alert = items.find((i) => i.type === "alert");
    expect(alert).toBeDefined();
    expect(alert!.machineCode).toBe("M5");
    expect(alert!.severity).toBe("critical"); // score 0.91 ≥ 0.85
  });
});

describe("listAlerts — real anomaly source (readMachineStatuses from aiAnomalyRouter)", () => {
  it("returns the anomaly alert(s) from the real source (not [])", async () => {
    readMachineStatuses.mockResolvedValue({
      5: {
        hasData: true,
        latestScore: 0.9,
        latestThreshold: 0.4,
        isAnomaly: true,
        latestAt: new Date(NOW),
        recent: { windowCount: 5, anomalyCount: 1, anomalyRate: 0.2 },
      },
      6: { hasData: true, latestScore: 0.1, latestThreshold: 0.4, isAnomaly: false, latestAt: null, recent: { windowCount: 5, anomalyCount: 0, anomalyRate: 0 } },
    });

    const items = await listAlerts(
      [
        { id: 5, code: "M5" },
        { id: 6, code: "M6" },
      ],
      20,
    );

    expect(readMachineStatuses).toHaveBeenCalledWith([5, 6], null);
    expect(items).toHaveLength(1); // only M5 (isAnomaly=true); M6 is not anomalous.
    expect(items[0]).toMatchObject({ type: "alert", machineCode: "M5", severity: "critical" });
  });

  it("no machines in scope → [] without calling the source", async () => {
    expect(await listAlerts([], 20)).toEqual([]);
    expect(await listAlerts(null, 20)).toEqual([]);
    expect(readMachineStatuses).not.toHaveBeenCalled();
  });

  it("a thrown anomaly source → no anomaly alerts, no crash (fail-safe)", async () => {
    readMachineStatuses.mockRejectedValue(new Error("anomaly source boom"));
    const items = await listAlerts([{ id: 5, code: "M5" }], 20);
    expect(items).toEqual([]);
  });

  it("an empty anomaly source (no data for the machine) → no anomaly alerts, no crash", async () => {
    // Realistic shape: readMachineStatuses ALWAYS pre-populates every requested id with
    // emptyStatus() (aiAnomalyRouter.ts) — it never omits a key. hasData:false / isAnomaly:false
    // is the "no data yet" case, not an absent map entry.
    readMachineStatuses.mockResolvedValue({
      5: {
        hasData: false,
        latestScore: null,
        latestThreshold: null,
        isAnomaly: false,
        latestAt: null,
        recent: { windowCount: 0, anomalyCount: 0, anomalyRate: 0 },
      },
    });
    const items = await listAlerts([{ id: 5, code: "M5" }], 20);
    expect(items).toEqual([]);
  });
});

describe("countInbox", () => {
  it("returns proposals + in-scope insights count (admin)", async () => {
    data.proposals = [{ id: "a" }, { id: "b" }];
    data.insights = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { count } = await countInbox({ id: 1, role: "admin" });
    expect(count).toBe(5);
  });
});

describe("dismissInboxItem — never executes", () => {
  it("proposal → reuses the HITL cancel flow (no confirm/execute)", async () => {
    const res = await dismissInboxItem({ id: 1, role: "admin" }, "proposal", "uuid-1");
    expect(cancelAction).toHaveBeenCalledTimes(1);
    expect(confirmAction).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(res.status).toBe("cancelled");
  });

  it("insight → marks acknowledged (admin, no scope restriction)", async () => {
    data.insights = [{ id: 11, machineCode: "M5" }]; // for the lookup-by-id
    const res = await dismissInboxItem({ id: 1, role: "admin" }, "insight", "11");
    expect(res.ok).toBe(true);
    expect(res.status).toBe("acknowledged");
    expect(data.updated?.[0]).toMatchObject({ status: "acknowledged", acknowledgedBy: 1 });
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it("insight (non-admin) → scope INCLUDES the insight's machineCode → dismiss succeeds (row updated)", async () => {
    getUserFactoryAssignments.mockResolvedValue([{ factoryCode: "F1" }]);
    data.machines = [{ id: 5, code: "M5" }]; // non-admin's scope: only M5.
    data.insights = [{ id: 11, machineCode: "M5" }]; // insight IS on M5 → in scope.

    const res = await dismissInboxItem({ id: 2, role: "maintenance" }, "insight", "11");

    expect(res.ok).toBe(true);
    expect(res.status).toBe("acknowledged");
    expect(data.updated?.[0]).toMatchObject({ status: "acknowledged", acknowledgedBy: 2 });
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it("insight (non-admin) → scope EXCLUDES the insight's machineCode → rejected 'forbidden', no update fired", async () => {
    getUserFactoryAssignments.mockResolvedValue([{ factoryCode: "F1" }]);
    data.machines = [{ id: 5, code: "M5" }]; // non-admin's scope: only M5.
    data.insights = [{ id: 11, machineCode: "M6" }]; // insight is on M6 → NOT in scope.

    const res = await dismissInboxItem({ id: 2, role: "maintenance" }, "insight", "11");

    expect(res.ok).toBe(false);
    expect(res.status).toBe("forbidden");
    expect(data.updated).toBeUndefined(); // guard must block the write entirely.
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it("alert → transient no-op acknowledge", async () => {
    const res = await dismissInboxItem({ id: 1, role: "admin" }, "alert", "anomaly:M5");
    expect(res.ok).toBe(true);
    expect(res.status).toBe("dismissed");
  });
});
