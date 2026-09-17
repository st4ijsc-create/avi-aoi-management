/**
 * zf/so.mjs — % PIXEL "ĐỔI BÊN THẮNG" trong MỘT VÙNG SÀN THUẦN 3D.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO PHÉP NÀY TÁCH ĐƯỢC Z-FIGHTING KHỎI RĂNG CƯA LƯỚI
 * ════════════════════════════════════════════════════════════════════════════
 * Ma trận phối cảnh của three.js chỉ dùng `near`/`far` ở HAI ô của cột z
 * (`(far+near)/(near-far)` và `2·far·near/(near-far)`). Hai ô quyết định x/y là
 * `f/aspect` và `f` — CHỈ phụ thuộc fov và aspect. Nên đổi RIÊNG `near` (hoặc
 * `far`) KHÔNG dịch một pixel nào của phép chiếu: mọi tam giác phủ ĐÚNG những
 * pixel cũ, mọi đường lưới rơi vào ĐÚNG chỗ cũ, răng cưa lặp lại Y HỆT.
 * Thứ DUY NHẤT đổi là giá trị độ sâu ghi/so. ⇒ pixel nào đổi màu dưới một
 * NHIỄU ĐỘ SÂU THUẦN thì đổi vì phép so độ sâu lật, tức z-fighting.
 *
 * Lập luận ấy là LỜI KHAI cho tới khi có đối chứng: `zf/bien.mjs probe` nâng
 * lưới lên 5 m (z-fighting bất khả) mà GIỮ NGUYÊN mật độ lưới; nếu con số vẫn
 * cao thì thước này đang đo thứ khác và lập luận trên SAI.
 *
 *   node .qa-tapdoan/zf/so.mjs <A.png> <B.png> <x0> <y0> <x1> <y1> [ra-to-do.png]
 */
import fs from "node:fs";
import { PNG } from "pngjs";

const [pA, pB] = [process.argv[2], process.argv[3]];
const [x0, y0, x1, y1] = process.argv.slice(4, 8).map(Number);
const raDo = process.argv[8] ?? null;

const A = PNG.sync.read(fs.readFileSync(pA));
const B = PNG.sync.read(fs.readFileSync(pB));
if (A.width !== B.width || A.height !== B.height)
  throw new Error(`KHÁC CỠ ẢNH ${A.width}x${A.height} vs ${B.width}x${B.height}`);
if (!(x0 >= 0 && y0 >= 0 && x1 <= A.width && y1 <= A.height && x1 > x0 && y1 > y0))
  throw new Error(`VÙNG SAI [${x0},${y0},${x1},${y1}] trên ảnh ${A.width}x${A.height}`);

const rong = x1 - x0;
const cao = y1 - y0;
const tong = rong * cao;
if (tong <= 0) throw new Error("VÙNG RỖNG");

// ── Chống tự thoả: hai ảnh phải CÓ NỘI DUNG trong vùng (≥ 2 màu), nếu không thì
//    "0 % đổi" chỉ chứng minh ta đang so hai tấm trống với nhau.
const mau = (P) => {
  const s = new Set();
  for (let y = y0; y < y1; y += 1)
    for (let x = x0; x < x1; x += 1) {
      const i = (y * P.width + x) * 4;
      s.add(`${P.data[i]},${P.data[i + 1]},${P.data[i + 2]}`);
    }
  return s.size;
};
const mauA = mau(A);
const mauB = mau(B);
if (mauA < 2 || mauB < 2) throw new Error(`VÙNG TRỐNG: số màu A=${mauA} B=${mauB} (cần ≥ 2)`);

const nguongs = [0, 6, 24];
const dem = Object.fromEntries(nguongs.map((n) => [n, 0]));
const doi = new Uint8Array(tong); // mặt nạ ngưỡng 6 — để đếm mảng loang
let tongLech = 0;
for (let y = y0; y < y1; y += 1)
  for (let x = x0; x < x1; x += 1) {
    const i = (y * A.width + x) * 4;
    const d =
      Math.abs(A.data[i] - B.data[i]) +
      Math.abs(A.data[i + 1] - B.data[i + 1]) +
      Math.abs(A.data[i + 2] - B.data[i + 2]);
    tongLech += d;
    for (const n of nguongs) if (d > n) dem[n] += 1;
    if (d > 6) doi[(y - y0) * rong + (x - x0)] = 1;
  }

// ── Mảng loang (4 láng giềng) trên mặt nạ ngưỡng 6.
let soMang = 0;
let mangLon = 0;
const tham = new Uint8Array(tong);
const ngan = new Int32Array(tong);
for (let k = 0; k < tong; k += 1) {
  if (!doi[k] || tham[k]) continue;
  soMang += 1;
  let dau = 0;
  let cuoi = 0;
  ngan[cuoi++] = k;
  tham[k] = 1;
  let cỡ = 0;
  while (dau < cuoi) {
    const c = ngan[dau++];
    cỡ += 1;
    const cx = c % rong;
    const cy = (c - cx) / rong;
    const lang = [];
    if (cx > 0) lang.push(c - 1);
    if (cx < rong - 1) lang.push(c + 1);
    if (cy > 0) lang.push(c - rong);
    if (cy < cao - 1) lang.push(c + rong);
    for (const l of lang) if (doi[l] && !tham[l]) { tham[l] = 1; ngan[cuoi++] = l; }
  }
  if (cỡ > mangLon) mangLon = cỡ;
}

if (raDo) {
  const R = new PNG({ width: rong, height: cao });
  for (let y = 0; y < cao; y += 1)
    for (let x = 0; x < rong; x += 1) {
      const i = ((y + y0) * B.width + (x + x0)) * 4;
      const j = (y * rong + x) * 4;
      if (doi[y * rong + x]) { R.data[j] = 255; R.data[j + 1] = 0; R.data[j + 2] = 255; }
      else { R.data[j] = B.data[i]; R.data[j + 1] = B.data[i + 1]; R.data[j + 2] = B.data[i + 2]; }
      R.data[j + 3] = 255;
    }
  fs.writeFileSync(raDo, PNG.sync.write(R));
}

const pct = (n) => ((n / tong) * 100).toFixed(2);
const ket = {
  A: pA,
  B: pB,
  vung: [x0, y0, x1, y1],
  soPixel: tong,
  soMauA: mauA,
  soMauB: mauB,
  doiNguong0: dem[0],
  doiNguong6: dem[6],
  doiNguong24: dem[24],
  pctNguong0: Number(pct(dem[0])),
  pctNguong6: Number(pct(dem[6])),
  pctNguong24: Number(pct(dem[24])),
  lechTrungBinh: Number((tongLech / tong).toFixed(3)),
  soMangLoang: soMang,
  mangLonNhat: mangLon,
};
console.log(JSON.stringify(ket));
console.log(
  `  vùng ${rong}×${cao}=${tong}px · màu A/B=${mauA}/${mauB} · ĐỔI >0:${pct(dem[0])}% >6:${pct(dem[6])}% >24:${pct(dem[24])}% · lệch TB ${ket.lechTrungBinh} · mảng ${soMang} (lớn nhất ${mangLon}px)`,
);
