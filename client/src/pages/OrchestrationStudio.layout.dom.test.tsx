// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 11 — Orchestration Studio thành mẫu P2 "Canvas designer" (doc 81 §1.2/§1.3).
// Hợp đồng (task-11-brief + plan GC3/GC4/Review Focus 1/3/4 + ruling R-2-g/j/l/n):
//   - Header MỘT hàng (h1 + chip "Khi nào dùng"/FOE tắt/sim-gate + Mô phỏng · Lưu (deploy) · Chạy · Trợ lý AI).
//   - Bảng bước + thư viện quy trình đã lưu bên TRÁI, canvas (cây/sơ đồ) là MAIN, Cấu hình bước (Inspector)
//     bên PHẢI, panel DƯỚI gồm Lần chạy / Chờ duyệt / Vấn đề — GẬP ở lần đầu, mở theo ý định (R-2-l), lựa
//     chọn gập/mở nhớ theo người dùng; số đếm luôn thấy ở thanh trạng thái.
//   - Trợ lý AI điều phối mở trong sheet 420 px (`?flyout=orch-ai`) và KHÔNG chồng với sheet chat AI (R-2-j).
//   - Lịch sử phiên bản = sheet `VersionHistoryPanel` + `RollbackConfirm` giữ ConfirmWithReason (lý do ≥3) +
//     OTP tươi mỗi lượt (doc 80 ORC-05, R-2-g). Nhân bản = sheet; Xoá giữ AlertDialog.
//   - Tiêu đề (tên quy trình) sửa tại chỗ; mã (ref) cũng vậy.
//   - R-2-n: Chạy / Deploy / Duyệt / Từ chối / Tiếp tục / Dừng / Huỷ giữ ĐÚNG đích, xác nhận và cổng cũ.
// Chạy trên wouter THẬT với history của jsdom; i18n THẬT (vi.json).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import VI from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { installResizeHandleHitAreaShim } from "@/components/patterns/layoutKitTestPanels";
import { getAiEntryState, resetAiEntryForTest, setAiChatOpen } from "@/lib/aiEntryStore";

vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
const perm = vi.hoisted(() => ({ canControl: true }));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: () => perm.canControl }),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 7, name: "Tester", role: "engineer" }, loading: false }),
}));
vi.mock("@/contexts/EngineeringContext", () => ({
  useEngineering: () => ({ setLastWorkflowRef: () => {} }),
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));
// Sơ đồ react-flow không dựng được trong jsdom — thay bằng vật đánh dấu ghi lại prop bố cục.
vi.mock("@/components/orchestration/WorkflowGraphCanvas", () => ({
  WF_DND_MIME: "application/x-wf-step-kind",
  WorkflowGraphCanvas: (p: { fill?: boolean; showPalette?: boolean }) => (
    <div data-testid="graph-canvas" data-fill={String(Boolean(p.fill))} data-palette={String(p.showPalette !== false)} />
  ),
}));

// ── "Server" giả ───────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
interface MutOpts { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }
const srv = vi.hoisted(() => ({
  status: { enabled: true, simGateRequired: false } as Record<string, unknown> | undefined,
  statusLoading: false,
  aiEnabled: true,
  workflows: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
  versions: {} as Record<number, Array<Record<string, unknown>>>,
  getRun: undefined as unknown,
  /** doc 81 Đợt 4 fix round 3 (R-4-n) — equipment rows + in-scope robots for the robot picker. */
  equipment: [] as unknown[],
  robots: [] as unknown[],
  queryInputs: {} as Record<string, unknown[]>,
  calls: {} as Record<string, unknown[]>,
  /** Kết quả trả cho onSuccess của mutation (khoá có mặt ⇒ tự gọi onSuccess sau một microtask). */
  results: {} as Record<string, unknown>,
  refetched: [] as string[],
  invalidated: [] as string[],
  simulate: null as null | ((input: unknown) => Promise<unknown>),
  suggest: null as null | ((input: unknown) => Promise<unknown>),
  optimize: null as null | ((input: unknown) => Promise<unknown>),
}));

vi.mock("@/lib/trpc", () => {
  const q = (key: string, data: unknown, extra: Record<string, unknown> = {}) => ({
    data,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    dataUpdatedAt: 1,
    refetch: () => {
      srv.refetched.push(key);
      return Promise.resolve();
    },
    ...extra,
  });
  const proc = (router: string, name: string) => {
    const key = `${router}.${name}`;
    return {
      useQuery: (input?: unknown, opts?: { enabled?: boolean }) => {
        const enabled = opts?.enabled !== false;
        if (enabled) (srv.queryInputs[key] ??= []).push(input);
        if (!enabled) return q(key, undefined);
        if (key === "orchestration.status") {
          return srv.statusLoading ? q(key, undefined, { isLoading: true }) : q(key, srv.status);
        }
        if (key === "aiOrchestration.status") return q(key, { enabled: srv.aiEnabled });
        if (key === "orchestration.listWorkflows") return q(key, srv.workflows);
        if (key === "orchestration.listRuns") return q(key, srv.runs);
        if (key === "orchestration.listVersions") {
          const id = (input as { workflowId: number }).workflowId;
          return q(key, srv.versions[id] ?? []);
        }
        if (key === "orchestration.getRun") return q(key, srv.getRun);
        if (key === "equipment.listEquipment") return q(key, srv.equipment);
        if (key === "fleet.robotPositions") return q(key, srv.robots);
        // doc 81 Đợt 3 Task 4 — phân công run đang hiệu lực + roster.
        if (key === "engineering.assignments") return q(key, [{ entityId: 30, assigneeUserId: 81, assigneeName: "Ky su Run" }]);
        if (key === "engineering.assignableUsers") return q(key, { users: [{ id: 81, name: "Ky su Run" }], truncated: false });
        return q(key, undefined);
      },
      useMutation: (opts: MutOpts = {}) => ({
        isPending: false,
        mutateAsync: vi.fn(),
        mutate: (input: unknown, callOpts?: MutOpts) => {
          (srv.calls[key] ??= []).push(input);
          if (key in srv.results) {
            const r = srv.results[key];
            void Promise.resolve().then(() => {
              opts.onSuccess?.(r);
              callOpts?.onSuccess?.(r);
            });
          }
        },
      }),
    };
  };
  const utils = new Proxy(
    {},
    {
      get: (_a, r: string) =>
        new Proxy(
          {},
          {
            get: (_b, p: string) => ({
              invalidate: () => {
                srv.invalidated.push(`${r}.${p}`);
                return Promise.resolve();
              },
              fetch: (input: unknown) => {
                (srv.calls[`${r}.${p}.fetch`] ??= []).push(input);
                if (r === "orchestration" && p === "simulate" && srv.simulate) return srv.simulate(input);
                if (r === "aiOrchestration" && p === "suggestWorkflow" && srv.suggest) return srv.suggest(input);
                if (r === "aiOrchestration" && p === "optimizeWorkflow" && srv.optimize) return srv.optimize(input);
                return Promise.resolve(undefined);
              },
              setData: () => {},
            }),
          },
        ),
    },
  );
  return {
    trpc: new Proxy(
      {},
      {
        get: (_t, routerName: string) => {
          if (routerName === "useUtils") return () => utils;
          return new Proxy({}, { get: (_t2, procName: string) => proc(routerName, procName) });
        },
      },
    ),
  };
});

import OrchestrationStudio from "./OrchestrationStudio";

// ── Dữ liệu (ORACLE khai tay) ──────────────────────────────────────────────────────────────────
const WF = (id: number, ref: string, name: string, version: number) => ({
  id, ref, name, version, status: "deployed", definitionJson: { ref, name, version, steps: [{ id: "cmd-1", type: "delay", ms: 500 }] },
});
const WORKFLOWS = [WF(11, "line-a-startup", "Khởi động dây chuyền A", 3), WF(12, "line-b-stop", "Dừng dây chuyền B", 1)];
const VERSIONS_11 = [3, 2, 1].map((v) => ({
  id: 100 + v, workflowId: 11, ref: "line-a-startup", version: v, name: `A v${v}`,
  definitionJson: { ref: "line-a-startup", name: `A v${v}`, version: v, steps: [{ id: "d", type: "delay", ms: v * 100 }] },
  createdBy: 1, createdAt: `2026-09-2${v}T00:00:00.000Z`,
}));
const run = (id: number, status: string, extra: Row = {}) => ({
  id, workflowId: 11, workflowRef: `wf-${id}`, status, paramsJson: {}, contextJson: {}, currentStepId: null,
  startedBy: 1, createdAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:00:00.000Z",
  dispatch: { mode: "none", simulated: 0, live: 0, unconfirmed: 0 }, ...extra,
});
const RUNS_PLAIN = [
  run(1, "completed", { dispatch: { mode: "simulated", simulated: 2, live: 0, unconfirmed: 0 } }),
  run(2, "failed", { dispatch: { mode: "unconfirmed", simulated: 0, live: 0, unconfirmed: 1 } }),
  run(3, "running"),
];
const AWAITING = run(30, "awaiting_confirm", { currentStepId: "g-1" });
const INTERRUPTED = run(31, "held", { currentStepId: "s-2", contextJson: { interrupted: true } });

beforeAll(async () => {
  installResizeHandleHitAreaShim();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // input-otp gọi document.elementFromPoint (jsdom không có).
  (document as unknown as { elementFromPoint: () => null }).elementFromPoint ??= () => null;
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  srv.status = { enabled: true, simGateRequired: false };
  srv.statusLoading = false;
  srv.aiEnabled = true;
  srv.workflows = WORKFLOWS.map((w) => ({ ...w }));
  srv.runs = RUNS_PLAIN.map((r) => ({ ...r }));
  srv.versions = { 11: VERSIONS_11.map((v) => ({ ...v })) };
  srv.getRun = undefined;
  srv.equipment = [];
  srv.robots = [];
  srv.queryInputs = {};
  srv.calls = {};
  srv.results = {};
  srv.refetched = [];
  srv.invalidated = [];
  srv.simulate = null;
  srv.suggest = null;
  srv.optimize = null;
  perm.canControl = true;
  for (const f of Object.values(toastSpy)) f.mockClear();
  localStorage.clear();
  resetAiEntryForTest();
  window.history.replaceState(null, "", "/orchestration-studio");
});
afterEach(() => cleanup());

const S = VI.studio;
const mainEl = () => document.querySelector("[data-layout-main]") as HTMLElement;
const params = () => new URLSearchParams(window.location.search);
const leftPanel = () => screen.getByRole("region", { name: S.libraryPanel });
const inspector = () => screen.getByRole("complementary", { name: S.inspector });
const bottomPanel = () => screen.getByRole("region", { name: S.bottomPanel }) as HTMLElement;
const bottomToggle = () => screen.getByRole("button", { name: VI.layoutKit.shell.toggleBottom });
const layer = (key: string) => document.querySelector(`[data-flyout-key="${key}"]`) as HTMLElement | null;
const waitLayer = (key: string) =>
  waitFor(() => {
    const l = layer(key);
    expect(l).toBeTruthy();
    return l as HTMLElement;
  });
const wfRow = (id: number) => leftPanel().querySelector(`[data-workflow-row="${id}"]`) as HTMLElement;
const rowOf = (id: number) => screen.getByText(new RegExp(`run #${id} ·`)).closest("[data-run-row]") as HTMLElement;
const calls = (key: string) => srv.calls[key] ?? [];

describe("Orchestration P2 — bố cục: canvas là MAIN", () => {
  it("MAIN duy nhất = canvas (cây), trong <main>; h1/chip/KPI/notice ở header NGOÀI MAIN", () => {
    render(<OrchestrationStudio />);
    const mains = document.querySelectorAll("[data-layout-main]");
    expect(mains).toHaveLength(1);
    const m = mainEl();
    expect(m.getAttribute("data-layout-main")).toBe("orchestration-studio");
    expect(m.closest("main")).toBeTruthy();
    expect(m.querySelector("h1, [data-layout-header], [data-layout-kpi], [data-notice-kind], [role=alert]")).toBeNull();
    // Canvas trống: trạng thái trống là phần tử làm việc đầu tiên của MAIN.
    expect(within(m).getByText(S.emptyCanvas)).toBeInTheDocument();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent(S.title);
    expect(h1.closest("[data-layout-header]")).toBeTruthy();
    // Phụ đề / "Khi nào dùng" / banner FOE không còn là khối trên trang (chỉ trong popover của chip).
    expect(screen.queryByText(S.whenToUse)).toBeNull();
    expect(screen.queryByText(S.subtitle)).toBeNull();
  });

  it("TRÁI = bảng bước (8 loại) + thư viện quy trình; PHẢI = Cấu hình bước; cả hai NGOÀI MAIN", () => {
    render(<OrchestrationStudio />);
    const left = leftPanel();
    expect(mainEl().contains(left)).toBe(false);
    const palette = within(left).getByRole("group", { name: S.addStep });
    expect(within(palette).getAllByRole("button")).toHaveLength(8);
    expect(within(left).getByText("Khởi động dây chuyền A")).toBeInTheDocument();
    expect(within(left).getByText("Dừng dây chuyền B")).toBeInTheDocument();
    const insp = inspector();
    expect(mainEl().contains(insp)).toBe(false);
    expect(within(insp).getByText(S.selectStep)).toBeInTheDocument();
  });

  it("bấm một loại trong bảng bước ⇒ thêm bước cấp cao nhất vào canvas, chọn nó, Inspector hiện cấu hình", async () => {
    const user = userEvent.setup();
    render(<OrchestrationStudio />);
    await user.click(within(within(leftPanel()).getByRole("group", { name: S.addStep })).getByRole("button", { name: S.type.delay }));
    expect(within(mainEl()).queryByText(S.emptyCanvas)).toBeNull();
    expect(within(mainEl()).getByText("delay-1")).toBeInTheDocument();
    expect(within(inspector()).getByDisplayValue("delay-1")).toBeInTheDocument();
  });

  it("thanh công cụ DUY NHẤT của MAIN (tên/mã sửa tại chỗ + Cây ⇄ Sơ đồ); sơ đồ lấp đầy MAIN, không lặp bảng bước", async () => {
    const user = userEvent.setup();
    render(<OrchestrationStudio />);
    const toolbars = mainEl().querySelectorAll("[data-layout-toolbar]");
    expect(toolbars).toHaveLength(1);
    const bar = toolbars[0] as HTMLElement;
    const toggle = within(bar).getByRole("tablist", { name: S.viewToggle });
    expect(within(bar).getByRole("button", { name: S.editName })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: S.editRef })).toBeInTheDocument();
    // Canvas (phần tử làm việc) đứng SAU thanh công cụ.
    expect(bar.compareDocumentPosition(within(mainEl()).getByText(S.emptyCanvas)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(within(toggle).getByRole("tab", { name: new RegExp(S.viewGraph) }));
    const g = within(mainEl()).getByTestId("graph-canvas");
    expect(g).toHaveAttribute("data-fill", "true");
    expect(g).toHaveAttribute("data-palette", "false");
    await user.click(within(toggle).getByRole("tab", { name: new RegExp(S.viewTree) }));
    expect(within(mainEl()).queryByTestId("graph-canvas")).toBeNull();
    expect(within(mainEl()).getByText(S.emptyCanvas)).toBeInTheDocument();
  });

  it("chip header: 'Khi nào dùng' giữ khoá riêng của trang; FOE tắt ⇒ chip, popover là câu cũ; đang tải ⇒ không chip", async () => {
    const user = userEvent.setup();
    srv.status = { enabled: false, simGateRequired: false };
    const { unmount } = render(<OrchestrationStudio />);
    const header = document.querySelector("[data-layout-header]") as HTMLElement;
    await user.click(within(header).getByTestId("orch-foe-off"));
    expect(await screen.findByText(S.foeOff)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(header.querySelector('[data-notice-kind="whenToUse"]') as HTMLElement);
    expect((await screen.findByText(S.whenToUse)).getAttribute("data-when-to-use")).toBe("studio.whenToUse");
    unmount();
    srv.statusLoading = true;
    render(<OrchestrationStudio />);
    expect(screen.queryByTestId("orch-foe-off")).toBeNull();
  });

  it("sim-gate BẬT: chip 'cần mô phỏng', Deploy khoá + lý do; mô phỏng ĐẠT ⇒ chip ĐẠT, Deploy mở", async () => {
    const user = userEvent.setup();
    srv.status = { enabled: true, simGateRequired: true };
    srv.simulate = () => Promise.resolve({ ok: true, valid: true, errors: [], warnings: [], timeline: [], totalDurationMs: 0, machineStateTrace: {}, simToken: "tok" });
    render(<OrchestrationStudio />);
    await user.click(within(leftPanel()).getByRole("button", { name: S.type.delay }));
    expect(screen.getByTestId("orch-sim-gate")).toHaveTextContent(S.simGateChipNeed);
    const deploy = screen.getByRole("button", { name: S.deploy });
    expect(deploy).toBeDisabled();
    expect(deploy).toHaveAttribute("title", S.simRequired);
    await user.click(screen.getByRole("button", { name: S.simulate }));
    await waitFor(() => expect(screen.getByTestId("orch-sim-gate")).toHaveTextContent(S.simGateChipOk));
    expect(screen.getByRole("button", { name: S.deploy })).toBeEnabled();
  });
});

describe("Orchestration P2 — panel dưới Lần chạy / Chờ duyệt / Vấn đề (R-2-l)", () => {
  it("lần đầu: panel GẬP, đếm luôn thấy ở thanh trạng thái; nội dung không unmount", () => {
    srv.runs = [...RUNS_PLAIN, AWAITING].map((r) => ({ ...r }));
    render(<OrchestrationStudio />);
    expect(bottomToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("orch-status-runs")).toHaveTextContent("4");
    expect(screen.getByTestId("orch-status-awaiting")).toHaveTextContent("1");
    expect(screen.getByTestId("orch-status-problems")).toHaveTextContent("0");
    const tabs = within(bottomPanel()).getAllByRole("tab").map((x) => x.textContent?.replace(/\d+$/, "").trim());
    expect(tabs).toEqual([S.runsTab, S.awaitingTab, S.problemsTab]);
    expect(mainEl().contains(bottomPanel())).toBe(false);
  });

  it("bấm 'Chờ duyệt' ở thanh trạng thái ⇒ mở panel ở tab Chờ duyệt (?tab=approvals)", async () => {
    const user = userEvent.setup();
    render(<OrchestrationStudio />);
    await user.click(screen.getByTestId("orch-status-awaiting"));
    await waitFor(() => expect(bottomToggle()).toHaveAttribute("aria-expanded", "true"));
    expect(within(bottomPanel()).getByRole("tab", { name: new RegExp(S.awaitingTab) })).toHaveAttribute("aria-selected", "true");
    expect(params().get("tab")).toBe("approvals");
  });

  it("lựa chọn gập/mở của NGƯỜI DÙNG được nhớ theo người dùng và thắng mặc định gập", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<OrchestrationStudio />);
    await user.click(bottomToggle());
    expect(bottomToggle()).toHaveAttribute("aria-expanded", "true");
    expect(localStorage.getItem("layoutKit:orchestration-studio:u7:bottomCollapsed")).toBe("0");
    unmount();
    render(<OrchestrationStudio />);
    await waitFor(() => expect(bottomToggle()).toHaveAttribute("aria-expanded", "true"));
  });

  it("deep-link ?filter=pending (PendingReviewStrip) ⇒ panel MỞ ở tab Chờ duyệt", async () => {
    srv.runs = [...RUNS_PLAIN, AWAITING].map((r) => ({ ...r }));
    window.history.replaceState(null, "", "/orchestration-studio?filter=pending");
    render(<OrchestrationStudio />);
    await waitFor(() => expect(bottomToggle()).toHaveAttribute("aria-expanded", "true"));
    expect(within(bottomPanel()).getByRole("tab", { name: new RegExp(S.awaitingTab) })).toHaveAttribute("aria-selected", "true");
    expect(within(rowOf(30)).getByRole("button", { name: S.approve })).toBeVisible();
  });

  it("run chờ duyệt ở tab Chờ duyệt (không lặp ở Lần chạy); run bị gián đoạn ở Lần chạy, KHÔNG có nút Duyệt", async () => {
    const user = userEvent.setup();
    srv.runs = [...RUNS_PLAIN, AWAITING, INTERRUPTED].map((r) => ({ ...r }));
    render(<OrchestrationStudio />);
    expect(screen.getAllByText(/run #30 ·/)).toHaveLength(1);
    const runsTab = within(bottomPanel()).getByRole("tab", { name: new RegExp(S.runsTab) });
    await user.click(runsTab);
    const runsPanel = screen.getByRole("tabpanel", { name: new RegExp(S.runsTab) });
    expect(within(runsPanel).getByText(S.interruptedRuns)).toBeInTheDocument();
    expect(within(rowOf(31)).queryByRole("button", { name: S.approve })).toBeNull();
    expect(within(rowOf(31)).getByRole("button", { name: S.continueRun })).toBeInTheDocument();
    expect(runsPanel.contains(rowOf(30))).toBe(false);
  });

  it("Review Focus 3: đổi tab KHÔNG huỷ chi tiết run đang mở (instance giữ nguyên)", async () => {
    const user = userEvent.setup();
    srv.runs = [...RUNS_PLAIN, AWAITING].map((r) => ({ ...r }));
    srv.getRun = { run: RUNS_PLAIN[0], steps: [{ stepId: "s1", stepType: "command", status: "completed", result: { routedTo: "ot-dispatcher", status: "simulated", simulated: true, accepted: true } }] };
    render(<OrchestrationStudio />);
    await user.click(within(bottomPanel()).getByRole("tab", { name: new RegExp(S.runsTab) }));
    await user.click(screen.getByText(/run #1 ·/));
    expect(within(rowOf(1)).getByTestId("step-dispatch")).toBeInTheDocument();
    await user.click(within(bottomPanel()).getByRole("tab", { name: new RegExp(S.awaitingTab) }));
    await user.click(within(bottomPanel()).getByRole("tab", { name: new RegExp(S.runsTab) }));
    expect(within(rowOf(1)).getByTestId("step-dispatch")).toBeInTheDocument();
  });

  it("GC3: nhãn DRY-RUN và CHƯA XÁC NHẬN vẫn trên hàng run trong panel dưới", () => {
    render(<OrchestrationStudio />);
    expect(within(rowOf(1)).getByTestId("dispatch-mode")).toHaveTextContent(VI.provenance.dispatch.simulated);
    expect(within(rowOf(2)).getByTestId("dispatch-mode")).toHaveTextContent(VI.provenance.dispatch.unconfirmed);
    expect(bottomPanel().contains(rowOf(1))).toBe(true);
  });
});

describe("Orchestration P2 — Mô phỏng ⇒ tab Vấn đề", () => {
  it("Mô phỏng gửi đúng định nghĩa, mở panel ở tab Vấn đề với lỗi/cảnh báo; thanh trạng thái đếm vấn đề", async () => {
    const user = userEvent.setup();
    srv.simulate = () =>
      Promise.resolve({
        ok: false, valid: false, errors: ["step delay-1: thiếu máy"], warnings: [{ stepId: "delay-1", kind: "timing", message: "chậm hơn chu kỳ" }],
        timeline: [], totalDurationMs: 0, machineStateTrace: {},
      });
    render(<OrchestrationStudio />);
    await user.click(within(leftPanel()).getByRole("button", { name: S.type.delay }));
    await user.click(screen.getByRole("button", { name: S.simulate }));
    expect(calls("orchestration.simulate.fetch")).toEqual([{ workflow: { ref: "", name: "", version: 1, steps: [{ id: "delay-1", type: "delay", ms: 1000 }] } }]);
    await waitFor(() => expect(bottomToggle()).toHaveAttribute("aria-expanded", "true"));
    expect(within(bottomPanel()).getByRole("tab", { name: new RegExp(S.problemsTab) })).toHaveAttribute("aria-selected", "true");
    const problems = screen.getByRole("tabpanel", { name: new RegExp(S.problemsTab) });
    expect(within(problems).getByText("step delay-1: thiếu máy")).toBeInTheDocument();
    expect(within(problems).getByText("chậm hơn chu kỳ")).toBeInTheDocument();
    expect(screen.getByTestId("orch-status-problems")).toHaveTextContent("2");
  });
});

describe("Orchestration P2 — final wave T11", () => {
  it("tab do MÃ chọn khi sheet mở (AI đề xuất + mô phỏng ⇒ Vấn đề) KHÔNG kẹt: sau đó đổi ?tab= (back/forward) thì panel theo URL", async () => {
    const user = userEvent.setup();
    srv.suggest = () =>
      Promise.resolve({
        available: true, valid: true, rationale: "lý do AI", workflow: { ref: "ai-wf", name: "AI WF", version: 1, steps: [{ id: "ai-step", type: "delay", ms: 10 }] },
        simulation: { ok: false, valid: false, errors: ["lỗi mô phỏng"], warnings: [], timeline: [], totalDurationMs: 0, machineStateTrace: {} },
      });
    render(<OrchestrationStudio />);
    await user.click(screen.getByRole("button", { name: S.aiTitle }));
    const l = await waitLayer("orch-ai");
    await user.type(within(l).getByLabelText(S.aiGoal), "khởi động");
    await user.click(within(l).getByRole("button", { name: S.aiSuggest }));
    const tabOf = (name: string) => within(screen.getByRole("region", { name: S.bottomPanel, hidden: true })).getByRole("tab", { name: new RegExp(name), hidden: true });
    await waitFor(() => expect(tabOf(S.problemsTab)).toHaveAttribute("aria-selected", "true"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(layer("orch-ai")).toBeNull());
    act(() => {
      window.history.pushState(null, "", "/orchestration-studio?tab=runs");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(tabOf(S.runsTab)).toHaveAttribute("aria-selected", "true"));
  });

  it("?flyout=orch-versions cho quy trình KHÔNG có trong danh sách đã tải ⇒ báo không tìm thấy, KHÔNG có nút khôi phục", async () => {
    window.history.replaceState(null, "", "/orchestration-studio?flyout=orch-versions&flyoutId=999");
    render(<OrchestrationStudio />);
    const l = await waitLayer("orch-versions");
    await waitFor(() => expect(l).toHaveTextContent("#999"));
    expect(within(l).queryByRole("button", { name: new RegExp(S.rollback) })).toBeNull();
  });
});

describe("Orchestration P2 — Trợ lý AI điều phối trong sheet 420 (R-2-j)", () => {
  it("mở sheet 420 (?flyout=orch-ai) với mục tiêu + gợi ý/tối ưu + ghi chú HITL; đóng sheet chat AI đang mở", async () => {
    const user = userEvent.setup();
    act(() => setAiChatOpen(true));
    render(<OrchestrationStudio />);
    await user.click(screen.getByRole("button", { name: S.aiTitle }));
    const l = await waitLayer("orch-ai");
    expect(l.className).toMatch(/max-w-\[420px\]/);
    expect(params().getAll("flyout")).toEqual(["orch-ai"]);
    expect(within(l).getByLabelText(S.aiGoal)).toBeInTheDocument();
    expect(within(l).getByRole("button", { name: S.aiSuggest })).toBeEnabled();
    expect(within(l).getByText(S.aiHitlNote)).toBeInTheDocument();
    expect(getAiEntryState().chatOpen).toBe(false);
  });

  it("sheet chat AI mở ra khi trợ lý điều phối đang mở ⇒ trợ lý điều phối đóng (không chồng hai bề mặt AI)", async () => {
    const user = userEvent.setup();
    render(<OrchestrationStudio />);
    await user.click(screen.getByRole("button", { name: S.aiTitle }));
    await waitLayer("orch-ai");
    act(() => setAiChatOpen(true));
    await waitFor(() => expect(layer("orch-ai")).toBeNull());
    expect(params().getAll("flyout")).toEqual([]);
    expect(getAiEntryState().chatOpen).toBe(true);
  });

  it("AI gợi ý ⇒ nạp đề xuất vào canvas (người vẫn tự deploy — không gọi deploy/run)", async () => {
    const user = userEvent.setup();
    srv.suggest = () =>
      Promise.resolve({ available: true, valid: true, rationale: "lý do AI", workflow: { ref: "ai-wf", name: "AI WF", version: 1, steps: [{ id: "ai-step", type: "delay", ms: 10 }] } });
    render(<OrchestrationStudio />);
    await user.click(screen.getByRole("button", { name: S.aiTitle }));
    const l = await waitLayer("orch-ai");
    await user.type(within(l).getByLabelText(S.aiGoal), "khởi động");
    await user.click(within(l).getByRole("button", { name: S.aiSuggest }));
    await waitFor(() => expect(within(mainEl()).getByText("ai-step")).toBeInTheDocument());
    expect(calls("aiOrchestration.suggestWorkflow.fetch")).toEqual([{ goal: "khởi động", lang: expect.any(String) }]);
    expect(within(l).getByText("lý do AI")).toBeInTheDocument();
    expect(calls("orchestration.deployWorkflow")).toEqual([]);
    expect(calls("orchestration.startRun")).toEqual([]);
  });

  it("AI tắt ⇒ nút khoá + câu 'đang TẮT' cũ", async () => {
    const user = userEvent.setup();
    srv.aiEnabled = false;
    render(<OrchestrationStudio />);
    await user.click(screen.getByRole("button", { name: S.aiTitle }));
    const l = await waitLayer("orch-ai");
    expect(within(l).getByRole("button", { name: S.aiSuggest })).toBeDisabled();
    expect(within(l).getByText(S.aiDisabledHint)).toBeInTheDocument();
  });
});

describe("Orchestration P2 — Lịch sử phiên bản: VersionHistoryPanel + RollbackConfirm (R-2-g)", () => {
  async function openVersions(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(wfRow(11)).getByRole("button", { name: S.versions }));
    const l = await waitLayer("orch-versions");
    expect(params().getAll("flyout")).toEqual(["orch-versions"]);
    expect(params().getAll("flyoutId")).toEqual(["11"]);
    return l;
  }
  async function reasonStep(l: HTMLElement, version: number, reason: string) {
    const row = l.querySelector(`[data-version-id="${100 + version}"]`) as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: new RegExp(S.rollback) }));
    const dlg = await screen.findByRole("dialog", { name: S.rollbackTitle });
    fireEvent.change(within(dlg).getByLabelText(VI.confirmWithReason.reasonLabel), { target: { value: reason } });
    return dlg;
  }

  it("sheet phiên bản liệt kê v3/v2/v1 của ĐÚNG quy trình (listVersions {workflowId})", async () => {
    const user = userEvent.setup();
    render(<OrchestrationStudio />);
    const l = await openVersions(user);
    expect(srv.queryInputs["orchestration.listVersions"]?.at(-1)).toEqual({ workflowId: 11 });
    expect(l.querySelector("[data-version-history]")).toBeTruthy();
    expect(within(l).getByText("v3")).toBeInTheDocument();
    expect(within(l).getByText("v1")).toBeInTheDocument();
  });

  it("Khôi phục: lý do <3 ⇒ khoá; đủ ⇒ xác nhận ⇒ HỎI OTP trước khi gọi; nhập OTP ⇒ gọi đúng một lần với lý do + OTP", async () => {
    const user = userEvent.setup();
    srv.results["orchestration.rollbackWorkflow"] = { ok: true };
    render(<OrchestrationStudio />);
    const l = await openVersions(user);
    let dlg = await reasonStep(l, 1, "ab");
    expect(within(dlg).getByRole("button", { name: VI.confirmWithReason.continue })).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText(VI.confirmWithReason.reasonLabel), { target: { value: "abc" } });
    expect(within(dlg).getByRole("alert")).toHaveTextContent(S.rollbackImpact);
    fireEvent.click(within(dlg).getByRole("button", { name: VI.confirmWithReason.continue }));
    dlg = await screen.findByRole("dialog", { name: VI.confirmWithReason.finalTitle });
    fireEvent.click(within(dlg).getByRole("button", { name: S.rollback }));
    const otp = await screen.findByRole("dialog", { name: VI.stepUp.title });
    expect(calls("orchestration.rollbackWorkflow")).toEqual([]);
    fireEvent.change(otp.querySelector("input") as HTMLInputElement, { target: { value: "123456" } });
    await waitFor(() => expect(calls("orchestration.rollbackWorkflow")).toHaveLength(1));
    expect(calls("orchestration.rollbackWorkflow")[0]).toEqual({ workflowId: 11, version: 1, reason: "abc", totpCode: "123456" });
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledWith(S.rollbackDone));
    expect(srv.refetched).toEqual(expect.arrayContaining(["orchestration.listWorkflows", "orchestration.listVersions"]));
  });

  for (const [reason, key] of [["robotIdMissing", "deployRobotIdMissing"], ["stopAdapterAmbiguous", "deployStopAdapterAmbiguous"], ["robotUnavailable", "deployRobotUnavailable"], ["robotDisabled", "deployRobotDisabled"], ["outOfScope", "deployOutOfScope"], ["refOutOfScope", "deployRefOutOfScope"]] as const) { // + doc 81 Đợt 5 E2
    it(`final wave G2: ROLLBACK refused with ${reason} ⇒ the translated sentence naming the steps (no raw server English)`, async () => {
      const user = userEvent.setup();
      srv.results["orchestration.rollbackWorkflow"] = { ok: false, enabled: true, reason, stepIds: ["s1", "s2"], message: "RAW server text" };
      render(<OrchestrationStudio />);
      const l = await openVersions(user);
      const dlg = await reasonStep(l, 1, "abc");
      fireEvent.click(within(dlg).getByRole("button", { name: VI.confirmWithReason.continue }));
      const fin = await screen.findByRole("dialog", { name: VI.confirmWithReason.finalTitle });
      fireEvent.click(within(fin).getByRole("button", { name: S.rollback }));
      const otp = await screen.findByRole("dialog", { name: VI.stepUp.title });
      fireEvent.change(otp.querySelector("input") as HTMLInputElement, { target: { value: "123456" } });
      await waitFor(() => expect(toastSpy.error).toHaveBeenCalled());
      const shown = String((toastSpy.error as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]);
      expect(shown).toBe(S[key].replace("{{steps}}", "s1, s2"));
      expect(shown).not.toContain("RAW server text");
    });
  }

  it("Huỷ OTP ⇒ KHÔNG gọi khôi phục", async () => {
    const user = userEvent.setup();
    render(<OrchestrationStudio />);
    const l = await openVersions(user);
    const dlg = await reasonStep(l, 2, "lý do đủ");
    fireEvent.click(within(dlg).getByRole("button", { name: VI.confirmWithReason.continue }));
    const fin = await screen.findByRole("dialog", { name: VI.confirmWithReason.finalTitle });
    fireEvent.click(within(fin).getByRole("button", { name: S.rollback }));
    const otp = await screen.findByRole("dialog", { name: VI.stepUp.title });
    fireEvent.click(within(otp).getByRole("button", { name: VI.common.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: VI.stepUp.title })).toBeNull());
    expect(calls("orchestration.rollbackWorkflow")).toEqual([]);
  });

  it("không có quyền machine_control ⇒ nút Khôi phục khoá", async () => {
    const user = userEvent.setup();
    perm.canControl = false;
    render(<OrchestrationStudio />);
    const l = await openVersions(user);
    const row = l.querySelector('[data-version-id="103"]') as HTMLElement;
    expect(within(row).getByRole("button", { name: new RegExp(S.rollback) })).toBeDisabled();
  });
});

