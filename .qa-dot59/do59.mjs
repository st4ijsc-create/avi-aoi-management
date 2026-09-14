/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ĐỢT 59 · MỤC B — THƯỚC D-1 THẾ HỆ MỚI: **FAIL-CLOSED** + **ĐỌC THEO NGHĨA HIỂN THỊ**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `.qa-dot44/do32.mjs` (+ `tomtat-D1`) là thước ĐÓNG BĂNG từ Đợt 32 và là mốc so của 5 cột lịch
 * sử — **giữ nguyên, không sửa một dòng**. Tệp này là thước THỨ HAI, đứng cạnh nó.
 *
 * Hai bệnh của thước cũ, QA lần 10 (§14q.37) đã chứng minh bằng số:
 *   ① **ĐỌC THEO TESTID ĐÃ DỜI** — ô #15 đọc `[data-testid="trang-thai-may"]@data-trang-thai`,
 *      ô #16/#20 đọc `[data-testid="ngan-do-tuoi"]`. Đợt 57 (mục 12) dời hai chỗ ấy ⇒ thước đọc
 *      `null` ⇒ kêu **SAI** trên một sản phẩm ĐÚNG (đo lại bằng chữ hiển thị: 5 nguồn + DB đều
 *      đồng thuận). Hai ô ĐỎ OAN.
 *   ② **XANH VÌ RỖNG (G146)** — ô #20 phán `moc.every(m => !/Never/.test(m.doTuoi ?? ""))`.
 *      Khi `doTuoi` là `null` ở cả 5 mốc, `?? ""` biến "không đọc được" thành "đọc được, không
 *      có chữ Never" ⇒ **ĐẠT**. Ô ĐỎ thì người ta nhìn thấy; ô này im lặng — và nguy hiểm hơn.
 *
 * ── Hai luật của thước này ────────────────────────────────────────────────────────────────────
 *   **L1 FAIL-CLOSED.** Mỗi ca khai TÊN những dữ kiện nó cần. Thiếu một cái ⇒ **HỎNG**, kèm tên
 *   dữ kiện thiếu. Không ca nào được XANH mà không cầm dữ kiện trong tay. `??` không được dùng
 *   để vá một lỗ ĐỌC — chỉ được dùng khi "vắng mặt" tự nó là một GIÁ TRỊ HỢP LỆ.
 *   **L2 ĐỌC THEO NGHĨA.** Với ba ô #15/#16/#20, dữ kiện lấy từ **chữ người dùng đọc được**
 *   (nhãn 3D trên cảnh · viên tin cậy · ngăn phải · cockpit 2D · hàng máy trên `/twin`), hai
 *   ngôn ngữ, KHÔNG qua `data-*` nào. Một testid dời chỗ không được phép đổi phán quyết; một
 *   CÂU đổi nghĩa thì phải đổi.
 *   (Kèm theo, ô #3 thôi đếm `<a href>`: sau QĐ-23 điều hướng đi bằng `setLocation`, đếm href là
 *   đếm một cơ chế đã chết — đó là lý do ở thước cũ ô này KHÔNG có phán quyết, chỉ ghi "xem #7".
 *   Đọc theo VAI TRÒ: "có đường đi tới màn Line/Máy" = bấm được VÀ URL đổi đúng.)
 *
 * ── Vì sao ở `.qa-dot59/` chứ không `scripts/` ────────────────────────────────────────────────
 * `scripts/` là cổng CHẠY ĐƯỢC TRÊN MỌI CÂY (`npm run …`, có trong `package.json`, người ngoài
 * đợt cũng gọi). Thước D-1 thì ngược lại: nó ghim vai `e2e_tai_loE`/`operator1`/user tạm, máy 14,
 * line 2, factory 1 của **DB dev này**, và cần hàng TẠM `andon_events` + user TẠM. Đặt nó vào
 * `scripts/` là mời người khác chạy một thứ GHI VÀO DB. `do32.mjs` ở `.qa-dotNN/` vì đúng lẽ ấy.
 *
 * ── Dùng ──────────────────────────────────────────────────────────────────────────────────────
 *   node .qa-dot59/do59.mjs thu --lo=A1600|A1280|B|C|R --base=… --out=.qa-dot59/f-head
 *   node .qa-dot59/do59.mjs xu  --out=.qa-dot59/f-head [--md=1]
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const LENH = process.argv[2] ?? "thu";
const BASE = arg("base", "http://localhost:3059");
const LO = arg("lo", "A1600");
const OUT = arg("out", ".qa-dot59/f-head");
mkdirSync(OUT, { recursive: true });

const VAI = {
  A1600: { u: "e2e_tai_loE", p: "E2eTaiLoE!2026", vw: 1600, vh: 900 },
  A1280: { u: "e2e_tai_loE", p: "E2eTaiLoE!2026", vw: 1280, vh: 720 },
  R: { u: "e2e_tai_loE", p: "E2eTaiLoE!2026", vw: 1600, vh: 900 },
  B: { u: "operator1", p: "User@123", vw: 1600, vh: 900 },
  C: { u: "e2e_dot32_khongquyen", p: "KhongQuyen!2026", vw: 1600, vh: 900 },
};

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   PHẦN 1 — THU DỮ KIỆN
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

async function dangNhap(ctx, vai) {
  const f = `${OUT}/state-${vai.u}.json`;
  const ai = async () => { const r = await ctx.request.get(`${BASE}/api/trpc/auth.me`); try { return JSON.parse(await r.text())?.result?.data?.json?.username ?? null; } catch { return null; } };
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === vai.u) return "cache"; await ctx.clearCookies(); }
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: vai.u, password: vai.p } });
  const ten = await ai();
  if (r.status() !== 200 || ten !== vai.u) throw new Error(`dang nhap that bai: ${vai.u} login=${r.status()} me=${ten}`);
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
  return "moi";
}
async function trpcGet(ctx, proc, input) {
  const u = `${BASE}/api/trpc/${proc}` + (input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  const r = await ctx.request.get(u);
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* không phải JSON */ }
  return { status: r.status(), data: j?.result?.data?.json ?? j?.result?.data ?? null };
}
const cho = (p, s, ms = 90_000) => p.waitForSelector(s, { timeout: ms }).then(() => true).catch(() => false);
const ngu = (p, ms) => p.waitForTimeout(ms);
const duong = (p) => { const u = new URL(p.url()); return u.pathname + u.search; };

