// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 8 — Safety & Workforce thành mẫu P4 Cockpit.
// Hợp đồng (task-8-brief + page-task-dispatch + plan Review Focus 1/3/4 + GC3 + R-2-n):
//   - Header một hàng: h1 + chip "Tư vấn — không phải SIS" (thay khối 88 px; popover giữ NGUYÊN câu cũ + câu chân
//     trang trùng đã bỏ) + chip NGUỒN AN TOÀN có chữ trạng thái (mọi trạng thái không-OK hiện SẴN, có màu, không
//     nằm trong "+N") + chip cờ 4 trạng thái (gọi tên cờ) + "Khi nào dùng" + dải `StatusChipStrip` (thay 4 MetricCard).
//   - MAIN (`data-layout-main`, CockpitLayout) = hàng tab `?tab=` (cockpit | workforce) + nội dung. Tab đầu = luồng
//     sự kiện + bảng tin trực tiếp (chip trong hàng công cụ). Bảng nhân lực ở lại (chưa có trang Sản xuất › Ca).
//   - Panel phụ (aside): panel NGUỒN AN TOÀN đầy đủ (luôn thấy) + tab Xu hướng / Phối hợp. Tab Phối hợp KHÔNG BAO
//     GIỜ unmount (Review Focus 3): đổi tab phụ, đổi tab MAIN, qua lại 1024 px.
//   - Dialog tạo/sửa → sheet (FlyoutHost `?flyout=`): báo cáo tiệm cận, phân công, phân công lại, bắt đầu phối hợp.
//     Form, kiểm tra, payload giữ nguyên. Kiểm định / đóng phân công / huỷ phối hợp giữ AlertDialog (R-2-n).
// Chạy trên wouter THẬT với history jsdom. "Server" giả là kho trong bộ nhớ: truy vấn CHỈ đổi khi trang gọi
// invalidate đúng thủ tục (như react-query).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import vi_ from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { installMatchMedia, presetNarrow, setNarrow } from "@/components/patterns/layoutKitTestMedia";

const VI = vi_ as unknown as {
  safety: Record<string, unknown> & { source: Record<string, unknown> & { chip: Record<string, string> }; chip: Record<string, string>; flag: Record<string, string>; tab: Record<string, string>; side: Record<string, string> };
  workforce: Record<string, unknown>;
  layoutKit: { chip: Record<string, string>; notice: { kind: Record<string, string> } };
  common: Record<string, unknown>;
};
const S = (k: string): string => {
  const v = k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], VI);
  if (typeof v !== "string") throw new Error(`thiếu khoá vi: ${k}`);
  return v;
};

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
const sock = vi.hoisted(() => ({ handlers: {} as Record<string, (e: unknown) => void>, emitted: [] as unknown[] }));
vi.mock("@/lib/socketManager", () => ({
  getSharedSocket: () => ({
    on: (ev: string, fn: (e: unknown) => void) => { sock.handlers[ev] = fn; },
    off: (ev: string) => { delete sock.handlers[ev]; },
    emit: (...a: unknown[]) => { sock.emitted.push(a); },
    connected: true,
  }),
  releaseSharedSocket: () => undefined,
}));

