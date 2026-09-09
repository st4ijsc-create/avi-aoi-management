import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ĐỢT 31 — NGHIỆM THU SỐNG MÀN **MÁY 3D RIÊNG** `/twin/may/:id` (`TwinMay.tsx`)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Đo trên `dist` (server 3030, `PLAYWRIGHT_BASE_URL`), viewport **1600×900** —
 * CÙNG điều kiện Đợt 30 để so được (`man-twin-line` đáy 900, 12 ô đáy 890).
 *
 * ★★★ bbox LÀ PHÉP ĐO QUYẾT ĐỊNH (G41): Đợt 30 có 12 ô trạm CÓ trong DOM, CÓ
 *   kích thước, mọi `toBeVisible()` XANH — và nằm dưới mép 900 px. Ở đây ta
 *   ghi bbox của khung, canvas, cockpit 2D, ngăn phải ra JSON rồi khẳng định
 *   **đáy ≤ viewport** — và ảnh tự chụp tự đọc (không tin `toBeVisible`).
 *
 * ★★★ G96 — chiều "bị chặn" KHÔNG đo được bằng tài khoản sẵn có (5/5 non-admin
 *   đều có `machine_status`). Dùng user TẠM `e2e_dot31_khongquyen` (0 hàng
 *   `permissions`), tạo/xoá bằng `.qa-dot31/user-tam.mjs`, đếm `users` trước/sau.
 *
 * ★★★ G76 — `operator1` có quyền (`machine_status`) nhưng **0 hàng
 *   `user_factory_assignments`**: nó chứng minh CỔNG ROUTE mở, còn thân màn
 *   phải NÓI RA "chưa được gán nhà máy" (L-5 `thieuQuyen`), không vẽ cảnh rỗng.
 *
 * ★ Ngăn `chuaDatCho` KHÔNG đo live được: SIM-FAC có 41 máy hoạt động và
 *   **41/41 đều có chỗ** (đo 2026-09-09). Nhánh ấy được ghim bằng lưới văn bản
 *   (`manMayNoiVaoTrang` ⑥); không tạo dữ liệu giả để "đo cho có" (DB gốc giữ
 *   nguyên 2 · 43 · 82).
 *
 * Ids đo được 2026-09-09 (không đoán):
 *   14  SIM-L2-AOI — SIM-FAC, chuyền 2, CÓ chỗ, sức khoẻ 61 (LOW) hôm nay ⇒ `canh`
 *   257 T12-SHOT-MC — nhà máy 18 ⇒ với `e2e_tai_loE` là `ngoaiPhamVi` (máy THẬT)
 */

const VIEWPORT = { width: 1600, height: 900 };
const ANH = ".qa-dot31";
const MAY = 14;
const MAY_NGOAI = 257;

const CO_DU_LIEU = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
const CHI_XEM = { username: "operator1", password: "User@123" };
const KHONG_QUYEN = { username: "e2e_dot31_khongquyen", password: "KhongQuyen!2026" };

/*
 * G86 — `createAuthLimiter` chặn 30 lượt đăng nhập / 15 phút / IP; 429 là
 * THIẾT BỊ ĐO, không nới. Đăng nhập MỘT lần mỗi vai, chạy TUẦN TỰ một worker.
 */
test.describe.configure({ mode: "serial" });
const PHIEN = new Map<string, string>();

async function dangNhap(page: Page, tk: { username: string; password: string }) {
  const daCo = PHIEN.get(tk.username);
  if (daCo) {
    await page.context().addCookies(JSON.parse(daCo));
    return;
  }
  const res = await page.request.post("/api/auth/login", { data: tk });
  expect(res.status(), `dang nhap ${tk.username}`).toBe(200);
  const me = await page.request.get("/api/auth/me");
  if (me.ok()) {
    const body = await me.json().catch(() => null);
    const ten = body?.username ?? body?.user?.username;
    if (ten) expect(ten, "phien phai dung vai vua dang nhap").toBe(tk.username);
  }
  PHIEN.set(tk.username, JSON.stringify(await page.context().cookies()));
}

interface Hop { x: number; y: number; w: number; h: number; day: number }
function bbox(page: Page, testId: string): Promise<Hop | null> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), day: Math.round(r.bottom) };
  }, testId);
}
function soCanvas(page: Page) {
  return page.evaluate(() => ({
    __soCanvas: (window as unknown as { __soCanvas?: number }).__soCanvas ?? null,
    canvasDom: document.querySelectorAll("canvas").length,
    drawCalls: (window as unknown as { __thongKeVe?: { calls?: number } }).__thongKeVe?.calls ?? null,
  }));
}

test.beforeAll(() => {
  fs.mkdirSync(ANH, { recursive: true }); // G65 — thư mục RIÊNG, không đụng test-results/
});
test.use({ viewport: VIEWPORT });

