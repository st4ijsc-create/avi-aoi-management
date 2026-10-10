// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 4 — ECN thành mẫu P3 danh sách–chi tiết.
// Hợp đồng (task-4-brief + plan Review Focus 1/4 + Ruling R-2-g):
//   - MAIN là danh sách ECN (DataTable phân trang) trong `[data-layout-main]`, FilterBar là thanh công cụ
//     DUY NHẤT trong MAIN, h1 + chip nằm trong header một hàng (ngoài MAIN); `?filter=pending` còn chạy.
//   - Chi tiết mở trong flyout `?flyout=ecn&flyoutId=<id>` với 5 tab; F5 dựng lại chi tiết đang mở.
//   - Tạo ECN qua flyout: mở → nhập → lưu → danh sách cập nhật (sau invalidate) → URL sạch.
//   - Duyệt/từ chối qua TransitionDialog, đúng hợp đồng HIỆN TẠI của trang: duyệt có bước xác nhận, ý
//     kiến TUỲ CHỌN; từ chối BẮT BUỘC lý do; submit/review/implement/close gọi thẳng; mọi lượt gửi
//     `expectedStatus` của hàng đang hiển thị; không mật khẩu/OTP (trang chưa từng có).
// Chạy trên wouter THẬT với history của jsdom. "Server" giả là kho trong bộ nhớ: danh sách CHỈ đổi khi
// trang gọi invalidate (như react-query), luật chuyển trạng thái + CAS + SoD chép theo ecnService.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import viLocale from "@/i18n/locales/vi.json";

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
const perm = { isAdmin: false, canCreate: true, canDecide: true };
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: perm.isAdmin,
    hasPermission: (_m: string, a: string) => (a === "canCreate" ? perm.canCreate : a === "canEdit" ? perm.canDecide : true),
  }),
}));
const me = { id: 7 as number | null };
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: me.id == null ? null : { id: me.id, name: "Tester", role: "engineer" }, loading: false }),
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));
const trpcErrSpy = vi.hoisted(() => ({ toastTrpcError: vi.fn() }));
vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: trpcErrSpy.toastTrpcError, mapTrpcError: () => "x" }));

// ── "Server" giả ───────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown> & { id: number; ecnKey: string; title: string; status: string; requestedBy: number | null; reviewedBy: number | null };
const srv = vi.hoisted(() => ({
  db: [] as Array<Record<string, unknown>>,
  items: {} as Record<number, Array<Record<string, unknown>>>,
  listSnapshot: [] as Array<Record<string, unknown>>,
  version: 0,
  listeners: new Set<() => void>(),
  nextId: 100,
  calls: { create: [] as unknown[], transition: [] as unknown[], getById: [] as unknown[] },
  invalidated: [] as string[],
  failTransition: null as null | { data: { code: string } },
  holdCreate: null as null | Promise<void>,
  // doc 81 Đợt 3 Task 4 — phân công đang hiệu lực + roster "Giao cho".
  assignments: [] as Array<Record<string, unknown>>,
  assignCalls: [] as unknown[],
}));
function bump() {
  srv.version++;
  for (const l of srv.listeners) l();
}
function refreshList() {
  srv.listSnapshot = srv.db.map((r) => ({ ...r }));
  bump();
}
const ACTION_TARGET: Record<string, string> = { submit: "submitted", review: "in_review", approve: "approved", reject: "rejected", implement: "implemented", close: "closed" };

