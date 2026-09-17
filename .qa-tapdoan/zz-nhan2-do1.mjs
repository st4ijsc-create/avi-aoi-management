/**
 * zz-nhan2-do1.mjs — BƯỚC 1: ĐO, KHÔNG VÁ.
 * Trả lời: vì sao "Nhà máy ảo (SIM)" và "Công ty A" ở admin/2D không cứu được?
 *
 * Chống bẫy (ba lần đã trả giá trong đợt này):
 *  · KHÔNG bấm gì trước khi đọc 3D.
 *  · Chuyển 2D phải bấm `nut-che-2d` ⇒ IN BẢN ĐỒ LỚP PHỦ TRƯỚC và SAU cú bấm.
 *  · Ổn định bằng "hai lượt đọc CÙNG KHOÁ", không bằng cửa sổ thời gian.
 *  · Khẳng định KÍCH THƯỚC mọi tập trước khi kết luận (cấm xanh trên tập rỗng).
 */
import { chromium } from "playwright";
import fs from "node:fs";

const GOC = "http://localhost:3067";
const MK = "Qatd!2026";
const NHAN = process.argv[2] ?? "truoc";
const RA = `.qa-tapdoan/zz-nhan2-do1-${NHAN}.json`;
const ANH = `.qa-tapdoan/zz-nhan2-anh/${NHAN}`;
fs.mkdirSync(ANH, { recursive: true });

const VAI = ["qatd_admin", "qatd_kythuat"];

const TRONG_TRANG = () => {
  const ten = (e) => {
    if (!e) return null;
    const tid = e.getAttribute && e.getAttribute("data-testid");
    return `${e.tagName}${tid ? "#" + tid : ""}`;
  };
  const hop = (e) => {
    const r = e.getBoundingClientRect();
    const n = (v) => Math.round(v * 10) / 10;
    return {
      trai: n(r.x),
      phai: n(r.x + r.width),
      tren: n(r.y),
      duoi: n(r.y + r.height),
      w: n(r.width),
      h: n(r.height),
    };
  };
  const lopPhu = [...document.querySelectorAll("[data-che-nhan]")]
    .map((e) => ({ ten: ten(e), ...hop(e), pe: getComputedStyle(e).pointerEvents }))
    .filter((o) => o.w > 0 && o.h > 0);
  return { ten, hop, lopPhu };
};

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ra = { nhan: NHAN, luc: new Date().toISOString(), goc: GOC, vai: {} };

