// ĐỢT 48 — LỆCH LỚP-vs-CANVAS cho MỌI lớp `<Html fullscreen>` (G110): lop-nhan-twin3d + lop-canh-bao + bất kỳ [data-testid^="lop-"] và
//   mọi div position:absolute có kích thước = canvas trong màn. 4 màn × 2 vp, vai e2e_tai_loE (auth.me thật).
//   node .qa-dot49/probe-lop48.mjs [--base=http://localhost:3049] [--vp=1600x900,1280x720] [--tag=lop]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3049"); const VPS = arg("vp", "1600x900,1280x720").split(","); const TAG = arg("tag", "lop");
const OUT = ".qa-dot49/lop"; mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { data: j?.result?.data?.json ?? j?.result?.data ?? null }; }
async function dangNhap(ctx) { const f = `.qa-dot49/state-${TK.username}.json`; const ai = async () => (await trpcGet(ctx, "auth.me")).data?.username ?? null; if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); } const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); if (res.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai"); writeFileSync(f, JSON.stringify(await ctx.cookies())); }
const MAN = [["/twin", "man-twin-van-hanh"], ["/twin/line/2", "man-twin-line"], ["/twin/may/14", "man-twin-may"], ["/twin-studio", "man-twin-studio"]];
const DO = (manTid) => {
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const man = document.querySelector(`[data-testid="${manTid}"]`);
  const canvasEl = man?.querySelector("canvas") ?? document.querySelector("canvas");
  const cv = R(canvasEl);
  const lech = (r) => (r && cv ? { dx: r.x - cv.x, dy: r.y - cv.y, dw: r.w - cv.w, dh: r.h - cv.h } : null);
  const lop = {};
  for (const t of ["lop-nhan-twin3d", "lop-canh-bao"]) { const el = document.querySelector(`[data-testid="${t}"]`); lop[t] = el ? { rect: R(el), lech: lech(R(el)), cha: R(el.parentElement), pos: getComputedStyle(el).position, z: getComputedStyle(el).zIndex, pe: getComputedStyle(el).pointerEvents } : null; }
  // MỌI lớp khác khai data-testid^=lop- (không phải hai lớp trên)
  const khac = [...document.querySelectorAll('[data-testid^="lop-"]')].filter((el) => !["lop-nhan-twin3d", "lop-canh-bao"].includes(el.getAttribute("data-testid"))).map((el) => ({ t: el.getAttribute("data-testid"), rect: R(el), lech: lech(R(el)) }));
  // Div absolute có kích thước = canvas nằm trong màn (mọi <Html fullscreen> của drei sẽ rơi vào đây)
  const fullscreen = [];
  if (man && cv) for (const el of man.querySelectorAll("div")) { const cs = getComputedStyle(el); if (cs.position !== "absolute") continue; const r = R(el); if (Math.abs(r.w - cv.w) <= 1 && Math.abs(r.h - cv.h) <= 1) fullscreen.push({ t: el.getAttribute("data-testid") ?? el.className.toString().slice(0, 40), rect: r, lech: lech(r), soCon: el.children.length }); }
  const nhan = [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].map((el) => R(el));
  const badge = [...document.querySelectorAll('[data-testid^="badge-canh-bao-"]')].map((el) => ({ t: el.getAttribute("data-testid"), r: R(el), left: el.style.left, top: el.style.top }));
  return { url: location.href, canvas: cv, soCanvas: document.querySelectorAll("canvas").length, __soCanvas: window.__soCanvas ?? null, lop, khac, fullscreen, soNhan: nhan.length, soBadge: badge.length, badge0: badge[0] ?? null };
};
const browser = await chromium.launch();
const kq = {}; let dat = 0, truot = 0;
try {
  for (const vp of VPS) {
    const [W, H] = vp.split("x").map(Number); const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch {} });
    await dangNhap(ctx);
    for (const [duong, man] of MAN) {
      const page = await ctx.newPage(); const t0 = Date.now();
      await page.goto(`${BASE}${duong}`, { waitUntil: "domcontentloaded" });
      const coCanvas = await page.waitForSelector(`[data-testid="${man}"] canvas`, { timeout: 90000 }).then(() => true).catch(() => false);
      await page.waitForTimeout(6000);
      const d = await page.evaluate(DO, man); d.msToiCanvas = Date.now() - t0; d.coCanvas = coCanvas;
      kq[`${vp}${duong}`] = d;
      const ln = d.lop["lop-nhan-twin3d"], lb = d.lop["lop-canh-bao"];
      const ok = (l) => l === null || (l.lech && l.lech.dx === 0 && l.lech.dy === 0 && l.lech.dw === 0 && l.lech.dh === 0);
      // chỉ xét lớp KHÁC có kích thước = canvas (lớp phủ toàn khung); lớp nhỏ (vd lop-phu-dong-thoi-gian = thanh dòng thời gian đáy canvas) chỉ ghi nhận
      const okKhac = d.khac.filter((k) => k.rect && k.lech && Math.abs(k.lech.dw) <= 1 && Math.abs(k.lech.dh) <= 1).every((k) => k.lech.dx === 0 && k.lech.dy === 0) && d.fullscreen.every((f) => f.lech.dx === 0 && f.lech.dy === 0);
      const okAll = coCanvas && ok(ln) && ok(lb) && okKhac;
      okAll ? dat++ : truot++;
      console.log(`   [${vp} ${duong}] ${okAll ? "ĐẠT" : "TRƯỢT"} canvas ${JSON.stringify(d.canvas)} · lop-nhan ${ln ? `lệch (${ln.lech.dx},${ln.lech.dy}) kích (${ln.lech.dw},${ln.lech.dh})` : "KHÔNG CÓ"} · lop-canh-bao ${lb ? `lệch (${lb.lech.dx},${lb.lech.dy}) kích (${lb.lech.dw},${lb.lech.dh})` : "KHÔNG CÓ"} · lớp khác ${d.khac.map((k) => `${k.t}(${k.lech?.dx},${k.lech?.dy})`).join(" ") || "—"} · fullscreen-abs ${d.fullscreen.length}: ${d.fullscreen.map((f) => `${f.t}(${f.lech.dx},${f.lech.dy})`).join(" ")} · nhãn ${d.soNhan} badge ${d.soBadge} · soCanvas dom ${d.soCanvas}/kit ${d.__soCanvas}`);
      await page.screenshot({ path: `${OUT}/${TAG}-${vp}${duong.replace(/\//g, "_")}.png` });
      await page.close();
    }
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(kq, null, 2));
console.log(`=== probe-lop48 ${TAG}: ĐẠT ${dat} · TRƯỢT ${truot} / ${dat + truot} (màn×vp) ===`);
