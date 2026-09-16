/**
 * n4-ngansach.mjs — TIÊU CHÍ 2 + 3 sau bản vá NHÃN-CỤM.
 *
 *   node .qa-tapdoan/n4-ngansach.mjs <nhan>
 *
 *   ② biểu tượng toà ≥ 24 px; quan hệ cụm × toà đúng theo **dải mã của
 *     `sinh-summary.json`** (KHÔNG đo bằng khe hở trên màn);
 *   ③ lệnh vẽ < 150 · tam giác < 500 k · nhãn < 30 · ≥ 30 khung/s.
 *
 * ⚠ Khung hình đo trên ANGLE+GPU — Playwright mặc định SwiftShader cho fps giả.
 * ⚠ Đo ở khung MẶC ĐỊNH; phần fps phải kéo chuột nên chạy SAU khi đã đọc xong
 *   mọi con số của trạng thái chưa-chạm.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "sau";
const GOC = "http://localhost:3064";
const TRAN = { calls: 150, triangles: 500_000, nhan: 30, fps: 30, rongPx: 24 };
const VAI = ["qatd_giamdoc", "qatd_quanly", "qatd_kythuat", "qatd_congnhan", "qatd_admin"];

const TT = JSON.parse(fs.readFileSync(".qa-tapdoan/sinh-summary.json", "utf8"));
/** Nguồn ĐỘC LẬP của quan hệ cụm × toà: dải mã bộ sinh, không phải hình trên màn. */
const TOA_THEO_NHA_MAY = new Map();
for (const t of TT.toas)
  TOA_THEO_NHA_MAY.set(t.factoryId, (TOA_THEO_NHA_MAY.get(t.factoryId) ?? 0) + 1);

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ra = {};

