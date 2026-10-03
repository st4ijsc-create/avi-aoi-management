// @vitest-environment jsdom
//
// doc 81 Đợt 2 Task 13 — IDE `/engineering` thành mẫu P1 "Workbench" (doc 81 §1.3, sơ đồ "IDE mục tiêu").
// Hợp đồng (task-13-brief + plan GC3/GC4/Review Focus 1/3 + ruling R-2-b/j/l/n/q/r):
//   - Vỏ EngineeringShell (WorkbenchShell, panel theo PX): activity bar · Explorer (Dự án / Phiên bản / Tags-IO /
//     Deploy) · tab editor (nguồn, Δ diff, Tags) · Inspector/Copilot phải · panel dưới (Vấn đề / Build-Mô phỏng /
//     Lịch sử deploy / Ma trận máy×version) GẬP ở lần đầu (R-2-l) · thanh trạng thái (Ln/Col, adapter,
//     "Triển khai thật: ON/OFF" bằng nhãn i18n — không tên biến môi trường).
//   - Copilot là panel TRONG layout (dùng chung lõi với dock): KHÔNG position:fixed, KHÔNG body.paddingRight
//     (R-2-b); nút AI top bar mở/đưa focus vào panel, không chồng sheet chat (R-2-j); stream sống qua đổi tab.
//   - Bỏ card "Trợ lý Lập trình AI" (lối vào AI thứ 3).
//   - Deploy wizard 4 bước (gồm canary) trên WizardDialog; deployPreview hiện TRƯỚC OTP; OTP = stepUp.guard của
//     trang (R-2-q); mỗi lượt xác nhận gửi ĐÚNG đích/cổng/expectedProjectId như thẻ cũ (R-2-n, R-2-r).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { installResizeHandleHitAreaShim } from "@/components/patterns/layoutKitTestPanels";
import { getAiEntryState, resetAiEntryForTest, setAiChatOpen } from "@/lib/aiEntryStore";
import PAGE_SRC from "./EngineeringWorkspace.tsx?raw";
import VI from "@/i18n/locales/vi.json";
import EN from "@/i18n/locales/en.json";
import ZH from "@/i18n/locales/zh.json";

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main data-testid="dashboard-layout">{children}</main>,
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));
vi.mock("@/hooks/useLicenseModules", () => ({
  useLicenseModules: () => ({ isModuleBlocked: () => false }),
}));
vi.mock("@/lib/socketManager", () => ({
  getSharedSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false }),
  releaseSharedSocket: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
vi.mock("@/components/engineering/CodeEditor", () => ({
  CodeEditor: (p: { value: string; onChange?: (v: string) => void; language?: string; "aria-label"?: string }) => (
    <textarea aria-label={p["aria-label"]} data-language={p.language} value={p.value} onChange={(e) => p.onChange?.(e.target.value)} />
  ),
}));
vi.mock("@/components/diff/HunkDiffView", () => ({ HunkDiffView: () => null }));

// ─── trpc giả (cùng khuôn với test đặc tả: onSuccess được gọi, enabled:false ⇒ không data) ─────────
interface QueryResult {
  data: unknown; isLoading: boolean; isPending: boolean; isFetching: boolean; isError: boolean;
  error: unknown; dataUpdatedAt: number | undefined; refetch: () => void;
}
function makeQuery(o: Partial<QueryResult> = {}): QueryResult {
  return { data: undefined, isLoading: false, isPending: false, isFetching: false, isError: false, error: null, dataUpdatedAt: undefined, refetch: vi.fn(), ...o };
}
const queryOverrides: Record<string, (input: unknown) => QueryResult> = {};
const queryInputs: Record<string, unknown> = {};
const queryEnabled: Record<string, boolean | undefined> = {};
const mutateCalls: Record<string, unknown[]> = {};
const mutationResponses: Record<string, ((vars: any) => unknown) | undefined> = {};
function chainable(): unknown {
  const fn = (..._a: unknown[]) => undefined;
  return new Proxy(fn, { get: () => chainable(), apply: () => undefined });
}
vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get(_t, routerName: string) {
      if (routerName === "useUtils") return () => chainable();
      return new Proxy({}, {
        get(_t2, procName: string) {
          const key = `${routerName}.${procName}`;
          return {
            useQuery: (input?: unknown, opts?: { enabled?: boolean }) => {
              queryInputs[key] = input;
              queryEnabled[key] = opts?.enabled;
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
              reset: vi.fn(), data: undefined, isPending: false, isError: false,
            }),
          };
        },
      });
    },
  }),
}));