/* ════════════════════════════════════════════════════════════════════════ */
/* A — `e2e_tai_loE` (CÓ dữ liệu + CÓ quyền)                                 */
/* ════════════════════════════════════════════════════════════════════════ */

test("A1 — /twin/may/14: bbox trong viewport, 1 canvas, cockpit 2D + NganXuLy THẬT trong DOM", async ({ page }) => {
  test.setTimeout(120_000);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto(`/twin/may/${MAY}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-may"]', { timeout: 90_000 });
  await page.waitForSelector('[data-testid="khoi-canh-may"] canvas', { timeout: 60_000 });
  // Chờ cockpit 2D nạp xong tab (không phải "Loading cockpit…").
  await page.waitForSelector('[data-testid="cockpit-2d"] [role="tablist"]', { timeout: 60_000 });
  await page.waitForTimeout(6_000);

  const do_ = {
    manTwinMay: await bbox(page, "man-twin-may"),
    thanhTren: await bbox(page, "thanh-tren-may"),
    khoiCanh: await bbox(page, "khoi-canh-may"),
    chip: await bbox(page, "chip-may"),
    cockpit: await bbox(page, "cockpit-2d"),
    panelPhai: await bbox(page, "panel-phai-may"),
    nganXuLy: await bbox(page, "ngan-xu-ly"),
    canvas: await page.evaluate(() => {
      const c = document.querySelector('[data-testid="khoi-canh-may"] canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), day: Math.round(r.bottom) };
    }),
    soTab: await page.locator('[data-testid="cockpit-2d"] [role="tab"]').count(),
    // ★ Nhãn tên máy THẤY ĐƯỢC (lần đầu: camera quá gần ⇒ LopNhan ẩn nhãn, chip "1 more names hidden").
    soNhan: await page.locator('[data-testid="khoi-canh-may"] [data-testid="nhan-may-twin3d"]').count(),
    soNhanAn: await page.locator('[data-testid="khoi-canh-may"] [data-testid="chip-nhan-bi-an"]').count(),
    tenMay: await page.getByTestId("ten-may").innerText(),
    maMay: await page.getByTestId("ma-may").innerText(),
    loaiMay: await page.getByTestId("loai-may").innerText(),
    sucKhoe: await page.getByTestId("suc-khoe-may").innerText(),
    hang: await page.getByTestId("suc-khoe-may").getAttribute("data-hang"),
    trangThai: await page.getByTestId("trang-thai-may").getAttribute("data-trang-thai"),
    hrefLine: await page.getByTestId("ve-man-line").getAttribute("href"),
    theLine: await page.getByTestId("ve-man-line").evaluate((el) => el.tagName),
    nganMaMay: await page.getByTestId("ngan-ma-may").innerText().catch(() => null),
    ...(await soCanvas(page)),
    viewport: VIEWPORT,
  };
  fs.writeFileSync(`${ANH}/do-bbox-may.json`, JSON.stringify(do_, null, 2));
  await page.screenshot({ path: `${ANH}/A1-may-14.png`, fullPage: false });

  // ★★★ bbox — đáy ≤ viewport (G41), cảnh NHỎ có trần, cockpit là phần lớn.
  expect(do_.manTwinMay!.day, "khung man-twin-may tran khoi viewport").toBeLessThanOrEqual(VIEWPORT.height);
  expect(do_.cockpit!.day).toBeLessThanOrEqual(VIEWPORT.height);
  expect(do_.panelPhai!.day).toBeLessThanOrEqual(VIEWPORT.height);
  expect(do_.khoiCanh!.h).toBeGreaterThanOrEqual(320);
  expect(do_.khoiCanh!.h).toBeLessThanOrEqual(360);
  // ★★★ Canvas KHÔNG tràn khỏi khung (lần đầu: khung 306, canvas 320 ⇒ chui dưới header cockpit).
  expect(do_.canvas!.day).toBeLessThanOrEqual(do_.khoiCanh!.day);
  expect(do_.cockpit!.h, "cockpit 2D phai chiem phan lon cot trai").toBeGreaterThan(do_.khoiCanh!.h);
  expect(do_.panelPhai!.w).toBe(288);
  // ★★★ G87 — đúng MỘT canvas (cả bộ đếm KhungCanh lẫn DOM thật).
  expect(do_.__soCanvas).toBe(1);
  expect(do_.canvasDom).toBe(1);
  // ★★★ §15.6.1 (A): tên máy là 1/3 thứ neo — phải THẤY, không bị declutter ẩn.
  expect(do_.soNhan).toBeGreaterThanOrEqual(1);
  expect(do_.soNhanAn, "khong con chip 'N ten bi an'").toBe(0);
  // ★★★ Cockpit 2D THẬT SỰ render (G85: đo DOM, không tin testid trên cha).
  expect(do_.soTab).toBeGreaterThanOrEqual(10);
  expect(do_.nganXuLy).not.toBeNull();
  // Chip (B) và breadcrumb: mã/loại/sức khoẻ đúng máy 14; link sang màn Line 2 là <a>.
  expect(do_.maMay).toBe("SIM-L2-AOI");
  expect(do_.loaiMay).toBe("AOI");
  expect(do_.hrefLine).toBe("/twin/line/2");
  expect(do_.theLine).toBe("A");
  expect(["canh", "theo_doi", "nguy_kich", "khoe", "het_han", "chua_do"]).toContain(do_.hang);
});

test("A2 — /twin/may/257 (máy THẬT, nhà máy khác): màn NÓI RA `ngoaiPhamVi`, không cảnh rỗng câm", async ({ page }) => {
  test.setTimeout(90_000);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto(`/twin/may/${MAY_NGOAI}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="may-khong-mo-duoc"]', { timeout: 60_000 });
  await page.waitForTimeout(2_000);
  const lyDo = await page.getByTestId("may-khong-mo-duoc").getAttribute("data-ly-do");
  const canvas = await soCanvas(page);
  fs.writeFileSync(`${ANH}/do-ngoai-pham-vi.json`, JSON.stringify({ lyDo, ...canvas }, null, 2));
  await page.screenshot({ path: `${ANH}/A2-may-257-ngoai-pham-vi.png` });
  expect(lyDo).toBe("ngoaiPhamVi");
  expect(canvas.canvasDom, "khong con canvas nao khi man da noi ly do").toBe(0);
});

