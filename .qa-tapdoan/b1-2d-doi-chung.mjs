/**
 * b1-2d-doi-chung.mjs — ĐỐI CHỨNG cho câu 3 của BƯỚC 1.
 *
 *   node .qa-tapdoan/b1-2d-doi-chung.mjs <nhan>
 *
 * Chạy ĐÚNG một phép đo trên HAI bản dựng khác nhau (cùng dữ liệu, cùng khung,
 * cùng vai) để tách hai câu hỏi mà một lần chạy KHÔNG tách được:
 *
 *   (i)  Ô 2D ở cấp tập đoàn có đọc được không?           → kích thước px
 *   (ii) Task 20 có làm nó XẤU ĐI không, hay nó vốn đã hỏng? → so t19 vs ph45
 *
 * Task 20 đổi `sanRongMm/sanSauMm` từ khuôn viên THẬT (2.240 m) sang SA BÀN
 * (673 m) — bản 2D đọc chính hai biến ấy làm `viewBox`. Nên không đo bản trước
 * Task 20 thì mọi câu "2D hỏng" đều lẫn với "Task 20 làm hỏng 2D".
 *
 * Đo thêm hai thứ ảnh không nói ra được:
 *   · CHỒNG NHAU: cặp máy có bao hình MÀN HÌNH giao nhau. Nếu sa bàn nén khuôn
 *     viên mà máy giữ kích thước THẬT thì máy phải dồn đống — đó là chỉ dấu
 *     bố cục SAI, khác hẳn "đúng nhưng bé".
 *   · BAO HÌNH toàn bộ máy so với khung SVG: sa bàn chiếm bao nhiêu phần khung.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import { PNG } from "pngjs";

const NHAN = process.argv[2] ?? "x";
const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const RA = `.qa-tapdoan/b1-dc-${NHAN}.json`;
const ANH = `.qa-tapdoan/anh/b1-dc-${NHAN}`;
fs.mkdirSync(ANH, { recursive: true });

function doMuc(duong) {
  if (!fs.existsSync(duong)) return null;
  const png = PNG.sync.read(fs.readFileSync(duong));
  const dem = new Map();
  for (let i = 0; i < png.data.length; i += 4) {
    const k = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
    dem.set(k, (dem.get(k) ?? 0) + 1);
  }
  let nenK = 0;
  let nenN = -1;
  for (const [k, n] of dem) if (n > nenN) ((nenN = n), (nenK = k));
  const nr = (nenK >> 16) & 255;
  const ng = (nenK >> 8) & 255;
  const nb = nenK & 255;
  let khacNen = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const d = Math.abs(png.data[i] - nr) + Math.abs(png.data[i + 1] - ng) + Math.abs(png.data[i + 2] - nb);
    if (d > 24) khacNen += 1;
  }
  const tong = png.width * png.height;
  return {
    w: png.width,
    h: png.height,
    nen: `#${nenK.toString(16).padStart(6, "0")}`,
    pxKhacNen: khacNen,
    tyLeMuc: Math.round((khacNen / tong) * 1000) / 10,
  };
}

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const kq = { nhan: NHAN, luc: new Date().toISOString(), vai: {} };

for (const vai of ["qatd_giamdoc"]) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: MK } });
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  // Ổn định theo SỐ MÁY trong lô (có ở CẢ HAI bản dựng — `__demSaBan` chỉ có ở bản sau).
  await page
    .waitForFunction(
      () => {
        const n = window.__demTuongTac?.dsMay?.()?.length ?? -1;
        const on = window.__b1dc === n && n > 0;
        window.__b1dc = n;
        return on;
      },
      undefined,
      { timeout: 120_000, polling: 1200 },
    )
    .catch(() => {});

  const truoc3d = await page.evaluate(() => ({
    soMay3D: window.__demTuongTac?.dsMay?.()?.length ?? -1,
    soBieuTuong: window.__demSaBan?.bieuTuong?.()?.length ?? null,
    thongKe: window.__thongKeVe ?? null,
  }));
  const c3 = await page.$("canvas");
  if (c3) await c3.screenshot({ path: `${ANH}/${vai}-3d.png` }).catch(() => {});

  await page.getByTestId("nut-che-2d").click({ timeout: 15_000 });
  await page.getByTestId("canh-van-hanh-2d").waitFor({ timeout: 30_000 });
  await page
    .waitForFunction(
      () => {
        const n = document.querySelectorAll("[data-testid^='may-2d-']").length;
        const on = window.__b1dc2 === n && n > 0;
        window.__b1dc2 = n;
        return on;
      },
      undefined,
      { timeout: 60_000, polling: 800 },
    )
    .catch(() => {});

  await page.screenshot({ path: `${ANH}/${vai}-2d-toan-man.png` });
  const osvg = await page.$("[data-testid='canh-van-hanh-2d']");
  if (osvg) await osvg.screenshot({ path: `${ANH}/${vai}-2d-svg.png` }).catch(() => {});

  const d = await page.evaluate(() => {
    const svg = document.querySelector("[data-testid='canh-van-hanh-2d']");
    const rs = svg.getBoundingClientRect();
    const g = [...document.querySelectorAll("[data-testid^='may-2d-']")];
    const hop = [];
    for (const el of g) {
      const r = el.querySelector("rect")?.getBoundingClientRect();
      if (r) hop.push({ x: r.x, y: r.y, w: r.width, h: r.height });
    }
    // CHỒNG NHAU — lưới băm ô 8 px để không phải so 1108² cặp.
    const O = 8;
    const luoi = new Map();
    let chong = 0;
    const daSo = new Set();
    hop.forEach((a, i) => {
      const i0 = Math.floor(a.x / O);
      const i1 = Math.floor((a.x + a.w) / O);
      const j0 = Math.floor(a.y / O);
      const j1 = Math.floor((a.y + a.h) / O);
      for (let i2 = i0; i2 <= i1; i2 += 1)
        for (let j2 = j0; j2 <= j1; j2 += 1) {
          const k = `${i2},${j2}`;
          const ds = luoi.get(k);
          if (ds) {
            for (const j of ds) {
              const key = i < j ? `${i}|${j}` : `${j}|${i}`;
              if (daSo.has(key)) continue;
              const b = hop[j];
              if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
                daSo.add(key);
                chong += 1;
              }
            }
            ds.push(i);
          } else luoi.set(k, [i]);
        }
    });
    const xs = hop.map((h) => h.x);
    const ys = hop.map((h) => h.y);
    const xe = hop.map((h) => h.x + h.w);
    const ye = hop.map((h) => h.y + h.h);
    const bao = hop.length
      ? { trai: Math.min(...xs), tren: Math.min(...ys), phai: Math.max(...xe), duoi: Math.max(...ye) }
      : null;
    const ws = hop.map((h) => h.w).sort((a, b) => a - b);
    // Số Ô 1px bị máy phủ (diện tích "mực" theo MÔ HÌNH, so được với mực ẢNH).
    const o1 = new Set();
    for (const h of hop) {
      const i0 = Math.round(h.x);
      const j0 = Math.round(h.y);
      for (let i = i0; i <= Math.round(h.x + h.w); i += 1)
        for (let j = j0; j <= Math.round(h.y + h.h); j += 1) o1.add(`${i},${j}`);
    }
    return {
      viewBox: svg.getAttribute("viewBox"),
      hopSvg: { x: Math.round(rs.x), y: Math.round(rs.y), w: Math.round(rs.width), h: Math.round(rs.height) },
      soMay: hop.length,
      rongPx: {
        min: Math.round((ws[0] ?? 0) * 100) / 100,
        p50: Math.round((ws[Math.floor(ws.length / 2)] ?? 0) * 100) / 100,
        max: Math.round((ws.at(-1) ?? 0) * 100) / 100,
      },
      duoi1px: ws.filter((w) => w < 1).length,
      duoi4px: ws.filter((w) => w < 4).length,
      duoi24px: ws.filter((w) => w < 24).length,
      capChongNhau: chong,
      baoHinhMay: bao
        ? {
            trai: Math.round(bao.trai),
            tren: Math.round(bao.tren),
            phai: Math.round(bao.phai),
            duoi: Math.round(bao.duoi),
            w: Math.round(bao.phai - bao.trai),
            h: Math.round(bao.duoi - bao.tren),
          }
        : null,
      oPhu1px: o1.size,
      soNhan: svg.querySelectorAll("text").length,
      banner: [...document.querySelectorAll("[data-testid^='banner-']")].map((e) => e.getAttribute("data-testid")),
    };
  });

  d.mucAnh2D = doMuc(`${ANH}/${vai}-2d-svg.png`);
  d.mucAnh3D = doMuc(`${ANH}/${vai}-3d.png`);
  d.truoc3d = truoc3d;
  kq.vai[vai] = d;
  console.log(
    `[${NHAN}] ${vai}: 3D soMay=${truoc3d.soMay3D} bieuTuong=${truoc3d.soBieuTuong} | 2D viewBox="${d.viewBox}"` +
      ` soMay=${d.soMay} rongPx=${d.rongPx.min}..${d.rongPx.max}(p50 ${d.rongPx.p50}) <1px=${d.duoi1px} <4px=${d.duoi4px}` +
      ` chongNhau=${d.capChongNhau} bao=${d.baoHinhMay?.w}×${d.baoHinhMay?.h} oPhu=${d.oPhu1px}` +
      ` mực2D=${d.mucAnh2D?.tyLeMuc}% mực3D=${d.mucAnh3D?.tyLeMuc}%`,
  );
  await ctx.close();
}

await trinh.close();
fs.writeFileSync(RA, JSON.stringify(kq, null, 1));
console.log(`→ ${RA} · ảnh ${ANH}`);
