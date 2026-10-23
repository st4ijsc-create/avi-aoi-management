/**
 * Đợt 9 — e2e Flow Studio (instance riêng, `_test`, KHÔNG GPU/OT):
 *   1. "Chạy thử node" trên bản nháp CHƯA LƯU: node lõi chạy thật (kết quả ngay tại node); node HTTP chỉ XEM TRƯỚC; DB không có lượt nào.
 *   2. So sánh hai lượt: bước giống/khác, đường dẫn JSON khác nhau, lượt trùng ⇒ "giống hệt".
 *   3. Form node OT: biểu ngữ MÔ PHỎNG, không nút nào trong form, chạy thử không bao giờ "đã gửi".
 *   4. Bật luồng hạng `ot`: nút "Bật" mở hộp OTP (step-up) và gọi `flow.batLuongOt` (không phải `datPhienBanHoatDong`);
 *      mã sai ⇒ luồng vẫn TẮT trong CSDL.
 * Chỉ chạy bằng `npx playwright test --config=playwright.flowstudio.config.ts` (globalSetup dựng instance + dữ liệu, đặt FS_E2E=1).
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { FLOW_OT, FLOW_SO_SANH, FLOW_THU, withTestDb, type FsFixture } from "./flow-studio/fixtures";

test.skip(process.env.FS_E2E !== "1", "FS e2e chạy riêng dưới playwright.flowstudio.config.ts");
test.describe.configure({ mode: "serial" });

/** Ảnh nghiệm thu (không bắt buộc): FS_SHOT_DIR=đường-dẫn ⇒ chụp màn hình chạy thử node / so sánh lượt / form OT. */
const chup = async (page: Page, ten: string) => {
  if (process.env.FS_SHOT_DIR) await page.screenshot({ path: `${process.env.FS_SHOT_DIR}/${ten}.png`, fullPage: false });
};

let fx: FsFixture;
let base = "";

test.beforeAll(() => {
  fx = JSON.parse(fs.readFileSync(process.env.FS_STATE!, "utf8")) as FsFixture;
  base = process.env.FS_BASE_URL!;
});

async function dangNhap(page: Page, ai: { username: string; password: string } = fx.admin, ngonNgu = "vi"): Promise<void> {
  await page.context().addInitScript((lng) => {
    try { localStorage.setItem("i18nextLng", lng); } catch { /* */ }
  }, ngonNgu);
  const r = await page.context().request.post(`${base}/api/auth/login`, { data: { username: ai.username, password: ai.password } });
  expect(r.ok(), `login: ${r.status()}`).toBe(true);
}

