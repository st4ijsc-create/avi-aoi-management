/**
 * t21-do.mjs — ĐO KẾT CỤC **PH-46 + PH-47** trên trình duyệt THẬT.
 *
 *   node .qa-tapdoan/t21-do.mjs <nhan>      # nhan = "truoc" | "sau" | ...
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THƯỚC ĐƯỢC KHAI **TRƯỚC KHI ĐO** (luật 5 của chủ đợt: không đổi thước sau khi
 * thấy đỏ). Năm ô, đo đúng thứ chúng nói:
 *
 *  ① mỗi biểu tượng toà ≥ 24 px bề rộng · toàn bộ sa bàn trong khung canvas
 *  ② quan hệ: 12 biểu tượng · 1 cụm = 1 nhà máy · toà × toà KHÁC công ty = 0
 *     (thước Task 20, GIỮ NGUYÊN — gom theo `factoryId` từ `sinh-summary.json`)
 *  ③ ngân sách vẽ: lệnh < 150 · tam giác < 500 k · nhãn < 30 · ≥ 30 khung/s
 *  ④ ★ MỚI — **cả 3 tên công ty đọc được**: phần tử `nhan-cum-sa-ban` có
 *     `display ≠ none` VÀ diện tích bị lớp phủ `[data-che-nhan]` phủ = 0 %.
 *  ⑤ ★ MỚI — **bề rộng sa bàn ≥ 60 % bề rộng vùng canvas KHÔNG BỊ CHE**.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⑤ ĐỊNH NGHĨA CHÍNH XÁC (khai trước, không sửa sau):
 *   · `cotBiChe[x]` = cột pixel x của canvas bị MỘT lớp phủ `[data-che-nhan]`
 *     phủ KÍN theo chiều dọc (0 → cao). Hai panel bên là như vậy; thẻ Metrics
 *     thì KHÔNG (nó chỉ phủ một dải giữa chừng).
 *   · `beRongVungDung` = dải cột LIÊN TỤC DÀI NHẤT không bị che kín. Ở khung
 *     mặc định 1280×720 đây là khoảng giữa hai panel.
 *   · `cotSaBanThay` = số cột x mà sa bàn có ÍT NHẤT MỘT pixel NHÌN THẤY ĐƯỢC
 *     (nằm trong bao hình một biểu tượng, và KHÔNG bị lớp phủ nào đè). Phần sa
 *     bàn nằm dưới thẻ DOM **không được tính** — đúng câu "vùng bị thẻ DOM phủ
 *     không tính là chỗ dùng được".
 *   · `tiLeDung` = `cotSaBanThay / beRongVungDung`.  NGƯỠNG ≥ 0,60.
 *   · In kèm `tiLeThoCanvas` = bề rộng bao hình sa bàn / bề rộng canvas THÔ —
 *     con số 35 % mà chủ đợt trích, để hai thước so được với nhau.
 *
 * ⚠ Bao hình biểu tượng là HỘP TRỤC-SONG-SONG của một khối 3D (bao rộng hơn
 *   bóng thật). Xấp xỉ này áp DƯỚI CÙNG MỘT CÁCH cho trước và sau.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ĐO Ở **HAI TRẠNG THÁI PANEL** (chủ đợt đòi, vì một khoảng bù cố định sẽ đúng ở
 * trạng thái này và sai ở trạng thái kia):
 *   · `macDinh`  — khung MẶC ĐỊNH, không thu gì. ĐÂY là khung nghiệm thu.
 *   · `thuPanel` — `?thu=trai,phai,kpi`. Ảnh PHỤ, và là phép thử tính bền.
 *
 * ⚠ `__demSaBan` chỉ gắn ở CHẾ ĐỘ ĐO ⇒ mọi URL mang `?do=1`.
 * ⚠ Khung hình đo trên ANGLE+GPU (Playwright mặc định SwiftShader ⇒ fps giả).
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "truoc";
const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const RA = `.qa-tapdoan/t21-${NHAN}.json`;
const ANH = `.qa-tapdoan/anh/t21-${NHAN}`;
fs.mkdirSync(ANH, { recursive: true });

const TT = JSON.parse(fs.readFileSync(".qa-tapdoan/sinh-summary.json", "utf8"));
const NHA_MAY = new Map(TT.congTys.map((c) => [c.id, c.code]));

const TRAN = { calls: 150, triangles: 500_000, nhan: 30, fps: 30, rongPx: 24, tiLeDung: 0.6 };

const VAI = [
  { ten: "qatd_giamdoc", moTa: "cap tap doan (gan TD QATD) - 3 cong ty" },
  { ten: "qatd_quanly", moTa: "chi gan QATD-A - 1 cong ty" },
];

const ketQua = { nhan: NHAN, luc: new Date().toISOString(), tran: TRAN, vai: {} };

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});

/** Đợi sa bàn + camera đứng yên: hai lượt đọc liên tiếp cùng bao hình. */
async function doiOnDinh(page, khoa) {
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  await page
    .waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, undefined, { timeout: 120_000 })
    .catch(() => {});
  await page
    .waitForFunction(
      (k) => {
        const ds = window.__demSaBan?.bieuTuong?.() ?? [];
        const s = ds
          .map((b) => `${b.toaNhaId}:${Math.round(b.hop.trai)}:${Math.round(b.hop.phai)}`)
          .join(",");
        const w = window;
        const on = w[k] === s && ds.length > 0;
        w[k] = s;
        return on;
      },
      khoa,
      { timeout: 120_000, polling: 1200 },
    )
    .catch(() => {});
}

