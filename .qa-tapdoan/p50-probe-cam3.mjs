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
    const cv = document.querySelector("canvas");
    const fk = Object.keys(cv).find(k => k.startsWith("__reactFiber$"));
    let f = cv[fk], hop = 0, cam = null, san = null;
    const thu = (o) => {
      if (!o || typeof o !== "object") return null;
      const st = typeof o.getState === "function" ? o.getState() : null;
      return st && st.camera && st.scene ? st : null;
    };
    while (f && hop < 200 && !cam) {
      hop += 1;
      for (const key of ["memoizedProps", "pendingProps", "memoizedState", "stateNode"]) {
        const o = f[key];
        if (!o || typeof o !== "object") continue;
        for (const v of [o, ...Object.values(o).slice(0, 40)]) {
          const st = thu(v);
          if (st) {
            const c = st.camera;
            cam = { near: c.near, far: c.far, fov: c.fov, pos: [c.position.x, c.position.y, c.position.z].map(n => Math.round(n * 10) / 10) };
            // cỡ sàn: tìm mesh tên "san"/plane lớn nhất
            const dsN = [];
            st.scene.traverse((ob) => { if (ob.name) dsN.push(ob.name + ":" + ob.type + (ob.isInstancedMesh ? "(" + ob.count + ")" : "")); });
            san = dsN.slice(0, 30);
            break;
          }
        }
        if (cam) break;
      }
      f = f.return;
    }
    return { hop, cam, nhomTrongCanh: san };
  });
  console.log(`\n══ ${vai} ══\n` + JSON.stringify(ra, null, 1));
  await ctx.close();
}
await trinh.close();
