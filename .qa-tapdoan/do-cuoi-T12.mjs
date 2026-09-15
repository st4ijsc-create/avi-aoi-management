/** NGHIỆM-THU CUỐI — T1 (nhánh GHI HỎNG của "Lưu rồi chuyển") và T2 (buffer nhiều
 *  hàng, HAI loại thay đổi: lật khoá + dời vị trí) × ba lối (ở lại / bỏ / lưu rồi chuyển).
 *  node .qa-tapdoan/do-cuoi-T12.mjs --ca=T1|T2|all
 *  Mọi hàng `twin_dat_cho` bị đụng đều được CHỤP TRƯỚC và KHÔI PHỤC nguyên trạng ở cuối.
 */
import { chromium } from "@playwright/test";
import { arg, BASE, LAUNCH, MOC, sqlMo, luu, bao, phan, dangNhapCtx, anh, choCanh } from "./lib-cuoi.mjs";

const CA = arg("ca", "all");
const chay = (c) => CA === "all" || CA === c;
const VAI = "qatd_kythuat";
const KQ = {};
const COT = ["viTriXMm", "viTriYMm", "viTriZMm", "rongMm", "caoMm", "sauMm", "kichThuocDaDo",
  "quatX", "quatY", "quatZ", "quatW", "tiLeX", "tiLeY", "tiLeZ", "modelId", "daKhoa", "hienThi", "nguon"];

const sql = sqlMo();
const chupHang = async (tangId) => sql`select id, "tangId", "thucTheId", ${sql(COT)} from twin_dat_cho
  where "tangId"=${tangId} and "loaiThucThe"='machine' order by "thucTheId"`;
const khoiPhuc = async (chup) => {
  let n = 0;
  for (const h of chup) {
    const d = {}; for (const c of COT) d[c] = h[c];
    const kq = await sql`update twin_dat_cho set ${sql(d)} where id=${h.id}`;
    n += kq.count;
  }
  return n;
};
const soKhac = (a, b) => {
  const m = new Map(b.map((x) => [Number(x.id), x]));
  let n = 0; const ds = [];
  for (const x of a) {
    const y = m.get(Number(x.id)); if (!y) { n += 1; ds.push({ id: x.id, ly: "mất hàng" }); continue; }
    const cot = COT.filter((c) => String(x[c]) !== String(y[c]));
    if (cot.length) { n += 1; ds.push({ id: x.id, thucTheId: x.thucTheId, cot }); }
  }
  return { so: n, ds };
};

