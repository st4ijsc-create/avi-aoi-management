/**
 * Đợt 10.4b (L1) — e2e production (cổng riêng 3049, DB test) của /ai-chat với MODEL NGOÀI, nhà cung cấp GIẢ (`openai_compat` → máy chủ HTTP giả trong tiến trình test;
 * không mạng ngoài, không GPU):
 *   1. Nhà máy bật AI ngoài nhưng CHƯA cho dữ liệu vận hành ⇒ ô chọn có "Model ngoài"; chọn ⇒ hộp đồng ý nói "chưa", nút đồng ý KHOÁ, ô giữ model cũ.
 *   2. Admin cho dữ liệu vận hành ⇒ chọn ⇒ hộp đồng ý mở được ⇒ Đồng ý ⇒ ô đổi; gửi câu hỏi ⇒ hộp xác nhận vận hành (428) ⇒ Đồng ý ⇒ trả lời hiện kèm nhãn + huy hiệu.
 *   3. Câu trả lời độc (liên kết javascript:, ảnh markdown, HTML thô, khối mã) hiển thị như CHỮ: không <a>/<img> sống, KHÔNG yêu cầu tới máy chủ giả ngoài POST /chat/completions.
 *   4. Máy chủ TỰ lưu lượt: đúng 2 tin (người dùng + trợ lý), tin trợ lý mang nguonModel; tải lại trang vẫn render bằng bộ an toàn + huy hiệu (không trùng tin).
 *   5. AI ngoài KHÔNG nhận công cụ / ảnh; lượt hai trong CÙNG hội thoại không hỏi lại gì.
 * Chạy: `npm run build` rồi `npx playwright test --config=playwright.flowhanhtrinh.config.ts ai-chat-model-ngoai-ky-su.spec.ts`.
 */
import { test, expect, request as pwRequest, type Page } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { withTestDb, type FsFixture } from "./flow-studio/fixtures";

test.skip(process.env.FHT_E2E !== "1", "FHT e2e chạy riêng dưới playwright.flowhanhtrinh.config.ts");
test.describe.configure({ mode: "serial" });

let fx: FsFixture;
let base = "";
const MA_NGOAI = "ngoai:openai_compat:fake-1";
const nhan = { goi: [] as Array<Record<string, any>>, truyCapLa: 0, cong: 0 };
let may: http.Server;
const TRA_LOI_DOC = (cong: number) =>
  `Xin chào. [bấm](javascript:alert(1)) ![x](http://127.0.0.1:${cong}/leak?c=ABC) <img src=x onerror=alert(1)>\n\n\`\`\`sh\nrm -rf /tmp/x\n\`\`\``;

function dungMayGia(): Promise<void> {
  return new Promise((ok) => {
    may = http.createServer((req, res) => {
      if (req.method === "GET") {
        nhan.truyCapLa++; // bất kỳ GET nào (vd /leak) = có ai tự tải thứ trong câu trả lời
        res.statusCode = 404;
        res.end();
        return;
      }
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        nhan.goi.push(JSON.parse(b || "{}") as Record<string, any>);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: TRA_LOI_DOC(nhan.cong) } }], usage: { prompt_tokens: 120, completion_tokens: 60 } }));
      });
    });
    may.listen(0, "127.0.0.1", () => {
      nhan.cong = (may.address() as AddressInfo).port;
      ok();
    });
  });
}

const cookieNguoi = new Map<string, Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>>();
async function dangNhapReq(req: { post: (u: string, o: { data: unknown }) => Promise<{ ok: () => boolean; status: () => number }> }, ai: { username: string; password: string }): Promise<void> {
  let st = 0;
  for (let lan = 0; lan < 8; lan++) {
    const r = await req.post(`${base}/api/auth/login`, { data: { username: ai.username, password: ai.password } });
    st = r.status();
    if (r.ok()) return;
    if (st !== 429) break;
    await new Promise((ok) => setTimeout(ok, 15_000));
  }
  expect(false, `login: ${st}`).toBe(true);
}
async function dangNhap(page: Page, ai: { username: string; password: string }): Promise<void> {
  await page.context().addInitScript(() => {
    try {
      localStorage.setItem("i18nextLng", "vi");
    } catch {
      /* */
    }
  });
  const co = cookieNguoi.get(ai.username);
  if (co) {
    await page.context().addCookies(co);
    return;
  }
  await dangNhapReq(page.context().request, ai);
  cookieNguoi.set(ai.username, await page.context().cookies());
}
const post = async (page: Page, proc: string, input: unknown) => {
  const r = await page.context().request.post(`${base}/api/trpc/${proc}`, { data: { json: input } });
  return { status: r.status(), json: (await r.json().catch(() => null)) as any };
};
const dl = (r: { json: any }) => r.json?.result?.data?.json;
const cauHinh = (F: number, choDuLieuVanHanh: boolean) => ({
  factoryId: F, batNgoai: true, choDuLieuVanHanh, luuNguyenVan: false, hanGiuNgay: 30,
  tranTokenNgay: null, tranTienNgayUsd: null, tranTokenNguoiNgay: null, tranTokenLuongNgay: null, tranTokenLuot: null, tranLanPhut: 60,
});

