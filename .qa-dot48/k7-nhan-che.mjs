// ĐỢT 48 · K7-NC — CENSUS "tâm KHỐI máy bị NHÃN/BADGE của máy KHÁC phủ" (gốc rễ nghi cho K7a/K7b SAI: hit-test nhãn thắng raycast khối).
//   Mỗi màn × vp: (1) khung mặc định, (2) sau KÉO 60 px (cùng thao tác k7.mjs). Với MỌI máy trong khung: tâm khối px (dsMay), DOM tại điểm,
//   raycast (hitTai), nhãn/badge nào chứa điểm (data-machine-id / data-testid) ⇒ đếm máy có tâm nằm trong hộp nhãn/badge của máy KHÁC.
//   Rồi BẤM THẬT vào một máy bị phủ (nếu có) ⇒ URL đi tới máy nào (nhãn hay khối?). Ghi .qa-dot48/k7/nc-*.json + PNG.
//   node .qa-dot48/k7-nhan-che.mjs [--base=http://localhost:3048] [--vp=1600x900,1280x720] [--fc=1]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3048"); const VPS = arg("vp", "1600x900,1280x720").split(","); const FC = arg("fc", "1") === "1";
const OUT = ".qa-dot48/k7"; mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function trpcGet(ctx, proc, input) { const u = `${BASE}/api/trpc/${proc}` + (input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`); const r = await ctx.request.get(u); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status(), data: j?.result?.data?.json ?? j?.result?.data ?? null }; }
async function dangNhap(ctx) { const f = `.qa-dot48/state-${TK.username}.json`; const ai = async () => (await trpcGet(ctx, "auth.me")).data?.username ?? null; if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); } const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); if (res.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai"); writeFileSync(f, JSON.stringify(await ctx.cookies())); }
const MAN = [["/twin", "man-twin-van-hanh"], ["/twin/line/2", "man-twin-line"]];
// Census trong trang
const CENSUS = (manTid) => {
  const canvas = manTid ? document.querySelector(`[data-testid="${manTid}"] canvas`) : document.querySelector("canvas"); const cv = canvas.getBoundingClientRect();
  const R = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, d: b.bottom }; };
  const nhan = [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].map((el) => ({ id: Number(el.getAttribute("data-machine-id")), chu: el.textContent?.trim().slice(0, 30), rect: R(el), pe: getComputedStyle(el).pointerEvents })).filter((n) => n.rect.w > 0);
  const badge = [...document.querySelectorAll('[data-testid^="badge-canh-bao-"]')].map((el) => ({ t: el.getAttribute("data-testid"), id: Number(el.getAttribute("data-machine-id") ?? NaN), chu: el.textContent?.trim().slice(0, 30), rect: R(el), pe: getComputedStyle(el).pointerEvents })).filter((n) => n.rect.w > 0);
  const trong = (p, r) => p.X >= r.x && p.X <= r.r && p.Y >= r.y && p.Y <= r.d;
  const ds = (window.__demTuongTac?.dsMay?.() ?? []).filter((m) => m.trongKhung);
  const may = ds.map((m) => {
    const X = cv.left + m.x, Y = cv.top + m.y; const duoi = document.elementFromPoint(X, Y); const t = window.__demTuongTac?.tamMay?.(m.machineId); const hit = t ? window.__demTuongTac?.hitTai?.(t.ndcX, t.ndcY) : null;
    const nhanPhu = nhan.filter((n) => trong({ X, Y }, n.rect)); const badgePhu = badge.filter((b) => trong({ X, Y }, b.rect));
    return { id: m.machineId, X: Math.round(X), Y: Math.round(Y), duoiLaCanvas: duoi === canvas, duoi: duoi === canvas ? "canvas" : (duoi?.getAttribute?.("data-testid") ?? duoi?.tagName ?? "null"), hit: hit ? `${hit.ten}#${hit.batchId}` : null, nhanPhu: nhanPhu.map((n) => n.id), nhanPhuKhac: nhanPhu.filter((n) => n.id !== m.machineId).map((n) => `${n.id}:${n.chu}`), badgePhu: badgePhu.map((b) => b.t), badgePhuKhac: badgePhu.map((b) => b.t) /* badge id = andon_events.id (locBadge.ts:72), KHÔNG phải machineId ⇒ chỉ ghi nhận "có badge phủ", không quy máy; badge pointer-events:none và LopCanhBao không có click ⇒ không chặn bấm */ };
  });
  const bamDuoc = may.filter((m) => m.duoiLaCanvas && m.hit?.startsWith("twin3d-lo-may"));
  return { url: location.href, cv: { x: cv.left, y: cv.top, w: cv.width, h: cv.height }, soTrongKhung: ds.length, soBamDuoc: bamDuoc.length, soNhan: nhan.length, soBadge: badge.length, peNhan: [...new Set(nhan.map((n) => n.pe))], peBadge: [...new Set(badge.map((b) => b.pe))], nhan: nhan.map((n) => ({ id: n.id, chu: n.chu, rect: { x: Math.round(n.rect.x), y: Math.round(n.rect.y), w: Math.round(n.rect.w), h: Math.round(n.rect.h) } })), may, biNhanKhacPhu: bamDuoc.filter((m) => m.nhanPhuKhac.length).map((m) => ({ id: m.id, X: m.X, Y: m.Y, nhan: m.nhanPhuKhac })), biBadgeKhacPhu: bamDuoc.filter((m) => m.badgePhuKhac.length).map((m) => ({ id: m.id, X: m.X, Y: m.Y, badge: m.badgePhuKhac })), biNhanMinhPhu: bamDuoc.filter((m) => m.nhanPhu.includes(m.id)).length };
};
async function moMan(page, duong, man) { await page.goto(`${BASE}${duong}?do=1`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(man ? `[data-testid="${man}"] canvas` : "canvas", { timeout: 90_000 }); await page.waitForFunction(() => (window.__demTuongTac?.dsMay?.() ?? []).some((m) => m.trongKhung), null, { timeout: 60_000 }).catch(() => {}); await page.waitForTimeout(2_500); }
const browser = await chromium.launch(); const tong = {};
try {
  for (const vp of VPS) {
    const [W, H] = vp.split("x").map(Number); const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch {} }); await dangNhap(ctx);
    const ma = (await trpcGet(ctx, "twinCanh.trangThaiHangLoat", { factoryId: 1 })).data?.may ?? []; const tenMay = Object.fromEntries(ma.map((m) => [m.machineId, m.ma]));
    for (const [duong, man] of MAN) {
      const page = await ctx.newPage(); const kq = { duong, man, vp };
      try {
        await moMan(page, duong, man);
        kq.macDinh = await page.evaluate(CENSUS, man);
        await page.screenshot({ path: `${OUT}/nc-${man}-${vp}-macdinh.png` });
        // KÉO 60 px từ máy bấm được đầu tiên (như k7.mjs)
        const m0 = kq.macDinh.may.find((m) => m.duoiLaCanvas && m.hit?.startsWith("twin3d-lo-may"));
        if (m0) { await page.mouse.move(m0.X, m0.Y, { steps: 4 }); await page.mouse.down(); for (let i = 1; i <= 6; i++) { await page.mouse.move(m0.X + i * 10, m0.Y, { steps: 1 }); await page.waitForTimeout(16); } await page.mouse.up(); await page.waitForTimeout(1_500); }
        kq.sauKeo = await page.evaluate(CENSUS, man);
        await page.screenshot({ path: `${OUT}/nc-${man}-${vp}-saukeo.png` });
        const in1 = (c, ten) => `${ten}: trong khung ${c.soTrongKhung} · bấm được ${c.soBamDuoc} · nhãn ${c.soNhan} (pe ${c.peNhan}) badge ${c.soBadge} (pe ${c.peBadge}) · tâm bị NHÃN máy KHÁC phủ ${c.biNhanKhacPhu.length} [${c.biNhanKhacPhu.map((x) => `${x.id}(${tenMay[x.id] ?? "?"})@${x.X},${x.Y}←${x.nhan.join("|")}`).join(" ; ").slice(0, 260)}] · bị BADGE máy khác phủ ${c.biBadgeKhacPhu.length} [${c.biBadgeKhacPhu.map((x) => `${x.id}←${x.badge.join("|")}`).join(" ; ").slice(0, 160)}] · tâm trong nhãn CỦA MÌNH ${c.biNhanMinhPhu}`;
        console.log(`   [${vp} ${duong}] ${in1(kq.macDinh, "mặc định")}`); console.log(`   [${vp} ${duong}] ${in1(kq.sauKeo, "sau kéo 60px")}`);
        // BẤM THẬT vào một máy bị nhãn máy khác phủ (sau kéo) ⇒ đích?
        const nan = kq.sauKeo.biNhanKhacPhu[0] ?? kq.macDinh.biNhanKhacPhu[0]; if (nan && kq.sauKeo.biNhanKhacPhu[0] == null) { /* trường hợp chỉ có ở mặc định: đã kéo rồi, bỏ qua bấm */ }
        const bam = kq.sauKeo.biNhanKhacPhu[0];
        if (bam) {
          await page.mouse.move(bam.X, bam.Y, { steps: 4 }); await page.waitForTimeout(150); await page.mouse.click(bam.X, bam.Y);
          await page.waitForURL(/\/twin\/may\/\d+/, { timeout: 3_000 }).catch(() => {}); await page.waitForTimeout(500);
          const dich = (page.url().match(/\/twin\/may\/(\d+)/) ?? [])[1] ?? null; const idNhan = Number(bam.nhan[0].split(":")[0]);
          kq.bamBiPhu = { may: bam.id, maMay: tenMay[bam.id] ?? null, X: bam.X, Y: bam.Y, nhanPhu: bam.nhan, dich: dich ? Number(dich) : null, dichLaNhan: Number(dich) === idNhan, dichLaKhoi: Number(dich) === bam.id, url: page.url() };
          console.log(`      BẤM máy ${bam.id} (${tenMay[bam.id] ?? "?"}) tại tâm bị nhãn ${bam.nhan.join("|")} phủ ⇒ /twin/may/${dich} ⇒ đích = ${kq.bamBiPhu.dichLaNhan ? "MÁY CỦA NHÃN (nhãn thắng khối)" : kq.bamBiPhu.dichLaKhoi ? "KHỐI (khối thắng)" : "MÁY KHÁC?"}`);
        } else console.log(`      (không có máy bấm được nào bị nhãn máy khác phủ sau kéo ⇒ không bấm)`);
      } catch (e) { kq.loi = String(e).slice(0, 300); console.log(`   [${vp} ${duong}] HỎNG ${kq.loi}`); }
      tong[`${vp}${duong}`] = kq; writeFileSync(`${OUT}/nc-${man}-${vp}.json`, JSON.stringify(kq, null, 2)); await page.close();
    }
    if (FC) {
      const p3 = await ctx.newPage(); const kh = { vp };
      try {
        await p3.goto(`${BASE}/factory-command?do=1`, { waitUntil: "domcontentloaded" }); await p3.waitForTimeout(8_000);
        const nut3d = p3.locator("button[aria-pressed]").filter({ hasText: /3D/ }); if ((await nut3d.count()) > 0) await nut3d.first().click();
        await p3.waitForSelector("canvas", { timeout: 90_000 }); await p3.waitForFunction(() => (window.__demTuongTac?.dsMay?.() ?? []).some((m) => m.trongKhung), null, { timeout: 60_000 }).catch(() => {}); await p3.waitForTimeout(2_500);
        kh.census = await p3.evaluate(CENSUS, null);
        const tam = kh.census.may.map((m) => `${m.X},${m.Y}`); kh.soTamKhacNhau = new Set(tam).size;
        const cum = {}; for (const m of kh.census.may) { const k = `${Math.round(m.X / 20)},${Math.round(m.Y / 20)}`; cum[k] = (cum[k] ?? 0) + 1; } kh.cumLonNhat = Math.max(...Object.values(cum));
        console.log(`   [${vp} /factory-command 3D] trong khung ${kh.census.soTrongKhung} · bấm được ${kh.census.soBamDuoc} · tâm khác nhau ${kh.soTamKhacNhau} · cụm 20px lớn nhất ${kh.cumLonNhat} máy · nhãn ${kh.census.soNhan} · bị nhãn khác phủ ${kh.census.biNhanKhacPhu.length}`);
        await p3.screenshot({ path: `${OUT}/nc-factory-command-${vp}.png` });
      } catch (e) { kh.loi = String(e).slice(0, 300); console.log(`   [${vp} /factory-command] HỎNG ${kh.loi}`); }
      tong[`${vp}/factory-command`] = kh; writeFileSync(`${OUT}/nc-factory-command-${vp}.json`, JSON.stringify(kh, null, 2)); await p3.close();
    }
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/nc-tong.json`, JSON.stringify(tong, null, 2)); console.log("=== k7-nhan-che xong ===");
