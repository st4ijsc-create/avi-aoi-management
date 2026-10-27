/**
 * Đợt 10.4 (T6) — e2e production (cổng riêng 3049, DB test) của KIỂM ĐỊNH BỞI AI NGOÀI với NHÀ CUNG CẤP GIẢ (`openai_compat` → máy chủ HTTP giả trong tiến trình test,
 * `host:cổng` khai vào `ai_ngoai_host_noi_bo`; không mạng ngoài, không GPU):
 *   1. Nhà máy TẮT ⇒ không có nút kiểm định ở /ai-chat.
 *   2. Admin cấu hình qua API (host nội bộ · khoá · model · bật nhà máy) ⇒ nút hiện; chat luôn `van-hanh` ⇒ nhà máy chưa cho dữ liệu vận hành ⇒ nút gửi KHOÁ + lý do; gọi thẳng thủ tục ⇒ 403.
 *   3. Cho phép dữ liệu vận hành ⇒ gửi được; AI ngoài KHÔNG nhận bí mật (đã che) và KHÔNG có công cụ; kết quả hiển thị.
 *   4. Chuỗi độc (HTML/markdown ảnh/liên kết, đường dẫn giả) hiển thị NGUYÊN VĂN; không yêu cầu tới máy chủ giả ngoài `/chat/completions` (markdown ảnh không tự tải).
 *   5. Model trả JSON sai ⇒ thử lại đúng 1 lần (2 lời gọi) ⇒ lỗi rõ, UI không vỡ.
 *   6. Bấm đúp ⇒ MỘT lời gọi.
 *   7. Người ngoài phạm vi / không phải chủ lượt ⇒ 404.
 *   8. Nguồn agent (chỉ tool đọc mã ⇒ ky-thuat) và coding (van-hanh) qua API xemTruoc.
 *   9. Luồng có node `ai.kiem-dinh-ngoai`: bảng duyệt hiện node, nút Bật khoá khi chưa duyệt; admin duyệt ⇒ bật ⇒ chạy tay ⇒ đầu ra `kiemDinh` đúng schema.
 * Chạy: `npm run build` rồi `npx playwright test --config=playwright.flowhanhtrinh.config.ts flow-kiem-dinh-ngoai-ky-su.spec.ts` (×3: `--repeat-each=3`).
 */
import { test, expect, request as pwRequest, type Page } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { withTestDb, type FsFixture } from "./flow-studio/fixtures";

test.skip(process.env.FHT_E2E !== "1", "FHT e2e chạy riêng dưới playwright.flowhanhtrinh.config.ts");
test.describe.configure({ mode: "serial" });

let fx: FsFixture;
let base = "";
const DUOI = Date.now().toString(36);
const BI_MAT_KHOA = "sk-proj-ABCDEF1234567890abcdefghijklmnop";
const BI_MAT_MK = "Sup3rSecret!x9";
// Mỗi LƯỢT lặp (`--repeat-each`) có tên/ID RIÊNG + trạng thái nhà máy đặt lại ở beforeAll ⇒ chạy lặp được.
let TIEU_DE = "";
let F_LUONG = "";

// ─── nhà cung cấp GIẢ ────────────────────────────────────────────────────────────────────────────
const nhan = { goi: [] as Array<Record<string, any>>, truyCapLa: 0, cong: 0 };
let may: http.Server;
const KET_QUA_TOT = { ketLuan: "can-sua", diem: 61, banChuanHoa: "echo ok", loi: [{ muc: "vua", moTa: "Thiếu kiểm tra null", viTri: "src/a.cs:3" }], baiHocDeXuat: [{ noiDung: "Luôn kiểm null", phamVi: "du-an" }] };
const KET_QUA_DOC = {
  ketLuan: "sai",
  diem: 5,
  banChuanHoa: `<img src=x onerror=alert(1)>\n![x](http://127.0.0.1:__PORT__/leak?c=ABC)\n[a](javascript:alert(1))`,
  loi: [{ muc: "nghiem-trong", moTa: "<script>alert(1)</script>", viTri: "../../etc/passwd" }],
  baiHocDeXuat: [],
};

