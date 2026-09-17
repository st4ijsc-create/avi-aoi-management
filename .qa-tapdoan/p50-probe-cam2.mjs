import { chromium } from "playwright";
const GOC = "http://localhost:3064", MK = "Qatd!2026";
const trinh = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
for (const vai of process.argv.slice(2)) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: MK } });
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90000 }).catch(() => {});
  await page.waitForFunction(() => { const n = document.querySelectorAll("[data-testid='nhan-cum-sa-ban']").length; const on = window.__p === n && n > 0; window.__p = n; return on; }, undefined, { timeout: 120000, polling: 1000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const ra = await page.evaluate(() => {
    const cvs = [...document.querySelectorAll("canvas")];
    const out = cvs.map((cv, i) => ({ i, w: cv.width, h: cv.height, keys: Object.keys(cv), syms: Object.getOwnPropertySymbols(cv).map(String) }));
    // thử moi state qua bất kỳ khoá nào
    let cam = null;
    for (const cv of cvs) {
      for (const k of [...Object.keys(cv), ...Object.getOwnPropertySymbols(cv)]) {
        const v = cv[k];
        const st = v?.root?.getState?.() ?? v?.store?.getState?.() ?? (typeof v?.getState === "function" ? v.getState() : null);
        if (st?.camera) { const c = st.camera; cam = { key: String(k), near: c.near, far: c.far, fov: c.fov, pos: [c.position.x, c.position.y, c.position.z].map(n => Math.round(n)) }; break; }
      }
      if (cam) break;
    }
    return { canvas: out, cam };
  });
  console.log(`\n══ ${vai} ══\n` + JSON.stringify(ra, null, 1));
  await ctx.close();
}
await trinh.close();
