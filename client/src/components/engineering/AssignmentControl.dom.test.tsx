// @vitest-environment jsdom
//
// doc 81 Đợt 3 Task 4 — bộ chọn "Giao cho" (`AssignmentControl`) + ô "Người được giao" (`AssigneeCell`).
// Hợp đồng: roster = `engineering.assignableUsers` (chỉ gọi khi giao được); chọn ⇒ `engineering.assign` mang
// `expectedAssigneeUserId` = người đang thấy (CAS); ✕ ⇒ `unassign` với người đang thấy; KHÔNG có quyền giao ⇒ chỉ tên,
// không combobox, không gọi roster; thành công ⇒ làm mới `engineering.assignments` + `oversight.pendingSummary`;
// CONFLICT ⇒ báo lỗi + làm mới. EntityPicker THẬT (Popover + cmdk).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const S = (k: string, src: unknown = vi_): string => {
  const v = k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], src);
  if (typeof v !== "string") throw new Error(`thiếu khoá: ${k}`);
  return v;
};

const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));
const errSpy = vi.hoisted(() => ({ toastTrpcError: vi.fn() }));
vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: errSpy.toastTrpcError }));
const who = vi.hoisted(() => ({ perms: new Set<string>(["machine_control:canEdit", "machine_control:canView", "interlock:canEdit", "machine_control:canCreate"]) }));
const me = vi.hoisted(() => ({ role: "engineer" as string }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 3, role: me.role }, loading: false }) }));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ isAdmin: false, hasPermission: (m: string, a: string) => who.perms.has(`${m}:${a}`) }),
}));

const srv = vi.hoisted(() => ({
  roster: [] as Array<{ id: number; name: string | null }>,
  rosterCalls: [] as unknown[],
  assign: [] as unknown[],
  unassign: [] as unknown[],
  invalidated: [] as string[],
  fail: null as null | { data: { code: string } },
}));
vi.mock("@/lib/trpc", () => {
  const mutation = (name: "assign" | "unassign") => (opts: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void } = {}) => ({
    isPending: false,
    mutate: (input: Record<string, unknown>) => {
      srv[name].push(input);
      void Promise.resolve().then(() => {
        if (srv.fail) {
          const e = srv.fail;
          srv.fail = null;
          opts.onError?.(e);
          return;
        }
        opts.onSuccess?.(name === "assign" ? { assigneeUserId: input.assigneeUserId, assigneeName: srv.roster.find((u) => u.id === input.assigneeUserId)?.name ?? null } : { success: true });
      });
    },
  });
  const inv = (path: string) => ({ invalidate: (x?: unknown) => srv.invalidated.push(x ? `${path}:${JSON.stringify(x)}` : path) });
  return {
    trpc: {
      useUtils: () => ({ engineering: { assignments: inv("engineering.assignments") }, oversight: { pendingSummary: inv("oversight.pendingSummary") } }),
      engineering: {
        assignableUsers: {
          useQuery: (input: unknown, opts: { enabled?: boolean }) => {
            if (opts?.enabled !== false) srv.rosterCalls.push(input);
            return { data: opts?.enabled === false ? undefined : srv.roster, isLoading: false };
          },
        },
        assign: { useMutation: mutation("assign") },
        unassign: { useMutation: mutation("unassign") },
      },
    },
  };
});

import { AssigneeCell, AssignmentControl, useCanAssign } from "./AssignmentControl";

beforeAll(async () => {
  Element.prototype.scrollIntoView ??= function () {};
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture ??= () => false;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  srv.roster = [{ id: 11, name: "Nguyen Van A" }, { id: 12, name: "Tran Thi B" }];
  srv.rosterCalls = [];
  srv.assign = [];
  srv.unassign = [];
  srv.invalidated = [];
  srv.fail = null;
  toastSpy.success.mockReset();
  errSpy.toastTrpcError.mockReset();
  who.perms = new Set(["machine_control:canEdit", "machine_control:canView", "interlock:canEdit", "machine_control:canCreate"]);
  me.role = "engineer";
});
afterEach(() => cleanup());