for (const vai of VAI) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: "Qatd!2026" } });
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  /*
   * ⚠⚠ THIẾT BỊ ĐO TỰ SINH RA MỘT SỐ SAI — ghi lại vì đúng lớp bẫy của đợt này.
   *   Bản đầu chỉ đòi "hai lượt đọc liên tiếp CÙNG khoá". Khi cảnh chưa nạp xong,
   *   `bieuTuong()` trả `[]` hai lượt liền ⇒ khoá `""` khớp `""` ⇒ ĐỨNG YÊN TRÊN
   *   TẬP RỖNG và khai `qatd_giamdoc` "0 biểu tượng, 15 nhãn ẩn ngoài khung" —
   *   trong khi phép đo `n1-do.mjs` (có chốt `khoa.length > 2`) cho 12 biểu tượng
   *   và 15/15 nhãn hiện ở CÙNG bản dựng. Số SAI: 0 biểu tượng. Số ĐÚNG: 12.
   *   ⇒ Chốt thêm: phải qua 8 s VÀ khoá khác rỗng thì mới được coi là ổn định;
   *     vai thật sự 0 biểu tượng (`qatd_admin`) rơi qua hạn rồi đo tiếp.
   */
  await page.evaluate(() => {
    window.__n4t0 = performance.now();
  });
  await page
    .waitForFunction(
      () => {
        const ds = (window.__demSaBan && window.__demSaBan.bieuTuong()) || [];
        const khoa = ds.map((b) => `${b.toaNhaId}:${Math.round(b.rongPx)}`).join(",");
        const on = window.__n4 === khoa && khoa.length > 0;
        window.__n4 = khoa;
        return on && performance.now() - window.__n4t0 > 8000;
      },
      undefined,
      { timeout: 45_000, polling: 1000 },
    )
    .catch(() => {});

  const tinh = await page.evaluate(() => {
    const bt = (window.__demSaBan && window.__demSaBan.bieuTuong()) || [];
    const trong = bt.filter((b) => b.trongKhung);
    return {
      soBieuTuong: bt.length,
      soTrongKhung: trong.length,
      rongPx: trong.map((b) => Math.round(b.rongPx * 10) / 10).sort((a, b) => a - b),
      toaTheoNhaMay: bt.reduce((m, b) => ((m[b.factoryId] = (m[b.factoryId] ?? 0) + 1), m), {}),
      soNhan: (window.__demSaBan && window.__demSaBan.soNhan()) || null,
      soNhanDom: document.querySelectorAll(
        "[data-testid='nhan-toa-sa-ban'],[data-testid='nhan-cum-sa-ban']",
      ).length,
      thongKe: window.__thongKeVe || null,
      soCanvas: document.querySelectorAll("canvas").length,
    };
  });

  // ── fps khi ĐANG XOAY (chạm chuột SAU CÙNG) ────────────────────────────────
  let fps = null;
  const c = await page.$("canvas");
  const box = c ? await c.boundingBox() : null;
  if (box) {
    await page.evaluate(() => {
      window.__n4k = 0;
      const dem = () => {
        window.__n4k += 1;
        window.__n4raf = requestAnimationFrame(dem);
      };
      window.__n4raf = requestAnimationFrame(dem);
      window.__n4t = performance.now();
    });
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 0; i < 40; i += 1) {
      await page.mouse.move(cx + Math.sin(i / 4) * 160, cy + Math.cos(i / 6) * 40);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    fps = await page.evaluate(() => {
      const ms = performance.now() - window.__n4t;
      cancelAnimationFrame(window.__n4raf);
      return {
        khung: window.__n4k,
        ms: Math.round(ms),
        fps: Math.round((window.__n4k / ms) * 1000),
        thongKe: window.__thongKeVe || null,
      };
    });
  }

  const kyVong = Object.fromEntries(
    Object.keys(tinh.toaTheoNhaMay).map((id) => [id, TOA_THEO_NHA_MAY.get(Number(id)) ?? null]),
  );
  const lechQuanHe = Object.entries(tinh.toaTheoNhaMay).filter(
    ([id, n]) => kyVong[id] !== null && kyVong[id] !== n,
  );

  ra[vai] = { ...tinh, fps, kyVongToaTheoNhaMay: kyVong, lechQuanHe };
  const rMin = tinh.rongPx[0];
  const rMax = tinh.rongPx[tinh.rongPx.length - 1];
  console.log(
    `${vai.padEnd(15)} biểuTượng=${tinh.soBieuTuong} (trongKhung ${tinh.soTrongKhung})` +
      ` rộng=${rMin ?? "-"}..${rMax ?? "-"}px ${rMin >= TRAN.rongPx ? "✓" : "✗<24"}` +
      ` · lệnh=${tinh.thongKe && tinh.thongKe.calls}${(tinh.thongKe?.calls ?? 0) < TRAN.calls ? "✓" : "✗"}` +
      ` tamGiác=${tinh.thongKe && tinh.thongKe.triangles}${(tinh.thongKe?.triangles ?? 0) < TRAN.triangles ? "✓" : "✗"}` +
      ` nhãnDOM=${tinh.soNhanDom}${tinh.soNhanDom < TRAN.nhan ? "✓" : "✗"}` +
      ` fps=${fps && fps.fps}${(fps?.fps ?? 0) >= TRAN.fps ? "✓" : "✗"}` +
      ` canvas=${tinh.soCanvas}`,
  );
  console.log(
    `                soNhan=${JSON.stringify(tinh.soNhan)}` +
      `  ve+an=tong? ${tinh.soNhan ? tinh.soNhan.ve + tinh.soNhan.an === tinh.soNhan.tong : "-"}`,
  );
  console.log(
    `                toà/nhà máy trên cảnh=${JSON.stringify(tinh.toaTheoNhaMay)} · theo bộ sinh=${JSON.stringify(kyVong)}` +
      ` · lệch=${lechQuanHe.length}`,
  );
  await ctx.close();
}
await trinh.close();
fs.writeFileSync(`.qa-tapdoan/n4-${NHAN}.json`, JSON.stringify(ra, null, 1));
console.log(`→ .qa-tapdoan/n4-${NHAN}.json`);