for (const vai of VAI) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const dn = await page.request.post(`${GOC}/api/auth/login`, {
    data: { username: vai, password: MK },
  });
  if (!dn.ok()) {
    ra.vai[vai] = { LOI: dn.status() };
    await ctx.close();
    continue;
  }
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const ds = (window.__demSaBan && window.__demSaBan.bieuTuong()) || [];
        const n = document.querySelectorAll("[data-testid='nhan-cum-sa-ban']").length;
        const khoa = `${n}|` + ds.map((b) => `${b.toaNhaId}:${Math.round(b.rongPx)}`).join(",");
        const on = window.__k === khoa && khoa.length > 2;
        window.__k = khoa;
        return on;
      },
      undefined,
      { timeout: 120_000, polling: 1000 },
    )
    .catch(() => {});

  // ══ 3D — KHÔNG BẤM GÌ ══
  await page.screenshot({ path: `${ANH}/${vai}-3d.png` });
  const d3 = await page.evaluate((src) => {
    const { hop, lopPhu } = new Function(`return (${src})()`)();
    const chePc = (r) => {
      const o = [];
      for (const p of lopPhu) {
        const gx = Math.max(0, Math.min(r.phai, p.phai) - Math.max(r.trai, p.trai));
        const gy = Math.max(0, Math.min(r.duoi, p.duoi) - Math.max(r.tren, p.tren));
        if (gx > 0 && gy > 0) o.push({ boi: p.ten, pc: Math.round(((gx * gy) / (r.w * r.h)) * 1000) / 10 });
      }
      return o;
    };
    const nhan = (sel) =>
      [...document.querySelectorAll(`[data-testid='${sel}']`)].map((e) => {
        const an = getComputedStyle(e).display === "none";
        const r = an ? null : hop(e);
        const che = r ? chePc(r) : null;
        return {
          chu: e.textContent.trim(),
          toaNhaId: Number(e.getAttribute("data-toa-nha-id")) || null,
          factoryId: Number(e.getAttribute("data-factory-id")) || null,
          an,
          hop: r,
          che,
          tyLeChe: che ? Math.round(che.reduce((s, c) => s + c.pc, 0) * 10) / 10 : null,
        };
      });
    const bt = (window.__demSaBan && window.__demSaBan.bieuTuong()) || [];
    return {
      soNhan: (window.__demSaBan && window.__demSaBan.soNhan()) || null,
      lopPhu,
      hopBieuTuong: bt.map((b) => ({
        toaNhaId: b.toaNhaId,
        factoryId: b.factoryId,
        hop: {
          trai: Math.round(b.hop.trai * 10) / 10,
          phai: Math.round(b.hop.phai * 10) / 10,
          tren: Math.round(b.hop.tren * 10) / 10,
          duoi: Math.round(b.hop.duoi * 10) / 10,
        },
      })),
      nhanCum: nhan("nhan-cum-sa-ban"),
      nhanToa: nhan("nhan-toa-sa-ban"),
      hopCanvas: document.querySelector("canvas") ? hop(document.querySelector("canvas")) : null,
    };
  }, TRONG_TRANG.toString());

  const phuTruoc = d3.lopPhu.map((p) => p.ten).sort();

  // ══ bấm ĐÚNG MỘT lần sang 2D ══
  await page.getByTestId("nut-che-2d").click({ timeout: 15_000 }).catch(() => {});
  await page.getByTestId("canh-van-hanh-2d").waitFor({ timeout: 45_000 }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const n = document.querySelectorAll(
          "[data-testid='nhan-cum-sa-ban-2d'],[data-testid='toa-2d-sa-ban']",
        ).length;
        const on = window.__k2 === n && n > 0;
        window.__k2 = n;
        return on;
      },
      undefined,
      { timeout: 45_000, polling: 800 },
    )
    .catch(() => {});
  await page.screenshot({ path: `${ANH}/${vai}-2d.png` });

  const d2 = await page.evaluate((src) => {
    const { hop, lopPhu } = new Function(`return (${src})()`)();
    const q = (id) => document.querySelector(`[data-testid='${id}']`);
    const svg = q("canh-van-hanh-2d");
    const lop = q("lop-sa-ban-2d");
    const chePc = (r) => {
      const o = [];
      for (const p of lopPhu) {
        const gx = Math.max(0, Math.min(r.phai, p.phai) - Math.max(r.trai, p.trai));
        const gy = Math.max(0, Math.min(r.duoi, p.duoi) - Math.max(r.tren, p.tren));
        if (gx > 0 && gy > 0) o.push({ boi: p.ten, pc: Math.round(((gx * gy) / (r.w * r.h)) * 1000) / 10 });
      }
      return o;
    };
    const nhan = (sel) =>
      [...document.querySelectorAll(`[data-testid='${sel}']`)].map((e) => {
        const an = getComputedStyle(e).visibility === "hidden" || e.getAttribute("data-an") === "1";
        const r = hop(e);
        let bb = null;
        try {
          const b = e.getBBox();
          bb = {
            x: Math.round(b.x * 100) / 100,
            y: Math.round(b.y * 100) / 100,
            w: Math.round(b.width * 100) / 100,
            h: Math.round(b.height * 100) / 100,
          };
        } catch {
          bb = null;
        }
        return {
          chu: e.textContent.trim(),
          factoryId: Number(e.getAttribute("data-factory-id")) || null,
          toaNhaId: Number(e.getAttribute("data-toa-nha-id")) || null,
          an,
          hopPx: r,
          bbMo: bb,
          che: an ? null : chePc(r),
          tyLeChe: an ? null : Math.round(chePc(r).reduce((s, c) => s + c.pc, 0) * 10) / 10,
        };
      });
    const rect = (sel, attrs) =>
      [...document.querySelectorAll(`[data-testid='${sel}']`)].map((e) => {
        const o = { hopPx: hop(e) };
        for (const a of attrs) o[a] = e.getAttribute(a);
        return o;
      });
    return {
      hopSvg: svg ? hop(svg) : null,
      viewBox: svg ? svg.getAttribute("viewBox") : null,
      demNhan: lop
        ? {
            ve: +lop.getAttribute("data-nhan-ve"),
            an: +lop.getAttribute("data-nhan-an"),
            tong: +lop.getAttribute("data-nhan-tong"),
          }
        : null,
      lopPhu,
      cum: rect("cum-2d-sa-ban", ["data-factory-id"]),
      toa: rect("toa-2d-sa-ban", ["data-toa-nha-id", "data-factory-id"]),
      nhanCum: nhan("nhan-cum-sa-ban-2d"),
      nhanToa: nhan("nhan-toa-sa-ban-2d"),
    };
  }, TRONG_TRANG.toString());

  const phuSau = d2.lopPhu.map((p) => p.ten).sort();
  ra.vai[vai] = {
    d3,
    d2,
    phuTruoc,
    phuSau,
    bamDoiLopPhu: JSON.stringify(phuTruoc) !== JSON.stringify(phuSau),
  };

  console.log(`\n════════ ${vai} ════════`);
  console.log(
    `KHẲNG ĐỊNH KÍCH THƯỚC: lớpPhủ3D=${d3.lopPhu.length} lớpPhủ2D=${d2.lopPhu.length}` +
      ` cụm2D=${d2.cum.length} toà2D=${d2.toa.length} nhãnCụm2D=${d2.nhanCum.length} nhãnToà2D=${d2.nhanToa.length}` +
      ` nhãnToà3D=${d3.nhanToa.length}`,
  );
  console.log(
    `lớp phủ TRƯỚC bấm = SAU bấm? ${JSON.stringify(phuTruoc) === JSON.stringify(phuSau) ? "GIỐNG ✓" : "KHÁC ✗"}`,
  );
  console.log(`  trước: ${phuTruoc.join(", ")}`);
  console.log(`  sau  : ${phuSau.join(", ")}`);
  console.log(`3D soNhan=${JSON.stringify(d3.soNhan)}`);
  for (const n of d3.nhanToa.filter((n) => n.an || n.tyLeChe > 0))
    console.log(
      `  3D toà "${n.chu}" ẩn=${n.an} %che=${n.tyLeChe} bởi=${JSON.stringify(n.che)} hộp=${JSON.stringify(n.hop)}`,
    );
  console.log(`2D svg=${JSON.stringify(d2.hopSvg)} viewBox=${d2.viewBox} demNhan=${JSON.stringify(d2.demNhan)}`);
  console.log(`2D LỚP PHỦ:`);
  for (const p of d2.lopPhu) console.log(`   ${p.ten} [${p.trai}..${p.phai}] × [${p.tren}..${p.duoi}] pe=${p.pe}`);
  console.log(`2D TẤM NỀN CỤM (px):`);
  for (const c of d2.cum)
    console.log(
      `   factory=${c["data-factory-id"]} [${c.hopPx.trai}..${c.hopPx.phai}] × [${c.hopPx.tren}..${c.hopPx.duoi}] (${c.hopPx.w}×${c.hopPx.h})`,
    );
  console.log(`2D NHÃN CỤM:`);
  for (const n of d2.nhanCum)
    console.log(
      `   "${n.chu}" f=${n.factoryId} ẩn=${n.an} hộpPx=[${n.hopPx.trai}..${n.hopPx.phai}]×[${n.hopPx.tren}..${n.hopPx.duoi}]` +
        ` (${n.hopPx.w}×${n.hopPx.h}) %che=${n.tyLeChe} bởi=${JSON.stringify(n.che)}`,
    );
  await ctx.close();
}
await trinh.close();
fs.writeFileSync(RA, JSON.stringify(ra, null, 1));
console.log(`\n→ ${RA} · ảnh ${ANH}`);