test.beforeAll(async () => {
  fx = JSON.parse(fs.readFileSync(process.env.FHT_STATE!, "utf8")) as FsFixture;
  base = process.env.FHT_BASE_URL!;
  await dungMayGia();
  // đặt lại trạng thái nhà máy A (lượt chạy trước có thể đã bật) rồi cấu hình: host nội bộ · khoá · model · bật AI ngoài, CHƯA cho dữ liệu vận hành
  const ctx = await pwRequest.newContext();
  try {
    await dangNhapReq(ctx, fx.admin);
    const p = async (proc: string, input: unknown) => {
      const r = await ctx.post(`${base}/api/trpc/${proc}`, { data: { json: input } });
      return { status: r.status(), json: (await r.json().catch(() => null)) as any };
    };
    const F = fx.nhaMayA.id;
    expect((await p("aiNgoai.datHostNoiBo", { factoryId: F, hostCong: `127.0.0.1:${nhan.cong}` })).status).toBe(200);
    const khoa = await p("aiNgoai.taoKhoa", { factoryId: F, nhaCungCap: "openai_compat", ten: "e2e-chat", khoa: "sk-fse2e-" + "b".repeat(24), endpoint: `http://127.0.0.1:${nhan.cong}` });
    expect(khoa.status, JSON.stringify(khoa.json).slice(0, 300)).toBe(200);
    const mo = await p("aiNgoai.datModel", { factoryId: F, nhaCungCap: "openai_compat", model: "fake-1", nhan: "Fake 1", keyId: dl(khoa).id as number, giaVaoUsdTrieu: null, giaRaUsdTrieu: null, tranTokenLuot: 200000, batModel: true });
    expect(mo.status, JSON.stringify(mo.json).slice(0, 600)).toBe(200);
    expect((await p("aiNgoai.ghiCauHinh", cauHinh(F, false))).status).toBe(200);
  } finally {
    await ctx.dispose();
  }
});
test.afterAll(async () => {
  await new Promise<void>((r) => may.close(() => r()));
});

const o = (page: Page) => page.getByTestId("chon-model-chat");