test("A3 — /twin/may/abc: id không hợp lệ ⇒ vỏ rẽ nhánh, KHÔNG canvas nào từng mount", async ({ page }) => {
  await dangNhap(page, CO_DU_LIEU);
  await page.goto("/twin/may/abc", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="may-id-khong-hop-le"]', { timeout: 60_000 });
  const canvas = await soCanvas(page);
  fs.writeFileSync(`${ANH}/do-id-xau.json`, JSON.stringify(canvas, null, 2));
  await page.screenshot({ path: `${ANH}/A3-id-xau.png` });
  expect(canvas.__soCanvas, "khong canvas nao tung mount => bo dem chua bao gio duoc ghi").toBeNull();
  expect(canvas.canvasDom).toBe(0);
});

test("A4 — breadcrumb `‹ Line` ĐI THẬT: từ máy 14 tới /twin/line/2 (màn Đợt 30)", async ({ page }) => {
  test.setTimeout(120_000);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto(`/twin/may/${MAY}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="ve-man-line"]', { timeout: 90_000 });
  await page.getByTestId("ve-man-line").click();
  await page.waitForSelector('[data-testid="man-twin-line"]', { timeout: 90_000 });
  await page.waitForTimeout(4_000);
  const canvas = await soCanvas(page);
  await page.screenshot({ path: `${ANH}/A4-ve-man-line-2.png` });
  expect(page.url()).toContain("/twin/line/2");
  // ★ Đổi màn = canvas cũ thu dọn, canvas mới dựng — vẫn ĐÚNG MỘT (G87 vì ROUTER).
  expect(canvas.__soCanvas).toBe(1);
  expect(canvas.canvasDom).toBe(1);
});

test("A5 — ★★★ G91 NỢ CÓ SẴN: bấm tab 3D của cockpit ⇒ 2 canvas DOM mà `__soCanvas` vẫn 1 (mù)", async ({ page }) => {
  test.setTimeout(120_000);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto(`/twin/may/${MAY}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="cockpit-2d"] [role="tablist"]', { timeout: 90_000 });
  await page.waitForSelector('[data-testid="khoi-canh-may"] canvas', { timeout: 60_000 });
  const truoc = await soCanvas(page);
  const tab3d = page.locator('[data-testid="cockpit-2d"] [role="tab"]').filter({ hasText: /3D/ });
  const coTab = (await tab3d.count()) > 0;
  let sau = truoc;
  if (coTab) {
    await tab3d.first().click();
    await page.waitForTimeout(5_000);
    sau = await soCanvas(page);
  }
  fs.writeFileSync(`${ANH}/do-tab-3d.json`, JSON.stringify({ coTab, truoc, sau }, null, 2));
  await page.screenshot({ path: `${ANH}/A5-tab-3d-cockpit.png` });
  expect(coTab, "cockpit co tab 3D (MachineCockpit.tsx:281)").toBe(true);
  /*
   * ★★★ Đây là phép đo GHI NỢ, không phải phép đo ĐẠT: 2 canvas DOM trong khi
   *   `__soCanvas` = 1 chứng minh bộ đếm RB-4 MÙ với drei `<Canvas>`. Nếu một
   *   ngày cockpit đi qua `KhungCanh`, ca này ĐỎ để người sửa cập nhật nợ.
   */
  expect(sau.canvasDom).toBe(2);
  expect(sau.__soCanvas).toBe(1);
});