async function moTrinhSua(page: Page, flowId: string, query = ""): Promise<void> {
  await page.goto(`${base}/ai-flows/${flowId}${query}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("bang-node")).toBeVisible();
}

const demHang = (flowId: string) =>
  withTestDb(async (sql) => {
    const [r] = await sql`SELECT
      (SELECT count(*)::int FROM ai_flow_runs WHERE "flowId" = ${flowId}) AS runs,
      (SELECT count(*)::int FROM ai_flow_queue q JOIN ai_flow_runs r ON r.id = q."runId" WHERE r."flowId" = ${flowId}) AS hang_doi,
      (SELECT count(*)::int FROM ai_flow_waits w JOIN ai_flow_runs r ON r.id = w."runId" WHERE r."flowId" = ${flowId}) AS cho`;
    return r as unknown as { runs: number; hang_doi: number; cho: number };
  });

test("1 — chạy thử MỘT node trên bản nháp chưa lưu: node lõi chạy thật, HTTP chỉ xem trước, không tạo lượt", async ({ page }) => {
  await dangNhap(page);
  const truoc = await demHang(FLOW_THU);
  await moTrinhSua(page, FLOW_THU);

  // node lõi: du-lieu.dat — thêm lên canvas (CHƯA lưu), đặt trường gap = x*2
  await page.getByTestId("them-du-lieu.dat").click();
  await page.getByTestId("dat-them-truong").click();
  await page.getByTestId("dat-ten-0").fill("gap");
  await page.getByTestId("dat-gia-tri-0").fill("{{ $json.x * 2 }}");
  await expect(page.getByText("Chưa lưu").first()).toBeVisible();
  await page.getByTestId("chay-thu-items-main").fill('[{"json":{"x":21}}]');
  const phanHoi = page.waitForResponse((r) => decodeURIComponent(r.url()).includes("flow.chayThuNut") && r.ok());
  await page.getByTestId("nut-chay-thu-nut").click();
  await phanHoi;
  const kq = page.getByTestId("ket-qua-chay-thu");
  await expect(kq).toHaveAttribute("data-che", "chay");
  await expect(kq).toHaveAttribute("data-ok", "1");
  await expect(page.getByTestId("chay-thu-ra-main")).toContainText('"gap": 42');
  await expect(page.getByTestId("chay-thu-ra-main")).toContainText('"x": 21');

  await kq.scrollIntoViewIfNeeded();
  await chup(page, "1-chay-thu-node");

  // biểu thức hỏng ⇒ lỗi hiện NGAY tại node, không ném
  await page.getByTestId("dat-gia-tri-0").fill("{{ 1 + }}");
  await page.getByTestId("nut-chay-thu-nut").click();
  await expect(page.getByTestId("ket-qua-chay-thu")).toHaveAttribute("data-ok", "0");
  await expect(page.getByTestId("chay-thu-loi")).toBeVisible();

  // node có tác dụng ra ngoài: HTTP gửi ⇒ chỉ XEM TRƯỚC (không chạy)
  await page.getByTestId("them-tich-hop.http-gui").click();
  await expect(page.getByTestId("node-config")).toContainText("tich-hop.http-gui");
  await page.getByTestId("nut-chay-thu-nut").click();
  await expect(page.getByTestId("ket-qua-chay-thu")).toHaveAttribute("data-che", "xem-truoc");
  await expect(page.getByTestId("chay-thu-tham-so")).toContainText("POST");
  await page.getByTestId("ket-qua-chay-thu").scrollIntoViewIfNeeded();
  await chup(page, "1b-http-xem-truoc");

  // CSDL: không có lượt / hàng đợi / hàng chờ nào được tạo
  expect(await demHang(FLOW_THU)).toEqual(truoc);
});

test("2 — so sánh hai lượt: bước giống/khác, đường dẫn JSON, lượt trùng ⇒ giống hệt", async ({ page }) => {
  await dangNhap(page);
  await moTrinhSua(page, FLOW_SO_SANH, `?run=${fx.runA}`);
  await page.getByTestId("nut-so-sanh-luot").click();
  await expect(page.getByTestId("so-sanh-luot")).toBeVisible();
  await page.getByTestId("so-sanh-a").selectOption(fx.runA);
  await page.getByTestId("so-sanh-b").selectOption(fx.runB);

  await expect(page.getByTestId("so-sanh-tom-tat")).toContainText("1 bước giống · 1 khác · 0 chỉ ở A · 0 chỉ ở B", { timeout: 60_000 });
  await expect(page.getByTestId("so-sanh-buoc-t")).toHaveAttribute("data-ket", "giong");
  const dat = page.getByTestId("so-sanh-buoc-dat");
  await expect(dat).toHaveAttribute("data-ket", "khac");
  await expect(dat).toContainText("$.main[0].json.a"); // đầu vào khác
  await expect(dat).toContainText("xong"); // trạng thái A
  await expect(dat).toContainText("loi"); // trạng thái B
  await expect(dat).toContainText("Δ +5000 ms"); // 1s → 6s
  await expect(page.getByTestId("so-sanh-tom-tat")).toContainText("Trạng thái lượt khác nhau");

  await chup(page, "2-so-sanh-luot");

  // cùng một lượt hai bên ⇒ giống hệt
  await page.getByTestId("so-sanh-a").selectOption(fx.runB);
  await expect(page.getByTestId("so-sanh-tom-tat")).toContainText("Hai lượt giống hệt nhau.");
});

test("3 — form node OT: MÔ PHỎNG, không nút nào trong form, chạy thử không bao giờ 'đã gửi'", async ({ page }) => {
  await dangNhap(page);
  await moTrinhSua(page, FLOW_OT);

  for (const loai of ["ot.doc-tag", "ot.de-xuat-lenh", "ot.de-xuat-luong"]) {
    await page.getByTestId(`them-${loai}`).click();
    await expect(page.getByTestId("node-config")).toContainText(loai);
    await expect(page.getByTestId("ot-mo-phong")).toContainText("MÔ PHỎNG");
    // form OT chỉ có ô nhập — không có nút (kể cả "gửi")
    await expect(page.getByTestId("form-ot").locator("button")).toHaveCount(0);
  }

  await chup(page, "3a-form-ot");

  // đề xuất lệnh: chạy thử ⇒ hoặc yêu cầu chờ duyệt MÔ PHỎNG, hoặc bị Cổng AI từ chối; không có dấu hiệu đã gửi
  await page.getByTestId("them-ot.de-xuat-lenh").click();
  await page.getByTestId("ot-may").fill(String(fx.machineId));
  await page.getByTestId("ot-lenh").fill("pause");
  await page.getByTestId("nut-chay-thu-nut").click();
  const kq = page.getByTestId("ket-qua-chay-thu");
  await expect(kq).toBeVisible();
  await expect(kq).toHaveAttribute("data-che", "chay");
  const chu = (await kq.innerText()) + (await kq.evaluate((e) => e.textContent ?? ""));
  expect(chu).not.toMatch(/"daGui":\s*true/);
  await kq.scrollIntoViewIfNeeded();
  await chup(page, "3b-form-ot-chay-thu");
  // máy là SỐ (không phải chuỗi "999999"): cổng không còn từ chối vì sai kiểu ⇒ đề xuất chờ duyệt MÔ PHỎNG, KHÔNG gửi
  await expect(kq).toHaveAttribute("data-ok", "1");
  await expect(page.getByTestId("chay-thu-cho")).toContainText(/MÔ PHỎNG/);
  await expect(page.getByTestId("chay-thu-cho")).toContainText("mô phỏng", { ignoreCase: true });
});

test("4 — bật luồng hạng OT: hộp OTP step-up, gọi flow.batLuongOt (không phải datPhienBanHoatDong); mã sai ⇒ luồng vẫn TẮT", async ({ page }) => {
  await dangNhap(page);
  const goi: string[] = [];
  page.on("request", (r) => {
    const u = decodeURIComponent(r.url());
    if (u.includes("/api/trpc/") && /flow\.(batLuongOt|datPhienBanHoatDong)/.test(u)) goi.push(`${/flow\.(\w+)/.exec(u)![1]} ${r.postData() ?? ""}`);
  });
  await moTrinhSua(page, FLOW_OT);
  await expect(page.getByTestId("flow-hang")).toContainText("OT");

  await page.getByTestId("nut-bat").click();
  await expect(page.getByTestId("stepup-mode")).toHaveAttribute("data-mode", "required");
  expect(goi, "chưa có lời gọi bật nào trước khi nhập OTP").toEqual([]);

  await page.keyboard.type("000000"); // onComplete ⇒ gửi
  await expect.poll(() => goi.length, { timeout: 20_000 }).toBe(1);
  expect(goi[0]).toMatch(/^batLuongOt /);
  expect(goi[0]).toContain("totpCode");
  expect(goi.some((g) => g.startsWith("datPhienBanHoatDong"))).toBe(false);

  // mã sai / chưa đăng ký 2FA ⇒ máy chủ từ chối ⇒ luồng vẫn TẮT
  await expect(page.getByTestId("flow-trang-thai-bat")).not.toContainText("Đang bật", { timeout: 10_000 });
  const [f] = await withTestDb((sql) => sql`SELECT enabled, "activeVersion" FROM ai_flows WHERE id = ${FLOW_OT}`);
  expect(f.enabled).toBe(false);
});

test("5 — dòng thời gian hiện MODEL THỰC của node AI; node rơi dự phòng vì khe nặng bận có nhãn + lý do", async ({ page }) => {
  await dangNhap(page);
  await moTrinhSua(page, FLOW_SO_SANH, `?run=${fx.runA}`);
  await expect(page.getByTestId("buoc-dat")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("model-thuc-dat")).toHaveText("Qwen3-Khe-Nang-30B");
  await expect(page.getByTestId("du-phong-dat")).toHaveCount(0);
  await chup(page, "5a-model-thuc");

  await moTrinhSua(page, FLOW_SO_SANH, `?run=${fx.runB}`);
  await expect(page.getByTestId("buoc-dat")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("model-thuc-dat")).toHaveText("Qwen3-4B-Instruct-2507-UD-Q4_K_XL");
  const nhan = page.getByTestId("du-phong-dat");
  await expect(nhan).toHaveAttribute("data-khe-ban", "1");
  await expect(nhan).toContainText("khe nặng đang giữ model khác");
  await expect(page.getByTestId("buoc-model-dat").locator("div").first()).toHaveAttribute("title", /khe-dang-giu-model-khac/);
  await chup(page, "5b-du-phong-khe-ban");
});

test("6 — tạo luồng MỚI: kỹ sư NHIỀU nhà máy phải chọn nhà máy; một nhà máy ⇒ không hỏi, máy chủ tự gán; luồng gán đúng nhà máy", async ({ page }) => {
  await dangNhap(page, fx.nhieu);
  await page.goto(`${base}/ai-flows`);
  await page.getByTestId("nut-tao-luong").click();
  await page.getByTestId("ten-luong-moi").fill("Luồng nhiều nhà máy");
  const chon = page.getByTestId("chon-nha-may");
  await expect(chon).toBeVisible();
  await expect(chon.locator("option")).toHaveCount(3); // "— chọn nhà máy —" + 2 nhà máy
  await expect(page.getByTestId("xac-nhan-tao")).toBeDisabled(); // chưa chọn ⇒ không cho tạo
  await chup(page, "6a-chon-nha-may");
  await chon.selectOption(String(fx.nhaMayB.id));
  await expect(page.getByTestId("xac-nhan-tao")).toBeEnabled();
  await page.getByTestId("xac-nhan-tao").click();
  await page.waitForURL(/\/ai-flows\/(?!duyet)[^/]+$/, { timeout: 30_000 });
  const id = decodeURIComponent(page.url().split("/").pop()!);
  const [f] = await withTestDb((sql) => sql`SELECT "factoryId" FROM ai_flows WHERE id = ${id}`);
  expect(f.factoryId).toBe(fx.nhaMayB.id);

  // kỹ sư MỘT nhà máy: không có ô chọn; luồng tự gán nhà máy ấy
  const ctx2 = await page.context().browser()!.newContext();
  const p2 = await ctx2.newPage();
  await ctx2.addInitScript(() => {
    try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ }
  });
  const r = await ctx2.request.post(`${base}/api/auth/login`, { data: { username: fx.mot.username, password: fx.mot.password } });
  expect(r.ok()).toBe(true);
  await p2.goto(`${base}/ai-flows`);
  await p2.getByTestId("nut-tao-luong").click();
  await p2.getByTestId("ten-luong-moi").fill("Luồng một nhà máy");
  await expect(p2.getByTestId("chon-nha-may")).toHaveCount(0);
  await p2.getByTestId("xac-nhan-tao").click();
  await p2.waitForURL(/\/ai-flows\/(?!duyet)[^/]+$/, { timeout: 30_000 });
  const id2 = decodeURIComponent(p2.url().split("/").pop()!);
  const [f2] = await withTestDb((sql) => sql`SELECT "factoryId" FROM ai_flows WHERE id = ${id2}`);
  expect(f2.factoryId).toBe(fx.nhaMayA.id);
  await ctx2.close();
});

test("7 — bí mật: cột host cho phép; bí mật cũ báo 'chưa khai'; admin khai host; tạo mới BẮT BUỘC có host", async ({ page }) => {
  await dangNhap(page);
  await page.goto(`${base}/ai-flows`);
  const o = page.getByTestId("host-fse2e-bm-cu");
  await expect(o).toBeVisible({ timeout: 60_000 });
  await expect(o).toContainText("Chưa khai");
  await chup(page, "7a-bi-mat-chua-khai-host");

  // tạo mới: thiếu host ⇒ nút Tạo bị khoá
  const khoi = page.getByTestId("khoi-bi-mat");
  await khoi.getByRole("textbox").nth(0).fill("fse2e-bm-moi");
  await khoi.getByRole("textbox").nth(1).fill("Bí mật mới");
  await khoi.locator('input[type="password"]').fill("gia-tri-bi-mat-1234");
  await expect(khoi.getByRole("button", { name: "Tạo" })).toBeDisabled();
  await page.getByTestId("bi-mat-host").fill("dich.gia");
  await expect(khoi.getByRole("button", { name: "Tạo" })).toBeEnabled();

  // khai host cho bí mật cũ
  await page.getByTestId("sua-host-fse2e-bm-cu").click();
  await page.getByTestId("sua-host-o").fill("Erp.Nha-May.vn, api.mes.vn");
  await page.getByTestId("luu-host").click();
  await expect(o).toContainText("erp.nha-may.vn, api.mes.vn", { timeout: 20_000 });
  const [h] = await withTestDb((sql) => sql`SELECT "hostChoPhep" FROM ai_flow_credentials WHERE id = 'fse2e-bm-cu'`);
  expect(h.hostChoPhep).toEqual(["erp.nha-may.vn", "api.mes.vn"]);
  await chup(page, "7b-bi-mat-da-khai-host");
});

test("8 — lỗi phạm vi hiện bằng EN: luồng không có/ngoài phạm vi ⇒ MỘT câu chung đã dịch (không khoá thô); chưa gán nhà máy ⇒ báo trước và vô hiệu nút Tạo", async ({ page }) => {
  await dangNhap(page, fx.mot, "en");
  await page.goto(`${base}/ai-flows/fse2e-khong-ton-tai`);
  const loi = page.locator("p.text-destructive").first();
  await expect(loi).toBeVisible({ timeout: 60_000 });
  const chu = (await loi.innerText()).trim();
  expect(chu).toContain("doesn't exist or doesn't belong to your factory");
  expect(chu).not.toMatch(/errors\.|flowKhongTonTai|Không/); // không khoá thô, không tiếng Việt
  await chup(page, "8a-loi-pham-vi-en");

  const ctx2 = await page.context().browser()!.newContext();
  const p2 = await ctx2.newPage();
  await ctx2.addInitScript(() => {
    try { localStorage.setItem("i18nextLng", "en"); } catch { /* */ }
  });
  const r = await ctx2.request.post(`${base}/api/auth/login`, { data: { username: fx.khong.username, password: fx.khong.password } });
  expect(r.ok()).toBe(true);
  await p2.goto(`${base}/ai-flows`);
  await p2.getByTestId("nut-tao-luong").click();
  await p2.getByTestId("ten-luong-moi").fill("Luồng không nhà máy");
  const canhBao = p2.getByTestId("chua-gan-nha-may");
  await expect(canhBao).toBeVisible({ timeout: 30_000 });
  await expect(canhBao).toContainText("isn't assigned to any factory");
  await expect(p2.getByTestId("xac-nhan-tao")).toBeDisabled();
  await ctx2.close();
});

test("9 — Trung tâm Model: bảng lượt đo đánh dấu hồ sơ ĐANG GÁN; form đổi gán đặt số đo cạnh nhau; hồ sơ chưa đo ⇒ nút gán active bị vô hiệu kèm lý do", async ({ page }) => {
  await dangNhap(page, fx.admin, "en");
  await page.goto(`${base}/ai-gguf-models`);
  const trungTam = page.getByTestId("trung-tam-model");
  await expect(trungTam).toBeVisible({ timeout: 60_000 });

  // (1) tab Đo: các lượt của e2e, hàng của hồ sơ đang gán có nhãn, kèm vai trò + mã commit + n×lượt
  await trungTam.getByRole("tab", { name: "Evaluation" }).click();
  const bang = page.getByTestId("bang-luot-do");
  const hangGan = bang.locator(`tr[data-profile="fse2e-ho-so-gan"]`);
  const hangTot = bang.locator(`tr[data-profile="fse2e-ho-so-tot"]`);
  await expect(hangGan).toHaveAttribute("data-dang-gan", "1");
  await expect(hangGan.getByTestId("dang-gan")).toBeVisible();
  await expect(hangGan).toContainText("7/10×1 (70 %)");
  await expect(hangGan).toContainText("code.plc");
  await expect(hangGan).toContainText("aaaaaaa11");
  await expect(hangTot).toHaveAttribute("data-dang-gan", "0");
  await expect(hangTot).toContainText("9/10×3 (90 %)");
  if (process.env.FS_SHOT_DIR) await trungTam.screenshot({ path: `${process.env.FS_SHOT_DIR}/9a-luot-do.png` });

  // (2) tab Vai trò & gán → form Đặt gán
  await trungTam.getByRole("tab", { name: "Roles & bindings" }).click();
  const form = page.getByTestId("form-dat-gan");
  await form.locator('select[name="roleId"]').selectOption("code.plc");
  await form.locator('select[name="loaiDich"]').selectOption("profile");
  await form.locator('select[name="dich"]').selectOption("fse2e-ho-so-tot");
  const soDo = page.getByTestId("so-do-canh-nhau");
  await expect(soDo).toContainText("plc-st-v1");
  await expect(page.getByTestId("so-do-hienTai")).toContainText("7/10×1 (70 %)");
  await expect(page.getByTestId("so-do-dich")).toContainText("9/10×3 (90 %)");
  await expect(page.getByTestId("ket-qua-so-sanh")).toHaveAttribute("data-ket-qua", "hon");
  if (process.env.FS_SHOT_DIR) await trungTam.screenshot({ path: `${process.env.FS_SHOT_DIR}/9b-so-canh-nhau.png` });

  // hồ sơ CHƯA ĐO: chế độ active ⇒ nút vô hiệu + lý do; chế độ 'trial' ⇒ cho gán
  await form.locator('select[name="dich"]').selectOption("fse2e-ho-so-chua-do");
  await form.locator('select[name="mode"]').selectOption("active");
  await expect(form.getByRole("button", { name: "Set binding" })).toBeDisabled();
  await expect(page.getByTestId("ly-do-chan-gan")).toContainText("has no eval run yet");
  if (process.env.FS_SHOT_DIR) await trungTam.screenshot({ path: `${process.env.FS_SHOT_DIR}/9c-chua-do-vo-hieu.png` });
  await form.locator('select[name="mode"]').selectOption("thu");
  await expect(form.getByRole("button", { name: "Set binding" })).toBeEnabled();
});

test("10 — trợ lý lập trình: nhãn kiểm biên dịch ST (AI giả qua SSE) — 'đã tự sửa K lỗi' + xem bản đầu + khối 'Bản đã sửa sau biên dịch'; còn lỗi ⇒ liệt kê", async ({ page }) => {
  await dangNhap(page, fx.admin, "en");
  const sse = (...su: object[]) => su.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const FB_SAI = "FUNCTION_BLOCK A\n  y := x AND ;\nEND_FUNCTION_BLOCK";
  const kich = {
    daSua: sse(
      { type: "meta", intent: "general", language: "en", confidence: 1, citations: [] },
      { type: "token", token: "Here is the block.\n```st\n" + FB_SAI + "\n```" },
      { type: "kiem_bien_dich", phase: "dang-kiem" },
      { type: "kiem_bien_dich", phase: "xong", ketQua: { trangThai: "da-sua", lyDo: null, phuongNgu: "st", soVong: 1, soLoiDaSua: 2, chanDoan: [], cauTraLoiDau: "```st\n" + FB_SAI + "\n```", msThem: 900 } },
      { type: "token", token: "\n\n---\n**Version corrected after compiling** — Auto-fixed 2 compile error(s) (RuSTy) after 1 round(s).\n\n```st\nFUNCTION_BLOCK A\n  y := x;\nEND_FUNCTION_BLOCK\n```" },
      { type: "done", provider: "ollama", cached: false, followUpSuggestions: [], answer: "", structured: {} },
    ),
    conLoi: sse(
      { type: "meta", intent: "general", language: "en", confidence: 1, citations: [] },
      { type: "token", token: "Another block.\n```st\n" + FB_SAI + "\n```" },
      { type: "kiem_bien_dich", phase: "xong", ketQua: { trangThai: "con-loi", lyDo: null, phuongNgu: "st", soVong: 2, soLoiDaSua: 0, chanDoan: [{ tep: "mã", dong: 2, cot: 14, ma: "E007", thongDiep: "Unexpected token ';'" }], cauTraLoiDau: null, msThem: 1200 } },
      { type: "done", provider: "ollama", cached: false, followUpSuggestions: [], answer: "", structured: {} },
    ),
  };
  let luot = 0;
  await page.route("**/api/ai/local-kb/stream", async (route) => {
    const body = luot++ === 0 ? kich.daSua : kich.conLoi;
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }, body });
  });
  await page.goto(`${base}/ai-coding-workspace`);
  const o = page.locator("textarea").last();
  await expect(o).toBeVisible({ timeout: 60_000 });

  await o.fill("write a PLC function block");
  await o.press("Enter");
  const the = page.getByTestId("kiem-bien-dich");
  await expect(the).toBeVisible({ timeout: 30_000 });
  await expect(the).toHaveAttribute("data-trang-thai", "da-sua");
  await expect(the).toContainText("Auto-fixed 2 compile error(s) (RuSTy) after 1 round(s)"); // nhãn do CLIENT dựng (en), không khoá thô
  await expect(page.getByText("Version corrected after compiling")).toBeVisible(); // khối bổ sung trong chat
  await page.getByTestId("kiem-bien-dich-xem-dau").click();
  const banDau = page.getByTestId("kiem-bien-dich-ban-dau");
  await expect(banDau).toContainText("y := x AND ;");
  // render bằng khối mã của chat (không phải markdown thô): có khối code-block, không còn chữ rào ```
  await expect(banDau.locator('[data-streamdown="code-block"]')).toHaveCount(1);
  await expect(banDau.locator('[data-streamdown="code-block"] .animate-spin')).toHaveCount(0, { timeout: 45_000 });
  expect(await banDau.innerText()).not.toContain("```");
  // Khối mã trong chat do Streamdown vẽ, bộ tô màu cú pháp TẢI LƯỜI (Suspense + spinner): chờ nó xong rồi mới chụp / khẳng định có mã thật.
  const khoiMa = page.locator('[data-streamdown="code-block"]');
  await expect(khoiMa.first()).toBeVisible();
  await expect(page.locator('[data-streamdown="code-block"] .animate-spin')).toHaveCount(0, { timeout: 45_000 });
  await expect(khoiMa.filter({ hasText: "y := x;" })).toHaveCount(1); // khối "đã sửa" hiện mã đúng, không kẹt spinner
  await expect(khoiMa.first()).toContainText("y := x AND ;"); // khối đầu (bản sai) cũng hiện mã
  await banDau.scrollIntoViewIfNeeded();
  if (process.env.FS_SHOT_DIR) await page.screenshot({ path: `${process.env.FS_SHOT_DIR}/10a-da-sua.png` });

  await o.fill("another one");
  await o.press("Enter");
  await expect(the).toHaveAttribute("data-trang-thai", "con-loi", { timeout: 30_000 });
  await expect(page.getByTestId("kiem-bien-dich-loi")).toContainText("mã:2:14 error[E007]: Unexpected token ';'");
  expect(await the.innerText()).not.toMatch(/repoWs\.|kiemBienDich/); // không khoá thô
  if (process.env.FS_SHOT_DIR) await page.screenshot({ path: `${process.env.FS_SHOT_DIR}/10b-con-loi.png` });
});