// ── "Server" giả ───────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const srv = vi.hoisted(() => ({
  status: { safetyAudit: true, workforce: true } as Row | undefined,
  statusError: false,
  health: undefined as Row | undefined,
  healthError: false,
  feed: [] as Row[],
  feedLoading: false,
  feedError: false,
  trend: [] as Row[],
  board: [] as Row[],
  assignments: [] as Row[],
  collabs: [] as Row[],
  snap: { feed: [] as Row[], trend: [] as Row[], board: [] as Row[], assignments: [] as Row[], collabs: [] as Row[] },
  version: 0,
  listeners: new Set<() => void>(),
  calls: {} as Record<string, unknown[]>,
  invalidated: [] as string[],
  queryInputs: [] as string[],
  queryOpts: {} as Record<string, unknown>,
  mutationError: null as null | Error,
  // Mutation giữ lại (đang chạy) cho tới khi test thả ra.
  hold: new Set<string>(),
  release: {} as Record<string, () => void>,
  // Đếm instance panel Phối hợp (hook advancePhase.useMutation CHỈ panel gọi).
  collab: { mounts: 0, unmounts: 0 },
}));
function bump() {
  srv.version++;
  for (const l of srv.listeners) l();
}
const NEXT_PHASE: Record<string, string> = { human_prep: "robot_work", robot_work: "human_verify", human_verify: "done", done: "done" };

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
  const runOp = (path: string, input: Row): Promise<unknown> => {
    const gate = srv.hold.has(path) ? new Promise<void>((res) => { srv.release[path] = res; }) : Promise.resolve();
    return gate.then(() => {
      (srv.calls[path] ??= []).push(input);
      if (srv.mutationError) throw srv.mutationError;
      if (path === "safety.ingestProximity") return { triggered: false };
      if (path === "safety.auditEvent") Object.assign(srv.feed.find((e) => e.id === input.eventId)!, { auditedAt: "2026-10-03T03:00:00Z" });
      if (path === "safety.assignOperator") srv.assignments.unshift(assignment(90, "planned", { operatorId: input.operatorId }));
      if (path === "safety.reassignOperator") Object.assign(srv.assignments.find((a) => a.id === input.assignmentId)!, { operatorId: input.operatorId });
      if (path === "safety.confirmAssignment") Object.assign(srv.assignments.find((a) => a.id === input.assignmentId)!, { status: "active" });
      if (path === "safety.closeAssignment") Object.assign(srv.assignments.find((a) => a.id === input.assignmentId)!, { status: "completed" });
      if (path === "safety.startCollaboration") srv.collabs.unshift(collab(95, "human_prep", { operationCode: input.operationCode ?? null }));
      if (path === "safety.signalHandshake") Object.assign(srv.collabs.find((c) => c.id === input.sessionId)!, { handshakeState: input.state });
      if (path === "safety.advancePhase") {
        const c = srv.collabs.find((x) => x.id === input.sessionId)!;
        c.phase = NEXT_PHASE[String(c.phase)];
      }
      if (path === "safety.abortCollaboration") Object.assign(srv.collabs.find((c) => c.id === input.sessionId)!, { endedAt: "2026-10-03T04:00:00Z" });
      return { ok: true };
    });
  };
  const hooks = (path: string) => ({
    useQuery: (input?: Row, opts?: { enabled?: boolean }) => {
      useVersion();
      const enabled = opts?.enabled !== false;
      if (enabled) srv.queryInputs.push(`${path}:${JSON.stringify(input ?? null)}`);
      srv.queryOpts[path] = opts;
      if (path === "safety.status")
        return srv.statusError ? q(undefined, enabled, { isError: true }) : srv.status === undefined ? q(undefined, enabled, { isLoading: true, isPending: true }) : q(srv.status, enabled);
      if (path === "safety.sourceHealth")
        return srv.healthError ? q(undefined, enabled, { isError: true }) : srv.health === undefined ? q(undefined, enabled, { isLoading: true, isPending: true }) : q(srv.health, enabled);
      if (path === "safety.feed") {
        if (srv.feedError) return q(undefined, enabled, { isError: true });
        if (srv.feedLoading) return q(undefined, enabled, { isLoading: true, isPending: true });
        return q(srv.snap.feed.filter((e) => !input?.eventType || e.eventType === input.eventType), enabled);
      }
      if (path === "safety.nearMissTrend") return q(srv.snap.trend, enabled);
      if (path === "safety.currentBoard") return q(srv.snap.board, enabled);
      if (path === "safety.listAssignments") return q(srv.snap.assignments.filter((a) => !input?.status || a.status === input.status), enabled);
      if (path === "safety.listCollaborations") return q(srv.snap.collabs, enabled);
      return q(undefined, enabled);
    },
    useMutation: (hookOpts: { onSuccess?: (r: unknown, vars: Row) => void; onError?: (e: unknown, vars: Row) => void } = {}) => {
      // Trạng thái "đang chạy" là của RIÊNG instance hook (như react-query): remount ⇒ mất.
      const [pending, setPending] = React.useState(false);
      const alive = React.useRef(true);
      React.useEffect(() => {
        alive.current = true;
        if (path === "safety.advancePhase") srv.collab.mounts++;
        return () => {
          alive.current = false;
          if (path === "safety.advancePhase") srv.collab.unmounts++;
        };
      }, []);
      const run = (input: Row, callOpts?: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
        setPending(true);
        return runOp(path, input).then(
          (r) => {
            if (alive.current) setPending(false);
            hookOpts.onSuccess?.(r, input);
            callOpts?.onSuccess?.(r);
            return r;
          },
          (e) => {
            if (alive.current) setPending(false);
            hookOpts.onError?.(e, input);
            callOpts?.onError?.(e);
            throw e;
          },
        );
      };
      return { isPending: pending, mutate: (input: Row, o?: Row) => void run(input, o as never).catch(() => undefined), mutateAsync: (input: Row) => run(input) };
    },
  });
  const refresh = (key: string) => {
    if (key === "safety.feed") srv.snap.feed = srv.feed.map((x) => ({ ...x }));
    if (key === "safety.nearMissTrend") srv.snap.trend = srv.trend.map((x) => ({ ...x }));
    if (key === "safety.currentBoard") srv.snap.board = srv.board.map((x) => ({ ...x }));
    if (key === "safety.listAssignments") srv.snap.assignments = srv.assignments.map((x) => ({ ...x }));
    if (key === "safety.listCollaborations") srv.snap.collabs = srv.collabs.map((x) => ({ ...x }));
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

function assignment(id: number, status: string, o: Row = {}): Row {
  return {
    id, operatorId: 40 + id, lineId: 1, stationId: 2, shiftConfigId: null, skillLevel: "qualified", role: "human",
    status, assignedStart: "2026-10-03T00:00:00.000Z", assignedEnd: "2026-10-03T08:00:00.000Z",
    confirmedBy: null, confirmedAt: null, closedBy: null, notes: null, scope: null, corporateCode: null, factoryId: 1,
    createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z", ...o,
  };
}
function collab(id: number, phase: string, o: Row = {}): Row {
  return {
    id, phase, handshakeState: "pending", operationCode: "OP-WELD-01", humanOperatorId: 11, robotDeviceId: 2, taskId: null,
    startedAt: "2026-10-03T00:00:00.000Z", endedAt: null, updatedAt: "2026-10-03T00:00:00.000Z", ...o,
  };
}
function event(id: number, o: Row = {}): Row {
  return {
    id, eventType: "estop", robotId: 2, lineId: 1, stationId: 3, detectedBy: "plc", outcome: "stopped", isNearMiss: false,
    responseTimeMs: 120, createdAt: "2026-10-03T01:00:00.000Z", auditedAt: null, ...o,
  };
}
function health(over: Row = {}): Row {
  return {
    checkedAt: "2026-10-03T00:00:00.000Z",
    safetyPlc: {
      adapterEnabled: true, enabledConfigs: 1, simConfigs: 1, simScriptedConfigs: 0, realConfigs: 0, realUnmappedConfigs: 0, basis: "sim",
      configs: [{ code: "SIM-SAFETY-PLC-1", backend: "sim", effective: "sim_empty", provenance: "SIM" }], hiddenConfigs: 0,
    },
    preflight: {
      expectedReading: "SIM",
      ot: { flag: "OT_SAFETY_PREFLIGHT_ENABLED", preflightEnabled: true, controlEnabled: true, realWrites: "blocked", refusalReason: "SAFETY_SIM_ONLY" },
      robot: { flag: "ROBOT_SAFETY_PREFLIGHT_ENABLED", preflightEnabled: true, controlEnabled: false, realWrites: "dry_run", refusalReason: null },
    },
    vision: { enabled: false, calibrations: 0, onnxPersonModelWired: false },
    zoneSw: { enabled: false, zones: 0 },
    estop: { enabled: false, adapter: "null", label: "null (scaffold)", rated: false },
    socket: { serverUp: true },
    ...over,
  };
}
const plc = (basis: string, configs: Row[] = []): Row => ({
  adapterEnabled: basis !== "adapter_off", enabledConfigs: configs.length, simConfigs: 0, simScriptedConfigs: 0, realConfigs: 0, realUnmappedConfigs: 0, basis, configs, hiddenConfigs: 0,
});
const verdict = (realWrites: string, refusalReason: string | null = null, flag = "OT_SAFETY_PREFLIGHT_ENABLED"): Row => ({
  flag, preflightEnabled: realWrites !== "unguarded", controlEnabled: realWrites !== "dry_run", realWrites, refusalReason,
});
const REAL_OK = (): Row =>
  health({
    safetyPlc: plc("real", [{ code: "PLC-L1", backend: "modbus", effective: "real", provenance: null }]),
    preflight: { expectedReading: "REAL", ot: verdict("real_basis"), robot: verdict("real_basis", null, "ROBOT_SAFETY_PREFLIGHT_ENABLED") },
  });

const TODAY = new Date().toISOString().slice(0, 10);

import SafetyWorkforce from "./SafetyWorkforce";

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
  srv.status = { safetyAudit: true, workforce: true };
  srv.statusError = false;
  srv.health = health();
  srv.healthError = false;
  srv.feed = [event(41), event(40, { eventType: "near_miss", isNearMiss: true, outcome: "logged_only", auditedAt: "2026-10-02T00:00:00Z" })];
  srv.feedLoading = false;
  srv.feedError = false;
  srv.trend = [{ day: "2026-09-30", count: 1 }, { day: TODAY, count: 2 }];
  srv.board = [{ stationId: 3, lineId: 1, humans: [{ assignmentId: 4, operatorId: 44, skillLevel: "qualified" }], robots: [{ robotId: 2, code: "R-2", status: "idle", openTaskCount: 1 }] }];
  srv.assignments = [assignment(3, "planned"), assignment(4, "active"), assignment(5, "completed")];
  srv.collabs = [collab(7, "robot_work"), collab(8, "done", { endedAt: "2026-10-02T09:00:00Z" })];
  srv.snap = { feed: [], trend: [], board: [], assignments: [], collabs: [] };
  srv.snap.feed = srv.feed.map((x) => ({ ...x }));
  srv.snap.trend = srv.trend.map((x) => ({ ...x }));
  srv.snap.board = srv.board.map((x) => ({ ...x }));
  srv.snap.assignments = srv.assignments.map((x) => ({ ...x }));
  srv.snap.collabs = srv.collabs.map((x) => ({ ...x }));
  srv.calls = {};
  srv.invalidated = [];
  srv.queryInputs = [];
  srv.queryOpts = {};
  srv.mutationError = null;
  srv.hold.clear();
  srv.release = {};
  srv.collab.mounts = 0;
  srv.collab.unmounts = 0;
  sock.handlers = {};
  sock.emitted = [];
  Object.assign(perm, { view: true, control: true });
  for (const f of Object.values(toastSpy)) f.mockClear();
  localStorage.clear();
  presetNarrow(false);
  window.history.replaceState(null, "", "/safety-workforce");
});
afterEach(() => cleanup());

