/** ph52/phong.mjs — cắt một vùng và phóng ×N (nearest) để soi bằng mắt.
 *   node .qa-tapdoan/ph52/phong.mjs <in.png> <x0> <y0> <x1> <y1> <N> <ra.png>
 */
import fs from "node:fs";
import { PNG } from "pngjs";
const [inp, x0, y0, x1, y1, n, ra] = [
  process.argv[2],
  ...process.argv.slice(3, 7).map(Number),
  Number(process.argv[7]),
  process.argv[8],
];
const A = PNG.sync.read(fs.readFileSync(inp));
if (!(x0 >= 0 && y0 >= 0 && x1 <= A.width && y1 <= A.height && x1 > x0 && y1 > y0))
  throw new Error(`VÙNG SAI [${x0},${y0},${x1},${y1}] trên ảnh ${A.width}x${A.height}`);
const w = x1 - x0;
const h = y1 - y0;
const R = new PNG({ width: w * n, height: h * n });
for (let y = 0; y < h * n; y += 1)
  for (let x = 0; x < w * n; x += 1) {
    const i = ((y0 + Math.floor(y / n)) * A.width + (x0 + Math.floor(x / n))) * 4;
    const j = (y * w * n + x) * 4;
    R.data[j] = A.data[i];
    R.data[j + 1] = A.data[i + 1];
    R.data[j + 2] = A.data[i + 2];
    R.data[j + 3] = 255;
  }
fs.writeFileSync(ra, PNG.sync.write(R));
console.log(`${inp} [${x0},${y0},${x1},${y1}] ×${n} → ${ra} (${w * n}×${h * n})`);
