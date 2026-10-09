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
  // final wave (I2) — "server" của safety.assignableShifts: phạm vi nhà máy của người gọi (null = toàn quyền), nhà máy của
  // từng chuyền (production_lines → workshops), tên nhà máy.
  scope: null as number[] | null,
  lineFactory: {} as Record<number, number>,
  factoryNames: {} as Record<number, string>,
  /** post-review (4): chuyền mà tập ca của nó ĐANG TẢI (chưa có câu trả lời). */
  pendingLines: [] as number[],
  lastAssignable: undefined as unknown,
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
      if (path === "safety.assignOperator") srv.assignments.unshift(assignment(90, "planned", { operatorId: input.operatorId, shiftConfigId: input.shiftConfigId ?? null }));
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
        // Đợt 3b Task 1 — "server" lọc ca như SQL thật: vắng ⇒ không lọc; null ⇒ chưa gắn ca; số ⇒ đúng ca đó.
        return q(
          srv.snap.assignments.filter(
            (a) => (!input?.status || a.status === input.status) && (input?.shiftConfigId === undefined || a.shiftConfigId === input.shiftConfigId),
          ),
          enabled,
        );
      }
      if (path === "shiftConfig.list") return srv.shiftsError ? q(undefined, enabled, { isError: true }) : q(srv.shifts, enabled);
      if (path === "safety.assignableShifts") {
        // như SQL thật (server/routers/safetyRouter.ts — đã kiểm trên _test): đang hoạt động, trong phạm vi, thuộc nhà máy chuyền.
        if (input?.lineId != null && srv.pendingLines.includes(input.lineId as number)) {
          // như react-query: `placeholderData(prev)` (nếu trang truyền) trả dữ liệu của khoá TRƯỚC trong lúc khoá mới đang tải.
          const ph = (opts as { placeholderData?: (p: unknown) => unknown } | undefined)?.placeholderData;
          const prev = ph ? ph(srv.lastAssignable) : undefined;
          return q(prev, enabled, { isLoading: prev === undefined, isPending: true, isFetching: true, isPlaceholderData: prev !== undefined });
        }
        const lf = input?.lineId != null ? srv.lineFactory[input.lineId as number] : undefined;
        return q(
          (srv.lastAssignable = srv.shifts
            .filter((s) => s.isActive && (s.factoryId == null || srv.scope == null || srv.scope.includes(s.factoryId as number)))
            .filter((s) => lf == null || s.factoryId == null || s.factoryId === lf)
            .map((s) => ({ ...s, factoryName: s.factoryId == null ? null : (srv.factoryNames[s.factoryId as number] ?? null) }))),
          enabled,
        );
      }
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

