// @vitest-environment jsdom
//
// Doc 81 Đợt 3 Task 3 — Sản xuất › Ca: bảng phân công nhân lực theo ca (trước là tab `?tab=workforce` của Safety &
// Workforce). Hợp đồng (task-3-brief + plan GC3/GC4/R-2-n + Review Focus 1):
//   - Danh sách phân công theo ca là MAIN (một hàng công cụ: lọc ca `?shift=` theo shift_configs, lọc trạng thái
//     `?status=`, Phân công) + chi tiết trong flyout (`?flyout=workforce-detail&flyoutId=`); bảng hiện trường ở panel phụ.
//   - Phân công / phân công lại = sheet, MỘT lượt gọi, payload + kiểm tra như cũ; xác nhận = một cú bấm `{assignmentId}`;
//     đóng = AlertDialog `{assignmentId}`; mỗi thao tác làm mới ĐÚNG tập truy vấn của `refetchAll` Safety cũ.
//   - Cổng như cũ: thiếu machine_control/canCreate ⇒ nút khoá kèm lý do, không sheet; cờ nhân lực CHƯA RÕ ⇒ khoá.
//   - Phối hợp người↔robot KHÔNG ở đây (một chỗ duy nhất bắt đầu phối hợp = Safety).
// Oracle payload / câu kiểm tra / toast: chép từ test cũ của tab Safety (SafetyWorkforce.layout.dom.test.tsx và
// SafetyWorkforce.dom.test.tsx trước Đợt 3 Task 3), không suy từ mã mới.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { installMatchMedia, presetNarrow, setNarrow } from "@/components/patterns/layoutKitTestMedia";

const VI = vi_ as unknown as Record<string, unknown>;
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

