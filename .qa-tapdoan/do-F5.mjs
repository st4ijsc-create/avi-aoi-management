// ★ F5 TRỰC QUAN + ẢNH — chip "còn N tên bị ẩn" trong canvas · màu theo HẠNG (chấm trạng thái trong danh sách,
//   vòng viền đế theo hạng sức khoẻ) · ≥8 ảnh PNG cho chủ đợt TỰ ĐỌC.
//   Màu vòng viền 3D KHÔNG đọc được bằng pixel (G34) ⇒ đo bằng: ① phân bố hạng từ API `twinCanh.sucKhoeMay`
//   (nguồn của `vienSucKhoe`) ② bảng 2D song song mà §11.5 bắt phải có (tìm trong DOM) ③ `suc-khoe-may[data-hang]`
//   trên màn Máy. Chấm màu danh sách đọc trực tiếp từ `style.background` (mã hoá dư thừa: màu + hoạ tiết + chữ).
import { chromium } from "@playwright/test";
import { arg, BASE, layCookie, ghi, ANH, TANG_DONG } from "./lib-F.mjs";

const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const kq = { ca: "F5", base: BASE, luc: new Date().toISOString(), soWorker: 1, anh: [], ca5: [] };

const DO_TQ = () => {
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), phai: Math.round(b.right), day: Math.round(b.bottom) }; };
  const q = (t) => document.querySelector(`[data-testid="${t}"]`);
  const canvas = R(document.querySelector("canvas"));
  const trong = (r) => !!canvas && r && r.x >= canvas.x - 0.5 && r.phai <= canvas.phai + 0.5 && r.y >= canvas.y - 0.5 && r.day <= canvas.day + 0.5;
  const chips = [...document.querySelectorAll('[data-testid="chip-nhan-bi-an"], [data-testid="chip-canh-bao-bi-an"], [data-testid="chip-su-co-ngoai-khung"]')].map((el) => { const r = R(el); return { t: el.getAttribute("data-testid"), chu: el.textContent.trim(), soAn: el.getAttribute("data-so-an"), theoCS: el.getAttribute("data-theo-chinh-sach"), rect: r, trongCanvas: trong(r) }; });
  // chấm màu theo trạng thái trong danh sách máy (mã hoá dư thừa: màu + hoạ tiết + chữ)
  const theoTT = {};
  for (const el of document.querySelectorAll('[data-testid^="may-hang-"]')) {
    const tt = el.getAttribute("data-trang-thai");
    const dot = el.querySelector('span[aria-hidden="true"]');
    if (!dot) continue;
    const cs = getComputedStyle(dot);
    const chuTT = [...el.querySelectorAll("span")].map((s) => s.textContent.trim()).filter(Boolean).pop() ?? null;
    theoTT[tt] = theoTT[tt] || { so: 0, mau: cs.backgroundColor, opacity: cs.opacity, hoaTiet: cs.backgroundImage !== "none", chuTrangThai: chuTT };
    theoTT[tt].so += 1;
  }
  return {
    canvas, chips, soChip: chips.length, chipNgoaiCanvas: chips.filter((c) => !c.trongCanvas).length,
    theoTT, soTT: Object.keys(theoTT).length,
    mauKhacNhau: [...new Set(Object.values(theoTT).map((v) => v.mau))].length,
    demNhan: window.__demNhan ?? null, demBadge: window.__demBadge ?? null,
    // bảng 2D song song mà §11.5 bắt cho lớp phủ màu 3D
    bang2dSucKhoe: ["bang-xep-hang-suc-khoe", "xep-hang-suc-khoe", "bang-suc-khoe", "dai-suc-khoe", "cum-suc-khoe"].filter((t) => q(t) !== null),
    hangTrenDom: [...document.querySelectorAll("[data-hang]")].map((el) => ({ t: el.getAttribute("data-testid"), hang: el.getAttribute("data-hang"), chu: el.textContent.trim().slice(0, 50), color: getComputedStyle(el).color })),
    breadcrumb: q("breadcrumb-twin")?.innerText?.replace(/\s*\n+\s*/g, " › ") ?? null,
    kpi: q("bang-kpi-noi")?.innerText?.replace(/\s*\n+\s*/g, " | ").slice(0, 240) ?? null,
    demMay: q("dem-may")?.textContent?.trim() ?? null,
    soCanvas: window.__soCanvas ?? null, calls: window.__thongKeVe?.calls ?? null, tri: window.__thongKeVe?.triangles ?? null,
  };
};

