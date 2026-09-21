/**
 * v6-2d-do-che.mjs — KHẢO SÁT MỨC ĐỘ: "tâm bị che" là phiền hay là CHẶN?
 *
 * `v6-2d-che-tam.mjs` cho biết 2/14 biểu tượng có TÂM bị che. Nhưng tâm bị che chưa chắc là
 * không bấm được: biểu tượng rộng 53×38 px, lớp phủ chỉ 310×29 px. Phép đo này hỏi **kết cục**:
 *
 *   ① bao nhiêu phần trăm DIỆN TÍCH biểu tượng còn bấm trúng chính nó?
 *   ② ô vuông 24×24 lớn nhất còn trống có tồn tại không? (tiêu chí WCAG 2.5.8 AA)
 *   ③ và cú bấm ở điểm trống ấy có ĐIỀU HƯỚNG thật không?
 *
 * ⚠ Không suy từ hình học: `elementFromPoint` mới biết `pointer-events`, z-index và
 *   `clip-path` cộng lại ra cái gì.
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3000";
const nghi = (m) => new Promise((r) => setTimeout(r, m));

const b = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const c = await b.newContext({ viewport: { width: 1280, height: 720 } });
await c.request.post(`${BASE}/api/auth/login`, {
  data: { username: "qatd_admin", password: "Qatd!2026" },
});
const p = await c.newPage();
await p.goto(`${BASE}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
await p.waitForSelector('[data-testid="nut-che-2d"]', { timeout: 30000 }).catch(() => {});
await nghi(9000);
await p.click('[data-testid="nut-che-2d"]');
await nghi(8000);

const kq = await p.evaluate(() => {
  const BUOC = 2; // px — lưới lấy mẫu
  const CANH = 24; // px — ngưỡng WCAG 2.5.8 AA
  const toa = [...document.querySelectorAll('[data-testid="toa-2d-sa-ban"]')];

  return toa.map((t, i) => {
    const r = t.getBoundingClientRect();
    const x0 = Math.ceil(r.left);
    const y0 = Math.ceil(r.top);
    const nx = Math.floor(r.width / BUOC);
    const ny = Math.floor(r.height / BUOC);

    // Lưới boolean: điểm này có bấm trúng CHÍNH biểu tượng không?
    const o = [];
    let trong = 0;
    for (let jy = 0; jy < ny; jy++) {
      const hang = [];
      for (let jx = 0; jx < nx; jx++) {
        const x = x0 + jx * BUOC;
        const y = y0 + jy * BUOC;
        const el = document.elementFromPoint(x, y);
        const ok = el === t || t.contains(el);
        hang.push(ok ? 1 : 0);
        if (ok) trong++;
      }
      o.push(hang);
    }

    // Ô vuông trống lớn nhất (cạnh px) — quy hoạch động trên lưới boolean.
    const dp = o.map((h) => h.slice());
    let canhMax = 0;
    let viTri = null;
    for (let jy = 0; jy < ny; jy++) {
      for (let jx = 0; jx < nx; jx++) {
        if (!dp[jy][jx]) continue;
        if (jy > 0 && jx > 0) {
          dp[jy][jx] = 1 + Math.min(dp[jy - 1][jx], dp[jy][jx - 1], dp[jy - 1][jx - 1]);
        }
        if (dp[jy][jx] > canhMax) {
          canhMax = dp[jy][jx];
          viTri = { jx, jy };
        }
      }
    }
    const canhPx = canhMax * BUOC;
    // Tâm của ô vuông trống lớn nhất — điểm bấm tốt nhất còn lại.
    const diemTot = viTri
      ? {
          x: Math.round(x0 + (viTri.jx - canhMax / 2 + 0.5) * BUOC),
          y: Math.round(y0 + (viTri.jy - canhMax / 2 + 0.5) * BUOC),
        }
      : null;

    return {
      i,
      toaNhaId: t.getAttribute("data-toa-nha-id"),
      factoryId: Number(t.getAttribute("data-factory-id")),
      rong: Math.round(r.width),
      cao: Math.round(r.height),
      tiLeTrong: nx * ny ? Math.round((100 * trong) / (nx * ny)) : 0,
      oVuongTrongPx: canhPx,
      datWcag: canhPx >= CANH,
      diemTot,
    };
  });
});

console.log("idx toà   nm   cỡ      % diện tích còn bấm được   ô vuông trống   ≥24px");
for (const h of kq) {
  console.log(
    `#${String(h.i).padStart(2)} ${String(h.toaNhaId).padStart(4)} ${String(h.factoryId).padStart(3)}  ` +
      `${String(h.rong).padStart(2)}×${String(h.cao).padStart(2)}   ` +
      `${String(h.tiLeTrong).padStart(3)} %                    ` +
      `${String(h.oVuongTrongPx).padStart(2)}×${String(h.oVuongTrongPx).padStart(2)} px      ` +
      `${h.datWcag ? "✅" : "❌"}`,
  );
}
console.log(`\nđạt 24×24 tại một ô còn trống: ${kq.filter((h) => h.datWcag).length}/${kq.length}`);

// ③ Bấm THẬT vào điểm trống tốt nhất của hai biểu tượng bị che — có điều hướng không?
const biChe = kq.filter((h) => h.tiLeTrong < 100 && h.diemTot);
console.log(`\n── bấm thật tại điểm trống của ${biChe.length} biểu tượng bị che ──`);
for (const h of biChe) {
  await p.goto(`${BASE}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await nghi(6000);
  await p.click('[data-testid="nut-che-2d"]').catch(() => {});
  await nghi(6000);
  const truoc = p.url();
  await p.mouse.click(h.diemTot.x, h.diemTot.y);
  await nghi(2500);
  const sau = p.url();
  const pv = new URL(sau).searchParams.get("pv");
  console.log(
    `  toà ${h.toaNhaId} (nm ${h.factoryId}) bấm (${h.diemTot.x},${h.diemTot.y}) ⇒ pv=${pv}  ` +
      `${pv === `factory:${h.factoryId}` ? "✅ ĐÚNG" : truoc === sau ? "❌ KHÔNG ĐỔI" : "⚠ đổi nhưng SAI"}`,
  );
}

await b.close();
