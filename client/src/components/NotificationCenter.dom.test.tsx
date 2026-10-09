// @vitest-environment jsdom
//
// doc 81 Đợt 3b Task 3 — chuông thông báo đọc bảng `notifications` (router `notification.*` sẵn có) CỘNG nội dung cũ.
// Hợp đồng:
//   • số trên chuông = chưa đọc của server (`notification.unreadCount`) + cảnh báo socket/hệ sinh thái đang hiện (GIỮ);
//   • poll `unreadCount` 30 s CHỈ khi tab hiển thị (usePollingInterval); `list` chỉ gọi khi ngăn mở;
//   • bấm một mục ⇒ điều hướng tới `actionUrl` (CHỈ đường nội bộ tương đối, kiểm lại ở client) + đánh dấu đã đọc;
//     URL lạ ⇒ KHÔNG điều hướng, vẫn đánh dấu đã đọc, hiện "liên kết không hợp lệ";
//   • "Đánh dấu tất cả đã đọc" ⇒ `markAllAsRead`; mọi mutation làm mới `list` + `unreadCount`;
//   • cảnh báo socket + nút "Xoá tất cả" cũ vẫn còn.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 7, role: "engineer" }, loading: false }) }));

const sock = vi.hoisted(() => ({
  alerts: [] as Array<Record<string, unknown>>,
  clearAlerts: vi.fn(),
  dismissAlert: vi.fn(),
}));
vi.mock("@/hooks/useSocket", () => ({
  useSocket: () => ({ isConnected: true, alerts: sock.alerts, clearAlerts: sock.clearAlerts, dismissAlert: sock.dismissAlert }),
}));
vi.mock("@/hooks/useEcosystemEvents", () => ({
  useEcosystemEvents: () => ({ events: [], clear: vi.fn(), dismiss: vi.fn() }),
}));

const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock("wouter", async (orig) => ({
  ...(await orig<typeof import("wouter")>()),
  useLocation: () => ["/", (to: string) => nav.to.push(to)],
}));

type Row = {
  id: number; userId: number; title: string; message: string; actionUrl: string | null; isRead: boolean; createdAt: Date; type: string; priority: string;
  actionUrlBlocked?: boolean; metadata?: Record<string, unknown> | null;
};
const srv = vi.hoisted(() => ({
  unread: 0,
  rows: [] as Row[],
  unreadOpts: [] as Array<Record<string, unknown>>,
  listCalls: [] as Array<{ input: unknown; opts: Record<string, unknown> }>,
  markRead: [] as unknown[],
  markAll: 0,
  invalidated: [] as string[],
  failMark: false,
}));
vi.mock("@/lib/trpc", () => {
  const mutation = (fn: (input: unknown) => void) => (opts: { onSuccess?: () => void; onError?: (e: unknown) => void; onSettled?: () => void } = {}) => ({
    isPending: false,
    mutate: (input: unknown) => {
      fn(input);
      void Promise.resolve().then(() => {
        if (srv.failMark) opts.onError?.(new Error("x"));
        else opts.onSuccess?.();
        opts.onSettled?.();
      });
    },
  });
  const inv = (p: string) => ({ invalidate: () => srv.invalidated.push(p) });
  return {
    trpc: {
      useUtils: () => ({ notification: { list: inv("notification.list"), unreadCount: inv("notification.unreadCount") } }),
      notification: {
        unreadCount: {
          useQuery: (_i: unknown, opts: Record<string, unknown>) => {
            srv.unreadOpts.push(opts);
            return { data: opts?.enabled === false ? undefined : srv.unread, isError: false };
          },
        },
        list: {
          useQuery: (input: unknown, opts: Record<string, unknown>) => {
            srv.listCalls.push({ input, opts });
            return { data: opts?.enabled === false ? undefined : srv.rows, isError: false, isLoading: false };
          },
        },
        markAsRead: { useMutation: mutation((i) => srv.markRead.push(i)) },
        markAllAsRead: { useMutation: mutation(() => { srv.markAll++; }) },
      },
    },
  };
});

import { NotificationCenter } from "./NotificationCenter";
import { toast } from "sonner";
import i18next from "i18next";

let visibility: DocumentVisibilityState = "visible";
beforeAll(async () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  Element.prototype.scrollIntoView ??= function () {};
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await initLayoutKitTestI18n();
});

const row = (id: number, over: Partial<Row> = {}): Row => ({
  id,
  userId: 7,
  title: `Bạn được giao: ECN-${id}`,
  message: `Nội dung ${id}`,
  actionUrl: `/engineering-changes?flyout=ecn&flyoutId=${id}`,
  isRead: false,
  createdAt: new Date("2026-10-09T08:00:00Z"),
  type: "INFO",
  priority: "NORMAL",
  ...over,
});

