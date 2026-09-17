/**
 * p50b-dem-pixel.mjs — ĐẾM PIXEL "CÓ HÌNH HỌC" trong vùng CANVAS 3D.
 *
 * Vì sao cần: `__demSaBan.bieuTuong()` là phép CHIẾU tính ngoài trang — nó nói hộp
 * bao nằm ở đâu trên màn, KHÔNG nói renderer có vẽ pixel nào không. Ở khung "trần
 * zoom" các biểu tượng chỉ còn ~15 px nên mắt khó phân xử trên ảnh thu nhỏ. Bộ đếm
 * này đọc CHÍNH điểm ảnh.
 *
 * Thước: pixel khác MÀU NỀN quá ngưỡng, chỉ trong khung con của canvas 3D (bỏ mọi
 * lớp phủ DOM đã biết vị trí thì không làm được — nên thay vào đó ta lấy HIỆU giữa
 * hai ảnh cùng vùng, và đếm riêng "pixel sáng hơn nền" cho từng ảnh).
 *
 *   node .qa-tapdoan/p50b-dem-pixel.mjs <anh.png> [x0 y0 x1 y1]
 */
import fs from "node:fs";
import { PNG } from "pngjs";

const duong = process.argv[2];
const A = PNG.sync.read(fs.readFileSync(duong));
const [x0, y0, x1, y1] = process.argv.slice(3).length === 4
  ? process.argv.slice(3, 7).map(Number)
  : [0, 0, A.width, A.height];

/** Màu nền = màu xuất hiện nhiều nhất trong vùng. */
const dem = new Map();
for (let y = y0; y < y1; y += 1)
  for (let x = x0; x < x1; x += 1) {
    const i = (y * A.width + x) * 4;
    const k = `${A.data[i]},${A.data[i + 1]},${A.data[i + 2]}`;
    dem.set(k, (dem.get(k) ?? 0) + 1);
  }
const [nenK, nenN] = [...dem].sort((a, b) => b[1] - a[1])[0];
const nen = nenK.split(",").map(Number);
let khac = 0;
for (let y = y0; y < y1; y += 1)
  for (let x = x0; x < x1; x += 1) {
    const i = (y * A.width + x) * 4;
    const d =
      Math.abs(A.data[i] - nen[0]) + Math.abs(A.data[i + 1] - nen[1]) + Math.abs(A.data[i + 2] - nen[2]);
    if (d > 24) khac += 1;
  }
const tong = (x1 - x0) * (y1 - y0);
console.log(
  `${duong.split(/[\\/]/).slice(-2).join("/")} vùng ${x1 - x0}×${y1 - y0}: nền=${nenK} (${((nenN / tong) * 100).toFixed(1)} %) · khác nền ${khac} px = ${((khac / tong) * 100).toFixed(3)} % · số màu ${dem.size}`,
);
