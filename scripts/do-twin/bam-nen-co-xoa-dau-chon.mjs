/**
 * v6-n3-vien4.mjs — N3/PH-42 lượt 4: TÁCH LỚP DOM RA KHỎI PHÉP ĐO CẢNH.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BA LƯỢT TRƯỚC ĐỀU ĐO NHẦM THỨ KHÁC — VÀ MỖI LẦN ĐỐI CHỨNG BẮT ĐƯỢC
 * ════════════════════════════════════════════════════════════════════════════
 *   lượt 1 — ô cắt CỐ ĐỊNH trên màn → 87,28 % khác, LỚN HƠN cả đối chứng dương.
 *            Máy dò `dsMay()` chỉ ra: **40/40 máy đổi toạ độ** ⇒ đo camera, không đo viền.
 *   lượt 2 — ô cắt NEO VÀO MÁY → đối chứng dương **0 px** ⇒ "mù", không kết luận được.
 *   lượt 3 — so TOÀN CANVAS ở ②↔③ (camera bất động, xác nhận tới 3 chữ số thập phân)
 *            → 98,89 % khác. Dò DOM ra thủ phạm: **lớp nền mờ 1600×900 `data-state="open"`**
 *            của ngăn chi tiết Radix. Ngăn ấy **buộc chặt** vào `selectedId`
 *            (`onOpenChange={(o) => !o && setSelectedId(null)}`) nên không tắt riêng được.
 *
 * ⇒ Lượt này **ẩn đúng lớp DOM ấy** ngay trước khi chụp, rồi trả lại. WebGL bên dưới không
 *   hề biết, nên cảnh 3D giữ nguyên — đây là tách nhiễu, không phải sửa đề bài.
 *
 * ★ Ba đối chứng vẫn chạy: camera bất động · canvas cùng cỡ · ④↔③ phải bằng 0.
 */
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = "http://127.0.0.1:3000";
const nghi = (m) => new Promise((r) => setTimeout(r, m));
const NGUONG = 8;