const DOC = () => {
  const el = (t) => document.querySelector(`[data-testid="${t}"]`);
  const dem = (t) => document.querySelectorAll(`[data-testid="${t}"]`).length;
  const chu = (t) => { const e = el(t); return e ? (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim() : null; };
  const so = (s) => { if (s == null) return null; const m = s.match(/(-?\d+)/); return m ? Number(m[1]) : null; };
  const oChon = (t) => { const e = el(t); return e ? { value: e.value, nhan: [...e.options].map((o) => o.value === e.value ? o.textContent.trim() : null).find(Boolean) || null, soMuc: e.options.length } : null; };
  const h = el("hop-thoai-chua-luu");
  return {
    url: location.pathname + location.search,
    oNhaMay: oChon("chon-nha-may"), oToaNha: oChon("chon-toa-nha"), oTang: oChon("chon-tang"),
    demChuaLuu: dem("dem-chua-luu"), demChuaLuuChu: chu("dem-chua-luu"), demChuaLuuSo: so(chu("dem-chua-luu")),
    nutLuu: dem("nut-luu"), congTacKhoa: dem("cong-tac-khoa"), congTacKhoaBat: el("cong-tac-khoa") ? el("cong-tac-khoa").getAttribute("data-state") : null,
    thanhCanChinh: dem("thanh-can-chinh"),
    nutCanhTrai: dem("nut-canh-trai"), nutCanhTraiTat: el("nut-canh-trai") ? el("nut-canh-trai").disabled : null,
    soKhoiCanh: (() => { const ds = window.__demTuongTac && window.__demTuongTac.dsMay ? window.__demTuongTac.dsMay() : null; return Array.isArray(ds) ? ds.length : null; })(),
    hopThoai: h ? { co: 1, chu: (h.innerText || "").replace(/\s+/g, " ").trim(),
      nutLuuRoiDoi: dem("nut-luu-roi-doi"), nutBoThayDoi: dem("nut-bo-thay-doi"), nutHuyDoi: dem("nut-huy-doi"),
      luuTat: el("nut-luu-roi-doi") ? el("nut-luu-roi-doi").disabled : null } : { co: 0 },
    loiTrenMan: [...document.querySelectorAll("[data-sonner-toast], [role='alert'], [role='status']")].map((e) => (e.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 5),
    soNodeMay: document.querySelectorAll('[data-testid^="node-cay-machine:"]').length,
    nodeChon: [...document.querySelectorAll('[data-testid^="node-cay-machine:"]')].filter((e) => e.getAttribute("aria-selected") === "true" || /bg-primary/.test(e.className)).map((e) => e.getAttribute("data-testid")),
  };
};
const doc = (p) => p.evaluate(DOC);

async function moStudio(browser, tang) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await dangNhapCtx(ctx, VAI);
  const page = await ctx.newPage();
  page.on("dialog", async (d) => { await d.dismiss().catch(() => {}); });
  await page.goto(`${BASE}/twin-studio?do=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[data-testid="man-twin-studio"]', { timeout: 120_000 }).catch(() => {});
  await page.waitForSelector('[data-testid="xuong-thiet-ke"] canvas', { timeout: 60_000 }).catch(() => {});
  await choCanh(page, 0);
  // lái tới đúng toà + tầng
  await page.selectOption('[data-testid="chon-toa-nha"]', String(tang.toa_id)).catch(() => {});
  await page.waitForFunction((t) => { const s = document.querySelector('[data-testid="chon-tang"]'); return !!s && [...s.options].some((o) => o.value === String(t)); }, tang.tang_id, { timeout: 45_000 }).catch(() => {});
  await page.selectOption('[data-testid="chon-tang"]', String(tang.tang_id)).catch(() => {});
  await choCanh(page, 0);
  await page.waitForFunction((n) => { const ds = window.__demTuongTac && window.__demTuongTac.dsMay ? window.__demTuongTac.dsMay() : null; return Array.isArray(ds) && ds.length === n; }, (tang.n != null ? tang.n : tang.so_may), { timeout: 60_000 }).catch(() => {});
  return { ctx, page };
}

/** Bấm TÂM một khối máy trên cảnh (đường người dùng thật) — trả machineId. */
async function bamMotKhoi(page, tru) {
  const diem = await page.evaluate((tru) => {
    const cv = document.querySelector('[data-testid="xuong-thiet-ke"] canvas');
    if (!cv) return { loi: "khong co canvas xuong-thiet-ke" };
    const r0 = cv.getBoundingClientRect();
    const ds = (window.__demTuongTac && window.__demTuongTac.dsMay ? window.__demTuongTac.dsMay() : []).filter((m) => m.trongKhung);
    for (const m of ds) {
      if (tru.includes(m.machineId)) continue;
      const t = window.__demTuongTac.tamMay ? window.__demTuongTac.tamMay(m.machineId) : null;
      if (!t || t.biChe) continue;
      const X = r0.left + t.x, Y = r0.top + t.y;
      if (document.elementFromPoint(X, Y) !== cv) continue;
      return { id: m.machineId, X, Y };
    }
    return { loi: `0 khoi bam duoc (trong khung ${ds.length}, tru ${tru.length})` };
  }, tru || []);
  if (diem.loi) throw new Error(`THIEU DU KIEN: tam khoi may bam duoc tren canh Studio — ${diem.loi}`);
  await page.mouse.move(diem.X - 40, diem.Y - 40);
  await page.mouse.move(diem.X, diem.Y, { steps: 4 });
  await page.mouse.click(diem.X, diem.Y);
  await page.waitForSelector('[data-testid="cong-tac-khoa"]', { timeout: 30_000 });
  return diem.id;
}

/** Đổi ô chọn rồi CHỜ tới khi phân định: hộp thoại hiện, hoặc ô đã đổi thật. */
async function doiO(page, testid, giaTri) {
  const truoc = await page.evaluate((t) => { const e = document.querySelector(`[data-testid="${t}"]`); return e ? e.value : null; }, testid);
  await page.selectOption(`[data-testid="${testid}"]`, String(giaTri)).catch(() => {});
  const ketCuc = await page.waitForFunction(({ t, v }) => {
    if (document.querySelector('[data-testid="hop-thoai-chua-luu"]')) return "hop-thoai";
    const e = document.querySelector(`[data-testid="${t}"]`);
    if (e && e.value === String(v)) return "doi-that";
    return false;
  }, { t: testid, v: giaTri }, { timeout: 30_000 }).then((h) => h.jsonValue()).catch(() => "khong-phan-dinh");
  return { truoc, ketCuc };
}

/** Chọn nhiều máy trong CÂY bằng shift+click — đường DUY NHẤT của sản phẩm cho đa chọn.
 *  ★ Đo được (`.qa-tapdoan/tho/CUOI/_probe-t2.log`): cây chỉ render nhánh ĐANG MỞ
 *    (304 node, không phải tất cả) nên phải dùng `loc-cay` để mở nhánh; và một cú bấm lên cảnh khi đang đa
 *    chọn KHÔNG rút tập chọn về 1 (gizmo của tập chọn nuốt cú bấm) ⇒ thứ tự bắt
 *    buộc là LẬT KHOÁ TRƯỚC (một máy, bấm cảnh), ĐA CHỌN + CĂN SAU.
 */
async function chonNhieuTrenCay(page, muc) {
  const daChon = [];
  for (const m of muc) {
    const sel = `[data-testid="node-cay-machine:${m.id}"]`;
    if ((await page.locator(sel).count()) === 0 && m.ma) {
      // ★ Cây chỉ render nhánh ĐANG MỞ. Bộ lọc `loc-cay` tự mở mọi nhánh khớp
      //   (`moHieuLuc` hợp nhất `khoaCanMo`) — đó là đường của sản phẩm để tới
      //   một máy ở nhánh đang gập, không phải một lối tắt của phép đo.
      await page.locator('[data-testid="loc-cay"]').fill(m.ma);
      await page.waitForSelector(sel, { timeout: 15_000 }).catch(() => {});
    }
    if ((await page.locator(sel).count()) === 0) continue;
    await page.locator(sel).first().click({ modifiers: daChon.length === 0 ? [] : ["Shift"] });
    daChon.push(m.id);
  }
  await page.locator('[data-testid="loc-cay"]').fill("").catch(() => {});
  return daChon;
}

const browser = await chromium.launch(LAUNCH);
const tang = MOC.tangT2[0];
try {
  /* ══ T1 — nhánh GHI HỎNG của "Lưu rồi chuyển" ═════════════════════════ */
  if (chay("T1")) {
    const r = { ca: "T1", vai: VAI, tang, deBai: "chan luot goi twinCanh.luuHangLoat o tang mang va tra 500 => hop thoai VAN MO, o chon tang CHUA doi, so thay doi GIU NGUYEN, co thong bao loi DOC DUOC" };
    let chupTruoc = null;
    try {
      chupTruoc = await chupHang(tang.tang_id);
      r.demHangTruoc = chupTruoc.length;
      const { ctx, page } = await moStudio(browser, tang);
      const goiLuu = [];
      await page.route("**/api/trpc/twinCanh.luuHangLoat*", async (route) => {
        goiLuu.push(route.request().url().slice(-60));
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { json: { message: "ép lỗi để đo", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } } } }) });
      });
      const d0 = await doc(page);
      const tang0 = d0.oTang ? d0.oTang.value : null;
      const mayId = await bamMotKhoi(page);
      await page.locator('[data-testid="cong-tac-khoa"]').click();
      await page.waitForSelector('[data-testid="dem-chua-luu"]', { timeout: 30_000 }).catch(() => {});
      const d1 = await doc(page);
      const tangKhac = await page.evaluate((t) => { const s = document.querySelector('[data-testid="chon-tang"]'); const o = [...s.options].find((x) => x.value !== String(t)); return o ? o.value : null; }, tang0);
      if (!tangKhac) throw new Error("THIEU DU KIEN: khong co tang KHAC trong o chon-tang de doi sang");
      const o = await doiO(page, "chon-tang", tangKhac);
      const d2 = await doc(page);
      r.anhHopThoai = await anh(page, "T1-hop-thoai");
      // bấm "Lưu rồi chuyển" — lượt ghi sẽ bị chặn và trả 500
      await page.locator('[data-testid="nut-luu-roi-doi"]').click();
      await page.waitForFunction(() => (window.__thongKeVe ? true : true), null, { timeout: 1000 }).catch(() => {});
      // chờ tới khi lượt gọi đã đi qua (có ít nhất 1 lần route) và nút hết trạng thái đang gửi
      await page.waitForFunction(() => { const b = document.querySelector('[data-testid="nut-luu-roi-doi"]'); return !b || b.disabled === false; }, null, { timeout: 45_000 }).catch(() => {});
      const d3 = await doc(page);
      r.anhSauLoi = await anh(page, "T1-sau-loi-ghi");
      const chupSau = await chupHang(tang.tang_id);
      await ctx.close();
      r.thay = { tangBanDau: tang0, tangDinhDoi: tangKhac, mayLatKhoa: mayId, ketCucDoiO: o.ketCuc,
        truocDoi: { demChuaLuu: d1.demChuaLuuSo, chu: d1.demChuaLuuChu },
        khiHopThoaiMo: { co: d2.hopThoai.co, tang: d2.oTang ? d2.oTang.value : null, demChuaLuu: d2.demChuaLuuSo },
        sauKhiGhiHong: { hopThoaiCo: d3.hopThoai.co, tang: d3.oTang ? d3.oTang.value : null, demChuaLuu: d3.demChuaLuuSo, chuHopThoai: d3.hopThoai.chu, loiTrenMan: d3.loiTrenMan },
        soLuotGoiLuuBiChan: goiLuu.length, khacBiet: soKhac(chupTruoc, chupSau) };
      Object.assign(r, phan(
        { "so luot goi luuHangLoat bi chan": goiLuu.length === 0 ? null : goiLuu.length, "dem-chua-luu truoc khi doi": d1.demChuaLuuSo, "hop thoai khi doi tang": d2.hopThoai.co },
        [
          { ten: "hop thoai VAN MO sau khi ghi hong", ok: d3.hopThoai.co === 1, thay: `co=${d3.hopThoai.co}` },
          { ten: "o chon-tang CHUA doi", ok: String(d3.oTang ? d3.oTang.value : null) === String(tang0), thay: `${d3.oTang ? d3.oTang.value : null} (ban đầu ${tang0})` },
          { ten: "so thay doi chua luu GIU NGUYEN", ok: d3.demChuaLuuSo === d1.demChuaLuuSo, thay: `${d1.demChuaLuuSo}→${d3.demChuaLuuSo}` },
          { ten: "co THONG BAO LOI doc duoc tren man", ok: d3.loiTrenMan.length > 0, thay: JSON.stringify(d3.loiTrenMan) },
          { ten: "CSDL KHONG doi mot hang nao", ok: r.thay.khacBiet.so === 0, thay: `${r.thay.khacBiet.so} hàng khác · ${JSON.stringify(r.thay.khacBiet.ds.slice(0, 3))}` },
        ]));
    } catch (e) { r.pq = "HỎNG"; r.vi = `lỗi khi đo: ${String(e.message).slice(0, 400)}`; }
    finally {
      if (chupTruoc) { const n = await khoiPhuc(chupTruoc); const sau = await chupHang(tang.tang_id); r.don = { khoiPhuc: n, conKhac: soKhac(chupTruoc, sau).so }; r.donSach = r.don.conKhac === 0; console.log(`  DỌN T1: khôi phục ${n} hàng · còn khác ${r.don.conKhac} · sạch=${r.donSach}`); }
      KQ.T1 = r; bao("T1", r.pq, r.vi); luu("T1", r);
    }
  }

  /* ══ T2 — buffer NHIỀU HÀNG, HAI LOẠI thay đổi × ba lối ═══════════════ */
  if (chay("T2")) {
    const r = { ca: "T2", vai: VAI, tang, deBai: "3 hang thay doi thuoc 2 loai (dan hang = DOI VI TRI, va lat KHOA) roi lap ba loi: o lai / bo thay doi / luu roi chuyen; loi luu phai ghi CA BA hang va deu mang ma tang CU" };
    let chupTruoc = null;
    try {
      chupTruoc = await chupHang(tang.tang_id);
      r.demHangTruoc = chupTruoc.length;
      const { ctx, page } = await moStudio(browser, tang);
      const d0 = await doc(page);
      const tang0 = d0.oTang ? d0.oTang.value : null;
      const tangKhac = await page.evaluate((t) => { const s = document.querySelector('[data-testid="chon-tang"]'); const o = [...s.options].find((x) => x.value !== String(t)); return o ? o.value : null; }, tang0);
      if (!tangKhac) throw new Error("THIEU DU KIEN: khong co tang KHAC trong o chon-tang");
      r.tang0 = tang0; r.tangKhac = tangKhac;

      /** Dựng buffer NHIỀU HÀNG, HAI LOẠI: 1 lật khoá + N dời vị trí — TẤT CẢ qua CÂY.
       *  ★ Đo được: một cú bấm lên CẢNH khi đang đa chọn KHÔNG rút tập chọn về 1
       *    (xem `_probe-t2.log`), nên lượt dựng thứ hai sẽ kẹt nếu đi đường cảnh.
       *    Cây là bề mặt chọn thứ hai của chính sản phẩm và nó tất định: bấm
       *    THƯỜNG = chọn một, bấm + Shift = thêm vào tập.
       */
      const dungBaThayDoi = async () => {
        const ds = await page.evaluate(() => (window.__demTuongTac && window.__demTuongTac.dsMay ? window.__demTuongTac.dsMay() : [])
          .filter((m) => m.trongKhung).map((m) => m.machineId));
        if (ds.length < 7) throw new Error(`THIEU DU KIEN: tang chi co ${ds.length} khoi trong khung, can >= 7 de dung 1 khoa + 6 can chinh`);
        const bay = ds.slice(0, 7);
        const maBay = await sql`select id, code from machines where id = any(${bay})`;
        const banDo = new Map(maBay.map((x) => [Number(x.id), x.code]));
        // (1) LẬT KHOÁ — chọn ĐÚNG MỘT máy qua cây (bấm thường), rồi lật công tắc.
        const mayKhoa = bay[0];
        const chonKhoa = await chonNhieuTrenCay(page, [{ id: mayKhoa, ma: banDo.get(mayKhoa) }]);
        if (chonKhoa.length !== 1) throw new Error(`THIEU DU KIEN: khong chon duoc node cay cua may ${mayKhoa} (${banDo.get(mayKhoa)})`);
        await page.waitForSelector('[data-testid="cong-tac-khoa"]', { timeout: 30_000 });
        await page.locator('[data-testid="cong-tac-khoa"]').click();
        await page.waitForSelector('[data-testid="dem-chua-luu"]', { timeout: 30_000 }).catch(() => {});
        const dKhoa = await doc(page);
        // (2) DỜI VỊ TRÍ — đa chọn 6 máy KHÁC rồi CĂN TRÁI (máy đã khoá bị `apKetQuaDich` bỏ qua nên không chọn nó).
        const daChon = await chonNhieuTrenCay(page, bay.slice(1).map((id) => ({ id, ma: banDo.get(id) })));
        const dChon = await doc(page);
        let canhDuoc = false;
        if (dChon.nutCanhTrai === 1 && dChon.nutCanhTraiTat === false) {
          await page.locator('[data-testid="nut-canh-trai"]').click();
          await page.waitForFunction((n) => { const e = document.querySelector('[data-testid="dem-chua-luu"]'); if (!e) return false; const m = (e.textContent || "").match(/(\d+)/); return !!m && Number(m[1]) > n; }, dKhoa.demChuaLuuSo || 0, { timeout: 30_000 }).catch(() => {});
          canhDuoc = true;
        }
        const dCuoi = await doc(page);
        return { mayKhoa, maMayKhoa: banDo.get(mayKhoa), soSauKhoa: dKhoa.demChuaLuuSo, daChon, canhDuoc, nutCanhTrai: dChon.nutCanhTrai, nutCanhTraiTat: dChon.nutCanhTraiTat, soCuoi: dCuoi.demChuaLuuSo };
      };

      /* — Lối 1: Ở LẠI (huỷ) — */
      const b1 = await dungBaThayDoi();
      r.dungLan1 = b1;
      r.anhBuffer = await anh(page, "T2-buffer-3-hang");
      const o1 = await doiO(page, "chon-tang", tangKhac);
      const dHt1 = await doc(page);
      r.anhHopThoai = await anh(page, "T2-hop-thoai");
      if (dHt1.hopThoai.co === 1) await page.locator('[data-testid="nut-huy-doi"]').click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="hop-thoai-chua-luu"]'), null, { timeout: 20_000 }).catch(() => {});
      const dSau1 = await doc(page);
      const chupSau1 = await chupHang(tang.tang_id);
      r.loiOLai = { ketCucDoiO: o1.ketCuc, hopThoaiHien: dHt1.hopThoai.co, demKhiHopThoai: dHt1.demChuaLuuSo,
        sauHuy: { hopThoai: dSau1.hopThoai.co, tang: dSau1.oTang ? dSau1.oTang.value : null, demChuaLuu: dSau1.demChuaLuuSo }, csdlKhac: soKhac(chupTruoc, chupSau1).so };

      /* — Lối 2: BỎ THAY ĐỔI — */
      const o2 = await doiO(page, "chon-tang", tangKhac);
      const dHt2 = await doc(page);
      if (dHt2.hopThoai.co === 1) await page.locator('[data-testid="nut-bo-thay-doi"]').click();
      await page.waitForFunction((t) => { const s = document.querySelector('[data-testid="chon-tang"]'); return !document.querySelector('[data-testid="hop-thoai-chua-luu"]') && s && s.value === String(t); }, tangKhac, { timeout: 30_000 }).catch(() => {});
      await choCanh(page, 0);
      const dSau2 = await doc(page);
      const chupSau2 = await chupHang(tang.tang_id);
      r.loiBo = { ketCucDoiO: o2.ketCuc, hopThoaiHien: dHt2.hopThoai.co, demKhiHopThoai: dHt2.demChuaLuuSo,
        sauBo: { hopThoai: dSau2.hopThoai.co, tang: dSau2.oTang ? dSau2.oTang.value : null, demChuaLuu: dSau2.demChuaLuuSo }, csdlKhac: soKhac(chupTruoc, chupSau2).so };
      r.anhSauBo = await anh(page, "T2-sau-bo-thay-doi");

      /* — Lối 3: LƯU RỒI CHUYỂN — */
      await doiO(page, "chon-tang", tang0);
      await choCanh(page, 0);
      await page.waitForFunction((n) => { const ds = window.__demTuongTac && window.__demTuongTac.dsMay ? window.__demTuongTac.dsMay() : null; return Array.isArray(ds) && ds.length === n; }, tang.n, { timeout: 60_000 }).catch(() => {});
      const b3 = await dungBaThayDoi();
      r.dungLan3 = b3;
      const chupTruocLuu = await chupHang(tang.tang_id);
      const o3 = await doiO(page, "chon-tang", tangKhac);
      const dHt3 = await doc(page);
      if (dHt3.hopThoai.co === 1) await page.locator('[data-testid="nut-luu-roi-doi"]').click();
      await page.waitForFunction((t) => { const s = document.querySelector('[data-testid="chon-tang"]'); return !document.querySelector('[data-testid="hop-thoai-chua-luu"]') && s && s.value === String(t); }, tangKhac, { timeout: 45_000 }).catch(() => {});
      await choCanh(page, 0);
      const dSau3 = await doc(page);
      r.anhSauLuu = await anh(page, "T2-sau-luu-roi-chuyen");
      const chupSauLuu = await chupHang(tang.tang_id);
      const khac = soKhac(chupTruocLuu, chupSauLuu);
      const hangGhi = chupSauLuu.filter((x) => khac.ds.some((k) => Number(k.id) === Number(x.id)));
      r.loiLuu = { ketCucDoiO: o3.ketCuc, hopThoaiHien: dHt3.hopThoai.co, demKhiHopThoai: dHt3.demChuaLuuSo,
        sauLuu: { hopThoai: dSau3.hopThoai.co, tang: dSau3.oTang ? dSau3.oTang.value : null, demChuaLuu: dSau3.demChuaLuuSo },
        soHangDaGhi: khac.so, chiTietGhi: khac.ds, tangIdCuaHangDaGhi: hangGhi.map((x) => Number(x.tangId)), tangCu: Number(tang0) };
      await ctx.close();

      const loaiThayDoi = new Set(khac.ds.flatMap((x) => x.cot).map((c) => (c === "daKhoa" ? "lat-khoa" : /^viTri/.test(c) ? "doi-vi-tri" : c)));
      r.thay = { loaiThayDoiDaGhi: [...loaiThayDoi] };
      Object.assign(r, phan(
        { "so thay doi buffer lan 1": b1.soCuoi, "so thay doi buffer lan 3": b3.soCuoi, "so hang da ghi o loi luu": r.loiLuu.soHangDaGhi },
        [
          { ten: "dung duoc buffer >= 3 hang", ok: (b1.soCuoi || 0) >= 3, thay: `lần 1 ${b1.soCuoi} (khoá ${b1.soSauKhoa} + căn ${(b1.soCuoi||0)-(b1.soSauKhoa||0)}) · lần 3 ${b3.soCuoi} · đã chọn ${JSON.stringify(b1.daChon)}` },
          { ten: "buffer mang HAI loai thay doi (doi vi tri + lat khoa)", ok: loaiThayDoi.has("doi-vi-tri") && loaiThayDoi.has("lat-khoa"), thay: JSON.stringify([...loaiThayDoi]) },
          { ten: "LOI 1 (o lai): hop thoai hien, tang CHUA doi, dem GIU, CSDL khong doi", ok: r.loiOLai.hopThoaiHien === 1 && String(r.loiOLai.sauHuy.tang) === String(tang0) && r.loiOLai.sauHuy.demChuaLuu === b1.soCuoi && r.loiOLai.csdlKhac === 0, thay: JSON.stringify(r.loiOLai) },
          { ten: "LOI 2 (bo thay doi): tang DOI, dem ve 0, CSDL khong doi", ok: String(r.loiBo.sauBo.tang) === String(tangKhac) && r.loiBo.sauBo.demChuaLuu === null && r.loiBo.csdlKhac === 0, thay: JSON.stringify(r.loiBo) },
          { ten: "LOI 3 (luu roi chuyen): tang DOI va dem ve 0", ok: String(r.loiLuu.sauLuu.tang) === String(tangKhac) && r.loiLuu.sauLuu.demChuaLuu === null, thay: JSON.stringify(r.loiLuu.sauLuu) },
          { ten: "LOI 3: CA BA hang duoc ghi", ok: r.loiLuu.soHangDaGhi === (b3.soCuoi || 0) && r.loiLuu.soHangDaGhi >= 3, thay: `${r.loiLuu.soHangDaGhi} hàng ghi / ${b3.soCuoi} hàng buffer · ${JSON.stringify(r.loiLuu.chiTietGhi)}` },
          { ten: "LOI 3: moi hang da ghi deu mang MA TANG CU", ok: r.loiLuu.tangIdCuaHangDaGhi.length > 0 && r.loiLuu.tangIdCuaHangDaGhi.every((x) => x === Number(tang0)), thay: `${JSON.stringify(r.loiLuu.tangIdCuaHangDaGhi)} vs tầng cũ ${tang0}` },
        ]));
    } catch (e) { r.pq = "HỎNG"; r.vi = `lỗi khi đo: ${String(e.message).slice(0, 400)}`; }
    finally {
      if (chupTruoc) { const n = await khoiPhuc(chupTruoc); const sau = await chupHang(tang.tang_id); r.don = { khoiPhuc: n, conKhac: soKhac(chupTruoc, sau).so }; r.donSach = r.don.conKhac === 0; console.log(`  DỌN T2: khôi phục ${n} hàng · còn khác ${r.don.conKhac} · sạch=${r.donSach}`); }
      KQ.T2 = r; bao("T2", r.pq, r.vi); luu("T2", r);
    }
  }
} finally { await browser.close(); await sql.end(); }
console.log("\n=== TOM TAT T ===");
for (const [k, v] of Object.entries(KQ)) console.log(` ${k}: ${v.pq}`);
