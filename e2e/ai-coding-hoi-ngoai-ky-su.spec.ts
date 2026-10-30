/**
 * Đợt 10.4b (L2) — e2e production (cổng 3049, DB test) của MÀN LẬP TRÌNH, chế độ HỎI với MODEL NGOÀI, nhà cung cấp GIẢ (`openai_compat` → máy chủ HTTP giả trong tiến trình test):
 *   1. Chọn model ngoài ⇒ hộp đồng ý; sau đó chế độ KHOÁ ở Hỏi (các chế độ agent bị vô hiệu) + dòng "chỉ đọc".
 *   2. Lượt ĐẦU (ky-thuat) KHÔNG cần nhà máy cho dữ liệu vận hành, không 428: model ngoài gọi công cụ ĐỌC (đúng 3 công cụ đọc được quảng bá) ⇒ trả lời hiện bằng bộ render an toàn (liên kết/ảnh chặn).
 *   3. Lượt HAI (lịch sử = van-hanh) khi nhà máy CHƯA cho ⇒ lỗi rõ, câu hỏi trả về ô nhập, KHÔNG gọi nhà cung cấp.
 *   4. Cho dữ liệu vận hành ⇒ lượt hai ⇒ hộp xác nhận (428) ⇒ đồng ý ⇒ trả lời.
 *   5. Phiên được lưu kèm dấu nguồn: ai_coding_sessions.coLuotNgoai = true (máy chủ xác minh callId); mở lại phiên ⇒ lượt assistant vẫn vẽ bằng bộ an toàn.
 * Chạy: `npm run build` rồi `npx playwright test --config=playwright.flowhanhtrinh.config.ts ai-coding-hoi-ngoai-ky-su.spec.ts`.
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
const MA_NGOAI = "ngoai:openai_compat:fake-code";
const nhan = { goi: [] as Array<Record<string, any>>, truyCapLa: 0, cong: 0 };
let may: http.Server;
const TRA_LOI = (cong: number) => `Hàm này ổn. [bấm](javascript:alert(1)) ![x](http://127.0.0.1:${cong}/leak?c=ABC) <img src=x onerror=alert(1)>`;

function dungMayGia(): Promise<void> {
  return new Promise((ok) => {
    may = http.createServer((req, res) => {
      if (req.method === "GET") {
        nhan.truyCapLa++;
        res.statusCode = 404;
        res.end();
        return;
      }
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        const j = JSON.parse(b || "{}") as Record<string, any>;
        nhan.goi.push(j);
        // máy chủ đưa kết quả công cụ vào danh sách tin (không dùng role "tool" của nhà cung cấp): đã có lượt đọc `package.json` trong ngữ cảnh ⇒ trả lời
        const daCoKetQuaTool = JSON.stringify(j.messages ?? []).includes("package.json");
        const message =
          Array.isArray(j.tools) && j.tools.length > 0 && !daCoKetQuaTool
            ? { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "package.json" }) } }] }
            : { role: "assistant", content: TRA_LOI(nhan.cong) };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 40 } }));
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
  // kỹ sư `mot` cần quyền đọc repo (như mig 0330/0331 cấp cho kỹ sư)
  await withTestDb(async (sql) => {
    await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${fx.mot.id}, 'machine_monitoring', 'ai_repo_read', true, false, false, false) ON CONFLICT DO NOTHING`;
  });
  const ctx = await pwRequest.newContext();
  try {
    await dangNhapReq(ctx, fx.admin);
    const p = async (proc: string, input: unknown) => {
      const r = await ctx.post(`${base}/api/trpc/${proc}`, { data: { json: input } });
      return { status: r.status(), json: (await r.json().catch(() => null)) as any };
    };
    const F = fx.nhaMayA.id;
    expect((await p("aiNgoai.datHostNoiBo", { factoryId: F, hostCong: `127.0.0.1:${nhan.cong}` })).status).toBe(200);
    const khoa = await p("aiNgoai.taoKhoa", { factoryId: F, nhaCungCap: "openai_compat", ten: "e2e-code", khoa: "sk-fse2e-" + "c".repeat(24), endpoint: `http://127.0.0.1:${nhan.cong}` });
    expect(khoa.status, JSON.stringify(khoa.json).slice(0, 300)).toBe(200);
    const mo = await p("aiNgoai.datModel", { factoryId: F, nhaCungCap: "openai_compat", model: "fake-code", nhan: "Fake Code", keyId: dl(khoa).id as number, giaVaoUsdTrieu: null, giaRaUsdTrieu: null, tranTokenLuot: 200000, batModel: true });
    expect(mo.status, JSON.stringify(mo.json).slice(0, 600)).toBe(200);
    expect((await p("aiNgoai.ghiCauHinh", cauHinh(F, false))).status).toBe(200);
  } finally {
    await ctx.dispose();
  }
});
test.afterAll(async () => {
  await new Promise<void>((r) => may.close(() => r()));
});

const o = (page: Page) => page.getByTestId("chon-model-lap-trinh");
const oNhap = (page: Page) => page.locator("[data-o-nhap] textarea");
async function gui(page: Page, cau: string): Promise<void> {
  await oNhap(page).fill(cau);
  await oNhap(page).press("Enter");
}

test("1–5 — Hỏi với model ngoài ở màn lập trình: khoá chế độ, lượt đầu không 428, lượt hai theo dữ liệu vận hành, phiên mang dấu nguồn", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await page.goto(`${base}/ai-coding-workspace`);
  await expect(o(page).locator(`option[value="${MA_NGOAI}"]`)).toHaveCount(1, { timeout: 60_000 });
  await o(page).selectOption(MA_NGOAI);
  await expect(page.getByTestId("hdy-dong-y")).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByTestId("hdy-coding")).toContainText("lượt hai");
  await page.getByTestId("hdy-dong-y").click();
  await expect(o(page)).toHaveValue(MA_NGOAI);
  // (1) khoá ở Hỏi
  await expect(page.getByTestId("ngoai-chi-hoi")).toBeVisible();
  for (const r of await page.getByRole("radio").all()) {
    const chon = (await r.getAttribute("aria-checked")) === "true";
    if (!chon) await expect(r).toBeDisabled();
  }

  // (2) lượt đầu: không 428, có vòng đọc
  const cau1 = `e2e hoi ngoai ${Date.now().toString(36)}`;
  await gui(page, cau1);
  const kh = page.getByTestId("noi-dung-tra-loi-ngoai").first();
  await expect(kh).toContainText("Hàm này ổn", { timeout: 90_000 });
  await expect(page.getByTestId("hop-xac-nhan-van-hanh")).toHaveCount(0);
  expect(nhan.goi.length).toBe(2); // vòng 1: model đòi read_file ⇒ vòng 2: trả lời
  const ten = (nhan.goi[0]!.tools as Array<{ function: { name: string } }>).map((t) => t.function.name).sort();
  expect(ten).toEqual(["grep_repo", "list_files", "read_file"]);
  expect(JSON.stringify(nhan.goi[0]!)).not.toContain("data:image");
  await expect(kh.locator("a, img, script, iframe")).toHaveCount(0);
  await expect(kh).toContainText("<img src=x onerror=alert(1)>");
  expect(nhan.truyCapLa).toBe(0);

  // (3) lượt hai khi nhà máy CHƯA cho dữ liệu vận hành ⇒ không gọi nhà cung cấp, câu hỏi trả về ô nhập
  const truoc = nhan.goi.length;
  await gui(page, "câu hai");
  await expect(oNhap(page)).toHaveValue("câu hai", { timeout: 30_000 });
  expect(nhan.goi.length).toBe(truoc);

  // (4) cho dữ liệu vận hành ⇒ 428 ⇒ xác nhận ⇒ trả lời
  const adm = await page.context().browser()!.newPage();
  try {
    await dangNhap(adm, fx.admin);
    expect((await post(adm, "aiNgoai.ghiCauHinh", cauHinh(fx.nhaMayA.id, true))).status).toBe(200);
  } finally {
    await adm.close();
  }
  await oNhap(page).press("Enter");
  await expect(page.getByTestId("hop-xac-nhan-van-hanh")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("xnvh-dong-y").click();
  await expect(page.getByTestId("noi-dung-tra-loi-ngoai")).toHaveCount(2, { timeout: 90_000 });

  // (5) phiên lưu kèm dấu nguồn do MÁY CHỦ xác minh
  await expect
    .poll(
      async () => (await withTestDb(async (sql) => sql`SELECT "coLuotNgoai" AS c FROM ai_coding_sessions WHERE "userId" = ${fx.mot.id} ORDER BY "updatedAt" DESC LIMIT 1`))[0]?.c,
      { timeout: 30_000 },
    )
    .toBe(true);
});
