// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 10 — Fleet Orchestration thành mẫu P4 Cockpit (CockpitLayout).
// Hợp đồng (task-10-brief + page-task-dispatch + plan GC3/Review Focus 1/4 + R-2-n/R-2-p):
//   - MAIN (`data-layout-main`) = BẢN ĐỒ cùng các vùng; hàng công cụ duy nhất (nhà máy + robot có vị trí).
//   - Panel phụ (aside, ngoài MAIN): tab `?tab=` Tác vụ / Vùng / Sạc / Tài nguyên + khối bế tắc khi có.
//   - 9 KPI → MỘT dải chip, mỗi chip ghi nguồn; Bế tắc / Thất bại / Vùng đầy tải GHIM (R-2-p).
//   - 7 Dialog → sheet sổ đăng ký (`?flyout=`): thao tác (sổ + tạo + ánh xạ), tài nguyên (tạo + đặt trước), trạm sạc,
//     gán lại tác vụ, đặt trước vùng. Huỷ tác vụ giữ AlertDialog.
//   - R-2-n: MỌI mutation tác động giữ đúng mục tiêu / xác nhận / cổng như trang cũ — một lượt gọi mỗi cú bấm/lưu.
//   - Giữ chặn chéo nhà máy (server FORBIDDEN SCOPE_MISMATCH ⇒ toast lỗi đã dịch, sheet giữ mở) và nhãn DEMO.
// "Server" giả là kho trong bộ nhớ: truy vấn CHỈ đổi khi trang gọi invalidate đúng thủ tục.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { installMatchMedia, presetNarrow } from "@/components/patterns/layoutKitTestMedia";
import { mapTrpcError } from "@/lib/trpcErrors";

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/PermissionGate", () => ({ ViewOnlyBadge: () => <span>Chỉ xem</span> }));
const perm = vi.hoisted(() => ({ view: true, control: true }));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: false,
    hasPermission: (m: string, a: string) => {
      if (m === "machine_monitoring" && a === "canView") return perm.view;
      if (m === "machine_control" && a === "canCreate") return perm.control;
      return false;
    },
  }),
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));

