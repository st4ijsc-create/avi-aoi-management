// @vitest-environment jsdom
//
// doc 81 Đợt 2 Task 14 — POU Studio `/pou-studio` thành mẫu P1 "Workbench" trên EngineeringShell (cùng khuôn IR Editor).
// Hợp đồng (task-14-brief + plan GC3/GC4/Review Focus 1/3 + ruling R-2-b/j/l/n/s/t):
//   - Lưới `lg:grid-cols-2` ⇒ EngineeringShell: activity bar · Explorer "Mở" (MỚI — dự án iec61131-pou → phiên bản pou-json →
//     Mở; mẫu LAD/FBD/SFC) · MAIN = thanh tab editor Canvas / JSON (một `data-layout-toolbar`, R-2-s) + editor cao hết vùng ·
//     Inspector phải [Chuyển mã → ST | PLCopen XML | Copilot] · panel dưới "Vấn đề" gập lần đầu (R-2-l) · thanh trạng thái
//     (chip "Xem trước — không deploy" + KPI).
//   - Copilot là panel TRONG layout (R-2-b). Lưu vào project = sheet phải; một createArtifact mỗi lần lưu (R-2-n).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { installResizeHandleHitAreaShim } from "@/components/patterns/layoutKitTestPanels";
import { installMatchMedia, presetNarrow } from "@/components/patterns/layoutKitTestMedia";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { getAiEntryState, resetAiEntryForTest, setAiChatOpen } from "@/lib/aiEntryStore";
import VI from "@/i18n/locales/vi.json";
import EN from "@/i18n/locales/en.json";
import ZH from "@/i18n/locales/zh.json";
import PAGE_SRC from "./PouStudio.tsx?raw";

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main data-testid="dashboard-layout">{children}</main>,
}));
const perm = vi.hoisted(() => ({ control: true }));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: (_m: string, a: string) => (a === "canView" ? true : perm.control) }),
}));
vi.mock("@/hooks/useLicenseModules", () => ({ useLicenseModules: () => ({ isModuleBlocked: () => false }) }));
vi.mock("@/contexts/EngineeringContext", () => ({
  useEngineering: () => ({ lastSelected: { projectId: null }, setLastProjectId: vi.fn() }),
}));
const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
vi.mock("@/components/engineering/CodeEditor", () => ({
  CodeEditor: (p: { value: string; onChange?: (v: string) => void; height?: string; "aria-label"?: string }) => (
    <textarea aria-label={p["aria-label"]} data-height={p.height} value={p.value} onChange={(e) => p.onChange?.(e.target.value)} />
  ),
}));
vi.mock("@/components/programming/PouCanvas", () => ({
  PouCanvas: (p: { project: { pous: Array<{ name: string }> }; pouIndex: number; fill?: boolean }) => (
    <div data-testid="pou-canvas" data-fill={String(Boolean(p.fill))} className="react-flow">{p.project.pous[p.pouIndex]?.name}</div>
  ),
}));

// ─── trpc giả (kết quả ổn định theo thủ tục + input, như react-query) ─────────────────────────────
interface QueryResult { data: unknown; isLoading: boolean; isPending: boolean; isFetching: boolean; isError: boolean; error: unknown; refetch: () => void }
function makeQuery(o: Partial<QueryResult> = {}): QueryResult {
  return { data: undefined, isLoading: false, isPending: false, isFetching: false, isError: false, error: null, refetch: vi.fn(), ...o };
}
const queryOverrides: Record<string, (input: unknown) => QueryResult> = {};
const queryCalls: Record<string, unknown[]> = {};
const queryCache = new Map<string, { fn: (input: unknown) => QueryResult; r: QueryResult }>();
const mutateCalls: Record<string, unknown[]> = {};
const mutationResponses: Record<string, ((vars: any) => unknown) | undefined> = {};
const invalidateCalls: Array<[string, unknown]> = [];
vi.mock("@/lib/trpc", () => {
  const utilsProxy = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get(_t, k: string) {
        if (k === "fetch") return () => Promise.reject(new Error("no fetch"));
        if (k === "invalidate" || k === "refetch") return (input?: unknown) => { invalidateCalls.push([path.join("."), input]); return Promise.resolve(); };
        return utilsProxy([...path, k]);
      },
    });
  return {
    trpc: new Proxy({}, {
      get(_t, routerName: string) {
        if (routerName === "useUtils") return () => utilsProxy([]);
        return new Proxy({}, {
          get(_t2, procName: string) {
            const key = `${routerName}.${procName}`;
            return {
              useQuery: (input?: unknown, opts?: { enabled?: boolean }) => {
                if (opts?.enabled === false) return makeQuery();
                (queryCalls[key] ??= []).push(input);
                if (!queryOverrides[key]) return makeQuery();
                const ck = `${key}|${JSON.stringify(input ?? null)}`;
                const hit = queryCache.get(ck);
                if (hit && hit.fn === queryOverrides[key]) return hit.r;
                const r = queryOverrides[key](input);
                queryCache.set(ck, { fn: queryOverrides[key], r });
                return r;
              },
              useMutation: () => ({
                mutate: (vars: unknown) => { (mutateCalls[key] ??= []).push(vars); },
                mutateAsync: (vars: unknown) => {
                  (mutateCalls[key] ??= []).push(vars);
                  const r = mutationResponses[key];
                  return Promise.resolve(r ? r(vars) : undefined);
                },
                reset: vi.fn(), isPending: false, isError: false,
              }),
            };
          },
        });
      },
    }),
  };
});

