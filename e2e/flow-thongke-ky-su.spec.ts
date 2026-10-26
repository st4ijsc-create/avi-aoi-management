/**
 * Lô B7 (e2e production, ×3) — tab THỐNG KÊ khớp dữ liệu gieo, ô "Hạn tối đa mỗi lượt" lưu đúng `settings.timeoutS` (giây) và banner "dữ liệu đã gỡ" theo `settings.luuDuLieu`:
 *   1. Dữ liệu gieo SỐ BIẾT TRƯỚC (4 lượt xong 10/20/30/40 s, 1 lỗi, 1 huỷ; node a 1/2/3 s + lỗi 4 s; token 302/32 + 51/6; đổi khe 2): tab Thống kê hiện đúng 66,7 %, p50 25 s, bảng node/model, đổi khe là ước lượng; đổi cửa sổ 30 ngày ⇒ số đổi theo.
 *   2. Ô hạn lượt (giờ): 2 ⇒ timeoutS = 7200; 0,5 ⇒ 1800; xoá ô ⇒ khoá timeoutS biến mất — kiểm ở phiên bản CSDL đã lưu.
 *   3. Lượt thật của luồng luuDuLieu=khong: banner "dữ liệu đã gỡ" + bước không còn dữ liệu; luồng day-du thì KHÔNG banner.
 * Chạy: `npx playwright test --config=playwright.flowhanhtrinh.config.ts flow-thongke-ky-su.spec.ts` (cùng globalSetup; `npm run build` trước).
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { withTestDb, type FsFixture } from "./flow-studio/fixtures";

test.skip(process.env.FHT_E2E !== "1", "FHT e2e chạy riêng dưới playwright.flowhanhtrinh.config.ts");
test.describe.configure({ mode: "serial" });

let fx: FsFixture;
let base = "";
const DUOI = Date.now().toString(36);
const F_TK = `fse2e-thongke-${DUOI}`;
const F_KHONG = `fse2e-tkkhong-${DUOI}`;
const F_DAYDU = `fse2e-tkdaydu-${DUOI}`;
const F_HAN = `fse2e-tkhan-${DUOI}`;

const nut = (id: string, type: string, parameters: Record<string, unknown>, vt: [number, number]) => ({ id, type, typeVersion: 1, name: id, position: vt, parameters });
const dinh = (id: string, settings: Record<string, unknown> = {}) => ({
  id, name: `Thống kê e2e ${id}`, version: 1, settings: { uuTien: "background", luuDuLieu: "day-du", ...settings },
  nodes: [nut("t", "kich-hoat.thu-cong", {}, [0, 0]), nut("a", "du-lieu.dat", { truong: { k: "{{ $json.x }}" } }, [300, 0])],
  connections: [{ from: { node: "t", port: "main" }, to: { node: "a", port: "main" } }],
});

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

async function gieo(sql: Parameters<Parameters<typeof withTestDb>[0]>[0]): Promise<void> {
  const run = async (status: string, truoc: string, giay: number | null) => {
    const id = randomUUID();
    await sql`INSERT INTO ai_flow_runs (id, "flowId", version, "triggerKind", status, "startedAt", "finishedAt")
      VALUES (${id}, ${F_TK}, 1, 'thu-cong', ${status}, now() - ${truoc}::interval, ${giay === null ? null : sql`now() - ${truoc}::interval + (${giay}::int * interval '1 second')`})`;
    return id;
  };
  let k = 0;
  const buoc = (runId: string, nodeId: string, status: string, giay: number) =>
    sql`INSERT INTO ai_flow_steps ("runId", "nodeId", lan, "lanThu", status, "idempotencyKey", "startedAt", "finishedAt")
      VALUES (${runId}, ${nodeId}, 1, 1, ${status}, ${`k-${DUOI}-${k++}`}, now() - interval '1 hour', now() - interval '1 hour' + (${giay}::int * interval '1 second'))`;
  const model = (runId: string, payload: Record<string, unknown>) => sql`INSERT INTO ai_flow_events ("runId", kind, payload) VALUES (${runId}, 'buoc.model', ${sql.json(payload as never)})`;
  const xong = [await run("xong", "1 hour", 10), await run("xong", "1 hour", 20), await run("xong", "1 hour", 30), await run("xong", "1 hour", 40)];
  const loi = await run("loi", "1 hour", 5);
  await run("huy", "1 hour", 1);
  const cu = await run("xong", "10 days", 100);
  for (const [i, g] of [1, 2, 3].entries()) await buoc(xong[i], "a", "xong", g);
  await buoc(loi, "a", "loi", 4);
  await buoc(xong[3], "b", "xong", 8);
  await buoc(cu, "a", "xong", 50);
  await model(xong[0], { nodeId: "a", model: "model-A", tokVao: 100, tokRa: 10, kheBan: false });
  await model(xong[0], { nodeId: "a", model: "model-A", tokVao: 200, tokRa: 20, kheBan: false });
  await model(xong[0], { nodeId: "b", model: "model-B", tokVao: 50, tokRa: 5, kheBan: true });
  await model(xong[0], { nodeId: "b", model: "model-B", kheBan: false });
  await model(xong[1], { nodeId: "a", model: "model-B", tokVao: 1, tokRa: 1, kheBan: false });
  await model(xong[1], { nodeId: "a", model: "model-A", tokVao: 2, tokRa: 2, kheBan: false });
}

test("1 — tab Thống kê khớp dữ liệu gieo: 66,7 %, p50 25 s, bảng node + model, đổi khe là ƯỚC LƯỢNG; cửa sổ 30 ngày đổi số", async ({ page }) => {
  await dangNhap(page, fx.mot);
  expect(await luuApi(page, dinh(F_TK))).toBe(200);
  await withTestDb(gieo);
  await page.goto(`${base}/ai-flows/${F_TK}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("tab-thong-ke").click();
  await expect(page.getByTestId("flow-thong-ke")).toBeVisible();
  await expect(page.getByTestId("tk-ti-le")).toHaveText("66.7%", { timeout: 30_000 });
  await expect(page.getByTestId("tk-p50")).toHaveText("p50 25 s");
  await expect(page.getByTestId("tk-theo-nut")).toContainText("a");
  await expect(page.getByTestId("tk-theo-nut")).toContainText("2.5 s"); // p50 node a (1,2,3 xong + 4 lỗi)
  await expect(page.getByTestId("tk-theo-model")).toContainText("model-A");
  await expect(page.getByTestId("tk-theo-model")).toContainText("302");
  await expect(page.getByTestId("tk-theo-model")).toContainText("51");
  await expect(page.getByTestId("tk-doi-khe")).toContainText("ƯỚC LƯỢNG");
  await expect(page.getByTestId("tk-doi-khe")).toContainText("2 lần");
  // 30 ngày gồm lượt xong cũ (10 ngày): 5 xong / 7 đóng = 71,4 %
  await page.getByTestId("tk-ngay").selectOption("30");
  await expect(page.getByTestId("tk-ti-le")).toHaveText("71.4%", { timeout: 30_000 });
});

test("2 — ô 'Hạn tối đa mỗi lượt (giờ)': 2 ⇒ timeoutS 7200; 0,5 ⇒ 1800; xoá ô ⇒ không còn timeoutS", async ({ page }) => {
  await dangNhap(page, fx.mot);
  expect(await luuApi(page, dinh(F_HAN))).toBe(200);
  const timeoutS = () =>
    withTestDb(async (sql) => {
      const [r] = await sql`SELECT definition->'settings'->'timeoutS' AS t FROM ai_flow_versions WHERE "flowId" = ${F_HAN} ORDER BY version DESC LIMIT 1`;
      return r.t as number | null;
    });
  expect(await timeoutS()).toBeNull();
  await page.goto(`${base}/ai-flows/${F_HAN}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  const luu = async () => {
    await page.getByTestId("nut-luu").click();
    await expect(page.getByText("Chưa lưu")).toHaveCount(0, { timeout: 30_000 });
  };
  await page.getByTestId("han-luot-gio").fill("2");
  await luu();
  expect(await timeoutS()).toBe(7200);
  await page.getByTestId("han-luot-gio").fill("0.5");
  await luu();
  expect(await timeoutS()).toBe(1800);
  await page.getByTestId("han-luot-gio").fill("");
  await luu();
  expect(await timeoutS()).toBeNull();
});

test("3 — luồng luuDuLieu=khong: lượt thật xong ⇒ banner 'dữ liệu đã gỡ' + bước không dữ liệu; luồng day-du ⇒ KHÔNG banner", async ({ page }) => {
  await dangNhap(page, fx.mot);
  expect(await luuApi(page, dinh(F_KHONG, { luuDuLieu: "khong" }))).toBe(200);
  expect(await luuApi(page, dinh(F_DAYDU, { luuDuLieu: "day-du" }))).toBe(200);
  const chay = async (flowId: string): Promise<string> => {
    const r = await page.context().request.post(`${base}/api/trpc/flow.chayTay`, { data: { json: { flowId, items: [{ json: { x: 5 } }] } } });
    expect(r.status()).toBe(200);
    const id = (await r.json()).result.data.json.runId as string;
    await expect
      .poll(async () => withTestDb(async (sql) => String((await sql`SELECT status FROM ai_flow_runs WHERE id = ${id}`)[0]?.status)), { timeout: 60_000 })
      .toBe("xong");
    return id;
  };
  const rKhong = await chay(F_KHONG);
  const rDayDu = await chay(F_DAYDU);
  const coDuLieu = (id: string) => withTestDb(async (sql) => (await sql`SELECT count(*)::int AS n FROM ai_flow_steps WHERE "runId" = ${id} AND (input IS NOT NULL OR output IS NOT NULL)`)[0].n as number);
  expect(await coDuLieu(rKhong)).toBe(0);
  expect(await coDuLieu(rDayDu)).toBeGreaterThan(0);
  await page.goto(`${base}/ai-flows/${F_KHONG}?run=${rKhong}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("tab-chay").click();
  await expect(page.getByTestId("du-lieu-da-go")).toBeVisible({ timeout: 30_000 });
  await page.goto(`${base}/ai-flows/${F_DAYDU}?run=${rDayDu}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("tab-chay").click();
  await expect(page.getByTestId("cac-buoc")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("du-lieu-da-go")).toHaveCount(0);
});
