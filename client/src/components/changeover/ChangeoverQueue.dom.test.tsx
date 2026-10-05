// @vitest-environment jsdom
//
// doc 81 Đợt 3 Task 4 — hàng đợi đổi model: mỗi yêu cầu CHỜ DUYỆT có "Giao cho" (cổng machine_control/canEdit) + tên người
// được giao. Được giao ≠ được duyệt: Duyệt/Từ chối giữ đúng payload cũ ({id} / {id, note}), không thêm gì.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: vi.fn() }));
const perm = vi.hoisted(() => ({ canEdit: true }));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ isAdmin: false, hasPermission: (_m: string, a: string) => (a === "canEdit" ? perm.canEdit : true) }),
}));
const srv = vi.hoisted(() => ({ calls: [] as Array<{ path: string; input: unknown }> }));
vi.mock("@/lib/trpc", () => {
  const q = (data: unknown, extra: Record<string, unknown> = {}) => ({ data, isLoading: false, isSuccess: data !== undefined, isError: false, ...extra });
  const data: Record<string, unknown> = {
    "machineRecipe.changeover.recipeOptions": [],
    "machineRecipe.changeover.listMine": [],
    "machineRecipe.changeover.list": [
      { id: 71, machineId: 3, machineCode: "MC-3", recipeCode: "RCP-A", recipeVersion: 2, recipeStatus: "active", requestNote: null },
      { id: 72, machineId: 4, machineCode: "MC-4", recipeCode: "RCP-B", recipeVersion: 1, recipeStatus: "active", requestNote: null },
    ],
    "engineering.assignments": [{ entityId: 71, assigneeUserId: 61, assigneeName: "Truong Ca" }],
    "engineering.assignableUsers": [{ id: 61, name: "Truong Ca" }],
  };
  const at = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_t, p: string) => {
        if (path.length === 0 && p === "useUtils") return () => at(["utils"]);
        if (p === "invalidate") return () => undefined;
        if (p === "useQuery") return (_i: unknown, o?: { enabled?: boolean }) => q(o?.enabled === false ? undefined : data[path.join(".")]);
        if (p === "useMutation") return () => ({ isPending: false, mutate: (input: unknown) => srv.calls.push({ path: path.join("."), input }) });
        return at([...path, p]);
      },
    });
  return { trpc: at([]) };
});

import { ChangeoverQueue } from "./ChangeoverQueue";

beforeAll(async () => {
  Element.prototype.scrollIntoView ??= function () {};
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture ??= () => false;
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  srv.calls = [];
  perm.canEdit = true;
});
afterEach(() => cleanup());

const rowOf = (id: number) => screen.getByText(`#${id}`).parentElement as HTMLElement;

describe("ChangeoverQueue — 'Giao cho' trên từng yêu cầu chờ duyệt", () => {
  it("mỗi yêu cầu có bộ chọn (yêu cầu #71 đang giao Truong Ca, #72 chưa giao)", () => {
    render(<ChangeoverQueue machineId={3} />);
    expect(within(rowOf(71)).getByRole("combobox", { name: "Giao cho" })).toHaveTextContent("Truong Ca");
    expect(within(rowOf(72)).getByRole("combobox", { name: "Giao cho" })).toHaveTextContent("Chưa giao");
  });

  it("giao #72 ⇒ engineering.assign; bấm Duyệt #71 ⇒ approve CHỈ {id} như cũ (được giao không đổi payload/cổng duyệt)", () => {
    render(<ChangeoverQueue machineId={3} />);
    fireEvent.click(within(rowOf(72)).getByRole("combobox", { name: "Giao cho" }));
    fireEvent.click(screen.getByRole("option", { name: /Truong Ca/ }));
    fireEvent.click(within(rowOf(71)).getByRole("button", { name: "Duyệt" }));
    expect(srv.calls).toEqual([
      { path: "engineering.assign", input: { entityType: "changeover", entityId: 72, assigneeUserId: 61, expectedAssigneeUserId: null } },
      { path: "machineRecipe.changeover.approve", input: { id: 71 } },
    ]);
  });

  it("không có canEdit ⇒ chỉ tên người được giao, không bộ chọn", () => {
    perm.canEdit = false;
    render(<ChangeoverQueue machineId={3} />);
    expect(screen.queryByRole("combobox", { name: "Giao cho" })).toBeNull();
    expect(rowOf(71)).toHaveTextContent("Truong Ca");
  });
});
