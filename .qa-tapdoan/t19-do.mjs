/**
 * t19-do.mjs — ĐO KẾT CỤC Task 19 trên trình duyệt THẬT (cổng 3064).
 *
 *   node .qa-tapdoan/t19-do.mjs <nhan>        # nhan = "truoc" | "sau"
 *
 * Đo đúng các ô nghiệm thu §9 của thiết kế:
 *   N1  vai cấp tập đoàn  ⇒ số CỤM khối + tổng máy vẽ
 *   N2  vai gán một nhà máy ⇒ 1 cụm + đúng số máy của nhà máy ấy
 *   N3  các cụm KHÔNG chồng nhau (bao hình X trên màn)
 *   N4  ngân sách vẽ (`__thongKeVe`) khi ĐANG XOAY + số nhãn + FPS
 *   N6  banner `banner-ha-cap` còn hay hết
 *   PANEL  chiều cao dải cảnh báo ở 1280×720 (tương tác đã được cảnh báo trước)
 *
 * ⚠ `__demTuongTac` chỉ gắn ở CHẾ ĐỘ ĐO ⇒ mọi URL mang `?do=1`.
 * ⚠ Cụm đếm theo KHE HỞ trên trục X của điểm chiếu; ngưỡng = 6 % bề rộng canvas,
 *   và script in cả danh sách khe để người đọc tự kiểm, không chỉ in con số.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "sau";
const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const RA = `.qa-tapdoan/t19-${NHAN}.json`;
const ANH = `.qa-tapdoan/anh/t19-${NHAN}`;
fs.mkdirSync(ANH, { recursive: true });

/**
 * Dải mã máy của từng công ty QATD — nguồn phân nhóm ĐỘC LẬP với màn đang đo.
 * Đọc từ tóm tắt bộ sinh (mã định danh đổi mỗi lần sinh lại; cấm chép số cũ).
 */
const TT = JSON.parse(fs.readFileSync(".qa-tapdoan/sinh-summary.json", "utf8"));
const DAI_MAY = TT.congTys.map((c) => ({
  code: c.code,
  tu: c.mayDauId,
  den: c.mayDauId + c.tongMay - 1,
}));
console.log("dải mã máy:", DAI_MAY.map((d) => `${d.code}=${d.tu}..${d.den}`).join(" · "));

const VAI = [
  { ten: "qatd_giamdoc", moTa: "cap tap doan (gan TĐ QATD)" },
  { ten: "qatd_quanly", moTa: "chi gan QATD-A" },
  { ten: "qatd_admin", moTa: "doi chung admin (thay het)" },
];

/** Gom điểm theo khe hở trên trục X. Trả về cụm + danh sách khe để kiểm tay. */
function gomCum(xs, nguong) {
  if (xs.length === 0) return { soCum: 0, cum: [], khe: [] };
  const s = [...xs].sort((a, b) => a - b);
  const cum = [];
  const khe = [];
  let dau = s[0];
  let truoc = s[0];
  let n = 1;
  for (let i = 1; i < s.length; i += 1) {
    const d = s[i] - truoc;
    if (d > nguong) {
      khe.push(Math.round(d));
      cum.push({ tu: Math.round(dau), den: Math.round(truoc), so: n });
      dau = s[i];
      n = 0;
    }
    truoc = s[i];
    n += 1;
  }
  cum.push({ tu: Math.round(dau), den: Math.round(truoc), so: n });
  return { soCum: cum.length, cum, khe };
}

