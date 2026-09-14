// ĐỢT 46 · D-3 — THỊ GIÁC ĐỘC LẬP (mô hình đo RỜI với bbox45): 4 màn × 2 vp × lang, NHIỀU TRẠNG THÁI; mỗi trạng thái: ảnh + số đo từ DOM thật.
//   node .qa-dot53/thigiac53.mjs --lang=vi [--base=http://localhost:3053] [--vp=1600x900,1280x720]
// ★ ĐỢT 53 — thêm trạng thái `may/co-canh-bao` (/twin/may/18): lỗ đo đã để SAI #1 của QA lần 8 sống sót.
// Đo (G122/G98/G42): MỌI nhãn/badge/chip đọc từ DOM kèm bbox TRONG canvas + giao với MỌI lớp phủ (không chỉ [data-che-nhan]) + z hiệu lực + thứ tự DOM
//   ⇒ "bịChe" = giao > 0 và lớp phủ ở TRÊN (z lớn hơn, hoặc bằng z và đứng sau trong DOM). elementFromPoint KHÔNG dùng (G42).
//   Cắt chữ: phần tử nowrap/ellipsis + overflow hidden/clip có scrollWidth > clientWidth+1 (kèm title?); <select>: đo chữ option bằng measureText.
//   Tràn: documentElement.scrollWidth/Height vs innerWidth/Height. Font: faceGeistLoaded (mặt chữ THẬT đã tải), không tin fonts.check (mù).
//   Tương phản chữ nhỏ: ẢNH CLIP từng phần tử (pngjs) ⇒ tỉ số (p95+0.05)/(p5+0.05) độ chói — xấp xỉ chữ/nền THẬT sau composite (backdrop, canvas).
//   Nút thu panel: liệt kê phần tử có chữ/icon trong panel bị tay nắm đè.
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3053");
const LANG = arg("lang", "vi");
const VPS = arg("vp", "1600x900,1280x720").split(",");
const OUT = process.env.QA_OUT ?? `.qa-dot53/d3-${LANG}`;
mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { data: j?.result?.data?.json ?? j?.result?.data ?? null }; }
async function dangNhap(ctx) {
  const f = process.env.QA_STATE ?? `.qa-dot53/state-${TK.username}.json`;
  const ai = async () => (await trpcGet(ctx, "auth.me")).data?.username ?? null;
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); }
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); if (res.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai");
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
}

