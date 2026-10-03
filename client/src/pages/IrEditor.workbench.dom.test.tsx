// @vitest-environment jsdom
//
// doc 81 Đợt 2 Task 14 — IR Editor `/ir-editor` thành mẫu P1/P2 "Workbench" trên EngineeringShell (doc 81 §1.2/§1.3).
// Hợp đồng (task-14-brief + plan GC3/GC4/Review Focus 1/3 + ruling R-2-b/j/l/n/s/t):
//   - `grid-cols-12` cố định ⇒ EngineeringShell: activity bar · Explorer (Bảng chọn khối — gập được · Luồng đã lưu · Khối hàm)
//     · MAIN = thanh tab editor (Vùng vẽ / So sánh phiên bản / Hợp nhất — một `data-layout-toolbar`, R-2-s) + canvas cao hết
//     vùng · Inspector/Transpile/Copilot phải · thanh trạng thái (chip "Xem trước — không deploy" + KPI).
//   - Copilot là panel TRONG layout (R-2-b): không dock position:fixed, không body.paddingRight.
//   - Giữ: lint dịch lỗi qua mapTrpcError, cổng Lưu/Build như cũ, một lời gọi mỗi lần bấm (R-2-n), phím tắt.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { installResizeHandleHitAreaShim } from "@/components/patterns/layoutKitTestPanels";
import { installMatchMedia, presetNarrow, setNarrow } from "@/components/patterns/layoutKitTestMedia";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { getAiEntryState, resetAiEntryForTest, setAiChatOpen } from "@/lib/aiEntryStore";
import VI from "@/i18n/locales/vi.json";
import EN from "@/i18n/locales/en.json";
import ZH from "@/i18n/locales/zh.json";
import PAGE_SRC from "./IrEditor.tsx?raw";

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
  CodeEditor: (p: { value: string; "aria-label"?: string }) => <textarea aria-label={p["aria-label"]} value={p.value} readOnly />,
}));
// Canvas đồ thị (react-flow) thay bằng bản giả: một nút "chọn" mỗi khối cấp cao + cờ `fill` (canvas cao hết vùng).
vi.mock("@/components/programming/IrGraphCanvas", () => ({
  IR_DND_MIME: "application/x-ir-block",
  IrGraphCanvas: (p: { flow: { blocks: Array<{ id?: string; type: string }> }; fill?: boolean; onSelect: (id: string) => void }) => (
    <div data-testid="ir-graph" data-fill={String(Boolean(p.fill))} className="react-flow">
      {p.flow.blocks.map((b) => (
        <button key={b.id} type="button" onClick={() => b.id && p.onSelect(b.id)}>{`chon-${b.type}`}</button>
      ))}
    </div>
  ),
}));
// Diff/Merge giả mang STATE CỤC BỘ (như bản thật: base/cmp, base/ours/theirs + `picks`) — để chứng minh state sống qua đổi tab.
vi.mock("@/components/programming/IrDiffPanel", async () => {
  const React = await import("react");
  return {
    IrDiffPanel: () => {
      const [v, setV] = React.useState("");
      return <div data-testid="ir-diff-panel"><input aria-label="diff-base" value={v} onChange={(e) => setV(e.target.value)} /></div>;
    },
  };
});
vi.mock("@/components/programming/IrMergePanel", async () => {
  const React = await import("react");
  return {
    IrMergePanel: () => {
      const [pick, setPick] = React.useState("");
      return <div data-testid="ir-merge-panel"><input aria-label="merge-pick" value={pick} onChange={(e) => setPick(e.target.value)} /></div>;
    },
  };
});