// ── "Server" giả: truy vấn CHỈ đổi khi trang gọi invalidate đúng thủ tục (như react-query) ───────────────
type Row = Record<string, unknown>;
const srv = vi.hoisted(() => ({
  status: { safetyAudit: true, workforce: true } as Row | undefined,
  statusError: false,
  board: [] as Row[],
  boardError: false,
  assignments: [] as Row[],
  assignError: false,
  assignLoading: false,
  shifts: [] as Row[],
  shiftsError: false,
  snap: { board: [] as Row[], assignments: [] as Row[] },
  version: 0,
  listeners: new Set<() => void>(),
  calls: {} as Record<string, unknown[]>,
  invalidated: [] as string[],
  queryInputs: [] as string[],
  queryPaths: new Set<string>(),
  mutationPaths: new Set<string>(),
  mutationError: null as null | Error,
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
      if (srv.mutationError) throw srv.mutationError;
      if (path === "safety.assignOperator") srv.assignments.unshift(assignment(90, "planned", { operatorId: input.operatorId }));
      if (path === "safety.reassignOperator") Object.assign(srv.assignments.find((a) => a.id === input.assignmentId)!, { operatorId: input.operatorId });
      if (path === "safety.confirmAssignment") Object.assign(srv.assignments.find((a) => a.id === input.assignmentId)!, { status: "active" });
      if (path === "safety.closeAssignment") Object.assign(srv.assignments.find((a) => a.id === input.assignmentId)!, { status: "completed" });
      return { ok: true };
    });
  const hooks = (path: string) => ({
    useQuery: (input?: Row, opts?: { enabled?: boolean }) => {
      useVersion();
      const enabled = opts?.enabled !== false;
      srv.queryPaths.add(path);
      if (enabled) srv.queryInputs.push(`${path}:${JSON.stringify(input ?? null)}`);
      if (path === "safety.status")
        return srv.statusError ? q(undefined, enabled, { isError: true }) : srv.status === undefined ? q(undefined, enabled, { isLoading: true, isPending: true }) : q(srv.status, enabled);
      if (path === "safety.currentBoard") return srv.boardError ? q(undefined, enabled, { isError: true }) : q(srv.snap.board, enabled);
      if (path === "safety.listAssignments") {
        if (srv.assignError) return q(undefined, enabled, { isError: true });
        if (srv.assignLoading) return q(undefined, enabled, { isLoading: true, isPending: true });
        return q(srv.snap.assignments.filter((a) => !input?.status || a.status === input.status), enabled);
      }
      if (path === "shiftConfig.list") return srv.shiftsError ? q(undefined, enabled, { isError: true }) : q(srv.shifts, enabled);
      return q(undefined, enabled);
    },
    useMutation: (hookOpts: { onSuccess?: (r: unknown, vars: Row) => void; onError?: (e: unknown, vars: Row) => void } = {}) => {
      srv.mutationPaths.add(path);
      const [pending, setPending] = React.useState(false);
      const run = (input: Row, callOpts?: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
        setPending(true);
        return runOp(path, input).then(
          (r) => {
            setPending(false);
            hookOpts.onSuccess?.(r, input);
            callOpts?.onSuccess?.(r);
            return r;
          },
          (e) => {
            setPending(false);
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
    if (key === "safety.currentBoard") srv.snap.board = srv.board.map((x) => ({ ...x }));
    if (key === "safety.listAssignments") srv.snap.assignments = srv.assignments.map((x) => ({ ...x }));
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
const shift = (id: number, name: string, code: string, sh: number, eh: number, o: Row = {}): Row => ({
  id, factoryId: null, name, code, startHour: sh, startMinute: 0, endHour: eh, endMinute: 0, isActive: true, orderIndex: id,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...o,
});

/** Tập truy vấn mà `refetchAll` của trang Safety CŨ làm mới sau mỗi thao tác phân công (oracle: SafetyWorkforce.tsx @6b9c026af). */
const OLD_REFETCH_ALL = [
  "safety.status", "safety.feed", "safety.nearMissTrend", "safety.currentBoard",
  "safety.listAssignments", "safety.listCollaborations", "safety.sourceHealth",
];

import ProductionShifts, { filterByShift } from "./ProductionShifts";

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
  srv.board = [{ stationId: 3, lineId: 1, humans: [{ assignmentId: 4, operatorId: 44, skillLevel: "qualified" }], robots: [{ robotId: 2, code: "R-2", status: "idle", openTaskCount: 1 }] }];
  srv.boardError = false;
  srv.assignments = [
    assignment(3, "planned", { shiftConfigId: 1 }),
    assignment(4, "active", { shiftConfigId: 2, confirmedBy: 9, confirmedAt: "2026-10-03T00:05:00.000Z", notes: "Thay ca" }),
    assignment(5, "completed"),
  ];
  srv.assignError = false;
  srv.assignLoading = false;
  srv.shifts = [shift(1, "Ca sáng", "A", 6, 14), shift(2, "Ca chiều", "B", 14, 22)];
  srv.shiftsError = false;
  srv.snap = { board: srv.board.map((x) => ({ ...x })), assignments: srv.assignments.map((x) => ({ ...x })) };
  srv.calls = {};
  srv.invalidated = [];
  srv.queryInputs = [];
  srv.queryPaths = new Set();
  srv.mutationPaths = new Set();
  srv.mutationError = null;
  Object.assign(perm, { view: true, control: true });
  for (const f of Object.values(toastSpy)) f.mockClear();
  localStorage.clear();
  presetNarrow(false);
  window.history.replaceState(null, "", "/production/shifts");
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
const calls = (p: string) => srv.calls[`safety.${p}`] ?? [];
const rowOf = (opId: number) => within(mainEl()).getByText(`#${opId}`).closest("tr") as HTMLElement;
const visibleOps = () => [...mainEl().querySelectorAll("tr[data-assignment-id]")].map((r) => Number(r.getAttribute("data-assignment-id")));
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Sản xuất › Ca — bố cục: danh sách MAIN, chi tiết trong flyout, bảng hiện trường ở panel phụ", () => {
  it("MAIN trong <main>, không chứa h1/header/KPI/notice/alert; đúng một thanh công cụ; bảng phân công là phần tử làm việc; 0 dialog lúc nạp", () => {
    render(<ProductionShifts />);
    const main = mainEl();
    expect(main).toBeTruthy();
    expect(main.getAttribute("data-layout-main")).toBe("production-shifts");
    expect(main.closest("main")).toBeTruthy();
    expect(main.querySelector("h1, [data-layout-header], [data-layout-kpi], [data-notice-kind], [role=alert]")).toBeNull();
    expect(main.querySelectorAll("[data-layout-toolbar]").length).toBe(1);
    expect(within(header()).getByRole("heading", { level: 1 })).toHaveTextContent(S("shifts.title"));
    expect(within(main).getByRole("region", { name: S("workforce.assignmentsTitle") })).toBeInTheDocument();
    expect(within(main).getByRole("table")).toBeInTheDocument();
    // Không còn hàng tab (trang riêng, không tab).
    expect(within(main).queryAllByRole("tab")).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // Bảng hiện trường ở panel phụ, ngoài MAIN.
    expect(main.contains(aside())).toBe(false);
    expect(within(aside()).getByText(S("workforce.boardTitle"))).toBeInTheDocument();
    expect(within(aside()).getByText(/R-2/)).toBeInTheDocument();
    // "Khi nào dùng" giữ khoá riêng của trang.
    expect(document.querySelector('[data-when-to-use="shifts.whenToUse"]') ?? screen.getByRole("button", { name: new RegExp(S("layoutKit.notice.kind.whenToUse")) })).toBeTruthy();
  });

  it("chip KPI trong header (đang phân công / chờ xác nhận), số theo danh sách đã lọc, mỗi chip có nguồn; lỗi ⇒ không số", () => {
    const { unmount } = render(<ProductionShifts />);
    expect(header().querySelectorAll("[data-layout-kpi]").length).toBe(2);
    expect(mainEl().querySelectorAll("[data-layout-kpi]").length).toBe(0);
    expect(chip("active-assignments")).toHaveAttribute("data-state", "ok");
    expect(chip("active-assignments").textContent).toContain("1");
    expect(chip("active-assignments").getAttribute("title") ?? "").toContain(S("shifts.chip.srcActive"));
    expect(chip("planned-assignments").textContent).toContain("1");
    expect(chip("planned-assignments").getAttribute("title") ?? "").toContain(S("shifts.chip.srcPlanned"));
    unmount();
    srv.assignError = true;
    render(<ProductionShifts />);
    expect(chip("active-assignments")).toHaveAttribute("data-state", "error");
    expect(within(mainEl()).getByRole("alert")).toHaveTextContent(S("shifts.listError"));
  });

  it("không có quyền xem ⇒ câu không quyền, KHÔNG truy vấn nào chạy", () => {
    perm.view = false;
    render(<ProductionShifts />);
    expect(screen.getByText(S("shifts.noPermission"))).toBeInTheDocument();
    expect(srv.queryInputs).toEqual([]);
  });

  it("đọc đúng thủ tục: safety.status / listAssignments {status, limit 200} / currentBoard / shiftConfig.list — KHÔNG đọc phối hợp", () => {
    render(<ProductionShifts />);
    expect(new Set(srv.queryInputs.map((x) => x.split(":")[0]))).toEqual(
      new Set(["safety.status", "safety.listAssignments", "safety.currentBoard", "shiftConfig.list"]),
    );
    expect(srv.queryInputs).toContain('safety.listAssignments:{"limit":200}');
    expect(srv.queryPaths.has("safety.listCollaborations")).toBe(false);
  });
});

describe("Sản xuất › Ca — lọc theo ca (shift_configs) và trạng thái, URL là nguồn sự thật", () => {
  it("chọn ca ⇒ ?shift= (replace), bảng chỉ còn phân công của ca đó; 'Chưa gắn ca' ⇒ shiftConfigId rỗng; 'Tất cả' ⇒ gỡ tham số", async () => {
    const user = userEvent.setup();
    const len0 = window.history.length;
    render(<ProductionShifts />);
    expect(visibleOps().sort()).toEqual([3, 4, 5]);
    // Cột ca hiện tên ca.
    expect(within(rowOf(43)).getByText("Ca sáng (A)")).toBeInTheDocument();
    await user.click(within(toolbar()).getByRole("combobox", { name: S("shifts.filter.shift") }));
    await user.click(await screen.findByRole("option", { name: "Ca chiều (B) 14:00–22:00" }));
    await waitFor(() => expect(params().get("shift")).toBe("2"));
    expect(window.history.length).toBe(len0);
    expect(visibleOps()).toEqual([4]);
    await user.click(within(toolbar()).getByRole("combobox", { name: S("shifts.filter.shift") }));
    await user.click(await screen.findByRole("option", { name: S("shifts.filter.noShift") }));
    await waitFor(() => expect(params().get("shift")).toBe("none"));
    expect(visibleOps()).toEqual([5]);
    await user.click(within(toolbar()).getByRole("combobox", { name: S("shifts.filter.shift") }));
    await user.click(await screen.findByRole("option", { name: S("shifts.filter.allShifts") }));
    await waitFor(() => expect(params().get("shift")).toBeNull());
    expect(visibleOps().sort()).toEqual([3, 4, 5]);
  });

  it("F5 với ?shift=1&status=planned mở thẳng đúng bộ lọc; trạng thái đi vào input của listAssignments như cũ", () => {
    window.history.replaceState(null, "", "/production/shifts?shift=1&status=planned");
    render(<ProductionShifts />);
    expect(visibleOps()).toEqual([3]);
    expect(srv.queryInputs).toContain('safety.listAssignments:{"status":"planned","limit":200}');
    expect(within(toolbar()).getByRole("combobox", { name: S("shifts.filter.shift") })).toHaveTextContent("Ca sáng (A) 06:00–14:00");
  });

  it("filterByShift: tất cả / ca / chưa gắn ca / giá trị lạ ⇒ không lọc", () => {
    const rows = [{ id: 1, shiftConfigId: 1 }, { id: 2, shiftConfigId: null }, { id: 3, shiftConfigId: 2 }];
    expect(filterByShift(rows, null).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(filterByShift(rows, "1").map((r) => r.id)).toEqual([1]);
    expect(filterByShift(rows, "none").map((r) => r.id)).toEqual([2]);
    expect(filterByShift(rows, "abc").map((r) => r.id)).toEqual([1, 2, 3]);
  });
});

describe("Sản xuất › Ca — luồng phân công qua flyout (R-2-n: payload, kiểm tra, làm mới như tab Safety cũ)", () => {
  it("Phân công: sheet ?flyout=; operator sai ⇒ toast; đúng ⇒ đúng payload, đóng, URL sạch, làm mới ĐÚNG tập cũ, danh sách cập nhật", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/production/shifts?shift=1");
    render(<ProductionShifts />);
    await user.click(within(toolbar()).getByRole("button", { name: S("workforce.assign") }));
    const sheet = await waitLayer("workforce-assign");
    expect(params().get("flyout")).toBe("workforce-assign");
    await user.click(within(sheet).getByRole("button", { name: S("workforce.assign") }));
    expect(toastSpy.error).toHaveBeenCalledWith(S("workforce.operatorIdRequired"));
    expect(calls("assignOperator")).toEqual([]);
    await user.type(within(sheet).getByLabelText(S("workforce.operatorId")), "77");
    await user.type(within(sheet).getByLabelText(S("workforce.lineId")), "2");
    await user.click(within(sheet).getByRole("button", { name: S("workforce.assign") }));
    await waitFor(() => expect(calls("assignOperator")).toEqual([{ operatorId: 77, lineId: 2, stationId: undefined, skillLevel: undefined }]));
    await waitFor(() => expect(layer("workforce-assign")).toBeNull());
    expect(params().get("flyout")).toBeNull();
    expect(params().get("shift")).toBe("1");
    expect(toastSpy.success).toHaveBeenCalledWith(S("workforce.assigned"));
    expect(new Set(srv.invalidated)).toEqual(new Set(OLD_REFETCH_ALL));
    // Phân công mới không có ca (payload như cũ) ⇒ hiện khi bỏ lọc ca.
    window.history.replaceState(null, "", "/production/shifts");
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
    await waitFor(() => expect(within(mainEl()).getByText("#77")).toBeInTheDocument());
  });

  it("Phân công lại: sheet ?flyoutId= điền sẵn; payload {assignmentId, ...}; deep link id lạ ⇒ không tìm thấy; đã kết thúc ⇒ không form", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ProductionShifts />);
    await user.click(within(rowOf(43)).getByRole("button", { name: S("workforce.reassign") }));
    const sheet = await waitLayer("workforce-reassign");
    expect(params().get("flyoutId")).toBe("3");
    const op = within(sheet).getByLabelText(S("workforce.operatorId")) as HTMLInputElement;
    expect(op.value).toBe("43");
    await user.clear(op);
    await user.type(op, "50");
    await user.click(within(sheet).getByRole("button", { name: S("workforce.reassign") }));
    await waitFor(() => expect(calls("reassignOperator")).toEqual([{ assignmentId: 3, operatorId: 50, lineId: 1, stationId: 2, skillLevel: "qualified" }]));
    await waitFor(() => expect(layer("workforce-reassign")).toBeNull());
    expect(new Set(srv.invalidated)).toEqual(new Set(OLD_REFETCH_ALL));
    unmount();
    window.history.replaceState(null, "", "/production/shifts?flyout=workforce-reassign&flyoutId=999");
    const r2 = render(<ProductionShifts />);
    const s2 = await waitLayer("workforce-reassign");
    expect(s2.textContent).toContain(S("workforce.assignmentNotFound").replace("{{id}}", "999"));
    expect(within(s2).queryByRole("button", { name: S("workforce.reassign") })).toBeNull();
    r2.unmount();
    window.history.replaceState(null, "", "/production/shifts?flyout=workforce-reassign&flyoutId=5");
    render(<ProductionShifts />);
    const s3 = await waitLayer("workforce-reassign");
    expect(s3.textContent).toContain(S("workforce.assignmentTerminal").replace("{{id}}", "5"));
    expect(within(s3).queryByRole("button", { name: S("workforce.reassign") })).toBeNull();
  });

  it("Xác nhận: một cú bấm ⇒ [{assignmentId}], không dialog; Đóng: AlertDialog, Huỷ ⇒ 0 lời gọi, xác nhận ⇒ [{assignmentId}]; hàng kết thúc khoá", async () => {
    const user = userEvent.setup();
    // Hai phân công "Kế hoạch" ⇒ một cú bấm phải chạm ĐÚNG MỘT (R-2-n: không thao tác hàng loạt).
    srv.assignments.push(assignment(6, "planned", { shiftConfigId: 1 }));
    srv.snap.assignments = srv.assignments.map((x) => ({ ...x }));
    render(<ProductionShifts />);
    await user.click(within(rowOf(43)).getByRole("button", { name: S("workforce.confirm") }));
    await waitFor(() => expect(calls("confirmAssignment")).toEqual([{ assignmentId: 3 }]));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(calls("confirmAssignment")).toEqual([{ assignmentId: 3 }]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(toastSpy.success).toHaveBeenCalledWith(S("workforce.confirmed"));
    await user.click(within(rowOf(44)).getByRole("button", { name: S("workforce.close") }));
    let dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText(S("workforce.closeConfirmTitle"))).toBeInTheDocument();
    expect(dlg.textContent).toContain(S("workforce.closeConfirmBody"));
    await user.click(within(dlg).getByRole("button", { name: S("common.cancel") }));
    expect(calls("closeAssignment")).toEqual([]);
    await user.click(within(rowOf(44)).getByRole("button", { name: S("workforce.close") }));
    dlg = await screen.findByRole("alertdialog");
    await user.click(within(dlg).getByRole("button", { name: S("workforce.confirmClose") }));
    await waitFor(() => expect(calls("closeAssignment")).toEqual([{ assignmentId: 4 }]));
    expect(toastSpy.success).toHaveBeenCalledWith(S("workforce.closed"));
    const done = rowOf(45);
    expect(within(done).getByRole("button", { name: S("workforce.reassign") })).toBeDisabled();
    expect(within(done).getByRole("button", { name: S("workforce.close") })).toBeDisabled();
    expect(within(done).queryByRole("button", { name: S("workforce.confirm") })).toBeNull();
  });

  it("Chi tiết (P3): bấm mã người vận hành ⇒ sheet workforce-detail ?flyoutId=; đủ trường kể cả ca + người xác nhận; deep link; id lạ ⇒ không tìm thấy", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ProductionShifts />);
    await user.click(within(mainEl()).getByRole("button", { name: S("shifts.openDetail").replace("{{id}}", "4") }));
    const sheet = await waitLayer("workforce-detail");
    expect(params().get("flyout")).toBe("workforce-detail");
    expect(params().get("flyoutId")).toBe("4");
    const dl = sheet.querySelector("[data-assignment-detail]") as HTMLElement;
    expect(dl).toHaveAttribute("data-assignment-detail", "4");
    expect(dl.textContent).toContain("Ca chiều (B) 14:00–22:00");
    expect(dl.textContent).toContain("#9");
    expect(dl.textContent).toContain("Thay ca");
    // Chỉ đọc: không nút thao tác nào trong chi tiết.
    expect(within(sheet).queryByRole("button", { name: S("workforce.reassign") })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: S("workforce.close") })).toBeNull();
    unmount();
    window.history.replaceState(null, "", "/production/shifts?flyout=workforce-detail&flyoutId=999");
    render(<ProductionShifts />);
    const s2 = await waitLayer("workforce-detail");
    expect(s2.textContent).toContain(S("workforce.assignmentNotFound").replace("{{id}}", "999"));
  });

  it("CONFLICT (trùng lịch) ⇒ toast.info; FEATURE_DISABLED ⇒ toast.info câu KHÔNG gọi tên biến môi trường + làm mới cờ", async () => {
    const user = userEvent.setup();
    srv.mutationError = Object.assign(new Error("Workforce feature is disabled"), { data: { code: "CONFLICT", appCode: "FEATURE_DISABLED" } });
    render(<ProductionShifts />);
    await user.click(within(rowOf(43)).getByRole("button", { name: S("workforce.confirm") }));
    await waitFor(() => expect(toastSpy.info).toHaveBeenCalledWith(S("shifts.flagOffToast")));
    expect(S("shifts.flagOffToast")).not.toMatch(/[A-Z][A-Z0-9]+_[A-Z0-9_]+/);
    expect(toastSpy.error).not.toHaveBeenCalled();
    expect(srv.invalidated).toContain("safety.status");
  });
});