function dungMayGia(): Promise<void> {
  return new Promise((ok) => {
    may = http.createServer((req, res) => {
      if (req.method === "GET") {
        nhan.truyCapLa++; // bất kỳ GET nào (vd /leak) = có ai tự tải thứ trong kết quả
        res.statusCode = 404;
        res.end();
        return;
      }
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        const j = JSON.parse(b || "{}") as Record<string, any>;
        nhan.goi.push(j);
        const chu = JSON.stringify(j.messages ?? []);
        let noiDung: string;
        if (chu.includes("[[SAI]]")) noiDung = "đây không phải JSON";
        else if (chu.includes("[[DOC]]")) noiDung = JSON.stringify(KET_QUA_DOC).replace("__PORT__", String(nhan.cong));
        else noiDung = JSON.stringify(KET_QUA_TOT);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: noiDung } }], usage: { prompt_tokens: 120, completion_tokens: 60 } }));
      });
    });
    may.listen(0, "127.0.0.1", () => {
      nhan.cong = (may.address() as AddressInfo).port;
      ok();
    });
  });
}

test.beforeAll(async () => {
  fx = JSON.parse(fs.readFileSync(process.env.FHT_STATE!, "utf8")) as FsFixture;
  base = process.env.FHT_BASE_URL!;
  const rnd = `${DUOI}-${Math.random().toString(36).slice(2, 7)}`;
  TIEU_DE = `fse2e-ngoai-${rnd}`;
  F_LUONG = `fse2e-kdn-${rnd}`;
  ids.run = randomUUID();
  ids.phien = randomUUID();
  ids.tin = [];
  nhan.goi = [];
  nhan.truyCapLa = 0;
  await dungMayGia();
  // đặt lại: nhà máy A TẮT AI ngoài (lượt lặp trước có thể đã bật)
  const coAdmin = cookieNguoi.get(fx.admin.username);
  const ctx = await pwRequest.newContext(coAdmin ? { storageState: { cookies: coAdmin as never, origins: [] } } : undefined);
  try {
    if (!coAdmin) {
      await dangNhapReq(ctx, fx.admin);
      cookieNguoi.set(fx.admin.username, (await ctx.storageState()).cookies as never);
    }
    const c = await ctx.post(`${base}/api/trpc/aiNgoai.ghiCauHinh`, {
      data: { json: { factoryId: fx.nhaMayA.id, batNgoai: false, choDuLieuVanHanh: false, luuNguyenVan: false, hanGiuNgay: 30, tranTokenNgay: null, tranTienNgayUsd: null, tranTokenNguoiNgay: null, tranTokenLuongNgay: null, tranTokenLuot: null, tranLanPhut: 60 } },
    });
    expect(c.status()).toBe(200);
  } finally {
    await ctx.dispose();
  }
  await gieoKho();
});
test.afterAll(async () => {
  await new Promise<void>((r) => may.close(() => r()));
});