beforeEach(() => {
  visibility = "visible";
  sock.alerts = [];
  sock.clearAlerts.mockClear();
  srv.unread = 0;
  srv.rows = [];
  srv.unreadOpts = [];
  srv.listCalls = [];
  srv.markRead = [];
  srv.markAll = 0;
  srv.invalidated = [];
  srv.failMark = false;
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.warning).mockClear();
  nav.to = [];
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => cleanup());

const bell = () => screen.getByRole("button", { name: S("notifications.title") });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("NotificationCenter — số trên chuông", () => {
  it("= chưa đọc của server + cảnh báo socket đang hiện (GỘP, không thay)", () => {
    srv.unread = 3;
    sock.alerts = [{ type: "NG_ALERT", machineName: "M1", message: "NG!", timestamp: new Date() }];
    render(<NotificationCenter />);
    expect(within(bell()).getByText("4")).toBeInTheDocument();
  });

  it("chỉ server, > 9 ⇒ '9+'", () => {
    srv.unread = 12;
    render(<NotificationCenter />);
    expect(within(bell()).getByText("9+")).toBeInTheDocument();
  });

  it("0 chưa đọc, 0 cảnh báo ⇒ không có chấm số", () => {
    render(<NotificationCenter />);
    expect(bell().textContent).toBe("");
  });
});

describe("NotificationCenter — poll chỉ khi tab hiển thị", () => {
  it("unreadCount: 30 s, không chạy nền; tab ẩn ⇒ tắt interval", () => {
    render(<NotificationCenter />);
    const last = () => srv.unreadOpts[srv.unreadOpts.length - 1];
    expect(last()).toMatchObject({ refetchInterval: 30_000, refetchIntervalInBackground: false });
    visibility = "hidden";
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(last()).toMatchObject({ refetchInterval: false });
  });

  it("list chỉ bật khi ngăn MỞ, giới hạn 20 mục mới nhất", () => {
    srv.rows = [row(1)];
    render(<NotificationCenter />);
    expect(srv.listCalls.every((c) => c.opts.enabled === false)).toBe(true);
    expect(screen.queryByText("Bạn được giao: ECN-1")).toBeNull();
    fireEvent.click(bell());
    const last = srv.listCalls[srv.listCalls.length - 1];
    expect(last.opts.enabled).toBe(true);
    expect(last.input).toEqual({ limit: 20 });
  });
});

describe("NotificationCenter — danh sách + bấm", () => {
  it("hiện mục của server CÙNG cảnh báo socket cũ; nút Xoá tất cả cũ vẫn chạy", () => {
    srv.unread = 1;
    srv.rows = [row(1), row(2, { isRead: true, title: "Đã bỏ giao: ECN #2" })];
    sock.alerts = [{ type: "NG_ALERT", machineName: "Máy A", message: "NG cao", timestamp: new Date() }];
    render(<NotificationCenter />);
    fireEvent.click(bell());
    const inbox = screen.getByTestId("notif-inbox");
    expect(within(inbox).getByText(S("notifications.inbox.title"))).toBeInTheDocument();
    const items = within(inbox).getAllByTestId("notif-inbox-item");
    expect(items.map((i) => i.getAttribute("data-unread"))).toEqual(["true", "false"]);
    expect(within(items[0]).getByText("Bạn được giao: ECN-1")).toBeInTheDocument();
    expect(within(items[0]).getByText("Nội dung 1")).toBeInTheDocument();
    expect(screen.getByText("Máy A")).toBeInTheDocument();
    expect(screen.getByText("NG cao")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: S("notifications.clearAll") }));
    expect(sock.clearAlerts).toHaveBeenCalledTimes(1);
  });

  it("bấm mục chưa đọc ⇒ điều hướng tới actionUrl + markAsRead({id}) + đóng ngăn + làm mới list/unreadCount", async () => {
    srv.unread = 1;
    srv.rows = [row(5)];
    render(<NotificationCenter />);
    fireEvent.click(bell());
    fireEvent.click(screen.getByTestId("notif-inbox-item"));
    await flush();
    expect(nav.to).toEqual(["/engineering-changes?flyout=ecn&flyoutId=5"]);
    expect(srv.markRead).toEqual([{ id: 5 }]);
    expect(srv.invalidated).toEqual(expect.arrayContaining(["notification.list", "notification.unreadCount"]));
    expect(screen.queryByTestId("notif-inbox")).toBeNull();
  });

  it("bấm mục ĐÃ đọc ⇒ chỉ điều hướng, không gọi markAsRead", async () => {
    srv.rows = [row(6, { isRead: true })];
    render(<NotificationCenter />);
    fireEvent.click(bell());
    fireEvent.click(screen.getByTestId("notif-inbox-item"));
    await flush();
    expect(nav.to).toEqual(["/engineering-changes?flyout=ecn&flyoutId=6"]);
    expect(srv.markRead).toEqual([]);
  });

  it.each([
    ["https://evil.example/x"],
    ["//evil.example/x"],
    ["/\\evil.example"],
    ["javascript:alert(1)"],
  ])("actionUrl lạ (%s) ⇒ KHÔNG điều hướng, vẫn đánh dấu đã đọc, báo liên kết không hợp lệ", async (url) => {
    srv.unread = 1;
    srv.rows = [row(9, { actionUrl: url })];
    render(<NotificationCenter />);
    fireEvent.click(bell());
    expect(screen.getByText(S("notifications.inbox.linkBlocked"))).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("notif-inbox-item"));
    await flush();
    expect(nav.to).toEqual([]);
    expect(srv.markRead).toEqual([{ id: 9 }]);
    expect(screen.getByTestId("notif-inbox")).toBeInTheDocument();
  });

  it("actionUrl null ⇒ không điều hướng, đánh dấu đã đọc, KHÔNG báo liên kết hỏng", async () => {
    srv.unread = 1;
    srv.rows = [row(10, { actionUrl: null })];
    render(<NotificationCenter />);
    fireEvent.click(bell());
    expect(screen.queryByText(S("notifications.inbox.linkBlocked"))).toBeNull();
    fireEvent.click(screen.getByTestId("notif-inbox-item"));
    await flush();
    expect(nav.to).toEqual([]);
    expect(srv.markRead).toEqual([{ id: 10 }]);
  });
});

