// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 5 — Interlock thành mẫu P3 (danh sách + panel dưới + flyout).
// Hợp đồng (task-5-brief + plan Review Focus 1/3/4 + GC3):
//   - MAIN là danh sách rule (`[data-layout-main]`, trong <main>), thanh công cụ DUY NHẤT trong MAIN là dải
//     tab TabbedHub (`?tab=` = "rules" | "matrix" — Danh sách / Ma trận Cause×Effect). h1 + chip ở header
//     một hàng, NGOÀI MAIN. Không còn khối "Khi nào dùng"/phụ đề nào giữa header và MAIN.
//   - Panel dưới "Sự kiện" (NGOÀI MAIN) lọc theo rule đang chọn (`?rule=<id>`, F5 giữ); `?filter=pending`
//     (deep-link Hub, Đợt 1 Task 2) vẫn lọc rule chưa duyệt + sự kiện "Chưa xử lý".
//   - Sửa/thêm rule = sheet (FlyoutHost `?flyout=rule&flyoutId=<id>` / `?flyout=rule-new`), luồng đầy đủ:
//     mở → nhập → lưu → danh sách cập nhật (sau invalidate) → URL sạch. Cảnh báo "Lưu sẽ tắt rule và cần
//     duyệt lại" (Đợt 1 Task 11) còn trong sheet; giữ nguyên commandValue khi không sửa (doc 80 Task 2).
//   - Test/evaluate = flyout công cụ `?flyout=rule-test&flyoutId=<id>` (dry-run, không ghi gì).
//   - Chip header: tư thế engine / OT / độ phủ đọc `oversight.posture` — 4 trạng thái trung thực.
// Chạy trên wouter THẬT với history của jsdom. "Server" giả là kho trong bộ nhớ: danh sách CHỈ đổi khi trang
// gọi invalidate (như react-query).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { installResizeHandleHitAreaShim } from "@/components/patterns/layoutKitTestPanels";
import { forceNarrowHeader } from "@/components/patterns/layoutKitTestHeaderFold";

vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
const perm = { isAdmin: false, canCreate: true, canEdit: true, canDelete: true };
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: perm.isAdmin,
    hasPermission: (_m: string, a: string) =>
      a === "canCreate" ? perm.canCreate : a === "canEdit" ? perm.canEdit : a === "canDelete" ? perm.canDelete : true,
  }),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 7, name: "Tester", role: "engineer" }, loading: false }),
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));
const trpcErrSpy = vi.hoisted(() => ({ toastTrpcError: vi.fn() }));
vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: trpcErrSpy.toastTrpcError, mapTrpcError: () => "x" }));

