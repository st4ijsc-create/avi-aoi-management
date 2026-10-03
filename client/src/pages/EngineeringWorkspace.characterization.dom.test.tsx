// @vitest-environment jsdom
//
// doc 81 Đợt 2 Task 12 — TEST ĐẶC TẢ (characterization) cho EngineeringWorkspace (IDE `/engineering`),
// viết và chạy XANH trên mã CŨ (≈40 `useState` phẳng) TRƯỚC khi nâng state lên WorkspaceContext +
// reducer thuần. Review Focus #2: "chọn project phải reset artifact/build/sim/diagnostics như cũ;
// phải có test cho chuỗi reset này TRƯỚC khi tách".
//
// Khác `EngineeringWorkspace.dom.test.tsx` (mutate không bao giờ gọi onSuccess): ở đây mock trpc
// GỌI `onSuccess` của mutation với phản hồi do lưới định sẵn ⇒ diagnostics / buildId / simResult /
// watching thật sự được ĐẶT qua đúng đường của trang, rồi đo xem đổi project có XOÁ chúng không.
// Query tôn trọng `enabled: false` như react-query thật (không trả data) ⇒ artifactId/buildId "ôi"
// lộ ra thành build/preview của project cũ hiện dưới project mới.
//
// Copilot: dùng ProgrammingCopilotProvider THẬT (không mock context) — luồng SSE + Huỷ chạy trong panel Copilot của
// inspector (Task 13; dock cố định đã gỡ ở Task 14 — trước đó renderPage() vẽ kèm dock), fetch = SSE giả lưới tự bơm.
//
// doc 81 Đợt 2 Task 13 — bố cục P1 Workbench: khối ảnh chụp DOM byte-identical (chỉ chứng minh "Task 12 không đổi
// giao diện") đã XOÁ cùng thư mục __snapshots__/EngineeringWorkspace.dom/. Các test HÀNH VI giữ nguyên khẳng định;
// chỉ đổi BỘ CHỌN / thêm bước ĐIỀU HƯỚNG (mở wizard deploy, tới bước) — liệt kê ở task-13-report.md.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// doc 81 Đợt 2 Task 13 — trang dựng EngineeringShell/WorkbenchShell ⇒ nạp bản BROWSER thật của react-resizable-panels
// (layoutKitTestPanels.ts — hạ tầng test, không mock hành vi).
vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="dashboard-layout">{children}</div>,
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));
vi.mock("@/lib/socketManager", () => ({
  getSharedSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false }),
  releaseSharedSocket: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
// CodeMirror không gõ được trong jsdom ⇒ thay bằng textarea (cùng aria-label) để GÕ được vào buffer.
vi.mock("@/components/engineering/CodeEditor", () => ({
  CodeEditor: (p: { value: string; onChange?: (v: string) => void; language?: string; "aria-label"?: string }) => (
    <textarea
      aria-label={p["aria-label"]}
      data-language={p.language}
      value={p.value}
      readOnly={!p.onChange}
      onChange={(e) => p.onChange?.(e.target.value)}
    />
  ),
}));
vi.mock("@/components/diff/HunkDiffView", () => ({ HunkDiffView: () => null }));

// ─── trpc giả ────────────────────────────────────────────────────────────────────────────────────
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
    data: undefined, isLoading: false, isPending: false, isFetching: false, isError: false,
    error: null, dataUpdatedAt: undefined, refetch: vi.fn(), ...overrides,
  };
}
type QueryFn = (input: unknown) => QueryResult;
const queryOverrides: Record<string, QueryFn> = {};
const queryInputs: Record<string, unknown> = {};
const queryEnabled: Record<string, boolean | undefined> = {};
const mutateCalls: Record<string, unknown[]> = {};
/** Phản hồi của mutation ⇒ mock GỌI onSuccess(resp) như react-query. */
const mutationResponses: Record<string, ((vars: any) => unknown) | undefined> = {};
/** `.data` của mutation (vd deployToFleet ⇒ fleetResult). */
const mutationData: Record<string, unknown> = {};
/** doc 81 Đợt 2 Task 12b — mutation HOÃN: onSuccess chỉ chạy khi lưới gọi `xaHoan(key)` (đua kết quả muộn). */
const mutationDeferred = new Set<string>();
const mutationPending: Record<string, Array<() => void>> = {};
/** Task 12b — mutation THẤT BẠI: mutateAsync bị reject (như react-query khi server ném). */
const mutationFails = new Set<string>();
/** Tuỳ chọn useMutation của lượt render MỚI NHẤT — react-query v5 `MutationObserver.setOptions` cập nhật
 *  tuỳ chọn (kể cả onSuccess) của mutation đang chạy mỗi lượt render ⇒ kết quả về muộn chạy closure MỚI. */
const latestMutOpts: Record<string, { onSuccess?: (d: unknown, v: unknown) => void } | undefined> = {};
function xaHoan(key: string) {
  const q = mutationPending[key] ?? [];
  mutationPending[key] = [];
  act(() => { for (const f of q) f(); });
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
                useQuery: (input?: unknown, opts?: { enabled?: boolean }) => {
                  queryInputs[key] = input;
                  queryEnabled[key] = opts?.enabled;
                  // react-query thật: enabled=false ⇒ không có data.
                  if (opts?.enabled === false) return makeQuery();
                  return queryOverrides[key] ? queryOverrides[key](input) : makeQuery();
                },
                useMutation: (mopts?: { onSuccess?: (d: unknown, v: unknown) => void }) => (latestMutOpts[key] = mopts, {
                  mutate: (vars: unknown) => {
                    (mutateCalls[key] ??= []).push(vars);
                    const r = mutationResponses[key];
                    if (mutationFails.has(key)) return;
                    if (r && mutationDeferred.has(key)) {
                      (mutationPending[key] ??= []).push(() => latestMutOpts[key]?.onSuccess?.(r(vars), vars));
                      return;
                    }
                    if (r) mopts?.onSuccess?.(r(vars), vars);
                  },
                  mutateAsync: (vars: unknown) => {
                    (mutateCalls[key] ??= []).push(vars);
                    if (mutationFails.has(key)) return Promise.reject(new Error(`${key} failed`));
                    const r = mutationResponses[key];
                    const d = r ? r(vars) : undefined;
                    if (r) mopts?.onSuccess?.(d, vars);
                    return Promise.resolve(d);
                  },
                  reset: vi.fn(),
                  data: mutationData[key],
                  isPending: false,
                  isError: false,
                }),
              };
            },
          },
        );
      },
    },
  ),
}));

