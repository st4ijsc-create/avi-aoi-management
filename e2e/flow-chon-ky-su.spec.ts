/**
 * Lô logic-chon — e2e trên BẢN DỰNG PRODUCTION (cùng instance riêng của cổng 8.3): kỹ sư (không admin, một nhà máy A) dùng node RẼ NHÁNH bằng FORM CÓ KIỂU:
 *   1. Luồng có cổng `khac` CHƯA nối ⇒ canvas hiện cảnh báo; luồng đã nối ⇒ không cảnh báo.
 *   2. Sửa điều kiện BẰNG FORM (không đụng ô JSON): thêm điều kiện, đổi sang "thuộc danh sách", nhập `b, c` ⇒ lưu ⇒ tham số CSDL đúng KIỂU ([{eq,"a"},{in,["b","c"]}]).
 *   3. Máy chủ KHÔNG tin form: gọi thẳng flow.luu với regex / 6 điều kiện / số là chuỗi ⇒ 400.
 *   4. Hạng thuần ⇒ kỹ sư tự bật + chạy tay với 3 item: item "a" đi nhánh 1, item "x" đi cổng khac, item "b" (nhánh 2 chưa nối) bị bỏ; lượt xong; bước đánh dấu nhận đúng item.
 * Chạy: `npx playwright test --config=playwright.flowhanhtrinh.config.ts` (cùng globalSetup; `npm run build` trước).
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { withTestDb, type FsFixture } from "./flow-studio/fixtures";

test.skip(process.env.FHT_E2E !== "1", "FHT e2e chạy riêng dưới playwright.flowhanhtrinh.config.ts");
test.describe.configure({ mode: "serial" });

let fx: FsFixture;
let base = "";
const DUOI = Date.now().toString(36);
const F1 = `fse2e-chon-${DUOI}`;
const F2 = `fse2e-chon-ko-${DUOI}`;

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
const dinh = (id: string, noiKhac: boolean) => ({
  id, name: `Luồng rẽ nhánh ${id}`, version: 1, settings: { uuTien: "background", luuDuLieu: "day-du" },
  nodes: [
    nut("t", "kich-hoat.thu-cong", {}, [0, 0]),
    nut("chon", "logic.chon", { giaTri: "{{ $json.nhan }}", nhanh: [{ so: "eq", dich: "a" }] }, [300, 0]),
    nut("ma", "du-lieu.dat", { truong: { kenh: "1" } }, [650, -150]),
    nut("mk", "du-lieu.dat", { truong: { kenh: "khac" } }, [650, 150]),
  ],
  connections: [
    { from: { node: "t", port: "main" }, to: { node: "chon", port: "main" } },
    { from: { node: "chon", port: "nhanh-1" }, to: { node: "ma", port: "main" } },
    ...(noiKhac ? [{ from: { node: "chon", port: "khac" }, to: { node: "mk", port: "main" } }] : []),
  ],
});
const luuApi = async (page: Page, definition: unknown) => (await page.context().request.post(`${base}/api/trpc/flow.luu`, { data: { json: { definition } } })).status();
const thamSoChon = (flowId: string) =>
  withTestDb(async (sql) => {
    const [r] = await sql`SELECT definition FROM ai_flow_versions WHERE "flowId" = ${flowId} ORDER BY version DESC LIMIT 1`;
    return ((r.definition as { nodes: { id: string; parameters: Record<string, unknown> }[] }).nodes).find((n) => n.id === "chon")!.parameters;
  });

test("1 — cổng khac CHƯA nối ⇒ canvas cảnh báo; đã nối ⇒ không", async ({ page }) => {
  await dangNhap(page, fx.mot);
  expect(await luuApi(page, dinh(F1, true))).toBe(200);
  expect(await luuApi(page, dinh(F2, false))).toBe(200);
  await page.goto(`${base}/ai-flows/${F2}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("canh-bao-cong-chua-noi")).toBeVisible({ timeout: 30_000 });
  await page.goto(`${base}/ai-flows/${F1}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("flow-node-chon")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("canh-bao-cong-chua-noi")).toHaveCount(0);
});

test("2 — sửa điều kiện BẰNG FORM: thêm điều kiện, 'thuộc danh sách', 'b, c' ⇒ lưu ⇒ CSDL đúng KIỂU; ô JSON chưa mở", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows/${F1}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("flow-node-chon").click();
  await expect(page.getByTestId("form-chon")).toBeVisible();
  await expect(page.getByTestId("json-tham-so")).toHaveCount(0);
  await page.getByTestId("chon-them").click();
  await page.getByTestId("chon-so-1").selectOption("in");
  await page.getByTestId("chon-dich-1").fill("b, c");
  if (process.env.FHT_SHOT_DIR) await page.screenshot({ path: `${process.env.FHT_SHOT_DIR}/c2-form-chon.png` });
  await page.getByTestId("nut-luu").click();
  await expect(page.getByText("Chưa lưu")).toHaveCount(0, { timeout: 30_000 });
  expect(await thamSoChon(F1)).toMatchObject({ giaTri: "{{ $json.nhan }}", nhanh: [{ so: "eq", dich: "a" }, { so: "in", dich: ["b", "c"] }] });
});

test("3 — máy chủ KHÔNG tin form: regex / 6 điều kiện / số là chuỗi / 'in' không phải danh sách ⇒ 400", async ({ page }) => {
  await dangNhap(page, fx.mot);
  const sai = (nhanh: unknown[]) => {
    const d = dinh(`fse2e-chon-sai-${DUOI}`, true);
    (d.nodes[1].parameters as Record<string, unknown>).nhanh = nhanh;
    return luuApi(page, d);
  };
  expect(await sai([{ so: "regex", dich: ".*" }])).toBe(400);
  expect(await sai(Array.from({ length: 6 }, () => ({ so: "eq", dich: 1 })))).toBe(400);
  expect(await sai([{ so: "gt", dich: "5" }])).toBe(400);
  expect(await sai([{ so: "in", dich: "a" }])).toBe(400);
  expect(await sai([{ so: "in", dich: ["a", 1] }])).toBe(200);
});

test("4 — kỹ sư (hạng thuần) tự bật + chạy tay 3 item: a → nhánh 1; x → khac; b (nhánh 2 chưa nối) bị bỏ; bước nhận đúng item", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows/${F1}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("nut-bat").click();
  await expect(page.getByTestId("flow-trang-thai-bat")).toContainText(/bật/i, { timeout: 30_000 });
  await page.getByTestId("nut-chay-tay").click();
  await page.getByTestId("items-json").fill('[{"json":{"nhan":"a","i":1}},{"json":{"nhan":"b","i":2}},{"json":{"nhan":"x","i":3}}]');
  const ph = page.waitForResponse((r) => decodeURIComponent(r.url()).includes("flow.chayTay"));
  await page.getByTestId("xac-nhan-chay").click();
  expect((await ph).status()).toBe(200);
  await expect
    .poll(async () => withTestDb(async (sql) => (await sql`SELECT status FROM ai_flow_runs WHERE "flowId" = ${F1}`).map((r) => String(r.status)).join(",")), { timeout: 60_000 })
    .toBe("xong");
  const dau = (node: string) =>
    withTestDb(async (sql) => {
      const [b] = await sql`SELECT s.input FROM ai_flow_steps s JOIN ai_flow_runs r ON r.id = s."runId" WHERE r."flowId" = ${F1} AND s."nodeId" = ${node}`;
      return ((b?.input as { main?: { json: { i: number } }[] } | undefined)?.main ?? []).map((x) => x.json.i);
    });
  expect(await dau("ma")).toEqual([1]);
  expect(await dau("mk")).toEqual([3]);
  const [ev] = await withTestDb((sql) => sql`SELECT count(*)::int AS n FROM ai_flow_events e JOIN ai_flow_runs r ON r.id = e."runId" WHERE r."flowId" = ${F1} AND e.kind = 'cong.khong-noi'`);
  expect(ev.n).toBe(0); // khac đã nối ⇒ không sự kiện (item b ở nhánh-2 không nối — không thuộc cổng "nên nối")
});
