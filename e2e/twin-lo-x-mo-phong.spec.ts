import { expect, test, type Page } from "@playwright/test";

/**
 * Lô X — nghiệm thu THỊ GIÁC ngăn "Mô phỏng" (§11 #30 what-if + #35 phát lại).
 *
 * ★ G10b — chạy trên `dist` ĐÃ DỰNG (`node dist/index.js`, NODE_ENV=production).
 * ★ G65 — outputDir riêng `.qa-loX/`, KHÔNG đụng `test-results/` (5 tệp lô C).
 * ★ G41 — bảng phải `z-30`; nhãn drei ở z-index 20. Chỉ ẢNH bắt được lỗi "hiện
 *   ra đủ mà đọc không được", nên mỗi ca đều chụp và người làm phải TỰ ĐỌC ảnh.
 * ★ G5/G6 — mỗi ca có ca DƯƠNG đi kèm: một trang trắng (chưa đăng nhập) cũng
 *   cho "không thấy X", nên phải chứng minh trang ĐÃ nạp trước khi kết luận.
 */

const TAI_KHOAN = {
  username: process.env.E2E_TAI_USER || "e2e_tai_loE",
  password: process.env.E2E_TAI_PASS || "E2eTaiLoE!2026",
};

async function dangNhap(page: Page) {
  const res = await page.request.post("/api/auth/login", { data: TAI_KHOAN });
  expect(res.status(), "dang nhap non-admin").toBe(200);
}

test("X1 — ngan Mo phong HIEN tren canh, doc duoc, va khai LY DO honest-null", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await dangNhap(page);
  // `pv=line:1` — chuyen 1 la chuyen DUY NHAT co ban ghi line_balance tren DB nay.
  await page.goto("/twin?pv=line:1", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(12_000);

  const ngan = page.getByTestId("ngan-mo-phong");

  // ── Ca DUONG: trang da nap that (canh 3D + bang KPI cua lo J deu co mat).
  //    Thieu phan nay thi mot trang trang cung cho "ngan khong hien" -> G5.
  await expect(page.getByTestId("bang-kpi-noi"), "ca duong: bang KPI lo J phai hien").toBeVisible({
    timeout: 90_000,
  });

  // ── Ngan Mo phong PHAI hien, va PHAI dang mo (vang mat trong `thu=` = mo).
  await expect(ngan, "ngan Mo phong phai hien").toBeVisible({ timeout: 60_000 });
  await expect(ngan).toHaveAttribute("data-mo", "1");

  // ── G41: doc z-index THAT tu trinh duyet, khong suy tu class.
  const z = await ngan.evaluate((el) => getComputedStyle(el as HTMLElement).zIndex);
  console.log(`   [X1] z-index ngan Mo phong = ${z} (phai > 20, nhan drei o 20)`);
  expect(Number(z), "z-index phai tren nhan drei (20)").toBeGreaterThan(20);

  // ── G41 phan hai: ngan KHONG duoc nuot chuot cua canvas.
  const pe = await ngan.evaluate((el) => getComputedStyle(el as HTMLElement).pointerEvents);
  console.log(`   [X1] pointer-events khung ngoai = ${pe} (phai 'none')`);
  expect(pe, "khung ngoai phai pointer-events:none").toBe("none");

  // ── HONEST-NULL: tren DB nay khong co nhip con han => phai co LY DO, khong so 0.
  const chayDuoc = await ngan.getAttribute("data-chay-duoc");
  const lyDo = await ngan.getAttribute("data-ly-do");
  console.log(`   [X1] chay-duoc=${chayDuoc} ly-do=${lyDo}`);

  if (chayDuoc === "0") {
    const oLyDo = page.getByTestId("mo-phong-ly-do");
    await expect(oLyDo, "phai hien LY DO doc duoc, khong phai o trong").toBeVisible();
    const chu = (await oLyDo.innerText()).trim();
    console.log(`   [X1] cau ly do hien tren man: "${chu}"`);
    // Phai co dau '—' (honest-null) va mot CAU, khong phai so 0.
    expect(chu, "honest-null phai in dau gach ngang").toContain("—");
    expect(chu.length, "phai co mot cau giai thich, khong phai o trong").toBeGreaterThan(10);
    expect(chu, "KHONG duoc hien so 0 thay cho chua-do-duoc").not.toMatch(/(^|\s)0(\s|$)/);

    /*
     * ★★★ RO RI I18N — o nay them SAU khi ANH TU CHUP bat duoc "(17 ngay ago)".
     *   `nhanTuoi` ban dau tra chuoi tieng Viet CUNG, roi ghep vao khuon tieng
     *   Anh "{{tuoi}} ago". `tsc` xanh, 36 luoi xanh, 3 ca Playwright xanh — vi
     *   khong o nao hoi *chuoi nay thuoc ngon ngu nao*. Phien nay chay bang
     *   locale EN (xem anh: "us English"), nen chu Viet o day la LOI.
     */
    expect(chu, "khong duoc tron chu tieng Viet vao ban EN").not.toMatch(/ngày|giờ|phút/);
  }

  await ngan.screenshot({ path: ".qa-loX/X1-ngan-mo-phong.png" });
  await page.screenshot({ path: ".qa-loX/X1-toan-man.png" });
});

