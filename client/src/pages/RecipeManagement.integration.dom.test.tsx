// @vitest-environment jsdom
//
// Doc 81 Đợt 3 Task 1 — Recipes nhận "Lịch sử nạp" + thao tác phiên bản của Equipment Integration.
// Hợp đồng (task-1-brief + plan Đợt 3 GC3/GC5 + Review Focus 1 + R-2-g/R-2-n):
//   - Tab "Lịch sử nạp" (`?tab=history`): theo MÃ (`equipmentIntegration.listCodeHistory`, mã đang chọn) hoặc theo MÁY
//     (`equipmentIntegration.listLoadHistory`, máy của bộ chọn header / `?machineId=`), limit 200 như tab cũ. Chưa chọn
//     mã: MAIN có hai tab "Lịch sử triển khai" (sổ cũ, mặc định) / "Lịch sử nạp".
//   - "Ghi nhận nạp" = sheet `?flyout=eq-recipe-load&flyoutId=<id>` chuyển NGUYÊN (R-2-n): một phiên bản, một máy,
//     một lượt `recordRecipeLoad {recipeId, machineId, deploy, notes}` mỗi lần bấm; ô `deploy` vẫn là ô đánh dấu trong
//     cùng form (màn cũ không tách). Lỗi cổng chặt (`recipeArchived`) HIỆN RÕ trong sheet + toast.
//   - Phát hành / Rollback phiên bản (code-level) của Integration: không trùng thao tác Recipes ⇒ thêm vào hàng của tab
//     Phiên bản, cùng thủ tục/payload/quyền; Rollback = RollbackConfirm hợp đồng cũ (không lý do, không OTP — R-2-g).
//     Tạo / Lưu trữ TRÙNG thao tác Recipes ⇒ một bộ (của Recipes).
//   - Sau mỗi thao tác tích hợp: invalidate ĐÚNG bộ cũ của Integration + bộ của Recipes (lịch sử cập nhật).
//   - Cờ EQ_INTEG: chip trạng thái 4 nhánh ở header khi khu tích hợp đang dùng; lỗi FEATURE_DISABLED ⇒ toast.info.
// "Server" giả là kho trong bộ nhớ: truy vấn CHỈ đổi khi trang gọi invalidate đúng thủ tục (như react-query).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { installResizeHandleHitAreaShim } from "@/components/patterns/layoutKitTestPanels";
import RECIPES_SRC from "./RecipeManagement.tsx?raw";

vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/PermissionGate", () => ({ ViewOnlyBadge: () => null }));
const perm = vi.hoisted(() => ({ canView: true, canCreate: true, canEdit: true, monitoring: true }));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: false,
    hasPermission: (m: string, a: string) => {
      if (m === "machine_monitoring") return a === "canView" && perm.monitoring;
      return a === "canView" ? perm.canView : a === "canCreate" ? perm.canCreate : a === "canEdit" ? perm.canEdit : false;
    },
  }),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 7, name: "Tester" }, loading: false }),
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));