import ProductionShifts, { defaultShiftId, shiftContains, shiftFilterInput } from "./ProductionShifts";

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
  srv.scope = null;
  srv.lineFactory = {};
  srv.factoryNames = {};
  srv.pendingLines = [];
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
  // Đợt 3b Task 1 — giờ "bây giờ" CỐ ĐỊNH (chỉ giả Date, hẹn giờ thật): 03:00 nằm ngoài cả hai ca A 06–14 / B 14–22 ⇒ sheet
  // phân công KHÔNG chọn sẵn ca ⇒ payload các ca cũ giữ nguyên văn như trước Đợt 3b.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 6, 3, 0, 0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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
    // Đợt 3b Task 1 — lọc ca do SERVER làm: ca đi vào input của listAssignments (không lọc trên 200 hàng đã tải).
    expect(srv.queryInputs).toContain('safety.listAssignments:{"shiftConfigId":2,"limit":200}');
    await user.click(within(toolbar()).getByRole("combobox", { name: S("shifts.filter.shift") }));
    await user.click(await screen.findByRole("option", { name: S("shifts.filter.noShift") }));
    await waitFor(() => expect(params().get("shift")).toBe("none"));
    expect(visibleOps()).toEqual([5]);
    expect(srv.queryInputs).toContain('safety.listAssignments:{"shiftConfigId":null,"limit":200}');
    await user.click(within(toolbar()).getByRole("combobox", { name: S("shifts.filter.shift") }));
    await user.click(await screen.findByRole("option", { name: S("shifts.filter.allShifts") }));
    await waitFor(() => expect(params().get("shift")).toBeNull());
    expect(visibleOps().sort()).toEqual([3, 4, 5]);
    expect(srv.queryInputs.filter((x) => x.startsWith("safety.listAssignments:")).at(-1)).toBe('safety.listAssignments:{"limit":200}');
  });

  it("F5 với ?shift=1&status=planned mở thẳng đúng bộ lọc; trạng thái đi vào input của listAssignments như cũ", () => {
    window.history.replaceState(null, "", "/production/shifts?shift=1&status=planned");
    render(<ProductionShifts />);
    expect(visibleOps()).toEqual([3]);
    expect(srv.queryInputs).toContain('safety.listAssignments:{"status":"planned","shiftConfigId":1,"limit":200}');
    expect(within(toolbar()).getByRole("combobox", { name: S("shifts.filter.shift") })).toHaveTextContent("Ca sáng (A) 06:00–14:00");
  });

  it("shiftFilterInput (Đợt 3b): tất cả ⇒ không khoá; ca ⇒ số; chưa gắn ca ⇒ null; giá trị lạ ⇒ không lọc (như cũ)", () => {
    expect(shiftFilterInput(null)).toEqual({});
    expect(shiftFilterInput("")).toEqual({});
    expect(shiftFilterInput("1")).toEqual({ shiftConfigId: 1 });
    expect(shiftFilterInput("none")).toEqual({ shiftConfigId: null });
    for (const bad of ["abc", "0", "-3", "1.5", "1e3"]) {
      expect(shiftFilterInput(bad), bad).toEqual({});
      expect("shiftConfigId" in shiftFilterInput(bad), bad).toBe(false);
    }
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
    // Đợt 3b Task 1 — 03:00 không thuộc ca nào ⇒ không chọn sẵn ⇒ payload NGUYÊN VĂN như cũ (không có khoá ca khi gửi đi).
    expect(JSON.stringify(calls("assignOperator")[0])).toBe('{"operatorId":77,"lineId":2}');
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
    // Đợt 3b Task 1 (doc 81 §12, chủ dự án duyệt) — sheet điền sẵn CẢ ca của phân công cũ (#3 thuộc ca 1) ⇒ payload mang ca;
    // trước Đợt 3b phân công lại làm RƠI ca (hàng mới shiftConfigId NULL).
    await waitFor(() => expect(calls("reassignOperator")).toEqual([{ assignmentId: 3, operatorId: 50, lineId: 1, stationId: 2, skillLevel: "qualified", shiftConfigId: 1 }]));
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

// ── Final wave (doc 81 Đợt 3, Task 3 FINAL-WAVE) ─────────────────────────────────────────────────────────────────────
// (a) lọc ca chỉ chạy trên 200 phân công MỚI NHẤT đã tải ⇒ lọc ra rỗng khi cửa sổ đầy phải NÓI RÕ phân công cũ hơn không
//     hiện ở đây (không để người dùng tưởng "ca này không có ai"); cửa sổ chưa đầy ⇒ "ca này chưa có phân công".
// (b) lỗi cờ tắt phân biệt theo MÃ cờ (`params.feature`) như trang Safety cũ phân biệt an toàn / nhân lực.
describe("Sản xuất › Ca — final wave: gợi ý bảng rỗng theo cửa sổ 200 + câu cờ tắt theo mã cờ", () => {
  it("Đợt 3b: ?shift=1 mà 200 phân công mới nhất đều thuộc ca khác ⇒ server lọc ca ⇒ câu 'ca này chưa có phân công' (gợi ý cửa sổ 200 đã bỏ)", () => {
    srv.snap.assignments = Array.from({ length: 200 }, (_, i) => assignment(100 + i, "planned", { shiftConfigId: 2 }));
    window.history.replaceState(null, "", "/production/shifts?shift=1");
    render(<ProductionShifts />);
    expect(visibleOps()).toEqual([]);
    const hint = mainEl().querySelector("[data-empty-hint]") as HTMLElement;
    expect(hint).toHaveTextContent(S("shifts.emptyForShift"));
    expect(hint.textContent).not.toContain("200");
    expect((vi_ as { shifts: Record<string, unknown> }).shifts.emptyForShiftWindow).toBeUndefined();
  });

  it("cửa sổ CHƯA đầy ⇒ 'Ca này chưa có phân công nào.'; không lọc ca ⇒ câu rỗng cũ", () => {
    srv.snap.assignments = [assignment(3, "planned", { shiftConfigId: 2 })];
    window.history.replaceState(null, "", "/production/shifts?shift=1");
    const { unmount } = render(<ProductionShifts />);
    expect(mainEl().querySelector("[data-empty-hint]")).toHaveTextContent(S("shifts.emptyForShift"));
    unmount();
    srv.snap.assignments = [];
    window.history.replaceState(null, "", "/production/shifts");
    render(<ProductionShifts />);
    expect(mainEl().querySelector("[data-empty-hint]")).toHaveTextContent(S("workforce.assignmentsEmpty"));
  });

  it.each([
    ["workforce", "shifts.flagOffToast"],
    ["safetyAudit", "safety.flagOffToast"],
    ["safetyZones", "common.flagOffToastGeneric"],
  ])("FEATURE_DISABLED với feature=%s ⇒ toast.info %s (không tên biến môi trường)", async (feature, key) => {
    const user = userEvent.setup();
    srv.mutationError = Object.assign(new Error("disabled"), { data: { code: "CONFLICT", appCode: "FEATURE_DISABLED", appParams: { feature } } });
    render(<ProductionShifts />);
    await user.click(within(rowOf(43)).getByRole("button", { name: S("workforce.confirm") }));
    await waitFor(() => expect(toastSpy.info).toHaveBeenCalledWith(S(key)));
    expect(S(key)).not.toMatch(/[A-Z][A-Z0-9]+_[A-Z0-9_]+/);
    expect(toastSpy.error).not.toHaveBeenCalled();
  });
});

// ── Đợt 3b Task 1 (doc 81 §12 "Đã chốt 2026-10-06") — bộ chọn ca TUỲ CHỌN trong sheet phân công / phân công lại ───────────
// Hợp đồng: chỉ ca ĐANG HOẠT ĐỘNG; mặc định = ca có khung giờ chứa "bây giờ" nếu ĐÚNG MỘT ca khớp (0 hoặc ≥2 ⇒ không chọn);
// phân công lại ưu tiên ca của phân công cũ (nếu còn hoạt động, như mọi trường khác được điền sẵn); "không gắn ca" ⇒ payload
// KHÔNG có khoá ca (y như trước). Oracle giờ: tính tay theo phút trong ngày, không gọi lại hàm của trang.
describe("Đợt 3b Task 1 — bộ chọn ca trong sheet phân công", () => {
  const at = (h: number, m = 0) => vi.setSystemTime(new Date(2026, 9, 6, h, m, 0));
  const shiftBox = (sheet: HTMLElement) => within(sheet).getByRole("combobox", { name: S("shifts.form.shift") });
  const openAssign = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(within(toolbar()).getByRole("button", { name: S("workforce.assign") }));
    return waitLayer("workforce-assign");
  };

  it("shiftContains / defaultShiftId: khung thường, khung qua đêm, khung 24 h, biên [đầu, cuối); đúng MỘT ca khớp mới chọn", () => {
    const A = { id: 1, startHour: 6, startMinute: 0, endHour: 14, endMinute: 0, isActive: true };
    const N = { id: 3, startHour: 22, startMinute: 0, endHour: 6, endMinute: 0, isActive: true };
    const D = { id: 4, startHour: 7, startMinute: 30, endHour: 7, endMinute: 30, isActive: true };
    const d = (h: number, m = 0) => new Date(2026, 9, 6, h, m);
    expect([shiftContains(A, d(6)), shiftContains(A, d(13, 59)), shiftContains(A, d(14)), shiftContains(A, d(5, 59))]).toEqual([true, true, false, false]);
    expect([shiftContains(N, d(22)), shiftContains(N, d(23, 30)), shiftContains(N, d(5, 59)), shiftContains(N, d(6)), shiftContains(N, d(12))]).toEqual([true, true, true, false, false]);
    expect([shiftContains(D, d(0)), shiftContains(D, d(7, 30)), shiftContains(D, d(23, 59))]).toEqual([true, true, true]);
    expect(defaultShiftId([A, N], d(10))).toBe(1);
    expect(defaultShiftId([A, N], d(23))).toBe(3);
    expect(defaultShiftId([A, N], d(15))).toBeNull();
    expect(defaultShiftId([A, D], d(10))).toBeNull(); // hai ca khớp ⇒ không đoán
    expect(defaultShiftId([{ ...A, isActive: false }, N], d(10))).toBeNull(); // ca TẮT không bao giờ được chọn
  });

  it("10:00 ⇒ sheet chọn sẵn ca A (06–14); danh sách chỉ ca ĐANG HOẠT ĐỘNG + 'không gắn ca'; gửi ⇒ payload mang shiftConfigId 1", async () => {
    at(10);
    srv.shifts = [...srv.shifts, shift(7, "Ca cũ", "Z", 8, 12, { isActive: false })];
    const user = userEvent.setup();
    render(<ProductionShifts />);
    const sheet = await openAssign(user);
    expect(shiftBox(sheet)).toHaveTextContent("Ca sáng (A) 06:00–14:00");
    expect(within(sheet).getByText(S("shifts.form.defaultHint"))).toBeInTheDocument();
    await user.click(shiftBox(sheet));
    const opts = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(opts).toEqual([S("shifts.form.noShift"), "Ca sáng (A) 06:00–14:00", "Ca chiều (B) 14:00–22:00"]);
    await user.keyboard("{Escape}");
    await user.type(within(sheet).getByLabelText(S("workforce.operatorId")), "77");
    await user.click(within(sheet).getByRole("button", { name: S("workforce.assign") }));
    await waitFor(() => expect(calls("assignOperator")).toEqual([{ operatorId: 77, lineId: undefined, stationId: undefined, skillLevel: undefined, shiftConfigId: 1 }]));
    expect(new Set(srv.invalidated)).toEqual(new Set(OLD_REFETCH_ALL));
  });

  it("03:00 (ngoài mọi ca) ⇒ không chọn sẵn, không câu gợi ý; người dùng chọn ca B ⇒ payload shiftConfigId 2", async () => {
    const user = userEvent.setup();
    render(<ProductionShifts />);
    const sheet = await openAssign(user);
    expect(shiftBox(sheet)).toHaveTextContent(S("shifts.form.noShift"));
    expect(within(sheet).queryByText(S("shifts.form.defaultHint"))).toBeNull();
    await user.click(shiftBox(sheet));
    await user.click(await screen.findByRole("option", { name: "Ca chiều (B) 14:00–22:00" }));
    await user.type(within(sheet).getByLabelText(S("workforce.operatorId")), "78");
    await user.click(within(sheet).getByRole("button", { name: S("workforce.assign") }));
    await waitFor(() => expect(calls("assignOperator")).toEqual([expect.objectContaining({ operatorId: 78, shiftConfigId: 2 })]));
  });

  it("10:00 nhưng HAI ca khớp (thêm ca 08–16) ⇒ không chọn sẵn; chọn sẵn A rồi bỏ về 'không gắn ca' ⇒ payload KHÔNG có khoá ca", async () => {
    at(10);
    srv.shifts = [...srv.shifts, shift(8, "Ca hành chính", "HC", 8, 16)];
    const user = userEvent.setup();
    const r = render(<ProductionShifts />);
    let sheet = await openAssign(user);
    expect(shiftBox(sheet)).toHaveTextContent(S("shifts.form.noShift"));
    r.unmount();
    srv.shifts = srv.shifts.filter((s) => s.id !== 8);
    window.history.replaceState(null, "", "/production/shifts");
    render(<ProductionShifts />);
    sheet = await openAssign(user);
    expect(shiftBox(sheet)).toHaveTextContent("Ca sáng (A) 06:00–14:00");
    await user.click(shiftBox(sheet));
    await user.click(await screen.findByRole("option", { name: S("shifts.form.noShift") }));
    await user.type(within(sheet).getByLabelText(S("workforce.operatorId")), "79");
    await user.click(within(sheet).getByRole("button", { name: S("workforce.assign") }));
    await waitFor(() => expect(calls("assignOperator").length).toBe(1));
    expect(JSON.stringify(calls("assignOperator")[0])).toBe('{"operatorId":79}');
  });

  it("ca qua đêm 22–06 lúc 23:30 ⇒ chọn sẵn ca đó", async () => {
    at(23, 30);
    srv.shifts = [...srv.shifts, shift(9, "Ca đêm", "C", 22, 6)];
    const user = userEvent.setup();
    render(<ProductionShifts />);
    const sheet = await openAssign(user);
    expect(shiftBox(sheet)).toHaveTextContent("Ca đêm (C) 22:00–06:00");
  });

  it("phân công lại: ca của phân công cũ thắng ca 'bây giờ'; ca cũ đã TẮT ⇒ ca 'bây giờ'; cũ chưa gắn ca ⇒ ca 'bây giờ'", async () => {
    at(10); // "bây giờ" thuộc ca A (1)
    srv.shifts = [...srv.shifts, shift(7, "Ca cũ", "Z", 8, 12, { isActive: false })];
    srv.assignments.push(assignment(6, "planned", { shiftConfigId: 7 }));
    srv.snap.assignments = srv.assignments.map((x) => ({ ...x }));
    const user = userEvent.setup();
    render(<ProductionShifts />);
    // #4 thuộc ca B (2)
    await user.click(within(rowOf(44)).getByRole("button", { name: S("workforce.reassign") }));
    let sheet = await waitLayer("workforce-reassign");
    expect(shiftBox(sheet)).toHaveTextContent("Ca chiều (B) 14:00–22:00");
    expect(within(sheet).queryByText(S("shifts.form.defaultHint"))).toBeNull();
    await user.click(within(sheet).getByRole("button", { name: S("workforce.reassign") }));
    await waitFor(() => expect(calls("reassignOperator")).toEqual([expect.objectContaining({ assignmentId: 4, shiftConfigId: 2 })]));
    await waitFor(() => expect(layer("workforce-reassign")).toBeNull());
    // #6 thuộc ca 7 đã TẮT ⇒ rơi về ca "bây giờ" (A).
    await user.click(within(rowOf(46)).getByRole("button", { name: S("workforce.reassign") }));
    sheet = await waitLayer("workforce-reassign");
    expect(shiftBox(sheet)).toHaveTextContent("Ca sáng (A) 06:00–14:00");
    await user.click(within(sheet).getByRole("button", { name: S("common.cancel") }));
    await waitFor(() => expect(layer("workforce-reassign")).toBeNull());
    // #3 chuyển thành chưa gắn ca qua "server" ⇒ ca "bây giờ" (A) + câu gợi ý.
    Object.assign(srv.assignments.find((a) => a.id === 3)!, { shiftConfigId: null });
    srv.snap.assignments = srv.assignments.map((x) => ({ ...x }));
    await act(async () => bump());
    await user.click(within(rowOf(43)).getByRole("button", { name: S("workforce.reassign") }));
    sheet = await waitLayer("workforce-reassign");
    expect(shiftBox(sheet)).toHaveTextContent("Ca sáng (A) 06:00–14:00");
    expect(within(sheet).getByText(S("shifts.form.defaultHint"))).toBeInTheDocument();
  });

  it("i18n: khoá bộ chọn ca có ở vi/en/zh (final wave I2: + allFactories; lỗi shiftFactoryMismatch)", () => {
    for (const loc of [vi_, en_, zh_] as Array<{ shifts: { form?: Record<string, string> }; errors: { reason: Record<string, string> } }>) {
      expect(Object.keys(loc.shifts.form ?? {}).sort()).toEqual(["allFactories", "defaultHint", "loadingShifts", "noShift", "shift"]);
      expect(loc.errors.reason.shiftFactoryMismatch).toMatch(/\S/);
      // post-review (3): phạm vi nhiều nhà máy phải chỉ ra nhà máy
      expect(loc.errors.reason.factoryRequired).toMatch(/\S/);
      expect((loc.errors as unknown as { field: Record<string, string> }).field.factoryId).toMatch(/\S/);
    }
  });
});

// ── doc 81 Đợt 3b final wave (I2) — bộ chọn ca theo PHẠM VI người dùng và NHÀ MÁY của chuyền đã chọn ────────────────────
// Trước: sheet đọc `shiftConfig.list()` (không phạm vi, mọi nhà máy) ⇒ người bị thu hẹp được chọn sẵn ca nhà máy khác (server
// từ chối ENTITY_NOT_FOUND); hai nhà máy cùng "Ca 1 06–14" ⇒ 2 ca khớp ⇒ không bao giờ chọn sẵn; nhãn không phân biệt.
describe("Đợt 3b final wave (I2) — bộ chọn ca theo phạm vi + nhà máy của chuyền", () => {
  const at = (h: number, m = 0) => vi.setSystemTime(new Date(2026, 9, 6, h, m, 0));
  const shiftBox = (sheet: HTMLElement) => within(sheet).getByRole("combobox", { name: S("shifts.form.shift") });
  const openAssign = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(within(toolbar()).getByRole("button", { name: S("workforce.assign") }));
    return waitLayer("workforce-assign");
  };
  const optionTexts = async (user: ReturnType<typeof userEvent.setup>, sheet: HTMLElement) => {
    await user.click(shiftBox(sheet));
    const opts = (await screen.findAllByRole("option")).map((o) => o.textContent);
    await user.keyboard("{Escape}");
    return opts;
  };
  const twoFactories = () => {
    srv.shifts = [
      shift(11, "Ca 1", "C1", 6, 14, { factoryId: 1 }),
      shift(21, "Ca 1", "C1", 6, 14, { factoryId: 2 }),
      shift(5, "Ca HC", "HC", 22, 23),
    ];
    srv.factoryNames = { 1: "NM Bắc", 2: "NM Nam" };
    srv.lineFactory = { 7: 1, 8: 2 };
  };

  it("sheet đọc safety.assignableShifts (KHÔNG shiftConfig.list); người bị thu hẹp ⇒ chỉ ca nhà máy của mình ⇒ 10:00 chọn sẵn đúng MỘT ca", async () => {
    at(10);
    twoFactories();
    srv.scope = [1];
    const user = userEvent.setup();
    render(<ProductionShifts />);
    const sheet = await openAssign(user);
    expect(srv.queryInputs).toContain("safety.assignableShifts:{}");
    // NM Bắc + toàn hệ thống = HAI "nhà máy" ⇒ nhãn mang nhà máy
    expect(shiftBox(sheet)).toHaveTextContent("Ca 1 (C1) 06:00–14:00 · NM Bắc");
    expect(await optionTexts(user, sheet)).toEqual([
      S("shifts.form.noShift"),
      "Ca 1 (C1) 06:00–14:00 · NM Bắc",
      `Ca HC (HC) 22:00–23:00 · ${S("shifts.form.allFactories")}`,
    ]);
    await user.type(within(sheet).getByLabelText(S("workforce.operatorId")), "70");
    await user.click(within(sheet).getByRole("button", { name: S("workforce.assign") }));
    await waitFor(() => expect(calls("assignOperator")).toEqual([expect.objectContaining({ operatorId: 70, shiftConfigId: 11 })]));
  });

  it("toàn quyền, hai nhà máy cùng 'Ca 1 06–14': chưa chọn chuyền ⇒ không đoán; nhập chuyền 8 (NM Nam) ⇒ input {lineId: 8}, chỉ ca NM Nam, chọn sẵn ca 21", async () => {
    at(10);
    twoFactories();
    const user = userEvent.setup();
    render(<ProductionShifts />);
    const sheet = await openAssign(user);
    expect(shiftBox(sheet)).toHaveTextContent(S("shifts.form.noShift"));
    expect(await optionTexts(user, sheet)).toEqual([
      S("shifts.form.noShift"),
      "Ca 1 (C1) 06:00–14:00 · NM Bắc",
      "Ca 1 (C1) 06:00–14:00 · NM Nam",
      `Ca HC (HC) 22:00–23:00 · ${S("shifts.form.allFactories")}`,
    ]);
    await user.type(within(sheet).getByLabelText(S("workforce.lineId")), "8");
    await waitFor(() => expect(srv.queryInputs).toContain('safety.assignableShifts:{"lineId":8}'));
    await waitFor(() => expect(shiftBox(sheet)).toHaveTextContent("Ca 1 (C1) 06:00–14:00 · NM Nam"));
    expect(await optionTexts(user, sheet)).toEqual([
      S("shifts.form.noShift"),
      "Ca 1 (C1) 06:00–14:00 · NM Nam",
      `Ca HC (HC) 22:00–23:00 · ${S("shifts.form.allFactories")}`,
    ]);
    await user.type(within(sheet).getByLabelText(S("workforce.operatorId")), "71");
    await user.click(within(sheet).getByRole("button", { name: S("workforce.assign") }));
    await waitFor(() => expect(calls("assignOperator")).toEqual([expect.objectContaining({ operatorId: 71, lineId: 8, shiftConfigId: 21 })]));
  });

  it("đã chọn ca NM Bắc rồi đổi sang chuyền NM Nam ⇒ ca cũ không còn trong danh sách ⇒ về mặc định của tập mới (không gửi ca bị từ chối)", async () => {
    at(3); // ngoài mọi ca ⇒ mặc định = không gắn ca
    twoFactories();
    const user = userEvent.setup();
    render(<ProductionShifts />);
    const sheet = await openAssign(user);
    await user.click(shiftBox(sheet));
    await user.click(await screen.findByRole("option", { name: "Ca 1 (C1) 06:00–14:00 · NM Bắc" }));
    expect(shiftBox(sheet)).toHaveTextContent("NM Bắc");
    await user.type(within(sheet).getByLabelText(S("workforce.lineId")), "8");
    await waitFor(() => expect(shiftBox(sheet)).toHaveTextContent(S("shifts.form.noShift")));
    await user.type(within(sheet).getByLabelText(S("workforce.operatorId")), "72");
    await user.click(within(sheet).getByRole("button", { name: S("workforce.assign") }));
    await waitFor(() => expect(calls("assignOperator").length).toBe(1));
    expect("shiftConfigId" in (calls("assignOperator")[0] as Row)).toBe(false);
  });

  it("một nhà máy duy nhất (mọi ca toàn hệ thống hoặc cùng nhà máy) ⇒ nhãn KHÔNG thêm nhà máy (như trước)", async () => {
    srv.shifts = [shift(1, "Ca sáng", "A", 6, 14, { factoryId: 1 }), shift(2, "Ca chiều", "B", 14, 22, { factoryId: 1 })];
    srv.factoryNames = { 1: "NM Bắc" };
    const user = userEvent.setup();
    render(<ProductionShifts />);
    const sheet = await openAssign(user);
    expect(await optionTexts(user, sheet)).toEqual([S("shifts.form.noShift"), "Ca sáng (A) 06:00–14:00", "Ca chiều (B) 14:00–22:00"]);
  });

  it("phân công lại: ca cũ của nhà máy NGOÀI phạm vi (không còn trong tập) ⇒ không điền sẵn ca đó, rơi về ca 'bây giờ' trong tập", async () => {
    at(10);
    twoFactories();
    srv.scope = [1];
    Object.assign(srv.assignments.find((a) => a.id === 4)!, { shiftConfigId: 21 });
    srv.snap.assignments = srv.assignments.map((x) => ({ ...x }));
    const user = userEvent.setup();
    render(<ProductionShifts />);
    await user.click(within(rowOf(44)).getByRole("button", { name: S("workforce.reassign") }));
    const sheet = await waitLayer("workforce-reassign");
    // hàng #4 có lineId 1 (không thuộc bản đồ chuyền ⇒ nhà máy không rõ ⇒ chỉ lọc phạm vi)
    expect(srv.queryInputs).toContain('safety.assignableShifts:{"lineId":1,"stationId":2}');
    expect(shiftBox(sheet)).toHaveTextContent("Ca 1 (C1) 06:00–14:00 · NM Bắc");
    await user.click(within(sheet).getByRole("button", { name: S("workforce.reassign") }));
    await waitFor(() => expect(calls("reassignOperator")).toEqual([expect.objectContaining({ assignmentId: 4, shiftConfigId: 11 })]));
  });
});