describe("Sản xuất › Ca — cổng giữ nguyên như tab Safety cũ", () => {
  it("không quyền điều khiển ⇒ không đăng ký sheet thao tác (deep link không mở); nút Phân công khoá kèm lý do; hàng 'Chỉ xem'; chi tiết vẫn mở", async () => {
    perm.control = false;
    window.history.replaceState(null, "", "/production/shifts?flyout=workforce-assign");
    const { unmount } = render(<ProductionShifts />);
    await settle();
    expect(layer("workforce-assign")).toBeNull();
    const btn = within(toolbar()).getByRole("button", { name: S("workforce.assign") });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toBeTruthy();
    expect(within(rowOf(43)).queryByRole("button", { name: S("workforce.confirm") })).toBeNull();
    expect(within(rowOf(43)).getByText(S("safety.viewOnly"))).toBeInTheDocument();
    unmount();
    window.history.replaceState(null, "", "/production/shifts?flyout=workforce-reassign&flyoutId=3");
    const r2 = render(<ProductionShifts />);
    await settle();
    expect(layer("workforce-reassign")).toBeNull();
    r2.unmount();
    window.history.replaceState(null, "", "/production/shifts?flyout=workforce-detail&flyoutId=3");
    render(<ProductionShifts />);
    await waitLayer("workforce-detail");
  });

  it("cờ nhân lực ĐANG TẢI / LỖI ⇒ Phân công khoá; deep link sheet không có form; TẮT (đã rõ) ⇒ nút bật như cũ; BẬT ⇒ không chip cờ", async () => {
    srv.status = undefined;
    const r0 = render(<ProductionShifts />);
    expect(within(toolbar()).getByRole("button", { name: S("workforce.assign") })).toBeDisabled();
    r0.unmount();
    window.history.replaceState(null, "", "/production/shifts?flyout=workforce-assign");
    const r1 = render(<ProductionShifts />);
    const s1 = await waitLayer("workforce-assign");
    expect(within(s1).getByText(S("common.gate.checkingStatus"))).toBeInTheDocument();
    expect(within(s1).queryByLabelText(S("workforce.operatorId"))).toBeNull();
    expect(screen.getByTestId("feature-status-loading")).toBeInTheDocument();
    r1.unmount();
    window.history.replaceState(null, "", "/production/shifts");
    srv.status = { safetyAudit: true, workforce: true };
    srv.statusError = true;
    const r2 = render(<ProductionShifts />);
    expect(within(toolbar()).getByRole("button", { name: S("workforce.assign") })).toBeDisabled();
    expect(screen.getByTestId("feature-status-error")).toBeInTheDocument();
    r2.unmount();
    srv.statusError = false;
    srv.status = { safetyAudit: true, workforce: false };
    const r3 = render(<ProductionShifts />);
    expect(within(toolbar()).getByRole("button", { name: S("workforce.assign") })).not.toBeDisabled();
    const off = screen.getByTestId("feature-status-off");
    expect(off.textContent).not.toMatch(/WORKFORCE_ENABLED/);
    r3.unmount();
    srv.status = { safetyAudit: true, workforce: true };
    render(<ProductionShifts />);
    expect(screen.queryByTestId("feature-status-off")).toBeNull();
    expect(within(toolbar()).getByRole("button", { name: S("workforce.assign") })).not.toBeDisabled();
  });

  it("phối hợp người↔robot KHÔNG ở trang này: không nút 'Bắt đầu phối hợp', sheet collab-start không đăng ký, không hook startCollaboration", async () => {
    window.history.replaceState(null, "", "/production/shifts?flyout=collab-start");
    render(<ProductionShifts />);
    await settle();
    expect(layer("collab-start")).toBeNull();
    expect(screen.queryByRole("button", { name: S("workforce.startCollab") })).toBeNull();
    expect([...srv.mutationPaths].sort()).toEqual([
      "safety.assignOperator", "safety.closeAssignment", "safety.confirmAssignment", "safety.reassignOperator",
    ]);
  });
});

