// @vitest-environment jsdom
//
// Doc 81 Đợt 3 Task 5 — Fleet đổi đường dẫn (/fleet-orchestration ⇒ /labs/fleet-orchestration). Ghim / Gần đây là lối tắt
// NGƯỜI DÙNG đã lưu (localStorage, dùng chung thanh bên + ⌘K + Hub): URL cũ phải được đọc như URL mới — không thì mục đã
// ghim âm thầm biến mất (thanh bên chỉ hiện href khớp một mục nav). URL đã GỘP vào trang khác (Studio, Copilot) KHÔNG đổi.
import { beforeEach, describe, expect, it } from "vitest";
import { NAV_FAVORITES_KEY, NAV_RECENT_KEY, readFavorites, readRecent } from "./navRecent";
import { canonicalNavHref } from "./engineeringLegacyRedirects";

beforeEach(() => localStorage.clear());

describe("Ghim / Gần đây — URL đã đổi tên đọc như URL mới", () => {
  it("canonicalNavHref: chỉ URL `rename` (giữ query); URL gộp và URL thường giữ nguyên", () => {
    expect(canonicalNavHref("/fleet-orchestration")).toBe("/labs/fleet-orchestration");
    expect(canonicalNavHref("/fleet-orchestration?filter=deadlock")).toBe("/labs/fleet-orchestration?filter=deadlock");
    expect(canonicalNavHref("/fleet-orchestration-x")).toBe("/fleet-orchestration-x");
    expect(canonicalNavHref("/engineering-studio")).toBe("/engineering-studio");
    expect(canonicalNavHref("/recipes?filter=pending")).toBe("/recipes?filter=pending");
  });

  it("readFavorites / readRecent: URL cũ ⇒ URL mới, không trùng lặp, giữ thứ tự", () => {
    localStorage.setItem(NAV_FAVORITES_KEY, JSON.stringify(["/fleet-orchestration", "/recipes", "/labs/fleet-orchestration"]));
    localStorage.setItem(NAV_RECENT_KEY, JSON.stringify(["/safety-workforce", "/fleet-orchestration?tab=zones"]));
    expect(readFavorites()).toEqual(["/labs/fleet-orchestration", "/recipes"]);
    expect(readRecent()).toEqual(["/safety-workforce", "/labs/fleet-orchestration?tab=zones"]);
  });
});