async function soAnh(a, b) {
  const [ra, rb] = await Promise.all([
    sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (ra.data.length !== rb.data.length) return { loi: "khác cỡ" };
  const W = ra.info.width;
  let khac = 0, lechMax = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < ra.data.length; i += 4) {
    const d = Math.max(
      Math.abs(ra.data[i] - rb.data[i]),
      Math.abs(ra.data[i + 1] - rb.data[i + 1]),
      Math.abs(ra.data[i + 2] - rb.data[i + 2]),
    );
    if (d > lechMax) lechMax = d;
    if (d > NGUONG) {
      khac++;
      const px = (i / 4) % W, py = Math.floor(i / 4 / W);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  return {
    khac, tong: ra.data.length / 4, tiLe: (100 * khac) / (ra.data.length / 4), lechMax,
    hop: khac ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
  };
}

const b = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const c = await b.newContext({ viewport: { width: 1600, height: 900 } });
await c.request.post(`${BASE}/api/auth/login`, {
  data: { username: "qatd_admin", password: "Qatd!2026" },
});
const p = await c.newPage();
await p.goto(`${BASE}/factory-command?do=1`, { waitUntil: "domcontentloaded" });
await nghi(14000);
await p.click('text="3D"').catch(() => {});
await nghi(14000);

const banDo = () =>
  p.evaluate(() => {
    const o = {};
    for (const m of window.__demTuongTac?.dsMay?.() ?? []) o[m.machineId] = [m.x, m.y];
    return o;
  });
const so = () =>
  p.evaluate(() => ({
    soChon: window.__demChonChiHuy?.() ?? null,
    nhanVe: (window.__demTuongTac?.hopNhanDaVe?.() ?? []).length,
    drawer: document.querySelectorAll('[role="dialog"]').length,
  }));

/** Ẩn ngăn chi tiết + lớp nền mờ; trả về SỐ phần tử đã ẩn để còn đối chiếu. */
const anNgan = () =>
  p.evaluate(() => {
    const ds = [...document.querySelectorAll('[role="dialog"], [data-state="open"]')].filter((el) => {
      const s = getComputedStyle(el);
      return s.position === "fixed" || s.position === "absolute";
    });
    window.__anTam = ds.map((el) => [el, el.style.visibility]);
    for (const el of ds) el.style.visibility = "hidden";
    return ds.length;
  });
const hienNgan = () =>
  p.evaluate(() => {
    for (const [el, v] of window.__anTam ?? []) el.style.visibility = v;
    delete window.__anTam;
  });

const bd1 = await banDo();
const cv1 = await p.locator("canvas").first().boundingBox();
const uv = Object.entries(bd1)
  .filter(([, v]) => v[0] > 150 && v[0] < cv1.width * 0.45 && v[1] > 150 && v[1] < cv1.height - 150)
  .sort((a, b2) => a[1][0] - b2[1][0])[0];
if (!uv) { console.log("không có ứng viên"); await b.close(); process.exit(0); }

// ② CHỌN
await p.mouse.click(cv1.x + uv[1][0], cv1.y + uv[1][1]);
await nghi(3500);
const s2 = await so();
const bd2 = await banDo();
const id = s2.soChon?.trang;
if (id == null) { console.log("không chọn được ⇒ lỗi hệ đo"); await b.close(); process.exit(0); }
const cv2 = await p.locator("canvas").first().boundingBox();
const o = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });

const soAn = await anNgan();
await nghi(600);
const a2 = await p.screenshot({ path: "scripts/do-twin/_tho/n3d-2-chon.png", clip: o(cv2) });
await hienNgan();
console.log(`② chọn   : id=${id} ẩn ${soAn} lớp DOM ${JSON.stringify(s2)}`);

// ③ BẤM NỀN
await p.mouse.click(cv1.x + 12, cv1.y + cv1.height - 12);
await nghi(3500);
const s3 = await so();
const bd3 = await banDo();
const cv3 = await p.locator("canvas").first().boundingBox();
const a3 = await p.screenshot({ path: "scripts/do-twin/_tho/n3d-3-nen.png", clip: o(cv2) });
console.log(`③ bấm nền: ${JSON.stringify(s3)}`);

// ④ ĐỐI CHỨNG ÂM
await nghi(3000);
const a4 = await p.screenshot({ path: "scripts/do-twin/_tho/n3d-4-am.png", clip: o(cv2) });

console.log(`\ncamera ②→③: ${JSON.stringify(bd2[id])} → ${JSON.stringify(bd3[id])} ⇒ ${JSON.stringify(bd2[id]) === JSON.stringify(bd3[id]) ? "ĐỨNG YÊN ✅" : "ĐÃ DỊCH ❌"}`);
console.log(`canvas cùng cỡ: ${cv2.width === cv3.width && cv2.height === cv3.height ? "CÓ ✅" : "KHÔNG ❌"}`);

const am = await soAnh(a4, a3);
console.log(`\nĐỐI CHỨNG ÂM ④↔③: ${am.khac}/${am.tong} px (${am.tiLe.toFixed(3)} %) ⇒ ${am.tiLe < 0.05 ? "đứng yên ✅" : "❌ tự đổi"}`);
const kq = await soAnh(a2, a3);
console.log(`CÂU HỎI THẬT ②↔③: ${kq.khac}/${kq.tong} px (${kq.tiLe.toFixed(3)} %), lệch tối đa ${kq.lechMax}`);
console.log(`vùng khác       : ${kq.hop ? `${kq.hop.w}×${kq.hop.h} tại (${kq.hop.x},${kq.hop.y})` : "(không có)"}`);
console.log(`máy ${id} trên ảnh ở (${(bd2[id][0]).toFixed(0)},${(bd2[id][1]).toFixed(0)})`);
console.log(
  kq.khac === 0
    ? "⇒ ⚠ bấm nền KHÔNG đổi một pixel nào của CẢNH ⇒ dấu chọn hoặc không tồn tại, hoặc CÒN SÓT"
    : "⇒ ✅ bấm nền CÓ xoá dấu chọn khỏi cảnh",
);
await b.close();