/** Bộ đo hình học/nhãn trong trang — MÔ HÌNH RỜI với `do32.doNhan` (viết lại, không sao chép). */
const TRONG_TRANG = (sel) => {
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), day: Math.round(b.bottom), phai: Math.round(b.right) }; };
  const khung = sel ? document.querySelector(sel) : null;
  const cvEl = khung ? khung.querySelector("canvas") : null;
  const cv = cvEl ? cvEl.getBoundingClientRect() : null;
  const lopEl = khung ? khung.querySelector('[data-testid="lop-nhan-twin3d"]') : null;
  const lop = lopEl ? lopEl.getBoundingClientRect() : null;
  const tamTrong = (b) => !!cv && b.x + b.width / 2 >= cv.x && b.x + b.width / 2 <= cv.right && b.y + b.height / 2 >= cv.y && b.y + b.height / 2 <= cv.bottom;
  const nhanEl = khung ? [...khung.querySelectorAll('[data-testid="nhan-may-twin3d"]')] : [];
  const PHU = ["bang-kpi-noi", "khoi-tong-quan", "panel-trai", "panel-phai", "lop-phu-dong-thoi-gian", "chip-may", "khoi-dai-line", "dai-line", "ngan-nhung", "thanh-tren-line", "thanh-tren-may"];
  const phu = PHU.map((t) => { const e = document.querySelector(`[data-testid="${t}"]`); const b = e ? e.getBoundingClientRect() : null; return b && b.width > 0 && b.height > 0 ? { t, b } : null; }).filter(Boolean);
  const giao = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const ds = nhanEl.map((el) => { const b = el.getBoundingClientRect(); return { chu: (el.textContent || "").trim().slice(0, 48), tamTrong: tamTrong(b), che: phu.filter((p) => giao(b, p.b) > 0).map((p) => p.t) }; });
  const bb = (t) => R(document.querySelector(`[data-testid="${t}"]`));
  const oTram = [...document.querySelectorAll('[data-testid^="o-tram-"]')].filter((e) => !e.getAttribute("data-testid").startsWith("o-tram-wip")).map((e) => ({ tid: e.getAttribute("data-testid"), ...R(e) }));
  const chu = (t, n) => { const e = document.querySelector(`[data-testid="${t}"]`); return e ? (e.innerText || e.textContent || "").trim().slice(0, n) : null; };
  const header = document.querySelector('[data-sidebar="header"]');
  return {
    url: location.pathname + location.search,
    canvasDom: document.querySelectorAll("canvas").length,
    soCanvasKit: window.__soCanvas === undefined ? null : window.__soCanvas,
    demNhan: window.__demNhan === undefined ? null : window.__demNhan,
    lopTrungCanvas: !!(cv && lop) && Math.round(lop.x) === Math.round(cv.x) && Math.round(lop.y) === Math.round(cv.y) && Math.round(lop.width) === Math.round(cv.width) && Math.round(lop.height) === Math.round(cv.height),
    soNhan: ds.length, tamTrong: ds.filter((d) => d.tamTrong).length, soBiChe: ds.filter((d) => d.che.length > 0).length, nhanDs: ds,
    bbox: Object.fromEntries(["man-twin-van-hanh", "man-twin-line", "man-twin-may", "man-twin-studio", "khoi-canh-3d", "khoi-canh-may", "cockpit-2d", "khoi-dai-line", "dai-line", "vung-canvas"].map((t) => [t, bb(t)])),
    oTram,
    chuKetNoi: chu("trang-thai-ket-noi", 60),
    voTieuDeApp: header ? ((header.innerText || "").split("\n").filter(Boolean)[0] || "").slice(0, 60) || null : null,
    biChan: /Không có quyền truy cập|Access denied/.test(document.body.innerText || "") ? 1 : 0,
    coMan: Object.fromEntries(["man-twin-van-hanh", "man-twin-line", "man-twin-may", "man-twin-studio"].map((t) => [t, document.querySelectorAll(`[data-testid="${t}"]`).length])),
    lyDoMay: (() => { const e = document.querySelector('[data-testid="may-khong-mo-duoc"]'); return e ? e.getAttribute("data-ly-do") : null; })(),
    lineRong: document.querySelectorAll('[data-testid="line-rong"]').length,
    soCanhBaoNgan: document.querySelectorAll('[data-testid="nhom-canh-bao"] [data-trang-thai]').length,
    nutAck: document.querySelectorAll('[data-testid="nut-ack"]').length,
  };
};

/**
 * ★★★ L2 — ĐỌC TRẠNG THÁI + TUỔI THEO **CHỮ HIỂN THỊ** (ô #15/#16/#20).
 * Bốn vùng người dùng nhìn thấy; không `data-*`, không testid trạng thái. Mỗi nguồn trả `null`
 * khi KHÔNG ĐỌC ĐƯỢC — và `null` ấy đi thẳng vào phán quyết HỎNG, không bị `??` nuốt.
 */
