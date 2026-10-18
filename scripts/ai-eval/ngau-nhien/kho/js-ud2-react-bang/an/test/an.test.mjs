import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chuanHoa, dinhDangTien, locSapXep, tongGiaTri } from "../src/locSapXep.mjs";

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
const { BangSanPham } = await napBang("an");
const ve = (props) => renderToStaticMarkup(createElement(BangSanPham, props));
const cacMa = (html) => [...html.matchAll(/data-ma="([^"]+)"/g)].map((m) => m[1]);

const KHO = Object.freeze([
  Object.freeze({ ma: "K-07", ten: "Đèn bàn", gia: 350000, ton: 0 }),
  Object.freeze({ ma: "K-02", ten: "Bút bi", gia: 5000, ton: 120 }),
  Object.freeze({ ma: "K-11", ten: "Áo mưa", gia: 45000, ton: 8 }),
  Object.freeze({ ma: "K-05", ten: "but chi", gia: 5000, ton: 40 }),
  Object.freeze({ ma: "K-01", ten: "Đà Nẵng map", gia: 45000, ton: 3 }),
]);

test("dinhDangTien: nhóm nghìn bằng dấu chấm, số âm, biên, sai kiểu", () => {
  assert.equal(dinhDangTien(999), "999 ₫");
  assert.equal(dinhDangTien(1000), "1.000 ₫");
  assert.equal(dinhDangTien(100000), "100.000 ₫");
  assert.equal(dinhDangTien(-1234), "-1.234 ₫");
  assert.equal(dinhDangTien(-999), "-999 ₫");
  assert.equal(dinhDangTien(9007199254740991), "9.007.199.254.740.991 ₫");
  for (const x of [1.5, "100", NaN, 2 ** 60, null]) assert.throws(() => dinhDangTien(x), TypeError);
});

test("chuanHoa: bỏ dấu tiếng Việt, đ/Đ ⇒ d, chữ thường, cả dạng tổ hợp NFD", () => {
  assert.equal(chuanHoa("Đà Nẵng"), "da nang");
  assert.equal(chuanHoa("ĐỒNG HỒ"), "dong ho");
  assert.equal(chuanHoa("Ơ ư Thước Kẻ"), "o u thuoc ke");
  assert.equal(chuanHoa("Ê é"), "e e");
});

test("lọc theo từ khoá: không dấu, không phân biệt hoa/thường, khớp tên hoặc mã", () => {
  assert.deepEqual(locSapXep(KHO, { tuKhoa: "da nang" }).map((x) => x.ma), ["K-01"]);
  assert.deepEqual(locSapXep(KHO, { tuKhoa: "  BÚT " }).map((x) => x.ma), ["K-02", "K-05"]);
  assert.deepEqual(locSapXep(KHO, { tuKhoa: "den" }).map((x) => x.ma), ["K-07"]);
  assert.deepEqual(locSapXep(KHO, { tuKhoa: "k-1" }).map((x) => x.ma), ["K-11"]);
  assert.equal(locSapXep(KHO, { tuKhoa: "   " }).length, 5);
  assert.equal(locSapXep(KHO).length, 5);
});

test("sắp xếp: tên theo dạng chuẩn hoá, hoà xếp theo mã tăng kể cả khi giảm dần, không sửa đầu vào", () => {
  assert.deepEqual(locSapXep(KHO, { sapXep: "ten" }).map((x) => x.ma), ["K-11", "K-02", "K-05", "K-01", "K-07"]);
  assert.deepEqual(locSapXep(KHO, { sapXep: "gia", tang: false }).map((x) => x.ma), ["K-07", "K-01", "K-11", "K-02", "K-05"]);
  assert.deepEqual(locSapXep(KHO, { sapXep: "gia" }).map((x) => x.ma), ["K-02", "K-05", "K-01", "K-11", "K-07"]);
  assert.deepEqual(locSapXep(KHO, { sapXep: "ton", tang: false }).map((x) => x.ma), ["K-02", "K-05", "K-11", "K-01", "K-07"]);
  const hai = [{ ma: "B", ten: "bút", gia: 1, ton: 1 }, { ma: "A", ten: "Bút", gia: 1, ton: 1 }];
  assert.deepEqual(locSapXep(hai, { tang: false }).map((x) => x.ma), ["A", "B"]);
  assert.notEqual(locSapXep(KHO), KHO);
  assert.throws(() => locSapXep(KHO, { sapXep: "ma" }), RangeError);
  assert.throws(() => locSapXep(KHO, { sapXep: "toString" }), RangeError);
});

