// @vitest-environment jsdom
//
// doc 80 Đợt 1 Task 4 — X-01 (badge SEED trên run orchestration) + ORC-13 (run hiện rõ
// DRY-RUN khi lệnh chỉ được mô phỏng). Dựng trang THẬT, chỉ mock hạ tầng nặng.
//
// ORACLE ĐỘC LẬP: SEEDED_RUN_IDS khai tay cùng fixture (contextJson.seed=true — như 6/6 run
// trên DB dev), không suy bằng hàm gắn nhãn đang bị kiểm.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
// doc 81 Đợt 2 Task 11 — HẠ TẦNG: trang nay dựng WorkbenchShell (react-resizable-panels). Separator của thư viện
// nuốt cú bấm trong jsdom (rect 0×0 tại điểm bấm) ⇒ ô nhập không nhận chữ — shim dời riêng separator ra xa.
import { installResizeHandleHitAreaShim } from "@/components/patterns/layoutKitTestPanels";
// final wave T11 — bản BROWSER của react-resizable-panels như mọi test trang dựng WorkbenchShell (dispatch-common):
// thiếu dòng này thư viện in 10× "Panel size not found" ra stderr.
vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());

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
  // final wave T11 — hằng số trang đọc khi kéo-thả bước (dragstart); thiếu thì test kéo-thả sau này ném lỗi.
  WF_DND_MIME: "application/x-wf-step-kind",
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
// doc 80 Đợt 1 Task 9 — một spy mutate CỐ ĐỊNH theo thủ tục (đọc được đối số người dùng gửi).
const mutateSpies: Record<string, ReturnType<typeof vi.fn>> = {};
// doc 80 Đợt 1 Task 11 — bắt `onSuccess`/`onError` của MỖI mutation (khuôn
// InterlockRuleManagement.dom.test.tsx) để gọi lại thủ công, kiểm toast render bằng t()
// thay vì message thô của server.
interface MutationOpts { onSuccess?: (...a: unknown[]) => void; onError?: (e: unknown) => void }
const mutationOpts: Record<string, MutationOpts> = {};
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
                useMutation: (opts: MutationOpts = {}) => {
                  mutationOpts[key] = opts;
                  return { mutate: (mutateSpies[key] ??= vi.fn()), mutateAsync: vi.fn(), isPending: false };
                },
              };
            },
          },
        );
      },
    },
  ),
}));

import OrchestrationStudio from "./OrchestrationStudio";

function run(id: number, ref: string, contextJson: Record<string, unknown>, dispatch: { mode: string; simulated: number; live: number; unconfirmed: number }) {
  return {
    id, workflowId: 1, workflowRef: ref, status: "completed", paramsJson: {}, contextJson,
    currentStepId: null, edgeNodeId: null, startedBy: 1, startedAt: null, finishedAt: null, error: null,
    createdAt: `2026-09-2${id % 10}T00:00:00.000Z`, updatedAt: "2026-09-27T00:00:00.000Z", dispatch,
  };
}
const RUNS = [
  run(7, "Line-a-startup", { gate: "passed", seed: true }, { mode: "none", simulated: 0, live: 0, unconfirmed: 0 }),
  run(8, "qt-1-order-production", { gate: "blocked", seed: true }, { mode: "none", simulated: 0, live: 0, unconfirmed: 0 }),
  run(20, "line-b-changeover", {}, { mode: "simulated", simulated: 2, live: 0, unconfirmed: 0 }),
  run(21, "line-c-startup", {}, { mode: "live", simulated: 0, live: 3, unconfirmed: 0 }),
  run(22, "line-d-mixed", {}, { mode: "mixed", simulated: 1, live: 1, unconfirmed: 0 }),
];
const SEEDED_RUN_IDS = new Set([7, 8]);