// ── "Server" giả ───────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
type Tables = { tasks: Row[]; zones: Row[]; reservations: Row[]; ops: Row[]; resources: Row[]; resRes: Row[]; chargers: Row[]; plans: Row[] };
const srv = vi.hoisted(() => ({
  status: { enabled: true } as Row | undefined,
  statusError: false,
  resStatus: { enabled: true } as Row | undefined,
  resStatusError: false,
  tasksLoading: false,
  tasksError: false,
  resourcesError: false,
  cycles: [] as number[][],
  db: {} as Tables,
  snap: {} as Tables,
  robots: [] as Row[],
  /** Lỗi server cho lượt gọi kế tiếp của thủ tục (vd FORBIDDEN chặn chéo nhà máy). */
  fail: {} as Record<string, unknown>,
  /** Kết quả server ghi đè (vd đặt chỗ bị từ chối). */
  result: {} as Record<string, unknown>,
  version: 0,
  listeners: new Set<() => void>(),
  calls: {} as Record<string, unknown[]>,
  invalidated: [] as string[],
  queryInputs: [] as string[],
  /** doc 81 Đợt 5 H3(b) — `factory.list` (danh sách nhà máy TRONG PHẠM VI người gọi); undefined = chưa có dữ liệu. */
  factories: undefined as Row[] | undefined,
  factoriesError: false,
}));
function bump() {
  srv.version++;
  for (const l of srv.listeners) l();
}
const clone = (rows: Row[]) => rows.map((x) => ({ ...x }));

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
  const loading = (enabled: boolean) => q(undefined, enabled, { isLoading: true, isPending: true });
  const errored = (enabled: boolean) => q(undefined, enabled, { isError: true, error: new Error("boom") });
  const runOp = (path: string, input: Row): Promise<unknown> =>
    Promise.resolve().then(() => {
      (srv.calls[path] ??= []).push(input);
      if (srv.fail[path]) {
        const e = srv.fail[path];
        delete srv.fail[path];
        throw e;
      }
      if (srv.result[path] !== undefined) return srv.result[path];
      const d = srv.db;
      if (path === "fleet.assign") {
        Object.assign(d.tasks.find((x) => x.id === input.taskId)!, { status: "assigned", assignedDeviceId: input.deviceId });
        return { ok: true };
      }
      if (path === "fleet.allocate") return { ok: true, assignedDeviceId: 5 };
      if (path === "fleet.cancelTask") {
        Object.assign(d.tasks.find((x) => x.id === input.taskId)!, { status: "cancelled" });
        return { ok: true };
      }
      if (path === "fleet.reserve") {
        d.reservations.push({ id: 900, zoneId: input.zoneId, deviceId: input.deviceId, status: "active", factoryId: 1 });
        return { ok: true, status: "active" };
      }
      if (path === "fleet.release") {
        d.reservations = d.reservations.filter((r) => !(r.zoneId === input.zoneId && r.deviceId === input.deviceId));
        return { ok: true };
      }
      if (path === "fleet.resolveDeadlock") return { ok: true, resolved: 1 };
      if (path === "fleet.createOperation") {
        d.ops.push({ id: 77, code: input.code, requiredCapability: input.requiredCapability, requiredSkillIds: [], toolType: input.toolType ?? null, estimatedCycleMs: input.estimatedCycleMs ?? null });
        return { id: 77 };
      }
      if (path === "fleet.mapOperationProgram") return { ok: true };
      if (path === "fleet.createResource") {
        d.resources.push({ id: 88, code: input.code, name: input.name ?? null, type: input.type, status: "available", currentOwnerDeviceId: null, availability: { activeCount: 0, queuedCount: 0 } });
        return { id: 88 };
      }
      if (path === "fleet.reserveResource") {
        d.resRes.push({ id: 901, resourceId: input.resourceId, deviceId: input.deviceId, status: "active" });
        return { ok: true, status: "active" };
      }
      if (path === "fleet.releaseResource") {
        d.resRes = d.resRes.filter((r) => !(r.resourceId === input.resourceId && r.deviceId === input.deviceId));
        return { ok: true };
      }
      if (path === "fleet.createCharger") {
        d.chargers.push({ id: 99, code: input.code, name: input.name ?? null, chargerType: input.chargerType, powerWatts: input.powerWatts ?? null, status: "available" });
        return { id: 99 };
      }
      if (path === "fleet.sweepCharging") return { scheduled: 2 };
      return undefined;
    });
  const hooks = (path: string) => ({
    useQuery: (input?: Row, opts?: { enabled?: boolean }) => {
      useVersion();
      const enabled = opts?.enabled !== false;
      if (enabled) srv.queryInputs.push(`${path}:${JSON.stringify(input ?? null)}`);
      const s = srv.snap;
      switch (path) {
        case "fleet.status":
          return srv.statusError ? errored(enabled) : srv.status === undefined ? loading(enabled) : q(srv.status, enabled);
        case "fleet.resourceStatus":
          return srv.resStatusError ? errored(enabled) : srv.resStatus === undefined ? loading(enabled) : q(srv.resStatus, enabled);
        case "fleet.listTasks":
          if (srv.tasksError) return errored(enabled);
          if (srv.tasksLoading) return loading(enabled);
          return q(input?.status ? s.tasks.filter((x) => x.status === input.status) : s.tasks, enabled);
        case "fleet.listZones":
          return q(s.zones, enabled);
        case "fleet.listReservations":
          return q(s.reservations, enabled);
        case "fleet.deadlocks":
          return q({ cycles: srv.cycles }, enabled);
        case "fleet.robotPositions":
          return q(srv.robots, enabled);
        case "twin.occupancyGrid":
          return q({ grid: null, note: null }, enabled);
        case "factory.list":
          return srv.factoriesError ? errored(enabled) : q(srv.factories, enabled);
        case "fleet.listOperations":
          return q(s.ops, enabled);
        case "fleet.resolveOperation":
          return input?.code === "OP-WELD-01"
            ? q({ code: "OP-WELD-01", requiredCapability: "weld", toolType: "torch", estimatedCycleMs: 30000, requiredSkillIds: [1], qualifiedPrograms: [{ programProjectId: 4, programCode: "PRJ-WELD", deviceKind: "arm" }] }, enabled)
            : errored(enabled);
        case "fleet.listResources":
          return srv.resourcesError ? errored(enabled) : q(s.resources, enabled);
        case "fleet.listResourceReservations":
          return q(s.resRes, enabled);
        case "fleet.listChargers":
          return q(s.chargers, enabled);
        case "fleet.listChargingPlans":
          return q(s.plans, enabled);
        default:
          return q(undefined, enabled);
      }
    },
    useMutation: (hookOpts: { onSuccess?: (r: unknown, vars: Row) => void; onError?: (e: unknown, vars: Row) => void } = {}) => {
      const run = (input: Row, callOpts?: { onSuccess?: (r: unknown) => void }) =>
        runOp(path, input).then(
          (r) => {
            hookOpts.onSuccess?.(r, input);
            callOpts?.onSuccess?.(r);
            return r;
          },
          (e) => {
            hookOpts.onError?.(e, input);
            throw e;
          },
        );
      return { isPending: false, mutate: (input: Row, o?: Row) => void run(input, o as never).catch(() => undefined), mutateAsync: (input: Row) => run(input) };
    },
  });
  const KEY_TO_TABLE: Record<string, keyof Tables> = {
    "fleet.listTasks": "tasks",
    "fleet.listZones": "zones",
    "fleet.listReservations": "reservations",
    "fleet.listOperations": "ops",
    "fleet.listResources": "resources",
    "fleet.listResourceReservations": "resRes",
    "fleet.listChargers": "chargers",
    "fleet.listChargingPlans": "plans",
  };
  const refresh = (key: string) => {
    const tb = KEY_TO_TABLE[key];
    if (tb) srv.snap[tb] = srv.db[tb].map((x) => ({ ...x }));
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

import FleetOrchestration from "./FleetOrchestration";

function task(id: number, taskKey: string, status: string, payload: Row | null = null, extra: Row = {}): Row {
  return {
    id, taskKey, sourceWorkOrderId: null, requiredCapability: "run_job", priority: 3, status,
    assignedDeviceId: null, assignedDeviceKind: null, locationStart: null, locationEnd: null,
    estimatedDurationMs: 1000, actualDurationMs: null, retryCount: 0, payload,
    corporateCode: null, factoryId: 1, lastError: null,
    createdAt: "2026-09-26T05:07:17.928Z", updatedAt: "2026-09-26T05:07:17.928Z",
    assignedAt: null, startedAt: null, completedAt: null, ...extra,
  };
}
// ORACLE (khai tay): 2/4 tác vụ là DEMO (taskKey DEMO-TASK-*, payload.demo=true) — như DB dev; T-9 đã kết thúc.
const TASKS = (): Row[] => [
  task(3, "DEMO-TASK-PICK-1", "pending", { demo: true, operationCode: "PICK_PLACE" }),
  task(4, "DEMO-TASK-INSPECT-1", "failed", { demo: true, operationCode: "INSPECT_AOI" }),
  task(5, "WO-7788-SMT", "running", { operationCode: "PICK_PLACE" }, { assignedDeviceId: 2 }),
  task(9, "LINE-B-DONE", "completed", null),
];
const SEEDED = new Set(["DEMO-TASK-PICK-1", "DEMO-TASK-INSPECT-1"]);
const ZONES = (): Row[] => [
  { id: 1, name: "Vùng A", code: "Z-A", zoneType: "production", occupancy: 1, maxConcurrentRobots: 2, factoryId: 1, bounds: { x: 0, y: 0, w: 10, h: 5 } },
  { id: 2, name: "Vùng B", code: "Z-B", zoneType: "human_shared", occupancy: 2, maxConcurrentRobots: 2, factoryId: 3, bounds: { x: 12, y: 0, w: 6, h: 5 } },
];
const RESERVATIONS = (): Row[] => [{ id: 11, zoneId: 1, deviceId: 7, status: "active", factoryId: 1 }];
const OPS = (): Row[] => [{ id: 21, code: "OP-WELD-01", requiredCapability: "weld", requiredSkillIds: [1], toolType: "torch", estimatedCycleMs: 30000 }];
const RESOURCES = (): Row[] => [
  { id: 31, code: "JIG-01", name: "Jig A", type: "jig", status: "in_use", currentOwnerDeviceId: 7, availability: { activeCount: 1, queuedCount: 0 } },
];
const RES_RES = (): Row[] => [{ id: 41, resourceId: 31, deviceId: 7, status: "active" }];
const CHARGERS = (): Row[] => [{ id: 51, code: "CHG-01", name: "Sạc 1", chargerType: "contact", powerWatts: 2000, status: "available" }];
const PLANS = (): Row[] => [{ id: 61, deviceId: 7, currentEnergyPct: 18, plannedStartAt: "2026-10-03T08:00:00.000Z", estimatedDurationMs: 600000, status: "planned", reason: "low battery" }];

beforeAll(async () => {
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
  srv.resStatus = { enabled: true };
  srv.resStatusError = false;
  srv.tasksLoading = false;
  srv.tasksError = false;
  srv.resourcesError = false;
  srv.cycles = [];
  srv.db = { tasks: TASKS(), zones: ZONES(), reservations: RESERVATIONS(), ops: OPS(), resources: RESOURCES(), resRes: RES_RES(), chargers: CHARGERS(), plans: PLANS() };
  srv.snap = {
    tasks: clone(srv.db.tasks), zones: clone(srv.db.zones), reservations: clone(srv.db.reservations), ops: clone(srv.db.ops),
    resources: clone(srv.db.resources), resRes: clone(srv.db.resRes), chargers: clone(srv.db.chargers), plans: clone(srv.db.plans),
  };
  srv.robots = [{ id: 7, code: "AGV-7", status: "online", battery: 80, x: 3, y: 2 }, { id: 8, code: "AGV-8", status: "offline", battery: null, x: null, y: null }];
  srv.fail = {};
  srv.result = {};
  srv.calls = {};
  srv.invalidated = [];
  srv.queryInputs = [];
  srv.factories = undefined;
  srv.factoriesError = false;
  Object.assign(perm, { view: true, control: true });
  for (const f of Object.values(toastSpy)) f.mockClear();
  localStorage.clear();
  presetNarrow(false);
  window.history.replaceState(null, "", "/labs/fleet-orchestration");
});
afterEach(() => cleanup());

const mainEl = () => {
  const all = [...document.querySelectorAll("[data-layout-main]")] as HTMLElement[];
  return all.find((e) => !all.some((o) => o !== e && o.contains(e))) as HTMLElement;
};
const header = () => document.querySelector("[data-layout-header]") as HTMLElement;
const side = () => document.querySelector("aside[aria-label]") as HTMLElement;
const params = () => new URLSearchParams(window.location.search);
const layer = (key: string) => document.querySelector(`[data-flyout-key="${key}"]`) as HTMLElement | null;
const waitLayer = (key: string) =>
  waitFor(() => {
    const l = layer(key);
    expect(l).toBeTruthy();
    return l as HTMLElement;
  });
const chip = (id: string) => document.querySelector(`[data-chip-id="${id}"]`) as HTMLElement | null;
const calls = (p: string) => srv.calls[`fleet.${p}`] ?? [];
const sideTab = (name: RegExp) => within(side()).getByRole("tab", { name });
const taskRow = (key: string) => within(side()).getByText(key).closest("tr") as HTMLElement;
const zoneCard = (id: number) => side().querySelector(`[data-zone-card="${id}"]`) as HTMLElement;

describe("Fleet P4 — bố cục: MAIN là bản đồ, panel phụ 4 tab", () => {
  it("MAIN (một, trong <main>) = bản đồ + các vùng; không h1/header/KPI/notice trong MAIN; một thanh công cụ; panel phụ ngoài MAIN với Tác vụ/Vùng/Sạc/Tài nguyên; 0 dialog lúc nạp", () => {
    render(<FleetOrchestration />);
    const m = mainEl();
    expect(m.getAttribute("data-layout-main")).toBe("fleet-orchestration");
    expect(m.closest("main")).toBeTruthy();
    expect(within(m).getByRole("img", { name: "Bản đồ đội thiết bị" })).toBeInTheDocument();
    // các vùng nằm TRÊN bản đồ (MAIN)
    expect(m.querySelectorAll("[data-zone-id]").length).toBe(2);
    expect(m.querySelector("h1, [data-layout-header], [data-layout-kpi], [data-notice-kind]")).toBeNull();
    expect(m.querySelectorAll("[data-layout-toolbar]").length).toBe(1);
    expect(within(m.querySelector("[data-layout-toolbar]") as HTMLElement).getByText(/Robot có vị trí: 1\/2/)).toBeInTheDocument();
    expect(within(header()).getByRole("heading", { level: 1, name: /Điều phối Đội xe & Tác vụ/ })).toBeInTheDocument();
    const aside = side();
    expect(m.contains(aside)).toBe(false);
    expect(within(aside).getAllByRole("tab").map((x) => x.textContent?.trim())).toEqual(["Tác vụ", "Vùng", "Sạc", "Tài nguyên"]);
    expect(sideTab(/^Tác vụ$/)).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length).toBe(0);
    // không còn thẻ KPI cũ / banner cũ trên MAIN
    expect(document.querySelector('[data-slot="metric-card"], [data-loc*="MetricCard"]')).toBeNull();
  });

  it("9 KPI cũ = MỘT dải chip, mỗi chip ghi NGUỒN; ≥1600 px: 5 chip + '+4'; giá trị như cũ", async () => {
    const user = userEvent.setup();
    render(<FleetOrchestration />);
    const strip = header().querySelector("[data-status-chip-strip]") as HTMLElement;
    expect(strip).toBeTruthy();
    expect(strip.querySelectorAll("[data-chip-id]").length).toBe(5);
    expect(strip.querySelector("[data-chip-more]")?.getAttribute("data-chip-more")).toBe("4");
    expect(chip("fleet-deadlocks")!.textContent).toMatch(/Bế tắc\s*0/);
    expect(chip("fleet-failed")!.textContent).toMatch(/Thất bại\s*1/);
    expect(chip("fleet-at-capacity")!.textContent).toMatch(/Vùng đầy tải\s*1\/2/);
    expect(chip("fleet-pending")!.textContent).toMatch(/Đang chờ\s*1/);
    expect(chip("fleet-running")!.textContent).toMatch(/Đang chạy\s*1/);
    expect(chip("fleet-failed")!.getAttribute("title")).toMatch(/Nguồn: fleet\.listTasks/);
    expect(chip("fleet-at-capacity")!.getAttribute("title")).toMatch(/Nguồn: fleet\.listZones/);
    await user.click(strip.querySelector("[data-chip-more]") as HTMLElement);
    const pop = await screen.findByRole("dialog");
    const hiddenIds = [...pop.querySelectorAll("[data-chip-id]")].map((e) => e.getAttribute("data-chip-id")).sort();
    expect(hiddenIds).toEqual(["fleet-active-res", "fleet-assigned", "fleet-charging", "fleet-resources-in-use"]);
    expect(chip("fleet-active-res")!.textContent).toMatch(/1/);
    expect(chip("fleet-resources-in-use")!.textContent).toMatch(/1\/1/);
    expect(chip("fleet-charging")!.getAttribute("title")).toMatch(/fleet\.listChargingPlans/);
  });

  it("R-2-p: <1600 px chỉ còn 3 chỗ — Bế tắc / Thất bại / Vùng đầy tải GHIM vẫn hiện dù chip khác đang tải; tác vụ LỖI ⇒ 'Lỗi', không in 0", () => {
    presetNarrow(true);
    srv.tasksError = true;
    render(<FleetOrchestration />);
    const strip = header().querySelector("[data-status-chip-strip]") as HTMLElement;
    const visible = [...strip.querySelectorAll(":scope > [data-chip-id]")].map((e) => e.getAttribute("data-chip-id"));
    expect(visible).toEqual(["fleet-deadlocks", "fleet-failed", "fleet-at-capacity"]);
    expect(chip("fleet-failed")!.getAttribute("data-state")).toBe("error");
    expect(chip("fleet-failed")!.textContent).toMatch(/Lỗi/);
    expect(chip("fleet-failed")!.textContent).not.toMatch(/\b0\b/);
    // "+N" mang tông TỆ NHẤT của phần giấu (chip tác vụ lỗi)
    expect(strip.querySelector("[data-chip-more]")!.getAttribute("data-state")).toBe("error");
  });

  it("R-2-p: chip GHIM Thất bại (số ổn) vẫn hiện khi một chip KHÔNG ghim đang LỖI giành chỗ (lỗi được ưu tiên hiện)", () => {
    presetNarrow(true);
    srv.resourcesError = true;
    render(<FleetOrchestration />);
    const strip = header().querySelector("[data-status-chip-strip]") as HTMLElement;
    const visible = [...strip.querySelectorAll(":scope > [data-chip-id]")].map((e) => e.getAttribute("data-chip-id"));
    expect(visible).toContain("fleet-failed");
    expect(visible).toContain("fleet-deadlocks");
    expect(visible).toContain("fleet-at-capacity");
    expect(chip("fleet-failed")!.textContent).toMatch(/Thất bạis*1/);
  });

  it("chip cờ G1 giữ 4 trạng thái (feature-status-*) ở header; G2 chỉ hiện ở tab Sạc/Tài nguyên (như banner cũ ngoài tab Tác vụ)", async () => {
    const user = userEvent.setup();
    srv.status = undefined;
    srv.resStatus = { enabled: false };
    const { unmount } = render(<FleetOrchestration />);
    expect(within(header()).getByTestId("feature-status-loading")).toBeInTheDocument();
    expect(within(header()).queryByTestId("feature-status-off")).toBeNull();
    await user.click(sideTab(/^Tài nguyên$/));
    const g2 = within(header()).getByTestId("feature-status-off");
    expect(g2.textContent).toMatch(/Lớp tài nguyên/);
    await user.click(g2);
    expect(await screen.findByText(/lớp tài nguyên đội xe đang tắt/)).toBeInTheDocument();
    unmount();
    srv.status = undefined;
    srv.statusError = true;
    window.history.replaceState(null, "", "/labs/fleet-orchestration");
    render(<FleetOrchestration />);
    expect(within(header()).getByTestId("feature-status-error")).toBeInTheDocument();
    expect(within(header()).queryByTestId("feature-status-off")).toBeNull();
  });

  it("'Chỉ trạng thái điều phối' + 'Khi nào dùng' là chip header (câu cũ trong popover), không còn khối ghi chú", async () => {
    const user = userEvent.setup();
    render(<FleetOrchestration />);
    const honesty = within(header()).getByRole("button", { name: /Chỉ trạng thái điều phối/ });
    await user.click(honesty);
    expect(await screen.findByText(/Chuyển động robot thực luôn đi qua dispatcher HITL/)).toBeInTheDocument();
    // header chỉ một chip ghi chú + "+1" (đo 1600 px: chip thứ hai bị vùng hành động che) — "Khi nào dùng" trong "+1"
    await user.keyboard("{Escape}");
    await user.click(within(header()).getByRole("button", { name: "Xem thêm 1 ghi chú" }));
    expect(await screen.findByText(/Khi nào dùng — phân bổ nhiệm vụ cho ĐỘI robot\/AGV/)).toBeInTheDocument();
    expect(document.querySelector('[data-when-to-use="fleet.whenToUse"]')).toBeTruthy();
  });

  it("< 1024 px: chip cờ + ghi chú xuống đầu MAIN ([data-narrow-notices]); header không còn chúng", () => {
    presetNarrow(true);
    srv.status = { enabled: false };
    render(<FleetOrchestration />);
    const narrowRow = mainEl().querySelector("[data-narrow-notices]") as HTMLElement;
    expect(narrowRow).toBeTruthy();
    expect(within(narrowRow).getByTestId("feature-status-off")).toBeInTheDocument();
    expect(within(header()).queryByTestId("feature-status-off")).toBeNull();
    expect(header().querySelector("[data-notice-kind]")).toBeNull();
  });
});

