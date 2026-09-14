import { test, expect, type Page } from "@playwright/test";

/**
 * ============================================================================
 * LÔ F (Đợt 10) — NGHIỆM THU F1/F2/F3/F4 TRÊN TRÌNH DUYỆT THẬT
 * ============================================================================
 *
 * ⚠ CHẠY BẰNG TÀI KHOẢN KHÔNG-ADMIN. Admin bypass `requirePermission`, nên một
 *   phép đo quyền bằng admin chứng minh SỐ 0 (bài học Khối D).
 *
 * ⚠ G34: `preserveDrawingBuffer=false` ⇒ tổng pixel = 0 trông y hệt canvas
 *   trống. Cửa kiểm sống là `__thongKeVe.calls > 0`, không phải ảnh chụp.
 *
 * Dữ liệu cần: `npx tsx scripts/sinh-tai-twin.ts` (FUYU-F, 549 máy / 3 tầng).
 * Phân bố đo được 2026-09-07: tầng 50 = 176 · 51 = 192 · 52 = 181 máy.
 * Bản CŨ khai "373 máy chưa xếp chỗ" = 192 + 181 (§11e.6 dòng #3).
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
  await page.waitForTimeout(2_500);
}

/** Đọc thẳng DOM — `locator.textContent()` treo hết timeout khi phần tử vắng. */
async function docBanner(page: Page) {
  return page.evaluate(() => {
    const q = (id: string) => document.querySelector(`[data-testid='${id}']`);
    const ds = q("banner-doi-soat");
    const ngoai = q("banner-ngoai-luot-nap");
    const ha = q("banner-ha-cap");
    return {
      doiSoat: ds?.textContent?.trim() ?? null,
      ngoaiLuotNap: ngoai ? Number(ngoai.getAttribute("data-so")) : null,
      moiToaDaHoi: ngoai?.getAttribute("data-moi-toa-da-hoi") ?? null,
      haCap: ha ? { yeuCau: ha.getAttribute("data-cap-yeu-cau"), thuc: ha.getAttribute("data-cap-thuc") } : null,
      demMay: q("dem-may")?.textContent?.trim() ?? null,
      breadcrumb: q("breadcrumb-twin")?.textContent?.trim() ?? null,
    };
  });
}

test.describe.configure({ mode: "serial" });