const DOC_NGHIA = () => {
  const chuCua = (sel) => { const e = document.querySelector(sel); return e ? (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim() : null; };
  const canh = chuCua('[data-testid="khoi-canh-may"]') || chuCua('[data-testid="khoi-canh-3d"]');
  const nhan3D = [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim());
  const nganPhai = chuCua('[data-testid="ngan-xu-ly"]') || chuCua('[data-testid="panel-phai-may"]') || chuCua('[data-testid="panel-phai"]');
  const cockpit = chuCua('[data-testid="cockpit-2d"]');
  const toanMan = (document.body.innerText || "").replace(/\s+/g, " ");
  const TUOI = /(?:Cập nhật\s+(.{1,40}?)\s+trước)|(?:Updated\s+(.{1,40}?)\s+ago)/;
  const layTuoi = (s) => { if (typeof s !== "string") return null; const m = s.match(TUOI); return m ? (m[1] || m[2] || "").trim() : null; };
  const nhanMay = nhan3D.length === 1 ? nhan3D[0] : null;
  const tuNhan = nhanMay && nhanMay.includes("·") ? nhanMay.split("·").slice(1).join("·").trim() : null;
  const KHONG_RO = /(Không rõ|Unknown)/;
  return {
    nhanMay, soNhan3D: nhan3D.length, trangThaiTuNhan3D: tuNhan,
    nganPhaiChu: nganPhai ? nganPhai.slice(0, 600) : null,
    nganPhaiKhongRo: nganPhai === null ? null : KHONG_RO.test(nganPhai),
    cockpitChu: cockpit ? cockpit.slice(0, 800) : null,
    cockpitOnOff: cockpit === null ? null : (cockpit.match(/\b(ONLINE|OFFLINE)\b/) || [null])[0],
    cockpitKetNoi: cockpit === null ? null : (cockpit.match(/\b(Connected|Disconnected)\b/) || [null])[0],
    cockpitStatusTho: cockpit === null ? null : (cockpit.match(/Status\s*([A-Za-z_]+)/) || [null, null])[1],
    tuoiTuCanh: layTuoi(canh), tuoiTuNgan: layTuoi(nganPhai), tuoiToanMan: layTuoi(toanMan),
    coChuChuaBao: /Never reported|Chưa từng báo/i.test(toanMan),
    coCanh: canh !== null, coNganPhai: nganPhai !== null, coCockpit: cockpit !== null,
  };
};

const demIdle = (p, ms) => p.evaluate((t) => new Promise((r) => { let n = 0; let a = window.__thongKeVe; const id = setInterval(() => { const b = window.__thongKeVe; if (b !== a) { n += 1; a = b; } }, 50); setTimeout(() => { clearInterval(id); r({ ms: t, khung: n }); }, t); }), ms);

async function thu() {
  const vai = VAI[LO];
  if (!vai) throw new Error(`lo? ${LO}`);
  const F = {};
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: vai.vw, height: vai.vh }, baseURL: BASE });
  try {
    F._cach = await dangNhap(ctx, vai);
    F._vai = vai.u; F._vp = `${vai.vw}x${vai.vh}`; F._lo = LO; F._luc = new Date().toISOString(); F._base = BASE;
    const page = await ctx.newPage();
    const anh = (t) => page.screenshot({ path: `${OUT}/${LO}-${t}.png` }).catch(() => {});

    /* ── B / C: bốn URL × (vào được? canvas? lý do?) ────────────────────────── */
    if (LO === "B" || LO === "C") {
      F.quyen = [];
      for (const [d, tid] of [["/twin", "man-twin-van-hanh"], ["/twin/line/2", "man-twin-line"], ["/twin/may/14", "man-twin-may"], ["/twin-studio", "man-twin-studio"]]) {
        await page.goto(`${BASE}${d}`, { waitUntil: "domcontentloaded" });
        await Promise.race([cho(page, `[data-testid="${tid}"]`, 45_000), page.locator("text=/Không có quyền truy cập|Access denied/").waitFor({ timeout: 45_000 }).catch(() => {})]);
        await ngu(page, 6000);
        const t = await page.evaluate(TRONG_TRANG, null);
        F.quyen.push({ duong: d, tid, coMan: t.coMan[tid], biChan: t.biChan, canvasDom: t.canvasDom, lyDoMay: t.lyDoMay, lineRong: t.lineRong });
        await anh(`quyen${d.replace(/[/:]/g, "_")}`);
      }
      writeFileSync(`${OUT}/${LO}.json`, JSON.stringify(F, null, 2));
      console.log(`[${LO}] ${F.quyen.map((x) => `${x.duong} man=${x.coMan} chan=${x.biChan} canvas=${x.canvasDom} lyDo=${x.lyDoMay}`).join(" | ")}`);
      await ctx.close();
      return;
    }

    /* ── /twin ─────────────────────────────────────────────────────────────── */
    await page.goto(`${BASE}/twin`, { waitUntil: "domcontentloaded" });
    await cho(page, '[data-testid="man-twin-van-hanh"] canvas', 90_000);
    await ngu(page, 7000);
    F.twin = await page.evaluate(TRONG_TRANG, '[data-testid="khoi-canh-3d"]');
    F.twinHangMay14 = await page.evaluate(() => { const e = document.querySelector('[data-testid="may-hang-14"]'); return e ? (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim() : null; });
    F.twinDaiHopNhat = await page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, chu: (el.innerText || "").trim().slice(0, 40) }; };
      const giao = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const nut = document.querySelector('[data-testid="nut-mo-dai-hop-nhat"]');
      const dai = document.querySelector('[data-testid="dai-hop-nhat"]');
      if (!nut || !dai) return { coNut: !!nut, coDai: !!dai, chong: null };
      const nb = r(nut);
      const chong = [...document.querySelectorAll("select, [role=combobox], button")].filter((e) => !dai.contains(e)).map(r).filter((u) => giao(u, nb) > 0);
      return { coNut: true, coDai: true, chong: chong.map((c) => c.chu) };
    });
    await anh("twin");

    /* ── /twin: bấm máy 14 — đường NGƯỜI DÙNG (ô #3 và #6) ──────────────────── */
    if ((await page.locator('[data-testid="may-hang-14"]').count()) === 0 && (await page.locator('[data-testid="chon-danh-sach-may"]').count()) > 0) {
      await page.getByTestId("chon-danh-sach-may").click().catch(() => {});
      await ngu(page, 1500);
    }
    F.bamMay14Duoc = (await page.locator('[data-testid="may-hang-14"]').count()) > 0;
    if (F.bamMay14Duoc) { await page.getByTestId("may-hang-14").click(); await ngu(page, 4000); }
    F.urlSauBamMay = duong(page);
    await anh("sau-bam-may");

    /* ── ngăn nhúng ?xem=machine:14 (ô #7) ─────────────────────────────────── */
    await page.goto(`${BASE}/twin?chon=machine:14&xem=machine:14`, { waitUntil: "domcontentloaded" });
    await ngu(page, 6000);
    F.nganNhung = { url: duong(page), coNgan: await page.locator('[data-testid="ngan-nhung"]').count() };

    /* ── /twin/line/2 ──────────────────────────────────────────────────────── */
    await page.goto(`${BASE}/twin/line/2`, { waitUntil: "domcontentloaded" });
    await cho(page, '[data-testid="man-twin-line"] canvas', 90_000);
    await ngu(page, 7000);
    F.line = await page.evaluate(TRONG_TRANG, '[data-testid="man-twin-line"]');
    F.camKhong = await page.evaluate(() => (window.__tuTheCamera === undefined ? null : window.__tuTheCamera));
    F.lineIdle1 = await demIdle(page, 4000);
    F.lineIdle2 = await demIdle(page, 4000);
    await anh("line");
    F.bamOTram14Duoc = (await page.locator('[data-testid="o-tram-14"]').count()) > 0;
    if (F.bamOTram14Duoc) { await page.getByTestId("o-tram-14").click(); await ngu(page, 3000); }
    F.urlSauBamOTram = duong(page);
    await page.goto(`${BASE}/twin/line/2?cam=10,5,10,0,0`, { waitUntil: "domcontentloaded" });
    await cho(page, '[data-testid="man-twin-line"] canvas', 90_000);
    await ngu(page, 7000);
    const lineCam = await page.evaluate(TRONG_TRANG, '[data-testid="man-twin-line"]');
    /* ★ Đợt 59 — ô #12 đo TƯ THẾ CAMERA THẬT (`__tuTheCamera`, cửa sổ đo của Đợt 33), KHÔNG suy ra
       từ "vị trí nhãn có đổi không". Đo thật ở HEAD: `?cam=10,5,10,0,0` cho **0 nhãn** (camera nhìn
       chỗ khác) ⇒ phép "so danh sách nhãn" đang so 12 với 0 — nó ra "đổi" kể cả khi trang CHẾT.
       Đúng lớp G146: một phép đo XANH trên tập rỗng. Tư thế camera thì đọc được cả khi 0 nhãn. */
    F.camCo = await page.evaluate(() => (window.__tuTheCamera === undefined ? null : window.__tuTheCamera));
    F.nhanLineCoCam = lineCam.nhanDs.map((d) => d.chu);
    F.camViTriDoi = JSON.stringify(F.line.nhanDs) !== JSON.stringify(lineCam.nhanDs);

    /* ── /twin/may/14 ──────────────────────────────────────────────────────── */
    await page.goto(`${BASE}/twin/may/14`, { waitUntil: "domcontentloaded" });
    await cho(page, '[data-testid="man-twin-may"]', 90_000);
    await cho(page, '[data-testid="khoi-canh-may"] canvas', 60_000);
    await cho(page, '[data-testid="cockpit-2d"] [role="tablist"]', 60_000);
    await ngu(page, 7000);
    F.may = await page.evaluate(TRONG_TRANG, '[data-testid="khoi-canh-may"]');
    F.mayNghia = await page.evaluate(DOC_NGHIA); // ★ L2 — ô #15/#16
    await anh("may-14");
    const tab3d = page.locator('[data-testid="cockpit-2d"] [role="tab"]').filter({ hasText: /3D/ });
    F.mayTab3d = { coTab: (await tab3d.count()) > 0, canvasDom: null, soCanvasKit: null };
    if (F.mayTab3d.coTab) {
      await tab3d.first().click();
      await ngu(page, 6000);
      const t = await page.evaluate(TRONG_TRANG, '[data-testid="khoi-canh-may"]');
      F.mayTab3d.canvasDom = t.canvasDom; F.mayTab3d.soCanvasKit = t.soCanvasKit;
    }
    /* điều hướng 5 bước (ô #19) */
    const dh = { sauVeLine: null, sauBack: null, sauF5: null, sauVeNhaMay: null, backTuNhaMay: null };
    const coNut = async (t) => (await page.locator(`[data-testid="${t}"]`).count()) > 0;
    if (await coNut("ve-man-line")) { await page.getByTestId("ve-man-line").click(); await cho(page, '[data-testid="man-twin-line"]', 90_000); await ngu(page, 3000); dh.sauVeLine = duong(page); }
    if (dh.sauVeLine) { await page.goBack({ waitUntil: "domcontentloaded" }); await cho(page, '[data-testid="man-twin-may"]', 90_000); await ngu(page, 4000); dh.sauBack = duong(page); }
    if (dh.sauBack) { await page.reload({ waitUntil: "domcontentloaded" }); await cho(page, '[data-testid="man-twin-may"]', 90_000); await ngu(page, 4000); dh.sauF5 = duong(page); }
    if (dh.sauF5 && (await coNut("ve-man-nha-may"))) { await page.getByTestId("ve-man-nha-may").click(); await cho(page, '[data-testid="man-twin-van-hanh"]', 90_000); await ngu(page, 3000); dh.sauVeNhaMay = duong(page); }
    if (dh.sauVeNhaMay) { await page.goBack({ waitUntil: "domcontentloaded" }); await cho(page, '[data-testid="man-twin-may"]', 90_000); await ngu(page, 3000); dh.backTuNhaMay = duong(page); }
    F.dieuHuong = dh;

    /* ── /twin/may/14 chuỗi thời gian (ô #20/#21) — ĐỌC THEO NGHĨA ──────────── */
    await page.goto(`${BASE}/twin/may/14`, { waitUntil: "domcontentloaded" });
    await cho(page, '[data-testid="man-twin-may"]', 90_000);
    const t0 = Date.now();
    F.mayMoc = [];
    for (const d of [3000, 5000, 7000, 10000, 15000]) {
      await ngu(page, d);
      const n = await page.evaluate(DOC_NGHIA);
      F.mayMoc.push({ tMs: Date.now() - t0, tuoiToanMan: n.tuoiToanMan, tuoiTuCanh: n.tuoiTuCanh, tuoiTuNgan: n.tuoiTuNgan, coChuChuaBao: n.coChuChuaBao, coCockpit: n.coCockpit, idle: await demIdle(page, 2000) });
    }
    await anh("may-14-thoi-gian");

    /* ── /twin-studio (ô #22/#23/#36) ──────────────────────────────────────── */
    await page.goto(`${BASE}/twin-studio`, { waitUntil: "domcontentloaded" });
    await cho(page, '[data-testid="man-twin-studio"]', 90_000);
    await ngu(page, 5000);
    F.studio = {};
    for (const tid of ["tab-con-duong-b", "tab-con-duong-a", "tab-thiet-ke"]) {
      if ((await page.locator(`[data-testid="${tid}"]`).count()) === 0) { F.studio[tid] = null; continue; }
      await page.getByTestId(tid).click();
      await ngu(page, 8000);
      const t = await page.evaluate(TRONG_TRANG, '[data-testid="man-twin-studio"]');
      F.studio[tid] = { day: t.bbox["man-twin-studio"] ? t.bbox["man-twin-studio"].day : null, canvasDom: t.canvasDom, soCanvasKit: t.soCanvasKit };
    }
    await anh("studio");

    /* ── deep-link trên CONTEXT MỚI (ô #24/#25/#26/#37) ─────────────────────── */
    F.deepLink = {};
    for (const [d, tid] of [["/twin", "man-twin-van-hanh"], ["/twin/line/2", "man-twin-line"], ["/twin/may/14", "man-twin-may"], ["/twin-studio", "man-twin-studio"]]) {
      const c2 = await browser.newContext({ viewport: { width: vai.vw, height: vai.vh } });
      await c2.addCookies(await ctx.cookies());
      const p2 = await c2.newPage();
      const td = Date.now();
      await p2.goto(`${BASE}${d}`, { waitUntil: "domcontentloaded" });
      const coMan = await cho(p2, `[data-testid="${tid}"]`, 90_000);
      let msCanvas = null;
      if (d === "/twin/may/14") { await cho(p2, '[data-testid="khoi-canh-may"] canvas', 60_000); msCanvas = Date.now() - td; }
      await ngu(p2, 6000);
      const t = await p2.evaluate(TRONG_TRANG, null);
      F.deepLink[d] = { coMan, tieuDeApp: t.voTieuDeApp, url: t.url, msCanvas };
      await c2.close();
    }

    /* ── redirect 14 đường cũ + ĐỐI CHỨNG DƯƠNG (ô #27) ─────────────────────── */
    const BANG = [
      ["/digital-twin", "/twin", "man-twin-van-hanh"], ["/digital-twin?tab=overview", "/twin", "man-twin-van-hanh"],
      ["/digital-twin?tab=center", "/twin", "man-twin-van-hanh"], ["/digital-twin?tab=map", "/twin", "man-twin-van-hanh"],
      ["/digital-twin?tab=floor", "/twin-studio", "man-twin-studio"], ["/digital-twin?tab=layout", "/twin-studio", "man-twin-studio"],
      ["/digital-twin?tab=cell", "/twin", "man-twin-van-hanh"], ["/digital-twin?tab=rf", "/rf-test-cell", ""],
      ["/factory-live-map", "/twin", "man-twin-van-hanh"], ["/factory-floor-editor", "/twin-studio", "man-twin-studio"],
      ["/cell-twin", "/twin", "man-twin-van-hanh"], ["/digital-twin-center", "/twin", "man-twin-van-hanh"],
      ["/layout", "/twin-studio", "man-twin-studio"], ["/rf-test-cell", "/rf-test-cell", ""],
    ];
    F.redirect = [];
    for (const [cu, dich, tid] of BANG) {
      await page.goto(`${BASE}${cu}`, { waitUntil: "domcontentloaded" });
      const toi = await page.waitForFunction((p) => location.pathname === p, dich.split("?")[0], { timeout: 60_000 }).then(() => true).catch(() => false);
      const coTid = tid ? await cho(page, `[data-testid="${tid}"]`, 90_000) : true;
      F.redirect.push({ cu, dich, urlCuoi: duong(page), toi, coTid, dat: toi && coTid && !duong(page).startsWith("/digital-twin") });
    }
    await page.goto(`${BASE}/digital-twin?tab=overview`, { waitUntil: "domcontentloaded" });
    const doiChungToi = await page.waitForFunction(() => location.pathname === "/twin-studio", null, { timeout: 20_000 }).then(() => true).catch(() => false);
    F.redirectDoiChungTruot = doiChungToi === false;

    /* ── ?pv=line:2&chon=machine:14 (ô #28) ────────────────────────────────── */
    await page.goto(`${BASE}/twin?pv=line:2&chon=machine:14`, { waitUntil: "domcontentloaded" });
    await ngu(page, 7000);
    F.urlPvLine = duong(page);

    /* ── API (ô #29/#30) — đường ĐỘC LẬP với DOM ───────────────────────────── */
    const ov = await trpcGet(ctx, "factoryCommand.overview", { factoryId: 1 });
    const ck = await trpcGet(ctx, "assetCockpit.machineDetail", { machineId: 14 });
    const m14 = ov.data && ov.data.machines ? ov.data.machines.find((x) => x.id === 14) : null;
    const ls = ck.data ? ck.data.liveState : null;
    F.api = {
      ovStatus: ov.status,
      m14Status: m14 ? m14.status : null,
      connected: ls ? (ls.value ? ls.value.connected : ls.connected) : null,
      issueOffline: ((ov.data && ov.data.issues) || []).find((i) => i.machineId === 14 && i.kind === "offline") || null,
      coCockpitApi: ck.data !== null,
    };

    /* ── /factory-command (ô #31) ──────────────────────────────────────────── */
    await page.goto(`${BASE}/factory-command`, { waitUntil: "domcontentloaded" });
    await ngu(page, 8000);
    const nut3d = page.locator("button[aria-pressed]").filter({ hasText: /3D/ });
    if ((await nut3d.count()) > 0) await nut3d.first().click();
    await cho(page, "canvas", 90_000);
    await ngu(page, 8000);
    F.factoryCommand = await page.evaluate(TRONG_TRANG, '[data-testid="khoi-canh-3d"]');
    await anh("factory-command");

    await ctx.close();
  } finally {
    await browser.close();
  }
  writeFileSync(`${OUT}/${LO}.json`, JSON.stringify(F, null, 2));
  console.log(`[${LO}] thu xong → ${OUT}/${LO}.json`);
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   PHẦN 2 — PHÁN QUYẾT FAIL-CLOSED
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

