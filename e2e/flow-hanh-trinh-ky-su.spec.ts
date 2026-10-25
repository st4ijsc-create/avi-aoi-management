/**
 * Cổng 8.3 — HÀNH TRÌNH 8 BƯỚC bằng KỸ SƯ KHÔNG ADMIN trên BẢN DỰNG PRODUCTION của Flow Studio (instance riêng, `_test`, KHÔNG GPU/OT/model).
 * Đây là e2e LUỒNG (mẫu "số liệu thuần", không node ai.*) — KHÔNG đo model.
 *
 *   1. Kỹ sư (một nhà máy A) đăng nhập; danh sách luồng KHÔNG chứa luồng toàn-hệ-thống / của nhà máy khác.
 *   2. Tạo luồng TỪ MẪU "Báo cáo ca số liệu thuần" — luồng gắn đúng nhà máy A.
 *   3. Chọn node thông báo, điền người nhận (chính kỹ sư) · chạy thử node (chỉ XEM TRƯỚC — chưa gửi gì).
 *   4. Lưu phiên bản; hạng hiển thị = ngoài-ghi.
 *   5. Kỹ sư bấm Bật ⇒ BỊ TỪ CHỐI (hạng ngoài-ghi chỉ quản trị viên bật); luồng vẫn tắt.
 *   6. Quản trị viên bật; kỹ sư bấm Chạy tay ⇒ cũng BỊ TỪ CHỐI (hạng ngoài-ghi); quản trị viên chạy ⇒ lượt xong, kỹ sư xem dòng thời gian đủ 4 bước, thông báo nội bộ đến đúng người (CSDL).
 *   7. Kỹ sư sửa người nhận sang người chỉ thuộc nhà máy B, lưu phiên bản mới; quản trị viên chạy bản mới ⇒ bước thông báo LỖI, 0 thông báo mới.
 *   8. So sánh lượt v1 (xong) với lượt v2 (lỗi): bước thông báo KHÁC.
 * Chạy: `npx playwright test --config=playwright.flowhanhtrinh.config.ts` (globalSetup dựng `dist/index.js` + dữ liệu, đặt FHT_E2E=1).
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { withTestDb, type FsFixture } from "./flow-studio/fixtures";

test.skip(process.env.FHT_E2E !== "1", "FHT e2e chạy riêng dưới playwright.flowhanhtrinh.config.ts");
test.describe.configure({ mode: "serial" });

const chup = async (page: Page, ten: string) => {
  if (process.env.FHT_SHOT_DIR) await page.screenshot({ path: `${process.env.FHT_SHOT_DIR}/${ten}.png`, fullPage: false });
};

let fx: FsFixture;
let base = "";
let banB = 0; // người chỉ thuộc nhà máy B
let flowId = "";
const TEN_MAU = "Báo cáo ca số liệu thuần";
const NODE_TB = "Gửi thông báo nội bộ (điền người nhận)";

test.beforeAll(async () => {
  fx = JSON.parse(fs.readFileSync(process.env.FHT_STATE!, "utf8")) as FsFixture;
  base = process.env.FHT_BASE_URL!;
  banB = await withTestDb(async (sql) => {
    const [u] = await sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
      VALUES (${`fse2e-banb-${Date.now().toString(36)}`}, ${`fse2e_banb_${Date.now().toString(36)}`}, 'FS ban B', 'password', 'supervisor', true, false, now()) RETURNING id`;
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${fx.nhaMayB.code})`;
    return Number(u.id);
  });
});

async function dangNhap(page: Page, ai: { username: string; password: string }): Promise<void> {
  await page.context().addInitScript(() => {
    try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ }
  });
  const r = await page.context().request.post(`${base}/api/auth/login`, { data: { username: ai.username, password: ai.password } });
  expect(r.ok(), `login: ${r.status()}`).toBe(true);
}

const trangThaiLuong = () =>
  withTestDb(async (sql) => {
    const [f] = await sql`SELECT enabled, "activeVersion", "factoryId", "riskClass" FROM ai_flows WHERE id = ${flowId}`;
    return f as unknown as { enabled: boolean; activeVersion: number | null; factoryId: number | null; riskClass: string };
  });
const demThongBao = () =>
  withTestDb(async (sql) => {
    const [r] = await sql`SELECT count(*)::int AS n FROM notifications WHERE "userId" = ${fx.mot.id} AND title = 'Báo cáo ca'`;
    return Number(r.n);
  });
const luotCuaLuong = () =>
  withTestDb((sql) => sql`SELECT id, status, version FROM ai_flow_runs WHERE "flowId" = ${flowId} ORDER BY "startedAt"`);

/** Mở phiên quản trị viên (ngữ cảnh riêng) và bấm Chạy tay trên luồng; trả mã trả lời của flow.chayTay. */
async function adminChayTay(browser: import("@playwright/test").Browser, version?: number): Promise<number> {
  const ctx = await browser.newContext();
  const ap = await ctx.newPage();
  await ctx.addInitScript(() => {
    try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ }
  });
  expect((await ctx.request.post(`${base}/api/auth/login`, { data: { username: fx.admin.username, password: fx.admin.password } })).ok()).toBe(true);
  await ap.goto(`${base}/ai-flows/${flowId}${version ? "?v=" + version : ""}`);
  await expect(ap.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  if (version) await ap.getByTestId("flow-phien-ban").selectOption(String(version));
  await ap.getByTestId("nut-chay-tay").click();
  const ph = ap.waitForResponse((x) => decodeURIComponent(x.url()).includes("flow.chayTay"));
  await ap.getByTestId("xac-nhan-chay").click();
  const rp = await ph;
  await ctx.close();
  return rp.status();
}