import PouStudio from "./PouStudio";
import { ProgrammingCopilotProvider } from "@/contexts/ProgrammingCopilotContext";
import { ShellAiButton } from "@/components/ShellAiButton";

const OPENED_MODEL = { name: "Opened", pous: [{ name: "FromServer", pouType: "program", vars: [], body: { language: "LD", networks: [] } }] };
const ARTS = [
  { id: 31, projectId: 5, version: 3, branch: "main", status: "draft", language: "pou-json", content: JSON.stringify(OPENED_MODEL) },
  { id: 30, projectId: 5, version: 2, branch: "main", status: "draft", language: "st", content: "PROGRAM X END_PROGRAM" },
];

function seed(o: { diagnostics?: Array<Record<string, unknown>> } = {}) {
  window.history.pushState({}, "", "/pou-studio");
  queryOverrides["programming.listProjects"] = () => makeQuery({ data: [{ id: 5, code: "PP", name: "Press POU", kind: "iec61131-pou" }, { id: 6, code: "IR", name: "IR one", kind: "ir-flow" }] });
  const diags = o.diagnostics ?? [];
  queryOverrides["programming.pouLint"] = () => makeQuery({ data: { ok: !diags.some((d) => d.severity === "error"), diagnostics: diags } });
  queryOverrides["programming.pouTranspilePreview"] = () => makeQuery({
    data: { ok: true, code: "(* [IEC LD #1] *)\nMotor := Start;", summary: { pouCount: 1, networks: 1, pous: [{ name: "MotorControl", language: "LD" }] } },
  });
  queryOverrides["programming.plcopenExport"] = () => makeQuery({ data: { xml: "<project/>" } });
  queryOverrides["programming.listArtifacts"] = () => makeQuery({ data: ARTS });
}

function renderPage(o: { aiButton?: boolean } = {}) {
  return render(
    <ProgrammingCopilotProvider>
      {o.aiButton && <ShellAiButton />}
      <PouStudio />
    </ProgrammingCopilotProvider>,
  );
}

