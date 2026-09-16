/**
 * b1-do-2d.mjs — BƯỚC 1 của việc "HAI CHIỀU": ĐO ô 2D ở phạm vi tập đoàn,
 * TRƯỚC khi sửa một dòng nào.
 *
 *   node .qa-tapdoan/b1-do-2d.mjs <nhan>       # nhan mặc định "truoc"
 *
 * Ba câu của chủ đợt, đo đúng thứ chúng hỏi:
 *  ① Ở `?pv=tapdoan`, bản 2D VẼ GÌ: bao nhiêu vật thể DOM thật, mỗi cái rộng
 *    bao nhiêu **pixel màn hình** (đo bằng `getBoundingClientRect` của chính
 *    `<rect>`, không suy từ toạ độ mô hình), và ĐỌC ĐƯỢC không.
 *  ② Cùng khung, cùng vai, bản 3D cho gì (chạy lại chính phép đo sa bàn).
 *  ③ 2D có dính đúng bệnh "tỉ lệ nuốt vật thể" của 3D trước Task 20 không.
 *
 * ★★★ CHỐNG TỰ THOẢ — KHÔNG kết luận "đọc được" từ toạ độ chiếu.
 *   Task 19 từng khai "3 khối" từ toạ độ chiếu trong khi ẢNH vẫn đen. Nên phép
 *   quyết định ở đây là PIXEL THẬT: chụp đúng vùng cảnh rồi đếm pixel khác nền
 *   bằng pngjs ở NODE (ngoài trang, trang không tự chấm điểm cho mình).
 *
 * ⚠ Playwright mặc định SwiftShader ⇒ thêm ANGLE+GPU cho phần 3D.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import { PNG } from "pngjs";

const NHAN = process.argv[2] ?? "truoc";
const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const RA = `.qa-tapdoan/b1-2d-${NHAN}.json`;
const ANH = `.qa-tapdoan/anh/b1-${NHAN}`;
fs.mkdirSync(ANH, { recursive: true });

const TT = JSON.parse(fs.readFileSync(".qa-tapdoan/sinh-summary.json", "utf8"));
const NHA_MAY = new Map(TT.congTys.map((c) => [c.id, c.code]));
console.log("nhà máy QATD (từ bộ sinh):", [...NHA_MAY].map(([id, m]) => `${m}=${id}`).join(" · "));
console.log("tổng máy theo bộ sinh:", TT.congTys.reduce((s, c) => s + c.tongMay, 0));

/** Đếm pixel "có mực" trong một ảnh PNG: khác pixel nền phổ biến nhất quá ngưỡng. */
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
    const d =
      Math.abs(png.data[i] - nr) + Math.abs(png.data[i + 1] - ng) + Math.abs(png.data[i + 2] - nb);
    if (d > 24) khacNen += 1;
  }
  const tong = png.width * png.height;
  return {
    w: png.width,
    h: png.height,
    nen: `#${nenK.toString(16).padStart(6, "0")}`,
    tyLeNen: Math.round((nenN / tong) * 1000) / 10,
    pxKhacNen: khacNen,
    tyLeMuc: Math.round((khacNen / tong) * 1000) / 10,
    soMauRieng: dem.size,
  };
}

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});

const ketQua = { nhan: NHAN, luc: new Date().toISOString(), vai: {} };