describe("NotificationCenter — đánh dấu tất cả đã đọc", () => {
  it("có chưa đọc ⇒ nút hiện; bấm ⇒ markAllAsRead + làm mới", async () => {
    srv.unread = 2;
    srv.rows = [row(1), row(2)];
    render(<NotificationCenter />);
    fireEvent.click(bell());
    fireEvent.click(screen.getByRole("button", { name: S("notifications.inbox.markAllRead") }));
    await flush();
    expect(srv.markAll).toBe(1);
    expect(srv.invalidated).toEqual(expect.arrayContaining(["notification.list", "notification.unreadCount"]));
  });

  it("0 chưa đọc ⇒ không có nút", () => {
    srv.rows = [row(1, { isRead: true })];
    render(<NotificationCenter />);
    fireEvent.click(bell());
    expect(screen.queryByRole("button", { name: S("notifications.inbox.markAllRead") })).toBeNull();
  });

  it("không gì cả ⇒ 'Không có thông báo mới' như cũ", () => {
    render(<NotificationCenter />);
    fireEvent.click(bell());
    expect(screen.getByText(S("notifications.noNew"))).toBeInTheDocument();
    expect(screen.queryByTestId("notif-inbox")).toBeNull();
  });
});

// ── doc 81 Đợt 3b final wave — chuông: link bị server chặn, lỗi đánh dấu, ngày theo ngôn ngữ app, thông báo giao việc i18n ──
describe("Đợt 3b final wave — chuông thông báo", () => {
  it("server đã CHẶN link (actionUrl null + actionUrlBlocked) ⇒ hiện 'liên kết không hợp lệ'; bấm ⇒ đánh dấu đọc + BÁO (không im lặng), không điều hướng", async () => {
    srv.unread = 1;
    srv.rows = [row(21, { actionUrl: null, actionUrlBlocked: true })];
    render(<NotificationCenter />);
    fireEvent.click(bell());
    expect(screen.getByText(S("notifications.inbox.linkBlocked"))).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("notif-inbox-item"));
    await flush();
    expect(nav.to).toEqual([]);
    expect(srv.markRead).toEqual([{ id: 21 }]);
    expect(toast.warning).toHaveBeenCalledWith(S("notifications.inbox.linkBlocked"));
  });

  it("markAsRead / markAllAsRead LỖI ⇒ toast lỗi (trước: im lặng); vẫn làm mới list + unreadCount", async () => {
    srv.failMark = true;
    srv.unread = 2;
    srv.rows = [row(22, { actionUrl: null }), row(23)];
    render(<NotificationCenter />);
    fireEvent.click(bell());
    fireEvent.click(screen.getAllByTestId("notif-inbox-item")[0]);
    await flush();
    expect(toast.error).toHaveBeenCalledWith(S("notifications.inbox.markReadFailed"));
    vi.mocked(toast.error).mockClear();
    fireEvent.click(screen.getByRole("button", { name: S("notifications.inbox.markAllRead") }));
    await flush();
    expect(toast.error).toHaveBeenCalledWith(S("notifications.inbox.markReadFailed"));
    expect(srv.invalidated).toEqual(expect.arrayContaining(["notification.list", "notification.unreadCount"]));
  });

  it("ngày giờ theo NGÔN NGỮ APP (i18n), không theo locale trình duyệt", () => {
    const at = new Date("2026-10-09T08:00:00Z");
    srv.rows = [row(24, { createdAt: at, isRead: true })];
    render(<NotificationCenter />);
    fireEvent.click(bell());
    const item = screen.getByTestId("notif-inbox-item");
    expect(item).toHaveTextContent(at.toLocaleString(i18next.language));
    expect(i18next.language).toBe("vi");
    expect(at.toLocaleString("vi")).not.toBe(at.toLocaleString("en-US"));
  });

  it("đổi ngôn ngữ app sang en ⇒ ngày của hộp thư VÀ giờ của cảnh báo socket cũ theo en (trước: cứng 'vi-VN' / locale trình duyệt)", async () => {
    const at = new Date("2026-10-09T15:04:05Z");
    srv.rows = [row(28, { createdAt: at, isRead: true })];
    sock.alerts = [{ type: "NG_ALERT", machineName: "M1", message: "NG!", timestamp: at }];
    await act(async () => { await i18next.changeLanguage("en"); });
    try {
      render(<NotificationCenter />);
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^(${S("notifications.title", en_)}|${S("notifications.title")}|notifications\.title)`) }));
      expect(screen.getByTestId("notif-inbox-item")).toHaveTextContent(at.toLocaleString("en"));
      expect(screen.getByText(at.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }))).toBeInTheDocument();
    } finally {
      await act(async () => { await i18next.changeLanguage("vi"); });
    }
  });

  it("thông báo giao việc mang khoá i18n + tham số ⇒ hiện bằng t() theo ngôn ngữ app; khoá lạ / không metadata ⇒ chữ đã lưu", () => {
    srv.rows = [
      row(25, {
        title: "STORED-TITLE", message: "STORED-MSG",
        metadata: { i18n: { title: "notifications.assignment.assignedTitle", message: "notifications.assignment.assignedMessage", params: { label: "ECN-25 Đổi keo", by: "Lan", entityType: "ecn", entityId: 25 } } },
      }),
      row(26, {
        title: "STORED-T2", message: "STORED-M2",
        metadata: { i18n: { title: "notifications.assignment.unassignedTitle", message: "notifications.assignment.unassignedMessage", params: { label: null, by: "Lan", entityType: "interlock_rule", entityId: 26 } } },
      }),
      row(27, { title: "STORED-T3", message: "STORED-M3", metadata: { i18n: { title: "notifications.khongCo", message: "notifications.khongCo2", params: {} } } }),
    ];
    render(<NotificationCenter />);
    fireEvent.click(bell());
    const [a, b, c] = screen.getAllByTestId("notif-inbox-item");
    const ecn = S("notifications.assignment.entity.ecn");
    const rule = S("notifications.assignment.entity.interlock_rule");
    expect(a).toHaveTextContent(S("notifications.assignment.assignedTitle").replace("{{label}}", "ECN-25 Đổi keo"));
    expect(a).toHaveTextContent(S("notifications.assignment.assignedMessage").replace("{{by}}", "Lan").replace("{{entity}}", ecn));
    expect(a).not.toHaveTextContent("STORED");
    expect(b).toHaveTextContent(S("notifications.assignment.unassignedTitle").replace("{{label}}", `${rule} #26`));
    expect(b).toHaveTextContent(S("notifications.assignment.unassignedMessage").replace("{{by}}", "Lan").replace("{{entity}}", rule));
    expect(c).toHaveTextContent("STORED-T3");
    expect(c).toHaveTextContent("STORED-M3");
  });
});

describe("i18n vi/en/zh", () => {
  it.each([
    "inbox.markReadFailed", "assignment.assignedTitle", "assignment.assignedMessage", "assignment.unassignedTitle", "assignment.unassignedMessage",
    "assignment.entity.ecn", "assignment.entity.recipe", "assignment.entity.interlock_rule", "assignment.entity.changeover", "assignment.entity.orchestration_run",
  ])("final wave: notifications.%s có ở cả ba", (k) => {
    for (const src of [vi_, en_, zh_]) expect(S(`notifications.${k}`, src).length).toBeGreaterThan(0);
  });
  it.each(["title", "markAllRead", "linkBlocked", "loadFailed"])("notifications.inbox.%s có ở cả ba", (k) => {
    for (const src of [vi_, en_, zh_]) expect(S(`notifications.inbox.${k}`, src).length).toBeGreaterThan(0);
  });
});