const flush = () => new Promise((r) => setTimeout(r, 0));
const combo = () => screen.getByRole("combobox", { name: S("engineeringAssign.label") });

describe("AssignmentControl — giao / giao lại / bỏ giao", () => {
  it("chưa giao + có quyền ⇒ combobox 'Giao cho' (chỗ trống nói 'Chưa giao'); chọn người ⇒ assign đúng payload, expected=null", async () => {
    render(<AssignmentControl entityType="ecn" entityId={5} assignment={undefined} canAssign />);
    expect(combo()).toHaveTextContent(S("engineeringAssign.placeholder"));
    expect(srv.rosterCalls).toEqual([{ entityType: "ecn" }]);
    fireEvent.click(combo());
    fireEvent.click(screen.getByRole("option", { name: /Tran Thi B/ }));
    expect(srv.assign).toEqual([{ entityType: "ecn", entityId: 5, assigneeUserId: 12, expectedAssigneeUserId: null }]);
    await flush();
    expect(toastSpy.success).toHaveBeenCalledTimes(1);
    expect(srv.invalidated).toEqual(['engineering.assignments:{"entityType":"ecn"}', "oversight.pendingSummary"]);
  });

  it("đã giao A ⇒ hiện tên A; chọn B ⇒ assign với expected=A (giao lại, CAS)", () => {
    render(<AssignmentControl entityType="recipe" entityId={9} assignment={{ entityId: 9, assigneeUserId: 11, assigneeName: "Nguyen Van A" }} canAssign />);
    expect(combo()).toHaveTextContent("Nguyen Van A");
    fireEvent.click(combo());
    fireEvent.click(screen.getByRole("option", { name: /Tran Thi B/ }));
    expect(srv.assign).toEqual([{ entityType: "recipe", entityId: 9, assigneeUserId: 12, expectedAssigneeUserId: 11 }]);
  });

  it("✕ ⇒ unassign với người ĐANG thấy; KHÔNG gọi assign", () => {
    render(<AssignmentControl entityType="interlock_rule" entityId={3} assignment={{ entityId: 3, assigneeUserId: 11, assigneeName: "Nguyen Van A" }} canAssign />);
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(srv.unassign).toEqual([{ entityType: "interlock_rule", entityId: 3, expectedAssigneeUserId: 11 }]);
    expect(srv.assign).toEqual([]);
  });

  it("người đang được giao NGOÀI roster (vd đã mất quyền xem) vẫn hiện tên — không hiện 'không tồn tại'", () => {
    render(<AssignmentControl entityType="ecn" entityId={5} assignment={{ entityId: 5, assigneeUserId: 99, assigneeName: null }} canAssign />);
    expect(combo()).toHaveTextContent(S("engineeringAssign.userFallback").replace("{{id}}", "99"));
    expect(screen.queryByText(S("entityPicker.invalid"))).toBeNull();
  });

  it("server CONFLICT ⇒ báo lỗi một lần + làm mới danh sách phân công (thấy người được giao thật)", async () => {
    srv.fail = { data: { code: "CONFLICT" } };
    render(<AssignmentControl entityType="ecn" entityId={5} assignment={undefined} canAssign />);
    fireEvent.click(combo());
    fireEvent.click(screen.getByRole("option", { name: /Nguyen Van A/ }));
    await flush();
    expect(errSpy.toastTrpcError).toHaveBeenCalledTimes(1);
    expect(toastSpy.success).not.toHaveBeenCalled();
    expect(srv.invalidated).toContain('engineering.assignments:{"entityType":"ecn"}');
  });
});