beforeAll(() => {
  installResizeHandleHitAreaShim();
});
beforeEach(() => {
  for (const k of Object.keys(queryOverrides)) delete queryOverrides[k];
  for (const k of Object.keys(mutateSpies)) delete mutateSpies[k];
  for (const k of Object.keys(mutationOpts)) delete mutationOpts[k];
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

describe("OrchestrationStudio — Fix round 1: failed/timeout là 'chưa xác nhận', chỉ rejected là 'không gửi'", () => {
  it("drawer: timeout ⇒ unconfirmed (có thể đã tới thiết bị), rejected ⇒ not sent", async () => {
    setQueryOverride(
      "orchestration.getRun",
      makeQuery({
        data: {
          run: RUNS[2],
          steps: [
            { stepId: "s1", stepType: "command", status: "failed", attempt: 1, result: { routedTo: "ot-dispatcher", status: "timeout", accepted: false, simulated: false } },
            { stepId: "s2", stepType: "command", status: "failed", attempt: 1, result: { routedTo: "ot-dispatcher", status: "rejected", accepted: false, simulated: false } },
          ],
        },
      }),
    );
    render(<OrchestrationStudio />);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(screen.getByText(/run #20 ·/));
    const tags = Array.from(rowOf(20).querySelectorAll('[data-testid="step-dispatch"]'));
    expect(tags.map((t) => t.getAttribute("data-kind"))).toEqual(["unconfirmed", "rejected"]);
    expect(tags[0].textContent).toMatch(/unconfirmed — may have reached the device/);
    expect(tags[0].textContent).not.toMatch(/not sent/);
    expect(tags[1].textContent).toMatch(/not sent/);
  });
});

describe("OrchestrationStudio — doc 81 Đợt 4 Task A5: bước dừng FOE_GATE_REQUIRED nói rõ phải làm gì", () => {
  it("bước lệnh có lỗi FOE_GATE_REQUIRED ⇒ dòng giải thích (studio.gateRequired); bước lỗi khác ⇒ không có dòng ấy", async () => {
    setQueryOverride(
      "orchestration.getRun",
      makeQuery({
        data: {
          run: RUNS[2],
          steps: [
            { stepId: "w1", stepType: "command", status: "failed", attempt: 1, result: null, error: 'FOE_GATE_REQUIRED: command step "w1" needs an earlier approval gate' },
            { stepId: "w2", stepType: "command", status: "failed", attempt: 1, result: null, error: "POLICY_DENIED: no" },
          ],
        },
      }),
    );
    render(<OrchestrationStudio />);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(screen.getByText(/run #20 ·/));
    const notes = rowOf(20).querySelectorAll('[data-testid="step-gate-required"]');
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toMatch(/approval gate earlier in the run, approved by someone other than the person who started it/);
    expect(notes[0].closest("div")?.textContent).toMatch(/w1/);
  });
});

describe("OrchestrationStudio — Task 9: duyệt/từ chối gửi GATE đang hiển thị (expectedStepId)", () => {
  // ORACLE khai tay: hàng danh sách còn ghi gate cũ, chi tiết (khối "Bước đang chờ") ghi gate mới —
  // thứ người duyệt NHÌN THẤY là khối chi tiết ⇒ đó là gate phải được gửi.
  const AWAITING = { ...run(30, "gate-flow", {}, { mode: "none", simulated: 0, live: 0, unconfirmed: 0 }), status: "awaiting_confirm", currentStepId: "g-list" };

  it("Approve ⇒ resumeRun.mutate({ runId, approved:true, expectedStepId: gate của khối 'Bước đang chờ' })", async () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride(
      "orchestration.getRun",
      makeQuery({ data: { run: { ...AWAITING, currentStepId: "g-detail" }, steps: [{ stepId: "g-detail", stepType: "hitl_gate", status: "awaiting_confirm", attempt: 0, result: { prompt: "Duyệt?" } }] } }),
    );
    render(<OrchestrationStudio />);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(within(rowOf(30)).getByRole("button", { name: /^(Approve|studio\.approve)$/i }));
    expect(mutateSpies["orchestration.resumeRun"]).toHaveBeenCalledWith({ runId: 30, approved: true, note: undefined, expectedStepId: "g-detail" });
  });

  it("Reject (kèm lý do) ⇒ gửi cùng gate đang hiển thị", async () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride(
      "orchestration.getRun",
      makeQuery({ data: { run: { ...AWAITING, currentStepId: "g-detail" }, steps: [] } }),
    );
    render(<OrchestrationStudio />);
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    await user.click(within(rowOf(30)).getByRole("button", { name: /^(Reject|studio\.reject)$/i }));
    await user.type(within(rowOf(30)).getByRole("textbox"), "sai");
    await user.click(within(rowOf(30)).getByRole("button", { name: /Xác nhận từ chối|confirm reject|studio\.confirmReject/i }));
    expect(mutateSpies["orchestration.resumeRun"]).toHaveBeenCalledWith({ runId: 30, approved: false, note: "sai", expectedStepId: "g-detail" });
  });

  it("chi tiết chưa nạp ⇒ dùng gate trên hàng danh sách (không bao giờ gửi thiếu)", async () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride("orchestration.getRun", makeQuery({ data: undefined }));
    render(<OrchestrationStudio />);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(within(rowOf(30)).getByRole("button", { name: /^(Approve|studio\.approve)$/i }));
    expect(mutateSpies["orchestration.resumeRun"]).toHaveBeenCalledWith({ runId: 30, approved: true, note: undefined, expectedStepId: "g-list" });
  });
});

describe("OrchestrationStudio — Task 11: toast từ chối 'draft' dùng t() thay message thô của server", () => {
  it("startRun ok:false + workflowStatus (ORC-06 draft/archived) ⇒ toast dịch, KHÔNG hiện nguyên văn message server", async () => {
    const { toast } = await import("sonner");
    render(<OrchestrationStudio />);
    const rawServerMessage = 'Workflow "line-a-startup" is draft — deploy it before running.';
    mutationOpts["orchestration.startRun"]!.onSuccess?.({
      ok: false,
      enabled: true,
      runId: undefined,
      workflowStatus: "draft",
      message: rawServerMessage,
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    const shown = (toast.error as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    // KHÔNG được là message thô của server (mục tiêu của Task 11).
    expect(shown).not.toBe(rawServerMessage);
    // Phải là bản dịch qua t() — hoặc khoá i18n thô (môi trường test chưa nạp resource) hoặc
    // default value đã nội suy {{status}} → chứa "draft" (cùng quy ước regex nới lỏng đã dùng
    // ở các ca Task 9 phía trên: `/^(Approve|studio\.approve)$/i`).
    expect(shown).toMatch(/studio\.runNotDeployed|draft/i);
  });

  it("startRun ok:false KHÔNG có workflowStatus (lỗi khác, vd not found) ⇒ vẫn hiện message của server (hành vi CŨ giữ nguyên)", async () => {
    const { toast } = await import("sonner");
    render(<OrchestrationStudio />);
    const rawServerMessage = 'Workflow "line-a-startup" not found.';
    mutationOpts["orchestration.startRun"]!.onSuccess?.({
      ok: false,
      enabled: true,
      runId: undefined,
      message: rawServerMessage,
    });
    expect(toast.error).toHaveBeenCalledWith(rawServerMessage);
  });
});
