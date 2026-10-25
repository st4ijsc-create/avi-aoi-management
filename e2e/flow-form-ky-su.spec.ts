/**
 * Lô Luồng-form — e2e trên BẢN DỰNG PRODUCTION (cùng instance riêng của cổng 8.3): kỹ sư (không admin, một nhà máy A) cấu hình luồng CHỈ BẰNG FORM CÓ KIỂU, không đụng ô JSON:
 *   1. Tạo từ mẫu "số liệu thuần"; chọn node số liệu ⇒ form (không có ô JSON); chọn truy vấn từ danh mục; giờ gõ 9999 ⇒ kẹp 168.
 *   2. Node thông báo ⇒ form người nhận: tìm "FS" chỉ thấy người trong nhà máy A (kỹ sư A, kỹ sư A+B, admin) — KHÔNG thấy người chỉ thuộc B; tìm tên người B ⇒ "không thấy".
 *   3. Thêm node sự kiện + node tạo phiếu từ bảng node ⇒ mỗi node có form có kiểu; sự kiện MẶC ĐỊNH TẮT.
 *   4. Lưu ⇒ tham số trong CSDL đúng như chọn bằng form; ô JSON chưa từng được mở.
 *   5. Máy chủ KHÔNG tin form: gọi thẳng flow.luu bằng tài khoản kỹ sư với tham số sai (truy vấn lạ, 21 người nhận, ưu tiên 9, sự kiện lạ) ⇒ 400; flow.nguoiNhanChoLuong trực tiếp không trả người nhà máy B.
 *   6. Admin bật + chạy ⇒ thông báo nội bộ đến người đã chọn bằng form.
 * Chạy: `npx playwright test --config=playwright.flowhanhtrinh.config.ts` (cùng globalSetup; `npm run build` trước).
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
let flowId = "";
const NODE_SL = "Sản lượng 12 giờ";
const NODE_TB = "Gửi thông báo nội bộ (điền người nhận)";

test.beforeAll(() => {
  fx = JSON.parse(fs.readFileSync(process.env.FHT_STATE!, "utf8")) as FsFixture;
  base = process.env.FHT_BASE_URL!;
});

async function dangNhap(page: Page, ai: { username: string; password: string }): Promise<void> {
  await page.context().addInitScript(() => {
    try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ }
  });
  const r = await page.context().request.post(`${base}/api/auth/login`, { data: { username: ai.username, password: ai.password } });
  expect(r.ok(), `login: ${r.status()}`).toBe(true);
}
const thamSoNut = (nodeId: string) =>
  withTestDb(async (sql) => {
    const [r] = await sql`SELECT v.definition FROM ai_flow_versions v WHERE v."flowId" = ${flowId} ORDER BY v.version DESC LIMIT 1`;
    const n = ((r.definition as { nodes: { id: string; parameters: Record<string, unknown> }[] }).nodes).find((x) => x.id === nodeId);
    return n?.parameters as Record<string, unknown>;
  });
const dsNutMoi = (loaiNut: string) => withTestDb(async (sql) => {
  const [r] = await sql`SELECT v.definition FROM ai_flow_versions v WHERE v."flowId" = ${flowId} ORDER BY v.version DESC LIMIT 1`;
  return ((r.definition as { nodes: { id: string; type: string; parameters: Record<string, unknown> }[] }).nodes).filter((x) => x.type === loaiNut);
});

test("1 — tạo từ mẫu, node số liệu bằng FORM: chọn truy vấn trong danh mục, giờ 9999 bị kẹp 168, không có ô JSON", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows`);
  await page.getByTestId("nut-tao-tu-mau").click();
  await page.getByTestId("ds-mau").getByText("Báo cáo ca số liệu thuần", { exact: false }).first().click();
  await page.getByTestId("ten-luong-moi").fill("Báo cáo ca bằng form");
  await page.getByTestId("xac-nhan-tao").click();
  await page.waitForURL(/\/ai-flows\/(?!duyet)[^/]+$/, { timeout: 30_000 });
  flowId = decodeURIComponent(page.url().split("/").pop()!);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId(`flow-node-${NODE_SL}`).click();
  await expect(page.getByTestId("form-so-lieu")).toBeVisible();
  await expect(page.getByTestId("json-tham-so")).toHaveCount(0);
  await page.getByTestId("so-lieu-truy-van").selectOption("oee.trung-binh");
  await page.getByTestId("so-lieu-gio").fill("9999");
  await expect(page.getByTestId("so-lieu-gio")).toHaveValue("168");
  await chup(page, "f1-form-so-lieu");
});

test("2 — node thông báo bằng FORM: tìm người nhận chỉ thấy người trong nhà máy A; người chỉ thuộc B không bao giờ hiện", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows/${flowId}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId(`flow-node-${NODE_TB}`).click();
  await expect(page.getByTestId("form-thong-bao")).toBeVisible();
  await expect(page.getByTestId("json-tham-so")).toHaveCount(0);
  // một ký tự: chưa tìm
  await page.getByTestId("nn-tim").fill("F");
  await expect(page.getByTestId("nn-ket-qua").locator("li")).toHaveCount(0);
  await page.getByTestId("nn-tim").fill("FS");
  await expect(page.getByTestId(`nn-them-${fx.mot.id}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`nn-them-${fx.nhieu.id}`)).toBeVisible(); // A + B
  await expect(page.getByTestId(`nn-them-${fx.admin.id}`)).toBeVisible(); // toàn quyền
  await expect(page.getByTestId(`nn-them-${fx.banB.id}`)).toHaveCount(0); // CHỈ B
  await expect(page.getByTestId(`nn-them-${fx.khong.id}`)).toHaveCount(0); // chưa gán nhà máy
  await chup(page, "f2-nguoi-nhan");
  await page.getByTestId("nn-tim").fill("FS banb");
  await expect(page.getByTestId("nn-khong-thay")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("nn-tim").fill("FS mot");
  await page.getByTestId(`nn-them-${fx.mot.id}`).click();
  await expect(page.getByTestId(`nn-da-chon-${fx.mot.id}`)).toBeVisible();
});

test("3 — thêm node sự kiện và node tạo phiếu: mỗi node một form có kiểu; sự kiện MẶC ĐỊNH TẮT", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows/${flowId}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("them-kich-hoat.su-kien").click();
  await expect(page.getByTestId("form-su-kien")).toBeVisible();
  await expect(page.getByTestId("sk-bat")).not.toBeChecked();
  await page.getByTestId("sk-su-kien").selectOption("downtime.start");
  await page.getByTestId("sk-cua-so").fill("5000");
  await expect(page.getByTestId("sk-cua-so")).toHaveValue("1440");
  await page.getByTestId("them-bao-tri.tao-phieu").click();
  await expect(page.getByTestId("form-tao-phieu")).toBeVisible();
  await page.getByTestId("tp-nhom").selectOption("plc-phan-mem");
  await page.getByTestId("tp-uu-tien").selectOption("2");
  await chup(page, "f3-form-tao-phieu");
  await expect(page.getByTestId("json-tham-so")).toHaveCount(0);
});

test("4 — lưu: tham số trong CSDL đúng như chọn bằng form (ô JSON chưa từng mở)", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows/${flowId}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  // các thay đổi bước 1–3 chưa lưu (mỗi bước nạp lại trang) ⇒ làm lại ngắn gọn trong MỘT phiên rồi lưu
  await page.getByTestId(`flow-node-${NODE_SL}`).click();
  await page.getByTestId("so-lieu-truy-van").selectOption("oee.trung-binh");
  await page.getByTestId("so-lieu-gio").fill("9999");
  await page.getByTestId(`flow-node-${NODE_TB}`).click();
  await page.getByTestId("nn-tim").fill("FS mot");
  await page.getByTestId(`nn-them-${fx.mot.id}`).click();
  await page.getByTestId("tb-loai").selectOption("INFO");
  await page.getByTestId("them-kich-hoat.su-kien").click();
  await page.getByTestId("sk-su-kien").selectOption("downtime.start");
  await page.getByTestId("them-bao-tri.tao-phieu").click();
  await page.getByTestId("tp-nhom").selectOption("plc-phan-mem");
  await page.getByTestId("tp-uu-tien").selectOption("2");
  await page.getByTestId("nut-luu").click();
  await expect(page.getByText("Chưa lưu")).toHaveCount(0, { timeout: 30_000 });
  expect(await thamSoNut("san-luong")).toMatchObject({ truyVan: "oee.trung-binh", gio: 168 });
  expect(await thamSoNut("thong-bao")).toMatchObject({ nguoiNhan: [fx.mot.id], loai: "INFO" });
  const [sk] = await dsNutMoi("kich-hoat.su-kien");
  expect(sk.parameters).toMatchObject({ suKien: "downtime.start" });
  expect(sk.parameters.bat === true).toBe(false); // MẶC ĐỊNH TẮT sau khi lưu
  const [tp] = await dsNutMoi("bao-tri.tao-phieu");
  expect(tp.parameters).toMatchObject({ nhom: "plc-phan-mem", uuTien: 2 });
});

test("5 — máy chủ KHÔNG tin form: flow.luu với tham số sai ⇒ 400; flow.nguoiNhanChoLuong gọi trực tiếp không trả người nhà máy B", async ({ page }) => {
  await dangNhap(page, fx.mot);
  const req = page.context().request;
  const luu = async (nodes: unknown[]) =>
    (await req.post(`${base}/api/trpc/flow.luu`, { data: { json: { definition: { id: flowId, name: "x", version: 1, nodes: [{ id: "t", type: "kich-hoat.thu-cong", typeVersion: 1, name: "t", position: [0, 0], parameters: {} }, ...nodes], connections: [] } } } })).status();
  const nut = (id: string, type: string, parameters: Record<string, unknown>) => ({ id, type, typeVersion: 1, name: id, position: [0, 0], parameters });
  expect(await luu([nut("s", "du-lieu.so-lieu", { truyVan: "drop-table" })])).toBe(400);
  expect(await luu([nut("n", "tich-hop.thong-bao", { nguoiNhan: Array.from({ length: 21 }, (_, i) => i + 1), tieuDe: "x" })])).toBe(400);
  expect(await luu([nut("p", "bao-tri.tao-phieu", { may: 1, tieuDe: "abc", uuTien: 9 })])).toBe(400);
  expect(await luu([nut("e", "kich-hoat.su-kien", { suKien: "order.created" })])).toBe(400);
  const q = encodeURIComponent(JSON.stringify({ json: { flowId, tim: "FS" } }));
  const r = await req.get(`${base}/api/trpc/flow.nguoiNhanChoLuong?input=${q}`);
  expect(r.status()).toBe(200);
  const nd = await r.text();
  expect(nd).toContain(String(fx.mot.id));
  expect(nd).not.toContain(`"id":${fx.banB.id},`);
  expect(nd).not.toMatch(/email|phone|@/i);
});

test("6 — admin bật + chạy tay ⇒ thông báo nội bộ đến người đã chọn bằng form", async ({ browser }) => {
  const ctx = await browser.newContext();
  const ap = await ctx.newPage();
  await ctx.addInitScript(() => {
    try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ }
  });
  expect((await ctx.request.post(`${base}/api/auth/login`, { data: { username: fx.admin.username, password: fx.admin.password } })).ok()).toBe(true);
  await ap.goto(`${base}/ai-flows/${flowId}`);
  await expect(ap.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  const truoc = await withTestDb(async (sql) => Number((await sql`SELECT count(*)::int AS n FROM notifications WHERE "userId" = ${fx.mot.id} AND title = 'Báo cáo ca'`)[0].n));
  await ap.getByTestId("nut-bat").click();
  await expect(ap.getByTestId("flow-trang-thai-bat")).toContainText(/bật/i, { timeout: 30_000 });
  const ph = ap.waitForResponse((x) => decodeURIComponent(x.url()).includes("flow.chayTay"));
  await ap.getByTestId("nut-chay-tay").click();
  await ap.getByTestId("xac-nhan-chay").click();
  expect((await ph).status()).toBe(200);
  await expect.poll(async () => withTestDb(async (sql) => Number((await sql`SELECT count(*)::int AS n FROM notifications WHERE "userId" = ${fx.mot.id} AND title = 'Báo cáo ca'`)[0].n)), { timeout: 60_000 }).toBe(truoc + 1);
  await ctx.close();
});
