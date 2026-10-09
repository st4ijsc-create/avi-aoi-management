// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 7 — Equipment Integration thành mẫu P4 Cockpit.
// Hợp đồng (task-7-brief + page-task-dispatch + plan Review Focus 1/3/4 + GC3 + R-2-g/R-2-n):
//   - Header một hàng: h1 + chip notice (Khi nào dùng, lưu ý trung thực, trạng thái cờ 4 nhánh) + dải
//     `StatusChipStrip` (thay 4 MetricCard). Nhãn ĐÚNG NGHĨA: số adapter là ĐĂNG KÝ trong registry, không
//     phải KẾT NỐI; chip "kết nối" đếm framework có thiết bị thật (configured), không phải "thiết bị".
//   - MAIN (`data-layout-main`, CockpitLayout) = hàng tab (thanh công cụ DUY NHẤT) + nội dung tab. Tab đồng bộ
//     `?tab=` (status; + history chỉ-đọc cho người không mở được /recipes — R-3-b). Đợt 3 Task 1: tab recipes / history
//     DỜI sang Recipes — `?tab=recipes|history` chuyển hướng `/recipes?tab=versions|history`, giữ query (các test cũ của
//     hai tab nay ở RecipeManagement.integration.dom.test.tsx). Đợt 3 Task 2: tab acquisition DỜI sang Vision › Thu ảnh —
//     `?tab=acquisition` chuyển hướng `/vision/acquisition` (giữ query, bỏ `tab`) cho người mở được trang đó (các test cũ
//     của tab nay ở VisionAcquisition.layout.dom.test.tsx).
//   - Tab đầu = catalog connector dạng danh sách–chi tiết (`?connector=`), gồm framework FOCAS/Euromap và
//     các giao thức adapter đã đăng ký; chi tiết framework giữ đầu dò snapshot trung thực.
// Chạy trên wouter THẬT với history jsdom. "Server" giả là kho trong bộ nhớ: truy vấn CHỈ đổi khi trang gọi
// invalidate đúng thủ tục (như react-query).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { installResizeHandleHitAreaShim } from "@/components/patterns/layoutKitTestPanels";
import { installMatchMedia, presetNarrow, setNarrow } from "@/components/patterns/layoutKitTestMedia";

vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/PermissionGate", () => ({ ViewOnlyBadge: () => <span>Chỉ xem</span> }));
const perm = vi.hoisted(() => ({ view: true, controlView: true, control: true, release: true, acqView: true, acqControl: true }));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: false,
    hasPermission: (m: string, a: string) => {
      if (m === "machine_monitoring" && a === "canView") return perm.view;
      // Fix round 1 (R-3-b) — HẠ TẦNG: quyền mở /recipes (machine_control/canView); mặc định có (như engineer).
      if (m === "machine_control" && a === "canView") return perm.controlView;
      if (m === "machine_control" && a === "canCreate") return perm.control;
      if (m === "machine_control" && a === "canEdit") return perm.release;
      if (m === "machine_alerts" && a === "canView") return perm.acqView;
      if (m === "machine_alerts" && a === "canCreate") return perm.acqControl;
      return false;
    },
  }),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 7, name: "Tester" }, loading: false }),
}));
// Final wave (Ruling R-3-h) — HẠ TẦNG: giấy phép theo route (cùng vị từ `isRouteAllowed` mà thanh bên/RouteGuard dùng).
// Mặc định /recipes ĐƯỢC cấp phép (MOD_ENGINEERING) như mọi test cũ; `lic.recipes=false` = khách chỉ mua MOD_OT_CONTROL.
const lic = vi.hoisted(() => ({ recipes: true, asked: [] as string[] }));
vi.mock("@/hooks/useLicenseModules", () => ({
  useLicenseModules: () => ({
    isLoading: false,
    isRouteAllowed: (p: string) => {
      lic.asked.push(p);
      return p === "/recipes" ? lic.recipes : true;
    },
  }),
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));

// ── "Server" giả ───────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const srv = vi.hoisted(() => ({
  status: { enabled: true } as Row | undefined,
  statusError: false,
  integration: undefined as Row | undefined,
  integrationLoading: false,
  integrationError: false,
  versions: [] as Row[],
  loads: [] as Row[],
  workers: [] as Row[],
  liveEnabled: true,
  snap: { versions: [] as Row[], loads: [] as Row[], workers: [] as Row[] },
  version: 0,
  listeners: new Set<() => void>(),
  nextId: 200,
  calls: {} as Record<string, unknown[]>,
  invalidated: [] as string[],
  queryInputs: [] as string[],
  queryOpts: {} as Record<string, unknown>,
  mutationError: null as null | Error,
  // Đếm instance của panel worker (hook acquisitionWorkerStatus.useQuery chỉ được gọi trong panel).
  acq: { mounts: 0, unmounts: 0, polls: new Set<() => void>(), refetches: 0 },
}));
function bump() {
  srv.version++;
  for (const l of srv.listeners) l();
}

