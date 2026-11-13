// @vitest-environment jsdom
//
// Vùng URGENT bền (H37 + 22 kind A2(n)): thẻ KHÔNG tự rời; "Tôi đã đọc" chỉ thu gọn (vẫn trong vùng); không nút xoá / "đánh dấu tất cả";
// nhãn theo kind (kind lạ ⇒ title); message server nguyên văn; tối đa 3 thẻ + "+N"; role="alert" chỉ cho thẻ chưa đọc; "cũ" khi làm mới lỗi.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import i18next from "i18next";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const srv = vi.hoisted(() => ({
  data: undefined as unknown,
  isError: false,
  signedIn: true,
  marks: [] as Array<{ id: number }>,
  mutOpts: undefined as { onError?: () => void; onMutate?: () => void } | undefined,
  invalidated: 0,
  queryInput: undefined as unknown,
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: srv.signedIn ? { id: 7 } : null }) }));
vi.mock("@/hooks/usePollingInterval", () => ({ usePollingInterval: (ms: number | false) => ({ refetchInterval: ms }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      notification: { list: { invalidate: () => { srv.invalidated++; } }, unreadCount: { invalidate: () => { srv.invalidated++; } } },
    }),
    notification: {
      // CỐ Ý không khai báo `delete`, `deleteOld`, `markAllAsRead`: thẻ mà đụng tới chúng sẽ ném ⇒ test đỏ.
      list: { useQuery: (input: unknown) => { srv.queryInput = input; return { data: srv.data, isError: srv.isError }; } },
      markAsRead: {
        useMutation: (o: { onError?: () => void; onMutate?: () => void }) => {
          srv.mutOpts = o;
          return { mutate: (v: { id: number }) => { srv.marks.push(v); o.onMutate?.(); }, isPending: false };
        },
      },
    },
  },
}));
vi.mock("wouter", () => ({ Link: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { VungUrgentBen } from "./VungUrgentBen";
import { KIND_URGENT_A2N, TIEN_TO_KIND } from "@/lib/urgentBen";

const VI = vi_ as unknown as { urgent: Record<string, any> };
const H37 = `${TIEN_TO_KIND}edge_stream_stuck`;
const NOW = Date.UTC(2026, 10, 13, 7, 44, 17); // 07:44:17Z

beforeAll(async () => {
  await initLayoutKitTestI18n();
  i18next.addResourceBundle("vi", "translation", vi_, true, true);
  i18next.addResourceBundle("en", "translation", en_, true, true);
  i18next.addResourceBundle("zh", "translation", zh_, true, true);
  await i18next.changeLanguage("vi");
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  srv.data = undefined;
  srv.isError = false;
  srv.signedIn = true;
  srv.marks = [];
  srv.mutOpts = undefined;
  srv.invalidated = 0;
  srv.queryInput = undefined;
});

const hang = (id: number, x: Record<string, unknown> = {}) => ({
  id,
  type: "ALERT",
  priority: "URGENT",
  title: `Run ${id}: edge report stream stuck`,
  message: `RAW server message ${id}`,
  entityType: "orchestration_run",
  entityId: 400 + id,
  isRead: false,
  readAt: null,
  createdAt: new Date(NOW - 192_000 - id * 1000).toISOString(), // 3 phút 12 s + id giây trước
  metadata: { kind: H37 },
  ...x,
});

describe("VungUrgentBen", () => {
  it("không có URGENT nào / chưa đăng nhập ⇒ không render gì", () => {
    srv.data = [];
    const { container, rerender } = render(<VungUrgentBen />);
    expect(container).toBeEmptyDOMElement();
    srv.data = [hang(1)];
    srv.signedIn = false;
    rerender(<VungUrgentBen />);
    expect(container).toBeEmptyDOMElement();
  });

  it("truy vấn đúng: notification.list type ALERT, limit 100", () => {
    srv.data = [hang(1)];
    render(<VungUrgentBen />);
    expect(srv.queryInput).toEqual({ type: "ALERT", limit: 100 });
  });

  it("★ thẻ chưa đọc H37: role=alert, nhãn theo kind, run, tuổi 'ghi nhận … trước · chưa có xác nhận xử lý', message server NGUYÊN VĂN, nút Mở run + Tôi đã đọc", () => {
    srv.data = [hang(1, { createdAt: new Date(NOW - 192_000).toISOString() })];
    render(<VungUrgentBen />);
    const the = screen.getByRole("alert");
    expect(within(the).getByTestId("urgent-nhan")).toHaveTextContent(VI.urgent.kind[H37]);
    expect(within(the).getByTestId("urgent-run")).toHaveTextContent("run 401");
    expect(within(the).getByTestId("urgent-ghi-nhan")).toHaveTextContent("ghi nhận 3 phút 12 s trước · chưa có xác nhận xử lý");
    expect(within(the).getByTestId("urgent-message")).toHaveTextContent("RAW server message 1");
    expect(within(the).getByRole("link", { name: VI.urgent.moRun })).toHaveAttribute("href", "/orchestration-studio?run=401");
    expect(within(the).getByRole("button", { name: VI.urgent.toiDaDoc })).toBeEnabled();
    // không còn chữ "còn hiệu lực" / "đã tác động" (chu-du-an-HST)
    expect(the.textContent ?? "").not.toMatch(/còn hiệu lực|đã tác động/i);
  });

  it("★ tuổi nằm trong vùng aria-live=off (cập nhật theo giây không làm trình đọc màn hình đọc lại thẻ alert); tuổi đổi theo đồng hồ", () => {
    srv.data = [hang(1, { createdAt: new Date(NOW - 10_000).toISOString() })];
    render(<VungUrgentBen />);
    const g = screen.getByTestId("urgent-ghi-nhan");
    expect(g).toHaveAttribute("aria-live", "off");
    expect(g).toHaveTextContent("10 s");
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByTestId("urgent-ghi-nhan")).toHaveTextContent("15 s");
  });

  it("★ bấm 'Tôi đã đọc' ⇒ markAsRead({id}) của đúng thẻ — và CHỈ markAsRead", () => {
    srv.data = [hang(1), hang(2)];
    render(<VungUrgentBen />);
    const the = screen.getAllByTestId("urgent-the");
    fireEvent.click(within(the[0]!).getByRole("button", { name: VI.urgent.toiDaDoc }));
    expect(srv.marks).toEqual([{ id: 1 }]);
  });

  it("★ thẻ ĐÃ ĐỌC KHÔNG biến mất: ở nhóm 'Đã đọc (1)' trong CÙNG vùng, 'bạn đã đọc lúc …', không role=alert, vẫn có Mở run + message", () => {
    srv.data = [hang(1, { isRead: true, readAt: new Date(NOW - 60_000).toISOString() })];
    render(<VungUrgentBen />);
    const vung = screen.getByTestId("vung-urgent-ben");
    const nhom = within(vung).getByTestId("urgent-nhom-da-doc");
    expect(nhom).toHaveTextContent("Đã đọc (1)");
    const the = within(nhom).getByTestId("urgent-the");
    expect(the).toHaveAttribute("data-doc", "da");
    expect(the).toHaveTextContent(/bạn đã đọc lúc/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(the).getByRole("link", { name: VI.urgent.moRun })).toBeInTheDocument();
    expect(within(the).getByTestId("urgent-message")).toHaveTextContent("RAW server message 1");
    expect(within(the).queryByRole("button", { name: VI.urgent.toiDaDoc })).toBeNull(); // đã đọc: không còn nút đọc
  });

  it("★ KHÔNG có nút xoá và KHÔNG có 'đánh dấu tất cả đã đọc' (cả thẻ chưa đọc lẫn đã đọc, cả 3 ngôn ngữ)", async () => {
    srv.data = [hang(1), hang(2, { isRead: true, readAt: new Date(NOW).toISOString() })];
    for (const lng of ["vi", "en", "zh"]) {
      await i18next.changeLanguage(lng);
      const { unmount } = render(<VungUrgentBen />);
      const ten = screen.queryAllByRole("button").map((b) => (b.textContent ?? "") + " " + (b.getAttribute("aria-label") ?? "") + " " + (b.getAttribute("title") ?? ""));
      expect(ten.join("|"), lng).not.toMatch(/xoá|xóa|delete|remove|删除|tất cả|mark all|all as read|全部/i);
      unmount();
    }
    await i18next.changeLanguage("vi");
  });

  it("kind LẠ (đúng tiền tố, chưa có nhãn) ⇒ hiện title của server, không ẩn", () => {
    srv.data = [hang(1, { metadata: { kind: `${TIEN_TO_KIND}kind_moi` }, title: "Run 1: some brand-new outcome" })];
    render(<VungUrgentBen />);
    expect(screen.getByTestId("urgent-nhan")).toHaveTextContent("Run 1: some brand-new outcome");
  });

  it("hàng không phải URGENT A2(n) (priority khác / entityType khác / kind khác) KHÔNG thành thẻ", () => {
    srv.data = [hang(1, { priority: "HIGH" }), hang(2, { entityType: "machine" }), hang(3, { metadata: { kind: "alert_other" } })];
    const { container } = render(<VungUrgentBen />);
    expect(container).toBeEmptyDOMElement();
  });

  it("★ 5 thẻ chưa đọc ⇒ hiện 3 MỚI NHẤT + '+2 URGENT khác'; bấm ⇒ hiện đủ 5 và có nút Thu gọn", () => {
    srv.data = [1, 2, 3, 4, 5].map((i) => hang(i, { createdAt: new Date(NOW - 600_000 + i * 1000).toISOString() }));
    render(<VungUrgentBen />);
    const ids = () => screen.getAllByTestId("urgent-the").map((x) => within(x).getByTestId("urgent-run").textContent);
    expect(ids()).toEqual(["run 405", "run 404", "run 403"]);
    const nhieu = screen.getByTestId("urgent-nhieu");
    expect(nhieu).toHaveTextContent("+2 URGENT khác");
    fireEvent.click(nhieu);
    expect(ids()).toHaveLength(5);
    expect(screen.queryByTestId("urgent-nhieu")).toBeNull();
    fireEvent.click(screen.getByTestId("urgent-thu-gon"));
    expect(ids()).toHaveLength(3);
  });

  it("★ role=alert chỉ cho thẻ CHƯA đọc (đúng số thẻ chưa đọc đang hiện)", () => {
    srv.data = [hang(1), hang(2), hang(3, { isRead: true, readAt: new Date(NOW).toISOString() })];
    render(<VungUrgentBen />);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("★ làm mới LỖI nhưng còn danh sách của lần trước ⇒ GIỮ thẻ + dải 'cũ' (có thể thiếu URGENT mới); lỗi mà chưa có gì ⇒ không hiện", () => {
    srv.data = [hang(1)];
    srv.isError = true;
    const { container, rerender } = render(<VungUrgentBen />);
    expect(screen.getByTestId("urgent-cu")).toHaveTextContent(VI.urgent.cu);
    expect(screen.getByTestId("urgent-the")).toBeInTheDocument();
    srv.data = undefined;
    rerender(<VungUrgentBen />);
    expect(container).toBeEmptyDOMElement();
  });

  it("★ danh sách của lần trước RỖNG mà làm mới LỖI ⇒ vẫn hiện dải 'cũ' (có thể đã có URGENT mới chưa tới), không thẻ nào", () => {
    srv.data = [];
    srv.isError = true;
    render(<VungUrgentBen />);
    expect(screen.getByTestId("urgent-cu")).toBeInTheDocument();
    expect(screen.queryByTestId("urgent-the")).toBeNull();
  });

  it("ghi 'đã đọc' lỗi ⇒ hiện câu lỗi (không im lặng), thẻ vẫn ở chưa đọc", () => {
    srv.data = [hang(1)];
    render(<VungUrgentBen />);
    act(() => { srv.mutOpts!.onError!(); });
    expect(screen.getByText(VI.urgent.loiDanhDau)).toBeInTheDocument();
    expect(screen.getByTestId("urgent-the")).toHaveAttribute("data-doc", "chua");
  });

  it("★ chú giải 'ghim' hiện MỘT lần khi có thẻ kind 16–18 (không lặp theo từng thẻ); không có thẻ nhóm này ⇒ không hiện", () => {
    srv.data = [hang(1, { metadata: { kind: `${TIEN_TO_KIND}stop_pin_mismatch` } }), hang(2, { metadata: { kind: `${TIEN_TO_KIND}stop_unconfirmed_read` } })];
    const { unmount } = render(<VungUrgentBen />);
    expect(screen.getAllByTestId("urgent-chu-giai-ghim")).toHaveLength(1);
    unmount();
    srv.data = [hang(3)];
    render(<VungUrgentBen />);
    expect(screen.queryByTestId("urgent-chu-giai-ghim")).toBeNull();
  });

  it("★ cả 23 kind dựng được thẻ với nhãn dịch (không để lộ khoá trần 'urgent.kind…')", () => {
    srv.data = KIND_URGENT_A2N.map((k, i) => hang(i + 1, { metadata: { kind: k } }));
    render(<VungUrgentBen />);
    fireEvent.click(screen.getByTestId("urgent-nhieu"));
    const nhan = screen.getAllByTestId("urgent-nhan").map((x) => x.textContent ?? "");
    expect(nhan).toHaveLength(23);
    expect(nhan.every((x) => x.length > 0 && !x.startsWith("urgent."))).toBe(true);
  });

  it("nút cao ≥ 44 px (min-h-11) cho Mở run / Tôi đã đọc", () => {
    srv.data = [hang(1)];
    render(<VungUrgentBen />);
    const the = screen.getByTestId("urgent-the");
    expect(within(the).getByRole("link", { name: VI.urgent.moRun }).className).toMatch(/min-h-11/);
    expect(within(the).getByRole("button", { name: VI.urgent.toiDaDoc }).className).toMatch(/min-h-11/);
  });
});
