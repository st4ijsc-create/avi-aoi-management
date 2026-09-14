// ĐỢT 37 · D-7 — ẢNH NGHIỆM THU THỊ GIÁC: 4 màn × 2 viewport, lang=vi, vai e2e_tai_loE. Ghi .qa-dot48/anh-vi/<man>-<vp>.png + bbox chính.
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3048");
const LANG = arg("lang", "vi");
const TAG = arg("tag", "truoc");
const OUT = `.qa-dot48/anh-${TAG}-${LANG}`;
mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { data: j?.result?.data?.json ?? j?.result?.data ?? null }; }
async function dangNhap(ctx) {
  const f = `.qa-dot48/state-${TK.username}.json`;
  const ai = async () => (await trpcGet(ctx, "auth.me")).data?.username ?? null;
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); }
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); if (res.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai");
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
}
const bbox = (page, tid) => page.evaluate((id) => { const el = document.querySelector(`[data-testid="${id}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), day: Math.round(r.bottom) }; }, tid);
const browser = await chromium.launch();
const kq = {};
try {
  for (const vp of ["1600x900", "1280x720"]) {
    const [VW, VH] = vp.split("x").map(Number);
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
    await ctx.addInitScript((l) => { try { localStorage.setItem("i18nextLng", l); } catch {} }, LANG);
    await dangNhap(ctx);
    const page = await ctx.newPage();
    const MAN = [
      ["twin", "/twin", '[data-testid="man-twin-van-hanh"] canvas', ["man-twin-van-hanh", "khoi-canh-3d", "panel-trai", "panel-phai", "lop-phu-dong-thoi-gian", "dai-hop-nhat"]],
      ["line", "/twin/line/2", '[data-testid="man-twin-line"] canvas', ["man-twin-line", "thanh-tren-line", "khoi-dai-line", "bang-kpi-noi", "ngan-mo-phong", "lop-nhan-twin3d"]],
      ["may", "/twin/may/14", '[data-testid="khoi-canh-may"] canvas', ["man-twin-may", "thanh-tren-may", "khoi-canh-may", "cockpit-2d", "panel-phai-may", "chip-may"]],
      ["studio", "/twin-studio", null, ["man-twin-studio", "khoi-canh-3d", "thu-vien-asset", "cay-phan-cap-twin", "bang-thuoc-tinh"]],
    ];
    for (const [ten, duong, cv, tids] of MAN) {
      await page.goto(`${BASE}${duong}`, { waitUntil: "domcontentloaded" });
      if (ten === "studio") { await page.waitForSelector('[data-testid="man-twin-studio"]', { timeout: 60_000 }).catch(() => {}); await page.waitForTimeout(3000); await page.screenshot({ path: `${OUT}/studio-macdinh-${vp}.png` }); if ((await page.locator('[data-testid="tab-thiet-ke"]').count()) > 0) await page.getByTestId("tab-thiet-ke").click(); await page.waitForSelector('[data-testid="man-twin-studio"] canvas', { timeout: 60_000 }).catch(() => {}); }
      else await page.waitForSelector(cv, { timeout: 90_000 }).catch(() => {});
      if (ten === "may") await page.waitForSelector('[data-testid="cockpit-2d"] [role="tablist"]', { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(9000);
      await page.screenshot({ path: `${OUT}/${ten}-${vp}.png` });
      const b = {}; for (const t of tids) b[t] = await bbox(page, t);
      const canvas = await page.evaluate(() => [...document.querySelectorAll("canvas")].map((c) => { const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), day: Math.round(r.bottom) }; }));
      const cuon = await page.evaluate(() => ({ docScrollW: document.documentElement.scrollWidth, docScrollH: document.documentElement.scrollHeight, innerW: innerWidth, innerH: innerHeight, olLine: (() => { const ol = document.querySelector('[data-testid="dai-line"] ol'); return ol ? { scrollW: ol.scrollWidth, clientW: ol.clientWidth } : null; })() }));
      const chip = await page.evaluate(() => ({ nhanAn: document.querySelector('[data-testid="chip-nhan-bi-an"]')?.textContent?.trim() ?? null, suCo: document.querySelector('[data-testid="chip-su-co-ngoai-khung"]')?.textContent?.trim() ?? null, soNhan: document.querySelectorAll('[data-testid="nhan-may-twin3d"]').length }));
      kq[`${ten}-${vp}`] = { url: page.url(), htmlLang: await page.evaluate(() => document.documentElement.lang), bbox: b, canvas, cuon, chip };
      console.log(`   ${ten}-${vp}: lang=${kq[`${ten}-${vp}`].htmlLang} canvas=${JSON.stringify(canvas)} cuon=${JSON.stringify(cuon)} chip=${JSON.stringify(chip)}`);
    }
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/bbox.json`, JSON.stringify(kq, null, 2));