vi.mock("@/lib/trpc", () => {
  const useVersion = () =>
    React.useSyncExternalStore(
      (cb) => {
        srv.listeners.add(cb);
        return () => srv.listeners.delete(cb);
      },
      () => srv.version,
    );
  const q = (data: unknown, enabled = true, extra: Row = {}) => ({
    data: enabled ? data : undefined,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
    ...extra,
  });
  const later = () => Promise.resolve();
  const runOp = (path: string, input: Row): Promise<unknown> =>
    later().then(() => {
      (srv.calls[path] ??= []).push(input);
      if (srv.mutationError) throw srv.mutationError;
      if (path === "equipmentIntegration.createRecipeVersion") {
        const same = srv.versions.filter((v) => v.code === input.code);
        const row = { id: srv.nextId++, code: input.code, name: input.name, version: same.length ? Math.max(...same.map((v) => Number(v.version))) + 1 : 1, payload: input.payload, status: "draft", designStatus: "draft", machineId: input.machineId ?? null, createdBy: 7, createdAt: "2026-10-03T00:00:00Z", notes: input.notes ?? null };
        srv.versions.push(row);
        return row;
      }
      if (path === "equipmentIntegration.releaseRecipeVersion") {
        const v = srv.versions.find((x) => x.id === input.recipeId)!;
        for (const o of srv.versions) if (o.code === v.code && o.designStatus === "released") o.designStatus = "archived";
        v.designStatus = "released";
        return v;
      }
      if (path === "equipmentIntegration.archiveRecipeVersion") {
        Object.assign(srv.versions.find((x) => x.id === input.recipeId)!, { designStatus: "archived" });
        return { ok: true };
      }
      if (path === "equipmentIntegration.rollbackRecipeVersion") {
        const v = srv.versions.find((x) => x.id === input.toRecipeId)!;
        for (const o of srv.versions) if (o.code === v.code && o.designStatus === "released") o.designStatus = "archived";
        v.designStatus = "released";
        return v;
      }
      if (path === "equipmentIntegration.recordRecipeLoad") {
        const v = srv.versions.find((x) => x.id === input.recipeId)!;
        srv.loads.unshift({ id: srv.nextId++, action: "load", recipeCode: v.code, recipeVersion: v.version, machineId: input.machineId, performedBy: 7, notes: input.notes ?? null, createdAt: "2026-10-03T02:00:00Z" });
        return { ok: true };
      }
      if (path === "visionAdapter.startAcquisitionWorker") {
        srv.workers.push(worker({ id: input.id, state: "running" }));
        return { ok: true };
      }
      if (path === "visionAdapter.stopAcquisitionWorker") {
        Object.assign(srv.workers.find((w) => w.id === input.id)!, { state: "stopped" });
        return { ok: true };
      }
      return undefined;
    });
  const hooks = (path: string) => ({
    useQuery: (input?: Row, opts?: { enabled?: boolean; refetchInterval?: unknown }) => {
      useVersion();
      const enabled = opts?.enabled !== false;
      if (enabled) srv.queryInputs.push(`${path}:${JSON.stringify(input ?? null)}`);
      if (path === "equipmentIntegration.status")
        return srv.statusError ? q(undefined, enabled, { isError: true }) : srv.status === undefined ? q(undefined, enabled, { isLoading: true, isPending: true }) : q(srv.status, enabled);
      if (path === "equipmentIntegration.integrationStatus") {
        if (srv.integrationError) return q(undefined, enabled, { isError: true });
        if (srv.integrationLoading) return q(undefined, enabled, { isLoading: true, isPending: true });
        return q(srv.integration, enabled);
      }
      if (path === "equipmentIntegration.frameworkSnapshot")
        return q({ kind: input?.kind, machineCode: input?.machineCode, source: "none", connected: false, at: null, recipeId: null, cycleCount: null, alarmCode: null, utilizationRate: null }, enabled);
      if (path === "machine.list") return q([{ id: 3, code: "MC-3", name: "M3" }, { id: 4, code: "MC-4", name: "M4" }], enabled);
      if (path === "equipmentIntegration.listRecipeVersions")
        return q({ code: input?.code, versions: srv.snap.versions.filter((v) => v.code === input?.code).sort((a, b) => Number(b.version) - Number(a.version)) }, enabled);
      if (path === "equipmentIntegration.listLoadHistory") return q(srv.snap.loads.filter((l) => l.machineId === input?.machineId), enabled);
      if (path === "equipmentIntegration.listCodeHistory") return q(srv.snap.loads.filter((l) => l.recipeCode === input?.code), enabled);
      if (path === "visionAdapter.acquisitionWorkerStatus") {
        // Trạng thái SỐNG riêng của instance panel: mỗi "nhịp poll" tăng frame. Remount ⇒ về 0.
        const [tick, setTick] = React.useState(0);
        React.useEffect(() => {
          srv.acq.mounts++;
          const poll = () => setTick((x) => x + 1);
          srv.acq.polls.add(poll);
          return () => {
            srv.acq.unmounts++;
            srv.acq.polls.delete(poll);
          };
        }, []);
        srv.queryOpts[path] = opts;
        return q(
          { liveEnabled: srv.liveEnabled, workers: srv.snap.workers.map((w) => ({ ...w, framesGrabbed: Number(w.framesGrabbed) + tick })) },
          enabled,
          { refetch: () => { srv.acq.refetches++; return Promise.resolve(); } },
        );
      }
      if (path === "visionAdapter.listAcquisitionSources")
        return q({ sources: [{ kind: "file", available: true }, { kind: "mock", available: true }, { kind: "genicam", available: false }] }, enabled);
      return q(undefined, enabled);
    },
    useMutation: (hookOpts: { onSuccess?: (r: unknown, vars: Row) => void; onError?: (e: unknown, vars: Row) => void } = {}) => {
      const run = (input: Row, callOpts?: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) =>
        runOp(path, input).then(
          (r) => {
            hookOpts.onSuccess?.(r, input);
            callOpts?.onSuccess?.(r);
            return r;
          },
          (e) => {
            hookOpts.onError?.(e, input);
            callOpts?.onError?.(e);
            throw e;
          },
        );
      return { isPending: false, mutate: (input: Row, o?: Row) => void run(input, o as never).catch(() => undefined), mutateAsync: (input: Row) => run(input) };
    },
  });
  const refresh = (key: string) => {
    if (key.startsWith("equipmentIntegration.listRecipeVersions")) srv.snap.versions = srv.versions.map((x) => ({ ...x }));
    if (key.startsWith("equipmentIntegration.listLoadHistory") || key.startsWith("equipmentIntegration.listCodeHistory")) srv.snap.loads = srv.loads.map((x) => ({ ...x }));
    if (key.startsWith("visionAdapter.acquisitionWorkerStatus")) srv.snap.workers = srv.workers.map((x) => ({ ...x }));
    bump();
  };
  const utilsAt = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get: (_t, p: string) => {
          if (p === "invalidate")
            return (input?: unknown) => {
              const key = path.join(".");
              srv.invalidated.push(input === undefined ? key : `${key}:${JSON.stringify(input)}`);
              refresh(key);
              return Promise.resolve();
            };
          if (p === "setData" || p === "refetch") return () => undefined;
          return utilsAt([...path, p]);
        },
      },
    );
  const trpcAt = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get: (_t, p: string) => {
          if (path.length === 0 && p === "useUtils") return () => utilsAt([]);
          if (p === "useQuery" || p === "useMutation") return (hooks(path.join(".")) as Record<string, unknown>)[p];
          return trpcAt([...path, p]);
        },
      },
    );
  return { trpc: trpcAt([]) };
});

function worker(o: Row): Row {
  return { id: "w1", state: "running", startedAt: "2026-10-03T00:00:00Z", stoppedAt: null, config: { source: { kind: "mock" }, submit: false, machineCode: null }, framesGrabbed: 10, submitted: 0, errors: 0, lastError: null, ledger: [], ...o };
}

import EquipmentIntegration from "./EquipmentIntegration";

const INTEGRATION = (): Row => ({
  enabled: true,
  adapters: [
    { kind: "ot-opcua", delegatesTo: "OpcUaAdapter" },
    { kind: "ot-modbus", delegatesTo: "ModbusAdapter" },
    { kind: "ot-s7", delegatesTo: "S7Adapter" },
  ],
  frameworks: [
    { kind: "focas", vendor: "FANUC", readOnly: true, configured: false, readFunctions: ["cnc_rdparam"], caveat: "Chua lien ket thu vien FOCAS." },
    { kind: "euromap", vendor: "EUROMAP", readOnly: true, configured: false, transports: ["opcua"], caveat: "Chua co transport Euromap." },
  ],
});
// ORACLE (khai tay): RCP-1 có v3 nháp (id 103), v2 đã phát hành gắn máy 3 (id 102), v1 đã lưu trữ (id 101).
const VERSIONS = (): Row[] => [
  { id: 103, code: "RCP-1", name: "Reflow A", version: 3, payload: { t: 3 }, status: "draft", designStatus: "draft", machineId: null, createdBy: 5, createdAt: "2026-09-30T00:00:00Z", notes: null },
  { id: 102, code: "RCP-1", name: "Reflow A", version: 2, payload: { t: 2 }, status: "active", designStatus: "released", machineId: 3, createdBy: 5, createdAt: "2026-09-29T00:00:00Z", notes: null },
  { id: 101, code: "RCP-1", name: "Reflow A", version: 1, payload: { t: 1 }, status: "archived", designStatus: "archived", machineId: null, createdBy: 5, createdAt: "2026-09-28T00:00:00Z", notes: null },
];
const LOADS = (): Row[] => [
  { id: 1, action: "load", recipeCode: "RCP-1", recipeVersion: 2, machineId: 3, performedBy: 5, notes: "nap ca sang", createdAt: "2026-09-29T01:00:00Z" },
  { id: 2, action: "release", recipeCode: "RCP-9", recipeVersion: 1, machineId: 4, performedBy: 5, notes: null, createdAt: "2026-09-29T02:00:00Z" },
];