describe("Fleet — `?tab=` panel phụ và bản đồ (Review Focus 4)", () => {
  it("bấm tab ⇒ ?tab= (replace); F5 giữ; giá trị lạ ⇒ Tác vụ; về Tác vụ ⇒ bỏ tham số", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<FleetOrchestration />);
    await user.click(sideTab(/^Vùng$/));
    expect(params().get("tab")).toBe("zones");
    expect(zoneCard(1)).toBeTruthy();
    unmount();
    render(<FleetOrchestration />); // F5
    expect(sideTab(/^Vùng$/)).toHaveAttribute("aria-selected", "true");
    await user.click(sideTab(/^Tác vụ$/));
    expect(params().has("tab")).toBe(false);
    cleanup();
    window.history.replaceState(null, "", "/labs/fleet-orchestration?tab=map");
    render(<FleetOrchestration />);
    expect(sideTab(/^Tác vụ$/)).toHaveAttribute("aria-selected", "true");
  });

  it("bấm một vùng trên bản đồ (hoặc Enter) ⇒ tab Vùng mở, thẻ vùng đó được đánh dấu", async () => {
    const user = userEvent.setup();
    render(<FleetOrchestration />);
    const zoneB = mainEl().querySelector('[data-zone-id="2"]') as HTMLElement;
    expect(zoneB.getAttribute("aria-label")).toMatch(/Vùng Z-B — 2\/2 robot/);
    await user.click(zoneB);
    expect(params().get("tab")).toBe("zones");
    expect(zoneCard(2)).toHaveAttribute("aria-current", "true");
    expect(zoneCard(1)).not.toHaveAttribute("aria-current");
    const zoneA = mainEl().querySelector('[data-zone-id="1"]') as HTMLElement;
    zoneA.focus();
    await user.keyboard("{Enter}");
    expect(zoneCard(1)).toHaveAttribute("aria-current", "true");
  });

  it("chặn chéo nhà máy (đọc): bộ chọn nhà máy chỉ liệt kê nhà máy của các vùng đọc được (#1, #3); đổi ⇒ occupancyGrid {factoryId}", async () => {
    const user = userEvent.setup();
    render(<FleetOrchestration />);
    expect(srv.queryInputs).toContain('twin.occupancyGrid:{"factoryId":1}');
    await user.click(within(mainEl()).getByRole("combobox", { name: "Nhà máy" }));
    const opts = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opts).toEqual(["#1", "#3"]);
    await user.click(screen.getByRole("option", { name: "#3" }));
    expect(srv.queryInputs).toContain('twin.occupancyGrid:{"factoryId":3}');
  });
});

