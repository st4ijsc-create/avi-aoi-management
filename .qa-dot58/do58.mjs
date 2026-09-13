// ĐỢT 58 — THIẾT BỊ ĐO ĐỘC LẬP cho 4 mục thiết kế 10/11/12/13 (QA lần 10).
// KHÔNG dùng lại .qa-dot57/do57.mjs: mô hình khác ở ba chỗ (BG-127 — độc lập phải ở MÔ HÌNH):
//   ① M11 đo trên VÙNG THẤY ĐƯỢC SAU KHI CẮT + SAU KHI TRỪ LỚP PHỦ, nên chuỗi "bị cắt/bị che"
//      vẫn đo được thay vì bị loại khỏi mẫu (Đợt 57 loại 80 chuỗi — chính chỗ cần phân xử).
//   ② M10 đo giao với MỌI phần tử chữ/icon TOÀN TRANG (không chỉ trong panel) + BẤM THẬT để xem
//      nút còn tác dụng không (kết cục), + đo nhãn 3D bị nút che, có ABLATION runtime.
//   ③ M12 đếm theo chuỗi hiển thị (không theo testid) + kiểm ĐỦ 5 dữ kiện của chip cũ.
//   node .qa-dot58/do58.mjs --tag=head|nen --lang=vi|en --base=http://localhost:3058 [--vp=..]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3058");
const LANG = arg("lang", "vi");
const TAG = arg("tag", "head");
const VPS = arg("vp", "1600x900,1280x720").split(",");
const CHISO = arg("chi", "");
const OUT = `.qa-dot58/do-${TAG}-${LANG}`;
mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { data: j?.result?.data?.json ?? j?.result?.data ?? null }; }
async function dangNhap(ctx) {
  const f = `.qa-dot58/state-${TK.username}.json`;
  const ai = async () => (await trpcGet(ctx, "auth.me")).data?.username ?? null;
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); }
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK });
  if (res.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai");
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
}

/* ══ hàm chạy TRONG trang ═══════════════════════════════════════════════════ */
const TRONG_TRANG = {
  /* ── chung ── */
  lib: function () {
    const w = window;
    w.__qa58 = {
      R: (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), phai: Math.round(b.right), day: Math.round(b.bottom) }; },
      q: (t) => document.querySelector(`[data-testid="${t}"]`),
      hien: (el) => { if (!el || el.hidden) return false; const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; },
      giao: (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
    };
    return true;
  },
};