describe("AssignmentControl — không có quyền giao ⇒ chỉ đọc", () => {
  it("canAssign=false ⇒ KHÔNG combobox, KHÔNG gọi roster; hiện tên người được giao / 'Chưa giao'", () => {
    const { rerender } = render(<AssignmentControl entityType="ecn" entityId={5} assignment={{ entityId: 5, assigneeUserId: 11, assigneeName: "Nguyen Van A" }} canAssign={false} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(srv.rosterCalls).toEqual([]);
    expect(screen.getByText("Nguyen Van A")).toBeInTheDocument();
    rerender(<AssignmentControl entityType="ecn" entityId={5} assignment={undefined} canAssign={false} />);
    expect(screen.getByText(S("engineeringAssign.none"))).toBeInTheDocument();
  });

  it("useCanAssign đọc ĐÚNG assignPerm của từng loại (shared/engineeringAssignment.ts)", () => {
    const Probe = () => (
      <span data-testid="p">
        {(["ecn", "recipe", "interlock_rule", "changeover", "orchestration_run"] as const).map((t) => `${t}=${useCanAssign(t)}`).join(",")}
      </span>
    );
    who.perms = new Set(["machine_control:canView", "machine_control:canCreate", "interlock:canEdit"]);
    render(<Probe />);
    expect(screen.getByTestId("p").textContent).toBe("ecn=false,recipe=false,interlock_rule=true,changeover=false,orchestration_run=true");
  });

  it("R-3-e — useCanAssign đòi SÀN VAI: operator/viewer/user có đủ bit vẫn false; quality_inspector chỉ qua ECN", () => {
    const Probe = () => (
      <span data-testid="p">
        {(["ecn", "recipe", "interlock_rule", "changeover", "orchestration_run"] as const).map((t) => `${t}=${useCanAssign(t)}`).join(",")}
      </span>
    );
    for (const role of ["operator", "viewer", "user", "maintenance"]) {
      me.role = role;
      const { unmount } = render(<Probe />);
      expect(screen.getByTestId("p").textContent, role).toBe("ecn=false,recipe=false,interlock_rule=false,changeover=false,orchestration_run=false");
      unmount();
    }
    me.role = "quality_inspector";
    render(<Probe />);
    expect(screen.getByTestId("p").textContent).toBe("ecn=true,recipe=false,interlock_rule=false,changeover=false,orchestration_run=false");
  });

  it("AssigneeCell: có ⇒ tên; không ⇒ '—'", () => {
    render(<div><AssigneeCell row={{ entityId: 1, assigneeUserId: 11, assigneeName: "Nguyen Van A" }} /><AssigneeCell row={undefined} /></div>);
    const cells = document.querySelectorAll("[data-assignee-cell]");
    expect(cells[0]).toHaveTextContent("Nguyen Van A");
    expect(cells[1]).toHaveTextContent("—");
  });
});

describe("i18n — khoá engineeringAssign.* / Hub / lỗi có đủ vi/en/zh", () => {
  it.each([
    "engineeringAssign.label", "engineeringAssign.column", "engineeringAssign.none", "engineeringAssign.placeholder",
    "engineeringAssign.search", "engineeringAssign.empty", "engineeringAssign.assigned", "engineeringAssign.unassigned",
    "engineeringAssign.userFallback", "engineeringAssign.noApprovalRight",
    "engineeringHome.scopeMine", "engineeringHome.scopeMineHint", "engineeringHome.scopeApprovals", "oversight.mineAllClear",
    "errors.operation.assignEngineeringItem", "errors.operation.unassignEngineeringItem", "errors.field.assigneeUserId",
    "errors.reason.assignTargetNotPending", "errors.reason.assignmentChanged", "errors.reason.alreadyAssignedToUser",
    "errors.reason.assigneeInvalid", "errors.reason.assignmentStoreMissing",
  ])("%s", (k) => {
    for (const src of [vi_, en_, zh_]) expect(S(k, src).length).toBeGreaterThan(0);
    // không tên biến môi trường trong chuỗi người dùng (GC6)
    for (const src of [vi_, en_, zh_]) expect(S(k, src)).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
  });
});

