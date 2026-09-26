import { test, expect } from "@playwright/test";

/**
 * doc 67 W4 [P1] — chống tái phát TRÀN NGANG (hScroll) ở viewport panel-PC operator
 * 1280×800 (persona #1: panel-PC 10.1" 1280×800, xem cách 50cm, thao tác găng tay).
 *
 * Bối cảnh: 8/9 trang module Tổng quan từng tràn ngang đúng tại 1280px (scrollWidth
 * đo thực tế 1423 và 1341 tại clientWidth 1280) do shell chung: topbar DashboardLayout
 * + AssetScopeBar (chuỗi Xưởng›Chuyền›Máy min-w-24 không co) + search + chips.
 * /andon (không dùng shell) không tràn → fix nằm ở shell; test này khoá lại điều đó.
 *
 * LƯU Ý AUTH: theo pattern các spec sẵn có (dashboard.spec.ts), suite này KHÔNG đăng
 * nhập và KHÔNG cần server data. Các route gated sẽ redirect về /login (hoặc render
 * màn "cần đăng nhập" của shell) — assertion VẪN HỢP LỆ: bất kể màn nào được render
 * (trang thật, login-redirect, hay shell chờ auth), document không được tràn ngang
 * tại 1280×800. Khi chạy với storageState đã đăng nhập, test tự khắt khe hơn (đo
 * đúng shell đầy đủ + AssetScopeBar).
 */

const VIEWPORT = { width: 1280, height: 800 };

/** Các route module Tổng quan + /login; route gated có thể thấy login-redirect. */
const ROUTES = [
  "/login",
  "/dashboard",
  "/control-tower",
  "/ops-console",
  "/andon",
  "/drill-down",
  "/corporate-dashboard",
  "/executive",
  "/command-center",
];

test.describe("Tổng quan @ 1280×800 — không tràn ngang (no hScroll)", () => {
  test.use({ viewport: VIEWPORT });

  for (const route of ROUTES) {
    test(`${route} không tràn ngang tại 1280px`, async ({ page }) => {
      const response = await page.goto(route);
      // Trang phải render được (SPA trả 200; route gated redirect vẫn <500).
      expect(response?.status() ?? 200).toBeLessThan(500);
      await expect(page.locator("body")).toBeVisible();
      // Chờ SPA mount + layout ổn định (network yên; fallback timeout ngắn nếu có
      // socket giữ kết nối làm networkidle không bao giờ tới).
      await page
        .waitForLoadState("networkidle", { timeout: 5_000 })
        .catch(() => {/* socket/polling giữ mạng bận — layout đã ổn định đủ để đo */});

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      // Bất biến: KHÔNG có tràn ngang ở mức document. clientWidth có thể < 1280 khi
      // có scrollbar dọc — nên so scrollWidth với clientWidth (bề rộng khả dụng thật),
      // và chặn trần tuyệt đối theo viewport để bắt cả trường hợp zoom/scale lạ.
      expect(
        scrollWidth,
        `hScroll tái phát: scrollWidth ${scrollWidth} > clientWidth ${clientWidth} tại ${route}`,
      ).toBeLessThanOrEqual(clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(VIEWPORT.width);
    });
  }
});
