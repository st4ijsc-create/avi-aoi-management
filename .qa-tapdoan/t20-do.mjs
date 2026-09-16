/**
 * t20-do.mjs — ĐO KẾT CỤC **TASK 20** (sa bàn quy hoạch) trên trình duyệt THẬT.
 *
 *   node .qa-tapdoan/t20-do.mjs <nhan>     # nhan = "truoc" | "sau"
 *
 * Bốn ô nghiệm thu của chủ đợt, đo ĐÚNG thứ chúng nói:
 *   ① @1280×720, khung MẶC ĐỊNH (không cuộn tay): mỗi biểu tượng toà rộng
 *      ≥ 24 px, và TOÀN BỘ sa bàn nằm trong khung canvas.
 *   ② Quan hệ: 12 biểu tượng · 3 cụm · mỗi cụm đúng 4 toà của ĐÚNG một công ty —
 *      gom theo `factoryId` lấy từ `sinh-summary.json` (nguồn ĐỘC LẬP với màn),
 *      KHÔNG gom theo khe hở trên màn (Task 19 đã dính: phối cảnh nén ⇒ "2 cụm").
 *   ③ Ngân sách vẽ: lệnh vẽ < 150 · tam giác < 500k · nhãn < 30 · ≥ 30 khung/s.
 *   ④ Ảnh khung mặc định để chủ đợt TỰ XEM.
 *
 * ⚠ `__demSaBan` chỉ gắn ở CHẾ ĐỘ ĐO ⇒ mọi URL mang `?do=1`.
 * ⚠ Khung hình đo trên ANGLE+GPU; Playwright mặc định SwiftShader (CPU) cho số
 *   thấp giả.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "sau";
const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const RA = `.qa-tapdoan/t20-${NHAN}.json`;
const ANH = `.qa-tapdoan/anh/t20-${NHAN}`;
fs.mkdirSync(ANH, { recursive: true });

const TT = JSON.parse(fs.readFileSync(".qa-tapdoan/sinh-summary.json", "utf8"));
/** `factoryId → mã công ty` — nguồn phân nhóm ĐỘC LẬP với thứ màn tự khai. */
const NHA_MAY = new Map(TT.congTys.map((c) => [c.id, c.code]));
console.log("nhà máy QATD:", [...NHA_MAY].map(([id, m]) => `${m}=${id}`).join(" · "));

const TRAN = { calls: 150, triangles: 500_000, nhan: 30, fps: 30, rongPx: 24 };

const VAI = [
  { ten: "qatd_giamdoc", moTa: "cap tap doan (gan TD QATD)" },
  { ten: "qatd_quanly", moTa: "chi gan QATD-A" },
];

const ketQua = { nhan: NHAN, luc: new Date().toISOString(), tran: TRAN, vai: {} };

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});