import EngineeringWorkspace from "./EngineeringWorkspace";
import { ProgrammingCopilotProvider } from "@/contexts/ProgrammingCopilotContext";

// ─── dữ liệu ─────────────────────────────────────────────────────────────────────────────────────
const ME = 8;
const P1 = { id: 1, name: "Cell One", code: "C1", kind: "zmotion-basic", deviceId: 3, defaultBranch: "main" };
const P2 = { id: 2, name: "Ladder Two", code: "L2", kind: "iec61131-ld", deviceId: null, defaultBranch: "main" };
const art = (o: Record<string, unknown>) => ({
  projectId: 1, branch: "main", kind: "zmotion-basic", language: "basic", status: "draft",
  reviewStatus: "pending_review", createdBy: 7, diagnosticsJson: null, ...o,
});
const ARTS: Record<number, unknown[]> = {
  1: [art({ id: 11, version: 1, content: "A\nB" }), art({ id: 12, version: 2, content: "A\nC" })],
  2: [art({ id: 21, projectId: 2, version: 1, content: "LD-CODE", kind: "iec61131-ld", language: "ld" })],
};
const BUILDS: Record<number, unknown[]> = {
  11: [{ id: 5, ok: true, status: "ok" }, { id: 6, ok: false, status: "failed" }],
  12: [{ id: 7, ok: true, status: "ok" }],
  21: [{ id: 9, ok: true, status: "ok" }],
};
const PREVIEW = (buildId: number, stage: string) => ({
  verdict: "real",
  gates: [{ name: "buildOk", ok: true, reason: "buildOk" }, { name: "signOff", ok: true, reason: "signOff" }],
  target: { adapterKind: "zmotion-basic", stage, deviceId: 3, path: "direct", artifactVersion: buildId },
});

function seed(o: { reviewOn?: boolean; deployEnabled?: boolean; projects?: unknown[]; deepLink?: number | null } = {}) {
  const deep = o.deepLink === undefined ? 1 : o.deepLink;
  window.history.pushState({}, "", deep == null ? "/engineering" : `/engineering?projectId=${deep}`);
  queryOverrides["auth.me"] = () => makeQuery({ data: { id: ME, role: "supervisor", name: "Sup", twoFactorEnabled: true } });
  queryOverrides["programming.status"] = () =>
    makeQuery({
      data: {
        deployEnabled: o.deployEnabled ?? true, streamingEnabled: true, deployApprovalEnabled: false,
        versionReviewEnabled: o.reviewOn ?? false,
        adapters: [{ kind: "stub", implemented: true }, { kind: "zmotion-basic", implemented: true }],
      },
    });
  queryOverrides["programming.listProjects"] = () => makeQuery({ data: o.projects ?? [P1, P2] });
  queryOverrides["machine.list"] = () => makeQuery({ data: [{ id: 3, name: "M3" }, { id: 4, name: "M4" }] });
  queryOverrides["programming.listArtifacts"] = (i) => makeQuery({ data: ARTS[(i as { projectId: number }).projectId] ?? [] });
  queryOverrides["programming.listBuilds"] = (i) => makeQuery({ data: BUILDS[(i as { artifactId: number }).artifactId] ?? [] });
  queryOverrides["programming.deployPreview"] = (i) => {
    const x = i as { buildId: number; stage: string };
    return makeQuery({ data: PREVIEW(x.buildId, x.stage) });
  };
  queryOverrides["programming.listDeployments"] = (i) =>
    makeQuery({ data: (i as { projectId: number }).projectId === 1 ? [{ id: 90, stage: "staging", status: "simulated", simulated: true }] : [] });
  queryOverrides["programming.listSymbols"] = (i) =>
    makeQuery({
      data: (i as { projectId: number }).projectId === 1
        ? [{ id: 31, name: "X0", address: "D100", dataType: "INT", comment: "start", watchable: true }]
        : [],
    });
  queryOverrides["programming.fleetVersionMatrix"] = () =>
    makeQuery({ data: [{ deviceId: 3, version: 1, branch: "main", stage: "staging", status: "simulated", simulated: true, contentHash: "abcdef0123456789" }] });
  queryOverrides["programming.listApprovers"] = () => makeQuery({ data: [{ id: ME, name: "Me" }, { id: 9, name: "Approver Nine" }] });

  mutationResponses["programming.validateArtifact"] = () => ({
    ok: false,
    diagnostics: [{ severity: "error", message: "DIAG-ERR-1", line: 2 }, { severity: "warning", message: "DIAG-WARN-2" }],
  });
  mutationResponses["programming.simulateBuild"] = () => ({ ok: true, warnings: ["SIM-WARN-1"], timeline: [{}, {}, {}] });
  mutationResponses["programming.startWatch"] = () => ({ started: true });
  mutationResponses["programming.stopWatch"] = () => ({});
  mutationResponses["programming.buildArtifact"] = () => ({ id: 6, ok: true });
  mutationResponses["programming.createArtifact"] = () => ({ id: 12, version: 2 });
  mutationResponses["programming.createProject"] = () => ({ id: 2, defaultBranch: "main" });
  mutationResponses["programming.upsertSymbol"] = () => ({});
  mutationResponses["programming.updateProject"] = () => ({});
  mutationResponses["programming.reviewArtifact"] = (v: { decision: string }) => ({ reviewStatus: v.decision });
  mutationResponses["programming.requestVersionReview"] = () => ({});
}

