// cắt + phóng ảnh để ĐỌC BẰNG MẮT. node .qa-dot58/cat-anh.mjs <src> <x> <y> <w> <h> <zoom> <dest>
import { PNG } from "pngjs";
import { readFileSync, writeFileSync } from "node:fs";
const [src, x, y, w, h, z, dest] = process.argv.slice(2);
const A = PNG.sync.read(readFileSync(src));
const X = +x, Y = +y, W = +w, H = +h, Z = +z;
const out = new PNG({ width: W * Z, height: H * Z });
for (let j = 0; j < H * Z; j++) for (let i = 0; i < W * Z; i++) {
  const si = ((Y + Math.floor(j / Z)) * A.width + (X + Math.floor(i / Z))) * 4;
  const di = (j * out.width + i) * 4;
  out.data[di] = A.data[si]; out.data[di + 1] = A.data[si + 1]; out.data[di + 2] = A.data[si + 2]; out.data[di + 3] = 255;
}
writeFileSync(dest, PNG.sync.write(out));
console.log(`${dest} ${W * Z}x${H * Z} <- ${src} (${X},${Y},${W},${H}) x${Z}`);