vi.mock("@/lib/trpc", () => {
  const useVersion = () =>
    React.useSyncExternalStore(
      (cb) => {
        srv.listeners.add(cb);
        return () => srv.listeners.delete(cb);
      },
      () => srv.version,
    );
  const q = (data: unknown, enabled = true) => ({ data: enabled ? data : undefined, isLoading: false, isPending: false, isError: false, error: null, refetch: vi.fn() });
  // Mutation thật trả kết quả ở lượt sau (không đồng bộ) — callback chạy ở microtask kế tiếp.
  const later = (fn: () => void) => {
    void Promise.resolve().then(fn);
  };
  const proc = (router: string, name: string) => ({
    useQuery: (input?: Record<string, unknown>, opts?: { enabled?: boolean }) => {
      useVersion();
      const enabled = opts?.enabled !== false;
      if (router === "ecn" && name === "list") return q(srv.listSnapshot, enabled);
      if (router === "ecn" && name === "getItems") return q(srv.items[Number(input?.ecnId)] ?? [], enabled);
      if (router === "ecn" && name === "getById") {
        if (enabled) srv.calls.getById.push(input);
        return q(srv.db.find((r) => r.id === input?.id) ?? undefined, enabled);
      }
      if (router === "productModel" && name === "list") return q([{ id: 5, code: "MODEL-A", name: "Model A" }], enabled);
      if (router === "engineering" && name === "assignments") return q(srv.assignments, enabled);
      if (router === "engineering" && name === "assignableUsers") return q({ users: [{ id: 21, name: "Ky su Duyet" }, { id: 22, name: "Ky su Thu Hai" }], truncated: false }, enabled);
      return q(undefined, enabled);
    },
    useMutation: (hookOpts: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void } = {}) => ({
      isPending: false,
      mutateAsync: vi.fn(),
      mutate: (input: Record<string, unknown>, callOpts: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void } = {}) => {
        if (router === "engineering") {
          srv.assignCalls.push({ name, ...input });
          return;
        }
        if (router === "ecn" && name === "create") {
          srv.calls.create.push(input);
          const row = { id: srv.nextId, ecnKey: `ECN-NEW-${srv.nextId}`, status: "draft", requestedBy: me.id, reviewedBy: null, changeType: input.changeType, title: input.title, effectivityDate: null, createdAt: new Date("2026-10-03T00:00:00Z") };
          srv.nextId++;
          const go = () => later(() => {
            srv.db.unshift(row);
            hookOpts.onSuccess?.(row);
            callOpts.onSuccess?.(row);
          });
          if (srv.holdCreate) void srv.holdCreate.then(go); else go();
          return;
        }
        if (router === "ecn" && name === "transition") {
          srv.calls.transition.push(input);
          later(() => {
            const cur = srv.db.find((r) => r.id === input.id) as Row | undefined;
            const fail = (code: string) => {
              const e = { data: { code } };
              hookOpts.onError?.(e);
              callOpts.onError?.(e);
            };
            if (srv.failTransition) {
              const e = srv.failTransition;
              srv.failTransition = null;
              hookOpts.onError?.(e);
              callOpts.onError?.(e);
              return;
            }
            if (!cur) return fail("NOT_FOUND");
            if (input.expectedStatus !== cur.status) return fail("CONFLICT");
            if ((input.action === "approve" || input.action === "review") && cur.requestedBy === me.id) return fail("FORBIDDEN");
            if (input.action === "approve" && cur.reviewedBy === me.id) return fail("FORBIDDEN");
            cur.status = ACTION_TARGET[String(input.action)];
            if (input.comment) cur.decisionComment = input.comment;
            if (input.action === "review" || input.action === "reject") cur.reviewedBy = me.id;
            hookOpts.onSuccess?.(cur);
            callOpts.onSuccess?.(cur);
          });
          return;
        }
      },
    }),
  });
  const utilsProxy = new Proxy(
    {},
    {
      get: (_a, r: string) => {
        const routerInv = () => {
          srv.invalidated.push(r);
          if (r === "ecn") refreshList();
        };
        return new Proxy(
          { invalidate: routerInv },
          {
            get: (t, p: string) =>
              p === "invalidate"
                ? routerInv
                : {
                    invalidate: () => {
                      srv.invalidated.push(`${r}.${p}`);
                      if (r === "ecn") refreshList();
                    },
                  },
          },
        );
      },
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

import EngineeringChanges from "./EngineeringChanges";

const base = { changeType: "product", productModelId: null, targetDescription: null, reason: null, impactSummary: null, effectivityDate: null, decisionComment: null, note: null, approvedBy: null, implementedBy: null, closedBy: null, submittedAt: null, reviewedAt: null, approvedAt: null, implementedAt: null, closedAt: null, createdAt: new Date("2026-09-01T00:00:00Z") };
// ORACLE: hàng khai tay. Người dùng hiện tại = 7.
const DRAFT = { ...base, id: 1, ecnKey: "ECN-0001", title: "Doi dung sai R12", status: "draft", requestedBy: 7, reviewedBy: null };
const SUBMITTED = { ...base, id: 2, ecnKey: "ECN-0002", title: "Cap nhat BOM v3", status: "submitted", requestedBy: 3, reviewedBy: null, reason: "Ly do thay doi BOM" };
const IN_REVIEW = { ...base, id: 3, ecnKey: "ECN-0003", title: "Recipe SMT-01", status: "in_review", requestedBy: 3, reviewedBy: 4 };
const MINE_IN_REVIEW = { ...base, id: 4, ecnKey: "ECN-0004", title: "Chuong trinh cua toi", status: "in_review", requestedBy: 7, reviewedBy: 4 };
const CLOSED = { ...base, id: 5, ecnKey: "ECN-0005", title: "Tai lieu cu", status: "closed", requestedBy: 3, reviewedBy: 4 };
const FAR = { ...base, id: 900, ecnKey: "ECN-0900", title: "Ngoai danh sach 200", status: "approved", requestedBy: 3, reviewedBy: 4 };

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // doc 81 Đợt 3 Task 4 — EntityPicker (cmdk) cần hai API trình duyệt mà jsdom không có.
  Element.prototype.scrollIntoView ??= function () {};
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture ??= () => false;
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  srv.db = [DRAFT, SUBMITTED, IN_REVIEW, MINE_IN_REVIEW, CLOSED].map((r) => ({ ...r }));
  srv.items = { 2: [{ id: 11, ecnId: 2, entityType: "bom", entityCode: "BOM-77", entityRef: null, action: "modify", description: "Doi linh kien R12" }] };
  srv.listSnapshot = srv.db.map((r) => ({ ...r }));
  srv.calls = { create: [], transition: [], getById: [] };
  srv.invalidated = [];
  srv.assignments = [{ entityId: 2, assigneeUserId: 21, assigneeName: "Ky su Duyet" }];
  srv.assignCalls = [];
  srv.failTransition = null;
  srv.holdCreate = null;
  srv.nextId = 100;
  perm.isAdmin = false;
  perm.canCreate = true;
  perm.canDecide = true;
  me.id = 7;
  toastSpy.error.mockClear();
  toastSpy.success.mockClear();
  trpcErrSpy.toastTrpcError.mockClear();
  window.history.replaceState(null, "", "/engineering-changes");
});
afterEach(() => cleanup());