for (const v of VAI) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const loi = [];
  page.on("pageerror", (e) => loi.push(String(e).slice(0, 200)));

  const dn = await page.request.post(`${GOC}/api/auth/login`, {
    data: { username: v.ten, password: MK },
  });
  if (!dn.ok()) {
    ketQua.vai[v.ten] = { LOI: `dang nhap that bai ${dn.status()}` };
    await ctx.close();
    continue;
  }

  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  await page
    .waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, undefined, { timeout: 120_000 })
    .catch(() => {});
  /*
   * Đợi sa bàn ỔN ĐỊNH: hai lần đọc liên tiếp cùng số biểu tượng > 0. Không dùng
   * cửa sổ thời gian cố định (bài học Đợt 30: 11/13 ca đỏ oan vì 1.200 ms cứng).
   * Camera còn TWEEN 500 ms sau khi `khungNhin` đổi, nên thêm một nhịp chờ hình
   * chiếu đứng yên — bao hình px là thứ ta sắp đo.
   */
  await page
    .waitForFunction(
      () => {
        const ds = window.__demSaBan?.bieuTuong?.() ?? [];
        const khoa = ds.map((b) => `${b.toaNhaId}:${Math.round(b.rongPx)}`).join(",");
        const w = window;
        const on = w.__t20_truoc === khoa && ds.length > 0;
        w.__t20_truoc = khoa;
        return on;
      },
      undefined,
      { timeout: 120_000, polling: 1200 },
    )
    .catch(() => {});

  // ── Ảnh SẠCH, KHUNG MẶC ĐỊNH (chưa bấm gì, chưa cuộn) ─────────────────────
  await page.screenshot({ path: `${ANH}/${v.ten}-1-toan-man.png` });
  const oCanh = await page.$("canvas");
  if (oCanh) await oCanh.screenshot({ path: `${ANH}/${v.ten}-2-canvas.png` }).catch(() => {});

  /*
   * ★ ẢNH PHỤ — CÙNG KHUNG MẶC ĐỊNH nhưng THU ba panel (`?thu=trai,phai,kpi`).
   *   Không phải để làm đẹp con số: ba panel là DOM `z-30` nổi TRÊN canvas, và ở
   *   1280×720 bảng `Metrics` che đúng góc trên-trái của sa bàn. Ảnh này tách hai
   *   câu hỏi khác nhau — sa bàn có đọc được không, và panel có che nó không — để
   *   chủ đợt phân xử từng câu một thay vì gộp thành một ấn tượng.
   */
  const ctx2 = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const p2 = await ctx2.newPage();
  await p2.request.post(`${GOC}/api/auth/login`, { data: { username: v.ten, password: MK } });
  await p2.goto(`${GOC}/twin?pv=tapdoan&do=1&thu=trai,phai,kpi`, { waitUntil: "domcontentloaded" });
  await p2.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  await p2
    .waitForFunction(() => (window.__demSaBan?.bieuTuong?.()?.length ?? 0) > 0, undefined, {
      timeout: 120_000,
      polling: 1000,
    })
    .catch(() => {});
  await p2.waitForTimeout(2500);
  const oCanh2 = await p2.$("canvas");
  if (oCanh2) await oCanh2.screenshot({ path: `${ANH}/${v.ten}-3-canvas-thu-panel.png` }).catch(() => {});
  const nhan2 = await p2.evaluate(() => window.__demSaBan?.soNhan?.() ?? null);
  await ctx2.close();

  // Banner nằm sau nút "xem" của dải hợp nhất — không bấm thì mọi phép đọc là null.
  await page.getByTestId("nut-mo-dai-hop-nhat").click({ timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(300);

  const doc = await page.evaluate(() => {
    const q = (id) => document.querySelector(`[data-testid='${id}']`);
    const canvas = document.querySelector("canvas");
    const r = canvas?.getBoundingClientRect();
    const bt = window.__demSaBan?.bieuTuong?.() ?? [];
    const b = q("banner-vi-tri-tam-sinh");
    return {
      canvas: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
      bieuTuong: bt.map((x) => ({
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
      })),
      soNhanSaBan: window.__demSaBan?.soNhan?.() ?? null,
      // Nhãn ĐỌC ĐƯỢC = có trong DOM **và** không `display:none` (lớp tự ẩn khi bị
      // panel z-30 nuốt). Đếm thô cả hai để so, vì chênh lệch chính là con số
      // mà QA Đợt 32 đã phải trả giá để biết.
      soNhanDom: (() => {
        const ds = [...document.querySelectorAll("[data-testid='nhan-toa-sa-ban'],[data-testid='nhan-cum-sa-ban']")];
        const hien = ds.filter((e) => getComputedStyle(e).display !== 'none');
        return { tong: ds.length, hien: hien.length };
      })(),
      nhanCum: [...document.querySelectorAll("[data-testid='nhan-cum-sa-ban']")].map((e) => ({
        factoryId: Number(e.getAttribute("data-factory-id")),
        chu: e.textContent.trim(),
      })),
      soMayVe: window.__demTuongTac?.dsMay?.()?.length ?? -1,
      thongKe: window.__thongKeVe ?? null,
      demMay: q("dem-may")?.textContent?.trim() ?? null,
      breadcrumb: q("breadcrumb-twin")?.textContent?.trim() ?? null,
      banner: {
        viTriSoDo: b ? b.textContent.trim().slice(0, 260) : null,
        soToa: b?.getAttribute("data-so-toa") ?? null,
        soKhoi: b?.getAttribute("data-so-khoi") ?? null,
        rongThatMm: b?.getAttribute("data-rong-that-mm") ?? null,
        rongSoDoMm: b?.getAttribute("data-rong-so-do-mm") ?? null,
        haCap: q("banner-ha-cap") ? q("banner-ha-cap").textContent.trim().slice(0, 120) : null,
        nhaMayVuotTran: q("banner-nha-may-vuot-tran")
          ? q("banner-nha-may-vuot-tran").textContent.trim().slice(0, 160)
          : null,
      },
    };
  });

  // ── ③ ngân sách khi ĐANG XOAY ────────────────────────────────────────────
  const xoay = await (async () => {
    const c = await page.$("canvas");
    const box = c ? await c.boundingBox() : null;
    if (!box) return null;
    await page.evaluate(() => {
      window.__t20_khung = 0;
      const dem = () => {
        window.__t20_khung += 1;
        window.__t20_raf = requestAnimationFrame(dem);
      };
      window.__t20_raf = requestAnimationFrame(dem);
      window.__t20_t0 = performance.now();
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
    return page.evaluate(() => {
      const ms = performance.now() - window.__t20_t0;
      cancelAnimationFrame(window.__t20_raf);
      return {
        khung: window.__t20_khung,
        ms: Math.round(ms),
        fps: Math.round((window.__t20_khung / ms) * 1000),
        thongKe: window.__thongKeVe ?? null,
        soBieuTuong: window.__demSaBan?.bieuTuong?.()?.length ?? -1,
      };
    });
  })();

  // ── ② gom cụm theo `factoryId` (nguồn độc lập), KHÔNG theo khe hở màn ─────
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
  // Một cụm = một nhà máy: mỗi nhà máy phải nằm trong ĐÚNG MỘT `chiSoCum`.
  const cumLan = ten.filter((k) => theoNhaMay[k].chiSoCum.size !== 1);
  // Cụm tách bạch: 0 cặp bao hình MÀN HÌNH giao nhau.
  let capChong = 0;
  const capChongTen = [];
  for (let i = 0; i < ten.length; i += 1) {
    for (let j = i + 1; j < ten.length; j += 1) {
      const a = theoNhaMay[ten[i]].hop;
      const b = theoNhaMay[ten[j]].hop;
      if (a.trai < b.phai && b.trai < a.phai && a.tren < b.duoi && b.tren < a.duoi) {
        capChong += 1;
        capChongTen.push(`${ten[i]}×${ten[j]}`);
      }
    }
  }

  /*
   * ★★★ TÁCH BẠCH ĐO BẰNG **BIỂU TƯỢNG × BIỂU TƯỢNG**, KHÔNG BẰNG BAO HÌNH CỤM.
   *
   * Bao-hình-của-bao-hình là phép đo SAI ở đây và nó tự lộ: ba cụm nằm trên lưới
   * 2×2, nhìn chéo 45° thì hộp trục-song-song của cụm A và cụm B chồng nhau ở
   * GÓC dù không một toà nào của A chạm toà nào của B. Đúng họ lỗi mà brief cảnh
   * báo (Task 19 gom theo khe hở ⇒ khai '2 cụm' cho một cảnh có ba khối).
   * ⇒ Phép quyết định: có toà nào của công ty X chồng toà nào của công ty Y trên
   *   màn không. Con số bao-hình-cụm vẫn được IN RA để người đọc tự kiểm.
   */
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

  const rongs = doc.bieuTuong.map((x) => x.rongPx);
  const cv = doc.canvas ?? { w: 0, h: 0 };
  const ngoaiKhung = doc.bieuTuong.filter(
    (x) => x.hop.trai < 0 || x.hop.tren < 0 || x.hop.phai > cv.w || x.hop.duoi > cv.h,
  );

  const o = {
    moTa: v.moTa,
    canvas: doc.canvas,
    soBieuTuong: doc.bieuTuong.length,
    rongPxMin: rongs.length ? Math.min(...rongs) : null,
    rongPxMax: rongs.length ? Math.max(...rongs) : null,
    soToaDuoiTran: rongs.filter((x) => x < TRAN.rongPx).length,
    soNgoaiKhung: ngoaiKhung.length,
    ngoaiKhung: ngoaiKhung.map((x) => ({ toaNhaId: x.toaNhaId, hop: x.hop })),
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
    capBaoHinhCumChongTrenMan: capChong,
    capBaoHinhCumChongTen: capChongTen,
    capToaChongKhacNhaMay,
    capToaChongTen,
    soMayVe: doc.soMayVe,
    soNhanSaBan: doc.soNhanSaBan,
    soNhanDom: doc.soNhanDom,
    nhanCum: doc.nhanCum,
    demMay: doc.demMay,
    breadcrumb: doc.breadcrumb,
    banner: doc.banner,
    nhanKhiThuPanel: nhan2,
    thongKe: doc.thongKe,
    xoay,
    loi,
  };
  o.DAT = {
    "①a moi bieu tuong >= 24px": o.soToaDuoiTran === 0 && o.soBieuTuong > 0,
    "①b toan bo sa ban trong khung": o.soNgoaiKhung === 0 && o.soBieuTuong > 0,
    "② quan he dung (1 cum = 1 nha may, 0 toa chong toa khac cong ty)":
      cumLan.length === 0 && capToaChongKhacNhaMay === 0 && o.soBieuTuong > 0,
    "③ ngan sach ve":
      (xoay?.thongKe?.calls ?? 1e9) < TRAN.calls &&
      (xoay?.thongKe?.triangles ?? 1e9) < TRAN.triangles &&
      o.soNhanDom.tong < TRAN.nhan &&
      (xoay?.fps ?? 0) >= TRAN.fps,
  };
  ketQua.vai[v.ten] = o;

  console.log(
    `[${NHAN}] ${v.ten.padEnd(14)} bieuTuong=${o.soBieuTuong} cum=${o.soCum}` +
      ` rongPx=${o.rongPxMin}..${o.rongPxMax} duoiTran=${o.soToaDuoiTran} ngoaiKhung=${o.soNgoaiKhung}` +
      ` nhaMay=${ten.join("/")} lanCum=${cumLan.length} toaChong=${capToaChongKhacNhaMay} bhCumChong=${capChong}` +
      ` calls=${xoay?.thongKe?.calls} tri=${xoay?.thongKe?.triangles} nhan=${o.soNhanDom.hien}/${o.soNhanDom.tong} fps=${xoay?.fps}` +
      ` may=${o.soMayVe} demMay="${o.demMay}"`,
  );
  console.log(`         DAT: ${JSON.stringify(o.DAT)}`);
  await ctx.close();
}

await trinh.close();
fs.writeFileSync(RA, JSON.stringify(ketQua, null, 1));
console.log(`\n→ ${RA}  ·  ảnh: ${ANH}`);