test("X2 — `?thu=moPhong` THU ngan lai, va khu hoi qua URL (G40)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await dangNhap(page);
  await page.goto("/twin?pv=line:1&thu=moPhong", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(12_000);

  const ngan = page.getByTestId("ngan-mo-phong");
  await expect(ngan, "vo ngan van hien (chi than bi thu)").toBeVisible({ timeout: 90_000 });

  // ── Ca AM: than ngan phai BI THU. Neu `moPhong` khong nam trong
  //    PANEL_THU_DUOC thi `docThu` NUOT no va ngan van mo — hong CAM (G67).
  await expect(ngan, "?thu=moPhong phai THU ngan").toHaveAttribute("data-mo", "0");
  const than = page.locator("#than-ngan-mo-phong");
  await expect(than, "than phai an").toBeHidden();

  // ── Ca DUONG: bam nut mo lai => than hien, VA URL mat `moPhong`.
  await page.getByTestId("nut-thu-mo-phong").click();
  await page.waitForTimeout(1_500);
  await expect(ngan, "bam mo => data-mo=1").toHaveAttribute("data-mo", "1");
  await expect(than, "than phai hien lai").toBeVisible();
  const url = page.url();
  console.log(`   [X2] URL sau khi mo lai = ${url}`);
  expect(url, "khoa thu= phai bo 'moPhong' khi mo").not.toContain("thu=moPhong");

  await page.screenshot({ path: ".qa-loX/X2-sau-khi-mo-lai.png" });
});

