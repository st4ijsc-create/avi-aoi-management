/**
 * p50b-so-n1.mjs — SO HAI KẾT QUẢ `n1-do` Ô-THEO-Ô, bỏ các trường vốn đổi mỗi lượt.
 *   node .qa-tapdoan/p50b-so-n1.mjs <a.json> <b.json>
 * In MỌI ô khác nhau, đường dẫn đầy đủ — để "không hồi quy" là một danh sách rỗng
 * chứ không phải một lời khai.
 */
import fs from "node:fs";

const BO_QUA = new Set(["luc", "nhan"]);
const A = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const B = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const khac = [];
function di(a, b, duong) {
  if (BO_QUA.has(duong.split(".").pop())) return;
  if (a === b) return;
  const ka = a && typeof a === "object";
  const kb = b && typeof b === "object";
  if (!ka || !kb) {
    khac.push(`${duong}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    return;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) di(a[k], b[k], `${duong}.${k}`);
}
di(A, B, "");
console.log(`${process.argv[2]} → ${process.argv[3]}`);
console.log(`  ${khac.length} ô khác`);
for (const d of khac) console.log("   · " + d);
