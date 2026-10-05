// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 6 — Recipes thành mẫu P3 (danh sách mã trái + chi tiết có tab + flyout).
// Hợp đồng (task-6-brief + page-task-dispatch + plan Review Focus 1/4 + GC3):
//   - Danh sách MÃ recipe bên trái (ngoài MAIN). MAIN = CHI TIẾT recipe (doc 81 §1.2: mainRegion "detail"),
//     trong <main>, không chứa h1/header/KPI. Mã đang chọn ở `?code=`, tab ở `?tab=` (F5 giữ).
//     Tab: Tham số / Phiên bản (VersionHistoryPanel) / Duyệt / Triển khai / Máy đang chạy.
//   - Bộ chọn máy gọn trong header (thay card "Xem theo máy" 146 px); kết quả "recipe đang chạy" của máy
//     vẫn đủ trạng thái và vẫn dẫn tới mã đó; `?machineId=` (Đợt 1) còn chạy.
//   - Banner HITL thành chip header (popover giữ nguyên câu cũ).
//   - Tạo phiên bản = sheet `?flyout=recipe-new`; duyệt = sheet `?flyout=recipe-approve&flyoutId=<id>`;
//     triển khai = drawer `?flyout=recipe-deploy&flyoutId=<id>` — R-2-n: MỘT máy, MỘT lượt `deploy` mỗi lần
//     xác nhận (đúng dialog cũ), giữ cổng "đã duyệt" + quyền + bước xác nhận; không có chọn nhiều máy.
//   - Rollback = RollbackConfirm `requireReason={false}` `requireOtp={false}` (hợp đồng cũ: AlertDialog,
//     không lý do, không OTP — R-2-g). Lưu trữ vẫn AlertDialog.
//   - Cổng recipe CHẶT Đợt 1C: lỗi `recipeArchived` (deploy) / `recipeRetired` (rollback) HIỆN RÕ trong UI
//     (khối role=alert cạnh hành động, kèm toast như cũ) — dịch bằng từ điển thật (mapTrpcError thật).
//   - `?filter=pending` (Đợt 1 Task 2) vẫn lọc mã có phiên bản cần chú ý.
// Chạy trên wouter THẬT với history jsdom. "Server" giả là kho trong bộ nhớ: truy vấn CHỈ đổi khi trang gọi
// invalidate đúng thủ tục (như react-query).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { installResizeHandleHitAreaShim } from "@/components/patterns/layoutKitTestPanels";

vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/PermissionGate", () => ({ ViewOnlyBadge: () => null }));
const perm = { canView: true, canCreate: true, canEdit: true };
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: false,
    hasPermission: (_m: string, a: string) =>
      a === "canView" ? perm.canView : a === "canCreate" ? perm.canCreate : a === "canEdit" ? perm.canEdit : false,
  }),
}));
// Final wave (M-3) — HẠ TẦNG: engineer ĐÃ bật 2FA (bộ chọn "Giao cho" nay mirror nửa 2FA của cổng server; thiếu 2FA ⇒ khoá).
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 7, name: "Tester", role: "engineer", twoFactorEnabled: true }, loading: false }),
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));

