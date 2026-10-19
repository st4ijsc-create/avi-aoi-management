import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dinhDangTien, locSapXep } from "../src/locSapXep.mjs";

/** Biên dịch src/BangSanPham.jsx (JSX automatic) thành tệp .mjs TẠM cạnh nó, import, rồi xoá tệp tạm. */
async function napBang(nhan) {
  const nguon = fileURLToPath(new URL("../src/BangSanPham.jsx", import.meta.url));
  const tam = path.join(path.dirname(nguon), `.tam-${nhan}-${process.pid}.mjs`);
  const { code } = transformSync(fs.readFileSync(nguon, "utf8"), { loader: "jsx", jsx: "automatic", format: "esm", sourcefile: nguon });
  fs.writeFileSync(tam, code);
  try {
    return await import(pathToFileURL(tam).href);
  } finally {
    fs.rmSync(tam, { force: true });
  }
}
const { BangSanPham } = await napBang("hien-thi");
const ve = (props) => renderToStaticMarkup(createElement(BangSanPham, props));

const SP = [
  { ma: "SP3", ten: "Thước", gia: 8000, ton: 4 },
  { ma: "SP1", ten: "Bút", gia: 5000, ton: 10 },
  { ma: "SP2", ten: "Compa", gia: 25000, ton: 2 },
];

test("định dạng tiền", () => {
  assert.equal(dinhDangTien(1234567), "1.234.567 ₫");
  assert.equal(dinhDangTien(0), "0 ₫");
});

test("sắp xếp theo giá tăng", () => {
  assert.deepEqual(locSapXep(SP, { sapXep: "gia" }).map((x) => x.ma), ["SP1", "SP3", "SP2"]);
});

test("bảng mặc định: sắp theo tên tăng, caption và aria-sort", () => {
  const html = ve({ sanPham: SP });
  assert.ok(html.startsWith('<table class="bang-sp"><caption>3 sản phẩm</caption>'), html);
  assert.ok(html.includes('<th aria-sort="ascending">Tên</th>'), html);
  assert.deepEqual([...html.matchAll(/data-ma="([^"]+)"/g)].map((m) => m[1]), ["SP1", "SP2", "SP3"]);
  assert.ok(html.includes('<td class="so">25.000 ₫</td>'), html);
});
