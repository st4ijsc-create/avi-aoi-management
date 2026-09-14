import { test, expect, type Page } from "@playwright/test";

/**
 * e2e Đợt 8 Lô B — #11 BÀN PHÍM WAI-ARIA cho `CayPhanCap` trên `/twin-studio`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO PHẢI CÓ SUITE NÀY DÙ ĐÃ CÓ 27 TEST jsdom
 * ════════════════════════════════════════════════════════════════════════════
 * `CayPhanCap.dom.test.tsx` render component trên **jsdom**, và jsdom KHÔNG có
 * bố cục, KHÔNG có cuộn, và mô hình focus của nó là bản mô phỏng. Ba thứ mà chỉ
 * trình duyệt thật trả lời được:
 *
 *   · **G18 — "chỉ trình duyệt mới thấy".** Thanh tua Đợt 6 render đúng mọi
 *     testid, `check` 0, `build` 0, 971 test xanh — và nằm ở `top: 1265` trong
 *     khung cao 1249px, tức VÔ HÌNH. Một hàng cây nhận focus mà nằm ngoài vùng
 *     cuộn thì người dùng bàn phím "mất" con trỏ y hệt như khi mã hỏng.
 *   · **`document.activeElement` THẬT** sau một sự kiện bàn phím THẬT do trình
 *     duyệt phát (không phải `fireEvent` tổng hợp).
 *   · **Bản đã BUNDLE** — `dist`, không phải mã nguồn. G10b: chỉ báo đo bundler
 *     có thể xanh ở dev và đỏ ở build.
 *
 * ⚠ Cần MÁY CHỦ CÓ THẬT (`aoi-pha0`: "live cần máy CÓ THẬT").
 *   Chạy: `npx playwright test e2e/twin-studio-ban-phim-cay.spec.ts`
 *
 * ★ Dùng lại tài khoản e2e riêng của Đợt 4 (KHÔNG dùng `admin` — xem docblock
 *   `twin-studio-thiet-ke.spec.ts`).
 */
const TAI_KHOAN = {
  username: process.env.E2E_TWIN_USER || "e2e_twin_dot4",
  password: process.env.E2E_TWIN_PASS || "E2eTwinDot4!2026",
};

async function dangNhap(page: Page) {
  const res = await page.request.post("/api/auth/login", { data: TAI_KHOAN });
  expect(res.ok(), `đăng nhập thất bại: ${res.status()}`).toBeTruthy();
}

/** Mở màn Thiết kế và chờ CÂY có hàng — không chờ canvas (bài này không đo 3D). */
async function moCay(page: Page) {
  await page.goto("/twin-studio");
  await page.getByTestId("tab-thiet-ke").click();
  await expect(page.getByTestId("cay-phan-cap-twin")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[role="treeitem"]').first()).toBeVisible({ timeout: 20_000 });
}

/** Khoá của node đang giữ focus THẬT trong trình duyệt. */
async function khoaDangFocus(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const id = el.getAttribute("data-testid");
    return id?.startsWith("node-cay-") ? id.slice("node-cay-".length) : null;
  });
}

