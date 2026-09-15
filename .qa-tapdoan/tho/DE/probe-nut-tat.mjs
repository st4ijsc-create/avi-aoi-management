/* Phụ lục D1 — nút "render + disabled" có NHÌN RA được là đang tắt không, và LÝ DO có đọc được không.
   (Ảnh DE-D1-* cho thấy "Acknowledge" vẫn màu chủ đạo đầy đủ trong khi DOM khai disabled.) */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const BASE = "http://localhost:3064";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
ctx.addCookies(JSON.parse(readFileSync("D:/SOURCES/avi-aoi-management/.qa-tapdoan/tho/DE/state-qatd_kythuat.json", "utf8")));
const p = await ctx.newPage();
await p.goto(`${BASE}/twin/may/4197`, { waitUntil: "domcontentloaded" });
await p.waitForSelector('[data-testid="ngan-ma-may"]', { timeout: 60000 });
await p.waitForTimeout(7000);
const kq = await p.evaluate(() => {
  const d = (t) => {
    const e = document.querySelector(`[data-testid="${t}"]`);
    if (!e) return { co: 0 };
    const cs = getComputedStyle(e);
    return {
      co: 1,
      chu: (e.innerText || "").trim(),
      disabled: e.hasAttribute("disabled") ? 1 : 0,
      opacity: cs.opacity,
      pointerEvents: cs.pointerEvents,
      mauChu: cs.color,
      mauNen: cs.backgroundColor,
      title: e.getAttribute("title"),
      ariaDesc: e.getAttribute("aria-describedby"),
    };
  };
  const nhom = document.querySelector('[data-testid="nhom-canh-bao"]');
  return {
    nutAck: d("nut-ack"),
    nutAnTam: d("nut-an-tam"),
    nutTaoPhieu: d("nut-tao-phieu"),
    chuNhomCanhBao: nhom ? (nhom.innerText || "").replace(/\s+/g, " ").trim() : null,
  };
});
writeFileSync("D:/SOURCES/avi-aoi-management/.qa-tapdoan/tho/DE/D1-phu-luc-nut-tat.json", JSON.stringify(kq, null, 1));
console.log(JSON.stringify(kq, null, 1));
await ctx.close(); await b.close();
