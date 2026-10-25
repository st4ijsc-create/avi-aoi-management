/**
 * Lô nguoi.bieu-mau — e2e trên BẢN DỰNG PRODUCTION (cùng instance riêng của cổng 8.3; AI không tham gia):
 *   1. Kỹ sư (không admin) soạn node biểu mẫu BẰNG FORM (thêm trường chọn + bắt buộc, lưu) — CSDL giữ định nghĩa đúng KIỂU.
 *   2. Máy chủ KHÔNG tin form: gọi thẳng flow.luu với trường trùng tên / 21 trường ⇒ 400.
 *   3. Kỹ sư bật + chạy tay; admin (người điền KHÁC người bật) mở `/ai-flows/duyet`: thẻ có ô nhập theo định nghĩa; bấm "Đồng ý" khi thiếu trường BẮT BUỘC ⇒ máy chủ từ chối, thẻ còn nguyên;
 *      điền đủ ⇒ cổng dong-y, item mang `bieuMau` đúng kiểu (số là số, boolean là boolean).
 *   4. Lượt thứ hai: admin bấm "Từ chối" (bỏ qua) ⇒ cổng tu-choi, KHÔNG có giá trị điền trong item.
 * Chạy: `npx playwright test --config=playwright.flowhanhtrinh.config.ts` (cùng globalSetup; `npm run build` trước). ×3: `--repeat-each=3`.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { withTestDb, type FsFixture } from "./flow-studio/fixtures";

test.skip(process.env.FHT_E2E !== "1", "FHT e2e chạy riêng dưới playwright.flowhanhtrinh.config.ts");
test.describe.configure({ mode: "serial" });

let fx: FsFixture;
let base = "";
const DUOI = Date.now().toString(36);
const FLOW = `fse2e-bieumau-${DUOI}`;

const nut = (id: string, type: string, parameters: Record<string, unknown>, vt: [number, number]) => ({ id, type, typeVersion: 1, name: id, position: vt, parameters });
const dinh = (truong: unknown[], id = FLOW) => ({
  id, name: "Biểu mẫu e2e", version: 1, settings: { uuTien: "background", luuDuLieu: "day-du", maxConcurrentRuns: 50 },
  nodes: [
    nut("t", "kich-hoat.thu-cong", {}, [0, 0]),
    nut("bm", "nguoi.bieu-mau", { tieuDe: "Nhập nguyên nhân {{ $json.ma }}", noiDung: "Điền biểu mẫu", hetHanGio: 24, vaiTroDuyet: "supervisor", truong, truongRa: "bieuMau" }, [300, 0]),
    nut("ok", "du-lieu.dat", { truong: { kenh: "da-dien" } }, [650, -100]),
    nut("ko", "du-lieu.dat", { truong: { kenh: "bo-qua" } }, [650, 100]),
  ],
  connections: [
    { from: { node: "t", port: "main" }, to: { node: "bm", port: "main" } },
    { from: { node: "bm", port: "dong-y" }, to: { node: "ok", port: "main" } },
    { from: { node: "bm", port: "tu-choi" }, to: { node: "ko", port: "main" } },
  ],
});
const TRUONG_MAC_DINH = [{ ten: "ghiChu", nhan: "Ghi chú", kieu: "chuoi" }];

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
const luuApi = async (page: Page, definition: unknown) => (await page.context().request.post(`${base}/api/trpc/flow.luu`, { data: { json: { definition } } })).status();
const runs = () => withTestDb(async (sql) => (await sql`SELECT id, status FROM ai_flow_runs WHERE "flowId" = ${FLOW} ORDER BY "startedAt"`).map((r) => ({ id: String(r.id), status: String(r.status) })));
const dauVao = (runId: string, nodeId: string) =>
  withTestDb(async (sql) => {
    const r = await sql`SELECT input FROM ai_flow_steps WHERE "runId" = ${runId} AND "nodeId" = ${nodeId} ORDER BY id DESC LIMIT 1`;
    return r[0] ? ((r[0].input as { main?: { json: Record<string, unknown> }[] }).main ?? []).map((x) => x.json) : null;
  });

async function chayTay(page: Page, ma: string): Promise<string> {
  const truoc = (await runs()).length;
  await page.getByTestId("nut-chay-tay").click();
  await page.getByTestId("items-json").fill(JSON.stringify([{ json: { ma } }]));
  const ph = page.waitForResponse((r) => decodeURIComponent(r.url()).includes("flow.chayTay"));
  await page.getByTestId("xac-nhan-chay").click();
  expect((await ph).status()).toBe(200);
  await expect.poll(async () => (await runs()).length, { timeout: 30_000 }).toBe(truoc + 1);
  return (await runs())[truoc].id;
}

let r1 = "";
let r2 = "";

test("1 — kỹ sư soạn biểu mẫu BẰNG FORM: thêm trường chọn bắt buộc ⇒ lưu ⇒ CSDL đúng KIỂU; ô JSON chưa mở", async ({ page }) => {
  await dangNhap(page, fx.mot);
  expect(await luuApi(page, dinh(TRUONG_MAC_DINH))).toBe(200);
  await page.goto(`${base}/ai-flows/${FLOW}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("flow-node-bm").click();
  await expect(page.getByTestId("form-bieu-mau")).toBeVisible();
  await expect(page.getByTestId("json-tham-so")).toHaveCount(0);
  await page.getByTestId("bm-them").click();
  await page.getByTestId("bm-ten-1").fill("nguyenNhan");
  await page.getByTestId("bm-nhan-1").fill("Nguyên nhân");
  await page.getByTestId("bm-kieu-1").selectOption("chon");
  await page.getByTestId("bm-lua-chon-1").fill("dien, co-khi");
  await page.getByTestId("bm-bat-buoc-1").check();
  await page.getByTestId("bm-them").click();
  await page.getByTestId("bm-ten-2").fill("soLan");
  await page.getByTestId("bm-nhan-2").fill("Số lần");
  await page.getByTestId("bm-kieu-2").selectOption("so");
  await page.getByTestId("bm-them").click();
  await page.getByTestId("bm-ten-3").fill("daXuLy");
  await page.getByTestId("bm-nhan-3").fill("Đã xử lý");
  await page.getByTestId("bm-kieu-3").selectOption("boolean");
  await page.getByTestId("nut-luu").click();
  await expect(page.getByText("Chưa lưu")).toHaveCount(0, { timeout: 30_000 });
  const tham = await withTestDb(async (sql) => {
    const [r] = await sql`SELECT definition FROM ai_flow_versions WHERE "flowId" = ${FLOW} ORDER BY version DESC LIMIT 1`;
    return ((r.definition as { nodes: { id: string; parameters: Record<string, unknown> }[] }).nodes).find((n) => n.id === "bm")!.parameters;
  });
  expect(tham.truong).toEqual([
    { ten: "ghiChu", nhan: "Ghi chú", kieu: "chuoi" },
    { ten: "nguyenNhan", nhan: "Nguyên nhân", kieu: "chon", batBuoc: true, luaChon: ["dien", "co-khi"] },
    { ten: "soLan", nhan: "Số lần", kieu: "so" },
    { ten: "daXuLy", nhan: "Đã xử lý", kieu: "boolean" },
  ]);
});

test("2 — máy chủ KHÔNG tin form: trường trùng tên / chọn thiếu lựa chọn / 21 trường ⇒ 400", async ({ page }) => {
  await dangNhap(page, fx.mot);
  const sai = (truong: unknown[]) => luuApi(page, dinh(truong, `fse2e-bieumau-sai-${DUOI}`));
  expect(await sai([{ ten: "a", nhan: "A", kieu: "chuoi" }, { ten: "a", nhan: "B", kieu: "so" }])).toBe(400);
  expect(await sai([{ ten: "a", nhan: "A", kieu: "chon", luaChon: [] }])).toBe(400);
  expect(await sai(Array.from({ length: 21 }, (_, i) => ({ ten: `t${i}`, nhan: "x", kieu: "chuoi" })))).toBe(400);
});

test("3 — admin điền biểu mẫu: thiếu trường bắt buộc ⇒ bị từ chối, thẻ còn nguyên; điền đủ ⇒ dong-y, item mang bieuMau đúng kiểu", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows/${FLOW}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("nut-bat").click();
  await expect(page.getByTestId("flow-trang-thai-bat")).toContainText(/bật/i, { timeout: 30_000 });
  r1 = await chayTay(page, "RCA-1");
  r2 = await chayTay(page, "RCA-2");
  await expect.poll(async () => (await runs()).map((r) => r.status).join(","), { timeout: 60_000 }).toBe("cho-duyet,cho-duyet");

  const admin = await page.context().browser()!.newContext();
  const trangAd = await admin.newPage();
  await dangNhap(trangAd, fx.admin);
  await trangAd.goto(`${base}/ai-flows/duyet`);
  const the = (ten: string) => trangAd.getByTestId(`cho-${FLOW}`).filter({ hasText: ten });
  await expect(the("RCA-1")).toBeVisible({ timeout: 60_000 });
  await expect(the("RCA-1").getByTestId("form-dien-bieu-mau")).toBeVisible();
  // thiếu "Nguyên nhân" (bắt buộc) ⇒ máy chủ từ chối
  const tc = trangAd.waitForResponse((r) => decodeURIComponent(r.url()).includes("flow.duyet"));
  await the("RCA-1").getByTestId("nut-dong-y").click();
  expect((await tc).status()).toBe(400);
  await expect(the("RCA-1")).toBeVisible();
  expect((await runs())[0].status).toBe("cho-duyet");
  // điền đủ
  await the("RCA-1").getByTestId("dien-nguyenNhan").selectOption("co-khi");
  await the("RCA-1").getByTestId("dien-soLan").fill("3");
  await the("RCA-1").getByTestId("dien-daXuLy").check();
  await the("RCA-1").getByTestId("dien-ghiChu").fill("đã thay vòng bi");
  const ok = trangAd.waitForResponse((r) => decodeURIComponent(r.url()).includes("flow.duyet"));
  await the("RCA-1").getByTestId("nut-dong-y").click();
  expect((await ok).status()).toBe(200);
  await expect.poll(async () => (await runs())[0].status, { timeout: 30_000 }).toBe("xong");
  const vao = (await dauVao(r1, "ok"))!;
  expect(vao).toHaveLength(1);
  expect(vao[0].bieuMau).toEqual({ ghiChu: "đã thay vòng bi", nguyenNhan: "co-khi", soLan: 3, daXuLy: true });
  expect(await dauVao(r1, "ko")).toBeNull();
  await admin.close();
});

test("4 — bỏ qua (Từ chối) ⇒ cổng tu-choi, KHÔNG có giá trị điền trong item", async ({ browser }) => {
  const admin = await browser.newContext();
  const trangAd = await admin.newPage();
  await dangNhap(trangAd, fx.admin);
  await trangAd.goto(`${base}/ai-flows/duyet`);
  const the = trangAd.getByTestId(`cho-${FLOW}`).filter({ hasText: "RCA-2" });
  await expect(the).toBeVisible({ timeout: 60_000 });
  await the.getByTestId("dien-ghiChu").fill("không được lưu");
  const tc = trangAd.waitForResponse((r) => decodeURIComponent(r.url()).includes("flow.duyet"));
  await the.getByTestId("nut-tu-choi").click();
  expect((await tc).status()).toBe(200);
  await expect.poll(async () => (await runs())[1].status, { timeout: 30_000 }).toBe("xong");
  expect(await dauVao(r2, "ok")).toBeNull();
  const ko = (await dauVao(r2, "ko"))!;
  expect(ko).toHaveLength(1);
  expect(JSON.stringify(ko)).not.toContain("không được lưu");
  expect(ko[0]).not.toHaveProperty("bieuMau");
  await admin.close();
});
