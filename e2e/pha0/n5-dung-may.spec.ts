/**
 * 50-N5 (pha 0 C0-3) — trình duyệt THẬT, hình học THẬT: faceplate mở → "Đổi…" mở hộp xác nhận lồng → 3 toast Sonner ⇒ nút DỪNG MÁY NỔI
 * phải (a) ở tầng trên cùng tại tâm nút (`elementFromPoint` = chính nút), (b) bấm được ≤ 1 s kể từ lúc điều kiện đủ, (c) mở HỘP XÁC NHẬN DỪNG
 * của máy SCR-06 mà KHÔNG gửi lệnh nào (không gọi /api/trpc/scadaCommands.dungMay).
 * Harness: `n5-harness.tsx` (thành phần thật, không máy chủ, không DB). Chạy:
 *   npx playwright test --config=playwright.n5.config.ts   (globalSetup tự dựng Vite harness ở cổng riêng N5_PORT, mặc định 5211).
 */
import { expect, test } from "@playwright/test";

const BASE = process.env.N5_BASE_URL ?? "http://127.0.0.1:5211";

test.describe("50-N5 — nút DỪNG MÁY không bị che (C0-3)", () => {
  test("hộp xác nhận lồng + 3 toast ⇒ bấm DỪNG được ≤ 1 s, hình học thật", async ({ page }) => {
    const gui: string[] = [];
    page.on("request", (r) => {
      if (/scadaCommands\.(dungMay|request|confirm)/.test(r.url())) gui.push(r.url());
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/n5-harness.html`);
    await page.getByTestId("mo-faceplate").click();
    await expect(page.getByTestId("faceplate")).toBeVisible();
    // 1) trong faceplate, chưa có hộp lồng ⇒ nút trong luồng bấm được và KHÔNG có nút nổi
    await expect(page.getByTestId("nut-dung-may")).toBeVisible();
    await expect(page.getByTestId("nut-dung-may-noi")).toHaveCount(0);

    // 2) hộp xác nhận lồng + 3 toast
    await page.getByTestId("mo-hop-long").click();
    await expect(page.getByTestId("hop-xac-nhan-long")).toBeVisible();
    await page.evaluate(() => (window as unknown as { __bonToast: () => void }).__bonToast());
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(3);

    // 3) nút nổi: có mặt, ở trên cùng tại tâm, không bị toast / hộp / lớp phủ che
    const nut = page.getByTestId("nut-dung-may-noi");
    await expect(nut).toBeVisible({ timeout: 2_000 });
    const hinhHoc = await nut.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const diem = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 4, r.top + 4],
        [r.right - 4, r.bottom - 4],
      ];
      return diem.map(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && (el === hit || el.contains(hit));
      });
    });
    expect(hinhHoc, "tâm + 2 góc của nút nổi phải là CHÍNH nút (không toast/lớp phủ che)").toEqual([true, true, true]);
    const z = await nut.evaluate((el) => Number(getComputedStyle(el.closest("[data-lop-dung-may-noi]") as HTMLElement).zIndex));
    expect(z).toBeGreaterThan(999_999_999);

    // 4) bấm ≤ 1 s ⇒ hộp xác nhận DỪNG của SCR-06; KHÔNG gửi lệnh
    const t0 = Date.now();
    await nut.click({ timeout: 1_000 });
    await expect(page.getByRole("dialog").filter({ hasText: "SCR-06" }).last()).toBeVisible({ timeout: 1_000 });
    const dt = Date.now() - t0;
    expect(dt, "bấm DỪNG → hộp xác nhận ≤ 1 s").toBeLessThanOrEqual(1_000);
    expect(gui, "mở hộp xác nhận KHÔNG được gửi lệnh nào").toEqual([]);
    console.log(`[N5] bấm DỪNG nổi → hộp xác nhận: ${dt} ms (3 toast + hộp lồng)`);
  });

  test("hộp lồng đóng ⇒ nút nổi biến mất; nút trong luồng bấm được lại", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/n5-harness.html`);
    await page.getByTestId("mo-faceplate").click();
    await page.getByTestId("mo-hop-long").click();
    await expect(page.getByTestId("nut-dung-may-noi")).toBeVisible({ timeout: 2_000 });
    await page.keyboard.press("Escape"); // đóng hộp lồng
    await expect(page.getByTestId("hop-xac-nhan-long")).toBeHidden();
    await expect(page.getByTestId("nut-dung-may-noi")).toHaveCount(0, { timeout: 2_000 });
    await expect(page.getByTestId("nut-dung-may")).toBeVisible();
  });
});
