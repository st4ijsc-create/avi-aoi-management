// ĐỢT 58 — M10 phần KẾT CỤC: nút còn BẤM ĐƯỢC không, và nhãn 3D có bị nút che không.
// ABLATION CHẠY LÚC THỰC THI (không sửa mã sản phẩm): `LopNhan` đọc `[data-che-nhan]` trong
// `useFrame` mỗi khung ⇒ gỡ thuộc tính trên DOM là đủ để lật hành vi. Gỡ → đo → gắn lại → đo.
//   node .qa-dot58/m10-bam.mjs --base=... --tag=head --vp=1280x720,1600x900
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3058");
const TAG = arg("tag", "head");
const VPS = arg("vp", "1280x720,1600x900").split(",");
const LANG = arg("lang", "vi");
const DUONG = arg("duong", "/twin");
const OUT = `.qa-dot58/m10-${TAG}-${LANG}${DUONG.includes("nhanTatCa") ? "-tatca" : ""}`;
mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function dangNhap(ctx) {
  const f = `.qa-dot58/state-${TK.username}.json`;
  const ai = async () => { const r = await ctx.request.get(`${BASE}/api/trpc/auth.me`); const t = await r.text(); try { return JSON.parse(t)?.result?.data?.json?.username ?? null; } catch { return null; } };
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); }
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK });
  if (r.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai");
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
}
const DO_NHAN = () => {
  const R = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const giao = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const hien = (el) => { const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const nhan = [...document.querySelectorAll('[data-testid^="nhan-may"],[data-testid^="nhan-line"],[data-testid^="nhan-tram"]')].filter(hien);
  const ra = { soNhan: nhan.length, che: [], tongGiao: 0, nut: {} };
  for (const tid of ["nut-thu-trai", "nut-thu-phai"]) {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!el || !hien(el)) { ra.nut[tid] = null; continue; }
    const r = el.getBoundingClientRect();
    ra.nut[tid] = { rect: R(el), cheNhan: el.getAttribute("data-che-nhan"), neo: el.getAttribute("data-neo") };
    for (const n of nhan) {
      const g = giao(r, n.getBoundingClientRect());
      if (g > 0.5) { ra.che.push({ nut: tid, nhan: n.getAttribute("data-testid"), chu: n.textContent.trim().slice(0, 20), giao: Math.round(g) }); ra.tongGiao += g; }
    }
  }
  ra.tongGiao = Math.round(ra.tongGiao);
  return ra;
};
const GO = () => { const n = []; for (const el of document.querySelectorAll('[data-testid="nut-thu-trai"],[data-testid="nut-thu-phai"]')) { if (el.hasAttribute("data-che-nhan")) { el.removeAttribute("data-che-nhan"); n.push(el.getAttribute("data-testid")); } } return n; };
const GAN = () => { const n = []; for (const el of document.querySelectorAll('[data-testid="nut-thu-trai"],[data-testid="nut-thu-phai"]')) { el.setAttribute("data-che-nhan", "1"); n.push(el.getAttribute("data-testid")); } return n; };
const BE_RONG = () => {
  const p = (t) => { const el = document.querySelector(`[data-testid="${t}"]`); if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), x: Math.round(b.x) }; };
  return { trai: p("panel-trai"), phai: p("panel-phai"), nutTrai: p("nut-thu-trai"), nutPhai: p("nut-thu-phai") };
};
const kq = {};
const browser = await chromium.launch();
try {
  for (const vp of VPS) {
    const [W, H] = vp.split("x").map(Number);
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.addInitScript((l) => { try { localStorage.setItem("i18nextLng", l); localStorage.removeItem("twin3d.nhan.macDinh"); } catch {} }, LANG);
    await dangNhap(ctx);
    const page = await ctx.newPage();
    await page.goto(`${BASE}${DUONG}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 });
    await page.waitForTimeout(8000);
    const K = (kq[vp] = {});
    K.truoc = await page.evaluate(DO_NHAN);
    K.rongTruoc = await page.evaluate(BE_RONG);
    await page.screenshot({ path: `${OUT}/${vp}-1-goc.png` });

    /* ① KẾT CỤC: bấm nút trái ⇒ panel phải THU lại; bấm lần nữa ⇒ MỞ lại */
    await page.click('[data-testid="nut-thu-trai"]');
    await page.waitForTimeout(1200);
    K.rongSauThu = await page.evaluate(BE_RONG);
    await page.screenshot({ path: `${OUT}/${vp}-2-da-thu.png` });
    await page.click('[data-testid="nut-thu-trai"]');
    await page.waitForTimeout(1200);
    K.rongSauMo = await page.evaluate(BE_RONG);
    K.bamCoTacDung = !!(K.rongTruoc.trai && K.rongSauThu.trai != null && K.rongSauThu.trai.w < K.rongTruoc.trai.w - 20 && K.rongSauMo.trai.w >= K.rongTruoc.trai.w - 2);

    /* ② nhãn bị nút che — trạng thái THẬT */
    await page.waitForTimeout(3000);
    K.nhanTruocGo = await page.evaluate(DO_NHAN);

    /* ③ ABLATION: gỡ data-che-nhan ⇒ lớp nhãn được phép vẽ dưới nút */
    K.daGo = await page.evaluate(GO);
    await page.waitForTimeout(7000);
    K.nhanSauGo = await page.evaluate(DO_NHAN);
    await page.screenshot({ path: `${OUT}/${vp}-3-ablation-go.png` });

    /* ④ HOÀN NGUYÊN */
    K.daGan = await page.evaluate(GAN);
    await page.waitForTimeout(7000);
    K.nhanSauGan = await page.evaluate(DO_NHAN);
    await page.screenshot({ path: `${OUT}/${vp}-4-hoan-nguyen.png` });
    console.log(`[${vp}] bấm có tác dụng=${K.bamCoTacDung} (panel ${K.rongTruoc.trai?.w}→${K.rongSauThu.trai?.w}→${K.rongSauMo.trai?.w}px) · nhãn bị che: trước=${K.nhanTruocGo.che.length}/${K.nhanTruocGo.tongGiao}px² · SAU GỠ=${K.nhanSauGo.che.length}/${K.nhanSauGo.tongGiao}px² · sau gắn lại=${K.nhanSauGan.che.length}/${K.nhanSauGan.tongGiao}px² (số nhãn ${K.nhanTruocGo.soNhan}/${K.nhanSauGo.soNhan}/${K.nhanSauGan.soNhan})`);
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/kq.json`, JSON.stringify(kq, null, 2));
console.log(`=== m10-bam tag=${TAG} xong → ${OUT}/kq.json ===`);
