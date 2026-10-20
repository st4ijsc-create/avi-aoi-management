/**
 * KHO BÀI của bộ đo ngẫu nhiên — nạp, kiểm hình dạng, lấy VÂN TAY.
 *
 * Mỗi bài là một thư mục `kho/<id>/`:
 *   bai.json      siêu dữ liệu (xem `KIEU_HOP_LE`, README §Định dạng bài)
 *   khung/        dự án KHỞI ĐẦU đầy đủ: cấu hình, test HIỂN THỊ, tệp mã khung (chữ ký rỗng) — thứ model/agent nhận
 *   an/           test ẨN, cùng đường tương đối như trong dự án (chép vào lúc chấm, dọn ngay sau)
 *   mau/          lời giải mẫu — các tệp chép ĐÈ lên khung (phải chứa mọi tệp trong `tepGiai`)
 *
 * VÂN TAY = sha256 (12 hex đầu) của MỌI byte trong thư mục bài (đường tương đối + nội dung, sắp xếp). Báo cáo ghi vân
 * tay từng bài ⇒ ai cũng kiểm được bài có bị sửa sau khi đo không (luật kho: README §Luật kho bài).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { KHO } from "./moiTruong.mjs";

export const NGON_NGU = ["py", "js", "ts", "cs", "java", "cpp", "sql", "go", "rs", "st"];
export const MUC = ["thuat-toan", "thu-vien", "ung-dung"];
export const KIEU_THEO_NGON_NGU = {
  py: "pytest", sql: "pytest", js: "node", ts: "node", cs: "dotnet", java: "java", cpp: "cmake", go: "go", rs: "cargo", st: "st",
};
/** Tên đầy đủ ngôn ngữ + nền tảng — dùng trong câu hỏi gửi model/agent. */
export const TEN_NGON_NGU = {
  py: "Python 3.14 (pytest)",
  js: "JavaScript — Node.js 24, ESM (node --test)",
  ts: "TypeScript chạy thẳng bằng Node.js 24 (tự bóc kiểu: CHỈ cú pháp xoá được — không enum/namespace/parameter properties; import ghi đuôi .ts)",
  cs: "C# — .NET 10 (xUnit)",
  java: "Java 26 (JDK thuần, không Maven/Gradle)",
  cpp: "C++20 — CMake + MSVC",
  sql: "SQL — SQLite 3.50 (chạy qua Python sqlite3)",
  go: "Go 1.27 (go test)",
  rs: "Rust (stable, edition 2021, cargo test, không crate ngoài)",
  st: "IEC 61131-3 Structured Text kiểu CODESYS (biên dịch bằng RuSTy; khối chuẩn TON/TOF/TP/R_TRIG/F_TRIG/CTU/CTD/SR/RS có sẵn — KHÔNG tự định nghĩa lại; không viết PROGRAM/main)",
};

const BO_QUA = new Set(["bin", "obj", "_b", "target", "out-kt", "__pycache__", ".pytest_cache", "node_modules"]);

/** Liệt kê tệp (đường tương đối POSIX) dưới `goc`, bỏ thư mục sản phẩm dựng. */
export function lietKeTep(goc, rel = "") {
  const ra = [];
  const d = rel ? `${goc}/${rel}` : goc;
  if (!fs.existsSync(d)) return ra;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (BO_QUA.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) ra.push(...lietKeTep(goc, r));
    else if (e.isFile()) ra.push(r);
  }
  return ra.sort();
}

export function vanTay(thuMucBai) {
  const h = crypto.createHash("sha256");
  for (const rel of lietKeTep(thuMucBai)) {
    h.update(rel + "\0");
    h.update(fs.readFileSync(`${thuMucBai}/${rel}`));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 12);
}