const ketQua = { nhan: NHAN, luc: new Date().toISOString(), vai: {} };

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
  // Đợi cảnh vẽ ÍT NHẤT một khung (không dùng cửa sổ thời gian cố định — G của Đợt 30).
  await page
    .waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, undefined, { timeout: 120_000 })
    .catch(() => {});
  // Đợi lô máy ỔN ĐỊNH: hai lần đọc liên tiếp cùng số máy.
  await page
    .waitForFunction(
      () => {
        const n = window.__demTuongTac?.dsMay?.()?.length ?? -1;
        const w = window;
        const on = w.__t19_truoc === n && n > 0;
        w.__t19_truoc = n;
        return on;
      },
      undefined,
      { timeout: 120_000, polling: 1500 },
    )
    .catch(() => {});

  // ── Ảnh SẠCH trước khi bấm gì: phần mở của dải hợp nhất NỔI ĐÈ lên canvas
  //    (`DaiHopNhat.tsx:170` `absolute z-30`), nên ảnh chụp sau khi bấm KHÔNG
  //    còn là ảnh của cảnh.
  await page.screenshot({ path: `${ANH}/${v.ten}-1-canh-sach.png` });
  const oCanh = await page.$("canvas");
  if (oCanh) await oCanh.screenshot({ path: `${ANH}/${v.ten}-2-canvas.png` }).catch(() => {});

  /*
   * ⚠ Banner nhóm `phamVi`/`duLieu` nằm SAU nút "xem" của `dai-hop-nhat`
   *   (`DaiHopNhat.tsx:178` — phần mở chỉ render khi `mo`). Không bấm nút này thì
   *   mọi phép đọc banner trả `null` cho CẢ trước lẫn sau, và cả hai đều vô
   *   nghĩa. Đây chính là bẫy "ô xanh trên tập rỗng".
   */
  await page
    .getByTestId("nut-mo-dai-hop-nhat")
    .click({ timeout: 8_000 })
    .catch(() => {});
  await page.waitForTimeout(300);

  const doc = await page.evaluate(() => {
    const q = (id) => document.querySelector(`[data-testid='${id}']`);
    const ds = window.__demTuongTac?.dsMay?.() ?? [];
    const canvas = document.querySelector("canvas");
    const r = canvas?.getBoundingClientRect();
    const dai = q("dai-canh-bao");
    const hangCanhBao = document.querySelectorAll("[data-testid^='canh-bao-']");
    const dongDanhTinh = document.querySelectorAll("[data-testid^='danh-tinh-']");
    const dsMay = document.querySelectorAll("[data-testid^='may-hang-']");
    return {
      soMayVe: ds.length,
      xs: ds.map((m) => m.x),
      /** `machineId → x` để gom theo NHÀ MÁY (dải id của bộ sinh), không chỉ theo khe hở. */
      diem: ds.map((m) => [m.machineId, Math.round(m.x), Math.round(m.y)]),
      trongKhung: ds.filter((m) => m.trongKhung).length,
      canvas: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
      thongKe: window.__thongKeVe ?? null,
      soNhan: window.__demTuongTac?.hopNhanDaVe?.()?.length ?? -1,
      demMay: q("dem-may")?.textContent?.trim() ?? null,
      breadcrumb: q("breadcrumb-twin")?.textContent?.trim() ?? null,
      soNhaMayOChon: q("chon-nha-may")?.getAttribute("data-so-muc") ?? null,
      banner: {
        haCap: q("banner-ha-cap") ? q("banner-ha-cap").textContent.trim().slice(0, 120) : null,
        nhaMayVuotTran: q("banner-nha-may-vuot-tran")
          ? q("banner-nha-may-vuot-tran").textContent.trim().slice(0, 160)
          : null,
        viTriTamSinh: q("banner-vi-tri-tam-sinh")
          ? q("banner-vi-tri-tam-sinh").textContent.trim().slice(0, 160)
          : null,
        trangThaiMotNhaMay: q("banner-trang-thai-mot-nha-may")
          ? q("banner-trang-thai-mot-nha-may").textContent.trim().slice(0, 200)
          : null,
        tangVuotTran: q("banner-tang-vuot-tran")
          ? q("banner-tang-vuot-tran").textContent.trim().slice(0, 160)
          : null,
      },
      soViecTrenDai: q("dai-hop-nhat")?.getAttribute("data-so-viec") ?? null,
      panelTrai: (() => {
        const p = dai?.getBoundingClientRect();
        const cuon = q("dai-canh-bao-cuon");
        const c = cuon?.getBoundingClientRect();
        const cao = [...hangCanhBao].map((e) => Math.round(e.getBoundingClientRect().height));
        const nhinThay = [...hangCanhBao].filter((e) => {
          const r = e.getBoundingClientRect();
          return c ? r.top >= c.top - 1 && r.bottom <= c.bottom + 1 : false;
        }).length;
        const tonDong = q("nhom-ton-dong");
        return {
          daiCanhBao: p ? { top: Math.round(p.top), h: Math.round(p.height) } : null,
          vungCuon: c ? { h: Math.round(c.height), cuonDuoc: cuon.scrollHeight } : null,
          soHangCanhBao: hangCanhBao.length,
          soHangNhinTronVen: nhinThay,
          soDongDanhTinh: dongDanhTinh.length,
          caoHangTrungBinh: cao.length ? Math.round((cao.reduce((a, b) => a + b, 0) / cao.length) * 100) / 100 : 0,
          caoHang6Dau: cao.slice(0, 6),
          coNhomTonDong: Boolean(tonDong),
          soHangMay: dsMay.length,
        };
      })(),
    };
  });

  // ── N4: ngân sách vẽ KHI ĐANG XOAY. Kéo chuột trên canvas và lấy mẫu FPS.
  const xoay = await (async () => {
    const c = await page.$("canvas");
    if (!c) return null;
    const box = await c.boundingBox();
    if (!box) return null;
    await page.evaluate(() => {
      window.__t19_khung = 0;
      const dem = () => {
        window.__t19_khung += 1;
        window.__t19_raf = requestAnimationFrame(dem);
      };
      window.__t19_raf = requestAnimationFrame(dem);
      window.__t19_t0 = performance.now();
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
      const ms = performance.now() - window.__t19_t0;
      cancelAnimationFrame(window.__t19_raf);
      return {
        khung: window.__t19_khung,
        ms: Math.round(ms),
        fps: Math.round((window.__t19_khung / ms) * 1000),
        thongKe: window.__thongKeVe ?? null,
        soNhan: window.__demTuongTac?.hopNhanDaVe?.()?.length ?? -1,
        soMayVe: window.__demTuongTac?.dsMay?.()?.length ?? -1,
      };
    });
  })();

  const nguong = doc.canvas ? doc.canvas.w * 0.06 : 60;
  const cum = gomCum(doc.xs, nguong);

  /*
   * ★★★ N1/N3 ĐO THEO **NHÀ MÁY**, KHÔNG THEO KHE HỞ TRÊN MÀN.
   *
   * Gom theo khe hở là một phép gần đúng và nó đã tự lộ ra: phép chiếu phối cảnh
   * nén hai cụm ở xa lại gần nhau nên "2 cụm" cho một cảnh CÓ ba khối. Nguồn
   * phân nhóm độc lập là DẢI MÃ MÁY của bộ sinh (`sinh-summary.json`) — không
   * phải thứ do chính màn tự khai, nên nó không thể tự thoả.
   */
  const theoNhaMay = {};
  for (const [id, x, y] of doc.diem) {
    const ct = DAI_MAY.find((d) => id >= d.tu && id <= d.den);
    const k = ct ? ct.code : "ngoai-QATD";
    (theoNhaMay[k] ??= { so: 0, xTu: Infinity, xDen: -Infinity, yTu: Infinity, yDen: -Infinity });
    const o = theoNhaMay[k];
    o.so += 1;
    o.xTu = Math.min(o.xTu, x);
    o.xDen = Math.max(o.xDen, x);
    o.yTu = Math.min(o.yTu, y);
    o.yDen = Math.max(o.yDen, y);
  }
  const ten = Object.keys(theoNhaMay);
  let capChongMan = 0;
  for (let i = 0; i < ten.length; i += 1) {
    for (let j = i + 1; j < ten.length; j += 1) {
      const a = theoNhaMay[ten[i]];
      const b = theoNhaMay[ten[j]];
      if (a.xTu <= b.xDen && b.xTu <= a.xDen && a.yTu <= b.yDen && b.yTu <= a.yDen) capChongMan += 1;
    }
  }

  delete doc.xs;
  delete doc.diem;
  ketQua.vai[v.ten] = {
    moTa: v.moTa,
    ...doc,
    khoiTheoNhaMay: theoNhaMay,
    soKhoiTheoNhaMay: ten.length,
    capBaoHinhChongTrenMan: capChongMan,
    cum: { ...cum, nguongPx: Math.round(nguong) },
    xoay,
    loi,
  };
  console.log(
    `[${NHAN}] ${v.ten.padEnd(14)} may=${String(doc.soMayVe).padStart(5)} cum=${cum.soCum}` +
      ` demMay="${doc.demMay}" haCap=${doc.banner.haCap ? "CO" : "khong"}` +
      ` calls=${doc.thongKe?.calls} tri=${doc.thongKe?.triangles} nhan=${doc.soNhan}` +
      ` fps=${xoay?.fps ?? "?"} khoi=${ten.length}(${ten.join("/")}) chong=${capChongMan}` +
      ` hangCB=${doc.panelTrai.soHangCanhBao} tron=${doc.panelTrai.soHangNhinTronVen} caoTB=${doc.panelTrai.caoHangTrungBinh}`,
  );
  await ctx.close();
}

await trinh.close();
fs.writeFileSync(RA, JSON.stringify(ketQua, null, 1));
console.log(`\n→ ${RA}`);