import EngineeringWorkspace from "./EngineeringWorkspace";
import { ProgrammingCopilotProvider } from "@/contexts/ProgrammingCopilotContext";
import ProgrammingCopilotDock from "@/components/programming/ProgrammingCopilotDock";
import { ShellAiButton } from "@/components/ShellAiButton";

const ME = 8;
const P1 = { id: 1, name: "Cell One", code: "C1", kind: "zmotion-basic", deviceId: 3, defaultBranch: "main" };
const art = (o: Record<string, unknown>) => ({
  projectId: 1, branch: "main", kind: "zmotion-basic", language: "basic", status: "draft",
  reviewStatus: "approved", createdBy: 7, diagnosticsJson: null, ...o,
});

function seed(o: { deployEnabled?: boolean } = {}) {
  window.history.pushState({}, "", "/engineering?projectId=1");
  queryOverrides["auth.me"] = () => makeQuery({ data: { id: ME, role: "supervisor", name: "Sup", twoFactorEnabled: true } });
  queryOverrides["programming.status"] = () => makeQuery({
    data: {
      deployEnabled: o.deployEnabled ?? true, streamingEnabled: true, deployApprovalEnabled: false, versionReviewEnabled: false,
      adapters: [{ kind: "zmotion-basic", implemented: true }],
    },
  });
  queryOverrides["programming.listProjects"] = () => makeQuery({ data: [P1] });
  queryOverrides["machine.list"] = () => makeQuery({ data: [{ id: 3, name: "M3" }, { id: 4, name: "M4" }] });
  queryOverrides["programming.listArtifacts"] = () => makeQuery({ data: [art({ id: 11, version: 1, content: "A\nB" })] });
  queryOverrides["programming.listBuilds"] = () => makeQuery({ data: [{ id: 5, ok: true, status: "ok" }] });
  queryOverrides["programming.deployPreview"] = (i) => {
    const x = i as { buildId: number; stage: string };
    return makeQuery({
      data: {
        verdict: "real", gates: [{ name: "buildOk", ok: true, reason: "buildOk" }],
        target: { adapterKind: "zmotion-basic", stage: x.stage, deviceId: 3, path: "direct", artifactVersion: 1 },
      },
    });
  };
  queryOverrides["programming.listDeployments"] = () => makeQuery({ data: [] });
  queryOverrides["programming.listSymbols"] = () => makeQuery({ data: [] });
  queryOverrides["programming.fleetVersionMatrix"] = () => makeQuery({ data: [] });
  queryOverrides["programming.listApprovers"] = () => makeQuery({ data: [{ id: ME, name: "Me" }, { id: 9, name: "Approver Nine" }] });
  mutationResponses["programming.validateArtifact"] = () => ({
    ok: false, diagnostics: [{ severity: "error", message: "DIAG-ERR-1", line: 2 }, { severity: "warning", message: "DIAG-WARN-2" }],
  });
}

function renderPage(o: { aiButton?: boolean } = {}) {
  return render(
    <ProgrammingCopilotProvider>
      {o.aiButton && <ShellAiButton />}
      <EngineeringWorkspace />
      <ProgrammingCopilotDock />
    </ProgrammingCopilotProvider>,
  );
}

// ─── SSE giả cho Copilot ─────────────────────────────────────────────────────────────────────────
interface LuongGia { body: Record<string, unknown>; signal: AbortSignal; day: (o: unknown) => void }
let luot: LuongGia[] = [];
function fetchGia(_url: string, init: RequestInit): Promise<Response> {
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  let dong = false;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
  const signal = init.signal as AbortSignal;
  signal.addEventListener("abort", () => { if (!dong) { dong = true; ctl.error(new DOMException("Aborted", "AbortError")); } });
  luot.push({ body: JSON.parse(String(init.body)), signal, day: (x) => !dong && ctl.enqueue(enc.encode(`data: ${JSON.stringify(x)}\n\n`)) });
  return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));
}
const nghi = () => act(() => new Promise((r) => setTimeout(r, 20)));