/** Đăng nhập có THỬ LẠI khi bị giới hạn tốc độ (429) — chạy lặp / nhiều người dùng liên tiếp dễ chạm trần đăng nhập của máy chủ. */
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
/** Phiên (cookie) đã đăng nhập theo người dùng — dùng lại giữa các ca/lượt lặp để KHÔNG chạm trần đăng nhập (mỗi người đăng nhập đúng 1 lần). */
type Cookies = Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>;
const cookieNguoi = new Map<string, Cookies>();
async function dangNhap(page: Page, ai: { username: string; password: string }): Promise<void> {
  await page.context().addInitScript(() => {
    try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ }
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
const lay = async (page: Page, proc: string, input: unknown) => {
  const r = await page.context().request.get(`${base}/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  return { status: r.status(), json: (await r.json().catch(() => null)) as any };
};
const dl = (r: { json: any }) => r.json?.result?.data?.json;

// ─── dữ liệu gieo (kho chat / agent / coding của người dùng `mot`) ─────────────────────────────────
const ids = { cuoc: 0, tin: [] as number[], run: randomUUID(), phien: randomUUID() };
async function gieoKho(): Promise<void> {
  await withTestDb(async (sql) => {
    const [cv] = await sql`INSERT INTO ai_chat_conversations ("userId", title, "messageCount") VALUES (${fx.mot.id}, ${TIEU_DE}, 8) RETURNING id`;
    ids.cuoc = Number(cv.id);
    const them = async (role: string, content: string) => {
      const [m] = await sql`INSERT INTO ai_chat_messages ("conversationId", role, content) VALUES (${ids.cuoc}, ${role}::chatroleenum, ${content}) RETURNING id`;
      return Number(m.id);
    };
    await them("user", "Hàm Divide sai chỗ nào?");
    ids.tin.push(await them("assistant", `Dùng khoá ${BI_MAT_KHOA} và password=${BI_MAT_MK} để chạy thử. Hàm Divide thiếu kiểm tra mẫu số bằng 0.`));
    await them("user", "câu hai");
    ids.tin.push(await them("assistant", "Trả lời hai [[DOC]] có chuỗi độc."));
    await them("user", "câu ba");
    ids.tin.push(await them("assistant", "Trả lời ba [[SAI]] model sẽ trả JSON sai."));
    await them("user", "câu bốn");
    ids.tin.push(await them("assistant", "Trả lời bốn dùng cho bấm đúp."));
    const su = (seq: number, suKien: Record<string, unknown>) => ({ seq, suKien });
    await sql`INSERT INTO ai_agent_runs (id, "userId", "projectId", "cheDo", "cauHoi", "trangThai", "suKien", "tomTat")
      VALUES (${ids.run}, ${fx.mot.id}, 'p1', 'hoi', 'Đọc hàm Divide', 'xong',
        ${sql.json([su(1, { loai: "goi-tool", goi: { id: "c1", ten: "read_file", thamSo: {} } }), su(2, { loai: "ket-qua-tool", ten: "read_file" }), su(3, { loai: "chu", noiDung: "Hàm Divide chia số." })] as never)}, 'Hàm Divide chia số.')`;
    await sql`INSERT INTO ai_coding_sessions (id, "userId", "projectId", title, turns, "turnCount")
      VALUES (${ids.phien}, ${fx.mot.id}, 'p1', 'fse2e', ${sql.json([{ role: "user", content: "sửa Divide" }, { role: "assistant", content: "đã sửa" }] as never)}, 2)`;
  });
}

async function moChat(page: Page): Promise<void> {
  await page.goto(`${base}/ai-chat`);
  await page.getByText(TIEU_DE, { exact: false }).first().click({ timeout: 60_000 });
  await expect(page.getByText("Hàm Divide thiếu kiểm tra mẫu số")).toBeVisible({ timeout: 30_000 });
}
const nut = (page: Page, i: number) => page.getByTestId("nut-kiem-dinh-ngoai").nth(i);

test("1 — nhà máy TẮT (chưa cấu hình) ⇒ không có nút kiểm định ở /ai-chat", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await moChat(page);
  await page.waitForTimeout(1500); // danh mục model tải xong
  await expect(page.getByTestId("nut-kiem-dinh-ngoai")).toHaveCount(0);
});

test("2 — admin cấu hình (host nội bộ · khoá · model · bật nhà máy) ⇒ nút hiện; chat là van-hanh mà nhà máy chưa cho ⇒ nút gửi KHOÁ + lý do; gọi thẳng thủ tục ⇒ 403", async ({ page }) => {
  await dangNhap(page, fx.admin);
  const F = fx.nhaMayA.id;
  const host = await post(page, "aiNgoai.datHostNoiBo", { factoryId: F, hostCong: `127.0.0.1:${nhan.cong}` });
  expect(host.status, JSON.stringify(host.json).slice(0, 300)).toBe(200);
  const khoa = await post(page, "aiNgoai.taoKhoa", { factoryId: F, nhaCungCap: "openai_compat", ten: "e2e", khoa: "sk-fse2e-" + "a".repeat(24), endpoint: `http://127.0.0.1:${nhan.cong}` });
  expect(khoa.status, JSON.stringify(khoa.json).slice(0, 300)).toBe(200);
  const keyId = dl(khoa).id as number;
  const mo = await post(page, "aiNgoai.datModel", { factoryId: F, nhaCungCap: "openai_compat", model: "fake-1", nhan: "Fake 1", keyId, giaVaoUsdTrieu: null, giaRaUsdTrieu: null, tranTokenLuot: 200000, batModel: true });
  expect(mo.status, JSON.stringify(mo.json).slice(0, 1800)).toBe(200);
  const cfg = await post(page, "aiNgoai.ghiCauHinh", {
    factoryId: F, batNgoai: true, choDuLieuVanHanh: false, luuNguyenVan: false, hanGiuNgay: 30,
    tranTokenNgay: null, tranTienNgayUsd: null, tranTokenNguoiNgay: null, tranTokenLuongNgay: null, tranTokenLuot: null, tranLanPhut: 60,
  });
  expect(cfg.status, JSON.stringify(cfg.json).slice(0, 300)).toBe(200);

  const p2 = await page.context().browser()!.newPage();
  try {
    await dangNhap(p2, fx.mot);
    await moChat(p2);
    await expect(nut(p2, 0)).toBeVisible({ timeout: 30_000 });
    await nut(p2, 0).click();
    await expect(p2.getByTestId("kdnh-xem")).toBeVisible({ timeout: 30_000 });
    await expect(p2.getByTestId("kdnh-muc")).toContainText("vận hành");
    await expect(p2.getByTestId("kdnh-khoa")).toContainText("dữ liệu vận hành");
    await expect(p2.getByTestId("kdnh-gui")).toBeDisabled();
    // non-admin KHÔNG thấy số token/USD của nhà máy (Q2)
    await expect(p2.getByTestId("kdnh-tran-nha-may-so")).toHaveCount(0);
    // gọi thẳng thủ tục (bỏ qua UI) ⇒ 403
    const truc = await post(p2, "aiKiemDinh.chay", { chonModel: "ngoai:openai_compat:fake-1", nguon: { loai: "chat", cuocTroChuyenId: ids.cuoc, tinNhanId: ids.tin[0] } });
    expect(truc.status).toBe(403);
    expect(nhan.goi.length).toBe(0);
  } finally {
    await p2.close();
  }
});

test("3 — cho phép dữ liệu vận hành ⇒ gửi được; AI ngoài KHÔNG nhận bí mật (đã che) và KHÔNG có công cụ; kết quả hiển thị đúng schema", async ({ page }) => {
  await dangNhap(page, fx.admin);
  const cfg = await post(page, "aiNgoai.ghiCauHinh", {
    factoryId: fx.nhaMayA.id, batNgoai: true, choDuLieuVanHanh: true, luuNguyenVan: false, hanGiuNgay: 30,
    tranTokenNgay: null, tranTienNgayUsd: null, tranTokenNguoiNgay: null, tranTokenLuongNgay: null, tranTokenLuot: null, tranLanPhut: 60,
  });
  expect(cfg.status).toBe(200);
  const p2 = await page.context().browser()!.newPage();
  try {
    await dangNhap(p2, fx.mot);
    await moChat(p2);
    await nut(p2, 0).click();
    await expect(p2.getByTestId("kdnh-xem")).toBeVisible({ timeout: 30_000 });
    await expect(p2.getByTestId("kdnh-gui")).toBeEnabled();
    const truoc = nhan.goi.length;
    await p2.getByTestId("kdnh-gui").click();
    await expect(p2.getByTestId("kdnh-ket-qua")).toBeVisible({ timeout: 60_000 });
    await expect(p2.getByTestId("kdn-ket-luan")).toContainText(/Cần sửa|can-sua/);
    await expect(p2.getByTestId("kdn-diem")).toContainText("61");
    expect(nhan.goi.length).toBe(truoc + 1);
    const g = nhan.goi[nhan.goi.length - 1]!;
    const chu = JSON.stringify(g);
    expect(chu, "khoá rò ra nhà cung cấp").not.toContain(BI_MAT_KHOA);
    expect(chu, "mật khẩu rò ra nhà cung cấp").not.toContain(BI_MAT_MK);
    expect(chu).toContain("Divide"); // nội dung kỹ thuật vẫn đi
    expect("tools" in g || "functions" in g || "tool_choice" in g, "AI ngoài không được có công cụ").toBe(false);
  } finally {
    await p2.close();
  }
});

test("4 — chuỗi độc trong kết quả hiển thị NGUYÊN VĂN; markdown ảnh không tự tải (0 GET tới máy chủ giả); không phần tử nguy hiểm", async ({ page }) => {
  await dangNhap(page, fx.mot);
  const yeuCauNgoai: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(base)) yeuCauNgoai.push(r.url());
  });
  await moChat(page);
  const truocGet = nhan.truyCapLa;
  await nut(page, 1).click();
  await expect(page.getByTestId("kdnh-xem")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("kdnh-gui").click();
  const kq = page.getByTestId("kdnh-ket-qua");
  await expect(kq).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("kdn-ban-chuan-hoa")).toContainText("<img src=x onerror=alert(1)>");
  await expect(page.getByTestId("kdn-ban-chuan-hoa")).toContainText("![x](http://127.0.0.1:");
  await expect(kq.locator("img, script, svg, iframe, a[href]")).toHaveCount(0);
  await expect(page.getByTestId("kdn-vi-tri")).toHaveText("../../etc/passwd");
  await page.waitForTimeout(1500);
  expect(nhan.truyCapLa).toBe(truocGet);
  expect(yeuCauNgoai.filter((u) => u.includes("leak") || u.includes(String(nhan.cong)))).toEqual([]);
});

