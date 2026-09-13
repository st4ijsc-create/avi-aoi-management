// ĐỢT 58 — hai lưới hồi quy còn lại:
//   ① LỆCH LỚP: bbox `lop-nhan-twin3d` / `lop-canh-bao` phải TRÙNG KHÍT canvas (0,0,0,0) — 4 màn × 2 vp.
//   ② 40 s ĐỨNG YÊN: số khung R3F vẽ thêm trong 40 s không tương tác, 3 màn (kỳ vọng ≤ 2).
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3058");
const OUT = ".qa-dot58/lech-idle";
mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function dangNhap(ctx) {
  const f = `.qa-dot58/state-${TK.username}.json`;
  const ai = async () => { const r = await ctx.request.get(`${BASE}/api/trpc/auth.me`); try { return JSON.parse(await r.text())?.result?.data?.json?.username ?? null; } catch { return null; } };
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); }
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK });
  if (r.status() !== 200) throw new Error("dang nhap that bai");
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
}
const LECH = () => {
  const R = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const cv = document.querySelector("canvas");
  if (!cv) return { canvas: null, lop: {} };
  const c = R(cv); const ra = {};
  for (const t of ["lop-nhan-twin3d", "lop-canh-bao"]) {
    const el = document.querySelector(`[data-testid="${t}"]`);
    if (!el) { ra[t] = null; continue; }
    const r = R(el);
    ra[t] = { rect: r, lech: { x: r.x - c.x, y: r.y - c.y, w: r.w - c.w, h: r.h - c.h } };
  }
  return { canvas: c, lop: ra, soCanvas: document.querySelectorAll("canvas").length };
};
const DEM_KHUNG = (ms) => new Promise((res) => { let n = 0, a = window.__thongKeVe; const id = setInterval(() => { const b = window.__thongKeVe; if (b !== a) { n++; a = b; } }, 50); setTimeout(() => { clearInterval(id); res({ ms, khung: n, coBoDem: a !== undefined }); }, ms); });
const MAN = [
  { ten: "twin", url: "/twin", cho: '[data-testid="man-twin-van-hanh"] canvas' },
  { ten: "line", url: "/twin/line/2", cho: '[data-testid="man-twin-line"] canvas' },
  { ten: "may", url: "/twin/may/14", cho: '[data-testid="khoi-canh-may"] canvas' },
  { ten: "studio", url: "/twin-studio", cho: '[data-testid="man-twin-studio"] canvas' },
];
const kq = { lech: {}, idle: {} };
const browser = await chromium.launch();
try {
  for (const vp of ["1600x900", "1280x720"]) {
    const [W, H] = vp.split("x").map(Number);
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch {} });
    await dangNhap(ctx);
    const page = await ctx.newPage();
    for (const m of MAN) {
      await page.goto(`${BASE}${m.url}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(m.cho, { timeout: 90_000 }).catch(() => {});
      await page.waitForTimeout(7000);
      const d = await page.evaluate(LECH);
      kq.lech[`${m.ten}-${vp}`] = d;
      const L = Object.entries(d.lop).map(([k, v]) => `${k}=${v ? JSON.stringify(v.lech) : "—"}`).join(" ");
      console.log(`[${vp}] ${m.ten}: canvas ${JSON.stringify(d.canvas)} · ${L}`);
      if (vp === "1600x900" && m.ten !== "studio") {
        const i = await page.evaluate(DEM_KHUNG, 40_000);
        kq.idle[m.ten] = i;
        console.log(`   40 s đứng yên ${m.ten}: ${i.khung} khung (bộ đếm ${i.coBoDem})`);
      }
    }
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/kq.json`, JSON.stringify(kq, null, 2));
const xau = Object.entries(kq.lech).flatMap(([k, v]) => Object.entries(v.lop).filter(([, l]) => l && (l.lech.x || l.lech.y || l.lech.w || l.lech.h)).map(([t]) => `${k}/${t}`));
console.log(`=== LỆCH LỚP: ${Object.values(kq.lech).reduce((a, v) => a + Object.values(v.lop).filter(Boolean).length, 0)} lớp đo · KHÁC (0,0,0,0): ${xau.length} ${xau.join(",")} ===`);
console.log(`=== IDLE 40 s: ${Object.entries(kq.idle).map(([k, v]) => `${k}=${v.khung}`).join(" · ")} ===`);
