import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { quetThuMuc, tongHopTheoDuoi } from "../src/quet.mjs";

/** Dựng cây trong thư mục tạm: khoá = đường POSIX; số ⇒ tệp n byte; chuỗi ⇒ nội dung UTF-8; khoá kết thúc "/" ⇒ thư mục rỗng. */
async function dungCay(cay) {
  const goc = await fs.mkdtemp(path.join(os.tmpdir(), "quet-"));
  for (const [rel, nd] of Object.entries(cay)) {
    const dich = path.join(goc, ...rel.split("/").filter(Boolean));
    if (rel.endsWith("/")) { await fs.mkdir(dich, { recursive: true }); continue; }
    await fs.mkdir(path.dirname(dich), { recursive: true });
    await fs.writeFile(dich, typeof nd === "number" ? Buffer.alloc(nd, 120) : nd);
  }
  return goc;
}
const don = (goc) => fs.rm(goc, { recursive: true, force: true });
const duong = (ds) => ds.map((x) => x.duong);

test("sắp xếp theo mã ký tự (không theo locale), tệp rỗng vẫn được liệt kê", async () => {
  const goc = await dungCay({ "a.txt": 3, "B.txt": 1, "a/b.txt": 2, "a-b/x.txt": 4, "a/c/d.txt": 0, "_z.txt": 6 });
  try {
    assert.deepEqual(await quetThuMuc(goc), [
      { duong: "B.txt", kichThuoc: 1 },
      { duong: "_z.txt", kichThuoc: 6 },
      { duong: "a-b/x.txt", kichThuoc: 4 },
      { duong: "a.txt", kichThuoc: 3 },
      { duong: "a/b.txt", kichThuoc: 2 },
      { duong: "a/c/d.txt", kichThuoc: 0 },
    ]);
  } finally {
    await don(goc);
  }
});

test("boQua áp cho tên tệp lẫn thư mục ở mọi độ sâu, phân biệt hoa/thường", async () => {
  const goc = await dungCay({
    "node_modules/a.js": 1, "src/node_modules/b.js": 1, "src/c.js": 2, ".DS_Store": 9,
    "src/deep/.DS_Store": 9, "src/deep/Node_Modules/d.js": 3, "dist/": 0, "giu/node_modules.txt": 4,
  });
  try {
    assert.deepEqual(duong(await quetThuMuc(goc, { boQua: ["node_modules", ".DS_Store", "dist"] })), [
      "giu/node_modules.txt", "src/c.js", "src/deep/Node_Modules/d.js",
    ]);
  } finally {
    await don(goc);
  }
});

test("lọc đuôi không phân biệt hoa/thường, theo đúng path.extname", async () => {
  const goc = await dungCay({ "A.TXT": 1, "b.txt": 2, "c.Md": 3, "d.tar.gz": 4, ".gitignore": 5, "Makefile": 6, "e.js": 7, "f.txt.bak": 8 });
  try {
    assert.deepEqual(duong(await quetThuMuc(goc, { duoi: [".txt", ".GZ"] })), ["A.TXT", "b.txt", "d.tar.gz"]);
    assert.deepEqual(duong(await quetThuMuc(goc, { duoi: [""] })), [".gitignore", "Makefile"]);
    assert.equal((await quetThuMuc(goc, { duoi: [] })).length, 8);
    assert.equal((await quetThuMuc(goc, {})).length, 8);
  } finally {
    await don(goc);
  }
});

test("thư mục rỗng ⇒ mảng rỗng; dấu phân cách cuối ở goc không đổi kết quả", async () => {
  const goc = await dungCay({ "x/": 0, "x/y/": 0, "z/": 0 });
  try {
    assert.deepEqual(await quetThuMuc(goc), []);
    await fs.writeFile(path.join(goc, "x", "y", "t.bin"), Buffer.alloc(11));
    assert.deepEqual(await quetThuMuc(goc + path.sep), [{ duong: "x/y/t.bin", kichThuoc: 11 }]);
  } finally {
    await don(goc);
  }
});

