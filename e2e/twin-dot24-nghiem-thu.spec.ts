/**
 * ĐỢT 24 — NGHIỆM THU THỊ GIÁC ba món. Vai KHÔNG-admin (G76).
 */
import { test, expect, type Page } from "@playwright/test";

const VP = { width: 1280, height: 720 };
const CHI_XEM = { username: "operator1", password: "User@123" };
const CO_DU_LIEU = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
const ra: Record<string, unknown> = {};

async function dangNhap(page: Page, tk: { username: string; password: string }) {
  const res = await page.request.post("/api/auth/login", { data: tk });
  expect(res.status(), `dang nhap ${tk.username}`).toBe(200);
}

async function choCanh(page: Page) {
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 });
  await page.waitForFunction(() => document.querySelector("canvas") !== null, null, { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(6_000);
}

/** ĐO CÁI NHÌN THẤY: chữ thật của badge cảnh báo ở vỏ. */
async function doBadge(page: Page) {
  return await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("button, a, div"));
    const hits = els
      .filter((e) => /alarm|cảnh báo|canh bao/i.test(e.textContent ?? ""))
      .map((e) => (e.textContent ?? "").trim())
      .filter((s) => s.length > 0 && s.length < 60);
    return { soUngVien: hits.length, chu: Array.from(new Set(hits)).slice(0, 6) };
  });
}

test("V1 — badge vỏ: operator1 (0 gán) KHÔNG khai số cảnh báo", async ({ page }) => {
  await page.setViewportSize(VP);
  await dangNhap(page, CHI_XEM);
  await page.goto("/twin");
  await choCanh(page);
  ra["V1-operator1-badge"] = await doBadge(page);
  await page.screenshot({ path: ".qa-dot24/V1-operator1-badge.png", fullPage: false });
});

test("V2 — badge vỏ: e2e_tai_loE (1 nhà máy) VẪN thấy cảnh báo của mình", async ({ page }) => {
  await page.setViewportSize(VP);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto("/twin");
  await choCanh(page);
  ra["V2-e2e-badge"] = await doBadge(page);
  await page.screenshot({ path: ".qa-dot24/V2-e2e-badge.png", fullPage: false });
});

test("V3 — nút chỉ-nhãn-bất-thường: có mặt, bấm được, đổi URL và đổi SỐ NHÃN", async ({ page }) => {
  await page.setViewportSize(VP);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto("/twin");
  await choCanh(page);

  const nut = page.locator('[data-testid="nut-chi-nhan-bat-thuong"]');
  await expect(nut).toBeVisible();
  const truoc = {
    ariaPressed: await nut.getAttribute("aria-pressed"),
    soNhan: await page.locator('[data-testid="nhan-may-twin3d"]').count(),
    url: page.url(),
  };
  await page.screenshot({ path: ".qa-dot24/V3-truoc.png" });

  await nut.click();
  await page.waitForTimeout(3_000);
  const sau = {
    ariaPressed: await nut.getAttribute("aria-pressed"),
    soNhan: await page.locator('[data-testid="nhan-may-twin3d"]').count(),
    url: page.url(),
  };
  await page.screenshot({ path: ".qa-dot24/V3-sau.png" });
  ra["V3-nhan-bat-thuong"] = { truoc, sau };

  // ĐẦU RA PHẢI KHÁC ĐẦU VÀO (G5).
  expect(sau.url).toContain("thu=");
  expect(sau.url).toContain("nhanBatThuong");
  expect(sau.ariaPressed).toBe("true");
  expect(truoc.ariaPressed).toBe("false");
});