test("5 — model trả JSON sai ⇒ thử lại ĐÚNG 1 lần (2 lời gọi) ⇒ lỗi rõ, UI không vỡ, có thể đóng", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await moChat(page);
  const truoc = nhan.goi.length;
  await nut(page, 2).click();
  await expect(page.getByTestId("kdnh-xem")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("kdnh-gui").click();
  await expect(page.getByTestId("kdnh-loi")).toBeVisible({ timeout: 60_000 });
  expect(nhan.goi.length - truoc).toBe(2);
  await expect(page.getByTestId("kdnh-gui")).toBeEnabled(); // có thể thử lại
  await page.getByRole("button", { name: "Đóng" }).first().click();
  await expect(page.getByTestId("hop-kiem-dinh-ngoai")).toHaveCount(0);
});

test("6 — bấm đúp ⇒ MỘT lời gọi tới nhà cung cấp", async ({ page }) => {
  await dangNhap(page, fx.mot);
  await moChat(page);
  await nut(page, 3).click();
  await expect(page.getByTestId("kdnh-xem")).toBeVisible({ timeout: 30_000 });
  const truoc = nhan.goi.length;
  await page.getByTestId("kdnh-gui").dblclick();
  await expect(page.getByTestId("kdnh-ket-qua")).toBeVisible({ timeout: 60_000 });
  expect(nhan.goi.length - truoc).toBe(1);
});

