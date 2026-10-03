// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 9 — Equipment Standards thành mẫu P3/P4 (CockpitLayout + SplitListDetail).
// Hợp đồng (task-9-brief + page-task-dispatch + plan GC3/Review Focus 1/4 + R-2-g/R-2-n/R-2-p):
//   - Header một hàng: h1 + chip cờ (4 trạng thái) + chip "loại không đạt" (lỗi) + `StatusChipStrip` (thay 5 MetricCard,
//     MỖI chip ghi nguồn) + chip "Khi nào dùng" / "Chỉ metadata". Số liên quan cảnh báo được GHIM (R-2-p).
//   - MAIN (`data-layout-main`) = hàng tab `?tab=` (giá trị cũ) + nội dung. Hàng tab là thanh công cụ DUY NHẤT trong MAIN.
//   - Phân cấp: cây (role=tree) + chi tiết (SplitListDetail, `?typeKey=`), đăng ký loại = sheet.
//   - Phân loại cảnh báo: `DataTable` PHÂN TRANG (trang không còn cao 8×); chuẩn hoá cảnh báo = SHEET; ánh xạ = sheet.
//   - Hiệu năng cảnh báo: KPI thành chip có nguồn ở panel phụ (ngoài MAIN); chattering "Chưa đo được"; Shelve vẫn KHOÁ.
//   - CR: `ApprovalQueue` dùng chung — hợp đồng HIỆN TẠI (R-2-g): KHÔNG bước xác nhận, KHÔNG bắt lý do từ chối,
//     một lượt gọi mỗi cú bấm (R-2-n); maker-checker giữ (tác giả không tự duyệt/từ chối/xuất bản — như server).
// "Server" giả là kho trong bộ nhớ: truy vấn CHỈ đổi khi trang gọi invalidate đúng thủ tục.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { installResizeHandleHitAreaShim } from "@/components/patterns/layoutKitTestPanels";
import { installMatchMedia, presetNarrow } from "@/components/patterns/layoutKitTestMedia";

vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());
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
const me = vi.hoisted(() => ({ id: 7 as number | null }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: me.id == null ? null : { id: me.id, name: "Tester" }, loading: false }),
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));

