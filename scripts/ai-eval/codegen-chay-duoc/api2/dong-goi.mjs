/**
 * Đóng gói bộ `tasks-api2` từ nguồn từng bài (`api2/bai/<id>/`) ⇒ `tasks-api2.json` + `fake-api2.json`.
 *
 * Nguồn mỗi bài (sửa ở ĐÂY, không sửa JSON sinh ra):
 *   bai.json   — id, lang, name, nhom, thuVien, dinhDanh, [kem], [csproj], [pg], [thoatCuong], [tranMs]
 *   de.md      — đề (prompt) gửi model, nguyên văn
 *   test.*     — bài kiểm ẨN (model không thấy)
 *   ok.*       — lời giải mẫu (fake-ok — PHẢI đạt)
 *   bad.*      — lời giải sai nhưng CHẠY ĐƯỢC (fake-bad — PHẢI trượt)
 *
 *   node scripts/ai-eval/codegen-chay-duoc/api2/dong-goi.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API2 = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.dirname(API2);
const DUOI = { ts: "ts", tsx: "tsx", cs: "cs", pgsql: "sql", tsql: "sql", ps1: "ps1" };
const DUOI_TEST = { ts: "test.ts", tsx: "test.tsx", cs: "test.cs", pgsql: "test.mjs", tsql: "test.cs", ps1: "test.ps1" };
const THU_TU_NHOM = ["ts-thu-vien", "react", "ot-node", "ot-dotnet", "sql", "powershell"];

const doc = (p) => fs.readFileSync(p, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
const tasks = [];
const fake = { "fake-ok": {}, "fake-bad": {} };
for (const id of fs.readdirSync(path.join(API2, "bai")).sort()) {
  const d = path.join(API2, "bai", id);
  const m = JSON.parse(doc(path.join(d, "bai.json")));
  if (m.id !== id) throw new Error(`${id}: bai.json id=${m.id} lệch tên thư mục`);
  const e = DUOI[m.lang];
  if (!e) throw new Error(`${id}: lang lạ ${m.lang}`);
  for (const k of m.kem ?? []) if (!fs.existsSync(path.join(BENCH, k))) throw new Error(`${id}: thiếu tệp kèm ${k}`);
  if (m.csproj && !fs.existsSync(path.join(BENCH, m.csproj))) throw new Error(`${id}: thiếu ${m.csproj}`);
  const { id: _i, lang, name, nhom, thuVien, dinhDanh, ...them } = m;
  if (!THU_TU_NHOM.includes(nhom)) throw new Error(`${id}: nhóm lạ ${nhom}`);
  tasks.push({ id, lang, name, nhom, thuVien, dinhDanh, prompt: doc(path.join(d, "de.md")).trim(), test: doc(path.join(d, DUOI_TEST[lang])), ...them });
  fake["fake-ok"][id] = doc(path.join(d, `ok.${e}`));
  fake["fake-bad"][id] = doc(path.join(d, `bad.${e}`));
  for (const k of ["fake-ok", "fake-bad"]) {
    if (dinhDanh && !fake[k][id].includes(dinhDanh)) throw new Error(`${id}: ${k} không chứa định danh "${dinhDanh}" (trichMa sẽ không ưu tiên được khối)`);
  }
}
tasks.sort((a, b) => THU_TU_NHOM.indexOf(a.nhom) - THU_TU_NHOM.indexOf(b.nhom) || a.id.localeCompare(b.id));
fs.writeFileSync(path.join(BENCH, "tasks-api2.json"), JSON.stringify(tasks, null, 1) + "\n");
fs.writeFileSync(path.join(BENCH, "fake-api2.json"), JSON.stringify(fake, null, 1) + "\n");
const dem = {};
for (const t of tasks) dem[t.nhom] = (dem[t.nhom] ?? 0) + 1;
console.log(`tasks-api2.json: ${tasks.length} bài`, dem);