const mainEl = () => {
  const all = [...document.querySelectorAll("[data-layout-main]")] as HTMLElement[];
  return all.find((e) => !all.some((o) => o !== e && o.contains(e))) as HTMLElement;
};
const header = () => document.querySelector("[data-layout-header]") as HTMLElement;
const aside = () => screen.getByRole("complementary") as HTMLElement;
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
const mainTab = (name: string | RegExp) => within(toolbar()).getByRole("tab", { name });
const sideTab = (name: string | RegExp) => within(aside()).getByRole("tab", { name });
const calls = (p: string) => srv.calls[`safety.${p}`] ?? [];
const sourceChip = () => screen.getByTestId("safety-source-chip");
const collabPanel = () => document.querySelector("[data-collab-panel]") as HTMLElement | null;
const advisoryChip = () => screen.getByRole("button", { name: S("safety.advisoryChip") });
/** Chữ NHÌN THẤY của một phần tử (bỏ mô tả sr-only, vd nguồn của chip KPI). */
const visibleText = (el: HTMLElement) => {
  const c = el.cloneNode(true) as HTMLElement;
  for (const x of c.querySelectorAll(".sr-only")) x.remove();
  return c.textContent ?? "";
};

async function openWorkforce(user: ReturnType<typeof userEvent.setup>) {
  await user.click(mainTab(S("safety.tab.workforce")));
  await waitFor(() => expect(params().get("tab")).toBe("workforce"));
}
async function openCollab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(sideTab(S("safety.tab.collaboration")));
  await waitFor(() => expect(collabPanel()).toBeVisible());
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Safety P4 — bố cục: một MAIN, header một hàng, panel phụ", () => {
  it("MAIN trong <main>, không chứa h1/header/KPI/notice/alert; đúng một thanh công cụ; 0 dialog lúc nạp", () => {
    render(<SafetyWorkforce />);
    const main = mainEl();
    expect(main).toBeTruthy();
    expect(main.closest("main")).toBeTruthy();
    expect(main.querySelector("h1, [data-layout-header], [data-layout-kpi], [data-notice-kind], [role=alert]")).toBeNull();
    expect(main.querySelectorAll("[data-layout-toolbar]").length).toBe(1);
    expect(within(header()).getByRole("heading", { level: 1 })).toHaveTextContent(S("safety.title"));
    expect(within(toolbar()).getAllByRole("tab").map((x) => x.textContent?.trim())).toEqual([S("safety.tab.cockpit"), S("safety.tab.workforce")]);
    // Luồng sự kiện là phần tử làm việc của MAIN.
    expect(within(main).getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // Panel phụ ngoài MAIN, chứa Xu hướng + Phối hợp + panel nguồn an toàn.
    expect(main.contains(aside())).toBe(false);
    expect(within(aside()).getAllByRole("tab").map((x) => x.textContent?.trim())).toEqual([S("safety.side.trend"), S("safety.tab.collaboration")]);
    expect(within(aside()).getByTestId("safety-source-panel")).toBeInTheDocument();
    // Không còn khối chân trang trùng.
    expect(screen.queryByText(S("safety.footerNote"))).toBeNull();
  });

  it("4 MetricCard → 4 chip KPI trong header, số đúng, mỗi chip có nguồn", () => {
    render(<SafetyWorkforce />);
    expect(header().querySelectorAll("[data-layout-kpi]").length).toBe(4);
    expect(mainEl().querySelectorAll("[data-layout-kpi]").length).toBe(0);
    const expectChip = (id: string, label: string, value: string, src: string) => {
      const c = chip(id);
      expect(c, id).toBeTruthy();
      expect(c).toHaveAttribute("data-state", "ok");
      expect(c.textContent).toContain(label);
      expect(c.textContent).toContain(value);
      expect(c.getAttribute("title") ?? "").toContain(src);
    };
    expectChip("open-events", S("safety.chip.openEvents"), "1", S("safety.chip.src.openEvents"));
    expectChip("near-miss-today", S("safety.chip.nearMissToday"), "2", S("safety.chip.src.nearMiss"));
    expectChip("active-assignments", S("safety.chip.activeAssignments"), "1", S("safety.chip.src.assignments"));
    expectChip("active-collabs", S("safety.chip.activeCollabs"), "1", S("safety.chip.src.collabs"));
  });

  it("KPI trung thực: đang tải ⇒ không số; lỗi ⇒ 'Lỗi' không phải 0; cửa sổ 200 sự kiện đầy ⇒ degraded (≥)", () => {
    srv.feedLoading = true;
    const { unmount } = render(<SafetyWorkforce />);
    expect(chip("open-events")).toHaveAttribute("data-state", "loading");
    expect(visibleText(chip("open-events"))).not.toMatch(/\d/);
    unmount();
    srv.feedLoading = false;
    srv.feedError = true;
    const r2 = render(<SafetyWorkforce />);
    expect(chip("open-events")).toHaveAttribute("data-state", "error");
    expect(visibleText(chip("open-events"))).not.toMatch(/\d/);
    r2.unmount();
    srv.feedError = false;
    srv.snap.feed = Array.from({ length: 200 }, (_, i) => event(1000 + i));
    render(<SafetyWorkforce />);
    expect(chip("open-events")).toHaveAttribute("data-state", "degraded");
    expect(chip("open-events").textContent).toContain("200");
  });

  it("chip 'Đang phối hợp' mở tab Phối hợp của panel phụ", async () => {
    const user = userEvent.setup();
    render(<SafetyWorkforce />);
    expect(collabPanel()).not.toBeVisible();
    await user.click(chip("active-collabs"));
    await waitFor(() => expect(collabPanel()).toBeVisible());
  });
});