/* M10 + M12 + M13 — bố cục */
const DO_BO_CUC = (manTid) => {
  const { R, q, hien, giao } = window.__qa58;
  const man = q(manTid);
  const canvasEl = man?.querySelector("canvas") ?? document.querySelector("canvas");
  const canvas = R(canvasEl);
  const laNoiDung = (c) => {
    const svg = c.tagName.toLowerCase() === "svg";
    if (!svg) {
      if (!(c instanceof HTMLElement)) return false;
      if (c.children.length > 0) return false;
      const truc = [...c.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
      if (!truc) return false;
    }
    return hien(c);
  };

  /* ── M10 — nút thu/mở panel ─────────────────────────────────────────────── */
  const nut = {};
  for (const [tid, ptid] of [["nut-thu-trai", "panel-trai"], ["nut-thu-phai", "panel-phai"]]) {
    const el = q(tid);
    if (!hien(el)) { nut[tid] = null; continue; }
    const r = el.getBoundingClientRect();
    const panel = q(ptid);
    const deTrongPanel = [], deToanTrang = [];
    let giaoPanelND = 0, giaoToanTrang = 0;
    for (const c of document.querySelectorAll("*")) {
      if (c === el || el.contains(c) || c.contains(el)) continue;
      if (!laNoiDung(c)) continue;
      const g = giao(r, c.getBoundingClientRect());
      if (g <= 0) continue;
      const muc = { chu: c.tagName.toLowerCase() === "svg" ? `svg:${c.getAttribute("data-testid") ?? (c.parentElement?.getAttribute("data-testid") ?? "")}` : c.textContent.trim().slice(0, 30), giao: Math.round(g), tid: c.getAttribute("data-testid"), rect: R(c) };
      giaoToanTrang += g; deToanTrang.push(muc);
      if (panel && panel.contains(c)) { giaoPanelND += g; deTrongPanel.push(muc); }
    }
    const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
    const tren = document.elementFromPoint(cx, cy);
    nut[tid] = {
      rect: R(el), panelRect: R(panel),
      giaoPanelHop: panel && hien(panel) ? Math.round(giao(r, panel.getBoundingClientRect())) : 0,
      giaoNoiDungTrongPanel: Math.round(giaoPanelND), soDeTrongPanel: deTrongPanel.length, deTrongPanel,
      giaoNoiDungToanTrang: Math.round(giaoToanTrang), soDeToanTrang: deToanTrang.length, deToanTrang,
      coCheNhan: el.getAttribute("data-che-nhan"), tamTrungNut: !!(tren && (tren === el || el.contains(tren))),
      tamTren: tren ? (tren.getAttribute("data-testid") ?? tren.tagName) : null, tam: { x: cx, y: cy },
    };
  }
  /* nhãn 3D (DOM) bị nút che — hệ quả của việc dời nút LÊN CẢNH */
  const nhanDOM = [...document.querySelectorAll('[data-testid^="nhan-may"],[data-testid^="nhan-line"],[data-testid^="nhan-tram"]')].filter(hien);
  const nhanBiNutChe = [];
  for (const [tid] of [["nut-thu-trai"], ["nut-thu-phai"]]) {
    const el = q(tid); if (!hien(el)) continue;
    const r = el.getBoundingClientRect();
    for (const n of nhanDOM) { const g = giao(r, n.getBoundingClientRect()); if (g > 0.5) nhanBiNutChe.push({ nut: tid, nhan: n.getAttribute("data-testid"), chu: n.textContent.trim().slice(0, 24), giao: Math.round(g) }); }
  }

  /* ── M13 — tồn đọng ─────────────────────────────────────────────────────── */
  const oCuon = q("dai-canh-bao-cuon");
  let tonDong = null;
  if (hien(oCuon)) {
    const cb = oCuon.getBoundingClientRect();
    const hang = [...oCuon.querySelectorAll('[data-ton-dong="1"]')].map((h) => {
      const b = h.getBoundingClientRect();
      const cao = Math.max(0, Math.min(b.bottom, cb.bottom) - Math.max(b.top, cb.top));
      return { tid: h.getAttribute("data-testid"), chu: h.textContent.trim().slice(0, 40), rect: R(h), phanHien: b.height > 0 ? +(cao / b.height).toFixed(3) : 0 };
    });
    const td = q("nhom-ton-dong"); const tdb = td ? td.getBoundingClientRect() : null;
    tonDong = {
      oCuonRect: R(oCuon), scrollTop: oCuon.scrollTop, scrollH: oCuon.scrollHeight, clientH: oCuon.clientHeight,
      tieuDeHien: tdb ? tdb.top >= cb.top - 0.5 && tdb.bottom <= cb.bottom + 0.5 : false, tieuDeChu: td ? td.textContent.trim() : null,
      tongHang: hang.length, hangDu: hang.filter((h) => h.phanHien >= 0.999).length, hangNua: hang.filter((h) => h.phanHien >= 0.5).length,
      tongTheoPhan: +hang.reduce((a, h) => a + h.phanHien, 0).toFixed(2), hang,
    };
  }
  const dsMay = q("danh-sach-may");
  let danhSach = null;
  if (hien(dsMay)) {
    const db = dsMay.getBoundingClientRect();
    const hangMay = [...dsMay.querySelectorAll('[data-testid^="may-hang-"]')].map((h) => {
      const b = h.getBoundingClientRect();
      const cao = Math.max(0, Math.min(b.bottom, db.bottom) - Math.max(b.top, db.top));
      return { tid: h.getAttribute("data-testid"), phanHien: b.height > 0 ? +(cao / b.height).toFixed(3) : 0 };
    });
    danhSach = { rect: R(dsMay), scrollH: dsMay.scrollHeight, clientH: dsMay.clientHeight, tongHang: hangMay.length, hangDu: hangMay.filter((h) => h.phanHien >= 0.999).length, hangNua: hangMay.filter((h) => h.phanHien >= 0.5).length };
  }

  /* ── M12 — lặp mã máy + đủ dữ kiện ──────────────────────────────────────── */
  const chuoiHienThi = (s) => {
    const ra = [];
    if (!s) return ra;
    for (const el of document.querySelectorAll("*")) {
      if (!(el instanceof HTMLElement)) continue;
      if (!hien(el)) continue;
      const truc = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("");
      if (!truc.includes(s)) continue;
      const rr = R(el);
      const trongMan = !!man && man.contains(el);
      const trongCanvas = !!canvas && rr.x >= canvas.x - 0.5 && rr.phai <= canvas.phai + 0.5 && rr.y >= canvas.y - 0.5 && rr.day <= canvas.day + 0.5;
      let duong = [], a = el; while (a && a !== document.body) { const t = a.getAttribute("data-testid"); if (t) duong.push(t); a = a.parentElement; }
      ra.push({ tid: el.getAttribute("data-testid"), chu: el.textContent.trim().slice(0, 40), rect: rr, trongMan, trongCanvas, duong: duong.slice(0, 5).join("<") });
    }
    return ra;
  };
  const doc = (t) => { const el = q(t); return hien(el) ? { tid: t, chu: el.textContent.trim().slice(0, 60), rect: R(el), giaTri: el.getAttribute("data-gia-tri"), giay: el.getAttribute("data-giay") } : null; };
  const nhan3dEl = document.querySelector('[data-testid="nhan-may-twin3d"]');
  const nhan3d = nhan3dEl ? nhan3dEl.textContent.trim() : null;
  const maNgan = doc("ngan-ma-may");
  const maMayCu = doc("ma-may");
  const khoa = (maMayCu?.chu && maMayCu.chu !== "—" ? maMayCu.chu : null) ?? (maNgan?.chu && maNgan.chu !== "—" ? maNgan.chu : null) ?? (nhan3d ? nhan3d.split("·")[0].trim() : null);
  const lap = chuoiHienThi(khoa);
  const khoiCanh = R(q("khoi-canh-may")) ?? R(q("khung-neo-lop-phu")) ?? canvas;
  const trongKhoiCanh = (r) => !!khoiCanh && r && r.x >= khoiCanh.x - 0.5 && r.phai <= khoiCanh.phai + 0.5 && r.y >= khoiCanh.y - 0.5 && r.day <= khoiCanh.day + 0.5;
  let vien = null;
  for (const t of ["vien-tin-cay-may", "cum-trang-thai-du-lieu"]) { const d = doc(t); if (d) { vien = d; break; } }
  const duKien = {
    ma: { canh: !!maMayCu, ngan: !!maNgan, nhan3d: !!nhan3d, gt: maNgan?.chu ?? maMayCu?.chu ?? nhan3d },
    trangThai: { canh: doc("trang-thai-may"), ngan: doc("ngan-trang-thai") },
    loai: { canh: doc("loai-may"), ngan: doc("ngan-loai-may") },
    sucKhoe: { canh: doc("suc-khoe-may"), ngan: doc("ngan-suc-khoe") },
    tuoi: { canh: doc("do-tuoi-may"), ngan: doc("ngan-do-tuoi") },
  };

  return {
    url: location.href, lang: document.documentElement.lang, canvas, soCanvas: document.querySelectorAll("canvas").length,
    nut, nhanDOMSo: nhanDOM.length, nhanBiNutChe,
    tonDong, danhSach, khoiTongQuan: R(q("khoi-tong-quan")), daiCanhBao: R(q("dai-canh-bao")), panelTrai: R(q("panel-trai")), panelPhai: R(q("panel-phai")),
    m12: { khoa, nhan3d, soLap: lap.length, lapTrongKhoiCanh: lap.filter((l) => trongKhoiCanh(l.rect)).length, lapTrongCanvas: lap.filter((l) => l.trongCanvas).length, lap, vien, vienTrongKhoiCanh: vien ? trongKhoiCanh(vien.rect) : null, khoiCanh, duKien },
    tran: { docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, innerW: innerWidth, innerH: innerHeight, bodyOverflowX: document.documentElement.scrollWidth > innerWidth, manRect: R(man) },
  };
};

/* M11 — liệt kê chuỗi ≤12 px + VÙNG ĐO (đã cắt, đã trừ lớp phủ) */
const LIET_KE = (manTid) => {
  const { q, hien } = window.__qa58;
  const man = q(manTid) ?? document.body;
  const zHL = (el) => { let e = el; while (e && e !== document.body) { const cs = getComputedStyle(e); if (cs.position !== "static" && cs.zIndex !== "auto") return Number(cs.zIndex); e = e.parentElement; } return 0; };
  const dt = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const c2 = cv.getContext("2d", { willReadFrequently: true });
  const byte = (css) => { try { c2.clearRect(0, 0, 1, 1); c2.fillStyle = "#000"; c2.fillStyle = css; if (c2.fillStyle === "#000000" && !/^#0{3,8}$|black|rgba?\(0, ?0, ?0/i.test(css)) return null; c2.fillRect(0, 0, 1, 1); const d = c2.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], +(d[3] / 255).toFixed(3)]; } catch { return null; } };
  /* lớp phủ ứng viên: phần tử định vị, CÓ nền đặc hoặc tự khai che nhãn */
  const phu = [];
  for (const e of document.querySelectorAll("*")) {
    if (!(e instanceof HTMLElement)) continue;
    const cs = getComputedStyle(e);
    if (cs.position === "static" || cs.display === "none" || cs.visibility === "hidden") continue;
    const b = e.getBoundingClientRect(); if (b.width < 2 || b.height < 2) continue;
    if (cs.backgroundColor === "rgba(0, 0, 0, 0)" && !e.hasAttribute("data-che-nhan")) continue;
    phu.push({ e, b, z: zHL(e) });
  }
  const ra = []; let stt = 0;
  for (const el of man.querySelectorAll("*")) {
    if (!(el instanceof HTMLElement)) continue;
    if (["CANVAS", "SCRIPT", "STYLE", "svg"].includes(el.tagName)) continue;
    const truc = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (!truc) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const px = parseFloat(cs.fontSize); if (!(px <= 12)) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 3 || b.height < 3) continue;
    if (b.right <= 0 || b.bottom <= 0 || b.left >= innerWidth || b.top >= innerHeight) continue;
    let op = 1, e = el; while (e && e !== document.documentElement) { op *= Number(getComputedStyle(e).opacity || 1); e = e.parentElement; }
    const dam = cs.fontWeight === "bold" || Number(cs.fontWeight) >= 700;
    /* vùng THẤY = rect ∩ mọi khung cắt của tổ tiên ∩ viewport */
    let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (acs.overflowX === "visible" && acs.overflowY === "visible") continue;
      const ab = a.getBoundingClientRect();
      clip = { left: Math.max(clip.left, ab.left), top: Math.max(clip.top, ab.top), right: Math.min(clip.right, ab.right), bottom: Math.min(clip.bottom, ab.bottom) };
    }
    const thay = { left: Math.max(b.left, clip.left), top: Math.max(b.top, clip.top), right: Math.min(b.right, clip.right), bottom: Math.min(b.bottom, clip.bottom) };
    const dienTich = b.width * b.height;
    const phanThay = dienTich > 0 ? +(dt(b, clip) / dienTich).toFixed(3) : 0;
    /* lớp phủ ĐỨNG TRÊN che vùng thấy ⇒ cắt tiếp thành hình chữ nhật con LỚN NHẤT không bị che */
    const zEl = zHL(el);
    let cheMax = 0, cheBoi = null, cheRect = null;
    for (const u of phu) {
      if (u.e === el || u.e.contains(el) || el.contains(u.e)) continue;
      const g = dt(thay, u.b); if (g <= 0) continue;
      const sau = (el.compareDocumentPosition(u.e) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      if (!(u.z > zEl || (u.z === zEl && sau))) continue;
      const p = g / Math.max(1, (thay.right - thay.left) * (thay.bottom - thay.top));
      if (p > cheMax) { cheMax = p; cheBoi = u.e.getAttribute("data-testid") ?? u.e.tagName; cheRect = { left: u.b.left, top: u.b.top, right: u.b.right, bottom: u.b.bottom }; }
    }
    let vungDo = { ...thay };
    if (cheRect && cheMax > 0.02) {
      const ung = [
        { left: thay.left, top: thay.top, right: thay.right, bottom: Math.min(thay.bottom, cheRect.top) },
        { left: thay.left, top: Math.max(thay.top, cheRect.bottom), right: thay.right, bottom: thay.bottom },
        { left: thay.left, top: thay.top, right: Math.min(thay.right, cheRect.left), bottom: thay.bottom },
        { left: Math.max(thay.left, cheRect.right), top: thay.top, right: thay.right, bottom: thay.bottom },
      ].map((r) => ({ ...r, s: Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top) }));
      ung.sort((x, y) => y.s - x.s);
      vungDo = ung[0].s > 6 ? ung[0] : vungDo;
    }
    el.setAttribute("data-qa58", String(++stt));
    const duong = []; let a2 = el; while (a2 && a2 !== document.body) { const t = a2.getAttribute("data-testid"); if (t) duong.push(t); a2 = a2.parentElement; }
    ra.push({
      id: stt, tid: el.getAttribute("data-testid"), duong: duong.slice(0, 4).join("<"),
      cls: (el.className && el.className.toString ? el.className.toString() : "").slice(0, 90),
      chu: truc.slice(0, 34), px, weight: cs.fontWeight, dam, color: cs.color, mauByte: byte(cs.color), opacity: +op.toFixed(3),
      phanThay, phanChe: +cheMax.toFixed(3), cheBoi,
      rect: { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
      vungDo: { x: Math.round(vungDo.left), y: Math.round(vungDo.top), w: Math.round(vungDo.right - vungDo.left), h: Math.round(vungDo.bottom - vungDo.top) },
      nguong: px >= 18.66 || (dam && px >= 14) ? 3.0 : 4.5,
    });
  }
  return ra;
};
const TAT_FILL = () => { const s = document.createElement("style"); s.id = "qa58-tat"; s.textContent = "[data-qa58]{-webkit-text-fill-color:transparent !important;text-shadow:none !important;}"; document.head.appendChild(s); };
const BAT_FILL = () => { const s = document.getElementById("qa58-tat"); if (s) s.remove(); for (const el of document.querySelectorAll("[data-qa58]")) el.removeAttribute("data-qa58"); };

const srgb = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const tyle = (a, b) => { const L1 = lum(...a), L2 = lum(...b); const hi = Math.max(L1, L2), lo = Math.min(L1, L2); return +((hi + 0.05) / (lo + 0.05)).toFixed(2); };
function doVung(A, B, r, VW, VH) {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(VW, r.x + r.w), y1 = Math.min(VH, r.y + r.h);
  if (x1 - x0 < 2 || y1 - y0 < 2) return { lyDo: "vung-qua-nho", soPixel: 0 };
  const diem = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * A.width + x) * 4;
    const a = [A.data[i], A.data[i + 1], A.data[i + 2]], b = [B.data[i], B.data[i + 1], B.data[i + 2]];
    const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    if (d > 8) diem.push({ d, a, b });
  }
  if (diem.length < 3) return { soPixel: diem.length, lyDo: "khong-thay-pixel-chu" };
  diem.sort((p, q) => q.d - p.d);
  const dMax = diem[0].d;
  const loi85 = diem.filter((p) => p.d >= dMax * 0.85);
  const loi50 = diem.filter((p) => p.d >= dMax * 0.5);
  const tb = (arr, k) => [0, 1, 2].map((j) => arr.reduce((s, p) => s + p[k][j], 0) / arr.length);
  const chu85 = tb(loi85, "a"), nen85 = tb(loi85, "b");
  const chu50 = tb(loi50, "a"), nen50 = tb(loi50, "b");
  return { soPixel: diem.length, dMax, chuRGB: chu85.map(Math.round), nenRGB: nen85.map(Math.round), tiSoP: tyle(chu85, nen85), tiSoP50: tyle(chu50, nen50), soLoi: loi85.length };
}

const MAN = [
  { ten: "twin", url: "/twin", tid: "man-twin-van-hanh", cho: '[data-testid="man-twin-van-hanh"] canvas' },
  { ten: "line", url: "/twin/line/2", tid: "man-twin-line", cho: '[data-testid="man-twin-line"] canvas' },
  { ten: "may", url: "/twin/may/14", tid: "man-twin-may", cho: '[data-testid="khoi-canh-may"] canvas' },
  { ten: "may18", url: "/twin/may/18", tid: "man-twin-may", cho: '[data-testid="khoi-canh-may"] canvas' },
  { ten: "studio", url: "/twin-studio", tid: "man-twin-studio", cho: '[data-testid="man-twin-studio"]' },
];
const LOC = CHISO ? MAN.filter((m) => CHISO.split(",").includes(m.ten)) : MAN;
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
    for (const m of LOC) {
      await page.goto(`${BASE}${m.url}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(m.cho, { timeout: 90_000 }).catch(() => {});
      if (m.ten === "may" || m.ten === "may18") await page.waitForSelector('[data-testid="cockpit-2d"] [role="tablist"]', { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(m.ten === "studio" ? 4500 : 7500);
      await page.evaluate(TRONG_TRANG.lib);
      const boCuc = await page.evaluate(DO_BO_CUC, m.tid);
      await page.screenshot({ path: `${OUT}/${m.ten}-${vp}.png` });
      const ds = await page.evaluate(LIET_KE, m.tid);
      const bufA = await page.screenshot();
      await page.evaluate(TAT_FILL); await page.waitForTimeout(500);
      const bufB = await page.screenshot();
      await page.evaluate(BAT_FILL);
      const A = PNG.sync.read(bufA), B = PNG.sync.read(bufB);
      const tp = ds.map((d) => {
        const rP = doVung(A, B, d.vungDo, VW, VH);
        const rFull = doVung(A, B, d.rect, VW, VH);
        /* MÔ HÌNH C — màu QUY ĐỊNH (đã hợp nhất alpha) trên nền ĐO ĐƯỢC tại lõi nét */
        let tiSoC = null;
        const nen = rP.nenRGB ?? rFull.nenRGB;
        if (d.mauByte && nen) {
          const al = d.mauByte[3] * d.opacity;
          const chuHieuLuc = al >= 0.999 ? d.mauByte.slice(0, 3) : [0, 1, 2].map((k) => al * d.mauByte[k] + (1 - al) * nen[k]);
          tiSoC = tyle(chuHieuLuc, nen);
        }
        const tiSoPmax = rP.tiSoP != null && rFull.tiSoP != null ? Math.max(rP.tiSoP, rFull.tiSoP) : (rP.tiSoP ?? rFull.tiSoP ?? null);
        const doDuoc = rP.tiSoP != null || rFull.tiSoP != null || tiSoC != null;
        const tiSoThan = [tiSoPmax, tiSoC].filter((x) => x != null).length ? Math.max(...[tiSoPmax, tiSoC].filter((x) => x != null)) : null; /* rộng lượng: như Đợt 57 */
        const tiSoNgat = [tiSoPmax, tiSoC].filter((x) => x != null).length ? Math.min(...[tiSoPmax, tiSoC].filter((x) => x != null)) : null; /* nghiêm: thấp nhất trong 2 mô hình */
        return { ...d, pixel: { tiSoP: rP.tiSoP, tiSoP50: rP.tiSoP50, dMax: rP.dMax, soPixel: rP.soPixel, lyDo: rP.lyDo, chuRGB: rP.chuRGB, nenRGB: rP.nenRGB }, pixelFull: { tiSoP: rFull.tiSoP, dMax: rFull.dMax, lyDo: rFull.lyDo }, tiSoC, tiSoThan, tiSoNgat, doDuoc };
      });
      const dd = tp.filter((d) => d.doDuoc);
      const duoiThan = dd.filter((d) => d.tiSoThan < d.nguong);
      const duoiNgat = dd.filter((d) => d.tiSoNgat < d.nguong);
      K[m.ten] = { ...boCuc, m11: { soChuNho: ds.length, doDuoc: dd.length, khongDo: ds.length - dd.length, duoiThan: duoiThan.length, duoiNgat: duoiNgat.length, ds: tp } };
      const n10 = Object.entries(boCuc.nut).filter((e) => e[1]).map((e) => `${e[0]}:${e[1].soDeTrongPanel}/${e[1].giaoNoiDungTrongPanel}px² (toàn trang ${e[1].soDeToanTrang}/${e[1].giaoNoiDungToanTrang})`).join(" ") || "—";
      const n13 = boCuc.tonDong ? `${boCuc.tonDong.hangDu} đủ/${boCuc.tonDong.hangNua} ≥½ (${boCuc.tonDong.tongTheoPhan} hàng)/${boCuc.tonDong.tongHang}` : "—";
      console.log(`   [${vp}] ${m.ten}: M10 ${n10} · nhãn bị nút che ${boCuc.nhanBiNutChe.length} · M11 ${duoiThan.length} (ngặt ${duoiNgat.length}) dưới ngưỡng / ${dd.length} đo được (không đo được ${ds.length - dd.length}) min=${dd.length ? Math.min(...dd.map((d) => d.tiSoThan)) : "—"} · M12 "${boCuc.m12.khoa}" ×${boCuc.m12.soLap} (khối cảnh ${boCuc.m12.lapTrongKhoiCanh}) viên=${boCuc.m12.vien ? boCuc.m12.vien.tid : "—"} · M13 ${n13}`);
    }
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/tong.json`, JSON.stringify(tong, null, 2));
console.log(`=== do58 tag=${TAG} lang=${LANG} xong → ${OUT}/tong.json ===`);