test("11 — tác nhân theo VAI TRÒ (AI giả qua SSE): dòng 'Running <model> · role code.plc' + nhãn dự phòng; mã từ chối 503 AI_KHONG_CO_MODEL hiện câu EN đã dịch", async ({ page }) => {
  await dangNhap(page, fx.admin, "en");
  const sse = (...su: object[]) => su.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  let luot = 0;
  await page.route("**/api/ai/agent/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    luot += 1;
    if (luot === 1) {
      // cờ AI_AGENT_THEO_VAI_TRO bật: bat-dau mang model + vai trò (nguồn dự phòng ⇒ nhãn)
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        body: sse(
          { loai: "bat-dau", runId: "run-fs-1", cheDo: "duyet", model: { vaiTro: "code.plc", model: "Qwen3.6-27B-UD-Q4_K_XL", nguon: "du-phong", bangChung: "dự án PLC (.st/.scl); khe đang giữ model khác" } },
          { loai: "chu", noiDung: "Done." },
          { loai: "xong", lyDo: "hoan-thanh", tomTat: "ok" },
        ),
      });
      return;
    }
    // lượt 2: bị từ chối TRƯỚC khi có lượt chạy (không SSE) — thân JSON y như server
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, code: "AI_KHONG_CO_MODEL", message: "raw server text" }) });
  });
  await page.goto(`${base}/ai-coding-workspace`);
  await page.getByRole("radio", { name: /step-by-step approval/i }).click();
  const o = page.locator("textarea").last();
  await expect(o).toBeVisible({ timeout: 60_000 });

  await o.fill("write a PLC function block");
  await o.press("Enter");
  const dong = page.getByTestId("agent-model-bat-dau");
  await expect(dong).toBeVisible({ timeout: 30_000 });
  await expect(dong).toHaveAttribute("data-vai-tro", "code.plc");
  await expect(dong).toContainText("Qwen3.6-27B-UD-Q4_K_XL · role code.plc (PLC project)");
  await expect(page.getByTestId("agent-model-du-phong")).toContainText("fallback");
  expect(await dong.innerText()).not.toMatch(/repoWs\.|modelBatDau/); // không khoá thô
  if (process.env.FS_SHOT_DIR) await page.screenshot({ path: `${process.env.FS_SHOT_DIR}/11a-model-bat-dau.png` });

  await expect(page.getByTestId("agent-trang-thai")).toHaveCount(0, { timeout: 30_000 }); // lượt 1 đã xong
  await o.fill("second request");
  await o.press("Enter");
  const khung = page.getByTestId("agent-dong-thoi-gian");
  await expect(khung).toContainText("No model is available for the Agent", { timeout: 30_000 });
  const chu = await khung.innerText();
  expect(chu).not.toContain("AI_KHONG_CO_MODEL"); // không mã thô
  expect(chu).not.toContain("raw server text"); // câu đã dịch thắng `message` của server
  if (process.env.FS_SHOT_DIR) await page.screenshot({ path: `${process.env.FS_SHOT_DIR}/11b-tu-choi-503.png` });
});

