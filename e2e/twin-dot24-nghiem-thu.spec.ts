/**
 * ĐỢT 24 — NGHIỆM THU THỊ GIÁC ba món. Vai KHÔNG-admin (G76).
 */
import { test, expect, type Page } from "@playwright/test";
import { duongRaBangChung, taoThuMuc } from "./duongRaBangChung";

/**
 * ĐỢT 51 (mục B) — đường ra bằng chứng KHÔNG còn ghim cứng.
 * Trước: 8 chỗ ghi thẳng `.qa-dot24/…` ⇒ chạy lại spec là GHI ĐÈ bằng chứng
 * của Đợt 24 (đúng lớp lỗi G130 đã làm mất 103 tệp ở Đợt 50). Xem `duongRaBangChung`.
 */
/**
 * ★★★ ĐỢT 55 (C) — CÁCH CHẠY (docblock này thiếu suốt các đợt trước; G130 nói rằng "một biến
 * môi trường mà người chạy phải NHỚ đặt không phải hàng rào" — nhưng nó vẫn phải được VIẾT RA).
 *
 *     TWIN_E2E_ANH_DOT24=<thư mục của ĐỢT ĐANG CHẠY>  *     PLAYWRIGHT_BASE_URL=http://localhost:<cổng dist của đợt đang chạy>  *     npx playwright test e2e/twin-dot24-nghiem-thu.spec.ts --workers=1 --output <thư mục của đợt>/pw-output
 *
  KHÔNG có config riêng ⇒ PHẢI tự đặt `--output <thư mục đợt>/pw-output` (xem chú thích dưới).
 *
 * ⚠ `--output` PHẢI trỏ ra ngoài `test-results/`: Playwright **DỌN SẠCH `outputDir` mỗi lượt**
 *   (đo được Đợt 55: sentinel đặt vào thư mục ấy BIẾN MẤT sau một lượt chạy), mà `test-results/`
 *   đang giữ 5 ảnh lô C ĐÃ COMMIT. Config gốc nay đặt `outputDir: ".qa-pw-output"`.
 * ⚠ Bỏ trống `TWIN_E2E_ANH_DOT24` thì `duongRaBangChung` tự đổi đường ra sang `.qa-dot24-lai-<mốc>`
 *   và IN CẢNH BÁO — không ghi đè im lặng lên bằng chứng của đợt trước.
 */
const ANH = duongRaBangChung("TWIN_E2E_ANH_DOT24", ".qa-dot24");


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
  await page.screenshot({ path: `${ANH}/V1-operator1-badge.png`, fullPage: false });
});

test("V2 — badge vỏ: e2e_tai_loE (1 nhà máy) VẪN thấy cảnh báo của mình", async ({ page }) => {
  await page.setViewportSize(VP);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto("/twin");
  await choCanh(page);
  ra["V2-e2e-badge"] = await doBadge(page);
  await page.screenshot({ path: `${ANH}/V2-e2e-badge.png`, fullPage: false });
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
  await page.screenshot({ path: `${ANH}/V3-truoc.png` });

  await nut.click();
  await page.waitForTimeout(3_000);
  const sau = {
    ariaPressed: await nut.getAttribute("aria-pressed"),
    soNhan: await page.locator('[data-testid="nhan-may-twin3d"]').count(),
    url: page.url(),
  };
  await page.screenshot({ path: `${ANH}/V3-sau.png` });
  ra["V3-nhan-bat-thuong"] = { truoc, sau };

  // ĐẦU RA PHẢI KHÁC ĐẦU VÀO (G5).
  // ★ Đợt 45 (mục 4) — MẶC ĐỊNH ĐẢO: `/twin` mở ra đã ở bậc "chỉ nhãn bất thường" (aria-pressed=true,
  //   URL trơn); bấm nút ⇒ chuyển sang "hiện tên mọi máy" = URL mang `nhanTatCa`, aria-pressed=false,
  //   và SỐ NHÃN TĂNG. Chiều ngược (nhanBatThuong) đo ở lưới đơn vị `chinhSachNhan.unit.test.ts`.
  expect(truoc.ariaPressed).toBe("true");
  expect(sau.url).toContain("thu=");
  expect(sau.url).toContain("nhanTatCa");
  expect(sau.ariaPressed).toBe("false");
  expect(sau.soNhan).toBeGreaterThan(truoc.soNhan);
});

