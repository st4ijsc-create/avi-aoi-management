/**
 * p50b-phong.mjs — CẮT + PHÓNG (nearest-neighbour) một vùng ảnh để MẮT NGƯỜI phân xử.
 * Ở khung "trần zoom" biểu tượng toà chỉ còn ~15 px trên nền tối; ảnh gốc 1:1 không
 * đủ để nói "có" hay "không có". Phóng KHÔNG thêm thông tin, chỉ làm thông tin sẵn có
 * nhìn thấy được — và vẫn là pixel thật, không nội suy.
 *   node .qa-tapdoan/p50b-phong.mjs <vao.png> <ra.png> <x0> <y0> <w> <h> <lan>
 */
import fs from "node:fs";
import { PNG } from "pngjs";

const [vao, raDuong, x0, y0, w, h, lan] = [
  process.argv[2],
  process.argv[3],
  ...process.argv.slice(4, 9).map(Number),
];
const A = PNG.sync.read(fs.readFileSync(vao));
const R = new PNG({ width: w * lan, height: h * lan });
for (let y = 0; y < h * lan; y += 1)
  for (let x = 0; x < w * lan; x += 1) {
    const sx = Math.min(A.width - 1, x0 + Math.floor(x / lan));
    const sy = Math.min(A.height - 1, y0 + Math.floor(y / lan));
    const i = (sy * A.width + sx) * 4;
    const j = (y * w * lan + x) * 4;
    R.data[j] = A.data[i];
    R.data[j + 1] = A.data[i + 1];
    R.data[j + 2] = A.data[i + 2];
    R.data[j + 3] = 255;
  }
fs.writeFileSync(raDuong, PNG.sync.write(R));
console.log(`${raDuong}  ← ${vao} [${x0},${y0} ${w}×${h}] ×${lan}`);