function xu() {
  const doc = (lo) => (existsSync(`${OUT}/${lo}.json`) ? JSON.parse(readFileSync(`${OUT}/${lo}.json`, "utf8")) : null);
  const A = doc("A1600"), A12 = doc("A1280"), B = doc("B"), C = doc("C"), R = doc("R");
  const hang = [];
  /**
   * `luat(id, moTa, goc, cantDoc, phan, ghi)`
   *   `cantDoc` — mảng `[tên dữ kiện, giá trị]`. Bất kỳ giá trị nào `undefined`/`null` ⇒ **HỎNG**
   *   kèm TÊN dữ kiện thiếu. Đây là L1: "không đọc được" KHÔNG BAO GIỜ rơi vào nhánh XANH.
   */
  const luat = (id, moTa, goc, cantDoc, phan, ghi) => {
    if (!goc) { hang.push({ id, moTa, gt: "(không có tệp thô của lô)", p: "HỎNG", ghi: ghi || "" }); return; }
    const thieu = cantDoc.filter(([, v]) => v === undefined || v === null).map(([k]) => k);
    if (thieu.length) { hang.push({ id, moTa, gt: `KHÔNG ĐỌC ĐƯỢC: ${thieu.join(", ")}`, p: "HỎNG", ghi: ghi || "" }); return; }
    const [gt, p] = phan();
    hang.push({ id, moTa, gt, p, ghi: ghi || "" });
  };
  const dat = (b) => (b ? "ĐẠT" : "SAI");
  const co = (x) => (x === undefined ? null : x);

  /* ── A @1600 ─────────────────────────────────────────────────────────────── */
  const t = A && A.twin, l = A && A.line, m = A && A.may, n = A && A.mayNghia;
  luat(1, "/twin: canvas DOM = __soCanvas = 1", A, [["twin.canvasDom", t && co(t.canvasDom)], ["twin.soCanvasKit", t && co(t.soCanvasKit)]], () => [`dom ${t.canvasDom} / kit ${t.soCanvasKit}`, dat(t.canvasDom === 1 && t.soCanvasKit === 1)]);
  luat(2, "/twin: lớp nhãn trùng canvas, tâm nhãn trong canvas", A, [["twin.lopTrungCanvas", t && co(t.lopTrungCanvas)], ["twin.soNhan>0", t && t.soNhan > 0 ? true : null]], () => [`trùng ${t.lopTrungCanvas} · ${t.tamTrong}/${t.soNhan}`, dat(t.lopTrungCanvas && t.tamTrong === t.soNhan)]);
  luat(3, "/twin: CÓ đường đi tới màn Line/Máy — đo theo VAI TRÒ (bấm được + URL đổi)", A, [["bamMay14Duoc", A && co(A.bamMay14Duoc)], ["urlSauBamMay", A && co(A.urlSauBamMay)], ["bamOTram14Duoc", A && co(A.bamOTram14Duoc)], ["urlSauBamOTram", A && co(A.urlSauBamOTram)]], () => [`máy ${A.bamMay14Duoc ? "bấm được" : "KHÔNG"} → ${A.urlSauBamMay} · trạm ${A.bamOTram14Duoc ? "bấm được" : "KHÔNG"} → ${A.urlSauBamOTram}`, dat(A.bamMay14Duoc && A.urlSauBamMay.startsWith("/twin/may/14") && A.bamOTram14Duoc && A.urlSauBamOTram.startsWith("/twin/may/14"))], "thước cũ đếm <a href> (cơ chế đã chết sau QĐ-23) ⇒ 0 phán quyết, chỉ ghi 'xem #7'");
  luat(4, "/twin: chỉ báo kết nối sau 7 s", A, [["twin.chuKetNoi", t && co(t.chuKetNoi)]], () => [`"${t.chuKetNoi}"`, dat(/Live|Trực tiếp/.test(t.chuKetNoi))]);
  luat(5, "/twin 1600: dải hợp nhất không chồng lên nút", A, [["daiHopNhat.chong", A && A.twinDaiHopNhat && co(A.twinDaiHopNhat.chong)]], () => [`chồng ${A.twinDaiHopNhat.chong.length}`, dat(A.twinDaiHopNhat.chong.length === 0)]);
  luat(6, "/twin: bấm máy 14 ⇒ URL /twin/may/14", A, [["urlSauBamMay", A && co(A.urlSauBamMay)]], () => [A.urlSauBamMay, dat(A.urlSauBamMay.startsWith("/twin/may/14"))]);
  luat(7, "/twin ?xem=machine:14 ⇒ ngăn nhúng (lối vào CŨ)", A, [["nganNhung.coNgan", A && A.nganNhung && co(A.nganNhung.coNgan)], ["nganNhung.url", A && A.nganNhung && co(A.nganNhung.url)]], () => (A.nganNhung.coNgan === 0 && A.nganNhung.url.startsWith("/twin/may/14") ? [`ngăn 0 — redirect → ${A.nganNhung.url}`, "N/A"] : [`ngăn ${A.nganNhung.coNgan} tại ${A.nganNhung.url}`, dat(A.nganNhung.coNgan > 0)]), "QĐ-23 bỏ lối vào cũ ⇒ N/A CÓ LÝ DO ĐỌC ĐƯỢC (URL redirect), không phải 'không đo'");
  luat(8, "/twin/line/2: 12/12 máy trong khung", A, [["line.demNhan", l && co(l.demNhan)]], () => { const d = l.demNhan; return [`vẽ ${d.ve} giấu ${d.biGiau} ngoàiKhung ${d.ngoaiKhung} tổng ${d.tong}`, dat(d.ngoaiKhung === 0 && d.ve + d.biGiau === 12)]; });
  luat(9, "/twin/line/2: lớp nhãn trùng canvas, tâm trong, 0 bị che", A, [["line.lopTrungCanvas", l && co(l.lopTrungCanvas)], ["line.soNhan>0", l && l.soNhan > 0 ? true : null]], () => [`trùng ${l.lopTrungCanvas} · tâm ${l.tamTrong}/${l.soNhan} · che ${l.soBiChe}`, dat(l.lopTrungCanvas && l.tamTrong === l.soNhan && l.soBiChe === 0)]);
  luat(10, "/twin/line/2: bấm ô trạm 14 ⇒ URL", A, [["urlSauBamOTram", A && co(A.urlSauBamOTram)]], () => [A.urlSauBamOTram, dat(A.urlSauBamOTram.startsWith("/twin/may/14"))]);
  luat(11, "/twin/line/2: dải trạm 1 hàng, đáy ≤ 900", A, [["line.oTram", l && l.oTram && l.oTram.length ? l.oTram : null]], () => { const d = Math.max(...l.oTram.map((o) => o.day)); return [`đáy ${d} · ${l.oTram.length} ô`, dat(l.oTram.length === 12 && d <= 900)]; });
  luat(12, "/twin/line/2: ?cam= đổi camera THẬT (đọc tư thế camera, không suy từ vị trí nhãn)", A, [["camKhong (tư thế trước)", A && co(A.camKhong)], ["camCo (tư thế sau ?cam=)", A && co(A.camCo)]], () => { const k = A.camKhong, c = A.camCo; const doi = JSON.stringify(k) !== JSON.stringify(c); return [`(${k.x.toFixed(1)},${k.y.toFixed(1)},${k.z.toFixed(1)}) → (${c.x.toFixed(1)},${c.y.toFixed(1)},${c.z.toFixed(1)}) · nhãn ${A.nhanLineCoCam.length} sau ?cam=`, dat(doi)]; }, "thước cũ suy từ 'vị trí nhãn có đổi không' — ở HEAD `?cam=` cho 0 nhãn ⇒ so 12 với 0 ⇒ 'đổi' kể cả khi trang chết");
  luat(13, "/twin/line/2: idle ≤ 2 khung/4 s (×2)", A, [["lineIdle1", A && A.lineIdle1 && co(A.lineIdle1.khung)], ["lineIdle2", A && A.lineIdle2 && co(A.lineIdle2.khung)]], () => [`${A.lineIdle1.khung}/${A.lineIdle2.khung}`, dat(A.lineIdle1.khung <= 2 && A.lineIdle2.khung <= 2)]);
  luat(14, "/twin/may/14 1600: cockpit.h > khoiCanh.h, đáy ≤ 900", A, [["may.khoiCanh", m && m.bbox["khoi-canh-may"]], ["may.cockpit", m && m.bbox["cockpit-2d"]], ["may.man", m && m.bbox["man-twin-may"]]], () => { const k = m.bbox["khoi-canh-may"], c = m.bbox["cockpit-2d"], x = m.bbox["man-twin-may"]; return [`canh ${k.h} · cockpit ${c.h} · đáy ${x.day}`, dat(c.h > k.h && x.day <= 900)]; });
  /* ★★★ #15 — L2: bốn NGUỒN CHỮ phải nói MỘT điều. Không đọc được một nguồn ⇒ HỎNG. */
  luat(15, "/twin/may/14: nhãn 3D · ngăn phải · cockpit · hàng /twin nói MỘT điều (đọc CHỮ)", A,
    [["nghia.trangThaiTuNhan3D", n && co(n.trangThaiTuNhan3D)], ["nghia.nganPhaiKhongRo", n && co(n.nganPhaiKhongRo)], ["nghia.cockpitOnOff", n && co(n.cockpitOnOff)], ["twinHangMay14", A && co(A.twinHangMay14)]],
    () => {
      const nhanKhongRo = /(Không rõ|Unknown)/.test(n.trangThaiTuNhan3D);
      const hangKhongRo = /(Không rõ|Unknown)/.test(A.twinHangMay14);
      const dongThuan = nhanKhongRo === (n.cockpitOnOff === "OFFLINE") && nhanKhongRo === n.nganPhaiKhongRo && nhanKhongRo === hangKhongRo;
      return [`nhãn3D "${n.trangThaiTuNhan3D}" · ngăn ${n.nganPhaiKhongRo ? "Không rõ" : "khác"} · cockpit ${n.cockpitOnOff} · hàng /twin "${A.twinHangMay14.slice(0, 32)}"`, dat(dongThuan)];
    }, "thước cũ đọc trang-thai-may@data-trang-thai — Đợt 57 DỜI ⇒ null ⇒ SAI OAN");
  /* ★★★ #16 — L2: CÂU tuổi ở bất kỳ đâu trên màn + khớp Connected/Disconnected. */
  luat(16, "/twin/may/14: câu TUỔI dữ liệu có mặt và khớp Connected/Disconnected (đọc CHỮ)", A,
    [["nghia.tuoiToanMan", n && co(n.tuoiToanMan)], ["nghia.cockpitKetNoi", n && co(n.cockpitKetNoi)]],
    () => [`"${n.tuoiToanMan}" (cảnh:${n.tuoiTuCanh || "—"} ngăn:${n.tuoiTuNgan || "—"}) · ${n.cockpitKetNoi}`, dat(n.cockpitKetNoi === "Disconnected" ? /ngày|day|tháng|month|năm|year/.test(n.tuoiToanMan) : true)],
    "thước cũ đọc ngan-do-tuoi — Đợt 57 DỜI sang viên tin cậy ⇒ null ⇒ SAI OAN");
  luat(17, "/twin/may/14: Status thô của cockpit không mâu thuẫn Connection", A, [["nghia.cockpitStatusTho", n && co(n.cockpitStatusTho)], ["nghia.cockpitKetNoi", n && co(n.cockpitKetNoi)]], () => [`Status "${n.cockpitStatusTho}" · ${n.cockpitKetNoi}`, dat(!(n.cockpitStatusTho === "online" && n.cockpitKetNoi === "Disconnected"))]);
  luat(18, "/twin/may/14: tab '3D model' cockpit ⇒ canvas DOM", A, [["mayTab3d.coTab", A && A.mayTab3d && co(A.mayTab3d.coTab)], ["mayTab3d.canvasDom", A && A.mayTab3d && co(A.mayTab3d.canvasDom)]], () => [`dom ${A.mayTab3d.canvasDom} / kit ${A.mayTab3d.soCanvasKit}`, dat(A.mayTab3d.canvasDom === 1)]);
  luat(19, "/twin/may/14: ‹Line · Back · F5 · ‹Nhà máy · Back (5 bước)", A, [["dieuHuong.sauVeLine", A && A.dieuHuong && co(A.dieuHuong.sauVeLine)], ["dieuHuong.sauBack", A && A.dieuHuong && co(A.dieuHuong.sauBack)], ["dieuHuong.sauF5", A && A.dieuHuong && co(A.dieuHuong.sauF5)], ["dieuHuong.sauVeNhaMay", A && A.dieuHuong && co(A.dieuHuong.sauVeNhaMay)], ["dieuHuong.backTuNhaMay", A && A.dieuHuong && co(A.dieuHuong.backTuNhaMay)]], () => { const d = A.dieuHuong; const ok = d.sauVeLine === "/twin/line/2" && d.sauBack === "/twin/may/14" && d.sauF5 === "/twin/may/14" && d.sauVeNhaMay.startsWith("/twin") && !d.sauVeNhaMay.startsWith("/twin/") && d.backTuNhaMay === "/twin/may/14"; return [`${ok ? 5 : "<5"}/5: ${d.sauVeLine}→${d.sauBack}→${d.sauF5}→${d.sauVeNhaMay}→${d.backTuNhaMay}`, dat(ok)]; });
  /* ★★★ #20 — G146: 5 mốc; mốc nào không đọc được CÂU TUỔI ⇒ HỎNG (thước cũ `?? ""` ⇒ XANH GIẢ). */
  luat(20, "/twin/may/14: chuỗi thời gian CÂU TUỔI ở 5 mốc — không 'chưa từng báo' giả", A,
    [["mayMoc (đủ 5 mốc)", A && A.mayMoc && A.mayMoc.length === 5 ? true : null], ["mayMoc[*].tuoiToanMan", A && A.mayMoc && A.mayMoc.every((x) => typeof x.tuoiToanMan === "string" && x.tuoiToanMan.length > 0) ? true : null]],
    () => [A.mayMoc.map((x) => x.tuoiToanMan).join(" · ").slice(0, 90), dat(A.mayMoc.every((x) => !x.coChuChuaBao))],
    'thước cũ: every() trên `doTuoi ?? ""` ⇒ null×5 vẫn ĐẠT — XANH GIẢ (G146)');
  luat(21, "/twin/may/14: idle theo mốc (khung/2 s tại 5 mốc) ≤ 2", A, [["mayMoc[*].idle", A && A.mayMoc && A.mayMoc.every((x) => x.idle && typeof x.idle.khung === "number") ? true : null]], () => { const v = A.mayMoc.map((x) => x.idle.khung); return [v.join("/"), dat(v.every((x) => x <= 2))]; });
  luat(22, "/twin-studio 1600: đáy ≤ 900", A, [["studio (≥1 tab đọc được)", A && A.studio && Object.values(A.studio).some((x) => x) ? true : null]], () => { const d = Math.max(...Object.values(A.studio).filter(Boolean).map((x) => x.day || 0)); return [`đáy ${d}`, dat(d <= 900)]; });
  luat(23, "/twin-studio: tab thiết kế 1 canvas = kit", A, [["studio['tab-thiet-ke']", A && A.studio && A.studio["tab-thiet-ke"]]], () => { const x = A.studio["tab-thiet-ke"]; return [`dom ${x.canvasDom} / kit ${x.soCanvasKit}`, dat(x.canvasDom === 1 && x.soCanvasKit === 1)]; });
  luat(24, "deep-link /twin/may/14 (context mới): vỏ app", A, [["deepLink['/twin/may/14'].tieuDeApp", A && A.deepLink && A.deepLink["/twin/may/14"] && co(A.deepLink["/twin/may/14"].tieuDeApp)]], () => { const x = A.deepLink["/twin/may/14"]; return [`"${x.tieuDeApp}" · canvas ${x.msCanvas} ms`, dat(x.tieuDeApp === "Production (MES)")]; });
  luat(25, "deep-link /twin/line/2 (context mới): vỏ app", A, [["deepLink['/twin/line/2'].tieuDeApp", A && A.deepLink && A.deepLink["/twin/line/2"] && co(A.deepLink["/twin/line/2"].tieuDeApp)]], () => [`"${A.deepLink["/twin/line/2"].tieuDeApp}"`, dat(A.deepLink["/twin/line/2"].tieuDeApp === "Production (MES)")]);
  luat(26, "deep-link /twin-studio (context mới): vỏ app", A, [["deepLink['/twin-studio'].tieuDeApp", A && A.deepLink && A.deepLink["/twin-studio"] && co(A.deepLink["/twin-studio"].tieuDeApp)]], () => [`"${A.deepLink["/twin-studio"].tieuDeApp}"`, dat(A.deepLink["/twin-studio"].tieuDeApp === "Production (MES)")]);
  luat(27, "redirect 14 đường cũ + đối chứng sai TRƯỢT", A, [["redirect (đủ 14)", A && A.redirect && A.redirect.length === 14 ? true : null], ["redirectDoiChungTruot", A && co(A.redirectDoiChungTruot)]], () => { const d = A.redirect.filter((x) => x.dat).length; return [`${d}/14 · đối chứng trượt ${A.redirectDoiChungTruot}`, dat(d === 14 && A.redirectDoiChungTruot)]; });
  luat(28, "/twin?pv=line:2&chon=machine:14 ⇒ màn riêng", A, [["urlPvLine", A && co(A.urlPvLine)]], () => [A.urlPvLine, dat(A.urlPvLine.startsWith("/twin/may/14"))]);
  luat(29, "API máy 14: overview.status ↔ cockpit.connected (một hợp đồng)", A, [["api.m14Status", A && A.api && co(A.api.m14Status)], ["api.connected", A && A.api && co(A.api.connected)]], () => [`overview ${A.api.m14Status} · connected ${A.api.connected}`, dat(A.api.m14Status === "offline" && A.api.connected === false)]);
  luat(30, "API máy 14: issue offline ageMinutes ≠ 0", A, [["api.coCockpitApi", A && A.api && co(A.api.coCockpitApi)]], () => { const o = A.api.issueOffline; return o ? [`offline:${o.ageMinutes}′`, dat(o.ageMinutes > 0)] : ["không có issue offline", "N/A"]; });
  luat(31, "/factory-command 3D: 1 canvas, nhãn trùng canvas (kit LopNhan NGOÀI twin)", A, [["factoryCommand.canvasDom", A && A.factoryCommand && co(A.factoryCommand.canvasDom)], ["factoryCommand.lopTrungCanvas", A && A.factoryCommand && co(A.factoryCommand.lopTrungCanvas)]], () => { const f = A.factoryCommand; return [`dom ${f.canvasDom} · trùng ${f.lopTrungCanvas} · nhãn ${f.soNhan}`, dat(f.canvasDom === 1 && f.lopTrungCanvas)]; });

  /* ── A @1280 ─────────────────────────────────────────────────────────────── */
  const t2 = A12 && A12.twin, l2 = A12 && A12.line, m2 = A12 && A12.may;
  luat(32, "/twin 1280: đáy ≤ 720", A12, [["twin.man", t2 && t2.bbox["man-twin-van-hanh"]]], () => [`đáy ${t2.bbox["man-twin-van-hanh"].day}`, dat(t2.bbox["man-twin-van-hanh"].day <= 720)]);
  luat(33, "/twin 1280: dải hợp nhất không chồng nút", A12, [["daiHopNhat.chong", A12 && A12.twinDaiHopNhat && co(A12.twinDaiHopNhat.chong)]], () => [`chồng ${A12.twinDaiHopNhat.chong.length}`, dat(A12.twinDaiHopNhat.chong.length === 0)]);
  luat(34, "/twin/line/2 1280: dải trạm đáy ≤ 720, 12 ô MỘT dòng (cao ô ≤ 60)", A12, [["line.oTram", l2 && l2.oTram && l2.oTram.length ? l2.oTram : null], ["line.khoiDaiLine", l2 && l2.bbox["khoi-dai-line"]]], () => { const cao = Math.max(...l2.oTram.map((o) => o.h)); return [`đáy ${l2.bbox["khoi-dai-line"].day} · ${l2.oTram.length} ô · cao ô ${cao}`, dat(l2.bbox["khoi-dai-line"].day <= 720 && l2.oTram.length === 12 && cao <= 60)]; });
  luat(35, "/twin/may/14 1280: cockpit.h > khoiCanh.h, đáy ≤ 720", A12, [["may.khoiCanh", m2 && m2.bbox["khoi-canh-may"]], ["may.cockpit", m2 && m2.bbox["cockpit-2d"]], ["may.man", m2 && m2.bbox["man-twin-may"]]], () => { const k = m2.bbox["khoi-canh-may"], c = m2.bbox["cockpit-2d"], x = m2.bbox["man-twin-may"]; return [`canh ${k.h} · cockpit ${c.h} · đáy ${x.day}`, dat(c.h > k.h && x.day <= 720)]; });
  luat(36, "/twin-studio 1280: đáy ≤ 720", A12, [["studio (≥1 tab đọc được)", A12 && A12.studio && Object.values(A12.studio).some((x) => x) ? true : null]], () => { const d = Math.max(...Object.values(A12.studio).filter(Boolean).map((x) => x.day || 0)); return [`đáy ${d}`, dat(d <= 720)]; });
  luat(37, "deep-link /twin/may/14 1280: vỏ app", A12, [["deepLink['/twin/may/14'].tieuDeApp", A12 && A12.deepLink && A12.deepLink["/twin/may/14"] && co(A12.deepLink["/twin/may/14"].tieuDeApp)]], () => [`"${A12.deepLink["/twin/may/14"].tieuDeApp}"`, dat(A12.deepLink["/twin/may/14"].tieuDeApp === "Production (MES)")]);

  /* ── B operator1 (0 gán nhà máy) ─────────────────────────────────────────── */
  const q = (o, d) => (o && o.quyen ? o.quyen.find((r) => r.duong === d) || null : null);
  luat(38, "operator1 /twin: màn mở, 0 canvas, không bị chặn cửa", B, [["B./twin", q(B, "/twin")]], () => { const d = q(B, "/twin"); return [`màn ${d.coMan} · canvas ${d.canvasDom} · chặn ${d.biChan}`, dat(d.coMan === 1 && d.canvasDom === 0 && d.biChan === 0)]; });
  luat(39, "operator1 /twin/line/2: 0 canvas, không sàn trống", B, [["B./twin/line/2", q(B, "/twin/line/2")]], () => { const d = q(B, "/twin/line/2"); return [`canvas ${d.canvasDom} · rỗng ${d.lineRong}`, dat(d.canvasDom === 0 && d.lineRong === 0)]; });
  luat(40, "operator1 /twin/may/14: lý do ĐÚNG BẢN CHẤT (chuaGanNhaMay)", B, [["B./twin/may/14.lyDoMay", q(B, "/twin/may/14") && co(q(B, "/twin/may/14").lyDoMay)]], () => { const d = q(B, "/twin/may/14"); return [`lyDo ${d.lyDoMay} · canvas ${d.canvasDom}`, dat(d.lyDoMay === "chuaGanNhaMay" && d.canvasDom === 0)]; });
  luat(41, "operator1 /twin-studio: bị chặn (0 quyền sửa)", B, [["B./twin-studio", q(B, "/twin-studio")]], () => { const d = q(B, "/twin-studio"); return [`chặn ${d.biChan} · màn ${d.coMan}`, d.biChan > 0 && d.coMan === 0 ? "CHẶN-ĐÚNG" : "SAI"]; });

  /* ── C user tạm 0 quyền ──────────────────────────────────────────────────── */
  for (const [d, id] of [["/twin", 42], ["/twin/line/2", 43], ["/twin/may/14", 44], ["/twin-studio", 45]]) {
    luat(id, `user 0 quyền ${d}: bị chặn, 0 canvas`, C, [[`C.${d}`, q(C, d)]], () => { const x = q(C, d); return [`chặn ${x.biChan} · màn ${x.coMan} · canvas ${x.canvasDom}`, x.biChan > 0 && x.coMan === 0 && x.canvasDom === 0 ? "CHẶN-ĐÚNG" : "SAI"]; });
  }

  /* ── andon raised TẠM máy 14 ─────────────────────────────────────────────── */
  luat(46, "raised: /twin/line/2 máy 14 có nhãn nhận ra được (đọc CHỮ nhãn)", R, [["R.line.nhanDs", R && R.line && R.line.nhanDs && R.line.nhanDs.length ? R.line.nhanDs : null]], () => { const n14 = R.line.nhanDs.filter((d) => /(^|SIM-L2-)AOI(\s|·|$)/.test(d.chu)); return [`nhãn 14: ${n14.map((d) => d.chu).join("|") || "—"}`, dat(n14.length > 0)]; });
  luat(47, "raised: /twin/may/14 ngăn có ≥1 cảnh báo; nút ack ẩn với vai canView", R, [["R.may.soCanhBaoNgan", R && R.may && co(R.may.soCanhBaoNgan)], ["R.may.nutAck", R && R.may && co(R.may.nutAck)]], () => [`cảnh báo ${R.may.soCanhBaoNgan} · nút ack ${R.may.nutAck}`, dat(R.may.soCanhBaoNgan >= 1 && R.may.nutAck === 0)]);
  luat(48, "raised: /twin bấm máy 14 ⇒ /twin/may/14, ngăn có cảnh báo", R, [["R.urlSauBamMay", R && co(R.urlSauBamMay)], ["R.may.soCanhBaoNgan", R && R.may && co(R.may.soCanhBaoNgan)]], () => [`${R.urlSauBamMay} · cảnh báo ${R.may.soCanhBaoNgan}`, dat(R.urlSauBamMay.startsWith("/twin/may/14") && R.may.soCanhBaoNgan >= 1)]);

  const dem = hang.reduce((a, r) => { a[r.p] = (a[r.p] || 0) + 1; return a; }, {});
  if (process.argv.includes("--md=1")) {
    console.log("| # | Ca | Giá trị ĐỌC ĐƯỢC | Phán | Ghi chú |");
    console.log("|---|---|---|---|---|");
    for (const r of hang) console.log(`| ${r.id} | ${r.moTa} | ${r.gt} | **${r.p}** | ${r.ghi} |`);
  } else {
    for (const r of hang) console.log(`${String(r.id).padStart(2)} ${r.p.padEnd(10)} ${r.moTa} | ${r.gt}${r.ghi ? " | " + r.ghi : ""}`);
  }
  const HOP_LE = ["ĐẠT", "SAI", "CHẶN-ĐÚNG", "N/A", "HỎNG"];
  const khong = hang.filter((r) => !HOP_LE.includes(r.p));
  console.log(`\nN=${hang.length} · ${JSON.stringify(dem)}`);
  console.log(`Ô KHÔNG có phán quyết: ${khong.length}${khong.length ? " — " + khong.map((r) => r.id).join(",") : ""}`);
  writeFileSync(`${OUT}/phan-quyet.json`, JSON.stringify({ out: OUT, luc: new Date().toISOString(), dem, hang }, null, 2));
}

if (LENH === "thu") await thu();
else if (LENH === "xu") xu();
else console.log("lenh? thu --lo=A1600|A1280|B|C|R --base=… --out=…  |  xu --out=… [--md=1]");
