// Kiểm NHÃN VÀNG quá hẹp: với mỗi câu có `dapAn.regex`, liệt kê mọi tài liệu kho hệ thống KHÁC nhãn `nguon` mà
// cũng chứa đáp án. Một câu "không kho nào ra nguồn đúng" mà đáp án nằm ở tệp khác là lỗi NHÃN, không phải lỗi truy hồi.
//   node scripts/ai-eval/nhan-vang-hep.mjs [st4i-may-aoi]
import fs from "node:fs";
import path from "node:path";

const corpus = process.argv[2] ?? "st4i-may-aoi";
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(md|ya?ml)$/.test(e.name)) files.push(p);
  }
};
for (const d of ["knowledge/operational-approved", "knowledge/features", "knowledge/domain", "knowledge/operational", "knowledge/workflows"]) {
  if (fs.existsSync(d)) walk(d);
}
const vang = fs.readFileSync(`knowledge/studio-golden/${corpus}.jsonl`, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l)).filter((c) => c.dapAn);
for (const c of vang) {
  const re = new RegExp(c.dapAn.regex, "i");
  const co = files.filter((f) => re.test(fs.readFileSync(f, "utf8"))).map((f) => f.split(path.sep).join("/"));
  const ngoai = co.filter((f) => !c.nguon.some((n) => f.endsWith(n)));
  if (ngoai.length) console.log(c.id, "đáp án CŨNG ở:", ngoai.join(", "), "| nhãn:", c.nguon.join(","));
}
