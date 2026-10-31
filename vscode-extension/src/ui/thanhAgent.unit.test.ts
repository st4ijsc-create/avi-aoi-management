/** Đợt 11.4 — nút thanh trạng thái + huy hiệu view, với vscode giả. */
import { describe, expect, it, vi } from "vitest";

const item = vi.hoisted(() => ({ text: "", tooltip: "", command: "", name: "", backgroundColor: undefined as unknown, show: vi.fn(), dispose: vi.fn() }));
vi.mock("vscode", () => ({
  StatusBarAlignment: { Right: 2 },
  ThemeColor: class { constructor(public id: string) {} },
  window: { createStatusBarItem: () => item },
}));

import { baoChoDuyet, baoThanhAgent, dangKyThanhAgent, ganViewHuyHieu } from "./thanhAgent";

describe("ui/thanhAgent", () => {
  it("★ đăng ký → hiện; báo usage → chữ đổi; chờ duyệt cộng nhiều khung, huy hiệu view theo tổng, về 0 thì xoá", () => {
    const ctx = { subscriptions: [] as Array<{ dispose(): void }> };
    dangKyThanhAgent(ctx as never);
    expect(item.show).toHaveBeenCalled();
    expect(item.command).toBe("aviAiLocal.moBangChat");
    expect(item.text).toBe("$(hubot) Thợ Cả");
    baoThanhAgent({ model: "chat", ctxPhanTram: 90, uocLuong: false, tokPerS: 40, dangChay: false });
    expect(item.text).toBe("$(hubot) Thợ Cả · chat · 90% ngữ cảnh · 40 tok/s");
    expect(item.backgroundColor).toBeTruthy();
    const view = { badge: undefined as unknown, onDidDispose: vi.fn() };
    ganViewHuyHieu(view as never);
    const a = {};
    const b = {};
    baoChoDuyet(a, 2);
    baoChoDuyet(b, 1);
    expect(view.badge).toEqual({ value: 3, tooltip: "3 thẻ duyệt đang chờ bạn" });
    expect(item.text).toContain("3 chờ duyệt");
    baoChoDuyet(a, 0);
    expect(view.badge).toEqual({ value: 1, tooltip: "1 thẻ duyệt đang chờ bạn" });
    baoChoDuyet(b, 0);
    expect(view.badge).toBeUndefined();
    expect(item.text).not.toContain("chờ duyệt");
    ctx.subscriptions.forEach((d) => d.dispose());
  });
  it("chưa đăng ký ⇒ baoThanhAgent/baoChoDuyet không ném", () => {
    expect(() => { baoThanhAgent({ dangChay: true }); baoChoDuyet({}, 1); }).not.toThrow();
  });
});
