/**
 * S1-a (doc 16 Khối 3) — Mixed-workforce + handover tests.
 *
 * Layers:
 *   • PURE: overlaps(), assembleBoard(), collaboration nextPhase/canAdvance — no DB.
 *   • DB-FLOW (in-memory fake db keyed on the REAL drizzle column .name): assignment
 *     conflict (double-book rejected), skill-mismatch warning, confirm/close,
 *     current-board assembly, handover state-machine transitions, flag-off no-ops.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", __k: col?.name, __v: val }),
  and: (...ps: any[]) => ({ __op: "and", __ps: ps.filter(Boolean) }),
  inArray: (col: any, vals: any[]) => ({ __op: "inArray", __k: col?.name, __vals: vals }),
  desc: (col: any) => ({ __desc: col?.name }),
  asc: (col: any) => ({ __asc: col?.name }),
  sql: () => ({}),
}));

type Row = Record<string, any>;
const store: Record<string, Row[]> = { operator_assignments: [], user_certifications: [], collaboration_sessions: [], robots: [], tasks: [], control_audit_log: [] };
const seq: Record<string, number> = {};
function nextId(t: string): number { seq[t] = (seq[t] ?? 0) + 1; return seq[t]; }
function reset() { for (const k of Object.keys(store)) store[k] = []; for (const k of Object.keys(seq)) seq[k] = 0; }

function tableName(t: any): string {
  const sym = Object.getOwnPropertySymbols(t).find((s) => String(s).includes("Name"));
  return sym ? (t as any)[sym] : t?._?.name;
}
function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__op === "and") return pred.__ps.every((p: any) => matches(row, p));
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  if (pred.__op === "inArray") return pred.__vals.includes(row[pred.__k]);
  return true;
}
function makeFakeDb() {
  const select = () => ({
    from: (t: any) => {
      const name = tableName(t);
      let pred: any = null; let order: any = null;
      const q: any = {
        where: (p: any) => { pred = p; return q; },
        orderBy: (o: any) => { order = o; return q; },
        limit: async (n: number) => run().slice(0, n),
        then: (resolve: any) => resolve(run()),
      };
      function run(): Row[] {
        let rows = (store[name] ?? []).filter((r) => matches(r, pred));
        if (order?.__desc) rows = [...rows].sort((a, b) => (b[order.__desc] ?? 0) - (a[order.__desc] ?? 0));
        return rows;
      }
      return q;
    },
  });
  return {
    select,
    insert: (t: any) => ({
      values: (vals: Row | Row[]) => {
        const name = tableName(t);
        const arr = Array.isArray(vals) ? vals : [vals];
        const inserted = arr.map((v) => { const row = { id: nextId(name), ...v }; store[name].push(row); return row; });
        const ret: any = { returning: async () => inserted };
        ret.then = (resolve: any) => resolve(inserted);
        return ret;
      },
    }),
    update: (t: any) => ({
      set: (vals: Row) => {
        const name = tableName(t);
        const apply = (pred: any) => { for (const r of (store[name] ?? []).filter((row) => matches(row, pred))) Object.assign(r, vals); };
        const w: any = { where: (pred: any) => { apply(pred); return { returning: async () => (store[name] ?? []).filter((row) => matches(row, pred)) }; } };
        return w;
      },
    }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: async () => makeFakeDb() }));

import { overlaps, assembleBoard, assignOperator, reassignOperator, confirmAssignment, closeAssignment, getCurrentBoard, type BoardHuman } from "./workforceService";
import { nextPhase, canAdvance, startCollaboration, signalHandshake, advancePhase, abortCollaboration } from "./collaborationService";

beforeEach(() => { reset(); delete process.env.WORKFORCE_ENABLED; });

// ════════════════════════════════════════════════════════════════════════════
// PURE
// ════════════════════════════════════════════════════════════════════════════
describe("overlaps (PURE)", () => {
  const d = (h: number) => new Date(2026, 5, 30, h);
  it("detects an overlapping window", () => {
    expect(overlaps(d(8), d(16), d(12), d(20))).toBe(true);
  });
  it("treats touching windows as non-overlapping (half-open)", () => {
    expect(overlaps(d(8), d(12), d(12), d(16))).toBe(false);
  });
  it("open-ended (null end) overlaps a later window", () => {
    expect(overlaps(d(8), null, d(20), d(22))).toBe(true);
  });
});

describe("assembleBoard (PURE)", () => {
  it("groups humans + robots per station", () => {
    const humans: BoardHuman[] = [
      { kind: "human", assignmentId: 1, operatorId: 5, lineId: 1, stationId: 10, skillLevel: "qualified", status: "active" },
    ];
    const board = assembleBoard(humans, [
      { id: 7, code: "R7", lineId: 1, stationId: 10, status: "idle", openTaskCount: 2 },
      { id: 8, code: "R8", lineId: 1, stationId: 11, status: "busy", openTaskCount: 0 },
    ]);
    const s10 = board.find((b) => b.stationId === 10)!;
    expect(s10.humans).toHaveLength(1);
    expect(s10.robots).toHaveLength(1);
    expect(s10.robots[0].openTaskCount).toBe(2);
    const s11 = board.find((b) => b.stationId === 11)!;
    expect(s11.humans).toHaveLength(0);
    expect(s11.robots).toHaveLength(1);
  });
});

describe("collaboration state machine (PURE)", () => {
  it("nextPhase walks forward and clamps at done", () => {
    expect(nextPhase("human_prep")).toBe("robot_work");
    expect(nextPhase("robot_work")).toBe("human_verify");
    expect(nextPhase("human_verify")).toBe("done");
    expect(nextPhase("done")).toBe("done");
  });
  it("canAdvance only when handshake is clear and not done", () => {
    expect(canAdvance("human_prep", "pending")).toBe(false);
    expect(canAdvance("human_prep", "clear")).toBe(true);
    expect(canAdvance("done", "clear")).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-FLOW — assignments
// ════════════════════════════════════════════════════════════════════════════
describe("assignOperator (flag-gated, conflict + skill)", () => {
  const d = (h: number) => new Date(2026, 5, 30, h);

  it("flag OFF → no-op", async () => {
    const r = await assignOperator({ operatorId: 5, assignedStart: d(8), assignedEnd: d(16) });
    expect(r.enabled).toBe(false);
    expect(store.operator_assignments).toHaveLength(0);
  });

  it("flag ON → creates a planned assignment", async () => {
    process.env.WORKFORCE_ENABLED = "true";
    const r = await assignOperator({ operatorId: 5, stationId: 10, assignedStart: d(8), assignedEnd: d(16) });
    expect(r.ok).toBe(true);
    expect(r.assignment?.status).toBe("planned");
    expect(store.operator_assignments).toHaveLength(1);
  });

  it("rejects a double-booking on an overlapping window", async () => {
    process.env.WORKFORCE_ENABLED = "true";
    await assignOperator({ operatorId: 5, assignedStart: d(8), assignedEnd: d(16) });
    const clash = await assignOperator({ operatorId: 5, assignedStart: d(12), assignedEnd: d(20) });
    expect(clash.ok).toBe(false);
    expect(clash.conflict).toBeDefined();
    expect(store.operator_assignments).toHaveLength(1); // not double-created
  });

  it("allows a non-overlapping second assignment", async () => {
    process.env.WORKFORCE_ENABLED = "true";
    await assignOperator({ operatorId: 5, assignedStart: d(8), assignedEnd: d(12) });
    const ok = await assignOperator({ operatorId: 5, assignedStart: d(12), assignedEnd: d(16) });
    expect(ok.ok).toBe(true);
    expect(store.operator_assignments).toHaveLength(2);
  });

  it("WARNS (not blocks) when the operator lacks an active certification", async () => {
    process.env.WORKFORCE_ENABLED = "true";
    // operator 5 has NO cert for skill 99
    const r = await assignOperator({ operatorId: 5, stationId: 10, requiredSkillId: 99, assignedStart: d(8), assignedEnd: d(16) });
    expect(r.ok).toBe(true);
    expect(r.skillWarning).toMatch(/no active certification/);
  });

  it("no warning when the operator holds a valid certification", async () => {
    process.env.WORKFORCE_ENABLED = "true";
    store.user_certifications.push({ id: 1, userId: 5, skillId: 99, isActive: true, expiresAt: null });
    const r = await assignOperator({ operatorId: 5, requiredSkillId: 99, assignedStart: d(8), assignedEnd: d(16) });
    expect(r.ok).toBe(true);
    expect(r.skillWarning).toBeUndefined();
  });

  it("confirm → active, close → completed (flag ON)", async () => {
    process.env.WORKFORCE_ENABLED = "true";
    const r = await assignOperator({ operatorId: 5, assignedStart: d(8), assignedEnd: d(16) });
    const id = r.assignment!.id;
    const confirmed = await confirmAssignment(id, 99);
    expect(confirmed?.status).toBe("active");
    expect(confirmed?.confirmedBy).toBe(99);
    const closed = await closeAssignment(id, 77);
    expect(closed?.status).toBe("completed");
    expect(closed?.closedBy).toBe(77);
    // Đúng 1 dòng audit close với actor/before/after.
    const audits = store.control_audit_log.filter((a) => a.action === "close");
    expect(audits).toHaveLength(1);
    expect(audits[0].entityType).toBe("operator_assignment");
    expect(audits[0].entityId).toBe(String(id));
    expect(audits[0].actorId).toBe(77);
    expect(audits[0].beforeJson.status).toBe("active");
    expect(audits[0].afterJson.status).toBe("completed");
  });

  it("reassign cancels the old + creates a new one", async () => {
    process.env.WORKFORCE_ENABLED = "true";
    const first = await assignOperator({ operatorId: 5, stationId: 10, assignedStart: d(8), assignedEnd: d(12) });
    const r = await reassignOperator(first.assignment!.id, { operatorId: 5, stationId: 11, assignedStart: d(12), assignedEnd: d(16) });
    expect(r.ok).toBe(true);
    const old = store.operator_assignments.find((a) => a.id === first.assignment!.id);
    expect(old?.status).toBe("cancelled");
    expect(store.operator_assignments.filter((a) => a.status === "planned")).toHaveLength(1);
  });
});

describe("getCurrentBoard (humans + robots)", () => {
  it("assembles active humans and enabled robots with open-task counts", async () => {
    process.env.WORKFORCE_ENABLED = "true";
    store.operator_assignments.push({ id: 1, operatorId: 5, lineId: 1, stationId: 10, skillLevel: "expert", status: "active", assignedStart: new Date() });
    store.robots.push({ id: 7, code: "R7", lineId: 1, stationId: 10, status: "idle", isEnabled: true });
    store.tasks.push({ id: 1, assignedDeviceId: 7, status: "running" });
    const board = await getCurrentBoard();
    const s10 = board.find((b) => b.stationId === 10)!;
    expect(s10.humans[0].operatorId).toBe(5);
    expect(s10.robots[0].robotId).toBe(7);
    expect(s10.robots[0].openTaskCount).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-FLOW — handover handshake
// ════════════════════════════════════════════════════════════════════════════
describe("collaboration handover (flag-gated)", () => {
  it("flag OFF → start is a no-op", async () => {
    const r = await startCollaboration({ taskId: 1 });
    expect(r.enabled).toBe(false);
    expect(store.collaboration_sessions).toHaveLength(0);
  });

  it("flag ON → full forward walk requires a clear handshake at each phase", async () => {
    process.env.WORKFORCE_ENABLED = "true";
    const r = await startCollaboration({ taskId: 1, humanOperatorId: 5, robotDeviceId: 7 });
    const id = r.session!.id;
    // cannot advance while pending
    let adv = await advancePhase(id);
    expect(adv.ok).toBe(false);
    expect(adv.reason).toMatch(/not clear/);
    // signal clear → advance to robot_work
    await signalHandshake(id, "clear");
    adv = await advancePhase(id);
    expect(adv.ok).toBe(true);
    expect(adv.session?.phase).toBe("robot_work");
    expect(adv.session?.handshakeState).toBe("pending"); // reset for new phase
    // walk to done
    await signalHandshake(id, "clear");
    await advancePhase(id); // → human_verify
    await signalHandshake(id, "clear");
    const last = await advancePhase(id); // → done
    expect(last.session?.phase).toBe("done");
    expect(last.session?.endedAt).toBeTruthy();
  });

  it("abort jumps straight to done", async () => {
    process.env.WORKFORCE_ENABLED = "true";
    const r = await startCollaboration({ taskId: 2 });
    const aborted = await abortCollaboration(r.session!.id, "operator cancelled", 88);
    expect(aborted?.phase).toBe("done");
    expect(aborted?.notes).toBe("operator cancelled");
    expect(aborted?.abortedBy).toBe(88);
    // Đúng 1 dòng audit abort với actor/reason/before/after.
    const audits = store.control_audit_log.filter((a) => a.action === "abort");
    expect(audits).toHaveLength(1);
    expect(audits[0].entityType).toBe("collaboration_session");
    expect(audits[0].actorId).toBe(88);
    expect(audits[0].reason).toBe("operator cancelled");
    expect(audits[0].beforeJson.phase).not.toBe("done");
    expect(audits[0].afterJson.phase).toBe("done");
  });
});
