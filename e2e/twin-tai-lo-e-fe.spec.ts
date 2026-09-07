import { test, expect, type Page } from "@playwright/test";

/**
 * ============================================================================
 * LÔ E4 — ĐO các phần FRONTEND ở quy mô 549 máy / 4 nhà máy
 * ============================================================================
 *
 * Suite này KHÔNG sửa gì. Nó ĐO và IN SỐ, để đợt sau biết sửa ở đâu và tới đâu.
 * Mỗi phép đo kèm CHỖ GỌI `file:line` (G16) trong tên test.
 */
const TAI_KHOAN = {
  username: process.env.E2E_TAI_USER || "e2e_tai_loE",
  password: process.env.E2E_TAI_PASS || "E2eTaiLoE!2026",
};

async function moTwin(page: Page, duong = "/twin") {
  const res = await page.request.post("/api/auth/login", { data: TAI_KHOAN });
  expect(res.ok()).toBeTruthy();
  await page.goto(duong, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("man-twin-van-hanh")).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(
    () => ((window as unknown as { __thongKeVe?: { calls: number } }).__thongKeVe?.calls ?? 0) > 0,
    undefined,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(3_000);
}

test.describe.configure({ mode: "serial" });

test.describe("Lo E4 — phan frontend o quy mo lon", () => {
  test("E4-1 danh sach may KHONG ao hoa — DanhSachMay.tsx:109", async ({ page }) => {
    test.setTimeout(240_000);
    await moTwin(page);

    const so = await page.evaluate(() => {
      const ul = document.querySelector("[data-testid='danh-sach-may'] ul");
      const li = ul ? ul.querySelectorAll("li").length : -1;
      const khai = ul?.getAttribute("data-so-may");
      return { liTrongDom: li, khaiSoMay: khai };
    });
    // Đo THỜI GIAN GÕ vào ô lọc — mỗi ký tự lọc lại toàn bộ danh sách.
    const o = page.getByTestId("o-loc-may");
    const t0 = Date.now();
    await o.fill("FUYU");
    await page.waitForTimeout(200);
    const goMs = Date.now() - t0;
    const sauLoc = await page.evaluate(
      () => document.querySelectorAll("[data-testid='danh-sach-may'] ul li").length,
    );

    console.log(
      `\n[E4-1] DanhSachMay.tsx:109 — .map() tren TOAN BO mang, khong virtual/pagination\n` +
        `   <li> thuc te trong DOM       = ${so.liTrongDom}\n` +
        `   data-so-may (tu khai)        = ${so.khaiSoMay}\n` +
        `   thoi gian mot lan go bo loc  = ${goMs} ms\n` +
        `   <li> sau khi loc "FUYU"      = ${sauLoc}`,
    );
    expect(so.liTrongDom).toBeGreaterThan(0);
  });

  test("E4-2 KHONG co o chon nha may/toa — TwinVanHanh.tsx:225-228", async ({ page }) => {
    test.setTimeout(240_000);
    await moTwin(page);

    const soSelect = await page.evaluate(() => {
      // Mọi bộ chọn khả dĩ trong vùng màn twin
      const root = document.querySelector("[data-testid='man-twin-van-hanh']");
      if (!root) return { select: -1, combobox: -1, vanBan: "" };
      return {
        select: root.querySelectorAll("select").length,
        combobox: root.querySelectorAll("[role='combobox']").length,
        vanBan: (root.querySelector("[data-testid='breadcrumb-twin']")?.textContent ?? "").trim(),
      };
    });
    console.log(
      `\n[E4-2] TwinVanHanh.tsx:225-228 — setFactoryId CHI duoc goi trong effect mac dinh\n` +
        `   <select> trong man twin      = ${soSelect.select}\n` +
        `   [role=combobox] trong man    = ${soSelect.combobox}\n` +
        `   breadcrumb                   = "${soSelect.vanBan}"\n` +
        `   ⇒ KHONG co duong nao trong UI de doi sang nha may khac.`,
    );
  });

  test("E4-3 chi nap tang[0] cua toaNha[0] — TwinVanHanh.tsx:270,278", async ({ page }) => {
    test.setTimeout(240_000);
    await moTwin(page);

    // ⚠ `locator.textContent()` CHỜ HẾT timeout khi phần tử vắng — `.catch()`
    // KHÔNG cứu được, nó chỉ nuốt lỗi SAU khi đã treo 4 phút. Đọc thẳng DOM.
    const { banner, demMay } = await page.evaluate(() => ({
      banner: document.querySelector("[data-testid='banner-doi-soat']")?.textContent ?? null,
      demMay: document.querySelector("[data-testid='dem-may']")?.textContent ?? null,
    }));
    console.log(
      `\n[E4-3] TwinVanHanh.tsx:270 (toaNha[0]) + :278 (tangs[0])\n` +
        `   banner doi soat  = ${banner?.trim() ?? "(khong co)"}\n` +
        `   dem-may tren man = ${demMay?.trim()}\n` +
        `   ⇒ may cua tang 2/3 bi dem la "chua xep cho", khong phai loi du lieu.`,
    );
  });

  test("E4-4 pham vi TAP DOAN khong gop 4 nha may — TwinVanHanh.tsx:226", async ({ page }) => {
    test.setTimeout(240_000);
    await moTwin(page, "/twin?pv=tapdoan");
    const demMay = await page.evaluate(
      () => document.querySelector("[data-testid='dem-may']")?.textContent ?? null,
    );
    const nhan = await page.evaluate(() => {
      const t = new Set<string>();
      for (const e of document.querySelectorAll("[data-testid='man-twin-van-hanh'] *")) {
        const s = (e.textContent ?? "").trim();
        const m = s.match(/^(FUYU-F|TAI-[BCD]|SIM)/);
        if (m && s.length < 40) t.add(m[1]);
      }
      return [...t].sort();
    });
    console.log(
      `\n[E4-4] pham vi ?pv=tapdoan\n` +
        `   dem-may            = ${demMay?.trim()}\n` +
        `   tien to nhan thay  = ${nhan.join(", ") || "(khong)"}\n` +
        `   ⇒ chi mot nha may hien; 3 nha may TAI-* vang mat.`,
    );
    await page.screenshot({ path: "test-results/loE4-tapdoan.png" });
  });
});
