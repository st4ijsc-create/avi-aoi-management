import { test } from "node:test";
import assert from "node:assert/strict";
import { taoUngDung } from "../src/app.mjs";

const JSON_UTF8 = "application/json; charset=utf-8";
const KHOA = { "x-khoa": "bi-mat" };

test("GET /sp khi kho rỗng", async () => {
  const app = taoUngDung();
  assert.deepEqual(await app.xuLy({ method: "GET", url: "/sp" }), {
    status: 200,
    headers: { "content-type": JSON_UTF8, "x-ung-dung": "kho-sp" },
    body: { tong: 0, ds: [] },
  });
});

test("POST /sp tạo sản phẩm rồi GET /sp/:id đọc lại", async () => {
  const app = taoUngDung();
  const tao = await app.xuLy({ method: "POST", url: "/sp", headers: KHOA, body: { ten: "Bút", gia: 5000 } });
  assert.deepEqual(tao, {
    status: 201,
    headers: { location: "/sp/1", "content-type": JSON_UTF8, "x-ung-dung": "kho-sp" },
    body: { id: 1, ten: "Bút", gia: 5000, ton: 0 },
  });
  const doc = await app.xuLy({ method: "GET", url: "/sp/1" });
  assert.equal(doc.status, 200);
  assert.deepEqual(doc.body, { id: 1, ten: "Bút", gia: 5000, ton: 0 });
});

test("ghi mà thiếu khoá ⇒ 401, không có header x-ung-dung", async () => {
  const app = taoUngDung();
  assert.deepEqual(await app.xuLy({ method: "POST", url: "/sp", body: { ten: "Bút", gia: 1 } }), {
    status: 401,
    headers: { "content-type": JSON_UTF8 },
    body: { loi: "chua-xac-thuc" },
  });
});

test("đường lạ ⇒ 404", async () => {
  const app = taoUngDung();
  assert.deepEqual(await app.xuLy({ method: "GET", url: "/khong-co" }), {
    status: 404,
    headers: { "content-type": JSON_UTF8 },
    body: { loi: "khong-tim-thay" },
  });
});