/** Kiểm hình dạng một bài; trả danh sách lỗi (rỗng = hợp lệ). */
function kiemBai(b, dir) {
  const loi = [];
  const can = ["id", "lang", "muc", "kieu", "tieuDe", "deBai", "tepGiai", "testHienThi", "testAn", "tepBaoVe", "soTest"];
  for (const k of can) if (b[k] === undefined) loi.push(`thiếu trường ${k}`);
  if (loi.length) return loi;
  if (b.id !== path.basename(dir)) loi.push(`id ${b.id} ≠ tên thư mục ${path.basename(dir)}`);
  if (!NGON_NGU.includes(b.lang)) loi.push(`lang lạ ${b.lang}`);
  if (!MUC.includes(b.muc)) loi.push(`muc lạ ${b.muc}`);
  if (KIEU_THEO_NGON_NGU[b.lang] !== b.kieu) loi.push(`kieu ${b.kieu} không khớp lang ${b.lang}`);
  for (const t of b.tepGiai) if (!fs.existsSync(`${dir}/mau/${t}`)) loi.push(`mau thiếu tệp giải ${t}`);
  for (const t of b.testHienThi) {
    if (!fs.existsSync(`${dir}/khung/${t}`)) loi.push(`khung thiếu test hiển thị ${t}`);
    if (!b.tepBaoVe.includes(t)) loi.push(`test hiển thị ${t} phải nằm trong tepBaoVe`);
  }
  for (const t of b.testAn) if (!fs.existsSync(`${dir}/an/${t}`)) loi.push(`an thiếu test ẩn ${t}`);
  for (const t of b.tepBaoVe) if (!fs.existsSync(`${dir}/khung/${t}`)) loi.push(`tepBaoVe ${t} không có trong khung`);
  for (const t of b.tepGiai) if (b.tepBaoVe.includes(t)) loi.push(`tệp giải ${t} không được nằm trong tepBaoVe`);
  if (!(b.soTest.hienThi > 0 && b.soTest.an > 0)) loi.push("soTest.hienThi và soTest.an phải > 0");
  if (!Array.isArray(b.sai) || b.sai.length === 0) loi.push("thiếu đột biến `sai` (lời giải sai-nhưng-chạy để kiểm thước)");
  return loi;
}

const MA_MUC = { "thuat-toan": "tt", "thu-vien": "tv", "ung-dung": "ud" };
const LANG_THEO_KIEU = Object.entries(KIEU_THEO_NGON_NGU).reduce((m, [l, k]) => ((m[k] ??= []).push(l), m), {});

/** Khớp NHANH theo tên thư mục (trước khi đọc bai.json) — để bài đang viết dở của người khác không làm hỏng lượt lọc. */
function khopTheoId(id, only) {
  if (!only) return true;
  return only.split(",").map((x) => x.trim()).filter(Boolean).some((x) =>
    x === id || id.startsWith(x + "-") || (MA_MUC[x] && new RegExp(`^[a-z]+-${MA_MUC[x]}\d`).test(id)) ||
    (LANG_THEO_KIEU[x] ?? []).some((l) => id.startsWith(l + "-")) || x === "nhieu");
}

/**
 * Nạp kho (sắp theo id). `only` (như --only) lọc theo tên thư mục TRƯỚC khi kiểm hình dạng: bài ngoài phạm vi không
 * được đọc. Bài TRONG phạm vi hỏng hình dạng ⇒ NÉM (bộ đo hỏng, không để thành "model trượt").
 */
export function docKho({ boQuaLoi = false, only = null } = {}) {
  if (!fs.existsSync(KHO)) return [];
  const ds = [];
  const hong = [];
  for (const id of fs.readdirSync(KHO).sort()) {
    if (!khopTheoId(id, only)) continue;
    const dir = `${KHO}/${id}`;
    if (!fs.statSync(dir).isDirectory() || !fs.existsSync(`${dir}/bai.json`)) continue;
    let b;
    try { b = JSON.parse(fs.readFileSync(`${dir}/bai.json`, "utf8")); }
    catch (e) { hong.push(`${id}: bai.json hỏng (${e.message})`); continue; }
    const loi = kiemBai(b, dir);
    if (loi.length) { hong.push(`${id}: ${loi.join("; ")}`); continue; }
    ds.push({
      ...b,
      dir,
      khungAbs: `${dir}/khung`,
      anAbs: `${dir}/an`,
      mauAbs: `${dir}/mau`,
      vanTay: vanTay(dir),
      nhieuTep: b.tepGiai.length > 1,
    });
  }
  if (hong.length && !boQuaLoi) throw new Error(`KHO BÀI HỎNG (${hong.length}):\n  ${hong.join("\n  ")}`);
  return ds;
}

/** Lọc theo `--only id,…|lang|muc|kieu`. */
export function locBai(ds, only) {
  if (!only) return ds;
  const k = only.split(",").map((s) => s.trim()).filter(Boolean);
  return ds.filter((b) => k.some((x) => x === b.id || x === b.lang || x === b.muc || x === b.kieu || (x === "nhieu" && b.nhieuTep)));
}