test("1 — chưa cho dữ liệu vận hành: có mục Model ngoài; chọn ⇒ hộp đồng ý nói 'chưa', nút đồng ý KHOÁ; Từ chối ⇒ ô giữ nguyên", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-chat`);
  await expect(o(page).locator(`option[value="${MA_NGOAI}"]`)).toHaveCount(1, { timeout: 30_000 });
  await expect(o(page).locator(`option[value="${MA_NGOAI}"]`)).toContainText("ngoài · gửi dữ liệu ra openai_compat");
  await o(page).selectOption(MA_NGOAI);
  await expect(page.getByTestId("hop-dong-y-ngoai")).toBeVisible();
  await expect(page.getByTestId("hdy-nha-may-cho")).toContainText("chưa");
  await expect(page.getByTestId("hdy-dong-y")).toBeDisabled();
  await expect(page.getByTestId("hdy-nguoi-go")).toContainText("DỮ LIỆU VẬN HÀNH");
  await expect(page.getByTestId("hdy-tran-nha-may-so")).toHaveCount(0); // người thường không thấy số của nhà máy
  await page.getByTestId("hdy-tu-choi").click();
  await expect(o(page)).toHaveValue("auto");
  expect(nhan.goi.length).toBe(0);
});

test("2–5 — cho dữ liệu vận hành: đồng ý ⇒ 428 ⇒ xác nhận ⇒ trả lời an toàn; máy chủ tự lưu 2 tin; không công cụ/ảnh; lượt hai không hỏi lại", async ({ page }) => {
  const adm = await page.context().browser()!.newPage();
  try {
    await dangNhap(adm, fx.admin);
    expect((await post(adm, "aiNgoai.ghiCauHinh", cauHinh(fx.nhaMayA.id, true))).status).toBe(200);
  } finally {
    await adm.close();
  }
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-chat`);
  await expect(o(page).locator(`option[value="${MA_NGOAI}"]`)).toHaveCount(1, { timeout: 30_000 });
  await o(page).selectOption(MA_NGOAI);
  await expect(page.getByTestId("hdy-dong-y")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("hdy-dong-y").click();
  await expect(o(page)).toHaveValue(MA_NGOAI);

  const cau = `e2e ngoai ${Date.now().toString(36)}`;
  const o_nhap = page.getByPlaceholder(/Hỏi bất cứ điều gì/i);
  await o_nhap.fill(cau);
  await o_nhap.press("Enter");
  // 428 ⇒ hộp xác nhận vận hành; chưa có lời gọi nào ra nhà cung cấp
  await expect(page.getByTestId("hop-xac-nhan-van-hanh")).toBeVisible({ timeout: 30_000 });
  expect(nhan.goi.length).toBe(0);
  await page.getByTestId("xnvh-dong-y").click();
  await expect(page.getByTestId("noi-dung-tra-loi-ngoai").first()).toContainText("Xin chào", { timeout: 60_000 });
  await expect(page.getByTestId("nhan-ngoai").first()).toContainText("openai_compat");
  expect(nhan.goi.length).toBe(1);

  // an toàn hiển thị: không <a>/<img> sống trong khối trả lời, không GET tới máy chủ giả
  const kh = page.getByTestId("noi-dung-tra-loi-ngoai").first();
  await expect(kh.locator("a, img, script, iframe")).toHaveCount(0);
  await expect(kh).toContainText("<img src=x onerror=alert(1)>"); // HTML thô = chữ
  await expect(kh.locator("[data-ngoai-lien-ket]").first()).toContainText("liên kết bị chặn");
  await expect(kh.locator("[data-ngoai-anh]").first()).toContainText("ảnh bị chặn");
  await expect(kh.locator("button[data-ngoai-chep]")).toHaveCount(1);
  expect(nhan.truyCapLa).toBe(0);

  // AI ngoài không nhận công cụ / ảnh; câu gõ có mặt (đã che bí mật nếu có)
  const yc = nhan.goi[0]!;
  expect(yc.tools ?? null).toBeNull();
  expect(JSON.stringify(yc)).not.toContain("data:image");
  expect(JSON.stringify(yc.messages)).toContain(cau);

  // máy chủ TỰ lưu: đúng 2 tin; tin trợ lý mang nguonModel
  const conv = await withTestDb(async (sql) => sql`SELECT id FROM ai_chat_conversations WHERE "userId" = ${fx.mot.id} ORDER BY id DESC LIMIT 1`);
  const hang = await withTestDb(async (sql) => sql`SELECT role::text AS role, "nguonModel" AS nguon FROM ai_chat_messages WHERE "conversationId" = ${Number(conv[0]!.id)} ORDER BY id`);
  expect(hang.map((h: any) => h.role)).toEqual(["user", "assistant"]);
  expect(hang[1]!.nguon).toBe(MA_NGOAI);
  expect(hang[0]!.nguon).toBeNull();

  // tải lại: render từ lịch sử vẫn bằng bộ an toàn + huy hiệu; không trùng tin
  await page.reload();
  await page.getByText(cau.slice(0, 30), { exact: false }).first().click({ timeout: 60_000 });
  await expect(page.getByTestId("noi-dung-tra-loi-ngoai").first()).toContainText("Xin chào", { timeout: 30_000 });
  await expect(page.getByTestId("nhan-ngoai")).toHaveCount(1);
  await expect(page.getByTestId("noi-dung-tra-loi-ngoai")).toHaveCount(1);

  // lượt hai cùng hội thoại: không hộp nào; thêm 2 tin (tổng 4)
  await o(page).selectOption(MA_NGOAI).catch(() => undefined);
  await page.getByPlaceholder(/Hỏi bất cứ điều gì/i).fill("câu hai");
  await page.getByPlaceholder(/Hỏi bất cứ điều gì/i).press("Enter");
  await expect(page.getByTestId("noi-dung-tra-loi-ngoai")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId("hop-xac-nhan-van-hanh")).toHaveCount(0);
  const hang2 = await withTestDb(async (sql) => sql`SELECT count(*)::int AS n FROM ai_chat_messages WHERE "conversationId" = ${Number(conv[0]!.id)}`);
  expect(hang2[0]!.n).toBe(4);
});
