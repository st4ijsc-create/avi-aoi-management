import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { duongRaBangChung } from "./duongRaBangChung";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ĐỢT 38 — NGHIỆM THU SỐNG bốn kết cục kỹ thuật của Pareto QA Đợt 37 (#3 · #4 · #5 · #6 · #7)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Đo trên `dist` (server 3038, `PLAYWRIGHT_BASE_URL`), vai `e2e_tai_loE` (danh tính THẬT qua tRPC `auth.me` — G100),
 * hai viewport 1600×900 và 1280×720. Mọi số đọc bằng DOM thật; JSON thô ghi `.qa-dot38/e2e/` (G65 — không đụng
 * `test-results/`). Chạy: `PLAYWRIGHT_BASE_URL=http://localhost:3038 npx playwright test e2e/twin-dot38-nghiem-thu.spec.ts
 * --workers=1 --output .qa-dotNN/pw-output` — ĐỢT 51: NN = đợt ĐANG chạy, kèm `TWIN_E2E_ANH_DOT38=.qa-dotNN/e2e`;
 * ghi vào `.qa-dot38/` là ghi đè bằng chứng của Đợt 38 (G130).
 *
 *   P5  Line/Máy/Studio: `documentElement.scrollHeight === innerHeight` (trước: 924/900 · 744/720, cuộn dọc 24 px)
 *   P4  `/twin/may/14` bấm tab "3D model": DOM canvas = `__soCanvas` = 1 ở ba trạng thái tab (trước: 2/1 — G99)
 *   P7  `/twin/line/2` @1280: `ol.scrollWidth ≤ clientWidth`, 12 ô, mã KHÔNG bị cắt, chip "N tên bị ẩn" ≤ 1
 *   P6  `/twin`: chỉ báo kết nối tới `truc_tiep` ≤ 2.5 s (trước: 8.9–9.8 s — broadcaster chỉ phát theo interval 10 s)
 *   P3  `/twin/may/14` Live state: badge Status suy từ `connected` — máy 14 (nhịp tim 54 ngày, đo 2026-09-10) ⇒
 *       `data-connected="false"` và tone KHÔNG success (trước: "online" xanh ngay dưới "Mất kết nối" đỏ)
 *
 * ★ Phụ thuộc dữ liệu THẬT đã đo: máy 14 SIM-L2-AOI @ trạm 14, chuyền 2 (12 trạm, tiền tố `SIM-L2-`), nhịp tim cuối
 *   2026-07-17. Nếu ai chèn nhịp tim mới cho máy 14, P3 đổi chiều — và ĐÓ là đúng (ca này đo sự thật, không đo hằng).
 */

const ANH = duongRaBangChung("TWIN_E2E_ANH_DOT38", ".qa-dot38/e2e");
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
const VP = [
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
];

test.describe.configure({ mode: "serial" });
let cookieCache: string | null = null;

async function dangNhap(page: Page) {
  if (cookieCache) {
    await page.context().addCookies(JSON.parse(cookieCache));
    return;
  }
  const res = await page.request.post("/api/auth/login", { data: TK });
  expect(res.status(), `dang nhap ${TK.username}`).toBe(200);
  // G100 — danh tính THẬT qua tRPC (`/api/auth/me` là SPA catch-all, 200 vô nghĩa).
  const me = await page.request.get("/api/trpc/auth.me");
  const body = await me.json().catch(() => null);
  const ten = body?.result?.data?.json?.username ?? body?.result?.data?.username;
  expect(ten, "auth.me phai tra dung vai vua dang nhap").toBe(TK.username);
  cookieCache = JSON.stringify(await page.context().cookies());
}

const luu = (ten: string, obj: unknown) => {
  fs.mkdirSync(ANH, { recursive: true });
  fs.writeFileSync(`${ANH}/${ten}.json`, JSON.stringify({ luc: new Date().toISOString(), ...(obj as object) }, null, 2));
};

const soCanvas = (page: Page) =>
  page.evaluate(() => ({
    __soCanvas: (window as unknown as { __soCanvas?: number }).__soCanvas ?? null,
    canvasDom: document.querySelectorAll("canvas").length,
  }));

const doCuon = (page: Page) =>
  page.evaluate(() => ({
    docScrollH: document.documentElement.scrollHeight,
    innerH: innerHeight,
    scrollY: (() => {
      window.scrollTo(0, 300);
      const y = window.scrollY;
      window.scrollTo(0, 0);
      return y;
    })(),
  }));

const MAN = {
  line: { duong: "/twin/line/2", canvas: '[data-testid="man-twin-line"] canvas' },
  may: { duong: "/twin/may/14", canvas: '[data-testid="khoi-canh-may"] canvas' },
  studio: { duong: "/twin-studio", canvas: '[data-testid="man-twin-studio"] canvas', tab: "tab-thiet-ke" },
} as const;

async function moMan(page: Page, ten: keyof typeof MAN) {
  const m = MAN[ten];
  await page.goto(m.duong, { waitUntil: "domcontentloaded" });
  if ("tab" in m) {
    await page.waitForSelector('[data-testid="man-twin-studio"]', { timeout: 60_000 });
    if ((await page.locator(`[data-testid="${m.tab}"]`).count()) > 0) await page.getByTestId(m.tab).click();
  }
  await page.waitForSelector(m.canvas, { timeout: 90_000 });
  if (ten === "may") await page.waitForSelector('[data-testid="cockpit-2d"] [role="tablist"]', { timeout: 60_000 });
}

for (const vp of VP) {
  test(`P5 @${vp.width}x${vp.height} — Line/Máy/Studio KHÔNG cuộn dọc: scrollHeight === innerHeight`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(vp);
    await dangNhap(page);
    const kq: Record<string, { docScrollH: number; innerH: number; scrollY: number }> = {};
    for (const ten of ["line", "may", "studio"] as const) {
      await moMan(page, ten);
      await page.waitForTimeout(3000);
      kq[ten] = await doCuon(page);
    }
    luu(`p5-${vp.width}x${vp.height}`, kq);
    for (const [ten, c] of Object.entries(kq)) {
      expect(c.docScrollH, `${ten}: scrollHeight`).toBe(c.innerH);
      expect(c.scrollY, `${ten}: scrollY sau scrollTo(0,300)`).toBe(0);
    }
  });
}

