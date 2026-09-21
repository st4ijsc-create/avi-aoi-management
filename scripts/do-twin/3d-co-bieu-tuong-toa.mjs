/** Đường cơ sở: cỡ từng biểu tượng toà trên cảnh 3D tập đoàn (FOV 45 hiện hành). */
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:3000";
const nghi = (m) => new Promise((r) => setTimeout(r, m));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=d3d11","--enable-gpu","--ignore-gpu-blocklist"] });
for (const [w, h] of [[1280, 720], [1920, 1080]]) {
  const c = await b.newContext({ viewport: { width: w, height: h } });
  await c.request.post(`${BASE}/api/auth/login`, { data: { username: "qatd_admin", password: "Qatd!2026" } });
  const p = await c.newPage();
  await p.goto(`${BASE}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await nghi(16000);
  const r = await p.evaluate(() => {
    const bt = window.__demSaBan?.bieuTuong?.() ?? [];
    return bt.map((x) => ({
      toa: x.toaNhaId, nm: x.factoryId,
      w: +(x.rongPx).toFixed(1), h: +(x.caoPx).toFixed(1),
      nho: +Math.min(x.rongPx, x.caoPx).toFixed(1),
      cy: +((x.hop.tren + x.hop.duoi) / 2).toFixed(0),
      trong: x.trongKhung,
    }));
  });
  const nho = r.map((x) => x.nho);
  console.log(`\n══ ${w}×${h} · ${r.length} biểu tượng · đạt ≥24px: ${nho.filter((v) => v >= 24).length}/${r.length} ══`);
  console.log(`   nhỏ nhất ${Math.min(...nho).toFixed(1)} px · lớn nhất ${Math.max(...nho).toFixed(1)} px · tỉ số ${(Math.max(...nho)/Math.min(...nho)).toFixed(2)}`);
  for (const x of [...r].sort((a, b2) => a.nho - b2.nho))
    console.log(`   toà ${String(x.toa).padStart(4)} nm ${String(x.nm).padStart(3)}  ${String(x.w).padStart(6)}×${String(x.h).padStart(5)}  nhỏ=${String(x.nho).padStart(5)} px  tâmY=${String(x.cy).padStart(4)}  ${x.nho >= 24 ? "✅" : "❌"}`);
  await c.close();
}
await b.close();
