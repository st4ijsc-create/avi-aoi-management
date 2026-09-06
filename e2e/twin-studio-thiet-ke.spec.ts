import { test, expect, type Page } from "@playwright/test";

/**
 * e2e Đợt 4 — màn Thiết kế `/twin-studio` (§7).
 *
 * Suite này là THIẾT BỊ ĐO của bốn cổng ra mà unit test KHÔNG chạm tới được:
 *
 *   ★★★ RB-1 — gizmo HIỆN THẬT. `scene.add(controls)` (sai) và
 *       `scene.add(controls.getHelper())` (đúng) đều CHẠY ĐƯỢC và không ném lỗi
 *       nào; khác biệt duy nhất là có pixel hay không. Nên phép đo phải là ẢNH
 *       CHỤP cộng một cờ đọc được tên lớp thứ ĐÃ vào scene — hai mô hình rời.
 *   ★★★ RB-4 — `window.__soCanvas === 1`.
 *   ★   §4  — `window.__thongKeVe` ≤ 150 draw calls, ≤ 500.000 tam giác.
 *
 * ⚠ Suite này cần MÁY CHỦ CÓ THẬT và DB có dữ liệu (bài học `aoi-pha0`: "live
 *   cần máy CÓ THẬT"). Chạy: `npm run dev` rồi `npx playwright test
 *   e2e/twin-studio-thiet-ke.spec.ts`.
 */

/**
 * ★ Tài khoản RIÊNG cho e2e, KHÔNG dùng `admin`.
 *
 * Hai lý do, cả hai đã đo được:
 *  1. Luật G2 (§12.3) — không sửa tài nguyên DÙNG CHUNG khi có phiên khác chạy
 *     cùng nhánh. Đổi mật khẩu `admin` trên DB dev là đúng hình dạng đó.
 *  2. `admin` trên DB dev này có mật khẩu KHÁC `admin123` mà mọi script smoke
 *     trong repo đang giả định, và đăng nhập sai chỉ còn 3 lần trước khi khoá
 *     tài khoản (`users.lockedUntil`). Đoán mật khẩu ở đây là tự khoá mình.
 *
 * Tài khoản này tạo bằng script trong scratchpad (vai `admin`).
 *
 * ⚠ Vai `admin` BYPASS `requirePermission` (`accessControl.ts:207`), nên suite
 *   này KHÔNG đo được phân quyền — nó đo hành vi UI/3D. Phép đo quyền cho
 *   `/twin-studio` phải chạy bằng tài khoản không-admin và vẫn là món CÒN MỞ.
 */
const TAI_KHOAN = {
  username: process.env.E2E_TWIN_USER || "e2e_twin_dot4",
  password: process.env.E2E_TWIN_PASS || "E2eTwinDot4!2026",
};

/** Đăng nhập bằng API rồi mở trang — nhanh và không phụ thuộc bố cục form. */
async function dangNhap(page: Page) {
  const res = await page.request.post("/api/auth/login", { data: TAI_KHOAN });
  expect(res.ok(), `đăng nhập thất bại: ${res.status()}`).toBeTruthy();
}

/** Mở tab Thiết kế và chờ canvas dựng xong. */
async function moManThietKe(page: Page) {
  await page.goto("/twin-studio");
  await page.getByTestId("tab-thiet-ke").click();
  await expect(page.getByTestId("khoi-canh-3d")).toBeVisible({ timeout: 20_000 });
  // Chờ khung đầu tiên được VẼ, không chỉ chờ DOM: `frameloop="demand"` nghĩa
  // là canvas có thể đã mount mà chưa vẽ gì, và mọi số đo sẽ là 0.
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __thongKeVe?: { calls: number } };
      return (w.__thongKeVe?.calls ?? 0) > 0;
    },
    undefined,
    { timeout: 20_000 },
  );
}

