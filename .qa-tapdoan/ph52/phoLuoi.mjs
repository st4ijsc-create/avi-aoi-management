/**
 * ph52/phoLuoi.mjs — ĐO BƯỚC LƯỚI TRÊN MÀN HÌNH, BẰNG PIXEL, TỪ CHÍNH ẢNH CHỤP.
 *
 * Câu hỏi của việc ③ là "một ô lưới rộng bao nhiêu PIXEL", và câu ấy KHÔNG nên
 * trả lời bằng công thức camera (foreshortening làm bước ô đổi theo từng dòng).
 * Nên đo thẳng trên ảnh: tự tương quan 2 chiều của vùng sàn thuần; chu kỳ lưới
 * là véc-tơ trễ NHỎ NHẤT (khác 0) mà tại đó tương quan đạt cực đại địa phương.
 *
 * ★ Chống tự thoả: vùng phải có tương phản thật (độ lệch chuẩn ≥ 0,5 mức) và
 *   đỉnh phải NHỌN hơn nền (tỉ số đỉnh/trung vị ≥ 1,05), nếu không thì in
 *   "KHÔNG THẤY CHU KỲ" thay vì bịa ra một con số.
 *
 *   node .qa-tapdoan/ph52/phoLuoi.mjs <anh.png> <x0> <y0> <x1> <y1> [nhan]
 */
import fs from "node:fs";
import { PNG } from "pngjs";

const [tep, x0, y0, x1, y1] = [process.argv[2], ...process.argv.slice(3, 7).map(Number)];
const NHAN = process.argv[7] ?? "";
const A = PNG.sync.read(fs.readFileSync(tep));
if (!(x0 >= 0 && y0 >= 0 && x1 <= A.width && y1 <= A.height && x1 > x0 && y1 > y0))
  throw new Error(`VÙNG SAI [${x0},${y0},${x1},${y1}] trên ảnh ${A.width}×${A.height}`);

const W = x1 - x0;
const H = y1 - y0;
const g = new Float64Array(W * H);
let tong = 0;
for (let y = 0; y < H; y += 1)
  for (let x = 0; x < W; x += 1) {
    const i = ((y + y0) * A.width + (x + x0)) * 4;
    const v = 0.299 * A.data[i] + 0.587 * A.data[i + 1] + 0.114 * A.data[i + 2];
    g[y * W + x] = v;
    tong += v;
  }
const tb = tong / (W * H);
let bp = 0;
for (let k = 0; k < W * H; k += 1) {
  g[k] -= tb;
  bp += g[k] * g[k];
}
const lechChuan = Math.sqrt(bp / (W * H));
if (lechChuan < 0.5) {
  console.log(JSON.stringify({ tep, nhan: NHAN, vung: [x0, y0, x1, y1], lechChuan, ket: "VÙNG PHẲNG — không đo được" }));
  process.exit(0);
}

const TRE_TOI_DA = Math.min(40, Math.floor(Math.min(W, H) / 3));
/** Tự tương quan chuẩn hoá tại trễ (dx, dy). */
function tuong(dx, dy) {
  let s = 0;
  let n = 0;
  for (let y = Math.max(0, -dy); y < Math.min(H, H - dy); y += 1)
    for (let x = Math.max(0, -dx); x < Math.min(W, W - dx); x += 1) {
      s += g[y * W + x] * g[(y + dy) * W + (x + dx)];
      n += 1;
    }
  return n > 0 ? s / n / (lechChuan * lechChuan) : 0;
}

// Quét nửa mặt phẳng trễ (dy ≥ 0, và dy = 0 thì dx > 0) — đối xứng nên đủ.
const o = [];
for (let dy = 0; dy <= TRE_TOI_DA; dy += 1)
  for (let dx = -TRE_TOI_DA; dx <= TRE_TOI_DA; dx += 1) {
    if (dy === 0 && dx <= 0) continue;
    o.push({ dx, dy, r: tuong(dx, dy), d: Math.hypot(dx, dy) });
  }
const trungVi = [...o].sort((a, b) => a.r - b.r)[Math.floor(o.length / 2)].r;

// Cực đại địa phương: r lớn hơn mọi ô kề trong bán kính 1.
const banDo = new Map(o.map((p) => [`${p.dx},${p.dy}`, p.r]));
const dinh = o
  .filter((p) => {
    if (p.r < trungVi + 0.05) return false;
    for (let ax = -1; ax <= 1; ax += 1)
      for (let ay = -1; ay <= 1; ay += 1) {
        if (ax === 0 && ay === 0) continue;
        const k = `${p.dx + ax},${p.dy + ay}`;
        if (banDo.has(k) && banDo.get(k) > p.r) return false;
      }
    return true;
  })
  // ⚠ BỎ trễ 1 px: mọi ảnh đều có tương quan cao ở (±1,0)/(0,±1) chỉ vì pixel kề
  //   nhau thì giống nhau (khử răng cưa, nén). Lấy nó làm "bước lưới" là đo độ
  //   mượt của ảnh, không đo lưới. Và xếp theo ĐỘ MẠNH, không theo độ gần.
  .filter((p) => p.d >= 2)
  .sort((a, b) => b.r - a.r);

const ket = {
  tep,
  nhan: NHAN,
  vung: [x0, y0, x1, y1],
  coPx: `${W}×${H}`,
  lechChuan: Number(lechChuan.toFixed(3)),
  trungViTuong: Number(trungVi.toFixed(4)),
  dinhManhNhat: dinh[0] ? { dx: dinh[0].dx, dy: dinh[0].dy, r: Number(dinh[0].r.toFixed(4)), buocPx: Number(dinh[0].d.toFixed(2)) } : null,
  baDinhDau: dinh.slice(0, 4).map((p) => `(${p.dx},${p.dy}) r=${p.r.toFixed(3)} ${p.d.toFixed(2)}px`),
};
if (!dinh[0] || dinh[0].r < trungVi * 1.05 + 0.05) ket.canhBao = "KHÔNG THẤY CHU KỲ RÕ";
console.log(JSON.stringify(ket));
console.log(
  `  ${NHAN.padEnd(22)} ${W}×${H}px · lệch chuẩn ${lechChuan.toFixed(2)} · ` +
    `BƯỚC LƯỚI ≈ ${dinh[0] ? dinh[0].d.toFixed(2) : "—"} px  [${ket.baDinhDau.join(" · ")}]`,
);