/** Toàn bộ phép đo hình học trong MỘT lượt `evaluate` (một khung, không lệch pha). */
const DOC_TRANG = () => {
  const canvas = document.querySelector("canvas");
  const cv = canvas?.getBoundingClientRect();
  if (!cv) return null;
  const W = Math.round(cv.width);
  const H = Math.round(cv.height);

  // ── Lớp phủ DOM tự khai (cùng nguồn `layVungCam` mà lớp nhãn dùng) ────────
  const phu = [];
  for (const el of document.querySelectorAll("[data-che-nhan]")) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const h = {
      testid: el.getAttribute("data-testid") ?? el.tagName.toLowerCase(),
      trai: r.left - cv.left,
      phai: r.right - cv.left,
      tren: r.top - cv.top,
      duoi: r.bottom - cv.top,
    };
    if (h.phai <= 0 || h.duoi <= 0 || h.trai >= W || h.tren >= H) continue;
    phu.push({
      ...h,
      trai: Math.max(0, Math.round(h.trai)),
      phai: Math.min(W, Math.round(h.phai)),
      tren: Math.max(0, Math.round(h.tren)),
      duoi: Math.min(H, Math.round(h.duoi)),
    });
  }

  const biChe = (x, y) =>
    phu.some((z) => x >= z.trai && x < z.phai && y >= z.tren && y < z.duoi);

  // ── ⑤a cột bị che KÍN theo chiều dọc ⇒ dải dùng được dài nhất ────────────
  const cotKin = new Array(W).fill(false);
  for (let x = 0; x < W; x += 1) {
    cotKin[x] = phu.some((z) => x >= z.trai && x < z.phai && z.tren <= 0 && z.duoi >= H);
  }
  let beRongVungDung = 0;
  let dungTu = 0;
  let dungDen = 0;
  let run = 0;
  for (let x = 0; x <= W; x += 1) {
    if (x < W && !cotKin[x]) run += 1;
    else {
      if (run > beRongVungDung) {
        beRongVungDung = run;
        dungTu = x - run;
        dungDen = x;
      }
      run = 0;
    }
  }

  // ── Biểu tượng toà ────────────────────────────────────────────────────────
  const bt = (window.__demSaBan?.bieuTuong?.() ?? []).map((x) => ({
    toaNhaId: x.toaNhaId,
    factoryId: x.factoryId,
    chiSoCum: x.chiSoCum,
    rongPx: Math.round(x.rongPx * 10) / 10,
    caoPx: Math.round(x.caoPx * 10) / 10,
    hop: {
      trai: Math.round(x.hop.trai),
      phai: Math.round(x.hop.phai),
      tren: Math.round(x.hop.tren),
      duoi: Math.round(x.hop.duoi),
    },
    trongKhung: x.trongKhung,
  }));

  // ── ⑤b cột sa bàn THẤY ĐƯỢC (bước 2 px cho nhanh, cùng bước ở mọi lượt) ──
  let cotSaBanThay = 0;
  let cotSaBanTong = 0;
  for (let x = 0; x < W; x += 1) {
    const o = bt.filter((b) => x >= b.hop.trai && x < b.hop.phai);
    if (o.length === 0) continue;
    cotSaBanTong += 1;
    let thay = false;
    for (const b of o) {
      for (let y = Math.max(0, b.hop.tren); y < Math.min(H, b.hop.duoi); y += 2) {
        if (!biChe(x, y)) {
          thay = true;
          break;
        }
      }
      if (thay) break;
    }
    if (thay) cotSaBanThay += 1;
  }

  // ── ④ ba nhãn cụm (tên công ty) ───────────────────────────────────────────
  const nhanCum = [...document.querySelectorAll("[data-testid='nhan-cum-sa-ban']")].map((el) => {
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const h = { trai: r.left - cv.left, phai: r.right - cv.left, tren: r.top - cv.top, duoi: r.bottom - cv.top };
    const dt = Math.max(0, h.phai - h.trai) * Math.max(0, h.duoi - h.tren);
    let cheDt = 0;
    for (const z of phu) {
      const w = Math.max(0, Math.min(h.phai, z.phai) - Math.max(h.trai, z.trai));
      const hh = Math.max(0, Math.min(h.duoi, z.duoi) - Math.max(h.tren, z.tren));
      cheDt = Math.max(cheDt, w * hh);
    }
    const trongCanvas = h.trai >= 0 && h.tren >= 0 && h.phai <= cv.width && h.duoi <= cv.height;
    return {
      factoryId: Number(el.getAttribute("data-factory-id")),
      chu: (el.textContent ?? "").trim(),
      display: st.display,
      hien: st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity) > 0.01,
      hop: { trai: Math.round(h.trai), phai: Math.round(h.phai), tren: Math.round(h.tren), duoi: Math.round(h.duoi) },
      tiLeChe: dt > 0 ? Math.round((cheDt / dt) * 1000) / 1000 : 1,
      trongCanvas,
    };
  });

  const nhanToaHien = [...document.querySelectorAll("[data-testid='nhan-toa-sa-ban']")].filter(
    (e) => getComputedStyle(e).display !== "none",
  ).length;
  const nhanToaTong = document.querySelectorAll("[data-testid='nhan-toa-sa-ban']").length;

  const q = (id) => document.querySelector(`[data-testid='${id}']`);
  return {
    canvas: { w: W, h: H },
    lopPhu: phu,
    beRongVungDung,
    vungDung: { tu: dungTu, den: dungDen },
    bieuTuong: bt,
    cotSaBanThay,
    cotSaBanTong,
    nhanCum,
    nhanToa: { hien: nhanToaHien, tong: nhanToaTong },
    soNhanSaBan: window.__demSaBan?.soNhan?.() ?? null,
    soNhanDomTong: nhanToaTong + nhanCum.length,
    soMayVe: window.__demTuongTac?.dsMay?.()?.length ?? -1,
    thongKe: window.__thongKeVe ?? null,
    demMay: q("dem-may")?.textContent?.trim() ?? null,
    breadcrumb: q("breadcrumb-twin")?.textContent?.trim() ?? null,
    chuaChoDai: q("khung-neo-lop-phu")?.getAttribute("data-chua-cho-dai") ?? null,
  };
};