// ── doc 81 Đợt 3b final wave — post-review (4): đổi chuyền ⇒ tập ca MỚI đang tải: KHÔNG hiện / KHÔNG gửi được ca của tập CŨ ──────
describe("Đợt 3b post-review (4) — tập ca đang tải sau khi đổi chuyền", () => {
  const shiftBox = (sheet: HTMLElement) => within(sheet).getByRole("combobox", { name: S("shifts.form.shift") });
  it("chọn ca NM Bắc rồi gõ chuyền 8 (đang tải) ⇒ bộ chọn + Phân công KHOÁ, câu 'đang tải', không còn ca cũ; tải xong ⇒ mở lại với tập mới", async () => {
    vi.setSystemTime(new Date(2026, 9, 6, 3, 0, 0));
    srv.shifts = [shift(11, "Ca 1", "C1", 6, 14, { factoryId: 1 }), shift(21, "Ca 1", "C1", 6, 14, { factoryId: 2 }), shift(5, "Ca HC", "HC", 22, 23)];
    srv.factoryNames = { 1: "NM Bắc", 2: "NM Nam" };
    srv.lineFactory = { 8: 2 };
    srv.pendingLines = [8];
    const user = userEvent.setup();
    render(<ProductionShifts />);
    await user.click(within(toolbar()).getByRole("button", { name: S("workforce.assign") }));
    const sheet = await waitLayer("workforce-assign");
    await user.click(shiftBox(sheet));
    await user.click(await screen.findByRole("option", { name: "Ca 1 (C1) 06:00–14:00 · NM Bắc" }));
    await user.type(within(sheet).getByLabelText(S("workforce.operatorId")), "73");
    await user.type(within(sheet).getByLabelText(S("workforce.lineId")), "8");
    await waitFor(() => expect(srv.queryInputs).toContain('safety.assignableShifts:{"lineId":8}'));
    const submit = within(sheet).getByRole("button", { name: S("workforce.assign") });
    expect(submit).toBeDisabled();
    expect(shiftBox(sheet)).toBeDisabled();
    expect(shiftBox(sheet)).not.toHaveTextContent("NM Bắc");
    expect(within(sheet).getByText(S("shifts.form.loadingShifts"))).toBeInTheDocument();
    await user.click(submit);
    expect(calls("assignOperator")).toEqual([]);
    srv.pendingLines = [];
    await act(async () => bump());
    await waitFor(() => expect(within(sheet).getByRole("button", { name: S("workforce.assign") })).toBeEnabled());
    expect(within(sheet).queryByText(S("shifts.form.loadingShifts"))).toBeNull();
    await user.click(within(sheet).getByRole("button", { name: S("workforce.assign") }));
    await waitFor(() => expect(calls("assignOperator").length).toBe(1));
    expect(calls("assignOperator")[0]).not.toHaveProperty("shiftConfigId", 11);
  });
});