// ── "Server" giả ───────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const srv = vi.hoisted(() => ({
  status: { enabled: true } as Row | undefined,
  statusError: false,
  complianceLoading: false,
  complianceError: false,
  kpiLoading: false,
  treeLoading: false,
  tree: [] as Row[],
  alarms: [] as Row[],
  crs: [] as Row[],
  masters: [] as Row[],
  snap: { tree: [] as Row[], alarms: [] as Row[], crs: [] as Row[], masters: [] as Row[] },
  version: 0,
  listeners: new Set<() => void>(),
  calls: {} as Record<string, unknown[]>,
  invalidated: [] as string[],
  queryInputs: [] as string[],
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
      if (path === "equipmentStandards.registerDeviceType") {
        srv.tree.push({ typeKey: input.typeKey, version: input.version, status: "draft", label: input.label ?? null, mappedMachineTypes: [], children: [] });
        return { id: 1 };
      }
      if (path === "equipmentStandards.upsertAlarmMapping") {
        srv.alarms.unshift({ vendor: input.vendor, nativeCode: input.nativeCode, standardCode: input.standardCode, severity: input.severity, recommendedAction: input.recommendedAction ?? null });
        return { ok: true };
      }
      if (path === "equipmentStandards.submitChangeRequest") {
        srv.crs.unshift(cr({ id: 99, crKey: "CR-NEW", targetTypeKey: input.targetTypeKey, kind: input.kind, requestedBy: 7 }));
        return { id: 99 };
      }
      if (path === "equipmentStandards.reviewChangeRequest") {
        Object.assign(srv.crs.find((c) => c.id === input.crId)!, { status: input.to });
        return { ok: true };
      }
      if (path === "equipmentStandards.publishChangeRequest") {
        Object.assign(srv.crs.find((c) => c.id === input.crId)!, { status: "published" });
        return { ok: true, decision: { newVersion: "2.0.0", effectiveBump: "major", breaking: true } };
      }
      if (path === "equipmentStandards.upsertMasterAlarm") {
        const ex = srv.masters.find((m) => m.alarmKey === input.alarmKey);
        if (ex) Object.assign(ex, { consequence: input.consequence, timeToRespond: input.timeToRespond ?? null });
        else srv.masters.push(master({ id: 50, alarmKey: input.alarmKey }));
        return { ok: true };
      }
      if (path === "equipmentStandards.shelveMasterAlarm") {
        Object.assign(srv.masters.find((m) => m.id === input.id)!, { isShelvedNow: input.shelvedUntil != null });
        return { ok: true };
      }
      if (path === "equipmentStandards.deleteMasterAlarm") {
        srv.masters = srv.masters.filter((m) => m.id !== input.id);
        return { ok: true };
      }
      return undefined;
    });
  const hooks = (path: string) => ({
    useQuery: (input?: Row, opts?: { enabled?: boolean }) => {
      useVersion();
      const enabled = opts?.enabled !== false;
      if (enabled) srv.queryInputs.push(`${path}:${JSON.stringify(input ?? null)}`);
      if (path === "equipmentStandards.status")
        return srv.statusError ? q(undefined, enabled, { isError: true }) : srv.status === undefined ? q(undefined, enabled, { isLoading: true, isPending: true }) : q(srv.status, enabled);
      if (path === "equipmentStandards.hierarchyTree")
        return srv.treeLoading ? q(undefined, enabled, { isLoading: true, isPending: true }) : q({ tree: srv.snap.tree, typeCount: countTypes(srv.snap.tree) }, enabled);
      if (path === "equipmentStandards.resolveType") {
        if (input?.typeKey === "Robot") return q(RESOLVED_ROBOT, enabled);
        return q(undefined, enabled, { isError: true, error: new Error("not found") });
      }
      if (path === "equipmentStandards.listAlarmMappings") {
        const rows = input?.vendor ? srv.snap.alarms.filter((a) => a.vendor === input.vendor) : srv.snap.alarms;
        return q({ mappings: rows, vendors: [...new Set(srv.snap.alarms.map((a) => String(a.vendor)))].sort() }, enabled);
      }
      if (path === "equipmentStandards.mapAlarm")
        return q({ standardCode: "COLLISION_DETECT", severity: "high", mapped: true, recommendedAction: "Dừng và kiểm tra" }, enabled);
      if (path === "equipmentStandards.listChangeRequests")
        return q(input?.status ? srv.snap.crs.filter((c) => c.status === input.status) : srv.snap.crs, enabled);
      if (path === "equipmentStandards.complianceMetrics") {
        if (srv.complianceError) return q(undefined, enabled, { isError: true });
        if (srv.complianceLoading) return q(undefined, enabled, { isLoading: true, isPending: true });
        return q(COMPLIANCE, enabled);
      }
      if (path === "equipmentStandards.runConformance") return q({ pass: true, seed: [], profiles: [] }, enabled);
      if (path === "alarmKpi.summary") return srv.kpiLoading ? q(undefined, enabled, { isLoading: true, isPending: true }) : q(SUMMARY, enabled);
      if (path === "equipmentStandards.listMasterAlarms") return q(srv.snap.masters, enabled);
      return q(undefined, enabled);
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
  const refresh = (key: string) => {
    if (key === "equipmentStandards.hierarchyTree") srv.snap.tree = structuredClone(srv.tree);
    if (key === "equipmentStandards.listAlarmMappings") srv.snap.alarms = srv.alarms.map((x) => ({ ...x }));
    if (key === "equipmentStandards.listChangeRequests") srv.snap.crs = srv.crs.map((x) => ({ ...x }));
    if (key === "equipmentStandards.listMasterAlarms") srv.snap.masters = srv.masters.map((x) => ({ ...x }));
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

function countTypes(nodes: Row[]): number {
  return nodes.reduce((n, x) => n + 1 + countTypes((x.children as Row[]) ?? []), 0);
}
function cr(o: Row): Row {
  return { id: 1, crKey: "CR-1", targetTypeKey: "Robot", kind: "modify", status: "pending", conformanceStatus: "pending", stage: "none", backwardIncompatible: "false", requestedBy: 5, ...o };
}
function master(o: Row): Row {
  return { id: 7, alarmKey: "OVERTEMP", assetType: null, priority: "high", consequence: "major", timeToRespond: 10, setpoint: null, deadband: null, isSuppressed: false, isShelvedNow: false, vendor: null, nativeCode: null, label: null, rationalization: null, ...o };
}

import EquipmentStandards from "./EquipmentStandards";

const TREE = (): Row[] => [
  {
    typeKey: "Equipment", version: "1.0.0", status: "published", label: "Equipment (base)", mappedMachineTypes: [], origin: "seed",
    children: [
      { typeKey: "Robot", version: "1.0.0", status: "published", label: "Robot", mappedMachineTypes: [], origin: "seed", children: [] },
      { typeKey: "LegacyPress", version: "1.0.0", status: "draft", label: "Legacy press", mappedMachineTypes: [], children: [] },
    ],
  },
];
const RESOLVED_ROBOT = {
  typeKey: "Robot", version: "1.0.0", adapterKind: null, inheritanceChain: ["Equipment", "Robot"],
  attributesSchema: [{ name: "payloadKg", dataType: "float", unit: "kg", required: false }],
  supportedCommands: [{ name: "start" }], supportedStates: ["IDLE"], extension: {}, mappedMachineTypes: ["ROBOT_ARM"],
};
// ORACLE (khai tay): 40 ánh xạ — fanuc SRVO-100..124 (25 dòng), abb ABB-125..139 (15 dòng).
const ALARMS = (): Row[] =>
  Array.from({ length: 40 }, (_, i) => ({
    vendor: i < 25 ? "fanuc" : "abb",
    nativeCode: i < 25 ? `SRVO-${100 + i}` : `ABB-${100 + i}`,
    standardCode: `STD_${String(i).padStart(2, "0")}`,
    severity: ["critical", "high", "medium", "low", "diagnostic"][i % 5],
    recommendedAction: i === 0 ? "Dừng robot" : null,
  }));
const CRS = (): Row[] => [
  cr({ id: 1, crKey: "CR-1", status: "pending", requestedBy: 5 }),
  cr({ id: 2, crKey: "CR-2", status: "in_review", requestedBy: 5 }),
  cr({ id: 3, crKey: "CR-3", status: "approved", conformanceStatus: "pass", backwardIncompatible: "true", requestedBy: 5 }),
  cr({ id: 4, crKey: "CR-4", status: "rejected", requestedBy: 5 }),
  cr({ id: 5, crKey: "CR-5", status: "published", stage: "staging", requestedBy: 5 }),
  cr({ id: 6, crKey: "CR-6", status: "pending", requestedBy: 7 }),
];
const MASTERS = (): Row[] => [master({ id: 7, alarmKey: "OVERTEMP" }), master({ id: 9, alarmKey: "OVERPRESS", isShelvedNow: true })];
const COMPLIANCE = {
  mappedRate: 0.5, machinesMappedToPublished: 1, machineCount: 2,
  conformancePassRate: 0.75, conformancePassCount: 3, conformanceTypeCount: 4,
  crPendingCount: 3, alarmVendorCoverage: 2, failingTypes: ["LegacyPress"], unmappedMachineTypes: ["PRESS"],
  basis: { machinesWithKey: 1, machinesWithUnpublishedKey: 0, publishedTypeCount: 4, warnings: [] },
};
const SUMMARY = {
  windowMs: 168 * 3600_000, now: Date.now(), operatorCount: 3, totalAlarms: 5,
  rate: { count: 5, windowHours: 168, operatorCount: 3, alarmsPerHour: 0.03, alarmsPerHourPerOperator: 0.01, status: "ok" },
  flood: { maxInWindow: 2, floodBucketCount: 4, totalBuckets: 4, floodPercent: 0, isFlooding: true, windowMinutes: 10, threshold: 10 },
  standing: { count: 1, thresholdHours: 24, status: "ok", worst: [] },
  badActors: [{ actorKey: "machine:1", actorLabel: "M-01", count: 3, percent: 60 }],
  distribution: { counts: {}, percent: {}, total: 5, target: {}, highOverTarget: false },
  breaches: [], sourceCounts: { andon: 4, predictive: 1 }, occurrenceLog: { available: true, firstOccurredAt: null }, generatedAt: new Date().toISOString(),
};

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
  srv.complianceLoading = false;
  srv.complianceError = false;
  srv.kpiLoading = false;
  srv.treeLoading = false;
  srv.tree = TREE();
  srv.alarms = ALARMS();
  srv.crs = CRS();
  srv.masters = MASTERS();
  srv.snap = { tree: structuredClone(srv.tree), alarms: srv.alarms.map((x) => ({ ...x })), crs: srv.crs.map((x) => ({ ...x })), masters: srv.masters.map((x) => ({ ...x })) };
  srv.calls = {};
  srv.invalidated = [];
  srv.queryInputs = [];
  Object.assign(perm, { view: true, control: true });
  me.id = 7;
  for (const f of Object.values(toastSpy)) f.mockClear();
  localStorage.clear();
  presetNarrow(false);
  window.history.replaceState(null, "", "/equipment-standards");
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
const chip = (id: string) => document.querySelector(`[data-chip-id="${id}"]`) as HTMLElement | null;
const toolbar = () => mainEl().querySelector("[data-layout-toolbar]") as HTMLElement;
const calls = (p: string) => srv.calls[`equipmentStandards.${p}`] ?? [];
const sidePanel = () => document.querySelector("aside[aria-label]") as HTMLElement | null;
const bodyRows = () => [...mainEl().querySelectorAll("tbody tr")] as HTMLElement[];

async function openTab(name: RegExp) {
  const user = userEvent.setup();
  await user.click(within(toolbar()).getByRole("tab", { name }));
  return user;
}

describe("Standards P3/P4 — bố cục", () => {
  it("MAIN (một, trong <main>) = hàng tab + nội dung; không h1/header/KPI/notice trong MAIN; một thanh công cụ; 5 tab giữ tên; 0 dialog", () => {
    render(<EquipmentStandards />);
    const m = mainEl();
    expect(m.closest("main")).toBeTruthy();
    expect(m.querySelector("h1")).toBeNull();
    expect(m.querySelector("[data-layout-header]")).toBeNull();
    expect(m.querySelector("[data-layout-kpi]")).toBeNull();
    expect(m.querySelector("[data-notice-kind]")).toBeNull();
    expect(m.querySelectorAll("[data-layout-toolbar]")).toHaveLength(1);
    const tabs = within(toolbar()).getAllByRole("tab").map((x) => x.textContent?.trim());
    expect(tabs).toEqual(["Phân cấp", "Phân loại cảnh báo", "Hiệu năng cảnh báo", "Yêu cầu thay đổi", "Tuân thủ"]);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Tiêu chuẩn & Quản trị Thiết bị");
    expect(h1.closest("[data-layout-header]")).toBeTruthy();
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
    // 5 MetricCard cũ ⇒ 5 chip 32 px: 4 hiện thẳng + "+1" (header một hàng ≥ 1600 px); không còn MetricCard nào
    expect(header().querySelectorAll("[data-layout-kpi]")).toHaveLength(4);
    expect(header().querySelector("[data-chip-more]")).toHaveAttribute("data-chip-more", "1");
    expect(document.querySelector('[data-slot="card"] [data-metric-card]')).toBeNull();
  });

  it("KPI = chip MANG NGUỒN: giá trị như thẻ cũ (tỉ lệ + n/m), title + mô tả ẩn nêu thủ tục nguồn", async () => {
    render(<EquipmentStandards />);
    // chip thứ 5 nằm trong "+1" — mở để đọc
    await userEvent.setup().click(header().querySelector("[data-chip-more]") as HTMLElement);
    const mapped = chip("eq-mapped")!;
    expect(mapped).toHaveAttribute("data-state", "ok");
    expect(mapped).toHaveTextContent("Máy đã ánh xạ");
    expect(mapped).toHaveTextContent("50% · 1/2");
    expect(mapped.getAttribute("title")).toMatch(/complianceMetrics/);
    const conf = chip("eq-conformance")!;
    expect(conf).toHaveTextContent("75% · 3/4");
    expect(conf.getAttribute("title")).toMatch(/complianceMetrics/);
    expect(chip("eq-pending-crs")).toHaveTextContent("3");
    expect(chip("eq-alarm-vendors")).toHaveTextContent("2");
    const types = chip("eq-types")!;
    expect(types).toHaveTextContent("3");
    expect(types.getAttribute("title")).toMatch(/hierarchyTree/);
    for (const id of ["eq-mapped", "eq-conformance", "eq-pending-crs", "eq-alarm-vendors", "eq-types"]) {
      expect(chip(id)!.getAttribute("title")).toMatch(/^Nguồn: /);
    }
  });

  it("complianceMetrics đang tải ⇒ chip 'loading' không in số; lỗi ⇒ 'error' không in 0", () => {
    srv.complianceLoading = true;
    render(<EquipmentStandards />);
    for (const id of ["eq-mapped", "eq-conformance", "eq-pending-crs", "eq-alarm-vendors"]) {
      expect(chip(id)).toHaveAttribute("data-state", "loading");
      expect(chip(id)).not.toHaveTextContent(/\d/);
    }
    cleanup();
    srv.complianceLoading = false;
    srv.complianceError = true;
    render(<EquipmentStandards />);
    for (const id of ["eq-mapped", "eq-conformance", "eq-pending-crs", "eq-alarm-vendors"]) {
      expect(chip(id)).toHaveAttribute("data-state", "error");
      expect(chip(id)).not.toHaveTextContent(/0/);
    }
  });

  it("R-2-p: chip 'Nhà cung cấp cảnh báo' GHIM — header hẹp (1 chỗ) vẫn hiện nó dù chip khác đang tải (ưu tiên cao hơn), phần dư vào '+N'", () => {
    presetNarrow(true);
    srv.treeLoading = true; // chip "Loại thiết bị" = loading ⇒ không ghim thì nó chiếm chỗ duy nhất
    render(<EquipmentStandards />);
    const strip = header().querySelector("[data-status-chip-strip]") as HTMLElement;
    expect(within(strip).getByText("Nhà cung cấp cảnh báo")).toBeInTheDocument();
    expect(strip.querySelector('[data-chip-id="eq-alarm-vendors"]')).toBeTruthy();
    expect(strip.querySelector("[data-chip-more]")).toBeTruthy();
  });

  it("chip cờ giữ 4 trạng thái (feature-status-*) và câu cũ; loại không đạt kiểm định = chip LỖI (popover giữ danh sách)", async () => {
    srv.status = undefined;
    render(<EquipmentStandards />);
    expect(screen.getByTestId("feature-status-loading")).toBeInTheDocument();
    cleanup();
    srv.status = { enabled: true };
    srv.statusError = true;
    render(<EquipmentStandards />);
    expect(screen.getByTestId("feature-status-error")).toBeInTheDocument();
    cleanup();
    srv.statusError = false;
    srv.status = { enabled: false };
    render(<EquipmentStandards />);
    const off = screen.getByTestId("feature-status-off");
    const user = userEvent.setup();
    await user.click(off);
    expect(await screen.findByText(/Chế độ xem trước: quản trị thiết bị đang tắt/)).toBeInTheDocument();
    cleanup();
    srv.status = { enabled: true };
    render(<EquipmentStandards />);
    expect(screen.queryByTestId("feature-status-off")).toBeNull();
    const failing = header().querySelector('[data-notice-kind="error"]') as HTMLElement;
    expect(failing).toHaveTextContent("1 loại không đạt");
    await userEvent.setup().click(failing);
    expect(await screen.findByText("LegacyPress", { selector: "[data-notice-popover] *" })).toBeInTheDocument();
  });

  it("'Khi nào dùng' (khoá riêng của trang) thành chip header; 'Chỉ metadata' (câu an toàn cũ) trong '+1' của cùng dải; không còn khối trên MAIN", async () => {
    render(<EquipmentStandards />);
    const user = userEvent.setup();
    await user.click(within(header()).getByRole("button", { name: "Khi nào dùng" }));
    expect(document.querySelector('[data-when-to-use="eqStandards.whenToUse"]')).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(within(header()).getByRole("button", { name: "Xem thêm 1 ghi chú" }));
    expect(await screen.findByText("Chỉ metadata")).toBeInTheDocument();
    expect(screen.getByText(/Trang này chỉ ghi metadata quản trị/)).toBeInTheDocument();
  });
});

describe("Standards — tab ?tab= (giá trị cũ) đồng bộ URL", () => {
  it("bấm tab ghi ?tab=, F5 giữ tab; giá trị lạ ⇒ Phân cấp", async () => {
    render(<EquipmentStandards />);
    await openTab(/Phân loại cảnh báo/);
    expect(params().get("tab")).toBe("alarms");
    cleanup();
    render(<EquipmentStandards />);
    expect(within(toolbar()).getByRole("tab", { name: /Phân loại cảnh báo/ })).toHaveAttribute("aria-selected", "true");
    cleanup();
    window.history.replaceState(null, "", "/equipment-standards?tab=xyz");
    render(<EquipmentStandards />);
    expect(within(toolbar()).getByRole("tab", { name: /Phân cấp/ })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Standards — Phân cấp: cây + chi tiết (SplitListDetail, ?typeKey=)", () => {
  it("cây là role=tree; bấm/Enter chọn ⇒ ?typeKey= + chi tiết đã phân giải; F5 giữ; chưa chọn ⇒ EmptyState", async () => {
    render(<EquipmentStandards />);
    const tree = screen.getByRole("tree");
    expect(within(tree).getAllByRole("treeitem").map((x) => x.getAttribute("data-testid"))).toEqual(["type-row-Equipment", "type-row-Robot", "type-row-LegacyPress"]);
    expect(screen.getByText("Chọn một loại thiết bị trong cây để xem thuộc tính, lệnh và trạng thái PackML đã gộp đầy đủ.")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("type-row-Robot"), { key: "Enter" });
    expect(params().get("typeKey")).toBe("Robot");
    await waitFor(() => expect(screen.getByText("payloadKg (kg)")).toBeInTheDocument());
    expect(screen.getByTestId("type-row-Robot")).toHaveAttribute("aria-selected", "true");
    cleanup();
    render(<EquipmentStandards />);
    expect(screen.getByText("payloadKg (kg)")).toBeInTheDocument();
    expect(srv.queryInputs).toContain('equipmentStandards.resolveType:{"typeKey":"Robot"}');
  });

  it("loại không phân giải được ⇒ 'Không tìm thấy loại:' như cũ", () => {
    window.history.replaceState(null, "", "/equipment-standards?typeKey=Nope");
    render(<EquipmentStandards />);
    expect(screen.getByText(/Không tìm thấy loại:/)).toBeInTheDocument();
  });

  it("'Đăng ký loại' (hàng công cụ) mở SHEET eq-type-new: kiểm tra bắt buộc, payload đúng, đóng, URL sạch, invalidate cây", async () => {
    render(<EquipmentStandards />);
    const user = userEvent.setup();
    await user.click(within(toolbar()).getByRole("button", { name: /Đăng ký loại/ }));
    const sheet = await waitLayer("eq-type-new");
    expect(params().getAll("flyout")).toEqual(["eq-type-new"]);
    await user.click(within(sheet).getByRole("button", { name: /^Đăng ký$/ }));
    expect(toastSpy.error).toHaveBeenCalledWith("Khóa loại là bắt buộc.");
    expect(calls("registerDeviceType")).toHaveLength(0);
    await user.type(within(sheet).getByLabelText("Khóa loại"), "  MyCell ");
    await user.type(within(sheet).getByLabelText("Nhãn"), "Ô của tôi");
    await user.click(within(sheet).getByRole("button", { name: /^Đăng ký$/ }));
    await waitFor(() => expect(calls("registerDeviceType")).toEqual([{ typeKey: "MyCell", parentTypeKey: undefined, version: "1.0.0", label: "Ô của tôi", description: undefined }]));
    await waitFor(() => expect(layer("eq-type-new")).toBeNull());
    expect(params().get("flyout")).toBeNull();
    expect(toastSpy.success).toHaveBeenCalledWith("Đã đăng ký loại thiết bị (bản nháp)");
    expect(srv.invalidated).toContain("equipmentStandards.hierarchyTree");
    expect(await screen.findByTestId("type-row-MyCell")).toBeInTheDocument();
  });

  it("cờ CHƯA RÕ ⇒ 'Đăng ký loại' khoá; deep link ?flyout=eq-type-new chỉ báo trạng thái, không có form", async () => {
    srv.status = undefined;
    window.history.replaceState(null, "", "/equipment-standards?flyout=eq-type-new&flyoutId=");
    render(<EquipmentStandards />);
    const sheet = await waitLayer("eq-type-new");
    // sheet đang mở (modal) ⇒ phần còn lại của trang aria-hidden: tìm nút kể cả phần ẩn
    expect(within(toolbar()).getByRole("button", { name: /Đăng ký loại/, hidden: true })).toBeDisabled();
    expect(within(sheet).queryByLabelText("Khóa loại")).toBeNull();
  });
});

describe("Standards — Phân loại cảnh báo: DataTable PHÂN TRANG + sheet chuẩn hoá", () => {
  it("40 ánh xạ ⇒ trang 1 có 15 dòng (không render cả 40), 'Next page' sang trang 2, trang cuối 10 dòng", async () => {
    window.history.replaceState(null, "", "/equipment-standards?tab=alarms");
    render(<EquipmentStandards />);
    expect(bodyRows()).toHaveLength(15);
    expect(within(mainEl()).getByText("SRVO-100")).toBeInTheDocument();
    expect(within(mainEl()).queryByText("SRVO-115")).toBeNull();
    const user = userEvent.setup();
    await user.click(within(mainEl()).getByRole("button", { name: "Next page" }));
    expect(within(mainEl()).getByText("SRVO-115")).toBeInTheDocument();
    expect(within(mainEl()).queryByText("SRVO-100")).toBeNull();
    await user.click(within(mainEl()).getByRole("button", { name: "Next page" }));
    expect(bodyRows()).toHaveLength(10);
    expect(within(mainEl()).getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("lọc nhà cung cấp (hàng công cụ) ⇒ truy vấn {vendor} như cũ, bảng chỉ còn dòng của vendor đó", async () => {
    window.history.replaceState(null, "", "/equipment-standards?tab=alarms");
    render(<EquipmentStandards />);
    const user = userEvent.setup();
    await user.click(within(toolbar()).getByRole("combobox", { name: "Nhà cung cấp" }));
    await user.click(await screen.findByRole("option", { name: "abb" }));
    await waitFor(() => expect(srv.queryInputs).toContain('equipmentStandards.listAlarmMappings:{"vendor":"abb"}'));
    expect(bodyRows()).toHaveLength(15);
    expect(within(mainEl()).getByText("ABB-125")).toBeInTheDocument();
    expect(within(mainEl()).queryByText("SRVO-100")).toBeNull();
  });

  it("'Chuẩn hóa cảnh báo' = SHEET eq-alarm-normalize: tra cứu gửi đúng {vendor, nativeCode} đã trim, hiện mã chuẩn", async () => {
    window.history.replaceState(null, "", "/equipment-standards?tab=alarms");
    render(<EquipmentStandards />);
    const user = userEvent.setup();
    await user.click(within(toolbar()).getByRole("button", { name: /Chuẩn hóa cảnh báo/ }));
    const sheet = await waitLayer("eq-alarm-normalize");
    const btn = within(sheet).getByRole("button", { name: /Tra cứu/ });
    expect(btn).toBeDisabled();
    await user.type(within(sheet).getByLabelText("Nhà cung cấp"), " fanuc ");
    await user.type(within(sheet).getByLabelText("Mã gốc"), "SRVO-050{Enter}");
    await waitFor(() => expect(srv.queryInputs).toContain('equipmentStandards.mapAlarm:{"vendor":"fanuc","nativeCode":"SRVO-050"}'));
    expect(within(sheet).getByText("COLLISION_DETECT")).toBeInTheDocument();
    expect(within(sheet).getByText(/Dừng và kiểm tra/)).toBeInTheDocument();
  });

  it("'Ánh xạ cảnh báo' = sheet eq-alarm-map: bắt buộc 3 trường, payload đúng, đóng, invalidate danh sách", async () => {
    window.history.replaceState(null, "", "/equipment-standards?tab=alarms");
    render(<EquipmentStandards />);
    const user = userEvent.setup();
    await user.click(within(toolbar()).getByRole("button", { name: /^Ánh xạ cảnh báo$/ }));
    const sheet = await waitLayer("eq-alarm-map");
    await user.click(within(sheet).getByRole("button", { name: /Lưu ánh xạ/ }));
    expect(toastSpy.error).toHaveBeenCalledWith("Nhà cung cấp, mã gốc và mã chuẩn là bắt buộc.");
    await user.type(within(sheet).getByLabelText("Nhà cung cấp"), "kuka");
    await user.type(within(sheet).getByLabelText("Mã gốc"), "K-1");
    await user.type(within(sheet).getByLabelText("Mã chuẩn"), "ESTOP");
    await user.click(within(sheet).getByRole("button", { name: /Lưu ánh xạ/ }));
    await waitFor(() => expect(calls("upsertAlarmMapping")).toEqual([{ vendor: "kuka", nativeCode: "K-1", standardCode: "ESTOP", severity: "medium", description: undefined, recommendedAction: undefined }]));
    await waitFor(() => expect(layer("eq-alarm-map")).toBeNull());
    expect(srv.invalidated).toContain("equipmentStandards.listAlarmMappings");
    expect(within(mainEl()).getByText("K-1")).toBeInTheDocument();
  });
});

describe("Standards — Hiệu năng cảnh báo: chip có nguồn ở panel phụ, Shelve KHOÁ", () => {
  it("panel phụ CHỈ ở tab này (ngoài MAIN); 7 chip; chattering 'Chưa đo được' kèm lý do; số cảnh báo GHIM", async () => {
    render(<EquipmentStandards />);
    expect(sidePanel()).toBeNull();
    await openTab(/Hiệu năng cảnh báo/);
    const side = sidePanel()!;
    expect(side).toBeTruthy();
    expect(mainEl().contains(side)).toBe(false);
    expect(side.querySelectorAll("[data-layout-kpi]")).toHaveLength(7);
    const chat = chip("alarm-kpi-chattering")!;
    expect(chat).toHaveTextContent("Chưa đo được");
    expect(chat.getAttribute("title")).toMatch(/chưa tính chattering/);
    expect(chip("alarm-kpi-total")).toHaveTextContent("5");
    expect(chip("alarm-kpi-flood")).toHaveTextContent("4");
    for (const id of ["alarm-kpi-total", "alarm-kpi-flood", "alarm-kpi-standing"]) expect(chip(id)!.getAttribute("title")).toMatch(/alarmKpi\.summary/);
    expect(within(side).getByTestId("alarm-kpi-source")).toHaveTextContent("3");
    expect(within(side).getByText("M-01")).toBeInTheDocument();
    expect(srv.queryInputs.some((x) => x.startsWith("alarmKpi.summary:") && !x.includes("operatorCount"))).toBe(true);
  });

  it("đổi cửa sổ (hàng công cụ) ⇒ alarmKpi.summary {windowHours: 30×24}", async () => {
    render(<EquipmentStandards />);
    const user = await openTab(/Hiệu năng cảnh báo/);
    await user.click(within(toolbar()).getByRole("combobox", { name: "Cửa sổ thời gian" }));
    await user.click(await screen.findByRole("option", { name: "30 ngày gần nhất" }));
    await waitFor(() => expect(srv.queryInputs).toContain('alarmKpi.summary:{"windowHours":720}'));
  });

  it("Shelve 8h KHOÁ + tooltip; Bỏ tạm ẩn một cú bấm {id, shelvedUntil:null}; xoá một cú bấm {id} (hợp đồng cũ); 'Sửa' mở sheet eq-master&flyoutId", async () => {
    render(<EquipmentStandards />);
    const user = await openTab(/Hiệu năng cảnh báo/);
    const row7 = within(mainEl()).getByText("OVERTEMP").closest("tr") as HTMLElement;
    const shelve = within(row7).getByRole("button", { name: "Tạm ẩn 8h" });
    expect(shelve).toBeDisabled();
    expect(shelve).toHaveAttribute("title", "Chưa có hiệu lực trên đường báo động");
    const row9 = within(mainEl()).getByText("OVERPRESS").closest("tr") as HTMLElement;
    expect(within(row9).getByTestId("master-shelved-9")).toHaveTextContent(/chưa có hiệu lực/i);
    await user.click(within(row9).getByRole("button", { name: "Bỏ tạm ẩn" }));
    await waitFor(() => expect(srv.calls["equipmentStandards.shelveMasterAlarm"]).toEqual([{ id: 9, shelvedUntil: null }]));
    await user.click(within(row7).getByRole("button", { name: "Xóa cảnh báo chuẩn" }));
    await waitFor(() => expect(srv.calls["equipmentStandards.deleteMasterAlarm"]).toEqual([{ id: 7 }]));
    expect(screen.queryAllByRole("alertdialog")).toHaveLength(0);
    await user.click(within(row9).getByRole("button", { name: "Sửa" }));
    const sheet = await waitLayer("eq-master");
    expect(params().get("flyoutId")).toBe("9");
    expect(within(sheet).getByLabelText(/Khóa cảnh báo/)).toHaveValue("OVERPRESS");
  });

  it("'Thêm cảnh báo chuẩn' = sheet eq-master: payload như cũ, đóng, invalidate", async () => {
    render(<EquipmentStandards />);
    const user = await openTab(/Hiệu năng cảnh báo/);
    await user.click(within(toolbar()).getByRole("button", { name: /Thêm cảnh báo chuẩn/ }));
    const sheet = await waitLayer("eq-master");
    await user.click(within(sheet).getByRole("button", { name: /Lưu/ }));
    expect(toastSpy.error).toHaveBeenCalledWith("Khóa cảnh báo là bắt buộc.");
    await user.type(within(sheet).getByLabelText(/Khóa cảnh báo/), "LOWAIR");
    await user.click(within(sheet).getByRole("button", { name: /Lưu/ }));
    await waitFor(() => expect(srv.calls["equipmentStandards.upsertMasterAlarm"]).toEqual([{
      alarmKey: "LOWAIR", assetType: undefined, vendor: undefined, nativeCode: undefined, label: undefined,
      consequence: "minor", timeToRespond: undefined, setpoint: undefined, deadband: undefined, rationalization: undefined, isSuppressed: false,
    }]));
    await waitFor(() => expect(layer("eq-master")).toBeNull());
    expect(srv.invalidated).toContain("equipmentStandards.listMasterAlarms");
  });
});

describe("Standards — CR qua ApprovalQueue (R-2-g: hợp đồng HIỆN TẠI; R-2-n: một lượt gọi mỗi cú bấm)", () => {
  const rowOf = (key: string) => within(mainEl()).getByText(key).closest("tr") as HTMLElement;

  it("Phê duyệt / Từ chối / Duyệt / Xuất bản: MỘT lượt gọi, đúng input cũ, KHÔNG sheet, KHÔNG lý do", async () => {
    window.history.replaceState(null, "", "/equipment-standards?tab=crs");
    render(<EquipmentStandards />);
    expect(screen.getByRole("table", { name: "Hội đồng Tiêu chuẩn Thiết bị" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(rowOf("CR-1")).getByRole("button", { name: "Duyệt" }));
    await user.click(within(rowOf("CR-2")).getByRole("button", { name: "Phê duyệt" }));
    await user.click(within(rowOf("CR-1")).getByRole("button", { name: "Từ chối" }));
    await user.click(within(rowOf("CR-3")).getByRole("button", { name: "Xuất bản" }));
    await waitFor(() => expect(calls("publishChangeRequest")).toEqual([{ crId: 3, stage: "staging" }]));
    expect(calls("reviewChangeRequest")).toEqual([{ crId: 1, to: "in_review" }, { crId: 2, to: "approved" }, { crId: 1, to: "rejected" }]);
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
    expect(srv.invalidated).toContain("equipmentStandards.listChangeRequests");
    expect(toastSpy.success).toHaveBeenCalledWith(expect.stringMatching(/Đã xuất bản yêu cầu thay đổi — v2\.0\.0 \(major, breaking\)/));
  });

  it("nút giữ tooltip cũ (title) khi được phép", () => {
    window.history.replaceState(null, "", "/equipment-standards?tab=crs");
    render(<EquipmentStandards />);
    expect(within(rowOf("CR-2")).getByRole("button", { name: "Phê duyệt" })).toHaveAttribute("title", "Phê duyệt — máy chủ tự tính cổng kiểm định từ lược đồ đề xuất");
    expect(within(rowOf("CR-3")).getByRole("button", { name: "Xuất bản" })).toHaveAttribute("title", "Xuất bản — cổng theo kiểm định + tương thích ngược");
  });

  it("maker-checker: CR do CHÍNH người dùng tạo ⇒ Duyệt/Phê duyệt/Từ chối khoá + lý do; bấm không gọi server", async () => {
    window.history.replaceState(null, "", "/equipment-standards?tab=crs");
    render(<EquipmentStandards />);
    const row = rowOf("CR-6");
    for (const name of ["Duyệt", "Phê duyệt", "Từ chối"]) {
      const b = within(row).getByRole("button", { name });
      expect(b).toBeDisabled();
      expect(b.getAttribute("title")).toMatch(/người tạo mục này/);
    }
    fireEvent.click(within(row).getByRole("button", { name: "Phê duyệt" }));
    expect(calls("reviewChangeRequest")).toHaveLength(0);
  });

  it("trạng thái cuối ⇒ '—'; không có quyền ⇒ 'Chỉ xem' và không có nút; cột giữ loại đích / loại / kiểm định / giai đoạn / cảnh báo không tương thích", () => {
    window.history.replaceState(null, "", "/equipment-standards?tab=crs");
    render(<EquipmentStandards />);
    expect(within(rowOf("CR-4")).queryAllByRole("button")).toHaveLength(0);
    expect(within(rowOf("CR-4")).getByText("—")).toBeInTheDocument();
    const r3 = rowOf("CR-3");
    expect(r3).toHaveTextContent("Robot");
    expect(r3).toHaveTextContent("modify");
    expect(r3).toHaveTextContent("approved");
    expect(r3).toHaveTextContent("pass");
    expect(r3).toHaveTextContent("none");
    expect(within(r3).getByTitle("Không tương thích ngược — cần tăng phiên bản major")).toBeInTheDocument();
    cleanup();
    perm.control = false;
    render(<EquipmentStandards />);
    expect(within(rowOf("CR-1")).queryAllByRole("button")).toHaveLength(0);
    expect(within(rowOf("CR-1")).getByText("Chỉ xem")).toBeInTheDocument();
    expect(within(toolbar()).queryByRole("button", { name: /Gửi CR/ })).toBeNull();
  });

  it("lọc trạng thái (hàng công cụ) ⇒ truy vấn {status, limit:200} như cũ", async () => {
    window.history.replaceState(null, "", "/equipment-standards?tab=crs");
    render(<EquipmentStandards />);
    const user = userEvent.setup();
    await user.click(within(toolbar()).getByRole("combobox", { name: "Trạng thái" }));
    await user.click(await screen.findByRole("option", { name: "approved" }));
    await waitFor(() => expect(srv.queryInputs).toContain('equipmentStandards.listChangeRequests:{"status":"approved","limit":200}'));
  });

  it("'Gửi CR' = sheet eq-cr-new: bắt buộc khoá loại đích, payload lược đồ đề xuất như cũ, đóng, invalidate", async () => {
    window.history.replaceState(null, "", "/equipment-standards?tab=crs");
    render(<EquipmentStandards />);
    const user = userEvent.setup();
    await user.click(within(toolbar()).getByRole("button", { name: /Gửi CR/ }));
    const sheet = await waitLayer("eq-cr-new");
    await user.click(within(sheet).getByRole("button", { name: /^Gửi$/ }));
    expect(toastSpy.error).toHaveBeenCalledWith("Khóa loại đích là bắt buộc.");
    await user.type(within(sheet).getByLabelText("Khóa loại đích"), "Robot");
    await user.click(within(sheet).getByRole("button", { name: /Thêm lệnh/ }));
    await user.type(within(sheet).getByPlaceholderText("tên lệnh"), "home");
    await user.click(within(sheet).getByRole("button", { name: /^Gửi$/ }));
    await waitFor(() => expect(calls("submitChangeRequest")).toEqual([{
      targetTypeKey: "Robot", kind: "modify", semverBump: "minor",
      proposedSchema: { parentTypeKey: undefined, attributesSchema: [], supportedCommands: [{ name: "home" }] },
    }]));
    await waitFor(() => expect(layer("eq-cr-new")).toBeNull());
    expect(srv.invalidated).toContain("equipmentStandards.listChangeRequests");
  });
});

describe("Standards — < 1024 px: công cụ tab vào đầu nội dung tab", () => {
  it("hẹp ⇒ hàng tab không chứa 'Đăng ký loại'; nút nằm ở đầu nội dung tab và vẫn mở sheet", async () => {
    presetNarrow(true);
    render(<EquipmentStandards />);
    expect(within(toolbar()).queryByRole("button", { name: /Đăng ký loại/ })).toBeNull();
    const tools = mainEl().querySelector("[data-narrow-tools]") as HTMLElement;
    await userEvent.setup().click(within(tools).getByRole("button", { name: /Đăng ký loại/ }));
    await waitLayer("eq-type-new");
  });

  it("hẹp ⇒ chip cờ / loại không đạt / ghi chú xuống hàng công cụ (header chỉ còn h1 + dải KPI, chip GHIM vẫn hiện)", () => {
    presetNarrow(true);
    srv.status = { enabled: false };
    render(<EquipmentStandards />);
    expect(header().querySelector("[data-notice-kind]")).toBeNull();
    expect(header().querySelector('[data-chip-id="eq-alarm-vendors"]')).toBeTruthy();
    const tools = document.querySelector("[data-narrow-tools]") as HTMLElement;
    expect(within(tools).getByTestId("feature-status-off")).toBeInTheDocument();
    expect(tools.querySelector('[data-notice-kind="error"]')).toHaveTextContent("1 loại không đạt");
    expect(tools.querySelector('[data-notice-kind="whenToUse"]')).toBeTruthy();
  });
});
