/**
 * doc 80 Đợt 0 — Task 1 — ROUTER: ORC-06 (duplicate) + ORC-11 (orchestrationGov RBAC + module gate).
 *
 *   • ORC-06 `orchestration.duplicateWorkflow`: sàn GHI (`writeProcedure` — vai chỉ-đọc bị chặn) +
 *     `machine_control/canCreate`; bản sao tạo `draft` ⇒ `startRun` từ chối tới khi qua deploy.
 *   • ORC-11 `orchestrationGov.*`: MỌI thủ tục đi qua cổng module MOD_ENGINEERING +
 *     `machine_monitoring/canView` (trước đây `protectedProcedure` trần ⇒ IDOR nhật ký run).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";

const perm = vi.hoisted(() => ({ deny: new Set<string>(), calls: [] as string[] }));
const gate = vi.hoisted(() => ({ deny: new Set<string>(), calls: [] as string[] }));

function makeNe(col: { name: string }, value: unknown) {
  return (row: Record<string, unknown>) => row[col.name] !== value;
}
function makeInArray(col: { name: string }, values: unknown[]) {
  return (row: Record<string, unknown>) => values.includes(row[col.name]);
}
function makeNotInArray(col: { name: string }, values: unknown[]) {
  return (row: Record<string, unknown>) => !values.includes(row[col.name]);
}

const fake = new FakeDb();
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc, ne: makeNe, inArray: makeInArray, notInArray: makeNotInArray };
});
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

vi.mock("../_core/accessControl", () => ({
  requirePermission: (moduleName: string, action: string) => async ({ ctx, next }: any) => {
    perm.calls.push(`${moduleName}.${action}`);
    if (perm.deny.has(`${moduleName}.${action}`)) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: `no ${moduleName}.${action}` });
    }
    return next({ ctx });
  },
}));
vi.mock("../_core/moduleGate", async (orig) => {
  const actual = await orig<typeof import("../_core/moduleGate")>();
  return {
    ...actual,
    moduleGate: (code: string) => async ({ ctx, next }: any) => {
      gate.calls.push(code);
      if (gate.deny.has(code)) {
        const { TRPCError } = await import("@trpc/server");
        throw new TRPCError({ code: "FORBIDDEN", message: `module ${code} not licensed` });
      }
      return next({ ctx });
    },
  };
});

import { orchestrationWorkflows } from "../../drizzle/schema";
import { orchestrationRouter } from "./orchestrationRouter";
import { orchestrationGovRouter } from "./orchestrationGovRouter";
import { startRun } from "../services/orchestration/foe/foeEngine";

const ENGINEER = { id: 10, role: "engineer", name: "eng" };
const VIEWER = { id: 20, role: "viewer", name: "viewer" };
const ctxOf = (user: { id: number; role: string; name: string }) => ({ user }) as any;

function codeOf(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  perm.deny.clear();
  perm.calls.length = 0;
  gate.deny.clear();
  gate.calls.length = 0;
  process.env.FOE_ENABLED = "true";
  fake.seed(orchestrationWorkflows, [
    {
      id: 1,
      ref: "line-a",
      name: "Line A",
      version: 3,
      description: null,
      definitionJson: { ref: "line-a", name: "Line A", steps: [{ id: "d", type: "delay", ms: 1 }] },
      status: "active",
      createdBy: 10,
    },
  ]);
});

// ════════════════════════════════════════════════════════════════════════════════
// ORC-06 — duplicate
// ════════════════════════════════════════════════════════════════════════════════
describe("ORC-06 — duplicateWorkflow tạo bản NHÁP không chạy được", () => {
  it("bản sao có status `draft` (không phải `active`) và startRun từ chối nó", async () => {
    const res = await orchestrationRouter.createCaller(ctxOf(ENGINEER)).duplicateWorkflow({ id: 1, newRef: "line-a-copy" });
    expect(res.ok).toBe(true);
    const copy = (fake.store.get("orchestration_workflows") ?? []).find((w) => w.ref === "line-a-copy");
    expect(copy?.status).toBe("draft");
    expect(copy?.version).toBe(1);

    const run = await startRun("line-a-copy", {}, ENGINEER);
    expect(run.ok).toBe(false);
    expect(fake.store.get("orchestration_runs") ?? []).toHaveLength(0);
  });

  it("vai CHỈ-ĐỌC (viewer) bị chặn ở sàn ghi dù bit quyền cho qua", async () => {
    const err = await orchestrationRouter
      .createCaller(ctxOf(VIEWER))
      .duplicateWorkflow({ id: 1, newRef: "line-a-copy" })
      .catch((e) => e);
    expect(codeOf(err)).toBe("FORBIDDEN");
    expect((fake.store.get("orchestration_workflows") ?? []).some((w) => w.ref === "line-a-copy")).toBe(false);
  });

  it("thiếu machine_control/canCreate ⇒ FORBIDDEN; và cổng module MOD_ENGINEERING được áp", async () => {
    perm.deny.add("machine_control.canCreate");
    const err = await orchestrationRouter
      .createCaller(ctxOf(ENGINEER))
      .duplicateWorkflow({ id: 1, newRef: "line-a-copy" })
      .catch((e) => e);
    expect(codeOf(err)).toBe("FORBIDDEN");
    expect(gate.calls).toContain("MOD_ENGINEERING");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// ORC-11 — orchestrationGov RBAC + module gate
// ════════════════════════════════════════════════════════════════════════════════
describe("ORC-11 — orchestrationGov: mọi thủ tục có RBAC đọc + cổng module", () => {
  const CALLS: Array<[string, (c: ReturnType<typeof orchestrationGovRouter.createCaller>) => Promise<unknown>]> = [
    ["validateDag", (c) => c.validateDag({ nodes: [{ id: "a", deps: [] }] })],
    ["orderQueue", (c) => c.orderQueue({ now: 1, tasks: [{ id: "t", priority: 1, createdTs: 0 }] })],
    ["fourEyesCheck", (c) => c.fourEyesCheck({ context: { action: "x" } })],
    ["runEvents", (c) => c.runEvents({ runId: 1 })],
    ["replayRun", (c) => c.replayRun({ runId: 1 })],
  ];

  it.each(CALLS)("%s — thiếu machine_monitoring/canView ⇒ FORBIDDEN", async (_name, call) => {
    perm.deny.add("machine_monitoring.canView");
    const err = await call(orchestrationGovRouter.createCaller(ctxOf(ENGINEER))).catch((e) => e);
    expect(codeOf(err)).toBe("FORBIDDEN");
  });

  it.each(CALLS)("%s — module MOD_ENGINEERING không có giấy phép ⇒ FORBIDDEN", async (_name, call) => {
    gate.deny.add("MOD_ENGINEERING");
    const err = await call(orchestrationGovRouter.createCaller(ctxOf(ENGINEER))).catch((e) => e);
    expect(codeOf(err)).toBe("FORBIDDEN");
  });

  it("có quyền ⇒ chạy bình thường và kiểm đúng machine_monitoring/canView", async () => {
    const c = orchestrationGovRouter.createCaller(ctxOf(ENGINEER));
    const r = await c.validateDag({ nodes: [{ id: "a", deps: [] }, { id: "b", deps: ["a"] }] });
    expect((r as { valid: boolean }).valid).toBe(true);
    expect(perm.calls).toContain("machine_monitoring.canView");
  });
});