try {
  const T = TANG_DONG;
  const CA = [
    { ten: "twin-tang-dong-68may-1600", tk: "qatd_kythuat", vp: "1600x900", duong: `/twin?nm=${T.nm}&toa=${T.toa}&tang=${T.tang}`, tid: "man-twin-van-hanh" },
    { ten: "twin-tang-dong-68may-1280", tk: "qatd_kythuat", vp: "1280x720", duong: `/twin?nm=${T.nm}&toa=${T.toa}&tang=${T.tang}`, tid: "man-twin-van-hanh" },
    { ten: "twin-pv-tapdoan-giamdoc-1600", tk: "qatd_giamdoc", vp: "1600x900", duong: "/twin?pv=tapdoan", tid: "man-twin-van-hanh" },
    { ten: "twin-giamdoc-tang-dong-1600", tk: "qatd_giamdoc", vp: "1600x900", duong: `/twin?nm=${T.nm}&toa=${T.toa}&tang=${T.tang}`, tid: "man-twin-van-hanh" },
    { ten: "line-217-1600", tk: "qatd_kythuat", vp: "1600x900", duong: "/twin/line/217", tid: "man-twin-line" },
    { ten: "may-4197-1600", tk: "qatd_kythuat", vp: "1600x900", duong: "/twin/may/4197", tid: "man-twin-may" },
    { ten: "may-4197-1280", tk: "qatd_kythuat", vp: "1280x720", duong: "/twin/may/4197", tid: "man-twin-may" },
    { ten: "studio-1600", tk: "qatd_kythuat", vp: "1600x900", duong: "/twin-studio", tid: "man-twin-studio" },
  ];
  const ckCache = {};
  for (const c of CA) {
    if (!ckCache[c.tk]) ckCache[c.tk] = await layCookie(browser, c.tk);
    const [W, H] = c.vp.split("x").map(Number);
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.addCookies(ckCache[c.tk]);
    const page = await ctx.newPage();
    const r = { ten: c.ten, tk: c.tk, vp: c.vp, duong: c.duong };
    try {
      await page.goto(`${BASE}${c.duong}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector(`[data-testid="${c.tid}"]`, { state: "visible", timeout: 60000 });
      await page.waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 90000 }).catch(() => {});
      await page.waitForTimeout(7500);
      Object.assign(r, await page.evaluate(DO_TQ));
    } catch (e) { r.loi = String(e.message).slice(0, 160); }
    const tep = `${ANH}/F-F5-${c.ten}.png`;
    await page.screenshot({ path: tep }).catch((e) => { r.anhLoi = String(e.message).slice(0, 80); });
    r.anh = tep; kq.anh.push(tep);
    kq.ca5.push(r);
    console.log(`  ${c.ten.padEnd(30)} chip ${r.soChip} (ngoài canvas ${r.chipNgoaiCanvas}) ${JSON.stringify((r.chips || []).map((x) => x.chu))}`);
    console.log(`      trạng thái×màu: ${JSON.stringify(r.theoTT)} ⇒ ${r.soTT} trạng thái / ${r.mauKhacNhau} màu khác nhau`);
    console.log(`      bảng 2D sức khoẻ trong DOM: ${JSON.stringify(r.bang2dSucKhoe)} · [data-hang]: ${JSON.stringify(r.hangTrenDom)}`);
    await ctx.close();
  }

  // phân bố HẠNG sức khoẻ của tầng đông (nguồn của vòng viền 3D) — API, độc lập DOM
  const ck = ckCache["qatd_kythuat"];
  const c2 = await browser.newContext(); await c2.addCookies(ck);
  const inp = encodeURIComponent(JSON.stringify({ json: { factoryId: T.nm, tangIds: [T.tang] } }));
  const rr = await c2.request.get(`${BASE}/api/trpc/twinCanh.sucKhoeMay?input=${inp}`);
  const tx = await rr.text();
  let ds = null; try { ds = JSON.parse(tx)?.result?.data?.json ?? null; } catch (e) { /* noop */ }
  kq.sucKhoeApi = { status: rr.status(), so: Array.isArray(ds) ? ds.length : null, mau: Array.isArray(ds) ? ds.slice(0, 3) : String(tx).slice(0, 300) };
  console.log(`\n  twinCanh.sucKhoeMay(tầng ${T.tang}) → ${rr.status()} · ${kq.sucKhoeApi.so} lời khai · mẫu ${JSON.stringify(kq.sucKhoeApi.mau).slice(0, 300)}`);
  await c2.close();
} finally { ghi("F5", kq); await browser.close(); }
