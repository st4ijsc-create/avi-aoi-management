import fs from "node:fs";

/** Đọc danh sách việc; tệp chưa có ⇒ danh sách rỗng. */
export function docKho(duong) {
  if (!fs.existsSync(duong)) return [];
  const raw = fs.readFileSync(duong, "utf8");
  return raw.trim() === "" ? [] : JSON.parse(raw);
}

export function ghiKho(duong, ds) {
  fs.writeFileSync(duong, JSON.stringify(ds, null, 2) + "\n", "utf8");
}

export function idKeTiep(ds) {
  return ds.reduce((m, v) => Math.max(m, v.id), 0) + 1;
}