beforeAll(async () => {
  installResizeHandleHitAreaShim();
  installMatchMedia();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function () {};
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture ??= () => false;
  (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture ??= () => {};
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  srv.status = { enabled: true };
  srv.statusError = false;
  srv.integration = INTEGRATION();
  srv.integrationLoading = false;
  srv.integrationError = false;
  srv.versions = VERSIONS();
  srv.loads = LOADS();
  srv.workers = [worker({})];
  srv.liveEnabled = true;
  srv.snap = { versions: srv.versions.map((x) => ({ ...x })), loads: srv.loads.map((x) => ({ ...x })), workers: srv.workers.map((x) => ({ ...x })) };
  srv.calls = {};
  srv.invalidated = [];
  srv.queryInputs = [];
  srv.queryOpts = {};
  srv.mutationError = null;
  srv.nextId = 200;
  srv.acq.mounts = 0;
  srv.acq.unmounts = 0;
  srv.acq.polls.clear();
  srv.acq.refetches = 0;
  Object.assign(perm, { view: true, controlView: true, control: true, release: true, acqView: true, acqControl: true });
  lic.recipes = true;
  lic.asked = [];
  for (const f of Object.values(toastSpy)) f.mockClear();
  localStorage.clear();
  presetNarrow(false);
  window.history.replaceState(null, "", "/equipment-integration");
});
afterEach(() => cleanup());

const mainEl = () => {
  const all = [...document.querySelectorAll("[data-layout-main]")] as HTMLElement[];
  return all.find((e) => !all.some((o) => o !== e && o.contains(e))) as HTMLElement;
};
const header = () => document.querySelector("[data-layout-header]") as HTMLElement;
const params = () => new URLSearchParams(window.location.search);
const layer = (key: string) => document.querySelector(`[data-flyout-key="${key}"]`) as HTMLElement | null;
const waitLayer = (key: string) =>
  waitFor(() => {
    const l = layer(key);
    expect(l).toBeTruthy();
    return l as HTMLElement;
  });
const chip = (id: string) => header().querySelector(`[data-chip-id="${id}"]`) as HTMLElement;
const toolbar = () => mainEl().querySelector("[data-layout-toolbar]") as HTMLElement;
const tabBtn = (name: RegExp) => within(toolbar()).getByRole("tab", { name });
const catalog = () => screen.getByRole("region", { name: "Danh mục connector" });
const calls = (p: string) => srv.calls[`equipmentIntegration.${p}`] ?? srv.calls[`visionAdapter.${p}`] ?? [];
const acqPanel = () => document.querySelector("[data-acq-panel]") as HTMLElement | null;

async function openTab(name: RegExp) {
  const user = userEvent.setup();
  await user.click(tabBtn(name));
  return user;
}
const versionRow = (id: number) => mainEl().querySelector(`tr[data-version-id="${id}"]`) as HTMLElement;

describe("Integration P4 — bố cục và chip trung thực", () => {
  it("MAIN (một, trong <main>) = hàng tab + nội dung; không h1/header/KPI/notice trong MAIN; h1 ở header một hàng; 0 dialog lúc nạp", () => {
    render(<EquipmentIntegration />);
    const m = mainEl();
    expect(m.closest("main")).toBeTruthy();
    expect(m.querySelector("h1")).toBeNull();
    expect(m.querySelector("[data-layout-header]")).toBeNull();
    expect(m.querySelector("[data-layout-kpi]")).toBeNull();
    expect(m.querySelector("[data-notice-kind]")).toBeNull();
    expect(m.querySelectorAll("[data-layout-toolbar]")).toHaveLength(1);
    const tabs = within(toolbar()).getAllByRole("tab").map((x) => x.textContent?.trim());
    // Đợt 3 Task 1 — tab "Phiên bản recipe" và "Lịch sử nạp" dời sang Recipes; Đợt 3 Task 2 — tab "Worker thu ảnh" dời
    // sang Vision › Thu ảnh (yêu cầu của hai task).
    expect(tabs).toEqual(["Danh mục connector"]);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Tích hợp thiết bị");
    expect(h1.closest("[data-layout-header]")).toBeTruthy();
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
    // 4 MetricCard cũ ⇒ 3 chip 32 px trong header (thẻ "Framework" gộp vào mẫu số của chip kết nối)
    expect(header().querySelectorAll("[data-layout-kpi]")).toHaveLength(3);
  });

  it("KPI: 'đăng ký' ≠ 'kết nối' — adapter là ĐĂNG KÝ (registry), chip kết nối đếm framework có thiết bị (0/2); không còn nhãn 'Adapter đã kết nối'", () => {
    render(<EquipmentIntegration />);
    const reg = chip("adapters-registered");
    expect(reg).toHaveAttribute("data-state", "ok");
    expect(reg).toHaveTextContent("Adapter đăng ký");
    expect(reg).toHaveTextContent("3");
    expect(reg.getAttribute("title")).toMatch(/đăng ký.*không phải kết nối/i);
    const conn = chip("frameworks-connected");
    expect(conn).toHaveTextContent("Framework đã kết nối");
    expect(conn).toHaveTextContent("0/2");
    expect(screen.queryByText(/Adapter đã kết nối/)).toBeNull();
    expect(screen.queryByText(/Thiết bị đã kết nối/)).toBeNull();
  });

  it("integrationStatus đang tải ⇒ chip 'loading' (không in số); lỗi ⇒ chip 'error' (không in 0)", () => {
    srv.integrationLoading = true;
    render(<EquipmentIntegration />);
    for (const id of ["adapters-registered", "frameworks-connected"]) {
      expect(chip(id)).toHaveAttribute("data-state", "loading");
      expect(chip(id)).not.toHaveTextContent(/\d/);
    }
    cleanup();
    srv.integrationLoading = false;
    srv.integrationError = true;
    render(<EquipmentIntegration />);
    for (const id of ["adapters-registered", "frameworks-connected"]) {
      expect(chip(id)).toHaveAttribute("data-state", "error");
      expect(chip(id)).not.toHaveTextContent(/0/);
    }
  });

  it("chip cờ giữ 4 trạng thái: đang kiểm tra / lỗi / tắt / bật — không bao giờ 'Bật' khi chưa biết", () => {
    srv.status = undefined;
    render(<EquipmentIntegration />);
    expect(chip("flag")).toHaveAttribute("data-state", "loading");
    expect(screen.getByTestId("feature-status-loading")).toBeInTheDocument();
    expect(chip("flag")).not.toHaveTextContent(/Bật|Tắt/);
    cleanup();
    srv.status = { enabled: true };
    srv.statusError = true;
    render(<EquipmentIntegration />);
    expect(chip("flag")).toHaveAttribute("data-state", "error");
    expect(screen.getByTestId("feature-status-error")).toBeInTheDocument();
    cleanup();
    srv.statusError = false;
    srv.status = { enabled: false };
    render(<EquipmentIntegration />);
    expect(chip("flag")).toHaveTextContent("Tắt");
    expect(screen.getByTestId("feature-status-off")).toBeInTheDocument();
    cleanup();
    srv.status = { enabled: true };
    render(<EquipmentIntegration />);
    expect(chip("flag")).toHaveTextContent("Bật");
    expect(screen.queryByTestId("feature-status-off")).toBeNull();
  });

  it("ghi chú 'Khi nào dùng' + lưu ý an toàn thành chip header (câu cũ trong popover); không còn khối ghi chú trên MAIN", async () => {
    const user = userEvent.setup();
    render(<EquipmentIntegration />);
    expect(screen.queryByText(/không có thiết bị trực tiếp nào được gắn/)).toBeNull();
    await user.click(within(header()).getByRole("button", { name: /Khi nào dùng/ }));
    expect(await screen.findByText(/Khi nào dùng — xem khung tích hợp theo hãng/)).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(within(header()).getByRole("button", { name: /^Chỉ đọc$/ }));
    expect(await screen.findByText(/FOCAS\/Euromap là các framework tích hợp chỉ đọc/)).toBeTruthy();
  });
});

describe("Catalog connector (danh sách–chi tiết)", () => {
  it("mặc định tab catalog: hàng framework + giao thức adapter, trạng thái đúng nghĩa; chưa chọn ⇒ gợi ý chọn", () => {
    render(<EquipmentIntegration />);
    expect(tabBtn(/^Danh mục connector/)).toHaveAttribute("aria-selected", "true");
    const list = catalog();
    expect(mainEl().contains(list)).toBe(true);
    const rows = within(list).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.getAttribute("data-connector"))).toEqual([
      "framework:focas", "framework:euromap", "adapter:ot-opcua", "adapter:ot-modbus", "adapter:ot-s7",
    ]);
    expect(within(rows[0]).getByText("Framework — chưa có thiết bị kết nối")).toBeTruthy();
    expect(within(rows[2]).getByText("Đã đăng ký")).toBeTruthy();
    expect(within(rows[2]).getByText("Giao thức adapter")).toBeTruthy();
    expect(screen.getByText("Chọn một connector để xem chi tiết.")).toBeTruthy();
  });

  it("bấm hàng framework ⇒ `?connector=`, aria-current, chi tiết có caveat + đầu dò snapshot trung thực ('—', nguồn 'Không có')", async () => {
    const user = userEvent.setup();
    render(<EquipmentIntegration />);
    await user.click(within(catalog()).getByText("focas"));
    expect(params().get("connector")).toBe("framework:focas");
    expect(within(catalog()).getByText("focas").closest("tr")).toHaveAttribute("aria-current", "true");
    const detail = screen.getByRole("region", { name: "Chi tiết connector" });
    expect(within(detail).getByText("Chua lien ket thu vien FOCAS.")).toBeTruthy();
    expect(within(detail).getByText(/Các thẻ bên dưới là FRAMEWORK tích hợp|FRAMEWORK tích hợp/)).toBeTruthy();
    await user.type(within(detail).getByRole("textbox", { name: "Mã máy" }), "CNC-01");
    await user.click(within(detail).getByRole("button", { name: "Đọc snapshot" }));
    expect(srv.queryInputs).toContain(`equipmentIntegration.frameworkSnapshot:${JSON.stringify({ kind: "focas", machineCode: "CNC-01" })}`);
    expect(await within(detail).findByText("Không có")).toBeTruthy();
    expect(within(detail).getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("chi tiết adapter nói rõ đăng ký ≠ kết nối + nơi chuyển xử lý; F5 `?connector=` dựng lại; Enter trên hàng chọn", async () => {
    window.history.replaceState(null, "", "/equipment-integration?connector=adapter:ot-s7");
    render(<EquipmentIntegration />);
    const detail = screen.getByRole("region", { name: "Chi tiết connector" });
    expect(within(detail).getByRole("heading", { name: "ot-s7" })).toBeTruthy();
    expect(within(detail).getByText("S7Adapter")).toBeTruthy();
    expect(within(detail).getByText(/đăng ký không có nghĩa là có thiết bị đang kết nối/)).toBeTruthy();
    const row = within(catalog()).getByText("ot-modbus").closest("tr") as HTMLElement;
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    await waitFor(() => expect(params().get("connector")).toBe("adapter:ot-modbus"));
  });
});

describe("Tab + URL", () => {
  it("bấm tab ghi `?tab=` (replace, giữ tham số khác); F5 `?tab=history` mở đúng tab; `?tab=` lạ ⇒ catalog", async () => {
    // Đợt 3 Task 2 — ĐỔI BỘ CHỌN: tab "Worker thu ảnh" đã dời ⇒ người còn ≥2 tab là vai không mở được /recipes (R-3-b):
    // dùng tab chỉ-đọc "Phiên bản & lịch sử nạp".
    Object.assign(perm, { controlView: false, control: false, release: false, acqView: false, acqControl: false });
    window.history.replaceState(null, "", "/equipment-integration?connector=framework:focas");
    render(<EquipmentIntegration />);
    await openTab(/^Phiên bản & lịch sử nạp/);
    expect(params().get("tab")).toBe("history");
    expect(params().get("connector")).toBe("framework:focas");
    cleanup();
    window.history.replaceState(null, "", "/equipment-integration?tab=history");
    render(<EquipmentIntegration />);
    expect(tabBtn(/^Phiên bản & lịch sử nạp/)).toHaveAttribute("aria-selected", "true");
    cleanup();
    window.history.replaceState(null, "", "/equipment-integration?tab=bogus");
    render(<EquipmentIntegration />);
    expect(tabBtn(/^Danh mục connector/)).toHaveAttribute("aria-selected", "true");
  });
});

describe("Đợt 3 Task 1 — phiên bản recipe / lịch sử nạp đã dời sang Recipes", () => {
  it("`?tab=recipes&code=` ⇒ REPLACE `/recipes?tab=versions&code=`; `?tab=history&machineId=` ⇒ `/recipes?tab=history&machineId=` (giữ query)", () => {
    window.history.replaceState(null, "", "/equipment-integration?tab=recipes&code=RCP-1&flyout=eq-recipe-load&flyoutId=102");
    const before = window.history.length;
    render(<EquipmentIntegration />);
    expect(window.location.pathname + window.location.search).toBe("/recipes?tab=versions&code=RCP-1&flyout=eq-recipe-load&flyoutId=102");
    expect(window.history.length).toBe(before);
    cleanup();
    window.history.replaceState(null, "", "/equipment-integration?tab=history&machineId=3");
    render(<EquipmentIntegration />);
    expect(window.location.pathname + window.location.search).toBe("/recipes?tab=history&machineId=3");
  });

  it("trang không còn đọc phiên bản / lịch sử nạp / danh sách máy, không còn sheet tạo phiên bản hay ghi nhận nạp", async () => {
    window.history.replaceState(null, "", "/equipment-integration?flyout=eq-recipe-new");
    render(<EquipmentIntegration />);
    await new Promise((r) => setTimeout(r, 20));
    expect(layer("eq-recipe-new")).toBeNull();
    expect(srv.queryInputs.filter((x) => /listRecipeVersions|listLoadHistory|listCodeHistory|^machine\.list/.test(x))).toEqual([]);
    expect(screen.queryByRole("link", { name: /Mở trong Recipes/ })).toBeNull();
  });
});

// ── Fix round 1 (Ruling R-3-b) — người KHÔNG mở được /recipes (vai seed operator/viewer: machine_status, không
// machine_control) GIỮ quyền xem chỉ-đọc ngay trên Integration: một tab "Phiên bản & lịch sử nạp (chỉ xem)" =
// danh sách phiên bản KHÔNG thao tác + LoadHistoryPanel; KHÔNG chuyển hướng sang /recipes. Server không đổi.
describe("R-3-b — vai không có machine_control (operator/viewer): xem chỉ-đọc, không chuyển hướng", () => {
  const asOperator = () => Object.assign(perm, { view: true, controlView: false, control: false, release: false, acqView: false, acqControl: false });
  const roTab = () => tabBtn(/^Phiên bản & lịch sử nạp/);

  it("tab chỉ-đọc có cho operator, KHÔNG có cho engineer (engineer dùng Recipes)", () => {
    asOperator();
    render(<EquipmentIntegration />);
    // Đợt 3 Task 2 — tab "Worker thu ảnh" đã dời sang Vision › Thu ảnh.
    expect(within(toolbar()).getAllByRole("tab").map((x) => x.textContent?.trim())).toEqual(["Danh mục connector", "Phiên bản & lịch sử nạp (chỉ xem)"]);
    cleanup();
    Object.assign(perm, { controlView: true });
    render(<EquipmentIntegration />);
    expect(within(toolbar()).queryByRole("tab", { name: /Phiên bản & lịch sử nạp/ })).toBeNull();
  });

  it.each([
    "/equipment-integration?tab=recipes&code=RCP-1",
    "/equipment-integration?tab=history&code=RCP-1",
  ])("%s (operator) ⇒ KHÔNG chuyển hướng; tab chỉ-đọc: phiên bản v3/v2/v1 kèm trạng thái, KHÔNG nút thao tác nào; lịch sử theo mã", (url) => {
    asOperator();
    window.history.replaceState(null, "", url);
    render(<EquipmentIntegration />);
    expect(window.location.pathname).toBe("/equipment-integration");
    expect(roTab()).toHaveAttribute("aria-selected", "true");
    expect(srv.queryInputs).toContain(`equipmentIntegration.listRecipeVersions:${JSON.stringify({ code: "RCP-1" })}`);
    expect(within(versionRow(103)).getByText("Nháp")).toBeTruthy();
    expect(within(versionRow(102)).getByText("Đã phát hành")).toBeTruthy();
    expect(within(versionRow(101)).getByText("Đã lưu trữ")).toBeTruthy();
    for (const id of [101, 102, 103]) {
      expect(within(versionRow(id)).queryAllByRole("button")).toHaveLength(0);
    }
    expect(screen.queryByRole("button", { name: /Phát hành|Rollback|Ghi nhận nạp|Lưu trữ|Phiên bản mới|Lưu phiên bản mới/ })).toBeNull();
    expect(srv.queryInputs).toContain(`equipmentIntegration.listCodeHistory:${JSON.stringify({ code: "RCP-1", limit: 200 })}`);
    const hist = mainEl().querySelector("[data-load-history]") as HTMLElement;
    expect(within(hist).getByText("nap ca sang")).toBeTruthy();
    expect(within(hist).getByText("M3")).toBeTruthy();
  });

  it("operator: nhập mã (Enter) ⇒ `?code=`; chọn máy ⇒ lịch sử theo máy (listLoadHistory {machineId, limit 200}); không gọi thủ tục ghi nào", async () => {
    asOperator();
    window.history.replaceState(null, "", "/equipment-integration?tab=history");
    const user = userEvent.setup();
    render(<EquipmentIntegration />);
    await user.type(within(toolbar()).getByRole("textbox", { name: "Mã recipe" }), "RCP-1{Enter}");
    expect(params().get("code")).toBe("RCP-1");
    expect(versionRow(102)).toBeTruthy();
    await user.click(within(toolbar()).getByRole("combobox", { name: "Máy" }));
    await user.click(await screen.findByRole("option", { name: /M4 \(MC-4\)/ }));
    const hist = mainEl().querySelector("[data-load-history]") as HTMLElement;
    await user.click(within(hist).getByRole("combobox", { name: "Lọc theo" }));
    await user.click(await screen.findByRole("option", { name: "Máy" }));
    expect(srv.queryInputs).toContain(`equipmentIntegration.listLoadHistory:${JSON.stringify({ machineId: 4, limit: 200 })}`);
    expect(Object.keys(srv.calls)).toEqual([]);
  });

  it("engineer (mở được /recipes) ⇒ `?tab=history&machineId=3` vẫn chuyển hướng `/recipes?tab=history&machineId=3`", () => {
    window.history.replaceState(null, "", "/equipment-integration?tab=history&machineId=3");
    render(<EquipmentIntegration />);
    expect(window.location.pathname + window.location.search).toBe("/recipes?tab=history&machineId=3");
  });
});

describe("Đợt 3 Task 2 — worker thu ảnh đã dời sang Vision › Thu ảnh", () => {
  it("`?tab=acquisition&flyout=acq-start&x=` (có machine_alerts/canView) ⇒ REPLACE `/vision/acquisition?flyout=acq-start&x=` (giữ query, bỏ `tab`)", () => {
    window.history.replaceState(null, "", "/equipment-integration?tab=acquisition&flyout=acq-start&x=a%20b");
    const before = window.history.length;
    render(<EquipmentIntegration />);
    expect(window.location.pathname + window.location.search).toBe("/vision/acquisition?flyout=acq-start&x=a%20b");
    expect(window.history.length).toBe(before);
  });

  it("KHÔNG có machine_alerts/canView (vd operator) ⇒ KHÔNG chuyển vào trang bị từ chối; ở lại Integration, tab catalog", () => {
    Object.assign(perm, { acqView: false, acqControl: false });
    window.history.replaceState(null, "", "/equipment-integration?tab=acquisition&connector=adapter:ot-s7");
    render(<EquipmentIntegration />);
    expect(window.location.pathname).toBe("/equipment-integration");
    expect(params().get("connector")).toBe("adapter:ot-s7");
    expect(tabBtn(/^Danh mục connector/)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Chi tiết connector" })).toBeTruthy();
  });

  // Fix round 1 (Ruling R-3-d) — chỗ cũ trỏ tới chỗ mới: khách chỉ có giấy phép OT (ô AI là upsell khi bật launcher) vẫn
  // có lối nhìn thấy được tới Vision › Thu ảnh. Cổng = cổng của trang đích (machine_alerts/canView).
  it("R-3-d: có machine_alerts/canView ⇒ link 'Worker thu ảnh → Vision › Thu ảnh' trong hàng công cụ (MỌI tab) trỏ /vision/acquisition; không có ⇒ không link", async () => {
    render(<EquipmentIntegration />);
    const link = within(toolbar()).getByRole("link", { name: /Worker thu ảnh → Vision › Thu ảnh/ });
    expect(link).toHaveAttribute("href", "/vision/acquisition");
    const user = userEvent.setup();
    await user.click(link);
    expect(window.location.pathname).toBe("/vision/acquisition");
    cleanup();
    // operator-like có quyền xem thu ảnh nhưng không mở được /recipes ⇒ link cũng có ở tab chỉ-đọc
    Object.assign(perm, { controlView: false, control: false, release: false });
    window.history.replaceState(null, "", "/equipment-integration?tab=history");
    render(<EquipmentIntegration />);
    expect(within(toolbar()).getByRole("link", { name: /Worker thu ảnh → Vision › Thu ảnh/ })).toBeTruthy();
    cleanup();
    Object.assign(perm, { acqView: false, acqControl: false });
    window.history.replaceState(null, "", "/equipment-integration");
    render(<EquipmentIntegration />);
    expect(screen.queryByRole("link", { name: /Worker thu ảnh/ })).toBeNull();
  });

  it("R-3-d: màn hẹp ⇒ link nằm trong công cụ đầu nội dung tab", () => {
    presetNarrow(true);
    render(<EquipmentIntegration />);
    const tools = mainEl().querySelector("[data-narrow-tools]") as HTMLElement;
    expect(within(tools).getByRole("link", { name: /Worker thu ảnh → Vision › Thu ảnh/ })).toHaveAttribute("href", "/vision/acquisition");
  });

  it("trang không còn tab, panel, truy vấn hay sheet nào của worker thu ảnh", async () => {
    window.history.replaceState(null, "", "/equipment-integration?flyout=acq-start");
    render(<EquipmentIntegration />);
    await new Promise((r) => setTimeout(r, 20));
    expect(within(toolbar()).queryByRole("tab", { name: /Worker thu ảnh/ })).toBeNull();
    expect(acqPanel()).toBeNull();
    expect(layer("acq-start")).toBeNull();
    expect(srv.acq.mounts).toBe(0);
    expect(srv.queryInputs.some((x) => x.startsWith("visionAdapter."))).toBe(false);
    expect(screen.queryByRole("button", { name: /Khởi động worker/ })).toBeNull();
  });
});

describe("Màn hẹp (<1024 px) — GC10", () => {
  it("công cụ của tab ra ĐẦU nội dung tab (hàng tab không cắt mất); qua lại 1024 px đưa công cụ về hàng tab", () => {
    presetNarrow(true);
    // Đợt 3 Task 2 — ĐỔI BỘ CHỌN: công cụ của tab Worker thu ảnh đã dời ⇒ kiểm bằng công cụ của tab catalog (số connector).
    render(<EquipmentIntegration />);
    expect(within(toolbar()).queryByText("5 connector")).toBeNull();
    const tools = mainEl().querySelector("[data-narrow-tools]") as HTMLElement;
    expect(within(tools).getByText("5 connector")).toBeTruthy();
    setNarrow(false);
    expect(mainEl().querySelector("[data-narrow-tools]")).toBeNull();
    expect(within(toolbar()).getByText("5 connector")).toBeTruthy();
    setNarrow(true);
    expect(within(mainEl().querySelector("[data-narrow-tools]") as HTMLElement).getByText("5 connector")).toBeTruthy();
  });
});

// ── Final wave (Ruling R-3-h, "không ai mất quyền") — "mở được /recipes" = QUYỀN (machine_control/canView) VÀ GIẤY PHÉP
// route /recipes (MOD_ENGINEERING; Integration thuộc MOD_OT_CONTROL). Khách chỉ mua OT + người có machine_control GIỮ NGUYÊN
// năng lực recipe cũ của Integration (trước Đợt 3 Task 1): phiên bản + tạo / phát hành / lưu trữ / rollback, ghi nhận nạp,
// lịch sử nạp — cùng thủ tục, payload, cổng hiện/bật, cùng bộ invalidate; KHÔNG bị đẩy vào khoá giấy phép của /recipes.
describe("R-3-h — giấy phép chỉ OT (không MOD_ENGINEERING) + machine_control: đủ năng lực recipe cũ ngay trên Integration", () => {
  const otOnly = () => {
    lic.recipes = false;
  };
  const OLD_INVALIDATIONS = [
    "equipmentIntegration.status",
    "equipmentIntegration.integrationStatus",
    "equipmentIntegration.listRecipeVersions",
    "equipmentIntegration.listLoadHistory",
    "equipmentIntegration.listCodeHistory",
  ];
  const appErr = (message: string, code: string, appCode: string, appParams: Record<string, string>) =>
    Object.assign(new Error(message), { data: { code, appCode, appParams } });

  it("giấy phép đọc ĐÚNG route /recipes (vị từ isRouteAllowed của nav/RouteGuard)", () => {
    otOnly();
    render(<EquipmentIntegration />);
    expect(lic.asked).toContain("/recipes");
  });

  it.each([
    ["/equipment-integration?tab=recipes&code=RCP-1", "/equipment-integration?tab=history&code=RCP-1"],
    ["/equipment-integration?tab=history&code=RCP-1", "/equipment-integration?tab=history&code=RCP-1"],
  ])("%s ⇒ KHÔNG chuyển hướng (ở lại %s); tab 'Phiên bản & lịch sử nạp' (không 'chỉ xem') đủ thao tác theo trạng thái", async (url, stay) => {
    otOnly();
    window.history.replaceState(null, "", url);
    render(<EquipmentIntegration />);
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe(stay));
    expect(within(toolbar()).getAllByRole("tab").map((x) => x.textContent?.trim())).toEqual(["Danh mục connector", "Phiên bản & lịch sử nạp"]);
    expect(tabBtn(/^Phiên bản & lịch sử nạp$/)).toHaveAttribute("aria-selected", "true");
    const names = (id: number) => within(versionRow(id)).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    // ORACLE (hợp đồng tab "Phiên bản recipe" cũ): nháp ⇒ Phát hành + Lưu trữ + Ghi nhận nạp; đã phát hành ⇒ Lưu trữ +
    // Ghi nhận nạp; đã lưu trữ ⇒ Rollback + Ghi nhận nạp.
    expect(names(103)).toEqual(expect.arrayContaining(["Phát hành", "Lưu trữ", "Ghi nhận nạp"]));
    expect(names(102)).toEqual(expect.arrayContaining(["Lưu trữ", "Ghi nhận nạp"]));
    expect(names(102)).not.toContain("Phát hành");
    expect(names(101)).toEqual(expect.arrayContaining(["Rollback", "Ghi nhận nạp"]));
    expect(names(101)).not.toContain("Lưu trữ");
    expect(within(toolbar()).getByRole("button", { name: /Phiên bản mới/ })).toBeEnabled();
    expect(within(toolbar()).queryByText("Chỉ xem")).toBeNull();
    // lịch sử nạp theo mã vẫn ở cùng tab
    const hist = mainEl().querySelector("[data-load-history]") as HTMLElement;
    expect(within(hist).getByText("nap ca sang")).toBeTruthy();
  });

  it("phát hành (nháp): MỘT cú bấm ⇒ MỘT lượt releaseRecipeVersion {recipeId}, toast, invalidate ĐÚNG bộ cũ; v3 thành đã phát hành", async () => {
    otOnly();
    window.history.replaceState(null, "", "/equipment-integration?tab=history&code=RCP-1");
    const user = userEvent.setup();
    render(<EquipmentIntegration />);
    await user.click(within(versionRow(103)).getByRole("button", { name: "Phát hành" }));
    await waitFor(() => expect(calls("releaseRecipeVersion")).toEqual([{ recipeId: 103 }]));
    expect(toastSpy.success).toHaveBeenCalledWith("Đã phát hành phiên bản");
    expect(srv.invalidated).toEqual(expect.arrayContaining(OLD_INVALIDATIONS));
    await waitFor(() => expect(within(versionRow(103)).getByText("Đã phát hành")).toBeTruthy());
  });

  // Đợt 3b Task 2 (c) — ĐỔI HỢP ĐỒNG (chủ dự án 2026-10-06, "thống nhất lưu trữ recipe cần xác nhận"): lưu trữ ở chế độ
  // dự phòng R-3-h có CÙNG bước xác nhận như Recipes (AlertDialog: tiêu đề "Lưu trữ", câu `recipes.confirmArchive`,
  // Hủy / Lưu trữ). Cổng KHÔNG đổi (canCreate — ca "thiếu canEdit" bên dưới vẫn bật); payload/invalidate KHÔNG đổi.
  it("lưu trữ: hộp xác nhận như Recipes — bấm ⇒ CHƯA gọi; Hủy ⇒ 0 lượt; xác nhận ⇒ ĐÚNG MỘT archiveRecipeVersion {recipeId}; toast; invalidate bộ cũ", async () => {
    otOnly();
    window.history.replaceState(null, "", "/equipment-integration?tab=history&code=RCP-1");
    const user = userEvent.setup();
    render(<EquipmentIntegration />);
    await user.click(within(versionRow(102)).getByRole("button", { name: "Lưu trữ" }));
    let dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByRole("heading", { name: "Lưu trữ" })).toBeTruthy();
    expect(within(dlg).getByText("Lưu trữ phiên bản v2?")).toBeTruthy();
    expect(calls("archiveRecipeVersion")).toHaveLength(0);
    await user.click(within(dlg).getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls("archiveRecipeVersion")).toHaveLength(0);
    await user.click(within(versionRow(102)).getByRole("button", { name: "Lưu trữ" }));
    dlg = await screen.findByRole("alertdialog");
    await user.click(within(dlg).getByRole("button", { name: "Lưu trữ" }));
    await waitFor(() => expect(calls("archiveRecipeVersion")).toEqual([{ recipeId: 102 }]));
    expect(toastSpy.success).toHaveBeenCalledWith("Đã lưu trữ phiên bản");
    expect(srv.invalidated).toEqual(expect.arrayContaining(OLD_INVALIDATIONS));
  });

  it("lưu trữ bản nháp (v3) ⇒ câu xác nhận mang ĐÚNG phiên bản của hàng; xác nhận ⇒ {recipeId: 103}", async () => {
    otOnly();
    window.history.replaceState(null, "", "/equipment-integration?tab=history&code=RCP-1");
    const user = userEvent.setup();
    render(<EquipmentIntegration />);
    await user.click(within(versionRow(103)).getByRole("button", { name: "Lưu trữ" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText("Lưu trữ phiên bản v3?")).toBeTruthy();
    await user.click(within(dlg).getByRole("button", { name: "Lưu trữ" }));
    await waitFor(() => expect(calls("archiveRecipeVersion")).toEqual([{ recipeId: 103 }]));
  });

  it("rollback = AlertDialog cũ (R-2-g): KHÔNG ô lý do, KHÔNG OTP; Huỷ ⇒ không gọi; xác nhận ⇒ {toRecipeId}", async () => {
    otOnly();
    window.history.replaceState(null, "", "/equipment-integration?tab=history&code=RCP-1");
    const user = userEvent.setup();
    render(<EquipmentIntegration />);
    await user.click(within(versionRow(101)).getByRole("button", { name: "Rollback" }));
    let dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText("Rollback hợp đồng đã phát hành?")).toBeTruthy();
    expect(within(dlg).queryByRole("textbox")).toBeNull();
    await user.click(within(dlg).getByRole("button", { name: "Hủy" }));
    expect(calls("rollbackRecipeVersion")).toHaveLength(0);
    await user.click(within(versionRow(101)).getByRole("button", { name: "Rollback" }));
    dlg = await screen.findByRole("alertdialog");
    await user.click(within(dlg).getByRole("button", { name: /Rollback/ }));
    await waitFor(() => expect(calls("rollbackRecipeVersion")).toEqual([{ toRecipeId: 101 }]));
    expect(screen.queryByText(/mã OTP/i)).toBeNull();
    expect(srv.invalidated).toEqual(expect.arrayContaining(OLD_INVALIDATIONS));
  });

  it("thiếu canEdit ⇒ Phát hành / Rollback hiện nhưng KHOÁ kèm lý do machine_control/canEdit; Lưu trữ / Ghi nhận nạp vẫn bật (như cũ)", () => {
    otOnly();
    perm.release = false;
    window.history.replaceState(null, "", "/equipment-integration?tab=history&code=RCP-1");
    render(<EquipmentIntegration />);
    const rel = within(versionRow(103)).getByRole("button", { name: "Phát hành" });
    expect(rel).toBeDisabled();
    expect(rel.getAttribute("title")).toMatch(/machine_control\/canEdit/);
    expect(within(versionRow(101)).getByRole("button", { name: "Rollback" })).toBeDisabled();
    expect(within(versionRow(103)).getByRole("button", { name: "Lưu trữ" })).toBeEnabled();
    expect(within(versionRow(103)).getByRole("button", { name: "Ghi nhận nạp" })).toBeEnabled();
  });

  it("thiếu canCreate (có canView) ⇒ hàng 'Chỉ xem', không nút, không 'Phiên bản mới'; deep link sheet không mở", async () => {
    otOnly();
    perm.control = false;
    perm.release = false;
    window.history.replaceState(null, "", "/equipment-integration?tab=history&code=RCP-1&flyout=eq-recipe-load&flyoutId=102");
    render(<EquipmentIntegration />);
    for (const id of [101, 102, 103]) {
      expect(within(versionRow(id)).queryAllByRole("button")).toHaveLength(0);
      expect(within(versionRow(id)).getByText("Chỉ xem")).toBeTruthy();
    }
    expect(within(toolbar()).queryByRole("button", { name: /Phiên bản mới/ })).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(layer("eq-recipe-load")).toBeNull();
  });

  it("ghi nhận nạp = sheet dùng chung `eq-recipe-load`: không chọn máy ⇒ 'Chọn một máy.'; chọn M4 ⇒ ĐÚNG MỘT lượt {recipeId, machineId, deploy, notes}, đóng, invalidate bộ cũ", async () => {
    otOnly();
    window.history.replaceState(null, "", "/equipment-integration?tab=history&code=RCP-1");
    const user = userEvent.setup();
    render(<EquipmentIntegration />);
    await user.click(within(versionRow(103)).getByRole("button", { name: "Ghi nhận nạp" }));
    const sheet = await waitLayer("eq-recipe-load");
    expect(params().get("flyoutId")).toBe("103");
    await waitFor(() => expect(within(sheet).getByText(/RCP-1 v3 đã được nạp lên một máy/)).toBeTruthy());
    await user.click(within(sheet).getByRole("button", { name: /Ghi nhận nạp/ }));
    expect(toastSpy.error).toHaveBeenCalledWith("Chọn một máy.");
    expect(calls("recordRecipeLoad")).toHaveLength(0);
    expect(within(sheet).getAllByRole("combobox")).toHaveLength(1);
    await user.click(within(sheet).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "M4 (MC-4)" }));
    await user.type(within(sheet).getByLabelText("Ghi chú"), "ca 3");
    await user.click(within(sheet).getByRole("button", { name: /Ghi nhận nạp/ }));
    await waitFor(() => expect(layer("eq-recipe-load")).toBeNull());
    expect(calls("recordRecipeLoad")).toEqual([{ recipeId: 103, machineId: 4, deploy: false, notes: "ca 3" }]);
    expect(toastSpy.success).toHaveBeenCalledWith("Đã ghi nhận nạp recipe (truy xuất nguồn gốc)");
    expect(srv.invalidated).toEqual(expect.arrayContaining(OLD_INVALIDATIONS));
  });

  it("deep link cũ `?tab=recipes&code=&flyout=eq-recipe-load&flyoutId=102` (OT-only) mở đúng sheet ngay trên Integration", async () => {
    otOnly();
    window.history.replaceState(null, "", "/equipment-integration?tab=recipes&code=RCP-1&flyout=eq-recipe-load&flyoutId=102");
    render(<EquipmentIntegration />);
    expect(window.location.pathname).toBe("/equipment-integration");
    const sheet = await waitLayer("eq-recipe-load");
    await waitFor(() => expect(within(sheet).getByRole("combobox")).toHaveTextContent("M3 (MC-3)"));
  });

  it("'Phiên bản mới' ⇒ sheet `eq-recipe-new` cũ ⇒ createRecipeVersion {code, name, payload, machineId?, notes?}; mã/tên trống ⇒ lỗi cũ, không gọi", async () => {
    otOnly();
    window.history.replaceState(null, "", "/equipment-integration?tab=history&code=RCP-1");
    const user = userEvent.setup();
    render(<EquipmentIntegration />);
    await user.click(within(toolbar()).getByRole("button", { name: /Phiên bản mới/ }));
    const sheet = await waitLayer("eq-recipe-new");
    expect(within(sheet).getByLabelText("Mã recipe")).toHaveValue("RCP-1");
    await user.click(within(sheet).getByRole("button", { name: /Tạo phiên bản/ }));
    expect(toastSpy.error).toHaveBeenCalledWith("Mã và tên là bắt buộc.");
    expect(calls("createRecipeVersion")).toHaveLength(0);
    await user.type(within(sheet).getByLabelText("Tên"), "Reflow B");
    await user.click(within(sheet).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "M3 (MC-3)" }));
    await user.click(within(sheet).getByRole("button", { name: /Tạo phiên bản/ }));
    await waitFor(() => expect(layer("eq-recipe-new")).toBeNull());
    expect(calls("createRecipeVersion")).toEqual([{ code: "RCP-1", name: "Reflow B", payload: {}, machineId: 3, notes: undefined }]);
    expect(toastSpy.success).toHaveBeenCalledWith("Đã tạo phiên bản recipe (bản nháp)");
    expect(srv.invalidated).toEqual(expect.arrayContaining(OLD_INVALIDATIONS));
  });

  it("cờ chưa rõ ⇒ 'Phiên bản mới' khoá; deep link sheet chỉ báo trạng thái (không form) — như cũ", async () => {
    otOnly();
    srv.status = undefined;
    window.history.replaceState(null, "", "/equipment-integration?tab=history&code=RCP-1&flyout=eq-recipe-new");
    render(<EquipmentIntegration />);
    // sheet mở ⇒ phần còn lại của trang aria-hidden (modal) ⇒ tìm cả phần tử ẩn với AT
    expect(within(toolbar()).getByRole("button", { name: /Phiên bản mới/, hidden: true })).toBeDisabled();
    const sheet = await waitLayer("eq-recipe-new");
    expect(within(sheet).queryByRole("textbox")).toBeNull();
  });

  it("cờ TẮT ở server ⇒ FEATURE_DISABLED: toast.info bình tĩnh KHÔNG tên biến môi trường, không toast đỏ, đọc lại cờ", async () => {
    otOnly();
    srv.mutationError = appErr("Equipment integration disabled", "CONFLICT", "FEATURE_DISABLED", { feature: "equipmentIntegration" });
    window.history.replaceState(null, "", "/equipment-integration?tab=history&code=RCP-1");
    const user = userEvent.setup();
    render(<EquipmentIntegration />);
    await user.click(within(versionRow(103)).getByRole("button", { name: "Phát hành" }));
    await waitFor(() => expect(toastSpy.info).toHaveBeenCalled());
    expect(String(toastSpy.info.mock.calls[0][0])).not.toMatch(/[A-Z][A-Z0-9]*_[A-Z0-9_]*ENABLED/);
    expect(toastSpy.error).not.toHaveBeenCalled();
    expect(srv.invalidated).toContain("equipmentIntegration.status");
  });

  it("CẢ HAI giấy phép + machine_control ⇒ vẫn chuyển hướng sang /recipes (không tab recipe trên Integration)", () => {
    lic.recipes = true;
    window.history.replaceState(null, "", "/equipment-integration?tab=recipes&code=RCP-1");
    render(<EquipmentIntegration />);
    expect(window.location.pathname + window.location.search).toBe("/recipes?tab=versions&code=RCP-1");
    cleanup();
    window.history.replaceState(null, "", "/equipment-integration");
    render(<EquipmentIntegration />);
    expect(within(toolbar()).getAllByRole("tab").map((x) => x.textContent?.trim())).toEqual(["Danh mục connector"]);
  });

  it("operator (không machine_control) + chỉ OT ⇒ vẫn CHỈ-ĐỌC (R-3-b không đổi): nhãn '(chỉ xem)', 0 nút trên hàng, không 'Phiên bản mới'", () => {
    otOnly();
    Object.assign(perm, { controlView: false, control: false, release: false });
    window.history.replaceState(null, "", "/equipment-integration?tab=history&code=RCP-1");
    render(<EquipmentIntegration />);
    expect(window.location.pathname).toBe("/equipment-integration");
    expect(tabBtn(/^Phiên bản & lịch sử nạp \(chỉ xem\)/)).toHaveAttribute("aria-selected", "true");
    for (const id of [101, 102, 103]) expect(within(versionRow(id)).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Phát hành|Rollback|Ghi nhận nạp|Lưu trữ|Phiên bản mới/ })).toBeNull();
  });
});
