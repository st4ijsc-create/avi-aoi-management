/**
 * Lô nhập/xuất luồng giữa nhà máy — e2e trên BẢN DỰNG PRODUCTION (cùng instance riêng của cổng 8.3), chỉ TỆP tải về / tải lên:
 *   1. Kỹ sư A (một nhà máy) dựng luồng có người nhận + chữ tự do nhắc nhà máy A; bấm Xuất ⇒ hộp xem trước có CẢNH BÁO (node + trường) và danh sách việc phải điền.
 *   2. Tải gói về: gói KHÔNG chứa id luồng, người nhận, bí mật; cảnh báo không nằm trong gói; có băm.
 *   3. Kỹ sư B (chỉ nhà máy B) tải gói lên ⇒ xem trước (hạng, số node, việc phải điền, không cảnh báo băm) ⇒ nhập ⇒ luồng MỚI thuộc nhà máy B, TẮT, người nhận trống.
 *   4. Gói bị sửa tay (băm lệch) ⇒ chỉ CẢNH BÁO; định dạng lạ ⇒ lỗi rõ, nút nhập không bật; máy chủ không tin giao diện: kỹ sư chỉ-A gọi thẳng flow.nhap vào nhà máy B ⇒ từ chối.
 * Chạy: `npx playwright test --config=playwright.flowhanhtrinh.config.ts` (cùng globalSetup; `npm run build` trước).
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withTestDb, type FsFixture } from "./flow-studio/fixtures";

test.skip(process.env.FHT_E2E !== "1", "FHT e2e chạy riêng dưới playwright.flowhanhtrinh.config.ts");
test.describe.configure({ mode: "serial" });

let fx: FsFixture;
let base = "";
let flowId = "";
let tepGoi = "";
let goi: { dinhDang: string; luong: { nodes: { id: string; type: string; parameters: Record<string, unknown>; credentialRef?: string }[] }; bam: string };
const THU_MUC = fs.mkdtempSync(path.join(os.tmpdir(), "fht-nhapxuat-"));

test.beforeAll(() => {
  fx = JSON.parse(fs.readFileSync(process.env.FHT_STATE!, "utf8")) as FsFixture;
  base = process.env.FHT_BASE_URL!;
});
test.afterAll(() => {
  fs.rmSync(THU_MUC, { recursive: true, force: true });
});

async function dangNhap(page: Page, ai: { username: string; password: string }): Promise<void> {
  await page.context().addInitScript(() => {
    try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ }
  });
  const r = await page.context().request.post(`${base}/api/auth/login`, { data: { username: ai.username, password: ai.password } });
  expect(r.ok(), `login: ${r.status()}`).toBe(true);
}
const nut = (id: string, type: string, parameters: Record<string, unknown>) => ({ id, type, typeVersion: 1, name: id, position: [0, 0], parameters });

test("1 — kỹ sư A dựng luồng (người nhận + chữ tự do nhắc nhà máy A) và bấm Xuất ⇒ hộp xem trước có cảnh báo vị trí + việc phải điền", async ({ page }) => {
  await dangNhap(page, fx.mot);
  flowId = `fse2e-xuat-${Date.now().toString(36)}`;
  const r = await page.context().request.post(`${base}/api/trpc/flow.luu`, {
    data: {
      json: {
        definition: {
          id: flowId, name: "Luồng xuất thử", version: 1, settings: { uuTien: "background", luuDuLieu: "day-du" },
          nodes: [
            nut("t", "kich-hoat.thu-cong", {}),
            nut("tb", "tich-hop.thong-bao", { nguoiNhan: [fx.mot.id], tieuDe: "Báo cáo", noiDung: `Gửi từ nhà máy ${fx.nhaMayA.code}` }),
            nut("tp", "bao-tri.tao-phieu", { may: "{{ $json.idMay }}", tieuDe: "{{ $json.lyDo }}", nhom: "dien" }),
          ],
          connections: [{ from: { node: "t", port: "main" }, to: { node: "tb", port: "main" } }],
        },
      },
    },
  });
  expect(r.ok(), await r.text()).toBe(true);
  await page.goto(`${base}/ai-flows/${flowId}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("nut-xuat").click();
  await expect(page.getByTestId("hop-xuat")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("xuat-canh-bao-tb").first()).toContainText(fx.nhaMayA.code); // nhà máy A nhắc trong nội dung thông báo (mã nhà máy trùng mã máy trong fixture ⇒ có thể 2 cảnh báo)
  await expect(page.getByTestId("xuat-canh-bao-tb").first()).toContainText("parameters.noiDung");
  await expect(page.getByTestId("xuat-viec")).toContainText("tb"); // người nhận phải chọn lại
  if (process.env.FHT_SHOT_DIR) await page.screenshot({ path: `${process.env.FHT_SHOT_DIR}/x1-hop-xuat.png` });
});

test("2 — tải gói về: gói KHÔNG chứa id luồng / người nhận / bí mật; cảnh báo không nằm trong gói; có băm", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-flows/${flowId}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("nut-xuat").click();
  await expect(page.getByTestId("hop-xuat")).toBeVisible({ timeout: 30_000 });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("xuat-tai-ve").click()]);
  tepGoi = path.join(THU_MUC, "goi.luong-ai.json");
  await dl.saveAs(tepGoi);
  const chu = fs.readFileSync(tepGoi, "utf8");
  goi = JSON.parse(chu);
  expect(goi.dinhDang).toBe("luong-ai/1");
  expect(chu).not.toContain(flowId);
  expect(chu).not.toContain("canhBao");
  expect(typeof goi.bam).toBe("string");
  const tb = goi.luong.nodes.find((n) => n.id === "tb")!;
  expect(tb.parameters.nguoiNhan).toEqual([]);
  expect(goi.luong.nodes.some((n) => n.credentialRef !== undefined)).toBe(false);
  expect(dl.suggestedFilename()).toMatch(/\.luong-ai\.json$/);
});

test("3 — kỹ sư B (chỉ nhà máy B) tải gói lên ⇒ xem trước ⇒ nhập ⇒ luồng MỚI thuộc nhà máy B, TẮT, người nhận trống", async ({ page }) => {
  await dangNhap(page, fx.banB);
  await page.goto(`${base}/ai-flows`);
  await page.getByTestId("nhap-tep").setInputFiles(tepGoi);
  await expect(page.getByTestId("hop-nhap")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("nhap-viec")).toContainText("tb", { timeout: 30_000 });
  await expect(page.getByTestId("nhap-canh-bao-bam-lech")).toHaveCount(0);
  await expect(page.getByTestId("nhap-canh-bao-bam-thieu")).toHaveCount(0);
  await page.getByTestId("nhap-ten").fill("Luồng nhập từ A");
  if (process.env.FHT_SHOT_DIR) await page.screenshot({ path: `${process.env.FHT_SHOT_DIR}/x3-hop-nhap.png` });
  await page.getByTestId("nhap-xac-nhan").click();
  await page.waitForURL(/\/ai-flows\/(?!duyet)[^/]+$/, { timeout: 30_000 });
  const moi = decodeURIComponent(page.url().split("/").pop()!);
  expect(moi).not.toBe(flowId);
  const [f] = await withTestDb((sql) => sql`SELECT "factoryId", enabled, "activeVersion" FROM ai_flows WHERE id = ${moi}`);
  expect(f.factoryId).toBe(fx.nhaMayB.id);
  expect(f.enabled).toBe(false);
  const [v] = await withTestDb((sql) => sql`SELECT definition FROM ai_flow_versions WHERE "flowId" = ${moi} AND version = 1`);
  const nodes = (v.definition as { nodes: { id: string; parameters: Record<string, unknown> }[] }).nodes;
  expect(nodes.find((n) => n.id === "tb")!.parameters.nguoiNhan).toEqual([]);
  expect(JSON.stringify(v.definition)).not.toContain(flowId);
});

test("4 — gói sửa tay ⇒ chỉ cảnh báo băm lệch; định dạng lạ ⇒ lỗi rõ, không nhập được; máy chủ không tin giao diện (chỉ-A gọi thẳng flow.nhap vào B ⇒ từ chối)", async ({ page }) => {
  await dangNhap(page, fx.banB);
  await page.goto(`${base}/ai-flows`);
  const sua = { ...goi, luong: { ...goi.luong, name: "Đã sửa tay" } };
  const tepSua = path.join(THU_MUC, "sua.luong-ai.json");
  fs.writeFileSync(tepSua, JSON.stringify(sua));
  await page.getByTestId("nhap-tep").setInputFiles(tepSua);
  await expect(page.getByTestId("nhap-canh-bao-bam-lech")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("nhap-xac-nhan")).toBeEnabled();
  await page.keyboard.press("Escape");
  const tepLa = path.join(THU_MUC, "la.luong-ai.json");
  fs.writeFileSync(tepLa, JSON.stringify({ ...goi, dinhDang: "luong-ai/9" }));
  await page.getByTestId("nhap-tep").setInputFiles(tepLa);
  await expect(page.getByTestId("nhap-loi")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("nhap-xac-nhan")).toBeDisabled();
  await page.keyboard.press("Escape");

  const ctxA = await page.context().browser()!.newContext();
  expect((await ctxA.request.post(`${base}/api/auth/login`, { data: { username: fx.mot.username, password: fx.mot.password } })).ok()).toBe(true);
  const r = await ctxA.request.post(`${base}/api/trpc/flow.nhap`, { data: { json: { goi, ten: "Sang B trái phép", factoryId: fx.nhaMayB.id } } });
  expect(r.status()).toBeGreaterThanOrEqual(400);
  const [dem] = await withTestDb((sql) => sql`SELECT count(*)::int AS n FROM ai_flows WHERE name = 'Sang B trái phép'`);
  expect(dem.n).toBe(0);
  await ctxA.close();
});