// ── "Server" giả ───────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const srv = vi.hoisted(() => ({
  versions: [] as Array<Record<string, unknown>>,
  deployments: [] as Array<Record<string, unknown>>,
  machines: [] as Array<Record<string, unknown>>,
  snap: { versions: [] as Array<Record<string, unknown>>, deployments: [] as Array<Record<string, unknown>> },
  version: 0,
  listeners: new Set<() => void>(),
  nextId: 100,
  nextDep: 100,
  calls: { create: [] as unknown[], approve: [] as unknown[], deploy: [] as unknown[], rollback: [] as unknown[], archive: [] as unknown[], setGolden: [] as unknown[] },
  invalidated: [] as string[],
  rollbackError: null as null | Error,
  holdDeploy: null as null | Promise<void>,
  queryInputs: [] as string[],
  // doc 81 Đợt 3 Task 4 — phân công đang hiệu lực + lượt gọi engineering.assign/unassign.
  assignments: [] as Array<Record<string, unknown>>,
  assignCalls: [] as unknown[],
}));
function bump() {
  srv.version++;
  for (const l of srv.listeners) l();
}
/** Lỗi tRPC đúng hình dạng server (appError → data.appCode/appParams). */
function appErr(message: string, code: string, appParams: Record<string, string>): Error {
  return Object.assign(new Error(message), { data: { code, appCode: "OPERATION_FAILED", appParams } });
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
  const q = (data: unknown, enabled = true) => ({
    data: enabled ? data : undefined,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  });
  const codesOf = (vs: Row[]) => {
    const by = new Map<string, Row[]>();
    for (const v of vs) by.set(String(v.code), [...(by.get(String(v.code)) ?? []), v]);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, rows]) => ({
      code,
      name: String(rows[0].name),
      versions: rows.length,
      maxVersion: Math.max(...rows.map((r) => Number(r.version))),
      activeVersion: rows.find((r) => r.status === "active")?.version ?? null,
      pendingCount: rows.filter((r) => r.approvedBy == null && (r.status === "draft" || r.status === "active")).length,
    }));
  };
  const later = () => Promise.resolve();
  const runOp = (path: string, input: Row): Promise<unknown> =>
    later().then(() => {
      if (path === "engineering.assign" || path === "engineering.unassign") {
        srv.assignCalls.push({ path, ...input });
        return { assigneeUserId: input.assigneeUserId, assigneeName: "Ky su B" };
      }
      if (path === "machineRecipe.recipes.create") {
        srv.calls.create.push(input);
        const same = srv.versions.filter((v) => v.code === input.code);
        const row = {
          id: srv.nextId++, code: input.code, name: input.name, version: same.length ? Math.max(...same.map((v) => Number(v.version))) + 1 : 1,
          payload: input.payload, status: "draft", isGolden: false, checksum: "c-new", notes: input.notes ?? null, machineId: null,
          createdBy: 7, createdByName: "Tester", createdAt: "2026-10-03T00:00:00Z", approvedBy: null, approvalNote: null,
        };
        srv.versions.push(row);
        return row;
      }
      if (path === "machineRecipe.recipes.approve") {
        srv.calls.approve.push(input);
        const v = srv.versions.find((x) => x.id === input.recipeId);
        if (v?.createdBy === 7) throw appErr("Segregation of duties", "BAD_REQUEST", { operation: "approveRecipe" });
        Object.assign(v!, { approvedBy: 9, approvalNote: input.note });
        return v;
      }
      if (path === "machineRecipe.recipes.deploy") {
        // Giữ lượt gọi đang bay (test đóng drawer khi chờ server): chạy lại đúng một lần khi thả.
        if (srv.holdDeploy) {
          const h = srv.holdDeploy;
          srv.holdDeploy = null;
          return h.then(() => runOp(path, input));
        }
        srv.calls.deploy.push(input);
        const v = srv.versions.find((x) => x.id === input.recipeId)!;
        // Cổng CHẶT (Đợt 1C): bản đã lưu trữ ⇒ PRECONDITION_FAILED recipeArchived — không ghi sổ.
        if (v.status === "archived") throw appErr(`Recipe #${v.id} is archived`, "PRECONDITION_FAILED", { operation: "deployRecipe", reason: "recipeArchived" });
        const m = srv.machines.find((x) => x.id === input.machineId);
        const dep = { id: srv.nextDep++, recipeId: v.id, machineId: input.machineId, machineName: m?.name ?? null, recipeCode: v.code, recipeVersion: v.version, deployedBy: 7, deployedAt: "2026-10-03T01:00:00Z", status: "deployed", previousRecipeId: null, notes: input.notes ?? null };
        srv.deployments.unshift(dep);
        return dep;
      }
      if (path === "machineRecipe.recipes.rollback") {
        srv.calls.rollback.push(input);
        if (srv.rollbackError) throw srv.rollbackError;
        return { id: 1 };
      }
      if (path === "machineRecipe.recipes.archive") {
        srv.calls.archive.push(input);
        Object.assign(srv.versions.find((x) => x.id === input.id)!, { status: "archived" });
        return { success: true };
      }
      if (path === "machineRecipe.recipes.setGolden") {
        srv.calls.setGolden.push(input);
        for (const v of srv.versions) if (v.code === srv.versions.find((x) => x.id === input.id)?.code) v.isGolden = false;
        const v = srv.versions.find((x) => x.id === input.id)!;
        v.isGolden = input.isGolden;
        return v;
      }
      return undefined;
    });
  const hooks = (path: string) => ({
    useQuery: (input?: Row, opts?: { enabled?: boolean }) => {
      useVersion();
      const enabled = opts?.enabled !== false;
      if (enabled) srv.queryInputs.push(`${path}:${JSON.stringify(input ?? null)}`);
      if (path === "machineRecipe.recipes.listCodes") return q(codesOf(srv.snap.versions), enabled);
      if (path === "machineRecipe.recipes.listVersions")
        return q(srv.snap.versions.filter((v) => v.code === input?.code).sort((a, b) => Number(b.version) - Number(a.version)), enabled);
      if (path === "machineRecipe.recipes.genealogy") return q([], enabled);
      if (path === "engineering.assignments") return q(srv.assignments, enabled);
      if (path === "engineering.assignableUsers") return q([{ id: 31, name: "Ky su A" }, { id: 32, name: "Ky su B" }], enabled);
      if (path === "machineRecipe.machines.list") return q(srv.machines, enabled);
      if (path === "machineRecipe.deployments.list") {
        const rows = input?.machineId != null ? srv.snap.deployments.filter((d) => d.machineId === input.machineId) : srv.snap.deployments;
        return q(rows.slice(0, Number(input?.limit ?? 100)), enabled);
      }
      return q(undefined, enabled);
    },
    useMutation: (hookOpts: { onSuccess?: (r: unknown, vars: Row) => void; onError?: (e: unknown, vars: Row) => void } = {}) => {
      const run = (input: Row) =>
        runOp(path, input).then(
          (r) => {
            hookOpts.onSuccess?.(r, input);
            return r;
          },
          (e) => {
            hookOpts.onError?.(e, input);
            throw e;
          },
        );
      return { isPending: false, mutate: (input: Row) => void run(input).catch(() => undefined), mutateAsync: run };
    },
  });
  const refresh = (path: string) => {
    if (path.startsWith("machineRecipe.recipes.listVersions") || path.startsWith("machineRecipe.recipes.listCodes")) {
      srv.snap.versions = srv.versions.map((x) => ({ ...x }));
      bump();
    }
    if (path.startsWith("machineRecipe.deployments.list")) {
      srv.snap.deployments = srv.deployments.map((x) => ({ ...x }));
      bump();
    }
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

import RecipeManagement from "./RecipeManagement";

const V = (o: Row): Row => ({
  code: "RCP-A", name: "Recipe A", machineId: null, machineType: null, isGolden: false, checksum: "c0ffee", notes: null,
  createdBy: 5, createdByName: "Alice", createdAt: "2026-09-20T00:00:00Z", approvedBy: null, approvalNote: null, ...o,
});
// ORACLE (khai tay): RCP-A có v4 (của CHÍNH người dùng 7, chưa duyệt), v3 (Alice, chưa duyệt), v2 (active, đã
// duyệt, Golden, gắn máy 3), v1 (đã lưu trữ, đã duyệt). RCP-B v1 active đã duyệt, không cần chú ý.
const VERSIONS = () => [
  V({ id: 14, version: 4, status: "draft", createdBy: 7, createdByName: "Tester", payload: { speed: 4 } }),
  V({ id: 13, version: 3, status: "draft", notes: "tang toc", payload: { speed: 3, lighting: { top: 90 } } }),
  V({ id: 12, version: 2, status: "active", approvedBy: 9, isGolden: true, machineId: 3, payload: { speed: 2, lighting: { top: 100 } } }),
  V({ id: 11, version: 1, status: "archived", approvedBy: 9, payload: { speed: 1 } }),
  V({ id: 21, code: "RCP-B", name: "Recipe B", version: 1, status: "active", approvedBy: 9, payload: { x: 1 } }),
];
const DEPLOYMENTS = () => [
  { id: 3, recipeId: 21, machineId: 4, machineName: "M4", recipeCode: "RCP-B", recipeVersion: 1, deployedBy: 9, deployedAt: "2026-09-30T00:00:00Z", status: "deployed", previousRecipeId: null, notes: null },
  { id: 2, recipeId: 12, machineId: 3, machineName: "M3", recipeCode: "RCP-A", recipeVersion: 2, deployedBy: 9, deployedAt: "2026-09-29T00:00:00Z", status: "deployed", previousRecipeId: 11, notes: "len v2" },
  { id: 1, recipeId: 11, machineId: 3, machineName: "M3", recipeCode: "RCP-A", recipeVersion: 1, deployedBy: 9, deployedAt: "2026-09-28T00:00:00Z", status: "rolled_back", previousRecipeId: null, notes: null },
];
const MACHINES = () => [
  { id: 3, code: "MC-3", name: "M3", machineType: "AOI" },
  { id: 4, code: "MC-4", name: "M4", machineType: "AOI" },
  { id: 5, code: "MC-5", name: "M5", machineType: "SPI" },
];

beforeAll(async () => {
  installResizeHandleHitAreaShim();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function () {};
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture ??= () => false;
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  srv.versions = VERSIONS();
  srv.deployments = DEPLOYMENTS();
  srv.machines = MACHINES();
  srv.snap = { versions: srv.versions.map((x) => ({ ...x })), deployments: srv.deployments.map((x) => ({ ...x })) };
  srv.calls = { create: [], approve: [], deploy: [], rollback: [], archive: [], setGolden: [] };
  srv.invalidated = [];
  srv.queryInputs = [];
  srv.nextId = 100;
  srv.rollbackError = null;
  srv.holdDeploy = null;
  srv.assignments = [{ entityId: 13, assigneeUserId: 31, assigneeName: "Ky su A" }, { entityId: 12, assigneeUserId: 31, assigneeName: "Ky su A" }];
  srv.assignCalls = [];
  perm.canView = true;
  perm.canCreate = true;
  perm.canEdit = true;
  for (const f of Object.values(toastSpy)) f.mockClear();
  localStorage.clear();
  window.history.replaceState(null, "", "/recipes");
});
afterEach(() => cleanup());

const mainEl = () => document.querySelector("[data-layout-main]") as HTMLElement;
const listEl = () => screen.getByRole("region", { name: "Mã recipe" });
const params = () => new URLSearchParams(window.location.search);
const layer = (key: string) => document.querySelector(`[data-flyout-key="${key}"]`) as HTMLElement | null;
const waitLayer = (key: string) =>
  waitFor(() => {
    const l = layer(key);
    expect(l).toBeTruthy();
    return l as HTMLElement;
  });
const codeRow = (code: string) => within(listEl()).getByText(code).closest("tr") as HTMLElement;
const tab = (name: RegExp) => within(mainEl()).getByRole("tab", { name });
const ARCHIVED_VI = "Phiên bản công thức này đã lưu trữ — hãy tạo phiên bản mới thay vì đưa bản đã lưu trữ vào chạy.";
const RETIRED_VI =
  "Phiên bản này đã bị CỐ Ý lưu trữ (không phải chỉ bị thay bằng bản mới), hoặc không có dấu vết từng bị thay — không thể quay lui về nó. Hãy tạo phiên bản mới.";

async function openCode(code = "RCP-A", tabName?: RegExp) {
  const user = userEvent.setup();
  render(<RecipeManagement />);
  await user.click(codeRow(code));
  if (tabName) await user.click(tab(tabName));
  return user;
}

describe("Recipes P3 — bố cục", () => {
  it("MAIN = chi tiết recipe (trong <main>, không h1/header/KPI); danh sách mã bên trái NGOÀI MAIN; h1 ở header một hàng", () => {
    render(<RecipeManagement />);
    const mains = document.querySelectorAll("[data-layout-main]");
    expect(mains).toHaveLength(1);
    const m = mainEl();
    expect(m.closest("main")).toBeTruthy();
    expect(m.getAttribute("aria-label")).toBe("Chi tiết recipe");
    expect(m.querySelector("h1")).toBeNull();
    expect(m.querySelector("[data-layout-header]")).toBeNull();
    expect(m.querySelector("[data-layout-kpi]")).toBeNull();
    expect(m.contains(listEl())).toBe(false);
    for (const c of ["RCP-A", "RCP-B"]) expect(within(listEl()).getByText(c)).toBeTruthy();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Quản lý Recipe máy");
    expect(h1.closest("[data-layout-header]")).toBeTruthy();
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
  });

  it("banner HITL thành chip header (câu cũ trong popover), không còn khối HITL giữa header và MAIN", async () => {
    const user = userEvent.setup();
    render(<RecipeManagement />);
    expect(screen.queryByText(/dùng luồng HITL trong AI Copilot/)).toBeNull();
    const header = document.querySelector("[data-layout-header]") as HTMLElement;
    await user.click(within(header).getByRole("button", { name: /Đẩy xuống máy qua HITL/ }));
    expect(await screen.findByText(/Triển khai chỉ cập nhật catalog \(kích hoạt phiên bản \+ ghi sổ\)/)).toBeTruthy();
  });

  it("chưa chọn mã: MAIN hiện sổ triển khai mọi máy (bảng) + gợi ý chọn mã; card 'Xem theo máy' không còn", () => {
    render(<RecipeManagement />);
    const m = mainEl();
    // Đợt 3 Task 1 — ĐỔI BỘ CHỌN: tiêu đề sổ nay là tab đầu của hàng tab "Lịch sử triển khai / Lịch sử nạp".
    expect(within(m).getByRole("tab", { name: /Lịch sử triển khai/ })).toHaveTextContent("(3)");
    expect(within(m).getByText(/Chọn một mã recipe ở danh sách bên trái/)).toBeTruthy();
    const rows = within(m).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(screen.queryByText("Xem theo máy")).toBeNull();
  });

  it("chọn mã (bấm hàng) ⇒ `?code=`, aria-current, MAIN có đúng MỘT thanh công cụ chứa 6 tab; mặc định tab Phiên bản", async () => {
    await openCode("RCP-A");
    expect(params().get("code")).toBe("RCP-A");
    expect(codeRow("RCP-A")).toHaveAttribute("aria-current", "true");
    const toolbars = mainEl().querySelectorAll("[data-layout-toolbar]");
    expect(toolbars).toHaveLength(1);
    const names = within(toolbars[0] as HTMLElement).getAllByRole("tab").map((x) => x.textContent?.replace(/\d+$/, "").trim());
    // Đợt 3 Task 1 — thêm tab thứ 6 "Lịch sử nạp" (yêu cầu của task, dời từ Integration).
    expect(names).toEqual(["Tham số", "Phiên bản", "Duyệt", "Triển khai", "Máy đang chạy", "Lịch sử nạp"]);
    expect(tab(/^Phiên bản/)).toHaveAttribute("aria-selected", "true");
    expect(mainEl().querySelector("[data-version-history]")).toBeTruthy();
  });

  it("chọn mã bằng bàn phím (Enter trên hàng)", async () => {
    render(<RecipeManagement />);
    const row = codeRow("RCP-B");
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    await waitFor(() => expect(params().get("code")).toBe("RCP-B"));
  });

  it("F5 `?code=RCP-A&tab=approval` dựng lại đúng mã + tab; bấm tab ghi `?tab=` (replace)", async () => {
    window.history.replaceState(null, "", "/recipes?code=RCP-A&tab=approval");
    const user = userEvent.setup();
    render(<RecipeManagement />);
    expect(tab(/^Duyệt/)).toHaveAttribute("aria-selected", "true");
    expect(within(mainEl()).getByRole("heading", { name: "RCP-A" })).toBeTruthy();
    await user.click(tab(/^Triển khai/));
    expect(params().get("tab")).toBe("deploy");
    expect(params().get("code")).toBe("RCP-A");
  });

  it("`?tab=` lạ ⇒ về tab mặc định (Phiên bản)", () => {
    window.history.replaceState(null, "", "/recipes?code=RCP-A&tab=bogus");
    render(<RecipeManagement />);
    expect(tab(/^Phiên bản/)).toHaveAttribute("aria-selected", "true");
  });

  it("`?filter=pending` (deep-link Hub) chỉ còn mã CẦN CHÚ Ý; chip 'Xem tất cả' bỏ lọc", async () => {
    window.history.replaceState(null, "", "/recipes?filter=pending");
    const user = userEvent.setup();
    render(<RecipeManagement />);
    expect(within(listEl()).getByText("RCP-A")).toBeTruthy();
    expect(within(listEl()).queryByText("RCP-B")).toBeNull();
    const toolbar = listEl().querySelector("[data-layout-toolbar]") as HTMLElement;
    expect(within(toolbar).getByText(/Chỉ mã cần chú ý/)).toBeTruthy();
    await user.click(within(toolbar).getByRole("button", { name: "Xem tất cả" }));
    expect(within(listEl()).getByText("RCP-B")).toBeTruthy();
  });

  it("fix 1 — đến từ `?filter=pending` ⇒ chọn mã mở thẳng tab Duyệt; `?tab=` hợp lệ vẫn thắng", async () => {
    window.history.replaceState(null, "", "/recipes?filter=pending");
    const user = userEvent.setup();
    render(<RecipeManagement />);
    await user.click(codeRow("RCP-A"));
    expect(tab(/^Duyệt/)).toHaveAttribute("aria-selected", "true");
    expect(mainEl().querySelector('tr[data-recipe-id="13"]')).toBeTruthy();
    cleanup();
    window.history.replaceState(null, "", "/recipes?filter=pending&code=RCP-A&tab=deploy");
    render(<RecipeManagement />);
    expect(tab(/^Triển khai/)).toHaveAttribute("aria-selected", "true");
  });

  it("fix 1 — 'Tất cả mã' bỏ chọn mã ⇒ MAIN về sổ triển khai MỌI máy (kể cả hàng không có mã recipe)", async () => {
    srv.deployments.push({ id: 9, recipeId: 77, machineId: 5, machineName: "M5", recipeCode: null, recipeVersion: null, deployedBy: 9, deployedAt: "2026-09-27T00:00:00Z", status: "deployed", previousRecipeId: null, notes: "khong ma" });
    srv.snap.deployments = srv.deployments.map((x) => ({ ...x }));
    const user = await openCode("RCP-A", /^Triển khai/);
    expect(within(mainEl()).queryByText("khong ma")).toBeNull();
    const toolbar = listEl().querySelector("[data-layout-toolbar]") as HTMLElement;
    await user.click(within(toolbar).getByRole("button", { name: "Tất cả mã" }));
    expect(params().get("code")).toBeNull();
    expect(codeRow("RCP-A")).not.toHaveAttribute("aria-current");
    // Đợt 3 Task 1 — ĐỔI BỘ CHỌN: heading ⇒ tab (như trên).
    expect(within(mainEl()).getByRole("tab", { name: /Lịch sử triển khai/ })).toHaveTextContent("(4)");
    expect(within(mainEl()).getByText("khong ma")).toBeTruthy();
    expect(within(toolbar).queryByRole("button", { name: "Tất cả mã" })).toBeNull();
  });
});

describe("Recipes P3 — bộ chọn máy trong header (thay card 146 px)", () => {
  it("chọn máy ⇒ thấy recipe đang chạy của máy đó; bấm ⇒ mở đúng mã", async () => {
    const user = userEvent.setup();
    render(<RecipeManagement />);
    const header = document.querySelector("[data-layout-header]") as HTMLElement;
    await user.click(within(header).getByRole("combobox", { name: "Chọn máy" }));
    await user.click(await screen.findByRole("option", { name: /M3/ }));
    const running = await screen.findByTestId("running-recipe");
    expect(header.contains(running)).toBe(true);
    const go = within(running).getByRole("button", { name: /RCP-A v2/ });
    await user.click(go);
    expect(params().get("code")).toBe("RCP-A");
    expect(srv.queryInputs).toContain('machineRecipe.deployments.list:{"machineId":3,"limit":20}');
  });

  it("`?machineId=4` (deep-link Đợt 1) mở sẵn máy; máy chưa có recipe ⇒ câu trống trung thực", async () => {
    window.history.replaceState(null, "", "/recipes?machineId=4");
    render(<RecipeManagement />);
    expect(within(await screen.findByTestId("running-recipe")).getByRole("button", { name: /RCP-B v1/ })).toBeTruthy();
    cleanup();
    window.history.replaceState(null, "", "/recipes?machineId=5");
    render(<RecipeManagement />);
    expect(within(await screen.findByTestId("running-recipe")).getByText("Máy này chưa có recipe đang chạy.")).toBeTruthy();
  });
});

describe("Recipes P3 — tab chi tiết", () => {
  it("Phiên bản = VersionHistoryPanel: bản GỐC mặc định là Golden (W5-22), 'Xem' chuyển sang tab Tham số đúng phiên bản", async () => {
    const user = await openCode("RCP-A");
    const panel = mainEl().querySelector("[data-version-history]") as HTMLElement;
    expect(within(panel).getByRole("radio", { name: "Chọn v2 làm bản gốc" })).toBeChecked();
    const r13 = panel.querySelector('tr[data-version-id="13"]') as HTMLElement;
    await user.click(within(r13).getByRole("button", { name: "Xem" }));
    expect(params().get("tab")).toBe("params");
    const m = mainEl();
    expect(within(m).getByText("lighting.top")).toBeTruthy();
    expect(within(m).getByText("90")).toBeTruthy();
  });

  it("Tham số mặc định = phiên bản ĐANG CHẠY (active), kể cả khi Golden là bản khác", async () => {
    // Golden = v3 (lighting.top 90), active = v2 (lighting.top 100) ⇒ lưới phải hiện bản ĐANG CHẠY.
    for (const v of srv.versions) v.isGolden = v.id === 13;
    srv.snap.versions = srv.versions.map((x) => ({ ...x }));
    await openCode("RCP-A", /^Tham số/);
    expect(within(mainEl()).getByText("100")).toBeTruthy();
    expect(within(mainEl()).queryByText("90")).toBeNull();
  });

  it("Golden: bấm sao ⇒ setGolden đúng payload, invalidate", async () => {
    const user = await openCode("RCP-A");
    const r13 = mainEl().querySelector('tr[data-version-id="13"]') as HTMLElement;
    await user.click(within(r13).getByRole("button", { name: "Đánh dấu Golden" }));
    await waitFor(() => expect(srv.calls.setGolden).toEqual([{ id: 13, isGolden: true }]));
    await waitFor(() => expect(srv.invalidated).toContain("machineRecipe.recipes.listCodes"));
  });

  it("Lưu trữ: AlertDialog xác nhận (phá huỷ) ⇒ archive {id}", async () => {
    const user = await openCode("RCP-A");
    const r13 = mainEl().querySelector('tr[data-version-id="13"]') as HTMLElement;
    await user.click(within(r13).getByRole("button", { name: "Lưu trữ" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText("Lưu trữ phiên bản v3?")).toBeTruthy();
    await user.click(within(dlg).getByRole("button", { name: "Lưu trữ" }));
    await waitFor(() => expect(srv.calls.archive).toEqual([{ id: 13 }]));
  });

  it("Máy đang chạy: máy có bản 'deployed' MỚI NHẤT thuộc mã này", async () => {
    await openCode("RCP-A", /^Máy đang chạy/);
    const m = mainEl();
    expect(within(m).getByText(/M3/)).toBeTruthy();
    expect(within(m).queryByText(/M4/)).toBeNull();
  });
});

describe("Recipes P3 — sheet tạo phiên bản", () => {
  it("mở → điền sẵn mã đang chọn → nhập → lưu ⇒ create đúng payload, danh sách cập nhật SAU invalidate, sheet đóng, URL sạch", async () => {
    const user = await openCode("RCP-A");
    await user.click(screen.getByRole("button", { name: "Lưu phiên bản mới" }));
    const l = await waitLayer("recipe-new");
    expect(params().get("flyout")).toBe("recipe-new");
    expect(params().get("code")).toBe("RCP-A");
    expect(within(l).getByLabelText("Mã")).toHaveValue("RCP-A");
    await user.type(within(l).getByLabelText("Tên"), "Recipe A moi");
    fireEvent.change(within(l).getByLabelText("Payload (JSON)"), { target: { value: '{"speed": 5}' } });
    await user.type(within(l).getByLabelText("Ghi chú"), "ly do");
    await user.click(within(l).getByRole("button", { name: "Lưu phiên bản mới" }));
    await waitFor(() => expect(srv.calls.create).toEqual([{ code: "RCP-A", name: "Recipe A moi", payload: { speed: 5 }, notes: "ly do" }]));
    await waitFor(() => expect(layer("recipe-new")).toBeNull());
    expect(params().get("flyout")).toBeNull();
    expect(toastSpy.success).toHaveBeenCalledWith("Đã tạo phiên bản recipe (draft)");
    expect(srv.invalidated).toContain("machineRecipe.recipes.listCodes");
    await waitFor(() => expect(mainEl().querySelector('tr[data-version-id="100"]')).toBeTruthy());
  });

  it("JSON sai / không phải object ⇒ báo lỗi trong sheet, KHÔNG gọi server; thiếu tên ⇒ nút Lưu khoá", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/recipes?flyout=recipe-new");
    render(<RecipeManagement />);
    const l = await waitLayer("recipe-new");
    const save = within(l).getByRole("button", { name: "Lưu phiên bản mới" });
    expect(save).toBeDisabled();
    await user.type(within(l).getByLabelText("Mã"), "RCP-C");
    await user.type(within(l).getByLabelText("Tên"), "C");
    fireEvent.change(within(l).getByLabelText("Payload (JSON)"), { target: { value: "[1,2]" } });
    await user.click(save);
    expect(within(l).getByText(/Payload phải là một object JSON/)).toBeTruthy();
    fireEvent.change(within(l).getByLabelText("Payload (JSON)"), { target: { value: "{oops" } });
    await user.click(save);
    expect(within(l).getByText(/JSON không hợp lệ/)).toBeTruthy();
    expect(srv.calls.create).toEqual([]);
  });

  it("không có quyền tạo ⇒ nút khoá kèm lý do, deep-link KHÔNG mở sheet", async () => {
    perm.canCreate = false;
    window.history.replaceState(null, "", "/recipes?flyout=recipe-new");
    render(<RecipeManagement />);
    const btn = screen.getByRole("button", { name: "Lưu phiên bản mới" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "Cần quyền machine_control");
    await new Promise((r) => setTimeout(r, 30));
    expect(layer("recipe-new")).toBeNull();
  });
});

describe("Recipes P3 — sheet duyệt (W2-9 phân tách nhiệm vụ)", () => {
  it("tab Duyệt → Duyệt v3 → sheet có người tạo, ghi chú, diff so với Golden → xác nhận ⇒ approve đúng payload, đóng, URL sạch", async () => {
    const user = await openCode("RCP-A", /^Duyệt/);
    const row = mainEl().querySelector('tr[data-recipe-id="13"]') as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Duyệt" }));
    const l = await waitLayer("recipe-approve");
    expect(params().get("flyoutId")).toBe("13");
    expect(within(l).getByText("Alice")).toBeTruthy();
    expect(within(l).getByText("tang toc")).toBeTruthy();
    expect(within(l).getByText("Khác biệt so với bản Golden")).toBeTruthy();
    expect(within(l).getByText("Người duyệt phải KHÁC người tạo (phân tách nhiệm vụ).")).toBeTruthy();
    await user.type(within(l).getByLabelText("Ghi chú duyệt"), "ok");
    await user.click(within(l).getByRole("button", { name: "Xác nhận duyệt" }));
    await waitFor(() => expect(srv.calls.approve).toEqual([{ recipeId: 13, note: "ok" }]));
    await waitFor(() => expect(layer("recipe-approve")).toBeNull());
    expect(params().get("flyout")).toBeNull();
    expect(toastSpy.success).toHaveBeenCalledWith("Đã duyệt công thức");
    expect(srv.invalidated).toContain('machineRecipe.recipes.listVersions:{"code":"RCP-A"}');
  });

  it("phiên bản của CHÍNH mình: nút Duyệt khoá kèm lý do; deep-link sheet ⇒ nút xác nhận khoá", async () => {
    window.history.replaceState(null, "", "/recipes?code=RCP-A&tab=approval");
    render(<RecipeManagement />);
    const own = mainEl().querySelector('tr[data-recipe-id="14"]') as HTMLElement;
    const btn = within(own).getByRole("button", { name: "Duyệt" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "Không thể tự duyệt công thức của mình (phân tách nhiệm vụ)");
    cleanup();
    window.history.replaceState(null, "", "/recipes?code=RCP-A&flyout=recipe-approve&flyoutId=14");
    render(<RecipeManagement />);
    const l = await waitLayer("recipe-approve");
    expect(within(l).getByRole("button", { name: "Xác nhận duyệt" })).toBeDisabled();
  });

  it("không có quyền sửa ⇒ deep-link duyệt KHÔNG mở", async () => {
    perm.canEdit = false;
    window.history.replaceState(null, "", "/recipes?code=RCP-A&flyout=recipe-approve&flyoutId=13");
    render(<RecipeManagement />);
    await new Promise((r) => setTimeout(r, 30));
    expect(layer("recipe-approve")).toBeNull();
  });
});

describe("doc 81 Đợt 3 Task 4 — tab Duyệt: 'Giao cho' + cột 'Người được giao'", () => {
  it("bản NHÁP chưa duyệt ⇒ bộ chọn 'Giao cho' (v3 đang giao Ky su A); bản đã duyệt ⇒ chỉ tên, không bộ chọn", () => {
    window.history.replaceState(null, "", "/recipes?code=RCP-A&tab=approval");
    render(<RecipeManagement />);
    expect(within(mainEl()).getByRole("columnheader", { name: "Người được giao" })).toBeInTheDocument();
    const v3 = mainEl().querySelector('tr[data-recipe-id="13"]') as HTMLElement;
    expect(within(v3).getByRole("combobox", { name: "Giao cho" })).toHaveTextContent("Ky su A");
    const v4 = mainEl().querySelector('tr[data-recipe-id="14"]') as HTMLElement;
    expect(within(v4).getByRole("combobox", { name: "Giao cho" })).toHaveTextContent("Chưa giao");
    const v2 = mainEl().querySelector('tr[data-recipe-id="12"]') as HTMLElement;
    expect(within(v2).queryByRole("combobox", { name: "Giao cho" })).toBeNull();
    expect(v2.querySelector("[data-assignee-cell]")).toHaveTextContent("Ky su A");
  });

  it("giao v4 cho Ky su B ⇒ MỘT lượt engineering.assign (expected=null); nút Duyệt của v4 VẪN khoá (tự duyệt) — được giao ≠ được duyệt", async () => {
    window.history.replaceState(null, "", "/recipes?code=RCP-A&tab=approval");
    render(<RecipeManagement />);
    const v4 = mainEl().querySelector('tr[data-recipe-id="14"]') as HTMLElement;
    fireEvent.click(within(v4).getByRole("combobox", { name: "Giao cho" }));
    fireEvent.click(screen.getByRole("option", { name: /Ky su B/ }));
    await waitFor(() => expect(srv.assignCalls).toHaveLength(1));
    expect(srv.assignCalls[0]).toEqual({ path: "engineering.assign", entityType: "recipe", entityId: 14, assigneeUserId: 32, expectedAssigneeUserId: null });
    expect(within(v4).getByRole("button", { name: "Duyệt" })).toBeDisabled();
    expect(srv.calls.approve).toEqual([]);
  });

  it("không có quyền sửa ⇒ không bộ chọn (chỉ tên), như nút Duyệt", () => {
    perm.canEdit = false;
    window.history.replaceState(null, "", "/recipes?code=RCP-A&tab=approval");
    render(<RecipeManagement />);
    const v3 = mainEl().querySelector('tr[data-recipe-id="13"]') as HTMLElement;
    expect(within(v3).queryByRole("combobox", { name: "Giao cho" })).toBeNull();
    expect(v3).toHaveTextContent("Ky su A");
  });
});

describe("Recipes P3 — drawer triển khai (R-2-n: MỘT máy, MỘT lượt mỗi lần xác nhận)", () => {
  const machinePicker = (l: HTMLElement) => within(l).getByRole("combobox", { name: "Máy" });

  it("bản CHƯA duyệt ⇒ nút Triển khai khoá kèm lý do", async () => {
    await openCode("RCP-A", /^Triển khai/);
    const r13 = mainEl().querySelector('tr[data-recipe-id="13"]') as HTMLElement;
    const btn = within(r13).getByRole("button", { name: "Triển khai" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "Phiên bản này phải được duyệt trước khi deploy");
  });

  it("v2 → drawer (HITL, máy gắn sẵn M3) → xác nhận ⇒ ĐÚNG MỘT lượt deploy đúng payload, toast, invalidate, đóng, URL sạch", async () => {
    const user = await openCode("RCP-A", /^Triển khai/);
    const r12 = mainEl().querySelector('tr[data-recipe-id="12"]') as HTMLElement;
    await user.click(within(r12).getByRole("button", { name: "Triển khai" }));
    const l = await waitLayer("recipe-deploy");
    expect(params().get("flyoutId")).toBe("12");
    expect(within(l).getByText(/dùng luồng HITL trong AI Copilot/)).toBeTruthy();
    expect(machinePicker(l)).toHaveTextContent("#3 · M3");
    await user.type(within(l).getByLabelText("Ghi chú"), "ca 2");
    await user.click(within(l).getByRole("button", { name: "Xác nhận triển khai" }));
    await waitFor(() => expect(layer("recipe-deploy")).toBeNull());
    expect(srv.calls.deploy).toEqual([{ recipeId: 12, machineId: 3, notes: "ca 2" }]);
    expect(params().get("flyout")).toBeNull();
    expect(toastSpy.success).toHaveBeenCalledTimes(1);
    expect(toastSpy.success).toHaveBeenCalledWith("Đã triển khai (cập nhật catalog + ghi sổ)");
    expect(srv.invalidated).toContain("machineRecipe.deployments.list");
  });

  it("KHÔNG chọn nhiều máy được: một ô chọn máy duy nhất, chọn máy khác THAY máy cũ ⇒ một lượt cho máy mới", async () => {
    window.history.replaceState(null, "", "/recipes?code=RCP-A&flyout=recipe-deploy&flyoutId=12");
    const user = userEvent.setup();
    render(<RecipeManagement />);
    const l = await waitLayer("recipe-deploy");
    expect(within(l).getAllByRole("combobox")).toHaveLength(1);
    expect(within(l).queryByRole("checkbox")).toBeNull();
    expect(within(l).queryByRole("button", { name: /Thêm máy|Bỏ M/ })).toBeNull();
    await user.click(machinePicker(l));
    await user.click(await screen.findByRole("option", { name: /M4/ }));
    expect(machinePicker(l)).toHaveTextContent("#4 · M4");
    expect(machinePicker(l)).not.toHaveTextContent("M3");
    await user.click(within(l).getByRole("button", { name: "Xác nhận triển khai" }));
    await waitFor(() => expect(layer("recipe-deploy")).toBeNull());
    expect(srv.calls.deploy).toEqual([{ recipeId: 12, machineId: 4, notes: null }]);
  });

  it("deep-link drawer tới bản CHƯA duyệt ⇒ có máy vẫn KHÔNG xác nhận được (cổng đã-duyệt trong drawer)", async () => {
    window.history.replaceState(null, "", "/recipes?code=RCP-A&flyout=recipe-deploy&flyoutId=13");
    const user = userEvent.setup();
    render(<RecipeManagement />);
    const l = await waitLayer("recipe-deploy");
    expect(within(l).getByText("Phiên bản này phải được duyệt trước khi deploy")).toBeTruthy();
    await user.click(machinePicker(l));
    await user.click(await screen.findByRole("option", { name: /M3/ }));
    expect(within(l).getByRole("button", { name: "Xác nhận triển khai" })).toBeDisabled();
    expect(srv.calls.deploy).toEqual([]);
  });

  it("chưa chọn máy nào ⇒ nút xác nhận khoá", async () => {
    window.history.replaceState(null, "", "/recipes?code=RCP-B&flyout=recipe-deploy&flyoutId=21");
    render(<RecipeManagement />);
    const l = await waitLayer("recipe-deploy");
    expect(within(l).getByRole("button", { name: "Xác nhận triển khai" })).toBeDisabled();
  });

  it("★ cổng CHẶT 1C: bản ĐÃ LƯU TRỮ ⇒ lỗi recipeArchived HIỆN RÕ trong drawer (role=alert, kèm máy) + toast; drawer giữ mở; một lượt", async () => {
    window.history.replaceState(null, "", "/recipes?code=RCP-A&tab=deploy");
    const user = userEvent.setup();
    render(<RecipeManagement />);
    const r11 = mainEl().querySelector('tr[data-recipe-id="11"]') as HTMLElement;
    await user.click(within(r11).getByRole("button", { name: "Triển khai" }));
    const l = await waitLayer("recipe-deploy");
    await user.click(machinePicker(l));
    await user.click(await screen.findByRole("option", { name: /M3/ }));
    await user.click(within(l).getByRole("button", { name: "Xác nhận triển khai" }));
    const alert = await within(l).findByRole("alert");
    expect(alert).toHaveTextContent(ARCHIVED_VI);
    expect(alert).toHaveTextContent("M3");
    expect(srv.calls.deploy).toEqual([{ recipeId: 11, machineId: 3, notes: null }]);
    expect(toastSpy.error).toHaveBeenCalledWith(expect.stringContaining(ARCHIVED_VI));
    expect(toastSpy.success).not.toHaveBeenCalled();
    expect(layer("recipe-deploy")).toBeTruthy();
  });

  it("đóng drawer khi lượt deploy ĐANG BAY: không cập nhật drawer đã đóng, KHÔNG đóng nhầm lớp mới; toast + invalidate vẫn chạy (hook trang); đúng một lượt", async () => {
    let release: () => void = () => {};
    srv.holdDeploy = new Promise<void>((r) => { release = r; });
    window.history.replaceState(null, "", "/recipes?code=RCP-A&flyout=recipe-deploy&flyoutId=12");
    const user = userEvent.setup();
    render(<RecipeManagement />);
    const l = await waitLayer("recipe-deploy");
    await user.click(within(l).getByRole("button", { name: "Xác nhận triển khai" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(layer("recipe-deploy")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Lưu phiên bản mới" }));
    await waitLayer("recipe-new");
    release();
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledWith("Đã triển khai (cập nhật catalog + ghi sổ)"));
    await waitFor(() => expect(srv.invalidated).toContain("machineRecipe.deployments.list"));
    expect(srv.calls.deploy).toEqual([{ recipeId: 12, machineId: 3, notes: null }]);
    expect(layer("recipe-new")).toBeTruthy();
    expect(params().get("flyout")).toBe("recipe-new");
  });

  it("không có quyền sửa ⇒ deep-link drawer KHÔNG mở", async () => {
    perm.canEdit = false;
    window.history.replaceState(null, "", "/recipes?code=RCP-A&flyout=recipe-deploy&flyoutId=12");
    render(<RecipeManagement />);
    await new Promise((r) => setTimeout(r, 30));
    expect(layer("recipe-deploy")).toBeNull();
  });
});

describe("Recipes P3 — rollback (R-2-g: AlertDialog, KHÔNG lý do, KHÔNG OTP)", () => {
  it("Rollback ⇒ AlertDialog đúng câu cũ, không ô lý do, xác nhận ⇒ rollback {machineId}, toast", async () => {
    const user = userEvent.setup();
    render(<RecipeManagement />);
    const row = within(mainEl()).getAllByRole("row").find((r) => r.textContent?.includes("len v2")) as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Rollback" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText("Rollback recipe đang dùng của máy 3 về phiên bản trước?")).toBeTruthy();
    expect(within(dlg).queryByRole("textbox")).toBeNull();
    await user.click(within(dlg).getByRole("button", { name: "Xác nhận rollback" }));
    await waitFor(() => expect(srv.calls.rollback).toEqual([{ machineId: 3 }]));
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledWith("Đã rollback"));
    expect(screen.queryByText(/mã OTP/i)).toBeNull();
    // fix 1 (review minor) — rollback thành công làm mới như cũ (invalidateAll).
    expect(srv.invalidated).toEqual(expect.arrayContaining(["machineRecipe.recipes.listCodes", "machineRecipe.deployments.list"]));
  });

  it("★ cổng CHẶT 1C: rollback về bản cố ý lưu trữ ⇒ lỗi recipeRetired HIỆN RÕ (role=alert, kèm máy) + toast", async () => {
    srv.rollbackError = appErr("retired", "PRECONDITION_FAILED", { operation: "rollbackRecipeDeployment", reason: "recipeRetired" });
    const user = await openCode("RCP-A", /^Triển khai/);
    const row = within(mainEl()).getAllByRole("row").find((r) => r.textContent?.includes("len v2")) as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Rollback" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Xác nhận rollback" }));
    const alert = await within(mainEl()).findByRole("alert");
    expect(alert).toHaveTextContent(RETIRED_VI);
    expect(alert).toHaveTextContent("#3");
    expect(toastSpy.error).toHaveBeenCalledWith(expect.stringContaining(RETIRED_VI));
    await user.click(within(alert).getByRole("button", { name: "Đóng" }));
    expect(within(mainEl()).queryByRole("alert")).toBeNull();
  });
});
