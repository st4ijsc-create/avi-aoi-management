// ĐỢT 58 — M10 · ABLATION lần 2: ép lớp nhãn TÍNH LẠI bằng một chu kỳ ĐỔI KÍCH THƯỚC CỬA SỔ
// (canvas resize ⇒ chiếu lại ⇒ `locNhan` chạy với vùng cấm HIỆN TẠI), đo ở CÙNG một cỡ 1600x900:
//   A: còn `data-che-nhan`   B: đã gỡ   C: gắn lại.  Chênh A→B chính là hiệu lực của thuộc tính.
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3058");
const TAG = arg("tag", "head");
const OUT = `.qa-dot58/m10ab2-${TAG}`;
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
  const el = document.querySelector('[data-testid="nut-thu-trai"]');
  const ra = { soNhan: nhan.length, che: [], tong: 0, cheNhan: el?.getAttribute("data-che-nhan") ?? null, thongKe: window.__thongKeVe ?? null };
  if (el && hien(el)) { const r = el.getBoundingClientRect(); for (const n of nhan) { const g = giao(r, n.getBoundingClientRect()); if (g > 0.5) { ra.che.push({ chu: n.textContent.trim().slice(0, 22), giao: Math.round(g) }); ra.tong += Math.round(g); } } }
  return ra;
};
const kq = {};
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch {} });
  await dangNhap(ctx);
  const page = await ctx.newPage();
  const chuKy = async () => { await page.setViewportSize({ width: 1500, height: 860 }); await page.waitForTimeout(2500); await page.setViewportSize({ width: 1600, height: 900 }); await page.waitForTimeout(3500); };
  await page.goto(`${BASE}/twin?thu=nhanTatCa`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 });
  await page.waitForTimeout(8000);
  kq.goc = await page.evaluate(DO);
  await chuKy();
  kq.A_conThuocTinh = await page.evaluate(DO);
  await page.screenshot({ path: `${OUT}/A-con-thuoc-tinh.png` });
  await page.evaluate(() => document.querySelector('[data-testid="nut-thu-trai"]')?.removeAttribute("data-che-nhan"));
  await chuKy();
  kq.B_daGo = await page.evaluate(DO);
  await page.screenshot({ path: `${OUT}/B-da-go.png` });
  await page.evaluate(() => document.querySelector('[data-testid="nut-thu-trai"]')?.setAttribute("data-che-nhan", "1"));
  await chuKy();
  kq.C_hoanNguyen = await page.evaluate(DO);
  await page.screenshot({ path: `${OUT}/C-hoan-nguyen.png` });
  console.log(`gốc=${kq.goc.che.length}/${kq.goc.tong}px² · A(còn)=${kq.A_conThuocTinh.che.length}/${kq.A_conThuocTinh.tong}px² nhãn ${kq.A_conThuocTinh.soNhan} · B(GỠ)=${kq.B_daGo.che.length}/${kq.B_daGo.tong}px² nhãn ${kq.B_daGo.soNhan} · C(gắn lại)=${kq.C_hoanNguyen.che.length}/${kq.C_hoanNguyen.tong}px² nhãn ${kq.C_hoanNguyen.soNhan}`);
  console.log(`   B che: ${JSON.stringify(kq.B_daGo.che)}`);
  await ctx.close();
} finally { await browser.close(); }
writeFileSync(`${OUT}/kq.json`, JSON.stringify(kq, null, 2));
console.log(`=== m10-ablation2 ${TAG} xong → ${OUT}/kq.json ===`);