const mainList = () => document.querySelector("[data-layout-main]") as HTMLElement;
const rowOf = (text: string) => within(mainList()).getByText(text).closest("tr") as HTMLElement;
const params = () => new URLSearchParams(window.location.search);
const detailLayer = () => document.querySelector('[data-flyout-key="ecn"]') as HTMLElement | null;

describe("ECN P3 — bố cục: MAIN là danh sách", () => {
  it("MAIN chứa bảng ECN + đúng MỘT thanh công cụ (FilterBar); h1 nằm trong header một hàng, ngoài MAIN", () => {
    render(<EngineeringChanges />);
    const m = mainList();
    expect(m).toBeTruthy();
    expect(m.closest("main")).toBeTruthy();
    expect(m.querySelector("table")).toBeTruthy();
    expect(m.querySelector("h1")).toBeNull();
    expect(m.querySelector("[data-layout-header]")).toBeNull();
    const toolbars = m.querySelectorAll("[data-layout-toolbar]");
    expect(toolbars).toHaveLength(1);
    expect(within(toolbars[0] as HTMLElement).getByRole("search")).toBeTruthy();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Thay đổi kỹ thuật");
    expect(h1.closest("[data-layout-header]")).toBeTruthy();
    // không còn khối mô tả/banner nào giữa header và MAIN: header và MAIN là hai con liền nhau
    const header = h1.closest("[data-layout-header]") as HTMLElement;
    expect(header.nextElementSibling).toBe(m);
    // mỗi ECN một hàng
    for (const r of [DRAFT, SUBMITTED, IN_REVIEW, MINE_IN_REVIEW, CLOSED]) expect(within(m).getByText(r.ecnKey)).toBeTruthy();
  });

  it("câu mô tả trang không mất: chuyển vào chip trong header (popover)", async () => {
    render(<EngineeringChanges />);
    const header = screen.getByRole("heading", { level: 1 }).closest("[data-layout-header]") as HTMLElement;
    expect(screen.queryByText(/Quy trình yêu cầu thay đổi ECN \/ ECO/)).toBeNull();
    await userEvent.click(within(header).getByRole("button", { name: /Quy trình ECN/ }));
    expect(await screen.findByText(/Quy trình yêu cầu thay đổi ECN \/ ECO/)).toBeTruthy();
  });

  it("?filter=pending (deep-link Hub) chỉ hiện submitted|in_review; nút 'Xem tất cả' gỡ lọc, giữ trang", async () => {
    window.history.replaceState(null, "", "/engineering-changes?filter=pending");
    render(<EngineeringChanges />);
    const m = mainList();
    expect(within(m).queryByText("ECN-0001")).toBeNull();
    expect(within(m).getByText("ECN-0002")).toBeTruthy();
    expect(within(m).getByText("ECN-0003")).toBeTruthy();
    expect(within(m).queryByText("ECN-0005")).toBeNull();
    const toolbar = m.querySelector("[data-layout-toolbar]") as HTMLElement;
    await userEvent.click(within(toolbar).getByRole("button", { name: "Xem tất cả" }));
    expect(params().get("filter")).toBeNull();
    expect(window.location.pathname).toBe("/engineering-changes");
    expect(within(mainList()).getByText("ECN-0001")).toBeTruthy();
  });

  it("FilterBar đồng bộ URL: ?status=draft&type=product lọc danh sách", () => {
    window.history.replaceState(null, "", "/engineering-changes?status=draft");
    render(<EngineeringChanges />);
    const m = mainList();
    expect(within(m).getByText("ECN-0001")).toBeTruthy();
    expect(within(m).queryByText("ECN-0002")).toBeNull();
  });

  it("danh sách phân trang (DataTable): hơn một trang ⇒ có nút trang sau", () => {
    srv.db = Array.from({ length: 45 }, (_, i) => ({ ...base, id: 1000 + i, ecnKey: `ECN-P${String(i).padStart(3, "0")}`, title: `p${i}`, status: "draft", requestedBy: 3, reviewedBy: null }));
    srv.listSnapshot = srv.db.map((r) => ({ ...r }));
    render(<EngineeringChanges />);
    const m = mainList();
    expect(within(m).getByText("ECN-P000")).toBeTruthy();
    expect(within(m).queryByText("ECN-P044")).toBeNull();
    expect(within(m).getByRole("button", { name: "Next page" })).toBeEnabled();
  });
});

