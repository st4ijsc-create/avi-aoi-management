// Trích NGUYÊN VĂN các dòng nghi vấn — đọc bằng docMaNguon() (G150: chuẩn hoá CRLF).
import { readFileSync } from "node:fs";
const chuanHoa = (s) => s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const docMaNguon = (p) => chuanHoa(readFileSync(p, "utf8"));
const MUC = [
  ["client/src/pages/TwinLine.tsx", 352, 356],
  ["client/src/pages/TwinLine.tsx", 374, 392],
  ["client/src/pages/TwinMay.tsx", 270, 275],
  ["client/src/pages/TwinMay.tsx", 292, 310],
  ["server/db/hierarchy.ts", 338, 341],
  ["server/db/twinCanh.ts", 256, 262],
  ["client/src/components/twin3d/van-hanh/manLine.ts", 410, 428],
];
for (const [p, a, b] of MUC) {
  const d = docMaNguon(p).split("\n");
  console.log(`\n=== ${p}:${a}-${b} ===`);
  for (let i = a; i <= b && i <= d.length; i++) console.log(String(i).padStart(5) + " | " + d[i - 1]);
}