describe("Safety P4 — chip 'Tư vấn — không phải SIS' thay khối 88 px", () => {
  it("chip luôn hiện ở header, popover ĐÓNG lúc nạp; mở ra đủ NGUYÊN VĂN tiêu đề + câu cũ + câu chân trang", async () => {
    const user = userEvent.setup();
    render(<SafetyWorkforce />);
    const c = advisoryChip();
    expect(header().contains(c)).toBe(true);
    expect(c).toHaveAttribute("data-notice-kind", "honesty");
    expect(screen.queryByText(S("safety.advisoryBanner"))).toBeNull();
    await user.click(c);
    const pop = await screen.findByRole("dialog");
    expect(within(pop).getByText(S("safety.advisoryTitle"))).toBeInTheDocument();
    expect(within(pop).getByText(S("safety.advisoryBanner"))).toBeInTheDocument();
    expect(within(pop).getByText(S("safety.footerNote"))).toBeInTheDocument();
  });

  it("chip vẫn hiện khi mọi truy vấn đang tải / lỗi", () => {
    srv.status = undefined;
    srv.health = undefined;
    srv.feedLoading = true;
    render(<SafetyWorkforce />);
    expect(advisoryChip()).toBeVisible();
    cleanup();
    srv.statusError = true;
    srv.healthError = true;
    render(<SafetyWorkforce />);
    expect(advisoryChip()).toBeVisible();
  });

  it("'Khi nào dùng' giữ khoá riêng safety.whenToUse + phụ đề cũ", async () => {
    const user = userEvent.setup();
    render(<SafetyWorkforce />);
    await user.click(within(header()).getByRole("button", { name: S("layoutKit.notice.kind.whenToUse") }));
    const pop = await screen.findByRole("dialog");
    expect(pop.querySelector('[data-when-to-use="safety.whenToUse"]')).toHaveTextContent(S("safety.whenToUse"));
    expect(within(pop).getByText(S("safety.subtitle"))).toBeInTheDocument();
  });

  it("hai chip cờ gọi tên cờ; 4 trạng thái giữ nguyên (loading / off / error; on ⇒ không chip)", () => {
    srv.status = { safetyAudit: false, workforce: true };
    const { unmount } = render(<SafetyWorkforce />);
    expect(screen.getAllByTestId("feature-status-off").length).toBe(1);
    expect(screen.getByTestId("feature-status-off")).toHaveAccessibleName(`${S("safety.flag.safetyAudit")}: ${S("layoutKit.notice.kind.flagOff")}`);
    unmount();
    srv.statusError = true;
    render(<SafetyWorkforce />);
    const errs = screen.getAllByTestId("feature-status-error");
    expect(errs.map((e) => e.textContent)).toEqual([
      `${S("safety.flag.safetyAudit")}: ${S("layoutKit.notice.kind.error")}`,
      `${S("safety.flag.workforce")}: ${S("layoutKit.notice.kind.error")}`,
    ]);
  });
});