// ─── trpc giả ──────────────────────────────────────────────────────────────────────────────────────
interface QueryResult { data: unknown; isLoading: boolean; isPending: boolean; isFetching: boolean; isError: boolean; error: unknown; refetch: () => void }
function makeQuery(o: Partial<QueryResult> = {}): QueryResult {
  return { data: undefined, isLoading: false, isPending: false, isFetching: false, isError: false, error: null, refetch: vi.fn(), ...o };
}
const queryOverrides: Record<string, (input: unknown) => QueryResult> = {};
const queryCalls: Record<string, number> = {};
const queryCache = new Map<string, { fn: (input: unknown) => QueryResult; r: QueryResult }>();
const mutateCalls: Record<string, unknown[]> = {};
const mutationResponses: Record<string, ((vars: any) => unknown) | undefined> = {};
const invalidateCalls: string[] = [];
const fetchResponses: Record<string, (input: any) => unknown> = {};
const fetchCalls: Record<string, unknown[]> = {};
vi.mock("@/lib/trpc", () => {
  const utilsProxy = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get(_t, k: string) {
        if (k === "fetch") {
          const key = path.join(".");
          return (input: unknown) => {
            (fetchCalls[key] ??= []).push(input);
            const r = fetchResponses[key];
            return r ? Promise.resolve(r(input)) : Promise.reject(new Error("no fetch"));
          };
        }
        if (k === "invalidate" || k === "refetch") return () => { invalidateCalls.push(path.join(".")); return Promise.resolve(); };
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
                queryCalls[key] = (queryCalls[key] ?? 0) + 1;
                if (!queryOverrides[key]) return makeQuery();
                // Như react-query (structural sharing): cùng thủ tục + cùng input ⇒ CÙNG đối tượng kết quả giữa các lượt render.
                const ck = `${key}|${JSON.stringify(input ?? null)}`;
                const hit = queryCache.get(ck);
                if (hit && hit.fn === queryOverrides[key]) return hit.r;
                const r = queryOverrides[key](input);
                queryCache.set(ck, { fn: queryOverrides[key], r });
                return r;
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
                reset: vi.fn(), isPending: false, isError: false,
              }),
            };
          },
        });
      },
    }),
  };
});

import IrEditor from "./IrEditor";
import { ProgrammingCopilotProvider } from "@/contexts/ProgrammingCopilotContext";
import { ShellAiButton } from "@/components/ShellAiButton";

const FLOW_ROWS = [
  { id: 41, branch: "main", version: 2, status: "validated", summary: { flowId: "pick-01", targetDeviceType: "universal-robots", blockCount: 3, blockTypes: ["grip"] } },
  { id: 40, branch: "main", version: 1, status: "draft", summary: { flowId: "pick-00", targetDeviceType: "universal-robots", blockCount: 1, blockTypes: ["wait"] } },
];

function seed(o: { enabled?: boolean; lint?: Partial<QueryResult> } = {}) {
  window.history.pushState({}, "", "/ir-editor");
  queryOverrides["ir.status"] = () => makeQuery({ data: { enabled: o.enabled ?? true, targets: ["urscript", "ros2"] } });
  queryOverrides["ir.listFlows"] = () => makeQuery({ data: FLOW_ROWS });
  queryOverrides["programming.listProjects"] = () => makeQuery({ data: [{ id: 7, code: "IRP", name: "IR cell", kind: "ir-flow" }, { id: 8, code: "X", name: "Other", kind: "stub" }] });
  queryOverrides["ir.lint"] = () => makeQuery(o.lint ?? { data: { ok: true, diagnostics: [] } });
  queryOverrides["ir.transpilePreview"] = () => makeQuery({ data: { ok: true, code: "# [IR wait #b1]\nsleep(0.1)", irCommentMap: {}, diagnostics: [] } });
}

function renderPage(o: { aiButton?: boolean } = {}) {
  return render(
    <ProgrammingCopilotProvider>
      {o.aiButton && <ShellAiButton />}
      <IrEditor />
    </ProgrammingCopilotProvider>,
  );
}

// ─── SSE giả cho Copilot (cùng khuôn test IDE) ────────────────────────────────────────────────────
interface LuongGia { body: Record<string, unknown>; signal: AbortSignal; day: (o: unknown) => void }
let luot: LuongGia[] = [];
function fetchGia(_url: string, init: RequestInit): Promise<Response> {
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  let dong = false;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
  const signal = init.signal as AbortSignal;
  signal.addEventListener("abort", () => { if (!dong) { dong = true; ctl.error(new DOMException("Aborted", "AbortError")); } });
  luot.push({ body: JSON.parse(String(init.body)), signal, day: (x) => !dong && ctl.enqueue(enc.encode(`data: ${JSON.stringify(x)}

`)) });
  return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));
}
const nghi = () => act(() => new Promise((r) => setTimeout(r, 20)));