test("7 — người ngoài phạm vi / không phải chủ lượt ⇒ 404 (xemTruoc và chay)", async ({ page }) => {
  for (const ai of [fx.banB, fx.khong, fx.nhieu]) {
    const p2 = await page.context().browser()!.newPage();
    try {
      await dangNhap(p2, ai);
      const nguon = { loai: "chat", cuocTroChuyenId: ids.cuoc, tinNhanId: ids.tin[0] };
      const x = await lay(p2, "aiKiemDinh.xemTruoc", { chonModel: "ngoai:openai_compat:fake-1", nguon });
      expect(x.status, ai.username).toBe(404);
      const c = await post(p2, "aiKiemDinh.chay", { chonModel: "ngoai:openai_compat:fake-1", nguon });
      expect(c.status, ai.username).toBe(404);
    } finally {
      await p2.close();
    }
  }
});

test("8 — nguồn agent (chỉ tool đọc mã) ⇒ ky-thuat; coding ⇒ van-hanh; chat ⇒ van-hanh; khoá lạ ở nguồn ⇒ 400", async ({ page }) => {
  await dangNhap(page, fx.mot);
  const xem = (nguon: unknown) => lay(page, "aiKiemDinh.xemTruoc", { chonModel: "ngoai:openai_compat:fake-1", nguon });
  expect(dl(await xem({ loai: "agent", runId: ids.run })).mucDuLieu).toBe("ky-thuat");
  expect(dl(await xem({ loai: "coding", phienId: ids.phien, chiSoLuot: 1 })).mucDuLieu).toBe("van-hanh");
  expect(dl(await xem({ loai: "chat", cuocTroChuyenId: ids.cuoc, tinNhanId: ids.tin[0] })).mucDuLieu).toBe("van-hanh");
  expect((await xem({ loai: "agent", runId: ids.run, mucDuLieu: "ky-thuat" })).status).toBe(400);
  expect((await lay(page, "aiKiemDinh.xemTruoc", { chonModel: "ngoai:openai_compat:fake-1", nguon: { loai: "agent", runId: ids.run }, mucDuLieu: "ky-thuat" })).status).toBe(400);
  expect((await xem({ loai: "van-ban", cauHoi: "x", traLoi: "y" })).status).toBe(400); // 10.4 không có nguồn van-ban
});

