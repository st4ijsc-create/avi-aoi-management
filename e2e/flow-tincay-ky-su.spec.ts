/**
 * Lô độ-tin-cậy — e2e trên BẢN DỰNG PRODUCTION (cùng instance riêng của cổng 8.3; AI KHÔNG tham gia, không đo model): mẫu #5 v2 bắt `ai.phan-loai` xuất `tinCay`, và rẽ nhánh
 * theo nhãn VÀ độ tin cậy. Spec dựng luồng từ CHÍNH tham số của node `kiem-nhan` và `duyet` trong tệp mẫu (đổi mẫu ⇒ spec chạy theo), thay bước AI bằng item có sẵn `nhan`/`tinCay`:
 *   1. Kỹ sư (không admin) mở luồng: form rẽ nhánh hiện biểu thức ngưỡng (tinCay, 0.8) — không cần ô JSON.
 *   2. Kỹ sư bật + chạy tay 3 lượt: R1 [A chắc 0,95 ; B nhãn hợp lệ nhưng tinCay 0,6] · R2 [C thiếu tinCay] · R3 [D nhãn lạ, tinCay 0,99].
 *      A ⇒ nhánh tạo phiếu (đánh dấu `ok`); B, C, D ⇒ NGƯỜI DUYỆT (mỗi lượt một thẻ), không nhánh tạo phiếu.
 *   3. Admin (người duyệt KHÁC người bật) mở `/ai-flows/duyet`: thẻ R1 hiện lý do + nhãn + ĐỘ TIN CẬY 0.6; đồng ý ⇒ nhánh sau duyệt chạy với item B.
 *      Thẻ R2 (thiếu độ tin cậy) bác ⇒ nhánh sau duyệt KHÔNG chạy, lượt xong. Thẻ R3 để nguyên ⇒ lượt còn cho-duyet.
 * Chạy: `npx playwright test --config=playwright.flowhanhtrinh.config.ts` (cùng globalSetup; `npm run build` trước). ×3: `--repeat-each=3`.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { withTestDb, type FsFixture } from "./flow-studio/fixtures";

test.skip(process.env.FHT_E2E !== "1", "FHT e2e chạy riêng dưới playwright.flowhanhtrinh.config.ts");
test.describe.configure({ mode: "serial" });

let fx: FsFixture;
let base = "";
const DUOI = Date.now().toString(36);
const FLOW = `fse2e-tincay-${DUOI}`;

const mau = JSON.parse(fs.readFileSync(path.join(process.cwd(), "server/services/flow/mau/phieu-bao-tri-phan-loai.json"), "utf8")) as { nodes: { id: string; parameters: Record<string, unknown> }[] };
const tham = (id: string) => mau.nodes.find((n) => n.id === id)!.parameters;
const nut = (id: string, type: string, parameters: Record<string, unknown>, vt: [number, number]) => ({ id, type, typeVersion: 1, name: id, position: vt, parameters });
const dinh = {
  id: FLOW, name: "Mẫu #5 độ tin cậy (e2e)", version: 1, settings: { uuTien: "background", luuDuLieu: "day-du", maxConcurrentRuns: 50 },
  nodes: [
    nut("t", "kich-hoat.thu-cong", {}, [0, 0]),
    nut("kiem-nhan", "logic.chon", tham("kiem-nhan"), [300, 0]),
    nut("ok", "du-lieu.dat", { truong: { kenh: "tao-phieu" } }, [650, -150]),
    nut("duyet", "nguoi.duyet", tham("duyet"), [650, 150]),
    nut("ok2", "du-lieu.dat", { truong: { kenh: "sau-duyet" } }, [1000, 150]),
  ],
  connections: [
    { from: { node: "t", port: "main" }, to: { node: "kiem-nhan", port: "main" } },
    { from: { node: "kiem-nhan", port: "nhanh-1" }, to: { node: "ok", port: "main" } },
    { from: { node: "kiem-nhan", port: "khac" }, to: { node: "duyet", port: "main" } },
    { from: { node: "duyet", port: "dong-y" }, to: { node: "ok2", port: "main" } },
  ],
};

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

const runs = () => withTestDb(async (sql) => (await sql`SELECT id, status FROM ai_flow_runs WHERE "flowId" = ${FLOW} ORDER BY "startedAt"`).map((r) => ({ id: String(r.id), status: String(r.status) })));
const buoc = (runId: string, nodeId: string) =>
  withTestDb(async (sql) => {
    const r = await sql`SELECT status, input FROM ai_flow_steps WHERE "runId" = ${runId} AND "nodeId" = ${nodeId} ORDER BY id DESC LIMIT 1`;
    return r[0] ? { status: String(r[0].status), lyDo: ((r[0].input as { main?: { json: { lyDo?: string } }[] }).main ?? []).map((x) => x.json.lyDo) } : null;
  });

async function chayTay(page: Page, items: unknown[]): Promise<string> {
  const truoc = (await runs()).length;
  await page.getByTestId("nut-chay-tay").click();
  await page.getByTestId("items-json").fill(JSON.stringify(items.map((json) => ({ json }))));
  const ph = page.waitForResponse((r) => decodeURIComponent(r.url()).includes("flow.chayTay"));
  await page.getByTestId("xac-nhan-chay").click();
  expect((await ph).status()).toBe(200);
  await expect.poll(async () => (await runs()).length, { timeout: 30_000 }).toBe(truoc + 1);
  return (await runs())[truoc].id;
}

let r1 = "";
let r2 = "";
let r3 = "";

test("1 — kỹ sư mở luồng: node rẽ nhánh hiện biểu thức ngưỡng tinCay bằng FORM (không ô JSON)", async ({ page }) => {
  await dangNhap(page, fx.mot);
  const st = (await page.context().request.post(`${base}/api/trpc/flow.luu`, { data: { json: { definition: dinh } } })).status();
  expect(st).toBe(200);
  await page.goto(`${base}/ai-flows/${FLOW}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("flow-node-kiem-nhan").click();
  await expect(page.getByTestId("form-chon")).toBeVisible();
  await expect(page.getByTestId("json-tham-so")).toHaveCount(0);
  const bieuThuc = await page.getByTestId("chon-gia-tri").inputValue();
  expect(bieuThuc).toContain("tinCay");
  expect(bieuThuc).toContain("0.8");
});

test("2 — chạy tay 3 lượt: chỉ item NHÃN HỢP LỆ VÀ CHẮC đi nhánh tạo phiếu; thấp / thiếu / nhãn lạ ⇒ người duyệt", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows/${FLOW}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("nut-bat").click();
  await expect(page.getByTestId("flow-trang-thai-bat")).toContainText(/bật/i, { timeout: 30_000 });
  r1 = await chayTay(page, [
    { lyDo: "R1-chac", nhan: "dien", tinCay: 0.95 },
    { lyDo: "R1-thap", nhan: "dien", tinCay: 0.6 },
  ]);
  r2 = await chayTay(page, [{ lyDo: "R2-thieu", nhan: "dien" }]);
  r3 = await chayTay(page, [{ lyDo: "R3-la", nhan: "linh-tinh", tinCay: 0.99 }]);
  await expect
    .poll(async () => (await runs()).map((r) => r.status).join(","), { timeout: 60_000 })
    .toBe("cho-duyet,cho-duyet,cho-duyet");
  // R1: A đi nhánh tạo phiếu; B sang người duyệt. R2, R3: chỉ người duyệt.
  expect(await buoc(r1, "ok")).toEqual({ status: "xong", lyDo: ["R1-chac"] });
  expect((await buoc(r1, "duyet"))?.lyDo).toEqual(["R1-thap"]);
  expect(await buoc(r2, "ok")).toBeNull();
  expect((await buoc(r2, "duyet"))?.lyDo).toEqual(["R2-thieu"]);
  expect(await buoc(r3, "ok")).toBeNull();
  expect((await buoc(r3, "duyet"))?.lyDo).toEqual(["R3-la"]);
  // các mục "kiểm hết hạn" đã được xếp (mỗi thẻ có hạn)
  const m = await withTestDb(async (sql) => (await sql`SELECT count(*)::int AS n FROM ai_flow_queue WHERE "runId" IN ${sql([r1, r2, r3])} AND inputs ? '__kiem-het-han'`)[0].n as number);
  expect(m).toBe(3);
});

test("3 — admin (người duyệt khác người bật) thấy NHÃN + ĐỘ TIN CẬY trên thẻ; đồng ý R1 ⇒ nhánh sau duyệt chạy; bác R2 ⇒ không chạy; R3 còn chờ", async ({ page }) => {
  await dangNhap(page, fx.admin);
  await page.goto(`${base}/ai-flows/duyet`);
  const the = (ten: string) => page.getByTestId(`cho-${FLOW}`).filter({ hasText: ten });
  await expect(the("R1-thap")).toBeVisible({ timeout: 60_000 });
  await expect(the("R1-thap")).toContainText("nhãn: dien");
  await expect(the("R1-thap")).toContainText("độ tin cậy: 0.6");
  await expect(the("R2-thieu")).toContainText("nhãn: dien");
  await expect(the("R3-la")).toContainText("nhãn: linh-tinh");
  expect(await the("R1-chac").count()).toBe(0); // item chắc đã đi nhánh tạo phiếu, không có thẻ
  const dy = page.waitForResponse((r) => decodeURIComponent(r.url()).includes("flow.duyet"));
  await the("R1-thap").getByTestId("nut-dong-y").click();
  expect((await dy).status()).toBe(200);
  const tc = page.waitForResponse((r) => decodeURIComponent(r.url()).includes("flow.duyet"));
  await the("R2-thieu").getByTestId("nut-tu-choi").click();
  expect((await tc).status()).toBe(200);
  await expect.poll(async () => (await runs()).map((r) => r.status).join(","), { timeout: 60_000 }).toBe("xong,xong,cho-duyet");
  expect((await buoc(r1, "ok2"))?.lyDo).toEqual(["R1-thap"]);
  expect(await buoc(r2, "ok2")).toBeNull();
  expect(await buoc(r3, "ok2")).toBeNull();
  // chờ đã trả lời ⇒ mục kiểm hết hạn của R1, R2 biến mất; R3 còn
  const con = await withTestDb(async (sql) => (await sql`SELECT count(*)::int AS n FROM ai_flow_queue WHERE "runId" IN ${sql([r1, r2, r3])} AND inputs ? '__kiem-het-han'`)[0].n as number);
  expect(con).toBe(1);
});
