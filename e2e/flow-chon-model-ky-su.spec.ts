/**
 * Đợt 10.2 bước 7 (e2e production, ×3) — Ô CHỌN MODEL ở mọi bề mặt web, trên BẢN DỰNG PRODUCTION (cùng instance riêng của cổng 8.3, không GPU/llama):
 *   1. Node `ai.llm` (luồng cũ chỉ có `vaiTro`): ô hiện ĐÚNG vai trò cũ; chọn vai trò khác ⇒ lưu ⇒ CSDL `vaiTro` mới + KHÔNG có `chonModel`; chọn "Tự động" ⇒ cả hai khoá biến mất.
 *   2. Máy chủ KHÔNG tin client: `chonModel` là BIỂU THỨC `{{ }}` ở node `ai.*` ⇒ flow.luu 400; mã đúng hình dạng nhưng không phải chuỗi cố định ⇒ 400.
 *   3. Chat AI `/ai-chat`: chọn một model ở ô ⇒ thân yêu cầu `/api/ai/local-kb/stream` mang `context.chonModel`; để "Tự động" ⇒ KHÔNG có trường.
 * Chạy: `npx playwright test --config=playwright.flowhanhtrinh.config.ts flow-chon-model-ky-su.spec.ts` (cùng globalSetup; `npm run build` trước).
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { withTestDb, type FsFixture } from "./flow-studio/fixtures";

test.skip(process.env.FHT_E2E !== "1", "FHT e2e chạy riêng dưới playwright.flowhanhtrinh.config.ts");
test.describe.configure({ mode: "serial" });

let fx: FsFixture;
let base = "";
const DUOI = Date.now().toString(36);
const F1 = `fse2e-chonmodel-${DUOI}`;

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
const nut = (id: string, type: string, parameters: Record<string, unknown>, vt: [number, number] = [0, 0]) => ({ id, type, typeVersion: 1, name: id, position: vt, parameters });
const dinh = (id: string, thamSoLlm: Record<string, unknown>) => ({
  id, name: `Luồng chọn model ${id}`, version: 1, settings: { uuTien: "background", luuDuLieu: "day-du" },
  nodes: [nut("t", "kich-hoat.thu-cong", {}, [0, 0]), nut("m", "ai.llm", thamSoLlm, [300, 0])],
  connections: [{ from: { node: "t", port: "main" }, to: { node: "m", port: "main" } }],
});
const luuApi = async (page: Page, definition: unknown) => (await page.context().request.post(`${base}/api/trpc/flow.luu`, { data: { json: { definition } } })).status();
const thamSoM = (flowId: string) =>
  withTestDb(async (sql) => {
    const [r] = await sql`SELECT definition FROM ai_flow_versions WHERE "flowId" = ${flowId} ORDER BY version DESC LIMIT 1`;
    return ((r.definition as { nodes: { id: string; parameters: Record<string, unknown> }[] }).nodes).find((n) => n.id === "m")!.parameters;
  });
const maTrongO = (page: Page, testId: string) => page.getByTestId(testId).locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));

test("1 — node ai.llm: luồng cũ chỉ có vaiTro ⇒ ô hiện đúng vai trò; đổi ⇒ CSDL vaiTro mới, không chonModel; Tự động ⇒ gỡ cả hai", async ({ page }) => {
  await dangNhap(page, fx.mot);
  expect(await luuApi(page, dinh(F1, { vaiTro: "summarize", loiNhac: "x" }))).toBe(200);
  await page.goto(`${base}/ai-flows/${F1}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("flow-node-m").click();
  const o = page.getByTestId("chon-model-nut");
  await expect(o).toBeVisible();
  await expect(o).toHaveValue("vai-tro:summarize");
  // danh mục thật của máy chủ: chọn một vai trò KHÁC vai hiện tại (nếu danh mục không có thì ca này đỏ — đó là phát hiện, không phải bỏ qua)
  await expect.poll(async () => (await maTrongO(page, "chon-model-nut")).filter((v) => v.startsWith("vai-tro:")).length, { timeout: 30_000 }).toBeGreaterThan(1);
  const khac = (await maTrongO(page, "chon-model-nut")).find((v) => v.startsWith("vai-tro:") && v !== "vai-tro:summarize")!;
  await o.selectOption(khac);
  await page.getByTestId("nut-luu").click();
  await expect(page.getByText("Chưa lưu")).toHaveCount(0, { timeout: 30_000 });
  const p1 = await thamSoM(F1);
  expect(p1.vaiTro).toBe(khac.slice("vai-tro:".length));
  expect("chonModel" in p1).toBe(false);
  expect(p1.loiNhac).toBe("x");
  await page.getByTestId("flow-node-m").click(); // sau khi lưu bảng cấu hình đóng — mở lại
  await expect(o).toHaveValue(khac);
  await o.selectOption("auto");
  await page.getByTestId("nut-luu").click();
  await expect(page.getByText("Chưa lưu")).toHaveCount(0, { timeout: 30_000 });
  const p2 = await thamSoM(F1);
  expect("vaiTro" in p2).toBe(false);
  expect("chonModel" in p2).toBe(false);
  expect(p2.loiNhac).toBe("x");
});

test("2 — máy chủ KHÔNG tin client: chonModel là biểu thức / chuỗi lạ ở node ai.* ⇒ 400; mã đúng hình dạng cố định ⇒ qua ải hình dạng", async ({ page }) => {
  await dangNhap(page, fx.mot);
  const sai = (c: unknown) => luuApi(page, dinh(`fse2e-chonmodel-sai-${DUOI}`, { vaiTro: "chat", chonModel: c }));
  expect(await sai("{{ $json.m }}")).toBe(400);
  expect(await sai("tên-tệp.gguf")).toBe(400);
  expect(await sai(5)).toBe(400);
  expect(await sai("ho-so:p-khong-ton-tai")).toBe(200); // hình dạng đúng ⇒ lưu được; có trong danh mục hay không do lúc CHẠY / cảnh báo nhập xác nhận
});

test("3 — Chat AI: chọn model ở ô ⇒ thân /api/ai/local-kb/stream có context.chonModel; Tự động ⇒ không có trường", async ({ page }) => {
  await dangNhap(page, fx.mot);
  const than: Array<Record<string, any>> = [];
  await page.route("**/api/ai/local-kb/stream", async (route) => {
    than.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: 'data: {"type":"token","text":"ok"}\n\ndata: {"type":"done"}\n\n' });
  });
  await page.goto(`${base}/ai-chat`);
  const o = page.getByTestId("chon-model-chat");
  await expect(o).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await maTrongO(page, "chon-model-chat")).filter((v) => v.startsWith("vai-tro:")).length, { timeout: 30_000 }).toBeGreaterThan(0);
  const chon = (await maTrongO(page, "chon-model-chat")).find((v) => v.startsWith("vai-tro:"))!;
  const hoi = async (cau: string) => {
    const n = than.length;
    await page.getByPlaceholder(/^Hỏi bất cứ điều gì/).fill(cau);
    await page.getByPlaceholder(/^Hỏi bất cứ điều gì/).press("Enter");
    await expect.poll(() => than.length, { timeout: 30_000 }).toBeGreaterThan(n);
    return than[than.length - 1]!;
  };
  await o.selectOption(chon);
  expect((await hoi("câu một")).context.chonModel).toBe(chon);
  await o.selectOption("auto");
  const b2 = await hoi("câu hai");
  expect("chonModel" in b2.context).toBe(false);
  // sticky: tải lại trang ⇒ lựa chọn của lần trước (auto) giữ; chọn lại rồi tải lại ⇒ còn
  await o.selectOption(chon);
  await page.reload();
  await expect(page.getByTestId("chon-model-chat")).toHaveValue(chon, { timeout: 60_000 });
});