test("tongGiaTri", () => {
  assert.equal(tongGiaTri(KHO), 5000 * 120 + 45000 * 8 + 5000 * 40 + 45000 * 3);
  assert.equal(tongGiaTri([]), 0);
});

test("HTML đầy đủ, đúng từng thẻ và thuộc tính", () => {
  const html = ve({
    sanPham: [{ ma: "B2", ten: "Bút", gia: 5000, ton: 0 }, { ma: "A1", ten: "Áo", gia: 120000, ton: 3 }],
    sapXep: "gia",
    tang: false,
  });
  const ky =
    '<table class="bang-sp"><caption>2 sản phẩm</caption>' +
    '<thead><tr><th>Mã</th><th>Tên</th><th aria-sort="descending">Giá</th><th>Tồn</th></tr></thead>' +
    '<tbody><tr data-ma="A1"><td>A1</td><td>Áo</td><td class="so">120.000 ₫</td><td class="so">3</td></tr>' +
    '<tr data-ma="B2" class="het-hang"><td>B2</td><td>Bút</td><td class="so">5.000 ₫</td><td class="so">0</td></tr></tbody>' +
    '<tfoot><tr><td>Tổng</td><td></td><td class="so">360.000 ₫</td><td class="so">3</td></tr></tfoot></table>';
  assert.equal(html, ky);
});

test("aria-sort chỉ ở cột đang sắp; lớp het-hang chỉ ở dòng tồn 0", () => {
  const thTon = ve({ sanPham: KHO, sapXep: "ton" });
  assert.ok(thTon.includes('<thead><tr><th>Mã</th><th>Tên</th><th>Giá</th><th aria-sort="ascending">Tồn</th></tr></thead>'), thTon);
  assert.equal((thTon.match(/aria-sort=/g) ?? []).length, 1);
  assert.deepEqual(cacMa(thTon), ["K-07", "K-01", "K-11", "K-05", "K-02"]);
  assert.equal((thTon.match(/class="het-hang"/g) ?? []).length, 1);
  assert.ok(thTon.includes('<tr data-ma="K-07" class="het-hang">'), thTon);
  assert.ok(thTon.includes('<tr data-ma="K-02"><td>'), thTon);
  const ten = ve({ sanPham: KHO, sapXep: "ten", tang: false });
  assert.ok(ten.includes('<th aria-sort="descending">Tên</th>'), ten);
});

test("danh sách rỗng hoặc không có kết quả ⇒ đoạn thông báo thay cho bảng", () => {
  const ky = '<p class="trong">Không có sản phẩm phù hợp</p>';
  assert.equal(ve({ sanPham: [] }), ky);
  assert.equal(ve({ sanPham: KHO, tuKhoa: "khong-co-gi" }), ky);
});

test("lọc ảnh hưởng caption và tfoot; ký tự HTML trong tên được thoát", () => {
  const ds = [...KHO, { ma: "X<1>", ten: 'Kéo <b>"cắt"</b> & dán', gia: 12000, ton: 2 }];
  const html = ve({ sanPham: ds, tuKhoa: "a" });
  // "a" khớp (sau chuẩn hoá): Đèn bàn, Áo mưa, Đà Nẵng map, Kéo … dán
  assert.ok(html.includes("<caption>4 sản phẩm</caption>"), html);
  assert.deepEqual(cacMa(html), ["K-11", "K-01", "K-07", "X&lt;1&gt;"]);
  assert.ok(html.includes("<td>Kéo &lt;b&gt;&quot;cắt&quot;&lt;/b&gt; &amp; dán</td>"), html);
  assert.ok(!html.includes("<b>"), html);
  assert.ok(html.endsWith('<tfoot><tr><td>Tổng</td><td></td><td class="so">519.000 ₫</td><td class="so">13</td></tr></tfoot></table>'), html);
});
