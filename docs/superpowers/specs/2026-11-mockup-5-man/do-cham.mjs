// Đo vùng chạm của phần tử tương tác trên HTML sống: node do-cham.mjs → liệt kê phần tử < --touch-min (48 px @1280 comfortable, 40 px @1920 default). Bỏ .demo (khung điều khiển mockup).
import { chromium } from "@playwright/test";
import { pathToFileURL, fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL("./", import.meta.url));
const PAGES = { "man-1-home.html": ["binh-thuong", "p1-chua-ack", "du-lieu-cu"], "man-4-canh-bao.html": ["hon-hop", "lu", "du-lieu-cu", "p1-tuoi-line-cu", "chi-tiet"], "man-5-tai-san.html": ["may-that", "may-sim", "ngoai-pham-vi", "wizard"] };
const b = await chromium.launch(); let tong = 0, loi = 0; const mau = {};
for (const [tep, ds] of Object.entries(PAGES)) for (const st of ds) for (const [w, h, den, min] of [[1280, 800, "comfortable", 48], [1920, 1080, "default", 40]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(pathToFileURL(dir + tep).href + `?state=${st}&density=${den}&rail=${w >= 1920 ? "open" : "closed"}&shot=1`);
  const r = await p.evaluate((min) => [...document.querySelectorAll("a[href],button,[role=tab],input,select,textarea,.chk")].filter((e) => !e.closest(".demo") && e.getClientRects().length).map((e) => ({ t: (e.textContent || e.className || e.tagName).trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height) })).reduce((a, x) => { a.n++; if (x.h < min) { a.bad.push(x); } return a; }, { n: 0, bad: [] }), min);
  tong += r.n; loi += r.bad.length; for (const x of r.bad) mau[`${x.t}|${x.h}`] = (mau[`${x.t}|${x.h}`] ?? 0) + 1;
  await p.close();
}
await b.close();
console.log(`phần tử tương tác đo: ${tong}; dưới mục tiêu chạm: ${loi}`); console.log(Object.entries(mau).slice(0, 15));
process.exitCode = loi ? 1 : 0;
