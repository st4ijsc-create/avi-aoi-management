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

test("liệt kê đệ quy, đường POSIX tương đối, kích thước byte", async () => {
  const goc = await dungCay({ "a.txt": 3, "sub/b.txt": 5, "sub/sub2/c.md": 7 });
  try {
    assert.deepEqual(await quetThuMuc(goc), [
      { duong: "a.txt", kichThuoc: 3 },
      { duong: "sub/b.txt", kichThuoc: 5 },
      { duong: "sub/sub2/c.md", kichThuoc: 7 },
    ]);
  } finally {
    await don(goc);
  }
});

test("bỏ qua theo tên và lọc theo đuôi", async () => {
  const goc = await dungCay({ "app.js": 10, "doc.md": 4, "node_modules/x/y.js": 99, "lib/util.js": 6 });
  try {
    assert.deepEqual(await quetThuMuc(goc, { boQua: ["node_modules"], duoi: [".js"] }), [
      { duong: "app.js", kichThuoc: 10 },
      { duong: "lib/util.js", kichThuoc: 6 },
    ]);
  } finally {
    await don(goc);
  }
});

test("tổng hợp theo đuôi", () => {
  const ds = [
    { duong: "a.js", kichThuoc: 10 },
    { duong: "b/c.js", kichThuoc: 5 },
    { duong: "d.md", kichThuoc: 3 },
  ];
  assert.deepEqual(tongHopTheoDuoi(ds), [
    { duoi: ".js", soTep: 2, tongKichThuoc: 15 },
    { duoi: ".md", soTep: 1, tongKichThuoc: 3 },
  ]);
});