describe("Fleet — final wave T10", () => {
  it("không biết nhà máy nào (chưa có vùng đọc được) ⇒ KHÔNG gọi occupancyGrid với factoryId=1 dự phòng", async () => {
    srv.db.zones = [];
    srv.snap.zones = [];
    render(<FleetOrchestration />);
    await new Promise((r) => setTimeout(r, 20));
    expect(srv.queryInputs.filter((x) => x.startsWith("twin.occupancyGrid:"))).toEqual([]);
    // khung bản đồ (svg, hay trạng thái tải/trống khi chưa có hình học) giữ đúng chiều cao (MAIN không co lại)
    const frame = document.querySelector('[data-fleet-map] > svg, [data-fleet-map-state]') as Element;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("class")).toMatch(/h-\[max\(18rem,calc\(100dvh_-_var\(--shell-chrome-h/);
  });

  it("chip GHIM 'Thất bại' khi đang lọc trạng thái KHÁC 'failed' ⇒ '—' (không đọc thành 0 khoẻ mạnh); lọc 'failed' ⇒ số thật", async () => {
    const user = userEvent.setup();
    render(<FleetOrchestration />);
    expect(chip("fleet-failed")!.textContent).toMatch(/Thất bại\s*1/);
    await user.click(screen.getByRole("combobox", { name: "Trạng thái" }));
    await user.click(await screen.findByRole("option", { name: "Đang chờ" }));
    await waitFor(() => expect(chip("fleet-failed")!.textContent).toMatch(/Thất bại\s*—/));
    expect(chip("fleet-failed")!.textContent).not.toMatch(/0/);
  });

  it("nút Phân bổ (một cú bấm, không xác nhận) KHÔNG sát nút Gán lại: hàng nút cách nhau ≥ gap-1", () => {
    render(<FleetOrchestration />);
    const allocate = screen.getAllByRole("button", { name: "Phân bổ" })[0];
    expect(allocate.parentElement!.className).toMatch(/(^|\s)gap-(1|1\.5|2)(\s|$)/);
    expect(allocate.parentElement!.className).not.toMatch(/gap-0\.5/);
  });
});

describe("Fleet — Tác vụ (G1): nhãn nguồn + hành động như cũ (R-2-n)", () => {
  it("nhãn DEMO: tóm tắt 2/4; BẤT BIẾN hàng seed có badge, hàng thật không", () => {
    render(<FleetOrchestration />);
    const s = within(side()).getByTestId("provenance-summary");
    expect(s).toHaveAttribute("data-count", "2");
    expect(s).toHaveAttribute("data-total", "4");
    for (const tk of TASKS()) {
      const badge = taskRow(String(tk.taskKey)).querySelector('[data-testid="provenance-badge"]');
      if (SEEDED.has(String(tk.taskKey))) expect(badge?.getAttribute("data-provenance"), String(tk.taskKey)).toBe("DEMO");
      else expect(badge, String(tk.taskKey)).toBeNull();
    }
  });

  it("Phân bổ = MỘT cú bấm, MỘT lượt {taskId}, không dialog; khoá khi đang chạy/kết thúc", async () => {
    const user = userEvent.setup();
    render(<FleetOrchestration />);
    await user.click(within(taskRow("DEMO-TASK-PICK-1")).getByRole("button", { name: "Phân bổ" }));
    await waitFor(() => expect(calls("allocate")).toEqual([{ taskId: 3 }]));
    expect(document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length).toBe(0);
    expect(toastSpy.success).toHaveBeenCalledWith(expect.stringMatching(/Đã chạy phân bổ → #5/));
    expect(within(taskRow("WO-7788-SMT")).getByRole("button", { name: "Phân bổ" })).toBeDisabled();
    expect(within(taskRow("LINE-B-DONE")).getByRole("button", { name: "Phân bổ" })).toBeDisabled();
    expect(within(taskRow("LINE-B-DONE")).getByRole("button", { name: "Gán lại" })).toBeDisabled();
    expect(within(taskRow("LINE-B-DONE")).getByRole("button", { name: "Hủy" })).toBeDisabled();
  });

  it("Huỷ = AlertDialog như cũ (khoá tác vụ); xác nhận ⇒ MỘT lượt {taskId}; Huỷ bỏ ⇒ không gọi", async () => {
    const user = userEvent.setup();
    render(<FleetOrchestration />);
    await user.click(within(taskRow("DEMO-TASK-PICK-1")).getByRole("button", { name: "Hủy" }));
    let dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText("DEMO-TASK-PICK-1")).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: /^Hủy$|^Huỷ$/ }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls("cancelTask")).toEqual([]);
    await user.click(within(taskRow("DEMO-TASK-PICK-1")).getByRole("button", { name: "Hủy" }));
    dlg = await screen.findByRole("alertdialog");
    await user.click(within(dlg).getByRole("button", { name: "Hủy tác vụ" }));
    await waitFor(() => expect(calls("cancelTask")).toEqual([{ taskId: 3 }]));
    expect(srv.invalidated).toContain("fleet.listTasks");
  });

  it("Gán lại = sheet fleet-task-assign&flyoutId: điền sẵn thiết bị; mã sai ⇒ toast, không gọi; lưu ⇒ {taskId, deviceId}, đóng, URL sạch, danh sách cập nhật", async () => {
    const user = userEvent.setup();
    render(<FleetOrchestration />);
    await user.click(within(taskRow("WO-7788-SMT")).getByRole("button", { name: "Gán lại" }));
    const l = await waitLayer("fleet-task-assign");
    expect(params().get("flyout")).toBe("fleet-task-assign");
    expect(params().get("flyoutId")).toBe("5");
    const input = within(l).getByLabelText("Mã thiết bị (robot)") as HTMLInputElement;
    expect(input.value).toBe("2");
    await user.clear(input);
    await user.type(input, "0");
    await user.click(within(l).getByRole("button", { name: /Gán$/ }));
    expect(toastSpy.error).toHaveBeenCalledWith("Nhập mã thiết bị hợp lệ.");
    expect(calls("assign")).toEqual([]);
    await user.clear(input);
    await user.type(input, "8");
    await user.click(within(l).getByRole("button", { name: /Gán$/ }));
    await waitFor(() => expect(calls("assign")).toEqual([{ taskId: 5, deviceId: 8 }]));
    await waitFor(() => expect(layer("fleet-task-assign")).toBeNull());
    expect(params().has("flyout")).toBe(false);
    expect(srv.invalidated).toContain("fleet.listTasks");
    expect(within(taskRow("WO-7788-SMT")).getByText("#8")).toBeInTheDocument();
  });

  it("không có quyền điều khiển: 'Chỉ xem' thay nút; deep link sheet ghi không mở (không đăng ký)", () => {
    perm.control = false;
    window.history.replaceState(null, "", "/labs/fleet-orchestration?flyout=fleet-task-assign&flyoutId=3");
    render(<FleetOrchestration />);
    expect(within(taskRow("DEMO-TASK-PICK-1")).getByText("Chỉ xem")).toBeInTheDocument();
    expect(within(taskRow("DEMO-TASK-PICK-1")).queryByRole("button", { name: "Phân bổ" })).toBeNull();
    expect(layer("fleet-task-assign")).toBeNull();
  });
});

describe("Fleet — Vùng (G1): đặt trước = sheet, giải phóng một cú bấm, chặn chéo nhà máy", () => {
  it("Đặt trước ⇒ sheet fleet-zone-reserve; lưu ⇒ {zoneId, deviceId, queueIfFull:true}; đóng; đặt chỗ mới hiện ở thẻ vùng", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/labs/fleet-orchestration?tab=zones");
    render(<FleetOrchestration />);
    await user.click(within(zoneCard(2)).getByRole("button", { name: /Đặt trước$/ }));
    const l = await waitLayer("fleet-zone-reserve");
    expect(params().get("flyoutId")).toBe("2");
    await user.type(within(l).getByLabelText("Mã thiết bị (robot)"), "9");
    await user.click(within(l).getByRole("button", { name: /Đặt trước$/ }));
    await waitFor(() => expect(calls("reserve")).toEqual([{ zoneId: 2, deviceId: 9, queueIfFull: true }]));
    await waitFor(() => expect(layer("fleet-zone-reserve")).toBeNull());
    expect(params().get("tab")).toBe("zones");
    expect(params().has("flyout")).toBe(false);
    expect(srv.invalidated).toContain("fleet.listReservations");
    expect(within(zoneCard(2)).getByText("#9")).toBeInTheDocument();
  });

  it("server TỪ CHỐI đặt chỗ ⇒ toast lỗi, sheet GIỮ MỞ (như dialog cũ)", async () => {
    const user = userEvent.setup();
    srv.result["fleet.reserve"] = { ok: false, status: "rejected", message: "full" };
    window.history.replaceState(null, "", "/labs/fleet-orchestration?tab=zones&flyout=fleet-zone-reserve&flyoutId=1");
    render(<FleetOrchestration />);
    const l = await waitLayer("fleet-zone-reserve");
    await user.click(within(l).getByRole("checkbox"));
    await user.type(within(l).getByLabelText("Mã thiết bị (robot)"), "9");
    await user.click(within(l).getByRole("button", { name: /Đặt trước$/ }));
    await waitFor(() => expect(calls("reserve")).toEqual([{ zoneId: 1, deviceId: 9, queueIfFull: false }]));
    expect(toastSpy.error).toHaveBeenCalledWith(expect.stringMatching(/Đặt chỗ bị từ chối — full/));
    expect(layer("fleet-zone-reserve")).toBeTruthy();
  });

  it("CHẶN CHÉO NHÀ MÁY (Đợt 0 Task 6): server FORBIDDEN SCOPE_MISMATCH ⇒ toast lỗi đã dịch, sheet giữ mở, danh sách không đổi", async () => {
    const user = userEvent.setup();
    const err = Object.assign(new Error("Zone 2 is outside your factory scope"), {
      data: { code: "FORBIDDEN", appCode: "SCOPE_MISMATCH", appParams: { entity: "zone", parent: "factory" } },
      shape: { data: { code: "FORBIDDEN", appCode: "SCOPE_MISMATCH", appParams: { entity: "zone", parent: "factory" } } },
    });
    srv.fail["fleet.reserve"] = err;
    window.history.replaceState(null, "", "/labs/fleet-orchestration?tab=zones&flyout=fleet-zone-reserve&flyoutId=2");
    render(<FleetOrchestration />);
    const l = await waitLayer("fleet-zone-reserve");
    await user.type(within(l).getByLabelText("Mã thiết bị (robot)"), "9");
    await user.click(within(l).getByRole("button", { name: /Đặt trước$/ }));
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalledTimes(1));
    expect(toastSpy.error).toHaveBeenCalledWith(mapTrpcError(err as never));
    expect(toastSpy.info).not.toHaveBeenCalled();
    expect(layer("fleet-zone-reserve")).toBeTruthy();
    expect(srv.invalidated).not.toContain("fleet.listReservations");
    expect(within(zoneCard(2)).queryByText("#9")).toBeNull();
  });

  it("Giải phóng = MỘT cú bấm, MỘT lượt {deviceId, zoneId}, không dialog", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/labs/fleet-orchestration?tab=zones");
    render(<FleetOrchestration />);
    await user.click(within(zoneCard(1)).getByRole("button", { name: "Giải phóng" }));
    await waitFor(() => expect(calls("release")).toEqual([{ deviceId: 7, zoneId: 1 }]));
    expect(document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length).toBe(0);
  });

  it("cờ G1 CHƯA RÕ ⇒ Đặt trước khoá + lý do; deep link sheet chỉ báo trạng thái (không form)", async () => {
    srv.status = undefined;
    window.history.replaceState(null, "", "/labs/fleet-orchestration?tab=zones&flyout=fleet-zone-reserve&flyoutId=1");
    render(<FleetOrchestration />);
    const l = await waitLayer("fleet-zone-reserve");
    expect(within(l).getByText("Đang kiểm tra trạng thái tính năng…")).toBeInTheDocument();
    expect(within(l).queryByLabelText("Mã thiết bị (robot)")).toBeNull();
    // trang phía sau sheet (modal) bị aria-hidden ⇒ hidden:true
    expect(within(zoneCard(1)).getByRole("button", { name: /Đặt trước$/, hidden: true })).toBeDisabled();
  });

  it("sheet đã nhập rồi Esc ⇒ hỏi 'Bỏ thay đổi chưa lưu?'", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/labs/fleet-orchestration?tab=zones&flyout=fleet-zone-reserve&flyoutId=1");
    render(<FleetOrchestration />);
    const l = await waitLayer("fleet-zone-reserve");
    await user.type(within(l).getByLabelText("Mã thiết bị (robot)"), "4");
    await user.keyboard("{Escape}");
    expect(await screen.findByText("Bỏ thay đổi chưa lưu?")).toBeInTheDocument();
  });
});

