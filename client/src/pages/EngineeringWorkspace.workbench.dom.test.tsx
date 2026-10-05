// @vitest-environment jsdom
//
// doc 81 Đợt 2 Task 13 — IDE `/engineering` thành mẫu P1 "Workbench" (doc 81 §1.3, sơ đồ "IDE mục tiêu").
// Hợp đồng (task-13-brief + plan GC3/GC4/Review Focus 1/3 + ruling R-2-b/j/l/n/q/r):
//   - Vỏ EngineeringShell (WorkbenchShell, panel theo PX): activity bar · Explorer (Dự án / Phiên bản / Tags-IO /
//     Deploy) · tab editor (nguồn, Δ diff, Tags) · Inspector/Copilot phải · panel dưới (Vấn đề / Build-Mô phỏng /
//     Lịch sử deploy / Ma trận máy×version) GẬP ở lần đầu (R-2-l) · thanh trạng thái (Ln/Col, adapter,
//     "Triển khai thật: ON/OFF" bằng nhãn i18n — không tên biến môi trường).
//   - Copilot là panel TRONG layout (lõi dùng chung ProgrammingCopilotCore; dock cố định đã gỡ ở Task 14): KHÔNG position:fixed, KHÔNG body.paddingRight
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
import { installMatchMedia, presetNarrow, setNarrow } from "@/components/patterns/layoutKitTestMedia";
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
/** Fix round 1 — mutation HOÃN (kết quả về muộn): onSuccess của lượt render MỚI NHẤT chạy khi gọi xaHoan(key). */
const mutationDeferred = new Set<string>();
const mutationPending: Record<string, Array<() => void>> = {};
const latestOnSuccess: Record<string, ((d: unknown, v: unknown) => void) | undefined> = {};
function xaHoan(key: string) {
  const q = mutationPending[key] ?? [];
  mutationPending[key] = [];
  act(() => { for (const f of q) f(); });
}
/** `.data` của mutation (deployToFleet ⇒ fleetResult). */
const mutationData: Record<string, unknown> = {};
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
            useMutation: (mopts?: { onSuccess?: (d: unknown, v: unknown) => void }) => (latestOnSuccess[key] = mopts?.onSuccess, {
              mutate: (vars: unknown) => {
                (mutateCalls[key] ??= []).push(vars);
                const r = mutationResponses[key];
                if (r && mutationDeferred.has(key)) {
                  (mutationPending[key] ??= []).push(() => latestOnSuccess[key]?.(r(vars), vars));
                  return;
                }
                if (r) mopts?.onSuccess?.(r(vars), vars);
              },
              mutateAsync: (vars: unknown) => {
                (mutateCalls[key] ??= []).push(vars);
                const r = mutationResponses[key];
                const d = r ? r(vars) : undefined;
                if (r) mopts?.onSuccess?.(d, vars);
                return Promise.resolve(d);
              },
              reset: vi.fn(), data: mutationData[key], isPending: false, isError: false,
            }),
          };
        },
      });
    },
  }),
}));

import EngineeringWorkspace from "./EngineeringWorkspace";
import { ProgrammingCopilotProvider } from "@/contexts/ProgrammingCopilotContext";
import { EngineeringProvider } from "@/contexts/EngineeringContext";
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
    </ProgrammingCopilotProvider>,
  );
}

// ─── SSE giả cho Copilot ─────────────────────────────────────────────────────────────────────────
interface LuongGia { body: Record<string, unknown>; signal: AbortSignal; day: (o: unknown) => void; dong: () => void }
let luot: LuongGia[] = [];
function fetchGia(_url: string, init: RequestInit): Promise<Response> {
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  let dong = false;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
  const signal = init.signal as AbortSignal;
  signal.addEventListener("abort", () => { if (!dong) { dong = true; ctl.error(new DOMException("Aborted", "AbortError")); } });
  luot.push({
    body: JSON.parse(String(init.body)), signal,
    day: (x) => !dong && ctl.enqueue(enc.encode(`data: ${JSON.stringify(x)}\n\n`)),
    // Task 15 — đóng luồng bình thường (kết thúc lượt có result)
    dong: () => { if (!dong) { dong = true; ctl.close(); } },
  });
  return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));
}
const nghi = () => act(() => new Promise((r) => setTimeout(r, 20)));