describe("ECN P3 — chi tiết trong flyout ?flyout=ecn&flyoutId=", () => {
  it("bấm hàng ⇒ URL có flyout=ecn&flyoutId=<id>, sheet có 5 tab; Esc đóng và URL sạch", async () => {
    render(<EngineeringChanges />);
    await userEvent.click(within(rowOf("ECN-0002")).getByText("Cap nhat BOM v3"));
    expect(params().getAll("flyout")).toEqual(["ecn"]);
    expect(params().getAll("flyoutId")).toEqual(["2"]);
    const layer = await waitFor(() => {
      const l = detailLayer();
      expect(l).toBeTruthy();
      return l as HTMLElement;
    });
    expect(layer.getAttribute("role")).toBe("dialog");
    const tabs = within(layer).getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Tổng quan", "Đối tượng", "Duyệt", "Nhiệm vụ", "Lịch sử"]);
    expect(within(layer).getByText("Ly do thay doi BOM")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(detailLayer()).toBeNull());
    expect(params().get("flyout")).toBeNull();
  });

  it("tab Đối tượng hiện các dòng ecn.getItems của ECN đang mở", async () => {
    render(<EngineeringChanges />);
    await userEvent.click(within(rowOf("ECN-0002")).getByText("Cap nhat BOM v3"));
    const layer = await waitFor(() => detailLayer() as HTMLElement);
    await userEvent.click(within(layer).getByRole("tab", { name: "Đối tượng" }));
    expect(await within(layer).findByText("BOM-77")).toBeTruthy();
    expect(within(layer).getByText("Doi linh kien R12")).toBeTruthy();
  });

  it("F5: nạp trang với ?flyout=ecn&flyoutId=3 dựng lại đúng chi tiết đang mở (giữ ?filter=pending)", async () => {
    window.history.replaceState(null, "", "/engineering-changes?filter=pending&flyout=ecn&flyoutId=3");
    render(<EngineeringChanges />);
    const layer = await waitFor(() => detailLayer() as HTMLElement);
    expect(within(layer).getAllByText("ECN-0003").length).toBeGreaterThan(0);
    expect(within(layer).getByText("Recipe SMT-01")).toBeTruthy();
    expect(params().get("filter")).toBe("pending");
  });

  it("F5 tới ECN không có trong trang danh sách ⇒ đọc ecn.getById, vẫn mở được", async () => {
    srv.db.push({ ...FAR });
    window.history.replaceState(null, "", "/engineering-changes?flyout=ecn&flyoutId=900");
    render(<EngineeringChanges />);
    const layer = await waitFor(() => detailLayer() as HTMLElement);
    expect(await within(layer).findByText("Ngoai danh sach 200")).toBeTruthy();
    expect(srv.calls.getById).toContainEqual({ id: 900 });
  });

  it("nút hành động trong hàng KHÔNG mở chi tiết (không lan click/Enter lên hàng)", async () => {
    render(<EngineeringChanges />);
    const btn = within(rowOf("ECN-0001")).getByRole("button", { name: "Gửi duyệt" });
    fireEvent.keyDown(btn, { key: "Enter" });
    await userEvent.click(btn);
    expect(params().get("flyout")).toBeNull();
  });
});