// ── "Server" giả ───────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const srv = vi.hoisted(() => ({
  versions: [] as Row[],
  deployments: [] as Row[],
  loads: [] as Row[],
  snap: { versions: [] as Row[], deployments: [] as Row[], loads: [] as Row[] },
  status: { enabled: true } as Row | undefined,
  statusError: false,
  version: 0,
  listeners: new Set<() => void>(),
  nextId: 300,
  calls: {} as Record<string, unknown[]>,
  invalidated: [] as string[],
  queryInputs: [] as string[],
  mutationError: null as null | Error,
}));
function bump() {
  srv.version++;
  for (const l of srv.listeners) l();
}
/** Lỗi tRPC đúng hình dạng server (appError → data.appCode/appParams). */
function appErr(message: string, code: string, appCode: string, appParams: Record<string, string>): Error {
  return Object.assign(new Error(message), { data: { code, appCode, appParams } });
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
      (srv.calls[path] ??= []).push(input);
      if (srv.mutationError) throw srv.mutationError;
      if (path === "equipmentIntegration.releaseRecipeVersion") {
        const v = srv.versions.find((x) => x.id === input.recipeId)!;
        for (const o of srv.versions) if (o.code === v.code && o.status === "active") o.status = "archived";
        v.status = "active";
        srv.loads.unshift({ id: srv.nextId++, action: "release", recipeCode: v.code, recipeVersion: v.version, machineId: null, performedBy: 7, notes: null, createdAt: "2026-10-05T01:00:00Z" });
        return { recipe: v };
      }
      if (path === "equipmentIntegration.rollbackRecipeVersion") {
        const v = srv.versions.find((x) => x.id === input.toRecipeId)!;
        for (const o of srv.versions) if (o.code === v.code && o.status === "active") o.status = "archived";
        v.status = "active";
        return { recipe: v };
      }
      if (path === "equipmentIntegration.recordRecipeLoad") {
        const v = srv.versions.find((x) => x.id === input.recipeId)!;
        // Cổng CHẶT (Đợt 1C) của nhánh deploy:true: bản đã lưu trữ ⇒ PRECONDITION_FAILED recipeArchived, không ghi gì.
        if (input.deploy && v.status === "archived")
          throw appErr(`Recipe #${v.id} is archived`, "PRECONDITION_FAILED", "OPERATION_FAILED", { operation: "deployRecipe", reason: "recipeArchived" });
        srv.loads.unshift({ id: srv.nextId++, action: "load", recipeCode: v.code, recipeVersion: v.version, machineId: input.machineId, performedBy: 7, notes: input.notes ?? null, createdAt: "2026-10-05T02:00:00Z" });
        if (input.deploy)
          srv.deployments.unshift({ id: srv.nextId++, recipeId: v.id, machineId: input.machineId, machineName: null, recipeCode: v.code, recipeVersion: v.version, deployedBy: 7, deployedAt: "2026-10-05T02:00:00Z", status: "deployed", previousRecipeId: null, notes: input.notes ?? null });
        return { recipe: v };
      }
      if (path === "machineRecipe.recipes.archive") {
        Object.assign(srv.versions.find((x) => x.id === input.id)!, { status: "archived" });
        return { success: true };
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
      if (path === "machineRecipe.recipes.genealogy") return q(srv.snap.loads.filter((l) => l.recipeCode === input?.code), enabled);
      if (path === "machineRecipe.machines.list") return q([{ id: 3, code: "MC-3", name: "M3" }, { id: 4, code: "MC-4", name: "M4" }], enabled);
      if (path === "machine.list") return q([{ id: 3, code: "MC-3", name: "M3" }, { id: 4, code: "MC-4", name: "M4" }], enabled);
      if (path === "machineRecipe.deployments.list") {
        const rows = input?.machineId != null ? srv.snap.deployments.filter((d) => d.machineId === input.machineId) : srv.snap.deployments;
        return q(rows.slice(0, Number(input?.limit ?? 100)), enabled);
      }
      if (path === "equipmentIntegration.status")
        return srv.statusError ? q(undefined, enabled, { isError: true }) : srv.status === undefined ? q(undefined, enabled, { isLoading: true, isPending: true }) : q(srv.status, enabled);
      if (path === "equipmentIntegration.listLoadHistory") return q(srv.snap.loads.filter((l) => l.machineId === input?.machineId), enabled);
      if (path === "equipmentIntegration.listCodeHistory") return q(srv.snap.loads.filter((l) => l.recipeCode === input?.code), enabled);
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
    if (key.startsWith("machineRecipe.recipes.listVersions") || key.startsWith("machineRecipe.recipes.listCodes")) srv.snap.versions = srv.versions.map((x) => ({ ...x }));
    if (key.startsWith("machineRecipe.deployments.list")) srv.snap.deployments = srv.deployments.map((x) => ({ ...x }));
    if (key.startsWith("equipmentIntegration.listLoadHistory") || key.startsWith("equipmentIntegration.listCodeHistory")) srv.snap.loads = srv.loads.map((x) => ({ ...x }));
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

import RecipeManagement from "./RecipeManagement";

const V = (o: Row): Row => ({
  code: "RCP-1", name: "Reflow A", machineId: null, machineType: null, isGolden: false, checksum: "c0ffee", notes: null,
  createdBy: 5, createdByName: "Alice", createdAt: "2026-09-28T00:00:00Z", approvedBy: 9, approvalNote: null, ...o,
});
// ORACLE (khai tay, cùng dữ liệu với test Integration cũ): RCP-1 v3 nháp (103), v2 đang chạy gắn máy 3 (102), v1 đã lưu trữ (101).
const VERSIONS = (): Row[] => [
  V({ id: 103, version: 3, status: "draft", approvedBy: null, payload: { t: 3 } }),
  V({ id: 102, version: 2, status: "active", machineId: 3, payload: { t: 2 } }),
  V({ id: 101, version: 1, status: "archived", payload: { t: 1 } }),
];
const LOADS = (): Row[] => [
  { id: 1, action: "load", recipeCode: "RCP-1", recipeVersion: 2, machineId: 3, performedBy: 5, notes: "nap ca sang", createdAt: "2026-09-29T01:00:00Z" },
  { id: 2, action: "release", recipeCode: "RCP-9", recipeVersion: 1, machineId: 4, performedBy: 5, notes: "may 4 thoi", createdAt: "2026-09-29T02:00:00Z" },
];
const DEPLOYMENTS = (): Row[] => [
  { id: 2, recipeId: 102, machineId: 3, machineName: "M3", recipeCode: "RCP-1", recipeVersion: 2, deployedBy: 9, deployedAt: "2026-09-29T00:00:00Z", status: "deployed", previousRecipeId: 101, notes: "len v2" },
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
  (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture ??= () => {};
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  srv.versions = VERSIONS();
  srv.deployments = DEPLOYMENTS();
  srv.loads = LOADS();
  srv.snap = { versions: srv.versions.map((x) => ({ ...x })), deployments: srv.deployments.map((x) => ({ ...x })), loads: srv.loads.map((x) => ({ ...x })) };
  srv.status = { enabled: true };
  srv.statusError = false;
  srv.calls = {};
  srv.invalidated = [];
  srv.queryInputs = [];
  srv.mutationError = null;
  srv.nextId = 300;
  Object.assign(perm, { canView: true, canCreate: true, canEdit: true, monitoring: true });
  for (const f of Object.values(toastSpy)) f.mockClear();
  localStorage.clear();
  window.history.replaceState(null, "", "/recipes");
});
afterEach(() => cleanup());

const mainEl = () => document.querySelector("[data-layout-main]") as HTMLElement;
const header = () => document.querySelector("[data-layout-header]") as HTMLElement;
const params = () => new URLSearchParams(window.location.search);
const layer = (key: string) => document.querySelector(`[data-flyout-key="${key}"]`) as HTMLElement | null;
const waitLayer = (key: string) =>
  waitFor(() => {
    const l = layer(key);
    expect(l).toBeTruthy();
    return l as HTMLElement;
  });
const tab = (name: RegExp) => within(mainEl()).getByRole("tab", { name });
const versionRow = (id: number) => mainEl().querySelector(`tr[data-version-id="${id}"]`) as HTMLElement;
const calls = (p: string) => srv.calls[`equipmentIntegration.${p}`] ?? [];
const historyPanel = () => mainEl().querySelector("[data-load-history]") as HTMLElement;
const ARCHIVED_VI = "Phiên bản công thức này đã lưu trữ — hãy tạo phiên bản mới thay vì đưa bản đã lưu trữ vào chạy.";
const RETIRED_VI =
  "Phiên bản này đã bị CỐ Ý lưu trữ (không phải chỉ bị thay bằng bản mới), hoặc không có dấu vết từng bị thay — không thể quay lui về nó. Hãy tạo phiên bản mới.";
const integInvalidations = [
  "equipmentIntegration.status",
  "equipmentIntegration.integrationStatus",
  "equipmentIntegration.listRecipeVersions",
  "equipmentIntegration.listLoadHistory",
  "equipmentIntegration.listCodeHistory",
];

function go(url: string) {
  window.history.replaceState(null, "", url);
  const user = userEvent.setup();
  render(<RecipeManagement />);
  return user;
}

describe("Lịch sử nạp — tab mới của Recipes", () => {
  it("chọn mã: tab thứ 6 'Lịch sử nạp' (`?tab=history`), mặc định theo MÃ ⇒ listCodeHistory {code, limit 200}, đủ cột/nhãn cũ", async () => {
    const user = go("/recipes?code=RCP-1");
    await user.click(tab(/^Lịch sử nạp/));
    expect(params().get("tab")).toBe("history");
    expect(params().get("code")).toBe("RCP-1");
    expect(srv.queryInputs).toContain(`equipmentIntegration.listCodeHistory:${JSON.stringify({ code: "RCP-1", limit: 200 })}`);
    const panel = historyPanel();
    expect(within(panel).getByRole("combobox", { name: "Lọc theo" })).toHaveTextContent("Mã recipe");
    const heads = within(panel).getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(heads).toEqual(["Thời điểm", "Thao tác", "Mã @ phiên bản", "Máy", "Người thực hiện", "Ghi chú"]);
    const row = within(panel).getByText("nap ca sang").closest("tr") as HTMLElement;
    expect(within(row).getByText("Nạp")).toBeTruthy();
    expect(within(row).getByText("RCP-1 @v2")).toBeTruthy();
    expect(within(row).getByText("M3")).toBeTruthy();
    expect(within(panel).queryByText("may 4 thoi")).toBeNull();
  });

  it("đổi sang theo MÁY: dùng máy của bộ chọn header (`?machineId=`) ⇒ listLoadHistory {machineId, limit 200}; chưa chọn máy ⇒ gợi ý, không gọi", async () => {
    const user = go("/recipes?code=RCP-1&tab=history");
    await user.click(within(historyPanel()).getByRole("combobox", { name: "Lọc theo" }));
    await user.click(await screen.findByRole("option", { name: "Máy" }));
    expect(within(historyPanel()).getByText(/Chọn một máy ở ô "Chọn máy" trên đầu trang/)).toBeTruthy();
    expect(srv.queryInputs.some((x) => x.startsWith("equipmentIntegration.listLoadHistory"))).toBe(false);
    await user.click(within(header()).getByRole("combobox", { name: "Chọn máy" }));
    await user.click(await screen.findByRole("option", { name: /M4/ }));
    expect(srv.queryInputs).toContain(`equipmentIntegration.listLoadHistory:${JSON.stringify({ machineId: 4, limit: 200 })}`);
    expect(within(historyPanel()).getByText("may 4 thoi")).toBeTruthy();
  });

  it("chưa chọn mã: MAIN có hai tab (sổ triển khai mặc định / Lịch sử nạp); `?tab=history&machineId=3` mở thẳng lịch sử theo máy", async () => {
    const user = go("/recipes");
    const names = within(mainEl()).getAllByRole("tab").map((x) => x.textContent?.trim());
    expect(names).toEqual(["Lịch sử triển khai (1)", "Lịch sử nạp"]);
    expect(tab(/^Lịch sử triển khai/)).toHaveAttribute("aria-selected", "true");
    await user.click(tab(/^Lịch sử nạp/));
    expect(params().get("tab")).toBe("history");
    expect(within(historyPanel()).getByRole("combobox", { name: "Lọc theo" })).toHaveTextContent("Máy");
    await user.click(tab(/^Lịch sử triển khai/));
    expect(params().get("tab")).toBeNull();
    cleanup();
    go("/recipes?tab=history&machineId=3");
    expect(srv.queryInputs).toContain(`equipmentIntegration.listLoadHistory:${JSON.stringify({ machineId: 3, limit: 200 })}`);
    expect(within(historyPanel()).getByText("nap ca sang")).toBeTruthy();
  });

  it("thiếu quyền đọc cũ (machine_monitoring/canView) ⇒ câu thiếu quyền, KHÔNG gọi server", () => {
    perm.monitoring = false;
    go("/recipes?code=RCP-1&tab=history");
    expect(within(historyPanel()).getByText(/cần quyền xem giám sát máy/)).toBeTruthy();
    expect(srv.queryInputs.some((x) => x.startsWith("equipmentIntegration."))).toBe(false);
  });

  it("nạp trang mặc định (chưa chọn mã, chưa mở tab mới) KHÔNG gọi thủ tục mới nào (thủ tục đã biết của thước giữ nguyên)", () => {
    go("/recipes");
    expect(srv.queryInputs.some((x) => x.startsWith("equipmentIntegration.") || x.startsWith("machine.list"))).toBe(false);
  });
});

describe("Ghi nhận nạp — sheet chuyển nguyên từ Integration (R-2-n)", () => {
  it("tab Phiên bản → 'Ghi nhận nạp' v2 ⇒ sheet `eq-recipe-load` (máy của phiên bản chọn sẵn) → lưu ⇒ ĐÚNG MỘT lượt {recipeId, machineId, deploy, notes}, toast, invalidate bộ cũ + Recipes, đóng; tab Lịch sử nạp có dòng mới", async () => {
    const user = go("/recipes?code=RCP-1");
    await user.click(within(versionRow(102)).getByRole("button", { name: /Ghi nhận nạp/ }));
    const sheet = await waitLayer("eq-recipe-load");
    expect(params().get("flyout")).toBe("eq-recipe-load");
    expect(params().get("flyoutId")).toBe("102");
    expect(within(sheet).getByText(/RCP-1 v2 đã được nạp lên một máy/)).toBeTruthy();
    // MỘT máy đích: một ô chọn máy duy nhất, đã chọn sẵn M3
    expect(within(sheet).getAllByRole("combobox")).toHaveLength(1);
    expect(within(sheet).getByRole("combobox")).toHaveTextContent("M3 (MC-3)");
    await user.click(within(sheet).getByRole("checkbox", { name: /recipe_deployments/ }));
    await user.type(within(sheet).getByLabelText("Ghi chú"), "ca 2");
    await user.click(within(sheet).getByRole("button", { name: /Ghi nhận nạp/ }));
    await waitFor(() => expect(layer("eq-recipe-load")).toBeNull());
    expect(calls("recordRecipeLoad")).toEqual([{ recipeId: 102, machineId: 3, deploy: true, notes: "ca 2" }]);
    expect(params().get("flyout")).toBeNull();
    expect(toastSpy.success).toHaveBeenCalledWith("Đã ghi nhận nạp recipe (truy xuất nguồn gốc)");
    expect(srv.invalidated).toEqual(expect.arrayContaining([...integInvalidations, "machineRecipe.recipes.listCodes", "machineRecipe.deployments.list"]));
    await user.click(tab(/^Lịch sử nạp/));
    expect(within(historyPanel()).getByText("ca 2")).toBeTruthy();
  });

  it("không chọn máy ⇒ toast 'Chọn một máy.' như cũ, không gọi; nhánh deploy:false gửi deploy:false", async () => {
    const user = go("/recipes?code=RCP-1&flyout=eq-recipe-load&flyoutId=103");
    const sheet = await waitLayer("eq-recipe-load");
    await user.click(within(sheet).getByRole("button", { name: /Ghi nhận nạp/ }));
    expect(toastSpy.error).toHaveBeenCalledWith("Chọn một máy.");
    expect(calls("recordRecipeLoad")).toHaveLength(0);
    await user.click(within(sheet).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "M4 (MC-4)" }));
    await user.click(within(sheet).getByRole("button", { name: /Ghi nhận nạp/ }));
    await waitFor(() => expect(calls("recordRecipeLoad")).toEqual([{ recipeId: 103, machineId: 4, deploy: false, notes: undefined }]));
  });

  it("★ cổng CHẶT 1C (deploy:true lên bản ĐÃ LƯU TRỮ) ⇒ lỗi recipeArchived HIỆN RÕ trong sheet (role=alert, kèm máy) + toast; sheet giữ mở; một lượt", async () => {
    const user = go("/recipes?code=RCP-1&flyout=eq-recipe-load&flyoutId=101");
    const sheet = await waitLayer("eq-recipe-load");
    await user.click(within(sheet).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "M3 (MC-3)" }));
    await user.click(within(sheet).getByRole("checkbox", { name: /recipe_deployments/ }));
    await user.click(within(sheet).getByRole("button", { name: /Ghi nhận nạp/ }));
    const alert = await within(sheet).findByRole("alert");
    expect(alert).toHaveTextContent(ARCHIVED_VI);
    expect(alert).toHaveTextContent("M3");
    expect(calls("recordRecipeLoad")).toEqual([{ recipeId: 101, machineId: 3, deploy: true, notes: undefined }]);
    expect(toastSpy.error).toHaveBeenCalledWith(expect.stringContaining(ARCHIVED_VI));
    expect(toastSpy.success).not.toHaveBeenCalled();
    expect(layer("eq-recipe-load")).toBeTruthy();
  });

  it("không có quyền tạo (machine_control/canCreate) ⇒ không có nút Ghi nhận nạp / Phát hành / Rollback phiên bản; deep link sheet không mở", async () => {
    perm.canCreate = false;
    go("/recipes?code=RCP-1&flyout=eq-recipe-load&flyoutId=102");
    for (const id of [101, 102, 103]) {
      expect(within(versionRow(id)).queryByRole("button", { name: /Ghi nhận nạp|Phát hành|^Rollback$/ })).toBeNull();
    }
    await new Promise((r) => setTimeout(r, 30));
    expect(layer("eq-recipe-load")).toBeNull();
  });
});

