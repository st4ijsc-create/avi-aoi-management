/**
 * p50-anhdiff.mjs — ĐẾM PIXEL LỆCH giữa hai ảnh, và nói lệch Ở ĐÂU.
 *   node .qa-tapdoan/p50-anhdiff.mjs <a.png> <b.png>
 * Vì sao cần: md5 ảnh KHÔNG phải thước hồi quy ở màn này — chuỗi sống
 * "Updated N h ago" đổi giữa hai lượt chạy CỦA CÙNG MỘT BẢN DỰNG, nên md5 khác
 * nhau cả khi hình học y hệt. Thước đúng là: lệch ở ĐÂU.
 */
import fs from "node:fs";
import { PNG } from "pngjs";
const A = PNG.sync.read(fs.readFileSync(process.argv[2]));
const B = PNG.sync.read(fs.readFileSync(process.argv[3]));
if (A.width !== B.width || A.height !== B.height) { console.log("KHÁC CỠ", A.width, A.height, B.width, B.height); process.exit(1); }
let n = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
for (let y = 0; y < A.height; y += 1)
  for (let x = 0; x < A.width; x += 1) {
    const i = (y * A.width + x) * 4;
    if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2]) {
      n += 1;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
const tong = A.width * A.height;
console.log(`${process.argv[2].split(/[\/]/).slice(-2).join("/")} ↔ ${process.argv[3].split(/[\/]/).slice(-2).join("/")}`);
console.log(`  lệch ${n}/${tong} px = ${((n / tong) * 100).toFixed(3)} %` + (n ? ` · vùng lệch x[${minX}..${maxX}] y[${minY}..${maxY}]` : " · GIỐNG HỆT"));