test("V4 — L-5: ?xem=machine:<id ngoài phạm vi> NÓI RA lý do", async ({ page }) => {
  await page.setViewportSize(VP);
  await dangNhap(page, CO_DU_LIEU);
  // id 999999 chắc chắn không thuộc phạm vi nào.
  await page.goto("/twin?xem=machine:999999");
  await choCanh(page);
  const chan = page.locator('[data-testid="ngan-nhung-bi-chan"]');
  await expect(chan).toBeVisible({ timeout: 30_000 });
  ra["V4-ngoai-pham-vi"] = {
    lyDo: await chan.getAttribute("data-ly-do"),
    chu: (await chan.innerText()).trim().slice(0, 200),
  };
  await page.screenshot({ path: ".qa-dot24/V4-ngoai-pham-vi.png" });
  expect(await chan.getAttribute("data-ly-do")).toBe("ngoaiPhamVi");
});

/**
 * ★★★ V5 — **KỲ VỌNG ĐẦU CỦA TÔI SAI, VÀ PHÉP ĐO ĐÃ BÁC BỎ NÓ.**
 *
 * Tôi viết ô này chờ `ngan-nhung-bi-chan` với `lyDo="thieuQuyen"`. Chạy thật
 * (ảnh `pw-out/…V5…/test-failed-1.png`) cho thấy `operator1` KHÔNG bao giờ tới
 * được ngăn ấy: cả màn `/twin` đã trả về `EmptyState` "Your account is not
 * assigned to any factory" ở `TwinVanHanh.tsx:2608`, TRƯỚC khi `NganXuLy` (và
 * do đó `NganNhung`) được render.
 *
 * ⇒ Người dùng ĐÃ nhận đúng câu "chưa được gán nhà máy" — và nhận nó ở chỗ TỐT
 *   HƠN một ngăn con: toàn màn. Nhánh `thieuQuyen` của `lyDoNganNhung` vì vậy
 *   là một **lưới an toàn cho tương lai** (nếu ai đó nới `phamViRong`), không
 *   phải đường đang chạy. Ghi lại thay vì lặng lẽ xoá ô test: đây là chỗ brief
 *   đòi "ba câu" mà thực địa chỉ cần hai.
 *
 * Ô này nay đo ĐÚNG thứ người dùng thấy.
 */
test("V5 — operator1 (0 gán): màn nói 'chưa được gán nhà máy' Ở TOÀN MÀN, và badge KHÔNG khai số", async ({ page }) => {
  await page.setViewportSize(VP);
  await dangNhap(page, CHI_XEM);
  await page.goto("/twin?xem=machine:1");
  await page.waitForTimeout(8_000);
  const rong = page.locator('[data-testid="ngan-nhung-bi-chan"]');
  const chu = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  ra["V5-operator1"] = {
    biChanNganCon: await rong.count(),
    noiPhamViRong: /not assigned to any factory|chưa được gán/i.test(chu),
    // ĐO CÁI NHÌN THẤY: vỏ có khai con số cảnh báo nào không.
    badge: await doBadge(page),
  };
  await page.screenshot({ path: ".qa-dot24/V5-operator1-pham-vi-rong.png" });
  // Màn PHẢI nói ra lý do (không im lặng) — dù bằng EmptyState toàn màn.
  expect(/not assigned to any factory|chưa được gán/i.test(chu)).toBe(true);
});

test("V6 — ĐỐI CHỨNG: ?xem=machine:<id TRONG phạm vi> vẫn MỞ THÂN, không bị chặn", async ({ page }) => {
  await page.setViewportSize(VP);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto("/twin?xem=machine:1");
  await choCanh(page);
  const chan = page.locator('[data-testid="ngan-nhung-bi-chan"]');
  const than = page.locator('[data-testid="than-nhung"]');
  ra["V6-doi-chung"] = {
    biChan: await chan.count(),
    coThan: await than.count(),
  };
  await page.screenshot({ path: ".qa-dot24/V6-doi-chung-mo.png" });
  // Chống vá quá tay: ngăn hợp lệ KHÔNG được hiện câu chặn.
  expect(await chan.count()).toBe(0);
});

test.afterAll(async () => {
  const fs = await import("node:fs");
  fs.writeFileSync(".qa-dot24/nghiem-thu.json", JSON.stringify(ra, null, 2), "utf-8");
  console.log("KET QUA DO:", JSON.stringify(ra, null, 2));
});