describe("Phiên bản (tích hợp) — Phát hành / Rollback trên tab Phiên bản; Tạo / Lưu trữ dùng một bộ của Recipes", () => {
  it("phát hành (nháp): MỘT cú bấm, MỘT lượt {recipeId}, toast, invalidate bộ cũ + Recipes; v2 thành đã lưu trữ ⇒ còn nút Rollback", async () => {
    const user = go("/recipes?code=RCP-1");
    await user.click(within(versionRow(103)).getByRole("button", { name: /Phát hành/ }));
    await waitFor(() => expect(calls("releaseRecipeVersion")).toEqual([{ recipeId: 103 }]));
    expect(toastSpy.success).toHaveBeenCalledWith("Đã phát hành phiên bản");
    expect(srv.invalidated).toEqual(expect.arrayContaining([...integInvalidations, 'machineRecipe.recipes.listVersions:{"code":"RCP-1"}']));
    await waitFor(() => expect(within(versionRow(102)).getByRole("button", { name: /^Rollback$/ })).toBeTruthy());
    expect(within(versionRow(103)).queryByRole("button", { name: /Phát hành/ })).toBeNull();
    expect(screen.queryAllByRole("alertdialog")).toHaveLength(0);
  });

  it("thiếu canEdit ⇒ Phát hành / Rollback khoá kèm lý do machine_control/canEdit (Ghi nhận nạp vẫn bật như cũ)", () => {
    perm.canEdit = false;
    go("/recipes?code=RCP-1");
    const rel = within(versionRow(103)).getByRole("button", { name: /Phát hành/ });
    expect(rel).toBeDisabled();
    expect(rel.getAttribute("title")).toMatch(/machine_control\/canEdit/);
    expect(within(versionRow(101)).getByRole("button", { name: /^Rollback$/ })).toBeDisabled();
    expect(within(versionRow(102)).getByRole("button", { name: /Ghi nhận nạp/ })).not.toBeDisabled();
  });

  it("rollback phiên bản = AlertDialog cũ (R-2-g): tiêu đề + câu cũ, KHÔNG ô lý do, KHÔNG OTP; Huỷ ⇒ không gọi; xác nhận ⇒ {toRecipeId}, toast, invalidate", async () => {
    const user = go("/recipes?code=RCP-1");
    await user.click(within(versionRow(101)).getByRole("button", { name: /^Rollback$/ }));
    let dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText("Rollback hợp đồng đã phát hành?")).toBeTruthy();
    expect(within(dlg).getByText(/Việc này phát hành RCP-1 v1 và lưu trữ phiên bản đang phát hành hiện tại/)).toBeTruthy();
    expect(within(dlg).queryByRole("textbox")).toBeNull();
    await user.click(within(dlg).getByRole("button", { name: "Hủy" }));
    expect(calls("rollbackRecipeVersion")).toHaveLength(0);
    await user.click(within(versionRow(101)).getByRole("button", { name: /^Rollback$/ }));
    dlg = await screen.findByRole("alertdialog");
    await user.click(within(dlg).getByRole("button", { name: /Rollback/ }));
    await waitFor(() => expect(calls("rollbackRecipeVersion")).toEqual([{ toRecipeId: 101 }]));
    expect(screen.queryByText(/mã OTP/i)).toBeNull();
    expect(toastSpy.success).toHaveBeenCalledWith("Đã rollback hợp đồng đã phát hành");
    expect(srv.invalidated).toEqual(expect.arrayContaining(integInvalidations));
  });

  it("★ cổng CHẶT: rollback về bản cố ý lưu trữ ⇒ lỗi recipeRetired HIỆN RÕ cạnh danh sách phiên bản (role=alert) + toast; đóng được", async () => {
    srv.mutationError = appErr("retired", "PRECONDITION_FAILED", "OPERATION_FAILED", { operation: "rollbackRecipeVersion", reason: "recipeRetired" });
    const user = go("/recipes?code=RCP-1");
    await user.click(within(versionRow(101)).getByRole("button", { name: /^Rollback$/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /Rollback/ }));
    const alert = await within(mainEl()).findByRole("alert");
    expect(alert).toHaveTextContent(RETIRED_VI);
    expect(alert).toHaveTextContent("v1");
    expect(toastSpy.error).toHaveBeenCalledWith(expect.stringContaining(RETIRED_VI));
    await user.click(within(alert).getByRole("button", { name: "Đóng" }));
    expect(within(mainEl()).queryByRole("alert")).toBeNull();
  });

  it("cờ TẮT ở server ⇒ FEATURE_DISABLED hiện toast.info bình tĩnh (không đỏ, không khối lỗi), invalidate trạng thái cờ, như cũ", async () => {
    srv.mutationError = appErr("Equipment integration disabled", "CONFLICT", "FEATURE_DISABLED", { feature: "equipmentIntegration" });
    const user = go("/recipes?code=RCP-1");
    await user.click(within(versionRow(103)).getByRole("button", { name: /Phát hành/ }));
    await waitFor(() => expect(toastSpy.info).toHaveBeenCalled());
    expect(String(toastSpy.info.mock.calls[0][0])).not.toMatch(/EQ_INTEG_ENABLED/);
    expect(toastSpy.error).not.toHaveBeenCalled();
    expect(within(mainEl()).queryByRole("alert")).toBeNull();
    expect(srv.invalidated).toContain("equipmentIntegration.status");
  });

  it("một bộ cho việc trùng: mỗi hàng đúng MỘT nút Lưu trữ (của Recipes: AlertDialog ⇒ machineRecipe.recipes.archive); trang không còn gọi create/archive của Integration", async () => {
    const user = go("/recipes?code=RCP-1");
    expect(within(versionRow(103)).getAllByRole("button", { name: "Lưu trữ" })).toHaveLength(1);
    expect(within(versionRow(102)).getAllByRole("button", { name: "Lưu trữ" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Lưu phiên bản mới|Phiên bản mới|Tạo phiên bản/ })).toHaveLength(1);
    await user.click(within(versionRow(103)).getByRole("button", { name: "Lưu trữ" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Lưu trữ" }));
    await waitFor(() => expect(srv.calls["machineRecipe.recipes.archive"]).toEqual([{ id: 103 }]));
    expect(calls("archiveRecipeVersion")).toHaveLength(0);
    expect(RECIPES_SRC).not.toMatch(/createRecipeVersion|archiveRecipeVersion/);
  });
});

describe("Cờ tích hợp (EQ_INTEG) — chip 4 trạng thái ở header khi khu tích hợp đang dùng", () => {
  it("đang kiểm tra / lỗi / tắt ⇒ chip đúng trạng thái (câu tắt không chứa tên biến môi trường); bật ⇒ không chip", () => {
    srv.status = undefined;
    go("/recipes?code=RCP-1");
    expect(within(header()).getByTestId("feature-status-loading")).toHaveTextContent(/Tích hợp thiết bị/);
    cleanup();
    srv.status = { enabled: true };
    srv.statusError = true;
    go("/recipes?code=RCP-1");
    expect(within(header()).getByTestId("feature-status-error")).toBeTruthy();
    cleanup();
    srv.statusError = false;
    srv.status = { enabled: false };
    go("/recipes?code=RCP-1");
    const off = within(header()).getByTestId("feature-status-off");
    expect(off).toHaveTextContent(/Tích hợp thiết bị/);
    cleanup();
    srv.status = { enabled: true };
    go("/recipes?code=RCP-1");
    expect(within(header()).queryByTestId(/feature-status-/)).toBeNull();
  });

  it("chưa dùng khu tích hợp (chưa chọn mã, không ở Lịch sử nạp) ⇒ không chip, không gọi trạng thái cờ", () => {
    srv.status = { enabled: false };
    go("/recipes");
    expect(within(header()).queryByTestId(/feature-status-/)).toBeNull();
    expect(srv.queryInputs.some((x) => x.startsWith("equipmentIntegration.status"))).toBe(false);
  });
});