function renderPage() {
  return render(
    <ProgrammingCopilotProvider>
      <EngineeringWorkspace />
    </ProgrammingCopilotProvider>,
  );
}

const editor = () => screen.getByLabelText("program-source") as HTMLTextAreaElement;
const versionBtn = (re: RegExp) => screen.getByText(re, { selector: "button" });
const projectBtn = (name: string) => screen.getByText(name, { selector: "button span" }).closest("button")!;
const btn = (re: RegExp) => screen.getByRole("button", { name: re });
/** Task 13 — nút Build ở top bar (thay nút của card editor). */
const buildBtn = () => btn(/^Build$/);
/** Task 13 — nút MỞ wizard deploy 4 bước ở top bar (thay hai nút Deploy / Triển khai canary của hai card cũ). */
const deployOpener = () => btn(/^(Deploy…)$/);
const wizard = () => screen.getByRole("dialog");
/** Task 13 — chỉ ĐIỀU HƯỚNG wizard deploy tới bước n (0 Build · 1 Đích & canary · 2 Ký duyệt · 3 Xem trước & xác nhận). */
function toWizardStep(n: number) {
  if (!screen.queryByRole("dialog")) fireEvent.click(deployOpener());
  const d = wizard();
  for (let guard = 0; guard < 8; guard++) {
    const cur = within(d).getAllByRole("listitem").findIndex((li) => li.getAttribute("aria-current") === "step");
    if (cur === n) return;
    fireEvent.click(within(d).getByRole("button", { name: cur < n ? /^(Next|Tiếp)$/ : /^(Back|Quay lại)$/ }));
  }
  throw new Error(`wizard: không tới được bước ${n}`);
}
const closeWizard = () => fireEvent.keyDown(wizard(), { key: "Escape" });
/** Task 13 — máy đích đội máy nằm ở bước "Đích & canary" của wizard, chế độ "Đội máy (canary)". */
function fleetCardOpen() {
  toWizardStep(1);
  fireEvent.click(within(wizard()).getByRole("radio", { name: /Fleet|Đội máy/ }));
  return within(wizard());
}
const fleetBox = (label: string) => {
  const l = Array.from(wizard().querySelectorAll("label")).find((x) => x.textContent === label);
  if (!l) throw new Error(`fleet label not found: ${label}`);
  return l.querySelector('[role="checkbox"]') as HTMLElement;
};
/**
 * Task 13 fix round 1 (review Minor 2) — đối chứng MẠNH cho "máy đội bị xoá khi đổi dự án": đang ở P2, chọn phiên bản +
 * build CỦA P2 (#9), mở wizard ở chế độ Đội máy ⇒ mọi checkbox máy chưa tick, nút triển khai đội máy khoá kèm lý do, bấm
 * không ra OTP, 0 deployToFleet; tóm tắt explorer không nhắc M3.
 */
function expectFleetResetQuaWizardP2() {
  fireEvent.click(versionBtn(/^v1 · main/));
  const hoi = screen.queryByRole("alertdialog"); // buffer cũ của P1 còn ⇒ trang hỏi bỏ thay đổi
  if (hoi) fireEvent.click(within(hoi).getByRole("button", { name: /Discard & continue|Bỏ thay đổi/ }));
  fireEvent.click(screen.getByText("#9"));
  expect(fleetSelection()).toHaveAttribute("data-count", "0");
  expect(fleetSelection()).not.toHaveTextContent("M3");
  fleetCardOpen();
  expect(fleetBox("M3 · #3")).toHaveAttribute("aria-checked", "false");
  expect(fleetBox("M4 · #4")).toHaveAttribute("aria-checked", "false");
  toWizardStep(3);
  expect(screen.getByTestId("engineering-fleet-deploy-button")).toBeDisabled();
  expect(screen.getByTestId("ide-wizard-not-ready")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("engineering-fleet-deploy-button"));
  expect(screen.queryByText(/Two-step verification to deploy|Xác thực 2 bước/)).not.toBeInTheDocument();
  expect(mutateCalls["programming.deployToFleet"]).toBeUndefined();
  closeWizard();
}
/** Task 13 — tóm tắt máy đội đã chọn (explorer › Deploy) — quan sát được cả khi CHƯA có build (wizard không mở được). */
const fleetSelection = () => screen.getByTestId("ide-fleet-targets");

/** Đặt đủ bốn thứ của chuỗi reset trên P1: artifact v1, diagnostics, build #5, simResult (+ watch, fleet). */
function armP1() {
  fireEvent.click(versionBtn(/^v1 · main/));
  expect(editor().value).toBe("A\nB");
  fireEvent.click(btn(/^(Validate|Kiểm tra)$/));
  fireEvent.click(screen.getByText("#5"));
  fireEvent.click(btn(/Simulate \(twin\)|Mô phỏng \(twin\)/));
  fireEvent.click(btn(/Watch live|Theo dõi trực tiếp/));
  fleetCardOpen();
  fireEvent.click(fleetBox("M3 · #3"));
  expect(fleetBox("M3 · #3")).toHaveAttribute("aria-checked", "true");
  closeWizard();
  // tiền điều kiện: cả bốn (và watch/fleet) ĐANG hiện
  expect(screen.getByText(/DIAG-ERR-1/)).toBeInTheDocument();
  expect(screen.getByTestId("deploy-preview")).toBeInTheDocument();
  expect(queryInputs["programming.deployPreview"]).toMatchObject({ buildId: 5 });
  expect(screen.getByText(/SIM-WARN-1/)).toBeInTheDocument();
  expect(btn(/Stop watch|Dừng theo dõi/)).toBeInTheDocument();
  expect(fleetSelection()).toHaveAttribute("data-count", "1");
  expect(queryEnabled["programming.listBuilds"]).toBe(true);
}

