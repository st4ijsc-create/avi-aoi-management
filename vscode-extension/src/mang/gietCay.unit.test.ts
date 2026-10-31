// Đợt 12 / H2 vòng 2 — đóng tiến trình sống lâu (MCP): POSIX SIGTERM TRƯỚC rồi SIGKILL cả cây sau ân hạn; thoát êm thì không SIGKILL; Windows đi đường taskkill.
// Hiệu ứng được TIÊM (`mo`) ⇒ chạy được nhánh POSIX trên máy Windows mà không giết nhầm tiến trình thật.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dongTienTrinhSongLau, type MoDongMem } from "./gietCay";

type Cp = Parameters<typeof dongTienTrinhSongLau>[0];
const cpGia = (o: Partial<Cp> = {}) => {
  const tinHieu: Array<string | undefined> = [];
  const cp = { pid: 4242, exitCode: null, signalCode: null, kill: (s?: NodeJS.Signals) => (tinHieu.push(s), true), ...o } as Cp;
  return { cp, tinHieu };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("dongTienTrinhSongLau — POSIX", () => {
  it("★ SIGTERM NGAY; chưa SIGKILL trước ân hạn; sau ân hạn còn sống ⇒ giết CẢ CÂY rồi SIGKILL", () => {
    const gietCay = vi.fn(() => "da-ra-lenh" as const);
    const mo: MoDongMem = { windows: false, gietCay };
    const { cp, tinHieu } = cpGia();
    dongTienTrinhSongLau(cp, 2_000, mo);
    expect(tinHieu).toEqual(["SIGTERM"]);
    vi.advanceTimersByTime(1_999);
    expect(tinHieu).toEqual(["SIGTERM"]);
    expect(gietCay).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(gietCay).toHaveBeenCalledWith(4242);
    expect(tinHieu).toEqual(["SIGTERM", "SIGKILL"]);
  });
  it("★ đã thoát êm sau SIGTERM (exitCode/signalCode có giá trị) ⇒ KHÔNG SIGKILL, không giết cây (tránh trúng pid tái dùng)", () => {
    const gietCay = vi.fn(() => "da-ra-lenh" as const);
    const { cp, tinHieu } = cpGia();
    dongTienTrinhSongLau(cp, 2_000, { windows: false, gietCay });
    (cp as { exitCode: number | null }).exitCode = 0;
    vi.advanceTimersByTime(5_000);
    expect(gietCay).not.toHaveBeenCalled();
    expect(tinHieu).toEqual(["SIGTERM"]);
    const b = cpGia({ signalCode: "SIGTERM" });
    dongTienTrinhSongLau(b.cp, 2_000, { windows: false, gietCay });
    vi.advanceTimersByTime(5_000);
    expect(gietCay).not.toHaveBeenCalled();
  });
  it("kill ném (đã chết) ⇒ không ném ra ngoài", () => {
    const { cp } = cpGia({
      kill: () => {
        throw new Error("ESRCH");
      },
    });
    expect(() => {
      dongTienTrinhSongLau(cp, 100, { windows: false, gietCay: () => "loi" });
      vi.advanceTimersByTime(200);
    }).not.toThrow();
  });
});

describe("dongTienTrinhSongLau — Windows", () => {
  it("không gửi SIGTERM; đi đường `gietCay` mặc định của Windows (taskkill) — ở đây chỉ kiểm KHÔNG có SIGTERM ngay", () => {
    // `gietCayThenLopHai` dùng `gietCayTienTrinh` THẬT (taskkill) với pid giả ⇒ pid không tồn tại, taskkill báo lỗi vô hại; chỉ cần không SIGTERM.
    const { cp, tinHieu } = cpGia({ pid: 2_147_000_000 });
    dongTienTrinhSongLau(cp, 2_000, { windows: true, gietCay: () => "khong-co-pid" });
    expect(tinHieu).not.toContain("SIGTERM");
  });
});