describe("Sản xuất › Ca — nhãn nguồn dữ liệu (doc 80 Task 4 X-01) đi theo bảng", () => {
  it("dải tóm tắt DEMO 2/4 + BẤT BIẾN: mọi hàng seed có badge, hàng thật không", () => {
    srv.snap.assignments = [
      assignment(3, "planned", { scope: "demo" }),
      assignment(4, "active", { scope: "demo" }),
      assignment(5, "planned", { scope: "F1:L1" }),
      assignment(6, "planned", { scope: null }),
    ];
    render(<ProductionShifts />);
    const s = screen.getByTestId("provenance-summary");
    expect(s).toHaveAttribute("data-count", "2");
    expect(s).toHaveAttribute("data-total", "4");
    for (const [id, seeded] of [[3, true], [4, true], [5, false], [6, false]] as const) {
      const badge = rowOf(40 + id).querySelector('[data-testid="provenance-badge"]');
      if (seeded) expect(badge?.getAttribute("data-provenance"), `#${id}`).toBe("DEMO");
      else expect(badge, `#${id}`).toBeNull();
    }
  });
});

describe("Sản xuất › Ca — dưới 1024 px và i18n", () => {
  it("< 1024 px: panel phụ xếp xuống dưới MAIN; công cụ vẫn trong MAIN; qua lại mốc không mất bộ lọc", async () => {
    window.history.replaceState(null, "", "/production/shifts?shift=2");
    render(<ProductionShifts />);
    setNarrow(true);
    await waitFor(() => expect(toolbar()).toBeTruthy());
    expect(within(toolbar()).getByRole("button", { name: S("workforce.assign") })).toBeInTheDocument();
    expect(visibleOps()).toEqual([4]);
    setNarrow(false);
    expect(visibleOps()).toEqual([4]);
  });

  it("mọi khoá shifts.* có ở vi/en/zh và KHÔNG chứa tên biến môi trường", () => {
    const flat = (o: unknown, p = ""): Record<string, string> =>
      Object.entries((o ?? {}) as Record<string, unknown>).reduce<Record<string, string>>((acc, [k, v]) => {
        const key = p ? `${p}.${k}` : k;
        if (typeof v === "string") acc[key] = v;
        else Object.assign(acc, flat(v, key));
        return acc;
      }, {});
    const vi = flat((vi_ as Record<string, unknown>).shifts);
    const en = flat((en_ as Record<string, unknown>).shifts);
    const zh = flat((zh_ as Record<string, unknown>).shifts);
    expect(Object.keys(vi).length).toBeGreaterThan(10);
    expect(Object.keys(en).sort()).toEqual(Object.keys(vi).sort());
    expect(Object.keys(zh).sort()).toEqual(Object.keys(vi).sort());
    for (const v of [...Object.values(vi), ...Object.values(en), ...Object.values(zh)]) expect(v).not.toMatch(/[A-Z][A-Z0-9]+_[A-Z0-9_]+/);
  });
});
