// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 2 (fix round 2) — FreshnessStrip `compactUntilXl`: dưới xl (1280 px) top bar không đủ
// chỗ cho nhãn đầy đủ ⇒ chỉ còn icon (vẫn tô màu theo trạng thái); nhãn vẫn đọc được bởi trình đọc màn
// hình (sr-only, KHÔNG display:none) và nằm trong tooltip (title) cùng giờ dữ liệu. Từ xl hiện như cũ.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const SOCK = vi.hoisted(() => ({ connected: true }));
vi.mock("./RealtimeBadge", () => ({ useSocketConnected: () => SOCK.connected }));

import { FreshnessStrip } from "./FreshnessStrip";

beforeAll(async () => {
  await initLayoutKitTestI18n();
});
afterEach(() => cleanup());

const cls = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

describe("FreshnessStrip compactUntilXl", () => {
  it("nhãn vẫn trong DOM cho trình đọc màn hình (sr-only dưới xl, hiện lại từ xl) + tooltip mang nhãn và giờ", () => {
    SOCK.connected = false;
    render(<FreshnessStrip compactUntilXl updatedAt={Date.UTC(2026, 9, 3, 1, 2, 3)} pollingFallback={false} />);
    const st = screen.getByRole("status");
    expect(st).toHaveTextContent("Mất kết nối");
    const label = screen.getByText("Mất kết nối");
    expect(cls(label)).toContain("sr-only");
    expect(cls(label)).toContain("xl:not-sr-only");
    expect(st.getAttribute("title") ?? "").toContain("Mất kết nối");
    expect(st.getAttribute("title") ?? "").toMatch(/\d\d:\d\d:\d\d/);
    // trạng thái bất thường vẫn tô màu ở dạng thu gọn
    expect(st.className).toMatch(/text-destructive/);
    const stamp = st.querySelector("[data-freshness-stamp]") as HTMLElement;
    expect(cls(stamp)).toContain("hidden");
    expect(cls(stamp)).toContain("xl:inline");
  });

  it("mặc định (không compact) không đổi: nhãn hiện, không sr-only", () => {
    SOCK.connected = true;
    render(<FreshnessStrip />);
    expect(cls(screen.getByText("Trực tiếp"))).not.toContain("sr-only");
  });
});