test("12 — socket `subscribe` theo PHẠM VI (instance thật, đăng nhập cookie thật): người trong nhà máy vào phòng máy của mình KHÔNG bị lỗi; người chưa gán nhà máy bị từ chối bằng lỗi chung", async ({ browser }) => {
  const { io: ioClient } = await import("socket.io-client");
  // Đăng nhập MỘT lần cho mỗi người dùng (nhiều lần đăng nhập liên tiếp dễ chạm giới hạn tần suất của /api/auth/login).
  const cookieCua = new Map<string, string>();
  const dangNhapMotLan = async (ai: { username: string; password: string }): Promise<string> => {
    const da = cookieCua.get(ai.username);
    if (da) return da;
    const ctx = await browser.newContext();
    const r = await ctx.request.post(`${base}/api/auth/login`, { data: { username: ai.username, password: ai.password }, timeout: 60_000 });
    expect(r.ok(), `login ${ai.username}: ${r.status()}`).toBe(true);
    const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
    await ctx.close();
    cookieCua.set(ai.username, cookie);
    return cookie;
  };
  const ketNoi = async (ai: { username: string; password: string }) => {
    const cookie = await dangNhapMotLan(ai);
    const sk = ioClient(base, { path: "/api/socket.io", transports: ["websocket"], forceNew: true, reconnection: false, extraHeaders: { cookie } });
    await new Promise<void>((ok, loi) => {
      sk.once("connect", () => ok());
      sk.once("connect_error", (e) => loi(e));
    });
    return { sk };
  };
  // `choTuChoi`: dự kiến BỊ từ chối ⇒ đợi lỗi tới (tối đa 15 s — lượt phân giải phạm vi đầu tiên trên instance nguội có thể chậm); không ⇒ đợi 3 s xem có lỗi muộn không.
  const thu = async (ai: { username: string; password: string }, payload: Record<string, unknown>, choTuChoi = false): Promise<unknown[]> => {
    const { sk } = await ketNoi(ai);
    const loi: unknown[] = [];
    sk.on("subscribe:error", (g) => loi.push(g));
    sk.emit("subscribe", payload);
    const han = Date.now() + (choTuChoi ? 15_000 : 3_000);
    while (Date.now() < han && !(choTuChoi && loi.length > 0)) await new Promise((r) => setTimeout(r, 100));
    sk.disconnect();
    return loi;
  };
  const dung = { machineId: fx.machineId, factoryId: fx.nhaMayA.id };
  expect(await thu(fx.mot, dung)).toEqual([]); // kỹ sư nhà máy A: máy + nhà máy của mình ⇒ không lỗi
  expect(await thu(fx.nhieu, dung)).toEqual([]); // kỹ sư A+B: cũng hợp lệ
  expect(await thu(fx.admin, dung)).toEqual([]); // admin: bypass
  expect(await thu(fx.mot, { factoryId: fx.nhaMayB.id }, true)).toEqual([{ code: "SUBSCRIBE_DENIED" }]); // nhà máy B không thuộc phạm vi của `mot`
  expect(await thu(fx.khong, dung, true)).toEqual([{ code: "SUBSCRIBE_DENIED" }]); // chưa gán nhà máy nào ⇒ chặn (MỘT lỗi chung)
  expect(await thu(fx.mot, {})).toEqual([]); // `subscribe {}` (các trang chỉ cần phòng chung) vẫn như cũ
});