describe("Fleet — bế tắc: chip GHIM + khối ngoài MAIN; xử lý một cú bấm như cũ", () => {
  it("có chu trình ⇒ chip Bế tắc tông lỗi; khối role=alert ở panel phụ (mọi tab); 'Xử lý bế tắc' MỘT lượt, không dialog; bấm chip ⇒ focus khối", async () => {
    const user = userEvent.setup();
    srv.cycles = [[1, 2, 3]];
    window.history.replaceState(null, "", "/labs/fleet-orchestration?tab=charging");
    render(<FleetOrchestration />);
    expect(chip("fleet-deadlocks")!.textContent).toMatch(/Bế tắc\s*1/);
    const block = side().querySelector("[data-fleet-deadlocks]") as HTMLElement;
    expect(block).toHaveAttribute("role", "alert");
    expect(mainEl().contains(block)).toBe(false);
    expect(block.textContent).toMatch(/1 → 2 → 3 → 1/);
    await user.click(chip("fleet-deadlocks")!);
    expect(document.activeElement).toBe(block);
    await user.click(within(block).getByRole("button", { name: /Xử lý bế tắc/ }));
    await waitFor(() => expect(calls("resolveDeadlock")).toEqual([undefined]));
    expect(document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length).toBe(0);
  });

  it("cờ G1 LỖI ⇒ 'Xử lý bế tắc' khoá (như cũ)", () => {
    srv.cycles = [[1, 2]];
    srv.statusError = true;
    render(<FleetOrchestration />);
    expect(within(side().querySelector("[data-fleet-deadlocks]") as HTMLElement).getByRole("button", { name: /Xử lý bế tắc/ })).toBeDisabled();
  });
});

