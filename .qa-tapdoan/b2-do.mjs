/**
 * b2-do.mjs — NGHIỆM THU "HAI CHIỀU": ô 2D và ô 3D ở cấp tập đoàn.
 *
 *   node .qa-tapdoan/b2-do.mjs <nhan>       # "truoc" | "sau"
 *
 * Tiêu chí của chủ đợt, ở 1280×720, khung MẶC ĐỊNH, KHÔNG thu panel:
 *   ① Đổi 2D↔3D không gặp thứ gì không giải thích được ⇒ hai chế độ khai CÙNG
 *      một đơn vị vẽ (`data-don-vi-ve`), và `aria-label` + banner nói đúng nó.
 *   ② Mỗi biểu tượng ≥ 24 px · 3 tên công ty ĐỌC ĐƯỢC · quan hệ đúng
 *      (3 cụm × 4 toà, mỗi cụm đúng một công ty).
 *   ④ Ngân sách vẽ — đo ở `t20-do.mjs` cho bản 3D (WebGL); bản 2D là SVG nên đo
 *      SỐ NÚT DOM và số nhãn thay cho lệnh vẽ/tam giác.
 *
 * ★★★ BA CHỖ CHỐNG TỰ THOẢ
 *  (a) **KHÔNG gom cụm theo khe hở trên màn.** Quan hệ toà↔công ty đọc từ
 *      `sinh-summary.json` (`toas[].id → factoryId`, dải mã của BỘ SINH) rồi đối
 *      chiếu với `data-factory-id` trên từng `<rect>`. Task 19 gom theo khe hở
 *      và khai "2 cụm" cho một cảnh có ba khối.
 *  (b) **"Đọc được" ≠ "có trong DOM".** Mỗi nhãn được kiểm bằng
 *      `document.elementFromPoint()` tại TÂM chữ: panel `z-30` (bảng Metrics,
 *      hai panel bên) nổi TRÊN cảnh và nuốt nhãn mà không lưới nào đỏ — G41, lớp
 *      lỗi đã cắn đợt này hai lần.
 *  (c) **Kích thước đo bằng `getBoundingClientRect` của chính `<rect>`**, không
 *      suy từ toạ độ mô hình. Task 19 khai "3 khối" từ toạ độ chiếu trong khi
 *      ảnh vẫn đen.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "sau";
const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const RA = `.qa-tapdoan/b2-${NHAN}.json`;
const ANH = `.qa-tapdoan/anh/b2-${NHAN}`;
fs.mkdirSync(ANH, { recursive: true });

const TT = JSON.parse(fs.readFileSync(".qa-tapdoan/sinh-summary.json", "utf8"));
/** Nguồn ĐỘC LẬP với màn: dải mã của bộ sinh. */
const MA_NHA_MAY = new Map(TT.congTys.map((c) => [c.id, c.code]));
const TEN_NHA_MAY = new Map(TT.congTys.map((c) => [c.id, c.ten]));
const TOA_THUOC = new Map(TT.toas.map((b) => [b.id, { factoryId: b.factoryId, ma: b.ma }]));
console.log(
  "bộ sinh:",
  [...MA_NHA_MAY].map(([id, m]) => `${m}=${id}`).join(" · "),
  "· toà:",
  TT.toas.length,
);

const TRAN = { rongPx: 24, nhan: 30 };

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const kq = { nhan: NHAN, luc: new Date().toISOString(), tran: TRAN, vai: {} };

