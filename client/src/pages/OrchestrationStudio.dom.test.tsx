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

describe("OrchestrationStudio — doc 81 Đợt 4 Task A5 + fix round 1: bước dừng FOE_GATE_REQUIRED nói rõ VÌ SAO và phải làm gì", () => {
  it("mỗi lý do một câu riêng (không gate / chủ run tự duyệt / duyệt cũ sau redeploy / không rõ chủ); lỗi khác ⇒ không có dòng ấy", async () => {
    setQueryOverride(
      "orchestration.getRun",
      makeQuery({
        data: {
          run: RUNS[2],
          steps: [
            { stepId: "w1", stepType: "command", status: "failed", attempt: 1, result: null, error: 'FOE_GATE_REQUIRED(noGate): command step "w1" was not sent' },
            { stepId: "w2", stepType: "command", status: "failed", attempt: 1, result: null, error: 'FOE_GATE_REQUIRED(approvedByOwner): command step "w2" was not sent' },
            { stepId: "w3", stepType: "command", status: "failed", attempt: 1, result: null, error: 'FOE_GATE_REQUIRED(staleApproval): command step "w3" was not sent' },
            { stepId: "w4", stepType: "command", status: "failed", attempt: 1, result: null, error: 'FOE_GATE_REQUIRED(ownerUnknown): command step "w4" was not sent' },
            { stepId: "w5", stepType: "command", status: "failed", attempt: 1, result: null, error: 'FOE_GATE_REQUIRED: legacy shape' },
            { stepId: "w6", stepType: "command", status: "failed", attempt: 1, result: null, error: "POLICY_DENIED: no" },
          ],
        },
      }),
    );
    render(<OrchestrationStudio />);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(screen.getByText(/run #20 ·/));
    const notes = Array.from(rowOf(20).querySelectorAll('[data-testid="step-gate-required"]'));
    expect(notes.map((n) => n.getAttribute("data-reason"))).toEqual(["noGate", "approvedByOwner", "staleApproval", "ownerUnknown", "noGate"]);
    expect(notes[0].textContent).toMatch(/approval gate earlier in the run, approved by someone other than the person who started it/);
    expect(notes[1].textContent).toMatch(/approved by the person who started the run, which does not count/);
    expect(notes[2].textContent).toMatch(/workflow was redeployed or the adapter, tag or robot configuration its commands use was changed/); // Đợt 5 E3
    expect(notes[3].textContent).toMatch(/no known owner/);
    expect(new Set(notes.slice(0, 4).map((n) => n.textContent)).size).toBe(4);
  });
});

describe("OrchestrationStudio — doc 81 Đợt 5 task E1: bước của lượt chạy khởi động bằng khoá API (apiRun) có câu riêng", () => {
  it("FOE_GATE_REQUIRED(apiRun) ⇒ data-reason apiRun + câu 'started through an API key' (khác câu noGate)", async () => {
    setQueryOverride(
      "orchestration.getRun",
      makeQuery({
        data: {
          run: RUNS[2],
          steps: [
            { stepId: "a1", stepType: "command", status: "failed", attempt: 1, result: null, error: 'FOE_GATE_REQUIRED(apiRun): command step "a1" was not sent' },
            { stepId: "a2", stepType: "command", status: "failed", attempt: 1, result: null, error: 'FOE_GATE_REQUIRED(noGate): command step "a2" was not sent' },
          ],
        },
      }),
    );
    render(<OrchestrationStudio />);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(screen.getByText(/run #20 ·/));
    const notes = Array.from(rowOf(20).querySelectorAll('[data-testid="step-gate-required"]'));
    expect(notes.map((n) => n.getAttribute("data-reason"))).toEqual(["apiRun", "noGate"]);
    expect(notes[0].textContent).toMatch(/started through an API key/);
    // 2026-10-12 doc 81 Đợt 9 R2 (option A): apiRun now means "an API key that cannot be identified"
    expect(notes[0].textContent).toMatch(/cannot be identified/);
    expect(notes[0].textContent).not.toBe(notes[1].textContent);
  });
});

const DEF_HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
/** doc 81 Đợt 7 I2 — the device-configuration digest getRun returns (sent back on approval). */
const BINDING_DIGEST = "c".repeat(64);
describe("OrchestrationStudio — doc 81 Đợt 4 fix round 3 (R-4-n): lỗi 'robotId required' của bước hiện bằng appError dịch", () => {
  it("bước lỗi mang detail.appError INVALID_VALUE robotId/robotIdRequired ⇒ dòng dịch (không phải chuỗi thô); bước thành công ⇒ không có", async () => {
    setQueryOverride(
      "orchestration.getRun",
      makeQuery({
        data: {
          run: RUNS[2],
          steps: [
            { stepId: "r1", stepType: "command", status: "failed", attempt: 1, error: "robotId required for robot command", result: { routedTo: "robot-dispatcher", status: "rejected", accepted: false, detail: { appError: { appCode: "INVALID_VALUE", appParams: { field: "robotId", reason: "robotIdRequired" } } } } },
            { stepId: "r2", stepType: "command", status: "completed", attempt: 1, result: { routedTo: "robot-dispatcher", status: "done", accepted: true } },
          ],
        },
      }),
    );
    render(<OrchestrationStudio />);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(screen.getByText(/run #20 ·/));
    const notes = Array.from(rowOf(20).querySelectorAll('[data-testid="step-app-error"]'));
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).not.toBe("robotId required for robot command");
    expect(notes[0].textContent).toMatch(/robotIdRequired|robot/i);
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
      makeQuery({ data: { run: { ...AWAITING, currentStepId: "g-detail" }, defHash: DEF_HASH, bindingDigest: BINDING_DIGEST, steps: [{ stepId: "g-detail", stepType: "hitl_gate", status: "awaiting_confirm", attempt: 0, result: { prompt: "Duyệt?" } }] } }),
    );
    render(<OrchestrationStudio />);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(within(rowOf(30)).getByRole("button", { name: /^(Approve|studio\.approve)$/i }));
    // doc 81 Đợt 4 fix round 2 (R-4-k): + the hash of the definition this screen loaded
    expect(mutateSpies["orchestration.resumeRun"]).toHaveBeenCalledWith({ runId: 30, approved: true, note: undefined, expectedStepId: "g-detail", expectedDefHash: DEF_HASH, expectedBindingDigest: BINDING_DIGEST });
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
    expect(mutateSpies["orchestration.resumeRun"]).toHaveBeenCalledWith({ runId: 30, approved: false, note: "sai", expectedStepId: "g-detail", expectedDefHash: undefined, expectedBindingDigest: undefined });
  });

  it("chi tiết chưa nạp ⇒ Approve KHOÁ (doc 81 Đợt 4 fix round 2, R-4-k: chưa biết định nghĩa đang xem ⇒ không duyệt được), không gửi gì", async () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride("orchestration.getRun", makeQuery({ data: undefined }));
    render(<OrchestrationStudio />);
    const btn = within(rowOf(30)).getByRole("button", { name: /^(Approve|studio\.approve)$/i });
    expect(btn).toBeDisabled();
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(btn);
    expect(mutateSpies["orchestration.resumeRun"]).not.toHaveBeenCalled();
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

// ════════════════ doc 81 Đợt 8 task O3 — the approval screen lists, per adapter / robot, whether its program is verified ════════════════
describe("OrchestrationStudio — doc 81 Đợt 8 O3: controller program check per adapter on the approval screen", () => {
  const AWAITING = { ...run(40, "prog-flow", {}, { mode: "none", simulated: 0, live: 0, unconfirmed: 0 }), status: "awaiting_confirm", currentStepId: "g1" };
  const CHECKSUM = "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  const detail = (over: Record<string, unknown>) =>
    makeQuery({ data: { run: AWAITING, defHash: DEF_HASH, steps: [{ stepId: "g1", stepType: "hitl_gate", status: "awaiting_confirm", attempt: 0, result: { prompt: "?" } }], ...over } });
  const items = () => Array.from(rowOf(40).querySelectorAll('[data-testid="program-check"]')) as HTMLElement[];

  it("★ verified (with the checksum) · unsupported (said plainly, never 'verified') — one line per adapter / robot; Approve stays enabled", () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride(
      "orchestration.getRun",
      detail({
        bindingDigest: BINDING_DIGEST,
        programChecks: [
          { target: "adapter", id: 501, label: "SIM-PLC", status: "verified", checksum: CHECKSUM, source: "sim" },
          { target: "adapter", id: 701, label: "MB-PLC", status: "unsupported", source: "modbus" },
          { target: "robot", id: 2, label: "R2", status: "unsupported", source: "robot" },
        ],
      }),
    );
    render(<OrchestrationStudio />);
    expect(within(rowOf(40)).getByTestId("program-checks")).toBeInTheDocument();
    const list = items();
    expect(list.map((i) => i.getAttribute("data-status"))).toEqual(["verified", "unsupported", "unsupported"]);
    expect(list.map((i) => i.getAttribute("data-target"))).toEqual(["adapter:501", "adapter:701", "robot:2"]);
    expect(list[0].textContent).toMatch(/SIM-PLC/);
    expect(list[0].textContent).toMatch(/Program verified \(checksum sha256:ba7816bf8f01/);
    expect(list[0].querySelector("[title]")?.getAttribute("title")).toBe(CHECKSUM); // the full value on hover
    expect(list[1].textContent).toMatch(/MB-PLC/);
    expect(list[1].textContent).toMatch(/Program cannot be verified on this controller/);
    expect(list[1].textContent).not.toMatch(/verified \(/);
    expect(list[2].textContent).toMatch(/R2/);
    expect(list[2].textContent).toMatch(/Program cannot be verified on this controller/);
    expect(within(rowOf(40)).getByRole("button", { name: /^(Approve|studio\.approve)$/i })).toBeEnabled();
  });

  it("★ unreadable on a supported adapter ⇒ shown as such, no digest ⇒ Approve DISABLED (fail-closed)", () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride(
      "orchestration.getRun",
      detail({ bindingDigest: null, programChecks: [{ target: "adapter", id: 501, label: "SIM-PLC", status: "unreadable", source: "sim", reason: "timeout" }] }),
    );
    render(<OrchestrationStudio />);
    const [only] = items();
    expect(only.getAttribute("data-status")).toBe("unreadable");
    expect(only.textContent).toMatch(/could not be read/);
    expect(only.textContent).not.toMatch(/Program verified/);
    expect(within(rowOf(40)).getByRole("button", { name: /^(Approve|studio\.approve)$/i })).toBeDisabled();
  });

  it("★ final wave (review O M3): a SIMULATED controller says so next to 'verified'; a real driver's source does not", () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride(
      "orchestration.getRun",
      detail({
        bindingDigest: BINDING_DIGEST,
        programChecks: [
          { target: "adapter", id: 501, label: "SIM-PLC", status: "verified", checksum: CHECKSUM, source: "sim" },
          { target: "adapter", id: 502, label: "S7-PLC", status: "verified", checksum: CHECKSUM, source: "s7-plus" },
        ],
      }),
    );
    render(<OrchestrationStudio />);
    const [simLine, realLine] = items();
    expect(simLine.querySelector('[data-testid="program-check-sim"]')?.textContent).toMatch(/simulation/);
    expect(realLine.querySelector('[data-testid="program-check-sim"]')).toBeNull();
    expect(realLine.textContent).not.toMatch(/simulation/);
  });

  it("★ doc 81 Đợt 9 T2 + R-9-a (4): an S7 checksum (source 's7-blockinfo') says 'per protocol documentation — not yet verified on a real device' and 'not tamper-proof'; other sources do not", () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride(
      "orchestration.getRun",
      detail({
        bindingDigest: BINDING_DIGEST,
        programChecks: [
          { target: "adapter", id: 601, label: "S7-PLC", status: "verified", checksum: "s7:sha256:" + "ab".repeat(32), source: "s7-blockinfo" },
          { target: "adapter", id: 501, label: "SIM-PLC", status: "verified", checksum: CHECKSUM, source: "sim" },
          { target: "adapter", id: 602, label: "S7-OFF", status: "unreadable", source: "s7", reason: "error" },
        ],
      }),
    );
    render(<OrchestrationStudio />);
    const [s7Line, simLine, offLine] = items();
    expect(s7Line.textContent).toMatch(/Program verified \(checksum s7:sha256:abab/);
    expect(s7Line.querySelector('[data-testid="program-check-s7-docs"]')?.textContent).toBe(
      "(checksum per protocol documentation — not yet verified on a real device)",
    );
    // ruling R-9-a (4): said plainly — change detection, not tamper-proof
    expect(s7Line.querySelector('[data-testid="program-check-s7-not-tamper-proof"]')?.textContent).toBe(
      "(change detection per protocol data — not tamper-proof against an attacker with PLC write access)",
    );
    expect(s7Line.querySelector('[data-testid="program-check-sim"]')).toBeNull();
    expect(simLine.querySelector('[data-testid="program-check-s7-docs"]')).toBeNull();
    expect(simLine.querySelector('[data-testid="program-check-s7-not-tamper-proof"]')).toBeNull();
    expect(offLine.querySelector('[data-testid="program-check-s7-docs"]')).toBeNull(); // unreadable: no "verified" line at all
    expect(offLine.textContent).toMatch(/could not be read/);
  });

  it("★ doc 81 Đợt 9 T fix 1 (#7): an S7 adapter without the opt-in says 'verification not enabled for this adapter' (not 'cannot be verified')", () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride(
      "orchestration.getRun",
      detail({
        bindingDigest: BINDING_DIGEST,
        programChecks: [
          { target: "adapter", id: 603, label: "S7-NOOPT", status: "unsupported", source: "s7" },
          { target: "adapter", id: 701, label: "MB-PLC", status: "unsupported", source: "modbus" },
          { target: "robot", id: 2, label: "R2", status: "unsupported", source: "robot" },
        ],
      }),
    );
    render(<OrchestrationStudio />);
    const [s7, mb, robot] = items();
    expect(s7.querySelector('[data-testid="program-check-s7-not-enabled"]')?.textContent).toBe("Program verification not enabled for this adapter");
    expect(s7.textContent).not.toMatch(/cannot be verified/);
    expect(mb.textContent).toMatch(/Program cannot be verified on this controller/);
    expect(mb.querySelector('[data-testid="program-check-s7-not-enabled"]')).toBeNull();
    expect(robot.textContent).toMatch(/Program cannot be verified on this controller/);
  });

  it("★ doc 81 Đợt 9 R-9-b: a reading served from the display-only cache is labelled as such; a fresh one is not", () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride(
      "orchestration.getRun",
      detail({
        bindingDigest: BINDING_DIGEST,
        programChecks: [
          { target: "adapter", id: 601, label: "S7-PLC", status: "verified", checksum: "s7:sha256:" + "ab".repeat(32), source: "s7-blockinfo", displayCache: { readAt: "2026-10-12T08:00:00.000Z" } },
          { target: "adapter", id: 604, label: "S7-FRESH", status: "verified", checksum: "s7:sha256:" + "cd".repeat(32), source: "s7-blockinfo" },
        ],
      }),
    );
    render(<OrchestrationStudio />);
    const [cached, fresh] = items();
    expect(cached.querySelector('[data-testid="program-check-display-cache"]')?.textContent).toMatch(
      /^\(shown from a reading at .+ — display only; approving reads the controller again\)$/,
    );
    expect(fresh.querySelector('[data-testid="program-check-display-cache"]')).toBeNull();
  });

  it("no program list from the server (older server / not an approver's read) ⇒ no block", () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride("orchestration.getRun", detail({ bindingDigest: BINDING_DIGEST }));
    render(<OrchestrationStudio />);
    expect(within(rowOf(40)).queryByTestId("program-checks")).toBeNull();
  });

  it("★ step note FOE_GATE_REQUIRED(programUnreadable) ⇒ its own sentence (not the noGate one)", async () => {
    setQueryOverride(
      "orchestration.getRun",
      makeQuery({
        data: {
          run: RUNS[2],
          steps: [
            { stepId: "p1", stepType: "command", status: "failed", attempt: 1, result: null, error: 'FOE_GATE_REQUIRED(programUnreadable): command step "p1" was not sent' },
            { stepId: "p2", stepType: "command", status: "failed", attempt: 1, result: null, error: 'FOE_GATE_REQUIRED(staleApproval): command step "p2" was not sent' },
          ],
        },
      }),
    );
    render(<OrchestrationStudio />);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(screen.getByText(/run #20 ·/));
    const notes = Array.from(rowOf(20).querySelectorAll('[data-testid="step-gate-required"]'));
    expect(notes.map((n) => n.getAttribute("data-reason"))).toEqual(["programUnreadable", "staleApproval"]);
    expect(notes[0].textContent).toMatch(/program checksum of a controller/);
    expect(notes[1].textContent).toMatch(/the program in a controller it writes to was changed/);
  });
});

describe("OrchestrationStudio — doc 81 Đợt 9 task R3: run started through an API key (option A)", () => {
  const AWAITING = { ...run(50, "api-flow", { startedViaApi: true }, { mode: "none", simulated: 0, live: 0, unconfirmed: 0 }), status: "awaiting_confirm", currentStepId: "g1" };
  const view = {
    identified: true,
    keyId: 700,
    name: "line-integration",
    keyPrefix: "ak_1a2b3c",
    holder: { id: 12, name: "Holder Now" },
    creator: { id: 10, name: "Key Creator" },
    earlierHolders: [{ id: 13, name: "Earlier Holder" }],
    excludedUserIds: [14, 10, 12, 13],
  };
  const detail = (apiKey: unknown) =>
    makeQuery({ data: { run: AWAITING, defHash: DEF_HASH, bindingDigest: BINDING_DIGEST, apiKey, steps: [{ stepId: "g1", stepType: "hitl_gate", status: "awaiting_confirm", attempt: 0, result: { prompt: "ok?" } }] } });

  it("★ names the key and who it is issued to, and explains who cannot approve (holder, earlier holder, creator); not 'you' for another user", () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride("orchestration.getRun", detail(view));
    setQueryOverride("auth.me", makeQuery({ data: { id: 20, role: "supervisor", name: "Second Person" } }));
    render(<OrchestrationStudio />);
    const block = within(rowOf(50)).getByTestId("api-key-identity");
    expect(block).toHaveAttribute("data-identified", "true");
    expect(within(block).getByTestId("api-key-issued-to").textContent).toMatch(/line-integration \(ak_1a2b3c…\).*Holder Now/);
    const why = within(block).getByTestId("api-key-excluded").textContent ?? "";
    expect(why).toMatch(/person who started the run/);
    for (const n of ["Holder Now", "Earlier Holder", "Key Creator"]) expect(why).toContain(n);
    expect(within(block).queryByTestId("api-key-you-excluded")).toBeNull();
    // the Approve button is not taken away — the server decides (a four-eyes gate refuses an excluded approver)
    expect(within(rowOf(50)).getByRole("button", { name: /^(Approve|studio\.approve)$/i })).toBeEnabled();
  });

  it("★ the current user IS one of them (here: an earlier holder) ⇒ said plainly", () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride("orchestration.getRun", detail(view));
    setQueryOverride("auth.me", makeQuery({ data: { id: 13, role: "engineer", name: "Earlier Holder" } }));
    render(<OrchestrationStudio />);
    const you = within(rowOf(50)).getByTestId("api-key-you-excluded");
    expect(you).toHaveAttribute("role", "alert");
    expect(you.textContent).toMatch(/does not count/);
  });

  it("★ an API key that cannot be identified ⇒ red alert: its machine / robot commands are refused whoever approves", () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride("orchestration.getRun", detail({ identified: false, keyId: null, name: null, keyPrefix: null, holder: null, creator: null, earlierHolders: [], excludedUserIds: [] }));
    render(<OrchestrationStudio />);
    const block = within(rowOf(50)).getByTestId("api-key-identity");
    expect(block).toHaveAttribute("data-identified", "false");
    expect(block.textContent).toMatch(/cannot be identified/);
    expect(block.textContent).toMatch(/refused whoever approves/);
  });

  it("a run started by a user (no apiKey) ⇒ no block", () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride("orchestration.getRun", detail(null));
    render(<OrchestrationStudio />);
    expect(within(rowOf(50)).queryByTestId("api-key-identity")).toBeNull();
  });

  it("★ FOE_GATE_REQUIRED(approvedByKeyHolder) ⇒ its own sentence (holder / creator), different from the owner one", async () => {
    setQueryOverride(
      "orchestration.getRun",
      makeQuery({
        data: {
          run: RUNS[2],
          steps: [
            { stepId: "k1", stepType: "command", status: "failed", attempt: 1, result: null, error: 'FOE_GATE_REQUIRED(approvedByKeyHolder): command step "k1" was not sent' },
            { stepId: "k2", stepType: "command", status: "failed", attempt: 1, result: null, error: 'FOE_GATE_REQUIRED(approvedByOwner): command step "k2" was not sent' },
          ],
        },
      }),
    );
    render(<OrchestrationStudio />);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(screen.getByText(/run #20 ·/));
    const notes = Array.from(rowOf(20).querySelectorAll('[data-testid="step-gate-required"]'));
    expect(notes.map((n) => n.getAttribute("data-reason"))).toEqual(["approvedByKeyHolder", "approvedByOwner"]);
    expect(notes[0].textContent).toMatch(/issued to, or by the person who created the key/);
    expect(notes[0].textContent).not.toBe(notes[1].textContent);
  });
});

describe("OrchestrationStudio — doc 81 Đợt 9 R fix 1: key revoked / expired now, identity unreadable", () => {
  const AWAITING = { ...run(51, "api-flow2", { startedViaApi: true }, { mode: "none", simulated: 0, live: 0, unconfirmed: 0 }), status: "awaiting_confirm", currentStepId: "g1" };
  const base = { identified: false, keyId: 700, name: "line-integration", keyPrefix: "ak_1a2b3c", holder: { id: 12, name: "Holder Now" }, creator: null, earlierHolders: [], excludedUserIds: [] };
  const detail = (apiKey: unknown) =>
    makeQuery({ data: { run: AWAITING, defHash: DEF_HASH, bindingDigest: BINDING_DIGEST, apiKey, steps: [{ stepId: "g1", stepType: "hitl_gate", status: "awaiting_confirm", attempt: 0, result: {} }] } });
  for (const [detailKey, re] of [["inactive", /revoked or disabled now/], ["expired", /has expired/]] as const) {
    it(`★ key ${detailKey} ⇒ red alert naming the key: refused whoever approves until an administrator acts`, () => {
      setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
      setQueryOverride("orchestration.getRun", detail({ ...base, refusal: "apiKeyInactive", refusalDetail: detailKey }));
      render(<OrchestrationStudio />);
      const block = within(rowOf(51)).getByTestId("api-key-identity");
      expect(block).toHaveAttribute("data-refusal", "apiKeyInactive");
      expect(block.textContent).toMatch(re);
      expect(block.textContent).toMatch(/line-integration/);
    });
  }
  it("★ identity unreadable ⇒ says so (database / migration 0369), not 'cannot be identified'", () => {
    setQueryOverride("orchestration.listRuns", makeQuery({ data: [AWAITING] }));
    setQueryOverride("orchestration.getRun", detail({ ...base, keyId: null, name: null, keyPrefix: null, holder: null, refusal: "apiIdentityUnavailable", refusalDetail: "migrationMissing" }));
    render(<OrchestrationStudio />);
    const block = within(rowOf(51)).getByTestId("api-key-identity");
    expect(block).toHaveAttribute("data-refusal", "apiIdentityUnavailable");
    expect(block.textContent).toMatch(/migration 0369/);
  });
  it("★ step errors apiKeyInactive / apiIdentityUnavailable ⇒ their own sentences (never the 'add a gate' one)", async () => {
    setQueryOverride(
      "orchestration.getRun",
      makeQuery({
        data: {
          run: RUNS[2],
          steps: [
            { stepId: "i1", stepType: "command", status: "failed", attempt: 1, result: null, error: 'FOE_GATE_REQUIRED(apiKeyInactive): command step "i1" was not sent' },
            { stepId: "i2", stepType: "command", status: "failed", attempt: 1, result: null, error: 'FOE_GATE_REQUIRED(apiIdentityUnavailable): command step "i2" was not sent' },
          ],
        },
      }),
    );
    render(<OrchestrationStudio />);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(screen.getByText(/run #20 ·/));
    const notes = Array.from(rowOf(20).querySelectorAll('[data-testid="step-gate-required"]'));
    expect(notes.map((n) => n.getAttribute("data-reason"))).toEqual(["apiKeyInactive", "apiIdentityUnavailable"]);
    expect(notes[0].textContent).toMatch(/revoked, disabled or expired/);
    expect(notes[1].textContent).toMatch(/could not be read/);
    for (const n of notes) expect(n.textContent).not.toMatch(/Add a gate/);
  });
});