describe("Fleet — sổ đăng ký thao tác (sheet, tab Operations cũ)", () => {
  it("'Sổ đăng ký thao tác' ⇒ ?flyout=fleet-operations; 'Thao tác mới' xếp lớp: bắt buộc mã+năng lực; lưu ⇒ payload cũ, lớp tạo đóng, sổ cập nhật, URL về sổ", async () => {
    const user = userEvent.setup();
    render(<FleetOrchestration />);
    await user.click(within(header()).getByRole("button", { name: "Sổ đăng ký thao tác" }));
    const reg = await waitLayer("fleet-operations");
    expect(params().getAll("flyout")).toEqual(["fleet-operations"]);
    expect(within(reg).getByText("OP-WELD-01")).toBeInTheDocument();
    await user.click(within(reg).getByRole("button", { name: "Thao tác mới" }));
    const cr = await waitLayer("fleet-operation-new");
    expect(params().getAll("flyout")).toEqual(["fleet-operations", "fleet-operation-new"]);
    await user.type(within(cr).getByLabelText("Mã thao tác"), "OP-PICK-02");
    await user.click(within(cr).getByRole("button", { name: /Thao tác mới$/ }));
    expect(toastSpy.error).toHaveBeenCalledWith("Mã và năng lực yêu cầu là bắt buộc.");
    expect(calls("createOperation")).toEqual([]);
    await user.type(within(cr).getByLabelText("Năng lực yêu cầu"), " pick ");
    await user.type(within(cr).getByLabelText("Chu kỳ dự kiến (ms)"), "1200");
    await user.click(within(cr).getByRole("button", { name: /Thao tác mới$/ }));
    await waitFor(() =>
      expect(calls("createOperation")).toEqual([{ code: "OP-PICK-02", requiredCapability: "pick", description: undefined, toolType: undefined, estimatedCycleMs: 1200 }]),
    );
    await waitFor(() => expect(layer("fleet-operation-new")).toBeNull());
    expect(params().getAll("flyout")).toEqual(["fleet-operations"]);
    expect(srv.invalidated).toContain("fleet.listOperations");
    expect(within(layer("fleet-operations")!).getByText("OP-PICK-02")).toBeInTheDocument();
  });

  it("Ánh xạ chương trình (xếp lớp, flyoutId = id thao tác) ⇒ {operationCodeId, programProjectId, deviceKind}; Phân giải ⇒ {code} + chương trình đủ điều kiện", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/labs/fleet-orchestration?flyout=fleet-operations");
    render(<FleetOrchestration />);
    const reg = await waitLayer("fleet-operations");
    await user.click(within(reg.querySelector('[data-op-id="21"]') as HTMLElement).getByRole("button", { name: "Phân giải" }));
    expect(srv.queryInputs).toContain('fleet.resolveOperation:{"code":"OP-WELD-01"}');
    expect(await within(reg).findByText(/PRJ-WELD · arm/)).toBeInTheDocument();
    await user.click(within(reg).getByRole("button", { name: "Ánh xạ chương trình" }));
    const mp = await waitLayer("fleet-operation-map");
    expect(params().getAll("flyoutId").filter(Boolean)).toContain("21");
    await user.type(within(mp).getByLabelText("Mã dự án chương trình"), "4");
    await user.type(within(mp).getByLabelText("Loại thiết bị (tùy chọn)"), " arm ");
    await user.click(within(mp).getByRole("button", { name: /Ánh xạ chương trình$/ }));
    await waitFor(() => expect(calls("mapOperationProgram")).toEqual([{ operationCodeId: 21, programProjectId: 4, deviceKind: "arm" }]));
    await waitFor(() => expect(layer("fleet-operation-map")).toBeNull());
    expect(layer("fleet-operations")).toBeTruthy();
  });

  it("deep link ánh xạ chương trình khi cờ G2 CHƯA RÕ ⇒ sheet chỉ báo trạng thái, không form", async () => {
    srv.resStatus = undefined;
    window.history.replaceState(null, "", "/labs/fleet-orchestration?flyout=fleet-operation-map&flyoutId=21");
    render(<FleetOrchestration />);
    const l = await waitLayer("fleet-operation-map");
    expect(within(l).getByText("Đang kiểm tra trạng thái tính năng…")).toBeInTheDocument();
    expect(within(l).queryByLabelText("Mã dự án chương trình")).toBeNull();
  });

  it("cờ G2 ĐANG TẢI ⇒ sổ hiện cổng G2 (đang kiểm tra), 'Thao tác mới' khoá, không có 'Ánh xạ chương trình'", async () => {
    srv.resStatus = undefined;
    window.history.replaceState(null, "", "/labs/fleet-orchestration?flyout=fleet-operations");
    render(<FleetOrchestration />);
    const reg = await waitLayer("fleet-operations");
    expect(within(reg).getByTestId("feature-status-loading")).toBeInTheDocument();
    expect(within(reg).getByRole("button", { name: "Thao tác mới" })).toBeDisabled();
    expect(within(reg).queryByRole("button", { name: "Ánh xạ chương trình" })).toBeNull();
  });
});