for (const vai of ["qatd_giamdoc", "qatd_quanly"]) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const loi = [];
  page.on("pageerror", (e) => loi.push(String(e).slice(0, 200)));
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: MK } });
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  await page
    .waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, undefined, { timeout: 120_000 })
    .catch(() => {});
  await page
    .waitForFunction(
      () => {
        const ds = window.__demSaBan?.bieuTuong?.() ?? [];
        const khoa = ds.map((b) => `${b.toaNhaId}:${Math.round(b.rongPx)}`).join(",");
        const on = window.__b2 === khoa && ds.length > 0;
        window.__b2 = khoa;
        return on;
      },
      undefined,
      { timeout: 120_000, polling: 1200 },
    )
    .catch(() => {});

  // ── Dải hợp nhất mở MỘT LẦN (banner nằm sau nó). Đọc trạng thái, không bấm mù.
  const moDai = async () => {
    const co = await page.evaluate(
      () => document.querySelectorAll("[data-testid^='banner-']").length,
    );
    if (co === 0) {
      await page.getByTestId("nut-mo-dai-hop-nhat").click({ timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  };

  const docChung = () =>
    page.evaluate(() => {
      const q = (id) => document.querySelector(`[data-testid='${id}']`);
      const b = q("banner-vi-tri-tam-sinh");
      const svg = q("canh-van-hanh-2d");
      const canvas = document.querySelector("canvas");
      const khungAria = svg ?? canvas?.closest("[aria-label]") ?? canvas?.parentElement;
      return {
        donViVe: svg?.getAttribute("data-don-vi-ve") ?? (canvas ? "(3D: canvas)" : null),
        aria:
          svg?.getAttribute("aria-label") ??
          (() => {
            let e = canvas;
            while (e && !e.getAttribute?.("aria-label")) e = e.parentElement;
            return e?.getAttribute("aria-label") ?? null;
          })(),
        ariaChu: khungAria ? undefined : undefined,
        banner: b ? b.textContent.trim().replace(/\s+/g, " ").slice(0, 300) : null,
        bannerSoToa: b?.getAttribute("data-so-toa") ?? null,
        bannerSoKhoi: b?.getAttribute("data-so-khoi") ?? null,
        demMay: q("dem-may")?.textContent?.trim() ?? null,
        thongKe: window.__thongKeVe ?? null,
      };
    });

  await moDai();
  const chung3d = await docChung();
  const sb3d = await page.evaluate(() => {
    const bt = window.__demSaBan?.bieuTuong?.() ?? [];
    return {
      soBieuTuong: bt.length,
      rongPx: bt.map((x) => Math.round(x.rongPx * 10) / 10),
      soNhanDom: document.querySelectorAll(
        "[data-testid='nhan-toa-sa-ban'],[data-testid='nhan-cum-sa-ban']",
      ).length,
    };
  });
  const c3 = await page.$("canvas");
  if (c3) await c3.screenshot({ path: `${ANH}/${vai}-3d-canvas.png` }).catch(() => {});

  /*
   * ⚠ ĐÓNG dải lại TRƯỚC khi sang 2D. Trạng thái mở SỐNG QUA lần đổi chế độ, nên
   *   nếu để mở thì phép đo "nhãn có bị che không" ở 2D lại chạy trên khung có
   *   thêm một lớp phủ — đúng lỗi mà bản đầu của tệp này đã mắc.
   */
  const dongDai = async () => {
    const co = await page.evaluate(
      () => document.querySelectorAll("[data-testid^='banner-']").length,
    );
    if (co > 0) {
      await page.getByTestId("nut-mo-dai-hop-nhat").click({ timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  };
  await dongDai();

  // ══ SANG 2D ══════════════════════════════════════════════════════════════
  await page.getByTestId("nut-che-2d").click({ timeout: 15_000 });
  await page.getByTestId("canh-van-hanh-2d").waitFor({ timeout: 30_000 });
  await page
    .waitForFunction(
      () => {
        const n = document.querySelectorAll(
          "[data-testid='toa-2d-sa-ban'],[data-testid^='may-2d-']",
        ).length;
        const on = window.__b2b === n && n > 0;
        window.__b2b = n;
        return on;
      },
      undefined,
      { timeout: 60_000, polling: 800 },
    )
    .catch(() => {});
  await page.waitForTimeout(600);

  await page.screenshot({ path: `${ANH}/${vai}-2d-toan-man.png` });
  const osvg = await page.$("[data-testid='canh-van-hanh-2d']");
  if (osvg) await osvg.screenshot({ path: `${ANH}/${vai}-2d-svg.png` }).catch(() => {});

  /*
   * ⚠⚠ SỬA THIẾT BỊ ĐO — IN CẢ SỐ CŨ LẪN SỐ MỚI, KHÔNG ÂM THẦM ĐỔI THƯỚC.
   *
   * Bản đầu của tệp này gọi `moDai()` (bấm `nut-mo-dai-hop-nhat`) TRƯỚC khi đo
   * nhãn. Dải hợp nhất mở ra là một lớp phủ `absolute` NẰM TRÊN cảnh, nên phép
   * đo "nhãn có bị che không" chạy trên một khung KHÔNG PHẢI khung mặc định —
   * và chính lớp phủ do thiết bị đo bật lên là thứ che nhãn.
   *   Số CŨ (sai khung): giám đốc 1/3 nhãn cụm đọc được ("Công ty A ← SPAN",
   *                      "Công ty B ← SPAN"); quản lý 0/1.
   *   Chẩn đoán độc lập (`b2-che.mjs`, KHÔNG mở dải): cả ba nhãn nhận cú chạm
   *                      vào `<rect>` NẰM TRONG `<svg>` ⇒ không lớp phủ nào che.
   *
   * ⇒ Nay đo nhãn ở KHUNG MẶC ĐỊNH (chưa bấm gì), rồi MỚI mở dải để đọc banner.
   *   Tiêu chí của chủ đợt nói rõ "khung MẶC ĐỊNH, không thu panel" — mở thêm
   *   một lớp phủ là đo một khung khác.
   */
  const d2 = await page.evaluate(() => {
    const svg = document.querySelector("[data-testid='canh-van-hanh-2d']");
    const rs = svg.getBoundingClientRect();
    const hop = (el) => {
      const r = el.getBoundingClientRect();
      return {
        trai: r.x,
        tren: r.y,
        phai: r.x + r.width,
        duoi: r.y + r.height,
        w: r.width,
        h: r.height,
      };
    };
    /** Nhãn ĐỌC ĐƯỢC = tâm chữ thật sự nhận được cú chạm (không bị lớp phủ nuốt). */
    const khongBiChe = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { ok: false, keChe: "cỡ 0" };
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight)
        return { ok: false, keChe: "ngoài viewport" };
      const tren = document.elementFromPoint(x, y);
      if (tren === null) return { ok: false, keChe: "không phần tử nào" };
      // Chữ SVG có `pointer-events:none` ⇒ cú chạm rơi xuống <svg>. Đó VẪN là
      // "không bị che": thứ nằm trên nó là chính cảnh, không phải panel.
      const trongCanh = tren === svg || svg.contains(tren);
      return {
        ok: trongCanh,
        keChe: trongCanh
          ? null
          : `${tren.tagName}${tren.getAttribute?.("data-testid") ? "#" + tren.getAttribute("data-testid") : ""}`,
      };
    };
    const toa = [...svg.querySelectorAll("[data-testid='toa-2d-sa-ban']")].map((e) => ({
      toaNhaId: Number(e.getAttribute("data-toa-nha-id")),
      factoryId: Number(e.getAttribute("data-factory-id")),
      chiSoCum: Number(e.getAttribute("data-chi-so-cum")),
      hop: hop(e),
    }));
    const nhanCum = [...svg.querySelectorAll("[data-testid='nhan-cum-sa-ban-2d']")].map((e) => ({
      factoryId: Number(e.getAttribute("data-factory-id")),
      chu: e.textContent.trim(),
      hop: hop(e),
      doc: khongBiChe(e),
    }));
    const nhanToa = [...svg.querySelectorAll("[data-testid='nhan-toa-sa-ban-2d']")].map((e) => ({
      toaNhaId: Number(e.getAttribute("data-toa-nha-id")),
      chu: e.textContent.trim(),
      hop: hop(e),
      doc: khongBiChe(e),
    }));
    return {
      hopSvg: { x: rs.x, y: rs.y, w: rs.width, h: rs.height },
      viewBox: svg.getAttribute("viewBox"),
      soMay2D: document.querySelectorAll("[data-testid^='may-2d-']").length,
      soNutSvg: svg.querySelectorAll("*").length,
      toa,
      nhanCum,
      nhanToa,
      lopSaBan: (() => {
        const l = svg.querySelector("[data-testid='lop-sa-ban-2d']");
        return l ? { soToa: l.getAttribute("data-so-toa"), soCum: l.getAttribute("data-so-cum") } : null;
      })(),
    };
  });

  /*
   * Banner đọc SAU khi đã đo nhãn: mở dải là đổi khung, nên nó phải đứng sau mọi
   * phép đo hình học/đọc-được. `docChung()` chạy hai lần cho thấy đúng điều đó.
   */
  const chung2dMacDinh = await docChung();
  await moDai();
  const chung2d = await docChung();
  /** ⚠ SỐ CŨ của thiết bị đo hỏng: đọc-được khi dải hợp nhất ĐANG MỞ. */
  const nhanCumKhiMoDai = await page.evaluate(() => {
    const svg = document.querySelector("[data-testid='canh-van-hanh-2d']");
    return [...svg.querySelectorAll("[data-testid='nhan-cum-sa-ban-2d']")].map((e) => {
      const r = e.getBoundingClientRect();
      const tren = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { chu: e.textContent.trim(), trongCanh: tren === svg || svg.contains(tren) };
    });
  });

  // ── ② Quan hệ: đối chiếu với DẢI MÃ CỦA BỘ SINH, không với khe hở trên màn.
  const saiThuocNhaMay = [];
  for (const v of d2.toa) {
    const that = TOA_THUOC.get(v.toaNhaId);
    if (!that) saiThuocNhaMay.push(`toà ${v.toaNhaId} KHÔNG có trong bộ sinh`);
    else if (that.factoryId !== v.factoryId)
      saiThuocNhaMay.push(`toà ${v.toaNhaId} (${that.ma}) màn khai NM ${v.factoryId}, bộ sinh ${that.factoryId}`);
  }
  const theoNM = {};
  for (const v of d2.toa) {
    const ma = MA_NHA_MAY.get(v.factoryId) ?? `ngoài-QATD(${v.factoryId})`;
    (theoNM[ma] ??= { soToa: 0, cum: new Set(), rong: [] });
    theoNM[ma].soToa += 1;
    theoNM[ma].cum.add(v.chiSoCum);
    theoNM[ma].rong.push(v.hop.w);
  }
  const nhaMayLanCum = Object.entries(theoNM)
    .filter(([, o]) => o.cum.size !== 1)
    .map(([k]) => k);
  // Một cụm chỉ được chứa MỘT nhà máy (chiều ngược lại của phép trên).
  const cumLan = [];
  const theoCum = new Map();
  for (const v of d2.toa) {
    const s = theoCum.get(v.chiSoCum) ?? new Set();
    s.add(v.factoryId);
    theoCum.set(v.chiSoCum, s);
  }
  for (const [c, s] of theoCum) if (s.size !== 1) cumLan.push(`cụm ${c} có ${s.size} nhà máy`);
  // Toà của hai công ty KHÁC NHAU không được chồng nhau trên màn.
  let toaChongKhacNM = 0;
  for (let i = 0; i < d2.toa.length; i += 1)
    for (let j = i + 1; j < d2.toa.length; j += 1) {
      const a = d2.toa[i].hop;
      const b = d2.toa[j].hop;
      if (d2.toa[i].factoryId === d2.toa[j].factoryId) continue;
      if (a.trai < b.phai && b.trai < a.phai && a.tren < b.duoi && b.tren < a.duoi) toaChongKhacNM += 1;
    }

  const rongs = d2.toa.map((v) => v.hop.w);
  const cv = d2.hopSvg;
  const ngoaiKhung = d2.toa.filter(
    (v) =>
      v.hop.trai < cv.x - 0.5 ||
      v.hop.tren < cv.y - 0.5 ||
      v.hop.phai > cv.x + cv.w + 0.5 ||
      v.hop.duoi > cv.y + cv.h + 0.5,
  );

  // ── Tên công ty: có đủ 3, ĐÚNG chữ, và ĐỌC ĐƯỢC.
  const tenMongDoi = [...MA_NHA_MAY.keys()]
    .filter((id) => d2.toa.some((v) => v.factoryId === id))
    .map((id) => TEN_NHA_MAY.get(id));
  const tenTrenMan = d2.nhanCum.map((n) => n.chu).sort();
  const nhanCumDocDuoc = d2.nhanCum.filter((n) => n.doc.ok);
  const nhanCumBiChe = d2.nhanCum.filter((n) => !n.doc.ok).map((n) => `${n.chu}←${n.doc.keChe}`);

  const o = {
    "3D": { ...chung3d, ...sb3d },
    "2D": {
      ...chung2d,
      viewBox: d2.viewBox,
      hopSvg: {
        x: Math.round(cv.x),
        y: Math.round(cv.y),
        w: Math.round(cv.w),
        h: Math.round(cv.h),
      },
      lopSaBan: d2.lopSaBan,
      soMayVe2D: d2.soMay2D,
      soBieuTuong: d2.toa.length,
      soNutSvg: d2.soNutSvg,
      rongPxMin: rongs.length ? Math.round(Math.min(...rongs) * 10) / 10 : null,
      rongPxMax: rongs.length ? Math.round(Math.max(...rongs) * 10) / 10 : null,
      soToaDuoiTran: rongs.filter((w) => w < TRAN.rongPx).length,
      soNgoaiKhung: ngoaiKhung.length,
      ngoaiKhung: ngoaiKhung.map((v) => ({ toaNhaId: v.toaNhaId, hop: v.hop })),
      soCum: theoCum.size,
      theoNhaMay: Object.fromEntries(
        Object.entries(theoNM).map(([k, v]) => [
          k,
          { soToa: v.soToa, cum: [...v.cum], rongPxMin: Math.round(Math.min(...v.rong) * 10) / 10 },
        ]),
      ),
      saiThuocNhaMay,
      nhaMayLanCum,
      cumLan,
      toaChongKhacNM,
      tenCongTyMongDoi: tenMongDoi.sort(),
      tenCongTyTrenMan: tenTrenMan,
      soNhanCumDocDuoc: nhanCumDocDuoc.length,
      nhanCumBiChe,
      bannerKhungMacDinh: chung2dMacDinh.banner,
      soNhanCumDocDuocKhiMoDai: nhanCumKhiMoDai.filter((n) => n.trongCanh).length,
      soNhanToa: d2.nhanToa.length,
      soNhanToaDocDuoc: d2.nhanToa.filter((n) => n.doc.ok).length,
      caoChuCumPx: d2.nhanCum.length ? Math.round(d2.nhanCum[0].hop.h * 10) / 10 : null,
      caoChuToaPx: d2.nhanToa.length ? Math.round(d2.nhanToa[0].hop.h * 10) / 10 : null,
      soNhanTong: d2.nhanCum.length + d2.nhanToa.length,
    },
    loi,
  };

  o.DAT = {
    "① hai chế độ CÙNG đơn vị vẽ + màn nói ra":
      o["2D"].donViVe === "toa-nha" && o["2D"].soBieuTuong > 0 && o["2D"].soMayVe2D === 0,
    "① aria 2D nói BIỂU TƯỢNG, không nói số máy":
      typeof o["2D"].aria === "string" && !/1108|\b371\b/.test(o["2D"].aria),
    "② mỗi biểu tượng ≥ 24 px": o["2D"].soToaDuoiTran === 0 && o["2D"].soBieuTuong > 0,
    "② toàn bộ sa bàn trong khung": o["2D"].soNgoaiKhung === 0 && o["2D"].soBieuTuong > 0,
    "② quan hệ đúng theo DẢI MÃ BỘ SINH":
      saiThuocNhaMay.length === 0 && nhaMayLanCum.length === 0 && cumLan.length === 0 && toaChongKhacNM === 0,
    "② đủ tên công ty và ĐỌC ĐƯỢC":
      tenTrenMan.length === tenMongDoi.length &&
      JSON.stringify(tenTrenMan) === JSON.stringify(tenMongDoi.sort()) &&
      nhanCumDocDuoc.length === tenMongDoi.length,
    "③ nhãn < 30": o["2D"].soNhanTong < TRAN.nhan,
    "0 lỗi trang": loi.length === 0,
  };
  kq.vai[vai] = o;

  console.log(`\n══ ${vai} ══`);
  console.log(
    `  3D: bieuTuong=${sb3d.soBieuTuong} rongPx=${sb3d.rongPx.length ? Math.min(...sb3d.rongPx) + ".." + Math.max(...sb3d.rongPx) : "-"}` +
      ` nhan=${sb3d.soNhanDom} | aria="${String(chung3d.aria).slice(0, 90)}"`,
  );
  console.log(
    `  2D: donViVe=${o["2D"].donViVe} bieuTuong=${o["2D"].soBieuTuong} may=${o["2D"].soMayVe2D}` +
      ` rongPx=${o["2D"].rongPxMin}..${o["2D"].rongPxMax} duoiTran=${o["2D"].soToaDuoiTran}` +
      ` ngoaiKhung=${o["2D"].soNgoaiKhung} cum=${o["2D"].soCum} chongKhacNM=${toaChongKhacNM}` +
      ` nhan=${o["2D"].soNhanTong} nutSvg=${o["2D"].soNutSvg}`,
  );
  console.log(`  2D aria="${String(chung2d.aria).slice(0, 110)}"`);
  console.log(
    `  tên công ty mong đợi=${JSON.stringify(tenMongDoi)} trên màn=${JSON.stringify(tenTrenMan)}` +
      ` đọc được=${nhanCumDocDuoc.length}/${d2.nhanCum.length}` +
      (nhanCumBiChe.length ? ` BỊ CHE: ${JSON.stringify(nhanCumBiChe)}` : ""),
  );
  console.log(
    `  nhãn toà đọc được=${o["2D"].soNhanToaDocDuoc}/${o["2D"].soNhanToa}` +
      ` caoChu cụm=${o["2D"].caoChuCumPx}px toà=${o["2D"].caoChuToaPx}px`,
  );
  console.log(`  banner="${String(chung2d.banner).slice(0, 140)}"`);
  console.log(`  DAT: ${JSON.stringify(o.DAT)}`);
  if (saiThuocNhaMay.length) console.log(`  ⚠ SAI THUỘC: ${JSON.stringify(saiThuocNhaMay)}`);
  await ctx.close();
}

await trinh.close();
fs.writeFileSync(RA, JSON.stringify(kq, null, 1));
console.log(`\n→ ${RA} · ảnh ${ANH}`);
