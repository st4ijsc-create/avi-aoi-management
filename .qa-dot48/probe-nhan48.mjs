// ĐỢT 47 — PROBE nhãn × badge sau vá N1/N5: __demNhan/__demBadge + bbox thật của nhãn/badge/lớp phủ trên /twin và /twin/line/2.
//   node .qa-dot48/probe-nhan47.mjs [--base=http://localhost:3048] [--vp=1600x900,1280x720] [--tag=sau]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3048"); const VPS = arg("vp", "1600x900,1280x720").split(","); const TAG = arg("tag", "sau");
const OUT = ".qa-dot48/probe"; mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { data: j?.result?.data?.json ?? j?.result?.data ?? null }; }
async function dangNhap(ctx) { const f = `.qa-dot48/state-${TK.username}.json`; const ai = async () => (await trpcGet(ctx, "auth.me")).data?.username ?? null; if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); } const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); if (res.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai"); writeFileSync(f, JSON.stringify(await ctx.cookies())); }
const DO = (manTid) => {
  const R = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const canvas = document.querySelector(`[data-testid="${manTid}"] canvas`);
  const cv = canvas ? R(canvas) : null;
  const nhan = [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].map((el) => ({ chu: el.textContent?.trim().slice(0, 30), id: el.getAttribute("data-machine-id"), r: R(el) }));
  const badge = [...document.querySelectorAll('[data-testid^="badge-canh-bao-"]')].map((el) => ({ t: el.getAttribute("data-testid"), chu: el.textContent?.trim().slice(0, 30), muc: el.getAttribute("data-muc"), ngoai: el.getAttribute("data-ngoai-khung"), doiCho: el.getAttribute("data-doi-cho"), r: R(el) }));
  const lop = [...document.querySelectorAll("[data-che-nhan]")].map((el) => ({ t: el.getAttribute("data-testid") ?? el.tagName, r: R(el) }));
  const chip = [...document.querySelectorAll('[data-testid="chip-nhan-bi-an"],[data-testid="chip-su-co-ngoai-khung"]')].map((el) => ({ t: el.getAttribute("data-testid"), chu: el.textContent?.trim(), r: R(el) }));
  const giao = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const badgeBiChe = badge.filter((b) => b.ngoai !== "1").map((b) => ({ t: b.t, che: lop.filter((l) => giao(b.r, l.r) > 0).map((l) => `${l.t}:${giao(b.r, l.r)}`) })).filter((x) => x.che.length);
  let capNB = 0; for (const n of nhan) for (const b of badge) if (giao(n.r, b.r) > 0) capNB++;
  return { url: location.href, cv, demNhan: window.__demNhan ?? null, demBadge: window.__demBadge ?? null, nhan, badge, lop: lop.map((l) => `${l.t}@${l.r.x},${l.r.y} ${l.r.w}x${l.r.h}`), chip, badgeBiChe, capNhanBadge: capNB };
};
const browser = await chromium.launch();
const kq = {};
try {
  for (const vp of VPS) {
    const [VW, VH] = vp.split("x").map(Number);
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
    await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); localStorage.removeItem("twin3d.nhan.macDinh"); } catch {} });
    await dangNhap(ctx);
    for (const [duong, man] of [["/twin", "man-twin-van-hanh"], ["/twin/line/2", "man-twin-line"]]) {
      const page = await ctx.newPage();
      await page.goto(`${BASE}${duong}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(`[data-testid="${man}"] canvas`, { timeout: 90_000 }).catch(() => {});
      await page.waitForTimeout(6000);
      const d = await page.evaluate(DO, man);
      kq[`${vp}${duong}`] = d;
      console.log(`   [${vp} ${duong}] nhãn ${d.nhan.length} · badge ${d.badge.length} (dời ${d.badge.filter((b) => b.doiCho === "1").length}, ngoài ${d.badge.filter((b) => b.ngoai === "1").length}) · badge bị lớp phủ che ${d.badgeBiChe.length} ${JSON.stringify(d.badgeBiChe).slice(0, 160)} · nhãn×badge ${d.capNhanBadge}`);
      console.log(`      __demNhan ${JSON.stringify(d.demNhan)}`);
      console.log(`      __demBadge ${JSON.stringify(d.demBadge)}`);
      console.log(`      nhãn: ${d.nhan.map((n) => `${n.chu}@${n.r.x},${n.r.y}`).join(" | ").slice(0, 300)}`);
      console.log(`      badge: ${d.badge.map((b) => `${b.chu}[${b.muc}${b.doiCho === "1" ? ",dời" : ""}]@${b.r.x},${b.r.y}`).join(" | ").slice(0, 400)}`);
      console.log(`      chip: ${JSON.stringify(d.chip.map((c) => c.chu))} · lớp phủ: ${d.lop.join(" ; ").slice(0, 300)}`);
      await page.screenshot({ path: `${OUT}/nhan47-${TAG}-${vp}${duong.replace(/\//g, "_")}.png` });
      await page.close();
    }
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/nhan47-${TAG}.json`, JSON.stringify(kq, null, 2));
console.log("=== probe-nhan47 xong ===");