test.describe("Twin Studio — màn Thiết kế Đợt 4", () => {
  test.beforeEach(async ({ page }) => {
    await dangNhap(page);
  });

  test("★★★ RB-4: đúng MỘT canvas sống", async ({ page }) => {
    await moManThietKe(page);
    const so = await page.evaluate(
      () => (window as unknown as { __soCanvas?: number }).__soCanvas ?? -1,
    );
    console.log(`[ĐO] window.__soCanvas = ${so}`);
    expect(so).toBe(1);
  });

  test("★★★ RB-1: gizmo dùng getHelper() và HIỆN trên màn hình", async ({ page }) => {
    await moManThietKe(page);

    // Chọn một máy trong cây để gizmo được gắn.
    //
    // ⚠ Cây MỞ MẶC ĐỊNH LÀ GẬP (chỉ hiện node xưởng), nên node máy chưa có
    //   trong DOM. Gõ vào ô lọc là đường mở nhanh nhất: `CayPhanCap` mở hết
    //   nhánh khi đang lọc, đúng để kết quả không nằm sau một mũi tên gập.
    await page.getByTestId("loc-cay").fill("SIM");
    const nodeMay = page.locator('[data-testid^="node-cay-machine:"]').first();
    await expect(nodeMay).toBeVisible({ timeout: 15_000 });
    await nodeMay.click();

    // ── Mô hình đo 1: cờ trong trang ──
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __gizmo?: { daGanHelper: boolean } };
        return w.__gizmo?.daGanHelper === true;
      },
      undefined,
      { timeout: 15_000 },
    );
    const gizmo = await page.evaluate(
      () =>
        (
          window as unknown as {
            __gizmo?: {
              daGanHelper: boolean;
              tenLopHelper: string;
              controlsLaObject3D: boolean;
            };
          }
        ).__gizmo,
    );
    console.log(`[ĐO] __gizmo = ${JSON.stringify(gizmo)}`);

    expect(gizmo?.daGanHelper).toBe(true);

    /*
     * ★★★ NỘI DUNG CHÍNH CỦA RB-1, đo bằng ba chỉ báo KHÔNG phụ thuộc tên lớp.
     *
     * ⚠⚠ ĐÍNH CHÍNH ĐO ĐƯỢC 2026-09-06 — chỉ báo ĐẦU TIÊN tôi chọn đã SAI.
     *   Bản đầu khẳng định `tenLopHelper === "TransformControlsRoot"`. Chạy trên
     *   `npm run build` cho ra `"Fj"`: minifier ĐỔI TÊN LỚP. Chỉ báo đó ĐỎ trên
     *   bản dựng ĐÚNG và XANH trên bản dev ⇒ nó đo BUNDLER, không đo RB-1.
     *   Đây đúng lớp lỗi mà luật G10 nói tới: "vi phạm X làm test Y đỏ" là LỜI
     *   KHAI CẦN ĐO. Ba chỉ báo dưới đây thay thế nó và đều bất biến với minify.
     */
    // 1. `controls` KHÔNG phải Object3D — chính là phát biểu của RB-1.
    expect(gizmo?.controlsLaObject3D).toBe(false);
    // 2. `getHelper()` trả về một Object3D THẬT.
    expect(gizmo?.helperLaObject3D).toBe(true);
    // 3. Helper ĐANG nằm trong scene graph. `scene.add(controls)` không bao giờ
    //    đạt được điều này — và đó là toàn bộ khác biệt giữa hiện và không hiện.
    expect(gizmo?.helperTrongScene).toBe(true);
    // 4. Helper có con (gizmo + plane) — helper rỗng thì không vẽ pixel nào.
    expect(gizmo?.soConHelper ?? 0).toBeGreaterThan(0);

    // ── Mô hình đo 2: PIXEL. Chụp ảnh để người đọc TỰ XEM. ──
    await page.waitForTimeout(800);
    const tk = await page.evaluate(
      () =>
        (window as unknown as { __thongKeVe?: { calls: number; triangles: number } })
          .__thongKeVe,
    );
    console.log(`[ĐO] sau khi gắn gizmo, __thongKeVe = ${JSON.stringify(tk)}`);
    // Gizmo là hình học THẬT trong scene: gắn nó vào phải làm số draw call TĂNG
    // so với cảnh trống. Nếu không tăng thì helper không được vẽ — tức đúng
    // triệu chứng của `scene.add(controls)`.
    expect(tk!.calls).toBeGreaterThan(2);

    await page.getByTestId("khoi-canh-3d").screenshot({
      path: "test-results/twin-studio-gizmo.png",
    });
  });

  test("★ §4: ngân sách vẽ ≤ 150 draw calls / ≤ 500.000 tam giác", async ({ page }) => {
    await moManThietKe(page);
    const tk = await page.evaluate(
      () =>
        (window as unknown as { __thongKeVe?: { calls: number; triangles: number } })
          .__thongKeVe,
    );
    console.log(`[ĐO] __thongKeVe = ${JSON.stringify(tk)}`);
    expect(tk).toBeTruthy();
    expect(tk!.calls).toBeLessThanOrEqual(150);
    expect(tk!.triangles).toBeLessThanOrEqual(500_000);
  });

  test("★ Dải sức khoẻ dữ liệu và Khu chờ xếp chỗ đều hiện (§7.1)", async ({ page }) => {
    await moManThietKe(page);
    await expect(page.getByTestId("dai-suc-khoe")).toBeVisible();
    await expect(page.getByTestId("khu-cho-xep-cho")).toBeVisible();
    const daXep = await page.getByTestId("sk-da-xep-cho").innerText();
    const choXep = await page.getByTestId("sk-cho-xep-cho").innerText();
    const chuaDo = await page.getByTestId("sk-chua-do").innerText();
    console.log(`[ĐO] dải sức khoẻ: ${daXep} | ${choXep} | ${chuaDo}`);
    // ★ NT-3.5: chưa tải xong hiện "—", KHÔNG hiện 0.
    expect(daXep).not.toBe("");
  });

  test("★ Ba vùng + thư viện asset dựng đủ (§7.1)", async ({ page }) => {
    await moManThietKe(page);
    await expect(page.getByTestId("cay-phan-cap-twin")).toBeVisible();
    await expect(page.getByTestId("vung-canvas")).toBeVisible();
    await expect(page.getByTestId("bang-thuoc-tinh")).toBeVisible();
    await expect(page.getByTestId("thu-vien-asset")).toBeVisible();
    await expect(page.getByTestId("thanh-can-chinh")).toBeVisible();
  });
});