test.describe("Đợt 8 Lô B — #11 bàn phím cây trên trình duyệt THẬT", () => {
  test.beforeEach(async ({ page }) => {
    await dangNhap(page);
  });

  test("★★★ ARIA khai gì thì làm được đúng thế: có tabindex, và ĐÚNG MỘT hàng = 0", async ({
    page,
  }) => {
    await moCay(page);

    // Trước Đợt 8: `role=tree` + `role=treeitem` CÓ, `tabIndex` = 0 chỗ trong
    // toàn `twin3d/**`. Đây là phép đo trực tiếp lên lời khai đó.
    const do1 = await page.evaluate(() => {
      const hang = [...document.querySelectorAll('[role="treeitem"]')];
      return {
        soHang: hang.length,
        soCoTabindex: hang.filter((e) => e.hasAttribute("tabindex")).length,
        soTabindex0: hang.filter((e) => e.getAttribute("tabindex") === "0").length,
        coRoleTree: document.querySelectorAll('[role="tree"]').length,
      };
    });
    console.log(`[ĐO] ${JSON.stringify(do1)}`);

    expect(do1.coRoleTree).toBe(1);
    expect(do1.soHang).toBeGreaterThan(0);
    // Mọi hàng phải khai tabindex (không còn `<div onClick>` trần).
    expect(do1.soCoTabindex).toBe(do1.soHang);
    // ★★★ ROVING: đúng MỘT điểm dừng Tab cho cả cây.
    expect(do1.soTabindex0).toBe(1);
  });

  test("★★★ ↓ ↑ DI CHUYỂN FOCUS THẬT giữa các hàng", async ({ page }) => {
    await moCay(page);

    // Mở cây bằng ô lọc (đường đã dùng ở suite Đợt 4): lọc thì cây bung hết.
    await page.getByTestId("loc-cay").fill("SIM");
    await expect(page.locator('[role="treeitem"]').nth(2)).toBeVisible({ timeout: 15_000 });

    // Đưa focus vào hàng đầu bằng phím Tab THẬT — không gọi .focus() bằng JS.
    // Đây là điểm khác biệt lớn nhất với jsdom: nếu roving tabindex sai thì Tab
    // KHÔNG rơi vào cây và bài test này đỏ.
    await page.locator('[role="treeitem"]').first().focus();
    const dau = await khoaDangFocus(page);
    expect(dau, "Tab/focus không rơi vào một treeitem").not.toBeNull();

    await page.keyboard.press("ArrowDown");
    const sauXuong = await khoaDangFocus(page);
    console.log(`[ĐO] ↓ : ${dau} → ${sauXuong}`);
    expect(sauXuong).not.toBeNull();
    expect(sauXuong).not.toBe(dau);

    await page.keyboard.press("ArrowUp");
    const sauLen = await khoaDangFocus(page);
    console.log(`[ĐO] ↑ : ${sauXuong} → ${sauLen}`);
    // ↑ phải quay lại ĐÚNG hàng cũ — không phải "một hàng nào đó".
    expect(sauLen).toBe(dau);
  });

  test("★★★ → MỞ nhánh (DOM mọc thêm hàng), ← ĐÓNG lại", async ({ page }) => {
    await moCay(page);

    const dem = () => page.locator('[role="treeitem"]').count();
    const truoc = await dem();

    await page.locator('[role="treeitem"]').first().focus();
    await page.keyboard.press("ArrowRight"); // mở node gốc
    await expect
      .poll(dem, { timeout: 10_000, message: "→ không mở được nhánh" })
      .toBeGreaterThan(truoc);
    const sauMo = await dem();
    console.log(`[ĐO] → : ${truoc} hàng → ${sauMo} hàng`);

    // ← trên node ĐANG MỞ phải ĐÓNG nó lại.
    await page.keyboard.press("ArrowLeft");
    await expect.poll(dem, { timeout: 10_000 }).toBe(truoc);
    console.log(`[ĐO] ← : ${sauMo} hàng → ${await dem()} hàng`);
  });

  test("★★★ → trên node ĐÃ MỞ đi VÀO CON ĐẦU (hành vi APG)", async ({ page }) => {
    await moCay(page);

    await page.locator('[role="treeitem"]').first().focus();
    const goc = await khoaDangFocus(page);

    await page.keyboard.press("ArrowRight"); // lần 1: MỞ
    expect(await khoaDangFocus(page), "→ lần 1 không được đổi focus").toBe(goc);

    await page.keyboard.press("ArrowRight"); // lần 2: VÀO CON
    const con = await khoaDangFocus(page);
    console.log(`[ĐO] → ×2 : ${goc} (mở) → ${con} (con đầu)`);
    expect(con).not.toBe(goc);
    expect(con).not.toBeNull();
  });

  test("★★★ Home / End nhảy tới hàng ĐẦU và hàng CUỐI đang nhìn thấy", async ({ page }) => {
    await moCay(page);
    await page.getByTestId("loc-cay").fill("SIM");
    await expect(page.locator('[role="treeitem"]').nth(3)).toBeVisible({ timeout: 15_000 });

    await page.locator('[role="treeitem"]').first().focus();
    await page.keyboard.press("End");
    const cuoi = await khoaDangFocus(page);

    // ĐO ĐỘC LẬP: hàng cuối theo DOM, không hỏi mã.
    const cuoiTheoDom = await page.evaluate(() => {
      const h = [...document.querySelectorAll('[role="treeitem"]')];
      const el = h[h.length - 1];
      return el?.getAttribute("data-testid")?.slice("node-cay-".length) ?? null;
    });
    console.log(`[ĐO] End → ${cuoi} · hàng cuối theo DOM = ${cuoiTheoDom}`);
    expect(cuoi).toBe(cuoiTheoDom);

    await page.keyboard.press("Home");
    const dau = await khoaDangFocus(page);
    const dauTheoDom = await page.evaluate(
      () =>
        document
          .querySelector('[role="treeitem"]')
          ?.getAttribute("data-testid")
          ?.slice("node-cay-".length) ?? null,
    );
    console.log(`[ĐO] Home → ${dau} · hàng đầu theo DOM = ${dauTheoDom}`);
    expect(dau).toBe(dauTheoDom);
  });

  test("★★★ G18 — hàng nhận focus phải NẰM TRONG KHUNG NHÌN", async ({ page }) => {
    // "Có trong DOM" và "ở trong khung nhìn" là HAI đại lượng khác nhau (G7).
    // Một hàng focus nằm ngoài vùng cuộn = người dùng bàn phím mất con trỏ, và
    // không cổng nào khác thấy được.
    await moCay(page);
    await page.getByTestId("loc-cay").fill("SIM");
    await expect(page.locator('[role="treeitem"]').nth(3)).toBeVisible({ timeout: 15_000 });

    await page.locator('[role="treeitem"]').first().focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");

    const do2 = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      // Vùng cuộn của cây, không phải cả trang: hàng phải nằm trong Ô CÂY.
      const hop = el.closest('[role="tree"]')?.getBoundingClientRect();
      return {
        khoa: el.getAttribute("data-testid"),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        cao: Math.round(r.height),
        cayTop: hop ? Math.round(hop.top) : null,
        cayBottom: hop ? Math.round(hop.bottom) : null,
        innerHeight: window.innerHeight,
      };
    });
    console.log(`[ĐO] G18 ${JSON.stringify(do2)}`);

    expect(do2).not.toBeNull();
    // Hàng có kích thước THẬT (không phải phần tử 0px "tồn tại mà vô hình").
    expect(do2!.cao).toBeGreaterThan(0);
    // Nằm trong khung nhìn của trình duyệt.
    expect(do2!.top).toBeGreaterThanOrEqual(0);
    expect(do2!.bottom).toBeLessThanOrEqual(do2!.innerHeight);
    // Và nằm trong ô cuộn của cây (cây đã cuộn theo focus).
    if (do2!.cayTop !== null && do2!.cayBottom !== null) {
      expect(do2!.top).toBeGreaterThanOrEqual(do2!.cayTop - 1);
      expect(do2!.bottom).toBeLessThanOrEqual(do2!.cayBottom + 1);
    }
  });

  test("★★★ Enter CHỌN node — và lựa chọn nhìn thấy được (aria-selected)", async ({ page }) => {
    await moCay(page);
    await page.getByTestId("loc-cay").fill("SIM");
    const may = page.locator('[data-testid^="node-cay-machine:"]').first();
    await expect(may).toBeVisible({ timeout: 15_000 });

    await may.focus();
    const khoa = await khoaDangFocus(page);
    await page.keyboard.press("Enter");

    // Đo bằng ARIA (thứ trình đọc màn hình thấy), không bằng class CSS.
    await expect(page.locator(`[data-testid="node-cay-${khoa}"]`)).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 10_000 },
    );
    console.log(`[ĐO] Enter chọn ${khoa} · aria-selected=true`);
  });

  test("★ PHÍM LẠ không bị nuốt — Tab vẫn ra khỏi cây được", async ({ page }) => {
    // Nuốt mọi phím sẽ NHỐT người dùng bàn phím trong cây — lỗi trợ năng nặng
    // hơn hẳn lỗi #11 đang vá.
    await moCay(page);
    await page.locator('[role="treeitem"]').first().focus();
    expect(await khoaDangFocus(page)).not.toBeNull();

    await page.keyboard.press("Tab");
    const conTrongCay = await page.evaluate(
      () => document.activeElement?.getAttribute("role") === "treeitem",
    );
    console.log(`[ĐO] sau Tab, còn ở treeitem? ${conTrongCay}`);
    expect(conTrongCay).toBe(false);
  });
});