test("9 — luồng ai.kiem-dinh-ngoai: bảng duyệt hiện node, nút Bật khoá khi chưa duyệt; admin duyệt ⇒ bật ⇒ chạy tay ⇒ đầu ra kiemDinh đúng schema", async ({ page }) => {
  const nutLuong = (id: string, type: string, parameters: Record<string, unknown>, vt: [number, number]) => ({ id, type, typeVersion: 1, name: id, position: vt, parameters });
  const dinh = {
    id: F_LUONG, name: `Luồng kiểm định ${DUOI}`, version: 1, settings: { uuTien: "background", luuDuLieu: "day-du" },
    nodes: [
      nutLuong("t", "kich-hoat.thu-cong", {}, [0, 0]),
      nutLuong("s", "du-lieu.dat", { truong: { cauHoi: "Hàm Divide sai chỗ nào?", traLoi: "Thiếu kiểm tra mẫu số bằng 0." } }, [300, 0]),
      nutLuong("kd", "ai.kiem-dinh-ngoai", { chonModel: "ngoai:openai_compat:fake-1", cauHoi: "{{ $json.cauHoi }}", traLoi: "{{ $json.traLoi }}", tieuChi: "đúng kỹ thuật", truongRa: "kiemDinh" }, [600, 0]),
    ],
    connections: [
      { from: { node: "t", port: "main" }, to: { node: "s", port: "main" } },
      { from: { node: "s", port: "main" }, to: { node: "kd", port: "main" } },
    ],
  };
  // kỹ sư tạo luồng (nhà máy A)
  await dangNhap(page, fx.mot);
  expect((await post(page, "flow.luu", { definition: dinh })).status).toBe(200);
  await page.goto(`${base}/ai-flows/${F_LUONG}`);
  await expect(page.getByTestId("flow-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("bang-duyet-ngoai")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("bdn-node-kd")).toContainText("openai_compat · fake-1");
  await expect(page.getByTestId("bdn-trang-thai")).toContainText("Chưa duyệt");
  await expect(page.getByTestId("bdn-nut-duyet")).toHaveCount(0); // kỹ sư không phải admin
  await expect(page.getByTestId("nut-bat")).toBeDisabled();

  // admin duyệt + bật + chạy
  const pa = await page.context().browser()!.newPage();
  try {
    await dangNhap(pa, fx.admin);
    await pa.goto(`${base}/ai-flows/${F_LUONG}`);
    await expect(pa.getByTestId("bdn-nut-duyet")).toBeEnabled({ timeout: 60_000 });
    await pa.getByTestId("bdn-nut-duyet").click();
    await expect(pa.getByTestId("bdn-trang-thai")).toContainText("Đã duyệt", { timeout: 30_000 });
    await expect(pa.getByTestId("nut-bat")).toBeEnabled();
    await pa.getByTestId("nut-bat").click();
    await expect(pa.getByTestId("flow-trang-thai-bat")).toContainText(/bật/i, { timeout: 30_000 });
    await pa.getByTestId("nut-chay-tay").click();
    await pa.getByTestId("items-json").fill('[{"json":{}}]');
    const ph = pa.waitForResponse((r) => decodeURIComponent(r.url()).includes("flow.chayTay"));
    await pa.getByTestId("xac-nhan-chay").click();
    expect((await ph).status()).toBe(200);
    await expect
      .poll(async () => withTestDb(async (sql) => (await sql`SELECT status FROM ai_flow_runs WHERE "flowId" = ${F_LUONG}`).map((r) => String(r.status)).join(",")), { timeout: 90_000 })
      .toBe("xong");
    const out = await withTestDb(async (sql) => {
      const [b] = await sql`SELECT s.output FROM ai_flow_steps s JOIN ai_flow_runs r ON r.id = s."runId" WHERE r."flowId" = ${F_LUONG} AND s."nodeId" = 'kd'`;
      return b?.output as { main?: Array<{ json: Record<string, any> }> } | undefined;
    });
    const j = out?.main?.[0]?.json;
    expect(j?.kiemDinh?.ketLuan).toBe("can-sua");
    expect(j?.kiemDinh?.diem).toBe(61);
    expect(j?.kiemDinhVet?.nhaCungCap).toBe("openai_compat");
  } finally {
    await pa.close();
  }
});