function expectChainReset() {
  expect(screen.queryByText(/DIAG-ERR-1/)).not.toBeInTheDocument(); // diagnostics
  expect(screen.queryByText(/SIM-WARN-1/)).not.toBeInTheDocument(); // simResult
  expect(screen.queryByTestId("deploy-preview")).not.toBeInTheDocument(); // buildId
  expect(queryEnabled["programming.deployPreview"]).toBe(false);
  expect(screen.queryByText("#5")).not.toBeInTheDocument(); // artifactId (build list của v1 cũ)
  expect(queryEnabled["programming.listBuilds"]).toBe(false);
  expect(screen.queryByRole("button", { name: /Stop watch|Dừng theo dõi/ })).not.toBeInTheDocument(); // watching
  expect(fleetSelection()).toHaveAttribute("data-count", "0"); // fleetDeviceIds (Task 13: wizard không mở được khi chưa có build)
}

// ─── SSE giả cho Copilot ─────────────────────────────────────────────────────────────────────────
interface LuongGia { body: Record<string, unknown>; signal: AbortSignal; day: (o: unknown) => void; dong: () => void }
let luot: LuongGia[] = [];
function fetchGia(_url: string, init: RequestInit): Promise<Response> {
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  let daDong = false;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
  const signal = init.signal as AbortSignal;
  signal.addEventListener("abort", () => {
    if (!daDong) { daDong = true; ctl.error(new DOMException("Aborted", "AbortError")); }
  });
  luot.push({
    body: JSON.parse(String(init.body)),
    signal,
    day: (o) => !daDong && ctl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`)),
    dong: () => { if (!daDong) { daDong = true; ctl.close(); } },
  });
  return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));
}
const nghi = () => act(() => new Promise((r) => setTimeout(r, 20)));

beforeEach(() => {
  for (const o of [queryOverrides, queryInputs, queryEnabled, mutateCalls, mutationResponses, mutationData, mutationPending]) {
    for (const k of Object.keys(o)) delete (o as Record<string, unknown>)[k];
  }
  mutationDeferred.clear();
  mutationFails.clear();
  for (const f of Object.values(toasts)) f.mockReset();
  try { window.localStorage.clear(); } catch { /* ignore */ }
  luot = [];
  vi.stubGlobal("fetch", vi.fn(fetchGia));
  Element.prototype.scrollIntoView ??= function () {};
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture ??= () => false;
  (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture ??= () => {};
  // input-otp (hộp OTP step-up) cần ResizeObserver.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Chuỗi reset khi đổi projectId (Review Focus #2)", () => {
  it("chọn project KHÁC ⇒ artifact / build / simResult / diagnostics (+ watching, máy đội) đều về rỗng", () => {
    seed();
    renderPage();
    armP1();
    fireEvent.click(projectBtn("Ladder Two"));
    expectChainReset();
    // project mới thật sự được chọn: phiên bản của P2 hiện, KHÔNG phiên bản nào đang chọn
    const v = versionBtn(/^v1 · main/);
    expect(v.className).not.toMatch(/border-primary/);
    expect(queryInputs["programming.listArtifacts"]).toEqual({ projectId: 2 });
    // Hành vi CŨ: buffer KHÔNG xoá khi đổi project (chỉ ngôn ngữ đổi theo loại dự án mới).
    expect(editor().value).toBe("A\nB");
    expect(editor().getAttribute("data-language")).toBe("ld");
    expectFleetResetQuaWizardP2();
  });

  it("bấm lại CHÍNH project đang chọn ⇒ không reset gì", () => {
    seed();
    renderPage();
    armP1();
    fireEvent.click(projectBtn("Cell One"));
    expect(screen.getByText(/DIAG-ERR-1/)).toBeInTheDocument();
    expect(screen.getByText(/SIM-WARN-1/)).toBeInTheDocument();
    expect(screen.getByTestId("deploy-preview")).toBeInTheDocument();
    expect(btn(/Stop watch|Dừng theo dõi/)).toBeInTheDocument();
  });

  it("buffer CHƯA LƯU ⇒ hỏi trước; Huỷ ⇒ giữ nguyên; xác nhận ⇒ mới chạy chuỗi reset", async () => {
    seed();
    renderPage();
    armP1();
    fireEvent.change(editor(), { target: { value: "A\nB\nDIRTY" } });
    expect(screen.getByText(/^(Unsaved|Chưa lưu)$/)).toBeInTheDocument();
    fireEvent.click(projectBtn("Ladder Two"));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg).toHaveTextContent(/Discard unsaved changes\?|Bỏ thay đổi chưa lưu\?/);
    // chưa xác nhận ⇒ chưa reset
    expect(screen.getByText(/DIAG-ERR-1/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: /^(Cancel|Hủy)$/ }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText(/DIAG-ERR-1/)).toBeInTheDocument();
    expect(queryInputs["programming.listArtifacts"]).toEqual({ projectId: 1 });

    fireEvent.click(projectBtn("Ladder Two"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /Discard & continue|Bỏ thay đổi/ }));
    expectChainReset();
    expect(queryInputs["programming.listArtifacts"]).toEqual({ projectId: 2 });
    expectFleetResetQuaWizardP2();
  });

  it("đổi PHIÊN BẢN (WS-05) ⇒ build / simResult / diagnostics về rỗng; watching + máy đội GIỮ", () => {
    seed();
    renderPage();
    armP1();
    fireEvent.click(versionBtn(/^v2 · main/));
    expect(screen.queryByText(/DIAG-ERR-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SIM-WARN-1/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("deploy-preview")).not.toBeInTheDocument();
    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(editor().value).toBe("A\nC");
    expect(btn(/Stop watch|Dừng theo dõi/)).toBeInTheDocument();
    expect(fleetSelection()).toHaveAttribute("data-count", "1"); // Task 13: build đã bỏ ⇒ đọc tóm tắt máy đội
  });

  it("LƯU phiên bản mới (createArtifact ⇒ artifactId mới) ⇒ build / simResult / diagnostics về rỗng", () => {
    seed();
    renderPage();
    armP1();
    fireEvent.change(editor(), { target: { value: "A\nC" } });
    fireEvent.click(btn(/^(Save version|Lưu phiên bản)$/));
    expect(mutateCalls["programming.createArtifact"]).toEqual([{ projectId: 1, branch: "main", language: "basic", content: "A\nC" }]);
    expect(screen.queryByText(/DIAG-ERR-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SIM-WARN-1/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("deploy-preview")).not.toBeInTheDocument();
    expect(versionBtn(/^v2 · main/).className).toMatch(/border-primary/);
  });

  // Task 12b fix round 1 (review Minor 2) — Build mới XOÁ verdict mô phỏng của build trước (trước đây
  // giữ ⇒ verdict của build A hiện dưới build B; đổi khẳng định có chủ đích, theo phán quyết).
  it("chọn build KHÁC ⇒ simResult về rỗng; Build mới (buildArtifact) đổi build đang chọn và XOÁ simResult", () => {
    seed();
    renderPage();
    armP1();
    fireEvent.click(buildBtn());
    expect(queryInputs["programming.deployPreview"]).toMatchObject({ buildId: 6 });
    expect(screen.queryByText(/SIM-WARN-1/)).not.toBeInTheDocument();
    expect(screen.getByText(/DIAG-ERR-1/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("#5"));
    expect(queryInputs["programming.deployPreview"]).toMatchObject({ buildId: 5 });
    expect(screen.queryByText(/SIM-WARN-1/)).not.toBeInTheDocument();
    expect(screen.getByText(/DIAG-ERR-1/)).toBeInTheDocument();
  });

  it("deep-link ?projectId= áp MỘT lần khi danh sách đã tải; id mồ côi ⇒ không chọn gì", () => {
    seed({ deepLink: 2 });
    renderPage();
    expect(queryInputs["programming.listArtifacts"]).toEqual({ projectId: 2 });
    cleanup();
    seed({ deepLink: 999 });
    renderPage();
    expect(screen.getByText(/Select a project to get started|Chọn một dự án để bắt đầu/)).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Duyệt phiên bản trong IDE (Đợt 1 Task 5)", () => {
  it("cờ BẬT: chờ duyệt ⇒ Build khoá kèm lý do; Duyệt ⇒ reviewArtifact(approved); Từ chối bắt buộc lý do", () => {
    seed({ reviewOn: true });
    renderPage();
    fireEvent.click(versionBtn(/^v1 · main/));
    expect(buildBtn()).toBeDisabled();
    expect(screen.getByTestId("build-review-lock")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("version-review-approve"));
    expect(mutateCalls["programming.reviewArtifact"]).toEqual([{ artifactId: 11, decision: "approved" }]);
    fireEvent.click(screen.getByTestId("version-review-reject"));
    expect(screen.getByTestId("version-review-reject-confirm")).toBeDisabled();
    fireEvent.change(screen.getByTestId("version-review-reject-reason"), { target: { value: "Thiếu interlock" } });
    fireEvent.click(screen.getByTestId("version-review-reject-confirm"));
    expect(mutateCalls["programming.reviewArtifact"]?.[1]).toEqual({ artifactId: 11, decision: "rejected", reason: "Thiếu interlock" });
    // Ctrl+Enter cũng không build khi bị khoá vì review
    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    expect(mutateCalls["programming.buildArtifact"]).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("deployPreview hiện TRƯỚC OTP", () => {
  it("staging: preview hiện ngay khi chọn build, CHƯA có hộp OTP; bấm Deploy ⇒ hộp OTP, chưa gọi deployBuild; nhập OTP ⇒ deployBuild đúng tham số", async () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn(/^v1 · main/));
    fireEvent.click(screen.getByText("#5"));
    expect(screen.getByTestId("deploy-preview")).toHaveAttribute("data-verdict", "real");
    expect(screen.queryByText(/Two-step verification to deploy|Xác thực 2 bước/)).not.toBeInTheDocument();
    toWizardStep(2);
    fireEvent.click(screen.getByTestId("engineering-deploy-signoff"));
    expect(queryInputs["programming.deployPreview"]).toEqual({ buildId: 5, stage: "staging", confirmedBy: ME, expectedProjectId: 1 });
    toWizardStep(3);
    fireEvent.click(screen.getByTestId("engineering-deploy-button"));
    expect(screen.getByText(/Two-step verification to deploy|Xác thực 2 bước/)).toBeInTheDocument();
    expect(mutateCalls["programming.deployBuild"]).toBeUndefined();
    const otp = document.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(otp, { target: { value: "123456" } }); });
    await nghi();
    expect(mutateCalls["programming.deployBuild"]).toHaveLength(1);
    expect(mutateCalls["programming.deployBuild"]![0]).toMatchObject({
      buildId: 5, stage: "staging", confirmedBy: ME, totpCode: "123456", reason: undefined,
    });
  });

  it("production: chọn người ký + lý do ⇒ preview nhận confirmedBy = người ký; Deploy khoá tới khi đủ", async () => {
    const user = userEvent.setup();
    seed();
    renderPage();
    fireEvent.click(versionBtn(/^v1 · main/));
    fireEvent.click(screen.getByText("#5"));
    toWizardStep(2);
    const deployCard = within(wizard());
    await user.click(deployCard.getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: "production" }));
    expect(queryInputs["programming.deployPreview"]).toEqual({ buildId: 5, stage: "production", confirmedBy: undefined, expectedProjectId: 1 });
    toWizardStep(3);
    expect(screen.getByTestId("engineering-deploy-button")).toBeDisabled();
    toWizardStep(2);
    await user.click(deployCard.getAllByRole("combobox")[1]);
    expect(screen.queryByRole("option", { name: "Me" })).not.toBeInTheDocument(); // không tự ký
    await user.click(screen.getByRole("option", { name: "Approver Nine" }));
    expect(queryInputs["programming.deployPreview"]).toEqual({ buildId: 5, stage: "production", confirmedBy: 9, expectedProjectId: 1 });
    toWizardStep(3);
    expect(screen.getByTestId("engineering-deploy-button")).toBeDisabled();
    toWizardStep(2);
    fireEvent.change(wizard().querySelector("textarea")!, { target: { value: "ECN-42" } });
    toWizardStep(3);
    expect(screen.getByTestId("engineering-deploy-button")).not.toBeDisabled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Copilot (dock thật) — binding của trang, stream + Huỷ, Apply chèn vào buffer", () => {
  // Task 13 — card "Trợ lý Lập trình AI" (nút "Mở Trợ lý") đã bỏ; Copilot là tab của inspector TRONG layout (Task 14: dock
  // cố định đã gỡ khỏi mã — renderPage() không còn vẽ kèm nó).
  async function moDock() {
    fireEvent.click(screen.getByRole("tab", { name: /Copilot/ }));
    await screen.findByPlaceholderText(/Describe what to generate/);
  }
  async function chay(req: string) {
    fireEvent.change(screen.getByPlaceholderText(/Describe what to generate/), { target: { value: req } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Generate$/ })); });
    await nghi();
  }

  it("stream nhận kind của project; bấm Huỷ ⇒ fetch bị abort, trạng thái Đã huỷ", async () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn(/^v1 · main/));
    await moDock();
    await chay("toggle a run bit");
    expect(luot).toHaveLength(1);
    expect(luot[0].body).toMatchObject({ kind: "zmotion-basic", mode: "generate", request: "toggle a run bit" });
    luot[0].day({ type: "stage", stage: "gate", elapsedMs: 0 });
    await nghi();
    await act(async () => { fireEvent.click(screen.getByTestId("copilot-cancel")); });
    await nghi();
    expect(luot[0].signal.aborted).toBe(true);
    expect(screen.queryByTestId("copilot-cancel")).toBeNull();
    expect(screen.getAllByRole("status").some((s) => /Cancelled/.test(s.textContent ?? ""))).toBe(true);
  });

  it("kết quả stream ⇒ Apply NỐI mã vào buffer của trang (chưa lưu)", async () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn(/^v1 · main/));
    await moDock();
    await chay("add a step");
    luot[0].day({ type: "result", result: { ok: true, refused: false, kind: "zmotion-basic", code: "GEN", validation: { ok: true, diagnostics: [] } } });
    luot[0].dong();
    await nghi();
    fireEvent.click(screen.getByRole("button", { name: /Apply to editor/ }));
    expect(editor().value).toBe("A\nB\n\nGEN");
    expect(screen.getByText(/^(Unsaved|Chưa lưu)$/)).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("FeatureStatusGate 4 trạng thái", () => {
  const cases = [
    ["loading", makeQuery({ isLoading: true, isPending: true }), "feature-status-loading", "…"],
    ["off", makeQuery({ data: { deployEnabled: false } }), "feature-status-off", "OFF"],
    ["error", makeQuery({ isError: true }), "feature-status-error", "?"],
    ["on", makeQuery({ data: { deployEnabled: true } }), null, "ON"],
  ] as const;
  it.each(cases)("%s", (_n, q, testId, badge) => {
    seed();
    queryOverrides["programming.status"] = () => q;
    renderPage();
    for (const id of ["feature-status-loading", "feature-status-off", "feature-status-error"]) {
      if (id === testId) expect(screen.getByTestId(id)).toBeInTheDocument();
      else expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    expect(screen.getByTestId("engineering-deploy-badge")).toHaveTextContent(new RegExp(`: ${badge.replace("?", "\\?")}$`));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 2 Task 12b (Ruling R-2-r) — mối nguy deploy CHÉO dự án. Đặt SAU khối ảnh chụp: id Radix
// là bộ đếm toàn cục theo thứ tự mount, chèn test phía trước sẽ làm lệch ảnh chụp của task 12.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const deployBtnEl = () => screen.getByTestId("engineering-deploy-button");
const fleetBtnEl = () => screen.getByTestId("engineering-fleet-deploy-button");

/** Đang hiện P2 (vừa tạo / vừa chuyển tới) ⇒ KHÔNG có đường nào dùng build của P1. */
function expectKhongDungDuocBuildCu() {
  expect(screen.getByText(/Ladder Two · (Versions|Phiên bản)/)).toBeInTheDocument();
  expect(screen.queryByText("#5")).not.toBeInTheDocument();
  expect(screen.queryByText("#6")).not.toBeInTheDocument();
  expect(queryEnabled["programming.listBuilds"]).toBe(false);
  expect(screen.queryByTestId("deploy-preview")).not.toBeInTheDocument();
  expect(queryEnabled["programming.deployPreview"]).toBe(false);
  // Task 13 — Deploy đơn VÀ đội máy đi qua MỘT lối: wizard deploy; không có build của dự án này ⇒ nút mở wizard KHOÁ, bấm
  // không mở (máy đích đội máy chỉ chọn được TRONG wizard ⇒ bước "tick lại một máy" của thẻ cũ không còn đường tới).
  expect(deployOpener()).toBeDisabled();
  expect(screen.queryByText(/DIAG-ERR-1/)).not.toBeInTheDocument();
  expect(screen.queryByText(/SIM-WARN-1/)).not.toBeInTheDocument();
  fireEvent.click(deployOpener());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByTestId("engineering-deploy-button")).toBeNull();
  expect(screen.queryByTestId("engineering-fleet-deploy-button")).toBeNull();
  expect(screen.queryByText(/Two-step verification to deploy|Xác thực 2 bước/)).not.toBeInTheDocument();
  expect(mutateCalls["programming.deployBuild"]).toBeUndefined();
  expect(mutateCalls["programming.deployToFleet"]).toBeUndefined();
  expectFleetResetQuaWizardP2();
}

describe("Task 12b (a) — tạo dự án mới reset như bấm chọn dự án", () => {
  it("'+ tạo dự án' khi P1 đang có build/sim/diagnostics ⇒ P2 mở sạch; Deploy/Fleet không dùng được build cũ", () => {
    seed();
    renderPage();
    armP1();
    const plus = btn(/^(New project|Dự án mới)$/); // Task 13: nút "+" có nhãn (header có nút popover khác cũng aria-haspopup=dialog)
    fireEvent.click(plus);
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveTextContent(/New project|Dự án mới/);
    fireEvent.change(within(dlg).getByPlaceholderText("ZMC-CELL-01"), { target: { value: "L2" } });
    fireEvent.change(dlg.querySelectorAll("input")[1], { target: { value: "Ladder Two" } });
    fireEvent.click(within(dlg).getByRole("button", { name: /^(Create|Tạo)$/ }));
    expect(mutateCalls["programming.createProject"]).toHaveLength(1);
    expect(queryInputs["programming.listArtifacts"]).toEqual({ projectId: 2 });
    expectKhongDungDuocBuildCu();
  });

  it("DEMO một chạm, createArtifact THẤT BẠI ⇒ dự án DEMO mở sạch (không giữ build của dự án trước)", async () => {
    seed();
    const r = renderPage();
    armP1();
    // Danh sách dự án rỗng (vd bị xoá ở nơi khác) ⇒ màn onboarding với nút DEMO; state cũ vẫn còn.
    queryOverrides["programming.listProjects"] = () => makeQuery({ data: [] });
    // phần tử MỚI mỗi lần (cùng tham chiếu phần tử ⇒ React bỏ qua lượt render).
    const tree = () => (
      <ProgrammingCopilotProvider>
        <EngineeringWorkspace />
      </ProgrammingCopilotProvider>
    );
    r.rerender(tree());
    mutationFails.add("programming.createArtifact");
    await act(async () => { fireEvent.click(btn(/Create DEMO project|Tạo dự án DEMO/)); });
    await nghi();
    expect(mutateCalls["programming.createProject"]).toHaveLength(1);
    expect(mutateCalls["programming.createArtifact"]).toHaveLength(1);
    // Danh sách làm mới có dự án DEMO (id 2 = "Ladder Two" trong dữ liệu lưới).
    queryOverrides["programming.listProjects"] = () => makeQuery({ data: [P1, P2] });
    r.rerender(tree());
    expectKhongDungDuocBuildCu();
  });
});

describe("Task 12b (b) — kết quả về MUỘN không rơi vào lựa chọn hiện tại", () => {
  it("Build đang chạy ở P1, chuyển sang P2, build xong ⇒ KHÔNG hiện, Deploy/Fleet khoá", () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn(/^v1 · main/));
    mutationDeferred.add("programming.buildArtifact");
    fireEvent.click(buildBtn());
    expect(mutateCalls["programming.buildArtifact"]).toEqual([{ artifactId: 11 }]);
    fireEvent.click(projectBtn("Ladder Two"));
    xaHoan("programming.buildArtifact");
    expectKhongDungDuocBuildCu();
  });

  it("Kiểm tra đang chạy ở v1, chuyển sang v2, kết quả về ⇒ chẩn đoán KHÔNG hiện dưới v2", () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn(/^v1 · main/));
    mutationDeferred.add("programming.validateArtifact");
    fireEvent.click(btn(/^(Validate|Kiểm tra)$/));
    fireEvent.click(versionBtn(/^v2 · main/));
    xaHoan("programming.validateArtifact");
    expect(versionBtn(/^v2 · main/).className).toMatch(/border-primary/);
    expect(screen.queryByText(/DIAG-ERR-1/)).not.toBeInTheDocument();
  });

  it("Mô phỏng build #5 đang chạy, chọn build #6, kết quả về ⇒ verdict KHÔNG gắn vào #6", () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn(/^v1 · main/));
    fireEvent.click(screen.getByText("#5"));
    mutationDeferred.add("programming.simulateBuild");
    fireEvent.click(btn(/Simulate \(twin\)|Mô phỏng \(twin\)/));
    fireEvent.click(screen.getByText("#6"));
    xaHoan("programming.simulateBuild");
    expect(queryInputs["programming.deployPreview"]).toMatchObject({ buildId: 6 });
    expect(screen.queryByText(/SIM-WARN-1/)).not.toBeInTheDocument();
  });

  it("Lưu phiên bản ở P1 đang chạy, chuyển sang P2, lưu xong ⇒ P2 KHÔNG nhận phiên bản/build của P1", () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn(/^v1 · main/));
    fireEvent.change(editor(), { target: { value: "A\nZ" } });
    mutationDeferred.add("programming.createArtifact");
    fireEvent.click(btn(/^(Save version|Lưu phiên bản)$/));
    // buffer bẩn ⇒ đổi project phải xác nhận
    fireEvent.click(projectBtn("Ladder Two"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /Discard & continue|Bỏ thay đổi/ }));
    xaHoan("programming.createArtifact");
    expect(queryEnabled["programming.listBuilds"]).toBe(false);
    expect(screen.queryByText("#7")).not.toBeInTheDocument();
    expect(versionBtn(/^v1 · main/).className).not.toMatch(/border-primary/);
  });
});

describe("Task 12b (c) — IDE LUÔN gửi expectedProjectId (dự án đang mở) ở biên deploy", () => {
  it("deployPreview + deployBuild (sau OTP) + deployToFleet mang expectedProjectId = dự án đang mở", async () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn(/^v1 · main/));
    fireEvent.click(screen.getByText("#5"));
    expect(queryInputs["programming.deployPreview"]).toMatchObject({ buildId: 5, expectedProjectId: 1 });
    // deploy đơn
    toWizardStep(3);
    fireEvent.click(deployBtnEl());
    const otp = document.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(otp, { target: { value: "123456" } }); });
    await nghi();
    expect(mutateCalls["programming.deployBuild"]?.[0]).toMatchObject({ buildId: 5, expectedProjectId: 1 });
    // đội máy
    fleetCardOpen();
    fireEvent.click(fleetBox("M3 · #3"));
    toWizardStep(3);
    fireEvent.click(fleetBtnEl());
    const otp2 = document.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(otp2, { target: { value: "654321" } }); });
    await nghi();
    expect(mutateCalls["programming.deployToFleet"]?.[0]).toMatchObject({ buildId: 5, deviceIds: [3], expectedProjectId: 1 });
  });

  it("production + Hộp duyệt BẬT ⇒ requestDeployApproval mang expectedProjectId", async () => {
    const user = userEvent.setup();
    seed();
    const st = queryOverrides["programming.status"]!;
    queryOverrides["programming.status"] = (i) => {
      const q = st(i);
      return { ...q, data: { ...(q.data as object), deployApprovalEnabled: true } };
    };
    renderPage();
    fireEvent.click(versionBtn(/^v1 · main/));
    fireEvent.click(screen.getByText("#5"));
    toWizardStep(2);
    const deployCard = within(wizard());
    await user.click(deployCard.getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: "production" }));
    fireEvent.change(wizard().querySelector("textarea")!, { target: { value: "ECN-42" } });
    toWizardStep(3);
    fireEvent.click(screen.getByTestId("engineering-request-deploy-button"));
    expect(mutateCalls["programming.requestDeployApproval"]?.[0]).toMatchObject({ buildId: 5, reason: "ECN-42", expectedProjectId: 1 });
  });
});

describe("Task 12b fix round 1 — toast của kết quả BỊ BỎ (về muộn) không hiện; kết quả của lựa chọn HIỆN TẠI vẫn hiện", () => {
  it("build về muộn sau khi đổi dự án ⇒ KHÔNG toast; build của lựa chọn hiện tại ⇒ toast", () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn(/^v1 · main/));
    mutationDeferred.add("programming.buildArtifact");
    fireEvent.click(buildBtn());
    fireEvent.click(projectBtn("Ladder Two"));
    for (const f of Object.values(toasts)) f.mockClear();
    xaHoan("programming.buildArtifact");
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
    // lựa chọn hiện tại (P2 · v1 = artifact 21) ⇒ toast vẫn hiện. Buffer của P1 còn ⇒ xác nhận bỏ.
    fireEvent.click(versionBtn(/^v1 · main/));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /Discard & continue|Bỏ thay đổi/ }));
    fireEvent.click(buildBtn());
    xaHoan("programming.buildArtifact");
    expect(toasts.success).toHaveBeenCalledTimes(1);
  });

  it("kiểm tra về muộn sau khi đổi phiên bản ⇒ KHÔNG toast cảnh báo; kiểm tra phiên bản hiện tại ⇒ toast cảnh báo", () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn(/^v1 · main/));
    mutationDeferred.add("programming.validateArtifact");
    fireEvent.click(btn(/^(Validate|Kiểm tra)$/));
    fireEvent.click(versionBtn(/^v2 · main/));
    for (const f of Object.values(toasts)) f.mockClear();
    xaHoan("programming.validateArtifact");
    expect(toasts.warning).not.toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
    fireEvent.click(btn(/^(Validate|Kiểm tra)$/));
    xaHoan("programming.validateArtifact");
    expect(toasts.warning).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/DIAG-ERR-1/)).toBeInTheDocument();
  });

  it("mô phỏng về muộn sau khi đổi build ⇒ KHÔNG toast; mô phỏng build hiện tại ⇒ toast", () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn(/^v1 · main/));
    fireEvent.click(screen.getByText("#5"));
    mutationDeferred.add("programming.simulateBuild");
    fireEvent.click(btn(/Simulate \(twin\)|Mô phỏng \(twin\)/));
    fireEvent.click(screen.getByText("#6"));
    for (const f of Object.values(toasts)) f.mockClear();
    xaHoan("programming.simulateBuild");
    expect(toasts.success).not.toHaveBeenCalled();
    fireEvent.click(btn(/Simulate \(twin\)|Mô phỏng \(twin\)/));
    xaHoan("programming.simulateBuild");
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/SIM-WARN-1/)).toBeInTheDocument();
  });
});
