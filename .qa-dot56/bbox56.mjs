// ĐỢT 45 — LƯỚI BBOX 11 MỤC THIẾT KẾ (9 + 2 kỹ thuật nhỏ), 4 màn × 2 viewport, đọc từ DOM THẬT (không hằng).
//   node .qa-dot49/bbox45.mjs --tag=truoc|sau|go-<muc> [--base=http://localhost:3049] [--lang=vi]
// Ghi .qa-dot49/bbox-<tag>.json + in "[vp] M<n> ĐẠT|TRƯỢT chi tiết". Mỗi mục có tiêu chí NÓI RA ở đầu hàm.
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3049");
const LANG = arg("lang", "vi");
const TAG = arg("tag", "truoc");
const OUT = process.env.QA_OUT ?? `.qa-dot53/bbox-${TAG}`;
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
// ── tiện ích DOM (chạy trong trang) ───────────────────────────────────────────
const R = (b) => (b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), day: Math.round(b.bottom), phai: Math.round(b.right) } : null);
const giao = (a, b) => (!a || !b ? 0 : Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)));
const bboxTid = (page, tid) => page.evaluate(({ tid }) => { const el = document.querySelector(`[data-testid="${tid}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), day: Math.round(r.bottom), phai: Math.round(r.right), hidden: el.hidden === true }; }, { tid });
const bongBong = (page) => page.evaluate(() => { const el = document.querySelector("div.fixed.bottom-6.right-6"); if (!el) return { co: 0, bbox: null }; const r = el.getBoundingClientRect(); return { co: 1, bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; });
const D = (vp, m, ok, chi) => { const s = `[${vp}] ${m} ${ok ? "ĐẠT" : "TRƯỢT"} ${chi}`; console.log("   " + s); return { ok, chi }; };

const browser = await chromium.launch();
const kq = {};
try {
  for (const vp of ["1600x900", "1280x720"]) {
    const [VW, VH] = vp.split("x").map(Number);
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
    await ctx.addInitScript((l) => { try { localStorage.setItem("i18nextLng", l); } catch {} }, LANG);
    await dangNhap(ctx);
    const page = await ctx.newPage();
    const K = (kq[vp] = { muc: {}, tho: {} });

    /* ══ /twin ══ */
    await page.goto(`${BASE}/twin`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(7000);
    await page.screenshot({ path: `${OUT}/twin-${vp}.png` });
    const twin = await page.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), day: Math.round(b.bottom), phai: Math.round(b.right) }; };
      const q = (t) => document.querySelector(`[data-testid="${t}"]`);
      const man = q("man-twin-van-hanh");
      const header = man?.querySelector("header");
      const hb = r(header);
      // M2a — thanh công cụ: mọi nút hành động bấm được & KHÔNG tràn phải header
      const NUT = ["nut-nap-lai", "nut-xuat-usd", "nut-che-2d", "nut-toan-man", "nut-chi-nhan-bat-thuong", "lien-ket-twin-studio"];
      const nut = NUT.map((t) => { const el = q(t); const b = r(el); return { t, co: !!el, bbox: b, trongHeader: !!(b && hb) && b.w > 0 && b.phai <= hb.phai + 1 && b.x >= hb.x - 1 }; });
      const headerTran = header ? header.scrollWidth > header.clientWidth + 1 : null;
      // trạng thái dữ liệu: 5 huy hiệu PHẢI còn (hợp đồng đo), hiện (w>0), không tràn viewport
      const TT = ["trang-thai-ket-noi", "co-che-giao-so", "badge-xuat-xu", "do-tuoi-nen"];
      const tt = TT.map((t) => { const el = q(t); const b = r(el); return { t, co: !!el, bbox: b, hien: !!b && b.w > 0 && b.phai <= innerWidth && b.x >= 0, chu: el?.textContent?.trim().slice(0, 60) ?? null }; });
      // M9 — breadcrumb: các mắt xích hiện KHÔNG bị cắt chữ (scrollWidth ≤ clientWidth), có ≥ 2 mắt xích hiện đủ (cấp cha + cấp hiện tại)
      const nav = q("breadcrumb-twin");
      const crumbs = [...(nav?.querySelectorAll('button[data-testid^="breadcrumb-"]') ?? [])].map((el) => ({ tid: el.getAttribute("data-testid"), chu: el.textContent?.trim() ?? "", bịCat: el.scrollWidth > el.clientWidth + 1, title: el.getAttribute("title"), w: Math.round(el.getBoundingClientRect().width) }));
      const nutAnCap = q("breadcrumb-an-cap");
      const navTran = nav ? nav.scrollWidth > nav.clientWidth + 1 : null;
      // M2b — ngăn phải khi CHƯA chọn máy: w = 0; vùng cảnh (khung neo) ≥ 700 @1280
      const pp = q("panel-phai");
      const panelPhai = { bbox: r(pp), hidden: pp?.hidden === true, thu: pp?.getAttribute("data-thu"), lyDo: pp?.getAttribute("data-ly-do-thu") };
      const neo = r(q("khung-neo-lop-phu"));
      const cumTT = r(q("cum-trang-thai-du-lieu"));
      // M4 — nhãn: mặc định chỉ nhãn bất thường (nút aria-pressed=true), số nhãn, chip
      const nutNhan = q("nut-chi-nhan-bat-thuong");
      const nhan = [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].map((el) => el.textContent?.trim().slice(0, 40) ?? "");
      const chip = q("chip-nhan-bi-an");
      const chipRect = r(chip);
      const chipTheoCS = chip?.getAttribute("data-theo-chinh-sach") ?? null;
      const cumChip = r(q("cum-chip-nhan"));
      const demDuoi = q("cum-chip-nhan")?.getAttribute("data-dem-duoi-px") ?? null;
      const canvasRect = r(q("khoi-canh-3d")?.querySelector("canvas"));
      const lopPhu = [...document.querySelectorAll("[data-che-nhan]"), ...(q("dai-hop-nhat") ? [q("dai-hop-nhat")] : [])].map((el) => ({ t: el.getAttribute("data-testid") ?? el.tagName, rect: r(el) })).filter((p) => p.rect && p.rect.w > 0 && p.rect.h > 0);
      // M8 — danh sách cảnh báo cuộn riêng: ô cuộn có bóng mép (class cuon-doc-bong) khi cuộn được; dải tab nằm trọn trong panel trái
      const dcb = q("dai-canh-bao");
      const oCuon = dcb ? [...dcb.children].find((c) => getComputedStyle(c).overflowY === "auto") : null;
      const cuon = oCuon ? { scrollH: oCuon.scrollHeight, clientH: oCuon.clientHeight, cuonDuoc: oCuon.scrollHeight > oCuon.clientHeight + 1, coBong: oCuon.classList.contains("cuon-doc-bong"), bg: getComputedStyle(oCuon).backgroundImage.slice(0, 40) } : null;
      const tab = r(q("khoi-cay-phan-cap"));
      const pt = r(q("panel-trai"));
      const goiY = r(q("goi-y-chon-may"));
      const dongTG = r(q("lop-phu-dong-thoi-gian"));
      return { hb, headerTran, navTran, nut, tt, crumbs, nutAnCap: !!nutAnCap, panelPhai, neo, cumTT, nhan: { so: nhan.length, ds: nhan, pressed: nutNhan?.getAttribute("aria-pressed"), chip: chip?.textContent?.trim() ?? null, soAn: chip?.getAttribute("data-so-an") ?? null, chipRect, chipTheoCS, cumChip, demDuoi }, canvasRect, lopPhu, cuon, tab, pt, goiY, dongTG, url: location.href };
    });
    const bb = await bongBong(page);
    K.tho.twin = { ...twin, bongBong: bb };
    K.muc.M1_twin = D(vp, "M1 /twin nút chat", bb.co === 0 || giao(bb.bbox, twin.dongTG) === 0, `bong=${bb.co} giao-dòng-thời-gian=${giao(bb.bbox, twin.dongTG)}px²`);
    const nutOk = twin.nut.every((n) => n.co && n.trongHeader);
    K.muc.M2a = D(vp, "M2a thanh công cụ không tràn, 6 nút bấm được", nutOk && twin.headerTran === false, `tràn=${twin.headerTran} ${twin.nut.map((n) => `${n.t}:${n.co ? (n.trongHeader ? "✓" : "tràn") : "thiếu"}`).join(" ")}`);
    const ttOk = twin.tt.every((x) => x.co && x.hien);
    K.muc.M2c = D(vp, "M2c 4 huy hiệu trạng thái còn & hiện", ttOk, twin.tt.map((x) => `${x.t}:${x.co ? (x.hien ? "✓" : "ẩn") : "thiếu"}`).join(" ") + ` · viên trạng thái=${twin.cumTT ? `${twin.cumTT.w}×${twin.cumTT.h}@${twin.cumTT.x},${twin.cumTT.y}` : "không"}`);
    const neoOk = VW === 1280 ? (twin.neo?.w ?? 0) >= 700 : (twin.neo?.w ?? 0) >= 900;
    K.muc.M2b = D(vp, "M2b ngăn phải 0 px khi chưa chọn; vùng cảnh rộng", (twin.panelPhai.bbox?.w ?? 1) === 0 && neoOk, `panel-phai w=${twin.panelPhai.bbox?.w} thu=${twin.panelPhai.thu} lyDo=${twin.panelPhai.lyDo} · neo w=${twin.neo?.w}`);
    const hienCrumbs = twin.crumbs;
    const crumbOk = hienCrumbs.length >= 2 && hienCrumbs.every((c) => !c.bịCat && c.chu.length > 0) && twin.navTran === false;
    K.muc.M9 = D(vp, "M9 breadcrumb không cắt chữ, ≥2 mắt xích đủ, nav không tràn", crumbOk, `${hienCrumbs.map((c) => `${c.tid}="${c.chu}"${c.bịCat ? "(CẮT)" : ""}`).join(" › ")} anCap=${twin.nutAnCap} navTràn=${twin.navTran}`);
    // M4: mặc định bật; nếu có chip thì chip phải nói THEO CHÍNH SÁCH (data-theo-chinh-sach=1), nằm TRỌN TRONG canvas,
    //     và KHÔNG bị lớp phủ nào che (thanh tua, dải hợp nhất, panel, viên trạng thái, gợi ý) — giao = 0 với mọi [data-che-nhan] + dai-hop-nhat.
    const cv = twin.canvasRect;
    const chipTrongCanvas = !!twin.nhan.chipRect && !!cv && twin.nhan.chipRect.y >= cv.y && twin.nhan.chipRect.day <= cv.day && twin.nhan.chipRect.x >= cv.x && twin.nhan.chipRect.phai <= cv.phai;
    const chipBiChe = (twin.lopPhu ?? []).filter((p) => giao(twin.nhan.chipRect, p.rect) > 0).map((p) => p.t);
    const chipOk = !twin.nhan.chipRect || (twin.nhan.chipTheoCS === "1" && chipTrongCanvas && chipBiChe.length === 0);
    K.muc.M4 = D(vp, "M4 mặc định chỉ nhãn bất thường; chip theo chính sách, TRONG canvas, không bị lớp phủ che", twin.nhan.pressed === "true" && twin.nhan.so <= 8 && chipOk, `pressed=${twin.nhan.pressed} nhãn=${twin.nhan.so} chip="${twin.nhan.chip}" theoCS=${twin.nhan.chipTheoCS} trongCanvas=${chipTrongCanvas} bịChe=[${chipBiChe.join(",")}] chipRect=${JSON.stringify(twin.nhan.chipRect)} đệm=${twin.nhan.demDuoi}`);
    const cuonOk = !!twin.cuon && (!twin.cuon.cuonDuoc || twin.cuon.coBong) && !!twin.tab && !!twin.pt && twin.tab.day <= twin.pt.day && twin.tab.h > 0;
    K.muc.M8 = D(vp, "M8 danh sách cảnh báo cuộn riêng có bóng mép, dải tab trọn", cuonOk, `cuộn=${JSON.stringify(twin.cuon)} tab=${JSON.stringify(twin.tab)}`);

    /* ══ /twin/line/2 ══ */
    await page.goto(`${BASE}/twin/line/2`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="man-twin-line"] canvas', { timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(7000);
    await page.screenshot({ path: `${OUT}/line-${vp}.png` });
    const line = await page.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), day: Math.round(b.bottom) }; };
      const q = (t) => document.querySelector(`[data-testid="${t}"]`);
      const cv = r(q("man-twin-line")?.querySelector("canvas"));
      const nhan = [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].map((el) => { const b = el.getBoundingClientRect(); return { chu: el.textContent?.trim().slice(0, 30), cx: Math.round(b.x + b.width / 2), cy: Math.round(b.y + b.height / 2) }; });
      const ty = cv ? nhan.map((n) => (n.cy - cv.y) / cv.h) : [];
      const dem = window.__demNhan ?? null;
      return { cv, so: nhan.length, ty: ty.map((v) => Number(v.toFixed(3))), tyMin: ty.length ? Math.min(...ty) : null, tyMax: ty.length ? Math.max(...ty) : null, tyTB: ty.length ? ty.reduce((a, b) => a + b, 0) / ty.length : null, ngoaiKhung: dem?.ngoaiKhung ?? null, dai: r(q("khoi-dai-line")) };
    });
    const bbL = await bongBong(page);
    K.tho.line = { ...line, bongBong: bbL };
    K.muc.M1_line = D(vp, "M1 /line nút chat", bbL.co === 0 || giao(bbL.bbox, line.dai) === 0, `bong=${bbL.co} giao-dải-trạm=${giao(bbL.bbox, line.dai)}px²`);
    const m3 = line.so === 12 && line.tyMin !== null && line.tyMin >= 0.3 && line.tyMax <= 0.9 && line.tyTB >= 0.55 && line.ngoaiKhung === 0;
    K.muc.M3 = D(vp, "M3 Line: 12/12 nhãn, tâm dải nhãn ở nửa giữa-dưới (TB ≥ 55 %, trong 30–90 %)", m3, `nhãn=${line.so} ngoàiKhung=${line.ngoaiKhung} ty=[${line.tyMin?.toFixed(2)}..${line.tyMax?.toFixed(2)}] TB=${line.tyTB?.toFixed(2)}`);

    /* ══ /twin/may/14 ══ */
    await page.goto(`${BASE}/twin/may/14`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="khoi-canh-may"] canvas', { timeout: 90_000 }).catch(() => {});
    await page.waitForSelector('[data-testid="cockpit-2d"] [role="tablist"]', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${OUT}/may-${vp}.png` });
    const may = await page.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), day: Math.round(b.bottom), phai: Math.round(b.right) }; };
      const q = (t) => document.querySelector(`[data-testid="${t}"]`);
      const canh = r(q("khoi-canh-may")); const cockpit = r(q("cockpit-2d")); const pp = r(q("panel-phai-may"));
      // M11 — thanh tab cockpit: cuộn ngang có chỉ báo (mép mờ + mũi tên) khi tràn
      const thanh = q("thanh-tab-cockpit");
      const tl = q("cockpit-2d")?.querySelector('[role="tablist"]');
      const oCuon = thanh?.querySelector("[data-o-cuon]") ?? null;
      const tab = { co: !!thanh, cuonDuoc: thanh?.getAttribute("data-cuon-duoc") ?? null, mepPhai: thanh?.getAttribute("data-mep-phai") ?? null, mepTrai: thanh?.getAttribute("data-mep-trai") ?? null, nutPhai: r(q("nut-cuon-tab-phai")), tlW: tl ? Math.round(tl.getBoundingClientRect().width) : null, oCuonW: oCuon ? oCuon.clientWidth : null, tran: oCuon ? oCuon.scrollWidth > oCuon.clientWidth + 1 : (tl && tl.parentElement ? tl.parentElement.scrollWidth > tl.parentElement.clientWidth + 1 : null) };
      // M12 — thẻ "Mất kết nối": giá trị 1 dòng
      const the = [...(q("cockpit-2d")?.querySelectorAll("div") ?? [])].find((el) => el.children.length === 0 && /^(Mất kết nối|Disconnected|Đã kết nối|Connected)$/.test(el.textContent?.trim() ?? ""));
      let theKq = null;
      if (the) { const cs = getComputedStyle(the); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25; const b = the.getBoundingClientRect(); theKq = { chu: the.textContent?.trim(), h: Math.round(b.height), lineH: Math.round(lh), dong: Math.round(b.height / lh), fontPx: parseFloat(cs.fontSize), w: Math.round(b.width) }; }
      return { canh, cockpit, pp, tab, the, theKq };
    });
    const bbM = await bongBong(page);
    K.tho.may = { ...may, bongBong: bbM };
    K.muc.M1_may = D(vp, "M1 /may nút chat", bbM.co === 0 || giao(bbM.bbox, may.pp) === 0, `bong=${bbM.co} giao-ngăn-phải=${giao(bbM.bbox, may.pp)}px²`);
    const m6 = !!may.canh && !!may.cockpit && may.cockpit.h > may.canh.h && (VW === 1280 ? may.canh.h >= 280 : may.canh.h >= 320);
    K.muc.M6 = D(vp, "M6 Máy: cảnh ≥ 280 @1280 (≥320 @1600), cockpit > cảnh", m6, `cảnh h=${may.canh?.h} cockpit h=${may.cockpit?.h}`);
    const m11 = may.tab.co && (!may.tab.tran || (may.tab.cuonDuoc === "1" && may.tab.mepPhai === "1" && !!may.tab.nutPhai && may.tab.nutPhai.w > 0));
    K.muc.M11 = D(vp, "M11 thanh tab cockpit: tràn ⇒ có mép mờ + mũi tên", m11, `co=${may.tab.co} tràn=${may.tab.tran} cuonDuoc=${may.tab.cuonDuoc} mepPhai=${may.tab.mepPhai} nútPhải=${JSON.stringify(may.tab.nutPhai)}`);
    K.muc.M12 = D(vp, "M12 thẻ Kết nối: giá trị 1 dòng", !!may.theKq && may.theKq.dong <= 1, JSON.stringify(may.theKq));

    /* ══ /twin-studio (tab thiết kế) ══ */
    await page.goto(`${BASE}/twin-studio`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="man-twin-studio"]', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    if ((await page.locator('[data-testid="tab-thiet-ke"]').count()) > 0) await page.getByTestId("tab-thiet-ke").click();
    await page.waitForSelector('[data-testid="man-twin-studio"] canvas', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${OUT}/studio-${vp}.png` });
    const studio = await page.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), day: Math.round(b.bottom), phai: Math.round(b.right) }; };
      const q = (t) => document.querySelector(`[data-testid="${t}"]`);
      const man = r(q("man-twin-studio")); const canh = r(q("khoi-canh-3d")); const vung = r(q("vung-canvas")); const mini = r(q("mini-map")); const tool = r(q("thanh-cong-cu-canh")); const tv = r(q("thu-vien-asset"));
      const header = q("man-twin-studio")?.querySelector("header");
      const tabs = q("tab-thiet-ke")?.closest('[role="tablist"]');
      const miniSvg = q("mini-map-svg");
      return { man, canh, vung, mini, tool, tv, header: r(header), tabs: r(tabs), miniCanh: miniSvg?.getAttribute("width") ?? null, miniDataCanh: q("mini-map")?.getAttribute("data-canh-px") ?? null, canvasEl: r(q("man-twin-studio")?.querySelector("canvas")) };
    });
    const bbS = await bongBong(page);
    K.tho.studio = { ...studio, bongBong: bbS };
    K.muc.M1_studio = D(vp, "M1 /studio nút chat", bbS.co === 0 || giao(bbS.bbox, studio.tv) === 0, `bong=${bbS.co} giao-thư-viện=${giao(bbS.bbox, studio.tv)}px²`);
    const gTool = giao(studio.mini, studio.tool);
    const m5 = gTool === 0 && !!studio.mini && !!studio.vung && studio.mini.h <= 0.45 * studio.vung.h && studio.mini.day <= studio.vung.day + 1;
    K.muc.M5 = D(vp, "M5 studio: minimap không che nút, ≤ 45 % chiều cao vùng cảnh", m5, `giao-nút=${gTool}px² mini h=${studio.mini?.h} vùng h=${studio.vung?.h} (${studio.mini && studio.vung ? Math.round((100 * studio.mini.h) / studio.vung.h) : "?"} %) cạnh=${studio.miniCanh}`);
    const tiLe = studio.canh && studio.man ? studio.canh.h / studio.man.h : 0;
    const khongChui = !!studio.canvasEl && !!studio.vung && studio.canvasEl.day <= studio.vung.day + 1;
    K.muc.M7 = D(vp, "M7 studio: cảnh ≥ 55 % vùng làm việc @1600 (≥45 % @1280), canvas không chui khỏi vùng", (VW === 1600 ? tiLe >= 0.55 : tiLe >= 0.45) && khongChui, `cảnh h=${studio.canh?.h} / màn h=${studio.man?.h} = ${(100 * tiLe).toFixed(1)} % · header h=${studio.header?.h} tabs y=${studio.tabs?.y} · canvas đáy=${studio.canvasEl?.day} vùng đáy=${studio.vung?.day}`);

    /* ══ ngoài twin — nút chat PHẢI còn ══ */
    await page.goto(`${BASE}/machine/14`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const bbN = await bongBong(page);
    K.tho.ngoai = { url: page.url(), bongBong: bbN };
    K.muc.M1_ngoai = D(vp, "M1 ngoài twin (/machine/14) nút chat CÒN", bbN.co === 1, `bong=${bbN.co} url=${page.url()}`);

    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${process.env.QA_OUT ?? ".qa-dot53"}/bbox-${TAG}.json`, JSON.stringify(kq, null, 2));
const tong = Object.values(kq).flatMap((k) => Object.values(k.muc));
console.log(`\n=== bbox45 tag=${TAG}: ĐẠT ${tong.filter((m) => m.ok).length} · TRƯỢT ${tong.filter((m) => !m.ok).length} / ${tong.length} ===`);
