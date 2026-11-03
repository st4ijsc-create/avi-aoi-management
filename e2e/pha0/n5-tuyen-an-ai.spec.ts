/**
 * 50-N5 / C0-2 (pha 0) — ỨNG DỤNG ĐẦY ĐỦ (instance riêng từ mã nguồn, CSDL `_test`, cổng riêng): trên MỌI tuyến có nút DỪNG MÁY, nút AI của top bar
 * (`ShellAiButton`, `[data-shell-ai]`) và bong bóng nổi (`AILocalChatBubble` FAB) KHÔNG có trong DOM; trên tuyến không có DỪNG (`/command-center`)
 * thì CÓ (đối chứng dương — chứng minh vỏ + nút AI thật sự dựng được trong cùng điều kiện đăng nhập).
 * Chạy: `npx playwright test --config=playwright.pha0route.config.ts` (globalSetup của flow-studio dựng instance + gieo MỘT người dùng fixture
 * `fse2e*`, dọn + đếm về 0 ở teardown; không :3000, không :3071, không dev DB; không bật OT / GPU).
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import type { FsFixture } from "../flow-studio/fixtures";

test.skip(process.env.FS_E2E !== "1", "chạy riêng dưới playwright.pha0route.config.ts");

let fx: FsFixture;
let base: string;
test.beforeAll(() => {
  fx = JSON.parse(fs.readFileSync(process.env.FS_STATE!, "utf8")) as FsFixture;
  base = process.env.FS_BASE_URL!;
});

async function dangNhap(page: Page): Promise<void> {
  await page.context().addInitScript(() => {
    try {
      localStorage.setItem("i18nextLng", "vi");
    } catch {
      /* */
    }
  });
  const r = await page.context().request.post(`${base}/api/auth/login`, { data: { username: fx.admin.username, password: fx.admin.password } });
  expect(r.ok(), `login: ${r.status()}`).toBe(true);
}

/** Số lối vào AI đang có trong DOM: nút AI trên top bar + FAB nổi cũ. */
const demLoiVaoAi = (page: Page) =>
  page.evaluate(() => ({
    shell: document.querySelectorAll("[data-shell-ai]").length,
    fab: document.querySelectorAll("div.fixed.bottom-6.right-6.z-50 button").length,
    topBar: document.querySelectorAll("header").length,
  }));

const TUYEN_CO_DUNG = ["/scada/diag", "/scada/config/channels", "/scada/journal", "/command-console", "/line-view"];

test.describe("50-N5 / C0-2 — AI ẩn trên tuyến có nút DỪNG", () => {
  test("đối chứng dương: /command-center có lối vào AI (vỏ dựng được)", async ({ page }) => {
    await dangNhap(page);
    await page.goto(`${base}/command-center`);
    await expect(page.locator("[data-shell-ai], div.fixed.bottom-6.right-6.z-50 button").first()).toBeAttached({ timeout: 60_000 });
    const d = await demLoiVaoAi(page);
    expect(d.shell + d.fab, "/command-center phải có ≥ 1 lối vào AI").toBeGreaterThanOrEqual(1);
  });

  for (const tuyen of TUYEN_CO_DUNG) {
    test(`${tuyen}: KHÔNG có nút AI trên top bar, KHÔNG có bong bóng nổi`, async ({ page }) => {
      await dangNhap(page);
      await page.goto(`${base}${tuyen}`);
      // chờ trang dựng xong (vỏ + nội dung), rồi để bong bóng lazy (React.lazy) có thời gian xuất hiện nếu có
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
      await page.waitForTimeout(3_000);
      const d = await demLoiVaoAi(page);
      expect(d.topBar, `${tuyen}: vỏ phải dựng (có top bar) — nếu không, phép đo vô nghĩa`).toBeGreaterThanOrEqual(1);
      expect(d.shell, `${tuyen}: nút AI top bar`).toBe(0);
      expect(d.fab, `${tuyen}: bong bóng nổi`).toBe(0);
    });
  }
});