for (const vai of ["qatd_giamdoc", "qatd_quanly"]) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const loi = [];
  page.on("pageerror", (e) => loi.push(String(e).slice(0, 200)));
  const dn = await page.request.post(`${GOC}/api/auth/login`, {
    data: { username: vai, password: MK },
  });
  if (!dn.ok()) {
    ketQua.vai[vai] = { LOI: `dang nhap ${dn.status()}` };
    await ctx.close();
    continue;
  }

  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  await page
    .waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, undefined, { timeout: 120_000 })
    .catch(() => {});
  // Sa bàn ỔN ĐỊNH: hai lần đọc liên tiếp cùng khoá (không dùng cửa sổ cố định).
  await page
    .waitForFunction(
      () => {
        const ds = window.__demSaBan?.bieuTuong?.() ?? [];
        const khoa = ds.map((b) => `${b.toaNhaId}:${Math.round(b.rongPx)}`).join(",");
        const on = window.__b1_truoc === khoa && ds.length > 0;
        window.__b1_truoc = khoa;
        return on;
      },
      undefined,
      { timeout: 120_000, polling: 1200 },
    )
    .catch(() => {});

  // ── ẢNH 3D (khung mặc định, chưa bấm gì) ──────────────────────────────────
  await page.screenshot({ path: `${ANH}/${vai}-3d-1-toan-man.png` });
  const o3d = await page.$("canvas");
  if (o3d) await o3d.screenshot({ path: `${ANH}/${vai}-3d-2-canvas.png` }).catch(() => {});

  const doc3d = await page.evaluate(() => {
    const q = (id) => document.querySelector(`[data-testid='${id}']`);
    const c = document.querySelector("canvas");
    const r = c?.getBoundingClientRect();
    const bt = window.__demSaBan?.bieuTuong?.() ?? [];
    return {
      hopCanh: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      soBieuTuong: bt.length,
      rongPx: bt.map((b) => Math.round(b.rongPx * 10) / 10),
      soNhanDom: document.querySelectorAll(
        "[data-testid='nhan-toa-sa-ban'],[data-testid='nhan-cum-sa-ban']",
      ).length,
      thongKe: window.__thongKeVe ?? null,
      demMay: q("dem-may")?.textContent?.trim() ?? null,
      nutChe: q("nut-che-2d") ? q("nut-che-2d").textContent.trim() : null,
      ariaCanh: (() => {
        const e = document.querySelector("canvas")?.closest("[aria-label]");
        return e?.getAttribute("aria-label") ?? null;
      })(),
    };
  });

  // ── BẤM SANG 2D ───────────────────────────────────────────────────────────
  await page.getByTestId("nut-che-2d").click({ timeout: 10_000 });
  await page.getByTestId("canh-van-hanh-2d").waitFor({ timeout: 30_000 }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const n = document.querySelectorAll("[data-testid^='may-2d-']").length;
        const on = window.__b1_2d === n && n >= 0;
        window.__b1_2d = n;
        return on;
      },
      undefined,
      { timeout: 60_000, polling: 800 },
    )
    .catch(() => {});

  await page.screenshot({ path: `${ANH}/${vai}-2d-1-toan-man.png` });
  const oSvg = await page.$("[data-testid='canh-van-hanh-2d']");
  if (oSvg) await oSvg.screenshot({ path: `${ANH}/${vai}-2d-2-svg.png` }).catch(() => {});

  const doc2d = await page.evaluate(() => {
    const q = (id) => document.querySelector(`[data-testid='${id}']`);
    const svg = q("canh-van-hanh-2d");
    const rs = svg?.getBoundingClientRect();
    const g = [...document.querySelectorAll("[data-testid^='may-2d-']")];
    // Kích thước MÀN HÌNH của từng máy: đo trên chính <rect> con đầu tiên.
    const kt = g.map((el) => {
      const r = el.querySelector("rect")?.getBoundingClientRect();
      return r
        ? {
            id: Number(el.getAttribute("data-testid").replace("may-2d-", "")),
            tt: el.getAttribute("data-trang-thai"),
            w: Math.round(r.width * 100) / 100,
            h: Math.round(r.height * 100) / 100,
            x: Math.round(r.x * 10) / 10,
            y: Math.round(r.y * 10) / 10,
          }
        : null;
    });
    const san = svg?.querySelector("rect");
    const rSan = san?.getBoundingClientRect();
    return {
      coSvg: !!svg,
      viewBox: svg?.getAttribute("viewBox") ?? null,
      hopSvg: rs ? { x: Math.round(rs.x), y: Math.round(rs.y), w: Math.round(rs.width), h: Math.round(rs.height) } : null,
      hopSan: rSan
        ? { x: Math.round(rSan.x), y: Math.round(rSan.y), w: Math.round(rSan.width), h: Math.round(rSan.height) }
        : null,
      soMay: g.length,
      kichThuoc: kt.filter(Boolean),
      soNhanText: svg ? svg.querySelectorAll("text").length : -1,
      // Bản 2D có bất kỳ lời khai nào về sa bàn / đơn vị vẽ không?
      coBieuTuongSaBan2D: document.querySelectorAll(
        "[data-testid='nhan-toa-sa-ban'],[data-testid='nhan-cum-sa-ban']",
      ).length,
      demMay: q("dem-may")?.textContent?.trim() ?? null,
      nutChe: q("nut-che-2d") ? q("nut-che-2d").textContent.trim() : null,
      ariaSvg: svg?.getAttribute("aria-label") ?? null,
      // MỌI banner/lời khai đang hiện ở chế độ 2D — để biết màn có NÓI RA gì không.
      banner: [...document.querySelectorAll("[data-testid^='banner-']")].map((e) => ({
        id: e.getAttribute("data-testid"),
        chu: e.textContent.trim().slice(0, 200),
      })),
      thongKe: window.__thongKeVe ?? null,
      soCanvas: document.querySelectorAll("canvas").length,
    };
  });

  // ── PIXEL THẬT (đếm ở node, không hỏi trang) ──────────────────────────────
  const muc = {
    "3d-canvas": doMuc(`${ANH}/${vai}-3d-2-canvas.png`),
    "2d-svg": doMuc(`${ANH}/${vai}-2d-2-svg.png`),
  };

  const ws = doc2d.kichThuoc.map((k) => k.w).sort((a, b) => a - b);
  const hs = doc2d.kichThuoc.map((k) => k.h).sort((a, b) => a - b);
  const th = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : null);

  const o = {
    ba_3D: doc3d,
    ba_2D: {
      ...doc2d,
      kichThuoc: undefined,
      soMayDuoi1px: ws.filter((w) => w < 1).length,
      soMayDuoi4px: ws.filter((w) => w < 4).length,
      soMayDuoi24px: ws.filter((w) => w < 24).length,
      rongPx: { min: ws[0] ?? null, p50: th(ws, 0.5), max: ws.at(-1) ?? null },
      caoPx: { min: hs[0] ?? null, p50: th(hs, 0.5), max: hs.at(-1) ?? null },
      mau10: doc2d.kichThuoc.slice(0, 10),
    },
    mucAnh: muc,
    loi,
  };
  ketQua.vai[vai] = o;

  console.log(
    `\n[${vai}] 3D: bieuTuong=${doc3d.soBieuTuong} rongPx=${doc3d.rongPx.length ? Math.min(...doc3d.rongPx) + ".." + Math.max(...doc3d.rongPx) : "-"}` +
      ` nhan=${doc3d.soNhanDom} calls=${doc3d.thongKe?.calls} tri=${doc3d.thongKe?.triangles} demMay="${doc3d.demMay}"`,
  );
  console.log(
    `[${vai}] 2D: svg=${doc2d.coSvg} viewBox="${doc2d.viewBox}" hopSvg=${JSON.stringify(doc2d.hopSvg)}` +
      ` soMay=${doc2d.soMay} rongPx=${o.ba_2D.rongPx.min}..${o.ba_2D.rongPx.max} (p50=${o.ba_2D.rongPx.p50})` +
      ` <1px=${o.ba_2D.soMayDuoi1px} <4px=${o.ba_2D.soMayDuoi4px} <24px=${o.ba_2D.soMayDuoi24px}` +
      ` nhanText=${doc2d.soNhanText} canvas=${doc2d.soCanvas} demMay="${doc2d.demMay}"`,
  );
  console.log(`[${vai}] mực: 3D=${JSON.stringify(muc["3d-canvas"])}`);
  console.log(`[${vai}] mực: 2D=${JSON.stringify(muc["2d-svg"])}`);
  console.log(`[${vai}] banner ở 2D: ${JSON.stringify(doc2d.banner.map((b) => b.id))}`);
  await ctx.close();
}

await trinh.close();
fs.writeFileSync(RA, JSON.stringify(ketQua, null, 1));
console.log(`\n→ ${RA}  ·  ảnh: ${ANH}`);