describe("Safety P4 — chip NGUỒN AN TOÀN: trạng thái không-OK luôn thấy, không cần bấm", () => {
  const cases: Array<{ name: string; h: () => Row; words: string[]; state: string }> = [
    { name: "SIM", h: () => health(), words: [S("safety.source.chip.sim")], state: "warning" },
    {
      name: "real_unmapped",
      h: () => health({ safetyPlc: plc("real_unmapped", [{ code: "PLC-L3", backend: "modbus", effective: "real_unmapped", provenance: null }]), preflight: { expectedReading: "UNMAPPED", ot: verdict("blocked", "SAFETY_SIM_ONLY"), robot: verdict("blocked", "SAFETY_SIM_ONLY") } }),
      words: [S("safety.source.chip.realUnmapped")],
      state: "warning",
    },
    { name: "adapter_off", h: () => health({ safetyPlc: plc("adapter_off"), preflight: { expectedReading: "UNKNOWN", ot: verdict("blocked", "SAFETY_UNKNOWN"), robot: verdict("blocked", "SAFETY_UNKNOWN") } }), words: [S("safety.source.chip.adapterOff")], state: "warning" },
    { name: "no_config", h: () => health({ safetyPlc: plc("no_config"), preflight: { expectedReading: "UNKNOWN", ot: verdict("blocked", "SAFETY_UNKNOWN"), robot: verdict("dry_run") } }), words: [S("safety.source.chip.noConfig")], state: "warning" },
    { name: "read_error", h: () => health({ safetyPlc: plc("read_error"), preflight: { expectedReading: "UNKNOWN", ot: verdict("blocked", "SAFETY_UNKNOWN"), robot: verdict("dry_run") } }), words: [S("safety.source.chip.readError")], state: "error" },
    { name: "real OK", h: REAL_OK, words: [S("safety.source.chip.real")], state: "ok" },
    {
      name: "real + unguarded OT",
      h: () => health({ safetyPlc: plc("real", [{ code: "PLC-L1", backend: "modbus", effective: "real", provenance: null }]), preflight: { expectedReading: "REAL", ot: verdict("unguarded"), robot: verdict("real_basis") } }),
      words: [S("safety.source.chip.real"), S("safety.source.chip.unguarded").replace("{{target}}", "OT")],
      state: "error",
    },
    {
      name: "real + robot blocked (unknown tag)",
      h: () => health({ safetyPlc: plc("real", [{ code: "PLC-L1", backend: "modbus", effective: "real", provenance: null }]), preflight: { expectedReading: "REAL", ot: verdict("real_basis"), robot: verdict("blocked", "SAFETY_UNKNOWN") } }),
      words: [S("safety.source.chip.real"), S("safety.source.chip.blocked").replace("{{target}}", "Robot")],
      state: "warning",
    },
    {
      name: "real + e-stop not rated",
      h: () => ({ ...REAL_OK(), estop: { enabled: true, adapter: "gpio", label: "gpio", rated: false } }),
      words: [S("safety.source.chip.real"), S("safety.source.chip.estopNotRated")],
      state: "warning",
    },
  ];
  for (const c of cases) {
    it(`${c.name} ⇒ chip '${c.words.join(" · ")}' trạng thái ${c.state}, hiện sẵn ở header`, () => {
      srv.health = c.h();
      render(<SafetyWorkforce />);
      const el = sourceChip();
      expect(header().contains(el)).toBe(true);
      expect(el).toBeVisible();
      expect(el).toHaveAttribute("data-state", c.state);
      const segs = [...el.querySelectorAll("[data-source-seg]")] as HTMLElement[];
      expect(segs.map((s) => s.textContent?.trim())).toEqual(c.words);
      // Mỗi đoạn không-OK có màu riêng (không chỉ chữ).
      for (const s of segs) if (s.getAttribute("data-tone") !== "ok") expect(s.className).toMatch(/(amber|destructive|red)/);
      // Không đoạn nào bị giấu trong "+N".
      expect(el.closest("[data-notice-more]")).toBeNull();
    });
  }

  it("đang tải ⇒ 'Đang kiểm tra' (không bao giờ ok); lỗi đọc ⇒ 'Không đọc được' trạng thái error", () => {
    srv.health = undefined;
    const { unmount } = render(<SafetyWorkforce />);
    expect(sourceChip()).toHaveAttribute("data-state", "loading");
    expect(sourceChip().textContent).toContain(S("safety.source.chip.loading"));
    unmount();
    srv.healthError = true;
    render(<SafetyWorkforce />);
    expect(sourceChip()).toHaveAttribute("data-state", "error");
    expect(sourceChip().textContent).toContain(S("safety.source.chip.error"));
  });

  it("panel nguồn ĐẦY ĐỦ nhìn thấy trong panel phụ không cần bấm; bấm chip ⇒ cuộn + focus vào panel", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<SafetyWorkforce />);
    for (const id of ["safety-source-plc", "safety-source-rule", "safety-source-ot", "safety-source-robot", "safety-source-vision", "safety-source-zone", "safety-source-estop", "safety-source-socket"]) {
      expect(within(aside()).getByTestId(id), id).toBeVisible();
    }
    await user.click(sourceChip());
    const panel = within(aside()).getByTestId("safety-source-panel");
    expect(spy).toHaveBeenCalled();
    expect(panel).toHaveFocus();
    spy.mockRestore();
    // "Panel phản ánh thực tế ≤5 s" (doc 80 Task 4) — giữ nguyên chu kỳ làm mới.
    expect((srv.queryOpts["safety.sourceHealth"] as { refetchInterval?: number }).refetchInterval).toBe(5000);
  });
});

describe("Safety P4 — ?tab= và bảng tin trực tiếp", () => {
  it("bấm tab ghi ?tab=workforce (replace); F5 với ?tab=workforce mở thẳng; giá trị lạ ⇒ cockpit", async () => {
    const user = userEvent.setup();
    const len0 = window.history.length;
    const { unmount } = render(<SafetyWorkforce />);
    await openWorkforce(user);
    expect(window.history.length).toBe(len0);
    expect(within(mainEl()).getByRole("region", { name: S("workforce.assignmentsTitle") })).toBeInTheDocument();
    unmount();
    window.history.replaceState(null, "", "/safety-workforce?tab=workforce");
    const r = render(<SafetyWorkforce />);
    expect(mainTab(S("safety.tab.workforce"))).toHaveAttribute("aria-selected", "true");
    r.unmount();
    window.history.replaceState(null, "", "/safety-workforce?tab=khong-co");
    render(<SafetyWorkforce />);
    expect(mainTab(S("safety.tab.cockpit"))).toHaveAttribute("aria-selected", "true");
  });

  it("chip 'Trực tiếp' trong hàng công cụ: 0 lúc đầu + câu chờ; sự kiện socket ⇒ đếm 1 + liệt kê + làm mới luồng", async () => {
    const user = userEvent.setup();
    render(<SafetyWorkforce />);
    const live = within(toolbar()).getByRole("button", { name: new RegExp(S("safety.liveTitle")) });
    expect(live).toHaveAttribute("data-live-count", "0");
    await user.click(live);
    expect(await screen.findByText(S("safety.liveEmpty"))).toBeInTheDocument();
    await user.keyboard("{Escape}");
    act(() => sock.handlers["safety:event"]?.({ id: 77, eventType: "collision", outcome: "stopped", isNearMiss: false, createdAt: "2026-10-03T05:00:00Z" }));
    expect(live).toHaveAttribute("data-live-count", "1");
    expect(srv.invalidated).toEqual(expect.arrayContaining(["safety.feed", "safety.nearMissTrend"]));
    await user.click(live);
    const pop = await screen.findByRole("dialog");
    expect(within(pop).getByText("#77")).toBeInTheDocument();
  });
});