test("goc không tồn tại ⇒ ENOENT; goc là tệp ⇒ ENOTDIR", async () => {
  const goc = await dungCay({ "f.txt": 1 });
  try {
    await assert.rejects(quetThuMuc(path.join(goc, "khong-co")), (e) => e.code === "ENOENT");
    await assert.rejects(quetThuMuc(path.join(goc, "f.txt")), (e) => e.code === "ENOTDIR");
  } finally {
    await don(goc);
  }
});

test("liên kết tượng trưng / junction không bị theo và không được liệt kê", async () => {
  const goc = await dungCay({ "that/a.txt": 2, "khac/b.txt": 3 });
  try {
    try {
      await fs.symlink(path.join(goc, "khac"), path.join(goc, "that", "lien"), "junction");
    } catch {
      // máy không cho tạo liên kết ⇒ phần này chỉ còn kiểm cây thường
    }
    assert.deepEqual(duong(await quetThuMuc(path.join(goc, "that"))), ["a.txt"]);
    assert.deepEqual(duong(await quetThuMuc(goc)), ["khac/b.txt", "that/a.txt"]);
  } finally {
    await don(goc);
  }
});

test("tên Unicode, kích thước tính theo BYTE", async () => {
  const goc = await dungCay({ "Đà Nẵng.txt": "Huế", "z.txt": "ab" });
  try {
    assert.deepEqual(await quetThuMuc(goc), [
      { duong: "z.txt", kichThuoc: 2 },
      { duong: "Đà Nẵng.txt", kichThuoc: 5 },
    ]);
  } finally {
    await don(goc);
  }
});

test("cây sâu 40 tầng và 300 tệp", async () => {
  const cay = {};
  let tang = "";
  for (let i = 0; i < 40; i++) {
    tang += `d${String(i).padStart(2, "0")}/`;
    cay[`${tang}f.dat`] = i;
  }
  for (let i = 0; i < 260; i++) cay[`phang/t${String(i).padStart(3, "0")}.log`] = 1;
  const goc = await dungCay(cay);
  try {
    const ds = await quetThuMuc(goc);
    assert.equal(ds.length, 300);
    assert.equal(ds[0].duong, "d00/d01/d02/d03/d04/d05/d06/d07/d08/d09/d10/d11/d12/d13/d14/d15/d16/d17/d18/d19/d20/d21/d22/d23/d24/d25/d26/d27/d28/d29/d30/d31/d32/d33/d34/d35/d36/d37/d38/d39/f.dat");
    assert.equal(ds[0].kichThuoc, 39);
    assert.equal(ds[39].duong, "d00/f.dat");
    assert.equal(ds[40].duong, "phang/t000.log");
    assert.equal(ds[299].duong, "phang/t259.log");
    assert.deepEqual(tongHopTheoDuoi(ds), [
      { duoi: ".dat", soTep: 40, tongKichThuoc: 780 },
      { duoi: ".log", soTep: 260, tongKichThuoc: 260 },
    ]);
  } finally {
    await don(goc);
  }
});

test("tổng hợp: gộp đuôi khác hoa/thường, không đuôi là \"\", hoà xếp theo đuôi", () => {
  const ds = [
    { duong: "a/X.TXT", kichThuoc: 5 }, { duong: "b.txt", kichThuoc: 5 }, { duong: "Makefile", kichThuoc: 10 },
    { duong: "c.md", kichThuoc: 10 }, { duong: ".env", kichThuoc: 1 }, { duong: "d.dir/e", kichThuoc: 0 },
  ];
  assert.deepEqual(tongHopTheoDuoi(ds), [
    { duoi: "", soTep: 3, tongKichThuoc: 11 },
    { duoi: ".md", soTep: 1, tongKichThuoc: 10 },
    { duoi: ".txt", soTep: 2, tongKichThuoc: 10 },
  ]);
  assert.deepEqual(tongHopTheoDuoi([]), []);
});