let undoShim: (() => void) | null = null;
beforeAll(async () => {
  await initLayoutKitTestI18n();
  undoShim = installResizeHandleHitAreaShim();
  installMatchMedia();
});
beforeEach(() => {
  for (const o of [queryOverrides, queryCalls, mutateCalls, mutationResponses, fetchResponses, fetchCalls]) {
    for (const k of Object.keys(o)) delete (o as Record<string, unknown>)[k];
  }
  queryCache.clear();
  invalidateCalls.length = 0;
  for (const f of Object.values(toasts)) f.mockReset();
  try { window.localStorage.clear(); } catch { /* ignore */ }
  document.body.style.paddingRight = "";
  perm.control = true;
  luot = [];
  vi.stubGlobal("fetch", vi.fn(fetchGia));
  resetAiEntryForTest();
  presetNarrow(false);
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

const mainEl = () => document.querySelector('[data-layout-main="ir-canvas"]') as HTMLElement;
const statusBar = () => document.querySelector("[data-workbench-statusbar]") as HTMLElement;
const explorer = () => document.querySelector("[data-workbench-left]") as HTMLElement;
const header = () => document.querySelector("[data-layout-header]") as HTMLElement;
const inspector = () => document.querySelector("aside[aria-label]") as HTMLElement;
const activityBar = () => screen.getByRole("toolbar", { name: "Thanh hoạt động" });
const editorTabs = () => screen.getByRole("tablist", { name: "Tab soạn thảo" });
const addFromPalette = (label: RegExp) => fireEvent.click(within(explorer()).getByRole("button", { name: label }));
/** Lint chạy trên bản nháp sau debounce 400 ms (như trang cũ) — đợi để kết quả lint khớp bản nháp hiện tại. */
const doiLint = () => act(() => new Promise((r) => setTimeout(r, 450)));

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("IR Editor — bố cục P1/P2 trên EngineeringShell (doc 81 §1.2)", () => {
  it("activity bar Bảng chọn khối / Luồng đã lưu / Khối hàm · MAIN = MỘT toolbar (tab Vùng vẽ / So sánh / Hợp nhất) + canvas cao hết vùng · không h1/header/KPI trong MAIN", () => {
    seed();
    renderPage();
    for (const re of [/^Bảng chọn khối$/, /^Luồng IR đã lưu$/, /^Khối hàm$/]) {
      expect(within(activityBar()).getByRole("button", { name: re })).toBeInTheDocument();
    }
    // Explorer mặc định = bảng chọn khối (có các nút khối)
    expect(within(explorer()).getAllByRole("button", { name: /Chờ|Di chuyển|Kẹp|Đặt đầu ra/ }).length).toBeGreaterThan(0);
    const names = within(editorTabs()).getAllByRole("tab").map((x) => x.textContent ?? "");
    expect(names[0]).toMatch(/^Vùng vẽ luồng/);
    expect(names.some((n) => /^So sánh phiên bản/.test(n))).toBe(true);
    expect(names.some((n) => /^Hợp nhất \(3 chiều\)/.test(n))).toBe(true);
    const main = mainEl();
    expect(main).not.toBeNull();
    const tb = main.querySelectorAll("[data-layout-toolbar]");
    expect(tb).toHaveLength(1);
    expect(tb[0]).toContainElement(editorTabs());
    const panel = within(main).getByRole("tabpanel");
    expect(panel).toContainElement(screen.getByTestId("ir-graph"));
    expect(screen.getByTestId("ir-graph")).toHaveAttribute("data-fill", "true");
    expect(main.querySelector("h1,[data-layout-header],[data-layout-kpi]")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Trình soạn IR trực quan");
    // bỏ lưới cố định grid-cols-12
    expect(document.querySelector(".lg\\:grid-cols-12")).toBeNull();
  });

  it("bảng chọn khối GẬP được: bấm lại mục đang chọn ⇒ explorer gập (aria-expanded=false), bấm nữa ⇒ mở", () => {
    seed();
    renderPage();
    const pal = within(activityBar()).getByRole("button", { name: /^Bảng chọn khối$/ });
    expect(pal).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(pal);
    expect(pal).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(pal);
    expect(pal).toHaveAttribute("aria-expanded", "true");
  });

  it("thanh trạng thái: chip 'Xem trước — không deploy' (popover = câu trung thực cũ) + KPI (khối cấp cao / lỗi / cảnh báo / trạng thái lint); KPI không còn ở chỗ khác", async () => {
    seed();
    renderPage();
    addFromPalette(/^Chờ$/);
    await doiLint();
    const sb = statusBar();
    const chip = within(sb).getByRole("button", { name: /Xem trước — không deploy/ });
    fireEvent.click(chip);
    expect(await screen.findByText(/Chỉ xem trước cấu trúc \+ lint \+ transpile/)).toBeInTheDocument();
    expect(within(sb).getByTestId("ir-kpi-blocks")).toHaveTextContent(/Khối cấp cao: 1/);
    expect(within(sb).getByTestId("ir-kpi-errors")).toHaveTextContent(/Lỗi lint: 0/);
    expect(within(sb).getByTestId("ir-kpi-warns")).toHaveTextContent(/Cảnh báo lint: 0/);
    expect(within(sb).getByTestId("ir-kpi-status")).toHaveTextContent(/Trạng thái lint: Đạt/);
    for (const label of ["Khối cấp cao", "Lỗi lint", "Cảnh báo lint", "Trạng thái lint"]) {
      for (const el of screen.getAllByText(new RegExp(label))) expect(sb.contains(el)).toBe(true);
    }
    // ghi chú trung thực không còn là khối banner trên trang
    expect(document.querySelector('[data-layout-main] [role="note"]')).toBeNull();
  });

  it("R-2-t: top bar 48 px cho nút 40 px (không cắt nút)", () => {
    seed();
    renderPage();
    const hd = header();
    const px = (cls: string, re: RegExp) => { const m = cls.split(/\s+/).map((c) => re.exec(c)).find(Boolean); return m ? Number(m[1]) * 4 : null; };
    expect(px(hd.className, /^h-(\d+(?:\.\d+)?)$/)).toBe(48);
    const padY = px(hd.className, /^py-(\d+(?:\.\d+)?)$/) ?? 0;
    const tallest = Math.max(...Array.from(hd.querySelectorAll("button")).map((b) => px(b.className, /^(?:h|size)-(\d+(?:\.\d+)?)$/) ?? 0));
    expect(tallest).toBeLessThanOrEqual(40);
    expect(48).toBeGreaterThanOrEqual(tallest + 2 * padY + 1);
  });

  it("metadata luồng (mã luồng, thiết bị đích, phiên bản, năng lực) nằm trong top bar (popover) và sửa được", async () => {
    seed();
    renderPage();
    fireEvent.click(within(header()).getByRole("button", { name: /flow-1/ }));
    const id = await screen.findByLabelText("Mã luồng");
    fireEvent.change(id, { target: { value: "pick-77" } });
    expect(within(header()).getByRole("button", { name: /pick-77/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Phiên bản")).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Explorer — luồng đã lưu + khối hàm; Diff/Merge là tab editor", () => {
  it("Luồng đã lưu: Nạp ⇒ ir.getFlow.fetch đúng artifact; Yêu cầu build ⇒ ĐÚNG MỘT requestBuild({artifactId}) mỗi lần bấm (R-2-n)", async () => {
    seed();
    fetchResponses["ir.getFlow"] = () => ({ flow: { flow_id: "pick-01", target_device_type: "universal-robots", version: 2, blocks: [{ id: "b9", type: "wait", ms: 10 }] } });
    renderPage();
    fireEvent.click(within(activityBar()).getByRole("button", { name: /^Luồng IR đã lưu$/ }));
    const ex = explorer();
    const row = within(ex).getByText("pick-01").closest("[data-flow-row]") as HTMLElement;
    expect(row).not.toBeNull();
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: /^Nạp$/ })); });
    expect(fetchCalls["ir.getFlow"]).toEqual([{ artifactId: 41 }]);
    expect(screen.getByRole("button", { name: "chon-wait" })).toBeInTheDocument();
    await doiLint();
    fireEvent.click(within(row).getByRole("button", { name: /^Yêu cầu build$/ }));
    expect(mutateCalls["ir.requestBuild"]).toEqual([{ artifactId: 41 }]);
  });

  it("cổng build như cũ: cờ tắt ⇒ nút Yêu cầu build khoá; không quyền machine_control ⇒ khoá", () => {
    seed({ enabled: false });
    renderPage();
    fireEvent.click(within(activityBar()).getByRole("button", { name: /^Luồng IR đã lưu$/ }));
    for (const b of within(explorer()).getAllByRole("button", { name: /^Yêu cầu build$/ })) expect(b).toBeDisabled();
    cleanup();
    perm.control = false;
    seed();
    renderPage();
    fireEvent.click(within(activityBar()).getByRole("button", { name: /^Luồng IR đã lưu$/ }));
    for (const b of within(explorer()).getAllByRole("button", { name: /^Yêu cầu build$/ })) expect(b).toBeDisabled();
  });

  it("Khối hàm: tạo mới ⇒ canvas sửa thân khối hàm (tab đổi nhãn, nút Luồng chính trong toolbar); tên + tham số sửa ở Inspector", () => {
    seed();
    renderPage();
    fireEvent.click(within(activityBar()).getByRole("button", { name: /^Khối hàm$/ }));
    fireEvent.click(within(explorer()).getByRole("button", { name: /^Khối hàm mới$/ }));
    const tab0 = within(editorTabs()).getAllByRole("tab")[0];
    expect(tab0.textContent).toMatch(/^Khối hàm: /);
    const tb = mainEl().querySelector("[data-layout-toolbar]") as HTMLElement;
    expect(within(tb).getByRole("button", { name: /Luồng chính/ })).toBeInTheDocument();
    // định nghĩa (tên, tham số) ở Inspector
    const insp = inspector();
    expect(within(insp).getByRole("button", { name: /Thêm tham số/ })).toBeInTheDocument();
    fireEvent.click(within(insp).getByRole("button", { name: /Thêm tham số/ }));
    expect(within(explorer()).getByText(/1 tham số/)).toBeInTheDocument();
    fireEvent.click(within(tb).getByRole("button", { name: /Luồng chính/ }));
    expect(within(editorTabs()).getAllByRole("tab")[0].textContent).toMatch(/^Vùng vẽ luồng/);
  });

  it("So sánh phiên bản / Hợp nhất là TAB EDITOR trong MAIN (một toolbar duy nhất)", () => {
    seed();
    renderPage();
    fireEvent.click(within(editorTabs()).getByRole("tab", { name: /^So sánh phiên bản/ }));
    expect(within(mainEl()).getByRole("tabpanel")).toContainElement(screen.getByTestId("ir-diff-panel"));
    expect(mainEl().querySelectorAll("[data-layout-toolbar]")).toHaveLength(1);
    fireEvent.click(within(editorTabs()).getByRole("tab", { name: /^Hợp nhất/ }));
    expect(within(mainEl()).getByRole("tabpanel")).toContainElement(screen.getByTestId("ir-merge-panel"));
    expect(screen.queryByTestId("ir-graph")).toBeNull();
    fireEvent.click(within(editorTabs()).getByRole("tab", { name: /^Vùng vẽ luồng/ }));
    expect(screen.getByTestId("ir-graph")).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Inspector / Transpile / Copilot bên phải", () => {
  it("chọn khối trên canvas ⇒ Inspector sửa tham số; Transpile chỉ truy vấn khi mở tab (như Tabs cũ)", () => {
    seed();
    renderPage();
    addFromPalette(/^Chờ$/);
    const insp = inspector();
    expect(within(insp).getByRole("tab", { name: /Bảng thuộc tính/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "chon-wait" }));
    expect(within(insp).getByText("wait")).toBeInTheDocument();
    expect(queryCalls["ir.transpilePreview"] ?? 0).toBe(0);
    fireEvent.click(within(insp).getByRole("tab", { name: /Xem trước transpile/ }));
    expect(queryCalls["ir.transpilePreview"]).toBeGreaterThan(0);
    expect(within(insp).getByText("sleep(0.1)")).toBeInTheDocument();
  });

  it("Copilot mở ⇒ panel TRONG inspector (aside data-layout-ai), KHÔNG dock fixed, KHÔNG body.paddingRight; ngoài MAIN", async () => {
    window.localStorage.setItem("progCopilotDock.open", "1");
    seed();
    renderPage();
    const aside = document.querySelector("aside[data-layout-ai]") as HTMLElement;
    expect(aside).not.toBeNull();
    expect(within(aside).getByRole("tab", { name: /Copilot/ })).toHaveAttribute("aria-selected", "true");
    await within(aside).findByPlaceholderText(/Describe what to generate|Mô tả/);
    expect(document.body.style.paddingRight).toBe("");
    expect(Array.from(document.querySelectorAll("aside")).some((a) => /(^|\s)fixed(\s|$)/.test(a.className))).toBe(false);
    expect(mainEl().contains(aside)).toBe(false);
  });

  it("stream Copilot SỐNG khi chuyển Copilot ↔ Bảng thuộc tính / Transpile (Review Focus 3); Huỷ ⇒ abort", async () => {
    seed();
    renderPage();
    fireEvent.click(within(inspector()).getByRole("tab", { name: /Copilot/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Mô tả cần sinh gì/), { target: { value: "move then grip" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Sinh mã$/ })); });
    await nghi();
    expect(luot).toHaveLength(1);
    luot[0].day({ type: "stage", stage: "gate", elapsedMs: 0 });
    await nghi();
    fireEvent.click(within(inspector()).getByRole("tab", { name: /Bảng thuộc tính/ }));
    fireEvent.click(within(inspector()).getByRole("tab", { name: /Xem trước transpile/ }));
    fireEvent.click(within(inspector()).getByRole("tab", { name: /Copilot/ }));
    await nghi();
    expect(luot).toHaveLength(1);
    expect(luot[0].signal.aborted).toBe(false);
    await act(async () => { fireEvent.click(screen.getByTestId("copilot-cancel")); });
    await nghi();
    expect(luot[0].signal.aborted).toBe(true);
  });

  it("nút AI top bar mở tab Copilot + đưa focus vào panel; sheet chat không chồng (R-2-j); bấm lại ⇒ về tab trước", () => {
    seed();
    renderPage({ aiButton: true });
    const ai = screen.getByRole("button", { name: "Mở Trợ lý Lập trình" });
    fireEvent.click(within(inspector()).getByRole("tab", { name: /Xem trước transpile/ }));
    fireEvent.click(ai);
    const copilotTab = within(inspector()).getByRole("tab", { name: /Copilot/ });
    expect(copilotTab).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById(copilotTab.getAttribute("aria-controls")!)!.contains(document.activeElement)).toBe(true);
    act(() => setAiChatOpen(true));
    expect(getAiEntryState().chatOpen).toBe(false);
    fireEvent.click(ai);
    expect(within(inspector()).getByRole("tab", { name: /Xem trước transpile/ })).toHaveAttribute("aria-selected", "true");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Giữ hành vi: lint (mapTrpcError), cổng Lưu, phím tắt, tạo project trong sheet", () => {
  it("lint lỗi ⇒ thông điệp ĐÃ DỊCH qua mapTrpcError (không chuỗi thô), Lưu khoá", () => {
    const err = Object.assign(new Error("raw-english-lint-failure"), { data: { code: "UNAUTHORIZED" } });
    seed({ lint: { data: undefined, error: err, isError: true } });
    renderPage();
    addFromPalette(/^Chờ$/);
    const alert = within(statusBar()).getByRole("alert");
    expect(alert).toHaveTextContent(/Phiên đăng nhập hết hạn/);
    expect(document.body.textContent).not.toMatch(/raw-english-lint-failure/);
    expect(within(header()).getByRole("button", { name: /^Lưu luồng$/ })).toBeDisabled();
  });

  it("Lưu luồng: ĐÚNG MỘT saveFlow({projectId, branch:'main', flow}) mỗi lần bấm; Ctrl/Cmd+S cũng lưu", async () => {
    seed();
    window.history.pushState({}, "", "/ir-editor?projectId=7");
    renderPage();
    addFromPalette(/^Chờ$/);
    await doiLint();
    const save = within(header()).getByRole("button", { name: /^Lưu luồng$/ });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(mutateCalls["ir.saveFlow"]).toHaveLength(1);
    expect(mutateCalls["ir.saveFlow"][0]).toMatchObject({ projectId: 7, branch: "main", flow: { flow_id: "flow-1" } });
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    expect(mutateCalls["ir.saveFlow"]).toHaveLength(2);
  });

  it("cờ tắt ⇒ chip trạng thái trong header (FeatureStatusNoticeChip 'off', không banner), Lưu khoá", () => {
    seed({ enabled: false });
    renderPage();
    expect(within(header()).getByTestId("feature-status-off")).toBeInTheDocument();
    expect(within(header()).getByRole("button", { name: /^Lưu luồng$/ })).toBeDisabled();
  });

  it("'Project ir-flow mới' mở SHEET phải (không dialog giữa màn); Tạo ⇒ createProject({code,name,kind:'ir-flow'})", async () => {
    seed();
    mutationResponses["programming.createProject"] = () => ({ id: 9, code: "NEW", name: "New" });
    renderPage();
    fireEvent.click(within(header()).getByRole("button", { name: /Project ir-flow mới/ }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveAttribute("data-slot", "sheet-content");
    fireEvent.change(within(dlg).getByLabelText("Mã project"), { target: { value: "NEW" } });
    fireEvent.change(within(dlg).getByLabelText("Tên project"), { target: { value: "New" } });
    await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: /^Tạo project$/ })); });
    expect(mutateCalls["programming.createProject"]).toEqual([{ code: "NEW", name: "New", kind: "ir-flow" }]);
  });

  it("i18n: mọi khoá ir.ws.* trang dùng có ở vi/en/zh", () => {
    const keys = Array.from(new Set(Array.from(PAGE_SRC.matchAll(/t\("(ir\.ws\.[A-Za-z0-9_.]+)"/g)).map((m) => m[1])));
    expect(keys.length).toBeGreaterThan(3);
    const get = (o: unknown, k: string) => k.split(".").reduce<unknown>((x, p) => (x && typeof x === "object" ? (x as Record<string, unknown>)[p] : undefined), o);
    for (const k of keys) for (const L of [VI, EN, ZH]) expect(typeof get(L, k), k).toBe("string");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Task 14 fix round 1 (review I1/M3/M4/M7 + Copilot qua mốc 1024 px)
describe("Fix round 1", () => {
  it("I1: state của So sánh / Hợp nhất SỐNG qua đổi tab canvas ↔ merge ↔ diff (panel đã mở giữ mount, tab không chọn bị ẩn)", () => {
    seed();
    renderPage();
    const tab = (re: RegExp) => fireEvent.click(within(editorTabs()).getByRole("tab", { name: re }));
    tab(/^So sánh phiên bản/);
    fireEvent.change(screen.getByLabelText("diff-base"), { target: { value: "v2" } });
    tab(/^Hợp nhất/);
    fireEvent.change(screen.getByLabelText("merge-pick"), { target: { value: "ours:b3" } });
    expect(screen.getByLabelText("diff-base").closest("[hidden]")).not.toBeNull();
    tab(/^Vùng vẽ luồng/);
    expect(screen.getByTestId("ir-graph")).toBeInTheDocument();
    expect(screen.getByLabelText("merge-pick").closest("[hidden]")).not.toBeNull();
    tab(/^Hợp nhất/);
    expect(screen.getByLabelText("merge-pick")).toHaveValue("ours:b3");
    expect(screen.getByLabelText("merge-pick").closest("[hidden]")).toBeNull();
    tab(/^So sánh phiên bản/);
    expect(screen.getByLabelText("diff-base")).toHaveValue("v2");
    expect(screen.getByLabelText("diff-base").closest("[hidden]")).toBeNull();
    expect(mainEl().querySelectorAll("[data-layout-toolbar]")).toHaveLength(1);
  });

  it("M4: tạo / sửa thân khối hàm ⇒ panel phải chuyển về Bảng thuộc tính (nơi có định nghĩa)", () => {
    seed();
    renderPage();
    fireEvent.click(within(inspector()).getByRole("tab", { name: /Xem trước transpile/ }));
    fireEvent.click(within(activityBar()).getByRole("button", { name: /^Khối hàm$/ }));
    fireEvent.click(within(explorer()).getByRole("button", { name: /^Khối hàm mới$/ }));
    expect(within(inspector()).getByRole("tab", { name: /Bảng thuộc tính/ })).toHaveAttribute("aria-selected", "true");
    expect(within(inspector()).getByRole("button", { name: /Thêm tham số/ })).toBeInTheDocument();
    fireEvent.click(within(inspector()).getByRole("tab", { name: /Xem trước transpile/ }));
    fireEvent.click(within(explorer()).getByRole("button", { name: /^(Sửa thân|Đang sửa thân)$/ }));
    expect(within(inspector()).getByRole("tab", { name: /Bảng thuộc tính/ })).toHaveAttribute("aria-selected", "true");
  });

  it("M3: popover 'Xem trước — không deploy' không còn nói 'bên dưới' (Yêu cầu build nằm ở Explorer)", async () => {
    seed();
    renderPage();
    fireEvent.click(within(statusBar()).getByRole("button", { name: /Xem trước — không deploy/ }));
    const p = await screen.findByText(/Lưu sẽ thêm một artifact ir-flow/);
    expect(p.textContent).not.toMatch(/bên dưới/);
    expect(p.textContent).toMatch(/Luồng IR đã lưu/);
    for (const L of [VI, EN, ZH]) expect((L as unknown as { ir: { deployReminder: string } }).ir.deployReminder).not.toMatch(/bên dưới|below|下方/);
  });

  it("M7: 'Làm mới' (luồng + chạy lại lint) luôn tới được — nút ở Explorer Luồng đã lưu làm đúng việc của nút top bar (ẩn < 640 px)", () => {
    seed();
    renderPage();
    expect(within(header()).getByRole("button", { name: "Làm mới" }).className).toMatch(/(^|\s)hidden(\s|$)/);
    fireEvent.click(within(activityBar()).getByRole("button", { name: /^Luồng IR đã lưu$/ }));
    fireEvent.click(within(explorer()).getByRole("button", { name: "Làm mới" }));
    expect(invalidateCalls).toContain("ir.lint");
  });

  it("stream Copilot SỐNG qua mốc 1024 px (rộng→hẹp→rộng); Huỷ vẫn abort", async () => {
    seed();
    renderPage();
    fireEvent.click(within(inspector()).getByRole("tab", { name: /Copilot/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Mô tả cần sinh gì/), { target: { value: "grip then release" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Sinh mã$/ })); });
    await nghi();
    expect(luot).toHaveLength(1);
    luot[0].day({ type: "stage", stage: "gate", elapsedMs: 0 });
    await nghi();
    setNarrow(true);
    await nghi();
    expect(document.querySelector("[data-workbench][data-narrow]")).not.toBeNull();
    expect(luot[0].signal.aborted).toBe(false);
    expect(screen.getByTestId("copilot-cancel")).toBeInTheDocument();
    setNarrow(false);
    await nghi();
    expect(luot).toHaveLength(1);
    expect(luot[0].signal.aborted).toBe(false);
    await act(async () => { fireEvent.click(screen.getByTestId("copilot-cancel")); });
    await nghi();
    expect(luot[0].signal.aborted).toBe(true);
  });
});