describe("Safety P4 — sheet thay dialog (form, kiểm tra, payload giữ nguyên)", () => {
  it("Báo cáo tiệm cận: sheet ?flyout=; kiểm tra khoảng cách / độ tin cậy; payload source 'test'; đóng, URL sạch, invalidate", async () => {
    const user = userEvent.setup();
    render(<SafetyWorkforce />);
    await user.click(within(toolbar()).getByRole("button", { name: S("safety.reportProximity") }));
    const sheet = await waitLayer("safety-proximity");
    expect(params().get("flyout")).toBe("safety-proximity");
    expect(within(sheet).getByText(S("safety.proximityHint"))).toBeInTheDocument();
    const distance = within(sheet).getByLabelText(S("safety.distance"));
    const confidence = within(sheet).getByLabelText(S("safety.confidence"));
    await user.clear(distance);
    await user.type(distance, "-5");
    await user.click(within(sheet).getByRole("button", { name: S("safety.ingest") }));
    expect(toastSpy.error).toHaveBeenCalledWith(S("safety.distanceRequired"));
    await user.clear(distance);
    await user.type(distance, "150");
    await user.clear(confidence);
    await user.type(confidence, "1.5");
    await user.click(within(sheet).getByRole("button", { name: S("safety.ingest") }));
    expect(toastSpy.error).toHaveBeenCalledWith(S("safety.confidenceRequired"));
    expect(calls("ingestProximity")).toEqual([]);
    await user.clear(confidence);
    await user.type(confidence, "0.9");
    await user.type(within(sheet).getByLabelText(S("safety.stationIdOpt")), "3");
    await user.click(within(sheet).getByRole("button", { name: S("safety.ingest") }));
    await waitFor(() => expect(calls("ingestProximity")).toEqual([{ deviceId: undefined, stationId: 3, distance: 150, confidence: 0.9, source: "test" }]));
    await waitFor(() => expect(layer("safety-proximity")).toBeNull());
    expect(params().get("flyout")).toBeNull();
    expect(toastSpy.info).toHaveBeenCalledWith(S("safety.proximityNoop"));
    expect(srv.invalidated).toEqual(expect.arrayContaining(["safety.status", "safety.feed", "safety.nearMissTrend", "safety.currentBoard", "safety.listAssignments", "safety.listCollaborations", "safety.sourceHealth"]));
  });

  it("deep link báo cáo tiệm cận khi cờ CHƯA RÕ ⇒ không có form (đang kiểm tra / lỗi); cờ TẮT ⇒ có form như nút cũ", async () => {
    srv.status = undefined;
    window.history.replaceState(null, "", "/safety-workforce?flyout=safety-proximity");
    const { unmount } = render(<SafetyWorkforce />);
    let sheet = await waitLayer("safety-proximity");
    expect(within(sheet).getByText(S("common.gate.checkingStatus"))).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: S("safety.ingest") })).toBeNull();
    unmount();
    srv.status = undefined;
    srv.statusError = true;
    window.history.replaceState(null, "", "/safety-workforce?flyout=safety-proximity");
    const r2 = render(<SafetyWorkforce />);
    sheet = await waitLayer("safety-proximity");
    expect(within(sheet).getByRole("alert")).toHaveTextContent(S("safety.auditFlagStatusError"));
    expect(within(sheet).queryByRole("button", { name: S("safety.ingest") })).toBeNull();
    r2.unmount();
    srv.statusError = false;
    srv.status = { safetyAudit: false, workforce: true };
    window.history.replaceState(null, "", "/safety-workforce?flyout=safety-proximity");
    render(<SafetyWorkforce />);
    sheet = await waitLayer("safety-proximity");
    expect(within(sheet).getByRole("button", { name: S("safety.ingest") })).toBeInTheDocument();
  });

  it("Phân công: sheet; operator sai ⇒ toast; đúng ⇒ đúng payload, đóng, danh sách cập nhật sau invalidate", async () => {
    const user = userEvent.setup();
    render(<SafetyWorkforce />);
    await openWorkforce(user);
    await user.click(within(toolbar()).getByRole("button", { name: S("workforce.assign") }));
    const sheet = await waitLayer("workforce-assign");
    await user.click(within(sheet).getByRole("button", { name: S("workforce.assign") }));
    expect(toastSpy.error).toHaveBeenCalledWith(S("workforce.operatorIdRequired"));
    await user.type(within(sheet).getByLabelText(S("workforce.operatorId")), "77");
    await user.type(within(sheet).getByLabelText(S("workforce.lineId")), "2");
    await user.click(within(sheet).getByRole("button", { name: S("workforce.assign") }));
    await waitFor(() => expect(calls("assignOperator")).toEqual([{ operatorId: 77, lineId: 2, stationId: undefined, skillLevel: undefined }]));
    await waitFor(() => expect(layer("workforce-assign")).toBeNull());
    expect(params().get("flyout")).toBeNull();
    expect(params().get("tab")).toBe("workforce");
    expect(toastSpy.success).toHaveBeenCalledWith(S("workforce.assigned"));
    await waitFor(() => expect(within(mainEl()).getByText("#77")).toBeInTheDocument());
  });

  it("Phân công lại: sheet ?flyoutId= điền sẵn; payload {assignmentId, ...}; deep link id lạ ⇒ báo không tìm thấy; đã kết thúc ⇒ không form", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SafetyWorkforce />);
    await openWorkforce(user);
    const row = within(mainEl()).getByText("#43").closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: S("workforce.reassign") }));
    const sheet = await waitLayer("workforce-reassign");
    expect(params().get("flyoutId")).toBe("3");
    const op = within(sheet).getByLabelText(S("workforce.operatorId")) as HTMLInputElement;
    expect(op.value).toBe("43");
    await user.clear(op);
    await user.type(op, "50");
    await user.click(within(sheet).getByRole("button", { name: S("workforce.reassign") }));
    await waitFor(() => expect(calls("reassignOperator")).toEqual([{ assignmentId: 3, operatorId: 50, lineId: 1, stationId: 2, skillLevel: "qualified" }]));
    await waitFor(() => expect(layer("workforce-reassign")).toBeNull());
    unmount();
    window.history.replaceState(null, "", "/safety-workforce?tab=workforce&flyout=workforce-reassign&flyoutId=999");
    const r2 = render(<SafetyWorkforce />);
    const s2 = await waitLayer("workforce-reassign");
    expect(s2.textContent).toContain(S("workforce.assignmentNotFound").replace("{{id}}", "999"));
    expect(within(s2).queryByRole("button", { name: S("workforce.reassign") })).toBeNull();
    r2.unmount();
    window.history.replaceState(null, "", "/safety-workforce?tab=workforce&flyout=workforce-reassign&flyoutId=5");
    render(<SafetyWorkforce />);
    const s3 = await waitLayer("workforce-reassign");
    expect(s3.textContent).toContain(S("workforce.assignmentTerminal").replace("{{id}}", "5"));
    expect(within(s3).queryByRole("button", { name: S("workforce.reassign") })).toBeNull();
  });

  it("Bắt đầu phối hợp (panel phụ): sheet; payload giữ nguyên; cờ nhân lực chưa rõ ⇒ không form", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SafetyWorkforce />);
    await openCollab(user);
    await user.click(within(collabPanel()!).getByRole("button", { name: S("workforce.startCollab") }));
    const sheet = await waitLayer("collab-start");
    expect(within(sheet).getByText(S("workforce.startCollabHint"))).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText(S("workforce.operationCode")), "OP-X ");
    await user.type(within(sheet).getByLabelText(S("workforce.humanId")), "11");
    await user.type(within(sheet).getByLabelText(S("workforce.robotId")), "abc");
    await user.click(within(sheet).getByRole("button", { name: S("workforce.startCollab") }));
    await waitFor(() => expect(calls("startCollaboration")).toEqual([{ operationCode: "OP-X", humanOperatorId: 11, robotDeviceId: undefined, taskId: undefined }]));
    await waitFor(() => expect(layer("collab-start")).toBeNull());
    expect(toastSpy.success).toHaveBeenCalledWith(S("workforce.collabStarted"));
    unmount();
    srv.status = undefined;
    window.history.replaceState(null, "", "/safety-workforce?flyout=collab-start");
    render(<SafetyWorkforce />);
    const s2 = await waitLayer("collab-start");
    expect(within(s2).getByText(S("common.gate.checkingStatus"))).toBeInTheDocument();
    expect(within(s2).queryByRole("button", { name: S("workforce.startCollab") })).toBeNull();
  });

  it("không có quyền điều khiển ⇒ không đăng ký sheet nào: deep link không mở; nút khoá kèm lý do", async () => {
    perm.control = false;
    window.history.replaceState(null, "", "/safety-workforce?flyout=safety-proximity");
    render(<SafetyWorkforce />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(layer("safety-proximity")).toBeNull();
    const btn = within(toolbar()).getByRole("button", { name: S("safety.reportProximity") });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toBeTruthy();
  });

  it("FEATURE_DISABLED ⇒ toast.info êm (không đỏ) + làm mới trạng thái cờ", async () => {
    const user = userEvent.setup();
    srv.mutationError = Object.assign(new Error("Workforce feature is disabled"), { data: { code: "CONFLICT", appCode: "FEATURE_DISABLED" } });
    render(<SafetyWorkforce />);
    await openCollab(user);
    await user.click(within(collabPanel()!).getByRole("button", { name: S("workforce.signalAck") }));
    await waitFor(() => expect(calls("signalHandshake").length).toBe(1));
    await waitFor(() => expect(toastSpy.info).toHaveBeenCalledWith(S("workforce.flagOffToast")));
    expect(toastSpy.error).not.toHaveBeenCalled();
    expect(srv.invalidated).toContain("safety.status");
  });
});

