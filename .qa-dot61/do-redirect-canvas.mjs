/**
 * ĐỢT 61 — đo SỐNG trên bản dựng .qa-dot61/dist-61 (cổng 3061):
 *   (1) 13 đường vào cũ của `dinhTuyenTwinCu` có tới ĐÚNG đích không (đo, không đoán)
 *   (2) 6 màn mở được + đếm canvas: DOM `document.querySelectorAll("canvas").length`
 *       VÀ `window.__soCanvas` (bộ đếm của kit twin3d). Đếm CẢ HAI vì G99: `__soCanvas`
 *       MÙ với canvas không đăng ký qua kit — `<Canvas>` cũ của CommandCenter chính là
 *       loại ấy, nên nếu chỉ đọc `__soCanvas` thì "0" nói lên rất ít.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3061";
const VAI = { u: "e2e_tai_loE", p: "E2eTaiLoE!2026" };

const DICH = {
  "/digital-twin": "/twin",
  "/digital-twin?tab=overview": "/twin",
  "/digital-twin?tab=center": "/twin",
  "/digital-twin?tab=map": "/twin",
  "/digital-twin?tab=floor": "/twin-studio",
  "/digital-twin?tab=layout": "/twin-studio",
  "/digital-twin?tab=cell": "/twin",
  "/digital-twin?tab=rf": "/rf-test-cell",
  "/factory-live-map": "/twin",
  "/factory-floor-editor": "/twin-studio",
  "/cell-twin": "/twin",
  "/digital-twin-center": "/twin",
  "/layout": "/twin-studio",
};

const MAN = ["/twin", "/twin/line/2", "/twin/may/14", "/twin-studio", "/command-center", "/factory-command"];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: VAI.u, password: VAI.p } });
const me = await ctx.request.get(`${BASE}/api/trpc/auth.me`);
const ten = JSON.parse(await me.text())?.result?.data?.json?.username ?? null;
if (r.status() !== 200 || ten !== VAI.u) { console.error("DANG NHAP THAT BAI", r.status(), ten); process.exit(1); }
console.log(`dang nhap: ${ten} (login ${r.status()})`);

const p = await ctx.newPage();
const kq = { redirect: [], man: [] };

console.log("\n=== (1) 13 DUONG VAO CU ===");
let dat = 0;
for (const [tu, mong] of Object.entries(DICH)) {
  await p.goto(`${BASE}${tu}`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(700);
  const thuc = new URL(p.url()).pathname + new URL(p.url()).search;
  const ok = thuc === mong || thuc.startsWith(mong + "?");
  if (ok) dat++;
  kq.redirect.push({ tu, mong, thuc, ok });
  console.log(`${ok ? "DAT " : "SAI "} ${tu.padEnd(30)} -> ${thuc.padEnd(16)} (mong ${mong})`);
}
console.log(`=> ${dat}/13 dung dich`);

console.log("\n=== (2) 6 MAN: mo duoc + dem canvas ===");
for (const m of MAN) {
  await p.goto(`${BASE}${m}`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(4500);
  const d = await p.evaluate(() => ({
    duong: location.pathname,
    domCanvas: document.querySelectorAll("canvas").length,
    soCanvas: window.__soCanvas ?? null,
    coNoiDung: document.body.innerText.trim().length,
    tieuDe: document.title,
  }));
  kq.man.push({ yeuCau: m, ...d });
  console.log(`${m.padEnd(18)} url=${d.duong.padEnd(16)} DOM canvas=${d.domCanvas}  __soCanvas=${d.soCanvas}  chu=${d.coNoiDung}`);
}

writeFileSync(".qa-dot61/09-redirect-canvas.json", JSON.stringify(kq, null, 2));
await b.close();
console.log("\nda ghi .qa-dot61/09-redirect-canvas.json");