test.describe("Lo F — nghiem thu F1/F2/F3/F4", () => {
  test("F1 — BA o chon ton tai va DOI DUOC (truoc: 0 <select> trong ca man)", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await moTwin(page);

    const dem = await page.evaluate(() => {
      const root = document.querySelector("[data-testid='man-twin-van-hanh']");
      const oTang = document.querySelector("[data-testid='chon-tang']") as HTMLSelectElement | null;
      return {
        select: root?.querySelectorAll("select").length ?? -1,
        soTang: oTang ? oTang.options.length : -1,
        tangDangChon: oTang?.value ?? null,
      };
    });
    console.log(`\n[F1] <select> trong man = ${dem.select} (lo E do duoc: 0)`);
    console.log(`     o chon Tang co ${dem.soTang} muc, dang chon = ${dem.tangDangChon}`);
    expect(dem.select).toBeGreaterThanOrEqual(3);
    expect(dem.soTang).toBeGreaterThanOrEqual(3);

    // ★ ĐỔI TẦNG PHẢI ĐỔI THẬT (G32: đầu ra khác đầu vào), VÀ VÀO URL.
    const truoc = await docBanner(page);
    const oTang = page.getByTestId("chon-tang");
    const giaTriMoi = await page.evaluate(() => {
      const s = document.querySelector("[data-testid='chon-tang']") as HTMLSelectElement;
      return [...s.options].map((o) => o.value).find((v) => v !== s.value) ?? "";
    });
    await oTang.selectOption(giaTriMoi);
    await page.waitForTimeout(3_000);
    const sau = await docBanner(page);
    const url = new URL(page.url());
    console.log(`     URL sau khi doi tang = ?${url.searchParams.toString()}`);
    console.log(`     ngoaiLuotNap truoc=${truoc.ngoaiLuotNap} sau=${sau.ngoaiLuotNap}`);
    expect(url.searchParams.get("tang")).toBe(giaTriMoi);

    // ★ TẢI LẠI GIỮ NGUYÊN LỰA CHỌN — "chia sẻ / tải lại được".
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("man-twin-van-hanh")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(3_000);
    const sauTai = await page.evaluate(
      () => (document.querySelector("[data-testid='chon-tang']") as HTMLSelectElement | null)?.value ?? null,
    );
    console.log(`     sau reload, o chon Tang = ${sauTai} (mong doi ${giaTriMoi})`);
    expect(sauTai).toBe(giaTriMoi);
  });

  test("F2 — banner KHONG con khai '373 may chua xep cho'", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await moTwin(page);
    const b = await docBanner(page);
    console.log(`\n[F2] banner doi soat        = ${b.doiSoat}`);
    console.log(`     so may ngoai luot nap  = ${b.ngoaiLuotNap} (moiToaDaHoi=${b.moiToaDaHoi})`);
    console.log(`     dem-may                = ${b.demMay}`);
    // Câu "N máy chưa xếp chỗ" chỉ được nói về máy THẬT SỰ chưa có chỗ.
    if (b.doiSoat) {
      const so = Number((b.doiSoat.match(/(\d+)\s*m[aá]y/i) ?? [])[1] ?? "0");
      console.log(`     -> so may khai 'chua xep cho' = ${so}`);
      expect(so).toBeLessThan(373);
    }
  });

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * ★★★ F3 — ĐO LẠI 2026-09-07: LỜI KHAI LÔ E **SAI**, VÀ BẢN NGHIỆM THU NÀY
   *     TRƯỚC ĐÓ ĐÒI ĐÚNG CÁI HÀNH VI SAI
   * ══════════════════════════════════════════════════════════════════════════
   * Bản trước của test này khẳng định `expect(b.haCap).not.toBeNull()` — tức
   * ĐÒI màn phải hạ cấp `tapDoan → nhaMay`. Đo lại trên DB thật cho thấy đòi hỏi
   * đó SAI, và test sẽ ĐỎ trên một hệ đang chạy ĐÚNG:
   *
   *   `e2e_tai_loE` id=21075 role=**supervisor** (không-admin)
   *   `user_factory_assignments` → `factoryCode=['SIM-FAC']` → `factoryIds=[1]`
   *   ⇒ `factory.list` trả **1** nhà máy ⇒ `factories.length === 1`
   *   ⇒ `phamViThuc(tapDoan, 1, 1).daHaCap === false` — "Tập đoàn = 1 nhà máy"
   *     là câu **ĐÚNG**, không có gì để hạ.
   *
   * Lô E nhìn thấy "chỉ 1 nhà máy" và gọi đó là lỗi phạm vi. Thực ra đó là
   * **hàng rào tenant đang làm đúng việc của nó** (`resolveTenantFactoryScope`,
   * `server/db/reportAggregators.ts`): vai không-admin chỉ thấy nhà máy được gán.
   *
   * ⚠ BẪY BG-127 mà phép đo này suýt dính: câu đếm đầu viết `a."factoryId"` —
   *   cột đó KHÔNG TỒN TẠI. Bảng chiếu qua **MÃ** (`factoryCode`), không qua id.
   *   Postgres báo 42703 nên nó nổ; nếu lược đồ tình cờ có cột tên `factoryId`
   *   thì phép đo đã im lặng cho ra "0 nhà máy được gán" — số SAI mà xanh.
   *
   * ⇒ Test này giờ đo theo SỐ NHÀ MÁY TÀI KHOẢN THẬT SỰ THẤY, thay vì khoá cứng
   *   một kết cục — cách duy nhất để nó còn đúng khi ai đó gán thêm nhà máy.
   */
  test("F3 — ?pv=tapdoan khai dung theo SO NHA MAY TAI KHOAN THAT SU THAY", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await moTwin(page, "/twin?pv=tapdoan");
    // ★ Nguon so nha may = CHINH endpoint man dung. Mot phep dem rieng (vd doc
    //   thang DB) tao NGUON SU THAT THU HAI va hai ben se lech nhau (G12).
    const soNhaMay = await page.evaluate(async () => {
      const dsSelect = document.querySelector("[data-testid='chon-nha-may']");
      const n = dsSelect?.getAttribute("data-so-muc");
      return n === null || n === undefined ? -1 : Number(n);
    });
    const b = await docBanner(page);
    console.log(`\n[F3] o chon nha may co = ${soNhaMay} muc (tai khoan ${TAI_KHOAN.username})`);
    console.log(`     breadcrumb   = "${b.breadcrumb}"`);
    console.log(`     dem-may      = ${b.demMay}`);
    console.log(`     banner ha cap= ${JSON.stringify(b.haCap)}`);
    expect(soNhaMay).toBeGreaterThan(0);
    if (soNhaMay <= 1) {
      // Hang rao tenant chay dung: "Tap doan" la cau DUNG, KHONG duoc ha cap.
      expect(b.haCap).toBeNull();
    } else {
      // Nhieu nha may ma chi nap 1 ⇒ PHAI ha cap va khai ro.
      expect(b.haCap).not.toBeNull();
      expect(b.haCap?.yeuCau).toBe("tapDoan");
      expect(b.haCap?.thuc).toBe("nhaMay");
    }
  });

  test("F4 — kich thuoc canvas o 1280x720", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await moTwin(page);
    const co = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      const r = c?.getBoundingClientRect();
      return {
        w: Math.round(r?.width ?? 0),
        h: Math.round(r?.height ?? 0),
        vw: window.innerWidth,
        vh: window.innerHeight,
        calls: (window as unknown as { __thongKeVe?: { calls: number } }).__thongKeVe?.calls ?? 0,
      };
    });
    const tiLe = ((co.w * co.h) / (co.vw * co.vh)) * 100;
    console.log(
      `\n[F4] canvas ${co.w}x${co.h} tren viewport ${co.vw}x${co.vh} = ${tiLe.toFixed(1)}% man hinh` +
        `\n     (lo E do duoc: 360x473 = ~13%)  draw calls = ${co.calls}`,
    );
    // ★ G34 — cua kiem SONG: canvas co ve that, khong phai mot the trong.
    expect(co.calls).toBeGreaterThan(0);
  });
});
