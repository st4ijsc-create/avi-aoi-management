/**
 * p50b-tran-zoom.mjs — TIÊU CHÍ 1: CUỘN RA **TỚI TRẦN ZOOM** MÀ KHÔNG MẤT VẬT THỂ NÀO.
 *
 * Cuộn cho tới khi `camXa` NGỪNG TĂNG (OrbitControls kẹp ở `maxDistance` — đó mới là
 * "trần", không phải một số nấc do người đo chọn), rồi so số vật thể ở trần với số ở
 * khung mặc định.
 *
 * ★ CHỐNG TỰ THOẢ:
 *   · khẳng định KÍCH THƯỚC trước: nấc 0 phải có `n0 > 0`, nếu không in "KHÔNG ĐO ĐƯỢC";
 *   · "đã tới trần" = camXa đứng yên HAI lượt liên tiếp, KHÔNG phải hết vòng lặp;
 *   · hai thước độc lập: `__demSaBan.bieuTuong()` (sa bàn) và `__demTuongTac.dsMay()`
 *     lọc `trongKhung` (mọi cấp khác) — cả hai đều tính qua `z < 1`, tức qua `far`.
 *
 * Dùng: node .qa-tapdoan/p50b-tran-zoom.mjs <nhan>
 */
import { chromium } from "playwright";
import fs from "node:fs";

const GOC = "http://localhost:3077";
const MK = "Qatd!2026";
const NHAN = process.argv[2] ?? "s";
const TT = JSON.parse(fs.readFileSync(".qa-tapdoan/sinh-summary.json", "utf8"));

/** Một ca = vai × màn. `dem` nói đọc số vật thể bằng thước nào. */
const CA = [];
for (const vai of ["qatd_admin", "qatd_giamdoc", "qatd_quanly", "qatd_kythuat", "qatd_congnhan"]) {
  CA.push({ vai, ten: "tapDoan", url: "/twin?pv=tapdoan&do=1", dem: "saBan" });
}
// Các cấp hẹp hơn: đo trên vai giám đốc (thấy 2 nhà máy) và admin (thấy cả FUYU).
const nmA = TT.congTys[0];
const toaA = TT.toas.find((t) => t.factoryId === nmA.id);
const tangA = TT.tangs.find((t) => t.toaNhaId === toaA.id);
for (const vai of ["qatd_giamdoc", "qatd_admin"]) {
  CA.push({ vai, ten: "nhaMay", url: `/twin?nm=${nmA.id}&pv=factory:${nmA.id}&do=1`, dem: "may" });
  CA.push({ vai, ten: "tang", url: `/twin?nm=${nmA.id}&pv=tang:${tangA.id}&do=1`, dem: "may" });
  CA.push({ vai, ten: "line", url: `/twin/line/${nmA.lineDauId}?do=1`, dem: "may" });
  CA.push({ vai, ten: "may", url: `/twin/may/${nmA.mayDauId}?do=1`, dem: "may" });
}

const trinh = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const ra = [];
for (const ca of CA) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: ca.vai, password: MK } });
  await page.goto(`${GOC}${ca.url}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  // Chờ cảnh VẼ THẬT (calls > 0) rồi chờ số vật thể ỔN ĐỊNH và KHÁC RỖNG.
  await page
    .waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, undefined, { timeout: 90000, polling: 500 })
    .catch(() => {});
  const docSo = async () =>
    page.evaluate((dem) => {
      const tk = window.__thongKeVe ?? null;
      const n =
        dem === "saBan"
          ? (window.__demSaBan?.bieuTuong?.() ?? []).length
          : (window.__demTuongTac?.dsMay?.() ?? []).filter((m) => m.trongKhung).length;
      return { n, far: tk?.far ?? null, near: tk?.near ?? null, camXa: tk?.camXa ?? null, calls: tk?.calls ?? null };
    }, ca.dem);
  await page
    .waitForFunction(
      (dem) => {
        const n =
          dem === "saBan"
            ? (window.__demSaBan?.bieuTuong?.() ?? []).length
            : (window.__demTuongTac?.dsMay?.() ?? []).filter((m) => m.trongKhung).length;
        const on = window.__p50b === n && n > 0;
        window.__p50b = n;
        return on;
      },
      ca.dem,
      { timeout: 120000, polling: 1000 },
    )
    .catch(() => {});
  await page.waitForTimeout(2500);

  const d0 = await docSo();
  const cv = await page.locator("canvas").first().boundingBox();
  let toiTran = false;
  let nacTran = 0;
  let nMin = d0.n;
  let dTran = d0;
  if (cv && d0.n > 0) {
    await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
    let truoc = d0.camXa;
    let dungYen = 0;
    for (let i = 1; i <= 60; i += 1) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(140);
      const d = await docSo();
      nMin = Math.min(nMin, d.n);
      dTran = d;
      nacTran = i;
      if (d.camXa !== null && Math.abs(d.camXa - truoc) < 0.01) {
        dungYen += 1;
        if (dungYen >= 2) {
          toiTran = true;
          break;
        }
      } else dungYen = 0;
      truoc = d.camXa;
    }
  }
  const dong = {
    vai: ca.vai,
    man: ca.ten,
    duocDo: d0.n > 0,
    n0: d0.n,
    nTran: dTran.n,
    nMin,
    matVatThe: d0.n - nMin,
    nacToiTran: nacTran,
    toiTran,
    far: d0.far,
    near: d0.near,
    tiLeFarNear: d0.near ? Math.round(d0.far / d0.near) : null,
    camXa0: d0.camXa,
    camXaTran: dTran.camXa,
  };
  ra.push(dong);
  console.log(
    `${dong.duocDo ? " " : "⚠"} ${ca.vai.padEnd(15)} ${ca.ten.padEnd(8)} far=${String(dong.far).padStart(10)} near=${String(dong.near).padStart(6)} tỉlệ=${String(dong.tiLeFarNear).padStart(7)} | n0=${dong.n0} nTrần=${dong.nTran} nMin=${dong.nMin} MẤT=${dong.matVatThe} | nấc=${dong.nacToiTran}${dong.toiTran ? " (TỚI TRẦN)" : " (CHƯA tới trần)"} camXa ${dong.camXa0}→${dong.camXaTran}`,
  );
  await ctx.close();
}
fs.writeFileSync(`.qa-tapdoan/p50b-tran-${NHAN}.json`, JSON.stringify(ra, null, 1));
const hong = ra.filter((r) => !r.duocDo || !r.toiTran || r.matVatThe > 0);
console.log(`\n→ .qa-tapdoan/p50b-tran-${NHAN}.json · ${ra.length} ca · KHÔNG ĐẠT: ${hong.length}`);
for (const h of hong) console.log(`  ✗ ${h.vai}/${h.man}: đo được=${h.duocDo} tớiTrần=${h.toiTran} mất=${h.matVatThe}`);
await trinh.close();