describe("Safety P4 — R-2-n: xác nhận / một mục tiêu mỗi lần như trang cũ", () => {
  it("Kiểm định: AlertDialog câu cũ; Huỷ ⇒ 0 lời gọi; xác nhận ⇒ đúng [{eventId}] + invalidate", async () => {
    const user = userEvent.setup();
    render(<SafetyWorkforce />);
    const row = within(mainEl()).getByText("#41").closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: S("safety.audit") }));
    let dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText(S("safety.auditConfirmTitle"))).toBeInTheDocument();
    expect(dlg.textContent).toContain(S("safety.auditConfirmBody"));
    await user.click(within(dlg).getByRole("button", { name: S("common.cancel") }));
    expect(calls("auditEvent")).toEqual([]);
    await user.click(within(row).getByRole("button", { name: S("safety.audit") }));
    dlg = await screen.findByRole("alertdialog");
    await user.click(within(dlg).getByRole("button", { name: S("safety.confirmAudit") }));
    await waitFor(() => expect(calls("auditEvent")).toEqual([{ eventId: 41 }]));
    expect(srv.invalidated).toContain("safety.feed");
    // Hàng đã kiểm định không còn nút.
    await waitFor(() => expect(within(within(mainEl()).getByText("#41").closest("tr") as HTMLElement).queryByRole("button", { name: S("safety.audit") })).toBeNull());
  });

  it("Xác nhận phân công: một cú bấm ⇒ [{assignmentId}], không dialog; Đóng: AlertDialog ⇒ [{assignmentId}]", async () => {
    const user = userEvent.setup();
    render(<SafetyWorkforce />);
    await openWorkforce(user);
    const planned = within(mainEl()).getByText("#43").closest("tr") as HTMLElement;
    await user.click(within(planned).getByRole("button", { name: S("workforce.confirm") }));
    await waitFor(() => expect(calls("confirmAssignment")).toEqual([{ assignmentId: 3 }]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const active = within(mainEl()).getByText("#44").closest("tr") as HTMLElement;
    await user.click(within(active).getByRole("button", { name: S("workforce.close") }));
    const dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText(S("workforce.closeConfirmTitle"))).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: S("workforce.confirmClose") }));
    await waitFor(() => expect(calls("closeAssignment")).toEqual([{ assignmentId: 4 }]));
    // Hàng đã kết thúc: Phân công lại / Đóng bị khoá như cũ.
    const done = within(mainEl()).getByText("#45").closest("tr") as HTMLElement;
    expect(within(done).getByRole("button", { name: S("workforce.reassign") })).toBeDisabled();
    expect(within(done).getByRole("button", { name: S("workforce.close") })).toBeDisabled();
  });

  it("Phối hợp: Ack / Clear / Chuyển pha một cú bấm mỗi phiên; Huỷ qua AlertDialog; phiên kết thúc không có nút", async () => {
    const user = userEvent.setup();
    render(<SafetyWorkforce />);
    await openCollab(user);
    const panel = collabPanel()!;
    const live = panel.querySelector('[data-collab-session="7"]') as HTMLElement;
    await user.click(within(live).getByRole("button", { name: S("workforce.signalAck") }));
    await waitFor(() => expect(calls("signalHandshake")).toEqual([{ sessionId: 7, state: "ack" }]));
    await user.click(within(live).getByRole("button", { name: S("workforce.signalClear") }));
    await waitFor(() => expect(calls("signalHandshake")).toEqual([{ sessionId: 7, state: "ack" }, { sessionId: 7, state: "clear" }]));
    await user.click(within(live).getByRole("button", { name: S("workforce.advance") }));
    await waitFor(() => expect(calls("advancePhase")).toEqual([{ sessionId: 7 }]));
    await user.click(within(live).getByRole("button", { name: S("workforce.abort") }));
    let dlg = await screen.findByRole("alertdialog");
    expect(dlg.textContent).toContain(S("workforce.abortConfirmBody"));
    await user.click(within(dlg).getByRole("button", { name: S("common.cancel") }));
    expect(calls("abortCollaboration")).toEqual([]);
    await user.click(within(live).getByRole("button", { name: S("workforce.abort") }));
    dlg = await screen.findByRole("alertdialog");
    await user.click(within(dlg).getByRole("button", { name: S("workforce.confirmAbort") }));
    await waitFor(() => expect(calls("abortCollaboration")).toEqual([{ sessionId: 7 }]));
    const ended = panel.querySelector('[data-collab-session="8"]') as HTMLElement;
    expect(within(ended).queryAllByRole("button")).toEqual([]);
  });

  it("không quyền điều khiển ⇒ phiên phối hợp không có nút hành động; luồng sự kiện không có nút Kiểm định", async () => {
    const user = userEvent.setup();
    perm.control = false;
    render(<SafetyWorkforce />);
    expect(within(mainEl()).queryByRole("button", { name: S("safety.audit") })).toBeNull();
    await openCollab(user);
    expect(within(collabPanel()!).queryByRole("button", { name: S("workforce.advance") })).toBeNull();
    expect(within(collabPanel()!).getByRole("button", { name: S("workforce.startCollab") })).toBeDisabled();
  });
});