/* ════════════════════════════════════════════════════════════════════════ */
/* B — HAI CHIỀU QUYỀN (QĐ-18/G43/G96)                                       */
/* ════════════════════════════════════════════════════════════════════════ */

test("B1 — operator1 (có `machine_status`, 0 nhà máy): QUA cổng route, thân NÓI `thieuQuyen` (L-5)", async ({ page }) => {
  test.setTimeout(90_000);
  await dangNhap(page, CHI_XEM);
  await page.goto(`/twin/may/${MAY}`, { waitUntil: "domcontentloaded" });
  // Cổng route MỞ: khung màn render (không phải thẻ "Không có quyền truy cập").
  await page.waitForSelector('[data-testid="man-twin-may"]', { timeout: 60_000 });
  await page.waitForSelector('[data-testid="may-khong-mo-duoc"]', { timeout: 60_000 });
  await page.waitForTimeout(2_000);
  const lyDo = await page.getByTestId("may-khong-mo-duoc").getAttribute("data-ly-do");
  const canvas = await soCanvas(page);
  const biChan = await page.locator("text=/Không có quyền truy cập|Access denied/").count();
  fs.writeFileSync(`${ANH}/do-operator1.json`, JSON.stringify({ lyDo, biChan, ...canvas }, null, 2));
  await page.screenshot({ path: `${ANH}/B1-operator1.png` });
  expect(biChan, "operator1 KHONG bi RouteGuard chan (cong /twin, QD-18)").toBe(0);
  /*
   * ★ KHÁC màn Line (cảnh rỗng, `__soCanvas`=1): màn Máy với người CHƯA ĐƯỢC GÁN
   *   nhà máy phải nói câu `thieuQuyen` của `cauChoLyDoNgan` — L-5 §15.3.3 bắt
   *   buộc dùng lại ba lý do, không cảnh rỗng câm. Canvas đã thu dọn ⇒ 0 DOM.
   */
  expect(lyDo).toBe("thieuQuyen");
  expect(canvas.canvasDom).toBe(0);
});

test("B2 — ★★★ user TẠM 0 quyền: RouteGuard CHẶN, 0 canvas, tRPC 403 `PERMISSION_DENIED` (G43)", async ({ page }) => {
  test.setTimeout(90_000);
  const loi403: Array<{ url: string; appCode: string | null }> = [];
  page.on("response", async (r) => {
    if (!r.url().includes("/api/trpc/") || r.status() !== 403) return;
    try {
      const j = await r.json();
      const ds = Array.isArray(j) ? j : [j];
      for (const x of ds) loi403.push({ url: r.url().slice(0, 120), appCode: x?.error?.json?.data?.appCode ?? x?.error?.data?.appCode ?? null });
    } catch {
      loi403.push({ url: r.url().slice(0, 120), appCode: null });
    }
  });
  await dangNhap(page, KHONG_QUYEN);
  await page.goto(`/twin/may/${MAY}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8_000);
  // ★ Ngôn ngữ giao diện của phiên là `en` ⇒ "Access denied" (en.json:13701); vi ⇒ "Không có quyền truy cập".
  const biChan = await page.locator("text=/Không có quyền truy cập|Access denied/").count();
  const manCo = await page.getByTestId("man-twin-may").count();
  const canvas = await soCanvas(page);
  // Dò thẳng một thủ tục của Twin bằng chính phiên này.
  const tho = await page.request.get(
    "/api/trpc/twinCanh.danhSachToaNha?input=" + encodeURIComponent(JSON.stringify({ json: { factoryId: 1 } })),
  );
  const thoBody = await tho.text();
  fs.writeFileSync(
    `${ANH}/do-khong-quyen.json`,
    JSON.stringify({ biChan, manCo, ...canvas, loi403, thoStatus: tho.status(), thoBody: thoBody.slice(0, 400) }, null, 2),
  );
  await page.screenshot({ path: `${ANH}/B2-khong-quyen.png` });
  expect(manCo, "man KHONG duoc render cho user 0 quyen").toBe(0);
  expect(biChan).toBeGreaterThanOrEqual(1);
  expect(canvas.canvasDom).toBe(0);
  // ★ G43 — đo appCode, không chỉ mã HTTP.
  expect(tho.status()).toBe(403);
  expect(thoBody).toContain("PERMISSION_DENIED");
});
