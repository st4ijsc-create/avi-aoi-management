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
// Copilot: dùng ProgrammingCopilotProvider + ProgrammingCopilotDock THẬT (không mock context) —
// trang chỉ CÔNG BỐ binding; luồng SSE + Huỷ chạy trong panel của dock, fetch = SSE giả lưới tự bơm.
//
// Ảnh chụp DOM (toMatchFileSnapshot) ghi ở mã cũ; sau khi tách, cùng các kịch bản phải ra ĐÚNG
// từng byte (không -u).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
                useMutation: (mopts?: { onSuccess?: (d: unknown, v: unknown) => void }) => ({
                  mutate: (vars: unknown) => {
                    (mutateCalls[key] ??= []).push(vars);
                    const r = mutationResponses[key];
                    if (r) mopts?.onSuccess?.(r(vars), vars);
                  },
                  mutateAsync: (vars: unknown) => {
                    (mutateCalls[key] ??= []).push(vars);
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
import ProgrammingCopilotDock from "@/components/programming/ProgrammingCopilotDock";

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
      <ProgrammingCopilotDock />
    </ProgrammingCopilotProvider>,
  );
}

const editor = () => screen.getByLabelText("program-source") as HTMLTextAreaElement;
const versionBtn = (re: RegExp) => screen.getByText(re, { selector: "button" });
const projectBtn = (name: string) => screen.getByText(name, { selector: "button span" }).closest("button")!;
const btn = (re: RegExp) => screen.getByRole("button", { name: re });
/** Nút Build của card editor (stepper luồng vàng cũng có nút tên "Build" khi bước đã xong). */
const buildBtn = () => within(document.getElementById("gt-editor")!).getByRole("button", { name: /^Build$/ });
const fleetCard = () => within(document.getElementById("gt-fleet")!);
const fleetBox = (label: string) => {
  const l = Array.from(document.getElementById("gt-fleet")!.querySelectorAll("label")).find((x) => x.textContent === label);
  if (!l) throw new Error(`fleet label not found: ${label}`);
  return l.querySelector('[role="checkbox"]') as HTMLElement;
};

/** Đặt đủ bốn thứ của chuỗi reset trên P1: artifact v1, diagnostics, build #5, simResult (+ watch, fleet). */
function armP1() {
  fireEvent.click(versionBtn(/^v1 · main/));
  expect(editor().value).toBe("A\nB");
  fireEvent.click(btn(/^(Validate|Kiểm tra)$/));
  fireEvent.click(screen.getByText("#5"));
  fireEvent.click(btn(/Simulate \(twin\)|Mô phỏng \(twin\)/));
  fireEvent.click(btn(/Watch live|Theo dõi trực tiếp/));
  fireEvent.click(fleetBox("M3 · #3"));
  // tiền điều kiện: cả bốn (và watch/fleet) ĐANG hiện
  expect(screen.getByText(/DIAG-ERR-1/)).toBeInTheDocument();
  expect(screen.getByTestId("deploy-preview")).toBeInTheDocument();
  expect(queryInputs["programming.deployPreview"]).toMatchObject({ buildId: 5 });
  expect(screen.getByText(/SIM-WARN-1/)).toBeInTheDocument();
  expect(btn(/Stop watch|Dừng theo dõi/)).toBeInTheDocument();
  expect(fleetBox("M3 · #3")).toHaveAttribute("aria-checked", "true");
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
  expect(fleetBox("M3 · #3")).toHaveAttribute("aria-checked", "false"); // fleetDeviceIds
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
  for (const o of [queryOverrides, queryInputs, queryEnabled, mutateCalls, mutationResponses, mutationData]) {
    for (const k of Object.keys(o)) delete (o as Record<string, unknown>)[k];
  }
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
    expect(fleetBox("M3 · #3")).toHaveAttribute("aria-checked", "true");
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

  it("chọn build KHÁC ⇒ simResult về rỗng; Build mới (buildArtifact) đổi build đang chọn nhưng GIỮ simResult (hành vi cũ)", () => {
    seed();
    renderPage();
    armP1();
    fireEvent.click(buildBtn());
    expect(queryInputs["programming.deployPreview"]).toMatchObject({ buildId: 6 });
    expect(screen.getByText(/SIM-WARN-1/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByTestId("engineering-deploy-signoff"));
    expect(queryInputs["programming.deployPreview"]).toEqual({ buildId: 5, stage: "staging", confirmedBy: ME });
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
    const deployCard = within(document.getElementById("gt-deploy")!);
    await user.click(deployCard.getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: "production" }));
    expect(queryInputs["programming.deployPreview"]).toEqual({ buildId: 5, stage: "production", confirmedBy: undefined });
    expect(screen.getByTestId("engineering-deploy-button")).toBeDisabled();
    await user.click(deployCard.getAllByRole("combobox")[1]);
    expect(screen.queryByRole("option", { name: "Me" })).not.toBeInTheDocument(); // không tự ký
    await user.click(screen.getByRole("option", { name: "Approver Nine" }));
    expect(queryInputs["programming.deployPreview"]).toEqual({ buildId: 5, stage: "production", confirmedBy: 9 });
    expect(screen.getByTestId("engineering-deploy-button")).toBeDisabled();
    fireEvent.change(document.querySelector("#gt-deploy textarea")!, { target: { value: "ECN-42" } });
    expect(screen.getByTestId("engineering-deploy-button")).not.toBeDisabled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Copilot (dock thật) — binding của trang, stream + Huỷ, Apply chèn vào buffer", () => {
  async function moDock() {
    fireEvent.click(btn(/^(Open Copilot|Mở Trợ lý)$/));
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
// Ảnh chụp DOM toàn trang (document.body, gồm portal của dialog) tại nhiều bước — ghi ở mã CŨ.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Ảnh chụp DOM byte-identical (trước/sau khi nâng state)", () => {
  const snap = (name: string) => expect(document.body.innerHTML).toMatchFileSnapshot(`./__snapshots__/EngineeringWorkspace.dom/${name}.html`);

  it("trống / đang tải / lỗi", async () => {
    seed({ projects: [], deepLink: null });
    renderPage();
    await snap("01-no-projects");
    cleanup();
    seed({ deepLink: null });
    queryOverrides["programming.status"] = () => makeQuery({ isLoading: true, isPending: true });
    queryOverrides["programming.listProjects"] = () => makeQuery({ isLoading: true, isPending: true });
    renderPage();
    await snap("02-loading");
    cleanup();
    seed({ deepLink: null });
    queryOverrides["programming.listProjects"] = () => makeQuery({ isError: true });
    renderPage();
    await snap("03-projects-error");
    cleanup();
    seed({ deepLink: null });
    renderPage();
    await snap("04-select-project");
  });

  it("dialog tạo dự án + DEMO một chạm", async () => {
    seed({ projects: [], deepLink: null });
    renderPage();
    const plus = document.querySelector("button[aria-haspopup='dialog']") as HTMLElement;
    fireEvent.click(plus);
    fireEvent.change(screen.getByPlaceholderText("ZMC-CELL-01"), { target: { value: "NP-1" } });
    const dlg = screen.getByRole("dialog");
    const inputs = dlg.querySelectorAll("input");
    fireEvent.change(inputs[1], { target: { value: "New One" } });
    await snap("30-new-project-dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: /^(Create|Tạo)$/ }));
    expect(mutateCalls["programming.createProject"]).toEqual([{ code: "NP-1", name: "New One", kind: "stub", deviceId: undefined }]);
    await snap("31-after-create");
    fireEvent.click(plus);
    await snap("32-new-project-dialog-reopened");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    // DEMO một chạm: createProject ⇒ createArtifact (mutateAsync, onSuccess chọn project/phiên bản)
    await act(async () => { fireEvent.click(btn(/Create DEMO project|Tạo dự án DEMO/)); });
    await nghi();
    expect(mutateCalls["programming.createProject"]?.[1]).toMatchObject({ code: expect.stringMatching(/^DEMO-\d+$/), kind: "stub" });
    expect(mutateCalls["programming.createArtifact"]).toEqual([
      expect.objectContaining({ projectId: 2, branch: "main", language: "text" }),
    ]);
    expect(btn(/Create DEMO project|Tạo dự án DEMO/)).not.toBeDisabled();
    await snap("33-after-demo");
  });

  it("luồng đầy đủ trên P1 rồi đổi sang P2", async () => {
    const user = userEvent.setup();
    seed({ reviewOn: true });
    mutationData["programming.deployToFleet"] = {
      halted: true, haltCode: "canary_not_real", promoted: false, haltReason: null,
      results: [{ deviceId: 3, phase: "canary", status: "simulated", error: null, rolledBack: false, rollbackError: null }],
    };
    renderPage();
    await snap("10-p1-deeplinked");
    armP1();
    await snap("11-p1-armed");
    // tìm kiếm + diff 2 phiên bản
    fireEvent.change(screen.getByPlaceholderText(/Search by name or code…|Tìm theo tên hoặc mã…/), { target: { value: "cell" } });
    const editorCard = within(document.getElementById("gt-editor")!);
    await user.click(editorCard.getAllByRole("combobox")[0]);
    await user.click(screen.getAllByRole("option", { name: "v1 · main" })[0]);
    await user.click(editorCard.getAllByRole("combobox")[1]);
    await user.click(screen.getAllByRole("option", { name: "v2 · main" })[0]);
    await snap("12-search-diff");
    // form deploy production + form fleet
    const deployCard = within(document.getElementById("gt-deploy")!);
    await user.click(deployCard.getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: "production" }));
    await user.click(deployCard.getAllByRole("combobox")[1]);
    await user.click(screen.getByRole("option", { name: "Approver Nine" }));
    fireEvent.change(document.querySelector("#gt-deploy textarea")!, { target: { value: "ECN-42" } });
    fireEvent.click(fleetBox("M4 · #4"));
    fireEvent.change(fleetCard().getByRole("spinbutton"), { target: { value: "2" } });
    fireEvent.click(fleetCard().getByText(/Promote only when the canary is VERIFIED|Chỉ promote/).closest("label")!.querySelector('[role="checkbox"]')!);
    fireEvent.click(fleetCard().getByText(/Auto-rollback if the canary fails|Tự khôi phục/).closest("label")!.querySelector('[role="checkbox"]')!);
    await user.click(fleetCard().getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: "production" }));
    await user.click(fleetCard().getAllByRole("combobox")[1]);
    await user.click(screen.getByRole("option", { name: "Approver Nine" }));
    fireEvent.change(fleetCard().getByPlaceholderText(/./), { target: { value: "fleet reason" } });
    await snap("13-prod-forms");
    // dialog sửa biến (điền sẵn) rồi đóng bằng Lưu
    fireEvent.click(within(document.getElementById("gt-monitor")!).getByRole("button", { name: /^(Edit|Sửa)$/ }));
    await snap("14-symbol-dialog");
    fireEvent.change(screen.getByDisplayValue("X0"), { target: { value: "X0b" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^(Save|Lưu)$/ }));
    expect(mutateCalls["programming.upsertSymbol"]).toEqual([{ projectId: 1, name: "X0b", address: "D100", dataType: "INT", comment: "start", watchable: true }]);
    await snap("15-symbol-saved");
    // dialog gắn thiết bị (điền sẵn deviceId 3)
    fireEvent.click(btn(/^(Change device|Đổi thiết bị)$/));
    await snap("16-attach-dialog");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^(Save|Lưu)$/ }));
    expect(mutateCalls["programming.updateProject"]).toEqual([{ id: 1, deviceId: 3 }]);
    // hộp rollback + hộp xoá biến
    fireEvent.click(within(document.getElementById("gt-deploy")!).getByRole("button", { name: /Roll back|Khôi phục/ }));
    await snap("17-rollback-dialog");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^(Cancel|Hủy)$/ }));
    fireEvent.click(within(document.getElementById("gt-monitor")!).getByRole("button", { name: /^(Delete|Xóa)$/ }));
    await snap("18-delete-symbol-dialog");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^(Delete|Xóa)$/ }));
    expect(mutateCalls["programming.deleteSymbol"]).toEqual([{ id: 31 }]);
    await snap("19-after-delete");
    // buffer bẩn + chuyển project có hỏi
    fireEvent.change(editor(), { target: { value: "A\nB\nDIRTY" } });
    fireEvent.click(projectBtn("Cell One")); // cùng project ⇒ không hỏi
    fireEvent.change(screen.getByPlaceholderText(/Search by name or code…|Tìm theo tên hoặc mã…/), { target: { value: "" } });
    fireEvent.click(projectBtn("Ladder Two"));
    await snap("20-dirty-guard");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /Discard & continue|Bỏ thay đổi/ }));
    await snap("21-p2-after-reset");
    // P2 là ladder ⇒ có chế độ trực quan
    // buffer cũ (A/B/DIRTY) vẫn còn (đổi project không xoá buffer) ⇒ chọn phiên bản cũng hỏi
    fireEvent.click(versionBtn(/^v1 · main/));
    await snap("22-p2-version-dirty-guard");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /Discard & continue|Bỏ thay đổi/ }));
    expect(editor().value).toBe("LD-CODE");
    fireEvent.click(btn(/^(Ladder)$/));
    await snap("23-p2-ladder-visual");
    fireEvent.click(btn(/^(Code)$/));
    await snap("24-p2-code");
  });

});