async function chonNodeThongBao(page: Page): Promise<void> {
  await page.getByTestId(`flow-node-${NODE_TB}`).click();
  await expect(page.getByTestId("node-config")).toContainText("tich-hop.thong-bao");
}
async function datNguoiNhan(page: Page, ids: number[]): Promise<void> {
  await chonNodeThongBao(page);
  const o = page.getByTestId("json-tham-so");
  const tham = JSON.parse(await o.inputValue()) as Record<string, unknown>;
  tham.nguoiNhan = ids;
  await o.fill(JSON.stringify(tham, null, 2));
}

test("1 — kỹ sư (không admin) đăng nhập: danh sách luồng không chứa luồng toàn-hệ-thống của nhà máy khác", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows`);
  await expect(page.getByTestId("nut-tao-luong")).toBeVisible({ timeout: 60_000 }); // danh sách rỗng ⇒ không có bảng
  await expect(page.getByTestId("bang-luong")).toHaveCount(0);
  await expect(page.getByTestId(`luong-fse2e-ot`)).toHaveCount(0);
  await expect(page.getByTestId(`luong-fse2e-thu`)).toHaveCount(0);
  await chup(page, "1-danh-sach");
});

test("2 — tạo luồng TỪ MẪU 'Báo cáo ca số liệu thuần': luồng gắn đúng nhà máy A của kỹ sư", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows`);
  await page.getByTestId("nut-tao-tu-mau").click();
  await page.getByTestId("ds-mau").getByText(TEN_MAU, { exact: false }).first().click();
  await page.getByTestId("ten-luong-moi").fill("Báo cáo ca e2e");
  await page.getByTestId("xac-nhan-tao").click();
  await page.waitForURL(/\/ai-flows\/(?!duyet)[^/]+$/, { timeout: 30_000 });
  flowId = decodeURIComponent(page.url().split("/").pop()!);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  const f = await trangThaiLuong();
  expect(f.factoryId).toBe(fx.nhaMayA.id);
  expect(f.enabled).toBe(false);
  await chup(page, "2-tao-tu-mau");
});

test("3 — chọn node thông báo, điền người nhận; chạy thử node chỉ XEM TRƯỚC (chưa gửi thông báo nào)", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows/${flowId}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  const truoc = await demThongBao();
  await datNguoiNhan(page, [fx.mot.id]);
  await expect(page.getByText("Chưa lưu").first()).toBeVisible();
  await page.getByTestId("chay-thu-items-main").fill('[{"json":{"sanLuong":{"tong":{"tong":3,"ng":1,"tiLeNg":33.33}},"may":{"tong":{"tongSoMay":1}}}}]');
  await page.getByTestId("nut-chay-thu-nut").click();
  const kq = page.getByTestId("ket-qua-chay-thu");
  await expect(kq).toHaveAttribute("data-che", "xem-truoc");
  await expect(page.getByTestId("chay-thu-tham-so")).toContainText("Sản lượng 12 giờ: 3 lần kiểm");
  expect(await demThongBao()).toBe(truoc);
  await chup(page, "3-chay-thu-xem-truoc");
  // lưu ngay (bước 4) để bước sau dùng bản lưu
  await page.getByTestId("nut-luu").click();
  await expect(page.getByText("Chưa lưu")).toHaveCount(0, { timeout: 30_000 });
});

test("4 — phiên bản đã lưu: hạng hiển thị là ngoài-ghi", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows/${flowId}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("flow-hang")).toContainText("Ghi ngoài");
  const f = await trangThaiLuong();
  expect(f.activeVersion).toBeNull();
});

test("5 — kỹ sư bấm Bật ⇒ BỊ TỪ CHỐI (hạng ngoài-ghi chỉ quản trị viên); luồng vẫn tắt", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows/${flowId}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  const phanHoi = page.waitForResponse((r) => decodeURIComponent(r.url()).includes("flow.datPhienBanHoatDong"));
  await page.getByTestId("nut-bat").click();
  const r = await phanHoi;
  expect(r.status()).toBe(403);
  const f = await trangThaiLuong();
  expect(f.enabled).toBe(false);
  await chup(page, "5-bat-bi-tu-choi");
});