describe("Fleet — Tài nguyên + Sạc (G2): sheet sổ đăng ký, một cú bấm như cũ", () => {
  it("Tài nguyên mới ⇒ sheet: bắt buộc mã; lưu ⇒ payload cũ; đóng; thẻ mới trong danh sách", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/labs/fleet-orchestration?tab=resources");
    render(<FleetOrchestration />);
    await user.click(within(side()).getByRole("button", { name: "Tài nguyên mới" }));
    const l = await waitLayer("fleet-resource-new");
    await user.click(within(l).getByRole("button", { name: /Tài nguyên mới$/ }));
    expect(toastSpy.error).toHaveBeenCalledWith("Mã tài nguyên là bắt buộc.");
    await user.type(within(l).getByLabelText("Mã"), "GRIP-02");
    await user.type(within(l).getByLabelText("Mã vùng gốc (tùy chọn)"), "3");
    await user.click(within(l).getByRole("button", { name: /Tài nguyên mới$/ }));
    await waitFor(() => expect(calls("createResource")).toEqual([{ code: "GRIP-02", name: undefined, type: "other", locationZoneId: 3 }]));
    await waitFor(() => expect(layer("fleet-resource-new")).toBeNull());
    expect(params().get("tab")).toBe("resources");
    expect(srv.invalidated).toContain("fleet.listResources");
    expect(side().querySelector('[data-resource-card="88"]')).toBeTruthy();
  });

  it("Đặt trước tài nguyên ⇒ sheet (flyoutId) ⇒ {resourceId, deviceId, queueIfFull}; Giải phóng MỘT lượt {deviceId, resourceId}", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/labs/fleet-orchestration?tab=resources");
    render(<FleetOrchestration />);
    const card = side().querySelector('[data-resource-card="31"]') as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Giải phóng" }));
    await waitFor(() => expect(calls("releaseResource")).toEqual([{ deviceId: 7, resourceId: 31 }]));
    await user.click(within(card).getByRole("button", { name: /Đặt trước$/ }));
    const l = await waitLayer("fleet-resource-reserve");
    expect(params().get("flyoutId")).toBe("31");
    await user.type(within(l).getByLabelText("Mã thiết bị (robot)"), "8");
    await user.click(within(l).getByRole("button", { name: /Đặt trước$/ }));
    await waitFor(() => expect(calls("reserveResource")).toEqual([{ resourceId: 31, deviceId: 8, queueIfFull: true }]));
    await waitFor(() => expect(layer("fleet-resource-reserve")).toBeNull());
  });

  it("server TỪ CHỐI chiếm tài nguyên ⇒ toast lỗi, sheet GIỮ MỞ (như dialog cũ)", async () => {
    const user = userEvent.setup();
    srv.result["fleet.reserveResource"] = { ok: false, status: "rejected", message: "busy" };
    window.history.replaceState(null, "", "/labs/fleet-orchestration?tab=resources&flyout=fleet-resource-reserve&flyoutId=31");
    render(<FleetOrchestration />);
    const l = await waitLayer("fleet-resource-reserve");
    await user.type(within(l).getByLabelText("Mã thiết bị (robot)"), "8");
    await user.click(within(l).getByRole("button", { name: /Đặt trước$/ }));
    await waitFor(() => expect(calls("reserveResource")).toEqual([{ resourceId: 31, deviceId: 8, queueIfFull: true }]));
    expect(toastSpy.error).toHaveBeenCalledWith(expect.stringMatching(/Yêu cầu chiếm tài nguyên bị từ chối — busy/));
    expect(layer("fleet-resource-reserve")).toBeTruthy();
  });

  it("Trạm sạc mới ⇒ sheet ⇒ payload cũ (mặc định contact); thẻ mới; 'Quét ngay' MỘT lượt, không dialog", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/labs/fleet-orchestration?tab=charging");
    render(<FleetOrchestration />);
    await user.click(within(side()).getByRole("button", { name: "Quét ngay" }));
    await waitFor(() => expect(calls("sweepCharging")).toEqual([undefined]));
    expect(document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length).toBe(0);
    await user.click(within(side()).getByRole("button", { name: "Trạm sạc mới" }));
    const l = await waitLayer("fleet-charger-new");
    await user.type(within(l).getByLabelText("Mã"), "CHG-02");
    await user.type(within(l).getByLabelText("Công suất (W)"), "1500");
    await user.click(within(l).getByRole("button", { name: /Trạm sạc mới$/ }));
    await waitFor(() =>
      expect(calls("createCharger")).toEqual([{ code: "CHG-02", name: undefined, chargerType: "contact", powerWatts: 1500, locationZoneId: undefined }]),
    );
    await waitFor(() => expect(layer("fleet-charger-new")).toBeNull());
    expect(srv.invalidated).toContain("fleet.listChargers");
    expect(side().querySelector('[data-charger-card="99"]')).toBeTruthy();
  });

  it("cờ G2 LỖI ⇒ deep link sheet tạo tài nguyên chỉ báo lỗi (role=alert), không form; nút khoá", async () => {
    srv.resStatusError = true;
    window.history.replaceState(null, "", "/labs/fleet-orchestration?tab=resources&flyout=fleet-resource-new");
    render(<FleetOrchestration />);
    const l = await waitLayer("fleet-resource-new");
    expect(within(l).getByRole("alert")).toHaveTextContent(/Không kiểm tra được trạng thái lớp tài nguyên/);
    expect(within(l).queryByLabelText("Mã")).toBeNull();
    expect(within(side()).getByRole("button", { name: "Tài nguyên mới", hidden: true })).toBeDisabled();
  });

  it("cờ TẮT ở server ⇒ FEATURE_DISABLED hiện toast.info bình tĩnh (không đỏ), như cũ", async () => {
    const user = userEvent.setup();
    srv.fail["fleet.sweepCharging"] = Object.assign(new Error("Fleet resource layer is disabled"), {
      data: { code: "CONFLICT", appCode: "FEATURE_DISABLED", appParams: { feature: "fleetResourceLayer" } },
    });
    window.history.replaceState(null, "", "/labs/fleet-orchestration?tab=charging");
    render(<FleetOrchestration />);
    await user.click(within(side()).getByRole("button", { name: "Quét ngay" }));
    await waitFor(() => expect(toastSpy.info).toHaveBeenCalledTimes(1));
    expect(toastSpy.error).not.toHaveBeenCalled();
    expect(srv.invalidated).toContain("fleet.resourceStatus");
  });
});