describe("ECN P3 — tạo ECN qua flyout (luồng đầy đủ)", () => {
  it("mở → nhập → Tạo ⇒ create.mutate đúng payload ⇒ danh sách có ECN mới ⇒ flyout đóng, URL sạch", async () => {
    render(<EngineeringChanges />);
    await userEvent.click(screen.getByRole("button", { name: "Thay đổi mới" }));
    expect(params().get("flyout")).toBe("ecn-new");
    const layer = await waitFor(() => document.querySelector('[data-flyout-key="ecn-new"]') as HTMLElement);
    expect(layer.getAttribute("data-slot")).toBe("sheet-content");
    await userEvent.type(within(layer).getByLabelText("Tiêu đề"), "  ECN moi tu test  ");
    await userEvent.type(within(layer).getByLabelText("Lý do"), "can doi");
    await userEvent.click(within(layer).getByRole("button", { name: "Tạo mới" }));
    expect(srv.calls.create).toEqual([{ title: "ECN moi tu test", changeType: "product", productModelId: undefined, targetDescription: undefined, reason: "can doi", impactSummary: undefined, effectivityDate: undefined }]);
    await waitFor(() => expect(document.querySelector('[data-flyout-key="ecn-new"]')).toBeNull());
    expect(params().get("flyout")).toBeNull();
    expect(within(mainList()).getByText("ECN-NEW-100")).toBeTruthy();
    expect(srv.invalidated.some((k) => k === "ecn" || k === "ecn.list")).toBe(true);
    expect(toastSpy.success).toHaveBeenCalled();
  });

  it("final wave M-1: tạo ĐANG BAY, người dùng bỏ sheet rồi mở chi tiết ECN khác ⇒ thành công muộn KHÔNG đóng nhầm lớp chi tiết", async () => {
    let release: () => void = () => {};
    srv.holdCreate = new Promise<void>((r) => { release = r; });
    render(<EngineeringChanges />);
    await userEvent.click(screen.getByRole("button", { name: "Thay đổi mới" }));
    const layer = await waitFor(() => document.querySelector('[data-flyout-key="ecn-new"]') as HTMLElement);
    await userEvent.type(within(layer).getByLabelText("Tiêu đề"), "ECN bay");
    await userEvent.click(within(layer).getByRole("button", { name: "Tạo mới" }));
    expect(srv.calls.create).toHaveLength(1);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(await screen.findByRole("button", { name: "Bỏ thay đổi" }));
    await waitFor(() => expect(document.querySelector('[data-flyout-key="ecn-new"]')).toBeNull());
    await userEvent.click(within(rowOf("ECN-0002")).getByText("ECN-0002"));
    await waitFor(() => expect(detailLayer()).toBeTruthy());
    release();
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(detailLayer()).toBeTruthy();
    expect(params().get("flyout")).toBe("ecn");
    expect(params().get("flyoutId")).toBe("2");
  });

  it("thiếu tiêu đề ⇒ báo lỗi, KHÔNG gọi create, flyout giữ mở", async () => {
    render(<EngineeringChanges />);
    await userEvent.click(screen.getByRole("button", { name: "Thay đổi mới" }));
    const layer = await waitFor(() => document.querySelector('[data-flyout-key="ecn-new"]') as HTMLElement);
    await userEvent.type(within(layer).getByLabelText("Tiêu đề"), "   ");
    await userEvent.click(within(layer).getByRole("button", { name: "Tạo mới" }));
    expect(srv.calls.create).toHaveLength(0);
    expect(toastSpy.error).toHaveBeenCalledWith("Bắt buộc nhập tiêu đề");
    expect(document.querySelector('[data-flyout-key="ecn-new"]')).toBeTruthy();
  });

  it("đã gõ rồi Esc ⇒ hỏi 'Bỏ thay đổi chưa lưu?' (không mất dữ liệu im lặng)", async () => {
    render(<EngineeringChanges />);
    await userEvent.click(screen.getByRole("button", { name: "Thay đổi mới" }));
    const layer = await waitFor(() => document.querySelector('[data-flyout-key="ecn-new"]') as HTMLElement);
    await userEvent.type(within(layer).getByLabelText("Tiêu đề"), "dang go");
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByText("Bỏ thay đổi chưa lưu?")).toBeTruthy();
  });

  it("không có quyền tạo ⇒ không có nút, deep-link ?flyout=ecn-new không mở form", async () => {
    perm.canCreate = false;
    window.history.replaceState(null, "", "/engineering-changes?flyout=ecn-new");
    render(<EngineeringChanges />);
    expect(screen.queryByRole("button", { name: "Thay đổi mới" })).toBeNull();
    expect(document.querySelector('[data-flyout-key="ecn-new"]')).toBeNull();
  });
});