describe("Orchestration P2 — Nhân bản (sheet) / Xoá (AlertDialog)", () => {
  it("Nhân bản: sheet → mã mới mặc định '<ref>-copy' → lưu ⇒ duplicateWorkflow({id,newRef}) MỘT lần → danh sách tải lại → sheet đóng, URL sạch", async () => {
    const user = userEvent.setup();
    srv.results["orchestration.duplicateWorkflow"] = { ok: true };
    render(<OrchestrationStudio />);
    await user.click(within(wfRow(11)).getByRole("button", { name: S.duplicate }));
    const l = await waitLayer("orch-duplicate");
    expect(params().getAll("flyoutId")).toEqual(["11"]);
    const input = within(l).getByLabelText(S.duplicateNewRef) as HTMLInputElement;
    expect(input.value).toBe("line-a-startup-copy");
    await user.clear(input);
    await user.type(input, "  line-a-v2  ");
    await user.click(within(l).getByRole("button", { name: S.duplicate }));
    expect(calls("orchestration.duplicateWorkflow")).toEqual([{ id: 11, newRef: "line-a-v2" }]);
    await waitFor(() => expect(layer("orch-duplicate")).toBeNull());
    expect(params().getAll("flyout")).toEqual([]);
    expect(srv.refetched).toContain("orchestration.listWorkflows");
    expect(toastSpy.success).toHaveBeenCalledWith(S.wfDuplicated);
  });

  it("Nhân bản: mã trống ⇒ nút lưu khoá", async () => {
    const user = userEvent.setup();
    render(<OrchestrationStudio />);
    await user.click(within(wfRow(12)).getByRole("button", { name: S.duplicate }));
    const l = await waitLayer("orch-duplicate");
    await user.clear(within(l).getByLabelText(S.duplicateNewRef));
    expect(within(l).getByRole("button", { name: S.duplicate })).toBeDisabled();
  });

  it("Xoá giữ AlertDialog: Huỷ ⇒ không gọi; Xoá ⇒ deleteWorkflow({id}) một lần", async () => {
    const user = userEvent.setup();
    render(<OrchestrationStudio />);
    await user.click(within(wfRow(12)).getByRole("button", { name: VI.common.delete }));
    let dlg = await screen.findByRole("alertdialog");
    await user.click(within(dlg).getByRole("button", { name: VI.common.cancel }));
    expect(calls("orchestration.deleteWorkflow")).toEqual([]);
    await user.click(within(wfRow(12)).getByRole("button", { name: VI.common.delete }));
    dlg = await screen.findByRole("alertdialog");
    await user.click(within(dlg).getByRole("button", { name: VI.common.delete }));
    expect(calls("orchestration.deleteWorkflow")).toEqual([{ id: 12 }]);
  });

  it("không có quyền ⇒ Nhân bản / Xoá khoá; Phiên bản (chỉ đọc) vẫn mở", () => {
    perm.canControl = false;
    render(<OrchestrationStudio />);
    expect(within(wfRow(11)).getByRole("button", { name: S.duplicate })).toBeDisabled();
    expect(within(wfRow(11)).getByRole("button", { name: VI.common.delete })).toBeDisabled();
    expect(within(wfRow(11)).getByRole("button", { name: S.versions })).toBeEnabled();
  });

  it("Nạp quy trình đã lưu ⇒ canvas hiện các bước của nó", async () => {
    const user = userEvent.setup();
    render(<OrchestrationStudio />);
    await user.click(within(wfRow(11)).getByRole("button", { name: S.load }));
    expect(within(mainEl()).getByText("cmd-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: S.editName })).toHaveTextContent("Khởi động dây chuyền A");
  });
});

describe("Orchestration P2 — tiêu đề sửa tại chỗ", () => {
  it("bấm tên ⇒ ô nhập; Enter lưu; Esc huỷ; tên mới đi vào định nghĩa gửi Deploy (sau OTP)", async () => {
    const user = userEvent.setup();
    render(<OrchestrationStudio />);
    await user.click(within(leftPanel()).getByRole("button", { name: S.type.delay }));
    await user.click(screen.getByRole("button", { name: S.editName }));
    const input = screen.getByRole("textbox", { name: S.editName });
    expect(input).toHaveFocus();
    await user.type(input, "Dây chuyền C{Enter}");
    expect(screen.getByRole("button", { name: S.editName })).toHaveTextContent("Dây chuyền C");
    await user.click(screen.getByRole("button", { name: S.editName }));
    await user.type(screen.getByRole("textbox", { name: S.editName }), " xyz{Escape}");
    expect(screen.getByRole("button", { name: S.editName })).toHaveTextContent(/^Dây chuyền C$/);
    await user.click(screen.getByRole("button", { name: S.editRef }));
    await user.type(screen.getByRole("textbox", { name: S.editRef }), "line-c{Enter}");
    await user.click(screen.getByRole("button", { name: S.deploy }));
    const otp = await screen.findByRole("dialog", { name: VI.stepUp.title });
    expect(calls("orchestration.deployWorkflow")).toEqual([]);
    fireEvent.change(otp.querySelector("input") as HTMLInputElement, { target: { value: "654321" } });
    await waitFor(() => expect(calls("orchestration.deployWorkflow")).toHaveLength(1));
    expect(calls("orchestration.deployWorkflow")[0]).toEqual({
      definition: { ref: "line-c", name: "Dây chuyền C", version: 1, steps: [{ id: "delay-1", type: "delay", ms: 1000 }] },
      simToken: undefined,
      totpCode: "654321",
    });
  });

  it("mã (ref) trống ⇒ Chạy khoá; có mã ⇒ Chạy gọi startRun({workflowRef, params:{}}) MỘT lần, không hộp thoại", async () => {
    const user = userEvent.setup();
    render(<OrchestrationStudio />);
    expect(screen.getByRole("button", { name: S.run })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: S.editRef }));
    await user.type(screen.getByRole("textbox", { name: S.editRef }), "line-a-startup{Enter}");
    await user.click(screen.getByRole("button", { name: S.run }));
    expect(calls("orchestration.startRun")).toEqual([{ workflowRef: "line-a-startup", params: {} }]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("Orchestration P2 — R-2-n: hành động điều khiển giữ đúng đích/xác nhận/cổng cũ", () => {
  it("Deploy: Huỷ OTP ⇒ không gọi", async () => {
    const user = userEvent.setup();
    render(<OrchestrationStudio />);
    await user.click(within(leftPanel()).getByRole("button", { name: S.type.delay }));
    await user.click(screen.getByRole("button", { name: S.deploy }));
    const otp = await screen.findByRole("dialog", { name: VI.stepUp.title });
    await user.click(within(otp).getByRole("button", { name: VI.common.cancel }));
    expect(calls("orchestration.deployWorkflow")).toEqual([]);
  });

  it("FOE tắt ⇒ Deploy / Chạy khoá với lý do cờ", () => {
    srv.status = { enabled: false, simGateRequired: false };
    render(<OrchestrationStudio />);
    expect(screen.getByRole("button", { name: S.deploy })).toBeDisabled();
    expect(screen.getByRole("button", { name: S.run })).toBeDisabled();
  });

  it("Dừng run đang chạy: abortRun({runId}) MỘT lần, như cũ (không hộp thoại)", async () => {
    const user = userEvent.setup();
    render(<OrchestrationStudio />);
    await user.click(within(rowOf(3)).getByRole("button", { name: S.abort }));
    expect(calls("orchestration.abortRun")).toEqual([{ runId: 3 }]);
  });

  it("doc 81 Đợt 5 E fix 2 (R-5-l): abort REFUSED with scopeUnverified ⇒ the translated 'scope not verified — use the direct STOP' toast", async () => {
    const user = userEvent.setup();
    srv.results["orchestration.abortRun"] = { ok: false, enabled: true, runId: 3, reason: "scopeUnverified", message: "RAW server text" };
    render(<OrchestrationStudio />);
    await user.click(within(rowOf(3)).getByRole("button", { name: S.abort }));
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalled());
    const shown = String((toastSpy.error as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]);
    expect(shown).toBe(S.scopeUnverified);
    expect(shown).not.toContain("RAW server text");
  });

  // ── doc 81 Đợt 6 (owner decision 2026-10-11) — abort skips non-STOP steps but STILL SENDS the remaining STOP steps ──
  const ABORT_STOPS = { sent: [], failed: [], pending: [], unverified: [], untakenBranch: [], notPinned: [], notNeeded: [] };
  it("doc 81 Đợt 6: the Abort button says the remaining STOP steps are still sent (accessible description) — still one click, no dialog", async () => {
    const user = userEvent.setup();
    render(<OrchestrationStudio />);
    const btn = within(rowOf(3)).getByRole("button", { name: S.abort });
    expect(btn).toHaveAccessibleDescription(S.abortHint);
    await user.click(btn);
    expect(calls("orchestration.abortRun")).toEqual([{ runId: 3 }]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("doc 81 Đợt 6 + fix 1 #7: abort done ⇒ the confirmation counts only CONFIRMED STOPs; one awaiting its answer is said apart", async () => {
    const user = userEvent.setup();
    srv.results["orchestration.abortRun"] = { ok: true, enabled: true, runId: 3, status: "aborted", abortStops: { ...ABORT_STOPS, sent: ["stop", "ra"], pending: ["late"] } };
    render(<OrchestrationStudio />);
    await user.click(within(rowOf(3)).getByRole("button", { name: S.abort }));
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalled());
    expect(String((toastSpy.success as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0])).toBe(S.abortDone.replace("{{id}}", "3").replace("{{sent}}", "2"));
    expect(String((toastSpy.info as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0])).toBe(S.abortStopsPending.replace("{{count}}", "1"));
    expect(toastSpy.warning).not.toHaveBeenCalled();
  });

  it("doc 81 Đợt 6 + fix 1 #7: STOP steps not sent / not verified / in an untaken branch ⇒ a translated warning (direct STOP / E-STOP); unpinned steps are NOT counted as STOPs", async () => {
    const user = userEvent.setup();
    srv.results["orchestration.abortRun"] = { ok: true, enabled: true, runId: 3, status: "aborted", abortStops: { ...ABORT_STOPS, sent: ["ra"], failed: ["x"], unverified: ["stop"], untakenBranch: ["b1"], notPinned: ["u"] } };
    render(<OrchestrationStudio />);
    await user.click(within(rowOf(3)).getByRole("button", { name: S.abort }));
    await waitFor(() => expect(toastSpy.warning).toHaveBeenCalled());
    expect(String((toastSpy.warning as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0])).toBe(S.abortStopsNotSent.replace("{{count}}", "3"));
    expect((toastSpy.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))).toContain(S.abortNotPinned.replace("{{count}}", "1"));
  });

  it("doc 81 Đợt 6: abort NOT confirmed by the database in time ⇒ the translated error (never the raw server text), no success toast", async () => {
    const user = userEvent.setup();
    srv.results["orchestration.abortRun"] = { ok: false, enabled: true, runId: 3, reason: "abortUnconfirmed", message: "RAW server text", abortStops: { ...ABORT_STOPS, sent: ["stop"] } };
    render(<OrchestrationStudio />);
    await user.click(within(rowOf(3)).getByRole("button", { name: S.abort }));
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalled());
    const shown = String((toastSpy.error as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]);
    expect(shown).toBe(S.abortUnconfirmed.replace("{{sent}}", "1"));
    expect(shown).not.toContain("RAW server text");
    expect(toastSpy.success).not.toHaveBeenCalled();
  });

  it("doc 81 Đợt 6 fix 1 #7: abort NOT confirmed and NO STOP sent ⇒ the text says 0 confirmed (never claims STOPs were sent)", async () => {
    const user = userEvent.setup();
    srv.results["orchestration.abortRun"] = { ok: false, enabled: true, runId: 3, reason: "abortUnconfirmed", message: "x", abortStops: { ...ABORT_STOPS } };
    render(<OrchestrationStudio />);
    await user.click(within(rowOf(3)).getByRole("button", { name: S.abort }));
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalled());
    expect(String((toastSpy.error as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0])).toBe(S.abortUnconfirmed.replace("{{sent}}", "0"));
  });

  it("doc 81 Đợt 6 fix 1 (R-6-b): a run that never acted ⇒ the confirmation says its STOP steps were not needed", async () => {
    const user = userEvent.setup();
    srv.results["orchestration.abortRun"] = { ok: true, enabled: true, runId: 3, status: "aborted", abortStops: { ...ABORT_STOPS, notNeeded: ["stop", "ra"] } };
    render(<OrchestrationStudio />);
    await user.click(within(rowOf(3)).getByRole("button", { name: S.abort }));
    await waitFor(() => expect(toastSpy.info).toHaveBeenCalled());
    expect(String((toastSpy.info as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0])).toBe(S.abortStopsNotNeeded.replace("{{count}}", "2"));
    expect(toastSpy.warning).not.toHaveBeenCalled();
  });

  it("doc 81 Đợt 6 fix 1 (R-6-a): Reject says the remaining STOP steps are still sent, and its answer gets the same confirmation + warning", async () => {
    const user = userEvent.setup();
    srv.runs = [...RUNS_PLAIN, AWAITING].map((r) => ({ ...r }));
    srv.getRun = { run: { ...AWAITING }, defHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", steps: [] };
    srv.results["orchestration.resumeRun"] = { ok: false, enabled: true, runId: 30, status: "aborted", abortStops: { ...ABORT_STOPS, sent: ["stop"], unverified: ["s2"] } };
    render(<OrchestrationStudio />);
    await user.click(within(bottomPanel()).getByRole("tab", { name: new RegExp(S.awaitingTab) }));
    const rejectBtn = within(rowOf(30)).getByRole("button", { name: S.reject });
    expect(rejectBtn).toHaveAccessibleDescription(S.rejectHint);
    await user.click(rejectBtn);
    await user.click(within(rowOf(30)).getByRole("button", { name: S.confirmReject }));
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalled());
    expect(String((toastSpy.success as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0])).toBe(S.abortDone.replace("{{id}}", "30").replace("{{sent}}", "1"));
    expect(String((toastSpy.warning as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0])).toBe(S.abortStopsNotSent.replace("{{count}}", "1"));
  });

  it("doc 81 Đợt 6: the run's steps show the STOP steps the abort sent / could not send", async () => {
    const user = userEvent.setup();
    srv.getRun = {
      run: RUNS_PLAIN[0],
      steps: [
        { stepId: "abort:stop", stepType: "command", status: "completed", result: { abortStop: "sent", stepId: "stop", routedTo: "ot-dispatcher", status: "simulated", simulated: true, accepted: true } },
        { stepId: "abort:ra", stepType: "command", status: "failed", result: { abortStop: "failed", stepId: "ra" }, error: "rejected" },
        { stepId: "s1", stepType: "command", status: "completed", result: { routedTo: "ot-dispatcher", status: "simulated", simulated: true, accepted: true } },
      ],
    };
    render(<OrchestrationStudio />);
    await user.click(within(bottomPanel()).getByRole("tab", { name: new RegExp(S.runsTab) }));
    await user.click(screen.getByText(/run #1 ·/));
    await waitFor(() => expect(rowOf(1).querySelectorAll('[data-testid="abort-stop"]')).toHaveLength(2));
    const tags = Array.from(rowOf(1).querySelectorAll('[data-testid="abort-stop"]'));
    expect(tags.map((x) => x.getAttribute("data-kind"))).toEqual(["sent", "failed"]);
    expect(tags.map((x) => x.textContent)).toEqual([S.abortStopSent, S.abortStopFailed]);
  });

  it("Tiếp tục run bị gián đoạn: AlertDialog rồi resumeRun({runId, approved:true, expectedStepId})", async () => {
    const user = userEvent.setup();
    srv.runs = [INTERRUPTED].map((r) => ({ ...r }));
    srv.getRun = { run: { ...INTERRUPTED }, defHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", steps: [] }; // R-4-k: Continue sends the loaded hash
    render(<OrchestrationStudio />);
    await user.click(within(rowOf(31)).getByRole("button", { name: S.continueRun }));
    expect(calls("orchestration.resumeRun")).toEqual([]);
    const dlg = await screen.findByRole("alertdialog");
    await user.click(within(dlg).getByRole("button", { name: S.continueRunConfirm }));
    expect(calls("orchestration.resumeRun")).toEqual([{ runId: 31, approved: true, note: undefined, expectedStepId: "s-2", expectedDefHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]);
  });

  it("Duyệt ở tab Chờ duyệt gửi expectedStepId của gate đang hiển thị; không quyền ⇒ không có nút", async () => {
    const user = userEvent.setup();
    srv.runs = [AWAITING].map((r) => ({ ...r }));
    srv.getRun = { run: { ...AWAITING, currentStepId: "g-detail" }, defHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", steps: [] };
    const { unmount } = render(<OrchestrationStudio />);
    await user.click(within(rowOf(30)).getByRole("button", { name: S.approve }));
    expect(calls("orchestration.resumeRun")).toEqual([{ runId: 30, approved: true, note: undefined, expectedStepId: "g-detail", expectedDefHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]);
    unmount();
    perm.canControl = false;
    render(<OrchestrationStudio />);
    expect(within(rowOf(30)).queryByRole("button", { name: S.approve })).toBeNull();
  });
});

describe("doc 81 Đợt 3 Task 4 — 'Giao cho' run đang chờ duyệt", () => {
  it("run chờ duyệt: hàng hiện tên người được giao + khối ngữ cảnh có bộ chọn; nút Duyệt giữ nguyên payload", async () => {
    const user = userEvent.setup();
    srv.runs = [AWAITING].map((r) => ({ ...r }));
    srv.getRun = { run: { ...AWAITING, currentStepId: "g-1" }, defHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", steps: [] };
    render(<OrchestrationStudio />);
    const row = rowOf(30);
    expect(row.querySelector("[data-assignee-cell]")).toHaveTextContent("Ky su Run");
    const ctl = row.querySelector('[data-assign-control="orchestration_run"]') as HTMLElement;
    expect(within(ctl).getByRole("combobox", { name: VI.engineeringAssign.label })).toHaveTextContent("Ky su Run");
    await user.click(within(row).getByRole("button", { name: S.approve }));
    expect(calls("orchestration.resumeRun")).toEqual([{ runId: 30, approved: true, note: undefined, expectedStepId: "g-1", expectedDefHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]);
    expect(calls("engineering.assign")).toEqual([]);
  });

  it("không quyền điều khiển ⇒ không khối ngữ cảnh, không bộ chọn", () => {
    perm.canControl = false;
    srv.runs = [AWAITING].map((r) => ({ ...r }));
    render(<OrchestrationStudio />);
    expect(rowOf(30).querySelector("[data-assign-control]")).toBeNull();
  });
});

describe("Orchestration P2 — URL là nguồn sự thật (Review Focus 4)", () => {
  it("F5 trên ?flyout=orch-versions&flyoutId=11 ⇒ sheet phiên bản dựng lại đúng quy trình", async () => {
    window.history.replaceState(null, "", "/orchestration-studio?flyout=orch-versions&flyoutId=11");
    render(<OrchestrationStudio />);
    const l = await waitLayer("orch-versions");
    expect(within(l).getByText("v3")).toBeInTheDocument();
    expect(srv.queryInputs["orchestration.listVersions"]?.at(-1)).toEqual({ workflowId: 11 });
  });

  it("F5 trên ?tab=problems&flyout=orch-ai ⇒ panel dưới mở ở tab Vấn đề và trợ lý AI mở lại", async () => {
    window.history.replaceState(null, "", "/orchestration-studio?tab=problems&flyout=orch-ai&flyoutId=");
    render(<OrchestrationStudio />);
    await waitLayer("orch-ai");
    // Sheet modal đang mở ⇒ phần còn lại của trang bị aria-hidden: truy vấn kèm `hidden: true`.
    const toggle = () => screen.getByRole("button", { name: VI.layoutKit.shell.toggleBottom, hidden: true });
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-expanded", "true"));
    const panel = screen.getByRole("region", { name: S.bottomPanel, hidden: true });
    expect(within(panel).getByRole("tab", { name: new RegExp(S.problemsTab), hidden: true })).toHaveAttribute("aria-selected", "true");
    expect(within(panel).getByText(S.noSim)).toBeInTheDocument();
  });
});

describe("Orchestration P2 — i18n", () => {
  it("mọi khoá `studio.*` trang gọi qua t() có mặt, không rỗng ở vi/en/zh", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "client/src/pages/OrchestrationStudio.tsx"), "utf8");
    const keys = [...new Set([...src.matchAll(/\bt\(\s*"(studio\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]))];
    expect(keys.length).toBeGreaterThan(100);
    const EN = (await import("@/i18n/locales/en.json")).default as Record<string, unknown>;
    const ZH = (await import("@/i18n/locales/zh.json")).default as Record<string, unknown>;
    const get = (o: Record<string, unknown>, k: string) => k.split(".").reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], o);
    const missing = keys.flatMap((k) =>
      ([["vi", VI], ["en", EN], ["zh", ZH]] as const)
        .filter(([, o]) => typeof get(o as Record<string, unknown>, k) !== "string" || !(get(o as Record<string, unknown>, k) as string).trim())
        .map(([l]) => `${l}:${k}`),
    );
    expect(missing).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 4 fix round 3 (R-4-n / R-4-p)
// ════════════════════════════════════════════════════════════════════════════════════════════════════
describe("doc 81 Đợt 4 fix round 3 — robot picker (R-4-n) + hash pinned at first view (R-4-p)", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView ??= function () {};
    (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture ??= () => false;
  });

  it("★ R-4-n: a robot step shows a robot picker (in-scope robots only); the chosen robotId goes into the deployed definition", async () => {
    const user = userEvent.setup();
    srv.equipment = [
      { machineId: 7, name: "Robot cell", machineType: "ROBOT", adapterKind: "robot", capability: { adapterKind: "robot", supportedCommands: [{ name: "abort", label: "Abort" }] } },
    ];
    srv.robots = [{ id: 42, code: "R42", name: "Arm 42" }];
    srv.workflows = [
      { id: 21, ref: "rb-wf", name: "Robot WF", version: 1, status: "deployed", definitionJson: { ref: "rb-wf", name: "Robot WF", version: 1, steps: [{ id: "rb-1", type: "command", machineId: 7, command: "abort", args: {} }] } },
    ];
    render(<OrchestrationStudio />);
    await user.click(within(wfRow(21)).getByRole("button", { name: S.load }));
    await user.click(within(mainEl()).getByText("rb-1"));
    const picker = within(inspector()).getByTestId("robot-picker");
    fireEvent.click(within(picker).getByRole("combobox", { name: S.robot }));
    fireEvent.click(screen.getByRole("option", { name: /#42 · Arm 42/ }));
    await user.click(screen.getByRole("button", { name: S.deploy }));
    const otp = await screen.findByRole("dialog", { name: VI.stepUp.title });
    fireEvent.change(otp.querySelector("input") as HTMLInputElement, { target: { value: "654321" } });
    await waitFor(() => expect(calls("orchestration.deployWorkflow")).toHaveLength(1));
    const def = (calls("orchestration.deployWorkflow")[0] as { definition: { steps: Array<{ args?: Record<string, unknown> }> } }).definition;
    expect(def.steps[0].args).toEqual({ robotId: 42 });
  });

  it("R-4-n: a non-robot machine has no robot picker", async () => {
    const user = userEvent.setup();
    srv.equipment = [{ machineId: 8, name: "PLC line", machineType: "AUTOMATION", adapterKind: "ot-opcua", capability: { adapterKind: "ot-opcua", supportedCommands: [{ name: "start" }] } }];
    srv.workflows = [
      { id: 22, ref: "ot-wf", name: "OT WF", version: 1, status: "deployed", definitionJson: { ref: "ot-wf", name: "OT WF", version: 1, steps: [{ id: "ot-1", type: "command", machineId: 8, command: "start", args: {} }] } },
    ];
    render(<OrchestrationStudio />);
    await user.click(within(wfRow(22)).getByRole("button", { name: S.load }));
    await user.click(within(mainEl()).getByText("ot-1"));
    expect(within(inspector()).queryByTestId("robot-picker")).toBeNull();
  });

  it("R-4-n: deploy refused with robotIdMissing ⇒ translated toast naming the steps (no raw server message)", async () => {
    render(<OrchestrationStudio />);
    srv.results["orchestration.deployWorkflow"] = { ok: false, enabled: true, reason: "robotIdMissing", stepIds: ["mv", "ab"], message: "RAW server text" };
    // the mocked mutation answers onSuccess with srv.results (as the server would)
    const user = userEvent.setup();
    await user.click(within(leftPanel()).getByRole("button", { name: S.type.delay }));
    await user.click(screen.getByRole("button", { name: S.deploy }));
    const otp = await screen.findByRole("dialog", { name: VI.stepUp.title });
    fireEvent.change(otp.querySelector("input") as HTMLInputElement, { target: { value: "654321" } });
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalled());
    const shown = String((toastSpy.error as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]);
    expect(shown).toContain("mv, ab");
    expect(shown).not.toContain("RAW server text");
  });

  it("final wave G4: START refused by the definition checks (robotUnavailable) ⇒ translated 'not started' + the step sentence, no raw server English", async () => {
    const user = userEvent.setup();
    srv.results["orchestration.startRun"] = { ok: false, enabled: true, reason: "robotUnavailable", stepIds: ["ab"], message: "RAW server text" };
    render(<OrchestrationStudio />);
    await user.click(screen.getByRole("button", { name: S.editRef }));
    await user.type(screen.getByRole("textbox", { name: S.editRef }), "legacy{Enter}");
    await user.click(screen.getByRole("button", { name: S.run }));
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalled());
    const shown = String((toastSpy.error as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]);
    expect(shown).toBe(`${S.runRefusedDefinition} ${S.deployRobotUnavailable.replace("{{steps}}", "ab")}`);
    expect(shown).not.toContain("RAW server text");
  });

  it("★ R-4-p: the hash is pinned at the first view of the gate; a later poll with ANOTHER hash ⇒ 'definition changed, reload' + Approve disabled (no silent update)", async () => {
    const user = userEvent.setup();
    srv.runs = [AWAITING].map((r) => ({ ...r }));
    srv.getRun = { run: { ...AWAITING, currentStepId: "g-1" }, defHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", steps: [] };
    const view = render(<OrchestrationStudio />);
    expect(within(rowOf(30)).queryByTestId("definition-changed")).toBeNull();
    // the next poll returns a redeployed definition
    srv.getRun = { run: { ...AWAITING, currentStepId: "g-1" }, defHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", steps: [] };
    view.rerender(<OrchestrationStudio />);
    expect(within(rowOf(30)).getByTestId("definition-changed")).toHaveTextContent(S.definitionChangedReload);
    const approve = within(rowOf(30)).getByRole("button", { name: S.approve });
    expect(approve).toBeDisabled();
    await user.click(approve);
    expect(calls("orchestration.resumeRun") ?? []).toEqual([]);
  });

  it("R-4-p: same hash on later polls ⇒ no warning, the approval carries the FIRST-viewed hash", async () => {
    const user = userEvent.setup();
    srv.runs = [AWAITING].map((r) => ({ ...r }));
    srv.getRun = { run: { ...AWAITING, currentStepId: "g-1" }, defHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", steps: [] };
    const view = render(<OrchestrationStudio />);
    view.rerender(<OrchestrationStudio />);
    expect(within(rowOf(30)).queryByTestId("definition-changed")).toBeNull();
    await user.click(within(rowOf(30)).getByRole("button", { name: S.approve }));
    expect(calls("orchestration.resumeRun")).toEqual([{ runId: 30, approved: true, note: undefined, expectedStepId: "g-1", expectedDefHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]);
  });
});