let undoShim: (() => void) | null = null;
beforeAll(() => {
  undoShim = installResizeHandleHitAreaShim();
  installMatchMedia();
});
beforeEach(() => {
  for (const o of [queryOverrides, queryInputs, queryEnabled, mutateCalls, mutationResponses, mutationData, mutationPending]) {
    for (const k of Object.keys(o)) delete (o as Record<string, unknown>)[k];
  }
  for (const f of Object.values(toasts)) f.mockReset();
  try { window.localStorage.clear(); } catch { /* ignore */ }
  document.body.style.paddingRight = "";
  resetAiEntryForTest();
  mutationDeferred.clear();
  presetNarrow(false);
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
    // MAIN = thanh tab editor (toolbar DUY NHẤT — R-2-s) + editor (tabpanel); không chứa h1/header/chip
    const main = mainEl();
    expect(main).not.toBeNull();
    const tb = main.querySelectorAll("[data-layout-toolbar]");
    expect(tb).toHaveLength(1);
    expect(tb[0]).toContainElement(tabs);
    expect(within(main).getByRole("tabpanel")).toContainElement(within(main).getByLabelText("program-source"));
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

  it("R-2-s: tab Δ So sánh / Tags — điều khiển riêng nằm TRONG cùng một toolbar; MAIN luôn đúng MỘT data-layout-toolbar", () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn());
    const tabs = () => screen.getByRole("tablist", { name: /Editor tabs|Tab soạn thảo/ });
    fireEvent.click(within(tabs()).getByRole("tab", { name: /^Δ/ }));
    let tb = mainEl().querySelectorAll("[data-layout-toolbar]");
    expect(tb).toHaveLength(1);
    expect(tb[0]).toContainElement(screen.getByRole("combobox", { name: /Base|Bản gốc/ }));
    expect(tb[0]).toContainElement(screen.getByRole("combobox", { name: /Compare|So với/ }));
    fireEvent.click(within(tabs()).getByRole("tab", { name: /^Tags$/ }));
    tb = mainEl().querySelectorAll("[data-layout-toolbar]");
    expect(tb).toHaveLength(1);
    expect(tb[0]).toContainElement(screen.getByRole("button", { name: /^(Add variable|Add symbol|Thêm biến)$/ }));
    expect(within(mainEl()).getByRole("table")).toBeInTheDocument();
  });

  // Fix round 2 (Ruling R-2-t) — top bar 48 px, nút giữ 40 px (ui/button.tsx: size sm = h-10, quy tắc chạm 40 px). jsdom không có
  // layout ⇒ đo theo lớp Tailwind (h-N = 4N px, py-N, border-b = 1 px, box-sizing border-box): chiều cao header ≥ nút cao nhất
  // + đệm dọc + viền ⇒ không nút nào bị cắt (header overflow-hidden). Trình duyệt thật: peek-fr2.txt.
  it("R-2-t: header đủ cao cho nút 40 px + viền (không cắt nút)", () => {
    seed();
    renderPage();
    const hd = document.querySelector("[data-layout-header]") as HTMLElement;
    const px = (cls: string, re: RegExp) => { const m = cls.split(/\s+/).map((c) => re.exec(c)).find(Boolean); return m ? Number(m[1]) * 4 : null; };
    const headerH = px(hd.className, /^h-(\d+(?:\.\d+)?)$/);
    const padY = px(hd.className, /^py-(\d+(?:\.\d+)?)$/) ?? 0;
    const border = /(^|\s)border-b(\s|$)/.test(hd.className) ? 1 : 0;
    expect(headerH).toBe(48);
    const btns = Array.from(hd.querySelectorAll("button"));
    expect(btns.length).toBeGreaterThan(5);
    const tallest = Math.max(...btns.map((b) => px(b.className, /^(?:h|size)-(\d+(?:\.\d+)?)$/) ?? 0));
    expect(tallest).toBe(40);
    expect(headerH!).toBeGreaterThanOrEqual(tallest + 2 * padY + border);
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
describe("final wave T13 — thanh công cụ Δ / Tags không tràn ở 1366", () => {
  it("nhãn 'So sánh phiên bản' / 'Bảng biến / tag' chỉ hiện từ 1440 px (ở 1366 hai ô chọn + tab vừa một hàng)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "EngineeringWorkspace.tsx"), "utf8");
    for (const key of ['t("engineering.compareVersions"', 't("engineering.symbols"']) {
      const i = src.indexOf(key);
      expect(i, key).toBeGreaterThan(-1);
      const spanStart = src.lastIndexOf("<span", i);
      const cls = src.slice(spanStart, src.indexOf(">", spanStart));
      expect(cls, key).toMatch(/min-\[1440px\]:flex/);
      expect(cls, key).not.toMatch(/(^|\s)xl:flex/);
    }
  });
});

describe("Copilot là panel TRONG layout (R-2-b / R-2-j)", () => {
  it("Copilot mở ⇒ KHÔNG dock position:fixed, KHÔNG body.paddingRight; panel nằm trong inspector (aside data-layout-ai)", async () => {
    window.localStorage.setItem("progCopilot.open", "1");
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

  it("final wave M-8: bấm tab 'Thuộc tính' đang chọn (không đổi gì) rồi mở bằng nút AI ⇒ focus VẪN vào panel Copilot (lỗi cờ treo của IDE)", async () => {
    seed();
    renderPage({ aiButton: true });
    const props = within(inspector()).getByRole("tab", { name: /Properties|Thuộc tính/ });
    fireEvent.click(props); // đã chọn sẵn ⇒ không đổi trạng thái
    fireEvent.click(screen.getByRole("button", { name: /^(Mở Trợ lý Lập trình|Open Programming Copilot)$/ }));
    const copilotTab = within(inspector()).getByRole("tab", { name: /Copilot/ });
    expect(copilotTab).toHaveAttribute("aria-selected", "true");
    const panel = document.getElementById(copilotTab.getAttribute("aria-controls")!)!;
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it("final wave M-8: IDE dùng CopilotInspector chung (không còn bản chép logic mount/focus)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "EngineeringWorkspace.tsx"), "utf8");
    expect(src).toContain("<CopilotInspector");
    expect(src).not.toContain("copilotOpenedByTabRef");
  });

  it("fix round 1: stream Copilot SỐNG qua mốc 1024 px (rộng→hẹp→rộng) và thao tác panel (gập/mở panel dưới); Huỷ vẫn abort", async () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn());
    fireEvent.click(within(inspector()).getByRole("tab", { name: /Copilot/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Describe what to generate/), { target: { value: "toggle a run bit" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Generate$/ })); });
    await nghi();
    expect(luot).toHaveLength(1);
    luot[0].day({ type: "stage", stage: "gate", elapsedMs: 0 });
    await nghi();
    setNarrow(true); // < 1024 ⇒ vùng làm việc thành tab
    await nghi();
    expect(document.querySelector("[data-workbench][data-narrow]")).not.toBeNull();
    expect(luot[0].signal.aborted).toBe(false);
    expect(screen.getByTestId("copilot-cancel")).toBeInTheDocument();
    setNarrow(false);
    await nghi();
    fireEvent.click(bottomToggle());
    fireEvent.click(bottomToggle());
    await nghi();
    expect(luot).toHaveLength(1);
    expect(luot[0].signal.aborted).toBe(false);
    await act(async () => { fireEvent.click(screen.getByTestId("copilot-cancel")); });
    await nghi();
    expect(luot[0].signal.aborted).toBe(true);
    expect(screen.queryByTestId("copilot-cancel")).toBeNull();
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
// doc 81 Đợt 2 Task 15 — trang /programming-copilot cũ ⇒ CHẾ ĐỘ SCRATCH của IDE (`/engineering?copilot=scratch`, URL cũ
// chuyển hướng giữ query). Giữ MỌI năng lực của trang cũ: chọn loại/chế độ/hãng, sinh mã, stream, Huỷ, kết quả + kiểm
// tra của lớp an toàn, Sao chép; KHÔNG thêm năng lực (không "Chèn vào editor" khi chưa có dự án — trang cũ cũng không).
describe("Chế độ scratch của IDE (thay trang Copilot riêng — Task 15)", () => {
  function renderWithEng() {
    return render(
      <EngineeringProvider>
        <ProgrammingCopilotProvider>
          <EngineeringWorkspace />
        </ProgrammingCopilotProvider>
      </EngineeringProvider>,
    );
  }
  function scratch(o: { lastProject?: number; extra?: string } = {}) {
    seed();
    window.history.pushState({}, "", `/engineering?copilot=scratch${o.extra ?? ""}`);
    if (o.lastProject != null) {
      window.localStorage.setItem("engineering-last-selected", JSON.stringify({ projectId: o.lastProject, machineId: null, workflowRef: null }));
    }
    return renderWithEng();
  }

  it("?copilot=scratch ⇒ panel Copilot MỞ trong layout, KHÔNG tự mở dự án nhớ lần trước, ghi chú nháp, không nút Chèn", async () => {
    scratch({ lastProject: 1 });
    await screen.findByPlaceholderText(/Describe what to generate/);
    expect(within(inspector()).getByRole("tab", { name: /Copilot/ })).toHaveAttribute("aria-selected", "true");
    // dự án nhớ lần trước (P1) KHÔNG bị mở: không truy vấn phiên bản, editor là trạng thái chưa chọn dự án
    expect(queryEnabled["programming.listArtifacts"]).toBe(false);
    expect(screen.queryByText(/^v1 · main/, { selector: "button" })).toBeNull();
    expect(document.querySelector("[data-copilot-scratch]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Apply to editor|Chèn vào editor/ })).toBeNull();
    // cùng lõi Copilot của IDE: nằm trong aside data-layout-ai, ngoài MAIN, không dock fixed
    expect(document.querySelector("aside[data-layout-ai]")).not.toBeNull();
    expect(document.body.style.paddingRight).toBe("");
  });

  it("năng lực trang cũ: Sinh mã ⇒ stream SSE (kind mặc định iec61131-st như trang cũ) ⇒ kết quả + Sao chép; KHÔNG Chèn", async () => {
    scratch();
    fireEvent.change(await screen.findByPlaceholderText(/Describe what to generate/), { target: { value: "moving average D100" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Generate$/ })); });
    await nghi();
    expect(luot).toHaveLength(1);
    expect(luot[0].body).toMatchObject({ kind: "iec61131-st", mode: "generate", request: "moving average D100" });
    expect(luot[0].body).not.toHaveProperty("contextCode");
    luot[0].day({ type: "result", result: { ok: true, refused: false, kind: "iec61131-st", code: "X := 1;", validation: { ok: true, diagnostics: [] } } });
    luot[0].dong();
    await nghi();
    expect(screen.getByLabelText("copilot-result")).toHaveValue("X := 1;");
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply to editor|Chèn vào editor/ })).toBeNull();
  });

  it("năng lực trang cũ: Huỷ giữa chừng ⇒ abort; stream sống qua đổi tab Thuộc tính ↔ Copilot", async () => {
    scratch();
    fireEvent.change(await screen.findByPlaceholderText(/Describe what to generate/), { target: { value: "x" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Generate$/ })); });
    await nghi();
    fireEvent.click(within(inspector()).getByRole("tab", { name: /Properties|Thuộc tính/ }));
    fireEvent.click(within(inspector()).getByRole("tab", { name: /Copilot/ }));
    await nghi();
    expect(luot).toHaveLength(1);
    expect(luot[0].signal.aborted).toBe(false);
    await act(async () => { fireEvent.click(screen.getByTestId("copilot-cancel")); });
    await nghi();
    expect(luot[0].signal.aborted).toBe(true);
  });

  it("?copilot=scratch&projectId=1 (query cũ giữ nguyên) ⇒ mở dự án đó; có dự án thì Chèn trở lại và tham số scratch rời URL", async () => {
    scratch({ extra: "&projectId=1" });
    await screen.findByPlaceholderText(/Describe what to generate/);
    expect(queryEnabled["programming.listArtifacts"]).toBe(true);
    expect(document.querySelector("[data-copilot-scratch]")).toBeNull();
    expect(window.location.search).not.toContain("copilot=scratch");
    expect(window.location.search).toContain("projectId=1");
  });

  it("không ?copilot=scratch ⇒ hành vi cũ: dự án nhớ lần trước vẫn tự mở", async () => {
    seed();
    window.history.pushState({}, "", "/engineering");
    window.localStorage.setItem("engineering-last-selected", JSON.stringify({ projectId: 1, machineId: null, workflowRef: null }));
    renderWithEng();
    await nghi();
    expect(queryEnabled["programming.listArtifacts"]).toBe(true);
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

  it("lượt deploy/đội máy XONG (onSuccess) ⇒ wizard đóng, panel dưới MỞ ở 'Lịch sử deploy' với kết quả rollout (ý định rõ — R-2-l)", async () => {
    seed();
    const fleet = { halted: false, promoted: true, haltCode: null, haltReason: null, results: [{ deviceId: 3, phase: "canary", status: "deployed", error: null, rolledBack: false, rollbackError: null }] };
    mutationResponses["programming.deployToFleet"] = () => fleet;
    mutationData["programming.deployToFleet"] = fleet;
    renderPage();
    expect(bottomToggle()).toHaveAttribute("aria-expanded", "false");
    const d = await moWizard();
    next(d);
    fireEvent.click(within(d).getByRole("radio", { name: /Fleet|Đội máy/ }));
    fireEvent.click(within(d).getByText("M3 · #3").closest("label")!.querySelector('[role="checkbox"]') as HTMLElement);
    next(d);
    next(d);
    fireEvent.click(within(d).getByTestId("engineering-fleet-deploy-button"));
    const otp = document.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(otp, { target: { value: "654321" } }); });
    await nghi();
    expect(mutateCalls["programming.deployToFleet"]).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: /Deploy build|Triển khai build/ })).toBeNull();
    expect(bottomToggle()).toHaveAttribute("aria-expanded", "true");
    const bottom = document.querySelector("[data-workbench-bottom]") as HTMLElement;
    expect(within(bottom).getByRole("tab", { name: /Deploy history|Lịch sử deploy/ })).toHaveAttribute("aria-selected", "true");
    expect(within(bottom).getByText(/promote/i)).toBeVisible();
  });

  it("đội máy: nút cuối KHOÁ khi chưa chọn máy (cổng fleetReady cũ); production khoá tới khi có người ký + lý do", async () => {
    const user = userEvent.setup();
    seed();
    renderPage();
    const d = await moWizard();
    next(d);
    fireEvent.click(within(d).getByRole("radio", { name: /Fleet|Đội máy/ }));
    next(d);
    next(d);
    expect(within(d).getByTestId("engineering-fleet-deploy-button")).toBeDisabled();
    expect(within(d).getByTestId("ide-wizard-not-ready")).toBeInTheDocument();
    fireEvent.click(within(d).getByTestId("engineering-fleet-deploy-button"));
    expect(screen.queryByText(otpText)).not.toBeInTheDocument();
    // chọn một máy ⇒ mở
    fireEvent.click(within(d).getByRole("button", { name: /^(Back|Quay lại)$/ }));
    fireEvent.click(within(d).getByRole("button", { name: /^(Back|Quay lại)$/ }));
    fireEvent.click(within(d).getByText("M3 · #3").closest("label")!.querySelector('[role="checkbox"]') as HTMLElement);
    next(d);
    next(d);
    expect(within(d).getByTestId("engineering-fleet-deploy-button")).not.toBeDisabled();
    // production ⇒ khoá lại tới khi có người ký + lý do
    fireEvent.click(within(d).getByRole("button", { name: /^(Back|Quay lại)$/ }));
    await user.click(within(d).getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: "production" }));
    next(d);
    expect(within(d).getByTestId("engineering-fleet-deploy-button")).toBeDisabled();
    expect(mutateCalls["programming.deployToFleet"]).toBeUndefined();
  });

  it("bản xem trước ở MỘT chỗ tại một thời điểm: wizard mở ⇒ chỉ bản trong wizard (inspector nhường)", async () => {
    seed();
    renderPage();
    fireEvent.click(versionBtn());
    fireEvent.click(screen.getByText("#5"));
    expect(document.querySelectorAll('[data-testid="deploy-preview"]')).toHaveLength(1);
    const d = await moWizard();
    next(d);
    next(d);
    next(d);
    const all = document.querySelectorAll('[data-testid="deploy-preview"]');
    expect(all).toHaveLength(1);
    expect(d.contains(all[0])).toBe(true);
  });

  it("fix round 1: wizard mở ⇒ phím tắt trang TẮT (Ctrl/Cmd+Enter không build, Ctrl/Cmd+S không lưu) — build ở bước cuối không bị đổi", async () => {
    seed();
    mutationResponses["programming.buildArtifact"] = () => ({ id: 6, ok: true });
    renderPage();
    const d = await moWizard();
    next(d);
    next(d);
    next(d);
    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    expect(mutateCalls["programming.buildArtifact"]).toBeUndefined();
    expect(mutateCalls["programming.createArtifact"]).toBeUndefined();
    expect(queryInputs["programming.deployPreview"]).toMatchObject({ buildId: 5 });
    expect(within(d).getByTestId("engineering-deploy-button")).not.toBeDisabled();
    // đóng wizard ⇒ phím tắt trở lại (đối chứng dương)
    fireEvent.keyDown(d, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    expect(mutateCalls["programming.buildArtifact"]).toEqual([{ artifactId: 11 }]);
  });

  it("fix round 1: build đổi SAU khi mở wizard (kết quả Build về muộn) ⇒ nút cuối KHOÁ + cảnh báo; không OTP, 0 deployBuild", async () => {
    seed();
    mutationResponses["programming.buildArtifact"] = () => ({ id: 6, ok: true });
    mutationDeferred.add("programming.buildArtifact");
    renderPage();
    fireEvent.click(versionBtn());
    fireEvent.click(screen.getByText("#5"));
    fireEvent.click(btn(/^Build$/)); // build mới đang chạy (hoãn)
    fireEvent.click(btn(/^(Deploy…)$/)); // ghim #5
    const d = screen.getByRole("dialog");
    next(d);
    next(d);
    next(d);
    expect(within(d).getByTestId("engineering-deploy-button")).not.toBeDisabled();
    xaHoan("programming.buildArtifact"); // build #6 về ⇒ build đang chọn đổi dưới bước cuối
    expect(queryInputs["programming.deployPreview"]).toMatchObject({ buildId: 6 });
    expect(within(d).getByTestId("ide-wizard-build-changed")).toBeInTheDocument();
    expect(within(d).getByTestId("engineering-deploy-button")).toBeDisabled();
    fireEvent.click(within(d).getByTestId("engineering-deploy-button"));
    expect(screen.queryByText(otpText)).not.toBeInTheDocument();
    expect(mutateCalls["programming.deployBuild"]).toBeUndefined();
    // mở lại ⇒ ghim build mới, mở khoá
    fireEvent.keyDown(d, { key: "Escape" });
    fireEvent.click(btn(/^(Deploy…)$/));
    const d2 = screen.getByRole("dialog");
    next(d2);
    next(d2);
    next(d2);
    expect(within(d2).queryByTestId("ide-wizard-build-changed")).toBeNull();
    expect(within(d2).getByTestId("engineering-deploy-button")).not.toBeDisabled();
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
describe("Rollback deployment — RollbackConfirm (final wave R-2-z3: requireOtp=false + stepUp.guard của trang, R-2-q)", () => {
  const otpText = /Two-step verification to deploy|Xác thực 2 bước/;
  const openDeploys = () => {
    fireEvent.click(screen.getByRole("tab", { name: /Lịch sử deploy|Deploy history/ }));
    return document.getElementById("ide-bottom-deploys") as HTMLElement;
  };

  it("Khôi phục ⇒ AlertDialog xác nhận phá huỷ (không ô lý do), CHƯA gọi server; xác nhận ⇒ OTP; OTP ⇒ đúng MỘT rollbackDeployment với bộ tham số cũ", async () => {
    seed();
    queryOverrides["programming.listDeployments"] = () => makeQuery({ data: [{ id: 42, stage: "staging", status: "deployed", simulated: false }] });
    renderPage();
    const panel = openDeploys();
    fireEvent.click(within(panel).getByRole("button", { name: /Khôi phục|Roll ?back/ }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent(/staging/);
    expect(within(dlg).queryByRole("textbox")).toBeNull();
    expect(mutateCalls["programming.rollbackDeployment"]).toBeUndefined();
    expect(screen.queryByText(otpText)).not.toBeInTheDocument();
    const confirm = within(dlg).getAllByRole("button").find((b) => /Khôi phục|Roll ?back/.test(b.textContent ?? ""))!;
    fireEvent.click(confirm);
    expect(await screen.findByText(otpText)).toBeInTheDocument();
    expect(mutateCalls["programming.rollbackDeployment"]).toBeUndefined();
    const otp = document.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(otp, { target: { value: "654321" } }); });
    await nghi();
    expect(mutateCalls["programming.rollbackDeployment"]).toHaveLength(1);
    const call = mutateCalls["programming.rollbackDeployment"]![0] as Record<string, unknown>;
    expect(Object.keys(call).sort()).toEqual(["actionId", "deploymentId", "idempotencyKey", "totpCode"]);
    expect(call).toMatchObject({ deploymentId: 42, totpCode: "654321" });
    expect(String(call.idempotencyKey)).toMatch(/^rollback-dep/);
    expect(call.actionId).toBe(call.idempotencyKey);
  });

  it("Huỷ ở hộp xác nhận ⇒ không OTP, không gọi server; mở lại ⇒ khoá thử MỚI (WS-04)", async () => {
    seed();
    queryOverrides["programming.listDeployments"] = () => makeQuery({ data: [{ id: 42, stage: "staging", status: "deployed", simulated: false }] });
    renderPage();
    const panel = openDeploys();
    fireEvent.click(within(panel).getByRole("button", { name: /Khôi phục|Roll ?back/ }));
    const dlg = await screen.findByRole("alertdialog");
    fireEvent.click(within(dlg).getByRole("button", { name: /Hủy|Huỷ|Cancel/ }));
    await nghi();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText(otpText)).not.toBeInTheDocument();
    expect(mutateCalls["programming.rollbackDeployment"]).toBeUndefined();
  });

  it("tĩnh: IDE dùng <RollbackConfirm requireReason={false} requireOtp={false}> và .mutate nằm trong stepUp.guard của trang — không còn AlertDialog rollback viết tay", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "EngineeringWorkspace.tsx"), "utf8");
    const i = src.indexOf("<RollbackConfirm");
    expect(i, "IDE phải dùng RollbackConfirm (Task 3 / R-2-q)").toBeGreaterThan(-1);
    const block = src.slice(i, src.indexOf("/>", src.indexOf("onRollback", i)) + 2);
    expect(block).toContain("requireReason={false}");
    expect(block).toContain("requireOtp={false}");
    expect(block).toMatch(/stepUp\.guard\(\(totpCode\) => rollbackM\.mutate\(/);
    expect(src).not.toContain("<AlertDialog open={rollbackTarget != null}");
  });
});

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

// doc 81 Đợt 3 Task 0 (D1, browser check 2026-10-05) — Copilot mở rồi thu hẹp < 1024: Copilot bị giấu (tab "Soạn thảo")
// trong khi nút AI vẫn báo mở ⇒ bấm lần 1 đóng thứ vô hình. Nay: vào màn hẹp ⇒ tab Inspector/Copilot HIỆN; rời tab đó
// ⇒ Copilot đóng (nút AI báo đóng, khớp thứ nhìn thấy); MỘT lần bấm nút AI ⇒ hiện lại.
describe("D1 — Copilot qua mốc 1024 px: nút AI khớp với thứ nhìn thấy", () => {
  it("mở Copilot ở màn rộng → thu hẹp ⇒ Copilot HIỆN; rời tab ⇒ nút AI báo đóng; bấm MỘT lần ⇒ hiện lại", async () => {
    seed();
    renderPage({ aiButton: true });
    fireEvent.click(versionBtn());
    const ai = screen.getByRole("button", { name: /^(Mở Trợ lý Lập trình|Open Programming Copilot)$/ });
    fireEvent.click(ai);
    expect(ai).toHaveAttribute("aria-expanded", "true");
    const copilotTab = within(inspector()).getByRole("tab", { name: /Copilot/ });
    const panel = document.getElementById(copilotTab.getAttribute("aria-controls")!)!;
    setNarrow(true);
    await nghi();
    expect(document.querySelector("[data-workbench][data-narrow]")).not.toBeNull();
    expect(panel).toBeVisible();
    expect(ai).toHaveAttribute("aria-expanded", "true");
    fireEvent.mouseDown(screen.getByRole("tab", { name: /^(Soạn thảo|Editor)$/ }));
    await nghi();
    expect(panel).not.toBeVisible();
    expect(ai).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(ai);
    await nghi();
    expect(ai).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    setNarrow(false);
    await nghi();
  });
});