test("X3 — #35 phat lai: chon workflow THAT => Gantt co thanh, nut buoc DOI moc", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await dangNhap(page);
  await page.goto("/twin?pv=line:1", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(12_000);

  const ngan = page.getByTestId("ngan-mo-phong");
  await expect(ngan).toBeVisible({ timeout: 90_000 });

  const chon = page.getByTestId("chon-workflow");
  const coChon = await chon.count();
  console.log(`   [X3] bo chon workflow co mat = ${coChon}`);

  if (coChon === 0) {
    // Thieu quyen `machine_monitoring/canView` => muc #35 AN ca. Do la DUNG
    // luat an-khong-disable; ghi ra de nguoi doc bao cao biet vi sao.
    const rong = await page.getByTestId("phat-lai-rong").count();
    console.log(`   [X3] muc #35 AN (thieu quyen) hoac rong=${rong} — ghi nhan, khong phai loi`);
    await page.screenshot({ path: ".qa-loX/X3-phat-lai-an.png" });
    return;
  }

  // ── Ca DUONG: bo chon phai co workflow THAT (DB co 5 hang).
  const soLuaChon = await chon.locator("option").count();
  console.log(`   [X3] so lua chon (ke ca dong trong) = ${soLuaChon}`);
  expect(soLuaChon, "phai co it nhat 1 workflow that").toBeGreaterThan(1);

  const ref = await chon.locator("option").nth(1).getAttribute("value");
  console.log(`   [X3] chon workflowRef = ${ref}`);
  await chon.selectOption(ref!);
  await page.waitForTimeout(8_000);

  const gantt = page.getByTestId("phat-lai-gantt");
  await expect(gantt, "Gantt phai hien sau khi chon").toBeVisible({ timeout: 60_000 });
  const soThanh = await gantt.locator("li").count();
  console.log(`   [X3] so buoc tren Gantt = ${soThanh}`);
  expect(soThanh, "phai co it nhat 1 buoc").toBeGreaterThan(0);

  // ── MOI thanh phai co be rong > 0: buoc 0 ms (hitl_gate) van phai THAY DUOC.
  const rong = await gantt.locator('[data-testid^="gantt-"]').evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).getBoundingClientRect().width),
  );
  console.log(`   [X3] be rong tung thanh (px) = ${JSON.stringify(rong)}`);
  expect(Math.min(...rong), "khong thanh nao duoc rong 0 px").toBeGreaterThan(0);

  // ── CHE DO: 4/5 workflow that gom TOAN `hitl_gate` (gateMs mac dinh 0) nen
  //    totalDurationMs = 0. Ngan phai chuyen sang che do BUOC va NOI RA, chu
  //    khong in "0.0s / 0.0s" — cau do doc y het "workflow rong".
  const oMoc = page.getByTestId("phat-lai-moc");
  const cheDo = await oMoc.getAttribute("data-che-do");
  const chuMoc = (await oMoc.innerText()).trim();
  console.log(`   [X3] che do = ${cheDo}, nhan moc = "${chuMoc}"`);

  if (cheDo === "buoc") {
    // Khong duoc in "0.0s" cho mot workflow co buoc that.
    expect(chuMoc, "che do BUOC khong duoc in giay").not.toContain("0.0s");
    await expect(
      page.getByTestId("phat-lai-khong-thoi-luong"),
      "phai NOI RA vi sao khong co giay",
    ).toBeVisible();
    const chuVi = (await page.getByTestId("phat-lai-khong-thoi-luong").innerText()).trim();
    console.log(`   [X3] cau giai thich: "${chuVi}"`);
    expect(chuVi.length).toBeGreaterThan(10);
  }

  // ── Nut buoc phai DOI moc (G32: f(x)=x thi nut khong lam gi).
  //    Truoc ban va lo X, o nay DO tren 4/5 workflow that: moi `startMs` deu 0
  //    nen tap bien gop ve [0] va nut chet. 1.694 luoi don vi deu mu.
  const mocTruoc = await oMoc.innerText();
  await page.getByTestId("nut-toi-buoc").click();
  await page.waitForTimeout(800);
  const mocSau = await oMoc.innerText();
  console.log(`   [X3] moc truoc="${mocTruoc}" sau="${mocSau}"`);
  expect(mocSau, "bam Toi buoc PHAI doi moc").not.toBe(mocTruoc);

  // ── Va thanh Gantt phai PHAN ANH moc do (hai ham cung mot che do, G12).
  const soDangChay = await page.locator('[data-dang-chay="1"]').count();
  console.log(`   [X3] so thanh dang-chay sau khi bam = ${soDangChay} (ky vong 1)`);
  expect(soDangChay, "dung MOT thanh sang len theo moc").toBe(1);

  await ngan.screenshot({ path: ".qa-loX/X3-gantt-phat-lai.png" });
  await page.screenshot({ path: ".qa-loX/X3-toan-man.png" });
});