test("P4 @1600 — /twin/may/14 tab 3D: DOM canvas = __soCanvas = 1 ở ba trạng thái tab (mặc định → 3D → đóng)", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(VP[0]);
  await dangNhap(page);
  await moMan(page, "may");
  await page.waitForTimeout(4000);
  const macDinh = await soCanvas(page);
  const tab3d = page.locator('[data-testid="cockpit-2d"] [role="tab"]').filter({ hasText: /^(3D|3D model|Model 3D|3D 模型)$/ }).first();
  expect(await tab3d.count(), "tab 3D phai ton tai").toBe(1);
  await tab3d.click();
  await page.waitForTimeout(3000);
  const moTab = await soCanvas(page);
  const ghiChu = await page.locator('[data-testid="model3d-da-nhung"]').count();
  await page.locator('[data-testid="cockpit-2d"] [role="tab"]').first().click();
  await page.waitForTimeout(2000);
  const dongTab = await soCanvas(page);
  luu("p4-1600x900", { macDinh, moTab, ghiChu, dongTab });
  for (const [k, v] of Object.entries({ macDinh, moTab, dongTab })) {
    expect(v.canvasDom, `${k}: canvas DOM`).toBe(1);
    expect(v.__soCanvas, `${k}: __soCanvas`).toBe(1);
  }
  expect(ghiChu, "tab 3D khi nhung hien ghi chu thay vi canvas thu hai").toBe(1);
});