// Đảm bảo không có tác động hàng loạt: mỗi nút ghi gọi ĐÚNG một thủ tục với ĐÚNG một mục tiêu.
describe("Fleet — R-2-n: không có thao tác hàng loạt", () => {
  it("không có ô chọn nhiều hàng / nút 'tất cả' trong panel tác vụ, vùng, tài nguyên", async () => {
    const user = userEvent.setup();
    render(<FleetOrchestration />);
    for (const tab of [/^Tác vụ$/, /^Vùng$/, /^Tài nguyên$/, /^Sạc$/]) {
      await user.click(sideTab(tab));
      expect(side().querySelectorAll('input[type="checkbox"], [role="checkbox"]').length).toBe(0);
    }
    act(() => undefined);
    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    expect(Object.keys(srv.calls)).toEqual([]);
  });
});

// doc 81 Đợt 5 H3(b) (mục 19) — bộ chọn nhà máy của bản đồ lấy từ danh sách nhà máy TRONG PHẠM VI người gọi
// (`factory.list`, server lọc theo phạm vi), không chỉ từ `zones[].factoryId`: site chưa có vùng nào mang factoryId vẫn
// nạp được lưới. Vùng đọc được (server đã lọc phạm vi) vẫn góp nhà máy của nó; danh sách lỗi/đang tải ⇒ như cũ (từ vùng).
describe("Fleet — H3(b): bộ chọn nhà máy từ danh sách nhà máy trong phạm vi", () => {
  it("KHÔNG vùng nào mang factoryId + factory.list [#4 Bắc, #9 Nam] ⇒ lưới nạp nhà máy #4; bộ chọn liệt kê tên; chọn Nam ⇒ occupancyGrid {factoryId:9}", async () => {
    srv.db.zones = srv.db.zones.map((z) => ({ ...z, factoryId: null }));
    srv.snap.zones = clone(srv.db.zones);
    srv.factories = [{ id: 4, code: "F-N", name: "Nhà máy Bắc" }, { id: 9, code: "F-S", name: "Nhà máy Nam" }];
    const user = userEvent.setup();
    render(<FleetOrchestration />);
    expect(srv.queryInputs).toContain('twin.occupancyGrid:{"factoryId":4}');
    expect(srv.queryInputs.filter((x) => x.startsWith("twin.occupancyGrid:")).every((x) => x.endsWith('{"factoryId":4}'))).toBe(true);
    await user.click(within(mainEl()).getByRole("combobox", { name: "Nhà máy" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Nhà máy Bắc", "Nhà máy Nam"]);
    await user.click(screen.getByRole("option", { name: "Nhà máy Nam" }));
    expect(srv.queryInputs).toContain('twin.occupancyGrid:{"factoryId":9}');
  });

  it("vùng của #1/#3 + factory.list [#3] ⇒ mặc định VẪN nhà máy của vùng (#1); bộ chọn = hợp (#3 theo tên, #1 thêm từ vùng)", async () => {
    srv.factories = [{ id: 3, code: "F3", name: "Xưởng Ba" }];
    const user = userEvent.setup();
    render(<FleetOrchestration />);
    expect(srv.queryInputs.filter((x) => x.startsWith("twin.occupancyGrid:"))[0]).toBe('twin.occupancyGrid:{"factoryId":1}');
    await user.click(within(mainEl()).getByRole("combobox", { name: "Nhà máy" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Xưởng Ba", "#1"]);
  });

  it("phạm vi RỖNG (factory.list = []) + không vùng ⇒ KHÔNG hỏi lưới (không dò nhà máy ngoài phạm vi)", async () => {
    srv.db.zones = [];
    srv.snap.zones = [];
    srv.factories = [];
    render(<FleetOrchestration />);
    await new Promise((r) => setTimeout(r, 20));
    expect(srv.queryInputs.filter((x) => x.startsWith("twin.occupancyGrid:"))).toEqual([]);
  });

  it("factory.list LỖI ⇒ như cũ: nhà máy từ vùng (#1, #3)", async () => {
    srv.factoriesError = true;
    const user = userEvent.setup();
    render(<FleetOrchestration />);
    expect(srv.queryInputs).toContain('twin.occupancyGrid:{"factoryId":1}');
    await user.click(within(mainEl()).getByRole("combobox", { name: "Nhà máy" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["#1", "#3"]);
  });
});
