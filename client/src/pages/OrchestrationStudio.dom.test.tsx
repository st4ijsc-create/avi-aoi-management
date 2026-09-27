// @vitest-environment jsdom
//
// doc 80 Đợt 1 Task 4 — X-01 (badge SEED trên run orchestration) + ORC-13 (run hiện rõ
// DRY-RUN khi lệnh chỉ được mô phỏng). Dựng trang THẬT, chỉ mock hạ tầng nặng.
//
// ORACLE ĐỘC LẬP: SEEDED_RUN_IDS khai tay cùng fixture (contextJson.seed=true — như 6/6 run
// trên DB dev), không suy bằng hàm gắn nhãn đang bị kiểm.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
// Canvas sơ đồ (xyflow) không cần cho danh sách run.
vi.mock("@/components/orchestration/WorkflowGraphCanvas", () => ({
  WorkflowGraphCanvas: () => null,
}));

interface QueryResult {
  data: unknown;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  dataUpdatedAt: number | undefined;
  refetch: () => void;
}
function makeQuery(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    dataUpdatedAt: undefined,
    refetch: vi.fn(),
    ...overrides,
  };
}
const queryOverrides: Record<string, () => QueryResult> = {};
function setQueryOverride(key: string, result: QueryResult) {
  queryOverrides[key] = () => result;
}
function chainable(): unknown {
  const fn = (..._args: unknown[]) => undefined;
  return new Proxy(fn, { get: () => chainable(), apply: () => undefined });
}
vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy(
    {},
    {
      get(_t, routerName: string) {
        if (routerName === "useUtils") return () => chainable();
        return new Proxy(
          {},
          {
            get(_t2, procName: string) {
              const key = `${routerName}.${procName}`;
              return {
                useQuery: () => (queryOverrides[key] ? queryOverrides[key]() : makeQuery()),
                useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
              };
            },
          },
        );
      },
    },
  ),
}));

import OrchestrationStudio from "./OrchestrationStudio";

function run(id: number, ref: string, contextJson: Record<string, unknown>, dispatch: { mode: string; simulated: number; live: number }) {
  return {
    id, workflowId: 1, workflowRef: ref, status: "completed", paramsJson: {}, contextJson,
    currentStepId: null, edgeNodeId: null, startedBy: 1, startedAt: null, finishedAt: null, error: null,
    createdAt: `2026-09-2${id % 10}T00:00:00.000Z`, updatedAt: "2026-09-27T00:00:00.000Z", dispatch,
  };
}
const RUNS = [
  run(7, "Line-a-startup", { gate: "passed", seed: true }, { mode: "none", simulated: 0, live: 0 }),
  run(8, "qt-1-order-production", { gate: "blocked", seed: true }, { mode: "none", simulated: 0, live: 0 }),
  run(20, "line-b-changeover", {}, { mode: "simulated", simulated: 2, live: 0 }),
  run(21, "line-c-startup", {}, { mode: "live", simulated: 0, live: 3 }),
  run(22, "line-d-mixed", {}, { mode: "mixed", simulated: 1, live: 1 }),
];
const SEEDED_RUN_IDS = new Set([7, 8]);

beforeEach(() => {
  for (const k of Object.keys(queryOverrides)) delete queryOverrides[k];
  setQueryOverride("orchestration.listRuns", makeQuery({ data: RUNS }));
});
afterEach(() => cleanup());

const rowOf = (id: number) => screen.getByText(new RegExp(`run #${id} ·`)).closest("[data-run-row]") as HTMLElement;

describe("OrchestrationStudio — Task 4: nhãn nguồn + DRY-RUN trên run", () => {
  it("dải tóm tắt '2/5 hàng là dữ liệu demo/seed'", () => {
    render(<OrchestrationStudio />);
    const s = screen.getByTestId("provenance-summary");
    expect(s).toHaveAttribute("data-count", "2");
    expect(s).toHaveAttribute("data-total", "5");
  });

  it("BẤT BIẾN: mọi run seed có badge SEED, run thật không", () => {
    render(<OrchestrationStudio />);
    for (const r of RUNS) {
      const row = rowOf(r.id);
      expect(row, `run #${r.id}`).not.toBeNull();
      const badge = row.querySelector('[data-testid="provenance-badge"]');
      if (SEEDED_RUN_IDS.has(r.id)) {
        expect(badge, `run seed #${r.id} THIẾU badge`).not.toBeNull();
        expect(badge!.getAttribute("data-provenance")).toBe("SEED");
      } else {
        expect(badge, `run thật #${r.id} bị gắn nhầm`).toBeNull();
      }
    }
  });

  it("ORC-13: run mô phỏng hiện DRY-RUN, run lẫn hiện badge riêng, run thật hiện LIVE, run không có lệnh không hiện gì", () => {
    render(<OrchestrationStudio />);
    const mode = (id: number) => rowOf(id).querySelector('[data-testid="dispatch-mode"]')?.getAttribute("data-mode") ?? null;
    expect(mode(20)).toBe("simulated");
    expect(rowOf(20).querySelector('[data-testid="dispatch-mode"]')?.textContent).toMatch(/DRY-RUN/);
    expect(mode(22)).toBe("mixed");
    expect(mode(21)).toBe("live");
    expect(mode(7)).toBeNull();
  });
});

describe("OrchestrationStudio — ORC-13: drawer bước hiện routedTo + mô phỏng/đã gửi", () => {
  it("mở run ⇒ mỗi bước lệnh mang tag (ot-dispatcher · simulated), bước gate không có tag", async () => {
    setQueryOverride(
      "orchestration.getRun",
      makeQuery({
        data: {
          run: RUNS[2],
          steps: [
            { stepId: "s1", stepType: "command", status: "completed", attempt: 1, result: { routedTo: "ot-dispatcher", status: "simulated", accepted: true, simulated: true } },
            { stepId: "s2", stepType: "hitl_gate", status: "completed", attempt: 1, result: { ok: true } },
            { stepId: "s3", stepType: "command", status: "completed", attempt: 1, result: { routedTo: "robot-dispatcher", status: "done", accepted: true } },
          ],
        },
      }),
    );
    render(<OrchestrationStudio />);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(screen.getByText(/run #20 ·/));
    const tags = rowOf(20).querySelectorAll('[data-testid="step-dispatch"]');
    expect(Array.from(tags).map((t) => t.getAttribute("data-kind"))).toEqual(["simulated", "live"]);
    expect(tags[0].textContent).toMatch(/ot-dispatcher/);
    expect(tags[0].textContent).toMatch(/simulated/);
  });
});
