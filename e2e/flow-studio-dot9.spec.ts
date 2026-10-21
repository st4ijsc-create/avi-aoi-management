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

async function dangNhap(page: Page): Promise<void> {
  await page.context().addInitScript(() => {
    try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ }
  });
  const r = await page.context().request.post(`${base}/api/auth/login`, { data: { username: fx.admin.username, password: fx.admin.password } });
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
  await page.getByTestId("ot-may").fill("999999");
  await page.getByTestId("ot-lenh").fill("pause");
  await page.getByTestId("nut-chay-thu-nut").click();
  const kq = page.getByTestId("ket-qua-chay-thu");
  await expect(kq).toBeVisible();
  await expect(kq).toHaveAttribute("data-che", "chay");
  const chu = (await kq.innerText()) + (await kq.evaluate((e) => e.textContent ?? ""));
  expect(chu).not.toMatch(/"daGui":\s*true/);
  await chup(page, "3b-form-ot-chay-thu");
  if ((await kq.getAttribute("data-ok")) === "1") await expect(page.getByTestId("chay-thu-cho")).toContainText(/MÔ PHỎNG|moPhong/);
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
