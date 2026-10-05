// @vitest-environment jsdom
//
// Doc 81 Đợt 3 Task 2 — Vision › Thu ảnh: trang riêng cho worker thu ảnh (trước là tab `?tab=acquisition` của Equipment
// Integration). Hợp đồng (task-2-brief + plan Review Focus 1/3/5 + GC3/R-2-n + QĐ-3c):
//   - P4 Cockpit (CockpitLayout, không tab): h1 ở header một hàng + chip (cờ thu ảnh trực tiếp 4 trạng thái, "Khi nào
//     dùng", "Về nguồn thu") + StatusChipStrip với chip "Worker lỗi" GHIM (R-2-p). MAIN = một hàng công cụ + bảng.
//   - Panel worker: MỘT instance cho cả vòng đời trang — qua lại 1024 px, mở/đóng sheet, đổi query KHÔNG unmount; poll
//     5 s CHỈ khi trang hiển thị (usePollingInterval: tab trình duyệt ẩn ⇒ dừng; hiện lại ⇒ 5 s + làm mới khi focus).
//   - Khởi động = sheet `?flyout=acq-start` → MỘT lượt startAcquisitionWorker, payload/kiểm tra như cũ; dừng = MỘT cú bấm
//     → stopAcquisitionWorker {id}; cả hai invalidate acquisitionWorkerStatus. Không quyền điều khiển ⇒ không nút.
// Oracle của payload / câu kiểm tra / toast: chép từ test cũ của tab Integration (EquipmentIntegration.layout.dom.test.tsx
// trước Đợt 3 Task 2), không suy từ mã mới.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { installResizeHandleHitAreaShim } from "@/components/patterns/layoutKitTestPanels";
import { installMatchMedia, presetNarrow, setNarrow } from "@/components/patterns/layoutKitTestMedia";
import { splitChipsForOverflow } from "@/components/patterns/StatusChipStrip";

vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
const perm = vi.hoisted(() => ({ acqView: true, acqControl: true }));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: false,
    hasPermission: (m: string, a: string) => {
      if (m === "machine_alerts" && a === "canView") return perm.acqView;
      if (m === "machine_alerts" && a === "canCreate") return perm.acqControl;
      return false;
    },
  }),
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));

