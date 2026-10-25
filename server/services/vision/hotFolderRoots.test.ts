/**
 * W15 — gốc cho phép của hot-folder: mặc định rỗng ⇒ từ chối; `..`, symlink/junction trỏ ra ngoài, đường dẫn anh em có tiền tố trùng ⇒ từ chối; tệp symlink thoát thư mục ⇒ bỏ qua.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hotFolderRoots, namTrong, tepTrongThuMuc, trongGocChoPhep } from "./hotFolderRoots";

let goc = "";
let ngoai = "";
beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "hfroots-"));
  goc = path.join(base, "goc");
  ngoai = path.join(base, "goc-anh-em"); // tiền tố trùng "goc"
  fs.mkdirSync(path.join(goc, "may1"), { recursive: true });
  fs.mkdirSync(ngoai, { recursive: true });
  process.env.HOT_FOLDER_ROOTS = goc;
});
afterEach(() => {
  delete process.env.HOT_FOLDER_ROOTS;
  fs.rmSync(path.dirname(goc), { recursive: true, force: true });
});

describe("trongGocChoPhep", () => {
  it("env rỗng ⇒ ROOTS_EMPTY (mặc định từ chối)", () => {
    delete process.env.HOT_FOLDER_ROOTS;
    expect(hotFolderRoots()).toEqual([]);
    expect(trongGocChoPhep(path.join(goc, "may1"))).toMatchObject({ ok: false, ma: "ROOTS_EMPTY" });
  });
  it("đường trong gốc (kể cả chưa tồn tại) ⇒ ok; gốc chính nó ⇒ ok", () => {
    expect(trongGocChoPhep(path.join(goc, "may1")).ok).toBe(true);
    expect(trongGocChoPhep(path.join(goc, "may1", "archive")).ok).toBe(true); // chưa tồn tại
    expect(trongGocChoPhep(goc).ok).toBe(true);
  });
  it("traversal `..` ra ngoài ⇒ OUTSIDE_ROOTS", () => {
    expect(trongGocChoPhep(path.join(goc, "may1", "..", "..", "goc-anh-em"))).toMatchObject({ ok: false, ma: "OUTSIDE_ROOTS" });
  });
  it("thư mục anh em có TIỀN TỐ trùng tên gốc ⇒ ngoài gốc (không so chuỗi con thô)", () => {
    expect(trongGocChoPhep(ngoai)).toMatchObject({ ok: false, ma: "OUTSIDE_ROOTS" });
    expect(namTrong(ngoai, goc)).toBe(false);
  });
  it("symlink / junction trong gốc trỏ ra ngoài ⇒ ngoài gốc", () => {
    const lien = path.join(goc, "lien-ket");
    try {
      fs.symlinkSync(ngoai, lien, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return; // môi trường không tạo được liên kết — bỏ qua
    }
    expect(trongGocChoPhep(path.join(lien, "con"))).toMatchObject({ ok: false, ma: "OUTSIDE_ROOTS" });
  });
});

describe("tepTrongThuMuc", () => {
  it("tệp thường trong thư mục ⇒ true; tệp symlink trỏ ra ngoài ⇒ false", () => {
    const thuong = path.join(goc, "may1", "a.csv");
    fs.writeFileSync(thuong, "x");
    expect(tepTrongThuMuc(thuong, path.join(goc, "may1"))).toBe(true);
    const bi = path.join(ngoai, "bi-mat.csv");
    fs.writeFileSync(bi, "secret");
    const lien = path.join(goc, "may1", "b.csv");
    try {
      fs.symlinkSync(bi, lien, "file");
    } catch {
      return;
    }
    expect(tepTrongThuMuc(lien, path.join(goc, "may1"))).toBe(false);
  });
});
