import { chromium } from "playwright";
const B = "http://localhost:3064";
const b = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const c = await b.newContext({ viewport: { width: 1280, height: 720 } });
const p = await c.newPage();
await p.request.post(B + "/api/auth/login", { data: { username: "qatd_giamdoc", password: "Qatd!2026" } });
for (const [ten, url] of [["tập đoàn 3D", "/twin?pv=tapdoan"], ["một nhà máy 3D", "/twin"]]) {
  await p.goto(B + url, { waitUntil: "domcontentloaded" });
  await p.getByTestId("man-twin-van-hanh").waitFor({ timeout: 60000 });
  await p.waitForTimeout(6000);
  const r = await p.evaluate(() => {
    const cv = document.querySelector("canvas");
    const boc = cv?.closest("[aria-label]");
    return {
      coCanvas: !!cv,
      ariaTrenCanvas: cv?.getAttribute("aria-label") ?? null,
      roleTrenCanvas: cv?.getAttribute("role") ?? null,
      toTienGanNhatCoAria: boc ? { tag: boc.tagName, aria: boc.getAttribute("aria-label") } : null,
      soPhanTuCoAriaTrongMan: document.querySelectorAll('[data-testid="man-twin-van-hanh"] [aria-label]').length,
    };
  });
  console.log(ten, "=>", JSON.stringify(r));
}
await b.close();