test("P7 @1280 — /twin/line/2 dải trạm: không cuộn ngang, 12 ô, mã không bị cắt, tiền tố in một lần, ≤ 1 tên bị ẩn", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(VP[1]);
  await dangNhap(page);
  await moMan(page, "line");
  await page.waitForTimeout(8000);
  const kq = await page.evaluate(() => {
    const ol = document.querySelector('[data-testid="dai-line"] ol');
    const oTram = [...document.querySelectorAll('[data-testid^="o-tram-"]')]
      .filter((e) => !e.getAttribute("data-testid")!.startsWith("o-tram-wip"))
      .map((e) => {
        const spans = [...e.querySelectorAll("span")].filter((s) => s.children.length === 0 && s.textContent!.trim());
        const ma = spans[0];
        return { tid: e.getAttribute("data-testid"), ma: ma?.textContent?.trim() ?? null, maDayDu: ma?.getAttribute("data-ma") ?? null, maCat: ma ? ma.scrollWidth > ma.clientWidth + 1 : null, w: Math.round(e.getBoundingClientRect().width) };
      });
    const chip = document.querySelector('[data-testid="chip-nhan-bi-an"]');
    const tienTo = document.querySelector('[data-testid="dai-line-tien-to"]')?.textContent?.trim() ?? null;
    return { ol: ol ? { scrollW: ol.scrollWidth, clientW: ol.clientWidth } : null, oTram, chip: chip?.textContent?.trim() ?? null, tienTo, __demNhan: (window as unknown as { __demNhan?: unknown }).__demNhan ?? null };
  });
  luu("p7-1280x720", kq);
  expect(kq.ol, "ol dai tram").toBeTruthy();
  expect(kq.ol!.scrollW, "ol.scrollWidth <= clientWidth").toBeLessThanOrEqual(kq.ol!.clientW + 1);
  expect(kq.oTram.length).toBe(12);
  expect(kq.oTram.filter((o) => o.maCat).length, "so ma bi cat").toBe(0);
  for (const o of kq.oTram) expect(o.maDayDu, `${o.tid}: giu ma day du o data-ma`).toMatch(/^SIM-L2-/);
  expect(kq.tienTo, "tien to chung in mot lan o dau dai").toContain("SIM-L2-");
  const soAn = Number((kq.chip ?? "").match(/\d+/)?.[0] ?? 0);
  expect(soAn, `chip "${kq.chip}"`).toBeLessThanOrEqual(1);
});

test("P6 @1600 — /twin: chỉ báo kết nối tới `truc_tiep` ≤ 2.5 s (broadcaster phát ngay khi join)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(VP[0]);
  await dangNhap(page);
  const t0 = Date.now();
  await page.goto("/twin", { waitUntil: "domcontentloaded" });
  let toi: number | null = null;
  const moc: Array<{ t: number; kn: string | null }> = [];
  for (let k = 0; k < 100; k += 1) {
    const kn = await page.evaluate(() => document.querySelector('[data-testid="trang-thai-ket-noi"]')?.getAttribute("data-ket-noi") ?? null);
    const t = Date.now() - t0;
    if (moc.length === 0 || moc[moc.length - 1].kn !== kn) moc.push({ t, kn });
    if (kn === "truc_tiep") {
      toi = t;
      break;
    }
    await page.waitForTimeout(150);
  }
  luu("p6-1600x900", { msToiTrucTiep: toi, moc });
  expect(toi, `khong toi truc_tiep trong 15 s: ${JSON.stringify(moc)}`).not.toBeNull();
  // Mốc tính từ `goto` (gồm tải trang ~1.3 s); phát-ngay-khi-join ⇒ ≤ 2.5 s. Trước Đợt 38: 8.9–9.8 s.
  expect(toi!).toBeLessThanOrEqual(2500);
});

test("P3 @1600 — /twin/may/14 Live state: Status suy từ `connected` (máy 14 nhịp tim 54 ngày ⇒ offline, KHÔNG tone success)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(VP[0]);
  await dangNhap(page);
  await moMan(page, "may");
  await page.waitForTimeout(5000);
  const kq = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="cockpit-live-status"]');
    const badge = el?.querySelector("[class*='border']") ?? el;
    return { coEl: !!el, connected: el?.getAttribute("data-connected") ?? null, chu: el?.textContent?.trim() ?? null, cls: badge?.getAttribute("class") ?? "" };
  });
  luu("p3-1600x900", kq);
  expect(kq.coEl, "cockpit-live-status phai ton tai").toBe(true);
  expect(["true", "false"]).toContain(kq.connected);
  if (kq.connected === "false") {
    expect(kq.chu).toBe("offline");
    expect(kq.cls).not.toContain("text-success");
    expect(kq.cls).toContain("text-destructive");
  } else {
    expect(kq.chu).toBe("online");
    expect(kq.cls).toContain("text-success");
  }
});