describe("ECN P3 — ký duyệt / từ chối qua TransitionDialog (hợp đồng hiện tại, R-2-g)", () => {
  it("Phê duyệt: mở sheet xác nhận (không bắn ngay), ý kiến TUỲ CHỌN; xác nhận ⇒ expectedStatus; trạng thái đổi trong danh sách", async () => {
    render(<EngineeringChanges />);
    await userEvent.click(within(rowOf("ECN-0003")).getByRole("button", { name: "Phê duyệt" }));
    expect(srv.calls.transition).toHaveLength(0);
    const sheet = await waitFor(() => document.querySelector('[data-transition-kind="approve"]') as HTMLElement);
    expect(sheet.getAttribute("data-slot")).toBe("sheet-content");
    expect(within(sheet).getByText(/Xác nhận phê duyệt ECN-0003/)).toBeTruthy();
    const confirm = within(sheet).getByRole("button", { name: "Phê duyệt" });
    expect(confirm).toBeEnabled(); // không bắt buộc ý kiến
    await userEvent.click(confirm);
    expect(srv.calls.transition).toEqual([{ id: 3, action: "approve", expectedStatus: "in_review" }]);
    await waitFor(() => expect(document.querySelector('[data-transition-kind="approve"]')).toBeNull());
    expect(within(rowOf("ECN-0003")).getByText("Đã phê duyệt")).toBeTruthy();
  });

  it("Phê duyệt có ý kiến ⇒ comment đã trim được gửi kèm", async () => {
    render(<EngineeringChanges />);
    await userEvent.click(within(rowOf("ECN-0003")).getByRole("button", { name: "Phê duyệt" }));
    const sheet = await waitFor(() => document.querySelector('[data-transition-kind="approve"]') as HTMLElement);
    await userEvent.type(within(sheet).getByRole("textbox"), "  dat yeu cau ");
    await userEvent.click(within(sheet).getByRole("button", { name: "Phê duyệt" }));
    expect(srv.calls.transition).toEqual([{ id: 3, action: "approve", expectedStatus: "in_review", comment: "dat yeu cau" }]);
  });

  it("Từ chối: lý do BẮT BUỘC (khoảng trắng không tính); có lý do ⇒ gửi comment + expectedStatus", async () => {
    render(<EngineeringChanges />);
    await userEvent.click(within(rowOf("ECN-0002")).getByRole("button", { name: "Từ chối" }));
    const sheet = await waitFor(() => document.querySelector('[data-transition-kind="reject"]') as HTMLElement);
    const confirm = within(sheet).getByRole("button", { name: "Từ chối" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(sheet).getByRole("textbox"), "   ");
    expect(confirm).toBeDisabled();
    await userEvent.type(within(sheet).getByRole("textbox"), "thieu phan tich");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(srv.calls.transition).toEqual([{ id: 2, action: "reject", comment: "thieu phan tich", expectedStatus: "submitted" }]);
    await waitFor(() => expect(within(rowOf("ECN-0002")).getByText("Đã từ chối")).toBeTruthy());
  });

  it("server từ chối (CONFLICT) ⇒ sheet GIỮ mở với chữ đã gõ, lỗi được báo đúng một lần", async () => {
    render(<EngineeringChanges />);
    await userEvent.click(within(rowOf("ECN-0002")).getByRole("button", { name: "Từ chối" }));
    const sheet = await waitFor(() => document.querySelector('[data-transition-kind="reject"]') as HTMLElement);
    await userEvent.type(within(sheet).getByRole("textbox"), "ly do");
    srv.failTransition = { data: { code: "CONFLICT" } };
    await userEvent.click(within(sheet).getByRole("button", { name: "Từ chối" }));
    await waitFor(() => expect(trpcErrSpy.toastTrpcError).toHaveBeenCalledTimes(1));
    expect(document.querySelector('[data-transition-kind="reject"]')).toBeTruthy();
    expect(within(sheet).getByRole("textbox")).toHaveValue("ly do");
  });

  it("Gửi duyệt (advance) gọi thẳng, không sheet, mang expectedStatus; danh sách cập nhật", async () => {
    render(<EngineeringChanges />);
    await userEvent.click(within(rowOf("ECN-0001")).getByRole("button", { name: "Gửi duyệt" }));
    expect(srv.calls.transition).toEqual([{ id: 1, action: "submit", expectedStatus: "draft" }]);
    expect(document.querySelector("[data-transition-kind]")).toBeNull();
    await waitFor(() => expect(within(rowOf("ECN-0001")).getByText("Đã gửi duyệt")).toBeTruthy());
  });

  it("maker-checker: người tạo không duyệt được ECN của mình (nút khoá, nói lý do) — khớp ecnService", () => {
    render(<EngineeringChanges />);
    const btn = within(rowOf("ECN-0004")).getByRole("button", { name: "Phê duyệt" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription(/Bạn là người tạo mục này/);
  });

  it("final wave T4-M2: maker-checker 'Bắt đầu xem xét' — người TẠO không tự xem xét ECN đã gửi của mình (nút khoá, nói lý do)", () => {
    srv.db.push({ ...SUBMITTED, id: 6, ecnKey: "ECN-0006", title: "Toi gui", requestedBy: 7 });
    srv.listSnapshot = srv.db.map((r) => ({ ...r }));
    render(<EngineeringChanges />);
    const mine = within(rowOf("ECN-0006")).getByRole("button", { name: "Bắt đầu xem xét" });
    expect(mine).toBeDisabled();
    expect(mine).toHaveAccessibleDescription(/Bạn là người tạo mục này/);
    // ECN người khác gửi ⇒ xem xét được
    expect(within(rowOf("ECN-0002")).getByRole("button", { name: "Bắt đầu xem xét" })).toBeEnabled();
  });

  it("final wave T4-M2: maker-checker 'Phê duyệt' — người ĐÃ XEM XÉT không tự phê duyệt (nút khoá, nói lý do)", () => {
    srv.db.push({ ...IN_REVIEW, id: 7, ecnKey: "ECN-0007", title: "Toi xem xet", requestedBy: 3, reviewedBy: 7 });
    srv.listSnapshot = srv.db.map((r) => ({ ...r }));
    render(<EngineeringChanges />);
    const btn = within(rowOf("ECN-0007")).getByRole("button", { name: "Phê duyệt" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription(/Bạn đã xem xét mục này/);
    // người khác xem xét ⇒ phê duyệt được
    expect(within(rowOf("ECN-0003")).getByRole("button", { name: "Phê duyệt" })).toBeEnabled();
  });

  it("duyệt từ trong chi tiết (flyout) ⇒ trạng thái trong chi tiết đổi, chi tiết vẫn mở", async () => {
    render(<EngineeringChanges />);
    await userEvent.click(within(rowOf("ECN-0003")).getByText("Recipe SMT-01"));
    const layer = await waitFor(() => detailLayer() as HTMLElement);
    expect(within(layer).getByText("Đang xem xét")).toBeTruthy();
    await userEvent.click(within(layer).getByRole("button", { name: "Phê duyệt" }));
    const sheet = await waitFor(() => document.querySelector('[data-transition-kind="approve"]') as HTMLElement);
    await userEvent.click(within(sheet).getByRole("button", { name: "Phê duyệt" }));
    expect(srv.calls.transition).toEqual([{ id: 3, action: "approve", expectedStatus: "in_review" }]);
    await waitFor(() => expect(within(detailLayer() as HTMLElement).getByText("Đã phê duyệt")).toBeTruthy());
    expect(params().get("flyoutId")).toBe("3");
  });

  it("không có quyền quyết định ⇒ không có nút hành động", () => {
    perm.canDecide = false;
    render(<EngineeringChanges />);
    expect(within(rowOf("ECN-0003")).queryByRole("button", { name: "Phê duyệt" })).toBeNull();
  });
});

describe("doc 81 Đợt 3 Task 4 — 'Giao cho' + cột 'Người được giao'", () => {
  const vi_ = (k: string): string => k.split(".").reduce<any>((o, p) => o?.[p], viLocale);
  it("danh sách có cột 'Người được giao' đọc engineering.assignments (ECN-0002 ⇒ tên; ECN khác ⇒ —)", () => {
    window.history.replaceState({}, "", "/engineering-changes");
    render(<EngineeringChanges />);
    const main = document.querySelector("[data-layout-main]") as HTMLElement;
    expect(within(main).getByRole("columnheader", { name: vi_("engineeringAssign.column") })).toBeInTheDocument();
    const row2 = within(main).getByText("ECN-0002").closest("tr") as HTMLElement;
    expect(row2.querySelector("[data-assignee-cell]")).toHaveTextContent("Ky su Duyet");
    const row1 = within(main).getByText("ECN-0001").closest("tr") as HTMLElement;
    expect(row1.querySelector("[data-assignee-cell]")).toHaveTextContent("—");
  });

  it("sheet chi tiết ECN CHỜ DUYỆT + quyền quyết định ⇒ bộ chọn 'Giao cho'; chọn người khác ⇒ assign mang expected = người đang giao", () => {
    window.history.replaceState({}, "", "/engineering-changes?flyout=ecn&flyoutId=2");
    render(<EngineeringChanges />);
    const ctl = document.querySelector('[data-assign-control="ecn"]') as HTMLElement;
    expect(ctl).not.toBeNull();
    const box = within(ctl).getByRole("combobox", { name: vi_("engineeringAssign.label") });
    expect(box).toHaveTextContent("Ky su Duyet");
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("option", { name: /Ky su Thu Hai/ }));
    expect(srv.assignCalls).toEqual([{ name: "assign", entityType: "ecn", entityId: 2, assigneeUserId: 22, expectedAssigneeUserId: 21 }]);
    // Được giao ≠ được duyệt: không lượt chuyển trạng thái ECN nào được gọi.
    expect(srv.calls.transition).toEqual([]);
  });

  it("ECN KHÔNG chờ duyệt (đã đóng) ⇒ chỉ đọc, không combobox; không có quyền quyết định ⇒ chỉ đọc", () => {
    window.history.replaceState({}, "", "/engineering-changes?flyout=ecn&flyoutId=5");
    render(<EngineeringChanges />);
    const ctl = document.querySelector('[data-assign-control="ecn"]') as HTMLElement;
    expect(ctl).not.toBeNull();
    expect(within(ctl).queryByRole("combobox")).toBeNull();
    cleanup();
    perm.canDecide = false;
    window.history.replaceState({}, "", "/engineering-changes?flyout=ecn&flyoutId=2");
    render(<EngineeringChanges />);
    const ctl2 = document.querySelector('[data-assign-control="ecn"]') as HTMLElement;
    expect(within(ctl2).queryByRole("combobox")).toBeNull();
    expect(ctl2).toHaveTextContent("Ky su Duyet");
  });
});

describe("ECN P3 — công cụ admin bổ sung componentCode", () => {
  it("chỉ admin thấy nút; bấm ⇒ flyout ecn-backfill (không còn card nằm dưới danh sách)", async () => {
    render(<EngineeringChanges />);
    expect(screen.queryByRole("button", { name: "Bổ sung componentCode từ BOM" })).toBeNull();
    cleanup();
    perm.isAdmin = true;
    render(<EngineeringChanges />);
    expect(screen.queryByText(/Điền componentCode còn trống/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Bổ sung componentCode từ BOM" }));
    expect(params().get("flyout")).toBe("ecn-backfill");
    expect(await screen.findByText(/Điền componentCode còn trống/)).toBeTruthy();
  });
});

describe("ECN P3 — i18n: mọi khoá trang dùng có chuỗi ở vi/en/zh", () => {
  it("khoá literal t(\"ecn.…\"/\"layoutKit.…\"/\"common.…\") + khoá động (type/status/action/itemAction/tab) đủ 3 ngôn ngữ", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(process.cwd(), "client/src");
    const src = fs.readFileSync(path.join(dir, "pages/EngineeringChanges.tsx"), "utf8");
    const keys = new Set([...src.matchAll(/t\("((?:ecn|layoutKit|common)\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]));
    for (const g of ["product", "bom", "recipe", "program", "process", "document"]) keys.add(`ecn.type.${g}`);
    for (const s of ["draft", "submitted", "in_review", "approved", "rejected", "implemented", "closed"]) keys.add(`ecn.status.${s}`);
    for (const a of ["submit", "review", "approve", "reject", "implement", "close"]) keys.add(`ecn.action.${a}`);
    for (const a of ["add", "modify", "remove"]) keys.add(`ecn.itemAction.${a}`);
    expect(keys.size).toBeGreaterThan(60);
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
