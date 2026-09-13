// ĐỢT 58 — M10 · ABLATION ĐÚNG CÁCH + truy vết "nhãn đè nút sau khi thu/mở panel".
// Lớp nhãn chỉ tính lại TRONG `useFrame`; cảnh đứng yên ⇒ không có khung ⇒ vùng cấm CŨ.
// Nên mỗi lần đổi trạng thái ta phải HÍCH cảnh (rê chuột trên canvas) rồi mới đo.
//   node .qa-dot58/m10-ablation.mjs --base=... --tag=head --vp=1600x900
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3058");
const TAG = arg("tag", "head");
const VPS = arg("vp", "1600x900,1280x720").split(",");
const OUT = `.qa-dot58/m10ab-${TAG}`;
mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function dangNhap(ctx) {
  const f = `.qa-dot58/state-${TK.username}.json`;
  const ai = async () => { const r = await ctx.request.get(`${BASE}/api/trpc/auth.me`); try { return JSON.parse(await r.text())?.result?.data?.json?.username ?? null; } catch { return null; } };
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); }
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK });
  if (r.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai");
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
}
const DO = () => {
  const giao = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const hien = (el) => { const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const nhan = [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].filter(hien);
  const ra = { soNhan: nhan.length, che: [], tong: 0, khung: window.__thongKeVe ?? null, nut: null };
  const el = document.querySelector('[data-testid="nut-thu-trai"]');
  if (el && hien(el)) {
    const r = el.getBoundingClientRect();
    ra.nut = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cheNhan: el.getAttribute("data-che-nhan") };
    for (const n of nhan) { const g = giao(r, n.getBoundingClientRect()); if (g > 0.5) { ra.che.push({ chu: n.textContent.trim().slice(0, 22), giao: Math.round(g) }); ra.tong += Math.round(g); } }
  }
  return ra;
};
const kq = {};
const browser = await chromium.launch();
try {
  for (const vp of VPS) {
    const [W, H] = vp.split("x").map(Number);
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch {} });
    await dangNhap(ctx);
    const page = await ctx.newPage();
    const K = (kq[vp] = {});
    const hich = async () => { const c = await page.evaluate(() => { const el = document.querySelector('[data-testid="man-twin-van-hanh"] canvas'); const b = el.getBoundingClientRect(); return { x: b.x + b.width * 0.72, y: b.y + b.height * 0.3 }; }); for (let i = 0; i < 6; i++) { await page.mouse.move(c.x + i * 3, c.y + i * 2); await page.waitForTimeout(120); } await page.waitForTimeout(2500); };
    await page.goto(`${BASE}/twin?thu=nhanTatCa`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 });
    await page.waitForTimeout(8000);
    K["1-goc"] = await page.evaluate(DO);
    await page.click('[data-testid="nut-thu-trai"]'); await page.waitForTimeout(1500);
    K["2-da-thu"] = await page.evaluate(DO);
    await page.click('[data-testid="nut-thu-trai"]'); await page.waitForTimeout(1500);
    K["3-mo-lai-chua-hich"] = await page.evaluate(DO);
    await page.screenshot({ path: `${OUT}/${vp}-3-mo-lai.png` });
    await hich();
    K["4-mo-lai-da-hich"] = await page.evaluate(DO);
    await page.screenshot({ path: `${OUT}/${vp}-4-da-hich.png` });
    /* ABLATION: gỡ data-che-nhan rồi HÍCH để lớp nhãn tính lại */
    K.go = await page.evaluate(() => { const e = document.querySelector('[data-testid="nut-thu-trai"]'); const c = e?.getAttribute("data-che-nhan"); e?.removeAttribute("data-che-nhan"); return c; });
    await hich();
    K["5-sau-go"] = await page.evaluate(DO);
    await page.screenshot({ path: `${OUT}/${vp}-5-sau-go.png` });
    /* HOÀN NGUYÊN */
    await page.evaluate(() => document.querySelector('[data-testid="nut-thu-trai"]')?.setAttribute("data-che-nhan", "1"));
    await hich();
    K["6-hoan-nguyen"] = await page.evaluate(DO);
    await page.screenshot({ path: `${OUT}/${vp}-6-hoan-nguyen.png` });
    console.log(`[${vp}] ${["1-goc", "2-da-thu", "3-mo-lai-chua-hich", "4-mo-lai-da-hich", "5-sau-go", "6-hoan-nguyen"].map((k) => `${k}=${K[k].che.length}/${K[k].tong}px²(nhãn ${K[k].soNhan})`).join(" · ")}`);
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/kq.json`, JSON.stringify(kq, null, 2));
console.log(`=== m10-ablation ${TAG} xong → ${OUT}/kq.json ===`);