// ── đo trong trang ────────────────────────────────────────────────────────────
const DO_TRONG_TRANG = (manTid) => {
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), day: Math.round(b.bottom), phai: Math.round(b.right) }; };
  const zHieuLuc = (el) => { let e = el; while (e && e !== document.body) { const cs = getComputedStyle(e); if (cs.position !== "static" && cs.zIndex !== "auto") return Number(cs.zIndex); e = e.parentElement; } return 0; };
  const q = (t) => document.querySelector(`[data-testid="${t}"]`);
  const hienRong = (el) => { if (!el || el.hidden) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const giao = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const man = q(manTid);
  const canvasEl = man?.querySelector("canvas") ?? document.querySelector("canvas");
  const canvas = R(canvasEl);
  // lớp phủ: MỌI [data-che-nhan] đang hiện + danh sách cố định (kể cả cái KHÔNG tự khai) — mô hình rời với LopNhan.
  const LOP = ["dai-hop-nhat", "panel-trai", "panel-phai", "panel-phai-may", "cum-trang-thai-du-lieu", "goi-y-chon-may", "bang-kpi-noi", "ngan-mo-phong", "lop-phu-dong-thoi-gian", "nut-thu-trai", "nut-thu-phai", "thanh-cong-cu-canh", "mini-map", "thu-vien-asset", "bang-thuoc-tinh", "cay-phan-cap-twin", "chip-may", "khoi-dai-line", "thanh-tren-line", "thanh-tren-may", "cockpit-2d", "thanh-tab-cockpit"];
  const lopEl = []; const seen = new Set();
  for (const el of document.querySelectorAll("[data-che-nhan]")) { if (!hienRong(el)) continue; seen.add(el); lopEl.push({ t: el.getAttribute("data-testid") ?? el.tagName, cheNhan: 1, el }); }
  for (const t of LOP) { const el = q(t); if (!el || seen.has(el) || !hienRong(el)) continue; seen.add(el); lopEl.push({ t, cheNhan: el.hasAttribute("data-che-nhan") ? 1 : 0, el }); }
  const lopPhu = lopEl.map((l) => ({ t: l.t, cheNhan: l.cheNhan, rect: R(l.el), z: zHieuLuc(l.el) }));
  const doMuc = (el) => {
    const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); const z = zHieuLuc(el);
    const trongCanvas = !!canvas && b.left >= canvas.x - 0.5 && b.right <= canvas.phai + 0.5 && b.top >= canvas.y - 0.5 && b.bottom <= canvas.day + 0.5;
    const giaoLop = lopEl.map((l) => { const g = giao(b, l.el.getBoundingClientRect()); if (g <= 0) return null; const lz = zHieuLuc(l.el); const sau = (el.compareDocumentPosition(l.el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0; const tren = lz > z || (lz === z && sau); return { t: l.t, giao: Math.round(g), lz, tren }; }).filter(Boolean);
    return { t: el.getAttribute("data-testid"), chu: el.textContent?.trim().slice(0, 40) ?? "", rect: R(el), z, opacity: Number(cs.opacity), fontPx: parseFloat(cs.fontSize), color: cs.color, bg: cs.backgroundColor, trongCanvas, giaoLop, biChe: giaoLop.filter((g) => g.tren).map((g) => `${g.t}:${g.giao}`), giaoDuoi: giaoLop.filter((g) => !g.tren).map((g) => `${g.t}:${g.giao}`) };
  };
  const nhan = [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].map(doMuc);
  const badge = [...document.querySelectorAll('[data-testid^="badge-canh-bao-"]')].map((el) => ({ ...doMuc(el), ngoaiKhung: el.getAttribute("data-ngoai-khung"), muc: el.getAttribute("data-muc") }));
  const chip = [...document.querySelectorAll('[data-testid="chip-nhan-bi-an"], [data-testid="chip-su-co-ngoai-khung"]')].map((el) => ({ ...doMuc(el), theoCS: el.getAttribute("data-theo-chinh-sach"), soAn: el.getAttribute("data-so-an") }));
  // cặp nhãn/badge còn chồng nhau (đầu ra)
  const capChongCheo = (A, B) => { let n = 0; for (const a of A) for (const b of B) { const x = a.rect, y = b.rect; if (Math.max(0, Math.min(x.phai, y.phai) - Math.max(x.x, y.x)) * Math.max(0, Math.min(x.day, y.day) - Math.max(x.y, y.y)) > 0) n++; } return n; };
  const capChong = (ds) => { let n = 0; for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) { const a = ds[i].rect, b = ds[j].rect; if (Math.max(0, Math.min(a.phai, b.phai) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.day, b.day) - Math.max(a.y, b.y)) > 0) n++; } return n; };
  // cắt chữ
  const cat = [];
  for (const el of man?.querySelectorAll("*") ?? []) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.tagName === "CANVAS" || el.tagName === "SELECT") continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    if (!(cs.overflowX === "hidden" || cs.overflowX === "clip")) continue;
    if (!(cs.textOverflow === "ellipsis" || cs.whiteSpace === "nowrap")) continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (el.clientWidth === 0) continue;
    const coChuTrucTiep = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    cat.push({ t: el.getAttribute("data-testid") ?? null, tag: el.tagName.toLowerCase(), cls: (el.className?.toString() ?? "").slice(0, 50), chu: el.textContent?.trim().slice(0, 50), sw: el.scrollWidth, cw: el.clientWidth, title: el.getAttribute("title") ?? null, titleCha: el.closest("[title]")?.getAttribute("title") ?? null, ariaLabel: el.getAttribute("aria-label"), coChuTrucTiep, rect: R(el) });
  }
  const sel = [...(man?.querySelectorAll("select") ?? [])].filter(hienRong).map((s) => { const cs = getComputedStyle(s); const c = document.createElement("canvas").getContext("2d"); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; const txt = s.options[s.selectedIndex]?.text ?? ""; const w = c.measureText(txt).width; const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 18; return { t: s.getAttribute("data-testid"), chu: txt, chuPx: Math.round(w), choPx: Math.round(s.clientWidth - pad), biCat: w > s.clientWidth - pad, title: s.getAttribute("title"), ariaLabel: s.getAttribute("aria-label") }; });
  const tran = { docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, innerW: innerWidth, innerH: innerHeight, manDay: R(man)?.day ?? null, manRect: R(man) };
  const VIEN = ["cum-trang-thai-du-lieu", "goi-y-chon-may", "bang-kpi-noi", "ngan-mo-phong", "chip-may", "thanh-cong-cu-canh", "mini-map", "trang-thai-ket-noi", "co-che-giao-so", "badge-xuat-xu", "do-tuoi-nen", "dem-may-line", "tong-wip-line", "trang-thai-may", "suc-khoe-may", "kpi-mau-so", "cum-chip-nhan", "breadcrumb-twin", "khoi-dai-line", "thanh-tab-cockpit", "khoi-canh-may", "cockpit-2d", "khoi-canh-3d", "vung-canvas", "thu-vien-asset", "bang-thuoc-tinh", "cay-phan-cap-twin"];
  const vien = {}; for (const t of VIEN) { const el = q(t); if (el && hienRong(el)) vien[t] = { rect: R(el), chu: el.textContent?.trim().slice(0, 60), z: zHieuLuc(el) }; }
  const faces = [...document.fonts].map((f) => ({ family: f.family.replace(/"/g, ""), status: f.status }));
  const font = { status: document.fonts.status, soFace: faces.length, faceGeistLoaded: faces.filter((f) => f.family === "Geist" && f.status === "loaded").length, faceMonoLoaded: faces.filter((f) => f.family === "Geist Mono" && f.status === "loaded").length, body: getComputedStyle(document.body).fontFamily.slice(0, 60), nhanFont: nhan.length ? getComputedStyle(document.querySelector('[data-testid="nhan-may-twin3d"]')).fontFamily.slice(0, 50) : null };
  const nutThu = {};
  for (const t of ["nut-thu-trai", "nut-thu-phai"]) {
    const el = q(t); if (!hienRong(el)) continue; const r = el.getBoundingClientRect();
    const panel = q(t === "nut-thu-trai" ? "panel-trai" : "panel-phai"); const de = [];
    if (panel && hienRong(panel)) for (const c of panel.querySelectorAll("*")) { const laSvg = c.tagName.toLowerCase() === "svg"; if (!laSvg && (c.children.length > 0 || !(c instanceof HTMLElement))) continue; const b = c.getBoundingClientRect(); if (b.width === 0) continue; const g = giao(r, b); if (g > 0 && (laSvg || c.textContent?.trim())) de.push({ chu: laSvg ? "svg-icon" : c.textContent.trim().slice(0, 30), giao: Math.round(g), rect: R(c) }); }
    nutThu[t] = { rect: R(el), z: zHieuLuc(el), panelRect: R(panel), giaoPanel: panel && hienRong(panel) ? Math.round(giao(r, panel.getBoundingClientRect())) : 0, de };
  }
  return { url: location.href, lang: document.documentElement.lang, canvas, soCanvas: document.querySelectorAll("canvas").length, lopPhu, nhan, badge, chip, capChongNhan: capChong(nhan), capChongBadge: capChong(badge), capChongNhanBadge: capChongCheo(nhan, badge), badgeDoiCho: badge.filter((b) => b.rect && document.querySelector(`[data-testid="${b.t}"]`)?.getAttribute("data-doi-cho") === "1").length, cat, sel, tran, vien, font, nutThu, demNhan: window.__demNhan ?? null, demBadge: window.__demBadge ?? null };
};

// ── tương phản từ ẢNH CLIP ────────────────────────────────────────────────────
const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
async function tuongPhan(page, rect, VW, VH) {
  if (!rect || rect.w < 2 || rect.h < 2) return null;
  const x = Math.max(0, rect.x), y = Math.max(0, rect.y), w = Math.min(rect.w, VW - x), h = Math.min(rect.h, VH - y);
  if (w < 2 || h < 2) return null;
  const buf = await page.screenshot({ clip: { x, y, width: w, height: h } });
  const png = PNG.sync.read(buf); const L = [];
  for (let i = 0; i < png.data.length; i += 4) L.push(lum(png.data[i], png.data[i + 1], png.data[i + 2]));
  L.sort((a, b) => a - b); const p = (k) => L[Math.min(L.length - 1, Math.floor(k * L.length))];
  const p5 = p(0.05), p95 = p(0.95); return { p5: +p5.toFixed(3), p95: +p95.toFixed(3), tiSo: +((p95 + 0.05) / (p5 + 0.05)).toFixed(2), pixel: L.length };
}

const browser = await chromium.launch();
const tong = {};
try {
  for (const vp of VPS) {
    const [VW, VH] = vp.split("x").map(Number);
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
    await ctx.addInitScript((l) => { try { localStorage.setItem("i18nextLng", l); localStorage.removeItem("twin3d.nhan.macDinh"); } catch {} }, LANG);
    await dangNhap(ctx);
    const page = await ctx.newPage();
    const K = (tong[vp] = {});
    const doTrangThai = async (man, tt, manTid, them = {}) => {
      const ten = `${man}-${tt}-${vp}`;
      await page.screenshot({ path: `${OUT}/${ten}.png` });
      const d = await page.evaluate(DO_TRONG_TRANG, manTid);
      // tương phản: chip, gợi ý, 2 nhãn đầu, 2 badge đầu, viên trạng thái, chip máy
      const mau = [];
      for (const c of d.chip) mau.push({ t: c.t, rect: c.rect });
      if (d.vien["goi-y-chon-may"]) mau.push({ t: "goi-y-chon-may", rect: d.vien["goi-y-chon-may"].rect });
      for (const n of d.nhan.slice(0, 2)) mau.push({ t: `nhan:${n.chu.slice(0, 14)}`, rect: n.rect });
      for (const b of d.badge.slice(0, 3)) mau.push({ t: `badge:${b.chu.slice(0, 14)}(op${b.opacity})`, rect: b.rect });
      for (const t of ["trang-thai-ket-noi", "kpi-mau-so", "chip-may", "dem-may-line"]) if (d.vien[t]) mau.push({ t, rect: d.vien[t].rect });
      const tp = {}; for (const m of mau) tp[m.t] = await tuongPhan(page, m.rect, VW, VH);
      const kq = { ...d, tuongPhan: tp, ...them };
      writeFileSync(`${OUT}/${ten}.json`, JSON.stringify(kq, null, 2));
      K[`${man}-${tt}`] = kq;
      const nc = d.nhan.filter((n) => !n.trongCanvas).length, nche = d.nhan.filter((n) => n.biChe.length).length, bche = d.badge.filter((b) => b.biChe.length).length, bnc = d.badge.filter((b) => !b.trongCanvas).length;
      const catKoTitle = d.cat.filter((c) => !c.title && !c.titleCha && !c.ariaLabel).length;
      console.log(`   [${vp}] ${man}/${tt}: nhãn ${d.nhan.length} (ngoàiCanvas ${nc}, bịChe ${nche}, cặpChồng ${d.capChongNhan}) · badge ${d.badge.length} (ngoàiCanvas ${bnc}, bịChe ${bche}, cặpChồng ${d.capChongBadge}, dờiChỗ ${d.badgeDoiCho}) · nhãn×badge ${d.capChongNhanBadge} · chip ${d.chip.map((c) => `"${c.chu}"${c.biChe.length ? "[CHE:" + c.biChe.join(",") + "]" : ""}${c.trongCanvas ? "" : "[NGOÀI]"}`).join(" ") || "—"} · cắt ${d.cat.length} (0 title ${catKoTitle}) select cắt ${d.sel.filter((s) => s.biCat).length}/${d.sel.length} · tràn W ${d.tran.docW}/${d.tran.innerW} H ${d.tran.docH}/${d.tran.innerH} · Geist ${d.font.faceGeistLoaded} · nútThu đè ${Object.entries(d.nutThu).map(([k, v]) => `${k}:${v.de.length}`).join(" ") || "—"} · tp ${Object.entries(tp).map(([k, v]) => `${k.split(":")[0]}=${v?.tiSo ?? "?"}`).join(" ")}`);
      return kq;
    };
    const labelsHien = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].map((el) => { const b = el.getBoundingClientRect(); return { chu: el.textContent?.trim() ?? "", ma: el.firstChild?.textContent?.trim() ?? "", cx: Math.round(b.x + b.width / 2), day: Math.round(b.bottom), y: Math.round(b.y) }; }));

    /* ══ /twin ══ */
    await page.goto(`${BASE}/twin`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(7000);
    await doTrangThai("twin", "chua-chon", "man-twin-van-hanh");
    const macDinh = await labelsHien();
    // tất cả nhãn (URL ?thu=nhanTatCa) — để biết vị trí máy đang bị ẩn
    await page.goto(`${BASE}/twin?thu=nhanTatCa`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(7000);
    await doTrangThai("twin", "nhan-tat-ca", "man-twin-van-hanh");
    const tatCa = await labelsHien();
    // hover: về mặc định, rê chuột vào máy đang ẩn nhãn ⇒ nhãn phải hiện (hover giữ) và không bị che
    await page.goto(`${BASE}/twin`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(7000);
    const daCo = new Set(macDinh.map((l) => l.ma));
    const cv = await page.evaluate(() => { const c = document.querySelector('[data-testid="man-twin-van-hanh"] canvas'); const b = c.getBoundingClientRect(); return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; });
    const ungVien = tatCa.filter((l) => l.ma && !daCo.has(l.ma)).sort((a, b) => Math.hypot(a.cx - cv.cx, a.day - cv.cy) - Math.hypot(b.cx - cv.cx, b.day - cv.cy)).slice(0, 8);
    let hover = { thu: [], trung: null };
    for (const u of ungVien) {
      for (const dy of [14, 26, 6]) {
        await page.mouse.move(u.cx, u.day + dy); await page.waitForTimeout(600);
        const sau = await labelsHien(); const moi = sau.find((l) => l.ma === u.ma);
        hover.thu.push({ ma: u.ma, x: u.cx, y: u.day + dy, soNhan: sau.length, hien: !!moi });
        if (moi) { hover.trung = { ...u, tai: { x: u.cx, y: u.day + dy }, nhanSau: moi, soNhanTruoc: macDinh.length, soNhanSau: sau.length }; break; }
      }
      if (hover.trung) break;
    }
    const kqHover = await doTrangThai("twin", "hover", "man-twin-van-hanh", { hover });
    const nhanHover = hover.trung ? kqHover.nhan.find((n) => n.chu.startsWith(hover.trung.ma)) : null;
    console.log(`   [${vp}] twin/hover: ứng viên ${ungVien.length} · thử ${hover.thu.length} · trúng ${hover.trung ? `${hover.trung.ma} @${hover.trung.tai.x},${hover.trung.tai.y} nhãn ${hover.trung.soNhanTruoc}→${hover.trung.soNhanSau}` : "KHÔNG"} · nhãn hover ${nhanHover ? `trongCanvas=${nhanHover.trongCanvas} bịChe=[${nhanHover.biChe}]` : "—"}`);
    await page.mouse.move(5, 5);

    /* ══ /twin/line/2 ══ */
    await page.goto(`${BASE}/twin/line/2`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="man-twin-line"] canvas', { timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(7000);
    await doTrangThai("line", "mac-dinh", "man-twin-line");
    const moPhong = await page.evaluate(() => document.querySelector('[data-testid="ngan-mo-phong"]')?.getAttribute("data-mo") ?? null);
    if (moPhong === "0" && (await page.locator('[data-testid="nut-thu-mo-phong"]').count()) > 0) { await page.getByTestId("nut-thu-mo-phong").click(); await page.waitForTimeout(1500); }
    const moPhongSau = await page.evaluate(() => document.querySelector('[data-testid="ngan-mo-phong"]')?.getAttribute("data-mo") ?? null);
    await doTrangThai("line", "mo-phong-mo", "man-twin-line", { moPhongTruoc: moPhong, moPhongSau });
    // hover nhãn Line: rê vào ô trạm đầu (dải) — nhãn máy tương ứng phải nổi/không che
    const oTram = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="o-tram-"]')].filter((e) => !e.getAttribute("data-testid").startsWith("o-tram-wip")).slice(0, 1).map((e) => { const b = e.getBoundingClientRect(); return { tid: e.getAttribute("data-testid"), x: b.x + b.width / 2, y: b.y + b.height / 2 }; }));
    if (oTram[0]) { await page.mouse.move(oTram[0].x, oTram[0].y); await page.waitForTimeout(700); }
    await doTrangThai("line", "hover-tram", "man-twin-line", { oTram: oTram[0] ?? null });
    await page.mouse.move(5, 5);

    /* ══ /twin/may/14 ══ */
    await page.goto(`${BASE}/twin/may/14`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="khoi-canh-may"] canvas', { timeout: 90_000 }).catch(() => {});
    await page.waitForSelector('[data-testid="cockpit-2d"] [role="tablist"]', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(5000);
    await doTrangThai("may", "mac-dinh", "man-twin-may");
    const tabTruoc = await page.evaluate(() => { const t = document.querySelector('[data-testid="thanh-tab-cockpit"]'); return t ? { cuonDuoc: t.getAttribute("data-cuon-duoc"), mepPhai: t.getAttribute("data-mep-phai"), mepTrai: t.getAttribute("data-mep-trai") } : null; });
    if ((await page.locator('[data-testid="nut-cuon-tab-phai"]').count()) > 0) { await page.getByTestId("nut-cuon-tab-phai").click().catch(() => {}); await page.waitForTimeout(900); }
    const tabSau = await page.evaluate(() => { const t = document.querySelector('[data-testid="thanh-tab-cockpit"]'); const o = t?.querySelector("[data-o-cuon]"); return t ? { cuonDuoc: t.getAttribute("data-cuon-duoc"), mepPhai: t.getAttribute("data-mep-phai"), mepTrai: t.getAttribute("data-mep-trai"), scrollLeft: o?.scrollLeft ?? null, tabCat: [...(t.querySelectorAll('[role="tab"]') ?? [])].map((b) => ({ chu: b.textContent?.trim().slice(0, 20), cat: b.scrollWidth > b.clientWidth + 1 })) } : null; });
    await doTrangThai("may", "tab-cuon", "man-twin-may", { tabTruoc, tabSau });
    const cuon = await page.evaluate(() => { const c = document.querySelector('[data-testid="cockpit-2d"]'); const o = [c, ...(c?.querySelectorAll("*") ?? [])].find((e) => e && e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)); if (!o) return { oCuon: null }; o.scrollTop = 400; return { oCuon: o.getAttribute("data-testid") ?? o.className.toString().slice(0, 40), scrollTop: o.scrollTop, scrollH: o.scrollHeight, clientH: o.clientHeight }; });
    await page.waitForTimeout(800);
    await doTrangThai("may", "cockpit-cuon", "man-twin-may", { cuon });

    /* ══ ★★★ ĐỢT 53 — /twin/may/18: MÁY ĐANG CÓ CẢNH BÁO MỞ ══
       LỖ ĐO của lưới 22 trạng thái: mọi trạng thái `may/*` đều dùng `/twin/may/14`, mà máy 14 có
       0 cảnh báo mở ⇒ trạng thái "màn Máy của máy ĐANG có cảnh báo" chưa bao giờ nằm trong lưới.
       Đó là lý do badge đè nhãn 17–35 % sống sót tới QA lần 8 (SAI #1). Trạng thái này đóng lỗ ấy. */
    await page.goto(`${BASE}/twin/may/18`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="khoi-canh-may"] canvas', { timeout: 90_000 }).catch(() => {});
    await page.waitForSelector('[data-testid="cockpit-2d"] [role="tablist"]', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(5000);
    const soBadgeMay18 = await page.evaluate(() => document.querySelectorAll('[data-testid^="badge-canh-bao-"]').length);
    const soHopBadgeNhan = await page.evaluate(() => window.__demNhan?.soHopBadge ?? null);
    const veBadge = await page.evaluate(() => window.__demBadge?.ve ?? null);
    await doTrangThai("may", "co-canh-bao", "man-twin-may", { soBadgeMay18, soHopBadgeNhan, veBadge });
    console.log(`   [${vp}] may/co-canh-bao: badge DOM ${soBadgeMay18} · __demBadge.ve ${veBadge} · __demNhan.soHopBadge ${soHopBadgeNhan} (phải BẰNG NHAU — 0 khi lệch = lớp nhãn không biết badge tồn tại)`);

    /* ══ /twin-studio ══ */
    await page.goto(`${BASE}/twin-studio`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="man-twin-studio"]', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const tabMacDinh = await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-testid") ?? null);
    await doTrangThai("studio", "design", "man-twin-studio", { tabMacDinh });
    if ((await page.locator('[data-testid="tab-thiet-ke"]').count()) > 0) await page.getByTestId("tab-thiet-ke").click();
    await page.waitForSelector('[data-testid="man-twin-studio"] canvas', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(5000);
    await doTrangThai("studio", "thiet-ke", "man-twin-studio");

    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/tong.json`, JSON.stringify(tong, null, 2));
console.log(`=== thigiac46 lang=${LANG}: xong ${Object.values(tong).reduce((a, k) => a + Object.keys(k).length, 0)} trạng thái → ${OUT}/ ===`);