let undoShim: (() => void) | null = null;
beforeAll(async () => {
  await initLayoutKitTestI18n();
  undoShim = installResizeHandleHitAreaShim();
  installMatchMedia();
});
beforeEach(() => {
  for (const o of [queryOverrides, queryCalls, mutateCalls, mutationResponses]) {
    for (const k of Object.keys(o)) delete (o as Record<string, unknown>)[k];
  }
  queryCache.clear();
  invalidateCalls.length = 0;
  for (const f of Object.values(toasts)) f.mockReset();
  try { window.localStorage.clear(); } catch { /* ignore */ }
  document.body.style.paddingRight = "";
  perm.control = true;
  resetAiEntryForTest();
  presetNarrow(false);
  Element.prototype.scrollIntoView ??= function () {};
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture ??= () => false;
  (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture ??= () => {};
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => cleanup());
afterAll(() => undoShim?.());

const mainEl = () => document.querySelector('[data-layout-main="pou-editor"]') as HTMLElement;
const statusBar = () => document.querySelector("[data-workbench-statusbar]") as HTMLElement;
const explorer = () => document.querySelector("[data-workbench-left]") as HTMLElement;
const header = () => document.querySelector("[data-layout-header]") as HTMLElement;
const inspector = () => document.querySelector("aside[aria-label]") as HTMLElement;
const editorTabs = () => screen.getByRole("tablist", { name: "Tab soạn thảo" });
const bottomToggle = () => screen.getByRole("button", { name: "Ẩn/hiện panel dưới" });

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("POU Studio — bố cục P1 trên EngineeringShell", () => {
  it("activity bar 'Mở' · MAIN = MỘT toolbar (tab Canvas / JSON) + canvas cao hết vùng · không h1/header/KPI trong MAIN · không lưới cố định", () => {
    seed();
    renderPage();
    expect(within(screen.getByRole("toolbar", { name: "Thanh hoạt động" })).getByRole("button", { name: /^Mở$/ })).toBeInTheDocument();
    const names = within(editorTabs()).getAllByRole("tab").map((x) => x.textContent ?? "");
    expect(names).toEqual(["Canvas", "JSON"]);
    const main = mainEl();
    expect(main).not.toBeNull();
    const tb = main.querySelectorAll("[data-layout-toolbar]");
    expect(tb).toHaveLength(1);
    expect(tb[0]).toContainElement(editorTabs());
    expect(within(main).getByRole("tabpanel")).toContainElement(screen.getByTestId("pou-canvas"));
    expect(screen.getByTestId("pou-canvas")).toHaveAttribute("data-fill", "true");
    expect(main.querySelector("h1,[data-layout-header],[data-layout-kpi]")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("IEC 61131 POU Studio");
    expect(document.querySelector(".lg\\:grid-cols-2")).toBeNull();
    // JSON là tab editor thứ hai — editor cao hết vùng
    fireEvent.click(within(editorTabs()).getByRole("tab", { name: "JSON" }));
    expect(within(mainEl()).getByLabelText("pou-json")).toHaveAttribute("data-height", "100%");
    expect(mainEl().querySelectorAll("[data-layout-toolbar]")).toHaveLength(1);
  });

  it("thanh trạng thái: chip 'Xem trước — không deploy' (popover = câu trung thực cũ) + KPI POU / mạng / lỗi / trạng thái lint", async () => {
    seed();
    renderPage();
    const sb = statusBar();
    fireEvent.click(within(sb).getByRole("button", { name: /Xem trước — không deploy/ }));
    expect(await screen.findByText(/Chỉ mô hình \+ lint \+ round-trip PLCopen XML/)).toBeInTheDocument();
    expect(within(sb).getByTestId("pou-kpi-pous")).toHaveTextContent("POU: 1");
    expect(within(sb).getByTestId("pou-kpi-networks")).toHaveTextContent("Mạng / bước: 1");
    expect(within(sb).getByTestId("pou-kpi-errors")).toHaveTextContent("Lỗi lint: 0");
    expect(within(sb).getByTestId("pou-kpi-status")).toHaveTextContent("Trạng thái lint: Đạt");
    for (const label of ["Mạng / bước", "Lỗi lint", "Trạng thái lint"]) {
      for (const el of screen.getAllByText(new RegExp(label))) expect(sb.contains(el)).toBe(true);
    }
  });

  it("R-2-t: top bar 48 px cho nút 40 px", () => {
    seed();
    renderPage();
    const hd = header();
    const px = (cls: string, re: RegExp) => { const m = cls.split(/\s+/).map((c) => re.exec(c)).find(Boolean); return m ? Number(m[1]) * 4 : null; };
    expect(px(hd.className, /^h-(\d+(?:\.\d+)?)$/)).toBe(48);
    const tallest = Math.max(...Array.from(hd.querySelectorAll("button")).map((b) => px(b.className, /^(?:h|size)-(\d+(?:\.\d+)?)$/) ?? 0));
    expect(tallest).toBeLessThanOrEqual(40);
  });

  it("panel dưới 'Vấn đề' GẬP lần đầu (R-2-l); số vấn đề luôn ở thanh trạng thái; bấm ⇒ mở và thấy chẩn đoán", () => {
    seed({ diagnostics: [{ severity: "error", rule: "UNDECL", pou: "MotorControl", ref: "rung0", message: "DIAG-POU-1" }] });
    renderPage();
    expect(bottomToggle()).toHaveAttribute("aria-expanded", "false");
    expect(within(statusBar()).getByTestId("pou-status-problems")).toHaveTextContent("1");
    fireEvent.click(within(statusBar()).getByTestId("pou-status-problems"));
    expect(bottomToggle()).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByTestId("pou-problems")).getByText(/DIAG-POU-1/)).toBeInTheDocument();
    expect(within(statusBar()).getByTestId("pou-kpi-status")).toHaveTextContent("Trạng thái lint: Bị chặn");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Explorer 'Mở' (mới) — chỉ đọc", () => {
  it("chỉ dự án iec61131-pou; chưa chọn dự án ⇒ KHÔNG truy vấn phiên bản; chọn ⇒ listArtifacts({projectId}); chỉ pou-json mở được; Mở ⇒ nạp vào trình soạn, đích lưu = dự án đó, 0 mutation", () => {
    seed();
    renderPage();
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Thanh hoạt động" })).getByRole("button", { name: /^Mở$/ }));
    const ex = explorer();
    expect(within(ex).getByRole("button", { name: /PP · Press POU/ })).toBeInTheDocument();
    expect(within(ex).queryByRole("button", { name: /IR one/ })).toBeNull();
    expect(queryCalls["programming.listArtifacts"]).toBeUndefined();
    fireEvent.click(within(ex).getByRole("button", { name: /PP · Press POU/ }));
    expect(queryCalls["programming.listArtifacts"]?.at(-1)).toEqual({ projectId: 5 });
    const rows = ex.querySelectorAll("[data-artifact-row]");
    expect(rows).toHaveLength(1);
    expect(within(ex).getByText(/1 phiên bản ngôn ngữ khác/)).toBeInTheDocument();
    fireEvent.click(within(rows[0] as HTMLElement).getByRole("button", { name: /^Mở$/ }));
    expect(screen.getByTestId("pou-canvas")).toHaveTextContent("FromServer");
    fireEvent.click(within(editorTabs()).getByRole("tab", { name: "JSON" }));
    expect((within(mainEl()).getByLabelText("pou-json") as HTMLTextAreaElement).value).toBe(ARTS[0].content);
    expect(Object.keys(mutateCalls)).toHaveLength(0);
    // đích lưu đã chọn sẵn = dự án vừa mở; có lối Build/Deploy ở Engineering như sau khi lưu
    expect(within(header()).getByRole("button", { name: /Build\/Deploy ở Engineering/ })).toBeInTheDocument();
  });

  it("mẫu LAD/FBD/SFC nằm trong Explorer 'Mở' và nạp mẫu vào mô hình", () => {
    seed();
    renderPage();
    fireEvent.click(within(explorer()).getByRole("button", { name: "FBD" }));
    expect(screen.getByTestId("pou-canvas")).toHaveTextContent("Compute");
    expect(toasts.success).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Inspector ST / PLCopen / Copilot + Lưu vào project", () => {
  it("PLCopen: xuất XML chỉ truy vấn khi tab PLCopen đang hiện (như Tabs cũ)", () => {
    seed();
    renderPage();
    const insp = inspector();
    expect(within(insp).getByRole("tab", { name: /Chuyển mã → ST/ })).toHaveAttribute("aria-selected", "true");
    expect(within(insp).getByText(/Motor := Start;/)).toBeInTheDocument();
    expect(queryCalls["programming.plcopenExport"]).toBeUndefined();
    fireEvent.click(within(insp).getByRole("tab", { name: /PLCopen XML/ }));
    expect(queryCalls["programming.plcopenExport"]?.length ?? 0).toBeGreaterThan(0);
    expect(within(insp).getByText("<project/>")).toBeInTheDocument();
  });

  it("Copilot mở ⇒ panel TRONG inspector (aside data-layout-ai), không dock fixed, không body.paddingRight; nút AI ⇒ focus vào panel, chat không chồng", async () => {
    seed();
    renderPage({ aiButton: true });
    const ai = screen.getByRole("button", { name: "Mở Trợ lý Lập trình" });
    fireEvent.click(ai);
    const aside = document.querySelector("aside[data-layout-ai]") as HTMLElement;
    expect(aside).not.toBeNull();
    const tab = within(aside).getByRole("tab", { name: /Copilot/ });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById(tab.getAttribute("aria-controls")!)!.contains(document.activeElement)).toBe(true);
    await within(aside).findByPlaceholderText(/Describe what to generate|Mô tả/);
    expect(document.body.style.paddingRight).toBe("");
    expect(Array.from(document.querySelectorAll("aside")).some((a) => /(^|\s)fixed(\s|$)/.test(a.className))).toBe(false);
    expect(mainEl().contains(aside)).toBe(false);
    act(() => setAiChatOpen(true));
    expect(getAiEntryState().chatOpen).toBe(false);
  });

  it("'Lưu vào project' mở SHEET phải; Lưu phiên bản ⇒ ĐÚNG MỘT createArtifact({projectId, branch:'main', language:'pou-json', content}); không quyền ⇒ khoá", async () => {
    seed();
    mutationResponses["programming.createArtifact"] = () => ({ id: 99, version: 4 });
    window.history.pushState({}, "", "/pou-studio?projectId=5");
    renderPage();
    fireEvent.click(within(header()).getByRole("button", { name: /Lưu vào project/ }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveAttribute("data-slot", "sheet-content");
    await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: /^Lưu phiên bản$/ })); });
    expect(mutateCalls["programming.createArtifact"]).toHaveLength(1);
    expect(mutateCalls["programming.createArtifact"][0]).toMatchObject({ projectId: 5, branch: "main", language: "pou-json" });
    expect(String((mutateCalls["programming.createArtifact"][0] as { content: string }).content)).toContain("MotorControl");
    cleanup();
    perm.control = false;
    seed();
    renderPage();
    expect(within(header()).getByRole("button", { name: /Lưu vào project/ })).toBeDisabled();
  });

  it("lỗi hình dạng (server) ⇒ thông điệp ĐÃ DỊCH qua mapTrpcError trong panel Vấn đề, badge ở header", () => {
    seed();
    const err = Object.assign(new Error("raw-english-shape"), { data: { code: "UNAUTHORIZED" } });
    queryOverrides["programming.pouTranspilePreview"] = () => makeQuery({ error: err, isError: true });
    renderPage();
    expect(within(header()).getByText("Lỗi hình dạng")).toBeInTheDocument();
    fireEvent.click(within(statusBar()).getByTestId("pou-status-problems"));
    expect(within(screen.getByTestId("pou-problems")).getByText(/Phiên đăng nhập hết hạn/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/raw-english-shape/);
  });

  it("i18n: mọi khoá pou.ws.* trang dùng có ở vi/en/zh", () => {
    const keys = Array.from(new Set(Array.from(PAGE_SRC.matchAll(/t\("(pou\.ws\.[A-Za-z0-9_.]+)"/g)).map((m) => m[1])));
    expect(keys.length).toBeGreaterThan(5);
    const get = (o: unknown, k: string) => k.split(".").reduce<unknown>((x, p) => (x && typeof x === "object" ? (x as Record<string, unknown>)[p] : undefined), o);
    for (const k of keys) for (const L of [VI, EN, ZH]) expect(typeof get(L, k), k).toBe("string");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Task 14 fix round 1 (review I2 + Ruling R-2-u)
describe("Fix round 1", () => {
  const openBtn = () => within(screen.getByRole("toolbar", { name: "Thanh hoạt động" })).getByRole("button", { name: /^Mở$/ });
  const leftSize = () => Number((document.querySelector("[data-workbench-left]")!.closest("[data-panel]") as HTMLElement).getAttribute("data-panel-size"));

  it("R-2-u: Explorer 'Mở' GẬP lần đầu (canvas là việc chính); bấm 'Mở' ⇒ mở; dải 240–300 px (không còn 200)", () => {
    seed();
    renderPage();
    expect(openBtn()).toHaveAttribute("aria-expanded", "false");
    expect(leftSize()).toBe(0);
    fireEvent.click(openBtn());
    expect(openBtn()).toHaveAttribute("aria-expanded", "true");
    expect(leftSize()).toBeGreaterThan(0);
    expect(PAGE_SRC).toMatch(/explorerSize=\{\{ minPx: 240, maxPx: 300, defaultPx: 240 \}\}/);
    expect(PAGE_SRC).not.toMatch(/minPx: 200/);
  });

  it("R-2-u: deep link ?projectId= (dự án POU) ⇒ Explorer 'Mở' tự mở ở dự án đó", () => {
    seed();
    window.history.pushState({}, "", "/pou-studio?projectId=5");
    renderPage();
    expect(openBtn()).toHaveAttribute("aria-expanded", "true");
    expect(queryCalls["programming.listArtifacts"]?.at(-1)).toEqual({ projectId: 5 });
  });

  it("I2: lưu ⇒ invalidate listArtifacts của ĐÚNG dự án + Explorer 'Mở' chuyển sang dự án vừa lưu (kể cả dự án mới tạo)", async () => {
    seed();
    mutationResponses["programming.createProject"] = () => ({ id: 77, code: "NEW", name: "New" });
    mutationResponses["programming.createArtifact"] = () => ({ id: 100, version: 1 });
    renderPage();
    fireEvent.click(within(header()).getByRole("button", { name: /Lưu vào project/ }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: /Project mới/ }));
    fireEvent.change(within(dlg).getByLabelText("Mã project"), { target: { value: "NEW" } });
    fireEvent.change(within(dlg).getByLabelText("Tên project"), { target: { value: "New" } });
    await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: /Tạo project & lưu/ })); });
    expect(mutateCalls["programming.createArtifact"]).toHaveLength(1);
    expect(invalidateCalls).toContainEqual(["programming.listArtifacts", { projectId: 77 }]);
    expect(queryCalls["programming.listArtifacts"]?.at(-1)).toEqual({ projectId: 77 });
  });
});
