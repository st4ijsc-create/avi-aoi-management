/** ph52/_probe-studio.mjs — `calls` của Studio ổn định ở đâu, và vì sao 3 vs 2? */
import { chromium } from "playwright";
const GOC = "http://localhost:3077";
const t = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
for (const lan of [1, 2]) {
  const ctx = await t.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  await p.request.post(`${GOC}/api/auth/login`, { data: { username: "qatd_admin", password: "Qatd!2026" } });
  await p.goto(`${GOC}/twin-studio?do=1`, { waitUntil: "domcontentloaded" });
  await p.locator("canvas").first().waitFor({ timeout: 90000 }).catch(() => {});
  const moc = [];
  for (let i = 0; i < 24; i += 1) {
    await p.waitForTimeout(1000);
    const d = await p.evaluate(() => {
      const tk = window.__thongKeVe ?? {};
      const bo = [...document.querySelectorAll('button[role="combobox"]')].map((b) => b.innerText.replace(/\n/g, " "));
      return { calls: tk.calls, tris: tk.triangles ?? tk.tris, near: tk.near, far: tk.far, camXa: tk.camXa, bo };
    });
    moc.push(`${i}s calls=${d.calls} tris=${d.tris} far=${d.far} camXa=${d.camXa}`);
    if (i === 23) console.log(`lần ${lan} · bộ chọn: ${JSON.stringify(d.bo)}`);
  }
  console.log(`lần ${lan}:\n  ` + moc.join("\n  "));
  await ctx.close();
}
await t.close();
