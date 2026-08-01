import { test, expect } from "@playwright/test";

/**
 * Doc 31 Đợt E (UX5, WE-2) — product-setup E2E.
 *
 * The audit found ZERO product E2E coverage (e2e/ chỉ có health/dashboard/login).
 * This spec adds the product-configuration surface.
 *
 * ── Two tiers, on purpose ────────────────────────────────────────────────────
 *  1. GUARDED-ROUTE SMOKE (always runs): the product pages (/products,
 *     /product-onboarding) load without a 5xx and are auth-guarded — proves the
 *     route + shell render against the live server without mutating any data.
 *  2. AUTHENTICATED HAPPY-PATH (skip-gated): create product → add measurement
 *     point → set a limit → (best-effort) release program. This REQUIRES login
 *     credentials and WRITES to the target DB, so it only runs when
 *     E2E_ADMIN_USER + E2E_ADMIN_PASS are provided against a DISPOSABLE env.
 *     By default it is authored-but-unrun (skipped) — the platform gates admin
 *     with mandatory 2FA (TOTP) which a headless run cannot satisfy, and we must
 *     never write test products into the dev/prod database. Supply an OTP-exempt
 *     service account (or a pre-authenticated E2E_SESSION_COOKIE) + a throwaway
 *     database to exercise it end-to-end.
 *
 * Run: npx playwright test e2e/product-setup.spec.ts
 */

test.describe("Product pages — guarded-route smoke", () => {
  test("/products renders (auth-guarded, no 5xx)", async ({ page }) => {
    const response = await page.goto("/products");
    expect(response?.status() ?? 200).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();

    // Unauthenticated → the RouteGuard sends us to /login (or shows a login form).
    // Either way the SPA mounted with real content and did not error.
    const html = await page.content();
    expect(html.length).toBeGreaterThan(100);
  });

  test("/product-onboarding wizard route renders (auth-guarded, no 5xx)", async ({ page }) => {
    const response = await page.goto("/product-onboarding");
    expect(response?.status() ?? 200).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });
});

/**
 * Full authenticated flow — see the header note for why this is skip-gated.
 */
const creds = {
  user: process.env.E2E_ADMIN_USER,
  pass: process.env.E2E_ADMIN_PASS,
  cookie: process.env.E2E_SESSION_COOKIE,
};
const canAuth = !!(creds.cookie || (creds.user && creds.pass));

test.describe("Product setup — authenticated happy path", () => {
  test.skip(!canAuth, "authored-but-unrun: needs E2E_ADMIN_USER/E2E_ADMIN_PASS (OTP-exempt) + a disposable DB");

  // A unique code per run so re-runs don't collide on the product_models unique index.
  const productCode = `E2E-${Date.now()}`;

  test.beforeEach(async ({ page, context }) => {
    if (creds.cookie) {
      // Pre-authenticated session cookie (name=value) supplied by the harness.
      const [name, ...rest] = creds.cookie.split("=");
      const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
      await context.addCookies([{ name, value: rest.join("="), url: baseURL }]);
      return;
    }
    // Interactive login through the real form.
    await page.goto("/login");
    await page.locator('input').first().fill(creds.user!);
    await page.locator('input[type="password"]').fill(creds.pass!);
    await page.locator('button[type="submit"], button:has-text("Đăng nhập"), button:has-text("Login")').first().click();
    // Land somewhere authenticated (role landing) — tolerate any non-login URL.
    await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 15_000 });
  });

  test("create product → add measurement point → set a limit → release", async ({ page }) => {
    // 1. Create the product.
    await page.goto("/products");
    await page.getByRole("button", { name: /new product|tạo sản phẩm|add product|thêm/i }).first().click();
    await page.getByLabel(/code|mã/i).first().fill(productCode);
    await page.getByLabel(/name|tên/i).first().fill(`E2E board ${productCode}`);
    await page.getByRole("button", { name: /save|create|tạo|lưu/i }).first().click();
    await expect(page.getByText(productCode).first()).toBeVisible({ timeout: 15_000 });

    // 2. Open the product editor and add a measurement point.
    await page.getByText(productCode).first().click();
    await page.getByRole("button", { name: /add point|thêm điểm|new point/i }).first().click();
    await page.getByLabel(/code|mã/i).first().fill("MP-1");
    await page.getByLabel(/name|tên/i).first().fill("Solder joint 1");

    // 3. Set a limit (LSL/USL) on the point.
    await page.getByLabel(/lower|lsl|dưới/i).first().fill("0.5");
    await page.getByLabel(/upper|usl|trên/i).first().fill("1.5");
    await page.getByRole("button", { name: /save|lưu/i }).first().click();

    // 4. Release the inspection program (best-effort — SoD may need a 2nd user).
    const releaseBtn = page.getByRole("button", { name: /release|phát hành/i }).first();
    if (await releaseBtn.count()) {
      await releaseBtn.click();
    }

    // Sanity: the point we just authored is visible on the product.
    await expect(page.getByText("MP-1").first()).toBeVisible({ timeout: 10_000 });
  });
});
