import { chromium } from "playwright";
const GOC = "http://localhost:3077";
const t = await chromium.launch();
const ctx = await t.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
await p.request.post(`${GOC}/api/auth/login`, { data: { username: "qatd_admin", password: "Qatd!2026" } });
await p.goto(`${GOC}/factory-command`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(9000);
const ds = await p.locator('button[role="combobox"]').all();
console.log("tổng combobox:", ds.length);
for (let i = 0; i < ds.length; i++) {
  const vis = await ds[i].isVisible();
  const lab = await ds[i].getAttribute("aria-label");
  const loc = await ds[i].getAttribute("data-loc");
  const txt = (await ds[i].innerText().catch(() => "")).replace(/\n/g, " ");
  console.log(`  [${i}] visible=${vis} label=${lab} loc=${loc} text="${txt}"`);
  if (vis) {
    await ds[i].click().catch(() => {});
    await p.waitForTimeout(600);
    const ops = await p.locator('[role="option"]').allInnerTexts().catch(() => []);
    console.log(`       options: ${JSON.stringify(ops)}`);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
  }
}
await t.close();