describe("Safety P4 — Review Focus 3: panel Phối hợp (state-machine pha) KHÔNG unmount", () => {
  it("mount MỘT lần lúc nạp; đổi tab phụ, đổi tab MAIN, qua lại 1024 px ⇒ vẫn 1 mount / 0 unmount; pha + thao tác đang chạy sống sót", async () => {
    const user = userEvent.setup();
    render(<SafetyWorkforce />);
    expect(srv.collab.mounts).toBe(1);
    await openCollab(user);
    const panel = collabPanel()!;
    const session = () => panel.querySelector('[data-collab-session="7"]') as HTMLElement;
    expect(session().querySelector("[data-phase-current]")).toHaveTextContent("robot_work");
    // Thao tác "chuyển pha" đang chạy (server chưa trả lời).
    srv.hold.add("safety.advancePhase");
    await user.click(within(session()).getByRole("button", { name: S("workforce.advance") }));
    expect(within(session()).getByRole("button", { name: S("workforce.advance") })).toBeDisabled();
    // Đổi tab phụ ×2, đổi tab MAIN ×2, qua lại 1024 px ×2.
    await user.click(sideTab(S("safety.side.trend")));
    expect(panel).not.toBeVisible();
    await openCollab(user);
    await openWorkforce(user);
    await user.click(mainTab(S("safety.tab.cockpit")));
    setNarrow(true);
    setNarrow(false);
    setNarrow(true);
    await user.click(sideTab(S("safety.side.trend")));
    await user.click(sideTab(S("safety.tab.collaboration")));
    setNarrow(false);
    expect(srv.collab.mounts).toBe(1);
    expect(srv.collab.unmounts).toBe(0);
    expect(collabPanel()).toBe(panel);
    // Trạng thái "đang chạy" là của instance — còn nguyên (nút vẫn khoá, không bấm lần 2 được).
    expect(within(session()).getByRole("button", { name: S("workforce.advance") })).toBeDisabled();
    expect(session().querySelector("[data-phase-current]")).toHaveTextContent("robot_work");
    // Server trả lời ⇒ toast + invalidate ⇒ pha mới hiện trên CÙNG instance.
    await act(async () => { srv.release["safety.advancePhase"]?.(); });
    await waitFor(() => expect(session().querySelector("[data-phase-current]")).toHaveTextContent("human_verify"));
    expect(toastSpy.success).toHaveBeenCalledWith(S("workforce.phaseAdvanced"));
    expect(calls("advancePhase")).toEqual([{ sessionId: 7 }]);
    expect(srv.collab.mounts).toBe(1);
    expect(srv.collab.unmounts).toBe(0);
  });

  it("pha đổi trên server khi panel đang ẩn ⇒ mở lại thấy pha mới, không remount", async () => {
    const user = userEvent.setup();
    render(<SafetyWorkforce />);
    expect(collabPanel()).not.toBeVisible();
    srv.collabs[0].phase = "human_verify";
    // Trang tự làm mới (nút làm mới ở header) khi panel đang ẩn.
    await user.click(within(header()).getByRole("button", { name: S("common.refresh") }));
    await openCollab(user);
    expect((collabPanel()!.querySelector('[data-collab-session="7"] [data-phase-current]') as HTMLElement)).toHaveTextContent("human_verify");
    expect(srv.collab.mounts).toBe(1);
    expect(srv.collab.unmounts).toBe(0);
  });
});

describe("Safety P4 — dưới 1024 px", () => {
  it("chip an toàn (tư vấn + nguồn + cờ) xuống hàng đầu MAIN, không bị header cắt; công cụ tab vào nội dung", () => {
    presetNarrow(true);
    srv.status = { safetyAudit: false, workforce: true };
    render(<SafetyWorkforce />);
    const row = mainEl().querySelector("[data-narrow-safety]") as HTMLElement;
    expect(row).toBeTruthy();
    expect(within(row).getByRole("button", { name: S("safety.advisoryChip") })).toBeInTheDocument();
    expect(within(row).getByTestId("safety-source-chip")).toBeInTheDocument();
    expect(within(row).getByTestId("feature-status-off")).toBeInTheDocument();
    expect(header().querySelector("[data-testid=safety-source-chip]")).toBeNull();
    // Header hẹp: 2 chip KPI hiện thẳng, 2 chip còn lại vào "+2" (không bị header cắt im lặng).
    expect(header().querySelectorAll("[data-layout-kpi]").length).toBe(2);
    expect(header().querySelector("[data-chip-more]")).toHaveAttribute("data-chip-more", "2");
    expect(mainEl().querySelector("[data-narrow-tools]")).toBeTruthy();
    expect(within(mainEl().querySelector("[data-narrow-tools]") as HTMLElement).getByRole("button", { name: S("safety.reportProximity") })).toBeInTheDocument();
  });
});
