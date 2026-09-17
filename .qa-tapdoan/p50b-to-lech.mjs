/**
 * p50b-to-lech.mjs — TÔ ĐỎ những pixel LỆCH giữa hai ảnh, trên nền ảnh thứ hai.
 * Dùng khi cần biết CHỖ NÀO đổi, không chỉ BAO NHIÊU px đổi.
 *   node .qa-tapdoan/p50b-to-lech.mjs <a.png> <b.png> <ra.png>
 */
import fs from "node:fs";
import { PNG } from "pngjs";

const A = PNG.sync.read(fs.readFileSync(process.argv[2]));
const B = PNG.sync.read(fs.readFileSync(process.argv[3]));
const R = new PNG({ width: B.width, height: B.height });
let n = 0;
for (let i = 0; i < B.data.length; i += 4) {
  const lech =
    Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
  if (lech > 6) {
    n += 1;
    R.data[i] = 255;
    R.data[i + 1] = 0;
    R.data[i + 2] = 255;
  } else {
    R.data[i] = B.data[i];
    R.data[i + 1] = B.data[i + 1];
    R.data[i + 2] = B.data[i + 2];
  }
  R.data[i + 3] = 255;
}
fs.writeFileSync(process.argv[4], PNG.sync.write(R));
console.log(`${process.argv[4]} · ${n} px tô đỏ`);
