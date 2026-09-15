#!/usr/bin/env node
// Đo độ lệch giữa chuỗi migration .sql và ảnh chụp trong drizzle/meta/.
// Lệch lớn nghĩa là `drizzle-kit generate` không dùng được và `push` nguy hiểm.
// Thoát 1 khi lệch vượt ngưỡng, để cắm vào cổng CI được.
//
// Luật kèm theo: docs/DEPLOYMENT_GUIDE.md § "⛔ CẤM `drizzle-kit push`".
import fs from "node:fs";
import path from "node:path";

const GOC = path.resolve(import.meta.dirname, "..");
const tepSql = fs
  .readdirSync(path.join(GOC, "drizzle"))
  .filter((t) => t.endsWith(".sql"))
  .sort();
const soSql = tepSql.length;

const duongJournal = path.join(GOC, "drizzle/meta/_journal.json");
if (!fs.existsSync(duongJournal)) {
  console.error("KHÔNG ĐỌC ĐƯỢC: thiếu drizzle/meta/_journal.json — không đo được độ lệch.");
  process.exit(1);
}
const journal = JSON.parse(fs.readFileSync(duongJournal, "utf8"));
const soMeta = journal.entries.length;
const lech = soSql - soMeta;

console.log(`migration .sql: ${soSql} (cao nhất: ${tepSql.at(-1) ?? "—"})`);
console.log(`mục trong _journal.json: ${soMeta} (cuối: ${journal.entries.at(-1)?.tag})`);
console.log(`LỆCH: ${lech}`);

if (lech > 0) {
  console.log("");
  console.log("⛔ drizzle-kit KHÔNG dùng được trên repo này:");
  console.log("   · `generate` diff với ảnh chụp cũ hơn " + lech + " migration");
  console.log("     ⇒ sinh migration khổng lồ dựng lại gần như toàn schema.");
  console.log("   · `push` so với DB SỐNG và GỠ mọi cột không có trong schema.ts");
  console.log("     ⇒ mất dữ liệu. TUYỆT ĐỐI KHÔNG CHẠY.");
  console.log("   Viết migration bằng TAY, đánh số tiếp, chạy bằng owner `aoi`.");
  process.exit(1);
}