// ── "Server" giả ───────────────────────────────────────────────────────────────────────────────
const srv = vi.hoisted(() => ({
  db: [] as Array<Record<string, unknown>>,
  listSnapshot: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  posture: { data: undefined as unknown, isError: false },
  version: 0,
  listeners: new Set<() => void>(),
  nextId: 100,
  calls: { create: [] as unknown[], update: [] as unknown[], approve: [] as unknown[], enable: [] as unknown[], testEvaluate: [] as unknown[] },
  invalidated: [] as string[],
  holdUpdate: null as null | Promise<void>,
  // doc 81 Đợt 3 Task 4
  assignments: [] as Array<Record<string, unknown>>,
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
  const q = (data: unknown, enabled = true, extra: Record<string, unknown> = {}) => ({
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
  const later = (fn: () => void) => {
    void Promise.resolve().then(fn);
  };
  const proc = (router: string, name: string) => ({
    useQuery: (input?: Record<string, unknown>, opts?: { enabled?: boolean }) => {
      useVersion();
      const enabled = opts?.enabled !== false;
      if (router === "interlock" && name === "list") return q(srv.listSnapshot, enabled);
      if (router === "interlock" && name === "events") return q(srv.events, enabled);
      if (router === "engineering" && name === "assignments") return q(srv.assignments, enabled);
      if (router === "engineering" && name === "assignableUsers") return q([{ id: 51, name: "Ky su Rule" }], enabled);
      if (router === "oversight" && name === "posture") {
        if (srv.posture.isError) return q(undefined, enabled, { isError: true, error: { message: "x" } });
        return q(srv.posture.data, enabled, { isLoading: enabled && srv.posture.data === undefined });
      }
      if (router === "interlock" && name === "testEvaluate") {
        if (!enabled) return q(undefined, false);
        srv.calls.testEvaluate.push(input);
        const rule = srv.db.find((r) => r.id === input?.id);
        const thr = Number(rule?.threshold);
        const obs = input?.observedValue as number | undefined;
        return q({ wouldFire: obs != null && obs > thr, outcome: obs != null && obs > thr ? "fire" : "pass", observed: obs ?? null, threshold: thr, note: "dry-run" });
      }
      return q(undefined, enabled);
    },
    useMutation: (hookOpts: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void } = {}) => ({
      isPending: false,
      mutateAsync: vi.fn(),
      mutate: (input: Record<string, unknown>) => {
        if (router === "interlock" && name === "create") {
          srv.calls.create.push(input);
          later(() => {
            const row = { ...BASE_RULE, ...input, id: srv.nextId++, approvedBy: null, enabled: false, versionToken: "v1:moi" };
            srv.db.push(row);
            hookOpts.onSuccess?.(row);
          });
          return;
        }
        if (router === "interlock" && name === "update") {
          srv.calls.update.push(input);
          const run = (fn: () => void) => (srv.holdUpdate ? void srv.holdUpdate.then(fn) : later(fn));
          run(() => {
            const cur = srv.db.find((r) => r.id === input.id);
            if (!cur) return hookOpts.onError?.({ data: { code: "NOT_FOUND" } });
            Object.assign(cur, input, { approvedBy: null, enabled: false });
            hookOpts.onSuccess?.(cur);
          });
          return;
        }
        if (router === "interlock" && name === "approve") srv.calls.approve.push(input);
        if (router === "interlock" && name === "enable") srv.calls.enable.push(input);
      },
    }),
  });
  const utilsProxy = new Proxy(
    {},
    {
      get: (_a, r: string) =>
        new Proxy(
          {},
          {
            get: (_b, p: string) => ({
              invalidate: () => {
                srv.invalidated.push(`${r}.${p}`);
                if (r === "interlock" && p === "list") {
                  srv.listSnapshot = srv.db.map((x) => ({ ...x }));
                  bump();
                }
              },
              setData: () => {},
            }),
          },
        ),
    },
  );
  return {
    trpc: new Proxy(
      {},
      {
        get: (_t, routerName: string) => {
          if (routerName === "useUtils") return () => utilsProxy;
          return new Proxy({}, { get: (_t2, procName: string) => proc(routerName, procName) });
        },
      },
    ),
  };
});

import InterlockRuleManagement from "./InterlockRuleManagement";

const BASE_RULE = {
  description: null, lineId: null, stationId: null, machineId: null, sourceKey: null, comparisonOperator: "gt",
  threshold: "5.000000", windowSize: null, consecutiveCount: null, windowSeconds: null, targetMachineId: null,
  targetAdapterId: null, commandTag: null, commandValue: null, requiresHumanConfirm: true, enabled: false,
  approvedBy: null, approvedAt: null, cooldownSeconds: 300, lastFiredAt: null, createdBy: 1,
  createdAt: new Date("2026-09-27T00:00:00Z"), updatedAt: new Date("2026-09-27T00:00:00Z"), updatedBy: 1,
};
// ORACLE: hàng khai tay. 41 và 43 CHUNG nguyên nhân (ng_rate @ machine #3), khác hệ quả.
const R41 = { ...BASE_RULE, id: 41, name: "rule-41", scope: "machine", machineId: 3, sourceType: "ng_rate", action: "stop_line", targetMachineId: 1, commandTag: "line_stop", commandValue: 1, versionToken: "v1:t41" };
const R42 = { ...BASE_RULE, id: 42, name: "rule-42", scope: "line", lineId: 2, sourceType: "spc_violation", sourceKey: "CPK-A", action: "alert", approvedBy: 9, approvedAt: new Date("2026-09-28T00:00:00Z"), versionToken: "v1:t42" };
const R43 = { ...BASE_RULE, id: 43, name: "rule-43", scope: "machine", machineId: 3, sourceType: "ng_rate", action: "reduce_speed", targetMachineId: 1, enabled: true, versionToken: "v1:t43" };
const ev = (id: number, ruleId: number, status: string, observedValue: string) => ({ id, ruleId, status, observedValue, threshold: "5", action: "alert", firedAt: new Date("2026-09-01T00:00:00Z") });
const POSTURE = {
  otControlEnabled: true, robotControlEnabled: false, dpcDeployEnabled: false, interlockEngineEnabled: false,
  interlockAutoBlockEnabled: false, interlockRulesEnabledWithTarget: 4, interlockCoverageDegraded: false,
  writesOnEngineOff: true, generatedAt: "2026-10-03T00:00:00Z",
};

beforeAll(async () => {
  // Separator của react-resizable-panels nuốt cú bấm trong jsdom — xem layoutKitTestPanels.ts.
  installResizeHandleHitAreaShim();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  srv.db = [R41, R42, R43].map((r) => ({ ...r }));
  srv.listSnapshot = srv.db.map((r) => ({ ...r }));
  srv.events = [ev(1, 41, "open", "11.1"), ev(2, 42, "resolved", "22.2"), ev(3, 42, "open", "33.3"), ev(4, 43, "open", "44.4")];
  srv.posture = { data: { ...POSTURE }, isError: false };
  srv.calls = { create: [], update: [], approve: [], enable: [], testEvaluate: [] };
  srv.invalidated = [];
  srv.nextId = 100;
  srv.holdUpdate = null;
  srv.assignments = [{ entityId: 41, assigneeUserId: 51, assigneeName: "Ky su Rule" }];
  toastSpy.warning.mockClear();
  perm.isAdmin = false;
  perm.canCreate = true;
  perm.canEdit = true;
  perm.canDelete = true;
  toastSpy.error.mockClear();
  toastSpy.success.mockClear();
  trpcErrSpy.toastTrpcError.mockClear();
  localStorage.clear();
  window.history.replaceState(null, "", "/interlock-rules");
});
afterEach(() => cleanup());

const mainEl = () => document.querySelector("[data-layout-main]") as HTMLElement;
const rowOf = (name: string) => within(mainEl()).getByText(name).closest("tr") as HTMLElement;
const params = () => new URLSearchParams(window.location.search);
const VI_TOGGLE = "Ẩn/hiện panel dưới";
const eventsPanel = () => screen.getByRole("region", { name: "Sự kiện" });
const layer = (key: string) => document.querySelector(`[data-flyout-key="${key}"]`) as HTMLElement | null;
const waitLayer = (key: string) =>
  waitFor(() => {
    const l = layer(key);
    expect(l).toBeTruthy();
    return l as HTMLElement;
  });
/** Giá trị quan sát (cột 3) của các hàng sự kiện đang hiện — duy nhất theo sự kiện. */
const shownEvents = () =>
  within(eventsPanel())
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelectorAll("td")[2]?.textContent ?? "")
    .filter((x) => /\d/.test(x));

describe("Interlock P3 — bố cục: MAIN là danh sách rule", () => {
  it("MAIN chứa bảng rule + đúng MỘT thanh công cụ (dải tab TabbedHub); h1/chip ở header, ngoài MAIN", () => {
    render(<InterlockRuleManagement />);
    const m = mainEl();
    expect(m).toBeTruthy();
    expect(m.closest("main")).toBeTruthy();
    expect(m.querySelector("table")).toBeTruthy();
    expect(m.querySelector("h1")).toBeNull();
    expect(m.querySelector("[data-layout-header]")).toBeNull();
    expect(m.querySelector("[data-layout-kpi]")).toBeNull();
    const toolbars = m.querySelectorAll("[data-layout-toolbar]");
    expect(toolbars).toHaveLength(1);
    const tabs = within(toolbars[0] as HTMLElement).getAllByRole("tab").map((x) => x.textContent);
    expect(tabs).toEqual(["Danh sách", "Ma trận Cause×Effect"]);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Quản lý quy tắc Interlock");
    expect(h1.closest("[data-layout-header]")).toBeTruthy();
    for (const r of [R41, R42, R43]) expect(within(m).getByText(r.name)).toBeTruthy();
  });

  it("câu 'Khi nào dùng' + phụ đề không còn là khối trên MAIN: nằm trong chip header (popover)", async () => {
    render(<InterlockRuleManagement />);
    expect(screen.queryByText(/định nghĩa quy tắc an toàn tự động dừng/)).toBeNull();
    expect(screen.queryByText(/Trang KHÔNG ghi lệnh xuống máy/)).toBeNull();
    const header = screen.getByRole("heading", { level: 1 }).closest("[data-layout-header]") as HTMLElement;
    await userEvent.click(within(header).getByRole("button", { name: /Khi nào dùng/ }));
    expect(await screen.findByText(/định nghĩa quy tắc an toàn tự động dừng/)).toBeTruthy();
    expect(screen.getByText(/Trang KHÔNG ghi lệnh xuống máy/)).toBeTruthy();
  });

  it("thiếu quyền tạo ⇒ nút 'Thêm quy tắc' vẫn hiện nhưng khoá, có lý do (U4 hiện-nhưng-khoá)", () => {
    perm.canCreate = false;
    render(<InterlockRuleManagement />);
    const btn = screen.getByRole("button", { name: /Thêm quy tắc/ });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toMatch(/interlock/);
  });
});

describe("Interlock P3 — final wave M-10: cột thao tác dính phải (không bị cắt ở 1366)", () => {
  it("tiêu đề + mọi ô cột Thao tác của bảng rule là sticky right-0 có nền (nút Duyệt luôn thấy khi bảng cuộn ngang)", () => {
    render(<InterlockRuleManagement />);
    const table = mainEl().querySelector("table") as HTMLElement;
    const head = table.querySelector("thead th:last-child") as HTMLElement;
    const cells = Array.from(table.querySelectorAll("tbody tr td:last-child")) as HTMLElement[];
    expect(cells.length).toBeGreaterThan(0);
    for (const el of [head, ...cells]) {
      expect(el.className).toMatch(/(^|\s)sticky(\s|$)/);
      expect(el.className).toMatch(/(^|\s)right-0(\s|$)/);
      expect(el.className).toMatch(/(^|\s)bg-background(\s|$)/);
    }
  });
});

describe("Interlock P3 — chip tư thế trên header (oversight.posture)", () => {
  const chip = (id: string) => document.querySelector(`[data-layout-kpi="${id}"]`) as HTMLElement;

  it("engine / OT / độ phủ: giá trị từ posture, nằm trong header; ghi thật khi engine TẮT ⇒ tô cảnh báo + chip cảnh báo", async () => {
    render(<InterlockRuleManagement />);
    const header = screen.getByRole("heading", { level: 1 }).closest("[data-layout-header]") as HTMLElement;
    for (const id of ["engine", "ot", "coverage"]) expect(header.contains(chip(id))).toBe(true);
    expect(chip("engine")).toHaveTextContent("Engine");
    expect(chip("engine")).toHaveTextContent("TẮT");
    expect(chip("ot")).toHaveTextContent("BẬT");
    expect(chip("coverage")).toHaveTextContent("4");
    for (const id of ["engine", "ot", "coverage"]) expect(chip(id).getAttribute("data-state")).toBe("ok");
    expect(chip("engine").querySelector(".text-warning")).toBeTruthy();
    await userEvent.click(within(header).getByRole("button", { name: /Ghi thật khi engine TẮT/ }));
    expect(await screen.findByText(/vi phạm sẽ KHÔNG được tự động chặn/)).toBeTruthy();
  });

  it("đang tải ⇒ không in số; lỗi ⇒ 'Lỗi', không in 0; độ phủ không đọc được ⇒ chip độ phủ lỗi (không '0')", () => {
    srv.posture = { data: undefined, isError: false };
    render(<InterlockRuleManagement />);
    expect(chip("coverage").getAttribute("data-state")).toBe("loading");
    expect(chip("engine").getAttribute("data-state")).toBe("loading");
    cleanup();
    srv.posture = { data: undefined, isError: true };
    render(<InterlockRuleManagement />);
    expect(chip("engine").getAttribute("data-state")).toBe("error");
    expect(chip("coverage")).not.toHaveTextContent(/\d/);
    cleanup();
    srv.posture = { data: { ...POSTURE, interlockCoverageDegraded: true, interlockRulesEnabledWithTarget: 0, writesOnEngineOff: false }, isError: false };
    render(<InterlockRuleManagement />);
    expect(chip("coverage").getAttribute("data-state")).toBe("error");
    expect(chip("coverage")).not.toHaveTextContent("0");
    expect(chip("engine").getAttribute("data-state")).toBe("ok");
    expect(screen.queryByRole("button", { name: /Ghi thật khi engine TẮT/ })).toBeNull();
  });

  // doc 81 Đợt 3b final wave (I1): ở 768/1024 px header GỘP — trước: "chip+3" xám, tư thế engine/OT im lặng (Engine TẮT có tông
  // default). Nay ba chip tư thế GHIM (R-2-p) ⇒ luôn hiện; chỉ "Khi nào dùng" vào "+1"; cảnh báo ILK-06 (lỗi) vẫn hiện.
  it("header HẸP (gộp) ⇒ engine / OT / độ phủ VẪN hiện thẳng (ghim), không vào '+N'; 'Khi nào dùng' vào '+1'", () => {
    const restore = forceNarrowHeader();
    try {
      render(<InterlockRuleManagement />);
      const header = screen.getByRole("heading", { level: 1 }).closest("[data-layout-header]") as HTMLElement;
      expect(header.getAttribute("data-header-fit")).not.toBeNull();
      const strip = header.querySelector("[data-status-chip-strip]") as HTMLElement;
      expect(Array.from(strip.querySelectorAll(":scope > [data-chip-id]")).map((x) => x.getAttribute("data-chip-id"))).toEqual(["engine", "ot", "coverage"]);
      expect(strip.querySelector("[data-chip-more]")).toBeNull();
      expect(within(header).getByRole("button", { name: /Ghi thật khi engine TẮT/ })).toBeTruthy();
      const more = header.querySelector("[data-notice-stack] [data-notice-more]") as HTMLElement;
      expect(more.getAttribute("data-notice-more")).toBe("1");
    } finally {
      restore();
    }
  });
});

describe("Interlock P3 — panel dưới Sự kiện lọc theo rule đang chọn", () => {
  it("panel Sự kiện nằm NGOÀI MAIN và hiện mọi sự kiện khi chưa chọn rule", () => {
    render(<InterlockRuleManagement />);
    const panel = eventsPanel();
    expect(mainEl().contains(panel)).toBe(false);
    expect(shownEvents()).toEqual(["11.1", "22.2", "33.3", "44.4"]);
  });

  it("bấm một hàng rule ⇒ ?rule=<id>, hàng được chọn, panel chỉ còn sự kiện của rule đó; bỏ lọc ⇒ hiện lại tất cả", async () => {
    render(<InterlockRuleManagement />);
    await userEvent.click(within(rowOf("rule-42")).getByText("rule-42"));
    expect(params().get("rule")).toBe("42");
    expect(rowOf("rule-42")).toHaveAttribute("aria-current", "true");
    expect(rowOf("rule-41")).not.toHaveAttribute("aria-current");
    expect(shownEvents()).toEqual(["22.2", "33.3"]);
    await userEvent.click(within(eventsPanel()).getByRole("button", { name: /Bỏ lọc theo quy tắc/ }));
    expect(params().get("rule")).toBeNull();
    expect(shownEvents()).toEqual(["11.1", "22.2", "33.3", "44.4"]);
  });

  it("chọn bằng bàn phím (Enter trên hàng) cũng lọc; nút trong hàng KHÔNG đổi lựa chọn", async () => {
    perm.isAdmin = true;
    render(<InterlockRuleManagement />);
    fireEvent.keyDown(rowOf("rule-43"), { key: "Enter" });
    expect(params().get("rule")).toBe("43");
    expect(shownEvents()).toEqual(["44.4"]);
    await userEvent.click(within(rowOf("rule-41")).getByRole("button", { name: "Duyệt" }));
    expect(srv.calls.approve).toHaveLength(1);
    expect(params().get("rule")).toBe("43");
  });

  it("F5 với ?rule=42 giữ bộ lọc (chip tên rule trong panel)", async () => {
    window.history.replaceState(null, "", "/interlock-rules?rule=42");
    render(<InterlockRuleManagement />);
    expect(shownEvents()).toEqual(["22.2", "33.3"]);
    expect(within(eventsPanel()).getByText("Quy tắc: rule-42")).toBeTruthy();
  });

  it("?filter=pending (deep-link Hub): chỉ rule chưa duyệt + sự kiện 'Chưa xử lý'; 'Xem tất cả' gỡ lọc rule", async () => {
    window.history.replaceState(null, "", "/interlock-rules?filter=pending");
    render(<InterlockRuleManagement />);
    const m = mainEl();
    expect(within(m).queryByText("rule-42")).toBeNull();
    expect(within(m).getByText("rule-41")).toBeTruthy();
    expect(within(m).getByText("rule-43")).toBeTruthy();
    expect(shownEvents()).toEqual(["11.1", "33.3", "44.4"]);
    const toolbar = m.querySelector("[data-layout-toolbar]") as HTMLElement;
    await userEvent.click(within(toolbar).getByRole("button", { name: "Xem tất cả" }));
    expect(within(mainEl()).getByText("rule-42")).toBeTruthy();
  });

  it("nút 'Giải quyết' (ConfirmWithReason) vẫn ở hàng sự kiện chưa xử lý", () => {
    render(<InterlockRuleManagement />);
    expect(within(eventsPanel()).getAllByRole("button", { name: "Giải quyết" })).toHaveLength(3);
  });
});

// ── Fix round 1 — Ruling R-2-l: panel Sự kiện gập lần đầu, mở theo ý định; đếm chưa xử lý luôn thấy ──
describe("Interlock P3 — R-2-l: panel Sự kiện gập lần đầu, mở theo ý định", () => {
  const toggle = () => screen.getByRole("button", { name: VI_TOGGLE });
  const isOpen = () => toggle().getAttribute("aria-expanded") === "true";
  const openBtn = () => screen.getByTestId("events-open-button");

  it("lần đầu: panel GẬP; nút 'Sự kiện' + số chưa xử lý (3) nằm trong thanh công cụ của MAIN, ngoài panel", () => {
    render(<InterlockRuleManagement />);
    expect(isOpen()).toBe(false);
    const toolbar = mainEl().querySelector("[data-layout-toolbar]") as HTMLElement;
    expect(toolbar).toContainElement(openBtn());
    expect(openBtn()).toHaveTextContent("3");
    expect(openBtn()).toHaveAccessibleName("Mở panel Sự kiện — 3 chưa xử lý");
    expect(eventsPanel()).not.toContainElement(openBtn());
  });

  it("bấm nút đếm ⇒ panel mở (không đổi bộ lọc rule)", async () => {
    render(<InterlockRuleManagement />);
    await userEvent.click(openBtn());
    expect(isOpen()).toBe(true);
    expect(params().get("rule")).toBeNull();
  });

  it("chọn một rule (hàng) ⇒ panel mở; chọn trong ma trận cũng mở", async () => {
    render(<InterlockRuleManagement />);
    await userEvent.click(within(rowOf("rule-42")).getByText("rule-42"));
    expect(isOpen()).toBe(true);
    // người dùng gập lại rồi chọn rule KHÁC ⇒ lại mở (ý định mới)
    await userEvent.click(toggle());
    expect(isOpen()).toBe(false);
    await userEvent.click(within(rowOf("rule-41")).getByText("rule-41"));
    expect(isOpen()).toBe(true);
    cleanup();
    localStorage.clear();
    window.history.replaceState(null, "", "/interlock-rules?tab=matrix");
    render(<InterlockRuleManagement />);
    expect(isOpen()).toBe(false);
    await userEvent.click(within(mainEl()).getByRole("button", { name: "rule-43" }));
    expect(isOpen()).toBe(true);
  });

  it("deep-link ?rule=42 hoặc ?filter=pending ⇒ panel mở ngay khi nạp", () => {
    window.history.replaceState(null, "", "/interlock-rules?rule=42");
    render(<InterlockRuleManagement />);
    expect(isOpen()).toBe(true);
    cleanup();
    localStorage.clear();
    window.history.replaceState(null, "", "/interlock-rules?filter=pending");
    render(<InterlockRuleManagement />);
    expect(isOpen()).toBe(true);
  });

  it("lựa chọn của người dùng được nhớ: tự mở bằng nút gập ⇒ lần nạp sau mở sẵn", async () => {
    const r = render(<InterlockRuleManagement />);
    await userEvent.click(toggle());
    expect(isOpen()).toBe(true);
    r.unmount();
    render(<InterlockRuleManagement />);
    expect(isOpen()).toBe(true);
  });

  it("toast sự kiện mới có hành động 'Mở panel Sự kiện' — bấm ⇒ panel mở", async () => {
    render(<InterlockRuleManagement />);
    expect(isOpen()).toBe(false);
    srv.events = [...srv.events, ev(9, 41, "open", "99.9")];
    // final wave T11b-7 — act của testing-library (bật môi trường act) thay React.act: hết cảnh báo "not configured to support act".
    act(() => bump());
    await waitFor(() => expect(toastSpy.warning).toHaveBeenCalled());
    const opts = toastSpy.warning.mock.calls.at(-1)?.[1] as { action?: { label: string; onClick: () => void } };
    expect(opts.action?.label).toBe("Mở panel Sự kiện");
    act(() => opts.action?.onClick());
    expect(isOpen()).toBe(true);
  });
});

describe("Interlock P3 — TabbedHub: Danh sách / Ma trận Cause×Effect (?tab=)", () => {
  it("bấm tab Ma trận ⇒ ?tab=matrix; ma trận: hàng = nguyên nhân, cột = hệ quả, rule nằm đúng ô", async () => {
    render(<InterlockRuleManagement />);
    await userEvent.click(screen.getByRole("tab", { name: "Ma trận Cause×Effect" }));
    expect(params().get("tab")).toBe("matrix");
    const table = within(mainEl()).getByRole("table", { name: "Ma trận Cause×Effect" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3); // tiêu đề + 2 nguyên nhân (41 và 43 chung nguyên nhân)
    const head = [...rows[0].querySelectorAll("th")].map((c) => c.textContent ?? "");
    expect(head).toHaveLength(4); // góc + 3 hệ quả
    expect(head[0]).toBe("Nguyên nhân ↓ · Hệ quả →");
    const cellOf = (name: string) => within(table).getByRole("button", { name }).closest("td") as HTMLTableCellElement;
    const causeOf = (name: string) => (cellOf(name).closest("tr") as HTMLTableRowElement).querySelector("th")?.textContent ?? "";
    const effectOf = (name: string) => head[cellOf(name).cellIndex];
    expect(causeOf("rule-41")).toMatch(/ng_rate/);
    expect(causeOf("rule-41")).toMatch(/machine #3/);
    expect(causeOf("rule-43")).toBe(causeOf("rule-41"));
    expect(effectOf("rule-41")).toMatch(/stop_line/);
    expect(effectOf("rule-41")).toMatch(/máy #1/);
    expect(effectOf("rule-43")).toMatch(/reduce_speed/);
    expect(causeOf("rule-42")).toMatch(/spc_violation · CPK-A/);
    expect(effectOf("rule-42")).toMatch(/alert/);
    expect(effectOf("rule-42")).toMatch(/không đích/);
    // bấm rule trong ma trận ⇒ chọn rule (panel Sự kiện lọc theo nó)
    await userEvent.click(within(table).getByRole("button", { name: "rule-43" }));
    expect(params().get("rule")).toBe("43");
    expect(shownEvents()).toEqual(["44.4"]);
  });

  it("F5 với ?tab=matrix mở thẳng ma trận; ?tab lạ ⇒ Danh sách", () => {
    window.history.replaceState(null, "", "/interlock-rules?tab=matrix");
    render(<InterlockRuleManagement />);
    expect(within(mainEl()).getByRole("table", { name: "Ma trận Cause×Effect" })).toBeTruthy();
    cleanup();
    window.history.replaceState(null, "", "/interlock-rules?tab=khong-co");
    render(<InterlockRuleManagement />);
    expect(screen.getByRole("tab", { name: "Danh sách" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Interlock P3 — sheet sửa rule (luồng đầy đủ)", () => {
  it("Sửa rule-41: ?flyout=rule&flyoutId=41, sheet điền sẵn; đổi tên → Lưu ⇒ update đúng payload (commandValue giữ nguyên) ⇒ danh sách cập nhật ⇒ URL sạch", async () => {
    render(<InterlockRuleManagement />);
    await userEvent.click(within(rowOf("rule-41")).getByRole("button", { name: "Sửa quy tắc" }));
    expect(params().get("flyout")).toBe("rule");
    expect(params().get("flyoutId")).toBe("41");
    const l = await waitLayer("rule");
    expect(l.getAttribute("data-slot")).toBe("sheet-content");
    expect(within(l).queryByTestId("edit-approved-warning")).toBeNull();
    const name = within(l).getByLabelText("Tên");
    expect(name).toHaveValue("rule-41");
    await userEvent.clear(name);
    await userEvent.type(name, "  rule-41-moi  ");
    await userEvent.click(within(l).getByRole("button", { name: "Lưu" }));
    expect(srv.calls.update).toEqual([
      {
        id: 41, name: "rule-41-moi", description: undefined, scope: "machine", lineId: null, stationId: null, machineId: 3,
        sourceType: "ng_rate", sourceKey: null, comparisonOperator: "gt", threshold: 5, windowSize: null, consecutiveCount: null,
        windowSeconds: null, action: "stop_line", targetMachineId: 1, targetAdapterId: null, commandTag: "line_stop", commandValue: 1,
        cooldownSeconds: 300,
      },
    ]);
    await waitFor(() => expect(layer("rule")).toBeNull());
    expect(params().get("flyout")).toBeNull();
    expect(within(mainEl()).getByText("rule-41-moi")).toBeTruthy();
    expect(srv.invalidated).toContain("interlock.list");
    expect(toastSpy.success).toHaveBeenCalledWith("Đã cập nhật quy tắc");
  });

  it("Sửa rule ĐÃ DUYỆT (rule-42) ⇒ sheet hiện cảnh báo 'Lưu sẽ tắt rule và cần duyệt lại' trước khi Lưu", async () => {
    render(<InterlockRuleManagement />);
    await userEvent.click(within(rowOf("rule-42")).getByRole("button", { name: "Sửa quy tắc" }));
    const l = await waitLayer("rule");
    expect(within(l).getByTestId("edit-approved-warning")).toHaveTextContent("Lưu sẽ tắt rule và cần duyệt lại");
  });

  it("F5 với ?flyout=rule&flyoutId=43 dựng lại sheet sửa (rule đang bật ⇒ có cảnh báo); giữ ?rule=", async () => {
    window.history.replaceState(null, "", "/interlock-rules?rule=43&flyout=rule&flyoutId=43");
    render(<InterlockRuleManagement />);
    const l = await waitLayer("rule");
    expect(within(l).getByLabelText("Tên")).toHaveValue("rule-43");
    expect(within(l).getByTestId("edit-approved-warning")).toBeTruthy();
    expect(params().get("rule")).toBe("43");
  });

  it("commandValue sai kiểu ⇒ báo lỗi, KHÔNG gọi update, sheet giữ mở; tên trống ⇒ nút Lưu khoá", async () => {
    render(<InterlockRuleManagement />);
    await userEvent.click(within(rowOf("rule-41")).getByRole("button", { name: "Sửa quy tắc" }));
    const l = await waitLayer("rule");
    const cv = within(l).getByLabelText("Command value");
    await userEvent.clear(cv);
    await userEvent.type(cv, "abc");
    // kiểu đang chọn = Số (suy từ giá trị gốc 1) ⇒ "abc" không hợp lệ
    await userEvent.click(within(l).getByRole("button", { name: "Lưu" }));
    expect(toastSpy.error).toHaveBeenCalledWith("Giá trị không phải là số hợp lệ.");
    expect(srv.calls.update).toHaveLength(0);
    expect(layer("rule")).toBeTruthy();
    await userEvent.clear(within(l).getByLabelText("Tên"));
    expect(within(l).getByRole("button", { name: "Lưu" })).toBeDisabled();
  });

  it("đã sửa rồi Esc ⇒ hỏi 'Bỏ thay đổi chưa lưu?'; chưa sửa ⇒ Esc đóng ngay, URL sạch", async () => {
    render(<InterlockRuleManagement />);
    await userEvent.click(within(rowOf("rule-41")).getByRole("button", { name: "Sửa quy tắc" }));
    await waitLayer("rule");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(layer("rule")).toBeNull());
    expect(params().get("flyout")).toBeNull();
    await userEvent.click(within(rowOf("rule-41")).getByRole("button", { name: "Sửa quy tắc" }));
    const l = await waitLayer("rule");
    await userEvent.type(within(l).getByLabelText("Tên"), "x");
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByText("Bỏ thay đổi chưa lưu?")).toBeTruthy();
  });

  it("review M3: Lưu đang chờ, người dùng Bỏ sheet rồi mở công cụ Test ⇒ khi Lưu xong KHÔNG đóng lớp Test", async () => {
    let release = () => {};
    srv.holdUpdate = new Promise<void>((r) => {
      release = r;
    });
    render(<InterlockRuleManagement />);
    await userEvent.click(within(rowOf("rule-41")).getByRole("button", { name: "Sửa quy tắc" }));
    const l = await waitLayer("rule");
    await userEvent.type(within(l).getByLabelText("Tên"), "x");
    await userEvent.click(within(l).getByRole("button", { name: "Lưu" }));
    expect(srv.calls.update).toHaveLength(1);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(await screen.findByRole("button", { name: "Bỏ thay đổi" }));
    await waitFor(() => expect(layer("rule")).toBeNull());
    await userEvent.click(within(rowOf("rule-42")).getByRole("button", { name: "Test (dry-run)" }));
    await waitLayer("rule-test");
    release();
    await waitFor(() => expect(srv.invalidated).toContain("interlock.list"));
    await new Promise((r) => setTimeout(r, 50));
    expect(layer("rule-test")).toBeTruthy();
    expect(params().get("flyout")).toBe("rule-test");
  });

  it("thiếu quyền sửa ⇒ deep-link ?flyout=rule&flyoutId=41 không mở form", async () => {
    perm.canEdit = false;
    window.history.replaceState(null, "", "/interlock-rules?flyout=rule&flyoutId=41");
    render(<InterlockRuleManagement />);
    expect(layer("rule")).toBeNull();
    expect(within(rowOf("rule-41")).getByRole("button", { name: "Sửa quy tắc" })).toBeDisabled();
  });
});

describe("Interlock P3 — thêm rule qua sheet (luồng đầy đủ)", () => {
  it("'Thêm quy tắc' ⇒ ?flyout=rule-new; nhập → Lưu ⇒ create đúng payload ⇒ rule mới trong danh sách ⇒ URL sạch, không cảnh báo duyệt lại", async () => {
    render(<InterlockRuleManagement />);
    await userEvent.click(screen.getByRole("button", { name: /Thêm quy tắc/ }));
    expect(params().get("flyout")).toBe("rule-new");
    const l = await waitLayer("rule-new");
    expect(within(l).queryByTestId("edit-approved-warning")).toBeNull();
    await userEvent.type(within(l).getByLabelText("Tên"), "rule-moi");
    await userEvent.type(within(l).getByLabelText("Ngưỡng"), "7");
    await userEvent.click(within(l).getByRole("button", { name: "Lưu" }));
    expect(srv.calls.create).toEqual([
      {
        name: "rule-moi", description: undefined, scope: "machine", lineId: null, stationId: null, machineId: null,
        sourceType: "ng_rate", sourceKey: null, comparisonOperator: "gt", threshold: 7, windowSize: null, consecutiveCount: null,
        windowSeconds: null, action: "alert", targetMachineId: null, targetAdapterId: null, commandTag: null, commandValue: null,
        cooldownSeconds: 300,
      },
    ]);
    await waitFor(() => expect(layer("rule-new")).toBeNull());
    expect(params().get("flyout")).toBeNull();
    expect(within(mainEl()).getByText("rule-moi")).toBeTruthy();
    expect(toastSpy.success).toHaveBeenCalledWith("Đã tạo quy tắc (tắt + chưa duyệt)");
  });

  it("thiếu quyền tạo ⇒ deep-link ?flyout=rule-new không mở form", () => {
    perm.canCreate = false;
    window.history.replaceState(null, "", "/interlock-rules?flyout=rule-new");
    render(<InterlockRuleManagement />);
    expect(layer("rule-new")).toBeNull();
  });
});

describe("Interlock P3 — flyout công cụ Test (dry-run)", () => {
  it("nút Test trên hàng ⇒ ?flyout=rule-test&flyoutId=41; nhập giá trị → Chạy test ⇒ testEvaluate(id, observedValue) ⇒ kết quả; Esc đóng, URL sạch", async () => {
    render(<InterlockRuleManagement />);
    await userEvent.click(within(rowOf("rule-41")).getByRole("button", { name: "Test (dry-run)" }));
    expect(params().get("flyout")).toBe("rule-test");
    expect(params().get("flyoutId")).toBe("41");
    const l = await waitLayer("rule-test");
    expect(l.getAttribute("data-slot")).toBe("sheet-content");
    expect(within(l).getByText(/rule-41/)).toBeTruthy();
    expect(srv.calls.testEvaluate).toHaveLength(0); // chưa chạy khi chưa bấm
    await userEvent.type(within(l).getByLabelText("Giá trị quan sát"), "7");
    await userEvent.click(within(l).getByRole("button", { name: "Chạy test" }));
    expect(srv.calls.testEvaluate.at(-1)).toEqual({ id: 41, observedValue: 7, series: undefined });
    expect(within(l).getByText("Có")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(layer("rule-test")).toBeNull());
    expect(params().get("flyout")).toBeNull();
  });

  it("F5 với ?flyout=rule-test&flyoutId=42 mở lại công cụ cho đúng rule", async () => {
    window.history.replaceState(null, "", "/interlock-rules?flyout=rule-test&flyoutId=42");
    render(<InterlockRuleManagement />);
    const l = await waitLayer("rule-test");
    expect(within(l).getByText(/rule-42/)).toBeTruthy();
  });
});

describe("Interlock P3 — token phiên bản khi duyệt/bật (Đợt 1 Task 9) giữ nguyên trong bố cục mới", () => {
  it("Duyệt/Bật trên hàng gửi versionToken của CHÍNH hàng đó", async () => {
    perm.isAdmin = true;
    render(<InterlockRuleManagement />);
    await userEvent.click(within(rowOf("rule-41")).getByRole("button", { name: "Duyệt" }));
    expect(srv.calls.approve).toEqual([{ id: 41, expectedVersion: "v1:t41" }]);
    await userEvent.click(within(rowOf("rule-42")).getByRole("button", { name: "Bật" }));
    expect(srv.calls.enable).toEqual([{ id: 42, expectedVersion: "v1:t42" }]);
  });
});

describe("Interlock P3 — i18n: mọi khoá trang dùng có chuỗi ở vi/en/zh", () => {
  it("khoá literal t(\"interlockRules.…\"/\"oversight.…\"/\"common.…\") đủ 3 ngôn ngữ", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(process.cwd(), "client/src");
    const src = fs.readFileSync(path.join(dir, "pages/InterlockRuleManagement.tsx"), "utf8");
    const keys = new Set([...src.matchAll(/t\("((?:interlockRules|oversight|common)\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]));
    expect(keys.size).toBeGreaterThan(80);
    const get = (o: unknown, k: string) => k.split(".").reduce<unknown>((a, p) => (a && typeof a === "object" ? (a as Record<string, unknown>)[p] : undefined), o);
    const missing: string[] = [];
    for (const lng of ["vi", "en", "zh"]) {
      const dict = JSON.parse(fs.readFileSync(path.join(dir, `i18n/locales/${lng}.json`), "utf8"));
      for (const k of keys) {
        const v = get(dict, k);
        if (typeof v !== "string" || v.trim() === "") missing.push(`${lng}:${k}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("doc 81 Đợt 3 Task 4 — 'Giao cho' (sheet rule) + cột 'Người được giao'", () => {
  it("danh sách có cột 'Người được giao' (rule-41 ⇒ tên; rule-43 ⇒ —); dòng trống trải đủ 9 cột", () => {
    render(<InterlockRuleManagement />);
    expect(screen.getByRole("columnheader", { name: "Người được giao" })).toBeInTheDocument();
    expect(rowOf("rule-41").querySelector("[data-assignee-cell]")).toHaveTextContent("Ky su Rule");
    expect(rowOf("rule-43").querySelector("[data-assignee-cell]")).toHaveTextContent("—");
  });

  it("sheet rule CHƯA DUYỆT ⇒ bộ chọn 'Giao cho' ở đầu sheet; rule ĐÃ DUYỆT ⇒ không có", async () => {
    window.history.replaceState(null, "", "/interlock-rules?flyout=rule&flyoutId=41");
    render(<InterlockRuleManagement />);
    const l = await waitLayer("rule");
    const ctl = l.querySelector('[data-assign-control="interlock_rule"]') as HTMLElement;
    expect(within(ctl).getByRole("combobox", { name: "Giao cho" })).toHaveTextContent("Ky su Rule");
    cleanup();
    window.history.replaceState(null, "", "/interlock-rules?flyout=rule&flyoutId=42");
    render(<InterlockRuleManagement />);
    const l2 = await waitLayer("rule");
    expect(l2.querySelector("[data-assign-control]")).toBeNull();
  });
});
