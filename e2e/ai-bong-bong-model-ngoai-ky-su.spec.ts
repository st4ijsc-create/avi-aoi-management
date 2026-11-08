/**
 * Đợt 10.4b (L4) — e2e production (cổng riêng 3049, DB test) của BONG BÓNG trợ lý với MODEL NGOÀI, nhà cung cấp GIẢ (`openai_compat` → máy chủ HTTP giả trong tiến trình test;
 * không mạng ngoài, không GPU):
 *   0. TÁI HIỆN lỗi trước khi sửa (điều kiện dieu-phoi): chọn model ngoài ở bong bóng ⇒ /api/ai/local-kb/stream trả 400/404 (không có conversationId) — ghi mã lỗi.
 *   1. Sau sửa: cùng ca ⇒ hộp đồng ý ⇒ 428 ⇒ xác nhận ⇒ trả lời an toàn + huy hiệu; hội thoại THẬT (2 tin) trong lịch sử; thân tới nhà cung cấp giả KHÔNG tools/ảnh/ngữ cảnh trang.
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

const o = (page: Page) => page.getByTestId("chon-model-bong-bong");

/** Máy chủ test không có KB/GPU ⇒ `aiLocalKb.health.ready=false` ⇒ bong bóng khoá ô nhập. Chỉ sửa MỤC health trong lô tRPC, mọi thứ khác đi thật. */
async function lamBongBongSanSang(page: Page): Promise<void> {
  await page.route("**/api/trpc/**", async (route) => {
    const url = route.request().url();
    const proc = decodeURIComponent(new URL(url).pathname.split("/api/trpc/")[1] ?? "").split(",");
    const idx = proc.indexOf("aiLocalKb.health");
    if (idx < 0) return route.continue();
    const res = await route.fetch();
    const body = (await res.json().catch(() => null)) as unknown;
    if (Array.isArray(body) && body[idx]) {
      body[idx] = { result: { data: { json: { ready: true, staleDays: 0, chunkCount: 1, status: "ready" } } } };
      return route.fulfill({ response: res, json: body });
    }
    return route.fulfill({ response: res });
  });
}
async function moBongBong(page: Page): Promise<void> {
  await page.goto(`${base}/`);
  const nut = page.getByRole("button", { name: "Trợ lý AI" }).last();
  await nut.click({ timeout: 60_000 });
  await expect(o(page)).toBeVisible({ timeout: 30_000 });
}
const oNhapBB = (page: Page) => page.getByPlaceholder(/Nhập câu hỏi/i);

/*
 * TÁI HIỆN (chạy TRƯỚC khi sửa, 2026-11-03, build 7a09224ec): chọn model ngoài ở bong bóng ⇒ POST /api/ai/local-kb/stream = 400 `NGOAI_THIEU_HOI_THOAI`,
 * rồi bong bóng rơi sang POST /api/ai/local-kb/ask = 404 `modelNgoaiKhongTonTaiHoacNgoaiPhamVi`; 0 lượt tới nhà cung cấp. Ca dưới đây là CÙNG ca đó, SAU sửa.
 */
test("1 — bong bóng + model ngoài: đồng ý ⇒ 428 ⇒ xác nhận ⇒ trả lời an toàn; hội thoại THẬT 2 tin; thân tới nhà cung cấp không tools/ngữ cảnh trang; có nút kiểm định", async ({ page }) => {
  const adm = await page.context().browser()!.newPage();
  try {
    await dangNhap(adm, fx.admin);
    expect((await post(adm, "aiNgoai.ghiCauHinh", cauHinh(fx.nhaMayA.id, true))).status).toBe(200);
  } finally {
    await adm.close();
  }
  await dangNhap(page, fx.mot);
  await lamBongBongSanSang(page);
  const goiLocalKb: Array<{ url: string; status: number }> = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/ai/local-kb/")) goiLocalKb.push({ url: r.url().replace(base, ""), status: r.status() });
  });
  await moBongBong(page);
  await expect(o(page).locator(`option[value="${MA_NGOAI}"]`)).toHaveCount(1, { timeout: 30_000 });
  const truoc = (await withTestDb(async (sql) => sql`SELECT count(*)::int AS n FROM ai_chat_conversations WHERE "userId" = ${fx.mot.id}`))[0]!.n as number;
  await o(page).selectOption(MA_NGOAI);
  await expect(page.getByTestId("hdy-dong-y")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("hdy-dong-y").click();
  await expect(o(page)).toHaveValue(MA_NGOAI);
  // chọn model KHÔNG tạo hội thoại
  expect((await withTestDb(async (sql) => sql`SELECT count(*)::int AS n FROM ai_chat_conversations WHERE "userId" = ${fx.mot.id}`))[0]!.n).toBe(truoc);

  const cau = `bong bong ngoai ${Date.now().toString(36)}`;
  await oNhapBB(page).fill(cau);
  await oNhapBB(page).press("Enter");
  await expect(page.getByTestId("hop-xac-nhan-van-hanh")).toBeVisible({ timeout: 30_000 });
  expect(nhan.goi.length).toBe(0);
  await page.getByTestId("xnvh-dong-y").click();
  const kh = page.getByTestId("noi-dung-tra-loi-ngoai").first();
  await expect(kh).toContainText("Xin chào", { timeout: 60_000 });
  await expect(page.getByTestId("huy-hieu-ngoai").first()).toContainText("openai_compat");
  expect(nhan.goi.length).toBe(1);
  // sau sửa: không còn 400/404 nào ở local-kb, và KHÔNG rơi sang /ask
  expect(goiLocalKb.filter((g) => g.status >= 400), JSON.stringify(goiLocalKb)).toEqual([{ url: "/api/ai/local-kb/stream", status: 428 }]);
  expect(goiLocalKb.some((g) => g.url.includes("/ask"))).toBe(false);

  // an toàn hiển thị
  await expect(kh.locator("a, img, script, iframe")).toHaveCount(0);
  await expect(kh).toContainText("<img src=x onerror=alert(1)>");
  expect(nhan.truyCapLa).toBe(0);

  // thân tới nhà cung cấp: không công cụ/ảnh; có câu gõ; KHÔNG tên trang / đính kèm
  const yc = nhan.goi[0]!;
  expect(yc.tools ?? null).toBeNull();
  const thanh = JSON.stringify(yc);
  expect(thanh).not.toContain("data:image");
  expect(JSON.stringify(yc.messages)).toContain(cau);

  // hội thoại THẬT: tạo ở tin ngoài đầu tiên, đúng 2 tin, tin trợ lý mang nguonModel
  const conv = await withTestDb(async (sql) => sql`SELECT id FROM ai_chat_conversations WHERE "userId" = ${fx.mot.id} ORDER BY id DESC LIMIT 1`);
  expect((await withTestDb(async (sql) => sql`SELECT count(*)::int AS n FROM ai_chat_conversations WHERE "userId" = ${fx.mot.id}`))[0]!.n).toBe(truoc + 1);
  const hang = await withTestDb(async (sql) => sql`SELECT role::text AS role, "nguonModel" AS nguon FROM ai_chat_messages WHERE "conversationId" = ${Number(conv[0]!.id)} ORDER BY id`);
  expect(hang.map((h: any) => h.role)).toEqual(["user", "assistant"]);
  expect(hang[1]!.nguon).toBe(MA_NGOAI);

  // nút kiểm định ở bong bóng (nhánh chat, lượt đã lưu)
  await expect(page.getByTestId("nut-kiem-dinh-ngoai").first()).toBeEnabled();
});
