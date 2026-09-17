/**
 * zz-nhan2-do2.mjs — ĐO ĐƯỜNG ĐỌC LẠI TÊN BỊ ẨN + chụp ảnh SAU.
 *
 * Câu hỏi: nhãn cụm bị ẩn ở `qatd_admin` 2D thì người dùng còn đường nào biết
 * tấm nền ấy là công ty nào không?
 *
 * Phép đo (không tin lời khai của mã):
 *  ① với MỖI nhãn cụm bị ẩn, tìm các điểm trên tấm nền của nó mà `elementFromPoint`
 *    trả về một phần tử NẰM TRONG svg (tức không bị panel chặn);
 *  ② đọc `<title>` của phần tử ấy và kiểm nó CÓ CHỨA tên cụm;
 *  ③ khẳng định KÍCH THƯỚC: nếu không có nhãn ẩn nào thì ca này VÔ NGHĨA — phải kêu.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const GOC = process.env.GOC_QA || "http://localhost:3067";
const MK = "Qatd!2026";
const NHAN = process.argv[2] ?? "sau";
const ANH = `.qa-tapdoan/zz-nhan2-anh/${NHAN}`;
fs.mkdirSync(ANH, { recursive: true });

const trinh = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const ra = { nhan: NHAN, luc: new Date().toISOString(), goc: GOC, vai: {} };

for (const vai of ["qatd_admin", "qatd_kythuat"]) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const dn = await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: MK } });
  if (!dn.ok()) { ra.vai[vai] = { LOI: dn.status() }; await ctx.close(); continue; }
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  await page.waitForFunction(() => {
    const ds = (window.__demSaBan && window.__demSaBan.bieuTuong()) || [];
    const n = document.querySelectorAll("[data-testid='nhan-cum-sa-ban']").length;
    const k = `${n}|` + ds.map((b) => `${b.toaNhaId}:${Math.round(b.rongPx)}`).join(",");
    const on = window.__k === k && k.length > 2; window.__k = k; return on;
  }, undefined, { timeout: 120_000, polling: 1000 }).catch(() => {});

  await page.screenshot({ path: `${ANH}/${vai}-3d.png` });
  const c = await page.$("canvas");
  if (c) await c.screenshot({ path: `${ANH}/${vai}-3d-canvas.png` }).catch(() => {});

  // 3D: nhãn HIỆN mà bị che một phần
  const d3 = await page.evaluate(() => {
    const lp = [...document.querySelectorAll("[data-che-nhan]")].map((e) => {
      const r = e.getBoundingClientRect();
      return { ten: `${e.tagName}${e.getAttribute("data-testid") ? "#" + e.getAttribute("data-testid") : ""}`,
        trai: r.x, phai: r.x + r.width, tren: r.y, duoi: r.y + r.height };
    }).filter((p) => p.phai > p.trai && p.duoi > p.tren);
    const ds = [...document.querySelectorAll("[data-testid='nhan-toa-sa-ban'],[data-testid='nhan-cum-sa-ban']")];
    const che = [];
    for (const e of ds) {
      if (getComputedStyle(e).display === "none") continue;
      const r = e.getBoundingClientRect();
      let s = 0;
      for (const p of lp) s += Math.max(0, Math.min(r.x + r.width, p.phai) - Math.max(r.x, p.trai)) * Math.max(0, Math.min(r.y + r.height, p.duoi) - Math.max(r.y, p.tren));
      if (s > 0) che.push({ chu: e.textContent.trim(), pc: Math.round((s / (r.width * r.height)) * 1000) / 10 });
    }
    return { soNhan: (window.__demSaBan && window.__demSaBan.soNhan()) || null, cheMotPhan: che, soNhanDom: ds.length };
  });

  await page.getByTestId("nut-che-2d").click({ timeout: 15_000 }).catch(() => {});
  await page.getByTestId("canh-van-hanh-2d").waitFor({ timeout: 45_000 }).catch(() => {});
  await page.waitForFunction(() => {
    const n = document.querySelectorAll("[data-testid='nhan-cum-sa-ban-2d'],[data-testid='toa-2d-sa-ban']").length;
    const on = window.__k2 === n && n > 0; window.__k2 = n; return on;
  }, undefined, { timeout: 45_000, polling: 800 }).catch(() => {});
  await page.screenshot({ path: `${ANH}/${vai}-2d.png` });
  const svgEl = await page.$("[data-testid='canh-van-hanh-2d']");
  if (svgEl) await svgEl.screenshot({ path: `${ANH}/${vai}-2d-svg.png` }).catch(() => {});

  const d2 = await page.evaluate(() => {
    const q = (id) => document.querySelector(`[data-testid='${id}']`);
    const svg = q("canh-van-hanh-2d");
    const lop = q("lop-sa-ban-2d");
    const cum = [...document.querySelectorAll("[data-testid='cum-2d-sa-ban']")];
    const nhan = [...document.querySelectorAll("[data-testid='nhan-cum-sa-ban-2d']")];
    const an = nhan.filter((e) => getComputedStyle(e).visibility === "hidden" || e.getAttribute("data-an") === "1");
    /** Quét lưới trên tấm nền, tìm điểm mà elementFromPoint còn thuộc svg. */
    const doDuongDoc = (factoryId) => {
      const r = cum.find((e) => e.getAttribute("data-factory-id") === String(factoryId));
      if (!r) return { LOI: "không thấy tấm nền" };
      const b = r.getBoundingClientRect();
      const diem = [];
      for (let i = 1; i < 40; i++) for (let j = 1; j < 12; j++) {
        const x = b.x + (b.width * i) / 40, y = b.y + (b.height * j) / 12;
        const el = document.elementFromPoint(x, y);
        if (!el || !svg.contains(el)) continue;
        const t = el.querySelector("title");
        diem.push({ x: Math.round(x), y: Math.round(y), the: el.tagName,
          tid: el.getAttribute("data-testid"), title: t ? t.textContent : null });
      }
      return { soDiemDocDuoc: diem.length, mau: diem.slice(0, 3),
        moiDiemCoTitle: diem.length > 0 && diem.every((d) => d.title && d.title.length > 0) };
    };
    return {
      demNhan: lop ? { ve: +lop.getAttribute("data-nhan-ve"), an: +lop.getAttribute("data-nhan-an"), tong: +lop.getAttribute("data-nhan-tong") } : null,
      soCum: cum.length, soNhanCum: nhan.length,
      nhanCumAn: an.map((e) => ({ chu: e.textContent.trim(), factoryId: +e.getAttribute("data-factory-id") })),
      duongDoc: an.map((e) => ({ chu: e.textContent.trim(), ...doDuongDoc(+e.getAttribute("data-factory-id")) })),
      titleTamNen: cum.map((e) => ({ f: e.getAttribute("data-factory-id"), title: e.querySelector("title") ? e.querySelector("title").textContent : null })),
      titleKhoiToa: [...document.querySelectorAll("[data-testid='toa-2d-sa-ban']")].slice(0, 20)
        .map((e) => ({ toa: e.getAttribute("data-toa-nha-id"), title: e.querySelector("title") ? e.querySelector("title").textContent : null })),
    };
  });

  ra.vai[vai] = { d3, d2 };
  console.log(`\n════════ ${vai} ════════`);
  console.log(`3D soNhan=${JSON.stringify(d3.soNhan)} · nhãn DOM=${d3.soNhanDom} · CHE-MỘT-PHẦN=${d3.cheMotPhan.length} ${JSON.stringify(d3.cheMotPhan)}`);
  console.log(`2D demNhan=${JSON.stringify(d2.demNhan)} · cụm=${d2.soCum} · nhãn cụm=${d2.soNhanCum} · nhãn cụm BỊ ẨN=${d2.nhanCumAn.length}`);
  console.log(`2D <title> tấm nền: ${JSON.stringify(d2.titleTamNen)}`);
  console.log(`2D <title> khối toà (3 đầu): ${JSON.stringify(d2.titleKhoiToa.slice(0, 3))}`);
  if (d2.nhanCumAn.length === 0) console.log(`   ⚠ KHÔNG có nhãn cụm nào bị ẩn ⇒ ca "đường đọc lại" VÔ NGHĨA ở vai này`);
  for (const d of d2.duongDoc) {
    const dung = d.mau && d.mau.some((m) => m.title && m.title.includes(d.chu));
    console.log(`   ẩn "${d.chu}" → ${d.soDiemDocDuoc} điểm di chuột được · mọi điểm có <title>: ${d.moiDiemCoTitle}` +
      ` · <title> CHỨA tên: ${dung ? "CÓ ✓" : "KHÔNG ✗"} · mẫu=${JSON.stringify(d.mau)}`);
  }
  await ctx.close();
}
await trinh.close();
fs.writeFileSync(`.qa-tapdoan/zz-nhan2-do2-${NHAN}.json`, JSON.stringify(ra, null, 1));
console.log(`\n→ ảnh ${ANH}`);
