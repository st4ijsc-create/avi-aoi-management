// Test ẩn bài js-loi-3-lop: lỗi lệch 1 đồng khi trả hàng có giảm giá — sửa tận gốc, không đổi định dạng CSV, có test hồi quy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tongDon, tienDong, xuatCsv } from "../index.mjs";
import { lamTron, phanTramCua } from "../src/tien.mjs";

// `node --test` đặt NODE_TEST_CONTEXT cho tệp test; `node --test` lồng mà kế thừa nó thì thoát 0 dù đỏ ⇒ bỏ biến này.
const ENV_CON = { ...process.env };
delete ENV_CON.NODE_TEST_CONTEXT;
const DA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Bản src/tien.mjs GỐC (trước khi sửa): test hồi quy của bài làm phải ĐỎ trên nó.
const TIEN_GOC = "// Phép tính tiền dùng chung. Mọi số tiền là đồng (số nguyên).\n\n/** Làm tròn tới đồng. */\nexport function lamTron(x) {\n  return Math.round(x);\n}\n\n/** `phanTram` % của `soTien`, làm tròn tới đồng. */\nexport function phanTramCua(soTien, phanTram) {\n  return lamTron((soTien * phanTram) / 100);\n}\n\nexport function congTien(...ds) {\n  return ds.reduce((s, x) => s + x, 0);\n}\n";
const ban = (sl, gia, giam) => ({ sanPham: "X", soLuong: sl, donGia: gia, giamPhanTram: giam });

test("ví dụ trong báo lỗi: DH-102 mua rồi trả đúng món ⇒ 0", () => {
  const don = { ma: "DH-102", dong: [ban(1, 12345, 10), ban(-1, 12345, 10)] };
  assert.deepEqual(tongDon(don), { soDong: 2, truocThue: 0, thue: 0, tong: 0 });
  assert.equal(xuatCsv([don]), "ma_don,so_dong,truoc_thue,thue,tong\nDH-102,2,0,0,0\nTONG_CONG,2,0,0,0\n");
});

test("dòng trả hàng đúng bằng số âm của dòng bán ở mọi khoản", () => {
  for (const [gia, giam] of [[12345, 10], [25, 10], [999, 50], [1, 50], [150000, 0], [77777, 15]]) {
    assert.equal(tienDong(ban(-1, gia, giam)) + 0, -tienDong(ban(1, gia, giam)) + 0, `${gia} @${giam}`);
    const mua = tongDon({ dong: [ban(1, gia, giam)] });
    const tra = tongDon({ dong: [ban(-1, gia, giam)] });
    assert.deepEqual([tra.truocThue, tra.thue, tra.tong].map((x) => x + 0), [-mua.truocThue, -mua.thue, -mua.tong].map((x) => x + 0), `${gia} @${giam}`);
  }
});

// kiem-dinh 11/11: chấm theo HÀNH VI của phép tính tiền dùng chung (src/tien.mjs), không ép sửa ở lamTron hay phanTramCua.
test("tận gốc: phép tính phần trăm tiền dùng chung đối xứng quanh 0, số dương không đổi", () => {
  for (const [st, pt] of [[12345, 10], [25, 10], [1, 50], [999, 50], [77777, 15], [3, 50]]) assert.equal(phanTramCua(-st, pt) + 0, -phanTramCua(st, pt) + 0, `${st} @${pt}`);
  assert.equal(lamTron(2.5), 3);
  assert.equal(lamTron(2.4), 2);
  assert.equal(lamTron(1234.5), 1235);
  assert.equal(phanTramCua(12345, 10), 1235);
  assert.equal(phanTramCua(-12345, 10), -1235);
});

test("trả một phần: mua 3 trả 1", () => {
  // bán: 37035 - 3704 = 33331, thuế 2666; trả: -12345 + 1235 = -11110, thuế -889
  assert.deepEqual(tongDon({ dong: [ban(3, 12345, 10), ban(-1, 12345, 10)] }), { soDong: 2, truocThue: 22221, thue: 1777, tong: 23998 });
});

test("đơn thường không đổi số, CSV không đổi định dạng", () => {
  const dh1 = { ma: "DH-101", dong: [ban(2, 150000, 10), { sanPham: "MU", soLuong: 1, donGia: 85000 }] };
  const dh2 = { ma: "DH-102", dong: [ban(1, 12345, 10), ban(-1, 12345, 10)] };
  assert.equal(xuatCsv([dh1, dh2]), "ma_don,so_dong,truoc_thue,thue,tong\nDH-101,2,355000,28400,383400\nDH-102,2,0,0,0\nTONG_CONG,4,355000,28400,383400\n");
});

test("có test hồi quy của bài làm: xanh trên mã đã sửa, ĐỎ trên mã gốc", () => {
  const BO = new Set(["baoCao.test.mjs", "an-f.test.mjs"]);
  const tep = fs.readdirSync(path.join(DA, "test")).filter((f) => f.endsWith(".test.mjs") && !BO.has(f));
  assert.ok(tep.length >= 1, "thiếu tệp test hồi quy mới trong test/");
  const chay = (goc) => spawnSync(process.execPath, ["--test", ...tep.map((f) => path.join("test", f))], { cwd: goc, env: ENV_CON, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  const moi = chay(DA);
  assert.equal(moi.status, 0, `test hồi quy phải xanh trên mã đã sửa:\n${(moi.stdout ?? "").slice(-800)}`);
  const tam = fs.mkdtempSync(path.join(os.tmpdir(), "loi3lop-"));
  try {
    fs.cpSync(DA, tam, { recursive: true });
    fs.writeFileSync(path.join(tam, "src", "tien.mjs"), TIEN_GOC);
    const cu = chay(tam);
    assert.notEqual(cu.status, 0, "test hồi quy phải ĐỎ trên mã gốc (nếu không, nó không bắt được lỗi này)");
  } finally {
    fs.rmSync(tam, { recursive: true, force: true });
  }
});
