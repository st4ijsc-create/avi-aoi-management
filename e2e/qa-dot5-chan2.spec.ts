/**
 * Nghiệm thu CHẶN-2 bằng tài khoản BỊ 403 — TUYỆT ĐỐI KHÔNG dùng admin.
 * `maint1` có machine_status/canView (vào được /twin sau bản vá CHẶN-1) nhưng
 * KHÔNG có `andon` ⇒ `andon.active` trả FORBIDDEN.
 */
import { test, expect } from "@playwright/test";

const TK = { username: "maint1", password: "QaDot5Vao!2026" };

test("CHAN-2 — tai khoan bi 403 thay '—' va banner, KHONG thay '0'", async ({ page }) => {
  const res = await page.request.post("/api/auth/login", { data: TK });
  expect(res.status()).toBe(200);

  await page.goto("/twin");
  await page.waitForTimeout(6000);

  // Ảnh toàn màn để TỰ ĐỌC.
  await page.screenshot({ path: ".qa-tmp/shot/chan2-maint1.png", fullPage: false });

  const demCanhBao = await page.getByTestId("khoi-canh-bao").textContent().catch(() => null);
  const demTongQuan = await page.getByTestId("khoi-tong-quan").textContent().catch(() => null);
  const banner = await page.getByTestId("banner-thieu-quyen-truy-van").count();
  const bannerText = banner > 0 ? await page.getByTestId("banner-thieu-quyen-truy-van").textContent() : null;
  const bannerAttr = banner > 0
    ? await page.getByTestId("banner-thieu-quyen-truy-van").getAttribute("data-truy-van") : null;

  console.log("KHOI_TONG_QUAN:", JSON.stringify(demTongQuan));
  console.log("KHOI_CANH_BAO:", JSON.stringify(demCanhBao));
  console.log("BANNER_COUNT:", banner);
  console.log("BANNER_TEXT:", JSON.stringify(bannerText));
  console.log("BANNER_QUERIES:", bannerAttr);
});