test("6 — quản trị viên bật; kỹ sư Chạy tay bị từ chối; quản trị viên chạy ⇒ lượt xong, kỹ sư thấy đủ 4 bước, thông báo nội bộ đến đúng người", async ({ browser, page }) => {
  const adminCtx = await browser.newContext();
  const ap = await adminCtx.newPage();
  await adminCtx.addInitScript(() => {
    try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ }
  });
  const rl = await adminCtx.request.post(`${base}/api/auth/login`, { data: { username: fx.admin.username, password: fx.admin.password } });
  expect(rl.ok()).toBe(true);
  await ap.goto(`${base}/ai-flows/${flowId}`);
  await expect(ap.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await ap.getByTestId("nut-bat").click();
  await expect(ap.getByTestId("flow-trang-thai-bat")).toContainText(/Đang bật|bật/i, { timeout: 30_000 });
  await adminCtx.close();
  expect((await trangThaiLuong()).enabled).toBe(true);

  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows/${flowId}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  const truoc = await demThongBao();
  // kỹ sư bấm Chạy tay ⇒ 403 (hạng ngoài-ghi); không có lượt nào
  await page.getByTestId("nut-chay-tay").click();
  const ph = page.waitForResponse((r) => decodeURIComponent(r.url()).includes("flow.chayTay"));
  await page.getByTestId("xac-nhan-chay").click();
  expect((await ph).status()).toBe(403);
  expect((await luotCuaLuong()).length).toBe(0);
  // quản trị viên chạy ⇒ lượt xong
  expect(await adminChayTay(browser)).toBe(200);
  await expect.poll(async () => (await luotCuaLuong()).map((x) => x.status).join(","), { timeout: 60_000 }).toBe("xong");
  await page.reload();
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("tab-chay").click();
  await expect(page.getByTestId("lich-su-chay").locator("li")).toHaveCount(1, { timeout: 30_000 });
  await page.getByTestId("lich-su-chay").locator("li button").first().click();
  for (const n of ["lich-6h", "san-luong", "may", "thong-bao"]) await expect(page.getByTestId(`buoc-${n}`)).toBeVisible({ timeout: 30_000 });
  expect(await demThongBao()).toBe(truoc + 1);
  const [tb] = await withTestDb((sql) => sql`SELECT message FROM notifications WHERE "userId" = ${fx.mot.id} AND title = 'Báo cáo ca' ORDER BY id DESC LIMIT 1`);
  expect(String(tb.message)).toMatch(/^Sản lượng 12 giờ: \d+ lần kiểm, NG \d+ \(\d+(\.\d+)? %\)\. Máy trong phạm vi: 1\.$/);
  await chup(page, "6-luot-xong");
});

test("7 — kỹ sư đổi người nhận sang người chỉ thuộc nhà máy B, lưu phiên bản mới; quản trị viên chạy bản mới ⇒ bước thông báo LỖI, không gửi thêm thông báo", async ({ browser, page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows/${flowId}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await datNguoiNhan(page, [banB]);
  await page.getByTestId("nut-luu").click();
  await expect(page.getByText("Chưa lưu")).toHaveCount(0, { timeout: 30_000 });
  const truoc = await demThongBao();
  // v2 chưa là phiên bản HOẠT ĐỘNG — quản trị viên chạy tay v2
  const [vv] = await withTestDb((sql) => sql`SELECT max(version)::int AS v FROM ai_flow_versions WHERE "flowId" = ${flowId}`);
  const vMoi = Number(vv.v);
  const luotTruoc = await luotCuaLuong();
  expect(vMoi).toBeGreaterThan(luotTruoc[0].version); // bản lưu ở bước 7 là phiên bản MỚI
  expect(await adminChayTay(browser, vMoi)).toBe(200);
  await expect.poll(async () => (await luotCuaLuong()).map((x) => `${x.version}:${x.status}`).join(","), { timeout: 60_000 }).toBe(`${luotTruoc[0].version}:xong,${vMoi}:loi`);
  expect(await demThongBao()).toBe(truoc);
  await page.getByTestId("tab-chay").click();
  await expect(page.getByTestId("lich-su-chay").locator("li")).toHaveCount(2, { timeout: 30_000 });
  await chup(page, "7-luot-loi");
});

test("8 — so sánh lượt xong với lượt lỗi: bước thông báo KHÁC", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows/${flowId}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("tab-chay").click();
  await page.getByTestId("nut-so-sanh-luot").click();
  await expect(page.getByTestId("so-sanh-luot")).toBeVisible();
  const [l1, l2] = await luotCuaLuong();
  await page.getByTestId("so-sanh-a").selectOption(String(l1.id));
  await page.getByTestId("so-sanh-b").selectOption(String(l2.id));
  await expect(page.getByTestId("so-sanh-tom-tat")).toContainText("Trạng thái lượt khác nhau", { timeout: 60_000 });
  await expect(page.getByTestId("so-sanh-buoc-thong-bao")).toHaveAttribute("data-ket", "khac");
  await expect(page.getByTestId("so-sanh-buoc-san-luong")).toHaveAttribute("data-ket", "giong");
  await chup(page, "8-so-sanh");
});

test.afterAll(async () => {
  await withTestDb(async (sql) => {
    await sql`DELETE FROM notifications WHERE "userId" IN (${fx.mot.id}, ${banB})`;
    await sql`DELETE FROM user_factory_assignments WHERE "userId" = ${banB}`;
    await sql`DELETE FROM users WHERE id = ${banB}`.catch(() => undefined);
  });
});