/** Gộp các phép suy luận NGOÀI trang (giữ `evaluate` thuần hình học). */
function suyRa(doc) {
  const theoNhaMay = {};
  for (const x of doc.bieuTuong) {
    const ma = NHA_MAY.get(x.factoryId) ?? `ngoai-QATD(${x.factoryId})`;
    (theoNhaMay[ma] ??= { soToa: 0, chiSoCum: new Set(), rongPx: [], hop: null });
    const o = theoNhaMay[ma];
    o.soToa += 1;
    o.chiSoCum.add(x.chiSoCum);
    o.rongPx.push(x.rongPx);
    o.hop = o.hop
      ? {
          trai: Math.min(o.hop.trai, x.hop.trai),
          phai: Math.max(o.hop.phai, x.hop.phai),
          tren: Math.min(o.hop.tren, x.hop.tren),
          duoi: Math.max(o.hop.duoi, x.hop.duoi),
        }
      : { ...x.hop };
  }
  const ten = Object.keys(theoNhaMay).sort();
  const cumLan = ten.filter((k) => theoNhaMay[k].chiSoCum.size !== 1);

  // ② thước Task 20 GIỮ NGUYÊN: toà × toà KHÁC công ty = 0.
  let capToaChongKhacNhaMay = 0;
  const capToaChongTen = [];
  for (let i = 0; i < doc.bieuTuong.length; i += 1) {
    for (let j = i + 1; j < doc.bieuTuong.length; j += 1) {
      const a = doc.bieuTuong[i];
      const b = doc.bieuTuong[j];
      if (a.factoryId === b.factoryId) continue;
      if (a.hop.trai < b.hop.phai && b.hop.trai < a.hop.phai && a.hop.tren < b.hop.duoi && b.hop.tren < a.hop.duoi) {
        capToaChongKhacNhaMay += 1;
        capToaChongTen.push(`${a.toaNhaId}×${b.toaNhaId}`);
      }
    }
  }
  // Bao hình cụm (thước CŨ, in ra để người đọc tự kiểm — không dùng để phán).
  let capBaoHinhCumChong = 0;
  for (let i = 0; i < ten.length; i += 1) {
    for (let j = i + 1; j < ten.length; j += 1) {
      const a = theoNhaMay[ten[i]].hop;
      const b = theoNhaMay[ten[j]].hop;
      if (a.trai < b.phai && b.trai < a.phai && a.tren < b.duoi && b.tren < a.duoi) capBaoHinhCumChong += 1;
    }
  }

  const rongs = doc.bieuTuong.map((x) => x.rongPx);
  const cv = doc.canvas;
  const ngoaiKhung = doc.bieuTuong.filter(
    (x) => x.hop.trai < 0 || x.hop.tren < 0 || x.hop.phai > cv.w || x.hop.duoi > cv.h,
  );
  const baoTrai = rongs.length ? Math.min(...doc.bieuTuong.map((x) => x.hop.trai)) : 0;
  const baoPhai = rongs.length ? Math.max(...doc.bieuTuong.map((x) => x.hop.phai)) : 0;

  return {
    theoNhaMay: Object.fromEntries(
      ten.map((k) => [
        k,
        {
          soToa: theoNhaMay[k].soToa,
          chiSoCum: [...theoNhaMay[k].chiSoCum],
          rongPxMin: Math.min(...theoNhaMay[k].rongPx),
          hop: theoNhaMay[k].hop,
        },
      ]),
    ),
    soCum: new Set(doc.bieuTuong.map((x) => x.chiSoCum)).size,
    nhaMayLanCum: cumLan,
    capToaChongKhacNhaMay,
    capToaChongTen,
    capBaoHinhCumChong,
    rongPxMin: rongs.length ? Math.min(...rongs) : null,
    rongPxMax: rongs.length ? Math.max(...rongs) : null,
    soToaDuoiTran: rongs.filter((x) => x < TRAN.rongPx).length,
    soNgoaiKhung: ngoaiKhung.length,
    ngoaiKhung: ngoaiKhung.map((x) => ({ toaNhaId: x.toaNhaId, hop: x.hop })),
    baoSaBan: { trai: baoTrai, phai: baoPhai, rong: baoPhai - baoTrai },
    tiLeDung: doc.beRongVungDung > 0 ? Math.round((doc.cotSaBanThay / doc.beRongVungDung) * 1000) / 1000 : 0,
    tiLeThoCanvas: cv.w > 0 ? Math.round(((baoPhai - baoTrai) / cv.w) * 1000) / 1000 : 0,
  };
}

