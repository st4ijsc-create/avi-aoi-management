/**
 * Hàm dùng chung cho mọi `tasks/<stack>/<id>/check.mjs`.
 *
 * HỢP ĐỒNG check.mjs: thoát 0 = ĐẠT, 1 = TRƯỢT, 2 = THƯỚC HỎNG hoặc MÔI TRƯỜNG SAI (vứt số, không tính là trượt).
 * Dòng cuối stdout luôn là MỘT dòng JSON `{ id, dat, lyDo: string[], ... }`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TASKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").split(path.sep).join("/");
export const ROOT = path.resolve(TASKS, "../../..").split(path.sep).join("/");
export const BENCH_CODEGEN = `${ROOT}/scripts/ai-eval/codegen-chay-duoc`;

/** Mã thoát của check.mjs. */
export const DAT = 0;
export const TRUOT = 1;
export const THUOC_HONG = 2;

/** Lỗi của THƯỚC hoặc môi trường (cây sai, đột biến không khớp, trình chạy không ra tổng kết): thoát 2. */
export class LoiThuoc extends Error {}

/** Thư mục bài + `bai.json` + `prompt.md` từ `import.meta.url` của check.mjs. */
export function docBai(urlCheck) {
  const dir = path.dirname(fileURLToPath(urlCheck)).split(path.sep).join("/");
  const bai = JSON.parse(fs.readFileSync(`${dir}/bai.json`, "utf8"));
  const prompt = fs.readFileSync(`${dir}/prompt.md`, "utf8");
  return { dir, bai, prompt };
}

export function thamSo(argv = process.argv.slice(2)) {
  const lay = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
  };
  return { lay, co: (k) => argv.includes(k), argv };
}

/** In kết quả (một dòng JSON, dòng cuối) và trả mã thoát. */
export function ketThuc(kq, ma) {
  console.log(JSON.stringify(kq));
  return ma ?? (kq.dat ? DAT : TRUOT);
}

/** Mọi bài: duyệt `tasks/<stack>/<id>/bai.json`. */
export function danhSachBai() {
  const ra = [];
  for (const stack of fs.readdirSync(TASKS, { withFileTypes: true })) {
    if (!stack.isDirectory() || stack.name === "lib") continue;
    for (const id of fs.readdirSync(`${TASKS}/${stack.name}`, { withFileTypes: true })) {
      const dir = `${TASKS}/${stack.name}/${id.name}`;
      if (!id.isDirectory() || !fs.existsSync(`${dir}/bai.json`)) continue;
      ra.push({ dir, stack: stack.name, ...JSON.parse(fs.readFileSync(`${dir}/bai.json`, "utf8")) });
    }
  }
  return ra.sort((a, b) => (a.stack + a.id).localeCompare(b.stack + b.id));
}