type Row = Record<string, unknown>;
const srv = vi.hoisted(() => ({
  workers: [] as Row[],
  snap: [] as Row[],
  liveEnabled: true as boolean,
  statusLoading: false,
  statusError: false,
  version: 0,
  listeners: new Set<() => void>(),
  calls: {} as Record<string, unknown[]>,
  invalidated: [] as string[],
  queryInputs: [] as string[],
  queryOpts: {} as Record<string, unknown>,
  acq: { mounts: 0, unmounts: 0, polls: new Set<() => void>() },
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
  const runOp = (path: string, input: Row): Promise<unknown> =>
    Promise.resolve().then(() => {
      (srv.calls[path] ??= []).push(input);
      if (path === "visionAdapter.startAcquisitionWorker") {
        srv.workers.push(worker({ id: input.id, state: "running", framesGrabbed: 0 }));
        return { ok: true };
      }
      if (path === "visionAdapter.stopAcquisitionWorker") {
        Object.assign(srv.workers.find((w) => w.id === input.id)!, { state: "stopped" });
        return { ok: true };
      }
      return undefined;
    });
  const hooks = (path: string) => ({
    useQuery: (input?: Row, opts?: { enabled?: boolean }) => {
      useVersion();
      const enabled = opts?.enabled !== false;
      if (enabled) srv.queryInputs.push(`${path}:${JSON.stringify(input ?? null)}`);
      if (path === "visionAdapter.acquisitionWorkerStatus") {
        // Trạng thái SỐNG riêng của instance: mỗi "nhịp poll" tăng frame. Remount ⇒ về 0.
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
        if (srv.statusError) return q(undefined, enabled, { isError: true });
        if (srv.statusLoading) return q(undefined, enabled, { isLoading: true, isPending: true });
        return q({ liveEnabled: srv.liveEnabled, workers: srv.snap.map((w) => ({ ...w, framesGrabbed: Number(w.framesGrabbed) + tick })) }, enabled);
      }
      if (path === "visionAdapter.listAcquisitionSources")
        return q({ liveEnabled: srv.liveEnabled, sources: [{ kind: "file", available: true }, { kind: "mock", available: true }, { kind: "genicam", available: false }] }, enabled);
      return q(undefined, enabled);
    },
    useMutation: (hookOpts: { onSuccess?: (r: unknown, vars: Row) => void; onError?: (e: unknown, vars: Row) => void } = {}) => {
      const run = (input: Row, callOpts?: { onSuccess?: (r: unknown) => void }) =>
        runOp(path, input).then((r) => {
          hookOpts.onSuccess?.(r, input);
          callOpts?.onSuccess?.(r);
          return r;
        });
      return { isPending: false, mutate: (input: Row, o?: Row) => void run(input, o as never).catch(() => undefined), mutateAsync: (input: Row) => run(input) };
    },
  });
  const utilsAt = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get: (_t, p: string) => {
          if (p === "invalidate")
            return (input?: unknown) => {
              const key = path.join(".");
              srv.invalidated.push(input === undefined ? key : `${key}:${JSON.stringify(input)}`);
              if (key === "visionAdapter.acquisitionWorkerStatus") srv.snap = srv.workers.map((x) => ({ ...x }));
              bump();
              return Promise.resolve();
            };
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

import VisionAcquisition, { buildAcquisitionChips } from "./VisionAcquisition";

// Page Visibility điều khiển được (jsdom: luôn "visible").
let visibility: DocumentVisibilityState = "visible";
function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeAll(async () => {
  installResizeHandleHitAreaShim();
  installMatchMedia();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
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
  srv.workers = [worker({})];
  srv.snap = srv.workers.map((x) => ({ ...x }));
  srv.liveEnabled = true;
  srv.statusLoading = false;
  srv.statusError = false;
  srv.calls = {};
  srv.invalidated = [];
  srv.queryInputs = [];
  srv.queryOpts = {};
  srv.acq.mounts = 0;
  srv.acq.unmounts = 0;
  srv.acq.polls.clear();
  visibility = "visible";
  Object.assign(perm, { acqView: true, acqControl: true });
  for (const f of Object.values(toastSpy)) f.mockClear();
  localStorage.clear();
  presetNarrow(false);
  window.history.replaceState(null, "", "/vision/acquisition");
});
afterEach(() => cleanup());

const mainEl = () => {
  const all = [...document.querySelectorAll("[data-layout-main]")] as HTMLElement[];
  return all.find((e) => !all.some((o) => o !== e && o.contains(e))) as HTMLElement;
};
const header = () => document.querySelector("[data-layout-header]") as HTMLElement;
const chip = (id: string) => header().querySelector(`[data-chip-id="${id}"]`) as HTMLElement;
const toolbar = () => mainEl().querySelector("[data-layout-toolbar]") as HTMLElement;
const acqPanel = () => document.querySelector("[data-acq-panel]") as HTMLElement | null;
const layer = (key: string) => document.querySelector(`[data-flyout-key="${key}"]`) as HTMLElement | null;
const waitLayer = (key: string) =>
  waitFor(() => {
    const l = layer(key);
    expect(l).toBeTruthy();
    return l as HTMLElement;
  });
const calls = (p: string) => srv.calls[`visionAdapter.${p}`] ?? [];
const interval = () => (srv.queryOpts["visionAdapter.acquisitionWorkerStatus"] as { refetchInterval?: number | false }).refetchInterval;

describe("Vision › Thu ảnh — bố cục P4 và chip trung thực", () => {
  it("MAIN (một, trong <main>) = một hàng công cụ + bảng worker; h1 'Thu ảnh' ở header; không notice/KPI trong MAIN; 0 dialog", () => {
    render(<VisionAcquisition />);
    const m = mainEl();
    expect(m.getAttribute("data-layout-main")).toBe("vision-acquisition");
    expect(m.closest("main")).toBeTruthy();
    expect(m.querySelector("h1")).toBeNull();
    expect(m.querySelector("[data-layout-header]")).toBeNull();
    expect(m.querySelector("[data-layout-kpi]")).toBeNull();
    expect(m.querySelector("[data-notice-kind]")).toBeNull();
    expect(m.querySelectorAll("[data-layout-toolbar]")).toHaveLength(1);
    expect(within(toolbar()).getByRole("button", { name: /Khởi động worker/ })).toBeTruthy();
    expect(m.contains(acqPanel())).toBe(true);
    expect(within(acqPanel()!).getByRole("table")).toBeTruthy();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Thu ảnh");
    expect(h1.closest("[data-layout-header]")).toBeTruthy();
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
    expect(header().querySelectorAll("[data-layout-kpi]")).toHaveLength(2);
  });

  it("chip: 'Worker lỗi' 0 (ok) / 1 worker lỗi ⇒ 1; 'Đang chạy' x/y; đang tải ⇒ không in số; lỗi ⇒ không in 0", () => {
    render(<VisionAcquisition />);
    expect(chip("workers-error")).toHaveAttribute("data-state", "ok");
    expect(chip("workers-error")).toHaveTextContent("Worker lỗi");
    expect(chip("workers-error")).toHaveTextContent("0");
    expect(chip("workers-running")).toHaveTextContent("1/1");
    cleanup();
    srv.workers = [worker({}), worker({ id: "w2", state: "error", lastError: "open failed" }), worker({ id: "w3", state: "stopped", errors: 2 })];
    srv.snap = srv.workers.map((x) => ({ ...x }));
    render(<VisionAcquisition />);
    expect(chip("workers-error")).toHaveTextContent("2");
    expect(chip("workers-running")).toHaveTextContent("1/3");
    cleanup();
    srv.statusLoading = true;
    render(<VisionAcquisition />);
    for (const id of ["workers-error", "workers-running"]) {
      expect(chip(id)).toHaveAttribute("data-state", "loading");
      expect(chip(id)).not.toHaveTextContent(/\d/);
    }
    cleanup();
    srv.statusLoading = false;
    srv.statusError = true;
    render(<VisionAcquisition />);
    for (const id of ["workers-error", "workers-running"]) {
      expect(chip(id)).toHaveAttribute("data-state", "error");
      expect(chip(id)).not.toHaveTextContent(/0/);
    }
  });

  it("R-2-p: chip 'Worker lỗi' GHIM — không bao giờ vào '+N'; tông đỏ khi > 0", () => {
    const t = (_k: string, f: string) => f;
    const items = buildAcquisitionChips(t, { workers: [{ state: "error", errors: 0 }, { state: "running", errors: 0 }] }, "ok");
    const err = items.find((x) => x.id === "workers-error")!;
    expect(err.pinned).toBe(true);
    expect(err.tone).toBe("error");
    expect(err.value).toBe(1);
    // dải hẹp (1 chỗ) + chip lỗi đứng SAU một chip ok ⇒ chip ghim vẫn hiện
    const { visible } = splitChipsForOverflow([items[1], err], 1);
    expect(visible.map((x) => x.id)).toContain("workers-error");
    expect(buildAcquisitionChips(t, { workers: [{ state: "running", errors: 0 }] }, "ok")[0].tone).toBe("default");
    expect(buildAcquisitionChips(t, undefined, "loading")[0].value).toBeUndefined();
  });

  it("cờ thu ảnh trực tiếp 4 trạng thái ở header: tắt ⇒ chip (câu trong popover, KHÔNG tên biến môi trường); bật ⇒ không chip; đang tải / lỗi ⇒ chip chưa biết", async () => {
    srv.liveEnabled = false;
    const user = userEvent.setup();
    render(<VisionAcquisition />);
    const off = within(header()).getByTestId("feature-status-off");
    expect(mainEl().contains(off)).toBe(false);
    expect(off).toHaveTextContent(/Thu ảnh trực tiếp/);
    await user.click(off);
    const msg = await screen.findByText(/Thu ảnh trực tiếp đang tắt trên server/);
    expect(msg.textContent).not.toMatch(/[A-Z][A-Z0-9]+_[A-Z0-9_]+/);
    cleanup();
    srv.liveEnabled = true;
    render(<VisionAcquisition />);
    expect(screen.queryByTestId("feature-status-off")).toBeNull();
    expect(screen.queryByTestId("feature-status-loading")).toBeNull();
    cleanup();
    srv.statusLoading = true;
    render(<VisionAcquisition />);
    expect(within(header()).getByTestId("feature-status-loading")).toBeTruthy();
    cleanup();
    srv.statusLoading = false;
    srv.statusError = true;
    render(<VisionAcquisition />);
    expect(within(header()).getByTestId("feature-status-error")).toBeTruthy();
  });

  it("'Khi nào dùng' + 'Về nguồn thu' là chip header (câu trong popover), không phải khối trên MAIN", async () => {
    const user = userEvent.setup();
    render(<VisionAcquisition />);
    expect(screen.queryByText(/Nguồn file\/mock chạy thật hôm nay/)).toBeNull();
    await user.click(within(header()).getByRole("button", { name: /Khi nào dùng/ }));
    expect(await screen.findByText(/Khi nào dùng — khởi động, theo dõi và dừng worker thu ảnh/)).toBeTruthy();
  });
});

describe("Review Focus 3 — panel worker không unmount", () => {
  it("mount MỘT lần; nhịp poll của instance còn nguyên khi qua lại 1024 px, mở/đóng sheet, đổi query; cùng một nút DOM", async () => {
    const user = userEvent.setup();
    render(<VisionAcquisition />);
    expect(srv.acq.mounts).toBe(1);
    const node = acqPanel();
    expect(within(node!).getByText("10")).toBeTruthy();
    act(() => {
      for (const p of srv.acq.polls) p();
      for (const p of srv.acq.polls) p();
    });
    expect(within(node!).getByText("12")).toBeTruthy();
    setNarrow(true);
    setNarrow(false);
    setNarrow(true);
    expect(acqPanel()).toBe(node);
    await user.click(within(toolbar()).getByRole("button", { name: /Khởi động worker/ }));
    const sheet = await waitLayer("acq-start");
    await user.click(within(sheet).getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(layer("acq-start")).toBeNull());
    act(() => {
      window.history.replaceState(null, "", "/vision/acquisition?x=1");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    setNarrow(false);
    expect(srv.acq.mounts).toBe(1);
    expect(srv.acq.unmounts).toBe(0);
    expect(acqPanel()).toBe(node);
    expect(within(node!).getByText("12")).toBeTruthy();
  });

  it("poll 5 s CHỈ khi trang hiển thị: tab trình duyệt ẩn ⇒ refetchInterval false (panel vẫn mount); hiện lại ⇒ 5000; không poll nền; làm mới khi focus", () => {
    render(<VisionAcquisition />);
    expect(interval()).toBe(5000);
    const o = srv.queryOpts["visionAdapter.acquisitionWorkerStatus"] as Row;
    expect(o.refetchIntervalInBackground).toBe(false);
    expect(o.refetchOnWindowFocus).toBe("always");
    setVisibility("hidden");
    expect(interval()).toBe(false);
    expect(srv.acq.unmounts).toBe(0);
    setVisibility("visible");
    expect(interval()).toBe(5000);
    expect(srv.acq.mounts).toBe(1);
  });
});

describe("Khởi động / dừng — R-2-n: cùng target, xác nhận, cổng và payload như màn cũ", () => {
  it("sheet `?flyout=acq-start`: kiểm tra bắt buộc như cũ; lưu ⇒ MỘT lượt, payload đúng, invalidate, đóng; panel không remount", async () => {
    const user = userEvent.setup();
    render(<VisionAcquisition />);
    await user.click(within(toolbar()).getByRole("button", { name: /Khởi động worker/ }));
    const sheet = await waitLayer("acq-start");
    expect(new URLSearchParams(window.location.search).get("flyout")).toBe("acq-start");
    await user.click(within(sheet).getByRole("button", { name: /Khởi động worker/ }));
    expect(toastSpy.error).toHaveBeenCalledWith("Cần nhập id worker.");
    await user.type(within(sheet).getByLabelText("Worker"), "replay-1");
    await user.click(within(sheet).getByRole("button", { name: /Khởi động worker/ }));
    expect(toastSpy.error).toHaveBeenCalledWith("Nguồn file cần đường dẫn thư mục.");
    await user.type(within(sheet).getByLabelText("Thư mục (trên server)"), "D:\\cap");
    await user.click(within(sheet).getByRole("checkbox", { name: /Submit mỗi frame/ }));
    await user.click(within(sheet).getByRole("button", { name: /Khởi động worker/ }));
    expect(toastSpy.error).toHaveBeenCalledWith("Submit frame cần mã máy.");
    await user.click(within(sheet).getByRole("checkbox", { name: /Submit mỗi frame/ }));
    expect(calls("startAcquisitionWorker")).toEqual([]);
    await user.click(within(sheet).getByRole("button", { name: /Khởi động worker/ }));
    await waitFor(() =>
      expect(calls("startAcquisitionWorker")).toEqual([
        { id: "replay-1", source: { kind: "file", directory: "D:\\cap", loop: false }, machineCode: undefined, intervalMs: 2000, submit: false, assessQuality: true },
      ]),
    );
    await waitFor(() => expect(layer("acq-start")).toBeNull());
    expect(toastSpy.success).toHaveBeenCalledWith("Đã khởi động worker thu ảnh");
    expect(srv.invalidated).toEqual(["visionAdapter.acquisitionWorkerStatus"]);
    expect(within(acqPanel()!).getByText("replay-1")).toBeTruthy();
    expect(srv.acq.mounts).toBe(1);
  });

  it("deep link `?flyout=acq-start` (đích chuyển hướng của tab cũ) mở sheet khởi động", async () => {
    window.history.replaceState(null, "", "/vision/acquisition?flyout=acq-start");
    render(<VisionAcquisition />);
    expect(await waitLayer("acq-start")).toBeTruthy();
  });

  it("dừng: MỘT cú bấm trên hàng đang chạy ⇒ MỘT lượt {id} (chỉ worker đó, dù worker khác cũng đang chạy); invalidate; hàng không chạy ⇒ không nút Dừng", async () => {
    srv.workers = [worker({}), worker({ id: "w2", state: "stopped" }), worker({ id: "w3", state: "running" })];
    srv.snap = srv.workers.map((x) => ({ ...x }));
    const user = userEvent.setup();
    render(<VisionAcquisition />);
    const row2 = acqPanel()!.querySelector('tr[data-worker-id="w2"]') as HTMLElement;
    expect(within(row2).queryByRole("button", { name: /Dừng/ })).toBeNull();
    const row1 = acqPanel()!.querySelector('tr[data-worker-id="w1"]') as HTMLElement;
    await user.click(within(row1).getByRole("button", { name: /Dừng/ }));
    await waitFor(() => expect(calls("stopAcquisitionWorker")).toEqual([{ id: "w1" }]));
    expect(toastSpy.success).toHaveBeenCalledWith("Đã dừng worker thu ảnh");
    expect(srv.invalidated).toEqual(["visionAdapter.acquisitionWorkerStatus"]);
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
  });

  it("không có machine_alerts/canCreate ⇒ không nút Khởi động / Dừng; `?flyout=acq-start` không mở", async () => {
    perm.acqControl = false;
    window.history.replaceState(null, "", "/vision/acquisition?flyout=acq-start");
    render(<VisionAcquisition />);
    await new Promise((r) => setTimeout(r, 20));
    expect(layer("acq-start")).toBeNull();
    expect(within(toolbar()).queryByRole("button", { name: /Khởi động worker/ })).toBeNull();
    expect(within(acqPanel()!).queryByRole("button", { name: /Dừng/ })).toBeNull();
    expect(within(acqPanel()!).getByText("w1")).toBeTruthy();
  });

  it("không có machine_alerts/canView ⇒ câu khoá, KHÔNG truy vấn visionAdapter nào, không chip", () => {
    Object.assign(perm, { acqView: false, acqControl: false });
    render(<VisionAcquisition />);
    expect(acqPanel()).toHaveTextContent("Xem worker thu ảnh cần quyền xem machine-alerts.");
    expect(srv.queryInputs.filter((x) => x.startsWith("visionAdapter."))).toEqual([]);
    expect(header().querySelectorAll("[data-layout-kpi]")).toHaveLength(0);
  });
});

describe("i18n — khối visionAcq", () => {
  const LOC = (l: string) => JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales", `${l}.json`), "utf8")) as Record<string, unknown>;
  const flat = (o: unknown, p = "", out: Record<string, string> = {}) => {
    if (typeof o === "string") out[p] = o;
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out);
    return out;
  };
  it("vi/en/zh cùng bộ khoá; KHÔNG chuỗi nào chứa tên biến môi trường; khoá cũ eqIntegration.acq / tab.acquisition đã gỡ", () => {
    const [vi, en, zh] = ["vi", "en", "zh"].map((l) => flat(LOC(l).visionAcq));
    expect(Object.keys(vi).length).toBeGreaterThan(30);
    expect(Object.keys(en).sort()).toEqual(Object.keys(vi).sort());
    expect(Object.keys(zh).sort()).toEqual(Object.keys(vi).sort());
    for (const block of [vi, en, zh]) {
      const bad = Object.entries(block).filter(([, v]) => /[A-Z][A-Z0-9]+_[A-Z0-9_]+/.test(v));
      expect(bad).toEqual([]);
    }
    for (const l of ["vi", "en", "zh"]) {
      const eq = LOC(l).eqIntegration as Record<string, Record<string, unknown>>;
      expect(eq.acq).toBeUndefined();
      expect(eq.tab.acquisition).toBeUndefined();
      const nav = LOC(l).nav as Record<string, unknown>;
      expect(typeof nav.visionAcquisition).toBe("string");
      expect(typeof nav.visionAcquisitionDesc).toBe("string");
    }
  });
});