let undoShim: (() => void) | null = null;
beforeAll(() => {
  undoShim = installResizeHandleHitAreaShim();
});
beforeEach(() => {
  for (const o of [queryOverrides, queryInputs, queryEnabled, mutateCalls, mutationResponses]) {
    for (const k of Object.keys(o)) delete (o as Record<string, unknown>)[k];
  }
  for (const f of Object.values(toasts)) f.mockReset();
  try { window.localStorage.clear(); } catch { /* ignore */ }
  document.body.style.paddingRight = "";
  resetAiEntryForTest();
  luot = [];
  vi.stubGlobal("fetch", vi.fn(fetchGia));
  Element.prototype.scrollIntoView ??= function () {};
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture ??= () => false;
  (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture ??= () => {};
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
afterAll(() => undoShim?.());

const btn = (re: RegExp) => screen.getByRole("button", { name: re });
const versionBtn = () => screen.getByText(/^v1 · main/, { selector: "button" });
const mainEl = () => document.querySelector('[data-layout-main="engineering-editor"]') as HTMLElement;
const statusBar = () => document.querySelector("[data-workbench-statusbar]") as HTMLElement;
const bottomToggle = () => btn(/Toggle the bottom panel|Ẩn\/hiện panel dưới/);
const inspector = () => document.querySelector("aside[aria-label]") as HTMLElement;

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("P1 Workbench — bố cục (doc 81 §1.3)", () => {
  it("activity bar 4 mục · Explorer Dự án/Phiên bản/Tags-IO/Deploy · tab editor nguồn/Δ diff/Tags · MAIN = editor · panel dưới 4 tab · thanh trạng thái", () => {
    seed();
    renderPage();
    const bar = screen.getByRole("toolbar", { name: /Activity bar|Thanh hoạt động/ });
    for (const re of [/^(Projects|Dự án)$/, /^(Versions|Phiên bản)$/, /^Tags \/ IO$/, /^Deploy$/]) {
      expect(within(bar).getByRole("button", { name: re })).toBeInTheDocument();
    }
    const explorer = document.querySelector("[data-workbench-left]") as HTMLElement;
    expect(explorer).not.toBeNull();
    for (const re of [/^(Projects|Dự án)$/, /(Versions|Phiên bản)/, /^Tags \/ IO$/, /^Deploy$/]) {
      expect(within(explorer).getAllByRole("heading", { name: re }).length).toBeGreaterThan(0);
    }
    const tabs = screen.getByRole("tablist", { name: /Editor tabs|Tab soạn thảo/ });
    const names = within(tabs).getAllByRole("tab").map((x) => x.textContent ?? "");
    expect(names.some((n) => /^(Source|Nguồn)/.test(n))).toBe(true);
    expect(names.some((n) => /^Δ/.test(n))).toBe(true);
    expect(names.some((n) => /^Tags$/.test(n))).toBe(true);
    // MAIN = editor (tabpanel), không chứa h1/header/chip
    const main = mainEl();
    expect(main).not.toBeNull();
    expect(main).toHaveAttribute("role", "tabpanel");
    expect(within(main).getByLabelText("program-source")).toBeInTheDocument();
    expect(main.querySelector("h1,[data-layout-header],[data-layout-kpi]")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    // panel dưới: 4 tab
    const bottom = document.querySelector("[data-workbench-bottom]") as HTMLElement;
    const btabs = within(bottom).getAllByRole("tab").map((x) => x.textContent ?? "");
    expect(btabs).toHaveLength(4);
    expect(btabs[0]).toMatch(/Problems|Vấn đề/);
    expect(btabs[1]).toMatch(/Build/);
    expect(btabs[2]).toMatch(/Deploy history|Lịch sử deploy/);
    expect(btabs[3]).toMatch(/matrix|Ma trận/i);
    // thanh trạng thái
    expect(statusBar()).toHaveTextContent(/Ln 1, Col 1/);
    expect(statusBar()).toHaveTextContent("zmotion-basic");
    expect(within(statusBar()).getByTestId("engineering-deploy-badge")).toHaveTextContent(/^(Real deploy|Triển khai thật): ON$/);
  });

  it("thanh trạng thái 'Triển khai thật: OFF' là nhãn i18n — KHÔNG tên biến môi trường ở bất kỳ đâu", () => {
    seed({ deployEnabled: false });
    renderPage();
    expect(within(statusBar()).getByTestId("engineering-deploy-badge")).toHaveTextContent(/^(Real deploy|Triển khai thật): OFF$/);
    expect(document.body.innerHTML).not.toMatch(/DPC_DEPLOY_ENABLED|DPC_DEPLOY/);
  });

  it("panel dưới GẬP ở lần đầu (R-2-l); Kiểm tra ⇒ mở ở tab Vấn đề; số vấn đề luôn thấy ở thanh trạng thái", () => {
    seed();
    renderPage();
    expect(bottomToggle()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(versionBtn());
    fireEvent.click(btn(/^(Validate|Kiểm tra)$/));
    expect(bottomToggle()).toHaveAttribute("aria-expanded", "true");
    const bottom = document.querySelector("[data-workbench-bottom]") as HTMLElement;
    expect(within(bottom).getByRole("tab", { name: /Problems|Vấn đề/ })).toHaveAttribute("aria-selected", "true");
    expect(within(bottom).getByText(/DIAG-ERR-1/)).toBeVisible();
    expect(within(statusBar()).getByTestId("ide-status-problems")).toHaveTextContent("2");
  });

  it("bỏ card 'Trợ lý Lập trình AI' (lối vào AI thứ 3): không nút 'Mở Trợ lý', không #gt-copilot", () => {
    seed();
    renderPage();
    expect(screen.queryByRole("button", { name: /^(Open Copilot|Mở Trợ lý)$/ })).toBeNull();
    expect(document.getElementById("gt-copilot")).toBeNull();
    expect(screen.queryByText(/^(AI Programming Copilot|Trợ lý Lập trình AI)$/)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Copilot là panel TRONG layout (R-2-b / R-2-j)", () => {
  it("Copilot mở ⇒ KHÔNG dock position:fixed, KHÔNG body.paddingRight; panel nằm trong inspector (aside data-layout-ai)", async () => {
    window.localStorage.setItem("progCopilotDock.open", "1");
    seed();
    renderPage();
    await screen.findByPlaceholderText(/Describe what to generate/);
    expect(document.body.style.paddingRight).toBe("");
    expect(Array.from(document.querySelectorAll("aside")).some((a) => /(^|\s)fixed(\s|$)/.test(a.className))).toBe(false);
    const aside = document.querySelector("aside[data-layout-ai]") as HTMLElement;
    expect(aside).not.toBeNull();
    expect(within(aside).getByPlaceholderText(/Describe what to generate/)).toBeInTheDocument();
    expect(within(aside).getByRole("tab", { name: /Copilot/ })).toHaveAttribute("aria-selected", "true");
    expect(mainEl().contains(aside)).toBe(false);
  });

  it("nút AI top bar mở panel trong layout + đưa focus vào; bấm lại ⇒ về Thuộc tính; sheet chat KHÔNG chồng (R-2-j)", async () => {
    seed();
    renderPage({ aiButton: true });
    const ai = screen.getByRole("button", { name: /^(Mở Trợ lý Lập trình|Open Programming Copilot)$/ });
    expect(ai).toHaveAttribute("aria-expanded", "false");
    expect(within(inspector()).getByRole("tab", { name: /Properties|Thuộc tính/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(ai);
    const copilotTab = within(inspector()).getByRole("tab", { name: /Copilot/ });
    expect(copilotTab).toHaveAttribute("aria-selected", "true");
    const panel = document.getElementById(copilotTab.getAttribute("aria-controls")!)!;
    expect(panel.contains(document.activeElement)).toBe(true);
    await screen.findByPlaceholderText(/Describe what to generate/);
    // chat mở (vd từ màn khác) ⇒ trao cho Copilot, không chồng
    act(() => setAiChatOpen(true));
    expect(getAiEntryState().chatOpen).toBe(false);
    expect(copilotTab).toHaveAttribute("aria-selected", "true");
    fireEvent.click(ai);
    expect(within(inspector()).getByRole("tab", { name: /Properties|Thuộc tính/ })).toHaveAttribute("aria-selected", "true");
    expect(document.body.style.paddingRight).toBe("");
  });

  it("stream Copilot SỐNG khi chuyển Thuộc tính ↔ Copilot (Review Focus 3); Huỷ ⇒ abort", async () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn());
    fireEvent.click(within(inspector()).getByRole("tab", { name: /Copilot/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Describe what to generate/), { target: { value: "toggle a run bit" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Generate$/ })); });
    await nghi();
    expect(luot).toHaveLength(1);
    expect(luot[0].body).toMatchObject({ kind: "zmotion-basic", request: "toggle a run bit" });
    fireEvent.click(within(inspector()).getByRole("tab", { name: /Properties|Thuộc tính/ }));
    fireEvent.click(within(inspector()).getByRole("tab", { name: /Copilot/ }));
    await nghi();
    expect(luot).toHaveLength(1);
    expect(luot[0].signal.aborted).toBe(false);
    await act(async () => { fireEvent.click(screen.getByTestId("copilot-cancel")); });
    await nghi();
    expect(luot[0].signal.aborted).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Deploy wizard 4 bước (WizardDialog) — deployPreview TRƯỚC OTP, R-2-n", () => {
  const otpText = /Two-step verification to deploy|Xác thực 2 bước/;
  async function moWizard() {
    fireEvent.click(versionBtn());
    fireEvent.click(screen.getByText("#5"));
    fireEvent.click(btn(/^(Deploy…)$/));
    return screen.getByRole("dialog");
  }
  const next = (d: HTMLElement) => fireEvent.click(within(d).getByRole("button", { name: /^(Next|Tiếp)$/ }));

  it("4 bước gồm canary; bước cuối hiện deployPreview; Deploy ⇒ hộp OTP, CHƯA deployBuild; OTP ⇒ deployBuild đúng bộ tham số cũ", async () => {
    seed();
    renderPage();
    const d = await moWizard();
    const steps = within(within(d).getByRole("list", { name: /Steps|Các bước/ })).getAllByRole("listitem").map((x) => x.textContent ?? "");
    expect(steps).toHaveLength(4);
    expect(steps[1]).toMatch(/canary/i);
    expect(within(d).getByText(/Build #5/)).toBeInTheDocument();
    next(d); // đích & canary — mặc định một máy
    expect(within(d).getByRole("radio", { name: /Single machine|Một máy/ })).toHaveAttribute("aria-checked", "true");
    next(d); // ký duyệt
    fireEvent.click(within(d).getByTestId("engineering-deploy-signoff"));
    expect(queryInputs["programming.deployPreview"]).toEqual({ buildId: 5, stage: "staging", confirmedBy: ME, expectedProjectId: 1 });
    next(d); // xem trước
    expect(within(d).getByTestId("deploy-preview")).toHaveAttribute("data-verdict", "real");
    expect(screen.queryByText(otpText)).not.toBeInTheDocument();
    fireEvent.click(within(d).getByTestId("engineering-deploy-button"));
    expect(screen.getByText(otpText)).toBeInTheDocument();
    expect(mutateCalls["programming.deployBuild"]).toBeUndefined();
    const otp = document.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(otp, { target: { value: "123456" } }); });
    await nghi();
    expect(mutateCalls["programming.deployBuild"]).toHaveLength(1);
    const call = mutateCalls["programming.deployBuild"]![0] as Record<string, unknown>;
    expect(Object.keys(call).sort()).toEqual(["actionId", "buildId", "confirmedBy", "expectedProjectId", "idempotencyKey", "reason", "stage", "totpCode"]);
    expect(call).toMatchObject({ buildId: 5, stage: "staging", confirmedBy: ME, reason: undefined, totpCode: "123456", expectedProjectId: 1 });
    expect(String(call.idempotencyKey)).toMatch(/^dep/);
    expect(mutateCalls["programming.deployToFleet"]).toBeUndefined();
  });

  it("canary đội máy: 2 máy + canary 1 ⇒ MỘT deployToFleet sau OTP với đúng deviceIds / strategy / expectedProjectId như thẻ cũ", async () => {
    seed();
    renderPage();
    const d = await moWizard();
    next(d);
    fireEvent.click(within(d).getByRole("radio", { name: /Fleet|Đội máy/ }));
    const box = (label: string) => within(d).getByText(label).closest("label")!.querySelector('[role="checkbox"]') as HTMLElement;
    fireEvent.click(box("M3 · #3"));
    fireEvent.click(box("M4 · #4"));
    fireEvent.change(within(d).getByRole("spinbutton"), { target: { value: "1" } });
    next(d);
    next(d);
    const go = within(d).getByTestId("engineering-fleet-deploy-button");
    expect(go).not.toBeDisabled();
    fireEvent.click(go);
    expect(screen.getByText(otpText)).toBeInTheDocument();
    expect(mutateCalls["programming.deployToFleet"]).toBeUndefined();
    const otp = document.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(otp, { target: { value: "654321" } }); });
    await nghi();
    expect(mutateCalls["programming.deployToFleet"]).toHaveLength(1);
    const call = mutateCalls["programming.deployToFleet"]![0] as Record<string, unknown>;
    expect(Object.keys(call).sort()).toEqual(["actionId", "buildId", "confirmedBy", "deviceIds", "expectedProjectId", "idempotencyKeyPrefix", "reason", "stage", "strategy", "totpCode"]);
    expect(call).toMatchObject({
      buildId: 5, deviceIds: [3, 4], stage: "staging", totpCode: "654321", expectedProjectId: 1,
      strategy: { canaryCount: 1, promoteOnVerified: false, autoRollbackOnMismatch: true },
    });
    expect(mutateCalls["programming.deployBuild"]).toBeUndefined();
  });

  it("chưa chọn build ⇒ nút mở wizard KHOÁ; không wizard, không OTP", () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn());
    const open = btn(/^(Deploy…)$/);
    expect(open).toBeDisabled();
    fireEvent.click(open);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(otpText)).not.toBeInTheDocument();
  });

  it("production: nút Deploy (bước cuối) KHOÁ tới khi có người ký + lý do — cổng cũ ở nút cuối; preview nhận confirmedBy = người ký", async () => {
    const user = userEvent.setup();
    seed();
    renderPage();
    const d = await moWizard();
    next(d);
    next(d);
    await user.click(within(d).getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: "production" }));
    next(d);
    expect(within(d).getByTestId("engineering-deploy-button")).toBeDisabled();
    expect(within(d).getByTestId("ide-wizard-not-ready")).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: /^(Back|Quay lại)$/ }));
    await user.click(within(d).getAllByRole("combobox")[1]);
    expect(screen.queryByRole("option", { name: "Me" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Approver Nine" }));
    fireEvent.change(within(d).getByRole("textbox"), { target: { value: "ECN-42" } });
    expect(queryInputs["programming.deployPreview"]).toEqual({ buildId: 5, stage: "production", confirmedBy: 9, expectedProjectId: 1 });
    next(d);
    expect(within(d).getByTestId("engineering-deploy-button")).not.toBeDisabled();
    expect(within(d).queryByTestId("ide-wizard-not-ready")).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("i18n — mọi khoá engineering.ws.* của trang có ở vi/en/zh (GC5)", () => {
  it("không thiếu, không rỗng", () => {
    const keys = Array.from(new Set(Array.from(PAGE_SRC.matchAll(/t\("engineering\.ws\.([A-Za-z]+)"/g), (m) => m[1])));
    expect(keys.length).toBeGreaterThan(30);
    for (const [name, loc] of [["vi", VI], ["en", EN], ["zh", ZH]] as const) {
      const ws = (loc as unknown as { engineering: { ws: Record<string, string> } }).engineering.ws;
      const missing = keys.filter((k) => typeof ws?.[k] !== "string" || ws[k].trim() === "");
      expect(missing, `${name} thiếu`).toEqual([]);
    }
  });
});