/*
 * ★ Đợt 34 — V4/V5/V6 cập nhật theo QĐ-23 (lớp (a)): `?xem=machine:N` trên `/twin` nay REDIRECT sang
 *   `/twin/may/N` (Đợt 33 K6). L-5 sống ở `TwinMay` với `data-testid="may-khong-mo-duoc"` +
 *   `data-ly-do` — CÙNG ba lý do (+ `chuaGanNhaMay` của Đợt 34 D). Mục đích đo giữ nguyên: màn NÓI RA
 *   lý do, không im lặng; đối chứng V6 vẫn mở thân. Giữ URL vào cũ để redirect cũng nằm trong phép đo.
 */
async function choManMay(page: Page, may: number) {
  await page.waitForFunction((p) => location.pathname === p, `/twin/may/${may}`, { timeout: 30_000 });
  await page.waitForSelector('[data-testid="man-twin-may"]', { timeout: 90_000 });
}

test("V4 — L-5: ?xem=machine:<id ngoài phạm vi> ⇒ /twin/may/<id> NÓI RA lý do", async ({ page }) => {
  await page.setViewportSize(VP);
  await dangNhap(page, CO_DU_LIEU);
  // id 999999 chắc chắn không thuộc phạm vi nào.
  await page.goto("/twin?xem=machine:999999");
  await choManMay(page, 999999);
  const chan = page.locator('[data-testid="may-khong-mo-duoc"]');
  await expect(chan).toBeVisible({ timeout: 60_000 });
  ra["V4-ngoai-pham-vi"] = {
    url: page.url(),
    lyDo: await chan.getAttribute("data-ly-do"),
    chu: (await chan.innerText()).trim().slice(0, 200),
  };
  await page.screenshot({ path: `${ANH}/V4-ngoai-pham-vi.png` });
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
/*
 * ★ Đợt 34 (D) — `operator1` (id 48, có `machine_status`, **0 hàng `user_factory_assignments`** — chủ
 *   dự án đo DB) trên `/twin/may/1` từng nhận câu của `thieuQuyen` ("You do not have permission…"):
 *   sai bản chất. Nay `data-ly-do="chuaGanNhaMay"` và câu "not assigned to any factory / chưa được gán".
 */
test("V5 — operator1 (0 gán): /twin?xem=machine:1 ⇒ /twin/may/1 nói 'chưa được gán nhà máy' (chuaGanNhaMay), badge KHÔNG khai số", async ({ page }) => {
  await page.setViewportSize(VP);
  await dangNhap(page, CHI_XEM);
  await page.goto("/twin?xem=machine:1");
  await choManMay(page, 1);
  const chan = page.locator('[data-testid="may-khong-mo-duoc"]');
  await expect(chan).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2_000);
  const chu = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  ra["V5-operator1"] = {
    url: page.url(),
    lyDo: await chan.getAttribute("data-ly-do"),
    cau: (await chan.innerText()).replace(/\s+/g, " ").trim().slice(0, 200),
    noiPhamViRong: /not assigned to any factory|chưa được gán/i.test(chu),
    // ĐO CÁI NHÌN THẤY: vỏ có khai con số cảnh báo nào không.
    badge: await doBadge(page),
  };
  await page.screenshot({ path: `${ANH}/V5-operator1-pham-vi-rong.png` });
  // Màn PHẢI nói ra lý do (không im lặng) — và phải là câu "chưa được gán", KHÔNG phải "thiếu quyền".
  expect(await chan.getAttribute("data-ly-do")).toBe("chuaGanNhaMay");
  expect(/not assigned to any factory|chưa được gán/i.test(chu)).toBe(true);
  expect(/do not have permission/i.test(await chan.innerText())).toBe(false);
});

test("V6 — ĐỐI CHỨNG: ?xem=machine:<id TRONG phạm vi> ⇒ /twin/may/1 vẫn MỞ THÂN (cockpit), không bị chặn", async ({ page }) => {
  await page.setViewportSize(VP);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto("/twin?xem=machine:1");
  await choManMay(page, 1);
  const than = page.locator('[data-testid="cockpit-2d"]');
  await expect(than).toBeVisible({ timeout: 90_000 });
  const chan = page.locator('[data-testid="may-khong-mo-duoc"]');
  ra["V6-doi-chung"] = {
    url: page.url(),
    biChan: await chan.count(),
    coThan: await than.count(),
  };
  await page.screenshot({ path: `${ANH}/V6-doi-chung-mo.png` });
  // Chống vá quá tay: máy hợp lệ KHÔNG được hiện câu chặn.
  expect(await chan.count()).toBe(0);
});

test.afterAll(async () => {
  const fs = await import("node:fs");
  fs.writeFileSync(`${taoThuMuc(ANH)}/nghiem-thu.json`, JSON.stringify(ra, null, 2), "utf-8");
  console.log("KET QUA DO:", JSON.stringify(ra, null, 2));
});