for (const v of VAI) {
  ketQua.vai[v.ten] = { moTa: v.moTa, trangThai: {} };
  const loi = [];

  for (const tt of [
    { ten: "macDinh", url: `${GOC}/twin?pv=tapdoan&do=1`, anhSo: "2" },
    { ten: "thuPanel", url: `${GOC}/twin?pv=tapdoan&do=1&thu=trai,phai,kpi`, anhSo: "3" },
  ]) {
    const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => loi.push(`[${tt.ten}] ${String(e).slice(0, 200)}`));

    const dn = await page.request.post(`${GOC}/api/auth/login`, {
      data: { username: v.ten, password: MK },
    });
    if (!dn.ok()) {
      ketQua.vai[v.ten].trangThai[tt.ten] = { LOI: `dang nhap that bai ${dn.status()}` };
      await ctx.close();
      continue;
    }
    await page.goto(tt.url, { waitUntil: "domcontentloaded" });
    await doiOnDinh(page, `__t21_${tt.ten}`);

    // Ảnh SẠCH trước khi chạm chuột vào bất cứ đâu.
    if (tt.ten === "macDinh") await page.screenshot({ path: `${ANH}/${v.ten}-1-toan-man.png` });
    const oCanh = await page.$("canvas");
    if (oCanh)
      await oCanh
        .screenshot({
          path: `${ANH}/${v.ten}-${tt.anhSo}-canvas${tt.ten === "thuPanel" ? "-thu-panel" : ""}.png`,
        })
        .catch(() => {});

    const doc = await page.evaluate(DOC_TRANG);
    const r = doc ? suyRa(doc) : null;

    // ── ③ ngân sách khi ĐANG XOAY (chỉ ở khung mặc định — đủ một lần) ───────
    let xoay = null;
    if (tt.ten === "macDinh") {
      const c = await page.$("canvas");
      const box = c ? await c.boundingBox() : null;
      if (box) {
        await page.evaluate(() => {
          window.__t21_khung = 0;
          const dem = () => {
            window.__t21_khung += 1;
            window.__t21_raf = requestAnimationFrame(dem);
          };
          window.__t21_raf = requestAnimationFrame(dem);
          window.__t21_t0 = performance.now();
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
        xoay = await page.evaluate(() => {
          const ms = performance.now() - window.__t21_t0;
          cancelAnimationFrame(window.__t21_raf);
          return {
            khung: window.__t21_khung,
            ms: Math.round(ms),
            fps: Math.round((window.__t21_khung / ms) * 1000),
            thongKe: window.__thongKeVe ?? null,
            soBieuTuong: window.__demSaBan?.bieuTuong?.()?.length ?? -1,
          };
        });
      }
    }

    const nhanDocDuoc = (doc?.nhanCum ?? []).filter((n) => n.hien && n.tiLeChe === 0 && n.trongCanvas);
    const o = {
      canvas: doc?.canvas ?? null,
      chuaChoDai: doc?.chuaChoDai ?? null,
      lopPhu: doc?.lopPhu ?? [],
      beRongVungDung: doc?.beRongVungDung ?? 0,
      vungDung: doc?.vungDung ?? null,
      soBieuTuong: doc?.bieuTuong?.length ?? 0,
      cotSaBanThay: doc?.cotSaBanThay ?? 0,
      cotSaBanTong: doc?.cotSaBanTong ?? 0,
      nhanCum: doc?.nhanCum ?? [],
      soNhanCumDocDuoc: nhanDocDuoc.length,
      nhanToa: doc?.nhanToa ?? null,
      soNhanDomTong: doc?.soNhanDomTong ?? 0,
      soNhanSaBan: doc?.soNhanSaBan ?? null,
      soMayVe: doc?.soMayVe ?? -1,
      demMay: doc?.demMay ?? null,
      breadcrumb: doc?.breadcrumb ?? null,
      thongKe: doc?.thongKe ?? null,
      bieuTuong: doc?.bieuTuong ?? [],
      ...(r ?? {}),
      xoay,
    };
    const soCongTy = new Set((doc?.bieuTuong ?? []).map((b) => b.factoryId)).size;
    o.soCongTy = soCongTy;
    o.DAT = {
      "①a moi bieu tuong >= 24px": o.soToaDuoiTran === 0 && o.soBieuTuong > 0,
      "①b toan bo sa ban trong khung": o.soNgoaiKhung === 0 && o.soBieuTuong > 0,
      "② quan he dung": (o.nhaMayLanCum?.length ?? 1) === 0 && o.capToaChongKhacNhaMay === 0 && o.soBieuTuong > 0,
      "④ moi ten cong ty doc duoc": soCongTy > 0 && o.soNhanCumDocDuoc === soCongTy,
      "⑤ sa ban >= 60% vung canvas khong bi che": o.tiLeDung >= TRAN.tiLeDung,
    };
    if (tt.ten === "macDinh") {
      o.DAT["③ ngan sach ve"] =
        (xoay?.thongKe?.calls ?? 1e9) < TRAN.calls &&
        (xoay?.thongKe?.triangles ?? 1e9) < TRAN.triangles &&
        o.soNhanDomTong < TRAN.nhan &&
        (xoay?.fps ?? 0) >= TRAN.fps;
    }
    ketQua.vai[v.ten].trangThai[tt.ten] = o;

    console.log(
      `[${NHAN}] ${v.ten} · ${tt.ten.padEnd(8)} canvas=${o.canvas?.w}×${o.canvas?.h}` +
        ` bt=${o.soBieuTuong} rong=${o.rongPxMin}..${o.rongPxMax}` +
        ` vungDung=${o.beRongVungDung}px[${o.vungDung?.tu}..${o.vungDung?.den}]` +
        ` saBanThay=${o.cotSaBanThay}/${o.cotSaBanTong} tiLeDung=${(o.tiLeDung * 100).toFixed(1)}%` +
        ` tho=${(o.tiLeThoCanvas * 100).toFixed(1)}%` +
        ` tenCty=${o.soNhanCumDocDuoc}/${soCongTy} toaChong=${o.capToaChongKhacNhaMay}` +
        ` nhan=${o.nhanToa?.hien}/${o.soNhanDomTong} fps=${xoay?.fps ?? "-"}`,
    );
    console.log(`         DAT: ${JSON.stringify(o.DAT)}`);
    console.log(
      `         lopPhu: ${o.lopPhu.map((z) => `${z.testid}[${z.trai},${z.tren}→${z.phai},${z.duoi}]`).join(" ")}`,
    );
    await ctx.close();
  }
  ketQua.vai[v.ten].loi = loi;
}

await trinh.close();
fs.writeFileSync(RA, JSON.stringify(ketQua, null, 1));
console.log(`\n→ ${RA}  ·  ảnh: ${ANH}`);
