// ĐỢT 49 mục E — đếm dân số census trên MỘT CÂY BẤT KỲ (git archive), để quy trách nhiệm độ trôi.
//   npx tsx .qa-dot49/dem-census.mts <goc-repo>
import { quetPhamViDoc, nhomCua, khoaCua } from "../server/routers/phamViDocScan";
const goc = process.argv[2];
const q = quetPhamViDoc(goc);
const dem: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, S: 0 };
for (const t of q.thuTuc) dem[nhomCua(t)] = (dem[nhomCua(t)] ?? 0) + 1;
console.log(JSON.stringify({ goc, ...dem, tong: q.thuTuc.length, soFile: q.soFileDuyet }));
