import { chromium } from "@playwright/test";
import { BASE, layCookie, TANG_DONG } from "./lib-F.mjs";
const b = await chromium.launch();
const ck = await layCookie(b, "qatd_kythuat");
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addCookies(ck);
const p = await ctx.newPage();
p.on("console", (m) => { if (m.type() === "error") console.log("  CONSOLE-ERR:", m.text().slice(0, 140)); });
const t0 = Date.now();
await p.goto(`${BASE}/twin?nm=${TANG_DONG.nm}&toa=${TANG_DONG.toa}&tang=${TANG_DONG.tang}`, { waitUntil: "domcontentloaded" });
console.log("goto", Date.now() - t0);
await p.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 60000, state: "visible" });
console.log("man", Date.now() - t0);
await p.waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 90000 });
console.log("khung dau", Date.now() - t0);
await p.waitForTimeout(6000);
console.log(JSON.stringify(await p.evaluate(() => ({
  url: location.href, lang: document.documentElement.lang,
  soCanvas: window.__soCanvas ?? null, canvasDom: document.querySelectorAll("canvas").length,
  calls: window.__thongKeVe?.calls, tri: window.__thongKeVe?.triangles,
  soNhan: document.querySelectorAll('[data-testid="nhan-may-twin3d"]').length,
  soBadge: document.querySelectorAll('[data-testid^="badge-canh-bao-"]').length,
  soHang: document.querySelectorAll('[data-testid^="may-hang-"]').length,
  demMay: document.querySelector('[data-testid="dem-may"]')?.textContent?.trim(),
  bc: document.querySelector('[data-testid="breadcrumb-twin"]')?.innerText?.replace(/\n+/g," > "),
  chonNhaMay: document.querySelector('[data-testid="chon-nha-may"]')?.value,
  selects: [...document.querySelectorAll('select')].map(s=>({t:s.getAttribute("data-testid"),v:s.value,txt:s.options[s.selectedIndex]?.text})),
  kpi: document.querySelector('[data-testid="bang-kpi-noi"]')?.innerText?.replace(/\n+/g," | ").slice(0,220),
  chip: document.querySelector('[data-testid="chip-nhan-bi-an"]')?.textContent?.trim() ?? null,
  demNhan: window.__demNhan ?? null,
})), null, 2));
await p.screenshot({ path: ".qa-tapdoan/anh/F-probe.png" });
await b.close();
